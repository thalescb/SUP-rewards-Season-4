/**
 * state.js
 *
 * Centralised mutable application state.
 *
 * All pipeline and render modules import this object and mutate it in place.
 * Using a single exported object (rather than individual `let` exports) lets
 * every module share the same reference — re-assignment inside the object
 * propagates everywhere without the need for setter functions.
 *
 * Usage:
 *   import { state } from './state.js';
 *   state.pool = fetchedPool;
 */
export const state = {
  /** Pool metadata returned by the Superfluid subgraph. */
  pool: null,

  /** Array of pool member objects from the Superfluid subgraph. */
  mem: [],

  /** Array of points-account objects from the Superfluid Points API. */
  pts: [],

  /** Live SUP token price in USD (null if unavailable). */
  price: null,

  /**
   * Activity timeline: array of memberUnitsUpdatedEvent objects
   * { id, timestamp, newUnits, oldUnits } ordered by timestamp ascending.
   */
  tl: [],

  /**
   * Actions breakdown keyed by event name.
   * Each entry: { label, desc, source, totalEvents, points, avgPts, estimated }
   */
  actions: {},

  /**
   * Locker→owner mapping: { lockerAddress → ownerWalletAddress }
   * Built from GD subgraph, lockers.json, and on-chain RPC calls.
   */
  lockers: {},

  /**
   * Supplementary on-chain entity counts from the GoodDollar subgraph.
   * Keyed by entity type name: { label, desc, count, exists }
   */
  sgActivity: {},

  /**
   * Breakdown of how many addresses were resolved via each strategy:
   * { gdSubgraph, lockerJson, rpc, selfMapped, total }
   */
  resolveStats: {},

  /**
   * ISO timestamp string if data was loaded from a snapshot cache;
   * null when fetched live.
   */
  snapshotTime: null,
};
