/**
 * render.js
 *
 * Build and inject all report HTML from the current application state.
 *
 * This module is the only place that writes to the DOM (other than the
 * pipeline's step-indicator updates in ui.js).  It reads state through the
 * shared `state` object and helper functions from calculations.js / charts.js.
 *
 * Rendering pipeline:
 *   render()
 *     ├─ buildDerivedData()   — compute per-member SUP, Gini, medians, etc.
 *     ├─ renderKpiRow1()      — top KPI cards
 *     ├─ renderBanner()       — match-rate / snapshot notice banner
 *     ├─ renderKpiRow2()      — secondary KPI cards
 *     ├─ renderDistributionCharts() — reward & points histograms
 *     ├─ renderTimelineCharts()     — activity timelines
 *     ├─ renderActionsSection()     — points-generating actions breakdown
 *     ├─ renderTables()       — top-30 leaderboards
 *     └─ renderTechDetails()  — raw technical metadata
 */

import Chart from 'chart.js/auto';

import { state }                            from './state.js';
import { calcSup, giniCoeff, fmt, usd, addressLink } from './calculations.js';
import { renderBarChart, renderLineChart, renderDoughnutChart } from './charts.js';
import { CID, PID, W }                      from './config.js';

// Colour palette shared across action cards, donut slices, and subgraph cards.
const PALETTE = [
  '#3fb950', '#58a6ff', '#bc8cff', '#f778ba',
  '#d29922', '#f85149', '#79c0ff', '#7ee787',
];

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Full report render.  Called once after data is ready (either from snapshot
 * or from the live pipeline).
 */
export function render() {
  // ── 1. Derived data ──────────────────────────────────────────────────────
  const { pr, tr, tS, tF, vs, med, cn, t10, g, tP, wP, matched, reallyResolved, selfMapped } =
    buildDerivedData();

  // ── 2. DOM sections ──────────────────────────────────────────────────────
  renderKpiRow1(pr, tS, tF, tr, wP, matched, reallyResolved, selfMapped);
  renderBanner(matched, pr.length, reallyResolved, selfMapped);
  renderKpiRow2(tS, pr.length, med, tS, t10, g);
  renderDistributionCharts(pr, tr);
  renderTimelineCharts(pr, tr);
  renderActionsSection(tP);
  renderTables(pr, tr, tS, matched);
  renderTechDetails(matched, pr.length, tS);

  // ── 3. Expose data window-globals for CSV export and tab switching ────────
  window._pr = pr;
  window._tr = tr;
  window._tS = tS;
  window._tF = tF;
  window._st = {
    tS, tF,
    m:    pr.length,
    cn,
    pa:   tr.length,
    tP,
    avg:  tS / pr.length,
    med,
    t10p: t10 / tS * 100,
    g,
    u:    Number(state.pool.totalUnits),
    price: state.price,
    matched,
    lkCount: Object.keys(state.lockers).length,
    resolveStats: state.resolveStats,
  };
}

// ---------------------------------------------------------------------------
// Derived data
// ---------------------------------------------------------------------------

/**
 * Compute all derived values needed by the render sub-functions.
 *
 * Data transformation steps:
 *  1. Build a points lookup map keyed by lowercase wallet address.
 *  2. Build bidirectional locker↔owner maps.
 *  3. For each pool member compute:
 *       - SUP received (via calcSup)
 *       - Linked wallet (forward: locker→owner; reverse: owner→locker)
 *       - Matched points data
 *  4. Sort by SUP descending to produce the pool rank table (`pr`).
 *  5. Sort points accounts by points descending (`tr`).
 *  6. Compute statistics: total, median, Gini, top-10 concentration.
 */
