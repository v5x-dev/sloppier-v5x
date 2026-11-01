import "@tanstack/react-start/server-only"

const refreshCookie = "__Host-code-refresh"
const markerCookie = "workos-has-session"
const cookieOptions = "Path=/; Secure; SameSite=Lax"
const maxAge = 60 * 60 * 24 * 365

function sessionCookies(
  headers: Headers,
  token: string | undefined,
  clientId: string
) {
  headers.append(
    "Set-Cookie",
    `${refreshCookie}=${token ? encodeURIComponent(token) : ""}; ${cookieOptions}; HttpOnly; Max-Age=${token ? maxAge : 0}`
  )
  headers.append(
    "Set-Cookie",
    `${markerCookie}=${token ? clientId : ""}; ${cookieOptions}; Max-Age=${token ? maxAge : 0}`
  )
}

// Keep the refresh token on our origin and out of JavaScript. AuthKit keeps
// access tokens in memory and uses the readable marker to restore on reload.
export async function authenticate(request: Request, clientId: string) {
  const headers = new Headers({ "Cache-Control": "no-store" })
  if (request.headers.get("Origin") !== new URL(request.url).origin) {
    return new Response("Forbidden", { status: 403, headers })
  }
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return new Response("Invalid JSON", { status: 400, headers })
  }
  if (
    body.client_id !== clientId ||
    !["authorization_code", "refresh_token"].includes(String(body.grant_type))
  ) {
    return new Response("Invalid authentication request", {
      status: 400,
      headers,
    })
  }
  // Only forward the supported PKCE/refresh fields, never browser credentials.
  const payload: Record<string, unknown> = {
    client_id: clientId,
    grant_type: body.grant_type,
  }
  if (body.grant_type === "refresh_token") {
    const token = request.headers
      .get("Cookie")
      ?.split(/;\s*/)
      .find((c) => c.startsWith(`${refreshCookie}=`))
      ?.slice(refreshCookie.length + 1)
    if (!token)
      return Response.json({ error: "invalid_grant" }, { status: 401, headers })
    payload.refresh_token = decodeURIComponent(token)
    if (typeof body.organization_id === "string")
      payload.organization_id = body.organization_id
  } else {
    if (
      typeof body.code !== "string" ||
      typeof body.code_verifier !== "string"
    ) {
      return new Response("Missing PKCE credentials", { status: 400, headers })
    }
    payload.code = body.code
    payload.code_verifier = body.code_verifier
  }
  const upstream = await fetch(
    "https://api.workos.com/user_management/authenticate",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  )
  const data = (await upstream.json()) as Record<string, unknown>
  if (upstream.ok && typeof data.refresh_token === "string") {
    sessionCookies(headers, data.refresh_token, clientId)
  } else if (
    [400, 401, 403].includes(upstream.status) &&
    body.grant_type === "refresh_token"
  ) {
    sessionCookies(headers, undefined, clientId)
  }
  delete data.refresh_token
  return Response.json(data, { status: upstream.status, headers })
}

export function authorizationRedirect(request: Request, clientId: string) {
  const url = new URL(request.url)
  url.protocol = "https:"
  url.host = "api.workos.com"
  url.port = ""
  url.searchParams.set("client_id", clientId)
  url.searchParams.set(
    "redirect_uri",
    `${new URL(request.url).origin}/callback`
  )
  return Response.redirect(url.toString(), 302)
}

export function logoutRedirect(request: Request, clientId: string) {
  const url = new URL("https://api.workos.com/user_management/sessions/logout")
  const sessionId = new URL(request.url).searchParams.get("session_id")
  if (sessionId) url.searchParams.set("session_id", sessionId)
  url.searchParams.set("return_to", new URL(request.url).origin)
  const headers = new Headers({
    Location: url.toString(),
    "Cache-Control": "no-store",
  })
  sessionCookies(headers, undefined, clientId)
  return new Response(null, { status: 302, headers })
}
