import { describe, expect, it } from 'vitest'
import { classifyMoves } from './classify'
import { describePosition, type Segment } from './describe'

const text = (segs: Segment[]) => segs.map((s) => ('text' in s ? s.text : s.san)).join('')

describe('describePosition', () => {
  it('describes a balanced position with findable good moves and a tempting blunder', () => {
    const classified = classifyMoves(
      new Map([
        ['e2e4', { cp: 30 }],
        ['d2d4', { cp: 28 }],
        ['g2g4', { cp: -150 }],
      ]),
      true,
    )
    const segs = describePosition({
      whiteToMove: true,
      elo: 1500,
      best: { cp: 30 },
      classified,
      policy: [
        { uci: 'e2e4', prob: 0.6 },
        { uci: 'd2d4', prob: 0.25 },
        { uci: 'g2g4', prob: 0.15 },
      ],
      san: (u) => ({ e2e4: 'e4', d2d4: 'd4', g2g4: 'g4' })[u] ?? u,
    })
    const t = text(segs)
    expect(t).toContain('La posición está equilibrada.')
    expect(t).toContain('Las jugadas buenas son e4 y d4')
    expect(t).toContain('sin problema (85 %)')
    expect(t).toContain('Cuidado con g4: la jugaría el 15 % pero es un error grave')
    // Moves are clickable segments with their colour.
    expect(segs.some((s) => 'move' in s && s.move === 'g2g4')).toBe(true)
  })

  it('reports mates and decisive advantages for the right side', () => {
    const base = { whiteToMove: false, elo: 1100, classified: new Map(), policy: [], san: (u: string) => u }
    expect(text(describePosition({ ...base, best: { mate: -2 } }))).toContain('mate en 2 para las negras')
    expect(text(describePosition({ ...base, best: { cp: 450 } }))).toContain('Las blancas tienen una ventaja decisiva (+4.50)')
  })
})
