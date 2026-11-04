# Current · meter dashboard

Public static dashboard build. Contains only the browser application, public Supabase URL/publishable key, build metadata and Pages deployment workflow. No private repository history, administrative keys, device credentials, firmware or database source is included.

Set repository Settings → Pages → Source to GitHub Actions. The included workflow also attempts to enable Pages automatically. Run the workflow and verify its reported deployment URL.

The dashboard starts in clearly labelled local demo mode. Choose “Connect your meters” and sign in to view private telemetry. Create the dashboard user in the intended Supabase project's Authentication → Users screen before signing in.

To update, rebuild from the private source with npm run build:site and commit the fresh static output into this repository. Keep the private repository private.
