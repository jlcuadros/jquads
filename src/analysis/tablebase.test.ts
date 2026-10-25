import { describe, expect, it } from 'vitest'
import { outcomeOf, parseTablebase, tablebaseEligible, tbLabel, tbPositionScore, type TbJson } from './tablebase'
import { classifyMoves, whiteWinProb } from './classify'

// Trimmed real answer of the API for KR vs K (8/8/4k3/8/8/4K3/8/7R w - - 0 1),
// fetched on 2026-10-25: White wins, DTM 23 plies (= mate in 12).
const KRK: TbJson = {
  category: 'win', dtz: 23, dtm: 23, checkmate: false, stalemate: false,
  moves: [
    { uci: 'h1d1', san: 'Rd1', category: 'loss', dtz: -22, dtm: -22 },
    { uci: 'h1h6', san: 'Rh6+', category: 'loss', dtz: -24, dtm: -24 },
    { uci: 'e3e4', san: 'Ke4', category: 'cursed-win', dtz: 101, dtm: null }, // invented: cursed for black
    { uci: 'h1h8', san: 'Rh8', category: 'draw', dtz: 0, dtm: 0 }, // invented: a drawing move
  ],
}
const FEN = '8/8/4k3/8/8/4K3/8/7R w - - 0 1'

describe('tablebaseEligible', () => {
  it('requires ≤ 7 pieces and no castling rights', () => {
    expect(tablebaseEligible(FEN)).toBe(true)
    expect(tablebaseEligible('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')).toBe(false)
    expect(tablebaseEligible('r3k3/8/8/8/8/8/8/4K2R w Kq - 0 1')).toBe(false) // castling rights
    expect(tablebaseEligible('8/5k2/8/3p4/3P4/2K5/5PPR/r7 w - - 0 1')).toBe(false) // 8 pieces
    expect(tablebaseEligible('8/5k2/8/3p4/3P4/2K5/7R/r7 w - - 0 1')).toBe(true) // 7 pieces
  })
})

describe('outcomeOf', () => {
  it('treats cursed wins / blessed losses as draws and unknown as no result', () => {
    expect(outcomeOf('win')).toBe('win')
    expect(outcomeOf('maybe-loss')).toBe('loss')
    expect(outcomeOf('cursed-win')).toBe('draw')
    expect(outcomeOf('blessed-loss')).toBe('draw')
    expect(outcomeOf('unknown')).toBeNull()
  })
})

describe('parseTablebase', () => {
  const r = parseTablebase(KRK, FEN)!

  it('gives the position result and mate distance in full moves', () => {
    expect(r.outcome).toBe('win')
    expect(r.mateIn).toBe(12) // 23 plies
  })

  it('inverts the opponent category into the mover result', () => {
    const rd1 = r.moves.find((m) => m.uci === 'h1d1')!
    expect(rd1.outcome).toBe('win')
    expect(rd1.mateIn).toBe(12) // 22 plies for black + this move = 23 plies
    expect(rd1.score).toEqual({ mate: 12 }) // White's point of view
    const ke4 = r.moves.find((m) => m.uci === 'e3e4')!
    expect(ke4.outcome).toBe('draw') // blessed loss for black = draw in practice
    expect(ke4.cursed).toBe(true)
  })

  it('produces scores that the colour code and the bar understand', () => {
    const scores = new Map(r.moves.map((m) => [m.uci, m.score]))
    const classified = classifyMoves(scores, true)
    expect(classified.get('h1d1')?.cls).toBe('good') // keeps the win
    expect(classified.get('h1h8')?.cls).toBe('blunder') // win → draw
    expect(whiteWinProb(r.moves[0].score)).toBe(1) // bar fully white
  })

  it('returns null when the tables do not know the position', () => {
    expect(parseTablebase({ ...KRK, category: 'unknown' }, FEN)).toBeNull()
  })

  it("works from Black's point of view", () => {
    const black = parseTablebase({ ...KRK, category: 'loss', dtm: -20 }, '8/8/4k3/8/8/4K3/8/7R b - - 0 1')!
    expect(black.outcome).toBe('loss')
    // A move after which White (the opponent) "loses" = Black wins → score negative for White.
    expect(black.moves[0].score).toEqual({ mate: -12 })
  })
})

describe('tbLabel', () => {
  it('uses signs in White\'s point of view instead of words', () => {
    expect(tbLabel({ mate: 12 }, 'win')).toBe('+M12')
    expect(tbLabel({ mate: -20 }, 'loss')).toBe('−M20') // Black mates in 20
    expect(tbLabel({ cp: 2000 }, 'win')).toBe('+M?') // distance unknown
    expect(tbLabel({ cp: -2000 }, 'win')).toBe('−M?')
    expect(tbLabel({ cp: 0 }, 'draw')).toBe('Tablas')
    expect(tbLabel({ cp: 0 }, 'draw', true)).toBe('Tablas (50 j.)')
  })

  it('position score: Black to move and winning → negative', () => {
    const tb = { outcome: 'win' as const, mateIn: 20, moves: [] }
    expect(tbLabel(tbPositionScore(tb, '8/8/8/8/8/2k5/1q6/K7 b - - 0 1'), 'win')).toBe('−M20')
    expect(tbLabel(tbPositionScore(tb, '8/8/8/8/8/2K5/1Q6/k7 w - - 0 1'), 'win')).toBe('+M20')
  })
})
