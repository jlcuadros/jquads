/**
 * The key of a position for the opening names (iteration 11, 2026-10-30): the
 * first four FEN fields (pieces, side to move, castling, en passant), with the
 * en passant square only when a pawn of the side to move stands next to it —
 * as the Lichess opening list does ("epd", en passant only when it matters).
 * Without that, 1. e4 (e3 square) and the same position reached by another
 * order would get different keys.
 *
 * No imports: scripts/openings/build-openings.mjs (Node) uses this same file,
 * so the keys of the list and of the app always match (DRY).
 */
export function positionKey(fen: string): string {
  const [placement, side, castling, ep] = fen.split(' ')
  return `${placement} ${side} ${castling} ${ep !== '-' && epCapturable(placement, side, ep) ? ep : '-'}`
}

/** Is there a pawn of the side to move on a square from which it could take en passant on `ep`? */
function epCapturable(placement: string, side: string, ep: string): boolean {
  const file = ep.charCodeAt(0) - 97
  const pawnRank = side === 'w' ? 5 : 4 // the pawn that just moved two squares stands there
  const pawn = side === 'w' ? 'P' : 'p'
  const row = expandRank(placement.split('/')[8 - pawnRank])
  return row[file - 1] === pawn || row[file + 1] === pawn
}

/** "3p4" → ["", "", "", "p", "", "", "", ""] (one entry per file a…h). */
function expandRank(rank: string): string[] {
  const out: string[] = []
  for (const c of rank) {
    if (c >= '1' && c <= '8') out.push(...Array<string>(Number(c)).fill(''))
    else out.push(c)
  }
  return out
}
