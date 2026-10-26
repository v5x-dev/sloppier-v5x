import { generateKeyPairSync, sign } from "node:crypto"
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import { execFileSync, spawn } from "node:child_process"

const root = resolve(import.meta.dirname, "../../../..")
const backend = resolve(root, "packages/backend")
const deployment = readFileSync(resolve(backend, ".env.local"), "utf8")
if (!/^CONVEX_DEPLOYMENT=dev:/m.test(deployment)) {
  throw new Error("Demo accounts require a development Convex deployment")
}
const dir = mkdtempSync(resolve(tmpdir(), "code-demo-"))
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "demo", alg: "RS256", use: "sig" }
const issuer = `https://code-demo.example.test/${crypto.randomUUID()}`
const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url")
const accounts = ["Alice", "Ben", "Clara", "Diego"].map((name) => {
  const id = `code-demo-${name.toLowerCase()}`
  const now = Math.floor(Date.now() / 1000)
  const body = `${encode({ alg: "RS256", typ: "JWT", kid: "demo" })}.${encode({ sub: id, name, iss: issuer, aud: "code-collaboration-demo", iat: now, exp: now + 3600 })}`
  return { id, name, token: `${body}.${sign("RSA-SHA256", Buffer.from(body), privateKey).toString("base64url")}` }
})
const envFile = resolve(dir, "convex.env")
writeFileSync(envFile, `CODE_DEMO_ISSUER=${issuer}\nCODE_DEMO_JWKS=${Buffer.from(JSON.stringify({ keys: [jwk] })).toString("base64")}\n`, { mode: 0o600 })
execFileSync("bunx", ["convex", "env", "set", "--force", "--from-file", envFile], { cwd: backend, stdio: "inherit" })
writeFileSync(resolve(dir, "accounts.json"), JSON.stringify(accounts), { mode: 0o600 })
const run = (name, args) => JSON.parse(execFileSync("bunx", [
  "convex", "run", name, JSON.stringify(args),
  "--identity", JSON.stringify({ subject: accounts[0].id }),
], { cwd: backend, encoding: "utf8" }))
const workspaceId = run("workspaces:ensurePersonal", {})
for (const account of accounts.slice(1)) {
  run("workspaces:addMember", { workspaceId, userId: account.id })
}
const projectId = run("projects:create", {
  workspaceId, name: "Four editors live demo", template: "pros",
})
console.log(`Demo credentials directory: ${dir}`)
for (const account of accounts) {
  console.log(`${account.name}: http://127.0.0.1:3001/programs/${projectId}?demoUser=${account.id}`)
}
const child = spawn("bunx", ["vite", "dev", "--port", "3001", "--host", "127.0.0.1"], {
  cwd: resolve(root, "apps/code/web"),
  env: { ...process.env, VITE_CODE_DEMO_ACCOUNTS: JSON.stringify(accounts) },
  stdio: "inherit",
})
const cleanup = () => {
  child.kill()
  for (const name of ["CODE_DEMO_ISSUER", "CODE_DEMO_JWKS"]) {
    execFileSync("bunx", ["convex", "env", "set", name, ""], { cwd: backend, stdio: "inherit" })
  }
  process.exit()
}
process.on("SIGINT", cleanup)
process.on("SIGTERM", cleanup)
