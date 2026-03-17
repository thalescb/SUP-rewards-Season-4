/**
 * charts.js
 *
 * Thin wrappers around Chart.js to create the bar and line charts used in the
 * report.  Chart.js is imported as an ES module from the npm package installed
 * in package.json — no CDN script tag needed.
 *
 * Design choices:
 *  - Responsive: charts fill their container width automatically.
 *  - No legend: labels appear on the axes or are provided by the surrounding
 *    card header so a legend would be redundant.
 *  - Colour scheme follows the CSS design-token palette (dark background).
 */

import Chart from 'chart.js/auto';

// Shared axis tick / grid styles so both chart types look consistent.
const AXIS_TICK = { color: '#8b949e', font: { size: 10 } };
const GRID_OPTS = { display: false };
const GRID_Y    = { color: '#21262d' };

// ---------------------------------------------------------------------------
// Bar chart
// ---------------------------------------------------------------------------

/**
 * Render a vertical bar chart into a `<canvas>` element.
 *
 * Typical use: histogram buckets for reward or points distribution.
 *
 * @param {string}   id     - The `id` attribute of the target `<canvas>`.
 * @param {string[]} labels - Category labels for the x-axis.
 * @param {number[]} data   - Corresponding values.
 * @param {string}   color  - Hex colour string for the bars (e.g. `'#3fb950'`).
 *                            An `cc` alpha suffix is appended for fill opacity.
 */
export function renderBarChart(id, labels, data, color) {
  new Chart(document.getElementById(id), {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: color + 'cc',
        borderRadius:    3,
        barPercentage:   0.7,
      }],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: AXIS_TICK, grid: GRID_OPTS },
        y: { ticks: AXIS_TICK, grid: GRID_Y    },
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Line chart
// ---------------------------------------------------------------------------

/**
 * Render a filled area line chart into a `<canvas>` element.
 *
 * Typical use: activity timelines (events per day).
 *
 * @param {string}   id     - The `id` attribute of the target `<canvas>`.
 * @param {string[]} labels - Date or category labels for the x-axis.
 * @param {number[]} data   - Corresponding values.
 * @param {string}   color  - Hex colour string for the line / fill.
 *                            A `22` alpha suffix is appended for the fill area.
 */
export function renderLineChart(id, labels, data, color) {
  new Chart(document.getElementById(id), {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data,
        borderColor:     color,
        backgroundColor: color + '22',
        fill:            true,
        tension:         0.3,
        pointRadius:     1,
        borderWidth:     2,
      }],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: {
          ticks: { ...AXIS_TICK, maxTicksLimit: 8 },
          grid:  GRID_OPTS,
        },
        y: { ticks: AXIS_TICK, grid: GRID_Y },
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Doughnut chart
// ---------------------------------------------------------------------------

/**
 * Render a doughnut chart into a `<canvas>` element.
 *
 * Typical use: points breakdown by action type.
 *
 * @param {string}   id          - The `id` attribute of the target `<canvas>`.
 * @param {string[]} labels      - Slice labels.
 * @param {number[]} data        - Values for each slice.
 * @param {string[]} colors      - Array of hex colour strings (one per slice).
 * @param {Function} tooltipFn   - Custom tooltip label callback.
 */
export function renderDoughnutChart(id, labels, data, colors, tooltipFn) {
  new Chart(document.getElementById(id), {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: colors.map(c => c + 'cc'),
        borderColor:     colors,
        borderWidth:     1,
        hoverOffset:     6,
      }],
    },
    options: {
      responsive: false,
      cutout: '65%',
      plugins: {
        legend:  { display: false },
        tooltip: { callbacks: { label: tooltipFn } },
      },
    },
  });
}
