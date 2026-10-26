/**
 * Marks in the move strip and the whole-game view (José, 2026-10-26): for
 * every move whose previous position was analysed, a small marker before the
 * move with the same code as everywhere else —
 *   - colour: the move's quality (the colour code, as in the columns);
 *   - shape: how likely Maia (selected Elo) was to play it there —
 *     ● ≥ 25 %, ■ 10–25 %, ▲ < 10 % (analysis/likelihood.ts).
 * Only on screen: they are never written into the PGN.
 */
import { judgePreviousMove } from './previousMove'
import { probOf, shapeOf, type Shape } from './likelihood'
import type { ClassifiedMove, Score } from './classify'

export interface MoveMark {
  color: string
  shape: Shape
}

/**
 * The mark of the move `uci` played from an analysed position (`prev`), or
 * undefined without data. `currentBest` = the position after it, if analysed
 * (used when Stockfish didn't evaluate that move in `prev`).
 */
export function moveMark(
  prev: { classified: Map<string, ClassifiedMove>; best?: Score; policy?: Array<{ uci: string; prob: number }> } | undefined,
  uci: string,
  whiteMoved: boolean,
  currentBest?: Score,
): MoveMark | undefined {
  const v = judgePreviousMove({ uci, san: '', whiteMoved, elo: 0, inBook: false, prev, currentBest })
  if (!v || !prev) return undefined
  return { color: v.color, shape: shapeOf(probOf(prev.policy, uci)) ?? 'circle' }
}
