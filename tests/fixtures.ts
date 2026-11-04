// Test-only deterministic telemetry; never included in the production app.
import {
  fields,
  type Device,
  type Meter,
  type Reading,
  type Values,
  type ChartRow,
} from "../src/model";
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
