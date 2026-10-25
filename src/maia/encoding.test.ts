import { describe, expect, it } from 'vitest'
import { decodePrediction, encodePosition, mirrorFen, mirrorMove, NUM_MOVES } from './encoding'

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

describe('mirroring', () => {
  it('mirrors moves and FENs (black to move → white to move)', () => {
    expect(mirrorMove('e7e5')).toBe('e2e4')
    expect(mirrorMove('a2a1q')).toBe('a7a8q')
    // After 1.e4 the mirrored position is "black played e5, white to move".
    expect(mirrorFen('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1')).toBe(
      'rnbqkbnr/pppp1ppp/8/4p3/8/8/PPPPPPPP/RNBQKBNR w KQkq e6 0 1',
    )
  })
})

describe('encodePosition', () => {
  it('encodes the start position: 32 pieces, 20 legal moves', () => {
    const enc = encodePosition(START)
    expect(enc.tokens.reduce((a, b) => a + b, 0)).toBe(32)
    expect(enc.tokens[(0 * 8 + 4) * 12 + 5]).toBe(1) // white king (K = 5) on e1
    expect(enc.tokens[(7 * 8 + 3) * 12 + 10]).toBe(1) // black queen (q = 10) on d8
    expect(enc.legalMovesUci).toHaveLength(20)
    expect(enc.blackToMove).toBe(false)
  })

  it('returns real-board moves when black is to move', () => {
    const enc = encodePosition('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1')
    expect(enc.blackToMove).toBe(true)
    expect(enc.legalMovesUci).toContain('e7e5')
    expect(enc.legalMovesUci).not.toContain('e2e4')
  })
})

describe('decodePrediction', () => {
  it('softmaxes over legal moves only and flips the value for black', () => {
    const enc = encodePosition('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1')
    const logits = new Float32Array(NUM_MOVES).fill(-50)
    logits[enc.legalIndices[0]] = 5 // make one legal move dominant
    const value = Float32Array.from([0, 0, 10]) // "win" for the side to move (black)
    const p = decodePrediction(enc, logits, value)
    expect(p.policy[0].uci).toBe(enc.legalMovesUci[0])
    expect(p.policy.reduce((a, m) => a + m.prob, 0)).toBeCloseTo(1)
    expect(p.whiteWinProb).toBeLessThan(0.01) // black winning → white ~0
  })
})
