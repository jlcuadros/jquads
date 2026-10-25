/**
 * HTML builders for the analysis panel (no state, no engine calls).
 *
 * Clickable moves carry `data-move="<uci>"` (play that move) and the move
 * strip carries `data-node="<id>"` (jump to that position); app.ts handles both
 * with a single delegated click listener.
 */
import { Chess } from 'chess.js'
import { shownMaiaMoves, type PositionAnalysis, type SideAnalysis } from '../analysis/analyzer'
import { formatScore, type MoveClass } from '../analysis/classify'
import { describePosition } from '../analysis/describe'
import type { EngineLine } from '../stockfish/stockfishClient'
import type { GameTree } from '../game/tree'

/** UCI → SAN in `fen` (falls back to UCI if something is off). */
export function sanOf(fen: string, uci: string): string {
  try {
    return new Chess(fen).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san
  } catch {
    return uci
  }
}

/** A move with its colour-code dot; clickable (plays the move). */
function chip(uci: string, san: string, color?: string): string {
  const style = color ? ` style="--chip:${color}"` : ''
  return `<span class="move-chip${color ? '' : ' plain'}" data-move="${uci}"${style}>${san}</span>`
}

const pct = (p: number) => `${(p * 100).toFixed(1)}%`

// ---------------------------------------------------------------------------

/** Line above the board: Maia's win % and Stockfish's eval as numbers. */
export function renderNumbers(a: PositionAnalysis | undefined): string {
  const m = a?.main
  const maia = m?.maia ? `Maia: blancas ${Math.round(m.maia.whiteWinProb * 100)}%` : 'Maia: …'
  const best = m?.lines[0]
  const sf = best ? `SF ${formatScore(lineScoreOf(best))} · d${m.depth}` : 'SF: …'
  return `<span class="maia">${maia}</span><span class="sf">${sf}</span>`
}

const lineScoreOf = (l: EngineLine) => (l.mate !== undefined ? { mate: l.mate } : { cp: l.scoreCp })

/**
 * A Blunder Meter bar + one-line legend. Used twice: for the side to move
 * and for the threats.
 *
 * Legend (José, iteration 3): Maia's most likely moves in order of
 * probability, whatever their class (the colour dot tells the class), as
 * many as fit on one line (CSS hides the ones that don't; on a phone at
 * least the first 4 fit). Which moves: shownMaiaMoves (≥ 1 %, max. 6).
 * No title on screen (saves vertical space): the bars are explained in ⚙.
 */
export function renderMeter(side: SideAnalysis | null | undefined, emptyMsg: string, showBar = true): string {
  const bar = (html: string) => (showBar ? `<div class="meter">${html}</div>` : '')
  if (side === null) return `${bar('')}<div class="meter-legend"><span>${emptyMsg}</span></div>`
  if (!side?.meter || !side.maia) {
    return `${bar('')}<div class="meter-legend"><span>calculando…</span></div>`
  }
  const { good, ok, blunder } = side.meter
  const seg = (cls: MoveClass, frac: number, label: string) =>
    `<div class="${cls}" style="width:${(frac * 100).toFixed(1)}%">${frac >= 0.12 ? label : ''}</div>`

  // Same moves Stockfish was asked to evaluate (shownMaiaMoves), so all have a colour.
  const items = shownMaiaMoves(side.maia.policy).map((p) => `<span>${chip(p.uci, sanOf(side.fen, p.uci), side.classified.get(p.uci)?.color)} ${Math.round(p.prob * 100)}%</span>`)

  return (
    bar(`${seg('blunder', blunder, `?? ${Math.round(blunder * 100)}%`)}${seg('ok', ok, `?! ${Math.round(ok * 100)}%`)}${seg('good', good, `✓ ${Math.round(good * 100)}%`)}`) +
    `<div class="meter-legend">${items.join('')}</div>`
  )
}

/** The move list in a single horizontal row; the current move highlighted. */
export function renderMoves(tree: GameTree): string {
  const line = tree.displayLine()
  if (!line.length) return '<span class="empty">Mueve una pieza para empezar</span>'
  return line
    .map((n, i) => {
      const { number, whiteMove } = tree.moveNumber(n)
      const num = whiteMove ? `<span class="num">${number}.</span>` : i === 0 ? `<span class="num">${number}…</span>` : ''
      const cur = n === tree.current ? ' current' : ''
      return `${num}<span class="mv${cur}" data-node="${n.id}">${n.san}</span>`
    })
    .join('')
}

/** Left column: Maia's most likely moves at the selected Elo. */
export function renderMaiaCol(side: SideAnalysis | undefined, elo: number, count: number): string {
  const rows = side?.maia
    ? side.maia.policy
        .slice(0, count)
        .map((p) => {
          const c = side.classified.get(p.uci)
          return `<tr data-move="${p.uci}"><td>${chip(p.uci, sanOf(side.fen, p.uci), c?.color)}</td><td>${pct(p.prob)}</td></tr>`
        })
        .join('')
    : '<tr><td colspan="2">calculando…</td></tr>'
  // The header row is also the title: "Maia 1500 | prob".
  return `<table><tr><th>Maia ${elo}</th><th>prob</th></tr>${rows}</table>`
}

/** Right column: Stockfish's best lines. */
export function renderSfCol(side: SideAnalysis | undefined, engineName: string): string {
  const rows = side?.lines.length
    ? side.lines
        .map((l) => {
          const uci = l.pv[0]
          const c = side.classified.get(uci)
          return `<tr data-move="${uci}"><td>${chip(uci, sanOf(side.fen, uci), c?.color)}</td><td>${formatScore(lineScoreOf(l))}</td></tr>`
        })
        .join('')
    : '<tr><td colspan="2">calculando…</td></tr>'
  // The header row is also the title: "Stockfish 17 d18 | eval".
  const depth = side?.depth ? ` <small>d${side.depth}</small>` : ''
  return `<table><tr><th>${engineName}${depth}</th><th>eval</th></tr>${rows}</table>`
}

/** Explanatory text under the columns (only when the analysis is complete). */
export function renderText(a: PositionAnalysis | undefined, elo: number): string {
  const m = a?.main
  if (!m?.done || !m.maia || !m.lines[0]) return ''
  const segs = describePosition({
    whiteToMove: m.fen.split(' ')[1] === 'w',
    elo,
    best: lineScoreOf(m.lines[0]),
    classified: m.classified,
    policy: m.maia.policy,
    san: (uci) => sanOf(m.fen, uci),
  })
  return segs.map((s) => ('text' in s ? s.text : chip(s.move, s.san, s.color))).join('')
}
