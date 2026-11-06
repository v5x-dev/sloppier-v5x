import * as Alchemy from "alchemy"
import * as Cloudflare from "@alchemy.run/cloudflare"
import * as Effect from "effect/Effect"

// The Design web app, a TanStack Start site, deployed as a Cloudflare Worker.
// Stage names come from `--stage`; each stage keeps its own state and resources.
// `DESIGN_DOMAIN` serves the stage on a custom domain that WorkOS accepts.
export const Website = Cloudflare.Website.Vite("Design", {
  domain: process.env.DESIGN_DOMAIN,
})

export default Alchemy.Stack(
  "V5xDesign",
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const website = yield* Website

    return {
      websiteUrl: website.url.as<string>(),
    }
  })
)
