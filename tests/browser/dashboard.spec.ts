import { test, expect } from "@playwright/test";
test("desktop demo, chart ranges, multi-meter selection, CSV and setup", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("./");
  await expect(
    page.getByRole("heading", { name: "Meter overview" }),
  ).toBeVisible();
  await expect(page.getByText("You’re exploring the local demo")).toBeVisible();
  await expect(page.locator(".stat-value").first()).not.toContainText("…");
  await expect(page.locator(".chart-panel")).toHaveCount(5);
  await page.getByRole("button", { name: "1 hour", exact: true }).click();
  await expect(page.locator(".chart-body svg").first()).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("DEMO-meter-readings-UTC.csv");
  const stream = await download.createReadStream();
  let csv = "";
  for await (const chunk of stream!) csv += chunk.toString();
  expect(csv).toContain("received_at");
  expect(csv.split("\r\n")).toHaveLength(61);
  await page.getByLabel("Meter", { exact: true }).selectOption("all");
  await expect(page.locator(".meter-row")).toHaveCount(2);
  await page
    .getByLabel("Gateway", { exact: true })
    .selectOption("demo-gateway-2");
  await expect(page.locator(".meter-row")).toHaveCount(1);
  await page.getByRole("button", { name: "Open setup guide" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Register gateway", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.screenshot({ path: "/tmp/meter-desktop.png", fullPage: true });
  expect(errors).toEqual([]);
});
test("phone layout and unconfigured auth state", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("./");
  await expect(
    page.getByRole("heading", { name: "Meter overview" }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "/tmp/meter-phone-demo.png", fullPage: true });
  await page.getByRole("button", { name: "Connect your meters" }).click();
  await expect(
    page.getByText("Add your Supabase URL and publishable key", {
      exact: false,
    }),
  ).toBeVisible();
  await page.screenshot({ path: "/tmp/meter-phone.png", fullPage: true });
});

test("single-sample history renders visible dots, including measured zero", async ({
  page,
}) => {
  await page.goto("./");
  await expect(
    page.getByRole("button", { name: "1 hour", exact: true }),
  ).toHaveClass("selected");
  await page.getByRole("button", { name: "Custom", exact: true }).click();
  await page
    .locator('input[type="datetime-local"]')
    .nth(0)
    .fill("2026-11-03T11:59");
  await page
    .locator('input[type="datetime-local"]')
    .nth(1)
    .fill("2026-11-03T11:59:30");
  const frequency = page.locator(".chart-panel").nth(3);
  await expect(frequency.locator(".recharts-line-dot")).toHaveCount(1);
  await expect(frequency.locator(".recharts-line-dot")).toBeVisible();
  const currents = page.locator(".chart-panel").nth(2);
  await expect(currents.locator(".recharts-line-dot")).toHaveCount(4);
});
