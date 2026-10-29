import { readEditorState, writeEditorState } from "./editor-persistence"
import type { api } from "@v5x/backend/api"
import type { Id } from "@v5x/backend/dataModel"
import type { FunctionArgs, FunctionReturnType } from "convex/server"
import { containsPath, type ExplorerUpdate } from "./explorer"
import { errorMessage } from "./errors"
import type { LivePerson } from "./live-file-session"
import type { SearchMatch } from "@v5x/backend/search"
import type { ReplacementAction } from "./search-replacement"

type Action<TName extends keyof typeof api.codeStorage> = (
  args: FunctionArgs<(typeof api.codeStorage)[TName]>
) => Promise<FunctionReturnType<(typeof api.codeStorage)[TName]>>
type Actions = {
  [
    Name in
      | "listFiles"
      | "readFile"
      | "commitFiles"
      | "restoreHistoryFile"
      | "restoreHistoryCommit"
      | "buildManifest"
  ]: Action<Name>
}
export type LoadedFile = {
  contents: string
  truncated: boolean
  editorKey?: string
}
type State = {
  paths: string[] | null
  listError: string | null
  openPaths: string[]
  activePath: string | null
  loaded: Partial<Record<string, LoadedFile>>
  readError: Partial<Record<string, string>>
  dirtyPaths: string[]
  liveSync: Record<string, boolean>
  filePeople: Record<string, LivePerson[]>
}
const MAX_READ_BYTES = 512 * 1024

/** Source identity and reconciliation for one program's open workbench. */
export class WorkbenchSource {
  private state: State = {
    paths: null,
    listError: null,
    openPaths: [],
    activePath: null,
    loaded: {},
    readError: {},
    dirtyPaths: [],
    liveSync: {},
    filePeople: {},
  }
  private committed = new Map<string, string>()
  private drafts = new Map<string, string>()
  private listeners = new Set<() => void>()
  private draftListeners = new Set<() => void>()
  private draftVersion = 0
  private reads = new Map<string, object>()
  private operationBusy = false
  private initialOpen = false
  private pathRequest = 0
  private replacementActions = new Map<string, ReplacementAction>()
  private replacementListeners = new Set<() => void>()
  readonly scrollPositions = new Map<string, number>()

  constructor(
    private programId: Id<"programs">,
    private actions: Actions
  ) {}

  getSnapshot = () => this.state
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  getDrafts = () => this.drafts as ReadonlyMap<string, string>
  // Changes on every draft update, so React can read drafts with useSyncExternalStore.
  getDraftVersion = () => this.draftVersion
  subscribeDrafts = (listener: () => void) => {
    this.draftListeners.add(listener)
    return () => {
      this.draftListeners.delete(listener)
    }
  }
  isSynced = () => Object.values(this.state.liveSync).every(Boolean)

  private update(patch: Partial<State>) {
    this.state = { ...this.state, ...patch }
    if ("openPaths" in patch || "activePath" in patch)
      writeEditorState(`${this.programId}:tabs`, {
        openPaths: this.state.openPaths,
        activePath: this.state.activePath,
      })
    for (const listener of this.listeners) listener()
  }
  private sourceChanged(patch: Partial<State> = {}) {
    const dirtyPaths = [...this.drafts]
      .filter(([path, text]) => this.committed.get(path) !== text)
      .map(([path]) => path)
      .sort()
    if (
      Object.keys(patch).length ||
      dirtyPaths.join("\n") !== this.state.dirtyPaths.join("\n")
    )
      this.update({ ...patch, dirtyPaths })
    this.draftVersion++
    for (const listener of this.draftListeners) listener()
  }

  setDraft = (path: string, text: string) => {
    if (this.state.paths && !this.state.paths.includes(path)) return
    if (this.drafts.get(path) === text) return
    this.drafts.set(path, text)
    this.sourceChanged()
  }
  setReplacementAction = (path: string, action: ReplacementAction | null) => {
    if (action) this.replacementActions.set(path, action)
    else this.replacementActions.delete(path)
    for (const listener of this.replacementListeners) listener()
  }

