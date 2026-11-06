import { createStart } from "@tanstack/react-start"

// AuthKit and Convex need the browser, so pages render on the client only.
export const startInstance = createStart(() => ({ defaultSsr: false }))
