// Font files each page renders first, preloaded in the document head. Vite hashes
// the URLs. The mapping is keyed by route id. Keep it in step with the routes and
// with the font-faces in styles/fonts.css.
import dmSansLatin from "../fonts/dm-sans-latin.woff2?url"
import jetbrainsMonoLatin from "../fonts/jetbrains-mono-latin.woff2?url"
import merriweatherLatin from "../fonts/merriweather-latin.woff2?url"

const fontPreload = (href: string) =>
  ({
    rel: "preload",
    as: "font",
    type: "font/woff2",
    href,
    crossOrigin: "anonymous",
  }) as const

const serif = fontPreload(merriweatherLatin)
const sans = fontPreload(dmSansLatin)
const mono = fontPreload(jetbrainsMonoLatin)

// Login renders no text, so it preloads nothing.
const preloadsByRoute: Record<string, Array<ReturnType<typeof fontPreload>>> = {
  "/": [serif, sans],
  "/callback": [serif],
  "/invites/$invitationId": [serif],
  "/programs/$programId": [serif, mono],
}

export function fontPreloadsForRoute(routeId: string | undefined) {
  return routeId ? (preloadsByRoute[routeId] ?? []) : []
}
