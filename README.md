# Current · electricity meter monitoring

A private electricity-meter dashboard for Secure Elite 300 series meters, MAX485 and ESP32 DevKit V1. React + TypeScript + Vite + Recharts on GitHub Pages; Supabase PostgreSQL, Auth and Edge Functions. No MQTT, ThingSpeak, Grafana or paid service is required.

**Deployment status:** Supabase database, Auth configuration, Edge Functions and scheduled retention are deployed and hosted-tested. Firmware compiles. The live dashboard is **https://diwas03.github.io/Meter_Reading_Dashboard/**, published from the clean static `gh-pages` branch. The deployed HTTPS page/assets and public Supabase configuration passed the release smoke check. Historical credentials must be rotated. See [first ESP32 upload](docs/first-reading.md). See [verification](docs/verification.md) for executed tests and blockers. The dashboard opens directly to sign-in and shows **only saved ESP32 telemetry**, with Asia/Thimphu dates and times by default. No demo mode or synthetic sample generator is bundled.

**Hardware status:** only auxiliary-power Modbus responses containing zeros were verified by the owner. Nonzero register mapping, float word order and scaling are **not calibrated** against the meter display. Do not use this system for billing, protection or safety control.

The original serial-only sketch and legacy ThingSpeak sketch are preserved. The latter now reads credentials from ignored `legacy_thingspeak_config.h` (copy `legacy_thingspeak_config.example.h` if you still need it). **Rotate any real credentials in the pre-existing ThingSpeak commit; they remain in Git history.** The Supabase firmware does not use ThingSpeak.

## Develop locally

Node.js 24 LTS and npm are required. Use the existing checkout in each isolated cloud task; do not create a worktree unless explicitly requested.

```sh
cd /workspace/Meter_Reading_Dashboard # or your own clone
npm ci
npm test
npm run build
npm run check:assets
npm run dev
```

The Vite base is `/Meter_Reading_Dashboard/`, including locally. The app uses no path-based router, so refreshes and Auth redirects stay on the project root. A different repository name requires changing `base` in `vite.config.ts` and all corresponding Auth URLs.

Sign in to view your gateways and stored readings. An empty account/history stays empty; network errors never fall back to sample data. Test-only synthetic fixtures live under tests/ and are excluded from the web build. Custom-date inputs initialize to the actual current date/time.

For live mode copy `.env.example` to ignored `.env.local` and supply:

```dotenv
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_REPLACE_ME
```

These two values are intentionally public and are bundled in the browser. RLS and authenticated sessions protect data. **Never put a service-role key, Supabase secret key, database password or gateway upload token in a `VITE_` variable.** Restart Vite after changing variables. The app accepts the modern `sb_publishable_…` key; use the project's API Keys page rather than the legacy anonymous JWT.

## Create and configure Supabase (Free)

1. Create a **new Free project** in your intended organization. Do not upgrade or alter another project. Save the database password in a password manager. Copy the project reference, Project URL and publishable key from project settings. Do not paste administrative credentials into chat.
2. Install the official Supabase CLI (Node 24 supports the npm route): `npx supabase --version`. Authenticate locally with `npx supabase login`; in automation use a securely supplied `SUPABASE_ACCESS_TOKEN`. This is a management token and must never enter the frontend. Check the selected project before each remote command.
3. Link and apply the migration to the **new, empty project**:

   ```sh
   npx supabase link --project-ref YOUR_PROJECT_REF
   npx supabase db push --dry-run
   npx supabase db push
   npx supabase functions deploy ingest --project-ref YOUR_PROJECT_REF --no-verify-jwt
   npx supabase functions deploy provision --project-ref YOUR_PROJECT_REF --no-verify-jwt
   ```

   The CLI prompts securely for the database password if needed. Review migration output. Do not use `db reset` on a remote project. Hosted functions receive `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from Supabase automatically; never upload these into Pages. `ingest` authenticates a device token itself. `provision` verifies the user's JWT using `auth.getUser()` itself. `verify_jwt=false` is deliberate for both, not anonymous authorization.
4. In **Authentication → Users**, create/invite your dashboard users. This app uses email/password sign-in; it does not expose public sign-up. Disable public sign-ups in Auth settings if you want invitation-only access. Set a password through the invitation flow. Never share a user's password with the device.
5. In **Authentication → URL Configuration** set:
   - Site URL: `https://diwas03.github.io/Meter_Reading_Dashboard/`
   - Redirect URLs: that exact URL, plus `http://localhost:5173/Meter_Reading_Dashboard/` (and `http://127.0.0.1:5173/Meter_Reading_Dashboard/` if used).
   - Update these if GitHub reports a different deployment URL. Password login itself does not redirect; invitation/recovery links use these settings. CORS on provisioning allows browser requests but grants no authority without a verified user session.
