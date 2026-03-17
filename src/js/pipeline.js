/**
 * pipeline.js
 *
 * The main data-fetching pipeline.  Runs 7 sequential steps, each of which
 * fetches data from an external source and stores the results in `state`.
 * Progress is reported through the loading-overlay step indicators.
 *
 * Steps:
 *  1. Pool metadata       — Superfluid subgraph
 *  2. Pool members        — Superfluid subgraph (paginated)
 *  3. Points leaderboard  — Superfluid Points API (with CORS fallback)
 *  4. SUP token price     — DexScreener / CoinGecko (with proxy fallback)
 *  5. Activity timeline   — Superfluid subgraph (paginated)
 *  6. Action breakdown    — Points API events + GD subgraph entity counts
 *  7. Wallet↔Locker map   — GD subgraph + lockers.json + RPC batch calls
 *
 * On success the loading overlay fades out and `render()` is called.
 * On unrecoverable error the overlay shows an error box with a Retry button.
 */

import { state }          from './state.js';
import { gql, gdGql, fetchPtsApi, batchEthCall } from './api.js';
import { PID, CID, PA, BASE_RPCS, OWNER_SELS }  from './config.js';
import { setStepStatus }  from './ui.js';
import { render }         from './render.js';

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Run the full live data pipeline.
 *
 * All steps share the `state` object.  If any step throws and is not caught
 * internally, the outer try/catch shows the error overlay.
 */
export async function runPipeline() {
  try {
    await stepPoolMetadata();
    await stepPoolMembers();
    await stepPointsLeaderboard();
    await stepSUPPrice();
    await stepActivityTimeline();
    await stepActionBreakdown();
    await stepWalletLockerMap();

    // Transition from loading overlay to report
    document.getElementById('ov').classList.add('fade-out');
    setTimeout(() => {
      document.getElementById('ov').style.display = 'none';
      document.getElementById('rpt').style.display = 'block';
      render();
    }, 600);

  } catch (e) {
    // Show error box in overlay
    document.getElementById('ovt').textContent    = '';
    document.getElementById('ovs').textContent    = '';
    document.getElementById('ring').style.display = 'none';
    document.getElementById('steps').style.display = 'none';
    document.getElementById('ebox').style.display  = 'block';
    document.getElementById('emsg').textContent    = e.message;
  }
}

// ---------------------------------------------------------------------------
// Step 1: Pool metadata
// ---------------------------------------------------------------------------

/**
 * Fetch top-level pool data: total distributed, total units, token info, admin.
 *
 * A single GraphQL query returns the pool entity by its address.
 * Throws if the pool is not found (indicates wrong PID or wrong subgraph).
 */
async function stepPoolMetadata() {
  setStepStatus('s1', 'active');

  const data = await gql(`{
    pool(id:"${PID}") {
      totalAmountDistributedUntilUpdatedAt
      totalUnits
      totalMembers
      flowRate
      token { id symbol name }
      admin  { id }
      updatedAtTimestamp
    }
  }`);

  state.pool = data.pool;
  if (!state.pool) throw new Error('Pool not found — check PID in config.js');

  setStepStatus('s1', 'done');
}

// ---------------------------------------------------------------------------
// Step 2: Pool members (paginated)
// ---------------------------------------------------------------------------

/**
 * Fetch all pool members using cursor-based pagination (1 000 per page).
 *
 * The subgraph caps result sets at 1 000 records.  We use `id_gt` cursor
 * pagination, tracking the last seen id to fetch successive pages until
 * fewer than 1 000 records are returned (indicating the last page).
 *
 * The step indicator is updated on every page to show the running count.
 */
async function stepPoolMembers() {
  setStepStatus('s2', 'active');

  let cursor = '';

  while (true) {
    const data = await gql(`{
      poolMembers(
        first: 1000,
        where: { pool: "${PID}", id_gt: "${cursor}" },
        orderBy: id
      ) {
        id
        account { id }
        units
        totalAmountReceivedUntilUpdatedAt
        poolTotalAmountDistributedUntilUpdatedAt
        updatedAtTimestamp
        isConnected
      }
    }`);

    state.mem = state.mem.concat(data.poolMembers);

    // Update step indicator with running count
    document.getElementById('s2').querySelector('.ico').textContent = state.mem.length;

    if (data.poolMembers.length < 1000) break;
    cursor = data.poolMembers[data.poolMembers.length - 1].id;
  }

  setStepStatus('s2', 'done');
}

