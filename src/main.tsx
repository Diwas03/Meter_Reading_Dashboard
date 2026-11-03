import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  ArrowDownToLine,
  ArrowUpRight,
  Check,
  ChevronRight,
  Clock3,
  Cpu,
  Gauge,
  HelpCircle,
  Layers3,
  LogOut,
  Radio,
  RefreshCw,
  ShieldCheck,
  X,
  Zap,
} from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Session } from "@supabase/supabase-js";
import { supabase, configured, charts, exportRows } from "./api";
import {
  chooseBucket,
  demoCharts,
  demoDevices,
  demoMeters,
  demoNow,
  demoReading,
  fields,
  groups,
  health,
  rangeDates,
  toCsv,
  type ChartRow,
  type Device,
  type Meter,
  type Reading,
} from "./model";
import "./style.css";
const colors = ["#d1674c", "#c4a33d", "#4e85b4", "#8b7bac"];
const message = (e: unknown) =>
  e instanceof Error
    ? e.message
    : typeof e === "object" && e && "message" in e
      ? String(e.message)
      : "Something went wrong. Please retry.";
function App() {
  const [demo, setDemo] = useState(true),
    [session, setSession] = useState<Session | null>(null),
    [devices, setDevices] = useState<Device[]>(demoDevices),
    [meters, setMeters] = useState<Meter[]>(demoMeters),
    [device, setDevice] = useState("demo-gateway"),
    [meter, setMeter] = useState("demo-meter-1");
  const [range, setRange] = useState("24h"),
    [from, setFrom] = useState("2026-11-02T12:00"),
    [to, setTo] = useState("2026-11-03T12:00"),
    [zone, setZone] = useState("Asia/Thimphu"),
    [threshold, setThreshold] = useState(
      () => Number(localStorage.getItem("offlineMinutes")) || 5,
    );
  const [latest, setLatest] = useState<Reading[]>([]),
    [history, setHistory] = useState<ChartRow[]>([]),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [tick, setTick] = useState(0),
    [clock, setClock] = useState(Date.now()),
    [inventory, setInventory] = useState(0),
    [guide, setGuide] = useState(false),
    [exporting, setExporting] = useState(false);
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [authBusy, setAuthBusy] = useState(false),
    [authError, setAuthError] = useState("");
  const request = useRef(0);
  const now = demo ? demoNow : clock;
  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, s) =>
      setSession(s),
    );
    return () => data.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    const t = setInterval(() => setClock(Date.now()), 10000),
      r = setInterval(() => {
        if (!document.hidden) setTick((t) => t + 1);
      }, 60000);
    return () => {
      clearInterval(t);
      clearInterval(r);
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    setLatest([]);
    setHistory([]);
    setError("");
    if (demo) {
      setDevices(demoDevices);
      setMeters(demoMeters);
      setDevice("demo-gateway");
      setMeter("demo-meter-1");
      return;
    }
    setDevices([]);
    setMeters([]);
    if (!session) {
      setDevice("");
      setMeter("");
      return;
    }
    (async () => {
      const [d, m] = await Promise.all([
        supabase!
          .from("devices")
          .select("id,name,revoked_at")
          .order("created_at"),
        supabase!.from("meters").select("*").order("slave_id"),
      ]);
      if (cancelled) return;
      if (d.error || m.error) {
        setError(message(d.error || m.error));
        return;
      }
      setDevices(d.data);
      setMeters(m.data);
      const chosen = d.data.some((d) => d.id === device)
        ? device
        : (d.data[0]?.id ?? "");
      setDevice(chosen);
      setMeter(
        meter === "all"
          ? "all"
          : m.data.some((m) => m.id === meter && m.device_id === chosen)
            ? meter
            : (m.data.find((m) => m.device_id === chosen)?.id ?? ""),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [demo, session, inventory]);
  const selected = useMemo(
    () =>
      meters.filter(
        (m) => m.device_id === device && (meter === "all" || m.id === meter),
      ),
    [meters, device, meter],
  );
  const ids = selected.map((m) => m.id).join(",");
  const primary = selected[0];
  const current = latest.find((r) => r.meter_id === primary?.id);
  const selectedDevice = devices.find((d) => d.id === device);
  useEffect(() => {
    const id = ++request.current;
    setLatest([]);
    setHistory([]);
    setError("");
    if (!ids || (!demo && !session)) return;
    setLoading(true);
    (async () => {
      try {
        const dates = rangeDates(
            range,
            demo ? demoNow : Date.now(),
            from,
            to,
            zone,
          ),
          seconds = chooseBucket(
            Date.parse(dates.start),
            Date.parse(dates.end),
            selected.length,
          );
        const [l, h] = demo
          ? [
              selected.map((m) => demoReading(m, demoNow - 60000)),
              demoCharts(selected, dates.start, dates.end, seconds),
            ]
          : await Promise.all([
              supabase!
                .rpc("latest_readings", { p_meters: ids.split(",") })
                .then(({ data, error }) => {
                  if (error) throw error;
                  return data as Reading[];
                }),
              charts(ids.split(","), dates.start, dates.end, seconds),
            ]);
        if (request.current === id) {
          setLatest(l);
          setHistory(h);
        }
      } catch (e) {
        if (request.current === id) setError(message(e));
      } finally {
        if (request.current === id) setLoading(false);
      }
    })();
    return () => {
      request.current++;
    };
  }, [ids, demo, session, range, from, to, zone, tick]); // selections are represented by ids
  const formatted = (time: string, short = false) =>
    new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      ...(short
        ? { hour: "2-digit", minute: "2-digit" }
        : {
            day: "2-digit",
            month: "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          }),
    }).format(new Date(time));
  const chartData = useMemo(() => {
    const map = new Map<string, Record<string, string | number | null>>();
    history.forEach((r) => {
      const row = map.get(r.time) ?? { time: r.time };
      fields.forEach((f) => (row[r.meter_id + "_" + f] = r[f]));
      map.set(r.time, row);
    });
    return [...map.values()];
  }, [history]);
  async function login(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setAuthBusy(true);
    setAuthError("");
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) throw error;
      setPassword("");
    } catch (e) {
      setAuthError(message(e));
    } finally {
      setAuthBusy(false);
    }
  }
  async function download() {
    setExporting(true);
    setError("");
    try {
      const dates = rangeDates(range, now, from, to, zone);
      if (Date.parse(dates.end) - Date.parse(dates.start) > 7 * 86400000)
        throw new Error("CSV supports up to seven days.");
      let rows: Reading[];
      if (demo) {
        rows = [];
        for (
          let t = Date.parse(dates.start);
          t < Date.parse(dates.end);
          t += 60000
        )
          for (const m of selected) {
            rows.push(demoReading(m, t));
            if (rows.length > 10000)
              throw new Error("Export exceeds 10,000 rows; shorten the range.");
          }
      } else
        rows = await exportRows(
          selected.map((m) => m.id),
          dates.start,
          dates.end,
        );
      const url = URL.createObjectURL(
          new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" }),
        ),
        a = document.createElement("a");
      a.href = url;
      a.download = `${demo ? "DEMO-" : ""}meter-readings-UTC.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(message(e));
    } finally {
      setExporting(false);
    }
  }
  const status = health(
    current?.received_at,
    now,
    threshold,
    !!selectedDevice?.revoked_at,
  );
  return (
    <div className="app">
      <aside className="sidebar">
        <a className="brand" href={import.meta.env.BASE_URL}>
          <span className="brand-icon">
            <Zap size={22} fill="currentColor" />
          </span>
          current<span className="brand-dot">.</span>
        </a>
        <div className="workspace">
          <span className="workspace-icon">
            <Layers3 size={18} />
          </span>
          <div>
            Meter workspace<small>ENERGY MONITORING</small>
          </div>
        </div>
        <div className="nav-label">WORKSPACE</div>
        <button className="nav active">
          <Gauge size={18} />
          Overview <span>01</span>
        </button>
        <button className="nav" onClick={() => setGuide(true)}>
          <Cpu size={18} />
          Devices & setup
          <ChevronRight size={15} />
        </button>
        <div className="sidebar-note">
          <Radio size={19} />
          <strong>Every reading matters.</strong>
          <p>A clear view of your meters, one minute at a time.</p>
          <span>SECURE ELITE 300 SERIES</span>
        </div>
        <div className="side-bottom">
          <ShieldCheck size={16} />
          Private by design <span>v1.0</span>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <span>
            Workspace <ChevronRight size={13} /> <b>Overview</b>
          </span>
          <div>
            <span className="timezone">
              <Clock3 size={14} />
              {zone === "Asia/Thimphu" ? "BTT · UTC+06:00" : "UTC+00:00"}
            </span>
            <button
              className="icon-btn"
              aria-label="Open setup guide"
              onClick={() => setGuide(true)}
            >
              <HelpCircle size={19} />
            </button>
            <span className="avatar">
              {demo
                ? "D"
                : (session?.user.email?.slice(0, 1).toUpperCase() ?? "U")}
            </span>
          </div>
        </header>
        <div className="content">
          <div className="heading">
            <div className="eyebrow">YOUR ENERGY, IN FOCUS</div>
            <div className="heading-row">
              <div>
                <h1>
                  Meter overview
                  <ArrowUpRight size={27} />
                </h1>
                <p>Understand your power. Stay connected to every phase.</p>
              </div>
              <button
                className="button"
                onClick={download}
                disabled={
                  !selected.length ||
                  exporting ||
                  loading ||
                  (!demo && !session)
                }
              >
                <ArrowDownToLine size={16} />
                {exporting ? "Preparing…" : "Export CSV"}
              </button>
            </div>
          </div>
          <div className={"mode-banner " + (demo ? "" : "live")}>
            <span className="mode-icon">
              <Activity size={18} />
            </span>
            <div>
              <strong>
                {demo
                  ? "You’re exploring the local demo"
                  : "Your private meter workspace"}
              </strong>
              <span>
                {demo
                  ? "Deterministic sample data · 03 Nov 2026 · no production connection"
                  : "Read-only telemetry · sign in to connect"}
              </span>
            </div>
            <button
              onClick={() => {
                setDemo((d) => !d);
                setAuthError("");
              }}
            >
              {demo ? "Connect your meters" : "Explore demo"}
              <ArrowUpRight size={16} />
            </button>
            {!demo && session && (
              <button onClick={() => supabase!.auth.signOut()}>
                <LogOut size={14} />
                Log out
              </button>
            )}
          </div>
          {!demo && !session ? (
            <section className="login panel">
              <div className="section-kicker">CONNECT YOUR WORKSPACE</div>
              <h2>Welcome back.</h2>
              <p>Sign in to see your gateways and readings.</p>
              {!configured ? (
                <div className="notice">
                  Add your Supabase URL and publishable key to connect this
                  dashboard. The setup guide has the exact steps.
                </div>
              ) : (
                <form onSubmit={login}>
                  <label>
                    Email
                    <input
                      type="email"
                      autoComplete="username"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                  </label>
                  <label>
                    Password
                    <input
                      type="password"
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                    />
                  </label>
                  <button className="button primary" disabled={authBusy}>
                    {authBusy ? "Signing in…" : "Sign in"}
                  </button>
                  <p className="muted">
                    Ask your project owner to create an account in Supabase
                    Auth.
                  </p>
                </form>
              )}
              {authError && (
                <div role="alert" className="error">
                  {authError}
                </div>
              )}
              <button className="text-button" onClick={() => setGuide(true)}>
                Open setup guide <ChevronRight size={14} />
              </button>
            </section>
          ) : (
            <>
              <section className="filters panel">
                <label>
                  <span>GATEWAY</span>
                  <select
                    aria-label="Gateway"
                    value={device}
                    onChange={(e) => {
                      setDevice(e.target.value);
                      setMeter(
                        meters.find((m) => m.device_id === e.target.value)
                          ?.id ?? "",
                      );
                    }}
                  >
                    {!devices.length && <option value="">No gateways</option>}
                    {devices.map((d) => (
                      <option value={d.id} key={d.id}>
                        {d.name}
                        {d.revoked_at ? " · revoked" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>METER</span>
                  <select
                    aria-label="Meter"
                    value={meter}
                    onChange={(e) => setMeter(e.target.value)}
                  >
                    {!meters.filter((m) => m.device_id === device).length && (
                      <option value="">No meters</option>
                    )}
                    {meters
                      .filter((m) => m.device_id === device)
                      .map((m) => (
                        <option key={m.id} value={m.id}>
                          Meter {String(m.slave_id).padStart(2, "0")} · Slave{" "}
                          {m.slave_id}
                        </option>
                      ))}
                    <option value="all">All gateway meters</option>
                  </select>
                </label>
                <div className="range-switch" aria-label="Time range">
                  {[
                    ["1h", "1 hour"],
                    ["24h", "24 hours"],
                    ["7d", "7 days"],
                    ["custom", "Custom"],
                  ].map(([v, l]) => (
                    <button
                      className={range === v ? "selected" : ""}
                      key={v}
                      onClick={() => setRange(v)}
                    >
                      {l}
                    </button>
                  ))}
                </div>
                <button
                  className="icon-btn refresh"
                  aria-label="Refresh readings"
                  disabled={loading}
                  onClick={() => setTick((t) => t + 1)}
                >
                  <RefreshCw size={17} className={loading ? "spinning" : ""} />
                </button>
              </section>
              {range === "custom" && (
                <div className="custom-range">
                  <label>
                    From ({zone})
                    <input
                      type="datetime-local"
                      value={from}
                      onChange={(e) => setFrom(e.target.value)}
                    />
                  </label>
                  <label>
                    To ({zone})
                    <input
                      type="datetime-local"
                      value={to}
                      onChange={(e) => setTo(e.target.value)}
                    />
                  </label>
                  <span>Charts: up to 90 days · CSV: up to 7 days</span>
                </div>
              )}
              <div className="reading-meta">
                <div>
                  <span className={"status " + status}>
                    <i />
                    {status}
                  </span>
                  <span>
                    {current
                      ? `Last received ${formatted(current.received_at)} · ${Math.max(0, Math.floor((now - Date.parse(current.received_at)) / 60000))} min ago`
                      : "Awaiting first reading"}{" "}
                    <b>{zone}</b>
                  </span>
                </div>
                <span className="muted">
                  60s refresh ·{" "}
                  {meter === "all" ? "Cards show first meter" : "Latest sample"}
                </span>
              </div>
              {error && (
                <div role="alert" className="error">
                  {error}{" "}
                  <button onClick={() => setTick((t) => t + 1)}>Retry</button>
                </div>
              )}
              {loading && (
                <div className="loading" role="status">
                  Fetching meter readings…
                </div>
              )}
              {!loading && !error && !current && (
                <div className="notice">
                  {devices.length
                    ? "No readings yet. Configure your ESP32 and send its first upload."
                    : "No gateways registered. Open Devices & setup to register your first gateway."}
                </div>
              )}
              <section className="stats">
                {[
                  {
                    label: "Average voltage",
                    key: "voltage_avg" as const,
                    unit: "V",
                    icon: <Zap size={18} />,
                    note: "Phase-to-neutral",
                  },
                  {
                    label: "R phase current",
                    key: "current_r" as const,
                    unit: "A",
                    icon: <Activity size={18} />,
                    note: "R phase · RMS",
                  },
                  {
                    label: "Frequency",
                    key: "frequency" as const,
                    unit: "Hz",
                    icon: <Radio size={18} />,
                    note: "System frequency",
                  },
                  {
                    label: "Average power factor",
                    key: "pf_avg" as const,
                    unit: "PF",
                    icon: <Gauge size={18} />,
                    note: "Reported by meter",
                  },
                ].map((c) => (
                  <article className="stat panel" key={c.key}>
                    <div className="stat-label">
                      {c.label}
                      <span>{c.icon}</span>
                    </div>
                    <div className="stat-value">
                      {loading
                        ? "…"
                        : current?.[c.key] === null ||
                            current?.[c.key] === undefined
                          ? "—"
                          : current[c.key]!.toFixed(c.key === "pf_avg" ? 3 : 2)}
                      <span>{c.unit}</span>
                    </div>
                    <div className="stat-note">
                      {current?.[c.key] === null ? (
                        <span className="warning">
                          Unavailable · {current.errors[c.key]}
                        </span>
                      ) : (
                        c.note
                      )}
                    </div>
                  </article>
                ))}
              </section>
              {current && (
                <div className="quality">
                  <ShieldCheck size={14} />
                  {Object.keys(current.errors).length
                    ? `Partial reading · ${Object.keys(current.errors).length} measurements unavailable. Valid values remain visible.`
                    : "All 16 measurements received."}{" "}
                  <span>
                    {current.clock_source === "server"
                      ? "Device clock unavailable · server timestamp used"
                      : "Device clock supplied"}
                  </span>
                </div>
              )}
              <div className="section-heading">
                <div>
                  <h2>Electrical trends</h2>
                  <p>
                    {range === "24h"
                      ? "The last 24 hours"
                      : range === "1h"
                        ? "The last hour"
                        : range === "7d"
                          ? "The last 7 days"
                          : "Your selected range"}{" "}
                    · averages per time bucket · received time
                  </p>
                </div>
                <span>
                  <i className="tiny-dot" />{" "}
                  {demo ? "SAMPLE TELEMETRY" : "METER TELEMETRY"}
                </span>
              </div>
              <section className="charts">
                {groups.map((g, index) => (
                  <article
                    className={
                      "chart-panel panel " + (index === 0 ? "wide" : "")
                    }
                    key={g.title}
                  >
                    <div className="chart-header">
                      <div>
                        <h3>{g.title}</h3>
                        <span>
                          {g.unit === "PF"
                            ? "Dimensionless"
                            : g.unit === "Hz"
                              ? "Hertz"
                              : g.unit === "A"
                                ? "Amperes"
                                : "Volts"}{" "}
                          · {zone}
                        </span>
                      </div>
                      <span className="chart-unit">{g.unit}</span>
                    </div>
                    <div className="legend">
                      {selected.flatMap((m) =>
                        g.keys.map((k, i) => (
                          <span key={m.id + k}>
                            <i style={{ background: colors[i] }} />
                            {selected.length > 1 ? `M${m.slave_id} · ` : ""}
                            {g.labels[i]}
                          </span>
                        )),
                      )}
                    </div>
                    <div className="chart-body">
                      {chartData.length ? (
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart
                            data={chartData}
                            margin={{
                              top: 12,
                              right: 12,
                              left: -22,
                              bottom: 0,
                            }}
                          >
                            <CartesianGrid
                              strokeDasharray="3 5"
                              vertical={false}
                              stroke="#e6e9e6"
                            />
                            <XAxis
                              dataKey="time"
                              tickFormatter={(t) => formatted(t, true)}
                              minTickGap={70}
                              tick={{ fontSize: 11, fill: "#8a938e" }}
                              axisLine={false}
                              tickLine={false}
                            />
                            <YAxis
                              domain={["auto", "auto"]}
                              tick={{ fontSize: 11, fill: "#8a938e" }}
                              axisLine={false}
                              tickLine={false}
                              tickFormatter={(n) =>
                                Number(n).toFixed(g.unit === "PF" ? 2 : 1)
                              }
                            />
                            <Tooltip
                              labelFormatter={(t) =>
                                `${formatted(String(t))} ${zone}`
                              }
                              formatter={(v) =>
                                v == null ? "Unavailable" : Number(v).toFixed(3)
                              }
                              contentStyle={{
                                borderRadius: 10,
                                border: "1px solid #dce3dd",
                                fontSize: 12,
                              }}
                            />
                            {selected.flatMap((m, mi) =>
                              g.keys.map((k, i) => (
                                <Line
                                  key={m.id + k}
                                  name={`${selected.length > 1 ? "M" + m.slave_id + " · " : ""}${g.labels[i]} (${g.unit})`}
                                  dataKey={m.id + "_" + k}
                                  type="linear"
                                  stroke={colors[i]}
                                  strokeWidth={1.7}
                                  dot={false}
                                  connectNulls={false}
                                  strokeDasharray={mi ? "5 3" : undefined}
                                  isAnimationActive={false}
                                />
                              )),
                            )}
                          </LineChart>
                        </ResponsiveContainer>
                      ) : (
                        <div className="chart-empty">
                          {loading
                            ? "Loading history…"
                            : "No readings in this range"}
                        </div>
                      )}
                    </div>
                    <div className="chart-footer">
                      Gaps indicate missing readings. Zero remains a measured
                      value.
                    </div>
                  </article>
                ))}
              </section>
              <section className="meter-health panel">
                <div className="chart-header">
                  <h3>Connected meters</h3>
                  <Cpu size={17} />
                </div>
                {selected.map((m) => {
                  const r = latest.find((x) => x.meter_id === m.id);
                  return (
                    <div className="meter-row" key={m.id}>
                      <span className="meter-icon">
                        <Cpu size={18} />
                      </span>
                      <div>
                        <strong>
                          Meter {String(m.slave_id).padStart(2, "0")}
                        </strong>
                        <small>
                          {selectedDevice?.name} · Modbus slave {m.slave_id}
                        </small>
                      </div>
                      <span
                        className={
                          "status " +
                          health(
                            r?.received_at,
                            now,
                            threshold,
                            !!selectedDevice?.revoked_at,
                          )
                        }
                      >
                        <i />
                        {health(
                          r?.received_at,
                          now,
                          threshold,
                          !!selectedDevice?.revoked_at,
                        )}
                      </span>
                      <span className="meter-time">
                        {r ? formatted(r.received_at) : "No data"}
                      </span>
                    </div>
                  );
                })}
              </section>
            </>
          )}
          <footer>
            <span>
              <Zap size={13} /> Current · Made for a clearer picture.
            </span>
            <div>
              <label>
                Display timezone{" "}
                <select value={zone} onChange={(e) => setZone(e.target.value)}>
                  <option>Asia/Thimphu</option>
                  <option>UTC</option>
                </select>
              </label>
              <label>
                Offline after{" "}
                <input
                  aria-label="Offline threshold in minutes"
                  type="number"
                  min="1"
                  max="60"
                  value={threshold}
                  onChange={(e) => {
                    const n = Math.max(
                      1,
                      Math.min(60, Number(e.target.value) || 5),
                    );
                    setThreshold(n);
                    localStorage.setItem("offlineMinutes", String(n));
                  }}
                />{" "}
                min
              </label>
            </div>
          </footer>
          <div className="calibration-note">
            Hardware validation pending: auxiliary-power zero responses only.
            Nonzero mapping, word order, and scaling must be checked against the
            meter display. Raw telemetry is deleted after 30 days by default
            when scheduled cleanup is enabled.
          </div>
        </div>
      </main>
      {guide && (
        <Setup
          demo={demo}
          devices={devices}
          close={() => setGuide(false)}
          refresh={() => {
            setInventory((v) => v + 1);
            setTick((t) => t + 1);
          }}
        />
      )}
    </div>
  );
}
function Setup({
  demo,
  devices,
  close,
  refresh,
}: {
  demo: boolean;
  devices: Device[];
  close: () => void;
  refresh: () => void;
}) {
  const [name, setName] = useState("Main gateway"),
    [slaves, setSlaves] = useState("1"),
    [target, setTarget] = useState(devices[0]?.id ?? ""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [result, setResult] = useState<{
      device_id: string;
      token: string | null;
    } | null>(null),
    [copied, setCopied] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "Tab") {
        const elements = Array.from(
          document.querySelectorAll<HTMLElement>(
            ".modal button, .modal input, .modal select, .modal a",
          ),
        ).filter((x) => !x.hasAttribute("disabled"));
        const first = elements[0],
          last = elements.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, [close]);
  async function manage(action: string) {
    setBusy(true);
    setError("");
    setResult(null);
    setCopied(false);
    try {
      if (demo || !supabase)
        throw new Error(
          "Switch to your workspace and sign in to provision a real device. Demo mode never writes to Supabase.",
        );
      if (!(await supabase.auth.getSession().then((r) => r.data.session)))
        throw new Error("Sign in first.");
      if (
        action === "revoke" &&
        !window.confirm(
          "Revoke uploads from this gateway? Existing readings remain visible.",
        )
      )
        return;
      const slave_ids = slaves.split(",").map((n) => Number(n.trim()));
      const { data, error } = await supabase.functions.invoke("provision", {
        body: {
          action,
          name,
          device_id: target || undefined,
          slave_ids:
            action === "register" || action === "add_meters" ? slave_ids : [],
        },
      });
      if (error) {
        if ("context" in error && error.context instanceof Response) {
          const details = await error.context.json().catch(() => null);
          throw new Error(details?.error ?? error.message);
        }
        throw error;
      }
      if (!data.ok) throw new Error(data.error);
      setResult(data);
      refresh();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="overlay">
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="setup-title"
      >
        <button
          className="close icon-btn"
          ref={closeRef}
          onClick={close}
          aria-label="Close setup"
        >
          <X size={20} />
        </button>
        <div className="section-kicker">DEVICE WORKSPACE</div>
        <h2 id="setup-title">Connect your first gateway.</h2>
        <p>A private route from your meter to your dashboard.</p>
        <ol className="steps">
          <li>
            <strong>Prepare Supabase</strong>
            <p>
              Apply the migrations and deploy <code>ingest</code> and{" "}
              <code>provision</code>. Create an Auth user, set the public
              frontend variables, then sign in. See the repository README for
              exact commands.
            </p>
          </li>
          <li>
            <strong>Register the ESP32</strong>
            <p>
              One gateway per ESP32. Slave IDs identify meters within that
              gateway.
            </p>
            <label>
              Gateway name
              <input
                value={name}
                maxLength={80}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label>
              Slave IDs (comma-separated)
              <input
                value={slaves}
                onChange={(e) => setSlaves(e.target.value)}
                placeholder="1,2"
              />
            </label>
            <button
              className="button primary"
              disabled={busy || demo}
              onClick={() => manage("register")}
            >
              {busy ? "Working…" : "Register gateway"}
            </button>
            {demo && (
              <small className="muted">
                Provisioning is disabled in local demo mode.
              </small>
            )}
          </li>
          <li>
            <strong>Configure & flash</strong>
            <p>
              Copy <code>firmware/meter_gateway/config.example.h</code> to
              ignored <code>config.h</code>. Enter Wi-Fi, gateway UUID, upload
              token, Supabase HTTPS endpoint, and its verified CA root. Flash
              the supplied sketch. Logs use 115200 baud.
            </p>
          </li>
          <li>
            <strong>Verify your first reading</strong>
            <p>
              After a successful HTTPS upload, refresh this dashboard. Verify
              nonzero values against the meter display before relying on them.
            </p>
          </li>
        </ol>
        <div className="manage">
          <h3>Manage an existing gateway</h3>
          <label>
            Gateway
            <select value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">Choose gateway</option>
              {devices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <div className="actions">
            <button
              className="button"
              disabled={busy || demo || !target}
              onClick={() => manage("add_meters")}
            >
              Add slave IDs above
            </button>
            <button
              className="button"
              disabled={busy || demo || !target}
              onClick={() => manage("rotate")}
            >
              Rotate token
            </button>
            <button
              className="button danger"
              disabled={busy || demo || !target}
              onClick={() => manage("revoke")}
            >
              Revoke uploads
            </button>
          </div>
          <small>
            Rotation invalidates the old token and re-enables a revoked gateway.
            Update the ESP32 immediately.
          </small>
        </div>
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        {result && (
          <div className="token-result">
            <strong>
              {result.token
                ? "Save this token now. It is only shown once."
                : "Gateway updated."}
            </strong>
            <label>
              Gateway UUID<code>{result.device_id}</code>
            </label>
            {result.token && (
              <>
                <label>
                  Upload token<code>{result.token}</code>
                </label>
                <button
                  className="button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(result.token!);
                      setCopied(true);
                    } catch {
                      setError(
                        "Clipboard unavailable. Select and copy the token manually.",
                      );
                    }
                  }}
                >
                  {copied ? (
                    <>
                      <Check size={14} />
                      Copied
                    </>
                  ) : (
                    "Copy token"
                  )}
                </button>
                <p>
                  Keep this token out of Git, logs, screenshots, and frontend
                  configuration.
                </p>
              </>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
