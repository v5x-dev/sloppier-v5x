export type BuildDiagnostic = {
  path: string
  line: number
  column?: number
  severity: "error" | "warning" | "note"
  message: string
}
export type DiagnosticTarget = {
  line: number
  column?: number
  request: number
}

/** Clang/GCC locations, including ANSI-colored output and paths containing colons. */
export function parseBuildDiagnostics(logs: string): BuildDiagnostic[] {
  // Compiler color escapes are control characters by definition.
  // eslint-disable-next-line no-control-regex
  const clean = logs.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
  const diagnostics: BuildDiagnostic[] = []
  const seen = new Set<string>()
  for (const text of clean.split(/\r?\n/)) {
    const match = text.match(
      /^(.+?):(\d+)(?::(\d+))?:\s*(fatal error|error|warning|note):\s*(.+)$/
    )
    if (!match) continue
    const [, path, line, column, severity, message] = match
    if (Number(line) < 1 || (column && Number(column) < 1)) continue
    const diagnostic: BuildDiagnostic = {
      path: path
        .trim()
        .replaceAll("\\", "/")
        .replace(/^(\.\/)+/, ""),
      line: Number(line),
      ...(column ? { column: Number(column) } : {}),
      severity:
        severity === "fatal error"
          ? "error"
          : (severity as BuildDiagnostic["severity"]),
      message,
    }
    const key = JSON.stringify(diagnostic)
    if (!seen.has(key)) {
      seen.add(key)
      diagnostics.push(diagnostic)
    }
  }
  return diagnostics
}

/** Only navigate to known repository paths; never guess a basename or an SDK path. */
export function resolveDiagnosticPath(
  path: string,
  paths: readonly string[]
): string | undefined {
  if (paths.includes(path)) return path
  const sourceRoot = "/home/builder/workspace/source/"
  if (path.startsWith(sourceRoot)) {
    const relative = path.slice(sourceRoot.length)
    return paths.includes(relative) ? relative : undefined
  }
  return undefined
}

export function diagnosticRevision(logs: string): string | undefined {
  return logs.match(/^Building commit (\S+)\r?\n/)?.[1]
}
export function diagnosticsAreStale(
  logs: string,
  currentSha: string | undefined,
  dirty: boolean
) {
  const revision = diagnosticRevision(logs)
  return dirty || Boolean(revision && currentSha && revision !== currentSha)
}
