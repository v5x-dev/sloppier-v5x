// Runs against an explicitly configured development deployment; never production.
import { spawn, execFileSync } from "node:child_process"
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import { setTimeout as delay } from "node:timers/promises"

const app = resolve(import.meta.dirname, "..")
const backend = resolve(app, "../../../packages/backend")
const backendEnv = readFileSync(resolve(backend, ".env.local"), "utf8")
const deployment = backendEnv.match(/^CONVEX_DEPLOYMENT=(.*)$/m)?.[1]
const convexURL = backendEnv.match(/^CONVEX_URL=(.*)$/m)?.[1]
if (!deployment?.startsWith("dev:") || !convexURL)
  throw new Error("A dedicated development Convex deployment is required")
const cli = (args, options = {}) =>
  execFileSync("bunx", ["convex", ...args], {
    cwd: backend,
    encoding: "utf8",
    ...options,
  })
for (const key of ["CODE_DEMO_ISSUER", "CODE_DEMO_JWKS"]) {
  let value = ""
  try {
    value = cli(["env", "get", key], {
      stdio: ["ignore", "pipe", "ignore"],
    }).trim()
  } catch {
    /* unset */
  }
  if (value)
    throw new Error(
      `${key} is already configured; refusing to replace another session`
    )
}
const emulator = spawn(
  "bunx",
  [
    "workos-emulate",
    "--port",
    "4100",
    "--interactive",
    "--seed",
    "e2e/fixtures/workos-emulate.yaml",
  ],
  { cwd: app, stdio: "inherit" }
)
let configured = false
let result = 1
let interrupted = false
const interrupt = () => {
  interrupted = true
  emulator.kill("SIGTERM")
}
process.on("SIGINT", interrupt)
process.on("SIGTERM", interrupt)
try {
  let ready = false
  for (let i = 0; i < 100 && !interrupted; i++) {
    if (emulator.exitCode !== null)
      throw new Error("WorkOS emulator exited before becoming ready")
    try {
      ready = (await fetch("http://localhost:4100/health")).ok
    } catch {
      /* still starting */
    }
    if (ready) break
    await delay(100)
  }
  if (!ready) throw new Error("WorkOS emulator did not become ready")
  const response = await fetch("http://localhost:4100/sso/jwks/client_test")
  if (!response.ok) throw new Error("Could not read emulator signing keys")
  const jwks = Buffer.from(await response.text()).toString("base64")
  const dir = mkdtempSync(resolve(tmpdir(), "v5x-e2e-"))
  try {
    const file = resolve(dir, "convex.env")
    writeFileSync(
      file,
      `CODE_DEMO_ISSUER=http://localhost:4100/user_management/client_test\nCODE_DEMO_JWKS=${jwks}\n`,
      { mode: 0o600 }
    )
    configured = true
    cli(["env", "set", "--force", "--from-file", file], { stdio: "inherit" })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  const test = spawn(
    "bunx",
    ["playwright", "test", "e2e/workos-emulator.spec.ts"],
    {
      cwd: app,
      stdio: "inherit",
      env: {
        ...process.env,
        PLAYWRIGHT_BASE_URL: "",
        PLAYWRIGHT_WORKOS_EMULATOR: "1",
        VITE_CONVEX_URL: convexURL,
        VITE_WORKOS_CLIENT_ID: "client_test",
        VITE_WORKOS_EMULATOR_URL: "http://localhost:4100",
        VITE_WORKOS_REDIRECT_URI: "http://127.0.0.1:4173/callback",
      },
    }
  )
  result = await new Promise((resolveResult) => {
    test.on("error", () => resolveResult(1))
    test.on("exit", (code) => resolveResult(code ?? 1))
  })
} finally {
  emulator.kill("SIGTERM")
  if (configured) {
    for (const key of ["CODE_DEMO_ISSUER", "CODE_DEMO_JWKS"]) {
      try {
        cli(["env", "set", key, ""], { stdio: "inherit" })
      } catch {
        result = 1
        console.error(
          `Could not clear ${key}; remove it from the development deployment`
        )
      }
    }
  }
}
process.exitCode = result
