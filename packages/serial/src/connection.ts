import {
  decodeReply,
  NackError,
  ReplyFramer,
  type Command,
  type Reply,
} from "./protocol"

export type ConnectionType = "wired" | "controller" | "bluetooth"
export class TimeoutError extends Error {
  override name = "TimeoutError"
  constructor() {
    super("Timed out waiting for a device reply")
  }
}
export class DisconnectedError extends Error {
  override name = "DisconnectedError"
  constructor() {
    super("Device disconnected")
  }
}

/** Transports deliver system bytes to the connection and user bytes separately. */
export interface Transport {
  readonly type: ConnectionType
  start(
    system: (data: Uint8Array) => void,
    user: (data: Uint8Array) => void,
    disconnected: (error: Error) => void
  ): Promise<void>
  writeSystem(data: Uint8Array): Promise<void>
  writeUser?(data: Uint8Array): Promise<void>
  close(): Promise<void>
}
export interface RequestOptions {
  timeout?: number
  retries?: number
}
type Pending = {
  cmd: number
  ecmd?: number
  resolve: (reply: Reply) => void
  reject: (error: Error) => void
}

export class Connection {
  readonly type: ConnectionType
  private readonly framer = new ReplyFramer()
  private pending?: Pending
  private failure?: Error
  private closing?: Promise<void>
  private queue: Promise<unknown> = Promise.resolve()
  private readonly disconnectListeners = new Set<(error: Error) => void>()
  private readonly userListeners = new Set<(data: Uint8Array) => void>()
  private constructor(readonly transport: Transport) {
    this.type = transport.type
  }
  static async open(transport: Transport): Promise<Connection> {
    const connection = new Connection(transport)
    try {
      await transport.start(
        (data) => connection.receive(data),
        (data) => {
          for (const listener of connection.userListeners) listener(data)
        },
        (error) => connection.fail(error)
      )
      return connection
    } catch (error) {
      await transport.close().catch(() => {})
      throw error
    }
  }
  private fail(error: Error) {
    if (this.failure) return
    this.failure = error
    for (const listener of this.disconnectListeners) listener(error)
    this.disconnectListeners.clear()
    this.pending?.reject(error)
    this.pending = undefined
  }
  private receive(data: Uint8Array) {
    for (const frame of this.framer.push(data)) {
      let reply: Reply
      try {
        reply = decodeReply(frame)
      } catch (error) {
        this.pending?.reject(
          error instanceof Error ? error : new Error(String(error))
        )
        this.pending = undefined
        continue
      }
      const pending = this.pending
      if (pending && reply.cmd === pending.cmd && reply.ecmd === pending.ecmd) {
        this.pending = undefined
        if (reply.ack !== undefined && reply.ack !== 0x76)
          pending.reject(new NackError(reply.ack))
        else pending.resolve(reply)
      }
    }
  }
  /** Serializes handshakes because the wire protocol has no request IDs. */
  request<T>(command: Command<T>, options: RequestOptions = {}): Promise<T> {
    const timeout = options.timeout ?? 500
    const retries = options.retries ?? 5
    if (
      !Number.isFinite(timeout) ||
      timeout <= 0 ||
      !Number.isInteger(retries) ||
      retries < 0
    )
      return Promise.reject(new RangeError("Invalid timeout or retry count"))
    return this.exclusive(async () => {
      for (let attempt = 0; ; attempt++) {
        if (this.failure) throw this.failure
        let timer: ReturnType<typeof setTimeout> | undefined
        const response = new Promise<Reply>((resolve, reject) => {
          this.pending = {
            cmd: command.cmd,
            ecmd: command.ecmd,
            resolve,
            reject,
          }
          timer = setTimeout(() => reject(new TimeoutError()), timeout)
        })
        // Attach the rejection handler before a write can fail or time out.
        const settled = response.then(
          (reply) => ({ reply }),
          (error) => ({ error })
        )
        try {
          await this.transport.writeSystem(command.bytes)
          const result = await settled
          if ("error" in result) throw result.error
          return command.decode(result.reply.payload)
        } catch (error) {
          if (!(error instanceof TimeoutError) || attempt >= retries)
            throw error
        } finally {
          clearTimeout(timer)
          this.pending = undefined
        }
      }
    })
  }
  /** Used for BLE file chunks, whose writes are not acknowledged by VEXos. */
  send(command: Command<unknown>): Promise<void> {
    return this.exclusive(async () => {
      if (this.failure) throw this.failure
      await this.transport.writeSystem(command.bytes)
    })
  }
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.queue.then(fn)
    this.queue = result.catch(() => {})
    return result
  }
  onDisconnect(listener: (error: Error) => void): () => void {
    if (this.failure) listener(this.failure)
    else this.disconnectListeners.add(listener)
    return () => {
      this.disconnectListeners.delete(listener)
    }
  }
  onUserData(listener: (data: Uint8Array) => void): () => void {
    this.userListeners.add(listener)
    return () => {
      this.userListeners.delete(listener)
    }
  }
  async writeUser(data: Uint8Array): Promise<void> {
    if (this.failure) throw this.failure
    if (!this.transport.writeUser)
      throw new Error(
        "Use writeUser() from commands for a connection without a separate user port"
      )
    await this.transport.writeUser(data)
  }
  close(): Promise<void> {
    this.closing ??= Promise.resolve().then(async () => {
      this.fail(new DisconnectedError())
      this.userListeners.clear()
      await this.transport.close()
    })
    return this.closing
  }
}
