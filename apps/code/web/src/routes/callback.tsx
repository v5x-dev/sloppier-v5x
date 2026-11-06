import { createFileRoute } from "@tanstack/react-router"
import { CallbackPage } from "@v5x/auth/gate"

export const Route = createFileRoute("/callback")({
  component: CallbackPage,
})
