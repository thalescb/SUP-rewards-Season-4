/**
 * calculations.js
 *
 * Pure math / formatting helpers.  No DOM access; no side effects.
 *
 * Data transformation notes
 * ─────────────────────────
 * SUP amounts are stored on-chain as 18-decimal integers (Wei-like).
 * The formula used to compute each member's accrued SUP is:
 *
 *   received = totalAmountReceived (already distributed to member)
 *   pending  = (units / totalUnits) × (poolTotal − memberSnapshotTotal)
 *   SUP      = (received + pending) / 1e18
 *
 * The `poolTotalAmountDistributedUntilUpdatedAt` field on each member is a
 * snapshot of the pool total at the time the member's units were last updated.
 * The difference (pool total − member snapshot) gives the amount distributed
 * since the last update, of which the member is entitled to their unit share.
 */

import { W } from './config.js';
import { state } from './state.js';

// ---------------------------------------------------------------------------
// SUP reward calculation
// ---------------------------------------------------------------------------

/**
 * Compute the total SUP tokens received (including pending distribution) for a
 * single pool member.
 *
 * @param {object} m - A pool member object from the Superfluid subgraph.
 * @returns {number} Total SUP as a human-readable float.
 */
export function calcSup(m) {
  // Raw 18-decimal integers from the subgraph.
  const received        = Number(m.totalAmountReceivedUntilUpdatedAt);
  const memberSnapshot  = Number(m.poolTotalAmountDistributedUntilUpdatedAt);
  const poolTotal       = Number(state.pool.totalAmountDistributedUntilUpdatedAt);
  const units           = Number(m.units);
  const totalUnits      = Number(state.pool.totalUnits);

  if (totalUnits === 0) {
    // No units allocated — fall back to directly recorded amount.
    return received / W;
  }

  // Pending amount: the member's pro-rata share of distribution since their
  // units were last updated.
  const pending = (units / totalUnits) * (poolTotal - memberSnapshot);

  return (received + pending) / W;
}

// ---------------------------------------------------------------------------
// Statistical helpers
// ---------------------------------------------------------------------------

/**
 * Compute the Gini coefficient for an array of non-negative values.
 *
 * The Gini coefficient measures inequality:
 *   0 = perfect equality (everyone receives the same)
 *   1 = maximum inequality (one person receives everything)
 *
 * Algorithm: sort ascending, then apply the standard discrete formula
 *   G = Σ (2i − n − 1) × x_i  /  (n² × μ)
 * where i is the 1-based rank, n is the count, and μ is the mean.
 *
 * @param {number[]} values - Raw (unsorted) distribution values.
 * @returns {number} Gini coefficient in [0, 1].
 */
export function giniCoeff(values) {
  // Only consider positive values (zeros don't affect inequality).
  const sorted = values.filter(x => x > 0).sort((a, b) => a - b);
  const n      = sorted.length;

  if (!n) return 0;

  const mean = sorted.reduce((a, b) => a + b, 0) / n;
  if (!mean) return 0;

  let numerator = 0;
  for (let i = 0; i < n; i++) {
    // (2i − n − 1) using 1-based index: (2(i+1) − n − 1)
    numerator += (2 * (i + 1) - n - 1) * sorted[i];
  }

  return numerator / (n * n * mean);
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/**
 * Format a number with locale-aware thousand separators.
 *
 * @param {number|string} n - Value to format.
 * @param {number}        d - Maximum decimal places (default 0).
 * @returns {string} Formatted string, e.g. "1,234,567.89".
 */
export function fmt(n, d = 0) {
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: d });
}

/**
 * Return a USD equivalent string for a SUP amount, or an empty string if the
 * live price is unavailable.
 *
 * @param {number} supAmount - Amount in SUP (not wei).
 * @returns {string} e.g. "≈ $1,234.56 USD" or "".
 */
export function usd(supAmount) {
  return state.price ? `≈ $${fmt(supAmount * state.price, 2)} USD` : '';
}

/**
 * Build an HTML snippet for an Ethereum address: a Basescan link showing the
 * truncated address plus a clipboard copy button.
 *
 * @param {string} a - Full Ethereum address (checksummed or lowercase).
 * @returns {string} HTML string safe for innerHTML assignment.
 */
export function addressLink(a) {
  const short = `${a.slice(0, 8)}…${a.slice(-4)}`;

  // Clipboard copy handler: swaps icon to ✓ for 1 second, then restores.
  const copyHandler = `navigator.clipboard.writeText('${a}');this.textContent='✓';setTimeout(()=>this.textContent='📋',1000)`;

  return (
    `<a href="https://basescan.org/address/${a}" target="_blank" rel="noopener" ` +
    `style="color:var(--accent);text-decoration:none" title="${a}">${short}</a>` +
    `<span onclick="${copyHandler}" ` +
    `style="cursor:pointer;margin-left:4px;font-size:10px;opacity:.5" title="Copy full address">📋</span>`
  );
}
