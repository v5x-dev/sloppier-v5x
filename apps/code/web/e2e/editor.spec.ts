import { expect, test } from "@playwright/test"
import { existsSync } from "node:fs"

const state =
  process.env.PLAYWRIGHT_AUTH_STATE ??
  (existsSync(".auth/state.json") ? ".auth/state.json" : undefined)
const demoUser = process.env.PLAYWRIGHT_DEMO_USER
const programId = process.env.PLAYWRIGHT_PROGRAM_ID
const searchTerm = process.env.PLAYWRIGHT_EDITOR_SEARCH ?? "#include"

test.describe("program editor", () => {
  test.describe.configure({ mode: "serial" })
  test.skip(
    (!state && !demoUser) || !programId,
    "Set a signed-in state (or development demo user) and PLAYWRIGHT_PROGRAM_ID"
  )
  test.use({ storageState: state })

  test.beforeEach(async ({ page }) => {
    await page.goto(
      `/programs/${encodeURIComponent(programId!)}${demoUser ? `?demoUser=${encodeURIComponent(demoUser)}` : ""}`
    )
    await expect(
      page.getByRole("button", { name: "Search program" })
    ).toBeVisible()
    await expect(page.getByRole("button", { name: "New file" })).toBeVisible()
  })

  test("searches source and opens a matching file", async ({ page }) => {
    await page.getByRole("button", { name: "Search program" }).click()
    await page.getByRole("textbox", { name: "Search text" }).fill(searchTerm)
    const match = page.locator("[data-search-result]").first()
    await expect(match).toBeVisible()
    await match.click()
    await expect(
      page.getByRole("tablist", { name: "Open files" })
    ).toBeVisible()
    await expect(page.getByRole("tab", { selected: true })).toBeVisible()
  })

  test("keeps an opened file tab after reload", async ({ page }) => {
    await page.getByRole("button", { name: "Search program" }).click()
    await page.getByRole("textbox", { name: "Search text" }).fill(searchTerm)
    const match = page.locator("[data-search-result]").first()
    await expect(match).toBeVisible()
    await match.click()
    const tab = page.getByRole("tab", { selected: true })
    await expect(tab).toBeVisible()
    const name = await tab.getAttribute("title")
    expect(name).toBeTruthy()
    await page.reload()
    await expect(page.getByRole("tab", { selected: true })).toHaveAttribute(
      "title",
      name!
    )
  })

  test("opens and closes program search with its controls", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Search program" }).click()
    const input = page.getByRole("textbox", { name: "Search text" })
    await expect(input).toBeFocused()
    await input.fill(searchTerm)
    await page.getByRole("button", { name: "Match case" }).click()
    await expect(page.locator("[data-search-result]").first()).toBeVisible()
    await page.getByRole("button", { name: "Close search" }).click()
    await expect(input).toBeHidden()
  })

  test("opens search by shortcut and preserves its query after reopening", async ({
    page,
  }) => {
    await page.keyboard.press("Control+Shift+f")
    const input = page.getByRole("textbox", { name: "Search text" })
    await expect(input).toBeFocused()
    await input.fill(searchTerm)
    await page.getByRole("button", { name: "Close search" }).click()
    await expect(input).toBeHidden()
    await page.getByRole("button", { name: "Search program" }).click()
    await expect(input).toHaveValue(searchTerm)
  })

  test("opens history and a commit diff", async ({ page }) => {
    await page.getByRole("button", { name: "Program history" }).click()
    const history = page.getByRole("dialog", { name: "Program history" })
    await expect(history).toBeVisible()
    await expect(history.getByText("Loading commits…")).toBeHidden()
    await history.getByRole("button", { name: /Create pros program/ }).click()
    await expect(page.getByLabel("Commit file diff")).toBeVisible()
  })

  test("edits a file and undoes the change", async ({ page }) => {
    await page.getByRole("button", { name: "Search program" }).click()
    await page.getByRole("textbox", { name: "Search text" }).fill(searchTerm)
    const match = page.locator("[data-search-result]").first()
    await expect(match).toBeVisible()
    await match.click()
    await expect(
      page.getByRole("textbox", { name: "Search text" })
    ).toBeHidden()
    const editor = page.getByRole("tabpanel").getByRole("textbox")
    await expect(editor).toBeVisible()
    await editor.click()
    await page.keyboard.press("Control+End")
    await page.keyboard.type(" // playwright-edit-check")
    await expect(page.getByRole("button", { name: /Commit/ })).toBeVisible()
    await page.keyboard.press("Control+z")
    await expect(page.getByRole("button", { name: /Commit/ })).toBeHidden()
  })

  test("keeps new lines visible when editing at the bottom", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Search program" }).click()
    await page.getByRole("textbox", { name: "Search text" }).fill(searchTerm)
    await page.locator("[data-search-result]").first().click()
    await expect(
      page.getByRole("textbox", { name: "Search text" })
    ).toBeHidden()
    const panel = page.getByRole("tabpanel")
    const editor = panel.getByRole("textbox")
    await expect(editor).toBeVisible()
    await editor.click()
    await page.keyboard.press("Control+End")
    for (let i = 0; i < 40; i++) await page.keyboard.press("Enter")
    await expect
      .poll(() =>
        panel.evaluate(
          (element) =>
            element.scrollHeight - element.clientHeight - element.scrollTop
        )
      )
      .toBeLessThanOrEqual(1)
    for (let i = 0; i < 40; i++) {
      if (!(await page.getByRole("button", { name: /Commit/ }).isVisible()))
        break
      await page.keyboard.press("Control+z")
    }
  })

  test("keeps split editor groups after reload and closes only the selected copy", async ({
    page,
  }) => {
    await expect(page.getByRole("tabpanel").getByRole("textbox")).toBeVisible()
    await page
      .getByRole("button", { name: "Split editor", exact: true })
      .click()
    await expect(page.getByRole("tablist", { name: "Open files" })).toHaveCount(
      2
    )
    await page.reload()
    await expect(page.getByRole("tablist", { name: "Open files" })).toHaveCount(
      2
    )
    await page
      .getByRole("button", { name: "Close src/main.cpp", exact: true })
      .last()
      .click()
    await expect(page.getByRole("tablist", { name: "Open files" })).toHaveCount(
      1
    )
    await expect(page.getByRole("tabpanel").getByRole("textbox")).toBeVisible()
  })
})
