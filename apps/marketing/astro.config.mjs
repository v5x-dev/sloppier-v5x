import { defineConfig } from "astro/config"
import tailwindcss from "@tailwindcss/vite"

export default defineConfig({
  server: {
    allowedHosts: [".trycloudflare.com"],
  },
  vite: {
    plugins: [tailwindcss()],
  },
})
