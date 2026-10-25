/**
 * What the 📂 games panel needs from any site (Lichess, Chess.com): the game
 * summary, the query (user + filters), the page of results, and helpers that
 * don't depend on the site (José, 2026-10-25: "a tab for Lichess and another
 * for Chess.com"). Each site has its own client: lichess/games.ts and
 * chesscom/games.ts; both return the same `GameSummary`, so the list, the
 * favourites and opening a game are shared.
 */

export type Site = 'lichess' | 'chesscom'
export const SITES: Site[] = ['lichess', 'chesscom']
export const SITE_NAMES: Record<Site, string> = { lichess: 'Lichess', chesscom: 'Chess.com' }

export type Speed = 'bullet' | 'blitz' | 'rapid' | 'classical' | 'correspondence'
export const SPEEDS: Speed[] = ['bullet', 'blitz', 'rapid', 'classical', 'correspondence']

/** Games loaded per page ("load more" fetches the next page). */
export const PAGE_SIZE = 20

export interface GameSummary {
  site?: Site // missing in favourites saved before Chess.com existed → Lichess
  id: string // unique across sites (Chess.com ids are prefixed "cc-")
  createdAt: number // ms (Chess.com: end of the game, the only time it gives)
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

/** One page of games, newest first. `exhausted`: there are no older ones. */
export interface GamesPage {
  games: GameSummary[]
  exhausted: boolean
}

export class GamesError extends Error {
  constructor(public kind: 'notFound' | 'rateLimited' | 'network', message: string) {
    super(message)
  }
}

export const siteOf = (g: GameSummary): Site => g.site ?? 'lichess'

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

/**
 * Runs jobs one at a time, in order (both sites ask for one request at a
 * time). Each site keeps its own queue, so they don't wait for each other.
 */
export function serialQueue() {
  let busy: Promise<unknown> = Promise.resolve()
  return <T>(job: () => Promise<T>): Promise<T> => {
    const run = busy.then(job)
    busy = run.catch(() => undefined)
    return run
  }
}

/** fetch() that turns network failures and HTTP errors into GamesError. */
export async function fetchOrThrow(url: string, init: RequestInit | undefined, user: string): Promise<Response> {
  let res: Response
  try {
    res = await fetch(url, init)
  } catch (e) {
    // When a site rate-limits (HTTP 429) its answer may lack the CORS headers,
    // so the browser reports a generic "access control" failure instead of
    // the 429 (seen with Lichess, 2026-10-25). The message shown to the user
    // mentions waiting a minute for that reason.
    throw new GamesError('network', e instanceof Error ? e.message : String(e))
  }
  if (res.status === 404) throw new GamesError('notFound', user)
  if (res.status === 429) throw new GamesError('rateLimited', 'HTTP 429')
  if (!res.ok) throw new GamesError('network', `HTTP ${res.status}`)
  return res
}
