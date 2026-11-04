# Verification · 2026-11-04

| Check | Executed result |
|---|---|
| Unit and HTTP contract tests | **46 passed**: payload/schema/numeric/date/size validation, real zero/null/error semantics, provisioning authentication, token lifecycle responses, stale/offline states, timezone conversion, deterministic demo, CSV escaping/pagination/10k cap and quota errors |
| PostgreSQL 17 integration | **Passed** on initial implementation: migration application, RLS/grants, cross-owner explicit-UUID latest/chart/CSV access denial, browser/anonymous write denial, token authorization/rotation/revocation, deduplication, multi-gateway/meter separation, chart null buckets, CSV limits and 5,000+100 row retention batches |
| Hosted Supabase migration | **Applied** to verified empty project `qivwjkqkeipaivztgbyy`, with migration tracking and all five app tables using RLS |
| Hosted Edge Functions | **ACTIVE**, version 1, both functions. `verify_jwt=false` with explicit user/device verification inside each function |
| Hosted end-to-end requests | **Passed** using two temporary users: Auth password login, register gateway/two meters, HTTPS ingestion and DB persistence, real zero versus failed null/error, server-clock fallback, cross-owner reads, direct-write/hash-table denial, invalid token/schema, 429 rate limiting, duplicate retry, rotation and old-token denial, second-slave upload, revocation, chart null buckets/aggregation, CSV query, cross-user latest RPC |
| Hosted fixture cleanup | **Verified**: temporary Auth accounts removed; counts of app gateways/readings and Auth users returned to zero. No demo series or actual owner credentials inserted |
| Hosted retention | **Active** every ten minutes, 30-day setting, max 5,000 deletes/run; at least one successful scheduled run observed |
| Edge runtime type checking | **Both entrypoints passed Deno check**, isolated function dependency context/lockfile |
| Frontend production build | **Passed** against the configured live project, both original path and alternate path build support. Static artifact includes only public browser configuration |
| Built assets and source credential scans | **Passed** targeted patterns for administrative/device tokens, private keys and accidental Wi-Fi credentials. Original historical credentials remain in old commits and must be rotated; scans do not claim old history is clean |
| Browser checks | **3 passed** in Chromium: desktop charts/time range/multi-meter selection/CSV download/setup, phone width and unconfigured-login state. Browser fixture server explicitly omits live configuration to keep local demo tests deterministic |
| Firmware | **Compiled** with Arduino CLI 1.3.1, esp32 3.3.0, ModbusMaster 2.0.1, ArduinoJson 7.4.2. Flash 1,070,727B (81%); globals 47,388B (14%). Upstream library/core warnings reported, including an unused ModbusMaster requestFrom path; actual sketch uses readHoldingRegisters |
| Firmware TLS | Public roots included with source/fingerprints in firmware-trust.md; hostname/chain/date verification remains enabled; SNTP is required. No insecure fallback |
| Physical ESP32/meter | **Not tested here**. Owner's supplied ThingSpeak sketch matches pins/UART/registers/decoder. Nonzero mapping, scaling and word order still require comparison against the physical display |
| GitHub public visibility | **Verified** with anonymous public API after owner's change. Connected account's earlier private metadata was stale |
| GitHub Pages | **Deployed and HTTPS-verified** at https://diwas03.github.io/Meter_Reading_Dashboard/. [Run 41793190376](https://github.com/Diwas03/Meter_Reading_Dashboard/actions/runs/41793190376) succeeded; its Verify published HTTPS dashboard step executed and passed HTML, all referenced assets, live public Supabase configuration and build metadata checks. Owner enabled Pages; static branch is gh-pages. No main merge |

No automatic main merge, remote DB reset, paid upgrade, secret logging or certificate-verification bypass was performed. Source branch and static publishing branch remain separate.

See [deployment.md](deployment.md) and [first-reading.md](first-reading.md) for exact configuration and hardware steps. The owner must create their own application login and register their actual gateway; passwords and device tokens are not sent in chat.

## Sparse-history plot fix

Real uploads were present and chart RPCs returned valid data. The 24h default compressed the short initial history into two non-null five-minute buckets among 289 buckets; isolated points with dot=false were invisible. The app now defaults to 1h, shows markers for series with up to 12 valid points, and explicitly labels groups without valid measurements. Missing values remain gaps and genuine zero contributes to valid point counts. A browser regression checks an exactly one-sample range and its zero-valued neutral-current point. Frequency axis labels retain two decimal places. No ingestion/data changes were required.
