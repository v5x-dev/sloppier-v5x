import * as Alchemy from "alchemy"
import * as Cloudflare from "@alchemy.run/cloudflare"
import * as Effect from "effect/Effect"

// The Design web app, a TanStack Start site, deployed as a Cloudflare Worker.
// Stage names come from `--stage`; each stage keeps its own state and resources.
// `DESIGN_DOMAIN` serves the stage on a custom domain that WorkOS accepts.
export const Website = Cloudflare.Website.Vite("Design", {
  domain: process.env.DESIGN_DOMAIN,
})

// The Part models: GLB files converted from VEX's STEP files by infra/parts and
// uploaded with infra/parts/upload.mjs. Every object is named by its content hash, so
// it is served with an immutable cache header and read by the browser directly.
export const Models = Cloudflare.R2.Bucket("DesignModels", {
  publicAccess: true,
  cors: [
    {
      allowedMethods: ["GET", "HEAD"],
      allowedOrigins: ["*"],
      maxAgeSeconds: 86400,
    },
  ],
})

export default Alchemy.Stack(
  "V5xDesign",
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const website = yield* Website
    const models = yield* Models

    return {
      websiteUrl: website.url.as<string>(),
      modelsBucket: models.bucketName.as<string>(),
      // The r2.dev host is rate-limited and meant for development. Production needs a
      // custom domain on the bucket before launch.
      modelsBaseUrl: models.publicDomain.as<string | undefined>(),
    }
  })
)
