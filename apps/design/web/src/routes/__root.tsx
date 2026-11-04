import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
} from "@tanstack/react-router"

import appCss from "@v5x/ui/globals.css?url"
import tokenCss from "@v5x/tokens/design/web.css?url"
import { fontPreloadsForRoute } from "@v5x/ui/lib/font-preloads"

export const Route = createRootRoute({
  // The root head sees every match, so the leaf route picks the font preloads.
  head: ({ matches }) => ({
    meta: [
      {
        charSet: "utf-8",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
      {
        title: "design (by v5x)",
      },
    ],
    links: [
      {
        rel: "icon",
        type: "image/svg+xml",
        href: "/favicon.svg",
      },
      {
        rel: "stylesheet",
        href: appCss,
      },
      {
        rel: "stylesheet",
        href: tokenCss,
      },
      ...fontPreloadsForRoute(matches.at(-1)?.routeId),
    ],
  }),
  notFoundComponent: () => (
    <main className="container mx-auto p-4 pt-16 text-center">
      <h1>404</h1>
      <p>The requested page could not be found.</p>
    </main>
  ),
  shellComponent: RootDocument,
  component: () => <Outlet />,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
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
