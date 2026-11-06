import { ConvexError } from "convex/values"
import * as Y from "yjs"
import {
  REMOTE,
  applyRemote,
  hasChanges,
  pendingUpdate,
} from "@v5x/backend/liveUpdates"
import { errorMessage } from "@v5x/backend/errors"

export type SyncStatus =
  | { kind: "loading" }
  | { kind: "saved" }
  | { kind: "saving" }
  | { kind: "error"; message: string }

type Append = (updateId: string, bytes: ArrayBuffer) => Promise<unknown>

const FLUSH_DELAY_MS = 150
const MAX_RETRY_DELAY_MS = 30_000

/**
 * Keeps a Design's local document and the server in step. `doc` holds every
 * edit; `server` holds only what the backend has acknowledged, so the difference
 * is what still needs sending, even after a reload or a long time offline.
 */
export class DesignSync {
  readonly doc = new Y.Doc()
  private readonly server = new Y.Doc()
  private status: SyncStatus = { kind: "loading" }
  private readonly listeners = new Set<() => void>()
  private localReady = false
  private replayed = false
  private sending = false
  private retries = 0
  private timer: ReturnType<typeof setTimeout> | undefined
  // Kept across failures so a retry repeats the same ID and bytes.
  private attempt: { id: string; bytes: ArrayBuffer } | undefined
  private destroyed = false

  constructor(
    private readonly append: Append,
    private readonly newId: () => string = () => crypto.randomUUID()
  ) {
    this.doc.on("update", this.onUpdate)
  }

  private readonly onUpdate = (_update: Uint8Array, origin: unknown) => {
    if (origin !== REMOTE) this.schedule(FLUSH_DELAY_MS)
  }

  /** Call once edits saved on this device have loaded into `doc`. */
  markLocalReady() {
    this.localReady = true
    this.schedule(0)
  }

  /** Call once every update on the server has been applied. */
  markReplayed() {
    this.replayed = true
    this.schedule(0)
  }

  applyRemote(updates: { bytes: ArrayBuffer }[]) {
    this.doc.transact(() => {
      for (const update of updates) {
        applyRemote(this.doc, this.server, update.bytes)
      }
    }, REMOTE)
  }

  getStatus = () => this.status

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  destroy() {
    this.destroyed = true
    clearTimeout(this.timer)
    this.doc.off("update", this.onUpdate)
    this.doc.destroy()
    this.server.destroy()
    this.listeners.clear()
  }

  private isDestroyed() {
    return this.destroyed
  }

  private setStatus(status: SyncStatus) {
    this.status = status
    for (const listener of this.listeners) listener()
  }

  private schedule(delay: number) {
    clearTimeout(this.timer)
    // Before the replay ends, everything looks unsent, so sending would repeat
    // the whole Design. Edits simply wait in `doc`.
    if (!this.localReady || !this.replayed) return
    if (hasChanges(this.doc, this.server) || this.attempt) {
      if (this.status.kind !== "error") this.setStatus({ kind: "saving" })
      this.timer = setTimeout(() => void this.flush(), delay)
    } else if (!this.sending) {
      this.setStatus({ kind: "saved" })
    }
  }

  private async flush() {
    if (this.sending || this.destroyed) return
    this.attempt ??= {
      id: this.newId(),
      bytes: pendingUpdate(this.doc, this.server).slice().buffer,
    }
    const { id, bytes } = this.attempt
    this.sending = true
    this.setStatus({ kind: "saving" })
    try {
      await this.append(id, bytes)
    } catch (error) {
      this.sending = false
      if (this.isDestroyed()) return
      // The backend refused these bytes, so repeating them would fail the same
      // way. A later edit builds a new update that includes them.
      if (error instanceof ConvexError) {
        this.attempt = undefined
        this.setStatus({ kind: "error", message: errorMessage(error) })
        return
      }
      this.retries += 1
      this.setStatus({ kind: "saving" })
      this.timer = setTimeout(
        () => void this.flush(),
        Math.min(1000 * 2 ** (this.retries - 1), MAX_RETRY_DELAY_MS)
      )
      return
    }
    this.sending = false
    if (this.isDestroyed()) return
    this.retries = 0
    this.attempt = undefined
    Y.applyUpdate(this.server, new Uint8Array(bytes), REMOTE)
    this.status = { kind: "saving" }
    this.schedule(0)
  }
}
