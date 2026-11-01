import { expect, test } from "@playwright/test"

const programId = process.env.PLAYWRIGHT_PROGRAM_ID
const user = process.env.PLAYWRIGHT_DEMO_USER
const builder = process.env.PLAYWRIGHT_BUILDER_URL
const brainScript = process.env.PLAYWRIGHT_BRAIN_SCRIPT

test("uploads through the real workbench, reuses the installed revision, and reports a failed build", async ({
  page,
  request,
}) => {
  test.skip(
    !programId || !user || !builder || !brainScript,
    "Run bun run test:e2e:editor for the simulated Builder and Brain"
  )
  test.setTimeout(180_000)
  await page.addInitScript({ path: brainScript! })
  await page.goto(`/programs/${programId}?demoUser=${user}`)
  const editor = page.getByRole("tabpanel").getByRole("textbox")
  await expect(editor).toBeVisible({ timeout: 90_000 })
  await page
    .getByRole("button", { name: "Connect V5 Brain", exact: true })
    .click()
  await page.getByRole("button", { name: "USB", exact: true }).click()
  await expect(page.getByText("USB connected", { exact: true })).toBeVisible()
  await page.keyboard.press("Escape")
  await page
    .getByRole("button", { name: "Upload to V5 Brain", exact: true })
    .click()
  await page
    .getByRole("button", { name: "Upload to slot 1", exact: true })
    .click()
  await expect(
    page.getByText("Uploaded to slot 1 and started.", { exact: true })
  ).toBeVisible({ timeout: 90_000 })
  const before = await (await request.get(`${builder}/__control`)).json()
  expect(before.builds).toBeGreaterThan(0)
  await page
    .getByRole("button", { name: "Upload to slot 1", exact: true })
    .click()
  await expect(
    page.getByText("Slot 1 already has this version.", { exact: true })
  ).toBeVisible()
  expect(
    (await (await request.get(`${builder}/__control`)).json()).builds
  ).toBe(before.builds)
  await page.keyboard.press("Escape")
  await editor.click()
  await page.keyboard.press("Control+End")
  await page.keyboard.type("\n// force-failed-build")
  await request.post(`${builder}/__control`, { data: { failNext: true } })
  await page.keyboard.press("Control+Shift+b")
  await expect(
    page.getByText(/Build failed or was replaced/).first()
  ).toBeVisible({ timeout: 90_000 })
})
