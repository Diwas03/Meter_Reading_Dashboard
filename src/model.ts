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
// Sparse series need markers: a single valid sample cannot form a line.
export function prepareChartData(history: ChartRow[]) {
  const rows = new Map<string, Record<string, string | number | null>>();
  const counts: Record<string, number> = {};
  for (const reading of history) {
    const row = rows.get(reading.time) ?? { time: reading.time };
    for (const field of fields) {
      const key = reading.meter_id + "_" + field;
      row[key] = reading[field];
      if (reading[field] !== null && Number.isFinite(reading[field]))
        counts[key] = (counts[key] ?? 0) + 1;
    }
    rows.set(reading.time, row);
  }
  return { points: [...rows.values()], counts };
}
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

export function localDateInput(time: number, zone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(time));
  const get = (name: string) => parts.find((p) => p.type === name)!.value;
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}
export function chartTimeLabel(time: string, zone: string, range: string) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    ...(range === "1h"
      ? {}
      : { day: "2-digit" as const, month: "short" as const }),
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(time));
}
