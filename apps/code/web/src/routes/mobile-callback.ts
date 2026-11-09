import { createFileRoute } from "@tanstack/react-router"
import { mobileCallbackResponse } from "@/lib/mobile-callback"

export const Route = createFileRoute("/mobile-callback")({
  server: {
    handlers: {
      GET: ({ request }) => mobileCallbackResponse(request),
    },
  },
})
