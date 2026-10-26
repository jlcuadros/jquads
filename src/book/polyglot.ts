/**
 * Polyglot opening book reader (José, iteration 6, 2026-10-26): the app's book
 * is made from Lichess games of players rated 2300+ (rapid and classical),
 * see scripts/book/build_book.py and the task note, Investigation 12.
 *
 * Format: 16-byte entries, big-endian, sorted by position key:
 *   key (u64) · move (u16) · weight (u16) · learn (u32).
 * In our book, learn = number of games that played the move (weight is the
 * same share scaled to 1..65535, for other Polyglot readers).
 *
 * Pure functions + a small class over an ArrayBuffer (binary search).
 */
import { RANDOM64 } from './polyglotRandom'

export interface BookMove {
  uci: string
  games: number // games that played it (learn field; falls back to weight)
  share: number // 0..1 of the position's games
}

// Polyglot piece order: black pawn 0, white pawn 1, black knight 2 … white king 11.
const PIECE_KIND: Record<string, number> = { p: 0, P: 1, n: 2, N: 3, b: 4, B: 5, r: 6, R: 7, q: 8, Q: 9, k: 10, K: 11 }
const CASTLING: Record<string, number> = { K: 768, Q: 769, k: 770, q: 771 }
const EN_PASSANT = 772
const TURN = 780

/** Board of a FEN as [rank 0..7 (rank 1 = 0)][file 0..7] → piece letter or ''. */
function boardOf(placement: string): string[][] {
  const ranks = placement.split('/').reverse() // FEN starts at rank 8
  return ranks.map((r) => {
    const row: string[] = []
    for (const c of r) {
      if (/\d/.test(c)) row.push(...Array<string>(Number(c)).fill(''))
      else row.push(c)
    }
    return row
  })
}

/** Polyglot key of a position (64-bit, as a BigInt). */
export function polyglotKey(fen: string): bigint {
  const [placement, turn, castling, ep] = fen.split(' ')
  const board = boardOf(placement)
  let key = 0n
  board.forEach((row, rank) =>
    row.forEach((piece, file) => {
      if (piece) key ^= RANDOM64[64 * PIECE_KIND[piece] + 8 * rank + file]
    }),
  )
  for (const c of castling === '-' ? '' : castling) key ^= RANDOM64[CASTLING[c]]
  // En passant counts only if a pawn of the side to move can actually capture.
  if (ep && ep !== '-') {
    const file = ep.charCodeAt(0) - 97
    const pawnRank = turn === 'w' ? 4 : 3 // rank 5 / rank 4, 0-based
    const pawn = turn === 'w' ? 'P' : 'p'
    if (board[pawnRank][file - 1] === pawn || board[pawnRank][file + 1] === pawn) key ^= RANDOM64[EN_PASSANT + file]
  }
  if (turn === 'w') key ^= RANDOM64[TURN]
  return key
}

const square = (file: number, rank: number) => String.fromCharCode(97 + file) + (rank + 1)

/**
 * Polyglot move → UCI. Castling is stored as "king takes own rook" (e1h1),
 * which UCI writes as the king's two-square move (e1g1).
 */
export function decodeMove(move: number, fen: string): string {
  const toFile = move & 7
  const toRank = (move >> 3) & 7
  const fromFile = (move >> 6) & 7
  const fromRank = (move >> 9) & 7
  const promo = (move >> 12) & 7
  const from = square(fromFile, fromRank)
  let to = square(toFile, toRank)
  const piece = boardOf(fen.split(' ')[0])[fromRank][fromFile]
  if ((piece === 'K' || piece === 'k') && fromFile === 4 && (toFile === 7 || toFile === 0)) to = square(toFile === 7 ? 6 : 2, toRank)
  return from + to + (promo ? ' nbrq'[promo] : '')
}

const ENTRY = 16

/** An opening book in memory. */
export class PolyglotBook {
  private view: DataView
  private count: number

  constructor(data: ArrayBuffer) {
    this.view = new DataView(data)
    this.count = Math.floor(data.byteLength / ENTRY)
  }

  private keyAt(i: number) {
    return this.view.getBigUint64(i * ENTRY, false)
  }

  /** The book moves of a position, most played first ([] if the position isn't in the book). */
  lookup(fen: string): BookMove[] {
    const key = polyglotKey(fen)
    // First entry with this key (binary search).
    let lo = 0
    let hi = this.count
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (this.keyAt(mid) < key) lo = mid + 1
      else hi = mid
    }
    const found: Array<{ uci: string; games: number }> = []
    for (let i = lo; i < this.count && this.keyAt(i) === key; i++) {
      const move = this.view.getUint16(i * ENTRY + 8, false)
      const weight = this.view.getUint16(i * ENTRY + 10, false)
      const learn = this.view.getUint32(i * ENTRY + 12, false)
      found.push({ uci: decodeMove(move, fen), games: learn || weight })
    }
    const total = found.reduce((s, m) => s + m.games, 0)
    return found.map((m) => ({ ...m, share: total ? m.games / total : 0 })).sort((a, b) => b.games - a.games)
  }
}
