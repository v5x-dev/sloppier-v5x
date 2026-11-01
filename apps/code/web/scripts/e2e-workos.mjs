// Exercises the real app against isolated local Convex and WorkOS processes.
import { writeFileSync } from "node:fs"
import { basename, resolve } from "node:path"
import {
  app,
  availablePort,
  createLocalFixture,
  waitFor,
} from "./local-fixture.mjs"

const fixture = await createLocalFixture()
let test
const interrupt = () => test?.kill("SIGTERM")
process.once("SIGINT", interrupt)
process.once("SIGTERM", interrupt)
try {
  const emulatorPort = await availablePort(),
    webPort = await availablePort()
  const emulatorURL = `http://localhost:${emulatorPort}`
  const webURL = `http://127.0.0.1:${webPort}`
  const emulator = fixture.start("bunx", [
    "workos-emulate",
    "--port",
    String(emulatorPort),
    "--interactive",
    "--seed",
    "e2e/fixtures/workos-emulate.yaml",
  ])
  await waitFor(`${emulatorURL}/health`, emulator)
  const response = await fetch(`${emulatorURL}/sso/jwks/client_test`)
  if (!response.ok) throw new Error("Could not read emulator signing keys")
  const file = resolve(fixture.dir, "auth.env")
  writeFileSync(
    file,
    `CODE_DEMO_ISSUER=${emulatorURL}/user_management/client_test\nCODE_DEMO_JWKS=${Buffer.from(await response.text()).toString("base64")}\n`,
    { mode: 0o600 }
  )
  fixture.cli(["env", "set", "--force", "--from-file", file])
  const web = fixture.start(
    "bunx",
    [
      "vite",
      "dev",
      "--host",
      "127.0.0.1",
      "--port",
      String(webPort),
      "--strictPort",
    ],
    {
      cwd: app,
      env: {
        ...process.env,
        VITE_CODE_DEMO_ACCOUNTS: "",
        CODE_TEST_CACHE_DIR: resolve(fixture.dir, "vite-cache"),
        VITE_CONVEX_URL: fixture.convexURL,
        VITE_WORKOS_CLIENT_ID: "client_test",
        VITE_WORKOS_EMULATOR_URL: emulatorURL,
        VITE_WORKOS_REDIRECT_URI: `${webURL}/callback`,
      },
    }
  )
  await waitFor(webURL, web)
  test = fixture.start(
    "bunx",
    [
      "playwright",
      "test",
      "e2e/workos-emulator.spec.ts",
      "--output",
      resolve(app, "test-results", basename(fixture.dir), "workos"),
    ],
    {
      env: {
        ...process.env,
        PLAYWRIGHT_BASE_URL: webURL,
        PLAYWRIGHT_WORKOS_EMULATOR: "1",
        PLAYWRIGHT_WORKOS_EDITOR: "1",
      },
    }
  )
  process.exitCode = await new Promise((yes) => {
    test.once("error", () => yes(1))
    test.once("exit", (code) => yes(code ?? 1))
  })
} finally {
  await fixture.stop()
}
