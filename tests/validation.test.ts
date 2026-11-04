import { describe, it, expect } from "vitest";
import {
  fields,
  hashToken,
  limitedJson,
  validateBatch,
} from "../supabase/functions/_shared/validation";
import {
  chooseBucket,
  demoMeters,
  demoNow,
  demoReading,
  health,
  rangeDates,
  toCsv,
} from "../src/model";
const device = "11111111-1111-4111-8111-111111111111",
  sample = "22222222-2222-4222-8222-222222222222";
const payload = () => ({
  device_id: device,
  samples: [
    {
      sample_id: sample,
      slave_id: 1,
      measured_at: null as string | null,
      values: { frequency: 0 } as Record<string, unknown>,
      errors: {} as Record<string, string>,
    },
  ],
});
describe("ingestion validation", () => {
  it("preserves real zeros, records failed values as null with errors", () => {
    const p = validateBatch(payload());
    expect(p.samples[0].values.frequency).toBe(0);
    expect(p.samples[0].values.current_r).toBeNull();
    expect(p.samples[0].errors.current_r).toBe("unavailable");
    expect(p.samples[0].measured_at).toBeNull();
  });
  it.each([NaN, Infinity, -Infinity, "0", 1e10])(
    "rejects invalid numeric %s",
    (n) => {
      const p = payload();
      p.samples[0].values.frequency = n;
      expect(() => validateBatch(p)).toThrow("Invalid frequency");
    },
  );
  it("rejects simultaneous value and error", () => {
    const p = payload();
    p.samples[0].errors.frequency = "timeout";
    expect(() => validateBatch(p)).toThrow();
  });
  it("accepts explicit null and bounded diagnostic", () => {
    const p = payload();
    p.samples[0].values.frequency = null;
    p.samples[0].errors.frequency = "timeout";
    expect(validateBatch(p).samples[0].errors.frequency).toBe("timeout");
  });
  it("bounds batch and rejects repeated ids", () => {
    const p = payload();
    p.samples = Array(33).fill(p.samples[0]);
    expect(() => validateBatch(p)).toThrow();
    p.samples = p.samples.slice(0, 2);
    expect(() => validateBatch(p)).toThrow();
  });
  it.each([0, 248, 1.1, "1"])("rejects slave %s", (n) => {
    const p = payload();
    p.samples[0].slave_id = n as number;
    expect(() => validateBatch(p)).toThrow();
  });
  it.each([
    "2020-01-01T00:00:00Z",
    "2030-01-01T00:00:00Z",
    "not-a-date",
    "2026-02-31T00:00:00Z",
    "2026-11-03T00:00:00",
  ])("rejects timestamp %s", (t) => {
    const p = payload();
    p.samples[0].measured_at = t;
    expect(() => validateBatch(p, demoNow)).toThrow();
  });
  it("normalizes reliable UTC timestamps", () => {
    const p = payload();
    p.samples[0].measured_at = "2026-11-03T05:59:00Z";
    expect(validateBatch(p, demoNow).samples[0].measured_at).toBe(
      "2026-11-03T05:59:00.000Z",
    );
  });
  it("rejects unknown fields and long errors", () => {
    const p = payload();
    p.samples[0].values.secret = 4;
    expect(() => validateBatch(p)).toThrow();
    delete p.samples[0].values.secret;
    p.samples[0].errors.current_r = "x".repeat(121);
    expect(() => validateBatch(p)).toThrow();
  });
  it("hashes high-entropy tokens deterministically, not plaintext", async () => {
    const h = await hashToken("mg_" + "a".repeat(64));
    expect(h).toMatch(/^[a-f0-9]{64}$/);
    expect(h).toBe(await hashToken("mg_" + "a".repeat(64)));
    expect(h).not.toBe(await hashToken("mg_" + "b".repeat(64)));
  });
  it("limits request streams without trusting content-length", async () => {
    const req = new Request("https://test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: '{"x":"' + "a".repeat(50) + '"}',
    });
    await expect(limitedJson(req, 20)).rejects.toThrow("Payload too large");
  });
  it("rejects malformed JSON and wrong content type", async () => {
    await expect(
      limitedJson(
        new Request("https://test", {
          method: "POST",
          body: "x",
          headers: { "content-type": "application/json" },
        }),
      ),
    ).rejects.toThrow("Malformed JSON");
    await expect(
      limitedJson(new Request("https://test", { method: "POST", body: "{}" })),
    ).rejects.toThrow("application/json");
  });
});
describe("dashboard data semantics", () => {
  it("computes online, stale, offline, no-data and revoked states", () => {
    expect(health(new Date(demoNow - 60000).toISOString(), demoNow, 5)).toBe(
      "online",
    );
    expect(health(new Date(demoNow - 180000).toISOString(), demoNow, 5)).toBe(
      "stale",
    );
    expect(health(new Date(demoNow - 301000).toISOString(), demoNow, 5)).toBe(
      "offline",
    );
    expect(health(undefined, demoNow, 5)).toBe("offline");
    expect(health(new Date(demoNow).toISOString(), demoNow, 5, true)).toBe(
      "offline",
    );
  });
  it("uses bounded aggregation even for many meters", () => {
    for (const count of [1, 8, 32]) {
      const seconds = chooseBucket(0, 7 * 86400000, count);
      expect(((7 * 86400) / seconds) * count).toBeLessThanOrEqual(880);
    }
  });
  it("converts Thimphu custom dates to UTC", () => {
    expect(
      rangeDates(
        "custom",
        demoNow,
        "2026-11-03T11:00",
        "2026-11-03T12:00",
        "Asia/Thimphu",
      ),
    ).toEqual({
      start: "2026-11-03T05:00:00.000Z",
      end: "2026-11-03T06:00:00.000Z",
    });
  });
  it("rejects inverted/oversized custom ranges", () => {
    expect(() =>
      rangeDates(
        "custom",
        demoNow,
        "2026-11-03T12:00",
        "2026-11-03T11:00",
        "UTC",
      ),
    ).toThrow();
    expect(() =>
      rangeDates(
        "custom",
        demoNow,
        "2026-01-01T00:00",
        "2026-11-03T00:00",
        "UTC",
      ),
    ).toThrow();
  });
  it("demo is deterministic and separates gateway/slave identity", () => {
    expect(demoReading(demoMeters[0], demoNow)).toEqual(
      demoReading(demoMeters[0], demoNow),
    );
    expect(demoMeters[0].slave_id).toBe(demoMeters[2].slave_id);
    expect(demoMeters[0].device_id).not.toBe(demoMeters[2].device_id);
  });
  it("exports null as an empty cell and zero as zero with UTC metadata", () => {
    const r = demoReading(demoMeters[0], demoNow);
    r.frequency = 0;
    r.voltage_rn = null;
    r.errors.voltage_rn = "timeout";
    const csv = toCsv([r]);
    expect(csv).toContain('"0"');
    expect(csv).toContain('"",');
    expect(csv).toContain("received_at");
    expect(csv).toContain('""voltage_rn"":""timeout""');
    expect(fields.every((f) => csv.includes(f))).toBe(true);
  });
});
