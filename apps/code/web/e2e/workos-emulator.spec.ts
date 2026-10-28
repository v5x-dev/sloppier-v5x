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
