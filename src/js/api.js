/**
 * api.js
 *
 * Network utilities for fetching data from:
 *  - Superfluid Protocol Subgraph (GraphQL)
 *  - GoodDollar Subgraph (GraphQL, with CORS-proxy fallback)
 *  - Superfluid Points API (REST, with CORS-proxy fallback)
 *  - Base Mainnet RPC (JSON-RPC batch eth_call)
 */

import { SG, GD_SG } from './config.js';

// ---------------------------------------------------------------------------
// Superfluid Subgraph
// ---------------------------------------------------------------------------

/**
 * Execute a GraphQL query against the Superfluid Protocol subgraph.
 *
 * @param {string} q - GraphQL query string (not wrapped in an object).
 * @returns {Promise<object>} The `data` field of the subgraph response.
 * @throws {Error} If the HTTP response is not OK.
 */
export async function gql(q) {
  const r = await fetch(SG, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ query: q }),
  });
  if (!r.ok) throw new Error('Subgraph HTTP ' + r.status);
  return (await r.json()).data;
}

// ---------------------------------------------------------------------------
// GoodDollar Subgraph
// ---------------------------------------------------------------------------

/**
 * Execute a GraphQL query against the GoodDollar subgraph.
 *
 * Tries the canonical endpoint directly first, then through corsproxy.io as a
 * fallback if the browser blocks the request due to CORS restrictions.
 *
 * @param {string} query - GraphQL query string.
 * @returns {Promise<object|null>} The `data` field, or null on failure.
 */
export async function gdGql(query) {
  // We try the base URL and an explicit /graphql path suffix.
  const endpoints = [GD_SG, GD_SG + '/graphql'];

  for (const ep of endpoints) {
    // --- Direct request ---
    try {
      const r = await fetch(ep, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ query }),
      });
      if (r.ok) {
        const j = await r.json();
        if (j.data) return j.data;
      }
    } catch (_) { /* swallow CORS / network errors and try proxy */ }

    // --- CORS proxy fallback ---
    try {
      const r = await fetch('https://corsproxy.io/?url=' + encodeURIComponent(ep), {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ query }),
      });
      if (r.ok) {
        const j = await r.json();
        if (j.data) return j.data;
      }
    } catch (_) { /* ignore */ }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Superfluid Points API
// ---------------------------------------------------------------------------

/**
 * Fetch a path from the Superfluid Points API, falling back to CORS proxies.
 *
 * Tries the following in order:
 *   1. Direct request (works when running locally or from a same-origin host)
 *   2. corsproxy.io
 *   3. api.allorigins.win
 *
 * @param {string} path - URL path starting with `/`, e.g. `/points/events?…`
 * @returns {Promise<object|null>} Parsed JSON, or null if all attempts fail.
 */
export async function fetchPtsApi(path) {
  const url = 'https://cms.superfluid.pro' + path;

  for (const px of [null, 'https://corsproxy.io/?url=', 'https://api.allorigins.win/raw?url=']) {
    try {
      const r = await fetch(px ? px + encodeURIComponent(url) : url);
      if (r.ok) return await r.json();
    } catch (_) { /* try next proxy */ }
  }

  return null;
}

// ---------------------------------------------------------------------------
// On-chain RPC — batch eth_call
// ---------------------------------------------------------------------------

/**
 * Send a JSON-RPC batch of eth_call requests for a list of contract addresses
 * and a given 4-byte function selector.
 *
 * The response is decoded as an Ethereum address (last 20 bytes of the 32-byte
 * ABI-encoded return value).  Entries that return the zero address or the
 * contract's own address (indicating the contract is not a locker) are skipped.
 *
 * @param {string[]} addrs    - Contract addresses to query (lowercase).
 * @param {string}   selector - 4-byte hex selector, e.g. `'0x8da5cb5b'`.
 * @param {string}   rpcUrl   - JSON-RPC endpoint URL.
 * @returns {Promise<Record<string,string>>} Map of address → resolved owner.
 */
export async function batchEthCall(addrs, selector, rpcUrl) {
  const resolved  = {};
  const batchSize = 50; // keep batch payloads manageable

  for (let i = 0; i < addrs.length; i += batchSize) {
    const batch = addrs.slice(i, i + batchSize);

    // Build a JSON-RPC 2.0 batch array; use the array index as the request id.
    const calls = batch.map((addr, j) => ({
      jsonrpc: '2.0',
      id:      j,
      method:  'eth_call',
      params:  [{ to: addr, data: selector }, 'latest'],
    }));

    try {
      const r       = await fetch(rpcUrl, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(calls),
      });
      const results = await r.json();

      // The RPC may return a single object if the batch contained one item.
      const items = Array.isArray(results) ? results : [results];

      items.forEach(res => {
        if (res.id == null || res.id >= batch.length) return;

        const addr = batch[res.id];

        // A valid ABI-encoded address response is 66 hex chars (0x + 32 bytes).
        // Skip empty responses, zero-bytes responses, and self-referential ones.
        if (
          res.result &&
          res.result.length >= 66 &&
          res.result !== '0x' &&
          !/^0x0+$/.test(res.result)
        ) {
          // The address occupies the last 20 bytes of the 32-byte return value.
          const owner = '0x' + res.result.slice(26).toLowerCase();

          if (
            owner !== '0x0000000000000000000000000000000000000000' &&
            owner !== addr
          ) {
            resolved[addr] = owner;
          }
        }
      });
    } catch (_) { /* RPC error — continue with remaining addresses */ }

    // Small delay between batches to avoid rate-limiting.
    if (i + batchSize < addrs.length) {
      await new Promise(r => setTimeout(r, 40));
    }
  }

  return resolved;
}
