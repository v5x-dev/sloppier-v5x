import { Navigate } from "@tanstack/react-router"
import { useAuth } from "@workos-inc/authkit-react"
import type { ReactNode } from "react"
import { SigningIn } from "@/components/signing-in"

// Queries throw until someone is signed in, so pages wait here first.
export function RequireSignIn({ children }: { children: ReactNode }) {
  const { isLoading, user } = useAuth()
  if (isLoading) return <SigningIn />
  if (!user) return <Navigate to="/login" replace />
  return <>{children}</>
}