  replaceMatches = async (
    path: string,
    matches: SearchMatch[],
    replacement: string
  ) => {
    if (!this.state.paths?.includes(path))
      throw new Error(`${path} no longer exists.`)
    if (!this.state.openPaths.includes(path))
      this.update({ openPaths: [...this.state.openPaths, path] })
    void this.loadFile(path)
    const action = await new Promise<ReplacementAction>((resolve, reject) => {
      const finish = (error?: string, ready?: ReplacementAction) => {
        clearTimeout(timer)
        this.replacementListeners.delete(check)
        unsubscribe()
        if (error) reject(new Error(error))
        else if (ready) resolve(ready)
      }
      const check = () => {
        if (
          !this.state.paths?.includes(path) ||
          !this.state.openPaths.includes(path)
        )
          return finish(`${path} was closed or removed.`)
        const ready = this.replacementActions.get(path)
        if (ready) return finish(undefined, ready)
        const error = this.state.readError[path]
        if (error) return finish(error)
        const file = this.state.loaded[path]
        if (
          file &&
          (file.truncated ||
            new TextEncoder().encode(file.contents).byteLength > 256 * 1024 ||
            file.contents.includes("\0") ||
            file.contents.includes("\ufffd"))
        )
          return finish(`${path} is read-only.`)
      }
      const unsubscribe = this.subscribe(check)
      const timer = setTimeout(
        () => finish(`Could not open ${path} for editing.`),
        15000
      )
      this.replacementListeners.add(check)
      check()
    })
    if (this.replacementActions.get(path) !== action)
      throw new Error(`${path} was closed or replaced. Search again.`)
    action(matches, replacement)
  }
  setSynced = (path: string, synced: boolean) => {
    if (this.state.paths && !this.state.paths.includes(path)) return
    if (this.state.liveSync[path] !== synced)
      this.update({ liveSync: { ...this.state.liveSync, [path]: synced } })
  }
  setPeople = (path: string, people: LivePerson[]) => {
    if (this.state.paths && !this.state.paths.includes(path)) return
    if (JSON.stringify(this.state.filePeople[path]) !== JSON.stringify(people))
      this.update({ filePeople: { ...this.state.filePeople, [path]: people } })
  }

  loadPaths = async () => {
    const request = ++this.pathRequest
    this.update({ listError: null })
    try {
      const all: string[] = []
      let cursor: string | undefined
      do {
        const page = await this.actions.listFiles({
          programId: this.programId,
          cursor,
        })
        all.push(...page.paths)
        cursor = page.hasMore ? page.nextCursor : undefined
      } while (cursor)
      if (request !== this.pathRequest) return
      const paths = all.filter((path) => !path.startsWith(".v5x/")).sort()
      this.update({ paths })
      if (!this.initialOpen) {
        this.initialOpen = true
        const saved = readEditorState<{
          openPaths: string[]
          activePath: string | null
        }>(`${this.programId}:tabs`)
        if (saved && Array.isArray(saved.openPaths)) {
          const openPaths = [
            ...new Set(saved.openPaths.filter((path) => paths.includes(path))),
          ]
          const activePath = openPaths.includes(saved.activePath ?? "")
            ? saved.activePath
            : (openPaths.at(-1) ?? null)
          this.update({ openPaths, activePath })
          for (const path of openPaths) void this.loadFile(path)
        } else {
          const entry = pickEntryFile(paths)
          if (entry) this.openFile(entry)
        }
      }
    } catch (error) {
      this.update({ listError: errorMessage(error) })
    }
  }

  refreshRepository = async () => {
    const refresh = this.initialOpen
    await this.loadPaths()
    if (!refresh || this.state.listError) return
    // Re-read the saved baseline, keeping live drafts and editor identities.
    await Promise.all(
      Object.keys(this.state.loaded)
        .filter((path) => this.state.paths?.includes(path))
        .map((path) => this.loadFile(path, true))
    )
  }

  openFile = (path: string) => {
    this.update({
      openPaths: this.state.openPaths.includes(path)
        ? this.state.openPaths
        : [...this.state.openPaths, path],
      activePath: path,
    })
    void this.loadFile(path)
  }
  private async loadFile(path: string, refresh = false) {
    if (
      !refresh &&
      (this.state.loaded[path] ||
        this.state.readError[path] ||
        this.reads.has(path))
    )
      return
    const request = {}
    this.reads.set(path, request)
    try {
      const { bytes, contentRange } = await this.actions.readFile({
        programId: this.programId,
        path,
        length: MAX_READ_BYTES,
      })
      if (this.reads.get(path) !== request) return
      const contents = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
      if (contents.includes("\0"))
        throw new Error(
          "This is a binary file. Use Download to open it locally."
        )
      const total = Number(contentRange?.split("/").at(1))
      const previous = this.committed.get(path)
      if (refresh && this.drafts.get(path) === previous)
        this.drafts.delete(path)
      this.committed.set(path, contents)
      this.sourceChanged({
        loaded: {
          ...this.state.loaded,
          [path]: {
            contents,
            editorKey:
              this.state.loaded[path]?.editorKey ??
              `${this.programId}:${crypto.randomUUID()}`,
            truncated: Number.isFinite(total) && total > bytes.byteLength,
          },
        },
      })
    } catch (error) {
      if (this.reads.get(path) === request)
        this.update({
          readError: { ...this.state.readError, [path]: errorMessage(error) },
        })
    } finally {
      if (this.reads.get(path) === request) this.reads.delete(path)
    }
  }

