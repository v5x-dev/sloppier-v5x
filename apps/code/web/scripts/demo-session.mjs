// Real app, signed identities, and a disposable local Convex backend.
import { generateKeyPairSync, sign, randomUUID } from "node:crypto"
import { writeFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  app,
  availablePort,
  createLocalFixture,
  waitFor,
} from "./local-fixture.mjs"

export async function startDemoSession({
  names,
  programName,
  template,
  port,
  builderURL,
}) {
  const fixture = await createLocalFixture({ builderURL })
  const runId = randomUUID()
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  })
  const jwk = {
    ...publicKey.export({ format: "jwk" }),
    kid: runId,
    alg: "RS256",
    use: "sig",
  }
  const issuer = `https://code-demo.example.test/${runId}`
  const encode = (value) =>
    Buffer.from(JSON.stringify(value)).toString("base64url")
  const accounts = names.map((name) => {
    const id = `code-demo-${runId}-${name.toLowerCase()}`
    const now = Math.floor(Date.now() / 1000)
    const claims = {
      sub: id,
      name,
      email: `${id}@example.test`,
      email_verified: true,
      emailVerified: true,
      iss: issuer,
      aud: "code-collaboration-demo",
      iat: now,
      exp: now + 3600,
    }
    const body = `${encode({ alg: "RS256", typ: "JWT", kid: runId })}.${encode(claims)}`
    return {
      id,
      name,
      token: `${body}.${sign("RSA-SHA256", Buffer.from(body), privateKey).toString("base64url")}`,
    }
  })
  const stop = fixture.stop
  const interrupt = () => {
    void stop().catch((error) => {
      console.error(error.message)
      process.exitCode = 1
    })
  }
  try {
    const envFile = resolve(fixture.dir, "auth.env")
    writeFileSync(
      envFile,
      `CODE_DEMO_ISSUER=${issuer}\nCODE_DEMO_JWKS=${Buffer.from(JSON.stringify({ keys: [jwk] })).toString("base64")}\n`,
      { mode: 0o600 }
    )
    fixture.cli(["env", "set", "--force", "--from-file", envFile])
    const run = (name, args) =>
      JSON.parse(
        fixture.cli([
          "run",
          name,
          JSON.stringify(args),
          "--identity",
          JSON.stringify({ subject: accounts[0].id }),
        ])
      )
    const workspaceId = run("workspaces:ensurePersonal", {})
    for (const account of accounts.slice(1))
      run("workspaces:addMember", { workspaceId, userId: account.id })
    const programId = run("programs:create", {
      workspaceId,
      name: programName,
      template,
    })
    port ??= await availablePort()
    const child = fixture.start(
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
        cwd: app,
        env: {
          ...process.env,
          CODE_TEST_CACHE_DIR: resolve(fixture.dir, "vite-cache"),
          VITE_CONVEX_URL: fixture.convexURL,
          VITE_WORKOS_CLIENT_ID: "client_test",
          VITE_WORKOS_EMULATOR_URL: "",
          VITE_WORKOS_REDIRECT_URI: `http://127.0.0.1:${port}/callback`,
          VITE_CODE_DEMO_ACCOUNTS: JSON.stringify(accounts),
        },
      }
    )
    child.once("exit", interrupt)
    process.once("SIGINT", interrupt)
    process.once("SIGTERM", interrupt)
    await waitFor(`http://127.0.0.1:${port}/`, child)
    const dashboardUrls = accounts.map(
      (account) => `http://127.0.0.1:${port}/?demoUser=${account.id}`
    )
    const programUrls = accounts.map(
      (account) =>
        `http://127.0.0.1:${port}/programs/${programId}?demoUser=${account.id}`
    )
    accounts.forEach((account, i) => {
      console.log(`${account.name} dashboard: ${dashboardUrls[i]}`)
      console.log(`${account.name} Program: ${programUrls[i]}`)
    })
    console.log(
      "Press Ctrl+C to stop and delete this run's repositories, database, and credentials."
    )
    return {
      accounts,
      programId,
      workspaceId,
      dashboardUrls,
      programUrls,
      port,
      fixture,
      stop,
    }
  } catch (error) {
    await stop()
    throw error
  }
}
