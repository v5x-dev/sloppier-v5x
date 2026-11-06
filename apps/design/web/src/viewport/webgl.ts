// Whether this browser can draw the 3D view. Checked before the canvas mounts, so a
// browser without WebGL gets a clear message instead of a blank page.

export function webglAvailable(): boolean {
  try {
    const canvas = document.createElement("canvas")
    return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"))
  } catch {
    return false
  }
}
