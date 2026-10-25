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

export type Speed = 'bullet' | 'blitz' | 'rapid' | 'classical' | 'correspondence'
export const SPEEDS: Speed[] = ['bullet', 'blitz', 'rapid', 'classical', 'correspondence']

/** API perfTypes per filter chip ("bullet" also covers ultraBullet). */
const PERF_TYPES: Record<Speed, string[]> = {
  bullet: ['ultraBullet', 'bullet'],
  blitz: ['blitz'],
  rapid: ['rapid'],
  classical: ['classical'],
  correspondence: ['correspondence'],
}

/** Games loaded per page ("load more" fetches the next page). */
export const PAGE_SIZE = 20

export interface GameSummary {
  id: string
  createdAt: number // ms
  speed: string
  rated: boolean
  clock?: { initial: number; increment: number } // seconds
  daysPerTurn?: number // correspondence
  status: string // mate, resign, outoftime, draw, stalemate…
  winner?: 'white' | 'black'
  opening?: string
  white: { name: string; rating?: number }
  black: { name: string; rating?: number }
  pgn: string
}

export interface GamesQuery {
  username: string
  speeds: Speed[] // empty = all standard speeds
  since?: number // ms, inclusive
  until?: number // ms, inclusive
  max?: number
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

/** Which colour `username` played (case-insensitive), or null if neither. */
export function userColor(g: GameSummary, username: string): 'white' | 'black' | null {
  const u = username.trim().toLowerCase()
  if (g.white.name.toLowerCase() === u) return 'white'
  if (g.black.name.toLowerCase() === u) return 'black'
  return null
}

/** Result from the user's point of view: win / loss / draw (or null if not their game). */
export function userResult(g: GameSummary, username: string): 'win' | 'loss' | 'draw' | null {
  const color = userColor(g, username)
  if (!color) return null
  if (!g.winner) return 'draw'
  return g.winner === color ? 'win' : 'loss'
}

/** "1-0", "0-1", "½-½" (or "*" if unfinished). */
export function scoreText(g: GameSummary): string {
  if (g.winner === 'white') return '1-0'
  if (g.winner === 'black') return '0-1'
  return ['started', 'created'].includes(g.status) ? '*' : '½-½'
}

/** "3+2" (minutes + increment), "¼+0" for 15 s, or "3d" for correspondence. */
export function timeControlText(g: GameSummary): string {
  if (g.clock) {
    const min = g.clock.initial / 60
    const m = min === 0.25 ? '¼' : min === 0.5 ? '½' : min === 0.75 ? '¾' : String(Math.round(min * 10) / 10)
    return `${m}+${g.clock.increment}`
  }
  return g.daysPerTurn ? `${g.daysPerTurn}d` : '∞'
}

/** Local date "YYYY-MM-DD" (from a <input type=date>) → [start, end] of that day in ms. */
export function dayRange(isoDate: string): [number, number] {
  const [y, m, d] = isoDate.split('-').map(Number)
  const start = new Date(y, m - 1, d).getTime()
  return [start, start + 86_400_000 - 1]
}

// ---------------------------------------------------------------------------
// Client: one request at a time
// ---------------------------------------------------------------------------

export class LichessGamesError extends Error {
  constructor(public kind: 'notFound' | 'rateLimited' | 'network', message: string) {
    super(message)
  }
}

let busy: Promise<unknown> = Promise.resolve()

/** Downloads one page of games (newest first). Throws LichessGamesError. */
export function fetchGames(q: GamesQuery): Promise<GameSummary[]> {
  const job = busy.then(async () => {
    let res: Response
    try {
      res = await fetch(gamesUrl(q), { headers: { Accept: 'application/x-ndjson' } })
    } catch (e) {
      // Note: when Lichess rate-limits (HTTP 429) its answer may lack the CORS
      // headers, so the browser reports a generic "access control" failure
      // here instead of the 429 status (seen while testing, 2026-10-25). The
      // message shown to the user mentions waiting a minute for that reason.
      throw new LichessGamesError('network', e instanceof Error ? e.message : String(e))
    }
    if (res.status === 404) throw new LichessGamesError('notFound', q.username)
    if (res.status === 429) throw new LichessGamesError('rateLimited', 'HTTP 429')
    if (!res.ok) throw new LichessGamesError('network', `HTTP ${res.status}`)
    const text = await res.text()
    return text.split('\n').map(parseGameLine).filter((g): g is GameSummary => g !== null)
  })
  busy = job.catch(() => undefined)
  return job
}
