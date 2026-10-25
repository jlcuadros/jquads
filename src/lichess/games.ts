/**
 * Lichess games of a user (José, 2026-10-25): list newest first, filter by
 * speed and date, open one in the analysis board. Like maiachess.com's
 * "Select game → Lichess", but without login: the user's public games are
 * available from the API with just the username.
 *
 * API: GET https://lichess.org/api/games/user/{username}  (Accept: application/x-ndjson)
 *   - newest first; filters: perfType (speeds, comma separated), since/until
 *     (ms timestamps), max; pgnInJson=true gives the PGN in each JSON line.
 *   - CORS: `access-control-allow-origin: *` (works from our page; checked in
 *     WebKit on 2026-10-25). Anonymous requests stream 20 games/s; Lichess asks
 *     for one request at a time and a minute of pause after HTTP 429.
 */
import { PAGE_SIZE, SPEEDS, fetchOrThrow, serialQueue, type GameSummary, type GamesPage, type GamesQuery, type Speed } from '../games/common'

/** API perfTypes per filter chip ("bullet" also covers ultraBullet). */
const PERF_TYPES: Record<Speed, string[]> = {
  bullet: ['ultraBullet', 'bullet'],
  blitz: ['blitz'],
  rapid: ['rapid'],
  classical: ['classical'],
  correspondence: ['correspondence'],
}

// ---------------------------------------------------------------------------
// Pure helpers (tested in games.test.ts)
// ---------------------------------------------------------------------------

/** URL of the request. Only standard chess (perfType never includes variants). */
export function gamesUrl(q: GamesQuery): string {
  const speeds = q.speeds.length ? q.speeds : SPEEDS
  const params = new URLSearchParams({
    max: String(q.max ?? PAGE_SIZE),
    perfType: speeds.flatMap((s) => PERF_TYPES[s]).join(','),
    pgnInJson: 'true',
    opening: 'true',
    clocks: 'false',
    evals: 'false',
  })
  if (q.since !== undefined) params.set('since', String(q.since))
  if (q.until !== undefined) params.set('until', String(q.until))
  return `https://lichess.org/api/games/user/${encodeURIComponent(q.username.trim())}?${params}`
}

/** One NDJSON line of the API → our summary (null for unusable lines). */
export function parseGameLine(line: string): GameSummary | null {
  if (!line.trim()) return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g: any = JSON.parse(line)
  if (!g.id || !g.pgn || g.variant !== 'standard') return null
  const player = (p: { user?: { name: string }; rating?: number; aiLevel?: number }) => ({
    name: p?.user?.name ?? (p?.aiLevel ? `Stockfish ${p.aiLevel}` : '?'),
    rating: p?.rating,
  })
  return {
    site: 'lichess',
    id: g.id,
    createdAt: g.createdAt,
    speed: g.speed,
    rated: !!g.rated,
    clock: g.clock ? { initial: g.clock.initial, increment: g.clock.increment } : undefined,
    daysPerTurn: g.daysPerTurn,
    status: g.status,
    winner: g.winner,
    opening: g.opening?.name,
    white: player(g.players.white),
    black: player(g.players.black),
    pgn: g.pgn,
  }
}

// ---------------------------------------------------------------------------
// Client: one request at a time
// ---------------------------------------------------------------------------

const queue = serialQueue()

/** Downloads one page of games (newest first). Throws GamesError. */
export function fetchLichessGames(q: GamesQuery): Promise<GamesPage> {
  return queue(async () => {
    const res = await fetchOrThrow(gamesUrl(q), { headers: { Accept: 'application/x-ndjson' } }, q.username)
    const text = await res.text()
    const games = text.split('\n').map(parseGameLine).filter((g): g is GameSummary => g !== null)
    return { games, exhausted: games.length < (q.max ?? PAGE_SIZE) }
  })
}
