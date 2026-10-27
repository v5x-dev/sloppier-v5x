import { createStart } from "@tanstack/react-start"

// AuthKit, Convex, and the Pierre editor and file tree all need the browser.
export const startInstance = createStart(() => ({ defaultSsr: false }))
