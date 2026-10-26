import { createFileRoute } from "@tanstack/react-router"
import { authenticate } from "@/lib/workos-session.server"

export const Route = createFileRoute("/user_management/authenticate")({
  server: {
    handlers: {
      POST: ({ request }) =>
        authenticate(request, import.meta.env.VITE_WORKOS_CLIENT_ID),
    },
  },
})
