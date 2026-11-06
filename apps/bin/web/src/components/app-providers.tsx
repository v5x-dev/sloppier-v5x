import { ConvexProviderWithAuthKit } from "@convex-dev/workos"
import { AuthKitProvider, useAuth } from "@workos-inc/authkit-react"
import { useRouter } from "@tanstack/react-router"
import { Toaster } from "@v5x/ui/components/toast"
import { ConvexReactClient } from "convex/react"
import type { ReactNode } from "react"

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL)

export function AppProviders({ children }: { children: ReactNode }) {
  const router = useRouter()

  return (
    <AuthKitProvider
      clientId={import.meta.env.VITE_WORKOS_CLIENT_ID}
      devMode={import.meta.env.DEV}
      redirectUri={
        import.meta.env.VITE_WORKOS_REDIRECT_URI ??
        `${window.location.origin}/callback`
      }
      onRedirectCallback={({ state }) => {
        void router.navigate({
          to: safeReturnPath(state?.returnTo),
          replace: true,
        })
      }}
    >
      <ConvexProviderWithAuthKit client={convex} useAuth={useAuth}>
        <Toaster>{children}</Toaster>
      </ConvexProviderWithAuthKit>
    </AuthKitProvider>
  )
}

// `state` round-trips through the URL unsigned, so only same-origin paths are honored.
function safeReturnPath(returnTo: unknown) {
  if (typeof returnTo !== "string") return "/"
  const url = new URL(returnTo, window.location.origin)
  return url.origin === window.location.origin ? url.pathname : "/"
}
