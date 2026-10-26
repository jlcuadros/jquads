/**
 * HTML builders for the analysis panel (no state, no engine calls).
 *
 * Clickable moves carry `data-move="<uci>"` (play that move) and the move
 * strip carries `data-node="<id>"` (jump to that position); app.ts handles both
 * with a single delegated click listener.
 */
import { Chess } from 'chess.js'
import { shownMaiaMoves, type PositionAnalysis, type SideAnalysis } from '../analysis/analyzer'
import { bestScore, deltaEval, formatScore, type MoveClass } from '../analysis/classify'
import { describePosition, type Segment } from '../analysis/describe'
import { describePreviousMove } from '../analysis/previousMove'
import type { EngineLine } from '../stockfish/stockfishClient'
import type { GameTree, MoveNode } from '../game/tree'
import { movetextTokens, type PgnHeaders } from '../game/pgn'
import { moveMark, type MoveMark } from '../analysis/moveMarks'
import { probOf, shapeOf, type Shape } from '../analysis/likelihood'
import { formatSan, type Notation } from '../game/notation'
import { tbLabel, tbPositionScore } from '../analysis/tablebase'
import { getLang, t } from '../i18n/i18n'
import type { BookMove } from '../book/polyglot'
import { BOOK_MIN_SHARE } from '../book/openingBook'

/**
 * Display options set by app.ts before rendering (iteration 4):
 *  - notation: figurine (♘f3, default) or letters (Nf3);
 *  - hideMoves: training mode — every suggested move becomes "--" (and is not
 *    clickable) while evaluations and percentages stay visible;
 *  - deltaCol / maiaCol: the middle columns of the Maia ("Δ eval") and
 *    Stockfish ("Maia") panels, each can be hidden in ⚙ (José, iteration 5);
 *  - book: the opening book's moves of a position (iteration 6), or undefined
 *    while it isn't loaded or when it is turned off in ⚙.
 */
const view: { notation: Notation; hideMoves: boolean; deltaCol: boolean; maiaCol: boolean; book?: (fen: string) => BookMove[] } = {
  notation: 'figurine',
  hideMoves: false,
  deltaCol: true,
  maiaCol: true,
}

/** 📖 after a move that is in the opening book (Maia and Stockfish columns). */
function bookMark(fen: string, uci: string): string {
  return view.book?.(fen).some((m) => m.uci === uci) ? `<span class="book-mark" title="${t('book.title')}">📖</span>` : ''
}

/** A middle column cell (or header), only when that column is shown. */
const midCell = (shown: boolean, html: string, tag = 'td') => (shown ? `<${tag} class="num">${html}</${tag}>` : '')
export function setViewOptions(options: Partial<typeof view>) {
  Object.assign(view, options)
}

/**
 * Wraps chess figurines in <span class="fig"> so CSS can enlarge them: in the
 * system font they render much smaller than letters (seen on iOS, iteration 4).
 */
const figHtml = (text: string) => text.replace(/[♔♕♖♗♘♚♛♜♝♞]/g, (c) => `<span class="fig">${c}</span>`)

/** What replaces a move when moves are hidden. */
const HIDDEN = '--'

/** UCI → SAN in `fen`, in the chosen notation (falls back to UCI if something is off). */
export function sanOf(fen: string, uci: string): string {
  try {
    const san = new Chess(fen).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san
    return formatSan(san, fen.split(' ')[1] === 'w', view.notation)
  } catch {
    return uci
  }
}

/**
 * A move with its marker: colour = quality (Stockfish), shape = how likely a
 * player of the selected Elo is to play it (● ≥ 25 %, ■ 10–25 %, ▲ < 10 %;
 * analysis/likelihood.ts, José 2026-10-26). Clickable (plays the move).
 * Hidden → "--", not clickable.
 */
function chip(uci: string, san: string, color?: string, shape?: Shape): string {
  const style = color ? ` style="--chip:${color}"` : ''
  const cls = `move-chip${color ? '' : ' plain'} shape-${shape ?? 'circle'}`
  if (view.hideMoves) return `<span class="${cls}"${style}>${HIDDEN}</span>`
  return `<span class="${cls}" data-move="${uci}"${style}>${figHtml(san)}</span>`
}

/** Shape of `uci` from a side's Maia list. */
const shapeIn = (side: SideAnalysis | undefined, uci: string) => shapeOf(probOf(side?.maia?.policy, uci))

/** `data-move` attribute for a table row, omitted when moves are hidden. */
const rowMove = (uci: string) => (view.hideMoves ? '' : ` data-move="${uci}"`)

/** Probability without decimals (José, iteration 5: saves space). */
const pct = (p: number) => `${Math.round(p * 100)}%`

// ---------------------------------------------------------------------------

