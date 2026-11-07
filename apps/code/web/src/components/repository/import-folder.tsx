import { UploadSimpleIcon } from "@phosphor-icons/react"
import { useState } from "react"
import { useMutation } from "convex/react"
import { useNavigate } from "@tanstack/react-router"
import { api } from "@v5x/backend/api"
import type { Doc, Id } from "@v5x/backend/dataModel"
import { ActionTooltip } from "@/components/shared/action-tooltip"
import { Button } from "@v5x/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@v5x/ui/components/dialog"
import { Input } from "@v5x/ui/components/input"
import { Spinner } from "@v5x/ui/components/spinner"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@v5x/ui/components/select"
import {
  folderBatches,
  planFolder,
  selectedFolder,
  type FolderFile,
} from "@/lib/folder-import"
import { errorMessage } from "@/lib/errors"

type Template = Doc<"programs">["template"]
/** The folder the user picked, or nothing picked yet. */
type Draft =
  { kind: "empty" } | { kind: "picked"; entries: FolderFile[]; name: string }
/** Editing the form (with the last error, if any), or uploading the folder with how many files have gone up. */
type Progress =
  { kind: "editing"; error: string } | { kind: "importing"; uploaded: number }
const templates = [
  { value: "vexcode", label: "VEXcode" },
  { value: "pros", label: "PROS" },
  { value: "rw", label: "RW" },
  { value: "ez-template", label: "EZ-Template" },
  { value: "jar", label: "JAR" },
]

export function ImportFolder({
  workspaceId,
}: {
  workspaceId: Id<"workspaces">
}) {
  const begin = useMutation(api.programs.beginFolderImport)
  const append = useMutation(api.programs.appendFolderImport)
  const finish = useMutation(api.programs.finishFolderImport)
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  // The folder picked, if any. Its name is the program's name, which the user may change.
  const [draft, setDraft] = useState<Draft>({ kind: "empty" })
  const entries = draft.kind === "picked" ? draft.entries : []
  const name = draft.kind === "picked" ? draft.name : ""
  const setName = (value: string) =>
    setDraft((current) =>
      current.kind === "picked" ? { ...current, name: value } : current
    )
  const [template, setTemplate] = useState<Template>("pros")
  const [progress, setProgress] = useState<Progress>({
    kind: "editing",
    error: "",
  })
  const busy = progress.kind === "importing"
  const uploaded = progress.kind === "importing" ? progress.uploaded : 0
  const error = progress.kind === "editing" ? progress.error : ""
  const setError = (message: string) =>
    setProgress((current) =>
      current.kind === "editing" ? { kind: "editing", error: message } : current
    )
  /** Closes the dialog and forgets the picked folder, its name, and any error. */
  const reset = () => {
    setOpen(false)
    setDraft({ kind: "empty" })
    setProgress({ kind: "editing", error: "" })
  }
  let plan: ReturnType<typeof planFolder> | null = null
  let planError = ""
  if (entries.length) {
    try {
      plan = planFolder(entries, template)
    } catch (failure) {
      planError = errorMessage(failure)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return
        if (next) setOpen(true)
        else reset()
      }}
    >
      <ActionTooltip label="Import folder">
        <DialogTrigger
          render={
            <Button variant="outline" size="icon" aria-label="Import folder" />
          }
        >
          <UploadSimpleIcon />
        </DialogTrigger>
      </ActionTooltip>
      <DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-xl">
        <form
          className="flex flex-col gap-5"
          onSubmit={async (event) => {
            event.preventDefault()
            if (!plan || busy || !name.trim()) return
            setProgress({ kind: "importing", uploaded: 0 })
            try {
              const importId = await begin({
                workspaceId,
                name,
                template,
                expectedFiles: plan.included.length,
              })
              let sequence = 0
              let count = 0
              for await (const files of folderBatches(plan.included)) {
                await append({ importId, sequence, files })
                sequence++
                count += files.length
                setProgress({ kind: "importing", uploaded: count })
              }
              const programId = await finish({ importId })
              reset()
              await navigate({
                to: "/programs/$programId",
                params: { programId },
              })
            } catch (failure) {
              setProgress({ kind: "editing", error: errorMessage(failure) })
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>Import folder</DialogTitle>
          </DialogHeader>
          <Input
            key={open ? "open" : "closed"}
            id="program-folder"
            aria-label="Program folder"
            type="file"
            multiple
            disabled={busy}
            ref={(node) => {
              node?.setAttribute("webkitdirectory", "")
            }}
            onChange={(event) => {
              setError("")
              try {
                const files = Array.from(event.target.files ?? [])
                if (!files.length) return
                const folder = selectedFolder(files)
                setDraft({
                  kind: "picked",
                  entries: folder.entries,
                  name: folder.name,
                })
                setTemplate(folder.template ?? "pros")
              } catch (failure) {
                setDraft({ kind: "empty" })
                setError(errorMessage(failure))
              }
            }}
          />
          {entries.length > 0 && (
            <>
              <Input
                id="import-name"
                aria-label="Program name"
                placeholder="Name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                maxLength={80}
                disabled={busy}
              />
              <Select
                value={template}
                onValueChange={(value) => {
                  if (value) setTemplate(value)
                }}
                items={templates}
                disabled={busy}
              >
                <SelectTrigger
                  id="import-template"
                  aria-label="Program type"
                  className="w-full"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {templates.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </>
          )}
          {plan && (
            <div className="flex flex-col gap-2">
              <p className="text-sm">
                {plan.included.length} files ·{" "}
                {(plan.totalBytes / 1024).toFixed(1)} KiB
              </p>
              <ul
                className="max-h-40 overflow-auto rounded-md border p-3 text-xs"
                aria-label="Files to import"
              >
                {plan.included.map((entry) => (
                  <li key={entry.path} className="py-0.5 break-all">
                    {entry.path}
                  </li>
                ))}
              </ul>
              {plan.skipped.length > 0 && (
                <details className="text-xs text-muted-foreground">
                  <summary className="cursor-pointer">
                    {plan.skipped.length} excluded files
                  </summary>
                  <ul className="mt-2 max-h-32 overflow-auto">
                    {plan.skipped.map((entry) => (
                      <li key={entry.path} className="py-0.5 break-all">
                        {entry.path} · {entry.reason}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
          {(error || planError) && (
            <p role="alert" className="text-sm text-destructive">
              {error || planError}
            </p>
          )}
          {busy && (
            <p role="status" className="text-sm text-muted-foreground">
              {uploaded === plan?.included.length
                ? "Creating repository…"
                : `Uploading ${uploaded} of ${plan?.included.length ?? 0} files…`}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => {
                reset()
              }}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !plan || !name.trim()}>
              {busy ? <Spinner /> : <UploadSimpleIcon />}Import program
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
