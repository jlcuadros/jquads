import { afterEach, describe, expect, it, vi } from 'vitest'
import { MAX_MONTHS_PER_PAGE, fetchChessComGames, matchesQuery, monthRange, openingFromEcoUrl, parseChessComGame } from './games'
import { GamesError, timeControlText, userColor, userResult } from '../games/common'
import { treeFromPgn } from '../game/pgn'

// Trimmed real game from the API (Ousland, 2026-09).
const GAME = {
  url: 'https://www.chess.com/game/live/174482090618',
  pgn: '[Event "Live Chess"]\n[Site "Chess.com"]\n[White "PHD87"]\n[Black "Ousland"]\n[Result "1-0"]\n\n1. Nf3 {[%clk 0:03:01.9]} 1... f5 {[%clk 0:03:00.3]} 2. g3 {[%clk 0:03:03]} 1-0',
  time_control: '180+2', end_time: 1789416723, rated: true, time_class: 'blitz', rules: 'chess',
  eco: 'https://www.chess.com/openings/Reti-Opening-Dutch-Variation...7.Nc3-c6-8.Re1-Na6',
  white: { username: 'PHD87', rating: 1571, result: 'win' },
  black: { username: 'Ousland', rating: 1520, result: 'resigned' },
}

describe('parseChessComGame', () => {
  it('converts a game to our summary', () => {
    const g = parseChessComGame(GAME)!
    expect(g.site).toBe('chesscom')
    expect(g.id).toBe('cc-live-174482090618')
    expect(g.createdAt).toBe(1789416723000)
    expect(g.speed).toBe('blitz')
    expect(timeControlText(g)).toBe('3+2')
    expect(g.winner).toBe('white')
    expect(g.status).toBe('resigned')
    expect(g.opening).toBe('Reti Opening Dutch Variation')
    expect(userColor(g, 'ousland')).toBe('black')
    expect(userResult(g, 'Ousland')).toBe('loss')
  })
  it('daily = correspondence, draws, no increment, variants', () => {
    const daily = parseChessComGame({ ...GAME, time_class: 'daily', time_control: '1/259200', url: 'https://www.chess.com/game/daily/9' })!
    expect(daily.speed).toBe('correspondence')
    expect(timeControlText(daily)).toBe('3d')
    expect(daily.id).toBe('cc-daily-9')
    const draw = parseChessComGame({ ...GAME, time_control: '600', white: { ...GAME.white, result: 'repetition' }, black: { ...GAME.black, result: 'repetition' } })!
    expect(draw.winner).toBeUndefined()
    expect(draw.status).toBe('draw')
    expect(timeControlText(draw)).toBe('10+0')
    expect(parseChessComGame({ ...GAME, rules: 'chess960' })).toBeNull()
  })
  it('the PGN with clock comments opens as a game', () => {
    const tree = treeFromPgn(GAME.pgn)
    expect(tree).toBeTruthy()
  })
})

describe('helpers', () => {
  it('monthRange (UTC)', () => {
    expect(monthRange('https://api.chess.com/pub/player/x/games/2026/09')).toEqual([Date.UTC(2026, 8, 1), Date.UTC(2026, 9, 1) - 1])
  })
  it('openingFromEcoUrl', () => {
    expect(openingFromEcoUrl('https://www.chess.com/openings/Sicilian-Defense-Kan-Modern-Variation...9.Nc3')).toBe('Sicilian Defense Kan Modern Variation')
    expect(openingFromEcoUrl('https://www.chess.com/openings/Queens-Pawn-Opening-2.Nf3')).toBe('Queens Pawn Opening')
    expect(openingFromEcoUrl(undefined)).toBeUndefined()
  })
  it('matchesQuery ignores "classical" (Chess.com has none)', () => {
    const g = parseChessComGame(GAME)!
    expect(matchesQuery(g, { username: 'x', speeds: ['blitz'] })).toBe(true)
    expect(matchesQuery(g, { username: 'x', speeds: ['rapid'] })).toBe(false)
    expect(matchesQuery(g, { username: 'x', speeds: ['classical'] })).toBe(true)
    expect(matchesQuery(g, { username: 'x', speeds: [], since: g.createdAt + 1 })).toBe(false)
  })
})