function buildDerivedData() {
  // ── Points lookup: wallet → { p: points, e: events, l: lastActive } ──────
  const ptsMap = {};
  state.pts.forEach(p => {
    ptsMap[p.account.toLowerCase()] = {
      p: p.totalPoints,
      e: p.eventCount,
      l: p.lastEventAt,
    };
  });

  // ── Bidirectional locker maps ─────────────────────────────────────────────
  // ownerToLockers: wallet → [lockerAddr, …]  (only genuine locker→owner pairs)
  const ownerToLockers = {};
  Object.entries(state.lockers).forEach(([lk, ow]) => {
    if (ow !== lk) {
      if (!ownerToLockers[ow]) ownerToLockers[ow] = [];
      ownerToLockers[ow].push(lk);
    }
  });

  // Pool member address set (for reverse lookup).
  const poolMemberSet = new Set(state.mem.map(m => m.account.id.toLowerCase()));

  // ── Reverse link: points-wallet → pool-member locker ─────────────────────
  // Strategy B: for each points account, find their locker and check if it is
  // in the pool.  Supplements the forward strategy in cases where the locker
  // map doesn't include the pool member's locker.
  const ptsToPoolMember = {};
  Object.keys(ptsMap).forEach(wallet => {
    const userLockers = ownerToLockers[wallet] || [];
    const inPool      = userLockers.find(l => poolMemberSet.has(l));
    if (inPool) ptsToPoolMember[wallet] = inPool;
  });

  // ── Forward + reverse join: pool member → points data ────────────────────
  const poolMemberToPts = {};

  // Forward (strategy A): locker → lockers[locker] → wallet → ptsMap[wallet]
  state.mem.forEach(m => {
    const locker = m.account.id.toLowerCase();
    const wallet = state.lockers[locker] || null;
    if (wallet && ptsMap[wallet]) {
      poolMemberToPts[locker] = { wallet, pts: ptsMap[wallet] };
    }
  });

  // Reverse (strategy B): fill gaps not covered by the forward pass.
  Object.entries(ptsToPoolMember).forEach(([wallet, locker]) => {
    if (!poolMemberToPts[locker]) {
      poolMemberToPts[locker] = { wallet, pts: ptsMap[wallet] };
    }
  });

  // ── Build ranked pool member array ───────────────────────────────────────
  const pr = state.mem
    .map(m => {
      const locker       = m.account.id.toLowerCase();
      const fwd          = state.lockers[locker] || null;
      const join         = poolMemberToPts[locker] || null;
      const wallet       = join ? join.wallet : fwd;
      const pt           = join ? join.pts    : null;
      // A member is "resolved" only if the locker was mapped to a *different*
      // address (i.e. genuinely resolved, not self-mapped).
      const resolvedReal = fwd && fwd !== locker;

      return {
        locker,
        wallet,
        u:        Number(m.units),
        s:        calcSup(m),      // total SUP received
        c:        m.isConnected,
        ts:       Number(m.updatedAtTimestamp),
        pts:      pt ? pt.p : 0,
        ev:       pt ? pt.e : 0,
        la:       pt ? pt.l : null,
        matched:  !!pt,
        resolved: resolvedReal,
      };
    })
    .sort((a, b) => b.s - a.s);   // rank by SUP descending

  // ── Ranked points table ───────────────────────────────────────────────────
  const tr = state.pts
    .map(p => ({ a: p.account.toLowerCase(), p: p.totalPoints, e: p.eventCount, l: p.lastEventAt }))
    .sort((a, b) => b.p - a.p);

  // ── Aggregate stats ───────────────────────────────────────────────────────
  const tS = pr.reduce((s, r) => s + r.s, 0);
  const tF = Number(state.pool.totalAmountDistributedUntilUpdatedAt) / W;
  const vs = pr.map(r => r.s);

  // Median: middle value of sorted array (average of two middles for even n).
  const sorted = [...vs].sort((a, b) => a - b);
  const mid    = sorted.length;
  const med    = mid % 2 === 0
    ? (sorted[mid / 2 - 1] + sorted[mid / 2]) / 2
    : sorted[Math.floor(mid / 2)];

  const cn      = pr.filter(r => r.c).length;
  const t10     = pr.slice(0, 10).reduce((s, r) => s + r.s, 0);
  const g       = giniCoeff(vs);
  const tP      = tr.reduce((s, r) => s + r.p, 0);
  const wP      = tr.filter(r => r.p > 0).length;
  const matched = pr.filter(r => r.matched).length;
  const reallyResolved = pr.filter(r => r.resolved).length;
  const selfMapped     = pr.filter(r => !r.resolved).length;

  return { pr, tr, tS, tF, vs, sorted, med, cn, t10, g, tP, wP, matched, reallyResolved, selfMapped };
}

