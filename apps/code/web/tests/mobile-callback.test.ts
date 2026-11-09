import { describe, expect, it } from "vitest"
import {
  allowedReturnUrl,
  mobileCallbackResponse,
} from "../src/lib/mobile-callback"

const expoGo = "exp://192.168.1.20:8081/--/auth-callback"

function callback(params: Record<string, string>) {
  const query = new URLSearchParams(params).toString()
  return new Request(`https://code.v5x.dev/mobile-callback?${query}`)
}

function state(returnTo: string) {
  return JSON.stringify({ nonce: "n1", returnTo })
}

describe("allowedReturnUrl", () => {
  it("accepts Expo Go return addresses", () => {
    expect(allowedReturnUrl(expoGo)?.hostname).toBe("192.168.1.20")
    expect(allowedReturnUrl("exps://tunnel.trycloudflare.com/--/x")).toBeDefined()
  })

  it.each([
    ["https://evil.example/--/auth-callback"],
    ["exp://192.168.1.20:8081/other"],
    ["javascript:alert(1)"],
    ["exp://user:pass@192.168.1.20:8081/--/auth-callback"],
    ["not a url"],
  ])("rejects %s", (value) => {
    expect(allowedReturnUrl(value)).toBeUndefined()
  })
})

describe("mobileCallbackResponse", () => {
  it("redirects to the app with the code and state", async () => {
    const response = mobileCallbackResponse(
      callback({ code: "abc", state: state(expoGo) })
    )
    expect(response.status).toBe(302)
    const location = new URL(response.headers.get("Location")!)
    expect(location.protocol).toBe("exp:")
    expect(location.pathname).toBe("/--/auth-callback")
    expect(location.searchParams.get("code")).toBe("abc")
    expect(location.searchParams.get("state")).toBe(state(expoGo))
  })

  it("forwards WorkOS errors to the app", () => {
    const response = mobileCallbackResponse(
      callback({
        error: "access_denied",
        error_description: "Denied",
        state: state(expoGo),
      })
    )
    const location = new URL(response.headers.get("Location")!)
    expect(location.searchParams.get("error")).toBe("access_denied")
    expect(location.searchParams.get("error_description")).toBe("Denied")
  })

  it("refuses to redirect when the return address is not an Expo Go address", () => {
    const response = mobileCallbackResponse(
      callback({ code: "abc", state: state("https://evil.example/--/x") })
    )
    expect(response.status).toBe(400)
    expect(response.headers.get("Location")).toBeNull()
  })

  it("refuses to redirect without a state", () => {
    expect(mobileCallbackResponse(callback({ code: "abc" })).status).toBe(400)
    expect(
      mobileCallbackResponse(callback({ code: "abc", state: "not json" })).status
    ).toBe(400)
  })
})
