import * as Crypto from "expo-crypto"
import * as Linking from "expo-linking"
import * as WebBrowser from "expo-web-browser"
import { workosClientId, workosMobileRedirectUri } from "./config"

const authorizeEndpoint = "https://api.workos.com/user_management/authorize"
const authenticateEndpoint =
  "https://api.workos.com/user_management/authenticate"

export type WorkOSUser = {
  id: string
  email: string
  first_name: string | null
  last_name: string | null
}

export type WorkOSSession = {
  accessToken: string
  refreshToken: string
  expiresAt: number
  user: WorkOSUser
}

export class SignInCancelledError extends Error {
  constructor() {
    super("Sign-in was cancelled.")
  }
}

function randomHex(bytes: number) {
  const values = Crypto.getRandomValues(new Uint8Array(bytes))
  return Array.from(values, (byte) => byte.toString(16).padStart(2, "0")).join(
    ""
  )
}

function base64UrlFromBase64(value: string) {
  return value.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

async function codeChallengeFor(verifier: string) {
  const digest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    verifier,
    { encoding: Crypto.CryptoEncoding.BASE64 }
  )
  return base64UrlFromBase64(digest)
}

function parseQuery(url: string) {
  const query = url.split("?")[1]?.split("#")[0] ?? ""
  const params: Record<string, string> = {}
  for (const part of query.split("&")) {
    if (!part) continue
    const [key, value = ""] = part.split("=")
    params[decodeURIComponent(key.replace(/\+/g, " "))] = decodeURIComponent(
      value.replace(/\+/g, " ")
    )
  }
  return params
}

// JWT expiry, read without verifying the signature. Convex verifies the token; the
// app only uses this to decide when to refresh.
export function jwtExpiresAt(token: string): number {
  const payload = token.split(".")[1]
  if (!payload) return 0
  const base64 = payload.replace(/-/g, "+").replace(/_/g, "/")
  const claims = JSON.parse(atob(base64)) as { exp?: number }
  return (claims.exp ?? 0) * 1000
}

async function authenticate(body: Record<string, string>) {
  const response = await fetch(authenticateEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: workosClientId, ...body }),
  })
  const data = (await response.json()) as Record<string, unknown>
  if (
    !response.ok ||
    typeof data.access_token !== "string" ||
    typeof data.refresh_token !== "string"
  ) {
    const message =
      typeof data.message === "string" ? data.message : "Sign-in failed."
    throw new Error(message)
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: jwtExpiresAt(data.access_token),
    user: data.user as WorkOSUser,
  }
}

// Signs in through WorkOS AuthKit with PKCE. The app is a public client, so it has
// no secret. The browser returns through the bridge route, then to this app.
export async function signInWithWorkOS(): Promise<WorkOSSession> {
  const verifier = randomHex(32)
  const challenge = await codeChallengeFor(verifier)
  const returnTo = Linking.createURL("auth-callback")
  const state = JSON.stringify({ nonce: randomHex(16), returnTo })

  const authorizeUrl = `${authorizeEndpoint}?${new URLSearchParams({
    client_id: workosClientId,
    redirect_uri: workosMobileRedirectUri,
    response_type: "code",
    provider: "authkit",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  })}`

  const result = await WebBrowser.openAuthSessionAsync(authorizeUrl, returnTo)
  if (result.type !== "success") throw new SignInCancelledError()

  const params = parseQuery(result.url)
  if (params.error) {
    throw new Error(params.error_description ?? params.error)
  }
  if (params.state !== state) throw new Error("Sign-in response did not match.")
  if (!params.code) throw new Error("Sign-in response had no code.")

  return authenticate({
    grant_type: "authorization_code",
    code: params.code,
    code_verifier: verifier,
  })
}

export function refreshWorkOSSession(refreshToken: string) {
  return authenticate({ grant_type: "refresh_token", refresh_token: refreshToken })
}