// ---------------------------------------------------------------------------
// Step 3: Points leaderboard
// ---------------------------------------------------------------------------

/**
 * Fetch all points accounts for the campaign from the Superfluid Points API.
 *
 * The API paginates at 100 accounts per page.  We iterate until
 * `pagination.hasNextPage` is false.
 *
 * CORS note: The Points API does not allow browser requests from most origins.
 * We try three transports in order:
 *   1. Direct fetch (works on localhost / same-origin deployments)
 *   2. corsproxy.io
 *   3. api.allorigins.win
 *
 * If all transports fail we show an upload fallback so the user can supply
 * a locally downloaded points_data.json file.
 */
async function stepPointsLeaderboard() {
  setStepStatus('s3', 'active');

  let ptsOk = false;

  // Inner helper: fetch all pages of points accounts through a given proxy.
  async function fetchAllPts(proxy) {
    state.pts = [];
    let page  = 1;

    while (true) {
      const url = `${PA}?campaignId=${CID}&limit=100&page=${page}&orderBy=totalPoints&order=desc`;
      const r   = await fetch(proxy ? proxy + encodeURIComponent(url) : url);

      if (!r.ok) throw new Error('HTTP ' + r.status);

      const j = await r.json();
      if (!j.accounts) throw new Error('No accounts field');

      state.pts = state.pts.concat(j.accounts);

      // Running count in the step indicator
      document.getElementById('s3').querySelector('.ico').textContent = state.pts.length;

      if (!j.pagination || !j.pagination.hasNextPage) break;
      page++;
    }
  }

  for (const proxy of [null, 'https://corsproxy.io/?url=', 'https://api.allorigins.win/raw?url=']) {
    try {
      await fetchAllPts(proxy);
      if (state.pts.length > 0) { ptsOk = true; break; }
    } catch (_) { /* try next proxy */ }
  }

  if (!ptsOk) {
    // Show CORS error with a file-upload fallback
    setStepStatus('s3', 'fail');

    document.getElementById('s3').innerHTML =
      `<span class="ico" style="color:var(--orange)">!</span> Points API blocked (CORS). Upload points_data.json:`;

    const ud = document.createElement('div');
    ud.style.cssText = 'margin:10px 0 0 30px';
    ud.innerHTML =
      `<div style="font-size:11px;color:var(--textDim);margin-bottom:6px">Run in PowerShell first:</div>` +
      `<pre style="background:var(--surface);padding:8px;border-radius:4px;font-size:9px;color:var(--orange);overflow:auto;margin-bottom:8px;max-height:60px;white-space:pre-wrap;word-break:break-all;user-select:all;cursor:text">` +
      `$all=@();$p=1;do{$r=Invoke-RestMethod "https://cms.superfluid.pro/points/accounts?campaignId=7860&limit=100&page=$p";$all+=$r.accounts;$p++}while($r.pagination.hasNextPage);$all|ConvertTo-Json -Depth 5|Out-File "$env:USERPROFILE\\Desktop\\points_data.json" -Encoding UTF8` +
      `</pre>` +
      `<label style="display:inline-flex;align-items:center;gap:6px;background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:8px 16px;cursor:pointer;font-size:12px;color:var(--textDim)">` +
      `📁 Upload points_data.json<input type="file" accept=".json" id="pts-upload" style="display:none"></label>` +
      `<span id="pts-status" style="margin-left:8px;font-size:12px"></span>`;

    document.getElementById('steps').appendChild(ud);

    // Wait for the user to upload a file
    await new Promise(resolve => {
      document.getElementById('pts-upload').addEventListener('change', function () {
        const f = this.files[0];
        if (!f) return;

        const reader = new FileReader();
        reader.onload = e => {
          try {
            const j = JSON.parse(e.target.result);
            state.pts = Array.isArray(j) ? j : (j.accounts || []);
            document.getElementById('pts-status').textContent = '✓ ' + state.pts.length + ' loaded';
            document.getElementById('pts-status').style.color = 'var(--green)';
            setStepStatus('s3', 'done');
            resolve();
          } catch (err) {
            document.getElementById('pts-status').textContent = 'Error: ' + err.message;
            document.getElementById('pts-status').style.color = 'var(--red)';
          }
        };
        reader.readAsText(f);
      });
    });
  } else {
    setStepStatus('s3', 'done');
  }
}

