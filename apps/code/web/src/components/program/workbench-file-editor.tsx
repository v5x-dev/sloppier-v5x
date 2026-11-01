import type { FormatChange } from "@/components/editor/editor-formatting"
import {
  LiveFileEditor,
  type LivePerson,
} from "@/components/editor/live-file-editor"
import type { DiagnosticTarget } from "@/lib/build-diagnostics"
import { editorThemeOptions } from "@/lib/editor-theme"
import { MAX_SOURCE_BYTES } from "@/lib/live-document"
import { File } from "@pierre/diffs/react"
import type { Id } from "@v5x/backend/dataModel"

import type { LoadedFile, WorkbenchSource } from "@/lib/workbench-source"
import { useLayoutEffect, useMemo, useRef } from "react"

export function FileEditor({
  onFormatChange,
  diagnosticTarget,
  programId,
  viewId,
  path,
  loaded,
  active,
  onSyncChange,
  onPeopleChange,
  scrollPositions,
  onChange,
  onReplacementAction,
  onCursorLine,
  takeLiveOpen,
}: {
  programId: Id<"programs">
  viewId: string
  path: string
  loaded: LoadedFile
  onFormatChange: FormatChange
  diagnosticTarget?: DiagnosticTarget
  active: boolean
  onSyncChange: (synced: boolean) => void
  onPeopleChange: (people: LivePerson[]) => void
  scrollPositions: Map<string, number>
  onChange: (text: string) => void
  onReplacementAction: WorkbenchSource["setReplacementAction"]
  onCursorLine: (path: string, line: number) => void
  takeLiveOpen: WorkbenchSource["takeLiveOpen"]
}) {
  const container = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const viewport = container.current?.parentElement
    if (viewport) viewport.scrollTop = scrollPositions.get(path) ?? 0
  }, [path, scrollPositions])

  const file = useMemo(
    () => ({
      name: path,
      contents: loaded.contents,
      cacheKey: `${programId}:${path}`,
    }),
    [loaded.contents, path, programId]
  )

  const tooLarge =
    new TextEncoder().encode(loaded.contents).byteLength > MAX_SOURCE_BYTES
  const binary =
    loaded.contents.includes("\0") || loaded.contents.includes("\ufffd")
  return (
    <div ref={container} className="min-h-full">
      {loaded.truncated || tooLarge || binary ? (
        <>
          <p className="border-b px-4 py-2 text-xs text-muted-foreground">
            {binary
              ? "This file is not UTF-8 text and is read-only."
              : "Files larger than 256 KiB are read-only. Preview limited to 512 KiB."}
          </p>
          <File file={file} options={editorThemeOptions} />
        </>
      ) : (
        <LiveFileEditor
          onFormatChange={onFormatChange}
          takeLiveOpen={takeLiveOpen}
          programId={programId}
          viewId={viewId}
          path={path}
          active={active}
          diagnosticTarget={diagnosticTarget}
          onChange={onChange}
          onSyncChange={onSyncChange}
          onPeopleChange={onPeopleChange}
          onReplacementAction={onReplacementAction}
          onCursorLine={onCursorLine}
        />
      )}
    </div>
  )
}
