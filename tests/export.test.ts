import { beforeEach, it, expect, vi } from "vitest";
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ rpc }) }));
beforeEach(() => {
  rpc.mockReset();
  vi.stubEnv("VITE_SUPABASE_URL", "https://test.supabase.co");
  vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
  vi.resetModules();
});
const start = "2026-11-03T00:00:00Z",
  end = "2026-11-03T01:00:00Z";
it("paginates beyond default database limits using stable time/identity cursors", async () => {
  const first = Array.from({ length: 500 }, (_, i) => ({
      id: i + 1,
      received_at: start,
    })),
    second = [{ id: 501, received_at: start }];
  rpc
    .mockResolvedValueOnce({ data: first, error: null })
    .mockResolvedValueOnce({ data: second, error: null });
  const { exportRows } = await import("../src/api");
  expect(await exportRows(["meter"], start, end)).toHaveLength(501);
  expect(rpc.mock.calls[1][1]).toMatchObject({
    p_after_id: 500,
    p_after_time: start,
    p_meters: ["meter"],
  });
});
it("rejects oversized exports instead of returning a partial result", async () => {
  rpc.mockResolvedValue({
    data: Array.from({ length: 500 }, (_, i) => ({
      id: i + 1,
      received_at: start,
    })),
    error: null,
  });
  const { exportRows } = await import("../src/api");
  await expect(exportRows(["meter"], start, end)).rejects.toThrow("10,000");
  expect(rpc).toHaveBeenCalledTimes(21);
});
it("rejects windows above seven days before issuing a query", async () => {
  const { exportRows } = await import("../src/api");
  await expect(
    exportRows(["meter"], "2026-10-01T00:00:00Z", end),
  ).rejects.toThrow("seven days");
  expect(rpc).not.toHaveBeenCalled();
});
it("surfaces database/quota failures without substituting a zero or demo row", async () => {
  rpc.mockResolvedValue({ data: null, error: new Error("quota exceeded") });
  const { exportRows } = await import("../src/api");
  await expect(exportRows(["meter"], start, end)).rejects.toThrow(
    "quota exceeded",
  );
});

it("returns a bounded table page and cursor at the last displayed row", async () => {
  const records = Array.from({ length: 51 }, (_, i) => ({
    id: 200 - i,
    received_at: start,
  }));
  rpc.mockResolvedValue({ data: records, error: null });
  const { readingPage } = await import("../src/api");
  const page = await readingPage(["meter"], start, end, null);
  expect(page.rows).toHaveLength(50);
  expect(page.next).toEqual({ time: start, id: 151 });
  expect(rpc.mock.calls[0][1]).toMatchObject({
    p_before_time: null,
    p_before_id: null,
  });
  await readingPage(["meter"], start, end, page.next);
  expect(rpc.mock.calls[1][1]).toMatchObject({
    p_before_time: start,
    p_before_id: 151,
  });
});
it("empty table pages remain empty", async () => {
  rpc.mockResolvedValue({ data: [], error: null });
  const { readingPage } = await import("../src/api");
  expect(await readingPage(["meter"], start, end, null)).toEqual({
    rows: [],
    next: null,
  });
});
