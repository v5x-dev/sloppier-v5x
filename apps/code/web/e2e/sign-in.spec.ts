import { expect, test } from "@playwright/test"

const protectedPages = [
  { name: "dashboard", path: "/" },
  { name: "program", path: "/programs/example-program" },
  { name: "invitation", path: "/invites/example-invitation" },
]

for (const { name, path } of protectedPages) {
  test(`an unauthenticated visitor is sent to WorkOS from the ${name}`, async ({
    page,
  }) => {
    await page.goto(path)
    await expect(page).toHaveURL(/workos|authkit/i)
  })
}

test("an incomplete callback offers a retry", async ({ page }) => {
  await page.goto("/callback")
  await expect(page.getByText("Sign-in didn't finish")).toBeVisible()
  await page.getByRole("button", { name: "Try again" }).click()
  await expect(page).toHaveURL(/workos|authkit/i)
})

test("unknown pages show a not-found message", async ({ page }) => {
  await page.goto("/this-page-does-not-exist")
  await expect(page.getByRole("heading", { name: "404" })).toBeVisible()
  await expect(
    page.getByText("The requested page could not be found.")
  ).toBeVisible()
})
