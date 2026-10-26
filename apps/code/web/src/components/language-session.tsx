import { createContext, useContext, useEffect, useRef, useState } from "react"
import type { BuildSource } from "@/lib/build-program"
import { LanguageClient } from "@/lib/language-client"
import { useProgramConnection } from "./program-connection"

export const DefinitionContext = createContext<
  ((path: string, line: number, column: number) => boolean) | null
>(null)

const Context = createContext<LanguageClient | null>(null)

export function useLanguageClient() {
  return useContext(Context)
}

/** One clangd session per tab, on the program's build machine. */
export function LanguageSession({
  prepareSource,
  onDefinition,
  children,
}: {
  onDefinition: (path: string, line: number, column: number) => boolean
  prepareSource: () => Promise<BuildSource>
  children: React.ReactNode
}) {
  const { request, ready } = useProgramConnection()
  const requestRef = useRef(request)
  requestRef.current = request
  const sourceRef = useRef(prepareSource)
  sourceRef.current = prepareSource
  const [client] = useState(
    () =>
      new LanguageClient(
        () => requestRef.current,
        () => sourceRef.current()
      )
  )
  // Token renewals change `request` but keep the machine session; only a
  // machine becoming ready starts (or, after replacement, restarts) clangd.
  useEffect(() => {
    if (ready) void client.start()
  }, [client, ready])
  useEffect(() => () => client.stop(), [client])
  return (
    <Context value={client}>
      <DefinitionContext value={onDefinition}>{children}</DefinitionContext>
    </Context>
  )
}
