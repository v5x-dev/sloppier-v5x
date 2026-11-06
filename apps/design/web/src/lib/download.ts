// Saves text as a file the person chooses to keep: a CSV, a Design file, and so on.

/** A name safe to use as a file name, from a Design's name or anything else typed. */
export function safeFileName(name: string, fallback = "design"): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_-]+/g, "-")
    .toLowerCase()
    .slice(0, 80)
  return slug === "" ? fallback : slug
}

/** Starts a download of `text`. Throws if the browser cannot make one. */
export function downloadText(
  filename: string,
  text: string,
  type: string
): void {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  // Revoke after the browser has begun the download.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