// ---------------------------------------------------------------------------
// Step 4: SUP token price
// ---------------------------------------------------------------------------

/**
 * Fetch the live SUP token price in USD from DexScreener (primary) or
 * CoinGecko (fallback).  A CORS-proxy variant of the DexScreener call is
 * tried last if both direct calls fail.
 *
 * `state.price` is left null if all attempts fail — the render layer handles
 * this gracefully by omitting USD equivalents.
 */
async function stepSUPPrice() {
  setStepStatus('s4', 'active');

  // Primary: DexScreener
  try {
    const r = await fetch('https://api.dexscreener.com/latest/dex/tokens/0xa69f80524381275a7ffdb3ae01c54150644c8792');
    const j = await r.json();
    if (j.pairs && j.pairs.length) state.price = parseFloat(j.pairs[0].priceUsd);
  } catch (_) {}

  // Fallback 1: CoinGecko
  if (!state.price) {
    try {
      const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=superfluid&vs_currencies=usd');
      const j = await r.json();
      if (j.superfluid?.usd) state.price = j.superfluid.usd;
    } catch (_) {}
  }

  // Fallback 2: DexScreener via CORS proxy
  if (!state.price) {
    try {
      const r = await fetch(
        'https://corsproxy.io/?url=' +
        encodeURIComponent('https://api.dexscreener.com/latest/dex/tokens/0xa69f80524381275a7ffdb3ae01c54150644c8792'),
      );
      const j = await r.json();
      if (j.pairs && j.pairs.length) state.price = parseFloat(j.pairs[0].priceUsd);
    } catch (_) {}
  }

  setStepStatus('s4', 'done');
}

// ---------------------------------------------------------------------------
// Step 5: Activity timeline
// ---------------------------------------------------------------------------

/**
 * Fetch the full history of `memberUnitsUpdatedEvent` records for the pool,
 * ordered by timestamp ascending, using cursor-based pagination.
 *
 * This data drives the "Member Activity Timeline" chart.  Failures are
 * silently ignored — the chart falls back to member `updatedAtTimestamp`.
 */
async function stepActivityTimeline() {
  setStepStatus('s5', 'active');

  try {
    let cursor = '';

    while (true) {
      const data = await gql(`{
        memberUnitsUpdatedEvents(
          first: 1000,
          where: { pool: "${PID}", id_gt: "${cursor}" },
          orderBy: timestamp,
          orderDirection: asc
        ) {
          id
          timestamp
          newUnits
          oldUnits
        }
      }`);

      if (!data.memberUnitsUpdatedEvents || !data.memberUnitsUpdatedEvents.length) break;

      state.tl = state.tl.concat(data.memberUnitsUpdatedEvents);

      if (data.memberUnitsUpdatedEvents.length < 1000) break;
      cursor = data.memberUnitsUpdatedEvents[data.memberUnitsUpdatedEvents.length - 1].id;
    }
  } catch (_) { /* non-fatal — chart has a fallback */ }

  setStepStatus('s5', 'done');
}

// ---------------------------------------------------------------------------
// Step 6: Action breakdown
// ---------------------------------------------------------------------------

/**
 * Build the `state.actions` map from two independent data sources:
 *
 * PART A — Superfluid Points API events
 *   Paginate through all events for the campaign.  Aggregate per event type:
 *     eventName → { totalEvents, totalPts }
 *   Apply:
 *     - Exclusion list: remove system/internal event types.
 *     - Merge map: combine related invite event types into one category.
 *   Produce a final map keyed by canonical event name with human-readable
 *   labels, descriptions, and calculated averages.
 *
 * PART B — GoodDollar subgraph entity counts
 *   Used as supplementary context (not for reward allocation).  We first
 *   probe which entity types exist with a multi-alias discovery query, then
 *   paginate only the present types for exact counts.
 *   Results stored in `state.sgActivity`.
 */
