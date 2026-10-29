import { describe, expect, it } from 'vitest'
import { nagsText, normalizeNags, toggleNag } from './annotations'
import { gamePgn, treeFromPgn } from './pgn'

describe('✏️ annotations: symbols as NAGs (2026-10-29)', () => {
  it('toggling: one per group for move and position, any number of "other"', () => {
    let nags = toggleNag([], 1) // !
    expect(nags).toEqual([1])
    nags = toggleNag(nags, 2) // ? replaces !
    expect(nags).toEqual([2])
    nags = toggleNag(toggleNag(nags, 16), 14) // ± then ⩲ (replaces ±)
    expect(nags).toEqual([2, 14])
    nags = toggleNag(toggleNag(nags, 146), 36) // N and ↑ together
    expect(nags).toEqual([2, 14, 146, 36])
    expect(toggleNag(nags, 14)).toEqual([2, 146, 36]) // second tap removes it
  })

  it('shown after the move: its own symbol stuck, the rest after a space', () => {
    expect(nagsText([16, 1])).toBe('! ±')
    expect(nagsText([16])).toBe(' ±')
    expect(nagsText([146, 5])).toBe('!? N')
    expect(nagsText(undefined)).toBe('')
    expect(normalizeNags([999, 1, 1])).toEqual([1]) // unknown codes and repeats dropped
  })

  it('PGN: "$n" and suffixes ("e4!?") are read, written back as "$n"', () => {
    const tree = treeFromPgn('1. e4!? $16 e5 2. Nf3 ! $146 {a comment} Nc6 $99 *')
    const [e4] = tree.root.children
    const nf3 = e4.children[0].children[0]
    expect(e4.nags).toEqual([5, 16])
    expect(nf3.nags).toEqual([1, 146])
    expect(nf3.comment).toBe('a comment')
    expect(nf3.children[0].nags).toBeUndefined() // $99: not offered, dropped
    const pgn = gamePgn(tree, new Date(2026, 9, 29))
    expect(pgn).toContain('1. e4 $5 $16 e5 2. Nf3 $1 $146 {a comment} 2... Nc6 *')
    // Round trip: same symbols after reading our own export.
    expect(treeFromPgn(pgn).root.children[0].nags).toEqual([5, 16])
  })

  it('a NAG before the first move or right after "(" / ")" has no move: ignored', () => {
    const tree = treeFromPgn('$1 1. e4 e5 ($2 1... c5 $6) $4 *')
    expect(tree.root.nags).toBeUndefined()
    expect(tree.root.children[0].nags).toBeUndefined() // e4: not the $2 after "("
    expect(tree.root.children[0].children[0].nags).toBeUndefined() // e5: not the $4 after ")"
    const c5 = tree.root.children[0].children[1]
    expect(c5.san).toBe('c5')
    expect(c5.nags).toEqual([6])
  })
})
