import { describe, expect, it } from 'vitest'
import { blunderMeter, classify, classifyMoves, formatScore, PALETTE, whiteWinProb, bestScore, deltaEval } from './classify'

describe('whiteWinProb', () => {
  it('is 50 % at 0, symmetric, and saturates with mate', () => {
    expect(whiteWinProb({ cp: 0 })).toBeCloseTo(0.5)
    expect(whiteWinProb({ cp: 100 }) + whiteWinProb({ cp: -100 })).toBeCloseTo(1)
    expect(whiteWinProb({ cp: 100 })).toBeCloseTo(0.591, 2) // Lichess formula
    expect(whiteWinProb({ mate: 3 })).toBe(1)
    expect(whiteWinProb({ mate: -2 })).toBe(0)
  })
})

describe('classify', () => {
  it('uses the 5 % / 10 % thresholds', () => {
    expect(classify(0)).toBe('good')
    expect(classify(0.049)).toBe('good')
    expect(classify(0.05)).toBe('ok')
    expect(classify(0.099)).toBe('ok')
    expect(classify(0.1)).toBe('blunder')
  })
})

describe('classifyMoves', () => {
  it('measures loss from the side to move, and colours best→worst within a class', () => {
    // Black to move: more negative (white's view) is better for black.
    const scores = new Map([
      ['e7e5', { cp: -20 }], // best for black
      ['d7d5', { cp: -10 }], // ~2 % worse → good, second shade
      ['g7g5', { cp: 150 }], // much worse → blunder
    ])
    const r = classifyMoves(scores, false)
    expect(r.get('e7e5')).toMatchObject({ cls: 'good', loss: 0, color: PALETTE.good[0] })
    expect(r.get('d7d5')).toMatchObject({ cls: 'good', color: PALETTE.good[1] })
    expect(r.get('g7g5')?.cls).toBe('blunder')
    expect(r.get('g7g5')?.color).toBe(PALETTE.blunder[0]) // first (palest) blunder shade
  })
})

describe('blunderMeter', () => {
  it('splits Maia probability among classes, normalised over evaluated moves', () => {
    const classified = classifyMoves(
      new Map([
        ['a', { cp: 50 }],
        ['b', { cp: -200 }],
      ]),
      true,
    )
    const m = blunderMeter(
      [
        { uci: 'a', prob: 0.6 },
        { uci: 'b', prob: 0.2 },
        { uci: 'c', prob: 0.2 }, // not evaluated → ignored
      ],
      classified,
    )
    expect(m.coverage).toBeCloseTo(0.8)
    expect(m.good).toBeCloseTo(0.75)
    expect(m.blunder).toBeCloseTo(0.25)
  })
})

describe('formatScore', () => {
  it('formats centipawns and mates', () => {
    expect(formatScore({ cp: 31 })).toBe('+0.31')
    expect(formatScore({ cp: -120 })).toBe('−1.20')
    expect(formatScore({ mate: 3 })).toBe('+M3')
    expect(formatScore({ mate: -2 })).toBe('−M2')
  })
})

describe('formatScore decimals', () => {
  it('two by default, one in the Stockfish column (iteration 5)', () => {
    expect(formatScore({ cp: 638 })).toBe('+6.38')
    expect(formatScore({ cp: 638 }, 1)).toBe('+6.4')
    expect(formatScore({ cp: -4 }, 1)).toBe('0.0') // not "−0.0"
    expect(formatScore({ mate: -3 }, 1)).toBe('−M3')
  })
})

describe('deltaEval (Maia column, iteration 5)', () => {
  it('pawns with one decimal, absolute value', () => {
    expect(deltaEval({ cp: 35 }, { cp: -120 })).toBe('↓1.6')
    expect(deltaEval({ cp: 30 }, { cp: 26 })).toBe('0.0') // rounds to zero: no arrow either
    expect(deltaEval({ cp: -50 }, { cp: -50 })).toBe('0.0') // no arrow when nothing is lost
    expect(deltaEval({ cp: -300 }, { cp: -10 })).toBe('↓2.9') // Black to move: best is lower, still positive
  })
  it('mates: same side → 0.0, gaining or losing a mate → M', () => {
    expect(deltaEval({ mate: 3 }, { mate: 7 })).toBe('0.0')
    expect(deltaEval({ mate: 3 }, { cp: 400 })).toBe('↓M')
    expect(deltaEval({ cp: 0 }, { mate: -2 })).toBe('↓M')
  })
  it('bestScore = the evaluated move with no loss', () => {
    const scores = new Map([['e2e4', { cp: 30 }], ['g2g4', { cp: -150 }]])
    expect(bestScore(new Map())).toBeUndefined()
    expect(bestScore(classifyMoves(scores, true))).toEqual({ cp: 30 })
    expect(bestScore(classifyMoves(scores, false))).toEqual({ cp: -150 })
  })
})

