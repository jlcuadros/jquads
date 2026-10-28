/**
 * Move quality and colour code (pure functions).
 *
 * Same rules as maiachess.com (src/constants/analysis.ts, commit a6e52f5):
 * a move is judged by how much winning probability it loses compared with
 * Stockfish's best move, from the point of view of the side to move:
 *   loss < 5 %        → good
 *   5 % ≤ loss < 10 % → ok (inaccuracy)
 *   loss ≥ 10 %       → blunder
 *
 * Difference with maiachess: they convert centipawns to win probability with a
 * lookup table; we use Lichess' published logistic formula (one line, same
 * shape). Documented in the task note (Decision).
 */

export type MoveClass = 'good' | 'ok' | 'blunder'

export const THRESHOLDS = { inaccuracy: 0.05, blunder: 0.1 } as const

/**
 * Colour shades per category, from best to worst move WITHIN the category
 * (maiachess' COLORS after its `.reverse()`): darkest green = best good move;
 * paler yellow → orange as "ok" moves get worse; pale → deep red for blunders.
 */
export const PALETTE: Record<MoveClass, string[]> = {
  good: ['#238b45', '#41ab5d', '#74c476', '#90D289', '#AEDFA4'],
  ok: ['#ffffcc', '#ffeda0', '#fed976', '#feb24c', '#ec7014'],
  blunder: ['#fcbba1', '#fc9272', '#fb6a4a', '#ef3b2c', '#cb181d'],
}

/** Engine score of one move, from WHITE's point of view. */
export interface Score {
  cp?: number
  mate?: number // + = white mates
  // Endgame tables: a forced win whose mate distance the tables don't give.
  // `cp` is then ±2000 (so colours and bars treat it as decisive) and it is
  // written "+M?" / "−M?" (José, 2026-10-26).
  mateUnknown?: boolean
}

/**
 * Expected score for White (0..1) from an engine score.
 * Lichess formula: winningChances = 2 / (1 + e^(−0.00368208·cp)) − 1.
 */
export function whiteWinProb(score: Score): number {
  if (score.mate !== undefined) return score.mate > 0 ? 1 : 0
  const cp = Math.max(-1000, Math.min(1000, score.cp ?? 0))
  return 1 / (1 + Math.exp(-0.00368208 * cp))
}

/** Win probability for the side to move. */
export function moverWinProb(score: Score, whiteToMove: boolean): number {
  const w = whiteWinProb(score)
  return whiteToMove ? w : 1 - w
}

export function classify(loss: number): MoveClass {
  if (loss >= THRESHOLDS.blunder) return 'blunder'
  if (loss >= THRESHOLDS.inaccuracy) return 'ok'
  return 'good'
}

export interface ClassifiedMove {
  uci: string
  score: Score
  loss: number // win probability lost vs the best move (0 = best)
  cls: MoveClass
  color: string
}

/**
 * Classifies every evaluated move of a position and assigns its colour.
 * @param scores UCI move → engine score (white's point of view)
 */
export function classifyMoves(scores: Map<string, Score>, whiteToMove: boolean): Map<string, ClassifiedMove> {
  const entries = [...scores].map(([uci, score]) => ({ uci, score, wp: moverWinProb(score, whiteToMove) }))
  if (!entries.length) return new Map()
  const best = Math.max(...entries.map((e) => e.wp))

  const result = new Map<string, ClassifiedMove>()
  // Sorted best → worst so that the shade index grows within each category.
  const sorted = entries.sort((a, b) => b.wp - a.wp)
  const seen: Record<MoveClass, number> = { good: 0, ok: 0, blunder: 0 }
  for (const e of sorted) {
    const loss = Math.max(0, best - e.wp)
    const cls = classify(loss)
    const shades = PALETTE[cls]
    const color = shades[Math.min(seen[cls]++, shades.length - 1)]
    result.set(e.uci, { uci: e.uci, score: e.score, loss, cls, color })
  }
  return result
}