async function stepActionBreakdown() {
  setStepStatus('s6', 'active');

  // ── PART A: Points API events ─────────────────────────────────────────────

  // Accumulator: eventName → { totalEvents, totalPts }
  const evTypes = {};
  let evPage    = 1;

  while (true) {
    const j = await fetchPtsApi('/points/events?campaignId=' + CID + '&limit=100&page=' + evPage);
    if (!j || !j.events || !j.events.length) break;

    j.events.forEach(e => {
      const n = e.eventName || 'unknown';
      if (!evTypes[n]) evTypes[n] = { totalEvents: 0, totalPts: 0 };
      evTypes[n].totalEvents++;
      evTypes[n].totalPts += (e.points || 0);
    });

    document.getElementById('s6').querySelector('.ico').textContent =
      Object.keys(evTypes).length + ' types · pg ' + evPage;

    if (!j.pagination || !j.pagination.hasNextPage) break;
    evPage++;
  }

  // Event types that are internal / system and should not appear in the report.
  const EXCLUDE_EVENTS = new Set(['stack_sync', 'superfluid-program-bootstrapper']);

  // Merge related invite event sub-types into a single "invites" category.
  const MERGE_MAP = { inviteRewards: 'invites', validInvites: 'invites' };

  // Human-readable labels and descriptions keyed by canonical event name.
  const evLabels = {
    governanceStakePoints: 'Governance Staking',
    claimPoints:           'G$ Claims',
    claimed:               'G$ Claims',
    streamPoints:          'Stream Donations',
    streamed:              'Stream Donations',
    invites:               'Invites',
    farcasterPoints:       'Farcaster Activity',
  };
  const evDescs = {
    governanceStakePoints: 'Staking G$ in GoodDollar governance',
    claimPoints:           'Daily G$ UBI claims',
    claimed:               'Daily G$ UBI claims',
    streamPoints:          'Streaming donations to GoodCollective',
    streamed:              'Streaming donations to GoodCollective',
    invites:               'Inviting new users to the ecosystem',
    farcasterPoints:       'Engagement on Farcaster social protocol',
  };

  // Apply exclusions and merges, then build `state.actions`.
  const merged = {};
  Object.entries(evTypes).forEach(([name, t]) => {
    if (EXCLUDE_EVENTS.has(name)) return;
    const key = MERGE_MAP[name] || name;
    if (!merged[key]) merged[key] = { totalEvents: 0, totalPts: 0 };
    merged[key].totalEvents += t.totalEvents;
    merged[key].totalPts   += t.totalPts;
  });

  Object.entries(merged).forEach(([name, t]) => {
    const avgPts = t.totalEvents > 0 ? t.totalPts / t.totalEvents : 0;
    state.actions[name] = {
      label:       evLabels[name] || name.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()),
      desc:        evDescs[name]  || 'Campaign point event',
      source:      'points-api',
      totalEvents: t.totalEvents,
      points:      t.totalPts,
      avgPts:      Math.round(avgPts * 100) / 100,
      estimated:   false,
    };
  });

  // ── PART B: GoodDollar subgraph entity counts ─────────────────────────────

  try {
    // Discovery query: find which entity types have at least one record.
    const disc = await gdGql(`{
      se: stakingEvents(first:1)         { id }
      ls: lockerStakings(first:1)        { id }
      fn: fontaines(first:1)             { id }
      iu: instantUnlocks(first:1)        { id }
      ce: claimEventUnits(first:1)       { id }
      fs: fluidStreamClaimEvents(first:1){ id }
      lp: liquidityPositions(first:1)    { id }
    }`);

    if (disc) {
      // Alias → entity metadata mapping
      const entMap = {
        se: { key: 'stakingEvents',          label: 'Staking Events',      desc: 'Governance staking events'        },
        ls: { key: 'lockerStakings',         label: 'Locker Stakings',     desc: 'Active staking positions'         },
        fn: { key: 'fontaines',              label: 'Fontaines',           desc: 'Streaming donation contracts'     },
        iu: { key: 'instantUnlocks',         label: 'Instant Unlocks',     desc: 'Token unlock events'              },
        ce: { key: 'claimEventUnits',        label: 'Claim Events',        desc: 'G$ UBI claim units'               },
        fs: { key: 'fluidStreamClaimEvents', label: 'Stream Claims',       desc: 'Superfluid stream claims'         },
        lp: { key: 'liquidityPositions',     label: 'Liquidity Positions', desc: 'Liquidity provision'              },
      };

      const found = Object.keys(entMap).filter(a => disc[a] && disc[a].length > 0);

      // Paginate each present entity to get an exact total count.
      for (const alias of found) {
        const ent    = entMap[alias];
        let count    = 0;
        let lastId   = '';

        try {
          while (true) {
            const w    = lastId
              ? `(first:1000,orderBy:id,where:{id_gt:"${lastId}"})`
              : `(first:1000,orderBy:id)`;
            const data = await gdGql(`{ ${ent.key}${w} { id } }`);

            if (!data || !data[ent.key] || !data[ent.key].length) break;

            count += data[ent.key].length;

            document.getElementById('s6').querySelector('.ico').textContent =
              ent.label + ': ' + count;

            if (data[ent.key].length < 1000) break;
            lastId = data[ent.key][data[ent.key].length - 1].id;
          }
        } catch (_) { /* entity pagination failed — record 0 */ }

        state.sgActivity[ent.key] = {
          label:  ent.label,
          desc:   ent.desc,
          count:  count,
          exists: true,
        };
      }

      document.getElementById('s6').querySelector('.ico').textContent =
        Object.keys(evTypes).length + ' pts + ' + found.length + ' on-chain';
    }
  } catch (e) {
    console.warn('GD subgraph probe:', e);
  }

  setStepStatus('s6', 'done');
}

