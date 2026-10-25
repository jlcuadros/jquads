import { describe, expect, it } from 'vitest'
import { shownMaiaMoves, SHOWN_MOVES } from './analyzer'

describe('shownMaiaMoves', () => {
  it('keeps moves ≥ 1 % in order, at most SHOWN_MOVES.max (6)', () => {
    const policy = Array.from({ length: 15 }, (_, i) => ({ uci: `m${i}`, prob: 0.2 - i * 0.01 }))
    const shown = shownMaiaMoves(policy)
    expect(shown).toHaveLength(SHOWN_MOVES.max)
    expect(shown[0].uci).toBe('m0')
  })

  it('drops moves under 1 %', () => {
    const shown = shownMaiaMoves([
      { uci: 'a', prob: 0.9 },
      { uci: 'b', prob: 0.01 },
      { uci: 'c', prob: 0.009 },
    ])
    expect(shown.map((p) => p.uci)).toEqual(['a', 'b'])
  })
})