  closeTab = (path: string) => {
    if (this.state.liveSync[path] === false)
      throw new Error("Keep it open until its live changes are saved.")
    const index = this.state.openPaths.indexOf(path)
    const remaining = this.state.openPaths.filter((entry) => entry !== path)
    this.update({
      openPaths: remaining,
      activePath:
        this.state.activePath === path
          ? (remaining.at(index) ?? remaining.at(-1) ?? null)
          : this.state.activePath,
    })
  }
  reorderTabs = (fromPath: string, toPath: string) => {
    const paths = [...this.state.openPaths]
    const from = paths.indexOf(fromPath),
      to = paths.indexOf(toPath)
    if (from < 0 || to < 0) return
    paths.splice(to, 0, paths.splice(from, 1)[0])
    this.update({ openPaths: paths })
  }

  commit = async (message?: string) => {
    if (!this.isSynced())
      throw new Error(
        "Wait for live changes to finish syncing before committing."
      )
    const changes = [...this.drafts]
      .filter(([path, text]) => this.committed.get(path) !== text)
      .map(([path, contents]) => ({
        operation: "put" as const,
        path,
        contents,
      }))
    if (!changes.length) return
    await this.exclusive(async () => {
      const paths = changes.map(({ path }) => path).sort()
      const generated =
        paths.length === 1
          ? `Update ${paths[0]}`
          : `Update ${paths.length} files: ${paths.join(", ")}`
      await this.actions.commitFiles({
        programId: this.programId,
        message: message ?? generated.slice(0, 200),
        changes,
      })
      // Acknowledge only the captured text. Later typing remains dirty.
      for (const change of changes)
        this.committed.set(change.path, change.contents)
      this.sourceChanged()
    })
  }

  restoreCommit = async (sha: string) => {
    if (this.operationBusy || this.state.dirtyPaths.length || !this.isSynced())
      throw new Error("Commit and sync current changes before restoring.")
    return this.exclusive(async () => {
      await this.actions.restoreHistoryCommit({
        programId: this.programId,
        sha,
      })
      // Dispose every old editor identity and discard pending reads and baselines.
      this.reads.clear()
      this.committed.clear()
      this.drafts.clear()
      this.scrollPositions.clear()
      this.sourceChanged({
        loaded: {},
        readError: {},
        liveSync: {},
        filePeople: {},
      })
      await this.loadPaths()
      if (this.state.listError)
        throw new Error(
          "Commit restored. Reload the program to load its files."
        )
      const openPaths = this.state.openPaths.filter((path) =>
        this.state.paths?.includes(path)
      )
      this.update({
        openPaths,
        activePath: openPaths.includes(this.state.activePath ?? "")
          ? this.state.activePath
          : (openPaths[0] ?? null),
      })
      await Promise.all(openPaths.map((path) => this.loadFile(path)))
      return null
    })
  }

  restoreFile = async (sha: string, path: string) => {
    if (this.operationBusy || this.state.dirtyPaths.length || !this.isSynced())
      throw new Error("Commit and sync current changes before restoring.")
    return this.exclusive(async () => {
      const result = await this.actions.restoreHistoryFile({
        programId: this.programId,
        sha,
        path,
      })
      this.reads.delete(path)
      this.committed.set(path, result.contents)
      this.sourceChanged({
        loaded: {
          ...this.state.loaded,
          [path]: {
            ...this.state.loaded[path],
            contents: result.contents,
            truncated: false,
          },
        },
        readError: { ...this.state.readError, [path]: undefined },
      })
      await this.loadPaths()
      this.openFile(path)
      return result.warning
    })
  }

