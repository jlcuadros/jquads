/**
 * Lichess endgame tablebase (Syzygy, up to 7 pieces) — perfect results for
 * endgames, used instead of Stockfish when available (José, 2026-10-25).
 *
 * API: GET https://tablebase.lichess.org/standard?fen=<FEN>  (CORS: *, fast,
 * cacheable 2 weeks). Lichess asks for one request at a time and a full minute
 * of pause after HTTP 429. We only ask when the position can be in the tables:
 * ≤ 7 pieces (kings included) and no castling rights (with castling rights the
 * answer is "unknown"). See the task note, Investigation 6.
 *
 * The exact results are translated into the same `Score` shape Stockfish
 * produces, so the colour code, the vertical bar, the arrows and the text work
 * unchanged: win → mate in N (or a big score when the distance is unknown),
 * draw → 0.00, loss → being mated.
 */
import { formatScore, type Score } from './classify'

export const TABLEBASE_URL = 'https://tablebase.lichess.org/standard'
export const MAX_TB_PIECES = 7

/** Raw categories returned by the API (side to move's point of view). */
export type TbCategory =
  | 'win' | 'syzygy-win' | 'maybe-win' | 'cursed-win'
  | 'draw'
  | 'blessed-loss' | 'maybe-loss' | 'syzygy-loss' | 'loss'
  | 'unknown'

export interface TbMoveJson {
  uci: string
  san: string
  category: TbCategory // for the side to move AFTER this move (the opponent)
  dtz: number | null
  dtm: number | null
}
export interface TbJson {
  category: TbCategory
  dtz: number | null
  dtm: number | null
  checkmate: boolean
  stalemate: boolean
  moves: TbMoveJson[] // best first, from the side to move's point of view
}

/** Simplified result for the player who has to move (or who just moved). */
export type TbOutcome = 'win' | 'draw' | 'loss'

/** One move's exact result, from the point of view of the player making it. */
export interface TbMove {
  uci: string
  outcome: TbOutcome
  mateIn?: number // full moves until mate, when known
  cursed: boolean // win/loss that the 50-move rule turns into a draw
  score: Score // White's point of view, for classification / bar / arrows
}

export interface TbResult {
  outcome: TbOutcome // for the side to move
  mateIn?: number
  moves: TbMove[] // best first
}

// ---------------------------------------------------------------------------
// Pure helpers (tested in tablebase.test.ts)
// ---------------------------------------------------------------------------

/** Can this position be in the tables? ≤ 7 pieces and no castling rights. */
export function tablebaseEligible(fen: string): boolean {
  const [board, , castling] = fen.split(' ')
  const pieces = board.replace(/[^a-zA-Z]/g, '').length
  return pieces <= MAX_TB_PIECES && castling === '-'
}

/**
 * Category → practical outcome. Cursed wins / blessed losses are draws under
 * the 50-move rule; "maybe" and "syzygy" variants keep their sign. "unknown"
 * has no outcome (the caller falls back to Stockfish).
 */
export function outcomeOf(category: TbCategory): TbOutcome | null {
  if (category === 'unknown') return null
  if (category === 'win' || category === 'syzygy-win' || category === 'maybe-win') return 'win'
  if (category === 'loss' || category === 'syzygy-loss' || category === 'maybe-loss') return 'loss'
  return 'draw' // draw, cursed-win, blessed-loss
}

/** The category of the opponent after a move → the mover's category. */
const INVERT: Record<TbCategory, TbCategory> = {
  win: 'loss', 'syzygy-win': 'syzygy-loss', 'maybe-win': 'maybe-loss', 'cursed-win': 'blessed-loss',
  draw: 'draw',
  'blessed-loss': 'cursed-win', 'maybe-loss': 'maybe-win', 'syzygy-loss': 'syzygy-win', loss: 'win',
  unknown: 'unknown',
}

/** DTM in plies → full moves (the API's dtm counts half-moves). */
const pliesToMoves = (plies: number) => Math.ceil(Math.abs(plies) / 2)

/** Exact outcome → Score from White's point of view (same shape as Stockfish). */
function toScore(outcome: TbOutcome, mateIn: number | undefined, moverIsWhite: boolean): Score {
  if (outcome === 'draw') return { cp: 0 }
  const sign = (outcome === 'win') === moverIsWhite ? 1 : -1
  // Mate distance when known; otherwise a decisive score (unknown distance).
  return mateIn !== undefined ? { mate: sign * mateIn } : { cp: sign * 2000 }
}

