import { test } from "node:test"
import assert from "node:assert/strict"
import { readEnv } from "../../apps/code/web/scripts/local-fixture.mjs"
test("reads public configuration and quoted multiline credential files", () => {
  assert.deepEqual(
    readEnv(
      '# ignore\nCONVEX_DEPLOYMENT=dev:test\nPIERRE_PRIVATE_KEY="line1\\nline2"\nEMPTY=\n'
    ),
    {
      CONVEX_DEPLOYMENT: "dev:test",
      PIERRE_PRIVATE_KEY: "line1\nline2",
      EMPTY: "",
    }
  )
})
