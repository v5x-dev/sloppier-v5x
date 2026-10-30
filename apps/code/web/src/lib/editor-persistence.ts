/** Device-local editor preferences only; source text remains in live documents. */
export function readEditorState<T>(key: string): T | null {
  try {
    return JSON.parse(
      localStorage.getItem(`v5x:editor:${key}`) ?? "null"
    ) as T | null
  } catch {
    return null
  }
}

export function writeEditorState(key: string, value: unknown) {
  try {
    localStorage.setItem(`v5x:editor:${key}`, JSON.stringify(value))
  } catch {
    // Editing still works when browser storage is unavailable or full.
  }
}

export function readAutonRoute(programId: string): string {
  const saved = readEditorState<unknown>(`${programId}:auton-route`)
  return typeof saved === "string" ? saved : ""
}

export function writeAutonRoute(programId: string, routeId: string) {
  writeEditorState(`${programId}:auton-route`, routeId)
}

export type AutonDimension = "trackWidth" | "robotWidth" | "robotLength"

export function readAutonDimension(
  programId: string,
  dimension: AutonDimension
): number {
  const value = readEditorState<unknown>(`${programId}:auton-${dimension}`)
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 1 &&
    value <= 36
    ? value
    : 12
}

export function writeAutonDimension(
  programId: string,
  dimension: AutonDimension,
  value: number
) {
  writeEditorState(`${programId}:auton-${dimension}`, value)
}

export type FileView = {
  selections: {
    start: number
    end: number
    direction: "forward" | "backward"
  }[]
  top: number
  left: number
  codeLeft?: number
}