6. **Retention:** migrations install a 30-day retention setting and bounded cleanup function, but intentionally do **not** activate deletion scheduling. Enable Supabase Cron (`pg_cron`) in **Integrations → Cron**, then run `supabase/schedule-retention.sql` in the intended project's SQL editor. This deletes up to 5,000 expired readings every 10 minutes. Monitor `cron.job_run_details`; a disabled/failed schedule does not enforce retention. Change days with `update public.retention_settings set days=30 where singleton;` (1–90). To stop deletion, run `select cron.unschedule('meter-retention');`. Deleted readings are not recoverable through this app. Export before expiration if needed.

For a full local Supabase stack with the CLI and Docker, run `npx supabase start`, `npx supabase db reset` **locally only**, and `npx supabase functions serve`. Use that local stack's publishable key/URL in `.env.local`. The lighter PostgreSQL integration suite below does not need an account.

## Register a gateway and send the first reading

1. Configure the frontend and sign in. Open **Devices & setup**.
2. Enter a gateway name and slave IDs, initially `1`. Register. Copy the **gateway UUID** and **one-time upload token**. Only its SHA-256 hash is stored in the database. The 256-bit random token cannot be retrieved later.
3. Configure and flash the firmware below. A gateway is an ESP32; a meter identity is `(gateway UUID, Modbus slave ID)`. Different gateways may both use slave 1.
4. A successful upload returns `{"ok":true,"inserted":1,"duplicates":0,"received_at":"…"}`. After 10 seconds, retrying the same sample returns a duplicate count. Requests within 10 seconds return 429 and must retry with the same IDs.
5. Refresh the dashboard and verify the timestamp and quality indicator. Chart filters use **server received time**, not device time. CSV includes both timestamps and `clock_source`.

To test manually without putting secrets in command history, this Python snippet prompts for the token and does not print it:

```python
import getpass, json, urllib.request, uuid
url = input('HTTPS ingest URL: ').strip()
device = input('Gateway UUID: ').strip()
token = getpass.getpass('Upload token: ')
payload = {'device_id': device, 'samples': [{
    'sample_id': str(uuid.uuid4()), 'slave_id': 1, 'measured_at': None,
    'values': {'frequency': 0}, 'errors': {'voltage_rn': 'not_connected'}
}]}
# This writes a deliberately partial test reading (frequency zero) to YOUR gateway.
req = urllib.request.Request(url, data=json.dumps(payload).encode(), method='POST',
    headers={'Content-Type':'application/json','Authorization':'Bearer '+token})
with urllib.request.urlopen(req, timeout=15) as r: print(r.status, r.read().decode())
```

Real zero stays zero. Unspecified, failed or null measurements become SQL NULL with per-field diagnostic errors. No missing field is filled with zero. A batch is atomic: an unregistered slave rejects the entire batch. Non-finite numbers, conflicting value/error pairs, timestamps outside seven days past or five minutes future, more than 32 samples, and bodies over 64 KiB are rejected. `measured_at:null` explicitly selects server-clock fallback; a supplied invalid timestamp is rejected.

**Add a meter:** connect/configure a unique Modbus address on the bus, then in Devices & setup select the existing gateway, enter IDs such as `2`, and choose **Add slave IDs above**. Update `SLAVE_IDS` in ignored firmware `config.h` to `{1,2}`, then reflash. Up to 32 meters can be registered per gateway; this firmware intentionally supports up to 8 to bound poll duration. Registering an existing ID is idempotent. There is a cap of 20 gateways per user.

