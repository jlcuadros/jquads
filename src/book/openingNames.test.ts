import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { LAST_MOVE_LOOKED_UP, moveNumberOf, OpeningNames, OPENINGS_FILE } from './openingNames'
import { positionKey } from './positionKey'
import { gamePgn, treeFromPgn } from '../game/pgn'

// The real list built into public/ (scripts/openings/build-openings.mjs).
const names = new OpeningNames(JSON.parse(readFileSync(`public/${OPENINGS_FILE}`, 'utf8')).openings)
const endOf = (pgn: string) => {
  const tree = treeFromPgn(pgn)
  let n = tree.root
  while (n.children.length) n = n.children[0]
  return { tree, end: n }
}
const DRAGON = '1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 g6'

describe('positionKey', () => {
  it('keeps the en passant square only when a pawn of the side to move can take there', () => {
    // 1. e4: e3 is the en passant square, but no black pawn on d4/f4 → "-"
    expect(positionKey('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1')).toBe('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -')
    // 1. e4 d5 2. e5 f5: white pawn on e5 next to f6 → kept
    expect(positionKey('rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3')).toBe('rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6')
  })
})

describe('opening names (Lichess list)', () => {
  it('names the Dragon, and 1. e4', () => {
    expect(names.at(endOf(DRAGON).end)).toEqual({ eco: 'B70', name: 'Sicilian Defense: Dragon Variation' })
    expect(names.at(endOf('1. e4').end)).toEqual({ eco: 'B00', name: "King's Pawn Game" })
  })

  it('a position reached by another move order (transposition) has the same name', () => {
    const transposed = '1. Nf3 c5 2. e4 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 g6'
    expect(names.at(endOf(transposed).end)?.name).toBe('Sicilian Defense: Dragon Variation')
  })

  it('after the list\'s theory the last name stays; before any move there is none', () => {
    const { tree, end } = endOf(DRAGON + ' 6. a3 a6 7. h3 h6')
    expect(names.exact(end.fen)).toBeUndefined()
    expect(names.at(end)?.name).toBe('Sicilian Defense: Dragon Variation')
    expect(names.at(tree.root)).toBeUndefined()
  })

  it('changeAt: only on the moves where the name changes', () => {
    const { tree } = endOf(DRAGON + ' 6. a3')
    const changes: string[] = []
    for (let n = tree.root.children[0]; n; n = n.children[0]) {
      const c = names.changeAt(n)
      if (c) changes.push(`${n.san}: ${c}`)
    }
    expect(changes[0]).toBe("e4: King's Pawn Game")
    expect(changes.at(-1)).toBe('g6: Sicilian Defense: Dragon Variation')
    expect(changes.some((c) => c.startsWith('a3'))).toBe(false) // no name: no comment
    // Never the same name twice in a row (a name may come back later: the list names 1. e4 c5 2. Nf3 d6
    // "Sicilian Defense: Modern Variations" and, after 3. d4, "Sicilian Defense" again).
    const named = changes.map((c) => c.slice(c.indexOf(': ') + 2))
    expect(named.every((name, i) => i === 0 || name !== named[i - 1])).toBe(true)
  })

  it('no lookup from move 22 on (José, 2026-10-30): the same position with a later move number has no name', () => {
    const fen = endOf(DRAGON).end.fen // "… w KQkq - 0 6": reached by Black's 5th move
    expect(moveNumberOf(fen)).toBe(5)
    expect(moveNumberOf('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1')).toBe(1) // 1. e4
    expect(LAST_MOVE_LOOKED_UP).toBe(21)
    const late = (n: number) => fen.replace(/ 6$/, ` ${n}`)
    expect(names.exact(late(22))?.name).toBe('Sicilian Defense: Dragon Variation') // reached by move 21
    expect(names.exact(late(23))).toBeUndefined() // move 22: not looked up
  })

  it('a long game keeps the last name found before move 22', () => {
    const shuffle = Array.from({ length: 10 }, (_, i) => `${6 + 2 * i}. Kd2 Kd7 ${7 + 2 * i}. Ke1 Ke8`).join(' ') // up to move 25
    const { end } = endOf(DRAGON + ' ' + shuffle)
    expect(moveNumberOf(end.fen)).toBe(25)
    expect(names.at(end)?.name).toBe('Sicilian Defense: Dragon Variation')
  })

  it('PGN: ECO + Opening headers, a comment where it changes, not repeated when exported again', () => {
    const { tree } = endOf(DRAGON)
    const pgn = gamePgn(tree, new Date(2026, 9, 30), names.headers(tree), undefined, (n) => names.changeAt(n))
    expect(pgn).toContain('[ECO "B70"]')
    expect(pgn).toContain('[Opening "Sicilian Defense: Dragon Variation"]')
    expect(pgn).toContain("1. e4 {King's Pawn Game}")
    expect(pgn).toContain('5. Nc3 g6 {Sicilian Defense: Dragon Variation}')
    // Opened again and exported again: the name is now the move's own comment → once.
    const again = treeFromPgn(pgn)
    const pgn2 = gamePgn(again, new Date(2026, 9, 30), names.headers(again), undefined, (n) => names.changeAt(n))
    expect(pgn2.match(/Dragon Variation\}/g)).toHaveLength(1)
  })
})
