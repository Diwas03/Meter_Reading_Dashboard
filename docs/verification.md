# Verification and remaining limits

Local checks executed 2026-11-03 on feature branch `feat/meter-monitoring`.

| Check | Result and scope |
|---|---|
| Unit/HTTP contract tests | **45 passed**: schema/numeric/date/size validation; real zero/null/error handling; HTTP auth/errors; per-user provisioning; hash/token minting; rotation/revocation response behaviour; offline/stale timing; Thimphu dates; deterministic demo; CSV escaping, keyset paging beyond 500 rows, 10k cap and quota errors |
| PostgreSQL 17 integration | **Passed**: migrations apply; owner-isolated tables and latest/chart/CSV RPCs including explicitly guessed other-owner UUIDs; anonymous and browser write denial; credential table denial; token authorization, rotation and revocation; rate limit; gateway+slave separation; atomic duplicate handling; server-clock fallback; chart null buckets; CSV range/cursor bounds; 5,000 + 100 row retention batches, recent rows retained |
| Edge runtime type checks | **Both entrypoints passed Deno check**, using their own lockfile and dependency context. HTTP handler tests use an injected backend adapter; SQL tests use a real disposable PostgreSQL database. Hosted Supabase gateway/JWT behaviour is not claimed from those tests. |
| Frontend TypeScript + production build | **Passed**. Browser/SDK/chart chunks split; no external font/CDN needed. |
| Browser functional checks | **2 passed** in real Chromium: desktop demo rendering, chart range changes, multi-meter/gateway selection, actual CSV download/content, disabled demo provisioning, setup modal keyboard close; phone width/no horizontal overflow and missing-config login state |
| Pages base path | **Passed** built-asset checks for `/Meter_Reading_Dashboard/`; no root-relative `/assets/` references. Real hosted deployment is unverified. |
| Credential scans | **Passed** current source patterns and built assets. No gateway token/admin key is bundled. The inherited ThingSpeak commit contained hardcoded connection credentials; current feature source uses ignored local config. **Old history still contains those values and they must be rotated.** Scans are targeted checks, not proof no conceivable secret exists. |
| Production dependency audit | **0 vulnerabilities reported** by `npm audit --omit=dev` at verification time |
| Firmware compilation | **Not completed locally**: official Arduino CLI 1.3.1 downloaded and checksum verified; board/library indexes denied by network policy. Firmware compile is added to CI using exact pinned packages and example config, but no CI run is claimed. Exact ESP32 3.3.0 HTTPS timeout implementation inspected. |
| Physical hardware | **Not run**. Owner's previous auxiliary-power zero responses are the only reported hardware validation. No claim of nonzero mapping/scaling/word-order calibration, Wi-Fi/TLS success, or timing under real bus faults. |
| Supabase hosted deployment | **Blocked/unverified**. Target `qivwjkqkeipaivztgbyy` supplied by owner. Repository linkage does not provide a management token. The session has no usable Supabase binding. Functions, migrations, Auth redirects and Cron have not been applied/verified remotely. |
| GitHub API / Pages | **Blocked/unverified**: live proxy denied `api.github.com`; Git read works. No Pages URL has been verified. Workflow is supplied, not claimed as executed. |

The PostgreSQL suite creates an unexposed, network-isolated container with a minimal test-only `auth.uid()`/role model, exercises real PostgreSQL RLS/grants/functions and rolls back fixtures. It does not replace testing real Supabase Auth sessions, PostgREST defaults, project policies or Edge infrastructure. Initial migration and readiness-test issues were corrected; final successful checks are recorded above rather than treating earlier failures as passes.

## Required hosted follow-up

1. Apply reviewed network settings and securely configure the saved `SUPABASE_ACCESS_TOKEN` requirement; configure the public frontend key. See [target deployment settings](deployment.md).
2. On the intended project, apply migrations; deploy functions; create two test users; verify login and direct cross-user PostgREST/RPC queries return no other-owner records. Verify public database writes are denied.
3. Register one gateway per owner and multiple slaves. Upload valid zero and partial readings; verify exact null/error preservation, timestamp fallback, retry duplication, wrong-gateway/slave rejection, invalid credentials, rotation and revocation. Wait ≥10s between accepted batches or expect 429.
4. Activate Cron intentionally, inspect scheduled job outcome and retention setting, and check database/egress/invocation quotas.
5. Run GitHub Actions including firmware compilation, publish Pages, and verify the reported HTTPS deployment URL, reload path, live Auth and actual queries. No automatic main merge is configured.
6. Configure CA trust and flash the ESP32. Test Wi-Fi/backend loss, queue overflow and reset loss; verify Serial output, certificate validation, clock sync, retry IDs, and nonzero values against the meter display. Register a second slave and verify both before relying on the installation.

No paid plan, existing remote database change, public database write policy or credential-verification bypass was introduced.