// ---------------------------------------------------------------------------
// KPI Row 1
// ---------------------------------------------------------------------------

function renderKpiRow1(pr, tS, tF, tr, wP, matched, reallyResolved, selfMapped) {
  document.getElementById('k1').innerHTML = `
    <div class="k g">
      <div class="kl">Total Pool Funding</div>
      <div class="kv">${fmt(tF)} SUP</div>
      <div class="ku">${usd(tF)}</div>
      <div class="ks">Season 4 allocation</div>
    </div>
    <div class="k g">
      <div class="kl">Distributed to Members</div>
      <div class="kv">${fmt(tS)} SUP</div>
      <div class="ku">${usd(tS)}</div>
      <div class="ks">${fmt(pr.length)} recipients</div>
    </div>
    <div class="k b">
      <div class="kl">Pool Members</div>
      <div class="kv">${fmt(pr.length)}</div>
      <div class="ks">${fmt(reallyResolved)} locker→wallet resolved · ${fmt(selfMapped)} direct/unresolved</div>
    </div>
    <div class="k o">
      <div class="kl">Points Participants</div>
      <div class="kv">${fmt(tr.length)}</div>
      <div class="ks">${wP} earned points · ${tr.length - wP} inactive</div>
    </div>
    <div class="k p">
      <div class="kl">Matched (Pool↔Points)</div>
      <div class="kv">${fmt(matched)}</div>
      <div class="ks">${fmt(matched)} of ${fmt(pr.length)} pool members linked to points accounts (${fmt(matched / pr.length * 100, 1)}%)</div>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Banner
// ---------------------------------------------------------------------------

function renderBanner(matched, total, reallyResolved, selfMapped) {
  const el = document.getElementById('banner');

  if (matched > total * 0.5) {
    el.innerHTML = `<strong>✅ Good match rate:</strong> ${fmt(matched)} of ${total} pool members linked to points accounts. ${fmt(reallyResolved)} lockers resolved via on-chain owner() calls + subgraph data.`;
    el.style.borderLeftColor = 'var(--green)';
  } else if (matched > 0) {
    el.innerHTML = `<strong>⚠️ Partial matching:</strong> ${fmt(matched)} of ${total} pool members matched (${fmt(matched / total * 100, 1)}%). ${fmt(reallyResolved)} lockers were resolved to owner wallets via RPC + subgraph. The remaining ${fmt(selfMapped)} addresses could not be resolved — they are likely smart contract lockers whose owner function uses a non-standard ABI, or direct wallet addresses not present in the points leaderboard. Pool distribution and points data are shown independently below.`;
    el.style.borderLeftColor = 'var(--orange)';
  } else {
    el.innerHTML = `<strong>ℹ️ No matches:</strong> Could not link pool members to points accounts. This may indicate the locker contracts use a non-standard owner interface, or the GoodDollar subgraph indexes a different chain than Base. Data is shown independently.`;
    el.style.borderLeftColor = 'var(--accent)';
  }

  // Append snapshot age notice if data came from cache.
  if (state.snapshotTime) {
    const st     = new Date(state.snapshotTime);
    const age    = Math.round((Date.now() - st.getTime()) / 3_600_000);
    const ageStr = age < 1 ? 'less than an hour' : age < 24 ? `${age}h` : `${Math.round(age / 24)}d`;

    el.innerHTML += `<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border);font-size:11px;color:var(--textMuted)">` +
      `📸 <strong style="color:var(--text)">Cached snapshot</strong> from ${st.toISOString().slice(0, 16).replace('T', ' ')} UTC (${ageStr} ago). ` +
      `Click <strong style="color:var(--orange)">↻ Refresh Live</strong> above for latest on-chain data. ` +
      `Use <strong>⬇ Snapshot</strong> after refresh to update the cache.</div>`;
  }
}

