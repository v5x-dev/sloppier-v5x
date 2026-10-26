import { defineConfig } from "vite"
import { cloudflare } from "@cloudflare/vite-plugin"
import { devtools } from "@tanstack/devtools-vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [
    {
      name: "language-runtime-encoding",
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          if (
            /^\/language\/clangd-[a-f0-9]+\.wasm(?:\?|$)/.test(
              request.url ?? ""
            )
          ) {
            response.setHeader("Content-Encoding", "gzip")
            response.setHeader("Content-Type", "application/wasm")
          }
          next()
        })
      },
    },
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    devtools(),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
  worker: { format: "es" },
  server: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "credentialless",
    },
    allowedHosts: ["dev.xdvaychyt7al.opentunnel.xyz", "code-dev.v5x.dev"],
  },
})

export default config
