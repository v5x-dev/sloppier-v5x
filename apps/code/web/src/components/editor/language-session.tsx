import { createContext, useContext, useEffect, useRef, useState } from "react"
import { LanguageService } from "@/lib/language-service"
import type { WorkbenchSource } from "@/lib/workbench-source"

export const DefinitionContext = createContext<
  ((path: string, line: number, column: number) => boolean) | null
>(null)
const Context = createContext<LanguageService | null>(null)
export function useLanguageService() {
  return useContext(Context)
}

/** One local source index per program, with live Yjs documents taking precedence. */
export function LanguageSession({
  source,
  template,
  onDefinition,
  children,
}: {
  template: string
  source: WorkbenchSource
  onDefinition: (path: string, line: number, column: number) => boolean
  children: React.ReactNode
}) {
  const sourceRef = useRef(source)
  sourceRef.current = source
  const [client] = useState(
    () =>
      new LanguageService(template, () =>
        sourceRef.current.prepareAutocompleteSource()
      )
  )
  useEffect(() => {
    let disposed = false
    let paths = source.getSnapshot().paths?.join("\n")
    const sync = () => {
      const state = source.getSnapshot()
      for (const [path, file] of Object.entries(state.loaded))
        if (file && !file.truncated) client.updateFile(path, file.contents)
      for (const [path, text] of source.getDrafts())
        client.updateFile(path, text)
    }
    const stop = source.subscribe(() => {
      sync()
      const next = source.getSnapshot().paths?.join("\n")
      if (next !== paths) {
        paths = next
        void client
          .refreshSource()
          .then(() => {
            if (!disposed) sync()
          })
          .catch(() => {})
      }
    })
    const stopDrafts = source.subscribeDrafts(sync)
    void client.start().then(() => {
      if (!disposed) sync()
    })
    return () => {
      disposed = true
      stop()
      stopDrafts()
      client.stop()
    }
  }, [client, source])
  return (
    <Context value={client}>
      <DefinitionContext value={onDefinition}>{children}</DefinitionContext>
    </Context>
  )
}
