import { expect, test } from "@playwright/test"

const protectedPages = [
  { name: "dashboard", path: "/" },
  { name: "program", path: "/programs/example-program" },
  { name: "invitation", path: "/invites/example-invitation" },
]

for (const { name, path } of protectedPages) {
  test(`an unauthenticated visitor sees the sign-in gate on the ${name}`, async ({ page }) => {
    await page.goto(path)
    await expect(page.getByText("Sign in to open your programs and edit them with your team.")).toBeVisible()
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible()
    await page.reload()
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`${path}$`))
  })
}

test("the sign-in button starts WorkOS sign-in", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "Sign in" }).click()
  await expect(page).toHaveURL(/workos|authkit/i)
})

test("an incomplete callback offers a retry", async ({ page }) => {
  await page.goto("/callback")
  await expect(page.getByText("Sign-in didn't finish")).toBeVisible()
  await page.getByRole("button", { name: "Try again" }).click()
  await expect(page).toHaveURL(/workos|authkit/i)
})

test("unknown pages show a not-found message", async ({ page }) => {
  await page.goto("/this-page-does-not-exist")
  await expect(page.getByRole("heading", { name: "404" })).toBeVisible()
  await expect(page.getByText("The requested page could not be found.")).toBeVisible()
})

test("the sign-in gate is usable on a narrow screen", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 })
  await page.goto("/")
  const signIn = page.getByRole("button", { name: "Sign in" })
  await expect(signIn).toBeVisible()
  await expect(signIn).toBeInViewport()
  await page.keyboard.press("Tab")
  await expect(signIn).toBeFocused()
})
