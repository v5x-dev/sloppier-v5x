import { test } from "node:test"
import assert from "node:assert/strict"
import {
  boundaryError,
  clientImportError,
  relativeTarget,
  exportError,
} from "../lib/boundaries.mjs"

test("forbids app-to-app and package-to-app dependencies", () => {
  assert.ok(
    boundaryError(
      "apps/code/web/src/a.ts",
      "apps/film/web/src/b.ts",
      "../../../../film/web/src/b"
    )
  )
  assert.ok(
    boundaryError(
      "packages/ui/src/a.ts",
      "apps/code/web/src/b.ts",
      "@v5x/code-web"
    )
  )
})
test("requires package exports but permits local implementation imports", () => {
  assert.ok(
    boundaryError(
      "apps/code/web/src/a.ts",
      "packages/backend/convex/schema.ts",
      "../../../../packages/backend/convex/schema"
    )
  )
  assert.equal(
    boundaryError(
      "apps/code/web/src/a.ts",
      "packages/backend/convex/_generated/api.js",
      "@v5x/backend/api"
    ),
    undefined
  )
  assert.equal(
    boundaryError("packages/ui/src/a.ts", "packages/ui/src/b.ts", "./b"),
    undefined
  )
  assert.equal(
    relativeTarget("apps/code/web/src/a.ts", "../../../../packages/ui/src/b"),
    "packages/ui/src/b"
  )
})
test("keeps server modules outside client imports while permitting server routes", () => {
  assert.ok(
    clientImportError(
      "apps/code/web/src/lib/a.ts",
      "apps/code/web/src/lib/auth.server.ts",
      "./auth.server"
    )
  )
  assert.ok(
    clientImportError(
      "apps/code/web/src/components/a.tsx",
      "node:crypto",
      "node:crypto"
    )
  )
  assert.equal(
    clientImportError(
      "apps/code/web/src/routes/auth.ts",
      "apps/code/web/src/lib/auth.server.ts",
      "./auth.server"
    ),
    undefined
  )
})

test("rejects private package subpaths even when source files exist", () => {
  const manifest = {
    name: "@v5x/ui",
    exports: {
      "./components/*": "./src/components/*.tsx",
      "./globals.css": "./src/styles/globals.css",
    },
  }
  assert.equal(exportError("@v5x/ui/components/button", manifest), undefined)
  assert.ok(exportError("@v5x/ui/src/components/button", manifest))
  assert.ok(exportError("@v5x/ui", manifest))
  assert.equal(exportError("@v5x/ui/globals.css?url", manifest), undefined)
})
