// Bridge for the native app's WorkOS sign-in. WorkOS redirects only to registered
// URIs, but Expo Go's return address changes with every dev host. The app therefore
// sends its return address inside `state`, WorkOS returns the browser here, and this
// route forwards the sign-in result to that address.

const allowedProtocols = new Set(["exp:", "exps:"])
const expoGoPathPrefix = "/--/"

// Accepts only Expo Go return addresses, so this route cannot be used as an open
// redirect to an arbitrary site.
export function allowedReturnUrl(value: string): URL | undefined {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return undefined
  }
  if (!allowedProtocols.has(url.protocol)) return undefined
  if (!url.pathname.startsWith(expoGoPathPrefix)) return undefined
  if (url.username || url.password) return undefined
  return url
}

// The app sends `state` as JSON: { nonce, returnTo }. The nonce is checked by the app.
function returnUrlFromState(state: string | null): URL | undefined {
  if (!state) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(state)
  } catch {
    return undefined
  }
  const returnTo = (parsed as { returnTo?: unknown } | null)?.returnTo
  return typeof returnTo === "string" ? allowedReturnUrl(returnTo) : undefined
}

export function mobileCallbackResponse(request: Request): Response {
  const params = new URL(request.url).searchParams
  const target = returnUrlFromState(params.get("state"))
  if (!target) {
    return new Response(
      "This sign-in link is invalid or has expired. Return to the app and try again.",
      {
        status: 400,
        headers: {
          "Cache-Control": "no-store",
          "Content-Type": "text/plain; charset=utf-8",
        },
      }
    )
  }
  for (const key of ["code", "state", "error", "error_description"]) {
    const value = params.get(key)
    if (value !== null) target.searchParams.set(key, value)
  }
  return new Response(null, {
    status: 302,
    headers: { Location: target.toString(), "Cache-Control": "no-store" },
  })
}
