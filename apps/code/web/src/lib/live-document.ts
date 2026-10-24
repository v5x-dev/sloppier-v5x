import * as Y from "yjs"

export const REMOTE = "remote"
export const MAX_SOURCE_BYTES = 256 * 1024

export function source(doc: Y.Doc) {
  return doc.getText("source")
}

export function hasChanges(doc: Y.Doc, server: Y.Doc) {
  const local = Y.decodeUpdate(pendingUpdate(doc, server))
  if (local.structs.length) return true
  // State vectors track inserts, not deletions. Yjs includes the complete
  // delete set even in an otherwise empty diff, so compare acknowledged ranges.
  const acknowledged = Y.decodeUpdate(Y.encodeStateAsUpdate(server)).ds.clients
  for (const [client, ranges] of local.ds.clients) {
    const known = acknowledged.get(client) ?? []
    for (const range of ranges) {
      if (
        !known.some(
          (item) =>
            item.clock <= range.clock &&
            item.clock + item.len >= range.clock + range.len
        )
      )
        return true
    }
  }
  return false
}

// A separate server document includes only acknowledged updates. A retry uses
// the same ID and bytes; later keystrokes stay in the local document meanwhile.
export function pendingUpdate(doc: Y.Doc, server: Y.Doc) {
  return Y.encodeStateAsUpdate(doc, Y.encodeStateVector(server))
}

export function applyRemote(doc: Y.Doc, server: Y.Doc, bytes: ArrayBuffer) {
  const update = new Uint8Array(bytes)
  Y.applyUpdate(server, update, REMOTE)
  Y.applyUpdate(doc, update, REMOTE)
}
