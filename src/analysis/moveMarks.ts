/**
 * Marks in the move strip (José, 2026-10-26): for every move whose previous
 * position was analysed, a small shape before the move —
 *   - colour: the move's quality (the colour code, as in the columns);
 *   - shape: how findable the good moves were there for a player of the
 *     selected Elo — circle easy (≥ 70 %), square not obvious (30–70 %),
 *     diamond hard (< 30 %).
 * Only on screen: they are never written into the PGN.
 */
import { judgePreviousMove } from './previousMove'
import { goodMoveFindability, type Findability } from './describe'
import type { ClassifiedMove, Score } from './classify'

export type MarkShape = 'circle' | 'square' | 'diamond'
const SHAPES: Record<Findability, MarkShape> = { easy: 'circle', medium: 'square', hard: 'diamond' }

export interface MoveMark {
  color: string
  shape: MarkShape
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
  const shape = prev.policy?.length ? SHAPES[goodMoveFindability(prev.policy, prev.classified).level] : 'circle'
  return { color: v.color, shape }
}
