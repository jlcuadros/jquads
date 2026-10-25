import { beforeEach, describe, expect, it } from 'vitest'
import { dayRange, gamesUrl, parseGameLine, scoreText, timeControlText, userColor, userResult } from './games'
import { isFavorite, listFavorites, toggleFavorite } from './favorites'
import { treeFromPgn } from '../game/pgn'

// Trimmed real NDJSON line from the API (Ousland, 2026-10-20).
const LINE = JSON.stringify({
  id: '1Lf8Wwxl', rated: true, variant: 'standard', speed: 'blitz', createdAt: 1792500000000, status: 'mate', winner: 'black',
  clock: { initial: 180, increment: 2, totalTime: 260 }, opening: { name: 'French Defense: Winawer Variation' },
  players: { white: { user: { name: 'Ousland' }, rating: 1891 }, black: { user: { name: 'AbateFaria' }, rating: 1990 } },
  pgn: '[Event "rated blitz game"]\n\n1. e4 e6 2. d4 d5 3. Nc3 Bb4 0-1',
})

describe('gamesUrl', () => {
  it('builds the query with speeds, dates and PGN in JSON', () => {
    const u = new URL(gamesUrl({ username: ' Ousland ', speeds: ['bullet', 'rapid'], since: 1, until: 2 }))
    expect(u.pathname).toBe('/api/games/user/Ousland')
    expect(u.searchParams.get('perfType')).toBe('ultraBullet,bullet,rapid')
    expect(u.searchParams.get('since')).toBe('1')
    expect(u.searchParams.get('until')).toBe('2')
    expect(u.searchParams.get('pgnInJson')).toBe('true')
    expect(u.searchParams.get('max')).toBe('20')
  })
  it('uses all standard speeds when none is selected', () => {
    expect(new URL(gamesUrl({ username: 'x', speeds: [] })).searchParams.get('perfType')).toBe(
      'ultraBullet,bullet,blitz,rapid,classical,correspondence',
    )
  })
})

describe('parseGameLine and helpers', () => {
  const g = parseGameLine(LINE)!
  it('reads the summary', () => {
    expect(g.white).toEqual({ name: 'Ousland', rating: 1891 })
    expect(g.opening).toBe('French Defense: Winawer Variation')
    expect(timeControlText(g)).toBe('3+2')
    expect(scoreText(g)).toBe('0-1')
  })
  it('computes colour and result for the user (case-insensitive)', () => {
    expect(userColor(g, 'ousland')).toBe('white')
    expect(userResult(g, 'Ousland')).toBe('loss')
    expect(userResult(g, 'AbateFaria')).toBe('win')
    expect(userResult({ ...g, winner: undefined, status: 'draw' }, 'Ousland')).toBe('draw')
  })
  it('skips variants and empty lines', () => {
    expect(parseGameLine('')).toBeNull()
    expect(parseGameLine(JSON.stringify({ ...JSON.parse(LINE), variant: 'chess960' }))).toBeNull()
  })
  it('formats short time controls', () => {
    expect(timeControlText({ ...g, clock: { initial: 15, increment: 0 } })).toBe('¼+0')
    expect(timeControlText({ ...g, clock: undefined, daysPerTurn: 3 })).toBe('3d')
  })
  it('converts a date input into the whole local day', () => {
    const [start, end] = dayRange('2026-10-20')
    expect(new Date(start).getHours()).toBe(0)
    expect(end - start).toBe(86_400_000 - 1)
  })
})

describe('treeFromPgn', () => {
  it('loads the moves as main line and starts at the initial position', () => {
    const t = treeFromPgn(parseGameLine(LINE)!.pgn)
    expect(t.current).toBe(t.root)
    t.toEnd()
    expect(t.pathTo().map((n) => n.san)).toEqual(['e4', 'e6', 'd4', 'd5', 'Nc3', 'Bb4'])
  })
  it('honours a [FEN] header', () => {
    const t = treeFromPgn('[SetUp "1"]\n[FEN "4k3/8/8/8/8/8/8/4K2R w K - 0 1"]\n\n1. O-O Kd7 *')
    expect(t.root.fen).toBe('4k3/8/8/8/8/8/8/4K2R w K - 0 1')
    t.toEnd()
    expect(t.current.san).toBe('Kd7')
  })
})

describe('favourites (localStorage)', () => {
  beforeEach(() => {
    const store: Record<string, string> = {}
    globalThis.localStorage = {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => void (store[k] = v),
    } as unknown as Storage
  })
  it('toggles and lists newest first', () => {
    const g = parseGameLine(LINE)!
    const older = { ...g, id: 'old', createdAt: g.createdAt - 1000 }
    expect(toggleFavorite(older)).toBe(true)
    expect(toggleFavorite(g)).toBe(true)
    expect(isFavorite('1Lf8Wwxl')).toBe(true)
    expect(listFavorites().map((x) => x.id)).toEqual(['1Lf8Wwxl', 'old'])
    expect(toggleFavorite(g)).toBe(false)
    expect(listFavorites().map((x) => x.id)).toEqual(['old'])
  })
})
