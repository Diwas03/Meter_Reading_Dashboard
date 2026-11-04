import {
  fields,
  type Field,
  type Values,
} from "../supabase/functions/_shared/validation";
export { fields };
export type { Field, Values };
export type Device = { id: string; name: string; revoked_at: string | null };
export type Meter = { id: string; device_id: string; slave_id: number };
export type Reading = Values & {
  id: number;
  sample_id: string;
  device_id: string;
  meter_id: string;
  measured_at: string | null;
  received_at: string;
  clock_source: "device" | "server";
  errors: Partial<Record<Field, string>>;
};
export type ChartRow = Values & { meter_id: string; time: string };
export const groups: {
  title: string;
  unit: string;
  keys: Field[];
  labels: string[];
}[] = [
  {
    title: "Phase-to-neutral voltage",
    unit: "V",
    keys: ["voltage_rn", "voltage_yn", "voltage_bn"],
    labels: ["R–N", "Y–N", "B–N"],
  },
  {
    title: "Phase-to-phase voltage",
    unit: "V",
    keys: ["voltage_ry", "voltage_yb", "voltage_br"],
    labels: ["R–Y", "Y–B", "B–R"],
  },
  {
    title: "Phase & neutral current",
    unit: "A",
    keys: ["current_r", "current_y", "current_b", "current_n"],
    labels: ["R", "Y", "B", "Neutral"],
  },
  {
    title: "Frequency",
    unit: "Hz",
    keys: ["frequency"],
    labels: ["Frequency"],
  },
  {
    title: "Power factor",
    unit: "PF",
    keys: ["pf_r", "pf_y", "pf_b", "pf_avg"],
    labels: ["R", "Y", "B", "Average"],
  },
];
export function health(
  received: string | undefined,
  now: number,
  thresholdMinutes: number,
  revoked = false,
) {
  if (revoked || !received) return "offline";
  const age = Math.max(0, now - Date.parse(received));
  return age > thresholdMinutes * 60000
    ? "offline"
    : age > Math.min(120000, thresholdMinutes * 30000)
      ? "stale"
      : "online";
}
export function chooseBucket(start: number, end: number, count: number) {
  const seconds = [60, 300, 900, 3600, 21600, 86400].find(
    (n) => ((end - start) / 1000 / n) * Math.max(1, count) <= 880,
  );
  if (!seconds) throw new Error("Choose fewer meters or a shorter date range.");
  return seconds;
}
export function rangeDates(
  range: string,
  now: number,
  from: string,
  to: string,
  zone: string,
) {
  const end =
    range === "custom"
      ? Date.parse(to + (zone === "UTC" ? "Z" : "+06:00"))
      : now;
  const start =
    range === "custom"
      ? Date.parse(from + (zone === "UTC" ? "Z" : "+06:00"))
      : end -
        ({ "1h": 3600000, "24h": 86400000, "7d": 604800000 }[range] ?? 3600000);
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    end <= start ||
    end - start > 90 * 86400000
  )
    throw new Error("Select a valid date range of up to 90 days.");
  return {
    start: new Date(start).toISOString(),
    end: new Date(end).toISOString(),
  };
}
const cell = (v: unknown) => `"${String(v ?? "").replaceAll('"', '""')}"`;
export function toCsv(rows: Reading[]) {
  const headers = [
    "sample_id",
    "device_id",
    "meter_id",
    "measured_at",
    "received_at",
    "clock_source",
    ...fields,
    "errors",
  ];
  return [
    headers.map(cell).join(","),
    ...rows.map((r) =>
      headers
        .map((k) =>
          cell(
            k === "errors" ? JSON.stringify(r.errors) : r[k as keyof Reading],
          ),
        )
        .join(","),
    ),
  ].join("\r\n");
}
export const demoNow = Date.parse("2026-11-03T06:00:00Z");
export const demoDevices: Device[] = [
  { id: "demo-gateway", name: "Main building", revoked_at: null },
  { id: "demo-gateway-2", name: "Workshop", revoked_at: null },
];
export const demoMeters: Meter[] = [
  { id: "demo-meter-1", device_id: "demo-gateway", slave_id: 1 },
  { id: "demo-meter-2", device_id: "demo-gateway", slave_id: 2 },
  { id: "demo-meter-3", device_id: "demo-gateway-2", slave_id: 1 },
];
export function demoReading(m: Meter, t: number): Reading {
  const i = Math.floor(t / 60000),
    offset = demoMeters.findIndex((x) => x.id === m.id);
  const wave = Math.sin(i / 13 + offset),
    vals = {} as Values;
  fields.forEach((key, k) => {
    vals[key] = key.startsWith("voltage")
      ? (key.match(/_(ry|yb|br)$/) ? 399 : 231) + wave * 2 + k * 0.15
      : key.startsWith("current")
        ? key === "current_n"
          ? 0
          : 7 + wave + offset
        : key === "frequency"
          ? 50 + wave * 0.03
          : 0.94 + wave * 0.02;
  });
  if (i % 31 === 0) vals.voltage_yn = null;
  return {
    ...vals,
    id: i,
    sample_id: `demo-${m.id}-${i}`,
    device_id: m.device_id,
    meter_id: m.id,
    measured_at: new Date(t).toISOString(),
    received_at: new Date(t).toISOString(),
    clock_source: "device",
    errors: vals.voltage_yn === null ? { voltage_yn: "modbus_timeout" } : {},
  };
}
export function demoCharts(
  meters: Meter[],
  start: string,
  end: string,
  seconds: number,
): ChartRow[] {
  const rows: ChartRow[] = [];
  for (
    let t = Math.floor(Date.parse(start) / (seconds * 1000)) * seconds * 1000;
    t <= Date.parse(end);
    t += seconds * 1000
  )
    for (const m of meters) {
      const reading = demoReading(m, t);
      if (Math.floor(t / (seconds * 1000)) % 47 === 0)
        fields.forEach((f) => (reading[f] = null));
      rows.push({ ...reading, time: new Date(t).toISOString() });
    }
  return rows;
}
