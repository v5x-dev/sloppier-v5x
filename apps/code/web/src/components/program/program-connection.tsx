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
import { errorMessage } from "@/lib/errors"

type Connection = { baseUrl: string; token: string; expiresAt: string }
type Status = {
  logs: string
  building: boolean
  startedAt?: number | null
  artifactId: string | null
}
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
  const connect = useAction(api.buildConnection.connect)
  const start = useMutation(api.builds.start)
  const convex = useConvex()
  const starting = useRef<Promise<Connection> | null>(null)
  // Convex carries lifecycle state only. Build output never enters this query.
  const machine = useQuery(api.builds.status, { programId })
  const [connection, setConnection] = useState<Connection | null>(null)
  const connectionRef = useRef<Connection | null>(null)
  connectionRef.current = connection
  const [status, setStatus] = useState<Status | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (machine?.status !== "ready") {
      connectionRef.current = null
      setConnection(null)
      return
    }
    let disposed = false
    let timer: ReturnType<typeof setTimeout>
    const handshake = async () => {
      try {
        const result = await connect({ programId })
        if (disposed) return
        setConnection(result)
        setError(null)
        timer = setTimeout(
          () => void handshake(),
          Math.max(1000, Date.parse(result.expiresAt) - Date.now() - 60_000)
        )
      } catch (err) {
        if (!disposed) {
          setError(errorMessage(err))
          timer = setTimeout(() => void handshake(), 3000)
        }
      }
    }
    void handshake()
    return () => {
      disposed = true
      clearTimeout(timer)
    }
  }, [connect, programId, machine?.machineId, machine?.status])
  const request = useCallback(
    async (path: string, body?: unknown, signal?: AbortSignal) => {
      signal?.throwIfAborted()
      let direct = connectionRef.current
      if (!direct) {
        if (!starting.current)
          starting.current = (async () => {
            await start({ programId })
            const deadline = Date.now() + 90_000
            while (Date.now() < deadline) {
              const state = await convex.query(api.builds.status, { programId })
              if (state?.status === "error") throw new Error(state.logs)
              if (state?.status === "ready") {
                const result = await connect({ programId })
                connectionRef.current = result
                setConnection(result)
                return result
              }
              await new Promise((resolve) => setTimeout(resolve, 500))
            }
            throw new Error("Builder startup timed out.")
          })().finally(() => {
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
        throw new Error(`Builder request failed (${response.status}).`)
      return response
    },
    [connect, convex, programId, start]
  )
  useEffect(() => {
    if (!connection) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    const isAborted = () => controller.signal.aborted
    const poll = async () => {
      if (!connectionRef.current || isAborted()) return
      try {
        const response = await request("/status", undefined, controller.signal)
        const next = (await response.json()) as Status
        if (!isAborted()) {
          setStatus(next)
          setError(null)
        }
      } catch (err) {
        if (!isAborted()) setError(errorMessage(err))
      } finally {
        if (!isAborted()) timer = setTimeout(() => void poll(), 500)
      }
    }
    void poll()
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [connection, request])
  return (
    <Context
      value={{
        machineStatus: machine?.status ?? null,
        status,
        ready: Boolean(connection && status),
        error,
        request,
      }}
    >
      {children}
    </Context>
  )
}