// ---------------------------------------------------------------------------
// KPI Row 2
// ---------------------------------------------------------------------------

function renderKpiRow2(tS, memberCount, med, _, t10, g) {
  document.getElementById('k2').innerHTML = `
    <div class="k g">
      <div class="kl">Average Reward</div>
      <div class="kv">${fmt(tS / memberCount, 2)} SUP</div>
      <div class="ku">${usd(tS / memberCount)}</div>
    </div>
    <div class="k b">
      <div class="kl">Median Reward</div>
      <div class="kv">${fmt(med, 2)} SUP</div>
      <div class="ku">${usd(med)}</div>
    </div>
    <div class="k pk">
      <div class="kl">Top 10 Concentration</div>
      <div class="kv">${fmt(t10 / tS * 100, 1)}%</div>
      <div class="ks">${fmt(t10)} SUP</div>
      <div class="ku">${usd(t10)}</div>
    </div>
    <div class="k ${g > 0.6 ? 'r' : 'o'}">
      <div class="kl">Gini Coefficient</div>
      <div class="kv">${Math.round(g * 1000) / 1000}</div>
      <div class="ks">${g > 0.6 ? 'Concentrated' : g > 0.4 ? 'Moderate' : 'Well distributed'}</div>
    </div>
    <div class="k p">
      <div class="kl">SUP Price</div>
      <div class="kv">${state.price ? '$' + state.price.toFixed(4) : 'N/A'}</div>
      <div class="ks">${state.price ? 'Live' : 'Not available'}</div>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Distribution charts (histograms)
// ---------------------------------------------------------------------------

/**
 * Render the two histogram charts:
 *  - Reward distribution: pool members bucketed by SUP received.
 *  - Points distribution: wallets bucketed by points earned.
 *
 * Bucketing transformation:
 *  Each bucket defines a [a, b) half-open interval.  Members/wallets falling
 *  in the interval are counted.  Empty buckets are omitted from the chart.
 */
function renderDistributionCharts(pr, tr) {
  document.getElementById('c1').innerHTML =
    '<div class="cb"><div class="ct">Reward Distribution</div><div class="cs">Pool members by SUP received</div><canvas id="h1"></canvas></div>' +
    '<div class="cb"><div class="ct">Points Distribution</div><div class="cs">Wallets by points earned</div><canvas id="h2"></canvas></div>';

  // SUP buckets (human-readable ranges)
  const supBuckets = [
    { l: '0-1',    a: 0,    b: 1    },
    { l: '1-10',   a: 1,    b: 10   },
    { l: '10-50',  a: 10,   b: 50   },
    { l: '50-100', a: 50,   b: 100  },
    { l: '100-500',a: 100,  b: 500  },
    { l: '500-1k', a: 500,  b: 1e3  },
    { l: '1k-5k',  a: 1e3,  b: 5e3  },
    { l: '5k+',    a: 5e3,  b: Infinity },
  ];

  const supData = supBuckets
    .map(b => ({ l: b.l, c: pr.filter(r => r.s >= b.a && r.s < b.b).length }))
    .filter(x => x.c > 0);

  renderBarChart('h1', supData.map(d => d.l), supData.map(d => d.c), '#3fb950');

  // Points buckets
  const ptsBuckets = [
    { l: '0',       a: 0,     b: 1     },
    { l: '1-10',    a: 1,     b: 11    },
    { l: '11-100',  a: 11,    b: 101   },
    { l: '100-1k',  a: 101,   b: 1001  },
    { l: '1k-5k',   a: 1001,  b: 5001  },
    { l: '5k-10k',  a: 5001,  b: 10001 },
    { l: '10k+',    a: 10001, b: Infinity },
  ];

  const ptsData = ptsBuckets
    .map(b => ({ l: b.l, c: tr.filter(r => r.p >= b.a && r.p < b.b).length }))
    .filter(x => x.c > 0);

  renderBarChart('h2', ptsData.map(d => d.l), ptsData.map(d => d.c), '#58a6ff');
}

// ---------------------------------------------------------------------------
// Timeline charts
// ---------------------------------------------------------------------------

/**
 * Render two daily-activity line charts:
 *  - Member activity: pool unit-update events per day.
 *    Falls back to member `updatedAtTimestamp` if the detailed timeline is empty.
 *  - Points activity: last-active date distribution across points wallets.
 *
 * Data transformation:
 *  Unix timestamps are converted to YYYY-MM-DD strings, counted per day,
 *  then sorted chronologically before being passed to the chart helper.
 */
function renderTimelineCharts(pr, tr) {
  document.getElementById('c2').innerHTML =
    '<div class="cb"><div class="ct">Member Activity Timeline</div><div class="cs">Pool unit updates per day</div><canvas id="t1"></canvas></div>' +
    '<div class="cb"><div class="ct">Points Activity Timeline</div><div class="cs">Last activity per wallet by date</div><canvas id="t2"></canvas></div>';

  // Member timeline: prefer detailed event log; fall back to member timestamps.
  const memberDayMap = {};
  if (state.tl.length) {
    state.tl.forEach(e => {
      const d = new Date(Number(e.timestamp) * 1000).toISOString().slice(0, 10);
      memberDayMap[d] = (memberDayMap[d] || 0) + 1;
    });
  } else {
    pr.forEach(r => {
      const d = new Date(r.ts * 1000).toISOString().slice(0, 10);
      memberDayMap[d] = (memberDayMap[d] || 0) + 1;
    });
  }
  const memberDays = Object.keys(memberDayMap).sort();
  renderLineChart('t1', memberDays, memberDays.map(d => memberDayMap[d]), '#3fb950');

  // Points timeline: last-active date per wallet.
  const ptsDayMap = {};
  tr.forEach(r => {
    if (r.l) {
      const d = r.l.slice(0, 10);
      ptsDayMap[d] = (ptsDayMap[d] || 0) + 1;
    }
  });
  const ptsDays = Object.keys(ptsDayMap).sort();
  renderLineChart('t2', ptsDays, ptsDays.map(d => ptsDayMap[d]), '#58a6ff');
}

// ---------------------------------------------------------------------------
// Actions section
// ---------------------------------------------------------------------------

/**
 * Render the "Points-Generating Actions" and (if available) "On-Chain Activity"
 * sections.
 *
 * Data sources:
 *  - `state.actions`: aggregated from Superfluid Points API events.
 *  - `state.sgActivity`: entity counts from the GoodDollar subgraph.
 *
 * @param {number} tP - Total points across all accounts (for percentage calcs).
 */
function renderActionsSection(tP) {
  const actionKeys   = Object.keys(state.actions)
    .sort((a, b) => (state.actions[b].points || 0) - (state.actions[a].points || 0));
  const actTotalPts  = actionKeys.reduce((s, k) => s + (state.actions[k].points || 0), 0);
  const actTotalEv   = actionKeys.reduce((s, k) => s + (state.actions[k].totalEvents || 0), 0);

  let html = '<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:18px;margin-bottom:12px">';

  html += '<div class="ct">Points-Generating Actions</div>';
  html += `<div class="cs" style="margin-bottom:4px">These are the action types discovered in the <strong style="color:var(--text)">Superfluid Points API</strong> for Campaign #${CID}. Each action generates points that determine a wallet's share of the SUP reward pool.</div>`;

  // Methodology note
  html += `<div style="background:var(--surface2);border-radius:6px;padding:10px 12px;margin-bottom:16px;font-size:11px;color:var(--textDim);line-height:1.5">`;
  html += `<strong style="color:var(--text)">Data source:</strong> All event counts and point values are exact totals computed from the full Superfluid Points API event history for Campaign #${CID}. `;
  html += `Total points across all actions: <strong style="color:var(--orange)">${fmt(actTotalPts)} pts</strong> from <strong style="color:var(--text)">${fmt(actTotalEv)}</strong> events. `;
  html += `Leaderboard total (sum of all account points): <strong style="color:var(--orange)">${fmt(tP)} pts</strong>.`;
  html += '</div>';

  // Donut chart + legend row
  if (actionKeys.length > 0) {
    html += '<div style="display:flex;gap:24px;flex-wrap:wrap;align-items:center;margin:12px 0">';
    html += '<div style="flex:0 0 200px;position:relative"><canvas id="donutActions" width="200" height="200"></canvas>';
    html += `<div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);text-align:center"><div style="font-size:20px;font-weight:700;color:var(--white)">${fmt(tP)}</div><div style="font-size:10px;color:var(--textMuted)">total points</div></div></div>`;
    html += '<div style="flex:1;min-width:220px">';

    actionKeys.forEach((ev, i) => {
      const a       = state.actions[ev];
      const color   = PALETTE[i % PALETTE.length];
      const ptsPct  = actTotalPts > 0 ? (a.points / actTotalPts * 100) : 0;
      html += `<div style="display:flex;align-items:center;gap:8px;padding:5px 0">` +
        `<div style="width:10px;height:10px;border-radius:2px;background:${color};flex-shrink:0"></div>` +
        `<div style="font-size:12px;color:var(--text);flex:1">${a.label}</div>` +
        `<div style="font-size:11px;color:var(--textDim);font-family:'JetBrains Mono',monospace;white-space:nowrap">${fmt(a.points)} pts (${fmt(ptsPct, 1)}%)</div>` +
        `</div>`;
    });

    html += '</div></div>';
  }

  // Detail cards (one per action type)
  html += '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:12px">';
  actionKeys.forEach((ev, i) => {
    const a      = state.actions[ev];
    const color  = PALETTE[i % PALETTE.length];
    const ptsPct = actTotalPts > 0 ? fmt(a.points / actTotalPts * 100, 1) + '%' : '—';
    html += `<div style="flex:1;min-width:200px;background:var(--surface2);border-radius:8px;padding:14px;border-left:3px solid ${color}">` +
      `<div style="font-size:10px;color:var(--textMuted);text-transform:uppercase;letter-spacing:1px;font-family:'JetBrains Mono',monospace;margin-bottom:6px">${a.label}</div>` +
      `<div style="font-size:22px;font-weight:700;color:var(--orange)">${fmt(a.points)} <span style="font-size:11px;font-weight:400;color:var(--textDim)">pts</span></div>` +
      `<div style="font-size:12px;color:var(--textDim);margin-top:4px">${fmt(a.totalEvents)} events · ${ptsPct} of total · ~${a.avgPts} pts/event</div>` +
      `<div style="font-size:10px;color:var(--textMuted);margin-top:4px">${a.desc}</div>` +
      `</div>`;
  });
  html += '</div>';

  if (actionKeys.length === 0) {
    html += `<div style="text-align:center;padding:24px;color:var(--textMuted)">No point events found in the Points API for campaign #${CID}. The events endpoint may be empty or blocked by CORS.</div>`;
  }

  html += '</div>';

  // On-chain activity section (supplementary GD subgraph data)
  const sgKeys = Object.keys(state.sgActivity);
  if (sgKeys.length > 0) {
    html += '<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:18px;margin-top:12px;margin-bottom:12px">';
    html += '<div class="ct">On-Chain Activity (GoodDollar Subgraph)</div>';
    html += '<div class="cs" style="margin-bottom:4px">Supplementary data from the GoodDollar subgraph showing all tracked on-chain entity types. These represent blockchain activity — not all of them generate campaign points directly.</div>';
    html += '<div style="display:flex;gap:10px;flex-wrap:wrap">';

    sgKeys.forEach((k, i) => {
      const e     = state.sgActivity[k];
      const color = PALETTE[(i + actionKeys.length) % PALETTE.length];
      html += `<div style="flex:1;min-width:160px;background:var(--surface2);border-radius:6px;padding:12px;border-left:3px solid ${color}">` +
        `<div style="font-size:10px;color:var(--textMuted);text-transform:uppercase;letter-spacing:1px;font-family:'JetBrains Mono',monospace;margin-bottom:3px">${e.label}</div>` +
        `<div style="font-size:16px;font-weight:600;color:var(--white)">${fmt(e.count)}</div>` +
        `<div style="font-size:10px;color:var(--textMuted);margin-top:2px">${e.desc}</div>` +
        `</div>`;
    });

    html += '</div></div>';
  }

  document.getElementById('actions-section').innerHTML = html;

  // Render donut chart now that the canvas is in the DOM.
  if (actionKeys.length > 0 && document.getElementById('donutActions')) {
    renderDoughnutChart(
      'donutActions',
      actionKeys.map(k => state.actions[k].label),
      actionKeys.map(k => state.actions[k].points || 0),
      actionKeys.map((_, i) => PALETTE[i % PALETTE.length]),
      ctx => {
        const k = actionKeys[ctx.dataIndex];
        const a = state.actions[k];
        return ` ${a.label}: ${fmt(a.points)} pts (${fmt(a.totalEvents)} events)`;
      },
    );
  }
}

