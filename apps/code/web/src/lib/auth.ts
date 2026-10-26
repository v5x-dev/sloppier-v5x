import { useCallback } from "react"
import { useAuth as useWorkosAuth } from "@workos-inc/authkit-react"

type DemoAccount = { id: string; name: string; token: string }

// Only an explicitly configured Vite development server can use demo identities.
export function demoAccount(): DemoAccount | undefined {
  if (!import.meta.env.DEV || !import.meta.env.VITE_CODE_DEMO_ACCOUNTS) return
  if (typeof window === "undefined") return
  const accounts = JSON.parse(import.meta.env.VITE_CODE_DEMO_ACCOUNTS) as DemoAccount[]
  return accounts.find((account) => account.id === new URLSearchParams(window.location.search).get("demoUser"))
}

export function useAuth() {
  const auth = useWorkosAuth()
  const demo = demoAccount()
  if (!demo) return auth
  return {
    ...auth,
    isLoading: false,
    user: {
      ...auth.user,
      id: demo.id,
      firstName: demo.name,
      lastName: "Demo",
      email: `${demo.id}@example.test`,
      profilePictureUrl: null,
    } as NonNullable<typeof auth.user>,
  }
}

export function useDemoConvexAuth() {
  const token = demoAccount()?.token
  const fetchAccessToken = useCallback(async () => token ?? null, [token])
  return {
    isLoading: false,
    isAuthenticated: Boolean(demoAccount()),
    fetchAccessToken,
  }
}