// ---------------------------------------------------------------------------
// Step 7: Wallet↔Locker mapping
// ---------------------------------------------------------------------------

/**
 * Resolve each pool member address to its human-controlled owner wallet using
 * four strategies applied in order.  Results accumulate in `state.lockers`.
 *
 * Strategy A — GD subgraph lockers (up to 10 pages × 1 000 = 10 000 lockers)
 *   The subgraph stores `locker.lockerOwner` for known locker contracts.
 *
 * Strategy B — lockers.json
 *   A pre-fetched JSON file at the repo root.  Adds entries not already found
 *   by Strategy A (does not overwrite existing mappings).
 *
 * Strategy C — RPC batch eth_call (always runs for unresolved members)
 *   For each unresolved pool member we call the contract's owner function
 *   using several common selectors (owner(), lockerOwner(), getOwner(), etc.).
 *   Batched in groups of 50 to stay within RPC rate limits.
 *   CRITICAL: this runs even when Strategies A/B loaded data, to maximise
 *   resolution of pool members whose lockers weren't in those data sets.
 *
 * Strategy D — Self-mapping (fallback)
 *   Any pool member still unresolved after A/B/C is mapped to itself.
 *   This covers EOA (externally-owned account) members who hold pool units
 *   directly (no locker contract).
 *
 * If resolution is very poor (< 10 % genuine mappings) an upload widget is
 * shown so the user can supply a supplementary lockers.json manually.
 */
