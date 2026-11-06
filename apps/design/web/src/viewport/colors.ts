// Colors for the scene, read from the design tokens at runtime, so the 3D view follows the
// suite's palette. The browser converts each token (an oklch value) to sRGB by painting it
// onto a canvas. If a token cannot be read, the fallback is used.

import { Color } from "three"

export type SceneColors = {
  background: Color
  grid: Color
  gridMajor: Color
  accent: Color
  snap: Color
  highlight: Color
  foreground: Color
}

const FALLBACK: Record<keyof SceneColors, string> = {
  background: "#17131a",
  grid: "#3a3440",
  gridMajor: "#56505e",
  accent: "#c94b8e",
  snap: "#f0569b",
  highlight: "#f2eef5",
  foreground: "#f2eef5",
}

const TOKENS: Record<keyof SceneColors, string> = {
  background: "--background",
  grid: "--border",
  gridMajor: "--field-border",
  accent: "--sidebar-primary",
  snap: "--sidebar-primary",
  highlight: "--foreground",
  foreground: "--foreground",
}

export function readSceneColors(
  root: HTMLElement = document.documentElement
): SceneColors {
  const style = getComputedStyle(root)
  const context = document
    .createElement("canvas")
    .getContext("2d", { willReadFrequently: true })
  const out = {} as SceneColors
  for (const key of Object.keys(TOKENS) as (keyof SceneColors)[]) {
    const token = style.getPropertyValue(TOKENS[key]).trim()
    out[key] = new Color(toHex(context, token) ?? FALLBACK[key])
  }
  return out
}

function toHex(
  context: CanvasRenderingContext2D | null,
  cssColor: string
): string | undefined {
  if (!context || !cssColor) return undefined
  context.clearRect(0, 0, 1, 1)
  context.fillStyle = "#000000"
  context.fillStyle = cssColor
  // Chrome keeps a color it cannot parse as the previous value, so unchanged means invalid.
  if (context.fillStyle === "#000000" && cssColor !== "#000000")
    return undefined
  context.fillRect(0, 0, 1, 1)
  const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data
  if (a === 0) return undefined
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`
}
