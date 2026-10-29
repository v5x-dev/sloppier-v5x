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
export type {
  CompletionItem,
  CompletionList,
  SignatureHelp,
} from "./autocomplete/types"

export class RequestCancelled extends Error {}
export type LanguageStatus = "stopped" | "starting" | "ready" | "error"
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
  private engine?: AutocompleteEngine
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
  private status: LanguageStatus = "stopped"
  private generation = 0
  private sourceGeneration = 0
  sourceLoading = false
  private formatter = new SourceFormatter()
  private lastError: string | null = null
  constructor(
    private template: string,
    private prepareSource: () => Promise<BuildSource>,
    private databaseLoader: (
      template: string
    ) => Promise<ApiDatabase> = loadDatabase
  ) {}
  get error() {
    return this.lastError
  }
  get isReady() {
    return Boolean(this.engine) && this.status === "ready"
  }
  getStatus = () => this.status
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
  private setStatus(status: LanguageStatus, error?: unknown) {
    const wasReady = this.isReady
    this.status = status
    this.lastError = error
      ? error instanceof Error
        ? error.message || "Autocomplete could not load"
        : String(error)
      : null
    for (const listener of this.listeners) listener()
    this.symbolsChanged()
    if (wasReady !== this.isReady)
      for (const listener of this.readyListeners) listener(this.isReady)
  }
  async start() {
    const generation = ++this.generation
    const revision = ++this.sourceGeneration
    this.sourceLoading = true
    this.setStatus("starting")
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
      this.engine = new AutocompleteEngine(database)
      for (const [path, text] of this.snapshot) this.engine.setFile(path, text)
      for (const [path, document] of this.documents)
        this.engine.setFile(path, document.text.toString())
      this.setStatus("ready")
      const result = await source
      if (generation !== this.generation || revision !== this.sourceGeneration)
        return
      this.sourceLoading = false
      if (result.snapshot) this.installSource(result.snapshot)
      else this.setStatus("ready", result.error)
    } catch (error) {
      if (generation === this.generation) {
        this.sourceLoading = false
        this.setStatus("error", error)
      }
    }
  }
  async refreshSource() {
    const generation = this.generation
    const revision = ++this.sourceGeneration
    this.sourceLoading = true
    this.symbolsChanged()
    const source = await this.prepareSource().catch((error: unknown) => {
      if (revision === this.sourceGeneration) {
        this.sourceLoading = false
        this.setStatus(this.status, error)
      }
      throw error
    })
    if (generation === this.generation && revision === this.sourceGeneration) {
      this.sourceLoading = false
      this.installSource(source)
      if (this.isReady && this.lastError) this.setStatus("ready")
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
    this.setStatus("stopped")
    this.formatter.stop()
    this.engine?.clear()
    this.engine = undefined
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
