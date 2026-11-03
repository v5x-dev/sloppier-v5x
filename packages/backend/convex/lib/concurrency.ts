/**
 * Maps items with at most `limit` calls in flight. A finished call starts the
 * next item immediately, so one slow item does not hold back a whole batch.
 * Results keep the input order. After a failure, no new items start.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (!Number.isInteger(limit) || limit < 1)
    throw new RangeError("Concurrency limit must be a positive integer")
  const results = new Array<R>(items.length)
  let next = 0
  let failed = false
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (!failed && next < items.length) {
        const index = next++
        try {
          results[index] = await fn(items[index], index)
        } catch (error) {
          failed = true
          throw error
        }
      }
    }
  )
  await Promise.all(workers)
  return results
}