/** Converts the API answer into our result; null when the tables don't know. */
export function parseTablebase(json: TbJson, fen: string): TbResult | null {
  const outcome = outcomeOf(json.category)
  if (outcome === null) return null
  const moverIsWhite = fen.split(' ')[1] === 'w'
  const moves: TbMove[] = []
  for (const m of json.moves) {
    const category = INVERT[m.category]
    const o = outcomeOf(category)
    if (o === null) continue
    // After the move it's the opponent's turn: its dtm (plies) + this move.
    const mateIn = o !== 'draw' && m.dtm !== null ? pliesToMoves(Math.abs(m.dtm) + 1) : undefined
    moves.push({
      uci: m.uci,
      outcome: o,
      mateIn,
      cursed: category === 'cursed-win' || category === 'blessed-loss',
      score: toScore(o, mateIn, moverIsWhite),
    })
  }
  const mateIn = outcome !== 'draw' && json.dtm !== null ? pliesToMoves(json.dtm) : undefined
  return { outcome, mateIn, moves }
}

/**
 * Short result label, in White's point of view like Stockfish's eval:
 * "+M20" (White mates in 20), "−M20" (Black mates in 20), "=" (draw) and
 * "= (50)" (a win or loss that the 50-move rule turns into a draw). When the
 * tables don't give the mate distance (usually 6–7 pieces): "+M?" / "−M?".
 * Signs instead of words (José, 2026-10-25: "Gana" / "Pierde" didn't fit on
 * one line in some languages; iteration 5: "=" instead of "Tablas").
 * Used for the moves (right column) and for the position (top line).
 */
export function tbLabel(score: Score, outcome: TbOutcome, cursed = false): string {
  if (cursed) return '= (50)'
  if (outcome === 'draw') return '='
  if (score.mate !== undefined) return formatScore(score)
  return `${(score.cp ?? 0) > 0 ? '+' : '−'}M?`
}

/** Score of the position itself (White's point of view), for the top line. */
export function tbPositionScore(tb: TbResult, fen: string): Score {
  return toScore(tb.outcome, tb.mateIn, fen.split(' ')[1] === 'w')
}

// ---------------------------------------------------------------------------
// Client: cache, one request at a time, pause after HTTP 429
// ---------------------------------------------------------------------------

const REQUEST_TIMEOUT_MS = 5000
const RATE_LIMIT_PAUSE_MS = 60_000

export class TablebaseClient {
  private cache = new Map<string, TbResult | null>() // FEN → result (null = not in the tables)
  private queue: Promise<unknown> = Promise.resolve()
  private pausedUntil = 0

  /**
   * Exact result for `fen`, or null if the position is not eligible, the
   * tables don't know it, or the API is unavailable (then: use Stockfish).
   */
  lookup(fen: string): Promise<TbResult | null> {
    if (!tablebaseEligible(fen)) return Promise.resolve(null)
    const key = fen.split(' ').slice(0, 4).join(' ') // move counters don't matter
    if (this.cache.has(key)) return Promise.resolve(this.cache.get(key)!)
    const job = this.queue.then(() => this.fetchOne(key))
    this.queue = job.catch(() => undefined)
    return job
  }

  private async fetchOne(key: string): Promise<TbResult | null> {
    if (this.cache.has(key)) return this.cache.get(key)! // answered while queued
    if (Date.now() < this.pausedUntil) return null // rate-limited: Stockfish for now
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      const res = await fetch(`${TABLEBASE_URL}?fen=${encodeURIComponent(key.replace(/ /g, '_'))}`, { signal: controller.signal })
      if (res.status === 429) {
        this.pausedUntil = Date.now() + RATE_LIMIT_PAUSE_MS
        return null
      }
      if (!res.ok) return null // temporary problem: not cached, may retry later
      const result = parseTablebase((await res.json()) as TbJson, `${key} 0 1`)
      this.cache.set(key, result)
      return result
    } catch {
      return null // offline / timeout: fall back to Stockfish
    } finally {
      clearTimeout(timer)
    }
  }
}
