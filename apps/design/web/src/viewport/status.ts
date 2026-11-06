// The types the viewport reports to the page. They live apart from the 3D code, so the
// editor page can use them without loading three.js.

export type Projection = "perspective" | "orthographic"

/** What the workspace reports upward. Sent only when a field changes. */
export type ViewportStatus = {
  parts: number
  invalid: number
  modelsLoading: number
  modelsFailed: string[]
  snap: string | null
  contextLost: boolean
}

export const INITIAL_STATUS: ViewportStatus = {
  parts: 0,
  invalid: 0,
  modelsLoading: 0,
  modelsFailed: [],
  snap: null,
  contextLost: false,
}
