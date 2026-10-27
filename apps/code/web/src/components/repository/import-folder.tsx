import { UploadSimpleIcon } from "@phosphor-icons/react"
import { useState } from "react"
import { useMutation } from "convex/react"
import { useNavigate } from "@tanstack/react-router"
import { api } from "@workspace/backend/api"
import type { Doc, Id } from "@workspace/backend/dataModel"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@workspace/ui/components/dialog"
import { Input } from "@workspace/ui/components/input"
import { Field, FieldLabel } from "@workspace/ui/components/field"
import { Spinner } from "@workspace/ui/components/spinner"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import {
  folderBatches,
  planFolder,
  selectedFolder,
  type FolderFile,
} from "@/lib/folder-import"
import { errorMessage } from "@/lib/errors"

type Template = Doc<"programs">["template"]
const templates = [
  { value: "vexcode", label: "VEXcode" },
  { value: "pros", label: "PROS" },
  { value: "ez-template", label: "EZ-Template" },
  { value: "jar", label: "JAR" },
]

export function ImportFolder({
  workspaceId,
  tile = false,
}: {
  workspaceId: Id<"workspaces">
  tile?: boolean
}) {
  const begin = useMutation(api.programs.beginFolderImport)
  const append = useMutation(api.programs.appendFolderImport)
  const finish = useMutation(api.programs.finishFolderImport)
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [entries, setEntries] = useState<FolderFile[]>([])
  const [name, setName] = useState("")
  const [template, setTemplate] = useState<Template>("pros")
  const [detected, setDetected] = useState<Template | null>(null)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [uploaded, setUploaded] = useState(0)
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
        setOpen(next)
        if (!next) {
          setEntries([])
          setError("")
          setName("")
          setUploaded(0)
        }
      }}
    >
      <DialogTrigger
        render={
          <Button
            className={
              tile
                ? "aspect-[4/3] h-auto w-full min-w-24 rounded-2xl border-0 bg-(--template-import)/25 text-foreground hover:brightness-110 dark:bg-(--template-import)/25"
                : undefined
            }
            variant="outline"
            size="icon"
            aria-label="Import folder"
            title="Import folder"
          />
        }
      >
        <UploadSimpleIcon className={tile ? "size-6" : undefined} />
      </DialogTrigger>
      <DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-xl">
        <form
          className="flex flex-col gap-5"
          onSubmit={async (event) => {
            event.preventDefault()
            if (!plan || busy || !name.trim()) return
            setBusy(true)
            setError("")
            setUploaded(0)
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
                setUploaded(count)
              }
              const programId = await finish({ importId })
              setOpen(false)
              setEntries([])
              await navigate({
                to: "/programs/$programId",
                params: { programId },
              })
            } catch (failure) {
              setError(errorMessage(failure))
            } finally {
              setBusy(false)
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>Import a program folder</DialogTitle>
            <DialogDescription>
              Choose a folder from your computer. Your source files and folder
              layout will become a new program.
            </DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="program-folder">Program folder</FieldLabel>
            <Input
              key={open ? "open" : "closed"}
              id="program-folder"
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
                  setEntries(folder.entries)
                  setName(folder.name)
                  setDetected(folder.template)
                  setTemplate(folder.template ?? "pros")
                } catch (failure) {
                  setEntries([])
                  setError(errorMessage(failure))
                }
              }}
            />
          </Field>
          {entries.length > 0 && (
            <>
              <Field>
                <FieldLabel htmlFor="import-name">Program name</FieldLabel>
                <Input
                  id="import-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                  maxLength={80}
                  disabled={busy}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="import-template">Program type</FieldLabel>
                <Select
                  value={template}
                  onValueChange={(value) => {
                    if (value) setTemplate(value)
                  }}
                  items={templates}
                  disabled={busy}
                >
                  <SelectTrigger id="import-template" className="w-full">
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
                <p className="text-xs text-muted-foreground">
                  {detected
                    ? "Detected from your folder. Change it if needed."
                    : "Choose the program type so the correct toolchain is used."}
                </p>
              </Field>
              <p className="text-xs text-muted-foreground">
                SDK and firmware dependencies use the versions provided by this
                editor's build service.
              </p>
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
          <p className="text-xs text-muted-foreground">
            Up to 1,000 files and 16 MiB total. Each file can be up to 384 KiB.
            Git history, build output, local environment files, and managed
            dependencies are excluded.
          </p>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => {
                setOpen(false)
                setEntries([])
                setError("")
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
