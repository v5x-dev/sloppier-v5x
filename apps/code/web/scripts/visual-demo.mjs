// Starts one authenticated Code web fixture for visual checks. The printed
// links let separate browser sessions inspect the same seeded app state.
import { startDemoSession } from "./demo-session.mjs"

const template = process.argv[2] ?? "ez-template"
const port = process.env.CODE_DEMO_PORT
  ? Number.parseInt(process.env.CODE_DEMO_PORT, 10)
  : undefined

if (
  port !== undefined &&
  (!Number.isInteger(port) || port < 1 || port > 65535)
) {
  throw new Error("CODE_DEMO_PORT must be a valid TCP port")
}

await startDemoSession({
  names: ["Luna"],
  programName: `Visual review (${template})`,
  template,
  port,
})
