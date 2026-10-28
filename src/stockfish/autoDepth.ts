/**
 * "Auto" Stockfish depth from the device's speed (José, 2026-10-28), measured
 * in ⚙ → Motor (nodes per second, StockfishClient.benchmark).
 *
 * José's two reference points:
 *   - iPhone 15, 1.83 M nodes/s → depth 15 (14 "works well", he'd use 15);
 *   - a phone at 0.4 M nodes/s → depth 10;
 * and never below 10 (the analysis loses too much quality). Between and beyond
 * them, each depth level is worth the same speed factor: the one that joins the
 * two points, (1.83 / 0.4)^(1 / 5) ≈ 1.36 — i.e. depth grows with log(speed).
 * Threats: 3 below the main depth, never below 9.
 */
export const REF_FAST = { nps: 1.83e6, depth: 15 }
export const REF_SLOW = { nps: 0.4e6, depth: 10 }
export const MIN_DEPTH = 10
export const MAX_DEPTH = 24
export const MIN_THREAT_DEPTH = 9
export const THREAT_OFFSET = 3

/** Speed factor of one depth level (≈ 1.36). */
const LEVEL = (REF_FAST.nps / REF_SLOW.nps) ** (1 / (REF_FAST.depth - REF_SLOW.depth))

/** Main depth for a measured speed; without a measurement, the iPhone 15's minus one (14), a safe middle. */
export function autoDepth(nps?: number): number {
  if (!nps) return REF_FAST.depth - 1
  const depth = Math.round(REF_FAST.depth + Math.log(nps / REF_FAST.nps) / Math.log(LEVEL))
  return Math.min(MAX_DEPTH, Math.max(MIN_DEPTH, depth))
}

/** Threats' depth for a main depth: 3 less, at least 9. */
export const autoThreatDepth = (depth: number) => Math.max(MIN_THREAT_DEPTH, depth - THREAT_OFFSET)
