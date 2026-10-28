import { chromium } from "@playwright/test"
import { mkdir } from "node:fs/promises"
import { dirname } from "node:path"

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:4173"
const state = process.env.PLAYWRIGHT_AUTH_STATE ?? ".auth/state.json"
const browser = await chromium.launch({ headless: false })
try {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(baseURL)
  console.log(
    "Sign in in the browser. The session is saved after the Programs dashboard loads."
  )
  await page
    .getByRole("heading", { name: "Programs", exact: true })
    .waitFor({ timeout: 300_000 })
  await page
    .getByRole("region", { name: "Create program" })
    .getByRole("button", { name: "New pros program" })
    .waitFor({ timeout: 60_000 })
  await mkdir(dirname(state), { recursive: true })
  await context.storageState({ path: state, indexedDB: true })
  console.log(`Signed-in session saved to ${state}`)
} finally {
  await browser.close()
}
