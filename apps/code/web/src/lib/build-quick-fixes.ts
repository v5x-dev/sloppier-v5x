import type { BuildDiagnostic } from "./build-diagnostics"

/** One single-line text change. `expected` is what must be on the line at `column` now. */
export type QuickFix = {
  title: string
  line: number
  /** 1-based, as the compiler reports it. */
  column: number
  expected: string
  replacement: string
}

const identifier = /^[A-Za-z_]\w*$/

/**
 * Fixes that follow from a compiler message alone. Anything that needs the
 * surrounding code to be judged stays out, so a fix never guesses.
 */
export function quickFixesFor(diagnostic: BuildDiagnostic): QuickFix[] {
  if (diagnostic.severity !== "error" || !diagnostic.column) return []
  const { line, column, message } = diagnostic
  const suggestion = message.match(/did you mean '([^']+)'\?/)?.[1]
  const unknown = message.match(/'([^']+)'/)?.[1]
  if (
    suggestion &&
    unknown &&
    identifier.test(unknown) &&
    identifier.test(suggestion) &&
    unknown !== suggestion
  ) {
    return [
      {
        title: `Replace '${unknown}' with '${suggestion}'`,
        line,
        column,
        expected: unknown,
        replacement: suggestion,
      },
    ]
  }
  // Clang and GCC report a missing ';' just past the previous token only for these phrasings.
  if (/^expected ';' (after|at end of) /.test(message)) {
    return [
      {
        title: "Insert ';'",
        line,
        column,
        expected: "",
        replacement: ";",
      },
    ]
  }
  return []
}

/** Rechecks the fix against the live text before it becomes an edit. */
export function quickFixEdit(text: string, fix: QuickFix) {
  const line = text.split("\n").at(fix.line - 1)
  const character = fix.column - 1
  if (
    line === undefined ||
    character < 0 ||
    character + fix.expected.length > line.length ||
    line.slice(character, character + fix.expected.length) !== fix.expected
  )
    throw new Error(
      "The code changed since the build. Build again before applying this fix."
    )
  return {
    range: {
      start: { line: fix.line - 1, character },
      end: { line: fix.line - 1, character: character + fix.expected.length },
    },
    newText: fix.replacement,
  }
}

/** Registered by an open editor. Applies the fix to its live document after rechecking it. */
export type QuickFixAction = (fix: QuickFix) => void
