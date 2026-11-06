import { createFileRoute } from "@tanstack/react-router"
import { LoginPage } from "@v5x/auth/gate"

export const Route = createFileRoute("/login")({
  validateSearch: (search): { login_hint?: string } =>
    typeof search.login_hint === "string"
      ? { login_hint: search.login_hint }
      : {},
  component: Login,
})

function Login() {
  const { login_hint: loginHint } = Route.useSearch()
  return <LoginPage loginHint={loginHint} />
}
