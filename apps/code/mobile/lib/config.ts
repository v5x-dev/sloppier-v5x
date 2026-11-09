// Public identifiers, safe to ship in the app. The defaults are the production values
// that match the web app's .env.production. Point a build at another environment (for
// example, staging) with EXPO_PUBLIC_* variables in apps/code/mobile/.env.local.
export const workosClientId =
  process.env.EXPO_PUBLIC_WORKOS_CLIENT_ID ?? "client_01M5NYG06JMYXC4TAYX2Z3WYJD"

export const convexUrl =
  process.env.EXPO_PUBLIC_CONVEX_URL ?? "https://different-fly-767.convex.cloud"

// Must be registered with WorkOS for workosClientId. The code web deployment serves it
// (src/routes/mobile-callback.ts) and forwards the result to the app's return address.
export const workosMobileRedirectUri =
  process.env.EXPO_PUBLIC_WORKOS_MOBILE_REDIRECT_URI ??
  "https://code.v5x.dev/mobile-callback"
