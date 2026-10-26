import { createFileRoute } from "@tanstack/react-router"
import { logoutRedirect } from "@/lib/workos-session.server"

export const Route = createFileRoute("/user_management/sessions/logout")({
  server: {
    handlers: {
      GET: ({ request }) =>
        logoutRedirect(request, import.meta.env.VITE_WORKOS_CLIENT_ID),
    },
  },
})
