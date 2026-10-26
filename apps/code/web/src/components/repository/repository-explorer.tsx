import { useEffect, useMemo, useRef, useState } from "react"
import { FileTree, useFileTree } from "@pierre/trees/react"
import type { ContextMenuOpenContext } from "@pierre/trees"
import { Button } from "@workspace/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
} from "@workspace/ui/components/dropdown-menu"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { Input } from "@workspace/ui/components/input"
import { Field, FieldLabel } from "@workspace/ui/components/field"
import { Spinner } from "@workspace/ui/components/spinner"
import { toast } from "@workspace/ui/components/toast"
import {
  ArrowsInLineVerticalIcon,
  FilePlusIcon,
  FolderPlusIcon,
} from "@phosphor-icons/react"
import type { useProgramBinaries } from "@/hooks/use-program-binaries"
import { errorMessage } from "@/lib/errors"
import {
  assertAvailable,
  assertRepositoryPaths,
  isClientBuildPath,
  barePath,
  containsPath,
  copyDestination,
  joinPath,
  parentPath,
  rootEntries,
  validateNewPath,
  type ExplorerUpdate,
  type ExplorerEntry,
  type RepositoryChange,
} from "@/lib/explorer"

export type { ExplorerUpdate } from "@/lib/explorer"

type Props = {
  binaries: ReturnType<typeof useProgramBinaries>
  paths: string[]
  dirtyPaths: string[]
  activePath: string | null
  programId: string
  style: React.CSSProperties
  readBytes: (path: string, saved?: boolean) => Promise<ArrayBuffer>
  apply: (update: ExplorerUpdate) => Promise<void>
  onOpen: (path: string) => void
}

type Prompt = {
  kind: "file" | "directory" | "rename" | "delete"
  entries: ExplorerEntry[]
  folder: string
}

