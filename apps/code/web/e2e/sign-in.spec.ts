import { expect, test } from "@playwright/test"

test("an unauthenticated visitor can reach the sign-in page", async ({ page }) => {
  await page.goto("/")

  await expect(page.getByText("Sign in to open your programs and edit them with your team.")).toBeVisible()
  await page.getByRole("button", { name: "Sign in" }).click()
  await expect(page).toHaveURL(/workos|authkit/i)
})