/** Line above the board: Maia's win % and Stockfish's eval as numbers. */
export function renderNumbers(a: PositionAnalysis | undefined): string {
  const m = a?.main
  // "blancas" dropped to make room for the hide-moves button (iteration 4).
  const maia = m?.maia ? `Maia: ${Math.round(m.maia.whiteWinProb * 100)}%` : 'Maia: …'
  const best = m?.lines[0]
  const sf = m?.tb ? `TB ${tbLabel(tbPositionScore(m.tb, m.fen), m.tb.outcome)}` : best ? `SF ${formatScore(lineScoreOf(best))}` : 'SF: …' // depth in the SF column's header (2026-10-26: room for 📋)
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
export function renderMeter(side: SideAnalysis | null | undefined, emptyMsg: string, showBar = true, showMoves = true): string {
  const bar = (html: string) => (showBar ? `<div class="meter">${html}</div>` : '')
  // Bar only (iteration 5, default for the top bar): no legend line at all.
  const legend = (html: string) => (showMoves ? `<div class="meter-legend">${html}</div>` : '')
  if (side === null) return `${bar('')}${legend(`<span>${emptyMsg}</span>`)}`
  if (!side?.meter || !side.maia) return `${bar('')}${legend(`<span>${t('panel.calculating')}</span>`)}`
  const { good, ok, blunder } = side.meter
  const seg = (cls: MoveClass, frac: number, label: string) =>
    `<div class="${cls}" style="width:${(frac * 100).toFixed(1)}%">${frac >= 0.12 ? label : ''}</div>`

  // Same moves Stockfish was asked to evaluate (shownMaiaMoves), so all have a colour.
  const items = shownMaiaMoves(side.maia.policy).map((p) => `<span>${chip(p.uci, sanOf(side.fen, p.uci), side.classified.get(p.uci)?.color, shapeOf(p.prob))} ${Math.round(p.prob * 100)}%</span>`)

  return (
    bar(`${seg('blunder', blunder, `?? ${Math.round(blunder * 100)}%`)}${seg('ok', ok, `?! ${Math.round(ok * 100)}%`)}${seg('good', good, `✓ ${Math.round(good * 100)}%`)}`) +
    legend(items.join(''))
  )
}

/** Mark of a move (strip and full game view): colour = quality, shape ● ■ ▲ = how likely (likelihood.ts), or nothing. */
export type MarkOf = (node: MoveNode) => MoveMark | undefined
const markHtml = (m?: MoveMark) => (m ? `<span class="mark shape-${m.shape}" style="--chip:${m.color}"></span>` : '')

/** The previous position's data as the move judges need it (shared by the summary and the marks). */
const prevData = (side?: SideAnalysis) =>
  side && { classified: side.classified, best: side.lines[0] && lineScoreOf(side.lines[0]), policy: side.maia?.policy }

/**
 * Mark of `node` from the analyses (cached) of the position before it and of
 * its own position (José, 2026-10-26: colour = quality of the move, shape =
 * how findable the good moves were).
 */
export function markFrom(node: MoveNode, before?: PositionAnalysis, after?: PositionAnalysis): MoveMark | undefined {
  if (!node.parent) return undefined
  const current = after?.main.done ? after.main.lines[0] : undefined
  return moveMark(prevData(before?.main), node.uci, node.parent.fen.split(' ')[1] === 'w', current && lineScoreOf(current))
}

/** The move list in a single horizontal row; the current move highlighted; marks where analysed. */
export function renderMoves(tree: GameTree, markOf?: MarkOf): string {
  const line = tree.displayLine()
  if (!line.length) return `<span class="empty">${t('panel.noMoves')}</span>`
  return line
    .map((n, i) => {
      const { number, whiteMove } = tree.moveNumber(n)
      const num = whiteMove ? `<span class="num">${number}.</span>` : i === 0 ? `<span class="num">${number}…</span>` : ''
      const cur = n === tree.current ? ' current' : ''
      return `${num}<span class="mv${cur}" data-node="${n.id}">${markHtml(markOf?.(n))}${figHtml(formatSan(n.san, whiteMove, view.notation))}</span>`
    })
    .join('')
}

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

/**
 * The whole game in large type (José, 2026-10-26), opened with the button in
 * the middle of the navigation bar: players/event from the PGN headers, then
 * every move — variations in parentheses, comments in italics — each one
 * tappable (data-node) to go there; the current move highlighted.
 */
export function renderGameView(tree: GameTree, headers: PgnHeaders, markOf?: MarkOf): string {
  const players = headers.White || headers.Black ? `${escapeHtml(headers.White ?? '?')} – ${escapeHtml(headers.Black ?? '?')}` : ''
  const about = [players, headers.Event, headers.Date, headers.Result && headers.Result !== '*' ? headers.Result : '']
    .filter((x) => x && x !== '?')
    .map((x) => escapeHtml(x!))
    .join(' · ')
  const tokens = movetextTokens(tree)
  const body = tokens
    .map((tk, i) => {
      // A space between tokens, but not after "(" nor before ")": "e5 (1... c5)".
      const space = i === 0 || tk.kind === 'close' || tokens[i - 1].kind === 'open' ? '' : ' '
      return space + tokenHtml(tk)
    })
    .join('')
  return (about ? `<div class="pv-about">${about}</div>` : '') + `<div class="pv-moves">${body || `<span class="empty">${t('panel.noMoves')}</span>`}</div>`

  function tokenHtml(tk: (typeof tokens)[number]): string {
    if (tk.kind === 'open') return '<span class="pv-var">('
    if (tk.kind === 'close') return ')</span>'
    if (tk.kind === 'comment') return `<span class="pv-comment">${escapeHtml(tk.text)}</span>`
    const n = tk.node
    const number = tk.text.slice(0, tk.text.length - n.san.length) // "1. ", "1... " or ""
    const cur = n === tree.current ? ' current' : ''
    return `<span class="pv-mv${cur}" data-node="${n.id}">${number}${markHtml(markOf?.(n))}${figHtml(formatSan(n.san, tree.moveNumber(n).whiteMove, view.notation))}</span>`
  }
}

/**
 * Left column: Maia's most likely moves at the selected Elo, with "Δ eval"
 * (José, iteration 5): how many pawns worse than Stockfish's best move each one
 * is (blank until Stockfish has evaluated it).
 */
export function renderMaiaCol(side: SideAnalysis | undefined, elo: number, count: number): string {
  const best = side && bestScore(side.classified)
  const rows = side?.maia
    ? side.maia.policy
        .slice(0, count)
        .map((p) => {
          const c = side.classified.get(p.uci)
          const delta = best && c ? deltaEval(best, c.score) : ''
          return `<tr${rowMove(p.uci)}><td>${chip(p.uci, sanOf(side.fen, p.uci), c?.color, shapeOf(p.prob))}${bookMark(side.fen, p.uci)}</td>${midCell(view.deltaCol, delta)}<td class="num">${pct(p.prob)}</td></tr>`
        })
        .join('')
    : `<tr><td colspan="3">${t('panel.calculating')}</td></tr>`
  // The header row is also the title: "Maia 1500 | Δ eval | prob" ("Δ eval" is not translated).
  return `<table><tr><th>Maia ${elo}</th>${midCell(view.deltaCol, 'Δ eval', 'th')}<th class="num">${t('panel.prob')}</th></tr>${rows}</table>`
}

/** Maia's probability for a move of the Stockfish column: "0%" if Maia doesn't list it, "…" before Maia answers. */
function maiaPct(side: SideAnalysis, uci: string): string {
  if (!side.maia) return '…'
  return pct(side.maia.policy.find((p) => p.uci === uci)?.prob ?? 0)
}

/** Right column: Stockfish's best lines — or the endgame tables' exact results — with Maia's probability of each move. */
export function renderSfCol(side: SideAnalysis | undefined, engineName: string): string {
  if (side?.tb) {
    const tb = side.tb
    const rows = side.lines
      .map((l) => {
        const uci = l.pv[0]
        const m = tb.moves.find((x) => x.uci === uci)
        const label = m ? tbLabel(m.score, m.outcome, m.cursed) : ''
        return `<tr${rowMove(uci)}><td>${chip(uci, sanOf(side.fen, uci), side.classified.get(uci)?.color, shapeIn(side, uci))}${bookMark(side.fen, uci)}</td>${midCell(view.maiaCol, maiaPct(side, uci))}<td class="num">${label}</td></tr>`
      })
      .join('')
    // "TB" (tablebase) instead of the long name, so the 3 columns fit (iteration 5).
    return `<table><tr><th>TB <small>Syzygy</small></th>${midCell(view.maiaCol, 'Maia', 'th')}<th class="num">${t('panel.result')}</th></tr>${rows}</table>`
  }
  const rows = side?.lines.length
    ? side.lines
        .map((l) => {
          const uci = l.pv[0]
          const c = side.classified.get(uci)
          return `<tr${rowMove(uci)}><td>${chip(uci, sanOf(side.fen, uci), c?.color, shapeIn(side, uci))}${bookMark(side.fen, uci)}</td>${midCell(view.maiaCol, maiaPct(side, uci))}<td class="num">${formatScore(lineScoreOf(l), 1)}</td></tr>`
        })
        .join('')
    : `<tr><td colspan="3">${t('panel.calculating')}</td></tr>`
  // Eval with one decimal in this column (José, iteration 5: saves space).
  // The header row is also the title: "SF d18 | Maia | eval". Middle column
  // (iteration 5): Maia's probability for each of Stockfish's moves.
  const depth = side?.depth ? ` <small>d${side.depth}</small>` : ''
  return `<table><tr><th>${engineName}${depth}</th>${midCell(view.maiaCol, 'Maia', 'th')}<th class="num">${t('panel.eval')}</th></tr>${rows}</table>`
}

/**
 * Opening book line at the start of the explanatory text (José, iteration 6):
 * "📖 Libro: e4 56% · d4 28% … — 72.599 partidas". (Which book it is — 2300+,
 * rapid and classical — is said in ⚙ and the help; José, 2026-10-26: it took
 * room without adding much.)
 * Moves with at least BOOK_MIN_SHARE of the games, coloured like the rest if
 * Stockfish already evaluated them. Empty when the position isn't in the book.
 */
export function renderBookLine(fen: string, a: PositionAnalysis | undefined): string {
  const moves = view.book?.(fen) ?? []
  if (!moves.length) return ''
  const classified = a?.main.fen === fen ? a.main.classified : undefined
  const games = moves.reduce((s, m) => s + m.games, 0)
  const items = moves
    .filter((m) => m.share >= BOOK_MIN_SHARE)
    .map((m) => `${chip(m.uci, sanOf(fen, m.uci), classified?.get(m.uci)?.color, a?.main.fen === fen ? shapeIn(a.main, m.uci) : undefined)} ${Math.round(m.share * 100)}%`)
    .join(' · ')
  const count = t('book.games', { n: games.toLocaleString(getLang()) })
  return `<div class="book-line">📖 <b>${t('book.title')}</b>: ${items} — ${count}</div>`
}

/**
 * First icon of each paragraph of the text, to tell at a glance what it is
 * about (José, 2026-10-26): 📖 the book, ♙ White, ♟ Black. U+FE0E asks for the
 * text glyph: iOS can otherwise draw ♟ as an emoji.
 */
const sideIcon = (white: boolean) => `<span class="fig side-icon">${white ? '♙' : '♟'}\uFE0E</span> `

/** The move that led to the current position, and the previous position's analysis if it was done. */
export interface PreviousMoveRef {
  fen: string // position before the move
  uci: string
  number: string // "12." or "12…"
  whiteMoved: boolean
  analysis?: PositionAnalysis
}

/**
 * A move already played (the previous move): coloured like the others but
 * never hidden by 🙈 (it is on the board already) and not clickable (it was
 * played from the previous position).
 */
const playedChip = (san: string, color: string, shape?: Shape) =>
  `<span class="move-chip shape-${shape ?? 'circle'}" style="--chip:${color}">${figHtml(san)}</span>`

/** Summary of the previous move (José, 2026-10-26), the last paragraph of the text. */
export function renderPreviousMove(ref: PreviousMoveRef | undefined, a: PositionAnalysis | undefined, elo: number): string {
  if (!ref) return ''
  const prev = ref.analysis?.main
  const best = prev?.lines[0]
  const current = a?.main.done ? a.main.lines[0] : undefined
  const segs: Segment[] = describePreviousMove({
    uci: ref.uci,
    san: ref.number + sanOf(ref.fen, ref.uci),
    whiteMoved: ref.whiteMoved,
    elo,
    inBook: !!view.book?.(ref.fen).some((m) => m.uci === ref.uci),
    prev: prevData(prev),
    currentBest: current && lineScoreOf(current),
  })
  if (!segs.length) return ''
  return `<div class="prev-move">${sideIcon(ref.whiteMoved)}${segs.map((s) => ('text' in s ? s.text : playedChip(s.san, s.color, shapeIn(prev, ref.uci)))).join('')}</div>`
}

/**
 * Explanatory text under the columns, in this order (José, 2026-10-26): the
 * PGN's comment on this move (✏️, if any), the book (if the position is in
 * it), the position (always, once analysed), the previous move (when there is
 * one and data for it).
 */
export function renderText(a: PositionAnalysis | undefined, elo: number, fen: string, previous?: PreviousMoveRef, comment?: string): string {
  const pgnComment = comment ? `<div class="pgn-comment">✏️ ${escapeHtml(comment)}</div>` : ''
  return pgnComment + renderBookLine(fen, a) + renderEnginesText(a, elo) + renderPreviousMove(previous, a, elo)
}

function renderEnginesText(a: PositionAnalysis | undefined, elo: number): string {
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
  const body = segs.map((s) => ('text' in s ? s.text : chip(s.move, s.san, s.color, shapeIn(m, s.move)))).join('')
  // About the side to move: its pawn first.
  const icon = sideIcon(m.fen.split(' ')[1] === 'w')
  return `<div class="side-text">${icon}${m.tb ? `<b>${t('panel.tbExact')}</b> ${body}` : body}</div>`
}