async function stepWalletLockerMap() {
  setStepStatus('s7', 'active');

  const allAddrs = state.mem.map(m => m.account.id.toLowerCase());

  state.resolveStats = {
    gdSubgraph: 0,
    lockerJson: 0,
    rpc:        0,
    selfMapped: 0,
    total:      allAddrs.length,
  };

  // ── Strategy A: GD subgraph ───────────────────────────────────────────────
  try {
    let lastId = '';
    for (let page = 0; page < 10; page++) {
      const data = await gdGql(`{
        lockers(first:1000, where:{id_gt:"${lastId}"}, orderBy:id) {
          id
          lockerOwner
        }
      }`);

      if (!data || !data.lockers || !data.lockers.length) break;

      data.lockers.forEach(l => {
        const lid = l.id.toLowerCase();
        const ow  = (l.lockerOwner || '').toLowerCase();
        if (ow && ow !== '0x0000000000000000000000000000000000000000') {
          state.lockers[lid] = ow;
        }
      });

      document.getElementById('s7').querySelector('.ico').textContent =
        Object.keys(state.lockers).length + ' subgraph';

      if (data.lockers.length < 1000) break;
      lastId = data.lockers[data.lockers.length - 1].id;
    }

    state.resolveStats.gdSubgraph = allAddrs.filter(a => state.lockers[a]).length;
  } catch (e) {
    console.warn('GD subgraph lockers:', e);
  }

  // ── Strategy B: lockers.json ──────────────────────────────────────────────
  try {
    const r = await fetch('lockers.json');
    if (r.ok) {
      const j   = await r.json();
      // Support multiple JSON shapes: { data: { lockers: [] } }, [], { lockers: [] }
      const lks = j.data ? j.data.lockers : (Array.isArray(j) ? j : (j.lockers || []));
      let added = 0;

      lks.forEach(l => {
        const lid = (l.id || '').toLowerCase();
        const ow  = (l.lockerOwner || '').toLowerCase();
        if (ow && !state.lockers[lid]) {
          state.lockers[lid] = ow;
          added++;
        }
      });

      state.resolveStats.lockerJson = added;
    }
  } catch (_) { /* lockers.json not present — silently skip */ }

  // ── Strategy C: RPC batch eth_call ───────────────────────────────────────
  // Always run for pool members not yet resolved, even if A/B loaded some data.
  const unresolvedBeforeRpc = allAddrs.filter(a => !state.lockers[a]);

  document.getElementById('s7').querySelector('.ico').textContent =
    (allAddrs.length - unresolvedBeforeRpc.length) + '/' + allAddrs.length + ' → RPC';

  if (unresolvedBeforeRpc.length > 0) {
    for (const rpcUrl of BASE_RPCS) {
      // Check if there are any addresses still unresolved.
      if (allAddrs.filter(a => !state.lockers[a]).length === 0) break;

      let rpcResolved = false;

      // Try each owner function selector on the current RPC endpoint.
      for (const { sel } of OWNER_SELS) {
        const remaining = allAddrs.filter(a => !state.lockers[a]);
        if (remaining.length === 0) break;

        const resolved = await batchEthCall(remaining, sel, rpcUrl);
        const count    = Object.keys(resolved).length;

        if (count > 0) {
          Object.assign(state.lockers, resolved);
          state.resolveStats.rpc += count;
          rpcResolved = true;
        }

        document.getElementById('s7').querySelector('.ico').textContent =
          allAddrs.filter(a => state.lockers[a]).length + '/' + allAddrs.length;
      }

      if (rpcResolved) break; // First successful RPC; stop trying fallbacks
    }
  }

  // ── Strategy D: self-map remaining ───────────────────────────────────────
  allAddrs.forEach(addr => {
    if (!state.lockers[addr]) {
      state.lockers[addr] = addr;
      state.resolveStats.selfMapped++;
    }
  });

  // ── Low-resolution fallback upload widget ─────────────────────────────────
  const resolvedReal = allAddrs.filter(a => state.lockers[a] && state.lockers[a] !== a).length;

  if (resolvedReal < allAddrs.length * 0.1) {
    const ud = document.createElement('div');
    ud.style.cssText = 'margin:4px 0 0 30px;font-size:11px';
    ud.innerHTML =
      `<span style="color:var(--orange)">Low resolution (${resolvedReal}/${allAddrs.length}). </span>` +
      `<label style="display:inline-flex;align-items:center;gap:4px;cursor:pointer;color:var(--accent)">` +
      `Upload lockers.json to improve` +
      `<input type="file" accept=".json" style="display:none" onchange="` +
      `const rd=new FileReader();rd.onload=function(e){` +
      `try{const j=JSON.parse(e.target.result);` +
      `const lks=j.data?j.data.lockers:(Array.isArray(j)?j:(j.lockers||[]));` +
      `lks.forEach(l=>{if(l.id&&l.lockerOwner)state.lockers[l.id.toLowerCase()]=l.lockerOwner.toLowerCase();});` +
      `this.parentElement.innerHTML='✓ Loaded '+lks.length+' lockers. Refresh to re-render.';` +
      `}catch(er){this.parentElement.textContent='Error: '+er.message;}}.bind(this);` +
      `rd.readAsText(this.files[0]);">` +
      `</label>`;

    document.getElementById('s7').parentElement.appendChild(ud);
  }

  setStepStatus('s7', 'done');
}
