import { existsSync, readFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { resolve } from "node:path"
import { readEnv } from "../apps/code/web/scripts/local-fixture.mjs"
const root = resolve(import.meta.dirname, "..")
let failed = false
function check(ok, message) {
  console.log(`${ok ? "OK" : "FIX"} ${message}`)
  if (!ok) failed = true
}
const read = (path) =>
  existsSync(resolve(root, path))
    ? readEnv(readFileSync(resolve(root, path), "utf8"))
    : {}
const backend = read("packages/backend/.env.local"),
  web = read("apps/code/web/.env.local")
const node = execFileSync(process.env.CODE_TEST_NODE ?? "node", ["--version"], {
  encoding: "utf8",
}).trim()
check(
  /^v(22|24)\./.test(node),
  `Local Convex tests need Node 22 or 24 (selected ${node}); CODE_TEST_NODE can select another executable.`
)
check(
  execFileSync("bun", ["--version"], { encoding: "utf8" }).trim() === "1.4.4",
  "Use the committed Bun version: 1.4.4."
)
const supplied = process.env.CODE_TEST_STORAGE_ENV
check(
  Boolean(
    supplied
      ? existsSync(supplied)
      : (process.env.PIERRE_ORG && process.env.PIERRE_PRIVATE_KEY) ||
          backend.CONVEX_DEPLOYMENT?.startsWith("dev:")
  ),
  "Test storage source: CODE_TEST_STORAGE_ENV, Pierre environment credentials, or a selected development Convex deployment."
)
if (backend.CONVEX_DEPLOYMENT || web.VITE_CONVEX_URL) {
  check(
    backend.CONVEX_DEPLOYMENT?.startsWith("dev:"),
    "Normal local development must select a development Convex deployment."
  )
  check(
    Boolean(backend.CONVEX_URL && backend.CONVEX_URL === web.VITE_CONVEX_URL),
    "Web and backend local configuration must select the same Convex URL."
  )
  check(
    Boolean(web.VITE_WORKOS_CLIENT_ID),
    "Normal development requires VITE_WORKOS_CLIENT_ID; isolated test runners supply their own identity settings."
  )
}
console.log(
  "No configuration or cloud state was changed. See apps/code/web/README.md for setup."
)
process.exitCode = failed ? 1 : 0
