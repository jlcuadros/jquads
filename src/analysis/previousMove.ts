/**
 * Summary of the move that led to the current position (José, 2026-10-26),
 * shown as the last paragraph of the explanatory text (after the book and the
 * position), always (good moves too), short (José's wording). Examples (Spanish):
 *   "Con 12.♘e5 las blancas cometieron un error: pasaron de +0.5 a −3.0. Un error típico de 1500."
 *   "Con 8.h3 las blancas cometieron una imprecisión: de +0.6 a +0.2."
 *   "8.♗e2 fue la mejor jugada (+0.4 → +0.3). Jugada de libro 📖."
 *
 * Data, only from what was already analysed (no extra engine work):
 *   - the previous position's analysis (cached when you go move by move):
 *     its best evaluation ("before"), the played move's own evaluation if
 *     Stockfish evaluated it there, and Maia's probabilities;
 *   - otherwise "after" = the current position's best evaluation.
 * Without the previous position's analysis there is nothing to say: null.
 *
 * Quality uses the colour code (win probability lost: < 5 % good, 5–10 %
 * inaccuracy, ≥ 10 % mistake) and the same mate rules as Δ eval: a mate for
 * the mover that is no longer there = "missed a mate", a mate against the
 * mover that wasn't there = "allowed mate".
 */
import { bestScore, classify, formatScore, moverWinProb, PALETTE, type ClassifiedMove, type MoveClass, type Score } from './classify'
import type { Segment } from './describe'
import { t, type MessageKey } from '../i18n/i18n'

export interface PreviousMoveInput {
  uci: string // the move played
  san: string // how to show it ("12.♘e5" — numbering included by the caller)
  whiteMoved: boolean
  elo: number
  inBook: boolean
  /** The previous position as analysed (cached), or undefined if it never was. */
  prev?: {
    classified: Map<string, ClassifiedMove>
    best?: Score // its Stockfish best line (white's point of view)
    policy?: Array<{ uci: string; prob: number }> // Maia at `elo`
  }
  /** Best evaluation of the current position, when known (fallback for "after"). */
  currentBest?: Score
}

/** Maia probability thresholds for "typical" / "rare" at that rating (agreed with José). */
export const TYPICAL_PROB = 0.1
export const RARE_PROB = 0.02

export type PreviousMoveKind = 'best' | 'good' | 'ok' | 'blunder' | 'missedMate' | 'allowedMate'

/** Which side a score's mate favours: 1 White, −1 Black, 0 no mate. */
const mateSide = (s: Score) => (s.mate !== undefined ? Math.sign(s.mate) : s.mateUnknown ? Math.sign(s.cp ?? 0) : 0)

/** The verdict on the move (pure): kind, colour, before/after evaluations. */
export function judgePreviousMove(input: PreviousMoveInput): { kind: PreviousMoveKind; color: string; before: Score; after: Score; cls: MoveClass } | null {
  const prev = input.prev
  if (!prev) return null
  const before = bestScore(prev.classified) ?? prev.best
  const own = prev.classified.get(input.uci)
  const after = own?.score ?? input.currentBest
  if (!before || !after) return null
  // Classification: the one Stockfish gave the move there, or computed the same way.
  const loss = own ? own.loss : Math.max(0, moverWinProb(before, input.whiteMoved) - moverWinProb(after, input.whiteMoved))
  const cls = own?.cls ?? classify(loss)
  const color = own?.color ?? PALETTE[cls][0]
  const mover = input.whiteMoved ? 1 : -1
  // "Best" only if Stockfish evaluated the move there and it lost nothing.
  let kind: PreviousMoveKind = cls === 'good' ? (own?.loss === 0 ? 'best' : 'good') : cls
  if (mateSide(before) === mover && mateSide(after) !== mover) kind = 'missedMate'
  else if (mateSide(after) === -mover && mateSide(before) !== -mover) kind = 'allowedMate'
  return { kind, color, before, after, cls }
}

/** A template with "{move}" → text segments around the move's segment. */
function withMove(template: string, move: Segment): Segment[] {
  const [a, b = ''] = template.split('{move}')
  return [...(a ? [{ text: a }] : []), move, ...(b ? [{ text: b }] : [])]
}

/** The summary as segments (the move coloured and clickable like the others), or [] without data. */
export function describePreviousMove(input: PreviousMoveInput): Segment[] {
  const v = judgePreviousMove(input)
  if (!v) return []
  const side = input.whiteMoved ? 'white' : 'black'
  const scores = { before: formatScore(v.before, 1), after: formatScore(v.after, 1) }
  const move: Segment = { move: input.uci, san: input.san, color: v.color }
  const segs = withMove(t(`pm.${v.kind}.${side}` as MessageKey, scores), move)
  if (input.inBook) segs.push({ text: t('pm.book') })
  // An inaccuracy or mistake that Maia expects often (≥ 10 %) at the selected
  // rating is "typical" of that level; one it almost never plays (< 2 %), "rare".
  const prob = input.prev?.policy?.find((p) => p.uci === input.uci)?.prob
  if (v.cls !== 'good' && prob !== undefined && (prob >= TYPICAL_PROB || prob < RARE_PROB)) {
    segs.push({ text: t(`pm.${prob >= TYPICAL_PROB ? 'typical' : 'rare'}.${v.cls}` as MessageKey, { elo: input.elo }) })
  }
  return segs
}
