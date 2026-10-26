/**
 * Icon code for how likely a move is (José, 2026-10-26), used everywhere a
 * move is shown with its colour dot — columns, bars' legends (threats too),
 * text, book line, previous move, move strip and the whole-game view:
 *   ● circle   very likely     Maia gives it ≥ 25 %
 *   ■ square   in between      10 % – 25 %
 *   ▲ triangle not very likely < 10 % (also moves Maia doesn't list)
 * Maia's probability at the selected Elo, in the position the move is played
 * from. The colour stays the quality (Stockfish, loss vs the best move).
 */
export type Shape = 'circle' | 'square' | 'triangle'

export const LIKELY_PROB = 0.25
export const POSSIBLE_PROB = 0.1

/** Shape for a probability; undefined when it isn't known (Maia not answered yet). */
export function shapeOf(prob: number | undefined): Shape | undefined {
  if (prob === undefined) return undefined
  return prob >= LIKELY_PROB ? 'circle' : prob >= POSSIBLE_PROB ? 'square' : 'triangle'
}

/** A move's probability in Maia's list (0 if not listed); undefined without the list. */
export function probOf(policy: Array<{ uci: string; prob: number }> | undefined, uci: string): number | undefined {
  if (!policy) return undefined
  return policy.find((p) => p.uci === uci)?.prob ?? 0
}
