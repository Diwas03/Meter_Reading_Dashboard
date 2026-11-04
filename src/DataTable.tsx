import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownToLine, RefreshCw } from "lucide-react";
import { exportRows, readingPage, type TableCursor } from "./api";
import {
  fields,
  localDateInput,
  loggingDateRange,
  toCsv,
  type Field,
  type Meter,
  type Reading,
} from "./model";
const columns: Record<Field, string> = {
  voltage_rn: "R–N (V)",
  voltage_yn: "Y–N (V)",
  voltage_bn: "B–N (V)",
  voltage_avg: "Average (V)",
  voltage_ry: "R–Y (V)",
  voltage_yb: "Y–B (V)",
  voltage_br: "B–R (V)",
  current_r: "R current (A)",
  current_y: "Y current (A)",
  current_b: "B current (A)",
  current_n: "Neutral (A)",
  pf_r: "R PF",
  pf_y: "Y PF",
  pf_b: "B PF",
  pf_avg: "Average PF",
  frequency: "Frequency (Hz)",
};
const errorMessage = (e: unknown) =>
  e instanceof Error
    ? e.message
    : e && typeof e === "object" && "message" in e
      ? String(e.message)
      : "Unable to load readings. Please retry.";
export default function DataTable({
  meters,
  zone,
  tick,
}: {
  meters: Meter[];
  zone: string;
  tick: number;
}) {
  const today = () => localDateInput(Date.now(), zone).slice(0, 10);
  const [from, setFrom] = useState(today),
    [to, setTo] = useState(today),
    [rows, setRows] = useState<Reading[]>([]),
    [next, setNext] = useState<TableCursor | null>(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [exporting, setExporting] = useState(false),
    [refresh, setRefresh] = useState(0);
  const ids = meters.map((m) => m.id),
    key = JSON.stringify({ ids, from, to, zone });
  const [pagination, setPagination] = useState<{
    key: string;
    index: number;
    cursors: (TableCursor | null)[];
  }>({ key: "", index: 0, cursors: [null] });
  const page =
      pagination.key === key ? pagination : { key, index: 0, cursors: [null] },
    cursor = page.cursors[page.index];
  const dates = useMemo(() => {
    try {
      return { range: loggingDateRange(from, to, zone), error: "" };
    } catch (e) {
      return { range: null, error: errorMessage(e) };
    }
  }, [from, to, zone]);
  const request = useRef(0);
  useEffect(() => {
    const current = ++request.current;
    setRows([]);
    setNext(null);
    setError("");
    if (!dates.range || !meters.length) {
      setLoading(false);
      return;
    }
    setLoading(true);
    readingPage(ids, dates.range.start, dates.range.end, cursor)
      .then((result) => {
        if (current === request.current) {
          setRows(result.rows);
          setNext(result.next);
        }
      })
      .catch((e) => {
        if (current === request.current) setError(errorMessage(e));
      })
      .finally(() => {
        if (current === request.current) setLoading(false);
      });
    return () => {
      request.current++;
    };
  }, [key, page.index, cursor?.time, cursor?.id, refresh, tick]);
  const format = (time: string) =>
    new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(new Date(time));
  const csvAllowed =
    dates.range &&
    Date.parse(dates.range.end) - Date.parse(dates.range.start) <= 7 * 86400000;
  async function download() {
    if (!dates.range) return;
    setExporting(true);
    setError("");
    try {
      const all = await exportRows(ids, dates.range.start, dates.range.end);
      const url = URL.createObjectURL(
        new Blob([toCsv(all)], { type: "text/csv;charset=utf-8" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = `meter-readings-${from}-${to}-UTC.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setExporting(false);
    }
  }
  return (
    <section className="data-panel panel" aria-label="Received readings table">
      <div className="chart-header">
        <div>
          <h2>Received readings</h2>
          <p>Raw meter samples · newest logged first · {zone}</p>
        </div>
        <button
          className="button"
          onClick={download}
          disabled={exporting || !meters.length || !csvAllowed}
        >
          <ArrowDownToLine size={16} />
          {exporting ? "Preparing CSV…" : "Download CSV"}
        </button>
      </div>
      <div className="logging-filters">
        <label>
          Logged from
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label>
          Logged through
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <button
          className="button"
          onClick={() => {
            setPagination({ key, index: 0, cursors: [null] });
            setRefresh((n) => n + 1);
          }}
          disabled={loading}
        >
          <RefreshCw size={15} />
          Refresh table
        </button>
      </div>
      <p className="table-help">
        Filters use the server-received logging date in {zone}, including the
        entire end day. CSV includes all matching readings in the filtered
        range, up to 7 days and 10,000 rows; timestamps in CSV are UTC.
      </p>
      {!csvAllowed && dates.range && (
        <div className="notice">
          Choose up to seven logging days to download CSV. The table supports up
          to 90 days.
        </div>
      )}
      {(error || dates.error) && (
        <div role="alert" className="error">
          {error || dates.error}
        </div>
      )}
      {loading ? (
        <div className="loading" role="status">
          Loading logged readings…
        </div>
      ) : !error && !dates.error && (!meters.length || !rows.length) ? (
        <div className="notice">
          {!meters.length
            ? "Select a gateway and meter to view readings."
            : "No readings logged in this date range."}
        </div>
      ) : null}
      {!loading && rows.length > 0 && (
        <div
          className="table-scroll"
          role="region"
          aria-label="Scrollable raw readings"
          tabIndex={0}
        >
          <table className="readings-table">
            <caption>
              ESP32 samples · {zone} · unavailable values are shown as —
            </caption>
            <thead>
              <tr>
                <th scope="col">Logged at ({zone})</th>
                <th scope="col">Meter / slave</th>
                <th scope="col">Measured at ({zone})</th>
                <th scope="col">Quality</th>
                {fields.map((f) => (
                  <th scope="col" key={f}>
                    {columns[f]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{format(row.received_at)}</td>
                  <td>
                    Meter{" "}
                    {meters.find((m) => m.id === row.meter_id)?.slave_id ??
                      row.meter_id}
                  </td>
                  <td>
                    {row.measured_at
                      ? format(row.measured_at)
                      : "Server clock fallback"}
                  </td>
                  <td>
                    <span
                      className={
                        "status " +
                        (Object.keys(row.errors).length ? "stale" : "online")
                      }
                      title={Object.entries(row.errors)
                        .map(([k, v]) => `${columns[k as Field] ?? k}: ${v}`)
                        .join("; ")}
                    >
                      {Object.keys(row.errors).length
                        ? `Partial · ${Object.keys(row.errors).length} unavailable`
                        : "Complete"}
                    </span>
                    <details>
                      <summary>Sample details</summary>
                      <div>Sample ID: {row.sample_id}</div>
                      <div>Clock source: {row.clock_source}</div>
                      {Object.entries(row.errors).map(([key, value]) => (
                        <div key={key}>
                          {columns[key as Field] ?? key}: {value}
                        </div>
                      ))}
                    </details>
                  </td>
                  {fields.map((f) => (
                    <td
                      key={f}
                      title={
                        row[f] === null
                          ? (row.errors[f] ?? "Unavailable")
                          : undefined
                      }
                    >
                      {row[f] === null ? "—" : Number(row[f]).toFixed(3)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="table-pagination">
        <span>
          {rows.length} readings · Page {page.index + 1} · 50 per page
        </span>
        <div>
          <button
            className="button"
            disabled={loading || page.index === 0}
            onClick={() => setPagination({ ...page, index: page.index - 1 })}
          >
            Previous
          </button>
          <button
            className="button"
            disabled={loading || !next}
            onClick={() =>
              next &&
              setPagination({
                key,
                index: page.index + 1,
                cursors: [...page.cursors.slice(0, page.index + 1), next],
              })
            }
          >
            Next
          </button>
        </div>
      </div>
    </section>
  );
}
