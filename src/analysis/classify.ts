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
  const text = Math.abs((score.cp ?? 0) / 100).toFixed(decimals)
  if (Number(text) === 0) return text // "0.0", not "−0.0" (−0.04 rounded to one decimal)
  return ((score.cp ?? 0) > 0 ? '+' : '−') + text
}

/**
 * "Δ eval" of the Maia column (José, iteration 5): how much worse a move is
 * than the best one, in pawns with one decimal — |eval(best) − eval(move)| —
 * after a down arrow: "↓1.6". Nothing lost → plain "0.0", no arrow (José,
 * 2026-10-26).
 * Both scores from White's point of view, as Stockfish gives them.
 * With mates there is no pawn difference: "0.0" if both mate for the same side
 * (only the distance changes), "↓M" if the move gains or loses a mate.
 */
export function deltaEval(best: Score, move: Score): string {
  if (best.mate === undefined && move.mate === undefined) {
    const pawns = (Math.abs((best.cp ?? 0) - (move.cp ?? 0)) / 100).toFixed(1)
    return pawns === '0.0' ? pawns : `↓${pawns}`
  }
  if (best.mate !== undefined && move.mate !== undefined && Math.sign(best.mate) === Math.sign(move.mate)) return '0.0'
  return '↓M'
}

/** The best of the evaluated moves for the side to move (the one with no loss), or undefined. */
export function bestScore(classified: Map<string, ClassifiedMove>): Score | undefined {
  let best: ClassifiedMove | undefined
  for (const c of classified.values()) if (!best || c.loss < best.loss) best = c
  return best?.score
}

