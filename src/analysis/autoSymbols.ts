/**
 * Automatic chess symbols (iteration 7, José, 2026-10-29): which NAGs a move
 * gets from the engines' analyses, with a stated criterion for each one. The
 * criteria are documented in the task note (3.25) and in the app's help.
 *
 * Every measure is the one the colour code already uses: the **win
 * probability lost** by the move (classify.ts, Lichess's formula), in points
 * (0.05 = 5 points).
 *
 * Position (one scale for the symbol and the text — José chose "B"):
 *   |eval| ≤ 0.35 → =    ≤ 0.90 → ⩲ / ⩱    ≤ 2.00 → ± / ∓    > 2.00 or mate → +− / −+
 *   Put on a move only when its category differs from the previous position's
 *   (José: "solo se pone cuando cambia"), and always with N.
 * Move (the first that applies, in this order):
 *   ??  loses ≥ 15 points   ?  10 – 15   ?!  5 – 10   — Lichess's thresholds
 *       (lila Advice.scala / liveAnnotate.ts: 0.3 / 0.2 / 0.1 of winning chances
 *       on a −1..1 scale = 15 / 10 / 5 points), and its rules for mates:
 *       allowing a mate is ?? unless the position was already lost (< −7 → ?,
 *       < −10 → ?!); letting a mate slip is ?? unless still winning (> +7 → ?,
 *       > +10 → ?!).
 *   !!  "only move" (below) that Maia gives < 5 % at the selected Elo.
 *   !   loses < 2 points, the second best loses ≥ 5, and Maia gives it < 10 %
 *       (▲): good and hard to find at that level.
 *   □   the best move, and every other move evaluated loses ≥ 10 (≥ 2 moves
 *       evaluated; a single legal move is not marked).
 *   !?  loses < 5 and sets a trap: the opponent's most likely reply (Maia)
 *       is an error there (loses ≥ 10).
 * Other:
 *   N   the first move out of the opening book (previous position in it, this
 *       move not) — "new for our book" (Lichess 2300+), not a theoretical novelty.
 *   ⨀   zugzwang: after the move, the side to move would be ≥ 10 points better
 *       if it could pass (the threats analysis is that position with the turn
 *       passed). Only when threats were computed and there is no check.
 * ∞ and =∞ can't be read from a number: never automatic.
 *
 * Sources (José asked for them in the docs, 2026-10-29):
 *   Lichess thresholds  https://github.com/lichess-org/lila/blob/898ad2cdee0aa803d7959d83868efc00097a648b/modules/tree/src/main/Advice.scala#L44-L49
 *   Lichess mate rules  https://github.com/lichess-org/lila/blob/898ad2cdee0aa803d7959d83868efc00097a648b/modules/tree/src/main/Advice.scala#L98-L106
 *   same, analysis board https://github.com/lichess-org/lila/blob/898ad2cdee0aa803d7959d83868efc00097a648b/ui/analyse/src/liveAnnotate.ts#L22-L32
 *   Stockfish's scale (+1.00 ≈ 50 % win in self-play) https://official-stockfish.github.io/docs/stockfish-wiki/Stockfish-FAQ.html
 *   no standard symbol table https://talkchess.com/viewtopic.php?p=489426
 *
 * Pure: the analyses are passed in.
 */
import type { PositionAnalysis } from './analyzer'
import { bestScore, moverWinProb, type Score } from './classify'

/** Upper limits (centipawns) of =, ⩲ and ± (José's choice "B", 2026-10-29). */
export const EVAL_BANDS = { equal: 35, slight: 90, clear: 200 } as const
export type EvalLevel = 'equal' | 'slight' | 'clear' | 'decisive'

/** Criteria in win points (0..1) — see the header. */
export const AUTO = {
  inaccuracy: 0.05,
  mistake: 0.1,
  blunder: 0.15,
  good: 0.02, // "!": the move loses less than this…
  secondWorse: 0.05, // …and the second best loses at least this
  onlyMove: 0.1, // "□": every other move loses at least this
  hardProb: 0.1, // "!": Maia gives it less than this (▲)
  veryHardProb: 0.05, // "!!"
  trapReply: 0.1, // "!?": the opponent's likely reply loses at least this
  zugzwang: 0.1, // "⨀": passing would be this much better
} as const

/** The level of an evaluation and who it favours ('white' / 'black'; null when equal). */
export function evalLevel(score: Score): { level: EvalLevel; side: 'white' | 'black' | null } {
  if (score.mate !== undefined) return { level: 'decisive', side: score.mate > 0 ? 'white' : 'black' }
  const cp = score.cp ?? 0
  const abs = Math.abs(cp)
  if (abs <= EVAL_BANDS.equal) return { level: 'equal', side: null }
  const level: EvalLevel = abs <= EVAL_BANDS.slight ? 'slight' : abs <= EVAL_BANDS.clear ? 'clear' : 'decisive'
  return { level, side: cp > 0 ? 'white' : 'black' }
}

