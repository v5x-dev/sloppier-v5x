import { AuthRequest, makeRedirectUri, ResponseType } from "expo-auth-session"
import * as SecureStore from "expo-secure-store"
import * as WebBrowser from "expo-web-browser"
import { fetch } from "expo/fetch"
import { Platform } from "react-native"
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react"

WebBrowser.maybeCompleteAuthSession()

const clientId = process.env.EXPO_PUBLIC_WORKOS_CLIENT_ID
const endpoint = "https://api.workos.com/user_management"
const storageKey = "code.workos.refresh-token"
type User = {
  id: string
  email: string
  first_name: string | null
  last_name: string | null
}
type Session = { access_token: string; refresh_token: string; user: User }
type SignInOptions = {
  provider?: "google" | "microsoft" | "github" | "apple"
  email?: string
  signUp?: boolean
}
const providerNames = {
  google: "GoogleOAuth",
  microsoft: "MicrosoftOAuth",
  github: "GitHubOAuth",
  apple: "AppleOAuth",
}

async function readToken() {
  return Platform.OS === "web"
    ? window.sessionStorage.getItem(storageKey)
    : SecureStore.getItemAsync(storageKey)
}
async function saveToken(token: string | null) {
  if (Platform.OS === "web") {
    if (token) window.sessionStorage.setItem(storageKey, token)
    else window.sessionStorage.removeItem(storageKey)
  } else if (token) await SecureStore.setItemAsync(storageKey, token)
  else await SecureStore.deleteItemAsync(storageKey)
}

class AuthenticationError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}
async function authenticate(body: Record<string, string>): Promise<Session> {
  if (!clientId)
    throw new Error("Set EXPO_PUBLIC_WORKOS_CLIENT_ID to connect sign-in.")
  const response = await fetch(`${endpoint}/authenticate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId, ...body }),
  })
  const result = await response.json()
  if (!response.ok)
    throw new AuthenticationError(
      result.message ??
        result.error_description ??
        "Sign-in failed. Please try again.",
      response.status
    )
  if (!result.access_token || !result.refresh_token || !result.user)
    throw new Error("The sign-in response was incomplete.")
  return result
}

type Auth = {
  user: User | null
  isLoading: boolean
  isSigningIn: boolean
  error: string | null
  signIn: (options?: SignInOptions) => Promise<void>
  signOut: () => Promise<void>
  fetchAccessToken: (options: {
    forceRefreshToken: boolean
  }) => Promise<string | null>
}
const AuthContext = createContext<Auth | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSigningIn, setIsSigningIn] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const session = useRef<Session | null>(null)
  const refreshing = useRef<Promise<string | null> | null>(null)
  const busy = useRef(false)
  const generation = useRef(0)

  const acceptSession = useCallback(
    async (next: Session, expectedGeneration: number) => {
      if (generation.current !== expectedGeneration) return null
      await saveToken(next.refresh_token)
      if (generation.current !== expectedGeneration) {
        await saveToken(null)
        return null
      }
      session.current = next
      setUser(next.user)
      setError(null)
      return next.access_token
    },
    []
  )

  const refresh = useCallback(() => {
    if (refreshing.current) return refreshing.current
    const currentGeneration = generation.current
    const pending = (async () => {
      const token = session.current?.refresh_token ?? (await readToken())
      if (!token) return null
      try {
        return await acceptSession(
          await authenticate({
            grant_type: "refresh_token",
            refresh_token: token,
          }),
          currentGeneration
        )
      } catch (cause) {
        if (generation.current !== currentGeneration) return null
        if (
          cause instanceof AuthenticationError &&
          [400, 401, 403].includes(cause.status)
        ) {
          await saveToken(null)
          session.current = null
          setUser(null)
        }
        setError(
          cause instanceof Error
            ? cause.message
            : "Could not restore your session."
        )
        throw cause
      }
    })()
    refreshing.current = pending
    void pending
      .finally(() => {
        if (refreshing.current === pending) refreshing.current = null
      })
      .catch(() => {})
    return pending
  }, [acceptSession])

  useEffect(() => {
    void refresh()
      .catch(() => {})
      .finally(() => setIsLoading(false))
  }, [refresh])

  const signIn = useCallback(
    async (options: SignInOptions = {}) => {
      if (busy.current) return
      busy.current = true
      setIsSigningIn(true)
      setError(null)
      const currentGeneration = generation.current
      try {
        if (!clientId)
          throw new Error(
            "Set EXPO_PUBLIC_WORKOS_CLIENT_ID to connect sign-in."
          )
        const redirectUri = makeRedirectUri({
          scheme: "v5x-code",
          path: "callback",
        })
        const request = new AuthRequest({
          clientId,
          redirectUri,
          responseType: ResponseType.Code,
          usePKCE: true,
          extraParams: {
            provider: options.provider
              ? providerNames[options.provider]
              : "authkit",
            ...(options.email ? { login_hint: options.email } : {}),
            ...(options.signUp ? { screen_hint: "sign-up" } : {}),
          },
        })
        const result = await request.promptAsync({
          authorizationEndpoint: `${endpoint}/authorize`,
        })
        if (result.type === "cancel" || result.type === "dismiss") return
        if (result.type !== "success")
          throw new Error(
            result.type === "error"
              ? (result.params.error_description ?? "Sign-in was rejected.")
              : "Could not complete sign-in."
          )
        if (!result.params.code || !request.codeVerifier)
          throw new Error("Sign-in did not return an authorization code.")
        await acceptSession(
          await authenticate({
            grant_type: "authorization_code",
            code: result.params.code,
            code_verifier: request.codeVerifier,
            redirect_uri: redirectUri,
          }),
          currentGeneration
        )
      } catch (cause) {
        setError(
          cause instanceof Error
            ? cause.message
            : "Could not sign in. Please try again."
        )
      } finally {
        busy.current = false
        setIsSigningIn(false)
      }
    },
    [acceptSession]
  )

  const signOut = useCallback(async () => {
    generation.current += 1
    session.current = null
    setUser(null)
    setError(null)
    await saveToken(null)
  }, [])
  const fetchAccessToken = useCallback(
    async ({ forceRefreshToken }: { forceRefreshToken: boolean }) => {
      if (!session.current) return null
      if (!forceRefreshToken) return session.current.access_token
      return refresh()
    },
    [refresh]
  )

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isSigningIn,
        error,
        signIn,
        signOut,
        fetchAccessToken,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const auth = useContext(AuthContext)
  if (!auth) throw new Error("AuthProvider is missing.")
  return auth
}
export function useConvexAuthAdapter() {
  const { isLoading, user, fetchAccessToken } = useAuth()
  return { isLoading, isAuthenticated: Boolean(user), fetchAccessToken }
}
