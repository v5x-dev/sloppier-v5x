import { afterEach, describe, expect, it, vi } from "vitest"
import { demoAccount } from "../src/lib/auth"

const accounts = JSON.stringify([{ id: "alice", name: "Alice", token: "signed-token" }])
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe("development demo authentication", () => {
  it("ignores demo credentials in production", () => {
    vi.stubEnv("DEV", false)
    vi.stubEnv("VITE_CODE_DEMO_ACCOUNTS", accounts)
    vi.stubGlobal("window", { location: { search: "?demoUser=alice" } })
    expect(demoAccount()).toBeUndefined()
  })

  it("only selects explicitly configured identities", () => {
    vi.stubEnv("DEV", true)
    vi.stubEnv("VITE_CODE_DEMO_ACCOUNTS", accounts)
    vi.stubGlobal("window", { location: { search: "?demoUser=administrator" } })
    expect(demoAccount()).toBeUndefined()
    vi.stubGlobal("window", { location: { search: "?demoUser=alice" } })
    expect(demoAccount()?.id).toBe("alice")
  })
})
