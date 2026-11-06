import type * as Y from "yjs"

export {
  REMOTE,
  applyRemote,
  hasChanges,
  pendingUpdate,
} from "@v5x/backend/liveUpdates"

export const MAX_SOURCE_BYTES = 256 * 1024

export function source(doc: Y.Doc) {
  return doc.getText("source")
}