  applyExplorerUpdate = async (update: ExplorerUpdate) => {
    if (!this.isSynced())
      throw new Error(
        "Wait for live changes to finish syncing before changing files."
      )
    if (!update.changes.length)
      throw new Error("No files to change. Refresh the Explorer.")
    if (update.changes.length > 100)
      throw new Error(
        "A repository operation can change at most 100 files. Select fewer items."
      )
    const size = update.changes.reduce(
      (total, change) =>
        total +
        (change.operation === "put"
          ? typeof change.contents === "string"
            ? new TextEncoder().encode(change.contents).byteLength
            : change.contents.byteLength
          : 0),
      0
    )
    if (size > MAX_READ_BYTES)
      throw new Error(
        "A repository operation can write at most 512 KiB. Select fewer or smaller files."
      )
    await this.exclusive(async () => {
      await this.actions.commitFiles({
        programId: this.programId,
        message: update.message,
        changes: update.changes,
        requireAbsentPaths: update.requireAbsentPaths,
        moves: update.changes.flatMap((change) => {
          if (change.operation !== "delete") return []
          const move = update.moves?.find(({ from }) =>
            containsPath(from, change.path)
          )
          return move
            ? [
                {
                  from: change.path,
                  to: `${move.to}${change.path.slice(move.from.length)}`,
                },
              ]
            : []
        }),
      })
      const removed = new Set(update.removed ?? [])
      const remap = (path: string) => {
        const move = update.moves?.find(({ from }) => containsPath(from, path))
        return move ? `${move.to}${path.slice(move.from.length)}` : path
      }
      const remapMap = <T>(map: Map<string, T>) => {
        const entries = [...map]
        map.clear()
        for (const [path, value] of entries)
          if (!removed.has(path)) map.set(remap(path), value)
      }
      remapMap(this.drafts)
      remapMap(this.committed)
      remapMap(this.scrollPositions)
      const remapRecord = <T>(record: Record<string, T>) =>
        Object.fromEntries(
          Object.entries(record)
            .filter(([path]) => !removed.has(path))
            .map(([path, value]) => [remap(path), value])
        )
      // Ignore outstanding reads addressed to the previous path identity.
      this.reads.clear()
      const loaded = remapRecord(this.state.loaded)
      for (const [path, value] of Object.entries(loaded))
        if (value)
          loaded[path] = {
            ...value,
            contents: this.drafts.get(path) ?? value.contents,
          }
      const openPaths = this.state.openPaths
        .filter((path) => !removed.has(path))
        .map(remap)
      const activePath =
        this.state.activePath && !removed.has(this.state.activePath)
          ? remap(this.state.activePath)
          : (openPaths.at(-1) ?? null)
      const paths = new Set(this.state.paths ?? [])
      for (const change of update.changes) {
        if (change.operation === "delete") paths.delete(change.path)
        else paths.add(change.path)
      }
      this.sourceChanged({
        loaded,
        openPaths,
        activePath,
        paths: [...paths].sort(),
        liveSync: remapRecord(this.state.liveSync),
        readError: remapRecord(this.state.readError),
        filePeople: remapRecord(this.state.filePeople),
      })
      if (activePath) void this.loadFile(activePath)
    })
  }

  readBytes = async (
    path: string,
    saved = false,
    ref?: string
  ): Promise<ArrayBuffer> => {
    const draft = !saved && !ref ? this.drafts.get(path) : undefined
    if (draft !== undefined) return new TextEncoder().encode(draft).buffer
    const chunks: Uint8Array[] = []
    let offset = 0
    for (;;) {
      const { bytes, contentRange } = await this.actions.readFile({
        programId: this.programId,
        path,
        offset,
        ref,
        length: MAX_READ_BYTES,
      })
      chunks.push(new Uint8Array(bytes))
      offset += bytes.byteLength
      const total = Number(contentRange?.split("/").at(-1))
      if (
        (Number.isFinite(total) && offset >= total) ||
        bytes.byteLength < MAX_READ_BYTES ||
        !contentRange
      )
        break
    }
    const bytes = new Uint8Array(offset)
    let position = 0
    for (const chunk of chunks) {
      bytes.set(chunk, position)
      position += chunk.byteLength
    }
    return bytes.buffer
  }

  prepareSource = () => this.prepareSnapshot(1)

  // Independent repository reads overlap without flooding a Chromebook with
  // requests. The build snapshot still follows its existing serial path.
  prepareAutocompleteSource = () => this.prepareSnapshot(6, true)

  private async prepareSnapshot(concurrency: number, sourceOnly = false) {
    const { sha, paths: manifestPaths } = await this.actions.buildManifest({
      programId: this.programId,
    })
    const paths = sourceOnly
      ? manifestPaths.filter((path) =>
          /\.(c|cc|cpp|cxx|h|hh|hpp|hxx|inc)$|(^|\/)\.clang-format$/i.test(path)
        )
      : manifestPaths
    const files: Record<string, Uint8Array> = {}
    let total = 0
    let next = 0
    await Promise.all(
      Array.from({ length: Math.min(concurrency, paths.length) }, async () => {
        while (next < paths.length) {
          const path = paths[next++]
          const bytes = new Uint8Array(await this.readBytes(path, true, sha))
          total += bytes.length
          if (total > 96 * 1024 * 1024)
            throw new Error("Source snapshot exceeds 96 MiB.")
          files[path] = bytes
        }
      })
    )
    return { sha, files }
  }

  private async exclusive<T>(operation: () => Promise<T>) {
    if (this.operationBusy)
      throw new Error("Wait for the current file operation to finish.")
    this.operationBusy = true
    try {
      return await operation()
    } finally {
      this.operationBusy = false
    }
  }
}

function pickEntryFile(paths: string[]) {
  return (
    paths.find((path) => /(^|\/)main\.(cpp|cc|c)$/.test(path)) ??
    paths.find((path) => path.endsWith(".cpp")) ??
    paths.at(0)
  )
}
