/**
 * config.js
 *
 * All hard-coded constants for the Season 4 SUP Rewards report.
 * Change values here when adapting this tool for a future season.
 */

// ---------------------------------------------------------------------------
// Superfluid Protocol Subgraph  (Base Mainnet)
// Used to fetch: pool metadata, pool members, unit counts, distribution totals.
// ---------------------------------------------------------------------------
export const SG = 'https://subgraph-endpoints.superfluid.dev/base-mainnet/protocol-v1';

// ---------------------------------------------------------------------------
// Superfluid Points API
// Base URL for the campaign points leaderboard and per-event history.
// ---------------------------------------------------------------------------
export const PA = 'https://cms.superfluid.pro/points/accounts';

// ---------------------------------------------------------------------------
// Campaign identifiers
// PID  — Superfluid pool contract address on Base Mainnet.
// CID  — Superfluid Points campaign ID.
// ---------------------------------------------------------------------------
export const PID = '0x41491a100847a7f678e3b286fea32b0dad18920e';
export const CID = 7860;

// Denomination: Superfluid stores token amounts as 18-decimal integers.
// Divide raw values by W to get human-readable SUP.
export const W = 1e18;

// ---------------------------------------------------------------------------
// Base Mainnet RPC endpoints
// Tried in order; the first one that responds successfully is used.
// ---------------------------------------------------------------------------
export const BASE_RPCS = [
  'https://mainnet.base.org',
  'https://base.llamarpc.com',
  'https://1rpc.io/base',
];

// ---------------------------------------------------------------------------
// Locker owner function selectors (keccak256 first 4 bytes)
// Different locker contracts expose ownership under different function names.
// We try each selector in turn until one returns a non-zero address.
// ---------------------------------------------------------------------------
export const OWNER_SELS = [
  { sel: '0x8da5cb5b', name: 'owner()'       },
  { sel: '0xa80b4694', name: 'lockerOwner()' },
  { sel: '0x893d20e8', name: 'getOwner()'    },
  { sel: '0xf851a440', name: 'admin()'       },
  { sel: '0x5aef7de6', name: 'avatar()'      },
];

// ---------------------------------------------------------------------------
// GoodDollar Subgraph  (The Graph hosted service)
// Used as supplementary data for locker→owner mappings and on-chain activity.
// NOTE: This subgraph may index a different chain than Base Mainnet.
//       We validate overlap against pool members before trusting its data.
// ---------------------------------------------------------------------------
export const GD_SG =
  'https://api.thegraph.com/subgraphs/id/QmbmxtkSiFkKpHeUd4wKmws8QVkb7DtE2UMRtezC7HpmG1';
