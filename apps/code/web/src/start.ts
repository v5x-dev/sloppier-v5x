import { createMiddleware, createStart } from "@tanstack/react-start"
import { setResponseHeader } from "@tanstack/react-start/server"

// clangd's pthread runtime needs SharedArrayBuffer. Credentialless keeps public
// cross-origin images usable without requiring their hosts to add CORP headers.
const languageIsolation = createMiddleware().server(async ({ next }) => {
  setResponseHeader("Cross-Origin-Opener-Policy", "same-origin")
  setResponseHeader("Cross-Origin-Embedder-Policy", "credentialless")
  return next()
})

// AuthKit, Convex, and the Pierre editor and file tree all need the browser.
export const startInstance = createStart(() => ({
  defaultSsr: false,
  requestMiddleware: [languageIsolation],
}))
