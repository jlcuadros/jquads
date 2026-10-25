/**
 * Position editor logic (pure functions): builds a full FEN from the edited
 * board + options, works out which castlings are possible, and validates the
 * result before it is analysed. The UI is in ui/editor.ts.
 */
import { Chess } from 'chess.js'
import { t } from '../i18n/i18n'

export type Turn = 'w' | 'b'
export type CastlingRights = { K: boolean; Q: boolean; k: boolean; q: boolean }

export const EMPTY_BOARD = '8/8/8/8/8/8/8/8'

/** Board part of a FEN → map square ("e1") → piece letter ("K"). */
function boardSquares(board: string): Map<string, string> {
  const squares = new Map<string, string>()
  board.split('/').forEach((row, r) => {
    let file = 0
    for (const ch of row) {
      const empty = Number(ch)
      if (empty) {
        file += empty
      } else {
        squares.set(String.fromCharCode(97 + file) + (8 - r), ch)
        file += 1
      }
    }
  })
  return squares
}

/**
 * Castlings that are geometrically possible: king on its original square and
 * the rook in its corner (K = white short, Q = white long, k/q = black).
 */
export function possibleCastling(board: string): CastlingRights {
  const sq = boardSquares(board)
  const whiteKing = sq.get('e1') === 'K'
  const blackKing = sq.get('e8') === 'k'
  return {
    K: whiteKing && sq.get('h1') === 'R',
    Q: whiteKing && sq.get('a1') === 'R',
    k: blackKing && sq.get('h8') === 'r',
    q: blackKing && sq.get('a8') === 'r',
  }
}

/**
 * Full FEN from the editor state. Requested castlings that are not possible
 * are dropped; no en passant; move counters reset (0 1).
 */
export function buildFen(board: string, turn: Turn, wanted: CastlingRights): string {
  const possible = possibleCastling(board)
  const castling = (['K', 'Q', 'k', 'q'] as const).filter((c) => wanted[c] && possible[c]).join('') || '-'
  return `${board} ${turn} ${castling} - 0 1`
}

/**
 * Checks that the edited position can be analysed. Returns an error message
 * in the selected language (shown to the user) or null if the position is valid.
 */
export function validatePosition(fen: string): string | null {
  const [board, turn] = fen.split(' ')
  const pieces = [...boardSquares(board)]
  const count = (p: string) => pieces.filter(([, piece]) => piece === p).length

  if (count('K') !== 1) return t('ed.err.whiteKing')
  if (count('k') !== 1) return t('ed.err.blackKing')
  if (pieces.some(([sq, p]) => (p === 'P' || p === 'p') && (sq[1] === '1' || sq[1] === '8'))) {
    return t('ed.err.pawnRank')
  }
  if (count('P') > 8 || count('p') > 8) return t('ed.err.pawnCount')

  // The side that is NOT to move cannot be in check (it would be capturable).
  const other = turn === 'w' ? 'b' : 'w'
  try {
    if (new Chess(`${board} ${other} - - 0 1`).inCheck()) {
      return t(turn === 'w' ? 'ed.err.blackInCheck' : 'ed.err.whiteInCheck')
    }
    new Chess(fen) // final check by chess.js (throws on anything else invalid)
  } catch (e) {
    return t('ed.err.invalid', { detail: e instanceof Error ? e.message : String(e) })
  }
  return null
}