/**
 * Blunder Meter: how Maia's probability mass splits among good / ok / blunder
 * moves. Only moves that Stockfish evaluated are counted; the result is
 * normalised over them (`coverage` says how much of Maia's mass that is).
 */
export function blunderMeter(
  policy: Array<{ uci: string; prob: number }>,
  classified: Map<string, ClassifiedMove>,
): { good: number; ok: number; blunder: number; coverage: number } {
  const sums = { good: 0, ok: 0, blunder: 0 }
  let coverage = 0
  for (const { uci, prob } of policy) {
    const c = classified.get(uci)
    if (!c) continue
    sums[c.cls] += prob
    coverage += prob
  }
  if (coverage === 0) return { good: 0, ok: 0, blunder: 0, coverage: 0 }
  return {
    good: sums.good / coverage,
    ok: sums.ok / coverage,
    blunder: sums.blunder / coverage,
    coverage,
  }
}

/** "+0.35", "−1.20", "+M3" — from WHITE's point of view, as on Lichess. */
export function formatScore(score: Score, decimals = 2): string {
  if (score.mate !== undefined) return `${score.mate > 0 ? '+' : '−'}M${Math.abs(score.mate)}`
  if (score.mateUnknown) return `${(score.cp ?? 0) > 0 ? '+' : '−'}M?`
  const text = Math.abs((score.cp ?? 0) / 100).toFixed(decimals)
  if (Number(text) === 0) return text // "0.0", not "−0.0" (−0.04 rounded to one decimal)
  return ((score.cp ?? 0) > 0 ? '+' : '−') + text
}

/** Δ eval when the move loses nothing: a star, "as good as the best" (José, 2026-10-28). */
export const DELTA_BEST = '★'

/** Which side a mate score favours: 1 White mates, −1 Black mates, 0 not a mate. */
const mateSide = (s: Score) => (s.mate !== undefined ? Math.sign(s.mate) : s.mateUnknown ? Math.sign(s.cp ?? 0) : 0)

/**
 * "Δ eval" of the Maia column: how much worse a move is than the best one.
 * Scores are White's point of view, as Stockfish (or the endgame tables) give
 * them; the same rules for Stockfish's mates and the tables' (José, 2026-10-26):
 *  - no mate in either: pawns lost with one decimal after a down arrow, "↓1.6";
 *    nothing lost → "★" (U+2605; José 2026-10-28, before "0.0");
 *  - both mate for the same side: how the mate distance changes, "↓M+3" (the
 *    mate comes 3 moves later, e.g. −M6 → −M9) or "↓M−6" (it comes 6 moves
 *    sooner, e.g. −M9 → −M3); same distance → "★"; if the tables don't
 *    give a distance: "↓M?" ("★" if neither has one);
 *  - a mate appears, disappears or changes side: "⇵" (U+21F5) and the move's
 *    own evaluation, e.g. +M5 → −M6 "⇵−M6", +0.3 → −M3 "⇵−M3",
 *    −M3 → +0.4 "⇵+0.4", a table win of unknown distance "⇵+M?".
 */
export function deltaEval(best: Score, move: Score): string {
  const side = mateSide(best)
  if (!side && !mateSide(move)) {
    const pawns = (Math.abs((best.cp ?? 0) - (move.cp ?? 0)) / 100).toFixed(1)
    return pawns === '0.0' ? DELTA_BEST : `↓${pawns}`
  }
  if (side !== mateSide(move)) return `⇵${formatScore(move, 1)}`
  if (best.mate === undefined || move.mate === undefined) return best.mate === move.mate ? DELTA_BEST : '↓M?'
  const later = Math.abs(move.mate) - Math.abs(best.mate) // > 0: the mate comes later
  return later === 0 ? DELTA_BEST : `↓M${later > 0 ? '+' : '−'}${Math.abs(later)}`
}

/** The best of the evaluated moves for the side to move (the one with no loss), or undefined. */
export function bestScore(classified: Map<string, ClassifiedMove>): Score | undefined {
  let best: ClassifiedMove | undefined
  for (const c of classified.values()) if (!best || c.loss < best.loss) best = c
  return best?.score
}

