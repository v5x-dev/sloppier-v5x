import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
  type ReactNode,
} from "react"
import { useAction, useMutation, useQuery } from "convex/react"
import { api } from "@workspace/backend/api"
import type { Id } from "@workspace/backend/dataModel"
import { errorMessage } from "@/lib/errors"

type Connection = { baseUrl: string; token: string; expiresAt: string }
type Status = { logs: string; building: boolean; artifactId: string | null }
type Channel = {
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
  projectId,
  children,
}: {
  projectId: Id<"projects">
  children: ReactNode
}) {
  const connect = useAction(api.buildConnection.connect)
  const heartbeat = useMutation(api.builds.heartbeat)
  // Convex carries lifecycle state only. Build output never enters this query.
  const machine = useQuery(api.builds.status, { projectId })
  const [connection, setConnection] = useState<Connection | null>(null)
  const connectionRef = useRef<Connection | null>(null)
  connectionRef.current = connection
  const [status, setStatus] = useState<Status | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const sessionId = crypto.randomUUID()
    let disposed = false
    let queue = Promise.resolve()
    const beat = () => {
      queue = queue.then(async () => {
        if (disposed) return
        try {
          const direct = connectionRef.current
          if (direct) {
            const response = await fetch(`${direct.baseUrl}/presence`, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${direct.token}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ sessionId }),
              signal: AbortSignal.timeout(10_000),
            })
            if (!response.ok)
              throw new Error(`Presence request failed (${response.status}).`)
          } else await heartbeat({ projectId, sessionId })
        } catch (err) {
          if (!disposed) setError(errorMessage(err))
        }
      })
    }
    beat()
    const timer = setInterval(beat, 10_000)
    return () => {
      disposed = true
      clearInterval(timer)
      void queue
        .then(async () => {
          const direct = connectionRef.current
          if (direct)
            await fetch(`${direct.baseUrl}/presence`, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${direct.token}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ sessionId, leave: true }),
              keepalive: true,
              signal: AbortSignal.timeout(10_000),
            }).catch(() => {})
          await heartbeat({ projectId, sessionId, leave: true })
        })
        .catch(() => {})
    }
  }, [heartbeat, projectId])
  useEffect(() => {
    if (machine?.status !== "ready") {
      setConnection(null)
      setStatus(null)
      return
    }
    let disposed = false
    let timer: ReturnType<typeof setTimeout>
    const handshake = async () => {
      try {
        const result = await connect({ projectId })
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
  }, [connect, projectId, machine?.machineId, machine?.status])
  const request = useCallback(
    async (path: string, body?: unknown, signal?: AbortSignal) => {
      if (!connection) throw new Error("Build machine is connecting.")
      const response = await fetch(`${connection.baseUrl}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Authorization: `Bearer ${connection.token}`,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
      })
      if (!response.ok)
        throw new Error(`Build machine request failed (${response.status}).`)
      return response
    },
    [connection]
  )
  useEffect(() => {
    if (!connection) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const response = await request("/status", undefined, controller.signal)
        const next = (await response.json()) as Status
        if (!controller.signal.aborted) {
          setStatus(next)
          setError(null)
        }
      } catch (err) {
        if (!controller.signal.aborted) setError(errorMessage(err))
      } finally {
        if (!controller.signal.aborted)
          timer = setTimeout(() => void poll(), 500)
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
      value={{ status, ready: Boolean(connection && status), error, request }}
    >
      {children}
    </Context>
  )
}
