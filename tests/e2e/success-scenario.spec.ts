/**
 * The spec's success scenario, end to end in a real browser:
 * apply → approve → convert (House #1 · Room 3, $750, Oct 1) → resident signs in
 * → sees $750 due Oct 1 → pays → receipt → balance $0 → admin sees the collection.
 * Runs with APP_TODAY=2026-09-27 (see playwright.config.ts).
 */
import { expect, test, type Page } from "@playwright/test";

test.skip(({ isMobile }) => isMobile, "scenario mutates shared data; run once on desktop");

const ADMIN = { email: "owner@legacy.demo", password: "LegacyDemo2026!" };
const stamp = Date.now().toString(36);
const applicant = { first: "Casey", last: `Morgan${stamp}`, email: `casey.${stamp}@example.test`, phone: "555-010-4000" };
const RESIDENT_PASSWORD = "Resident2026ok";

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

async function logout(page: Page) {
  await page.getByRole("button", { name: "Sign out" }).first().click();
  await expect(page).toHaveURL(/\/login/);
}

test("apply → approve → convert → sign in → pay → receipt → $0", async ({ page }) => {
  // 1. Public application
  await page.goto("/apply");
  await page.getByLabel("First name").fill(applicant.first);
  await page.getByLabel("Last name").fill(applicant.last);
  await page.getByLabel("Phone").first().fill(applicant.phone);
  await page.getByLabel("Email").fill(applicant.email);
  await page.getByLabel(/information I've entered is accurate/).check();
  await page.getByRole("button", { name: "Send my application" }).click();
  await expect(page.getByRole("heading", { name: /we got it/i })).toBeVisible();

  // 2. Owner reviews and approves
  await login(page, ADMIN.email, ADMIN.password);
  await expect(page).toHaveURL(/\/admin$/);
  await page.getByRole("link", { name: /^Applications/ }).first().click();
  await page.getByRole("link", { name: `${applicant.first} ${applicant.last}` }).click();
  await page.getByLabel("Status").selectOption("APPROVED");
  await page.getByRole("button", { name: "Save review" }).click();
  await expect(page.getByText("Application updated.")).toBeVisible();
  await page.reload();

  // 3. Convert to resident: Legacy House #1 · Room 3, $750/month, Oct 1 move-in, due day 1
  const room3 = await page.locator("option", { hasText: "Legacy House #1 · Room 3" }).getAttribute("value");
  await page.getByLabel("Property & room").selectOption(room3!);
  await page.getByLabel("Monthly rent").fill("750");
  await page.getByLabel("Move-in date").fill("2026-10-01");
  await page.getByLabel("Rent due day").fill("1");
  await page.getByRole("button", { name: "Convert to resident" }).click();
  await expect(page.getByText(/is now a resident/)).toBeVisible();
  const inviteUrl = await page.getByLabel(/setup link/i).inputValue();
  expect(inviteUrl).toContain("/invite/");
  await logout(page);

  // 4. Resident sets a password and lands on their dashboard
  await page.goto(new URL(inviteUrl).pathname);
  await page.getByLabel("New password").fill(RESIDENT_PASSWORD);
  await page.getByLabel("Type it again").fill(RESIDENT_PASSWORD);
  await page.getByRole("button", { name: "Create my account" }).click();
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByTestId("balance")).toHaveText("$750.00");
  await expect(page.getByTestId("due-date")).toHaveText("October 1, 2026");
  await expect(page.getByText("Due soon").first()).toBeVisible();

  // 5. Pay rent (sandbox checkout)
  await page.getByTestId("pay-rent").click();
  await expect(page.getByLabel("How much would you like to pay?")).toHaveValue("750.00");
  await page.getByText("Debit card").click();
  await page.getByRole("button", { name: "Continue to secure payment" }).click();
  await expect(page).toHaveURL(/\/pay\/sandbox\//);
  await page.getByRole("button", { name: "Pay $750.00" }).click();
  await expect(page.getByTestId("payment-result")).toHaveText("Payment successful");

  // 6. Receipt
  await page.getByRole("link", { name: "View receipt" }).click();
  await expect(page.getByTestId("receipt-amount")).toHaveText("$750.00");
  await expect(page.getByText(/LIL-20260927-/)).toBeVisible();

  // 7. Balance is $0 and the ledger shows both lines
  await page.goto("/home");
  await expect(page.getByTestId("balance")).toHaveText("$0.00");
  await expect(page.getByText("You're all paid up")).toBeVisible();
  await page.goto("/payments");
  await expect(page.getByText("Monthly rent")).toBeVisible();
  await expect(page.getByText("-$750.00")).toBeVisible();
  await logout(page);

  // 8. Admin sees the collection and the room still assigned
  await login(page, ADMIN.email, ADMIN.password);
  const row = page.getByRole("row", { name: new RegExp(`${applicant.first} ${applicant.last}`) });
  await expect(row.getByText("Paid")).toBeVisible();
  await expect(row.getByText("Room 3")).toBeVisible();
  // The $750 is October rent, so it shows in October's collection report.
  await page.goto("/admin/reports?month=2026-10");
  await expect(page.getByRole("heading", { name: /Rent collection · October 2026/ })).toBeVisible();
  await page.goto("/admin/properties");
  await expect(page.getByRole("link", { name: `${applicant.first} ${applicant.last}` })).toBeVisible();
});
