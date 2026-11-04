import { test, expect, type Page } from "@playwright/test";
import {
  demoDevices as gateways,
  demoMeters as meters,
  demoReading as reading,
  demoCharts as chartRows,
} from "../fixtures";
import { fields } from "../../src/model";
const user = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "fixture@example.invalid",
  aud: "authenticated",
  role: "authenticated",
};
async function fixture(
  page: Page,
  options: {
    signedIn?: boolean;
    single?: boolean;
    empty?: boolean;
    error?: boolean;
    tablePages?: boolean;
  } = {},
) {
  const now = Math.floor(Date.now() / 60000) * 60000;
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const session = {
    access_token:
      encode({ alg: "HS256", typ: "JWT" }) +
      "." +
      encode({
        ...user,
        sub: user.id,
        exp: Math.floor(Date.now() / 1000) + 3600,
      }) +
      ".fixture",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: "browser-test-only",
    user,
  };
  if (options.signedIn)
    await page.addInitScript(
      (s) =>
        localStorage.setItem(
          "sb-browser-fixture-auth-token",
          JSON.stringify(s),
        ),
      session,
    );
  await page.route("https://browser-fixture.supabase.co/**", async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      path = url.pathname;
    const body = req.method() === "POST" ? req.postDataJSON() : null;
    let data: unknown = [];
    if (path === "/auth/v1/token") data = session;
    else if (path === "/auth/v1/user") data = user;
    else if (path === "/auth/v1/logout") {
      await route.fulfill({ status: 204 });
      return;
    } else if (path === "/rest/v1/devices") data = gateways;
    else if (path === "/rest/v1/meters") data = meters;
    else if (path === "/rest/v1/rpc/latest_readings")
      data = options.empty
        ? []
        : meters
            .filter((m) => body.p_meters.includes(m.id))
            .map((m) => reading(m, now));
    else if (path === "/rest/v1/rpc/chart_readings") {
      if (options.error) {
        await route.fulfill({
          status: 503,
          json: { message: "History temporarily unavailable" },
        });
        return;
      }
      const selected = meters.filter((m) => body.p_meters.includes(m.id));
      if (options.empty) data = [];
      else if (options.single) {
        data = selected.flatMap((m) => {
          const sample = reading(m, now);
          return [
            Object.fromEntries([
              ...Object.entries(sample),
              ...fields.map((f) => [f, null]),
              ["time", new Date(now - 60000).toISOString()],
            ]),
            { ...sample, time: new Date(now).toISOString() },
          ];
        });
      } else
        data = chartRows(selected, body.p_start, body.p_end, body.p_seconds);
    } else if (path === "/rest/v1/rpc/table_readings") {
      if (options.error) {
        await route.fulfill({
          status: 503,
          json: { message: "Table temporarily unavailable" },
        });
        return;
      }
      const selected = meters.filter((m) => body.p_meters.includes(m.id));
      data = options.empty
        ? []
        : options.tablePages
          ? Array.from({ length: body.p_before_id ? 1 : 51 }, (_, i) => ({
              ...reading(selected[0], now),
              id: body.p_before_id ? 1 : 200 - i,
              frequency: 0,
              current_r: null,
              errors: { current_r: "timeout" },
            }))
          : selected.map((m) => reading(m, now));
    } else if (path === "/rest/v1/rpc/export_readings")
      data = options.empty
        ? []
        : meters
            .filter((m) => body.p_meters.includes(m.id))
            .map((m) => reading(m, now));
    await route.fulfill({ status: 200, json: data });
  });
}
test("starts with real login and displays only authenticated API telemetry", async ({
  page,
}) => {
  await fixture(page);
  await page.goto("./");
  await expect(
    page.getByRole("heading", { name: "Welcome back." }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /demo/i })).toHaveCount(0);
  await expect(page.locator(".chart-panel")).toHaveCount(0);
  await page
    .getByLabel("Email", { exact: true })
    .fill("fixture@example.invalid");
  await page.getByLabel("Password", { exact: true }).fill("test-only-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator(".chart-panel")).toHaveCount(16);
  await expect(page.locator(".stat-value").first()).not.toContainText("…");
  await expect(page.getByText("Live ESP32 telemetry")).toBeVisible();
  await expect(page.locator(".chart-panel .recharts-line")).toHaveCount(16);
  for (const card of await page.locator(".chart-panel").all())
    await expect(card.locator(".recharts-line")).toHaveCount(1);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("meter-readings-UTC.csv");
  const stream = await file.createReadStream();
  let csv = "";
  for await (const chunk of stream!) csv += chunk.toString();
  expect(csv.split("\r\n")).toHaveLength(2);
  expect(csv).toContain("received_at");
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
});
test("phone live account renders a single point including genuine zero", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fixture(page, { signedIn: true, single: true });
  await page.goto("./");
  await expect(
    page
      .locator(".chart-panel")
      .filter({
        has: page.getByRole("heading", { name: "Frequency", exact: true }),
      })
      .locator(".recharts-line-dot"),
  ).toHaveCount(1);
  await expect(
    page
      .locator(".chart-panel")
      .filter({
        has: page.getByRole("heading", {
          name: "Neutral current",
          exact: true,
        }),
      })
      .locator(".recharts-line-dot"),
  ).toHaveCount(1);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.getByRole("button", { name: "Devices & setup" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
});
test("empty account history does not manufacture samples", async ({ page }) => {
  await fixture(page, { signedIn: true, empty: true });
  await page.goto("./");
  await expect(
    page.getByText("No valid measurements in this range"),
  ).toHaveCount(16);
  await expect(page.locator(".stat-value").first()).toContainText("—");
  await expect(page.locator(".recharts-line-dot")).toHaveCount(0);
});
test("history network failure is visible without sample-data fallback", async ({
  page,
}) => {
  await fixture(page, { signedIn: true, error: true });
  await page.goto("./");
  await expect(page.getByRole("alert")).toContainText(
    "History temporarily unavailable",
  );
  await expect(page.locator(".recharts-line-dot")).toHaveCount(0);
});
test("long chart ranges include calendar dates and current custom dates", async ({
  page,
}) => {
  await fixture(page, { signedIn: true });
  await page.goto("./");
  await expect(page.locator(".chart-panel")).toHaveCount(16);
  await page.getByRole("button", { name: "24 hours", exact: true }).click();
  await expect(page.locator(".chart-panel").first()).toContainText(
    /\d{2} [A-Z][a-z]{2}/,
  );
  await page.getByRole("button", { name: "Custom", exact: true }).click();
  const value = await page
    .locator('input[type="datetime-local"]')
    .nth(1)
    .inputValue();
  expect(value.slice(0, 4)).toBe(String(new Date().getUTCFullYear()));
  const originalInstant = Date.parse(value + "+06:00");
  await page.getByLabel("Display timezone").selectOption("UTC");
  const utc = await page
    .locator('input[type="datetime-local"]')
    .nth(1)
    .inputValue();
  expect(Date.parse(utc + "Z")).toBe(originalInstant);
});

test("data table paginates, preserves zero/null and exports the logged-date selection", async ({
  page,
}) => {
  await fixture(page, { signedIn: true, tablePages: true });
  await page.goto("./");
  const requests: Record<string, unknown>[] = [];
  page.on("request", (r) => {
    if (
      r.url().includes("/rpc/table_readings") ||
      r.url().includes("/rpc/export_readings")
    )
      requests.push(r.postDataJSON());
  });
  await page.getByRole("tab", { name: "Data table", exact: true }).click();
  const table = page.getByRole("table");
  await expect(table.locator("tbody tr")).toHaveCount(50);
  await expect(table.locator("tbody tr").first()).toContainText("0.000");
  await expect(table.locator("tbody tr").first()).toContainText("—");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(table.locator("tbody tr")).toHaveCount(1);
  await expect(page.getByText("Page 2", { exact: false })).toBeVisible();
  expect(requests.some((r) => r.p_before_id === 151)).toBe(true);
  await page.getByRole("button", { name: "Previous", exact: true }).click();
  await expect(table.locator("tbody tr")).toHaveCount(50);
  await page.getByLabel("Logged from", { exact: true }).fill("2026-11-03");
  await page.getByLabel("Logged through", { exact: true }).fill("2026-11-04");
  await expect(table.locator("tbody tr")).toHaveCount(50);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download CSV", exact: true }).click();
  expect((await download).suggestedFilename()).toBe(
    "meter-readings-2026-11-03-2026-11-04-UTC.csv",
  );
  expect(
    requests.some(
      (r) =>
        r.p_start === "2026-11-02T18:00:00.000Z" &&
        r.p_end === "2026-11-04T18:00:00.000Z",
    ),
  ).toBe(true);
  await page.getByRole("tab", { name: "Overview", exact: true }).click();
  await expect(page.locator(".chart-panel")).toHaveCount(16);
});
test("table displays empty logging range and disables oversized CSV", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fixture(page, { signedIn: true, empty: true });
  await page.goto("./");
  await page.getByRole("tab", { name: "Data table", exact: true }).click();
  await expect(
    page.getByText("No readings logged in this date range."),
  ).toBeVisible();
  await page.getByLabel("Logged from", { exact: true }).fill("2026-11-01");
  await page.getByLabel("Logged through", { exact: true }).fill("2026-11-09");
  await expect(
    page.getByRole("button", { name: "Download CSV", exact: true }),
  ).toBeDisabled();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
});
