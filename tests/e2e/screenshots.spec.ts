/**
 * Visual snapshots of key screens (phone + desktop) written to docs/screenshots.
 * Only runs when SCREENSHOTS=1 (CI sets it on commits tagged [screenshots]).
 */
import { test, type Page } from "@playwright/test";

test.skip(!process.env.SCREENSHOTS, "set SCREENSHOTS=1 to capture screenshots");

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

async function shot(page: Page, name: string, project: string, fullPage = true) {
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `docs/screenshots/${project}-${name}.png`, fullPage });
}

test("capture", async ({ page }, info) => {
  test.setTimeout(120_000);
  const p = info.project.name;
  await page.goto("/login");
  await shot(page, "01-login", p, false);
  await page.goto("/apply");
  await shot(page, "02-apply", p);

  await signIn(page, "angela.price@legacy.demo", "ResidentDemo2026!");
  await shot(page, "10-resident-home-due", p);
  await page.goto("/pay");
  await shot(page, "11-resident-pay", p);
  await page.goto("/payments");
  await shot(page, "12-resident-payments", p);
  const receipt = await page.getByRole("link", { name: /Receipt/ }).first().getAttribute("href");
  await page.goto(receipt!);
  await shot(page, "13-receipt", p);
  await page.context().clearCookies();

  await signIn(page, "denise.carter@legacy.demo", "ResidentDemo2026!");
  await shot(page, "14-resident-home-overdue", p, false);
  await page.context().clearCookies();

  await signIn(page, "owner@legacy.demo", "LegacyDemo2026!");
  await shot(page, "20-admin-dashboard", p);
  await page.goto("/admin/properties");
  await shot(page, "21-admin-properties", p);
  await page.goto("/admin/residents");
  await shot(page, "22-admin-residents", p);
  await page.getByRole("link", { name: "Denise Carter" }).click();
  await shot(page, "23-admin-resident-profile", p);
  await page.goto("/admin/applications?status=APPROVED");
  await page.getByRole("link", { name: "Jordan Ellis" }).click();
  await shot(page, "24-admin-application-convert", p);
  await page.goto("/admin/payments?range=all");
  await shot(page, "25-admin-payments", p);
  await page.goto("/admin/reports");
  await shot(page, "26-admin-reports", p);
});
