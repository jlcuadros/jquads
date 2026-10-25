/**
 * Analysis coordinator: for one position, runs Maia + Stockfish, classifies the
 * moves (colour code), computes the Blunder Meter and the threats, and reports
 * partial results as they arrive so the UI can update progressively.
 *
 * Pipeline per position (each step is skipped if the position changed):
 *   1. Maia (selected Elo) → move probabilities + win %.
 *   2. Stockfish MultiPV (⚙ "Jugadas por motor", default 4) to the chosen
 *      depth (progressive updates).
 *   3. Stockfish `searchmoves` for EVERY move Maia shows (see shownMaiaMoves)
 *      that is not among those lines, so every move on screen has an
 *      evaluation and a colour (José, 2026-10-25).
 *   4. Threats: same as 1–3 on the "null move" position (turn passed to the
 *      opponent), at a lower depth. Skipped if the side to move is in check.
 *
 * Results are cached per (position, Elo, depths), so going back and forth
 * through a game is instant.
 */
import type { MaiaClient } from '../maia/maiaClient'
import type { EngineLine, StockfishClient } from '../stockfish/stockfishClient'
import { blunderMeter, classifyMoves, type ClassifiedMove, type Score } from './classify'
import { nullMoveFen } from '../game/tree'

/** Below this depth the colour code is not reliable (same as maiachess). */
export const MIN_CLASSIFY_DEPTH = 12
/**
 * Which of Maia's moves are "shown" and therefore must be evaluated by
 * Stockfish (José: "analyse with Stockfish every move that appears in the GUI").
 *   - Bar legend: Maia's moves by probability, ≥ 1 %, at most 6 (what fits on
 *     one line on an iPhone, measured in iteration 4).
 *   - Maia column: its top "Moves per engine" (≤ 6) → already included above.
 *   - Stockfish column: Stockfish's own lines → evaluated by the main search.
 * Single source of truth for both the analysis and the rendering (ui/render.ts).
 */
export const SHOWN_MOVES = { minProb: 0.01, max: 6 } as const
export function shownMaiaMoves<T extends { prob: number }>(policy: T[]): T[] {
  return policy.filter((p) => p.prob >= SHOWN_MOVES.minProb).slice(0, SHOWN_MOVES.max)
}

/** Depth used for the extra `searchmoves` pass (cheaper than the main search). */
const CANDIDATE_DEPTH = 14

export interface Settings {
  elo: number
  depth: number // main Stockfish depth
  threatDepth: number // Stockfish depth for threats
  threats: boolean // compute threats at all (⚙ "Amenazas" ≠ "No calcular")
  lines: number // Stockfish MultiPV for the main analysis (= rows shown per engine)
}

/** Everything known about one position (main side to move, or threats). */
export interface SideAnalysis {
  fen: string
  maia?: { policy: Array<{ uci: string; prob: number }>; whiteWinProb: number }
  lines: EngineLine[] // Stockfish lines (white's point of view)
  depth: number // depth reached by the main lines
  classified: Map<string, ClassifiedMove>
  meter?: ReturnType<typeof blunderMeter>
  done: boolean
}

export interface PositionAnalysis {
  main: SideAnalysis
  /** null = no threats (side to move in check); undefined = not computed yet. */
  threats?: SideAnalysis | null
}

const lineScore = (l: EngineLine): Score => (l.mate !== undefined ? { mate: l.mate } : { cp: l.scoreCp })

export class Analyzer {
  private generation = 0
  private cache = new Map<string, PositionAnalysis>()

  constructor(
    private maia: MaiaClient,
    private stockfish: StockfishClient,
  ) {}

  /** Cancels the analysis in progress (call when the position changes). */
  cancel() {
    this.generation++
    this.stockfish.stop()
  }

  /**
   * Analyses `fen`. `onUpdate` receives the (partial) analysis every time
   * something new is known. Resolves when everything is done or cancelled.
   */
  async analyse(fen: string, s: Settings, onUpdate: (a: PositionAnalysis) => void): Promise<void> {
    this.cancel()
    const gen = this.generation
    const key = `${fen}|${s.elo}|${s.depth}|${s.threatDepth}|${s.lines}`
    const alive = () => gen === this.generation

    // Reuse what was already finished for this position (main and/or threats);
    // only unfinished parts are recomputed. Stored right away, so even a
    // half-done analysis is not lost when you move on.
    const cached = this.cache.get(key)
    const result: PositionAnalysis = {
      main: cached?.main.done ? cached.main : emptySide(fen),
      threats: cached?.threats === null || cached?.threats?.done ? cached.threats : undefined,
    }
    this.cache.set(key, result)
    const emit = () => alive() && onUpdate(result)
    emit()
    if (result.threats !== undefined) return // everything was cached

    if (!result.main.done) {
      await this.analyseSide(result.main, s.elo, s.depth, s.lines, alive, emit)
      if (!alive()) return
    }

    if (!s.threats) return // main analysis is cached; threats will be computed if re-enabled
    const nullFen = nullMoveFen(fen)
    if (!nullFen) {
      result.threats = null
    } else {
      result.threats = emptySide(nullFen)
      // Threats only need the opponent's best moves (arrow + colours): 3 lines.
      await this.analyseSide(result.threats, s.elo, s.threatDepth, 3, alive, emit)
      if (!alive()) return
    }
    emit()
  }

  /** Steps 1–3 for one position, filling `side` in place. */
  private async analyseSide(
    side: SideAnalysis,
    elo: number,
    depth: number,
    multiPv: number,
    alive: () => boolean,
    emit: () => void,
  ) {
    const whiteToMove = side.fen.split(' ')[1] === 'w'

    // 1. Maia.
    const { predictions } = await this.maia.predict(side.fen, [elo])
    if (!alive()) return
    side.maia = { policy: predictions[0].policy, whiteWinProb: predictions[0].whiteWinProb }
    emit()

    // 2. Stockfish main lines, with progressive updates.
    const scores = new Map<string, Score>()
    const reclassify = () => {
      side.classified = classifyMoves(scores, whiteToMove)
      side.meter = side.maia ? blunderMeter(side.maia.policy, side.classified) : undefined
    }
    await this.stockfish.analyse(side.fen, depth, multiPv, (lines) => {
      if (!alive()) return
      side.lines = lines
      side.depth = lines[0]?.depth ?? 0
      if (side.depth >= MIN_CLASSIFY_DEPTH) {
        scores.clear()
        for (const l of lines) if (l.pv[0]) scores.set(l.pv[0], lineScore(l))
        reclassify()
      }
      emit()
    })
    if (!alive()) return
    for (const l of side.lines) if (l.pv[0]) scores.set(l.pv[0], lineScore(l))

    // 3. Every shown Maia move that Stockfish's own lines didn't cover.
    const candidates = shownMaiaMoves(side.maia.policy)
      .map((p) => p.uci)
      .filter((uci) => !scores.has(uci))
    if (candidates.length) {
      const extra = await this.stockfish.analyse(side.fen, Math.min(depth, CANDIDATE_DEPTH), candidates.length, undefined, candidates)
      if (!alive()) return
      for (const l of extra.lines) if (l.pv[0] && !scores.has(l.pv[0])) scores.set(l.pv[0], lineScore(l))
    }
    reclassify()
    side.done = true
    emit()
  }
}

function emptySide(fen: string): SideAnalysis {
  return { fen, lines: [], depth: 0, classified: new Map(), done: false }
}
