import * as Y from "yjs"

export function visibleHistoryPath(path: string) {
  return !path.startsWith(".v5x/")
}
export function restoreUpdate(updates: ArrayBuffer[], contents: string) {
  const doc = new Y.Doc()
  try {
    for (const bytes of updates) Y.applyUpdate(doc, new Uint8Array(bytes))
    const vector = Y.encodeStateVector(doc)
    const text = doc.getText("source")
    doc.transact(() => {
      text.delete(0, text.length)
      text.insert(0, contents)
    })
    return Y.encodeStateAsUpdate(doc, vector).buffer as ArrayBuffer
  } finally {
    doc.destroy()
  }
}