/** The position symbol's NAG: = 10, ⩲ 14 / ⩱ 15, ± 16 / ∓ 17, +− 18 / −+ 19. */
export function evalNag(score: Score): number {
  const { level, side } = evalLevel(score)
  if (level === 'equal') return 10
  const white = { slight: 14, clear: 16, decisive: 18 }[level]
  return side === 'white' ? white : white + 1
}

export interface AutoInput {
  uci: string // the move played
  whiteMoved: boolean
  before?: PositionAnalysis // the position the move was played in (cached)
  after?: PositionAnalysis // the position after it (cached)
  /** The previous position was in the book and this move is not (book on). */
  leftBook: boolean
}

/** Pawns from the mover's side (for Lichess's mate rules); mates count as ±100. */
const povCp = (s: Score, white: boolean) => (s.mate !== undefined ? Math.sign(s.mate) * 10000 : (s.cp ?? 0)) * (white ? 1 : -1)
const mateFor = (s: Score, white: boolean) => s.mate !== undefined && (s.mate > 0) === white

/** The move's quality symbol from the loss and Lichess's mate rules (undefined = none). */
function errorNag(beforeBest: Score, played: Score, loss: number, white: boolean): number | undefined {
  // Allowing a mate (Lichess "MateCreated"): milder if the position was already lost.
  if (mateFor(played, !white) && !mateFor(beforeBest, !white)) {
    const prev = povCp(beforeBest, white)
    return prev < -999 ? 6 : prev < -700 ? 2 : 4
  }
  // Letting a mate slip (Lichess "MateLost"): milder if still clearly winning.
  if (mateFor(beforeBest, white) && !mateFor(played, white)) {
    const now = povCp(played, white)
    return now > 999 ? 6 : now > 700 ? 2 : 4
  }
  if (loss >= AUTO.blunder) return 4
  if (loss >= AUTO.mistake) return 2
  if (loss >= AUTO.inaccuracy) return 6
  return undefined
}

/**
 * The automatic NAGs of a move, in display order. [] when the analyses
 * needed are missing (a symbol is only given with the data for it).
 */
export function autoNags(input: AutoInput): number[] {
  const out: number[] = []
  const bm = input.before?.main
  const am = input.after?.main
  const white = input.whiteMoved
  const beforeBest = bm?.done ? bestScore(bm.classified) : undefined
  const afterBest = am?.done && am.lines[0] ? (am.lines[0].mate !== undefined ? { mate: am.lines[0].mate } : { cp: am.lines[0].scoreCp }) : undefined

  // Move quality: needs the position before (its best) and the played move's score.
  if (bm && beforeBest) {
    const own = bm.classified.get(input.uci)
    const played = own?.score ?? afterBest
    if (played) {
      const loss = own ? own.loss : Math.max(0, moverWinProb(beforeBest, white) - moverWinProb(played, white))
      const err = errorNag(beforeBest, played, loss, white)
      if (err) out.push(err)
      else {
        const others = [...bm.classified.values()].filter((c) => c.uci !== input.uci)
        const prob = bm.maia?.policy.find((p) => p.uci === input.uci)?.prob
        const isBest = own?.loss === 0
        const only = isBest && others.length > 0 && others.every((c) => c.loss >= AUTO.onlyMove)
        const second = Math.min(...others.map((c) => c.loss))
        if (only && prob !== undefined && prob < AUTO.veryHardProb) out.push(3) // !!
        else if (loss < AUTO.good && others.length > 0 && second >= AUTO.secondWorse && prob !== undefined && prob < AUTO.hardProb) out.push(1) // !
        else if (only) out.push(7) // □
        else if (loss < AUTO.inaccuracy && am?.done && am.maia) {
          // !?: the opponent's most likely reply is an error.
          const reply = am.maia.policy[0]?.uci
          const r = reply ? am.classified.get(reply) : undefined
          if (r && r.loss >= AUTO.trapReply) out.push(5)
        }
      }
    }
  }

  // Position: when its category changes (or with N).
  if (afterBest) {
    const nag = evalNag(afterBest)
    const changed = !!beforeBest && evalNag(beforeBest) !== nag // unknown before: can't tell, nothing
    if (changed || input.leftBook) out.push(nag)
  }
  if (input.leftBook) out.push(146) // N

  // Zugzwang: the side to move after the move would be better off passing.
  const th = input.after?.threats
  if (afterBest && th?.done && th.lines[0]) {
    const pass: Score = th.lines[0].mate !== undefined ? { mate: th.lines[0].mate } : { cp: th.lines[0].scoreCp }
    const toMove = !white
    if (moverWinProb(pass, toMove) - moverWinProb(afterBest, toMove) >= AUTO.zugzwang) out.push(22)
  }
  return out
}
