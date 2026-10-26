import {
  detectImportTemplate,
  excludedImportPath,
  validateImportPaths,
  IMPORT_MAX_FILES,
  IMPORT_MAX_BYTES,
  IMPORT_BATCH_BYTES,
  IMPORT_BATCH_FILES,
} from "@workspace/backend/imports"
import type { Doc } from "@workspace/backend/dataModel"

type Template = Doc<"programs">["template"]
export type FolderFile = { path: string; file: File }

export function selectedFolder(files: File[]) {
  const root = files[0]?.webkitRelativePath?.split("/")[0]
  if (
    !root ||
    files.some((file) => !file.webkitRelativePath.startsWith(`${root}/`))
  )
    throw new Error("Choose a single program folder.")
  const entries = files.map((file) => ({
    path: file.webkitRelativePath.slice(root.length + 1),
    file,
  }))
  return {
    name: root.slice(0, 80),
    entries,
    template: detectImportTemplate(entries.map((entry) => entry.path)),
  }
}

export function planFolder(entries: FolderFile[], template: Template) {
  const included: FolderFile[] = []
  const skipped: { path: string; reason: string }[] = []
  for (const entry of entries) {
    const reason = excludedImportPath(template, entry.path)
    if (reason) skipped.push({ path: entry.path, reason })
    else included.push(entry)
  }
  if (!included.length)
    throw new Error(
      "This folder has no files to import after excluding generated files and managed dependencies."
    )
  if (included.length > IMPORT_MAX_FILES)
    throw new Error(
      `Import up to ${IMPORT_MAX_FILES.toLocaleString()} files at a time.`
    )
  validateImportPaths(included.map((entry) => entry.path))
  let totalBytes = 0
  for (const entry of included) {
    if (entry.file.size > IMPORT_BATCH_BYTES)
      throw new Error(
        `${entry.path} is larger than the 384 KiB per-file import limit.`
      )
    totalBytes += entry.file.size
  }
  if (totalBytes > IMPORT_MAX_BYTES)
    throw new Error(
      "The folder exceeds the 16 MiB import limit after exclusions."
    )
  included.sort((a, b) => a.path.localeCompare(b.path))
  return { included, skipped, totalBytes }
}

export async function* folderBatches(entries: FolderFile[]) {
  let batch: { path: string; contents: ArrayBuffer }[] = []
  let bytes = 0
  for (const entry of entries) {
    if (entry.file.size > IMPORT_BATCH_BYTES)
      throw new Error(`${entry.path} exceeds the per-file import limit.`)
    if (
      batch.length &&
      (bytes + entry.file.size > IMPORT_BATCH_BYTES ||
        batch.length === IMPORT_BATCH_FILES)
    ) {
      yield batch
      batch = []
      bytes = 0
    }
    batch.push({ path: entry.path, contents: await entry.file.arrayBuffer() })
    bytes += entry.file.size
  }
  if (batch.length) yield batch
}
