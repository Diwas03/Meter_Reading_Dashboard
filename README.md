# Current · meter dashboard

Public static dashboard build. Contains only the browser application, public Supabase URL/publishable key, build metadata and Pages deployment workflow. No private repository history, administrative keys, device credentials, firmware or database source is included.

Set repository Settings → Pages → Source to GitHub Actions. Enable Pages in repository settings before running the workflow. Run the workflow and verify its reported deployment URL.

The dashboard opens directly to sign-in and displays only authenticated ESP32 readings, with Asia/Thimphu dates/times by default. No demo mode or sample generators are shipped. Create the dashboard user in the intended Supabase project's Authentication → Users screen before signing in.

To update, rebuild from the source checkout with npm run build:site and commit the fresh static output into this repository. Keep real credentials out of Git.
