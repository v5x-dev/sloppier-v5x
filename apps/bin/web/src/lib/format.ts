import { ConvexError } from "convex/values"

// Server-side rules arrive as ConvexError messages meant for people.
export function errorMessage(error: unknown) {
  if (error instanceof ConvexError && typeof error.data === "string") {
    return error.data
  }
  return "Something went wrong. Try again."
}

export function formatDate(ms: number) {
  return new Date(ms).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  })
}

// Parses a form field that must be a whole number; blank or invalid gives NaN.
export function parseWhole(value: string) {
  const trimmed = value.trim()
  return trimmed === "" ? Number.NaN : Number(trimmed)
}

export function daysAgo(ms: number) {
  const days = Math.floor((Date.now() - ms) / 86_400_000)
  if (days <= 0) return "today"
  return days === 1 ? "yesterday" : `${days} days ago`
}

export function initials(name: string) {
  return (
    name
      .split(/[\s.]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0))
      .join("")
      .slice(0, 2)
      .toUpperCase() || "?"
  )
}
