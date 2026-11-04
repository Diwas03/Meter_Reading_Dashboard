// Creates a fresh static-only publishing directory. No private Git history or backend source.
import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
const repository = process.env.PAGES_REPOSITORY || "Meter_Reading_Dashboard";
const branch = process.env.PAGES_SOURCE_BRANCH || "gh-pages";
if (!/^[A-Za-z0-9._-]+$/.test(branch))
  throw new Error("Invalid publishing branch");
if (!/^[A-Za-z0-9._-]+$/.test(repository))
  throw new Error("Invalid Pages repository name");
if (
  !process.env.VITE_SUPABASE_URL ||
  !process.env.VITE_SUPABASE_PUBLISHABLE_KEY?.startsWith("sb_publishable_")
)
  throw new Error(
    "Set the public VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY first",
  );
const env = { ...process.env, PAGES_BASE_PATH: `/${repository}/` };
execFileSync("npm", ["run", "build"], { env, stdio: "inherit" });
execFileSync("node", ["tests/check-assets.mjs"], { env, stdio: "inherit" });
const output = resolve(".public-site");
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
cpSync("dist", output, { recursive: true });
mkdirSync(output + "/.github/workflows", { recursive: true });
writeFileSync(output + "/.nojekyll", "");
writeFileSync(
  output + "/.github/workflows/pages.yml",
  `name: Publish static dashboard
on:
  push:
    branches: [${branch}]
  workflow_dispatch:
permissions:
  contents: read
  pages: write
  id-token: write
concurrency:
  group: pages
  cancel-in-progress: true
jobs:
  publish:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: \${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v5
      - uses: actions/configure-pages@v5
        with:
          enablement: true
      - uses: actions/upload-pages-artifact@v3
        with:
          path: .
      - uses: actions/deploy-pages@v4
        id: deployment
`,
);
const sha = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
writeFileSync(
  output + "/build-info.json",
  JSON.stringify(
    {
      source_commit: sha,
      base_path: env.PAGES_BASE_PATH,
      built_at: new Date().toISOString(),
    },
    null,
    2,
  ) + "\n",
);
writeFileSync(
  output + "/README.md",
  `# Current · meter dashboard\n\nPublic static dashboard build. Contains only the browser application, public Supabase URL/publishable key, build metadata and Pages deployment workflow. No private repository history, administrative keys, device credentials, firmware or database source is included.\n\nSet repository Settings → Pages → Source to GitHub Actions. The included workflow also attempts to enable Pages automatically. Run the workflow and verify its reported deployment URL.\n\nThe dashboard starts in clearly labelled local demo mode. Choose “Connect your meters” and sign in to view private telemetry. Create the dashboard user in the intended Supabase project's Authentication → Users screen before signing in.\n\nTo update, rebuild from the private source with npm run build:site and commit the fresh static output into this repository. Keep the private repository private.\n`,
);
console.log(`Static-only publish directory: ${output}`);
