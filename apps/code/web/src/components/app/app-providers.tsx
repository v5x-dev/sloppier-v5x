import { UpdateNotice } from "@/components/app/update-notice"
import { AuthProviders } from "@v5x/auth/providers"
import { Toaster } from "@v5x/ui/components/toast"
import { ConvexReactClient } from "convex/react"
import type { ReactNode } from "react"

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL)

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <AuthProviders convex={convex}>
      <Toaster>
        {children}
        <UpdateNotice />
      </Toaster>
    </AuthProviders>
  )
}
