import { defineConfig } from "vite"
import { randomUUID } from "node:crypto"
import { cloudflare } from "@cloudflare/vite-plugin"
import { devtools } from "@tanstack/devtools-vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

const release = randomUUID()

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  cacheDir: process.env.CODE_TEST_CACHE_DIR ?? "node_modules/.vite",
  plugins: [
    {
      name: "code-release-marker",
      resolveId(id) {
        if (id === "virtual:code-release") return "\0virtual:code-release"
      },
      load(id) {
        if (id === "\0virtual:code-release") {
          return `export default ${JSON.stringify(release)}`
        }
      },
      generateBundle() {
        if (this.environment.name === "client") {
          this.emitFile({
            type: "asset",
            fileName: "release.json",
            source: JSON.stringify({ release }),
          })
        }
      },
    },
    cloudflare({
      viteEnvironment: { name: "ssr" },
      ...(process.env.CODE_PR_PREVIEW === "1"
        ? { configPath: "wrangler.preview.jsonc" }
        : {}),
    }),
    devtools(),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
  // Discover the formatter before the first edit. Optimizing this worker-only
  // dependency on demand otherwise reloads the page and drops a connected Brain.
  optimizeDeps: { include: ["@wasm-fmt/clang-format/vite"] },
  worker: { format: "es" },
  build: {
    // Keep font files as separate requests. An inlined font rides along in the
    // stylesheet and loads on every page, even pages that never use it.
    assetsInlineLimit: (filePath) =>
      filePath.endsWith(".woff2") ? false : undefined,
  },
  server: {
    allowedHosts: ["dev.xdvaychyt7al.opentunnel.xyz", "code-dev.v5x.dev"],
  },
})

export default config
