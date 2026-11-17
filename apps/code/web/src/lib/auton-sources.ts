import { mapWithConcurrency } from "@v5x/backend/concurrency"

export type AutonSourceRead = {
  bytes: ArrayBuffer
  contentRange?: string | null
}

// Each read is a separate server round trip, so overlap a few instead of paying for them one by one.
const READ_CONCURRENCY = 6

/** Reads and decodes the source files for the auton preview, keeping path order. */
export async function readAutonSources(
  paths: readonly string[],
  read: (path: string) => Promise<AutonSourceRead>
): Promise<Map<string, string>> {
  const decoded = await mapWithConcurrency(
    paths,
    READ_CONCURRENCY,
    async (path) => {
      const { bytes, contentRange } = await read(path)
      const total = Number(contentRange?.split("/").at(-1))
      if (total > bytes.byteLength)
        throw new Error(`${path} is too large to preview completely.`)
      return [
        path,
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      ] as const
    }
  )
  return new Map(decoded)
}
