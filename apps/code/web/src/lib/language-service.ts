import type * as Y from "yjs"
import type { BuildSource } from "./build-program"
import { AutocompleteEngine } from "./autocomplete/engine"
import { loadDatabase, loadSdkSources } from "./autocomplete/database"
import { SourceFormatter } from "./autocomplete/formatter"
import {
  positionAt,
  type Position,
  type ApiDatabase,
  type TextEdit,
} from "./autocomplete/types"

export { positionAt } from "./autocomplete/types"
export type { CompletionItem, SignatureHelp } from "./autocomplete/types"

export class RequestCancelled extends Error {}

/** The repository read that runs beside the engine: whether it is in flight, and the failure it left behind. */
export type SourceState = { loading: boolean; error: string | null }

/**
 * Where the language service is. Each state holds only what is valid in it: the engine exists only while ready,
 * and every state that has started carries its source read.
 */
export type LanguageState =
  | { status: "stopped" }
  | { status: "starting"; source: SourceState }
  | { status: "ready"; engine: AutocompleteEngine; source: SourceState }
  | { status: "error"; source: SourceState }
export type LanguageStatus = LanguageState["status"]

const loadingSource: SourceState = { loading: true, error: null }
const describeFailure = (error: unknown) =>
  error
    ? error instanceof Error
      ? error.message || "Autocomplete could not load"
      : String(error)
    : null
export const isLanguageFile = (path: string) =>
  /\.(c|cc|cpp|cxx|h|hh|hpp|hxx|inc)$/i.test(path)

type OpenDocument = { text: Y.Text; version: number; observe: () => void }

