import { ConvexProviderWithAuthKit } from "@convex-dev/workos"
import { AuthKitProvider, useAuth } from "@workos-inc/authkit-react"
import { UpdateNotice } from "@/components/app/update-notice"
import { Toaster } from "@v5x/ui/components/toast"
import { useRouter } from "@tanstack/react-router"
import { demoAccount, useDemoConvexAuth } from "@/lib/auth"
import { ConvexProviderWithAuth, ConvexReactClient } from "convex/react"
import type { ReactNode } from "react"

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL)

export function AppProviders({ children }: { children: ReactNode }) {
  const router = useRouter()
  const emulator =
    import.meta.env.DEV && import.meta.env.VITE_WORKOS_EMULATOR_URL
      ? new URL(import.meta.env.VITE_WORKOS_EMULATOR_URL)
      : undefined

  if (
    emulator &&
    (!["localhost", "127.0.0.1"].includes(emulator.hostname) ||
      emulator.protocol !== "http:")
  ) {
    throw new Error(
      "The development WorkOS emulator must use a loopback HTTP URL"
    )
  }

  const content = (
    <Toaster>
      {children}
      <UpdateNotice />
    </Toaster>
  )

  return (
    <AuthKitProvider
      clientId={import.meta.env.VITE_WORKOS_CLIENT_ID}
      devMode={import.meta.env.DEV}
      apiHostname={
        emulator?.hostname ??
        (import.meta.env.PROD ? window.location.hostname : undefined)
      }
      port={emulator ? Number(emulator.port) : undefined}
      https={emulator ? emulator.protocol === "https:" : undefined}
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
      {demoAccount() ? (
        <ConvexProviderWithAuth client={convex} useAuth={useDemoConvexAuth}>
          {content}
        </ConvexProviderWithAuth>
      ) : (
        <ConvexProviderWithAuthKit client={convex} useAuth={useAuth}>
          {content}
        </ConvexProviderWithAuthKit>
      )}
    </AuthKitProvider>
  )
}

// `state` round-trips through the URL unsigned, so only same-origin paths are honored.
function safeReturnPath(returnTo: unknown) {
  if (typeof returnTo !== "string") return "/"
  const url = new URL(returnTo, window.location.origin)
  return url.origin === window.location.origin ? url.pathname : "/"
}
