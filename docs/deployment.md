# Deployment state · 2026-11-04

## Supabase: deployed and verified

- Project reference: `qivwjkqkeipaivztgbyy`
- Project URL: `https://qivwjkqkeipaivztgbyy.supabase.co`
- Ingest: `https://qivwjkqkeipaivztgbyy.supabase.co/functions/v1/ingest`
- Provisioning: `https://qivwjkqkeipaivztgbyy.supabase.co/functions/v1/provision`

The migration is applied with CLI-compatible migration tracking; all five app tables have RLS. Both functions are ACTIVE, version 1, with explicit custom authentication and `verify_jwt=false`. Hosted Auth, provisioning, ingestion, persistence, zero/null/error semantics, ownership isolation, credential rotation/revocation, retries, charts and CSV queries passed. Temporary verification accounts and cascading data were removed. No real owner account or gateway credential was fabricated.

Public signup is disabled. Create your own app user at https://supabase.com/dashboard/project/qivwjkqkeipaivztgbyy/auth/users before signing in. Auth's site URL is `https://diwas03.github.io/Meter_Reading_Dashboard/`; local-development redirects are also retained. Scheduled 30-day retention is active (`meter-retention`, every ten minutes, at most 5,000 expired rows/run), and a successful Cron execution was observed. Do not reapply the initial migration or reset this project.

## GitHub Pages publication

The owner chose the original repository, `Diwas03/Meter_Reading_Dashboard`, and made it public. Anonymous GitHub API verification confirms this even though connected account metadata was stale. Historical ThingSpeak credentials must be rotated; the original history is not rewritten automatically.

Source changes remain on `feat/meter-monitoring`, with no automatic merge into main. A fresh **gh-pages** branch contains only the built dashboard, public Supabase URL/publishable key, public build metadata, README and a static Pages Actions workflow. It does not contain device credentials, administrative keys, firmware, database source or the original Git history. Other branches remain part of the same public repository.

```sh
# From the source checkout with the public frontend variables configured:
npm ci
npm run build:site
# Generated static-only publishing files are in ignored .public-site/
```

The default publishing path is `/Meter_Reading_Dashboard/`, with workflow pushes on `gh-pages`. `PAGES_REPOSITORY` and `PAGES_SOURCE_BRANCH` can override those names when preparing a different target. The generated workflow uses Pages Actions; the owner enabled Pages in repository settings. No build secrets or repository variables are needed for this prebuilt static branch. The source workflow still supports rebuilding/deploying from main after review, with the two public Actions variables configured.

The verified live URL is **https://diwas03.github.io/Meter_Reading_Dashboard/**. [Release run 41793190376](https://github.com/Diwas03/Meter_Reading_Dashboard/actions/runs/41793190376) completed successfully, including the explicit read-only HTTPS smoke step: dashboard HTML, every referenced asset, live Supabase public config and build metadata. If Pages is later disabled, open https://github.com/Diwas03/Meter_Reading_Dashboard/settings/pages and select **Source: GitHub Actions**, then rerun the static branch workflow. The session's GitHub account connection cannot directly configure Pages or Actions variables (403), but normal Git pushes and workflow discovery are authorized.

Follow [first-reading.md](first-reading.md) to create your own app login, register the ESP32 and upload its first real reading. Never use the account management token or administrative key on the device or frontend.
