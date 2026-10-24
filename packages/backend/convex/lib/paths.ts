import { ConvexError } from "convex/values"

export function validateRepositoryPath(input: string, allowInternal = false) {
  const path = input.trim()
  const parts = path.split("/")

  if (
    path.length === 0 ||
    path.length > 1024 ||
    path.startsWith("/") ||
    path.includes("\\") ||
    parts.some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new ConvexError("File path must be a normalized relative path.")
  }

  if (!allowInternal && parts[0] === ".v5x") {
    throw new ConvexError("The .v5x directory is reserved for CRDT data.")
  }

  return path
}
