import { createFileRoute } from "@tanstack/react-router"
import { useAuth } from "@workos-inc/authkit-react"
import { useEffect } from "react"
import { SigningIn } from "@/components/signing-in"

// Starts AuthKit sign-in, forwarding any login hint.
export const Route = createFileRoute("/login")({
  validateSearch: (search): { login_hint?: string } =>
    typeof search.login_hint === "string"
      ? { login_hint: search.login_hint }
      : {},
  component: Login,
})

function Login() {
  const { isLoading, signIn } = useAuth()
  const { login_hint: loginHint } = Route.useSearch()

  useEffect(() => {
    if (!isLoading) void signIn({ loginHint })
  }, [isLoading, loginHint, signIn])

  return <SigningIn />
}