// ---------------------------------------------------------------------------
// Leaderboard tables
// ---------------------------------------------------------------------------

/**
 * Render the "Top SUP Recipients" and "Top Points Earners" tables (top 30 each).
 *
 * Wallet cells display:
 *  - A Basescan link + clipboard button for resolved wallets.
 *  - A truncated address with a ⚠ warning for self-mapped (unresolved) entries.
 */
function renderTables(pr, tr, tS, matched) {
  const maxSUP = pr.length ? pr[0].s : 1;

  let poolHtml = '<div style="overflow-x:auto"><table><thead><tr><th>#</th><th>Wallet</th><th>Locker</th><th>SUP Received</th><th>Points</th><th>Units</th><th>Share</th></tr></thead><tbody>';

  pr.slice(0, 30).forEach((r, i) => {
    const pct  = Math.round(r.s / maxSUP * 100);
    const sPct = r.s / tS * 100;

    // Wallet cell: resolved → link; self-mapped → truncated + warning icon.
    const walletCell = r.resolved
      ? addressLink(r.wallet)
      : (r.wallet === r.locker
        ? `<span style="color:var(--textMuted);font-size:10px" title="Self-mapped: could not resolve owner">${r.locker.slice(0, 8)}…${r.locker.slice(-4)} ⚠</span>`
        : addressLink(r.wallet));

    poolHtml += `<tr>` +
      `<td class="mono" style="color:var(--textMuted)">${i + 1}</td>` +
      `<td class="mono" style="font-size:11px">${walletCell}</td>` +
      `<td class="mono" style="font-size:11px">${addressLink(r.locker)}</td>` +
      `<td style="font-weight:600;color:var(--white)">${fmt(r.s, 2)}` +
        `<span style="display:block;font-size:10px;color:var(--textMuted);font-style:italic">${usd(r.s)}</span>` +
        `<div style="margin-top:3px;height:3px;background:var(--border);border-radius:2px;width:100px">` +
          `<div style="height:3px;background:var(--green);border-radius:2px;width:${pct}px"></div></div></td>` +
      `<td style="color:${r.pts > 0 ? 'var(--orange)' : 'var(--textMuted)'}">${r.pts > 0 ? fmt(r.pts) : '—'}</td>` +
      `<td style="color:var(--textDim)">${r.u}</td>` +
      `<td style="color:var(--textDim)">${fmt(sPct, 2)}%` +
        `<div style="margin-top:3px;height:3px;background:var(--border);border-radius:2px;width:60px">` +
          `<div style="height:3px;background:var(--accent);border-radius:2px;width:${Math.round(sPct / 5 * 60)}px"></div></div></td>` +
      `</tr>`;
  });

  poolHtml += '</tbody></table></div>';
  document.getElementById('tp').innerHTML = poolHtml;
  document.getElementById('tc').textContent = `Top 30 of ${pr.length} · ${matched} linked to points data`;

  // Points table
  const maxPts = tr.length ? tr[0].p : 1;
  let ptsHtml  = '<div style="overflow-x:auto"><table><thead><tr><th>#</th><th>Wallet</th><th>Points</th><th>Events</th><th>Last Active</th></tr></thead><tbody>';

  tr.slice(0, 30).forEach((r, i) => {
    const pPct = Math.round(r.p / maxPts * 100);
    ptsHtml += `<tr>` +
      `<td class="mono" style="color:var(--textMuted)">${i + 1}</td>` +
      `<td class="mono" style="font-size:11px">${addressLink(r.a)}</td>` +
      `<td style="font-weight:600;color:var(--orange)">${fmt(r.p)}` +
        `<div style="margin-top:3px;height:3px;background:var(--border);border-radius:2px;width:100px">` +
          `<div style="height:3px;background:var(--orange);border-radius:2px;width:${pPct}px"></div></div></td>` +
      `<td style="color:var(--textDim)">${fmt(r.e)}</td>` +
      `<td class="mono" style="color:var(--textDim);font-size:11px">${r.l ? r.l.slice(0, 10) : '—'}</td>` +
      `</tr>`;
  });

  ptsHtml += '</tbody></table></div>';
  document.getElementById('tt').innerHTML = ptsHtml;
}

