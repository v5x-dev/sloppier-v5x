import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
  type ReactNode,
} from "react"
import { useAction, useMutation, useQuery, useConvex } from "convex/react"
import { api } from "@v5x/backend/api"
import type { Id } from "@v5x/backend/dataModel"
import {
  diagnosticRevision,
  parseBuildDiagnostics,
} from "@/lib/build-diagnostics"
import { errorMessage } from "@/lib/errors"
import type { ArtifactEntries } from "@/lib/build-binaries"

type Connection = { baseUrl: string; token: string; expiresAt: string }
type Status = {
  logs: string
  building: boolean
  startedAt?: number | null
  artifactId: string | null
  speculative?: boolean
  sourceHash?: string | null
  artifactEntries?: ArtifactEntries | null
}
/**
 * This client's link to the Builder. `linking` is retrying the handshake; `linked` holds the connection the Builder
 * granted, and keeps it while a refresh is retried after a failure. `failure` is the last handshake error.
 */
type Link =
  | { kind: "unlinked" }
  | { kind: "linking"; failure: string | null }
  | { kind: "linked"; connection: Connection; failure: string | null }
/** The latest status the Builder reported, and the last poll's failure. */
type Polled = { status: Status | null; failure: string | null }
/**
 * The last non-speculative build this client submitted. Its compiler problems are saved once, when that build
 * finishes; `savedStartedAt` records which build that was.
 */
