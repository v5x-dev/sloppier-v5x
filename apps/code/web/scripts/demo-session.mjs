// Shared setup for local demo accounts on a development Convex deployment.
// Registers an ephemeral public JWT key, creates a program owned by the first
// account, and starts a loopback-only Vite server that accepts those accounts.
import { generateKeyPairSync, sign } from "node:crypto"
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import { execFileSync, spawn } from "node:child_process"
import { setTimeout as delay } from "node:timers/promises"

const root = resolve(import.meta.dirname, "../../../..")
const backend = resolve(root, "packages/backend")

function getDemoEnv(name) {
  try {
    return execFileSync("bunx", ["convex", "env", "get", name], {
      cwd: backend,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim()
  } catch {
    return ""
  }
}

async function availablePort() {
  const server = createServer()
  await new Promise((resolveListen, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolveListen)
  })
  const address = server.address()
  if (!address || typeof address === "string") {
    server.close()
    throw new Error("Could not reserve a local port for the demo server")
  }
  const port = address.port
  await new Promise((resolveClose, reject) =>
    server.close((error) => (error ? reject(error) : resolveClose()))
  )
  return port
}

async function waitForServer(child, port, getChildError) {
  const url = `http://127.0.0.1:${port}/`
  let lastError
  for (let attempt = 0; attempt < 300; attempt++) {
    if (getChildError()) throw getChildError()
    if (child.exitCode !== null) {
      throw new Error(
        `Code web exited before it became ready (exit ${child.exitCode})`
      )
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) })
      if (response.ok) return
      lastError = new Error(`Code web returned HTTP ${response.status}`)
    } catch (error) {
      lastError = error
    }
    await delay(100)
  }
  throw new Error(`Code web did not become ready at ${url}: ${lastError}`)
}

export async function startDemoSession({ names, programName, template, port }) {
  const deployment = readFileSync(resolve(backend, ".env.local"), "utf8")
  if (!/^CONVEX_DEPLOYMENT=dev:/m.test(deployment)) {
    throw new Error("Demo accounts require a development Convex deployment")
  }
  for (const name of ["CODE_DEMO_ISSUER", "CODE_DEMO_JWKS"]) {
    if (getDemoEnv(name)) {
      throw new Error(
        `${name} is already configured on this development deployment. Stop the other demo session and clear its auth settings before starting another.`
      )
    }
  }
  port ??= await availablePort()
  const dir = mkdtempSync(resolve(tmpdir(), "code-demo-"))
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  })
  const jwk = {
    ...publicKey.export({ format: "jwk" }),
    kid: "demo",
    alg: "RS256",
    use: "sig",
  }
  const issuer = `https://code-demo.example.test/${crypto.randomUUID()}`
  const encode = (value) =>
    Buffer.from(JSON.stringify(value)).toString("base64url")
  const accounts = names.map((name) => {
    const id = `code-demo-${name.toLowerCase()}`
    const now = Math.floor(Date.now() / 1000)
    const claims = {
      sub: id,
      name,
      email: `${id}@example.test`,
      email_verified: true,
      iss: issuer,
      aud: "code-collaboration-demo",
      iat: now,
      exp: now + 3600,
    }
    const body = `${encode({ alg: "RS256", typ: "JWT", kid: "demo" })}.${encode(claims)}`
    return {
      id,
      name,
      token: `${body}.${sign("RSA-SHA256", Buffer.from(body), privateKey).toString("base64url")}`,
    }
  })
  const envFile = resolve(dir, "convex.env")
  writeFileSync(
    envFile,
    `CODE_DEMO_ISSUER=${issuer}\nCODE_DEMO_JWKS=${Buffer.from(JSON.stringify({ keys: [jwk] })).toString("base64")}\n`,
    { mode: 0o600 }
  )
  let configured = false
  let child
  let cleaned = false
  const cleanup = (exit = false) => {
    if (cleaned) return
    cleaned = true
    child?.kill()
    if (configured) {
      for (const name of ["CODE_DEMO_ISSUER", "CODE_DEMO_JWKS"]) {
        try {
          execFileSync("bunx", ["convex", "env", "set", name, ""], {
            cwd: backend,
            stdio: "inherit",
          })
        } catch {
          console.error(
            `Could not clear ${name}; remove it from the development deployment`
          )
          process.exitCode = 1
        }
      }
    }
    rmSync(dir, { recursive: true, force: true })
    if (exit) process.exit()
  }

  try {
    configured = true
    // Convex keeps empty settings registered; --force is safe after the
    // preflight above confirms no other demo identity is active.
    execFileSync(
      "bunx",
      ["convex", "env", "set", "--force", "--from-file", envFile],
      {
        cwd: backend,
        stdio: "inherit",
      }
    )
    writeFileSync(resolve(dir, "accounts.json"), JSON.stringify(accounts), {
      mode: 0o600,
    })
    const run = (name, args) =>
      JSON.parse(
        execFileSync(
          "bunx",
          [
            "convex",
            "run",
            name,
            JSON.stringify(args),
            "--identity",
            JSON.stringify({ subject: accounts[0].id }),
          ],
          { cwd: backend, encoding: "utf8" }
        )
      )
    const workspaceId = run("workspaces:ensurePersonal", {})
    for (const account of accounts.slice(1)) {
      run("workspaces:addMember", { workspaceId, userId: account.id })
    }
    const programId = run("programs:create", {
      workspaceId,
      name: programName,
      template,
    })
    child = spawn(
      "bunx",
      [
        "vite",
        "dev",
        "--port",
        String(port),
        "--host",
        "127.0.0.1",
        "--strictPort",
      ],
      {
        cwd: resolve(root, "apps/code/web"),
        env: {
          ...process.env,
          VITE_CODE_DEMO_ACCOUNTS: JSON.stringify(accounts),
        },
        stdio: "inherit",
      }
    )
    let childError
    child.once("error", (error) => {
      childError = error
    })
    child.on("exit", () => {
      if (!cleaned) cleanup()
    })
    process.once("SIGINT", () => cleanup(true))
    process.once("SIGTERM", () => cleanup(true))
    await waitForServer(child, port, () => childError)

    const dashboardUrls = accounts.map(
      (account) => `http://127.0.0.1:${port}/?demoUser=${account.id}`
    )
    const programUrls = accounts.map(
      (account) =>
        `http://127.0.0.1:${port}/programs/${programId}?demoUser=${account.id}`
    )
    console.log(`Code web ready at http://127.0.0.1:${port}`)
    accounts.forEach((account, i) => {
      console.log(`${account.name} dashboard: ${dashboardUrls[i]}`)
      console.log(`${account.name} Program: ${programUrls[i]}`)
    })
    console.log(
      "Use separate browser tabs for parallel read-only screenshots. Press Ctrl+C to stop and clean up."
    )
    return { accounts, programId, dashboardUrls, programUrls, port }
  } catch (error) {
    cleanup()
    throw error
  }
}
