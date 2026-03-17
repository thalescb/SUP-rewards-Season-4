# Development Guide

Season 4 SUP Rewards Report — GoodDollar / Superfluid

---

## Project overview

This is a single-page analytics report that shows how Season 4 SUP rewards
were distributed across GoodDollar participants.  It pulls live data from three
sources:

| Source | What it provides |
|--------|-----------------|
| Superfluid Protocol Subgraph (Base Mainnet) | Pool members, units, SUP distribution totals |
| Superfluid Points API (`cms.superfluid.pro`) | Campaign points leaderboard & event history |
| GoodDollar Subgraph (The Graph) | Locker→owner mappings, on-chain entity counts |

A **snapshot** (`data/snapshot.json`) can be committed to the repo so the page
loads instantly without making any live API calls.

---

## Directory structure

```
SUP-rewards-Season-4/
├── index.html              # HTML shell (no inline CSS or JS)
├── vite.config.js          # Vite build configuration
├── package.json            # npm manifest
│
├── src/
│   ├── css/
│   │   └── main.css        # All styles (design tokens, layout, components)
│   └── js/
│       ├── main.js         # Entry point: imports CSS, wires globals, calls init()
│       ├── config.js       # Hard-coded constants (endpoints, pool address, etc.)
│       ├── state.js        # Shared mutable application state object
│       ├── api.js          # Network helpers: gql(), gdGql(), fetchPtsApi(), batchEthCall()
│       ├── calculations.js # Pure math/formatting: calcSup(), giniCoeff(), fmt(), usd(), addressLink()
│       ├── snapshot.js     # Snapshot load / build / download
│       ├── pipeline.js     # 7-step live data pipeline (go())
│       ├── render.js       # Full DOM render from state
│       ├── charts.js       # Chart.js wrappers: bar, line, doughnut
│       ├── export.js       # CSV export functions
│       └── ui.js           # Step indicators, tab switching, refresh handler
│
├── data/
│   ├── snapshot.json       # Cached data snapshot (commit this after a refresh)
│   └── source_code.js      # Original monolithic source (reference only)
│
└── lockers.json            # Pre-fetched locker→owner map (large; used as fallback)
```

---

## Prerequisites

- **Node.js** ≥ 18  (check with `node -v`)
- **npm** ≥ 9       (check with `npm -v`)

---

## Installation

```bash
npm install
```

This installs Vite and Chart.js as listed in `package.json`.

---

## Running locally (development server)

```bash
npm run dev
```

Vite starts a hot-reloading dev server (default: `http://localhost:5173`).

Open the URL in your browser.  The page will either:

1. **Load instantly from snapshot** if `data/snapshot.json` exists.
2. **Run the live pipeline** if no snapshot is present (takes ~10 minutes;
   requires network access to Superfluid / GoodDollar APIs).

> **CORS note**: The Superfluid Points API does not allow browser requests from
> `localhost`.  If the Points step fails, the UI will prompt you to upload a
> `points_data.json` file.  See the "Fetching points data manually" section.

---

## Building for production / GitHub Pages

```bash
npm run build
```

Output goes to `dist/`.  The build uses relative paths (`base: './'` in
`vite.config.js`) so it works when served from any GitHub Pages sub-path.

### Previewing the build locally

```bash
npm run preview
```

Vite serves the `dist/` folder at `http://localhost:4173`.

### Deploying to GitHub Pages

Two common approaches:

**Option A — deploy from `docs/` on `main`:**

```bash
npm run build
cp -r dist/ docs/
git add docs/
git commit -m "build: update GitHub Pages output"
git push
```

Then in GitHub → Settings → Pages: set source to `main`, folder `/docs`.

**Option B — deploy to `gh-pages` branch (recommended):**

Install the helper:
```bash
npm install --save-dev gh-pages
```

Add to `package.json` scripts:
```json
"deploy": "npm run build && gh-pages -d dist"
```

Then:
```bash
npm run deploy
```

In GitHub → Settings → Pages: set source to `gh-pages` branch, folder `/`.

---

## Updating the snapshot

The snapshot allows instant loading without live API calls.  Update it whenever
you want to refresh the displayed data:

