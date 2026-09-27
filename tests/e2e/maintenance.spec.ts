/** Resident reports a repair with a photo → owner schedules it → resident sees the visit. */
import { expect, test, type Page } from "@playwright/test";

test.skip(({ isMobile }) => isMobile, "mutates shared data; run once on desktop");

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

test("report → schedule → resident sees visit", async ({ page, browser }) => {
  const title = `Kitchen light flickers ${Date.now().toString(36)}`;

  // Resident reports a problem
  await signIn(page, "gloria.james@legacy.demo", "ResidentDemo2026!");
  await page.getByRole("link", { name: "Repairs" }).first().click();
  await page.getByTestId("report-problem").click();
  await page.getByLabel("What kind of problem is it?").selectOption("ELECTRICAL");
  await page.getByLabel("In a few words, what's wrong?").fill(title);
  await page.getByLabel("Tell us more").fill("Flickers every few seconds since yesterday.");
  await page.getByText("Urgent — needs attention today").click();
  await page.locator('input[type="file"][name="photos"]').setInputFiles({ name: "light.png", mimeType: "image/png", buffer: PNG });
  await page.getByLabel(/OK to enter my room/).check();
  await page.getByRole("button", { name: "Send request" }).click();
  await expect(page.getByText("Request sent")).toBeVisible();
  await expect(page.getByTestId("request-title")).toHaveText(title);
  await expect(page.getByText("Submitted").first()).toBeVisible();
  await expect(page.getByRole("img", { name: "Photo 1" })).toBeVisible();
  const requestUrl = page.url().replace(/\?.*$/, "");

  // Owner schedules it
  const owner = await browser.newPage();
  await signIn(owner, "owner@legacy.demo", "LegacyDemo2026!");
  await owner.goto("/admin/maintenance");
  await owner.getByRole("link", { name: title }).click();
  await owner.getByLabel("Status", { exact: true }).selectOption("SCHEDULED");
  await owner.getByLabel("Visit date & time").fill("2026-09-29T10:00");
  await owner.getByLabel("Assigned to").fill("Sam the electrician");
  await owner.getByLabel("Note", { exact: true }).fill("Sam will replace the fixture.");
  await owner.getByRole("button", { name: "Save update" }).click();
  await expect(owner.getByText("Request updated.")).toBeVisible();
  await owner.getByLabel("Note", { exact: true }).fill("Fixture is $35");
  await owner.getByLabel("Staff-only note").check();
  await owner.getByRole("button", { name: "Save update" }).click();
  await expect(owner.getByText("Fixture is $35")).toBeVisible();
  await owner.close();

  // Resident sees the visit, not the staff-only note
  await page.goto(requestUrl);
  await expect(page.getByTestId("scheduled-for")).toContainText("Tue, Sep 29, 10:00 AM");
  await expect(page.getByTestId("scheduled-for")).toContainText("Sam the electrician");
  await expect(page.getByText("Sam will replace the fixture.")).toBeVisible();
  await expect(page.getByText("Fixture is $35")).toHaveCount(0);
  await page.goto("/notifications");
  await expect(page.getByText(/Repair scheduled/).first()).toBeVisible();
});

test("residents can't open another resident's request", async ({ browser }) => {
  const owner = await browser.newPage();
  await signIn(owner, "owner@legacy.demo", "LegacyDemo2026!");
  await owner.goto("/admin/maintenance?q=AC");
  const href = await owner.getByRole("link", { name: "AC not cooling in my room" }).getAttribute("href");
  const id = href!.split("/").pop();
  await owner.close();

  const angela = await browser.newPage();
  await signIn(angela, "angela.price@legacy.demo", "ResidentDemo2026!");
  const res = await angela.goto(`/maintenance/${id}`);
  expect(res?.status()).toBe(404);
  await angela.goto("/admin/maintenance");
  await expect(angela).toHaveURL(/\/home$/);
  await angela.close();
});
