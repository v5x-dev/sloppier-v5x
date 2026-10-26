import type { ProgramData } from "@workspace/serial"

/** PROS hot/cold packages must be uploaded together; never guess between outputs. */
export function selectUploadProgram(
  files: Record<string, Uint8Array>
): ProgramData {
  const entries = Object.entries(files)
  const named = (name: string) =>
    entries.filter(([path]) => path.split("/").at(-1) === name)
  const hot = named("hot.package.bin"),
    cold = named("cold.package.bin")
  if (hot.length || cold.length) {
    if (hot.length !== 1 || cold.length !== 1)
      throw new Error(
        "Build must contain exactly one hot and one cold package. Build the program again."
      )
    if (
      hot[0][0].slice(0, -"hot.package.bin".length) !==
      cold[0][0].slice(0, -"cold.package.bin".length)
    )
      throw new Error(
        "Hot and cold packages must come from the same build folder."
      )
    if (!hot[0][1].length || !cold[0][1].length)
      throw new Error("Build contains an empty program binary.")
    return { type: "hot-cold", hot: hot[0][1], cold: cold[0][1] }
  }
  const monolith = named("monolith.bin")
  const candidates = monolith.length ? monolith : named("program.bin")
  const selected = candidates.length ? candidates : entries
  if (selected.length !== 1)
    throw new Error(
      "Build the program to generate a single binary or a hot/cold package pair."
    )
  if (!selected[0][1].length)
    throw new Error("Build contains an empty program binary.")
  return { type: "monolith", data: selected[0][1] }
}
