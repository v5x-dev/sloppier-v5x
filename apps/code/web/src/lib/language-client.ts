import type { HoverContents } from "./hover-content"
import type * as Y from "yjs"
import type { BuildSource } from "./build-program"
import type { LanguageTransport } from "./language/worker-transport"

// Incremental LSP client. The transport owns the browser worker and SDK files.

export type LspPosition = { line: number; character: number }
export type LspRange = { start: LspPosition; end: LspPosition }
export type LspTextEdit = { range: LspRange; newText: string }
export type CompletionItem = {
  label: string
  labelDetails?: { detail?: string; description?: string }
  kind?: number
  detail?: string
  documentation?: string | { kind: string; value: string }
  sortText?: string
  filterText?: string
  insertText?: string
  insertTextFormat?: number
  textEdit?: LspTextEdit
  additionalTextEdits?: LspTextEdit[]
  commitCharacters?: string[]
  score?: number
}
export type CompletionList = { isIncomplete: boolean; items: CompletionItem[] }
export type SignatureHelp = {
  signatures: {
    label: string
    documentation?: string | { kind: string; value: string }
    parameters?: { label: string | [number, number] }[]
    activeParameter?: number
  }[]
  activeSignature?: number
  activeParameter?: number
}
export const CompletionTrigger = {
  Invoked: 1,
  TriggerCharacter: 2,
  Incomplete: 3,
} as const

type Message = {
  id?: number | string
  method?: string
  params?: unknown
  result?: unknown
  error?: { message: string }
}
type Pending = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}
type OpenDocument = {
  path: string
  text: Y.Text
  shadow: string
  version: number
  observe: (event: Y.YTextEvent) => void
}

export type LanguageStatus = "stopped" | "starting" | "ready" | "error"

export class RequestCancelled extends Error {}

export function isLanguageFile(path: string) {
  return /\.(c|cc|cpp|cxx|h|hh|hpp|hxx|inc)$/i.test(path)
}

/** Convert a Yjs delta into LSP incremental changes against the prior text. */
export function deltaToChanges(before: string, delta: Y.YTextEvent["delta"]) {
  let text = before
  let offset = 0
  const changes: { range: LspRange; text: string }[] = []
  for (const part of delta) {
    if (part.retain) offset += part.retain
    if (part.delete) {
      const range = {
        start: positionAt(text, offset),
        end: positionAt(text, offset + part.delete),
      }
      changes.push({ range, text: "" })
      text = text.slice(0, offset) + text.slice(offset + part.delete)
    }
    if (typeof part.insert === "string") {
      const at = positionAt(text, offset)
      changes.push({ range: { start: at, end: at }, text: part.insert })
      text = text.slice(0, offset) + part.insert + text.slice(offset)
      offset += part.insert.length
    }
  }
  return { text, changes }
}

/** UTF-16 offset to LSP position; Yjs and LSP both count UTF-16 code units. */
export function positionAt(text: string, offset: number): LspPosition {
  let line = 0
  let start = 0
  for (let i = text.indexOf("\n"); i !== -1 && i < offset;) {
    line++
    start = i + 1
    i = text.indexOf("\n", start)
  }
  return { line, character: offset - start }
}

export class LanguageClient {
  triggerCharacters = new Set<string>()
  signatureTriggerCharacters = new Set<string>()
  private root: string | null = null
  private nextId = 1
  private pending = new Map<number, Pending>()
  private outbox: Message[] = []
  private sending: Promise<void> = Promise.resolve()
  private documents = new Map<string, OpenDocument>()
  private generation = 0
  private status: LanguageStatus = "stopped"
  private statusListeners = new Set<() => void>()
  private ready = false
  private readyListeners = new Set<(ready: boolean) => void>()
  private controller: AbortController | null = null

  constructor(
    private readonly transport: LanguageTransport,
    private readonly prepareSource: () => Promise<BuildSource>
  ) {}

  getStatus = () => this.status

  onStatusChange = (listener: () => void) => {
    this.statusListeners.add(listener)
    return () => void this.statusListeners.delete(listener)
  }

  private setStatus(status: LanguageStatus) {
    if (this.status === status) return
    this.status = status
    for (const listener of this.statusListeners) listener()
  }

  get isReady() {
    return this.ready
  }

  /** Called when the session becomes ready or stops being ready. */
  onReadyChange(listener: (ready: boolean) => void) {
    this.readyListeners.add(listener)
    return () => void this.readyListeners.delete(listener)
  }

