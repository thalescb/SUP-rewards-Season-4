/**
 * ui.js
 *
 * UI interaction helpers: loading-step indicators, tab switching,
 * and the "Refresh Live" flow.
 */

import Chart from 'chart.js/auto';
import { state }       from './state.js';
import { runPipeline } from './pipeline.js';

// ---------------------------------------------------------------------------
// Step indicator
// ---------------------------------------------------------------------------

/**
 * Update the visual state of a pipeline loading step.
 *
 * Steps live in the loading overlay and track progress through the 7-stage
 * data-fetching pipeline.  Each step has a `.ico` span whose text content
 * signals the current status at a glance.
 *
 * @param {string} id     - Element id, e.g. `'s1'`.
 * @param {string} status - One of `'active'`, `'done'`, `'fail'`.
 */
export function setStepStatus(id, status) {
  const el  = document.getElementById(id);
  el.className = 'step ' + status;

  const icons = { done: '✓', active: '◉', fail: '✗' };
  el.querySelector('.ico').textContent = icons[status] ?? '○';
}

// ---------------------------------------------------------------------------
// Tab switching
// ---------------------------------------------------------------------------

/**
 * Switch between the "Top SUP Recipients" and "Top Points Earners" tables.
 *
 * Called from the HTML tab buttons via `onclick`.
 *
 * @param {string}      tab - `'p'` for pool recipients, `'t'` for points earners.
 * @param {HTMLElement} el  - The clicked tab element (receives the `.on` class).
 */
export function switchTab(tab, el) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('on'));
  el.classList.add('on');

  document.getElementById('tp').style.display = tab === 'p' ? 'block' : 'none';
  document.getElementById('tt').style.display = tab === 't' ? 'block' : 'none';

  const count = tab === 'p' ? window._pr?.length : window._tr?.length;
  document.getElementById('tc').textContent = `Top 30 of ${count ?? 0}`;
}

// ---------------------------------------------------------------------------
// Refresh live
// ---------------------------------------------------------------------------

/**
 * Reset all application state and re-run the full live data pipeline.
 *
 * This is the handler for the "↻ Refresh Live" button.  It:
 *  1. Asks the user to confirm (the pipeline takes ~10 minutes).
 *  2. Resets the `state` object to initial empty values.
 *  3. Destroys any existing Chart.js instances to free canvas contexts.
 *  4. Restores the loading overlay to its initial visual state.
 *  5. Calls `runPipeline()` to begin live fetching.
 */
export async function refreshLive() {
  if (!confirm('This will re-fetch all data live from the blockchain and APIs.\nThis takes ~10 minutes. Continue?')) return;

  // Reset shared state
  state.pool         = undefined;
  state.mem          = [];
  state.pts          = [];
  state.price        = null;
  state.tl           = [];
  state.actions      = {};
  state.lockers      = {};
  state.sgActivity   = {};
  state.resolveStats = {};
  state.snapshotTime = null;

  // Destroy all active Chart.js instances to release their canvas contexts
  // (otherwise Chart.js throws when re-using the same canvas ids).
  Object.values(Chart.instances || {}).forEach(c => {
    try { c.destroy(); } catch (_) { /* ignore */ }
  });

  // Show overlay, hide report
  document.getElementById('rpt').style.display = 'none';
  const ov = document.getElementById('ov');
  ov.style.display = 'flex';
  ov.classList.remove('fade-out');
  ov.style.opacity  = '1';

  document.getElementById('ring').style.display = '';
  document.getElementById('ovt').textContent    = 'Refreshing Live Data';
  document.getElementById('ovs').textContent    = 'Re-fetching from blockchain and APIs…';
  document.getElementById('ebox').style.display = 'none';

  // Reset step indicators to their initial idle state
  for (let i = 1; i <= 7; i++) {
    const el = document.getElementById('s' + i);
    if (el) {
      el.className = 'step';
      el.querySelector('.ico').textContent = '○';
    }
  }

  // Remove any dynamic upload widgets injected during previous runs
  document.querySelectorAll('#steps > div:not(.step)').forEach(el => el.remove());

  runPipeline();
}
