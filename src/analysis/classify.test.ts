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
  it('measures loss from the side to move', () => {
    // Black to move: more negative (white's view) is better for black.
    const scores = new Map([
      ['e7e5', { cp: -20 }], // best for black
      ['d7d5', { cp: -10 }], // ~0.9 % worse → good, still the darkest green
      ['g7g5', { cp: 150 }], // much worse → blunder
    ])
    const r = classifyMoves(scores, false)
    expect(r.get('e7e5')).toMatchObject({ cls: 'good', loss: 0, color: PALETTE.good[0] })
    expect(r.get('d7d5')).toMatchObject({ cls: 'good', color: PALETTE.good[0] })
    expect(r.get('g7g5')?.cls).toBe('blunder')
    expect(r.get('g7g5')?.color).toBe(PALETTE.blunder[0]) // first (palest) blunder shade
  })

  it('green and yellow shades by the loss, one per point (José, 2026-10-28)', () => {
    // White to move, best 0.00 (50 %). Losses: −0.30 2.8 %, −0.60 5.5 %, −0.80 7.3 %, −1.00 9.1 %.
    const r = classifyMoves(new Map([['a', { cp: 0 }], ['b', { cp: -30 }], ['c', { cp: -60 }], ['d', { cp: -80 }], ['e', { cp: -100 }]]), true)
    expect(r.get('b')?.color).toBe(PALETTE.good[2]) // 2–3 %
    expect(r.get('c')?.color).toBe(PALETTE.ok[0]) // 5–6 %
    expect(r.get('d')?.color).toBe(PALETTE.ok[2]) // 7–8 %
    expect(r.get('e')?.color).toBe(PALETTE.ok[4]) // 9–10 %
  })

  it('same loss → same shade, whatever the order (green and red)', () => {
    const r = classifyMoves(new Map([['a', { cp: 0 }], ['b', { cp: -10 }], ['c', { cp: -10 }], ['d', { cp: -200 }], ['e', { cp: -200 }], ['f', { cp: -300 }]]), true)
    expect(r.get('b')?.color).toBe(r.get('c')?.color)
    expect(r.get('d')?.color).toBe(PALETTE.blunder[0]) // red still by order…
    expect(r.get('e')?.color).toBe(PALETTE.blunder[0]) // …but equal ones share it
    expect(r.get('f')?.color).toBe(PALETTE.blunder[1])
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
    expect(deltaEval({ cp: 30 }, { cp: 26 })).toBe('★') // rounds to zero: no arrow either
    expect(deltaEval({ cp: -50 }, { cp: -50 })).toBe('★') // no arrow when nothing is lost
    expect(deltaEval({ cp: -300 }, { cp: -10 })).toBe('↓2.9') // Black to move: best is lower, still positive
  })
  it('mates for the same side: change of mate distance (José, 2026-10-26)', () => {
    expect(deltaEval({ mate: -6 }, { mate: -9 })).toBe('↓M+3') // the mate comes 3 moves later
    expect(deltaEval({ mate: -9 }, { mate: -3 })).toBe('↓M−6') // received 6 moves sooner
    expect(deltaEval({ mate: 3 }, { mate: 7 })).toBe('↓M+4')
    expect(deltaEval({ mate: -5 }, { mate: -5 })).toBe('★') // same distance: nothing lost, no arrow
  })
  it('a mate appears, disappears or changes side: ⇵ and the move\'s own evaluation', () => {
    expect(deltaEval({ mate: 5 }, { mate: -6 })).toBe('⇵−M6')
    expect(deltaEval({ cp: 30 }, { mate: -3 })).toBe('⇵−M3')
    expect(deltaEval({ cp: -30 }, { mate: -3 })).toBe('⇵−M3')
    expect(deltaEval({ mate: -3 }, { cp: 40 })).toBe('⇵+0.4')
    expect(deltaEval({ mate: 2 }, { cp: 0 })).toBe('⇵0.0')
  })
  it('endgame-table wins of unknown distance', () => {
    const win = { cp: 2000, mateUnknown: true }
    expect(deltaEval(win, { cp: 0 })).toBe('⇵0.0') // a won ending drawn
    expect(deltaEval({ cp: 0 }, win)).toBe('⇵+M?')
    expect(deltaEval(win, win)).toBe('★')
    expect(deltaEval({ mate: 12 }, win)).toBe('↓M?')
    expect(formatScore(win)).toBe('+M?')
  })
  it('bestScore = the evaluated move with no loss', () => {
    const scores = new Map([['e2e4', { cp: 30 }], ['g2g4', { cp: -150 }]])
    expect(bestScore(new Map())).toBeUndefined()
    expect(bestScore(classifyMoves(scores, true))).toEqual({ cp: 30 })
    expect(bestScore(classifyMoves(scores, false))).toEqual({ cp: -150 })
  })
})

