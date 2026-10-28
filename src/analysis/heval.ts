/**
 * h-eval — "human evaluation" of the candidate moves (José's design, 2026-10-28):
 * how much a move is worth in practice against an opponent of the selected Elo,
 * counting on how they are likely to answer.
 *
 *   1. Candidates (José, 2026-10-28): every move shown in the SF column and in
 *      the Maia column, then filled up to N (⚙, default 10) with Stockfish's
 *      best moves at depth 7 (HEVAL_DEPTH). If the two columns already give N
 *      or more, they are all taken and the depth-7 search is skipped.
 *   2. For each candidate, the opponent's replies according to Maia at the
 *      selected Elo, most likely first, until they cover ≥ 90 % (at most 8).
 *   3. Each reply's position is valued by Maia at 2600 (expected score for
 *      the side that played the candidate: win + ½ draw).
 *   4. h-eval = the replies' values averaged with their probabilities
 *      (normalised over the replies taken), shown like Stockfish's evaluation
 *      (+1.6) with the Lichess formula reversed: cp = ln(p / (1 − p)) / 0.00368208.
 *   Mates and draws on the board are scored exactly, without asking Maia.
 *
 * Example (José's): A (SF +0.50) → replies 60 % / 30 % worth 55 % / 52 % →
 * 54 % → +0.4; B, a trap (SF +0.30) → 50 % fall in it (80 %), 40 % don't (45 %)
 * → 64 % → +1.6. B is the better practical choice; it gets the 💣.
 *
 * Pure: the engines are passed in, so it is tested without them.
 */
import { Chess } from 'chess.js'
import type { Score } from './classify'

export const HEVAL_DEPTH = 7 // was 6, then 10 was tried (≈ +0.7 s per position); José chose 7
export const REPLY_COVERAGE = 0.9
export const MAX_REPLIES = 8
export const STRONG_ELO = 2600
/** Lichess's coefficient (classify.ts → whiteWinProb), used in reverse. */
const K = 0.00368208

export interface HevalEngines {
  /** Stockfish: the `n` best moves of `fen` at `depth` (UCI, best first). */
  candidates(fen: string, depth: number, n: number): Promise<string[]>
  /** Maia: for each item, the move probabilities and White's expected score. */
  maia(items: Array<{ fen: string; elo: number }>): Promise<Array<{ policy: Array<{ uci: string; prob: number }>; whiteWinProb: number }>>
}

export interface HevalResult {
  /** h-eval of each candidate, White's point of view like Stockfish's (mate in 1 = { mate: ±1 }). */
  scores: Map<string, Score>
  /** The candidate with the best h-eval for the side to move (it gets the 💣). */
  best?: string
}

/** Expected score (0..1) → evaluation in centipawns, the Lichess formula reversed. */
export function scoreToCp(p: number): number {
  const q = Math.min(0.999, Math.max(0.001, p)) // 0 and 1 have no finite value
  return Math.round(Math.log(q / (1 - q)) / K)
}

/** Position after `uci`, and its exact result if the game is over there (1 / 0 / ½ for `moverWhite`). */
function after(fen: string, uci: string, moverWhite: boolean): { fen: string; exact?: number } {
  const c = new Chess(fen)
  c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] })
  if (c.isCheckmate()) return { fen: c.fen(), exact: (c.turn() === 'w') === moverWhite ? 0 : 1 }
  if (c.isDraw() || c.isStalemate()) return { fen: c.fen(), exact: 0.5 }
  return { fen: c.fen() }
}

/** The replies to take: most likely first until `REPLY_COVERAGE`, at most `MAX_REPLIES`. */
export function likelyReplies(policy: Array<{ uci: string; prob: number }>): Array<{ uci: string; prob: number }> {
  const taken: Array<{ uci: string; prob: number }> = []
  let covered = 0
  for (const p of [...policy].sort((a, b) => b.prob - a.prob)) {
    // (1e-9: 0.6 + 0.3 is 0.8999… in floating point and must count as 90 %)
    if (covered >= REPLY_COVERAGE - 1e-9 || taken.length >= MAX_REPLIES) break
    taken.push(p)
    covered += p.prob
  }
  return taken
}

/** `shown`: the moves on screen (SF and Maia columns), always candidates; Stockfish fills up to `n`. */
export async function hEval(fen: string, elo: number, n: number, engines: HevalEngines, shown: string[] = []): Promise<HevalResult> {
  const moverWhite = fen.split(' ')[1] === 'w'
  const cands = [...new Set(shown)]
  if (cands.length < n) {
    for (const m of await engines.candidates(fen, HEVAL_DEPTH, n)) {
      if (cands.length >= n) break
      if (!cands.includes(m)) cands.push(m)
    }
  }
  const expected = new Map<string, number>() // candidate → expected score for the mover (0..1)

  // Step 2: Maia (selected Elo) on the positions after each candidate.
  const afterCand = cands.map((m) => ({ m, ...after(fen, m, moverWhite) }))
  for (const a of afterCand) if (a.exact !== undefined) expected.set(a.m, a.exact)
  const open = afterCand.filter((a) => a.exact === undefined)
  const replyPolicies = await engines.maia(open.map((a) => ({ fen: a.fen, elo })))

  // Step 3: Maia 2600 on the positions after each likely reply (one batch).
  const items: Array<{ cand: string; prob: number; fen: string; exact?: number }> = []
  open.forEach((a, i) => {
    for (const r of likelyReplies(replyPolicies[i].policy)) items.push({ cand: a.m, prob: r.prob, ...after(a.fen, r.uci, moverWhite) })
  })
  const toValue = items.filter((it) => it.exact === undefined)
  const values = await engines.maia(toValue.map((it) => ({ fen: it.fen, elo: STRONG_ELO })))
  toValue.forEach((it, i) => (it.exact = moverWhite ? values[i].whiteWinProb : 1 - values[i].whiteWinProb))

  // Step 4: weighted mean per candidate.
  for (const a of open) {
    const mine = items.filter((it) => it.cand === a.m)
    const mass = mine.reduce((s, it) => s + it.prob, 0)
    if (mass > 0) expected.set(a.m, mine.reduce((s, it) => s + it.prob * it.exact!, 0) / mass)
  }

  const scores = new Map<string, Score>()
  let best: string | undefined
  for (const m of cands) {
    const p = expected.get(m)
    if (p === undefined) continue
    const mate = p === 1 && afterCand.find((a) => a.m === m)?.exact === 1 // mates at once
    const sign = moverWhite ? 1 : -1
    scores.set(m, mate ? { mate: sign } : { cp: sign * scoreToCp(p) })
    if (best === undefined || p > expected.get(best)!) best = m
  }
  return { scores, best }
}
