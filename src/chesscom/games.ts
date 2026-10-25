/**
 * Chess.com games of a user (José, 2026-10-25), for the same 📂 panel as the
 * Lichess games. See the task note, Investigation 10.
 *
 * API ("PubAPI", no login, CORS `*`, checked from our page in WebKit):
 *   GET https://api.chess.com/pub/player/{user}/games/archives
 *       → { archives: [".../games/2014/01", …, ".../games/2026/10"] }  (oldest first)
 *   GET https://api.chess.com/pub/player/{user}/games/{YYYY}/{MM}
 *       → { games: [...] }  every game of that month, oldest first
 * Unknown user → 404. Chess.com asks for one request at a time (parallel
 * requests may get HTTP 429).
 *
 * Unlike Lichess there are no server-side filters or paging: we walk the
 * months from the newest, filter speed and dates here and stop when a page is
 * full. Past months never change, so they are kept in memory for the session.
 */
import { PAGE_SIZE, fetchOrThrow, serialQueue, type GameSummary, type GamesPage, type GamesQuery, type Speed } from '../games/common'

const API = 'https://api.chess.com/pub/player'

/** Chess.com has no "classical": its long games are "rapid"; "daily" = correspondence. */
export const CHESSCOM_SPEEDS: Speed[] = ['bullet', 'blitz', 'rapid', 'correspondence']
const SPEED_OF: Record<string, Speed> = { bullet: 'bullet', blitz: 'blitz', rapid: 'rapid', daily: 'correspondence' }

/** Months downloaded per page at most (a rare speed filter could otherwise walk years). */
export const MAX_MONTHS_PER_PAGE = 6
/** The current month (and the archive list) may change: re-download after this. */
const FRESH_MS = 60_000

// ---------------------------------------------------------------------------
// Pure helpers (tested in games.test.ts)
// ---------------------------------------------------------------------------

/** Archive URL ".../games/2026/10" → [first ms, last ms] of that month (UTC, as Chess.com). */
export function monthRange(archiveUrl: string): [number, number] {
  const [y, m] = archiveUrl.split('/').slice(-2).map(Number)
  return [Date.UTC(y, m - 1, 1), Date.UTC(y, m, 1) - 1]
}

/** Opening name from the `eco` URL: ".../openings/Sicilian-Defense-Kan-Variation...5.Bd3" → "Sicilian Defense Kan Variation". */
export function openingFromEcoUrl(url: string | undefined): string | undefined {
  const slug = url?.split('/openings/')[1]
  if (!slug) return undefined
  const name = slug.split(/\.\.\.|-\d+\./)[0].replace(/-/g, ' ').trim()
  return name ? decodeURIComponent(name) : undefined
}

const DRAWS = ['agreed', 'repetition', 'stalemate', 'insufficient', '50move', 'timevsinsufficient']

/** One game of a monthly archive → our summary (null for variants or broken entries). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseChessComGame(g: any): GameSummary | null {
  if (!g?.pgn || g.rules !== 'chess' || !g.white || !g.black) return null
  const winner = g.white.result === 'win' ? 'white' : g.black.result === 'win' ? 'black' : undefined
  const loserResult = winner === 'white' ? g.black.result : g.white.result
  const [base, inc] = String(g.time_control ?? '').split('+')
  const daily = g.time_class === 'daily'
  return {
    site: 'chesscom',
    // ".../game/live/184627853334" → "cc-live-184627853334" (live and daily ids are separate series)
    id: `cc-${String(g.url ?? g.uuid).split('/').slice(-2).join('-')}`,
    createdAt: g.end_time * 1000,
    speed: SPEED_OF[g.time_class] ?? g.time_class,
    rated: !!g.rated,
    // daily: "1/86400" = one move per 86 400 s = 1 day
    clock: daily || !base ? undefined : { initial: Number(base), increment: Number(inc ?? 0) },
    daysPerTurn: daily ? Math.round(Number(base.split('/')[1]) / 86400) || undefined : undefined,
    status: winner ? loserResult : DRAWS.includes(g.white.result) ? 'draw' : g.white.result,
    winner,
    opening: openingFromEcoUrl(g.eco),
    white: { name: g.white.username, rating: g.white.rating },
    black: { name: g.black.username, rating: g.black.rating },
    pgn: g.pgn,
  }
}

/** Does `g` pass the speed and date filters? (Classical is ignored: Chess.com has none.) */
export function matchesQuery(g: GameSummary, q: GamesQuery): boolean {
  const speeds = q.speeds.filter((s) => CHESSCOM_SPEEDS.includes(s))
  if (speeds.length && !speeds.includes(g.speed as Speed)) return false
  if (q.since !== undefined && g.createdAt < q.since) return false
  if (q.until !== undefined && g.createdAt > q.until) return false
  return true
}

// ---------------------------------------------------------------------------
// Client: one request at a time, months cached for the session
// ---------------------------------------------------------------------------

const queue = serialQueue()
const cache = new Map<string, { at: number; data: unknown }>() // URL → JSON

/** GET with the session cache; `stable` = never changes (a past month). */
async function getJson<T>(url: string, user: string, stable: boolean): Promise<{ data: T; downloaded: boolean }> {
  const hit = cache.get(url)
  if (hit && (stable || Date.now() - hit.at < FRESH_MS)) return { data: hit.data as T, downloaded: false }
  const data = (await (await fetchOrThrow(url, undefined, user)).json()) as T
  cache.set(url, { at: Date.now(), data })
  return { data, downloaded: true }
}

/** Downloads one page of games (newest first). Throws GamesError. */
export function fetchChessComGames(q: GamesQuery): Promise<GamesPage> {
  const user = q.username.trim()
  const max = q.max ?? PAGE_SIZE
  return queue(async () => {
    const { data } = await getJson<{ archives: string[] }>(`${API}/${encodeURIComponent(user.toLowerCase())}/games/archives`, user, false)
    const months = [...data.archives].reverse() // newest first
    const found: GameSummary[] = []
    let downloads = 0
    for (const url of months) {
      const [start, end] = monthRange(url)
      if (q.until !== undefined && start > q.until) continue // newer than the range
      if (q.since !== undefined && end < q.since) break // older than the range: done
      const isPast = end < Date.now()
      if (!cache.has(url) && downloads >= MAX_MONTHS_PER_PAGE) return { games: found, exhausted: false }
      const month = await getJson<{ games: unknown[] }>(url, user, isPast)
      if (month.downloaded) downloads++
      const games = month.data.games
        .map(parseChessComGame)
        .filter((g): g is GameSummary => g !== null && matchesQuery(g, q))
        .sort((a, b) => b.createdAt - a.createdAt)
      found.push(...games)
      if (found.length >= max) return { games: found.slice(0, max), exhausted: false }
    }
    return { games: found, exhausted: true }
  })
}
