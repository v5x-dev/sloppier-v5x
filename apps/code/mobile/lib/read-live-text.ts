import type { useConvex } from "convex/react"
import { randomUUID } from "expo-crypto"
import type { Id } from "@workspace/backend/dataModel"
import { createLiveFileSession } from "@/lib/live-file"

// Reads a file's current live text: the same CRDT document the editor
// syncs, so edits made elsewhere since are included in the commit.
export function readLiveText(
  client: ReturnType<typeof useConvex>,
  programId: Id<"programs">,
  path: string
) {
  return new Promise<string>((resolve, reject) => {
    let settled = false
    const session = createLiveFileSession({
      client,
      programId,
      path,
      createId: randomUUID,
      callbacks: {
        onText: (text) => {
          if (settled) return
          settled = true
          resolve(text)
          setTimeout(() => session.dispose(), 0)
        },
        onSync: () => {},
        onError: (error) => {
          if (settled || !error) return
          settled = true
          reject(new Error(`${path}: ${error}`))
          setTimeout(() => session.dispose(), 0)
        },
      },
    })
  })
}
