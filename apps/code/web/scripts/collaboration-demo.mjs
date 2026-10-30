import { startDemoSession } from "./demo-session.mjs"

await startDemoSession({
  names: ["Alice", "Ben", "Clara", "Diego"],
  programName: "Four editors live demo",
  template: "pros",
})
