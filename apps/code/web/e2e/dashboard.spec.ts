import { expect, test } from "@playwright/test"
import { existsSync } from "node:fs"

// Supply a Playwright storage state for a dedicated test account with a workspace.
const state =
  process.env.PLAYWRIGHT_AUTH_STATE ??
  (existsSync(".auth/state.json") ? ".auth/state.json" : undefined)

test.describe("signed-in dashboard", () => {
  test.skip(
    !state,
    "Set PLAYWRIGHT_AUTH_STATE to a signed-in test account's storage state"
  )
  test.use({ storageState: state })

  test.beforeEach(async ({ page }) => {
    await page.goto("/")
    await expect(
      page.getByRole("heading", { name: "Programs", exact: true })
    ).toBeVisible()
    await expect(
      page
        .getByRole("region", { name: "Create program" })
        .getByRole("button", { name: "New PROS program", exact: true })
    ).toBeVisible()
  })

  test("shows a tile for each program template", async ({ page }) => {
    const create = page.getByRole("region", { name: "Create program" })
    for (const label of ["VEXCode", "JAR", "PROS", "EZ", "RW"]) {
      await expect(
        create.getByRole("button", {
          name: `New ${label} program`,
          exact: true,
        })
      ).toBeVisible()
    }
  })

  test("opens the new program dialog from a template tile", async ({
    page,
  }) => {
    await page
      .getByRole("region", { name: "Create program" })
      .getByRole("button", { name: "New PROS program", exact: true })
      .click()
    const dialog = page.getByRole("dialog", { name: "New program" })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole("button", { name: "PROS" })).toHaveAttribute(
      "aria-pressed",
      "true"
    )
    await dialog.getByRole("button", { name: "Cancel" }).click()
    await expect(dialog).toBeHidden()
  })

  test("opens and cancels the new program dialog", async ({ page }) => {
    await page
      .getByRole("region", { name: "Create program" })
      .getByRole("button", { name: "New VEXCode program", exact: true })
      .click()
    const dialog = page.getByRole("dialog", { name: "New program" })
    await expect(dialog).toBeVisible()
    await dialog.getByLabel("Name").fill("Playwright draft")
    await dialog.getByRole("button", { name: "Cancel" }).click()
    await expect(dialog).toBeHidden()
  })

  test("filters programs and clears the search with Escape", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Search programs" }).click()
    const search = page.getByRole("searchbox", { name: "Search programs" })
    await search.fill("playwright-no-matching-program-987654321")
    await expect(page.getByText(/No matches|No programs yet/)).toBeVisible()
    await search.press("Escape")
    await expect(search).toBeHidden()
    await expect(
      page.getByRole("button", { name: "Search programs", exact: true })
    ).toBeVisible()
  })

  test("toggles the archived program view", async ({ page }) => {
    const archived = page.getByRole("button", {
      name: "Show archived programs",
    })
    await expect(archived).toHaveAttribute("aria-pressed", "false")
    await archived.click()
    await expect(archived).toHaveAttribute("aria-pressed", "true")
    await archived.click()
    await expect(archived).toHaveAttribute("aria-pressed", "false")
  })

  test("opens the workspace and account menus", async ({ page }) => {
    await page.getByRole("button", { name: "Switch workspace" }).click()
    await expect(
      page.getByRole("menuitem", { name: "New workspace" })
    ).toBeVisible()
    await page.keyboard.press("Escape")
    await page.getByRole("button", { name: "Account menu" }).click()
    await expect(
      page.getByRole("menuitem", { name: "Invitations" })
    ).toBeVisible()
    await expect(page.getByRole("menuitem", { name: "Sign out" })).toBeVisible()
  })
})
