/**
 * snapshot.js
 *
 * Snapshot caching layer.
 *
 * A snapshot is a trimmed, serialised copy of the application state saved as
 * `data/snapshot.json`.  Committing this file to the repository allows the
 * page to load instantly (no live API calls) while still displaying accurate
 * historical data.
 *
 * Workflow:
 *   1. Open the page without a snapshot → live pipeline runs.
 *   2. Click "⬇ Snapshot" → `downloadSnapshot()` triggers a browser download.
 *   3. Commit the downloaded file to `data/snapshot.json`.
 *   4. Next page load hits `loadSnapshot()` → instant render from cache.
 *   5. Click "↻ Refresh Live" at any time to re-run the full live pipeline.
 */

import { state } from './state.js';

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

/**
 * Attempt to load a pre-built snapshot from `data/snapshot.json`.
 *
 * If successful, all fields of `state` are populated and the function returns
 * `true`.  Returns `false` if the file is missing or malformed (the caller
 * should fall back to the live pipeline).
 *
 * @returns {Promise<boolean>}
 */
export async function loadSnapshot() {
  try {
    const r = await fetch('data/snapshot.json');
    if (!r.ok) return false;

    const snap = await r.json();

    // Hydrate application state from the snapshot fields.
    state.pool         = snap.pool;
    state.mem          = snap.mem;
    state.pts          = snap.pts;
    state.price        = snap.price;
    state.tl           = snap.tl           || [];
    state.actions      = snap.actions      || {};
    state.sgActivity   = snap.sgActivity   || {};
    state.lockers      = snap.lockers      || {};
    state.resolveStats = snap.resolveStats || {};
    state.snapshotTime = snap.generated_at || null;

    return true;
  } catch (_) {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

/**
 * Construct a snapshot object from the current application state.
 *
 * Data reduction steps applied before serialisation:
 *  - `lockers`: trimmed to only entries whose locker address is a pool member
 *    OR whose owner address appears in the points leaderboard — removes the
 *    large number of unrelated locker mappings loaded from lockers.json.
 *  - `tl` (timeline): trimmed to `{ id, timestamp }` pairs only; the render
 *    layer only needs timestamps, not unit-change amounts.
 *
 * @returns {object} Plain object ready to be passed to `JSON.stringify`.
 */
export function buildSnapshot() {
  // Build address sets for filtering.
  const poolAddrs = new Set(state.mem.map(m => m.account.id.toLowerCase()));
  const ptsAddrs  = new Set(state.pts.map(p => p.account.toLowerCase()));

  // Keep only locker entries relevant to the current report.
  const filteredLockers = {};
  Object.entries(state.lockers).forEach(([k, v]) => {
    if (poolAddrs.has(k) || ptsAddrs.has(v)) filteredLockers[k] = v;
  });

  // Strip unit-change details from timeline events (saves ~50 % of space).
  const trimmedTl = state.tl.map(e => ({ id: e.id, timestamp: e.timestamp }));

  return {
    generated_at: new Date().toISOString(),
    pool:         state.pool,
    mem:          state.mem,
    pts:          state.pts,
    price:        state.price,
    tl:           trimmedTl,
    actions:      state.actions,
    sgActivity:   state.sgActivity,
    lockers:      filteredLockers,
    resolveStats: state.resolveStats,
  };
}

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------

/**
 * Serialise the current state as a snapshot and trigger a browser download.
 *
 * The user should commit the downloaded `snapshot.json` to `data/` in the
 * repository to enable instant loading on future visits.
 */
export function downloadSnapshot() {
  const snap = buildSnapshot();
  const json = JSON.stringify(snap);

  const blob = new Blob([json], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');

  a.href     = url;
  a.download = 'snapshot.json';
  a.click();

  URL.revokeObjectURL(url);
}