type Submitted = {
  startedAt: number | null
  revision: string | null
  savedStartedAt: number | null
}
// Status cadence: quick while a build runs, relaxed while the Builder is idle.
const IDLE_STATUS_MS = 500
const BUILD_STATUS_MS = 100
const HANDSHAKE_RETRY_MS = 3000
type Channel = {
  machineStatus: string | null
  status: Status | null
  ready: boolean
  error: string | null
  request: (
    path: string,
    body?: unknown,
    signal?: AbortSignal
  ) => Promise<Response>
  /** Starts a Builder when none is running. Editing uses it so speculative builds have a machine to use. */
  startBuilder: () => void
}
const Context = createContext<Channel | null>(null)
export function useProgramConnection() {
  const channel = useContext(Context)
  if (!channel) throw new Error("Program connection provider is missing.")
  return channel
}
export function ProgramConnection({
  programId,
  children,
}: {
  programId: Id<"programs">
  children: ReactNode
}) {
  const saveDiagnostics = useMutation(api.diagnostics.save)
  const submitted = useRef<Submitted>({
    startedAt: null,
    revision: null,
    savedStartedAt: null,
  })
  const connect = useAction(api.buildConnection.connect)
  const start = useMutation(api.builds.start)
  const convex = useConvex()
  const starting = useRef<Promise<Connection> | null>(null)
  // Convex carries lifecycle state only. Build output never enters this query.
  const machine = useQuery(api.builds.status, { programId })
  const [link, setLinkState] = useState<Link>({ kind: "unlinked" })
  // Requests made between renders read the link from here, so every change goes through setLink.
  const linkRef = useRef<Link>(link)
  const setLink = useCallback((next: Link) => {
    linkRef.current = next
    setLinkState(next)
  }, [])
  const [polled, setPolled] = useState<Polled>({ status: null, failure: null })
  useEffect(() => {
    if (machine?.status !== "ready") {
      setLink({ kind: "unlinked" })
      return
    }
    if (linkRef.current.kind === "unlinked")
      setLink({ kind: "linking", failure: null })
    let disposed = false
    let timer: ReturnType<typeof setTimeout>
    const handshake = async () => {
      try {
        const result = await connect({ programId })
        if (disposed) return
        setLink({ kind: "linked", connection: result, failure: null })
        timer = setTimeout(
          () => void handshake(),
          Math.max(1000, Date.parse(result.expiresAt) - Date.now() - 60_000)
        )
      } catch (err) {
        if (disposed) return
        const failure = errorMessage(err)
        const current = linkRef.current
        setLink(
          current.kind === "linked"
            ? { ...current, failure }
            : { kind: "linking", failure }
        )
        timer = setTimeout(() => void handshake(), HANDSHAKE_RETRY_MS)
      }
    }
    void handshake()
    return () => {
      disposed = true
      clearTimeout(timer)
    }
  }, [connect, programId, machine?.machineId, machine?.status, setLink])
  // Starts the Builder, then waits for it to report ready and links to it.
  const startAndConnect = useCallback(async (): Promise<Connection> => {
    await start({ programId })
    const deadline = Date.now() + 90_000
    while (Date.now() < deadline) {
      const state = await convex.query(api.builds.status, { programId })
      if (state?.status === "error") throw new Error(state.logs)
      if (state?.status === "ready") {
        const result = await connect({ programId })
        setLink({ kind: "linked", connection: result, failure: null })
        return result
      }
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
    throw new Error("The Builder didn't start in time. Try again.")
  }, [connect, convex, programId, setLink, start])
  const request = useCallback(
    async (path: string, body?: unknown, signal?: AbortSignal) => {
      signal?.throwIfAborted()
      let direct =
        linkRef.current.kind === "linked" ? linkRef.current.connection : null
      if (!direct) {
        if (!starting.current)
          starting.current = startAndConnect().finally(() => {
            starting.current = null
          })
        direct = await starting.current
      }
      signal?.throwIfAborted()
      const response = await fetch(`${direct.baseUrl}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Authorization: `Bearer ${direct.token}`,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(30_000)])
          : AbortSignal.timeout(30_000),
      })
      if (!response.ok)
        throw new Error(
          `The Builder didn't respond (${response.status}). Try again.`
        )
      // A speculative build is not a commit: it must not claim the build clock or the revision for diagnostics.
      const speculative = (body as { speculative?: boolean } | undefined)
        ?.speculative
      if (path === "/build" && !speculative) {
        submitted.current = {
          ...submitted.current,
          startedAt: Date.now(),
          revision: (body as { commit?: string } | undefined)?.commit ?? null,
        }
      }
      return response
    },
    [startAndConnect]
  )
  useEffect(() => {
    if (link.kind !== "linked") return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    const isAborted = () => controller.signal.aborted
    let pollInterval = IDLE_STATUS_MS
    const poll = async () => {
      if (linkRef.current.kind !== "linked" || isAborted()) return
      try {
        const response = await request("/status", undefined, controller.signal)
        const next = (await response.json()) as Status
        pollInterval = next.building ? BUILD_STATUS_MS : IDLE_STATUS_MS
        if (!isAborted()) {
          const record = submitted.current
          if (next.building && next.startedAt && !next.speculative)
            record.startedAt = next.startedAt
          const revision = diagnosticRevision(next.logs) ?? record.revision
          if (
            !next.building &&
            !next.speculative &&
            revision &&
            record.startedAt !== null &&
            record.savedStartedAt !== record.startedAt
          ) {
            const startedAt = record.startedAt
            record.savedStartedAt = startedAt
            void saveDiagnostics({
              programId,
              revision,
              startedAt,
              diagnostics: parseBuildDiagnostics(next.logs).slice(0, 2000),
            }).catch((err) => {
              submitted.current.savedStartedAt = null
              if (!isAborted())
                setPolled((prev) => ({
                  ...prev,
                  failure: `Could not save compiler problems: ${errorMessage(err)}`,
                }))
            })
          }
          setPolled({ status: next, failure: null })
        }
      } catch (err) {
        if (!isAborted())
          setPolled((prev) => ({ ...prev, failure: errorMessage(err) }))
      } finally {
        if (!isAborted()) timer = setTimeout(() => void poll(), pollInterval)
      }
    }
    void poll()
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [link.kind, request, programId, saveDiagnostics])
  const machineStatus = machine?.status ?? null
  const machineStatusRef = useRef<string | null>(null)
  machineStatusRef.current = machineStatus
  const lastStart = useRef(0)
  const startBuilder = useCallback(() => {
    if (linkRef.current.kind === "linked") return
    if (
      machineStatusRef.current === "ready" ||
      machineStatusRef.current === "starting"
    )
      return
    if (Date.now() - lastStart.current < 10_000) return
    lastStart.current = Date.now()
    start({ programId }).catch(() => {
      lastStart.current = 0
    })
  }, [programId, start])
  const linkFailure = link.kind === "unlinked" ? null : link.failure
  return (
    <Context
      value={{
        machineStatus,
        status: polled.status,
        ready: link.kind === "linked" && polled.status !== null,
        error: linkFailure ?? polled.failure,
        request,
        startBuilder,
      }}
    >
      {children}
    </Context>
  )
}
