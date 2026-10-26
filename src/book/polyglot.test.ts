import { describe, expect, it } from 'vitest'
import { Chess } from 'chess.js'
import { PolyglotBook, decodeMove, polyglotKey } from './polyglot'

/** FEN after playing `moves` (SAN) from the start. */
const fenAfter = (...moves: string[]) => {
  const c = new Chess()
  for (const m of moves) c.move(m)
  return c.fen()
}

describe('polyglotKey (reference keys from the Polyglot book-format specification)', () => {
  it.each([
    [[], 0x463b96181691fc9cn],
    [['e4'], 0x823c9b50fd114196n],
    [['e4', 'd5'], 0x0756b94461c50fb0n],
    [['e4', 'd5', 'e5'], 0x662fafb965db29d4n],
    [['e4', 'd5', 'e5', 'f5'], 0x22a48b5a8e47ff78n], // en passant possible (exf6)
    [['e4', 'd5', 'e5', 'f5', 'Ke2'], 0x652a607ca3f242c1n],
    [['e4', 'd5', 'e5', 'f5', 'Ke2', 'Kf7'], 0x00fdd303c946bdd9n],
    [['a4', 'b5', 'h4', 'b4', 'c4'], 0x3c8123ea7b067637n], // en passant possible (bxc3)
    [['a4', 'b5', 'h4', 'b4', 'c4', 'bxc3', 'Ra3'], 0x5c3f9b829b279560n],
  ])('%j', (moves, key) => {
    expect(polyglotKey(fenAfter(...(moves as string[])))).toBe(key)
  })
  it('an en passant square without a capturing pawn does not count', () => {
    // After 1. e4 the FEN may carry "e3", but no black pawn can take: same key as without it.
    expect(polyglotKey('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1')).toBe(0x823c9b50fd114196n)
  })
})

describe('decodeMove', () => {
  const enc = (from: string, to: string, promo = 0) =>
    (to.charCodeAt(0) - 97) | (Number(to[1]) - 1) << 3 | (from.charCodeAt(0) - 97) << 6 | (Number(from[1]) - 1) << 9 | promo << 12
  it('plain moves, promotions and castling (king takes own rook → UCI king move)', () => {
    expect(decodeMove(enc('e2', 'e4'), fenAfter())).toBe('e2e4')
    expect(decodeMove(enc('a7', 'a8', 4), '8/P6k/8/8/8/8/8/K7 w - - 0 1')).toBe('a7a8q')
    expect(decodeMove(enc('a7', 'a8', 1), '8/P6k/8/8/8/8/8/K7 w - - 0 1')).toBe('a7a8n')
    expect(decodeMove(enc('e1', 'h1'), 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1')).toBe('e1g1')
    expect(decodeMove(enc('e1', 'a1'), 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1')).toBe('e1c1')
    expect(decodeMove(enc('e8', 'h8'), 'r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1')).toBe('e8g8')
    // A rook (not a king) from e1 to h1 is not castling.
    expect(decodeMove(enc('e1', 'h1'), '4k3/8/8/8/8/8/8/K3R3 w - - 0 1')).toBe('e1h1')
  })
})

describe('PolyglotBook.lookup', () => {
  /** A tiny book: entries [key, move, weight, learn], written as the real file. */
  function book(entries: Array<[bigint, number, number, number]>) {
    const buf = new ArrayBuffer(entries.length * 16)
    const v = new DataView(buf)
    entries.forEach(([k, m, w, l], i) => {
      v.setBigUint64(i * 16, k, false)
      v.setUint16(i * 16 + 8, m, false)
      v.setUint16(i * 16 + 10, w, false)
      v.setUint32(i * 16 + 12, l, false)
    })
    return new PolyglotBook(buf)
  }
  const start = 0x463b96181691fc9cn
  const e2e4 = 4 | 3 << 3 | 4 << 6 | 1 << 9
  const d2d4 = 3 | 3 << 3 | 3 << 6 | 1 << 9
  const b = book([
    [0x1n, e2e4, 1, 1],
    [start, d2d4, 20000, 30],
    [start, e2e4, 45535, 70],
    [0xffffffffffffffffn, e2e4, 1, 1],
  ])
  it('finds the moves of a position, most played first, with games and share', () => {
    expect(b.lookup(fenAfter())).toEqual([
      { uci: 'e2e4', games: 70, share: 0.7 },
      { uci: 'd2d4', games: 30, share: 0.3 },
    ])
  })
  it('a position not in the book → []', () => {
    expect(b.lookup(fenAfter('a3'))).toEqual([])
  })
})
