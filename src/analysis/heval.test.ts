import { describe, expect, it } from 'vitest'
import { Chess } from 'chess.js'
import { hEval, likelyReplies, scoreToCp, HEVAL_DEPTH, MAX_REPLIES, STRONG_ELO, type HevalEngines } from './heval'
import { formatScore } from './classify'

/** FEN after playing UCI moves from `fen`. */
const play = (fen: string, ...ucis: string[]) => {
  const c = new Chess(fen)
  for (const u of ucis) c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] })
  return c.fen()
}
const START = new Chess().fen()

describe('h-eval (José\'s design, 2026-10-28)', () => {
  it('José\'s example: A 54 % → +0.4, B (a trap) 64 % → +1.6 and the 💣', async () => {
    // Candidates A = e2e4, B = d2d4. Black's replies (Maia at the selected Elo) and their 2600 values.
    const replies: Record<string, Array<{ uci: string; prob: number }>> = {
      [play(START, 'e2e4')]: [{ uci: 'e7e5', prob: 0.6 }, { uci: 'c7c5', prob: 0.3 }, { uci: 'a7a6', prob: 0.1 }],
      [play(START, 'd2d4')]: [{ uci: 'g8f6', prob: 0.5 }, { uci: 'd7d5', prob: 0.4 }, { uci: 'a7a6', prob: 0.1 }],
    }
    const value: Record<string, number> = { // White's expected score after the reply (Maia 2600)
      [play(START, 'e2e4', 'e7e5')]: 0.55, [play(START, 'e2e4', 'c7c5')]: 0.52,
      [play(START, 'd2d4', 'g8f6')]: 0.8, [play(START, 'd2d4', 'd7d5')]: 0.45,
    }
    const calls: number[] = []
    const engines: HevalEngines = {
      candidates: async () => ['e2e4', 'd2d4'],
      maia: async (items) => {
        calls.push(items.length)
        return items.map((it) => (it.elo === STRONG_ELO ? { policy: [], whiteWinProb: value[it.fen] } : { policy: replies[it.fen], whiteWinProb: 0.5 }))
      },
    }
    const r = await hEval(START, 1500, 10, engines)
    expect(formatScore(r.scores.get('e2e4')!, 1)).toBe('+0.4') // (0.6×55 + 0.3×52) / 0.9 = 54 %
    expect(formatScore(r.scores.get('d2d4')!, 1)).toBe('+1.6') // (0.5×80 + 0.4×45) / 0.9 = 64.4 %
    expect(r.best).toBe('d2d4')
    expect(calls).toEqual([2, 4]) // two Maia batches: replies, then values
  })

  it('Black to move: positive means good for White, as everywhere', async () => {
    const fen = play(START, 'e2e4')
    const engines: HevalEngines = {
      candidates: async () => ['e7e5'],
      maia: async (items) => items.map((it) => (it.elo === STRONG_ELO ? { policy: [], whiteWinProb: 0.3 } : { policy: [{ uci: 'g1f3', prob: 1 }], whiteWinProb: 0.5 })),
    }
    const r = await hEval(fen, 1500, 5, engines)
    expect(formatScore(r.scores.get('e7e5')!, 1)).toBe('−2.3') // Black scores 70 % → White −2.3
  })

  it('a candidate that mates at once: mate, no Maia needed', async () => {
    const fen = 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4'
    const engines: HevalEngines = { candidates: async () => ['h5f7'], maia: async (items) => items.map(() => ({ policy: [], whiteWinProb: 0.5 })) }
    const r = await hEval(fen, 1500, 5, engines)
    expect(r.scores.get('h5f7')).toEqual({ mate: 1 })
    expect(r.best).toBe('h5f7')
  })

  it('candidates: the moves on screen first, then Stockfish fills up to N', async () => {
    const calls: number[] = []
    const engines: HevalEngines = {
      candidates: async (_f, d, n) => (calls.push(d), ['e2e4', 'd2d4', 'c2c4', 'g1f3'].slice(0, n)),
      maia: async (items) => items.map(() => ({ policy: [{ uci: 'e7e5', prob: 1 }], whiteWinProb: 0.5 })),
    }
    // SF + Maia columns give d2d4, g1f3 (repeated once): filled with e2e4 (d2d4 already in) up to 3.
    let r = await hEval(START, 1500, 3, engines, ['d2d4', 'g1f3', 'd2d4'])
    expect([...r.scores.keys()]).toEqual(['d2d4', 'g1f3', 'e2e4'])
    expect(calls).toEqual([HEVAL_DEPTH])
    // The columns already give N or more: all taken, no Stockfish search.
    r = await hEval(START, 1500, 2, engines, ['d2d4', 'g1f3', 'b1c3'])
    expect([...r.scores.keys()]).toEqual(['d2d4', 'g1f3', 'b1c3'])
    expect(calls).toEqual([HEVAL_DEPTH])
  })

  it('replies: until 90 % or 8 moves; the formula and its limits', () => {
    expect(likelyReplies([{ uci: 'a', prob: 0.5 }, { uci: 'b', prob: 0.45 }, { uci: 'c', prob: 0.05 }]).map((r) => r.uci)).toEqual(['a', 'b'])
    expect(likelyReplies(Array.from({ length: 20 }, (_, i) => ({ uci: `m${i}`, prob: 0.05 })))).toHaveLength(MAX_REPLIES)
    expect(scoreToCp(0.5)).toBe(0)
    expect(scoreToCp(0.6)).toBe(110)
    expect(scoreToCp(1)).toBe(1876) // capped at 99.9 %
  })
})
