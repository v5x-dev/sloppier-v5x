import { expect, test } from "@playwright/test"

const programId = process.env.PLAYWRIGHT_PROGRAM_ID
const alice = process.env.PLAYWRIGHT_DEMO_USER
const ben = process.env.PLAYWRIGHT_PEER_USER

test("independent sessions share edits, preserve local undo, and reconnect after reload", async ({
  browser,
}) => {
  test.skip(
    !programId || !alice || !ben,
    "Run bun run test:e2e:editor for isolated collaborators"
  )
  test.setTimeout(120_000)
  const a = await browser.newContext(),
    b = await browser.newContext()
  try {
    const left = await a.newPage(),
      right = await b.newPage()
    await Promise.all([
      left.goto(`/programs/${programId}?demoUser=${alice}`),
      right.goto(`/programs/${programId}?demoUser=${ben}`),
    ])
    const leftEditor = left.getByRole("tabpanel").getByRole("textbox")
    const rightEditor = right.getByRole("tabpanel").getByRole("textbox")
    await expect(leftEditor).toBeVisible({ timeout: 90_000 })
    await expect(rightEditor).toBeVisible({ timeout: 90_000 })
    await leftEditor.click()
    await left.keyboard.press("Control+End")
    await left.keyboard.type("\n// alice-shared-edit")
    await expect(rightEditor).toContainText("alice-shared-edit")
    await rightEditor.click()
    await right.keyboard.press("Control+End")
    await right.keyboard.type("\n// ben-shared-edit")
    await expect(leftEditor).toContainText("ben-shared-edit")
    await right.keyboard.press("Shift+ArrowLeft")
    await expect(left.getByLabel("Ben Demo's cursor").first()).toBeVisible()
    await leftEditor.click()
    await left.keyboard.press("Control+z")
    await expect(rightEditor).not.toContainText("alice-shared-edit")
    await expect(rightEditor).toContainText("ben-shared-edit")
    await left.reload()
    await expect(leftEditor).toContainText("ben-shared-edit")
    await rightEditor.click()
    await right.keyboard.press("Control+End")
    await right.keyboard.type("\n// after-reconnect")
    await expect(leftEditor).toContainText("after-reconnect")
    await right.keyboard.press("Control+s")
    await expect(
      right.getByRole("button", { name: /Commit \d+ file/ })
    ).toBeHidden({ timeout: 30_000 })
    await expect(
      left.getByRole("button", { name: /Commit \d+ file/ })
    ).toBeHidden({ timeout: 30_000 })
    await left.reload()
    await expect(leftEditor).toContainText("after-reconnect")
  } finally {
    await a.close()
    await b.close()
  }
})
