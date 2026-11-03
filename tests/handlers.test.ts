import { it, expect, vi } from "vitest";
import { handler as ingest } from "../supabase/functions/ingest/handler";
import { handler as provision } from "../supabase/functions/provision/handler";
import type { Admin } from "../supabase/functions/_shared/admin";
const id = "11111111-1111-4111-8111-111111111111";
const batch = {
  device_id: id,
  samples: [{ sample_id: id, slave_id: 1, values: { frequency: 0 } }],
};
const request = (body: unknown, token = "mg_" + "a".repeat(64)) =>
  new Request("https://test/functions/v1/ingest", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
function admin() {
  return {
    rpc: vi
      .fn<Admin["rpc"]>()
      .mockResolvedValue({ data: { inserted: 1, duplicates: 0 }, error: null }),
    auth: {
      getUser: vi
        .fn()
        .mockResolvedValue({ data: { user: { id } }, error: null }),
    },
  };
}
it("ingestion authenticates device token, hashes it and passes validated zeros", async () => {
  const a = admin();
  const response = await ingest(a)(request(batch));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ ok: true, inserted: 1 });
  expect(a.rpc.mock.calls[0][1]).toMatchObject({
    p_device: id,
    p_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
    p_samples: [{ values: { frequency: 0, current_r: null } }],
  });
});
it("rejects missing credentials before invoking the database", async () => {
  const a = admin();
  expect((await ingest(a)(request(batch, "bad"))).status).toBe(401);
  expect(a.rpc).not.toHaveBeenCalled();
});
it.each([
  ["UNAUTHORIZED", 401],
  ["UNREGISTERED_METER", 403],
  ["RATE_LIMIT", 429],
  ["database disconnected", 503],
])("maps %s to HTTP %i", async (message, status) => {
  const a = admin();
  a.rpc.mockResolvedValue({ data: null, error: { message } });
  const res = await ingest(a)(request(batch));
  expect(res.status).toBe(status);
  expect(await res.json()).toMatchObject({ ok: false });
});
it("rejects malformed payload without a database request", async () => {
  const a = admin();
  expect(
    (await ingest(a)(request({ device_id: id, samples: [] }))).status,
  ).toBe(400);
  expect(a.rpc).not.toHaveBeenCalled();
});
it("does not reflect backend secret errors", async () => {
  const a = admin();
  a.rpc.mockRejectedValue(new Error("postgres://private-password"));
  const r = await ingest(a)(request(batch));
  expect(r.status).toBe(503);
  expect(await r.text()).not.toContain("private-password");
});
it("provision verifies user and returns a newly generated one-time token only after success", async () => {
  const a = admin();
  a.rpc.mockResolvedValue({ data: id, error: null });
  const response = await provision(a)(
    request(
      { action: "register", name: "My gateway", slave_ids: [1, 2] },
      "user-jwt",
    ),
  );
  const data = await response.json();
  expect(data.token).toMatch(/^mg_[a-f0-9]{64}$/);
  expect(a.auth.getUser).toHaveBeenCalledWith("user-jwt");
  expect(a.rpc.mock.calls[0][1]).toMatchObject({
    p_owner: id,
    p_slaves: [1, 2],
  });
  expect(a.rpc.mock.calls[0][1].p_hash).not.toBe(data.token);
});
it("provision rejects invalid sessions and repeated meters", async () => {
  const a = admin();
  a.auth.getUser.mockResolvedValue({
    data: { user: null },
    error: new Error("expired"),
  });
  expect(
    (
      await provision(a)(
        request({ action: "register", name: "A", slave_ids: [1] }, "bad"),
      )
    ).status,
  ).toBe(401);
  expect(a.rpc).not.toHaveBeenCalled();
  const b = admin();
  expect(
    (
      await provision(b)(
        request({ action: "register", name: "A", slave_ids: [1, 1] }, "user"),
      )
    ).status,
  ).toBe(400);
});
it("revoke does not mint credentials; rotate mints a distinct token", async () => {
  const a = admin();
  a.rpc.mockResolvedValue({ data: id, error: null });
  const r = await provision(a)(
    request({ action: "revoke", device_id: id }, "user"),
  );
  expect((await r.json()).token).toBeNull();
  const tokens = [];
  for (let i = 0; i < 2; i++) {
    const res = await provision(a)(
      request({ action: "rotate", device_id: id }, "user"),
    );
    tokens.push((await res.json()).token);
  }
  expect(tokens[0]).not.toBe(tokens[1]);
});
it("supports browser preflight without treating it as authorization", async () => {
  const a = admin();
  const response = await provision(a)(
    new Request("https://test", { method: "OPTIONS" }),
  );
  expect(response.status).toBe(200);
  expect(a.auth.getUser).not.toHaveBeenCalled();
  expect(response.headers.get("access-control-allow-headers")).toContain(
    "authorization",
  );
});
