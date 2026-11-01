// A fresh local Convex database per run. Cloud credentials are only read to
// obtain test Code Storage credentials; no cloud functions or auth settings change.
import { execFileSync, spawn } from "node:child_process"
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { createRequire } from "node:module"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { resolve, dirname } from "node:path"
import { pathToFileURL } from "node:url"
import { setTimeout as delay } from "node:timers/promises"

export const app = resolve(import.meta.dirname, "..")
const backend = resolve(app, "../../../packages/backend")

export function readEnv(text) {
  return Object.fromEntries(
    text.split(/\r?\n/).flatMap((line) => {
      const match = line.match(/^([A-Z_][A-Z_0-9]*)=(.*)$/)
      if (!match) return []
      let value = match[2].trim()
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1).replaceAll("\\n", "\n")
      }
      return [[match[1], value]]
    })
  )
}

export async function availablePort() {
  const server = createServer()
  await new Promise((yes, no) => {
    server.once("error", no)
    server.listen(0, "127.0.0.1", yes)
  })
  const port = server.address().port
  await new Promise((yes, no) =>
    server.close((error) => (error ? no(error) : yes()))
  )
  return port
}

export async function waitFor(
  url,
  child,
  predicate = (response) => response.ok
) {
  const deadline = Date.now() + 120_000
  let last = "not ready"
  while (Date.now() < deadline) {
    if (child.exitCode !== null)
      throw new Error(
        `Process exited (${child.exitCode}) before ${url} became ready`
      )
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) })
      if (await predicate(response)) return
      last = `HTTP ${response.status}`
    } catch (error) {
      last = error.message
    }
    await delay(100)
  }
  throw new Error(`${url} did not become ready: ${last}`)
}

function storageCredentials() {
  const supplied = process.env.CODE_TEST_STORAGE_ENV
    ? readEnv(readFileSync(process.env.CODE_TEST_STORAGE_ENV, "utf8"))
    : process.env
  if (supplied.PIERRE_ORG && supplied.PIERRE_PRIVATE_KEY)
    return {
      PIERRE_ORG: supplied.PIERRE_ORG,
      PIERRE_PRIVATE_KEY: supplied.PIERRE_PRIVATE_KEY,
    }
  const selection = existsSync(resolve(backend, ".env.local"))
    ? readEnv(readFileSync(resolve(backend, ".env.local"), "utf8"))
    : {}
  if (
    process.env.CONVEX_DEPLOY_KEY
      ? !process.env.CONVEX_DEPLOY_KEY.startsWith("dev:")
      : !selection.CONVEX_DEPLOYMENT?.startsWith("dev:")
  )
    throw new Error(
      "Provide CODE_TEST_STORAGE_ENV with test Pierre credentials, or select a development Convex deployment to read them from."
    )
  const credentials = {}
  for (const key of ["PIERRE_ORG", "PIERRE_PRIVATE_KEY"]) {
    try {
      credentials[key] = execFileSync("bunx", ["convex", "env", "get", key], {
        cwd: backend,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 30_000,
      }).trim()
    } catch {
      throw new Error(
        `Could not read ${key} from the selected development deployment. Provide CODE_TEST_STORAGE_ENV instead.`
      )
    }
    if (!credentials[key])
      throw new Error(`${key} is empty on the test storage source.`)
  }
  return credentials
}

