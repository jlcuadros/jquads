import { beforeEach, describe, expect, it } from 'vitest'
import { FAVORITES_PGN_KEY, favoritesPgn, isFavorite, listFavorites, saveFavorite, toggleFavorite } from './favorites'
import { summaryFromPgn, type GameSummary } from './common'
import { ownerName } from '../ui/gamesPanel'
import { treeFromPgn } from '../game/pgn'

const store: Record<string, string> = {}
beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k]
  globalThis.localStorage = {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => void (store[k] = v),
  } as unknown as Storage
})

const SAVED = '[Event "Club"]\n[Site "Madrid"]\n[Date "2026.10.25"]\n[Round "3"]\n[White "Ousland"]\n[Black "Rival"]\n[Result "1-0"]\n[WhiteElo "1900"]\n\n1. e4 e5 (1... c5) 2. Nf3 1-0\n'
const lichessGame = (): GameSummary => ({
  site: 'lichess', id: 'abc', createdAt: 1000, speed: 'blitz', rated: true, status: 'mate', winner: 'black',
  white: { name: 'Someone' }, black: { name: 'Ousland' }, pgn: '[Event "rated blitz"]\n[Result "0-1"]\n\n1. f3 e5 2. g4 Qh4# 0-1\n\n\n',
})

describe('saved games (📂 → Guardar)', () => {
  it('summaryFromPgn takes players, Elo, result and event from the headers', () => {
    const g = summaryFromPgn(SAVED, 'local-1', 5000)
    expect(g).toMatchObject({ site: 'local', id: 'local-1', createdAt: 5000, winner: 'white', opening: 'Club', white: { name: 'Ousland', rating: 1900 }, black: { name: 'Rival', rating: undefined } })
    expect(summaryFromPgn(SAVED.replace('"1-0"', '"*"'), 'x', 1).status).toBe('started')
  })

  it('saveFavorite adds, and replaces the same id (editing a saved game again)', () => {
    saveFavorite(summaryFromPgn(SAVED, 'local-1', 5000))
    saveFavorite(summaryFromPgn(SAVED.replace('Rival', 'Otro'), 'local-1', 6000))
    expect(listFavorites()).toHaveLength(1)
    expect(listFavorites()[0].black.name).toBe('Otro')
    expect(isFavorite('local-1')).toBe(true)
  })

  it('keeps all the favourites as one PGN file, newest first, rewritten on every change', () => {
    toggleFavorite(lichessGame())
    saveFavorite(summaryFromPgn(SAVED, 'local-1', 5000))
    const pgn = favoritesPgn()
    expect(store[FAVORITES_PGN_KEY]).toBe(pgn)
    expect(pgn.indexOf('[Event "Club"]')).toBeLessThan(pgn.indexOf('[Event "rated blitz"]')) // newest first
    expect(pgn).toContain('2. Nf3 1-0\n\n[Event "rated blitz"]') // one blank line between games
    expect(pgn.endsWith('Qh4# 0-1\n')).toBe(true)
    toggleFavorite(lichessGame()) // removed → the file follows
    expect(store[FAVORITES_PGN_KEY]).not.toContain('rated blitz')
  })

  it('a saved game reopens with its variations', () => {
    const tree = treeFromPgn(SAVED)
    expect(tree.root.children[0].children.map((n) => n.san)).toEqual(['e5', 'c5'])
  })

  it('ownerName: the site user, or for saved games whichever username plays in it', () => {
    const users = { lichess: 'ousland', chesscom: 'otheruser' }
    expect(ownerName(lichessGame(), (s) => users[s])).toBe('ousland')
    expect(ownerName(summaryFromPgn(SAVED, 'l', 1), (s) => users[s])).toBe('ousland')
    expect(ownerName(summaryFromPgn(SAVED.replace(/Ousland/g, 'Nobody'), 'l', 1), (s) => users[s])).toBe('')
  })
})