export function RepositoryExplorer(props: Props) {
  const { dirtyPaths, activePath } = props
  const binaries = props.binaries
  const generatedPaths = useMemo(
    () => Object.keys(binaries.files),
    [binaries.files]
  )
  const paths = useMemo(
    () => [...new Set([...props.paths, ...generatedPaths])].sort(),
    [props.paths, generatedPaths]
  )
  const isReadOnly = (path: string) => isClientBuildPath(path, generatedPaths)
  async function readBytes(path: string, saved?: boolean) {
    const binary = binaries.files[path]
    return binary ? new Uint8Array(binary).buffer : props.readBytes(path, saved)
  }
  function onOpen(path: string) {
    const binary = binaries.files[path]
    if (binary)
      saveDownload(new Uint8Array(binary).buffer, path.split("/").at(-1)!)
    else props.onOpen(path)
  }
  async function apply(update: ExplorerUpdate) {
    assertRepositoryPaths(
      [
        ...update.changes.map((change) => change.path),
        ...(update.moves ?? []).flatMap((move) => [move.from, move.to]),
      ],
      generatedPaths
    )
    await props.apply(update)
  }
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [clipboard, setClipboard] = useState<{
    entries: ExplorerEntry[]
    cut: boolean
  } | null>(null)
  const [promptOpen, setPromptOpen] = useState(false)
  const [prompt, setPrompt] = useState<Prompt | null>(null)
  const [value, setValue] = useState("")
  const [promptError, setPromptError] = useState<string | null>(null)
  const [menu, setMenu] = useState<{
    entry: ExplorerEntry
    context: ContextMenuOpenContext
  } | null>(null)
  const uploadInput = useRef<HTMLInputElement>(null)
  const uploadFolder = useRef("")
  const initialized = useRef(false)
  const knownPaths = useRef<string[]>([])
  // Pierre captures its initial callbacks, so selection must read current binaries.
  const openRef = useRef(onOpen)
  openRef.current = onOpen
  const resetting = useRef(false)
  const { model } = useFileTree({
    paths: [],
    flattenEmptyDirectories: true,
    initialExpansion: "closed",
    density: "compact",
    onSelectionChange: (selected) => {
      if (resetting.current) return
      const path = selected.at(-1)
      if (path && model.getItem(path)?.isDirectory() === false)
        openRef.current(path)
    },
  })

  useEffect(() => {
    // Reset implicit directories too, preserving expanded folders and selection.
    resetting.current = true
    if (!initialized.current) {
      model.resetPaths(paths, {
        initialExpandedPaths: [
          ...(activePath ? ancestors(activePath) : []),
          ...(generatedPaths.length ? ["bin"] : []),
        ],
      })
      initialized.current = true
    } else {
      const directories = new Set(knownPaths.current.flatMap(ancestors))
      const expanded = [...directories].filter((path) => {
        const handle = model.getItem(path)
        return handle && "isExpanded" in handle && handle.isExpanded()
      })
      if (
        generatedPaths.length &&
        !knownPaths.current.some((path) => containsPath("bin", path))
      )
        expanded.push("bin")
      const selectedPaths = model.getSelectedPaths()
      model.resetPaths(paths, { initialExpandedPaths: expanded })
      for (const path of selectedPaths) model.getItem(path)?.select()
    }
    knownPaths.current = paths
    resetting.current = false
  }, [model, paths])

  useEffect(() => {
    model.setGitStatus(
      dirtyPaths.map((path) => ({ path, status: "modified" as const }))
    )
  }, [model, dirtyPaths])

  useEffect(() => {
    if (!activePath) return
    for (const directory of ancestors(activePath)) {
      const handle = model.getItem(directory)
      if (handle && "expand" in handle) handle.expand()
    }
    if (!model.getItem(activePath)?.isSelected())
      model.getItem(activePath)?.select()
  }, [model, activePath, paths])

  function selectionFor(entry: ExplorerEntry) {
    const selection = model.getSelectedPaths()
    if (!selection.some((path) => barePath(path) === barePath(entry.path)))
      return [entry]
    return rootEntries(
      selection.map((path) => ({
        path: barePath(path),
        kind: model.getItem(path)?.isDirectory() ? "directory" : "file",
      }))
    )
  }

  async function run(action: () => Promise<void>) {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try {
      await action()
    } catch (error) {
      toast.add({
        type: "error",
        title: "File operation failed",
        description: errorMessage(error),
      })
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  function ask(kind: Prompt["kind"], entry: ExplorerEntry) {
    if (
      isReadOnly(entry.path) ||
      (kind === "delete" &&
        selectionFor(entry).some((item) => isReadOnly(item.path)))
    )
      return
    setPromptOpen(true)
    setPromptError(null)
    setValue(kind === "rename" ? barePath(entry.path).split("/").at(-1)! : "")
    setPrompt({
      kind,
      entries: kind === "delete" ? selectionFor(entry) : [entry],
      folder:
        entry.kind === "directory"
          ? barePath(entry.path)
          : parentPath(entry.path),
    })
  }

  function filesUnder(entries: ExplorerEntry[]) {
    return paths.filter((path) =>
      entries.some((entry) =>
        entry.kind === "directory"
          ? containsPath(entry.path, path)
          : path === entry.path
      )
    )
  }

  async function transfer(
    entries: ExplorerEntry[],
    destinations: string[],
    move: boolean
  ) {
    assertRepositoryPaths(
      [...entries.map((entry) => entry.path), ...destinations],
      generatedPaths
    )
    const changes: RepositoryChange[] = []
    const moves: { from: string; to: string }[] = []
    for (const [index, entry] of entries.entries()) {
      const from = barePath(entry.path)
      const to = destinations[index]
      assertAvailable(to, paths)
      if (entry.kind === "directory" && containsPath(from, to))
        throw new Error("A folder cannot be pasted inside itself.")
      const sources = filesUnder([entry])
      if (!sources.length)
        throw new Error(`${from} no longer exists. Refresh the Explorer.`)
      for (const path of sources) {
        const destination = `${to}${path.slice(from.length)}`
        // Moving preserves the saved version; the parent remaps unsaved drafts.
        const contents = await readBytes(path, move)
        changes.push({ operation: "put", path: destination, contents })
        if (move) changes.push({ operation: "delete", path })
      }
      if (move) moves.push({ from, to })
    }
    await apply({
      changes,
      moves,
      requireAbsentPaths: destinations,
      message:
        `${move ? "Move" : "Copy"} ${entries.map((entry) => barePath(entry.path)).join(", ")}`.slice(
          0,
          200
        ),
    })
  }

  async function submitPrompt(event: React.FormEvent) {
    event.preventDefault()
    if (!prompt || busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setPromptError(null)
    try {
      const entry = prompt.entries[0]
      if (prompt.kind === "delete") {
        const removed = filesUnder(prompt.entries)
        await apply({
          changes: removed.map((path) => ({ operation: "delete", path })),
          removed,
          message:
            `Delete ${prompt.entries.map((item) => item.path).join(", ")}`.slice(
              0,
              200
            ),
        })
      } else if (prompt.kind === "rename") {
        const destination = validateNewPath(
          joinPath(parentPath(entry.path), value)
        )
        if (destination !== barePath(entry.path))
          await transfer([entry], [destination], true)
      } else {
        const destination = validateNewPath(joinPath(prompt.folder, value))
        assertAvailable(destination, paths)
        // Git stores files, so keep newly created empty folders with .gitkeep.
        const path =
          prompt.kind === "directory" ? `${destination}/.gitkeep` : destination
        await apply({
          changes: [{ operation: "put", path, contents: "" }],
          requireAbsentPaths: [destination],
          message: `Create ${destination}`.slice(0, 200),
        })
        if (prompt.kind === "file") onOpen(path)
      }
      setPromptOpen(false)
    } catch (error) {
      setPromptError(errorMessage(error))
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  async function paste(folder: string) {
    if (!clipboard) return
    const reserved = [...paths]
    const destinations = clipboard.entries.map((entry) => {
      if (clipboard.cut && parentPath(entry.path) === folder)
        throw new Error("The item is already in this folder.")
      const destination = copyDestination(entry.path, folder, reserved)
      reserved.push(destination)
      return destination
    })
    await transfer(clipboard.entries, destinations, clipboard.cut)
    if (clipboard.cut) setClipboard(null)
  }

  async function download(entries: ExplorerEntry[]) {
    const files = filesUnder(entries)
    if (
      files.length === 1 &&
      entries.length === 1 &&
      entries[0].kind === "file"
    ) {
      saveDownload(await readBytes(files[0]), files[0].split("/").at(-1)!)
      return
    }
    // Use the browser directory picker for folder downloads, as VS Code web does.
    const picker = (
      window as Window & {
        showDirectoryPicker?: () => Promise<DirectoryHandle>
      }
    ).showDirectoryPicker
    if (!picker)
      throw new Error(
        "Folder download requires a browser with directory picker support. Download individual files in this browser."
      )
    let directory: DirectoryHandle
    try {
      directory = await picker.call(window)
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return
      throw error
    }
    const prefix = entries.length === 1 ? parentPath(entries[0].path) : ""
    for (const path of files) {
      const relative = prefix ? path.slice(prefix.length + 1) : path
      const segments = relative.split("/")
      let target = directory
      for (const segment of segments.slice(0, -1))
        target = await target.getDirectoryHandle(segment, { create: true })
      const file = await target.getFileHandle(segments.at(-1)!, {
        create: true,
      })
      const writer = await file.createWritable()
      try {
        await writer.write(await readBytes(path))
      } finally {
        await writer.close()
      }
    }
  }

  async function upload(files: File[]) {
    if (!files.length) return
    const changes: RepositoryChange[] = []
    const reserved = [...paths]
    for (const file of files) {
      const path = joinPath(
        uploadFolder.current,
        file.webkitRelativePath || file.name
      )
      assertAvailable(path, reserved)
      reserved.push(path)
      if (file.size > 512 * 1024)
        throw new Error(
          `${file.name} exceeds the repository's 512 KiB operation limit.`
        )
      changes.push({
        operation: "put",
        path,
        contents: await file.arrayBuffer(),
      })
    }
    await apply({
      changes,
      requireAbsentPaths: changes.map((change) => change.path),
      message: `Upload ${files.length} file${files.length === 1 ? "" : "s"}`,
    })
  }

  async function copyText(text: string) {
    await navigator.clipboard.writeText(text)
  }

  function menuItems(entry: ExplorerEntry, context: ContextMenuOpenContext) {
    const folder =
      entry.kind === "directory" ? barePath(entry.path) : parentPath(entry.path)
    const entries = selectionFor(entry)
    const readOnly = isReadOnly(entry.path)
    const selectedReadOnly = entries.some((item) => isReadOnly(item.path))
    const handle = model.getItem(entry.path)
    const expanded = handle && "isExpanded" in handle && handle.isExpanded()
    const openPrompt = (kind: Prompt["kind"]) => {
      context.close({ restoreFocus: false })
      ask(kind, entry)
    }
    return (
      <>
        {entry.kind === "directory" && (
          <>
            <DropdownMenuItem
              disabled={readOnly}
              onClick={() => openPrompt("file")}
            >
              New File
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={readOnly}
              onClick={() => openPrompt("directory")}
            >
              New Folder
            </DropdownMenuItem>
            {entry.path && !expanded && (
              <DropdownMenuItem
                onClick={() => {
                  if (handle && "toggle" in handle) handle.toggle()
                }}
              >
                Expand Folder
              </DropdownMenuItem>
            )}
          </>
        )}
        {entry.kind === "directory" && <DropdownMenuSeparator />}
        {entry.path && (
          <>
            <DropdownMenuItem
              disabled={selectedReadOnly}
              onClick={() => setClipboard({ entries, cut: true })}
            >
              Cut
              <DropdownMenuShortcut className="font-mono tracking-normal">
                Ctrl+X
              </DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={selectedReadOnly}
              onClick={() => setClipboard({ entries, cut: false })}
            >
              Copy
              <DropdownMenuShortcut className="font-mono tracking-normal">
                Ctrl+C
              </DropdownMenuShortcut>
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuItem
          disabled={!clipboard || readOnly}
          onClick={() => void run(() => paste(folder))}
        >
          Paste
          <DropdownMenuShortcut className="font-mono tracking-normal">
            Ctrl+V
          </DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {entry.path && (
          <DropdownMenuItem onClick={() => void run(() => download(entries))}>
            Download
          </DropdownMenuItem>
        )}
        {entry.kind === "directory" && (
          <DropdownMenuItem
            disabled={readOnly}
            onClick={() => {
              uploadFolder.current = folder
              uploadInput.current?.click()
            }}
          >
            Upload Files
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() =>
            void run(() =>
              copyText(
                entries
                  .map(
                    (item) => `v5x://${props.programId}/${barePath(item.path)}`
                  )
                  .join("\n")
              )
            )
          }
        >
          Copy Path
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() =>
            void run(() =>
              copyText(entries.map((item) => barePath(item.path)).join("\n"))
            )
          }
        >
          Copy Relative Path
        </DropdownMenuItem>
        {entry.path && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={entries.length !== 1 || selectedReadOnly}
              onClick={() => openPrompt("rename")}
            >
              Rename
              <DropdownMenuShortcut className="font-mono tracking-normal">
                F2
              </DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              disabled={selectedReadOnly}
              onClick={() => openPrompt("delete")}
            >
              Delete
              <DropdownMenuShortcut className="font-mono tracking-normal">
                Delete
              </DropdownMenuShortcut>
            </DropdownMenuItem>
          </>
        )}
      </>
    )
  }

  function keyboard(event: React.KeyboardEvent) {
    if (
      event.target instanceof HTMLElement &&
      /INPUT|TEXTAREA/.test(event.target.tagName)
    )
      return
    const path = model.getFocusedPath()
    if (!path || busy) return
    const entry: ExplorerEntry = {
      path: barePath(path),
      kind: model.getItem(path)?.isDirectory() ? "directory" : "file",
    }
    if (selectionFor(entry).some((item) => isReadOnly(item.path))) return
    const modifier = event.ctrlKey || event.metaKey
    let action: (() => void) | undefined
    if (event.key === "F2") action = () => ask("rename", entry)
    if (event.key === "Delete") action = () => ask("delete", entry)
    if (modifier && event.key.toLowerCase() === "c")
      action = () => setClipboard({ entries: selectionFor(entry), cut: false })
    if (modifier && event.key.toLowerCase() === "x")
      action = () => setClipboard({ entries: selectionFor(entry), cut: true })
    if (modifier && event.key.toLowerCase() === "v")
      action = () =>
        void run(() =>
          paste(
            entry.kind === "directory"
              ? barePath(entry.path)
              : parentPath(entry.path)
          )
        )
    if (action) {
      event.preventDefault()
      event.stopPropagation()
      action()
    }
  }

  const root: ExplorerEntry = { path: "", kind: "directory" }
  return (
    <div
      className="flex h-full min-h-0 flex-col"
      onKeyDownCapture={keyboard}
      aria-busy={busy}
    >
      <div className="flex shrink-0 items-center justify-start gap-0.5 px-2 pb-1">
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="New file"
          disabled={busy}
          onClick={() => ask("file", root)}
        >
          <FilePlusIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="New folder"
          disabled={busy}
          onClick={() => ask("directory", root)}
        >
          <FolderPlusIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Collapse all folders"
          onClick={() => {
            const directories = new Set(paths.flatMap(ancestors))
            for (const path of directories) {
              const handle = model.getItem(path)
              if (handle && "collapse" in handle) handle.collapse()
            }
          }}
        >
          <ArrowsInLineVerticalIcon />
        </Button>
        {busy && <Spinner className="ml-1 size-3" />}
      </div>
      <div
        className="min-h-0 flex-1"
        onContextMenu={(event) => {
          if (event.defaultPrevented || busy) return
          event.preventDefault()
          const rect = new DOMRect(event.clientX, event.clientY, 0, 0)
          const anchor = event.currentTarget
          setMenu({
            entry: root,
            context: {
              anchorElement: anchor,
              anchorRect: rect,
              close: () => setMenu(null),
              restoreFocus: () => model.focusFirstItem(),
            },
          })
        }}
      >
        <FileTree
          model={model}
          style={props.style}
          renderContextMenu={(item, context) => (
            <ExplorerMenu context={context} busy={busy}>
              {menuItems(
                { path: barePath(item.path), kind: item.kind },
                context
              )}
            </ExplorerMenu>
          )}
        />
      </div>
      {binaries.loading && (
        <p role="status" className="px-3 py-1 text-xs text-muted-foreground">
          Downloading build binaries…
        </p>
      )}
      {binaries.error && (
        <p role="alert" className="px-3 py-1 text-xs text-destructive">
          {binaries.error}
        </p>
      )}
      {menu && (
        <ExplorerMenu context={menu.context} busy={busy}>
          {menuItems(menu.entry, menu.context)}
        </ExplorerMenu>
      )}
      <input
        ref={uploadInput}
        type="file"
        multiple
        hidden
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? [])
          event.currentTarget.value = ""
          void run(() => upload(files))
        }}
      />
      <Dialog
        open={promptOpen}
        onOpenChange={(open) => {
          if (!open && !busy) setPromptOpen(false)
        }}
      >
        <DialogContent>
          <form
            onSubmit={(event) => void submitPrompt(event)}
            className="flex flex-col gap-5"
          >
            <DialogHeader>
              <DialogTitle>
                {prompt?.kind === "delete"
                  ? "Delete permanently?"
                  : prompt?.kind === "rename"
                    ? "Rename"
                    : prompt?.kind === "directory"
                      ? "New folder"
                      : "New file"}
              </DialogTitle>
              <DialogDescription>
                {prompt?.kind === "delete"
                  ? "This deletes the selected items and their contents from the repository. Unsaved edits in these files will be discarded."
                  : "Changes are saved to the repository immediately. Use / to create nested paths."}
              </DialogDescription>
            </DialogHeader>
            {prompt?.kind === "delete" ? (
              <ul className="max-h-48 overflow-auto text-sm">
                {prompt.entries.map((entry) => (
                  <li key={entry.path}>{entry.path}</li>
                ))}
              </ul>
            ) : (
              <Field>
                <FieldLabel htmlFor="explorer-name">
                  {prompt?.kind === "rename" ? "New name or path" : "Name"}
                </FieldLabel>
                <Input
                  id="explorer-name"
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                  required
                  autoFocus
                  disabled={busy}
                />
              </Field>
            )}
            {promptError && (
              <p role="alert" className="text-sm text-destructive">
                {promptError}
              </p>
            )}
            <DialogFooter>
              <DialogClose
                render={
                  <Button type="button" variant="outline" disabled={busy} />
                }
              >
                Cancel
              </DialogClose>
              <Button
                type="submit"
                variant={prompt?.kind === "delete" ? "destructive" : "default"}
                disabled={busy || (prompt?.kind !== "delete" && !value.trim())}
              >
                {busy && <Spinner />}
                {prompt?.kind === "delete"
                  ? "Delete"
                  : prompt?.kind === "rename"
                    ? "Rename"
                    : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function ExplorerMenu({
  context,
  busy,
  children,
}: {
  context: ContextMenuOpenContext
  busy: boolean
  children: React.ReactNode
}) {
  return (
    <DropdownMenu
      open
      modal={false}
      onOpenChange={(open) => {
        if (!open) context.close()
      }}
    >
      <DropdownMenuContent
        anchor={{ getBoundingClientRect: () => context.anchorRect }}
        side="bottom"
        align="start"
        sideOffset={2}
        data-file-tree-context-menu-root="true"
        aria-label="Explorer actions"
        finalFocus={false}
        className="min-w-60"
        onClickCapture={(event) => {
          if (busy) {
            event.preventDefault()
            event.stopPropagation()
          }
        }}
      >
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function ancestors(path: string) {
  const parts = path.split("/").slice(0, -1)
  return parts.map((_, index) => parts.slice(0, index + 1).join("/"))
}

function saveDownload(bytes: ArrayBuffer, name: string) {
  const url = URL.createObjectURL(new Blob([bytes]))
  const link = document.createElement("a")
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

type DirectoryHandle = {
  getDirectoryHandle: (
    name: string,
    options: { create: boolean }
  ) => Promise<DirectoryHandle>
  getFileHandle: (
    name: string,
    options: { create: boolean }
  ) => Promise<{
    createWritable: () => Promise<{
      write: (data: ArrayBuffer) => Promise<void>
      close: () => Promise<void>
    }>
  }>
}