1. Start the dev server: `npm run dev`
2. Wait for the live pipeline to complete (~10 minutes).
3. Click **"⬇ Snapshot"** — a `snapshot.json` file is downloaded.
4. Move/copy it to `data/snapshot.json`.
5. Commit and push:

```bash
git add data/snapshot.json
git commit -m "data: update Season 4 snapshot $(date -u +%Y-%m-%d)"
git push
```

---

## Fetching points data manually

If the Points API is blocked by CORS (common when accessing from a browser on
a non-whitelisted origin), fetch the data via PowerShell on Windows:

```powershell
$all = @()
$p   = 1
do {
    $r    = Invoke-RestMethod "https://cms.superfluid.pro/points/accounts?campaignId=7860&limit=100&page=$p"
    $all += $r.accounts
    $p++
} while ($r.pagination.hasNextPage)

$all | ConvertTo-Json -Depth 5 | Out-File "$env:USERPROFILE\Desktop\points_data.json" -Encoding UTF8
```

Or via curl / jq on macOS / Linux:

```bash
page=1; all='[]'
while :; do
  resp=$(curl -s "https://cms.superfluid.pro/points/accounts?campaignId=7860&limit=100&page=${page}")
  accounts=$(echo "$resp" | jq '.accounts')
  all=$(echo "$all $accounts" | jq -s 'add')
  hasNext=$(echo "$resp" | jq -r '.pagination.hasNextPage')
  [ "$hasNext" = "true" ] || break
  ((page++))
done
echo "$all" > points_data.json
```

Then click the **"Upload points_data.json"** button that appears in the loading
overlay when the Points step fails.

---

## Adapting for a future season

All season-specific values are in `src/js/config.js`:

| Constant    | Purpose |
|-------------|---------|
| `PID`       | Superfluid pool contract address on Base Mainnet |
| `CID`       | Superfluid Points campaign ID |
| `SG`        | Superfluid subgraph endpoint |
| `PA`        | Points API base URL |
| `GD_SG`     | GoodDollar subgraph ID |
| `BASE_RPCS` | RPC fallback list for on-chain owner() resolution |
| `OWNER_SELS`| Function selectors tried for locker ownership |

Update those constants, delete (or archive) the old `data/snapshot.json`, and
run the pipeline live to generate a fresh snapshot for the new season.

The `expectedSUP` sanity-check value in `src/js/render.js → renderTechDetails()`
should also be updated to match the new season's total allocation.

---

## Module reference

| Module | Exports | Description |
|--------|---------|-------------|
| `config.js` | constants | All hard-coded values |
| `state.js` | `state` | Shared mutable state object |
| `api.js` | `gql`, `gdGql`, `fetchPtsApi`, `batchEthCall` | Network utilities |
| `calculations.js` | `calcSup`, `giniCoeff`, `fmt`, `usd`, `addressLink` | Pure math/formatting |
| `snapshot.js` | `loadSnapshot`, `buildSnapshot`, `downloadSnapshot` | Snapshot management |
| `pipeline.js` | `runPipeline` | 7-step live data pipeline |
| `render.js` | `render` | Full DOM render |
| `charts.js` | `renderBarChart`, `renderLineChart`, `renderDoughnutChart` | Chart.js wrappers |
| `export.js` | `exportPool`, `exportPoints`, `exportSummary` | CSV downloads |
| `ui.js` | `setStepStatus`, `switchTab`, `refreshLive` | UI interactions |
| `main.js` | — | Entry point; wires globals, calls `init()` |

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Blank page / no data | Open browser DevTools console; check for network errors. |
| Points step fails with "CORS" | Fetch manually (see above) and upload the file. |
| Snapshot loads stale data | Delete `data/snapshot.json`, click "↻ Refresh Live", re-download snapshot. |
| Chart.js "Canvas already in use" | This happens if `render()` is called twice without destroying old charts. The `refreshLive()` function destroys all instances before re-running. |
| RPC resolution is slow | Normal — batching 50 calls per request across up to 3 RPC endpoints takes a few minutes for ~1 000 pool members. |
| Build fails: `Cannot find module 'chart.js/auto'` | Run `npm install` first. |
