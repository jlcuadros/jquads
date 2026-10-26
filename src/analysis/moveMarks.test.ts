import { describe, expect, it } from 'vitest'
import { moveMark } from './moveMarks'
import { classifyMoves, PALETTE, type Score } from './classify'

/** A previous position (White to move) with these evaluated moves and Maia probabilities. */
function prev(scores: Record<string, Score>, policy: Record<string, number>) {
  return {
    classified: classifyMoves(new Map(Object.entries(scores)), true),
    policy: Object.entries(policy).map(([uci, prob]) => ({ uci, prob })),
  }
}

describe('moveMark (move strip, 2026-10-26)', () => {
  const scores = { e2e4: { cp: 30 }, d2d4: { cp: 25 }, g2g4: { cp: -200 } }

  it('colour = the move\'s quality; shape = how findable the good moves were', () => {
    expect(moveMark(prev(scores, { e2e4: 0.5, d2d4: 0.3, g2g4: 0.2 }), 'e2e4', true)).toEqual({ color: PALETTE.good[0], shape: 'circle' }) // 80 % → easy
    expect(moveMark(prev(scores, { e2e4: 0.2, d2d4: 0.2, g2g4: 0.6 }), 'g2g4', true)?.shape).toBe('square') // 40 % → not obvious
    const hard = moveMark(prev(scores, { e2e4: 0.1, d2d4: 0.05, g2g4: 0.85 }), 'g2g4', true)
    expect(hard?.shape).toBe('diamond') // 15 % → hard
    expect(hard?.color).toBe(PALETTE.blunder[0])
  })

  it('without Maia data: a circle; without the previous analysis: no mark', () => {
    expect(moveMark({ classified: classifyMoves(new Map(Object.entries(scores)), true) }, 'd2d4', true)?.shape).toBe('circle')
    expect(moveMark(undefined, 'e2e4', true)).toBeUndefined()
  })
})