export async function createLocalFixture({ builderURL } = {}) {
  const credentials = storageCredentials()
  const major = Number(
    execFileSync(process.env.CODE_TEST_NODE ?? "node", ["--version"], {
      encoding: "utf8",
    }).match(/^v(\d+)/)?.[1]
  )
  if (![22, 24].includes(major))
    throw new Error(
      "Local Convex Node actions require Node 22 or 24. Run with that Node on PATH or set CODE_TEST_NODE to its executable."
    )
  const dir = mkdtempSync(resolve(tmpdir(), "v5x-code-test-"))
  const children = []
  let stopped = false
  let stopping
  const env = { ...process.env, CONVEX_AGENT_MODE: "anonymous" }
  for (const key of [
    "CONVEX_DEPLOYMENT",
    "CONVEX_DEPLOY_KEY",
    "CONVEX_URL",
    "CONVEX_SITE_URL",
    "CONVEX_SELF_HOSTED_URL",
    "CONVEX_SELF_HOSTED_ADMIN_KEY",
  ])
    delete env[key]
  if (process.env.CODE_TEST_NODE)
    env.PATH = `${dirname(resolve(process.env.CODE_TEST_NODE))}:${env.PATH}`
  function start(command, args, options = {}) {
    if (stopped) throw new Error("Fixture has been stopped")
    const child = spawn(command, args, {
      cwd: app,
      env,
      stdio: "inherit",
      detached: process.platform !== "win32",
      ...options,
    })
    children.push(child)
    child.once("error", (error) =>
      console.error(`Could not start ${command}: ${error.message}`)
    )
    return child
  }
  const cli = (args) =>
    execFileSync("bunx", ["convex", ...args], {
      cwd: dir,
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 60_000,
    })
  const stopChild = async (child) => {
    if (!child || child.exitCode !== null) return
    try {
      process.platform === "win32"
        ? child.kill("SIGTERM")
        : process.kill(-child.pid, "SIGTERM")
    } catch {
      return
    }
    await Promise.race([
      new Promise((yes) => child.once("exit", yes)),
      delay(3000),
    ])
    if (child.exitCode === null) {
      try {
        process.platform === "win32"
          ? child.kill("SIGKILL")
          : process.kill(-child.pid, "SIGKILL")
      } catch {
        /* already stopped */
      }
    }
  }
  const onSignal = () => {
    void stop().catch((error) => {
      console.error(error.message)
      process.exitCode = 1
    })
  }
  const stop = () => {
    if (stopping) return stopping
    stopped = true
    stopping = cleanup()
    return stopping
  }
  async function cleanup() {
    process.removeListener("SIGINT", onSignal)
    process.removeListener("SIGTERM", onSignal)
    // Stop callers before deleting their storage; keep the backend for listing
    // the exact repositories created in this disposable database.
    for (const child of children.slice(1).reverse()) await stopChild(child)
    let failed = false
    try {
      // Only repositories named by this run's disposable database are eligible.
      const rows = cli([
        "data",
        "programs",
        "--format",
        "json",
        "--limit",
        "10000",
      ]).trim()
      const programs = rows ? JSON.parse(rows) : []
      writeFileSync(
        resolve(dir, "repositories.json"),
        JSON.stringify(
          programs.map(({ _id, repositoryId }) => ({
            programId: _id,
            repositoryId,
          })),
          null,
          2
        ),
        { mode: 0o600 }
      )
      const require = createRequire(resolve(backend, "package.json"))
      const { GitStorage } = await import(
        pathToFileURL(require.resolve("@pierre/storage")).href
      )
      const storage = new GitStorage({
        name: credentials.PIERRE_ORG,
        key: credentials.PIERRE_PRIVATE_KEY,
      })
      for (const program of programs) {
        if (program.repositoryId !== `programs/${program._id}`) continue
        const repo = await storage.findOne({ id: program.repositoryId })
        if (repo) await storage.deleteRepo({ id: program.repositoryId })
      }
    } catch (error) {
      // A backend that never became ready has no repositories to clean up.
      if (existsSync(resolve(dir, ".env.local"))) {
        failed = true
        console.error(
          `Fixture repository cleanup failed; retain ${dir} for recovery: ${error.message}`
        )
      }
    }
    await stopChild(children[0])
    if (!failed) rmSync(dir, { recursive: true, force: true })
    else throw new Error(`Fixture cleanup requires recovery in ${dir}`)
  }
  process.once("SIGINT", onSignal)
  process.once("SIGTERM", onSignal)
  try {
    cpSync(resolve(backend, "convex"), resolve(dir, "convex"), {
      recursive: true,
    })
    if (builderURL) {
      if (new URL(builderURL).hostname !== "127.0.0.1")
        throw new Error("Fixture Builder must be loopback-only")
      for (const file of ["buildWorker.ts", "buildConnection.ts"]) {
        const path = resolve(dir, "convex", file)
        const source = readFileSync(path, "utf8")
        if (!source.includes("https://api.smolmachines.com/v1"))
          throw new Error(
            `Builder boundary changed in ${file}; update the fixture adapter`
          )
        writeFileSync(
          path,
          source.replaceAll(
            "https://api.smolmachines.com/v1",
            `${builderURL}/v1`
          )
        )
      }
    }
    for (const file of ["package.json", "convex.json"])
      cpSync(resolve(backend, file), resolve(dir, file))
    writeFileSync(
      resolve(dir, "tsconfig.json"),
      '{"compilerOptions":{"target":"ES2022","moduleResolution":"bundler","module":"ESNext","strict":true,"skipLibCheck":true}}\n'
    )
    symlinkSync(
      resolve(backend, "node_modules"),
      resolve(dir, "node_modules"),
      "dir"
    )
    const port = await availablePort(),
      sitePort = await availablePort()
    const child = start(
      "bunx",
      [
        "convex",
        "dev",
        "--typecheck",
        "disable",
        "--codegen",
        "disable",
        "--tail-logs",
        "disable",
        "--local-cloud-port",
        String(port),
        "--local-site-port",
        String(sitePort),
      ],
      { cwd: dir, stdio: ["ignore", "pipe", "pipe"] }
    )
    let logs = "",
      ready = false
    for (const stream of [child.stdout, child.stderr])
      stream.on("data", (chunk) => {
        logs = (logs + chunk.toString()).slice(-16_000)
        if (logs.includes("Convex functions ready")) ready = true
      })
    await waitFor(`http://127.0.0.1:${port}/version`, child)
    const envFile = resolve(dir, "storage.env")
    const initial = {
      ...credentials,
      ...(builderURL
        ? {
            SMOL_CLOUD_TOKEN: "fixture-token",
            SMOL_BUILD_IMAGE: "fixture-image",
            SMOL_BUILD_CHECKPOINT: "",
          }
        : {}),
      WORKOS_CLIENT_ID: "",
      CODE_DEMO_ISSUER: "",
      CODE_DEMO_JWKS: "",
    }
    writeFileSync(
      envFile,
      Object.entries(initial)
        .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
        .join("\n"),
      { mode: 0o600 }
    )
    cli(["env", "set", "--force", "--from-file", envFile])
    const deadline = Date.now() + 120_000
    while (!ready && Date.now() < deadline && child.exitCode === null)
      await delay(100)
    if (!ready)
      throw new Error(`Local Convex did not deploy functions:\n${logs}`)
    console.log(
      `Isolated Convex ready at http://127.0.0.1:${port} (temporary database)`
    )
    return {
      dir,
      cli,
      start,
      stop,
      convexURL: `http://127.0.0.1:${port}`,
      siteURL: `http://127.0.0.1:${sitePort}`,
    }
  } catch (error) {
    await stop().catch(() => {})
    throw error
  }
}
