/**
 * Explanatory text for a position, in Spanish (pure function).
 *
 * Inspired by maiachess' templated descriptions (useDescriptionGenerator.ts,
 * see the task note, Investigation 1.1) but simplified and deterministic:
 *   1. Who is better, from Stockfish's best line.
 *   2. Which moves are good (loss < 5 %).
 *   3. How findable they are for a human of the selected Elo: Maia's
 *      probability mass on the good moves.
 *   4. Tempting mistakes: moves Maia gives ≥ 10 % that Stockfish classifies
 *      as inaccuracy or blunder.
 *
 * Output is a list of segments so moves can be rendered coloured and clickable.
 */
import type { ClassifiedMove, Score } from './classify'
import { formatScore } from './classify'

export type Segment = { text: string } | { move: string; san: string; color: string }

export interface DescribeInput {
  whiteToMove: boolean
  elo: number
  best: Score // Stockfish's best line, white's point of view
  classified: Map<string, ClassifiedMove> // moves evaluated by Stockfish
  policy: Array<{ uci: string; prob: number }> // Maia, sorted desc
  san: (uci: string) => string
}

/** Minimum Maia probability for a mistake to be called "tempting". */
const TEMPTING_PROB = 0.1

const pct = (p: number) => `${Math.round(p * 100)} %`

/** "A", "A y B", "A, B y C" with move segments. */
function moveList(moves: ClassifiedMove[], input: DescribeInput): Segment[] {
  const out: Segment[] = []
  moves.forEach((m, i) => {
    if (i > 0) out.push({ text: i === moves.length - 1 ? ' y ' : ', ' })
    out.push({ move: m.uci, san: input.san(m.uci), color: m.color })
  })
  return out
}

/** Sentence 1: evaluation in words, from Stockfish's best line. */
function outcome(input: DescribeInput): string {
  const { best } = input
  if (best.mate !== undefined) {
    const side = best.mate > 0 ? 'las blancas' : 'las negras'
    return `Hay mate en ${Math.abs(best.mate)} para ${side}.`
  }
  const cp = best.cp ?? 0
  const side = cp > 0 ? 'las blancas' : 'las negras'
  const abs = Math.abs(cp)
  if (abs <= 35) return 'La posición está equilibrada.'
  if (abs <= 150) return `${cap(side)} tienen una ligera ventaja (${formatScore(best)}).`
  if (abs <= 300) return `${cap(side)} tienen una ventaja clara (${formatScore(best)}).`
  return `${cap(side)} tienen una ventaja decisiva (${formatScore(best)}).`
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1)

export function describePosition(input: DescribeInput): Segment[] {
  const segs: Segment[] = [{ text: outcome(input) + ' ' }]
  const evaluated = [...input.classified.values()].sort((a, b) => a.loss - b.loss)
  const good = evaluated.filter((m) => m.cls === 'good').slice(0, 3)
  if (!good.length) return segs

  // Sentence 2 + 3: good moves and how findable they are at this Elo.
  const goodMass = input.policy.filter((p) => input.classified.get(p.uci)?.cls === 'good').reduce((a, p) => a + p.prob, 0)
  if (good.length === 1) segs.push({ text: 'Solo hay una jugada buena: ' })
  else segs.push({ text: 'Las jugadas buenas son ' })
  segs.push(...moveList(good, input))
  const who = `un jugador de ${input.elo}`
  if (goodMass >= 0.7) segs.push({ text: `, y ${who} la${good.length > 1 ? 's' : ''} encontraría sin problema (${pct(goodMass)}). ` })
  else if (goodMass >= 0.3) segs.push({ text: `, aunque no son evidentes: ${who} acertaría el ${pct(goodMass)} de las veces. ` })
  else segs.push({ text: `, pero son difíciles de ver: ${who} solo acertaría el ${pct(goodMass)} de las veces. ` })

  // Sentence 4: tempting mistakes (likely for a human, but bad).
  const tempting = input.policy
    .filter((p) => p.prob >= TEMPTING_PROB)
    .map((p) => ({ p, c: input.classified.get(p.uci) }))
    .filter((x): x is { p: (typeof input.policy)[number]; c: ClassifiedMove } => !!x.c && x.c.cls !== 'good')
  for (const { p, c } of tempting) {
    segs.push({ text: 'Cuidado con ' }, { move: c.uci, san: input.san(c.uci), color: c.color })
    const kind = c.cls === 'blunder' ? 'es un error grave' : 'es una imprecisión'
    segs.push({ text: `: la jugaría el ${pct(p.prob)} pero ${kind} (${formatScore(c.score)}). ` })
  }
  return segs
}
