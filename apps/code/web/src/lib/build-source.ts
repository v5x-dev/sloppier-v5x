/** Source files for one build, keyed by repository path. */
export type SourceFiles = Record<string, Uint8Array>

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export const encodeSourceText = (text: string) => encoder.encode(text)
export const decodeSourceText = (bytes: Uint8Array) => decoder.decode(bytes)

function compareUtf8(a: string, b: string) {
  const left = encoder.encode(a)
  const right = encoder.encode(b)
  const length = Math.min(left.length, right.length)
  for (let index = 0; index < length; index++) {
    if (left[index] !== right[index]) return left[index] - right[index]
  }
  return left.length - right.length
}

/**
 * Identity of a source snapshot: SHA-256 over sorted (UTF-8 path, NUL, SHA-256 of contents).
 * The Builder computes the same value for the files it extracts (`source_hash` in
 * infra/build/v5x-server). A speculative build is claimed only when both hashes agree.
 */
export async function sourceHash(files: SourceFiles): Promise<string> {
  const parts: Uint8Array[] = []
  for (const name of Object.keys(files).sort(compareUtf8)) {
    const digest = new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        files[name] as Uint8Array<ArrayBuffer>
      )
    )
    parts.push(encoder.encode(name), new Uint8Array([0]), digest)
  }
  const length = parts.reduce((total, part) => total + part.length, 0)
  const joined = new Uint8Array(length)
  let offset = 0
  for (const part of parts) {
    joined.set(part, offset)
    offset += part.length
  }
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", joined))
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(
    ""
  )
}
