import {
  expect,
  test,
  type Page,
  type Locator,
  type BrowserContext,
} from "@playwright/test"
import { existsSync } from "node:fs"
import { performance } from "node:perf_hooks"

const runs = Number(process.env.PLAYWRIGHT_BENCHMARK_RUNS ?? 5)
if (!Number.isInteger(runs) || runs < 1 || runs > 100) {
  throw new Error("PLAYWRIGHT_BENCHMARK_RUNS must be an integer from 1 to 100")
}

const cpuRate = Number(process.env.PLAYWRIGHT_CPU_THROTTLE ?? 1)
if (!Number.isFinite(cpuRate) || cpuRate < 1 || cpuRate > 20) {
  throw new Error("PLAYWRIGHT_CPU_THROTTLE must be a number from 1 to 20")
}

async function measuredPage(context: BrowserContext) {
  const page = await context.newPage()
  if (cpuRate > 1) {
    const cdp = await context.newCDPSession(page)
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpuRate })
  }
  return page
}

const state =
  process.env.PLAYWRIGHT_AUTH_STATE ??
  (existsSync(".auth/state.json") ? ".auth/state.json" : undefined)
const demoUser = process.env.PLAYWRIGHT_DEMO_USER
const programId = process.env.PLAYWRIGHT_PROGRAM_ID

test.describe.configure({ mode: "serial" })

const waitVisible = (locator: Locator) =>
  expect
    .poll(() => locator.isVisible(), { intervals: [10], timeout: 20_000 })
    .toBe(true)

function summarize(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  const median =
    sorted.length % 2
      ? sorted[middle]
      : (sorted[middle - 1] + sorted[middle]) / 2
  return {
    medianMs: Math.round(median),
    minMs: Math.round(sorted[0]),
    p90Ms: Math.round(sorted[Math.ceil(sorted.length * 0.9) - 1]),
    maxMs: Math.round(sorted[sorted.length - 1]),
    samplesMs: values.map(Math.round),
  }
}

type Scenario = {
  name: string
  path: string
  ready: (page: Page) => Promise<void>
  storageState?: string
}
const scenarios: Scenario[] = [
  {
    name: "Not-found page",
    path: "/this-page-does-not-exist",
    ready: async (page) => {
      await waitVisible(page.getByRole("heading", { name: "404" }))
    },
  },
  {
    name: "Incomplete sign-in callback",
    path: "/callback",
    ready: async (page) => {
      await waitVisible(page.getByText("Sign-in didn't finish"))
    },
  },
]
if (state || demoUser) {
  scenarios.push({
    name: "Programs dashboard",
    path: demoUser ? `/?demoUser=${encodeURIComponent(demoUser)}` : "/",
    storageState: state,
    ready: async (page) => {
      await waitVisible(
        page.getByRole("heading", { name: "Programs", exact: true })
      )
      await waitVisible(page.getByRole("button", { name: "New pros program" }))
    },
  })
}
if ((state || demoUser) && programId) {
  scenarios.push({
    name: "Program editor",
    path: `/programs/${encodeURIComponent(programId)}${demoUser ? `?demoUser=${encodeURIComponent(demoUser)}` : ""}`,
    storageState: state,
    ready: async (page) => {
      await waitVisible(page.getByRole("button", { name: "Search program" }))
      await waitVisible(page.getByRole("button", { name: "New file" }))
      await waitVisible(page.getByRole("tabpanel").getByRole("textbox"))
    },
  })
}

for (const scenario of scenarios) {
  test(scenario.name, async ({ browser, baseURL }) => {
    const cold: number[] = []
    const reload: number[] = []
    const treeCold: number[] = []
    const treeReload: number[] = []
    for (let i = 0; i < runs; i++) {
      const context = await browser.newContext({
        baseURL,
        storageState: scenario.storageState,
      })
      try {
        const page = await measuredPage(context)
        let start = performance.now()
        await page.goto(scenario.path, { waitUntil: "domcontentloaded" })
        if (scenario.name === "Program editor") {
          await waitVisible(page.getByRole("button", { name: "New file" }))
          treeCold.push(performance.now() - start)
        }
        await scenario.ready(page)
        cold.push(performance.now() - start)
        start = performance.now()
        await page.reload({ waitUntil: "domcontentloaded" })
        if (scenario.name === "Program editor") {
          await waitVisible(page.getByRole("button", { name: "New file" }))
          treeReload.push(performance.now() - start)
        }
        await scenario.ready(page)
        reload.push(performance.now() - start)
      } finally {
        await context.close()
      }
    }
    console.log(
      JSON.stringify({
        scenario: scenario.name,
        runs,
        cpuRate,
        cold: summarize(cold),
        reload: summarize(reload),
        ...(treeCold.length
          ? { treeCold: summarize(treeCold), treeReload: summarize(treeReload) }
          : {}),
      })
    )
  })
}

if ((state || demoUser) && programId) {
  test("Open and edit a Program file", async ({ browser, baseURL }) => {
    const openTimes: number[] = []
    const editTimes: number[] = []
    for (let i = 0; i < runs; i++) {
      const context = await browser.newContext({ baseURL, storageState: state })
      try {
        const page = await measuredPage(context)
        await page.goto(
          `/programs/${encodeURIComponent(programId)}${demoUser ? `?demoUser=${encodeURIComponent(demoUser)}` : ""}`
        )
        await page.getByRole("button", { name: "Search program" }).click()
        await page
          .getByRole("textbox", { name: "Search text" })
          .fill(process.env.PLAYWRIGHT_EDITOR_SEARCH ?? "#include")
        const result = page.locator("[data-search-result]").first()
        await expect(result).toBeVisible()
        let start = performance.now()
        await result.click()
        const editor = page.getByRole("tabpanel").getByRole("textbox")
        await expect(editor).toBeVisible()
        openTimes.push(performance.now() - start)
        await editor.focus()
        await page.keyboard.press("Control+End")
        start = performance.now()
        await page.keyboard.type(" // benchmark")
        await expect(page.getByRole("button", { name: /Commit/ })).toBeVisible()
        editTimes.push(performance.now() - start)
        await page.keyboard.press("Control+z")
        await expect(page.getByRole("button", { name: /Commit/ })).toBeHidden()
      } finally {
        await context.close()
      }
    }
    console.log(
      JSON.stringify({
        scenario: "Open and edit a Program file",
        cpuRate,
        open: summarize(openTimes),
        edit: summarize(editTimes),
      })
    )
  })
}

if ((state || demoUser) && programId) {
  test("Open Program from dashboard", async ({ browser, baseURL }) => {
    const samples: number[] = []
    for (let i = 0; i < runs; i++) {
      const context = await browser.newContext({ baseURL, storageState: state })
      try {
        const page = await measuredPage(context)
        await page.goto(
          demoUser ? `/?demoUser=${encodeURIComponent(demoUser)}` : "/"
        )
        const link = page.locator(
          `a[href="/programs/${encodeURIComponent(programId)}"]`
        )
        await waitVisible(link)
        const start = performance.now()
        await link.click()
        await waitVisible(page.getByRole("button", { name: "New file" }))
        await waitVisible(page.getByRole("tabpanel").getByRole("textbox"))
        samples.push(performance.now() - start)
      } finally {
        await context.close()
      }
    }
    console.log(
      JSON.stringify({
        scenario: "Open Program from dashboard",
        runs,
        cpuRate,
        ...summarize(samples),
      })
    )
  })
}
