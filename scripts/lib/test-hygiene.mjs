import ts from "typescript"

/**
 * Rules for test files, applied to the syntax tree so that strings and comments that
 * describe a forbidden call are not mistaken for one. AGENTS.md (Testing) states the
 * same rules in prose; change both together.
 */

const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/

/** Folders the workspace test runners collect from (vitest, playwright, node --test). */
const RUNNER_FOLDERS = new Set(["tests", "e2e", "benchmarks"])

const TEST_CALLERS = new Set(["it", "test", "describe", "suite"])

export function isTestFile(path) {
  return TEST_FILE.test(path.replaceAll("\\", "/"))
}

export function placementError(path) {
  const folders = path.replaceAll("\\", "/").split("/").slice(0, -1)
  if (!folders.some((folder) => RUNNER_FOLDERS.has(folder)))
    return "Test files must live in a tests/, e2e/, or benchmarks/ folder, where the workspace runner collects them."
}

const MESSAGES = {
  "no-only":
    "Remove .only before committing. It silently skips every other test in the run.",
  "unreasoned-skip":
    "An unconditional skip needs `// quarantine: #<issue> <reason>` on the line above.",
  "wall-clock-wait":
    "Tests must not wait on wall-clock time. Await the promise, event, or state that marks the milestone.",
}

const QUARANTINE = /quarantine:\s*#\d+/

/** Returns { line, rule, message } for each rule the test source breaks, in line order. */
export function findTestHygieneViolations(path, source) {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true)
  const lines = source.split("\n")
  const violations = []

  const report = (node, rule) => {
    const index = file.getLineAndCharacterOfPosition(node.getStart(file)).line
    // index is zero-based, so lines[index - 1] is the line above the node.
    const previous = lines[index - 1] ?? ""
    if (rule === "unreasoned-skip" && QUARANTINE.test(previous)) return
    violations.push({ line: index + 1, rule, message: MESSAGES[rule] })
  }

  const visit = (node) => {
    if (ts.isCallExpression(node)) checkCall(node)
    if (ts.isNewExpression(node)) checkPromise(node)
    ts.forEachChild(node, visit)
  }

  function checkCall(call) {
    const callee = call.expression
    if (ts.isPropertyAccessExpression(callee)) {
      const owner = callee.expression
      const method = callee.name.text
      if (ts.isIdentifier(owner) && TEST_CALLERS.has(owner.text)) {
        if (method === "only") report(call, "no-only")
        // A skip whose first argument is a string is unconditional. Conditional skips
        // name their condition first: test.skip(process.env.X !== "1", "reason").
        if (method === "skip" && isStringLiteral(call.arguments[0]))
          report(call, "unreasoned-skip")
      }
      if (method === "waitForTimeout") report(call, "wall-clock-wait")
    } else if (ts.isIdentifier(callee) && callee.text === "sleep") {
      report(call, "wall-clock-wait")
    }
  }

  // A promise that settles on a timer is a wall-clock wait, whatever its helper is named.
  function checkPromise(node) {
    const isPromise =
      ts.isIdentifier(node.expression) && node.expression.text === "Promise"
    const executor = node.arguments?.[0]
    if (!isPromise || !executor) return
    if (!ts.isArrowFunction(executor) && !ts.isFunctionExpression(executor))
      return
    if (containsCallTo(executor.body, "setTimeout"))
      report(node, "wall-clock-wait")
  }

  visit(file)
  return violations.sort((a, b) => a.line - b.line)
}

function isStringLiteral(node) {
  return (
    node !== undefined &&
    (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
  )
}

function containsCallTo(node, name) {
  let found = false
  const visit = (child) => {
    if (found) return
    if (
      ts.isCallExpression(child) &&
      ts.isIdentifier(child.expression) &&
      child.expression.text === name
    ) {
      found = true
      return
    }
    ts.forEachChild(child, visit)
  }
  visit(node)
  return found
}
