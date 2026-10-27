import { getRandomValues as getSecureRandomValues } from "expo-crypto"

// Stands in for lib0/webcrypto on native (see metro.config.js). Yjs only needs
// random values; lib0 AES-GCM helpers, which need subtle, are not used here.
type RandomArray = Parameters<typeof getSecureRandomValues>[0]

export function getRandomValues<T extends RandomArray>(array: T): T {
  return getSecureRandomValues(array)
}
