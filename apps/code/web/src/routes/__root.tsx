import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
} from "@tanstack/react-router"

import appCss from "@workspace/ui/globals.css?url"
import tokenCss from "@workspace/tokens/code/web.css?url"
import noiseCss from "../noise.css?url"
import { AppProviders } from "@/components/app/app-providers"
import { useEffect } from "react"

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: "utf-8",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
      {
        title: "code (by v5x)",
      },
      {
        name: "theme-color",
        content: "#171717",
      },
    ],
    links: [
      {
        rel: "icon",
        type: "image/svg+xml",
        href: "/favicon.svg",
      },
      {
        rel: "manifest",
        href: "/manifest.json",
      },
      {
        rel: "apple-touch-icon",
        href: "/icons/apple-touch-icon.png",
      },
      {
        rel: "stylesheet",
        href: appCss,
      },
      {
        rel: "stylesheet",
        href: tokenCss,
      },
      {
        rel: "stylesheet",
        href: noiseCss,
      },
    ],
  }),
  notFoundComponent: () => (
    <main className="container mx-auto p-4 pt-16 text-center">
      <h1>404</h1>
      <p>The requested page could not be found.</p>
    </main>
  ),
  shellComponent: RootDocument,
  component: RootComponent,
})

function RootComponent() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js").catch((error) => {
        console.error("Service worker registration failed", error)
      })
    }
  }, [])

  return (
    <AppProviders>
      <Outlet />
    </AppProviders>
  )
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <HeadContent />
      </head>
      <body className="font-serif">
        {children}
        <Scripts />
      </body>
    </html>
  )
}