**Rotate/revoke:** the setup panel rotates a token or revokes uploads. Rotation immediately invalidates the old token, re-enables a revoked gateway, and shows the new token once. Update the ESP32. Revocation blocks uploads without deleting history. Dashboard users cannot directly write or edit telemetry.

## ESP32 firmware

Prefer one file? Use [`firmware/meter_gateway_single/meter_gateway_single.ino`](firmware/meter_gateway_single/meter_gateway_single.ino): settings and trusted certificates are embedded. See its [setup instructions](firmware/meter_gateway_single/README.md). Save a private copy before entering real credentials.

Files: `firmware/meter_gateway/meter_gateway.ino` and `config.example.h`. Copy the latter to ignored `config.h` in the same directory. Keep real credentials there, outside Git.

Exact required packages:

- **esp32 by Espressif Systems 3.3.0** (Arduino board package); select **ESP32 Dev Module** (`esp32:esp32:esp32`) for DevKit V1.
- **ModbusMaster by Doc Walker 2.0.1**.
- **ArduinoJson by Benoit Blanchon 7.4.2**.
- WiFi, WiFiClientSecure, HTTPClient, FreeRTOS and SNTP come with the ESP32 board package; do not install unrelated similarly named libraries.

Arduino IDE → Preferences → Additional boards URL: `https://espressif.github.io/arduino-esp32/package_esp32_index.json`.

```sh
arduino-cli core update-index --additional-urls https://espressif.github.io/arduino-esp32/package_esp32_index.json
arduino-cli core install esp32:esp32@3.3.0 --additional-urls https://espressif.github.io/arduino-esp32/package_esp32_index.json
arduino-cli lib install 'ModbusMaster@2.0.1' 'ArduinoJson@7.4.2'
arduino-cli compile --fqbn esp32:esp32:esp32 firmware/meter_gateway
# Use your actual USB port, after compilation succeeds:
arduino-cli upload --fqbn esp32:esp32:esp32 --port YOUR_USB_PORT firmware/meter_gateway
```

Preserved configuration: RX16, TX17, DE+/RE18, slave `{1}`, 9600 `SERIAL_8N1`, Serial Monitor 115200. Each value uses `readHoldingRegisters(address,2)` and IEEE754 **low word first**: `(register[1]<<16)|register[0]`. The 16 configurable addresses remain **99,101,103,105,107,109,111,113,115,117,119,133,135,137,139,171** in the order listed in `FIELD_NAMES`. Do not change these based on generic 1-based register conventions. Use a suitable electrically safe RS485 interface; review MAX485/ESP32 logic voltage compatibility and meter wiring with the hardware documentation.

**HTTPS trust:** use the exact `https://PROJECT.supabase.co/functions/v1/ingest` endpoint without redirect. Keep the included `trusted_roots.h` trust set enabled; its public roots, source and SHA-256 fingerprints are documented in `docs/firmware-trust.md`. Maintain it against the certificate authorities’ official published roots. Inspect the endpoint's certificate chain from a trusted machine, match issuer to the CA's official root, and record the root expiry. A leaf certificate alone is not a durable trust anchor. Do not use the development environment proxy CA or disable validation. Monitor certificate-chain changes and update firmware before expiry. No `setInsecure()` is used. SNTP (`pool.ntp.org`, configurable) establishes UTC for TLS validity. Blocked NTP prevents HTTPS until a valid clock exists; local polling continues. Device time is recorded only if the clock has been set; pre-sync samples use null and server fallback.

**Bounded operation:** polling and networking run in separate FreeRTOS tasks. Meters poll sequentially about once per 60s; an offline meter incurs one ModbusMaster timeout (2s in the pinned library), then remaining fields are marked failed. Each successful register read is separated by 50ms. HTTPS has 5s connection/read and 8s TLS handshake timeouts, and cannot block the polling task. Wi-Fi attempts have 20s windows and 30s pauses. Upload batches contain up to four samples, with a minimum 10s spacing and exponential retry backoff from 5s to 300s plus jitter. Retries keep the same UUIDs. The first rate-limited retry can return 429, then backs off further. No shared master device key is used.

