import { ConvexError } from "convex/values"

export function errorMessage(error: unknown) {
  if (error instanceof ConvexError) {
    return String(error.data)
  }
  return error instanceof Error ? error.message : "Something went wrong."
}
