/**
 * main.js
 *
 * Application entry point.
 *
 * Responsibilities:
 *  1. Import the CSS so Vite bundles it and injects it at build time.
 *  2. Attach all window-level functions required by HTML inline event handlers
 *     (onclick attributes in index.html cannot reference ES module exports
 *     directly; they must be properties of the global `window` object).
 *  3. Kick off the initialisation logic: try snapshot first, fall back to live.
 */

// Let Vite handle CSS injection (creates a <link> in dev and inline styles in build).
import '../css/main.css';

import { loadSnapshot }    from './snapshot.js';
import { downloadSnapshot } from './snapshot.js';
import { runPipeline }     from './pipeline.js';
import { render }          from './render.js';
import { switchTab, refreshLive } from './ui.js';
import { exportPool, exportPoints, exportSummary } from './export.js';

// ---------------------------------------------------------------------------
// Expose functions to the global scope for HTML onclick handlers
// ---------------------------------------------------------------------------

// Export buttons
window.xSnap  = downloadSnapshot;
window.xPool  = exportPool;
window.xPts   = exportPoints;
window.xSum   = exportSummary;

// Tab switching
window.sw = switchTab;

// Refresh button
window.refreshLive = refreshLive;

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------

/**
 * Try to load a pre-built snapshot for instant rendering.
 * If no snapshot is found, run the full live data pipeline instead.
 */
async function init() {
  const loaded = await loadSnapshot();

  if (loaded) {
    // Snapshot found → skip loading overlay and render immediately
    document.getElementById('ov').style.display  = 'none';
    document.getElementById('rpt').style.display = 'block';
    render();
  } else {
    // No snapshot → fetch live from blockchain and APIs
    runPipeline();
  }
}

init();
