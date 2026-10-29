import { describe, expect, it } from 'vitest'
import { autoNags, evalNag, type AutoInput } from './autoSymbols'
import type { PositionAnalysis, SideAnalysis } from './analyzer'
import type { ClassifiedMove, Score } from './classify'
import { displayNags } from '../game/annotations'

/** A finished analysis: best line `best` (white's view), moves with their loss, Maia's policy. */
function side(best: Score, moves: Array<[string, number, Score?]> = [], policy: Array<[string, number]> = []): SideAnalysis {
  const classified = new Map<string, ClassifiedMove>(
    moves.map(([uci, loss, score]) => [uci, { uci, loss, score: score ?? best, cls: loss >= 0.1 ? 'blunder' : loss >= 0.05 ? 'ok' : 'good', color: '' }]),
  )
  return {
    fen: '',
    lines: [{ multipv: 1, depth: 14, scoreCp: best.cp, mate: best.mate, pv: [moves[0]?.[0] ?? 'a2a3'] }],
    depth: 14,
    classified,
    maia: { policy: policy.map(([uci, prob]) => ({ uci, prob })), whiteWinProb: 0.5 },
    done: true,
  }
}
const pos = (main: SideAnalysis, threats?: SideAnalysis | null): PositionAnalysis => ({ main, threats })
/** White plays `uci` from a position analysed as `before`; `after` = the resulting position. */
const auto = (before: SideAnalysis, after: SideAnalysis | undefined, extra: Partial<AutoInput> = {}) =>
  autoNags({ uci: 'e2e4', whiteMoved: true, before: pos(before), after: after && pos(after), leftBook: false, ...extra })

describe('automatic symbols (iteration 7, José 2026-10-29)', () => {
  it('position scale "B": = ≤ 0.35, ⩲ ≤ 0.90, ± ≤ 2.00, +− beyond or mate', () => {
    expect([35, 36, 90, 91, 200, 201].map((cp) => evalNag({ cp }))).toEqual([10, 14, 14, 16, 16, 18])
    expect([-36, -91, -201].map((cp) => evalNag({ cp }))).toEqual([15, 17, 19])
    expect(evalNag({ mate: -3 })).toBe(19)
  })

  it('errors: ?! 5–10 points, ? 10–15, ?? ≥ 15 (Lichess)', () => {
    const at = (loss: number) => auto(side({ cp: 30 }, [['d2d4', 0], ['e2e4', loss]]), undefined)
    expect([0.04, 0.06, 0.12, 0.2].map(at)).toEqual([[], [6], [2], [4]])
  })

  it("mates, Lichess's rules: allowing one is ?? unless already lost", () => {
    const allow = (beforeCp: number) => auto(side({ cp: beforeCp }, [['d2d4', 0], ['e2e4', 0.3, { mate: -2 }]]), undefined)
    expect([100, -800, -1200].map(allow)).toEqual([[4], [2], [6]])
    // Letting a mate slip: ?? unless still clearly winning.
    const slip = (afterCp: number) => auto(side({ mate: 3 }, [['d2d4', 0, { mate: 3 }], ['e2e4', 0.01, { cp: afterCp }]]), undefined)
    expect([300, 800, 1200].map(slip)).toEqual([[4], [2], [6]])
  })

  it('□ only move, ! hard and good, !! both, !? a trap', () => {
    // e4 best, the rest lose ≥ 10 → □ (Maia finds it easily: 60 %).
    const only = side({ cp: 50 }, [['e2e4', 0], ['d2d4', 0.12], ['g1f3', 0.2]], [['e2e4', 0.6]])
    expect(auto(only, undefined)).toEqual([7])
    // Same, Maia 3 % → !!
    expect(auto(side({ cp: 50 }, [['e2e4', 0], ['d2d4', 0.12]], [['e2e4', 0.03]]), undefined)).toEqual([3])
    // Best, second loses 6 (not an only move), Maia 8 % → !
    expect(auto(side({ cp: 50 }, [['e2e4', 0], ['d2d4', 0.06]], [['e2e4', 0.08]]), undefined)).toEqual([1])
    // Loses 3, and Black's likeliest reply (e7e5) loses 12 there → !?
    const after = side({ cp: 40 }, [['c7c5', 0], ['e7e5', 0.12]], [['e7e5', 0.5], ['c7c5', 0.3]])
    expect(auto(side({ cp: 50 }, [['d2d4', 0], ['e2e4', 0.03]], [['e2e4', 0.4]]), after)).toEqual([5])
  })

  it('position symbol only when it changes; with N when leaving the book', () => {
    const before = side({ cp: 20 }, [['e2e4', 0]], [['e2e4', 0.5]])
    expect(auto(before, side({ cp: 30 }))).toEqual([]) // = → =
    expect(auto(before, side({ cp: 60 }))).toEqual([14]) // = → ⩲
    expect(auto(before, side({ cp: 30 }), { leftBook: true })).toEqual([10, 146]) // N always with its evaluation
  })

  it('⨀ zugzwang from the threats (the turn passed), only when computed', () => {
    const before = side({ cp: 300 }, [['e2e4', 0]], [['e2e4', 0.5]])
    const after = side({ cp: 300 }) // Black to move: +3.00
    const passing = side({ cp: 0 }) // if Black could pass: 0.00 → much better for Black
    const z = (threats?: SideAnalysis | null) => autoNags({ uci: 'e2e4', whiteMoved: true, before: pos(before), after: pos(after, threats), leftBook: false })
    expect(z(passing)).toEqual([22])
    expect(z(side({ cp: 400 }))).toEqual([]) // passing is worse: no zugzwang
    expect(z(undefined)).toEqual([]) // threats not computed
    expect(z(null)).toEqual([]) // in check: no pass
  })

  it('without the analyses: nothing', () => {
    expect(autoNags({ uci: 'e2e4', whiteMoved: true, leftBook: false })).toEqual([])
  })

  it('yours replace the automatic ones of the same group; "other" keeps both', () => {
    expect(displayNags([1], [2, 16, 146])).toEqual([
      { code: 1, auto: false },
      { code: 16, auto: true },
      { code: 146, auto: true },
    ])
    expect(displayNags([14, 22], [16, 146]).map((d) => d.code)).toEqual([14, 146, 22])
  })
})
