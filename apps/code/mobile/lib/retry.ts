// Convex rejects actions that were in flight when its WebSocket dropped, as
// happens whenever iOS suspends the app. Those are safe to retry once the
// client reconnects; anything else is surfaced as-is.
export function isConnectionLost(error: unknown) {
  return (
    error instanceof Error &&
    /Connection lost while action was in flight/i.test(error.message)
  )
}

export async function retryOnReconnect<T>(
  run: () => Promise<T>,
  { attempts = 5, delayMs = 500 }: { attempts?: number; delayMs?: number } = {}
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await run()
    } catch (error) {
      if (attempt >= attempts || !isConnectionLost(error)) throw error
      await new Promise((resolve) =>
        setTimeout(resolve, delayMs * 2 ** (attempt - 1))
      )
    }
  }
}
