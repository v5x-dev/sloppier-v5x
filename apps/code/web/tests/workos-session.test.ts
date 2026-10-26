import { afterEach, expect, it, vi } from "vitest"
import { authenticate, logoutRedirect } from "../src/lib/workos-session.server"

const clientId = "client_test"
const origin = "https://code.v5x.dev"
function request(body: object, cookie = "", requestOrigin = origin) {
  return new Request(`${origin}/user_management/authenticate`, {
    method: "POST",
    headers: {
      Origin: requestOrigin,
      Cookie: cookie,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ client_id: clientId, ...body }),
  })
}
afterEach(() => vi.unstubAllGlobals())
it("restores a session after reload using only the HttpOnly cookie and rotates it", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({ access_token: "first", refresh_token: "refresh-one" })
    )
    .mockResolvedValueOnce(
      Response.json({ access_token: "restored", refresh_token: "refresh-two" })
    )
  vi.stubGlobal("fetch", fetch)
  const login = await authenticate(
    request({
      grant_type: "authorization_code",
      code: "code",
      code_verifier: "verifier",
    }),
    clientId
  )
  expect(await login.json()).toEqual({ access_token: "first" })
  const cookies = login.headers.getSetCookie()
  expect(cookies[0]).toContain("HttpOnly")
  expect(cookies[0]).toContain("Secure; SameSite=Lax")
  expect(cookies[1]).toContain(`workos-has-session=${clientId}`)
  const restored = await authenticate(
    request({ grant_type: "refresh_token" }, cookies[0].split(";")[0]),
    clientId
  )
  expect(JSON.parse(fetch.mock.calls[1][1].body).refresh_token).toBe(
    "refresh-one"
  )
  expect(await restored.json()).toEqual({ access_token: "restored" })
  expect(restored.headers.getSetCookie()[0]).toContain("refresh-two")
})
it("rejects cross-origin refresh and ignores browser-supplied refresh tokens", async () => {
  const fetch = vi.fn()
  vi.stubGlobal("fetch", fetch)
  expect(
    (
      await authenticate(
        request({ grant_type: "refresh_token" }, "", "https://evil.test"),
        clientId
      )
    ).status
  ).toBe(403)
  expect(
    (
      await authenticate(
        request({ grant_type: "refresh_token", refresh_token: "injected" }),
        clientId
      )
    ).status
  ).toBe(401)
  expect(fetch).not.toHaveBeenCalled()
})
it("clears persistent session cookies on logout", () => {
  const response = logoutRedirect(
    new Request(
      `${origin}/user_management/sessions/logout?session_id=session&return_to=https://evil.test`
    ),
    clientId
  )
  expect(
    response.headers.getSetCookie().every((c) => c.includes("Max-Age=0"))
  ).toBe(true)
  expect(
    new URL(response.headers.get("Location")!).searchParams.get("return_to")
  ).toBe(origin)
})