**Data loss:** there is a 32-sample RAM queue plus up to four pending samples. On queue overflow the oldest queued sample is dropped and a counter is logged. RAM data is lost on power loss/reset. A batch older than six days is dropped; permanent schema/meter 400/403/413/415 errors discard the rejected batch with a diagnostic so it cannot block all later samples. 401/429/network/5xx failures retain the batch for retry. This is **not lossless offline storage**. At one meter, the queue holds about 36 minutes; at eight meters about 4.5 minutes. Diagnostics never print Wi-Fi passwords or upload tokens.

## GitHub Pages

The workflow `.github/workflows/pages.yml` runs unit, PostgreSQL, Edge type checks, browser checks, firmware compile, production build and asset checks, then publishes `dist` using Pages Actions. PRs validate without publishing. Main pushes/manual dispatches can deploy; no automatic merge is configured.

1. Push the feature branch and review it. Merge only after your review, or use your own approved branch workflow. A workflow must exist on the default branch for GitHub's manual-dispatch UI to appear.
2. Repository **Settings → Pages → Build and deployment → Source: GitHub Actions**. Ensure Actions is enabled. If using GitHub Free, a public repository is normally needed for free Pages; do not change repository visibility without reviewing what would become public.
3. **Settings → Secrets and variables → Actions → Variables**, create `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. They are intentionally public, not administrative secrets. With either missing, the app explains the missing configuration and cannot display readings.
4. Run the workflow, inspect all jobs and the `github-pages` environment URL, then open that exact URL. Test sign-in, owner isolation, first ESP32 upload and reload under `/Meter_Reading_Dashboard/`. Do not treat a green build as proof that hosted ingestion or hardware works.

Expected project URL is `https://diwas03.github.io/Meter_Reading_Dashboard/`; **this is not a verified deployed URL**. Pages hosts public application files even when application data requires login. This is a personal/noncommercial monitoring dashboard, not commercial SaaS or an e-commerce site. GitHub Pages prohibits using it primarily for commercial transactions/SaaS and discourages sensitive transactions. Published site limit 1 GB; soft bandwidth limit 100 GB/month; deployment timeout 10 minutes. Auth requests go directly over HTTPS to Supabase; Pages never receives database secrets. Review applicable restrictions before changing use.

## Individual graphs and received-data table

**Overview** has one graph per supported parameter (16 total): all phase-to-neutral and phase-to-phase voltages, average voltage, R/Y/B/neutral currents, R/Y/B/average power factors, and frequency. Choose the gateway/meter and time range above the charts. Each graph plots only that parameter; selecting multiple meters compares the same parameter across those meters.

Choose **Data table** to inspect individual stored samples. Use **Logged from** and **Logged through** to filter by server-received calendar date in the selected timezone (Asia/Thimphu by default). The entire end date is included. Rows are newest first, 50 per page, with all values, measured/logged timestamps, quality and per-field errors. Failed values display — while real zero remains 0.000.

**Download CSV** exports the full selected date range for the selected meters, up to seven days and 10,000 rows. CSV timestamps remain UTC and failed fields are empty. Table queries support up to 90 days, subject to the raw-data retention policy. Pagination uses received time plus row ID so identical timestamps do not cause duplicate or skipped rows. The read-only table RPC is protected by the same ownership RLS as graphs.

## Tests and architecture

```sh
npm test                 # validation, HTTP handlers, deterministic data and CSV semantics
npm run test:db          # isolated PostgreSQL 17 container; no real project or public DB port
npm run test:edge        # Deno checks both actual Edge entrypoints
npm run test:browser     # system Chromium locally; Playwright Chromium on CI
npm run build
npm run check:assets
npm run check:source
```

For local browser tests install Chromium or set `CHROMIUM_PATH`. In CI: `npx playwright install --with-deps chromium`. On a proxied cloud machine Deno needs the supplied trusted CA (`DENO_CERT`), and Arduino CLI may need `network.proxy`; never disable TLS verification. Details: [architecture](docs/architecture.md), [storage and quotas](docs/storage.md), [verification and deployment blockers](docs/verification.md), [official documentation checked](docs/references.md).
