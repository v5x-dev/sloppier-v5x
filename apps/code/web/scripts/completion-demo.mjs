// Starts a one-account PROS program for exercising local autocomplete.
// Usage: node apps/code/web/scripts/completion-demo.mjs [pros|ez-template|vexcode|jar]
// See docs/autocomplete.md for the agent-browser walkthrough.
import { startDemoSession } from "./demo-session.mjs"

const template = process.argv[2] ?? "pros"
startDemoSession({
  names: ["Alice"],
  programName: `Autocomplete check (${template})`,
  template,
})
