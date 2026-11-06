import "@tanstack/react-start/server-only"
import {
  authenticate as authenticateWith,
  logoutRedirect as logoutRedirectWith,
} from "@v5x/auth/session.server"

export { authorizationRedirect } from "@v5x/auth/session.server"

const refreshCookie = "__Host-design-refresh"

export function authenticate(request: Request, clientId: string) {
  return authenticateWith(refreshCookie, request, clientId)
}

export function logoutRedirect(request: Request, clientId: string) {
  return logoutRedirectWith(refreshCookie, request, clientId)
}