  /** Start or restart the worker from the latest source snapshot. */
  async start() {
    const generation = ++this.generation
    this.reset("starting")
    const controller = new AbortController()
    this.controller = controller
    try {
      const root = await this.transport.start(
        this.prepareSource(),
        (message) => {
          if (generation === this.generation) this.receive(message)
        },
        () => {
          if (generation === this.generation) this.reset()
        }
      )
      if (generation !== this.generation) return
      this.root = root
      const result = (await this.call(
        "initialize",
        {
          processId: null,
          rootUri: `file://${this.root}`,
          capabilities: {
            general: { positionEncodings: ["utf-16"] },
            textDocument: {
              synchronization: { dynamicRegistration: false },
              hover: { contentFormat: ["markdown", "plaintext"] },
              definition: { linkSupport: true },
              completion: {
                contextSupport: true,
                completionItem: {
                  snippetSupport: true,
                  labelDetailsSupport: true,
                  documentationFormat: ["plaintext", "markdown"],
                },
              },
              signatureHelp: {
                contextSupport: true,
                signatureInformation: {
                  documentationFormat: ["plaintext", "markdown"],
                  parameterInformation: { labelOffsetSupport: true },
                  activeParameterSupport: true,
                },
              },
            },
          },
        },
        AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)])
      )) as {
        capabilities: {
          completionProvider?: { triggerCharacters?: string[] }
          signatureHelpProvider?: { triggerCharacters?: string[] }
        }
      }
      if (generation !== this.generation) return
      const capabilities = result.capabilities
      this.triggerCharacters = new Set(
        capabilities.completionProvider?.triggerCharacters ?? []
      )
      this.signatureTriggerCharacters = new Set(
        capabilities.signatureHelpProvider?.triggerCharacters ?? []
      )
      this.notify("initialized", {})
      for (const document of this.documents.values()) this.didOpen(document)
      this.setReady(true)
    } catch {
      if (generation === this.generation && !controller.signal.aborted)
        this.reset()
    }
  }

  stop() {
    this.generation++
    this.reset("stopped")
    for (const document of this.documents.values())
      document.text.unobserve(document.observe)
    this.documents.clear()
  }

  /** Track a live Yjs document; local and remote edits both reach clangd. */
  openDocument(path: string, text: Y.Text) {
    if (!isLanguageFile(path)) return () => {}
    this.closeDocument(path)
    const document: OpenDocument = {
      path,
      text,
      shadow: text.toString(),
      version: 1,
      observe: (event) => {
        const { text: next, changes } = deltaToChanges(
          document.shadow,
          event.delta
        )
        document.shadow = next
        document.version++
        if (this.ready)
          this.notify("textDocument/didChange", {
            textDocument: { uri: this.uri(path), version: document.version },
            contentChanges: changes,
            // This client displays completions and navigation, not diagnostics.
            // Skip unsolicited AST rebuilds while the user is typing.
            wantDiagnostics: false,
          })
      },
    }
    text.observe(document.observe)
    this.documents.set(path, document)
    if (this.ready) this.didOpen(document)
    return () => {
      if (this.documents.get(path) === document) this.closeDocument(path)
    }
  }

  version(path: string) {
    return this.documents.get(path)?.version
  }

  formatting(path: string, signal: AbortSignal) {
    if (!this.ready || !this.documents.has(path))
      return Promise.reject(
        new RequestCancelled("Language server is connecting.")
      )
    return this.call(
      "textDocument/formatting",
      {
        textDocument: { uri: this.uri(path) },
        options: { tabSize: 2, insertSpaces: true },
      },
      signal
    ).then((result) => (result as LspTextEdit[] | null) ?? [])
  }

  completion(
    path: string,
    position: LspPosition,
    context: { triggerKind: number; triggerCharacter?: string },
    signal: AbortSignal
  ) {
    return this.call(
      "textDocument/completion",
      { textDocument: { uri: this.uri(path) }, position, context },
      signal
    ).then((result) =>
      Array.isArray(result)
        ? { isIncomplete: false, items: result as CompletionItem[] }
        : ((result as CompletionList | null) ?? {
            isIncomplete: false,
            items: [],
          })
    )
  }

  signatureHelp(path: string, position: LspPosition, signal: AbortSignal) {
    return this.call(
      "textDocument/signatureHelp",
      { textDocument: { uri: this.uri(path) }, position },
      signal
    ) as Promise<SignatureHelp | null>
  }

  hover(path: string, position: LspPosition, signal: AbortSignal) {
    return this.call(
      "textDocument/hover",
      {
        textDocument: { uri: this.uri(path) },
        position,
      },
      signal
    ) as Promise<{
      contents: HoverContents
    } | null>
  }

  async definition(path: string, position: LspPosition, signal: AbortSignal) {
    const result = (await this.call(
      "textDocument/definition",
      {
        textDocument: { uri: this.uri(path) },
        position,
      },
      signal
    )) as
      | {
          uri?: string
          range?: LspRange
          targetUri?: string
          targetSelectionRange?: LspRange
        }[]
      | { uri: string; range: LspRange }
      | null
    const locations = result ? (Array.isArray(result) ? result : [result]) : []
    return locations.flatMap((location) => {
      const uri = "targetUri" in location ? location.targetUri : location.uri
      const range =
        "targetSelectionRange" in location
          ? location.targetSelectionRange
          : location.range
      if (!uri || !range || !this.root) return []
      const root = new URL(`file://${this.root}/`)
      const target = new URL(uri)
      if (target.protocol !== "file:" || target.host !== root.host) return []
      return [
        {
          uri,
          path: target.pathname.startsWith(root.pathname)
            ? decodeURIComponent(target.pathname.slice(root.pathname.length))
            : null,
          position: range.start,
        },
      ]
    })
  }

  async readDefinition(uri: string, signal: AbortSignal) {
    if (!this.ready) throw new Error("Language server is connecting.")
    return this.transport.read(uri, signal)
  }

  private uri(path: string) {
    return `file://${this.root}/${path.split("/").map(encodeURIComponent).join("/")}`
  }

  private didOpen(document: OpenDocument) {
    document.shadow = document.text.toString()
    this.notify("textDocument/didOpen", {
      textDocument: {
        uri: this.uri(document.path),
        languageId: /\.c$/i.test(document.path) ? "c" : "cpp",
        version: document.version,
        text: document.shadow,
      },
    })
  }

  private closeDocument(path: string) {
    const document = this.documents.get(path)
    if (!document) return
    document.text.unobserve(document.observe)
    this.documents.delete(path)
    if (this.ready)
      this.notify("textDocument/didClose", {
        textDocument: { uri: this.uri(path) },
      })
  }

  private setReady(ready: boolean) {
    if (ready) this.setStatus("ready")
    if (this.ready === ready) return
    this.ready = ready
    for (const listener of this.readyListeners) listener(ready)
  }

  private reset(status: LanguageStatus = "error") {
    this.setStatus(status)
    this.transport.stop()
    this.controller?.abort()
    this.controller = null
    this.setReady(false)
    this.root = null
    this.outbox = []
    for (const pending of this.pending.values())
      pending.reject(new RequestCancelled("Language server restarted."))
    this.pending.clear()
  }

  private call(method: string, params: unknown, signal?: AbortSignal) {
    const id = this.nextId++
    return new Promise<unknown>((resolve, reject) => {
      if (signal?.aborted) return reject(new RequestCancelled())
      const abort = () => {
        if (!this.pending.delete(id)) return
        this.notify("$/cancelRequest", { id })
        reject(new RequestCancelled())
      }
      signal?.addEventListener("abort", abort, { once: true })
      this.pending.set(id, {
        resolve: (value) => {
          signal?.removeEventListener("abort", abort)
          resolve(value)
        },
        reject: (error) => {
          signal?.removeEventListener("abort", abort)
          reject(error)
        },
      })
      this.enqueue({ id, method, params })
    })
  }

  private notify(method: string, params: unknown) {
    this.enqueue({ method, params })
  }

  private enqueue(message: Message) {
    const first = this.outbox.length === 0
    this.outbox.push(message)
    // Keystrokes in one task share a worker message; sends stay ordered so
    // didChange always reaches clangd before the completion that follows it.
    if (first) this.sending = this.sending.then(() => this.flush())
  }

  private flush() {
    const messages = this.outbox
    this.outbox = []
    if (!messages.length || !this.root) return
    try {
      this.transport.send(
        messages.map((message) => ({ jsonrpc: "2.0", ...message }))
      )
    } catch {
      this.reset()
    }
  }

  private receive(message: Message) {
    if (message.method !== undefined) {
      // Server requests such as workDoneProgress/create need any response.
      if (message.id !== undefined)
        this.enqueue({ id: message.id, result: null })
      return
    }
    const pending = this.pending.get(message.id as number)
    if (!pending) return
    this.pending.delete(message.id as number)
    if (message.error) pending.reject(new Error(message.error.message))
    else pending.resolve(message.result)
  }
}
