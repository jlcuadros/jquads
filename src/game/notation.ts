/**
 * Move notation for display: figurine (♘f3) or letters (Nf3).
 *
 * Figurine is the default (José, iteration 4). The piece symbol takes the
 * colour of the side that moves: outlined for White (♘), filled for Black (♞).
 * Only K Q R B N are replaced (files are lowercase, castling is O-O), which
 * also covers promotions ("e8=Q" → "e8=♕").
 */
export type Notation = 'figurine' | 'letters'

const WHITE: Record<string, string> = { K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘' }
const BLACK: Record<string, string> = { K: '♚', Q: '♛', R: '♜', B: '♝', N: '♞' }

export function formatSan(san: string, whiteMoved: boolean, notation: Notation): string {
  if (notation === 'letters') return san
  const map = whiteMoved ? WHITE : BLACK
  return san.replace(/[KQRBN]/g, (letter) => map[letter])
}
