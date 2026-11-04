import { createClient } from "@supabase/supabase-js";
import type { Reading, ChartRow } from "./model";
const url = import.meta.env.VITE_SUPABASE_URL,
  key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
export const configured = Boolean(
  url &&
    key &&
    !url.includes("YOUR_PROJECT") &&
    key.startsWith("sb_publishable_"),
);
export const supabase = configured ? createClient(url, key) : null;
export async function charts(
  ids: string[],
  start: string,
  end: string,
  seconds: number,
): Promise<ChartRow[]> {
  const { data, error } = await supabase!.rpc("chart_readings", {
    p_meters: ids,
    p_start: start,
    p_end: end,
    p_seconds: seconds,
  });
  if (error) throw error;
  return data ?? [];
}
export async function exportRows(
  ids: string[],
  start: string,
  end: string,
): Promise<Reading[]> {
  if (Date.parse(end) - Date.parse(start) > 7 * 86400000)
    throw new Error("CSV exports support up to seven days. Narrow your range.");
  const rows: Reading[] = [];
  let afterTime: string | null = null,
    afterId: number | null = null;
  while (true) {
    const { data, error } = await supabase!.rpc("export_readings", {
      p_meters: ids,
      p_start: start,
      p_end: end,
      p_after_time: afterTime,
      p_after_id: afterId,
    });
    if (error) throw error;
    const page = data as Reading[];
    rows.push(...page);
    if (rows.length > 10000)
      throw new Error(
        "Export exceeds 10,000 rows. Select fewer meters or a shorter range. No partial file was downloaded.",
      );
    if (page.length < 500) return rows;
    const last = page.at(-1)!;
    afterTime = last.received_at;
    afterId = last.id;
  }
}
