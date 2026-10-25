import { describe, expect, it } from 'vitest'
import { GameTree, nullMoveFen, START_FEN } from './tree'

describe('GameTree', () => {
  it('plays legal moves and rejects illegal ones', () => {
    const t = new GameTree()
    expect(t.play('e2e4')?.san).toBe('e4')
    expect(t.play('e2e4')).toBeNull() // no pawn on e2 any more
    expect(t.current.san).toBe('e4')
  })

  it('reuses an existing move instead of duplicating it', () => {
    const t = new GameTree()
    t.play('e2e4')
    t.back()
    t.play('e2e4')
    expect(t.root.children).toHaveLength(1)
  })

  it('creates variations and keeps the main line', () => {
    const t = new GameTree()
    t.play('e2e4')
    t.play('e7e5')
    t.back()
    t.play('c7c5') // variation: Sicilian
    expect(t.root.children[0].children.map((c) => c.san)).toEqual(['e5', 'c5'])
    // Display line follows the variation we are in.
    expect(t.displayLine().map((n) => n.san)).toEqual(['e4', 'c5'])
    // Going back to e4 shows the main continuation again.
    t.back()
    expect(t.displayLine().map((n) => n.san)).toEqual(['e4', 'e5'])
  })

  it('navigates start / end / forward', () => {
    const t = new GameTree()
    ;['e2e4', 'e7e5', 'g1f3'].forEach((m) => t.play(m))
    t.toStart()
    expect(t.current).toBe(t.root)
    t.forward()
    expect(t.current.san).toBe('e4')
    t.toEnd()
    expect(t.current.san).toBe('Nf3')
  })

  it('numbers moves, also when starting with black to move', () => {
    const t = new GameTree()
    const e4 = t.play('e2e4')!
    const e5 = t.play('e7e5')!
    expect(t.moveNumber(e4)).toEqual({ number: 1, whiteMove: true })
    expect(t.moveNumber(e5)).toEqual({ number: 1, whiteMove: false })

    const fromBlack = new GameTree('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1')
    const c5 = fromBlack.play('c7c5')!
    const nf3 = fromBlack.play('g1f3')!
    expect(fromBlack.moveNumber(c5)).toEqual({ number: 1, whiteMove: false })
    expect(fromBlack.moveNumber(nf3)).toEqual({ number: 2, whiteMove: true })
  })
})

describe('nullMoveFen', () => {
  it('swaps the side to move and clears en passant', () => {
    expect(nullMoveFen('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1')).toBe(
      'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 1',
    )
    expect(nullMoveFen(START_FEN)?.split(' ')[1]).toBe('b')
  })

  it('returns null when the side to move is in check', () => {
    // Black king on e8 in check from the white queen on e2... after 1.e4 f5 2.Qh5+
    expect(nullMoveFen('rnbqkbnr/ppppp1pp/8/5p1Q/4P3/8/PPPP1PPP/RNB1KBNR b KQkq - 1 2')).toBeNull()
  })
})
