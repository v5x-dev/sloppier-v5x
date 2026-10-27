import type { ApiDatabase } from "./types"

export async function loadDatabase(template: string): Promise<ApiDatabase> {
  switch (template) {
    case "pros":
      return (await import("./data/pros.json")).default
    case "ez-template":
      return (await import("./data/ez-template.json")).default
    case "vexcode":
    case "jar":
      return (await import("./data/vexcode.json")).default
    default:
      throw new Error(`Unsupported program template: ${template}`)
  }
}
export async function loadSdkSources(
  template: string
): Promise<Record<string, string>> {
  switch (template) {
    case "pros":
      return (await import("./data/pros-sources.json")).default
    case "ez-template":
      return (await import("./data/ez-template-sources.json")).default
    case "vexcode":
    case "jar":
      return (await import("./data/vexcode-sources.json")).default
    default:
      throw new Error(`Unsupported program template: ${template}`)
  }
}
