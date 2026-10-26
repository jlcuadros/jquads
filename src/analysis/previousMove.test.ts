import { describe, expect, it } from 'vitest'
import { describePreviousMove, judgePreviousMove, type PreviousMoveInput } from './previousMove'
import { classifyMoves, type Score } from './classify'
import type { Segment } from './describe'

/** The summary as plain text, the move written as "[san]". */
const text = (segs: Segment[]) => segs.map((s) => ('text' in s ? s.text : `[${s.san}]`)).join('').trim()

/** Input where White just played `uci`; `scores` = the previous position's evaluated moves. */
function input(uci: string, scores: Record<string, Score>, extra: Partial<PreviousMoveInput> = {}): PreviousMoveInput {
  return {
    uci,
    san: '12.♘e5',
    whiteMoved: true,
    elo: 1500,
    inBook: false,
    prev: { classified: classifyMoves(new Map(Object.entries(scores)), true), policy: [] },
    ...extra,
  }
}

describe('describePreviousMove (José\'s short wording, 2026-10-26)', () => {
  it('a mistake, typical of the rating (Maia ≥ 25 %, ●)', () => {
    const i = input('f3e5', { d2d4: { cp: 50 }, f3e5: { cp: -300 } })
    i.prev!.policy = [{ uci: 'f3e5', prob: 0.3 }]
    expect(text(describePreviousMove(i))).toBe('Con [12.♘e5] las blancas cometieron un error: pasaron de +0.5 a −3.0. Un error típico de 1500.')
  })
  it('a mistake by Black, rare for the rating (Maia < 10 %, ▲)', () => {
    const i = input('d8h4', { e7e5: { cp: -30 }, d8h4: { cp: 210 } }, { san: '12…♛h4', whiteMoved: false })
    i.prev = { classified: classifyMoves(new Map(Object.entries({ e7e5: { cp: -30 }, d8h4: { cp: 210 } })), false), policy: [{ uci: 'd8h4', prob: 0.01 }] }
    expect(text(describePreviousMove(i))).toBe('Con [12…♛h4] las negras cometieron un error: pasaron de −0.3 a +2.1. Un error raro para 1500.')
  })
  it('an inaccuracy; Maia between 10 and 25 % (■) says nothing about the level', () => {
    // (+0.6 → +0.2 would be "good": only ~4 % of win probability lost; an inaccuracy is 5–10 %.)
    const i = input('h2h3', { d2d4: { cp: 60 }, h2h3: { cp: -10 } }, { san: '8.h3' })
    i.prev!.policy = [{ uci: 'h2h3', prob: 0.15 }]
    expect(text(describePreviousMove(i))).toBe('Con [8.h3] las blancas cometieron una imprecisión: de +0.6 a −0.1.')
  })
  it('good, best, and book moves', () => {
    expect(text(describePreviousMove(input('f1e2', { d2d4: { cp: 40 }, f1e2: { cp: 30 } }, { san: '8.♗e2' })))).toBe('[8.♗e2] fue buena jugada (+0.4 → +0.3).')
    expect(text(describePreviousMove(input('f1e2', { f1e2: { cp: 40 }, d2d4: { cp: 30 } }, { san: '8.♗e2', inBook: true })))).toBe(
      '[8.♗e2] fue la mejor jugada (+0.4). Jugada de libro 📖.', // the best move: one evaluation
    )
  })
  it('mates, with the same rules as Δ eval', () => {
    expect(judgePreviousMove(input('a2a3', { h5f7: { mate: 3 }, a2a3: { cp: 120 } }))?.kind).toBe('missedMate')
    expect(text(describePreviousMove(input('a2a3', { h5f7: { mate: 3 }, a2a3: { cp: 120 } }, { san: '9.a3' })))).toBe(
      'Con [9.a3] las blancas dejaron escapar un mate: de +M3 a +1.2.',
    )
    expect(text(describePreviousMove(input('a2a3', { d2d4: { cp: 40 }, a2a3: { mate: -2 } }, { san: '9.a3' })))).toBe(
      'Con [9.a3] las blancas permitieron mate: de +0.4 a −M2.',
    )
  })
  it('the move was not evaluated there: "after" = the current position\'s evaluation; never "best"', () => {
    const i = input('a2a4', { d2d4: { cp: 40 } }, { san: '8.a4', currentBest: { cp: 35 } })
    expect(text(describePreviousMove(i))).toBe('[8.a4] fue buena jugada (+0.4 → +0.3).')
  })
  it('without the previous analysis, or without any "after": nothing', () => {
    expect(describePreviousMove(input('d2d4', {}, { prev: undefined }))).toEqual([])
    expect(describePreviousMove(input('a2a4', { d2d4: { cp: 40 } }))).toEqual([])
  })
})