/** Local metadata and live source. No compiler startup or request transport. */
export class LanguageService {
  readonly triggerCharacters = new Set([
    ".",
    ">",
    ":",
    "(",
    ",",
    "=",
    "/",
    '"',
    "<",
  ])
  readonly signatureTriggerCharacters = new Set(["(", ",", ")"])
  private snapshot = new Map<string, string>()
  private documents = new Map<string, OpenDocument>()
  private listeners = new Set<() => void>()
  private symbolListeners = new Set<() => void>()
  private symbolVersion = 0
  getSymbolVersion = () => this.symbolVersion
  subscribeSymbols = (listener: () => void) => {
    this.symbolListeners.add(listener)
    return () => {
      this.symbolListeners.delete(listener)
    }
  }
  private symbolsChanged() {
    this.symbolVersion++
    for (const listener of this.symbolListeners) listener()
  }
  programSymbols() {
    return this.engine?.programSymbols() ?? []
  }
  private readyListeners = new Set<(ready: boolean) => void>()
  private state: LanguageState = { status: "stopped" }
  private generation = 0
  private sourceGeneration = 0
  private formatter = new SourceFormatter()
  constructor(
    private template: string,
    private prepareSource: () => Promise<BuildSource>,
    private databaseLoader: (
      template: string
    ) => Promise<ApiDatabase> = loadDatabase
  ) {}
  /** The last failure: a startup error, or a repository read that could not finish. */
  get error() {
    return this.state.status === "stopped" ? null : this.state.source.error
  }
  get sourceLoading() {
    return this.state.status !== "stopped" && this.state.source.loading
  }
  get isReady() {
    return this.state.status === "ready"
  }
  /** Whether the symbol list shows loading rather than its contents: no engine and no failure yet, or a read in flight. */
  get symbolsLoading() {
    return this.sourceLoading || (!this.isReady && !this.error)
  }
  private get engine() {
    return this.state.status === "ready" ? this.state.engine : undefined
  }
  getStatus = () => this.state.status
  onStatusChange = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  onReadyChange(listener: (ready: boolean) => void) {
    this.readyListeners.add(listener)
    return () => {
      this.readyListeners.delete(listener)
    }
  }
  /** Moves to `next`, telling status listeners and, when readiness flips, ready listeners. */
  private commit(next: LanguageState) {
    const wasReady = this.isReady
    this.state = next
    for (const listener of this.listeners) listener()
    this.symbolsChanged()
    if (wasReady !== this.isReady)
      for (const listener of this.readyListeners) listener(this.isReady)
  }
  /**
   * Updates the repository read beside the current state. Only a failure change is a status change;
   * toggling the loading flag is not.
   */
  private setSource(patch: Partial<SourceState>) {
    if (this.state.status === "stopped") return
    this.state = {
      ...this.state,
      source: { ...this.state.source, ...patch },
    }
    if (patch.error !== undefined) {
      for (const listener of this.listeners) listener()
      this.symbolsChanged()
    }
  }
  private scheduledStart: { cancel: () => void } | undefined
  /**
   * Starts loading once the first editor is on screen, in idle time. Opening a
   * file should not wait for autocomplete's repository reads and index build.
   */
  scheduleStart() {
    if (this.state.status !== "stopped" || this.scheduledStart) return
    const run = () => {
      this.scheduledStart = undefined
      void this.start()
    }
    if (typeof requestIdleCallback === "function") {
      const handle = requestIdleCallback(run, { timeout: 1000 })
      this.scheduledStart = { cancel: () => cancelIdleCallback(handle) }
    } else {
      const handle = setTimeout(run, 200)
      this.scheduledStart = { cancel: () => clearTimeout(handle) }
    }
  }
  async start() {
    const generation = ++this.generation
    const revision = ++this.sourceGeneration
    this.commit({ status: "starting", source: loadingSource })
    // API suggestions and open buffers become usable before repository reads finish.
    const source = Promise.resolve()
      .then(() => this.prepareSource())
      .then(
        (snapshot) => ({ snapshot, error: undefined }),
        (error: unknown) => ({ snapshot: undefined, error })
      )
    try {
      const database = await this.databaseLoader(this.template)
      if (generation !== this.generation) return
      const engine = new AutocompleteEngine(database)
      for (const [path, text] of this.snapshot) engine.setFile(path, text)
      for (const [path, document] of this.documents)
        engine.setFile(path, document.text.toString())
      this.commit({ status: "ready", engine, source: loadingSource })
      const result = await source
      if (generation !== this.generation || revision !== this.sourceGeneration)
        return
      this.setSource({ loading: false })
      if (result.snapshot) this.installSource(result.snapshot)
      else this.setSource({ error: describeFailure(result.error) })
    } catch (error) {
      if (generation === this.generation)
        this.commit({
          status: "error",
          source: { loading: false, error: describeFailure(error) },
        })
    }
  }
  async refreshSource() {
    // Before the first start, the next start reads the current file list.
    if (this.state.status === "stopped") return
    const generation = this.generation
    const revision = ++this.sourceGeneration
    this.setSource({ loading: true })
    this.symbolsChanged()
    const source = await this.prepareSource().catch((error: unknown) => {
      if (revision === this.sourceGeneration)
        this.setSource({ loading: false, error: describeFailure(error) })
      throw error
    })
    if (generation === this.generation && revision === this.sourceGeneration) {
      this.setSource({ loading: false })
      this.installSource(source)
      // A source that now loads clears the failure it left, while the engine can still answer.
      if (this.isReady && this.error) this.setSource({ error: null })
    }
  }
  private installSource(source: BuildSource) {
    for (const path of this.snapshot.keys())
      if (!(path in source.files) && !this.documents.has(path))
        this.engine?.removeFile(path)
    this.snapshot.clear()
    const decoder = new TextDecoder("utf-8", { fatal: true })
    for (const [path, bytes] of Object.entries(source.files)) {
      if (!isLanguageFile(path) && !/(^|\/)\.clang-format$/.test(path)) continue
      const text = decoder.decode(bytes)
      this.snapshot.set(path, text)
      if (!this.documents.has(path)) this.engine?.setFile(path, text)
    }
    for (const [path, document] of this.documents)
      this.engine?.setFile(path, document.text.toString())
    this.symbolsChanged()
  }
  updateFile(path: string, text: string) {
    if (!isLanguageFile(path) && !/(^|\/)\.clang-format$/.test(path)) return
    this.snapshot.set(path, text)
    if (!this.documents.has(path) && this.engine?.getFile(path) !== text) {
      this.engine?.setFile(path, text)
      this.symbolsChanged()
    }
  }
  stop() {
    this.generation++
    this.scheduledStart?.cancel()
    this.scheduledStart = undefined
    const engine = this.engine
    this.commit({ status: "stopped" })
    this.formatter.stop()
    engine?.clear()
    for (const document of this.documents.values())
      document.text.unobserve(document.observe)
    this.documents.clear()
    this.snapshot.clear()
  }
  openDocument(path: string, text: Y.Text) {
    if (!isLanguageFile(path)) return () => {}
    const previous = this.documents.get(path)
    if (previous) previous.text.unobserve(previous.observe)
    const document: OpenDocument = {
      text,
      version: 1,
      observe: () => {
        document.version++
        this.engine?.setFile(path, text.toString())
        this.symbolsChanged()
      },
    }
    this.documents.set(path, document)
    text.observe(document.observe)
    this.engine?.setFile(path, text.toString())
    this.symbolsChanged()
    return () => {
      if (this.documents.get(path) !== document) return
      if (this.snapshot.has(path)) this.snapshot.set(path, text.toString())
      else this.engine?.removeFile(path)
      this.documents.delete(path)
      text.unobserve(document.observe)
    }
  }
  version(path: string) {
    return this.documents.get(path)?.version
  }
  private check(signal: AbortSignal) {
    if (signal.aborted || !this.isReady) throw new RequestCancelled()
    return this.engine!
  }
  async completion(path: string, position: Position, signal: AbortSignal) {
    return this.check(signal).complete(path, position)
  }
  async signatureHelp(path: string, position: Position, signal: AbortSignal) {
    return this.check(signal).signatures(path, position)
  }
  async hover(path: string, position: Position, signal: AbortSignal) {
    const contents = this.check(signal).describe(path, position)
    return contents
      ? { contents: { kind: "markdown" as const, value: contents } }
      : null
  }
  async definition(path: string, position: Position, signal: AbortSignal) {
    return this.check(signal)
      .symbolAt(path, position)
      .flatMap((s) =>
        s.path && s.position
          ? [
              {
                uri: s.path,
                path: s.path.startsWith("sdk/") ? null : s.path,
                position: s.position,
              },
            ]
          : []
      )
  }
  async readDefinition(path: string, signal: AbortSignal) {
    this.check(signal)
    if (path.startsWith("sdk/")) {
      const sources = await loadSdkSources(this.template)
      this.check(signal)
      if (!(path in sources)) throw new Error("Header not found")
      return { path: path.slice(4), contents: sources[path] }
    }
    const contents = this.engine?.getFile(path)
    if (contents === undefined) throw new Error("Source file not found")
    return { path, contents }
  }
  async formatting(path: string, signal: AbortSignal): Promise<TextEdit[]> {
    const engine = this.check(signal)
    const text = engine.getFile(path)
    if (text === undefined || !this.documents.has(path))
      throw new RequestCancelled()
    const directories = path.split("/")
    directories.pop()
    let config = "{BasedOnStyle: LLVM, IndentWidth: 2, ColumnLimit: 120}"
    for (let depth = directories.length; depth >= 0; depth--) {
      const found = this.snapshot.get(
        [...directories.slice(0, depth), ".clang-format"].join("/")
      )
      if (found) {
        config = found
        break
      }
    }
    const formatted = await this.formatter.format(path, text, config, signal)
    this.check(signal)
    return formatted === text
      ? []
      : [
          {
            range: {
              start: { line: 0, character: 0 },
              end: positionAt(text, text.length),
            },
            newText: formatted,
          },
        ]
  }
}
