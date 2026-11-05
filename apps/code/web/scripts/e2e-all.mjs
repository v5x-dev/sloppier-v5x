// One command for the isolated browser suites. It installs Chromium when it is missing,
// then runs the WorkOS sign-in suite and the editor suites. Node 22/24 and the Pierre
// storage credentials are resolved by local-fixture.mjs, which also prints the source it used.
import { execFileSync, spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { chromium } from "@playwright/test"

if (!existsSync(chromium.executablePath())) {
  console.error("Installing Chromium for the browser tests...")
  execFileSync("bunx", ["playwright", "install", "chromium"], {
    stdio: "inherit",
  })
}

for (const script of ["test:e2e:workos", "test:e2e:editor"]) {
  const run = spawnSync("bun", ["run", script], { stdio: "inherit" })
  if (run.status !== 0) process.exit(run.status ?? 1)
}
