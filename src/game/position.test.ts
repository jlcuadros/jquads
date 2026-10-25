import { describe, expect, it } from 'vitest'
import { buildFen, possibleCastling, validatePosition, EMPTY_BOARD } from './position'

const START_BOARD = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR'
const ALL = { K: true, Q: true, k: true, q: true }

describe('possibleCastling / buildFen', () => {
  it('allows all castlings in the start position', () => {
    expect(possibleCastling(START_BOARD)).toEqual(ALL)
    expect(buildFen(START_BOARD, 'w', ALL)).toBe(`${START_BOARD} w KQkq - 0 1`)
  })

  it('drops castlings whose king or rook has moved', () => {
    // White king on f1, black rook missing from h8.
    const board = 'rnbqkbn1/pppppppp/8/8/8/8/PPPPPPPP/RNBQ1KNR'
    expect(possibleCastling(board)).toEqual({ K: false, Q: false, k: false, q: true })
    expect(buildFen(board, 'b', ALL)).toBe(`${board} b q - 0 1`)
  })

  it('writes "-" when no castling is possible or wanted', () => {
    expect(buildFen(START_BOARD, 'w', { K: false, Q: false, k: false, q: false })).toBe(`${START_BOARD} w - - 0 1`)
  })
})

describe('validatePosition', () => {
  it('accepts the start position and a simple ending', () => {
    expect(validatePosition(`${START_BOARD} w KQkq - 0 1`)).toBeNull()
    expect(validatePosition('8/8/4k3/8/8/4K3/4P3/8 w - - 0 1')).toBeNull()
  })

  it('requires exactly one king per side', () => {
    expect(validatePosition(`${EMPTY_BOARD} w - - 0 1`)).toMatch(/rey blanco/)
    expect(validatePosition('8/8/4k3/8/8/4K3/8/K7 w - - 0 1')).toMatch(/rey blanco/)
    expect(validatePosition('8/8/8/8/8/4K3/8/8 w - - 0 1')).toMatch(/rey negro/)
  })

  it('rejects pawns on the first or last rank', () => {
    expect(validatePosition('P7/8/4k3/8/8/4K3/8/8 w - - 0 1')).toMatch(/peones/)
  })

  it('rejects the side not to move being in check', () => {
    // Black king on e8 attacked by the white rook on e1, but it is White's turn.
    expect(validatePosition('4k3/8/8/8/8/8/8/K3R3 w - - 0 1')).toMatch(/rey negro está en jaque/)
    // Same position with Black to move is fine.
    expect(validatePosition('4k3/8/8/8/8/8/8/K3R3 b - - 0 1')).toBeNull()
  })
})
