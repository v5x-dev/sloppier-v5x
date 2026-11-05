import { test } from "node:test"
import assert from "node:assert/strict"
import {
  findTestHygieneViolations,
  isTestFile,
  placementError,
} from "../lib/test-hygiene.mjs"

const rules = (source) =>
  findTestHygieneViolations("apps/code/web/tests/case.test.ts", source).map(
    (violation) => violation.rule
  )

test("recognises test and spec files in every script extension", () => {
  assert.ok(isTestFile("apps/code/web/tests/editor.test.ts"))
  assert.ok(isTestFile("apps/code/web/e2e/sign-in.spec.ts"))
  assert.ok(isTestFile("scripts/tests/env.test.mjs"))
  assert.equal(isTestFile("apps/code/web/tests/fake-brain.ts"), false)
})

test("requires test files to sit in a folder a runner collects", () => {
  assert.equal(placementError("apps/code/web/tests/editor.test.ts"), undefined)
  assert.equal(placementError("apps/code/web/e2e/sign-in.spec.ts"), undefined)
  assert.equal(placementError("scripts/tests/env.test.mjs"), undefined)
  assert.ok(placementError("apps/code/web/src/editor.test.ts"))
})

test("rejects committed .only, which silently skips the rest of a run", () => {
  assert.deepEqual(rules('it.only("focused", () => {})'), ["no-only"])
  assert.deepEqual(rules('test.only("focused", () => {})'), ["no-only"])
  assert.deepEqual(rules('describe.only("suite", () => {})'), ["no-only"])
})

test("requires a tracked quarantine for an unconditional skip", () => {
  assert.deepEqual(rules('it.skip("broken", () => {})'), ["unreasoned-skip"])
  assert.deepEqual(
    rules(
      '// quarantine: #1234 the Builder mock races the upload\nit.skip("broken", () => {})'
    ),
    []
  )
})

test("allows conditional skips that name their condition first", () => {
  assert.deepEqual(
    rules(
      'test.skip(\n  process.env.PLAYWRIGHT_WORKOS_EMULATOR !== "1",\n  "Run with the emulator"\n)'
    ),
    []
  )
})

test("rejects a wall-clock wait in a test body", () => {
  assert.deepEqual(
    rules(
      "await new Promise((resolve) => setTimeout(resolve, 30))\nexpect(x).toBe(1)"
    ),
    ["wall-clock-wait"]
  )
  assert.deepEqual(
    rules("const wait = (ms) => new Promise((r) => setTimeout(r, ms))"),
    ["wall-clock-wait"]
  )
  assert.deepEqual(
    rules(
      "const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))\nawait sleep(5)"
    ),
    ["wall-clock-wait", "wall-clock-wait"]
  )
  assert.deepEqual(rules("await page.waitForTimeout(500)"), ["wall-clock-wait"])
})

test("allows timers that a test controls or that simulate work it does not wait on", () => {
  assert.deepEqual(
    rules("setTimeout(() => { status.building = false }, 5)"),
    []
  )
  assert.deepEqual(rules("await vi.waitFor(() => expect(x).toBe(1))"), [])
  assert.deepEqual(rules("await vi.advanceTimersByTimeAsync(100)"), [])
})

test("ignores commented-out code and reports line numbers", () => {
  assert.deepEqual(rules('// it.only("old", () => {})'), [])
  assert.deepEqual(
    findTestHygieneViolations(
      "apps/code/web/tests/case.test.ts",
      'it("a", () => {})\n\nit.only("b", () => {})'
    ),
    [
      {
        line: 3,
        rule: "no-only",
        message:
          "Remove .only before committing. It silently skips every other test in the run.",
      },
    ]
  )
})
