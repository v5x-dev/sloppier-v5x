import * as SecureStore from "expo-secure-store"
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import {
  refreshWorkOSSession,
  signInWithWorkOS,
  SignInCancelledError,
  type WorkOSSession,
  type WorkOSUser,
} from "./workos"

const refreshTokenKey = "workos-refresh-token"
// Refresh a little before the access token expires, so Convex never gets a stale one.
const refreshMarginMs = 60_000

type AuthStatus = "loading" | "signedOut" | "signedIn"

type AuthValue = {
  status: AuthStatus
  user: WorkOSUser | null
  signIn: () => Promise<string | null>
  signOut: () => Promise<void>
  getAccessToken: (options?: {
    forceRefreshToken?: boolean
  }) => Promise<string | null>
}

const AuthContext = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading")
  const [user, setUser] = useState<WorkOSUser | null>(null)
  const sessionRef = useRef<WorkOSSession | null>(null)
  const refreshing = useRef<Promise<WorkOSSession | null> | null>(null)

  const adopt = useCallback(async (session: WorkOSSession) => {
    sessionRef.current = session
    await SecureStore.setItemAsync(refreshTokenKey, session.refreshToken)
    setUser(session.user)
    setStatus("signedIn")
  }, [])

  const clear = useCallback(async () => {
    sessionRef.current = null
    await SecureStore.deleteItemAsync(refreshTokenKey)
    setUser(null)
    setStatus("signedOut")
  }, [])

  // Each refresh rotates the refresh token, so the new one replaces the stored one.
  // Concurrent callers share one request.
  const refresh = useCallback(
    (refreshToken: string) => {
      refreshing.current ??= refreshWorkOSSession(refreshToken)
        .then(async (session) => {
          await adopt(session)
          return session
        })
        .catch(async () => {
          await clear()
          return null
        })
        .finally(() => {
          refreshing.current = null
        })
      return refreshing.current
    },
    [adopt, clear]
  )

  useEffect(() => {
    void (async () => {
      const stored = await SecureStore.getItemAsync(refreshTokenKey)
      if (!stored) {
        setStatus("signedOut")
        return
      }
      await refresh(stored)
    })()
  }, [refresh])

  const getAccessToken = useCallback<AuthValue["getAccessToken"]>(
    async (options) => {
      const current = sessionRef.current
      if (!current) return null
      const fresh =
        current.expiresAt - refreshMarginMs > Date.now() &&
        !options?.forceRefreshToken
      if (fresh) return current.accessToken
      const session = await refresh(current.refreshToken)
      return session?.accessToken ?? null
    },
    [refresh]
  )

  const signIn = useCallback(async () => {
    try {
      await adopt(await signInWithWorkOS())
      return null
    } catch (error) {
      if (error instanceof SignInCancelledError) return null
      return error instanceof Error ? error.message : "Sign-in failed."
    }
  }, [adopt])

  const value = useMemo<AuthValue>(
    () => ({ status, user, signIn, signOut: clear, getAccessToken }),
    [status, user, signIn, clear, getAccessToken]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error("useAuth must be used inside AuthProvider")
  return value
}

// Shape that ConvexProviderWithAuth expects.
export function useConvexAuth() {
  const { status, getAccessToken } = useAuth()
  return useMemo(
    () => ({
      isLoading: status === "loading",
      isAuthenticated: status === "signedIn",
      fetchAccessToken: getAccessToken,
    }),
    [status, getAccessToken]
  )
}
