import { createStart } from "@tanstack/react-start"

// AuthKit, Convex, and the 3D workspace all need the browser.
export const startInstance = createStart(() => ({ defaultSsr: false }))
