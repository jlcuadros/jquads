/**
 * Explanatory text for a position, in the selected language (i18n: keys "d.*").
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
import { evalLevel } from './autoSymbols'
import { formatScore } from './classify'
import { t, type MessageKey } from '../i18n/i18n'

export type Segment = { text: string } | { move: string; san: string; color: string }

export interface DescribeInput {
  whiteToMove: boolean
  elo: number
  best: Score // Stockfish's best line, white's point of view
  classified: Map<string, ClassifiedMove> // moves evaluated by Stockfish
  policy: Array<{ uci: string; prob: number }> // Maia, sorted desc
  san: (uci: string) => string
}

export type Findability = 'easy' | 'medium' | 'hard'

/**
 * How findable the good moves are for a human of the selected Elo: Maia's
 * probability mass on them. ≥ 70 % easy, ≥ 30 % medium ("not obvious"), else
 * hard. Used by the text's sentence on how findable the good moves are.
 */
export function goodMoveFindability(
  policy: Array<{ uci: string; prob: number }>,
  classified: Map<string, ClassifiedMove>,
): { mass: number; level: Findability } {
  const mass = policy.filter((p) => classified.get(p.uci)?.cls === 'good').reduce((a, p) => a + p.prob, 0)
  return { mass, level: mass >= 0.7 ? 'easy' : mass >= 0.3 ? 'medium' : 'hard' }
}

/** Minimum Maia probability for a mistake to be called "tempting". */
const TEMPTING_PROB = 0.1

const pct = (p: number) => `${Math.round(p * 100)} %`

/** "A", "A y B", "A, B y C" with move segments. */
function moveList(moves: ClassifiedMove[], input: DescribeInput): Segment[] {
  const out: Segment[] = []
  moves.forEach((m, i) => {
    if (i > 0) out.push({ text: i === moves.length - 1 ? t('d.and') : ', ' })
    out.push({ move: m.uci, san: input.san(m.uci), color: m.color })
  })
  return out
}

/** Sentence 1: evaluation in words, from Stockfish's best line. */
function outcome(input: DescribeInput): string {
  const { best } = input
  if (best.mate !== undefined) {
    return t(best.mate > 0 ? 'd.mate.white' : 'd.mate.black', { n: Math.abs(best.mate) })
  }
  // Same scale as the evaluation symbols (=, ⩲, ±, +−; autoSymbols.ts → EVAL_BANDS, José's
  // choice "B" 2026-10-29: 0.35 / 0.90 / 2.00; until then 0.35 / 1.50 / 3.00).
  const { level, side } = evalLevel(best)
  if (!side) return t('d.balanced')
  // One full sentence per side and level: the verb agrees differently in each
  // language ("Las blancas tienen" / "White has" / "Les Blancs ont"…).
  return t(`d.${level}.${side}` as MessageKey, { score: formatScore(best) })
}

export function describePosition(input: DescribeInput): Segment[] {
  const segs: Segment[] = [{ text: outcome(input) + ' ' }]
  const evaluated = [...input.classified.values()].sort((a, b) => a.loss - b.loss)
  const good = evaluated.filter((m) => m.cls === 'good').slice(0, 3)
  if (!good.length) return segs

  // Sentence 2 + 3: good moves and how findable they are at this Elo.
  const { mass, level } = goodMoveFindability(input.policy, input.classified)
  const number = good.length === 1 ? 'one' : 'many' // grammar: "la" / "las", "it" / "them"…
  segs.push({ text: t(`d.good.${number}`) })
  segs.push(...moveList(good, input))
  segs.push({ text: t(`d.${level}.${number}` as MessageKey, { elo: input.elo, pct: pct(mass) }) })

  // Sentence 4: tempting mistakes (likely for a human, but bad).
  const tempting = input.policy
    .filter((p) => p.prob >= TEMPTING_PROB)
    .map((p) => ({ p, c: input.classified.get(p.uci) }))
    .filter((x): x is { p: (typeof input.policy)[number]; c: ClassifiedMove } => !!x.c && x.c.cls !== 'good')
  for (const { p, c } of tempting) {
    segs.push({ text: t('d.careful') }, { move: c.uci, san: input.san(c.uci), color: c.color })
    const kind = c.cls === 'blunder' ? 'd.tempting.blunder' : 'd.tempting.ok'
    segs.push({ text: t(kind, { pct: pct(p.prob), score: formatScore(c.score) }) })
  }
  return segs
}
