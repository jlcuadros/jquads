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

  it('colour = the move\'s quality; shape = how likely the played move was (● ≥ 25 %, ■ 10–25 %, ▲ < 10 %)', () => {
    const policy = { e2e4: 0.5, d2d4: 0.15, g2g4: 0.05 }
    expect(moveMark(prev(scores, policy), 'e2e4', true)).toEqual({ color: PALETTE.good[0], shape: 'circle' })
    expect(moveMark(prev(scores, policy), 'd2d4', true)?.shape).toBe('square')
    const unlikely = moveMark(prev(scores, policy), 'g2g4', true)
    expect(unlikely?.shape).toBe('triangle')
    expect(unlikely?.color).toBe(PALETTE.blunder[0])
    expect(moveMark(prev(scores, policy), 'a2a3', true, { cp: 20 })?.shape).toBe('triangle') // not in Maia's list
  })

  it('without Maia data: a circle; without the previous analysis: no mark', () => {
    expect(moveMark({ classified: classifyMoves(new Map(Object.entries(scores)), true) }, 'd2d4', true)?.shape).toBe('circle')
    expect(moveMark(undefined, 'e2e4', true)).toBeUndefined()
  })
})

describe('shapeOf (icon code, 2026-10-26)', () => {
  it('● ≥ 25 %, ■ 10–25 %, ▲ < 10 %, nothing when unknown', async () => {
    const { shapeOf, probOf } = await import('./likelihood')
    expect([0.25, 0.6].map(shapeOf)).toEqual(['circle', 'circle'])
    expect([0.1, 0.249].map(shapeOf)).toEqual(['square', 'square'])
    expect([0, 0.099].map(shapeOf)).toEqual(['triangle', 'triangle'])
    expect(shapeOf(undefined)).toBeUndefined()
    expect(probOf([{ uci: 'e2e4', prob: 0.4 }], 'd2d4')).toBe(0)
    expect(probOf(undefined, 'd2d4')).toBeUndefined()
  })
})
