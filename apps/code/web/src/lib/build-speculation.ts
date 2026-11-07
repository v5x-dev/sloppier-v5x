import type { BuildRequest, BuildStatus, ClaimedBuild } from "./build-program"
import { uploadSource } from "./build-program"
import {
  decodeSourceText,
  encodeSourceText,
  sourceHash,
  type SourceFiles,
} from "./build-source"
import { SourceFormatter } from "./autocomplete/formatter"
import { isLanguageFile } from "./language-service"

const DEFAULT_CLANG_FORMAT =
  "{BasedOnStyle: LLVM, IndentWidth: 2, ColumnLimit: 120}"

/** The formatter configuration the language service uses for path: the nearest .clang-format. */
export function clangFormatConfig(files: SourceFiles, path: string) {
  const directories = path.split("/")
  directories.pop()
  for (let depth = directories.length; depth >= 0; depth--) {
    const candidate = [...directories.slice(0, depth), ".clang-format"].join(
      "/"
    )
    const found = (files as Partial<SourceFiles>)[candidate]
    const text = found ? decodeSourceText(found) : ""
    if (text) return text
  }
  return DEFAULT_CLANG_FORMAT
}

export type SpeculativeBuild = ClaimedBuild & { hash: string }

type FormatSource = (
  path: string,
  text: string,
  config: string,
  signal: AbortSignal
) => Promise<string>

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Builds the source the user is editing before they press Upload.
 *
 * Each distinct snapshot is hashed the same way the Builder hashes what it extracts. The artifact
 * is claimed only when the committed snapshot has the same hash, so a claimed binary is always
 * the binary of the committed source. Speculative builds never write diagnostics and never
 * replace a normal build: the Builder cancels a superseded speculative build itself.
 */
export class BuildSpeculation {
  private generation = 0
  private timer: ReturnType<typeof setTimeout> | undefined
  /**
   * The latest build this class started, with the token that ends the watch of any older one. It is kept
   * after the build settles, so the same content is not built again while its result is current.
   */
  private attempt: { token: symbol; hash: string } | null = null
  private finished: SpeculativeBuild | null = null
  /** The latest run, including its build. */
  private running: Promise<void> = Promise.resolve()
  /** The latest build watch; a run that finds its hash already built returns without starting one. */
  private watching: Promise<void> = Promise.resolve()
  private readonly formatter = new SourceFormatter()
  private readonly format: FormatSource

  constructor(
    private readonly options: {
      /** Draft source as a commit would record it (committed head plus unsaved text). */
      prepare: () => Promise<{ files: SourceFiles; dirty: string[] }>
      request: BuildRequest
      /** True while a Builder is connected; speculation never provisions a machine. */
      warm: () => boolean
      delay?: number
      format?: FormatSource
    }
  ) {
    this.format =
      options.format ??
      ((path, text, config, signal) =>
        this.formatter.format(path, text, config, signal))
  }

  private formatterWarm = false

  /** Starts the formatter worker once, so the first draft build does not wait for it to load. */
  warmFormatter() {
    if (this.formatterWarm) return
    this.formatterWarm = true
    void this.format(
      "warm.cpp",
      "",
      DEFAULT_CLANG_FORMAT,
      new AbortController().signal
    ).catch(() => {})
  }

  /** Builds the draft after `wait` milliseconds; a later call replaces the pending one. Upload asks for 0. */
  schedule(wait = this.options.delay ?? 400) {
    clearTimeout(this.timer)
    if (wait <= 0) {
      // No debounce: start now, so a claim made right after sees this run.
      this.running = this.run()
      return
    }
    this.timer = setTimeout(() => {
      this.running = this.run()
    }, wait)
  }

  /**
   * The finished speculative build for this exact source hash. Speculation still in progress is awaited first,
   * so an Upload that started with the draft does not build the same source a second time.
   */
  async claimOrWait(hash: string): Promise<SpeculativeBuild | null> {
    await this.running
    await this.watching
    return this.finished?.hash === hash ? this.finished : null
  }

  /** Whether `token` still names the latest build, so an older build's watch ends. */
  private isCurrent(token: symbol) {
    return this.attempt?.token === token
  }

  stop() {
    this.generation++
    clearTimeout(this.timer)
    this.formatter.stop(new Error("Speculative build stopped"))
  }

  private async run() {
    const generation = ++this.generation
    if (!this.options.warm()) return
    const controller = new AbortController()
    let token: symbol | undefined
    try {
      const { files, dirty } = await this.options.prepare()
      // Commits format dirty language files before recording them; speculation must
      // build the same bytes, without changing what the editor shows.
      for (const path of dirty) {
        if (!isLanguageFile(path)) continue
        const text = decodeSourceText(files[path])
        const formatted = await this.format(
          path,
          text,
          clangFormatConfig(files, path),
          controller.signal
        )
        if (generation !== this.generation) return
        if (formatted !== text) files[path] = encodeSourceText(formatted)
      }
      if (generation !== this.generation) return
      const hash = await sourceHash(files)
      // Same content as the build in flight or finished: keep watching it. Only a new build supersedes a watch.
      if (generation !== this.generation || hash === this.attempt?.hash) return
      token = Symbol(hash)
      this.attempt = { token, hash }
      const id = await uploadSource(
        this.options.request,
        { sha: hash, files },
        controller.signal
      )
      if (!this.isCurrent(token)) return
      await this.options.request("/build", {
        id,
        commit: `speculative ${hash}`,
        speculative: true,
      })
      await this.watch(token, hash)
    } catch {
      // A refused or failed speculation only means the next Upload builds normally, and the same content may retry.
      if (token !== undefined && this.attempt?.token === token)
        this.attempt = null
    }
  }

  /** Waits for the build this token started. A newer build posted by run() ends the wait. */
  private watch(token: symbol, hash: string) {
    const following = this.follow(token, hash)
    this.watching = following.catch(() => undefined)
    return following
  }

  private async follow(token: symbol, hash: string) {
    let since: number | undefined
    for (;;) {
      if (!this.isCurrent(token)) return
      // A Builder that reports versions answers a long poll when the status changes; an older one is polled.
      if (since === undefined) await sleep(25)
      if (!this.isCurrent(token)) return
      const path =
        since === undefined ? "/status" : `/status?since=${since}&wait=5000`
      const response = await this.options.request(path)
      const status = (await response.json()) as BuildStatus
      if (!this.isCurrent(token)) return
      if (status.building) {
        since = status.version
        continue
      }
      if (
        status.speculative &&
        status.sourceHash === hash &&
        status.artifactId &&
        status.logs.trimEnd().endsWith("Build succeeded.")
      ) {
        this.finished = {
          hash,
          artifactId: status.artifactId,
          entries: status.artifactEntries ?? null,
        }
      }
      return
    }
  }
}
