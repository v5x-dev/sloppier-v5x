import { defineApp, type ComponentDefinition } from "convex/server"
import presence from "@convex-dev/presence/convex.config.js"

const app = defineApp()
// Bun resolves separate peer instances of Convex for this app and presence.
// Normalize the component type at the package boundary.
app.use(presence as unknown as ComponentDefinition)

export default app
