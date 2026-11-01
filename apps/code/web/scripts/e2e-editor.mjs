import { execFileSync } from "node:child_process"
import { basename, resolve } from "node:path"
import { startFakeBuilder } from "../e2e/fixtures/fake-builder.mjs"
import { startDemoSession } from "./demo-session.mjs"
const builder = await startFakeBuilder()
let session
try {
  session = await startDemoSession({
    names: ["Alice", "Ben"],
    programName: "Editor integration",
    template: "pros",
    builderURL: builder.url,
  })
  const brainScript = resolve(session.fixture.dir, "fake-brain.js")
  execFileSync(
    "bun",
    [
      "build",
      "e2e/fixtures/fake-brain-browser.ts",
      "--target",
      "browser",
      "--format",
      "iife",
      "--outfile",
      brainScript,
    ],
    { cwd: resolve(import.meta.dirname, ".."), stdio: "inherit" }
  )
  const suites = ["editor", "collaboration", "build-upload"]
  for (const [index, suite] of suites.entries()) {
    // Each capability starts with clean source; interrupted or failed edits in
    // another suite must never change this suite's initial state.
    const programId =
      index === 0
        ? session.programId
        : JSON.parse(
            session.fixture.cli([
              "run",
              "programs:create",
              JSON.stringify({
                workspaceId: session.workspaceId,
                name: `${suite} integration`,
                template: "pros",
              }),
              "--identity",
              JSON.stringify({ subject: session.accounts[0].id }),
            ])
          )
    const child = session.fixture.start(
      "bunx",
      [
        "playwright",
        "test",
        `e2e/${suite}.spec.ts`,
        "--workers=1",
        "--output",
        resolve(
          import.meta.dirname,
          "../test-results",
          basename(session.fixture.dir),
          suite
        ),
      ],
      {
        env: {
          ...process.env,
          PLAYWRIGHT_BUILDER_URL: builder.url,
          PLAYWRIGHT_BRAIN_SCRIPT: brainScript,
          PLAYWRIGHT_BASE_URL: `http://127.0.0.1:${session.port}`,
          PLAYWRIGHT_PROGRAM_ID: programId,
          PLAYWRIGHT_DEMO_USER: session.accounts[0].id,
          PLAYWRIGHT_PEER_USER: session.accounts[1].id,
        },
      }
    )
    const result = await new Promise((yes) => {
      child.once("error", () => yes(1))
      child.once("exit", (code) => yes(code ?? 1))
    })
    if (result) {
      process.exitCode = result
      break
    }
  }
} finally {
  await session?.stop()
  await builder.stop()
}