describe('fetchChessComGames (mocked API)', () => {
  // Fake archives: one game per day in each month, `perMonth` games.
  const months = ['2026/02', '2026/03', '2026/04', '2026/05', '2026/06', '2026/07', '2026/08', '2026/09']
  // Each test uses its own user: past months stay cached for the session.
  function mockApi(perMonth: Record<string, number>, user: string) {
    const base = `https://api.chess.com/pub/player/${user}/games`
    const calls: string[] = []
    vi.stubGlobal('fetch', async (url: string) => {
      calls.push(url)
      if (!url.includes(`/player/${user}/`)) return new Response('', { status: 404 })
      if (url.endsWith('/archives')) return Response.json({ archives: months.map((m) => `${base}/${m}`) })
      const m = url.split('/games/')[1]
      const [y, mo] = m.split('/').map(Number)
      const games = Array.from({ length: perMonth[m] ?? 0 }, (_, i) => ({
        ...GAME, url: `https://www.chess.com/game/live/${y}${mo}${i}`, end_time: Date.UTC(y, mo - 1, i + 1) / 1000,
      }))
      return Response.json({ games }) // oldest first, like the API
    })
    return calls
  }
  afterEach(() => vi.unstubAllGlobals())

  it('newest first, across months, page by page with "until"', async () => {
    mockApi({ '2026/09': 14, '2026/08': 28, '2026/07': 5 }, 'ousland')
    const p1 = await fetchChessComGames({ username: 'Ousland', speeds: [], max: 20 })
    expect(p1.games).toHaveLength(20)
    expect(p1.exhausted).toBe(false)
    const times = p1.games.map((g) => g.createdAt)
    expect(times).toEqual([...times].sort((a, b) => b - a))
    expect(new Date(p1.games[0].createdAt).getUTCMonth()).toBe(8) // September first
    const p2 = await fetchChessComGames({ username: 'Ousland', speeds: [], max: 20, until: p1.games[19].createdAt - 1 })
    const p3 = await fetchChessComGames({ username: 'Ousland', speeds: [], max: 20, until: p2.games[19].createdAt - 1 })
    expect(p2.games).toHaveLength(20)
    expect(p3.games).toHaveLength(7) // 14 + 28 + 5 = 47
    expect(p3.exhausted).toBe(true)
    expect(new Set([...p1.games, ...p2.games, ...p3.games].map((g) => g.id)).size).toBe(47)
  })
  it('stops after MAX_MONTHS_PER_PAGE downloads when the filter finds nothing', async () => {
    const calls = mockApi({ '2026/09': 3, '2026/08': 3, '2026/07': 3, '2026/06': 3, '2026/05': 3 }, 'capped')
    const max = (n: number) => fetchChessComGames({ username: 'capped', speeds: ['rapid'], max: 20, until: Date.UTC(2026, 9, 1) + n })
    const p = await max(0)
    expect(MAX_MONTHS_PER_PAGE).toBeLessThan(months.length) // so the cap is actually tested
    expect(calls.filter((u) => !u.endsWith('/archives'))).toHaveLength(MAX_MONTHS_PER_PAGE)
    expect(p).toEqual({ games: [], exhausted: false }) // "Load more" stays available
    const next = await max(1) // cached months are free: it goes on with the rest
    expect(next.exhausted).toBe(true)
    expect(calls.filter((u) => !u.endsWith('/archives'))).toHaveLength(months.length)
  })
  it('skips months outside the dates without downloading them', async () => {
    const calls = mockApi({ '2026/09': 3, '2026/08': 3, '2026/07': 3 }, 'other')
    const p = await fetchChessComGames({ username: 'other', speeds: [], max: 20, since: Date.UTC(2026, 7, 1), until: Date.UTC(2026, 7, 31) })
    expect(p.games.every((g) => new Date(g.createdAt).getUTCMonth() === 7)).toBe(true)
    expect(calls.filter((u) => u.includes('/games/2026/')).map((u) => u.slice(-7))).toEqual(['2026/08'])
  })
  it('unknown user → GamesError notFound', async () => {
    mockApi({}, 'someone')
    await expect(fetchChessComGames({ username: 'nobody-xq', speeds: [] })).rejects.toMatchObject({ kind: 'notFound' })
    expect(GamesError).toBeTruthy()
  })
})
