// Which instanced mesh a Part is drawn in. Parts that share a catalog entry and a length
// share one mesh, so 2,000 screws are one draw call.

import type { PartRef } from "./model"

export function groupKey(ref: PartRef): string {
  return ref.lengthMm === undefined
    ? ref.catalogId
    : `${ref.catalogId}@${ref.lengthMm}`
}
