import { expect, test } from "@playwright/test"

test.skip(
  process.env.PLAYWRIGHT_WORKOS_EMULATOR !== "1",
  "Run with the isolated WorkOS emulator setup"
)

test("protected Program links redirect to sign-in before exposing an editor", async ({
  page,
}) => {
  await page.goto("/programs/not-a-program")
  await expect(page.locator('input[name="email"]')).toBeVisible()
  await expect(
    page.getByRole("button", { name: "Search program" })
  ).toBeHidden()
})

test("unknown routes show a not-found page", async ({ page }) => {
  await page.goto("/not-a-real-page")
  await expect(page.getByRole("heading", { name: "404" })).toBeVisible()
})

test("signs in through AuthKit and restores the session after reload", async ({
  page,
}) => {
  await page.goto("/")
  await page.locator('input[name="email"]').fill("playwright@example.test")
  await page.getByRole("button", { name: "Continue" }).click()
  await expect(
    page.getByRole("heading", { name: "Programs", exact: true })
  ).toBeVisible()
  await expect(
    page
      .getByRole("region", { name: "Create program" })
      .getByRole("button", { name: "New pros program" })
  ).toBeVisible()
  await page.reload()
  await expect(
    page.getByRole("heading", { name: "Programs", exact: true })
  ).toBeVisible()
  await expect(
    page
      .getByRole("region", { name: "Create program" })
      .getByRole("button", { name: "New pros program" })
  ).toBeVisible()
})

test("edits and commits a disposable Program after WorkOS sign-in", async ({
  page,
}) => {
  test.skip(
    process.env.PLAYWRIGHT_WORKOS_EDITOR !== "1",
    "Requires disposable Code Storage-backed Program provisioning"
  )
  test.setTimeout(120_000)
  await page.goto("/")
  await page.locator('input[name="email"]').fill("playwright@example.test")
  await page.getByRole("button", { name: "Continue" }).click()
  const create = page
    .getByRole("region", { name: "Create program" })
    .getByRole("button", { name: "New pros program" })
  await expect(create).toBeVisible()
  await create.click()
  const dialog = page.getByRole("dialog", { name: "New program" })
  await dialog.getByLabel("Name").fill("Playwright auth startup check")
  await dialog.getByRole("button", { name: "Create program" }).click()
  await expect(page.getByRole("button", { name: "New file" })).toBeVisible({
    timeout: 90_000,
  })
  await expect(page.getByRole("tabpanel").getByRole("textbox")).toBeVisible({
    timeout: 30_000,
  })
  const editor = page.getByRole("tabpanel").getByRole("textbox")
  await editor.click()
  await page.keyboard.press("Control+End")
  await page.keyboard.type(" // playwright-commit-check")
  await expect(page.getByRole("button", { name: /Commit/ })).toBeVisible()
  await page.getByRole("button", { name: /Commit/ }).click()
  const commit = page.getByRole("dialog", { name: "Commit changes" })
  await commit.getByLabel("Message").fill("Playwright editor smoke test")
  await commit.getByRole("button", { name: "Commit", exact: true }).click()
  await expect(commit).toBeHidden({ timeout: 30_000 })
  await page.reload()
  await expect(page.getByRole("button", { name: "New file" })).toBeVisible({
    timeout: 30_000,
  })
  await expect(page.getByRole("tabpanel").getByRole("textbox")).toBeVisible({
    timeout: 30_000,
  })
  await expect(page.getByRole("tabpanel").getByRole("textbox")).toContainText(
    "playwright-commit-check"
  )
})
