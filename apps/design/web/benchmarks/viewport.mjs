#!/usr/bin/env node
// Loads 2,000 Parts, mostly screws, into a new Design and measures the viewport.
//
//   BENCH_URL=http://127.0.0.1:3002 BENCH_EMAIL=you@example.test node benchmarks/viewport.mjs
//
// BENCH_URL is a dev server signed in through the WorkOS emulator: the numbers come from
// `window.__designBench`, which production builds do not have. BENCH_ARGS passes Chromium
// flags, such as `--use-angle=swiftshader` for software GL. BENCH_SHOT saves a screenshot.
// BENCH_CPU_THROTTLE slows the page's CPU by that factor, to approximate a slower machine.
// The renderer it ran on is printed, because a number means little without it.

import { chromium } from "@playwright/test"

const url = process.env.BENCH_URL
const email = process.env.BENCH_EMAIL ?? "bench@example.test"
if (!url) {
  console.error("Set BENCH_URL to a Design dev server.")
  process.exit(1)
}

/** [catalog id, length in mm or undefined, how many]. Adds up to 2,000. */
export const MIX = [
  ["screw-8-32-1", undefined, 500],
  ["screw-8-32-2", undefined, 220],
  ["screw-6-32-1-2", undefined, 400],
  ["screw-6-32-1-4", undefined, 300],
  ["nut-8-32-hex", undefined, 200],
  ["standoff-1", undefined, 80],
  ["standoff-1-2", undefined, 60],
  ["channel-1x2x1-aluminum", 444.5, 40],
  ["channel-1x2x1-aluminum", 254, 40],
  ["channel-1x2x1-aluminum", 127, 40],
  ["angle-1x1-aluminum", 254, 30],
  ["shaft-square-1-4", 100, 40],
  ["motor-v5-smart-11w", undefined, 12],
  ["wheel-omni-4", undefined, 8],
  ["gusset-90-flat", undefined, 20],
  ["plate-5x15-steel", undefined, 10],
]

const browser = await chromium.launch({
  args: (process.env.BENCH_ARGS ?? "").split(" ").filter(Boolean),
})
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } })
page.setDefaultTimeout(120_000)

await page.goto(`${url}/`)
await page.locator('input[name="email"]').fill(email)
await page.getByRole("button", { name: "Continue" }).click()
await page.getByRole("button", { name: "New Design" }).first().click()
await page.getByRole("textbox", { name: "Name" }).fill("2,000 Parts")
await page.getByRole("button", { name: "Create" }).click()
await page.getByRole("status").getByText("Saved").waitFor()
await page.locator("canvas").first().waitFor()
await page.waitForFunction(() => "__designBench" in window)

const load = await page.evaluate(async (mix) => {
  const { doc, placePart, store } = window.__designBench
  const entries = mix.flatMap(([catalogId, lengthMm, n]) =>
    Array.from({ length: n }, () => ({ catalogId, lengthMm }))
  )
  const side = Math.ceil(Math.sqrt(entries.length))
  const started = performance.now()
  doc.transact(() => {
    entries.forEach((entry, i) => {
      const position = [
        (i % side) * 25 - (side * 25) / 2,
        30,
        Math.floor(i / side) * 25 - (side * 25) / 2,
      ]
      placePart(doc, {
        ...entry,
        position,
        rotation: [0, 0, 0, 1],
        color: "#8a909a",
      })
    })
  })
  return {
    insertAndSyncMs: performance.now() - started,
    parts: entries.length,
    stats: store.stats(),
  }
}, MIX)

await page.waitForFunction(
  (n) =>
    (document.querySelector("footer")?.textContent ?? "").includes(
      `${n} parts`
    ),
  load.parts
)
await page.keyboard.press("f")
// Wait for every model, so frames draw all of the geometry.
await page.waitForFunction(
  () =>
    !document.body.textContent.includes("model") ||
    !/Loading \d+ model/.test(document.body.textContent)
)

// Hold an orbit drag and count the frames actually rendered.
const throttle = Number(process.env.BENCH_CPU_THROTTLE ?? 1)
if (throttle > 1) {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle })
}
const box = await page.locator("canvas").first().boundingBox()
const cx = box.x + box.width / 2
const cy = box.y + box.height / 2
const frames = () =>
  page.evaluate(() => window.__designBench.renderer.info.render.frame)
await page.mouse.move(cx, cy)
await page.mouse.down()
const f0 = await frames()
const t0 = Date.now()
let moves = 0
while (Date.now() - t0 < 10_000) {
  moves += 1
  await page.mouse.move(
    cx + Math.sin(moves / 4) * 200,
    cy + Math.cos(moves / 4) * 60
  )
}
const elapsed = Date.now() - t0
const f1 = await frames()
await page.mouse.up()

const after = await page.evaluate(() => {
  const { renderer, store, doc, placePart } = window.__designBench
  const started = performance.now()
  const id = placePart(doc, {
    catalogId: "screw-8-32-1",
    position: [0, 30, 0],
    rotation: [0, 0, 0, 1],
    color: "#8a909a",
  })
  const placeOneMs = performance.now() - started
  doc.getMap("parts").delete(id)
  const context = renderer.getContext()
  const debug = context.getExtension("WEBGL_debug_renderer_info")
  return {
    renderer: debug
      ? context.getParameter(debug.UNMASKED_RENDERER_WEBGL)
      : "unknown",
    drawCalls: renderer.info.render.calls,
    trianglesPerFrame: renderer.info.render.triangles,
    placeOneMs,
    stats: store.stats(),
  }
})
if (process.env.BENCH_SHOT)
  await page.screenshot({ path: process.env.BENCH_SHOT, timeout: 120_000 })

console.log(
  JSON.stringify(
    {
      renderer: after.renderer,
      viewport: "1366x768, device pixel ratio 1",
      cpuThrottle: throttle,
      parts: load.parts,
      insertAndSyncMs: Math.round(load.insertAndSyncMs),
      placeOnePartWith2000Ms: Math.round(after.placeOneMs * 10) / 10,
      drawCalls: after.drawCalls,
      trianglesPerFrame: after.trianglesPerFrame,
      instancedMeshes: after.stats.meshes,
      framesRendered: f1 - f0,
      seconds: elapsed / 1000,
      msPerFrame: Math.round((elapsed / Math.max(1, f1 - f0)) * 10) / 10,
      fps: Math.round(((f1 - f0) / (elapsed / 1000)) * 10) / 10,
    },
    null,
    2
  )
)
await browser.close()
