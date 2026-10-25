import { describe, expect, it } from 'vitest'
import { formatSan } from './notation'
import { gamePgn } from './pgn'
import { GameTree } from './tree'

describe('formatSan', () => {
  it('uses outlined figurines for White and filled ones for Black', () => {
    expect(formatSan('Nf3', true, 'figurine')).toBe('♘f3')
    expect(formatSan('Nf6', false, 'figurine')).toBe('♞f6')
    expect(formatSan('Qxe7+', true, 'figurine')).toBe('♕xe7+')
    expect(formatSan('e8=Q#', true, 'figurine')).toBe('e8=♕#')
  })
  it('leaves pawn moves, castling and letters mode untouched', () => {
    expect(formatSan('exd5', true, 'figurine')).toBe('exd5')
    expect(formatSan('O-O-O', false, 'figurine')).toBe('O-O-O')
    expect(formatSan('Nf3', true, 'letters')).toBe('Nf3')
  })
})

describe('gamePgn', () => {
  const date = new Date(2026, 9, 25)

  it('exports the main line with headers', () => {
    const t = new GameTree()
    ;['e2e4', 'e7e5', 'g1f3'].forEach((m) => t.play(m))
    const pgn = gamePgn(t, date)
    expect(pgn).toContain('[Date "2026.10.25"]')
    expect(pgn).not.toContain('[FEN')
    expect(pgn.trim().endsWith('1. e4 e5 2. Nf3 *')).toBe(true)
  })

  it('includes variations in parentheses with correct numbering', () => {
    const t = new GameTree()
    ;['e2e4', 'e7e5', 'g1f3'].forEach((m) => t.play(m))
    t.toStart()
    t.play('e2e4')
    t.play('c7c5') // variation for Black's first move
    const pgn = gamePgn(t, date)
    expect(pgn).toContain('1. e4 e5 (1... c5) 2. Nf3 *')
  })

  it('adds SetUp/FEN when starting from a custom position, and numbers a black first move', () => {
    const t = new GameTree('4k3/8/8/8/8/8/8/K3R3 b - - 0 1')
    t.play('e8d7')
    const pgn = gamePgn(t, date)
    expect(pgn).toContain('[SetUp "1"]')
    expect(pgn).toContain('[FEN "4k3/8/8/8/8/8/8/K3R3 b - - 0 1"]')
    expect(pgn).toContain('1... Kd7 *')
  })
})
