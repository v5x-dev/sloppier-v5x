import { createFileRoute } from "@tanstack/react-router"
import { authorizationRedirect } from "@/lib/workos-session.server"

export const Route = createFileRoute("/user_management/authorize")({
  server: {
    handlers: {
      GET: ({ request }) =>
        authorizationRedirect(request, import.meta.env.VITE_WORKOS_CLIENT_ID),
    },
  },
})
