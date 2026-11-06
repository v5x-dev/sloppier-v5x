import { useSyncExternalStore } from "react"
import { keyStore } from "@/design/key-store"
import type { Bindings } from "@/design/keys"

/** The editor's current shortcuts. Re-renders when someone changes one. */
export function useKeyBindings(): Bindings {
  return useSyncExternalStore(keyStore.subscribe, keyStore.get, keyStore.get)
}
