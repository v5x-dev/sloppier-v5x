import { createContext, useContext, useEffect, useRef, useState } from "react"
import type { BuildSource } from "@/lib/build-program"
import { LanguageClient } from "@/lib/language-client"
import { WorkerLanguageTransport } from "@/lib/language/worker-transport"

export const DefinitionContext = createContext<
  ((path: string, line: number, column: number) => boolean) | null
>(null)

const Context = createContext<LanguageClient | null>(null)

export function useLanguageClient() {
  return useContext(Context)
}

/** One browser clangd worker per tab, independent of the build machine. */
export function LanguageSession({
  prepareSource,
  template,
  onDefinition,
  children,
}: {
  template: string
  onDefinition: (path: string, line: number, column: number) => boolean
  prepareSource: () => Promise<BuildSource>
  children: React.ReactNode
}) {
  const sourceRef = useRef(prepareSource)
  sourceRef.current = prepareSource
  const [client] = useState(
    () =>
      new LanguageClient(new WorkerLanguageTransport(template), () =>
        sourceRef.current()
      )
  )
  useEffect(() => {
    void client.start()
    return () => client.stop()
  }, [client])
  return (
    <Context value={client}>
      <DefinitionContext value={onDefinition}>{children}</DefinitionContext>
    </Context>
  )
}
