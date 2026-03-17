/**
 * export.js
 *
 * CSV export helpers.  All functions read from the window-level cache set by
 * render.js (`window._pr`, `window._tr`, `window._tS`, `window._st`) so that
 * exports always reflect exactly what is displayed on screen.
 */

import { state }  from './state.js';
import { fmt }    from './calculations.js';
import { CID, PID } from './config.js';

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/**
 * Serialise an array of row objects into a CSV string.
 *
 * Cells that contain commas or double-quotes are quoted and escaped per RFC 4180.
 *
 * @param {object[]} rows    - Array of plain objects (all must have the same keys).
 * @param {string[]} headers - Ordered list of keys to include as columns.
 * @returns {string} CSV text with a header row followed by data rows.
 */
function buildCsv(rows, headers) {
  const escape = v =>
    typeof v === 'string' && (v.includes(',') || v.includes('"'))
      ? `"${v.replace(/"/g, '""')}"`
      : v;

  return [
    headers.join(','),
    ...rows.map(r => headers.map(k => escape(r[k])).join(',')),
  ].join('\n');
}

/**
 * Trigger a browser download of a text file.
 *
 * @param {string} content  - File contents.
 * @param {string} filename - Suggested download filename.
 */
function downloadFile(content, filename) {
  const blob = new Blob([content], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');

  a.href     = url;
  a.download = filename;
  a.click();

  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Public export functions (attached to window by main.js)
// ---------------------------------------------------------------------------

/**
 * Export the full pool member list with SUP amounts, points, and metadata.
 *
 * Columns: rank, wallet, locker, sup, usd, points, events, units, share,
 *          connected, matched, resolved
 */
export function exportPool() {
  const pr   = window._pr;
  const tS   = window._tS;
  const price = state.price;

  const rows = pr.map((r, i) => ({
    rank:      i + 1,
    wallet:    r.wallet || '',
    locker:    r.locker,
    sup:       Math.round(r.s * 1e4) / 1e4,
    usd:       price ? Math.round(r.s * price * 100) / 100 : '',
    points:    r.pts,
    events:    r.ev,
    units:     r.u,
    share:     Math.round(r.s / tS * 1e4) / 100,
    connected: r.c       ? 'Y' : 'N',
    matched:   r.matched ? 'Y' : 'N',
    resolved:  r.resolved ? 'Y' : 'N',
  }));

  downloadFile(
    buildCsv(rows, ['rank', 'wallet', 'locker', 'sup', 'usd', 'points', 'events', 'units', 'share', 'connected', 'matched', 'resolved']),
    'season4_pool.csv',
  );
}

/**
 * Export the points leaderboard.
 *
 * Columns: rank, wallet, points, events, last
 */
export function exportPoints() {
  const rows = window._tr.map((r, i) => ({
    rank:   i + 1,
    wallet: r.a,
    points: r.p,
    events: r.e,
    last:   r.l || '',
  }));

  downloadFile(
    buildCsv(rows, ['rank', 'wallet', 'points', 'events', 'last']),
    'season4_points.csv',
  );
}

/**
 * Export a one-column summary of key metrics.
 *
 * Columns: m (metric name), v (value)
 */
export function exportSummary() {
  const s    = window._st;
  const rows = [
    { m: 'Total Funding (SUP)',    v: Math.round(s.tF   * 100) / 100 },
    { m: 'Total Distributed (SUP)', v: Math.round(s.tS  * 100) / 100 },
    { m: 'SUP Price (USD)',        v: s.price || 'N/A' },
    { m: 'Total Value (USD)',      v: s.price ? Math.round(s.tS * s.price * 100) / 100 : 'N/A' },
    { m: 'Pool Members',           v: s.m },
    { m: 'Connected',              v: s.cn },
    { m: 'Points Participants',    v: s.pa },
    { m: 'Matched (Pool↔Points)', v: s.matched },
    { m: 'Lockers Indexed',        v: s.lkCount },
    { m: 'Total Points',           v: s.tP },
    { m: 'Total Units',            v: s.u },
    { m: 'Average (SUP)',          v: Math.round(s.avg  * 100) / 100 },
    { m: 'Median (SUP)',           v: Math.round(s.med  * 100) / 100 },
    { m: 'Top 10 %',               v: Math.round(s.t10p * 100) / 100 },
    { m: 'Gini',                   v: Math.round(s.g    * 1000) / 1000 },
    { m: 'Token',                  v: 'SUP' },
    { m: 'Pool',                   v: PID },
    { m: 'Network',                v: 'Base Mainnet' },
    { m: 'Campaign',               v: '#' + CID },
  ];

  downloadFile(buildCsv(rows, ['m', 'v']), 'season4_summary.csv');
}
