# Target account configuration

The owner supplied this new Supabase project URL:

- Project reference: `qivwjkqkeipaivztgbyy`
- Project URL: `https://qivwjkqkeipaivztgbyy.supabase.co`
- Ingestion URL after deployment: `https://qivwjkqkeipaivztgbyy.supabase.co/functions/v1/ingest`
- Provisioning URL after deployment: `https://qivwjkqkeipaivztgbyy.supabase.co/functions/v1/provision`

These are configuration destinations, **not verified running endpoints**.

## Configuration still needed

1. Supabase project's **Settings → API Keys → Publishable key**: enter its `sb_publishable_…` key as `VITE_SUPABASE_PUBLISHABLE_KEY`. Set `VITE_SUPABASE_URL` to the URL above. Locally these go in ignored `.env.local`; for GitHub Pages they go in **repository Actions variables**. Modern publishable keys are intentionally public. Never use a service-role or `sb_secret_…` key in these fields.
2. For this cloud session to deploy, securely add `SUPABASE_ACCESS_TOKEN` through environment settings. The saved credential requirement is scoped to `api.supabase.com`. GitHub–Supabase repository linking alone does not inject a management credential here. Do not put the token in GitHub Pages variables, code, chat or saved scripts. Alternatively run the README deployment commands from your own authenticated CLI.
3. Review/save the draft network settings. The current runtime initially permitted package-manager/Git destinations only. Saved additions: `supabase.com`, `api.supabase.com`, the project host, `docs.github.com`, `api.github.com`, `downloads.arduino.cc`, `espressif.github.io`, `dl.espressif.com`. Saving a draft does not apply or publish it. Refresh the runtime configuration and retry before assuming access works.
4. Apply the SQL migration, deploy both functions with explicit custom auth configuration, create an Auth user and set redirect URLs, enable retention Cron, and set GitHub Pages to Actions as described in README. Review migrations on the intended new project; don't reset or delete data from another project.

Supabase CLI commands for this target:

```sh
npx supabase login
npx supabase link --project-ref qivwjkqkeipaivztgbyy
npx supabase db push --dry-run
npx supabase db push
npx supabase functions deploy ingest --project-ref qivwjkqkeipaivztgbyy --no-verify-jwt
npx supabase functions deploy provision --project-ref qivwjkqkeipaivztgbyy --no-verify-jwt
```

Use the secure CLI password prompt if needed. Never run `db reset` remotely. Remote account tests must verify RLS, Auth, uploads and retention on this actual project; passing disposable PostgreSQL tests is not remote deployment verification.
