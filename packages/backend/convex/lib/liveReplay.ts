import * as Y from "yjs"

export class LiveReplayError extends Error {
  constructor(readonly reason: "replaced" | "limit" | "stalled") {
    super(`Live document replay failed: ${reason}`)
  }
}

type ReplayPage<DocumentId> = {
  documentId: DocumentId | null
  updates: { sequence: number; bytes: ArrayBuffer }[]
  hasMore: boolean
}

/** A budget can be shared across documents, including failed replays. */
export type ReplayBudget = { used: number; limit: number }

export async function replayLiveDocument<DocumentId>(
  readPage: (afterSequence: number) => Promise<ReplayPage<DocumentId>>,
  budget: ReplayBudget,
  expectedDocumentId?: DocumentId
) {
  const doc = new Y.Doc()
  let documentId: DocumentId | null | undefined = expectedDocumentId
  let afterSequence = 0
  try {
    while (true) {
      const page = await readPage(afterSequence)
      if (documentId !== undefined && page.documentId !== documentId)
        throw new LiveReplayError("replaced")
      documentId = page.documentId
      const previous = afterSequence
      for (const update of page.updates) {
        budget.used += update.bytes.byteLength
        if (budget.used > budget.limit) throw new LiveReplayError("limit")
        Y.applyUpdate(doc, new Uint8Array(update.bytes))
        afterSequence = update.sequence
      }
      if (!page.hasMore) break
      if (afterSequence <= previous) throw new LiveReplayError("stalled")
    }
    return {
      documentId: documentId ?? null,
      contents: doc.getText("source").toString(),
      snapshot: Y.encodeStateAsUpdate(doc).buffer as ArrayBuffer,
    }
  } finally {
    doc.destroy()
  }
}
