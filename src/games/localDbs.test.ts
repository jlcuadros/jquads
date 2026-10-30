import { describe, expect, it } from 'vitest'
import { dbSummaries, gameRef, pgnDateMs, shortName, splitPgnGames } from './localDbs'
import { treeFromPgn } from '../game/pgn'

const G1 = '[Event "Club"]\n[Date "2026.10.25"]\n[White "Ousland"]\n[Black "Rival"]\n[Result "1-0"]\n\n1. e4 e5 (1... c5 {Sicilian}) 2. Nf3 1-0'
const G2 = '[Event "Open"]\n[Date "2025.??.??"]\n[White "A"]\n[Black "B"]\n[Result "1/2-1/2"]\n\n1. d4 d5\n2. c4 1/2-1/2'

describe('📁 Local: PGN files', () => {
  it('splitPgnGames: one PGN per game (BOM, CRLF, blank lines, a tag-only game)', () => {
    const file = `\uFEFF\r\n${G1.replace(/\n/g, '\r\n')}\r\n\r\n\r\n${G2}\n\n[Event "Empty"]\n[Result "*"]\n\n*\n`
    const games = splitPgnGames(file)
    expect(games).toHaveLength(3)
    expect(games[0]).toBe(G1 + '\n')
    expect(games[1]).toBe(G2 + '\n')
    expect(games[2]).toContain('[Event "Empty"]')
    // Each piece reads as a game, variations and comments included.
    expect(treeFromPgn(games[0]).root.children[0].children).toHaveLength(2)
  })

  it('splitPgnGames: nothing for a file without games', () => {
    expect(splitPgnGames('\n\n  \n')).toEqual([])
  })

  it('shortName: no extension, no path, middle characters cut', () => {
    expect(shortName('Najdorf.pgn')).toBe('Najdorf')
    expect(shortName('/Users/me/Partidas/mis.partidas.pgn')).toBe('mis.partidas')
    expect(shortName('C:\\chess\\club.PGN')).toBe('club')
    const long = shortName('repertorio-blancas-italiana-2026.pgn', 18)
    expect(long).toBe('repertori…ana-2026')
    expect(long).toHaveLength(18)
  })

  it('pgnDateMs: full dates only', () => {
    expect(new Date(pgnDateMs('2026.10.25')).toISOString().slice(0, 10)).toBe('2026-10-25')
    expect(pgnDateMs('2025.??.??')).toBe(0)
    expect(pgnDateMs(undefined)).toBe(0)
  })

  it('dbSummaries: rows with the database name and ids that point back to it', () => {
    const rows = dbSummaries({ id: 'ldb-x1', name: 'Club' }, [G1 + '\n', G2 + '\n'])
    expect(rows.map((r) => r.id)).toEqual(['ldb-x1#0', 'ldb-x1#1'])
    expect(rows[0]).toMatchObject({ site: 'local', source: 'Club', winner: 'white', white: { name: 'Ousland' } })
    expect(rows[1].createdAt).toBe(0)
    expect(gameRef(rows[1].id)).toEqual({ dbId: 'ldb-x1', index: 1 })
    expect(gameRef('local-123')).toBeUndefined()
    expect(gameRef(undefined)).toBeUndefined()
  })
})