// ---------------------------------------------------------------------------
// Technical details
// ---------------------------------------------------------------------------

function renderTechDetails(matched, memberCount, tS) {
  // Sanity check: warn if total SUP deviates from the expected seasonal amount.
  const expectedSUP = 837_370;
  const supDelta    = Math.abs(tS - expectedSUP) / expectedSUP * 100;
  const sanity      = [];
  if (supDelta > 10) {
    sanity.push(`⚠ Total SUP (${fmt(tS)}) deviates ${fmt(supDelta, 1)}% from expected ~${fmt(expectedSUP)}`);
  }

  document.getElementById('tech').innerHTML =
    `<div style="font-size:13px;font-weight:600;color:var(--white);margin-bottom:8px;font-family:'DM Sans'">Technical Details</div>` +
    `<div><strong>Data Sources (3 separate systems):</strong></div>` +
    `<div>  1. Superfluid Protocol Subgraph (Base Mainnet) → pool members, units, SUP distribution</div>` +
    `<div>  2. Superfluid Points API (cms.superfluid.pro) → campaign points, events, leaderboard</div>` +
    `<div>  3. GoodDollar Subgraph (thegraph.com) → locker mappings, on-chain activity context</div>` +
    `<div style="margin-top:6px">Token: SUP · ${state.pool.token.id}</div>` +
    `<div>Pool: ${PID}</div>` +
    `<div>Admin: ${state.pool.admin.id}</div>` +
    `<div>Network: Base Mainnet · Chain ID: 8453</div>` +
    `<div>Campaign: #${CID}</div>` +
    `<div>Flow Rate: ${state.pool.flowRate} (complete)</div>` +
    `<div>Units: ${fmt(Number(state.pool.totalUnits))}</div>` +
    `<div>Updated: ${new Date(Number(state.pool.updatedAtTimestamp) * 1000).toISOString()}</div>` +
    `<div style="margin-top:6px"><strong>Wallet Resolution:</strong></div>` +
    `<div>  GD subgraph lockers: ${fmt(state.resolveStats.gdSubgraph || 0)} matches</div>` +
    `<div>  lockers.json file: ${fmt(state.resolveStats.lockerJson || 0)} additional</div>` +
    `<div>  RPC owner() calls: ${fmt(state.resolveStats.rpc || 0)} resolved</div>` +
    `<div>  Self-mapped (likely EOAs): ${fmt(state.resolveStats.selfMapped || 0)}</div>` +
    `<div>  → ${fmt(matched)} matched to points accounts (${fmt(matched / memberCount * 100, 1)}%)</div>` +
    (sanity.length ? `<div style="color:var(--orange);margin-top:6px">${sanity.join('<br>')}</div>` : '');

  // Footer timestamp
  if (state.snapshotTime) {
    const st  = new Date(state.snapshotTime);
    const age = Math.round((Date.now() - st.getTime()) / 3_600_000);
    document.getElementById('ft').textContent =
      `Data snapshot: ${st.toISOString().slice(0, 16).replace('T', ' ')} UTC (${age}h ago) · Click "↻ Refresh Live" for latest data`;
  } else {
    document.getElementById('ft').textContent =
      `Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC · Live data from Superfluid Subgraph + Points API + GoodDollar Subgraph`;
  }
}
