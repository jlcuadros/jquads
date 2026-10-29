import { describe, expect, it } from 'vitest'
import { formatSan } from './notation'
import { commentText, gamePgn, movetextTokens, parsePgnHeaders, treeFromPgn } from './pgn'
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

describe('PGN headers and import with variations', () => {
  const date = new Date(2026, 9, 25)
  const sample = () => {
    const t = new GameTree()
    ;['e2e4', 'e7e5', 'g1f3', 'b8c6'].forEach((m) => t.play(m))
    t.toStart()
    t.play('e2e4')
    t.play('c7c5') // variation 1... c5
    t.play('g1f3')
    t.play('d7d6')
    t.goTo(t.root.children[0].children[1].children[0]) // after 1. e4 c5 2. Nf3
    t.play('b8c6') // nested variation 2... Nc6
    return t
  }

  it('writes edited headers in roster order, extras after, Result as the end marker', () => {
    const pgn = gamePgn(sample(), date, { White: 'Ousland', Black: 'Rival "R"', Result: '1-0', WhiteElo: '1900', BlackElo: '', FEN: 'ignored' })
    const lines = pgn.split('\n')
    expect(lines.slice(0, 8)).toEqual([
      '[Event "Análisis"]', '[Site "https://jquads.pages.dev"]', '[Date "2026.10.25"]', '[Round "-"]',
      '[White "Ousland"]', '[Black "Rival \\"R\\""]', '[Result "1-0"]', '[WhiteElo "1900"]',
    ])
    expect(pgn).not.toContain('BlackElo') // empty extras are left out
    expect(pgn).not.toContain('ignored') // FEN comes from the tree
    expect(pgn.trim().endsWith('1-0')).toBe(true)
    expect(parsePgnHeaders(pgn)).toMatchObject({ White: 'Ousland', Black: 'Rival "R"', Result: '1-0' })
  })

  it('an invalid result becomes "*"', () => {
    expect(gamePgn(sample(), date, { Result: 'win' })).toContain('[Result "*"]')
  })

  it('round trip keeps every variation (also nested)', () => {
    const pgn = gamePgn(sample(), date)
    expect(pgn).toContain('1. e4 e5 (1... c5 2. Nf3 d6 (2... Nc6)) 2. Nf3 Nc6 *')
    const back = treeFromPgn(pgn)
    expect(back.current).toBe(back.root) // opens at the start
    expect(gamePgn(back, date)).toBe(pgn)
  })

  it('reads Lichess / Chess.com style movetext: clocks, comments, NAGs, "1...", custom FEN', () => {
    const t = treeFromPgn('[FEN "4k3/8/8/8/8/8/8/K3R3 b - - 0 1"]\n\n1... Kd7 {[%clk 0:03:00]} 2.Re2!? $1 ; note\n(2. Ka2 Kc6) 2... Kd6 *')
    // The "; note" comment is kept (2026-10-26); the clock is not. The symbols "!?" and
    // "$1" are kept too since 2026-10-29 (both, as read: a PGN may bring two).
    expect(gamePgn(t, date)).toContain('1... Kd7 2. Re2 $1 $5 {note} (2. Ka2 Kc6) 2... Kd6 *')
  })

  it('throws on an illegal move', () => {
    expect(() => treeFromPgn('1. e5 *')).toThrow(/Illegal/)
  })
})

describe('PGN comments (shown with ✏️, kept on export — 2026-10-26)', () => {
  const date = new Date(2026, 9, 25)
  const pgn = '[Event "x"]\n\n{Una partida de prueba} 1. e4 {[%clk 0:03:00] El peón rey} e5 (1... c5 {La siciliana}) 2. Nf3 *'

  it('reads comments into the moves (and the root), without clock/eval commands', () => {
    const t = treeFromPgn(pgn)
    const e4 = t.root.children[0]
    expect(t.root.comment).toBe('Una partida de prueba')
    expect(e4.comment).toBe('El peón rey')
    expect(e4.children.map((n) => [n.san, n.comment])).toEqual([['e5', undefined], ['c5', 'La siciliana']])
    expect(commentText('[%clk 0:03:00] [%eval 0.3]  ')).toBe('') // only commands → no comment
  })

  it('writes them back, with the numbering a comment requires', () => {
    expect(gamePgn(treeFromPgn(pgn), date)).toContain('{Una partida de prueba} 1. e4 {El peón rey} 1... e5 (1... c5 {La siciliana}) 2. Nf3 *')
  })

  it('round trip keeps moves, variations and comments', () => {
    const once = gamePgn(treeFromPgn(pgn), date)
    expect(gamePgn(treeFromPgn(once), date)).toBe(once)
  })

  it('tokens for the full game view: moves with their nodes, comments, variations', () => {
    const kinds = movetextTokens(treeFromPgn(pgn)).map((tk) => (tk.kind === 'move' ? tk.text : tk.kind === 'comment' ? `{${tk.text}}` : tk.kind))
    expect(kinds).toEqual(['{Una partida de prueba}', '1. e4', '{El peón rey}', '1... e5', 'open', '1... c5', '{La siciliana}', 'close', '2. Nf3'])
  })

  it('"Sobrescribir": clearContinuation drops what followed', () => {
    const t = treeFromPgn(pgn)
    t.goTo(t.root.children[0]) // after 1. e4
    t.clearContinuation()
    t.play('d7d5')
    expect(gamePgn(t, date)).toContain('1. e4 {El peón rey} 1... d5 *')
  })
})

