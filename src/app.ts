/**
 * Interface v1: board + move list + Analysis panel (Maia, Stockfish, colour
 * code, Blunder Meter, threats, explanatory text).
 *
 * Design: task note, Investigation 3. Flow:
 *   startup → load Maia + Stockfish (download once, then cached) →
 *   every position change → Analyzer (cancels the previous one) → render.
 */
import { Chessground } from 'chessground'
import type { Api } from 'chessground/api'
import type { Key } from 'chessground/types'
import type { DrawShape } from 'chessground/draw'
import 'chessground/assets/chessground.base.css'
import 'chessground/assets/chessground.brown.css'
import 'chessground/assets/chessground.cburnett.css'
import './style.css'

import { Chess } from 'chess.js'
import { GameTree, type MoveNode } from './game/tree'
import { loadBook } from './book/openingBook'
import { MAX_DEPTH, MIN_DEPTH, MIN_THREAT_DEPTH, THREAT_OFFSET, autoDepth, autoThreatDepth } from './stockfish/autoDepth'
import { askChoice } from './ui/choice'
import { findNode, openGameView, refreshGameView } from './ui/gameView'
import type { PolyglotBook } from './book/polyglot'
import { gamePgn, parsePgnHeaders, treeFromPgn, type PgnHeaders } from './game/pgn'
import type { Notation } from './game/notation'
import { whiteWinProb } from './analysis/classify'
import { TablebaseClient } from './analysis/tablebase'
import { LANGUAGES, applyStaticTranslations, detectLang, setLang, t, type Lang, getLang } from './i18n/i18n'
import { MaiaClient } from './maia/maiaClient'
import { StockfishClient, type StockfishVariant } from './stockfish/stockfishClient'
import { Analyzer, type PositionAnalysis, type Settings } from './analysis/analyzer'
import { openEditor, retranslateEditor } from './ui/editor'
import { openGames, ownerName, retranslateGames } from './ui/gamesPanel'
import { userColor, type OnlineSite } from './games/common'
import { setViewOptions, markFrom, renderGameView, sanOf, type MarkOf, type PreviousMoveRef, renderMaiaCol, renderMeter, renderMoves, renderNumbers, renderSfCol, renderText } from './ui/render'

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T

// ---------------------------------------------------------------------------
// Settings (remembered in localStorage when available)
// ---------------------------------------------------------------------------


declare global {
  interface Window {
    /** Defined in index.html: applies "system" / "light" / "dark" (also before the first paint). */
    applyTheme(pref?: string): void
  }
}
const ELOS = Array.from({ length: 21 }, (_, i) => 600 + i * 100) // as maiachess
// Every depth, odd ones too (José, 2026-10-28: "solo dejas valores pares"), never below
// 10 (main) / 9 (threats): below that the analysis loses too much quality. "Auto" first.
const DEPTHS = Array.from({ length: MAX_DEPTH - MIN_DEPTH + 1 }, (_, i) => MIN_DEPTH + i)
const THREAT_DEPTHS = Array.from({ length: MAX_DEPTH - THREAT_OFFSET - MIN_THREAT_DEPTH + 1 }, (_, i) => MIN_THREAT_DEPTH + i)
const HASH_SIZES = [16, 32, 64, 128, 256] // MB
const LINE_COUNTS = [3, 4, 5, 6] // moves shown per engine column
/** h-eval candidates offered in ⚙ (0 = don't compute). */
const HEVAL_CANDIDATES = [0, 5, 10, 15, 20]
/**
 * Cores the browser reports. Stockfish uses min(4, cores) threads by default
 * (as before ⚙ had the option, 2026-10-26); ⚙ offers 1 … cores (at most 8).
 */
const CORES = Math.max(1, navigator.hardwareConcurrency || 1)
const SF_THREADS = Array.from({ length: Math.min(8, CORES) }, (_, i) => i + 1)
const DEFAULTS: AppSettings = {
  elo: 1500,
  depth: 'auto', // from the device's speed (stockfish/autoDepth.ts, José 2026-10-28)
  threatDepth: 'auto', // main depth − 3, at least 9
  lines: 4,
  threatsMode: 'moves', // José, iteration 3
  meterMode: 'bar', // top bar (Maia's moves): only the bar by default (José, iteration 5)
  deltaCol: true, // "Δ eval" column in the Maia panel (iteration 5, can be hidden)
  maiaCol: true, // "Maia" % column in the Stockfish panel (iteration 5, can be hidden)
  hevalCandidates: 10, // h-eval: Stockfish candidates at depth 6 (José, 2026-10-28); 0 = off
  hevalCol: true, // "h-eval" column in the Maia panel (can be hidden)
  hashMb: 16,
  sfThreads: Math.min(4, CORES), // ⚙ (José, 2026-10-26)
  theme: 'system', // ⚙ → Interfaz → Tema (José, 2026-10-28); applied by index.html
  variant: 'sf17',
  notation: 'figurine', // iteration 4: chess figurines by default
  evalBar: true, // iteration 4: thin vertical evaluation bar beside the board
  tablebase: true, // Lichess online endgame tables when ≤ 7 pieces (José: on by default)
  book: true, // opening book (Lichess 2300+, rapid and classical; iteration 6)
  lang: detectLang(), // device language if supported, otherwise English (José, 2026-10-25)
  lichessUser: '', // ⚙ / 📂: the board faces this player when opening their Lichess games
  chesscomUser: '', // same for Chess.com
}

/** Bumped when a default changes and saved settings must be migrated (see loadSettings). */
const SETTINGS_VERSION = 3

/** How threats are shown: bar + moves, only the moves (legend), or not computed. */
type ThreatsMode = 'bar' | 'moves' | 'off'
/** How the top bar (Maia's moves) is shown: bar + moves, only the bar, only the moves, or hidden. */
type MeterMode = 'both' | 'bar' | 'moves' | 'off'

/** Analysis settings + UI/engine settings, all editable in the ⚙ panel. */
interface AppSettings extends Omit<Settings, 'threats' | 'depth' | 'threatDepth'> {
  version?: number // settings format version (SETTINGS_VERSION)
  depth: number | 'auto' // main Stockfish depth; 'auto' = from the measured speed
  threatDepth: number | 'auto' // threats' depth; 'auto' = main depth − 3 (≥ 9)
  threatsMode: ThreatsMode
  meterMode: MeterMode
  deltaCol: boolean // show "Δ eval" in the Maia panel
  maiaCol: boolean // show Maia's % in the Stockfish panel
  hevalCol: boolean // show h-eval in the Maia panel
  hashMb: number // Stockfish hash (shared by the main analysis and the threats)
  sfThreads: number // Stockfish threads (Maia keeps min(4, cores))
  theme: 'system' | 'light' | 'dark'
  sfNps?: number // last speed test on this device (nodes per second), ⚙ → Motor
  variant: StockfishVariant // changing it reloads the page
  notation: Notation // move notation: figurine (♘f3) or letters (Nf3)
  evalBar: boolean // show the vertical evaluation bar
  book: boolean // use the opening book (📖)
  lang: Lang // UI language (⚙)
  lichessUser: string // Lichess username (⚙ and 📂 panel)
  chesscomUser: string // Chess.com username (⚙ and 📂 panel)
}

function loadSettings(): AppSettings {
  try {
    const saved = JSON.parse(localStorage.getItem('settings') ?? '{}')
    // Settings saved by iteration 2 had `threats: boolean` instead of `threatsMode`.
    if (saved.threatsMode === undefined && saved.threats === false) saved.threatsMode = 'off'
    delete saved.threats
    // Before settings version 2 the default threats mode was 'bar' and it was
    // saved with everything else: adopt the new default ('moves') once.
    if ((saved.version ?? 1) < 2 && saved.threatsMode === 'bar') delete saved.threatsMode
    // Version 3 (2026-10-28): depths can be "Auto". The old defaults (18 / 12) were saved like
    // any choice: they become Auto; a depth chosen by hand (e.g. José's 14) is kept.
    if ((saved.version ?? 1) < 3) {
      if (saved.depth === 18) delete saved.depth
      if (saved.threatDepth === 12) delete saved.threatDepth
    }
    saved.version = SETTINGS_VERSION
    return { ...DEFAULTS, ...saved }
  } catch {
    return { ...DEFAULTS }
  }
}

/** What the Analyzer needs from the app settings. */
/** The depths in use: the chosen ones, or "Auto" resolved from the measured speed. */
function engineDepths(): { depth: number; threatDepth: number } {
  const depth = settings.depth === 'auto' ? autoDepth(settings.sfNps) : settings.depth
  return { depth, threatDepth: settings.threatDepth === 'auto' ? autoThreatDepth(depth) : settings.threatDepth }
}
const analysisSettings = (): Settings => ({ ...settings, ...engineDepths(), threats: settings.threatsMode !== 'off' })
function saveSettings() {
  try {
    localStorage.setItem('settings', JSON.stringify(settings))
  } catch {
    /* private mode etc.: settings just won't persist */
  }
}
const settings = loadSettings()

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let tree = new GameTree()
// Opening book (iteration 6): loaded in the background after the engines; null until then or when off.
let openingBook: PolyglotBook | null = null
// PGN headers of the game on the board (from the PGN it was opened from; {} for
// a game made here) and its favourite id if it was saved with 📂 → 💾 Guardar.
let gameHeaders: PgnHeaders = {}
let savedId: string | undefined

/**
 * Measures Stockfish's speed on this device (1 s, ⚙ → Motor) and keeps it:
 * it sets the "Auto" depths. Done automatically the first time the engines are
 * ready, when the threads change, and with the "Medir" button.
 * `restart`: start the interrupted analysis again afterwards.
 */
async function measureSpeed(restart: boolean) {
  if (!enginesReady) return
  const button = $<HTMLButtonElement>('sfMeasure')
  button.disabled = true
  $('sfSpeed').textContent = t('set.sfSpeed.measuring')
  analyzer.cancel()
  try {
    settings.sfNps = await stockfish.benchmark(1000)
    saveSettings()
  } finally {
    button.disabled = false
    showSpeed()
    fillDepthSelects()
    if (restart) positionChanged()
  }
}

/** h-eval candidates (⚙ → Motor): "No calcular" (0) or how many Stockfish candidates. */
function fillHevalSelect() {
  $<HTMLSelectElement>('hevalCandidates').innerHTML = HEVAL_CANDIDATES.map((n) => `<option value="${n}">${n || t('set.heval.off')}</option>`).join('')
  $<HTMLSelectElement>('hevalCandidates').value = String(settings.hevalCandidates)
}

/** Depth selects: "Auto (N)" (N = what Auto means now on this device) and every depth. */
function fillDepthSelects() {
  const { depth, threatDepth } = engineDepths()
  const fill = (id: string, values: number[], chosen: number | 'auto', auto: number) => {
    const options = [`<option value="auto">${t('set.depth.auto', { n: auto })}</option>`, ...values.map((v) => `<option value="${v}">${v}</option>`)]
    $<HTMLSelectElement>(id).innerHTML = options.join('')
    $<HTMLSelectElement>(id).value = String(chosen)
  }
  fill('depth', DEPTHS, settings.depth, settings.depth === 'auto' ? depth : autoDepth(settings.sfNps))
  fill('threatDepth', THREAT_DEPTHS, settings.threatDepth, autoThreatDepth(depth))
}

/** Last measured Stockfish speed in ⚙ ("1.23 M nodos/s"), or "—" if never measured. */
function showSpeed() {
  $('sfSpeed').textContent = settings.sfNps ? t('set.sfSpeed.value', { n: (settings.sfNps / 1e6).toLocaleString(getLang(), { maximumFractionDigits: 2 }) }) : '—'
}

/** The panels under the top line: ⚙ settings and 📋 position/game. At most one is open. */
type Panel = 'settings' | 'positionPanel'
function showPanel(open: Panel | null) {
  for (const id of ['settings', 'positionPanel'] as const) $(id).hidden = id !== open
}
function togglePanel(panel: Panel) {
  showPanel($(panel).hidden ? panel : null)
}

/** A new game (editor, FEN, "Nueva partida"): forgets the headers and the saved favourite. */
function startNewGame(next: GameTree) {
  tree = next
  gameHeaders = {}
  savedId = undefined
}
let orientation: 'white' | 'black' = 'white'
let enginesReady = false
let hideMoves = false // training mode: 🙈 hides the moves, 💡 shows them again (not saved: always starts visible)
let analysis: PositionAnalysis | undefined // analysis of tree.current (may be partial)

const maia = new MaiaClient()
const stockfish = new StockfishClient()
const analyzer = new Analyzer(maia, stockfish, new TablebaseClient())

// ---------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------

const board: Api = Chessground($('board'), {
  movable: { free: false, showDests: true, events: { after: onBoardMove } },
  draggable: { showGhost: true },
  highlight: { lastMove: true, check: true },
  animation: { duration: 150 },
})
// Extra brush for the threat arrow, added to chessground's default brushes
// (DrawBrushes allows extra keys; the config type would require all defaults).
board.state.drawable.brushes.threat = { key: 'th', color: '#e67e22', opacity: 0.85, lineWidth: 8 }

/** Legal destinations for the side to move, in chessground's format. */
function legalDests(chess: Chess): Map<Key, Key[]> {
  const dests = new Map<Key, Key[]>()
  for (const m of chess.moves({ verbose: true })) {
    const from = m.from as Key
    dests.set(from, [...(dests.get(from) ?? []), m.to as Key])
  }
  return dests
}

/** A move made by dragging/tapping on the board. Promotions: always a queen (v1). */
function onBoardMove(orig: Key, dest: Key) {
  const chess = new Chess(tree.current.fen)
  const piece = chess.get(orig as Parameters<Chess['get']>[0])
  const promotes = piece?.type === 'p' && (dest[1] === '8' || dest[1] === '1')
  playMove(orig + dest + (promotes ? 'q' : ''))
}

/**
 * Plays a move from the current position. If the game already continues with a
 * different move there, asks (José, 2026-10-26): "Variante nueva" (added as a
 * variation, the main line untouched) or "Sobrescribir" (what followed is
 * deleted). Cancelling puts the board back.
 */
async function playMove(uci: string) {
  const here = tree.current
  if (here.children.length && !here.children.some((c) => c.uci === uci)) {
    const main = here.children[0]
    const choice = await askChoice(t('var.title', { move: numberedSan(main) }), [
      { label: t('var.new'), value: 'new' },
      { label: t('var.overwrite'), value: 'overwrite' },
    ])
    if (!choice) return updateBoard() // the piece goes back
    if (choice === 'overwrite') tree.clearContinuation()
  }
  if (tree.play(uci)) positionChanged()
  else updateBoard()
}

/** "12.♘f3" / "12…e5": a node's move as shown in the move list. */
function numberedSan(node: MoveNode): string {
  const { number, whiteMove } = tree.moveNumber(node)
  return `${number}${whiteMove ? '.' : '…'}${sanOf(node.parent!.fen, node.uci)}`
}

/** ▶: with several continuations, asks which one to follow (José, 2026-10-26). */
async function stepForward() {
  const options = tree.current.children
  if (options.length <= 1) return (tree.forward(), positionChanged())
  const chosen = await askChoice(
    t('var.choose'),
    options.map((c, i) => ({ label: numberedSan(c) + (i === 0 ? ` <small>(${t('var.main')})</small>` : ''), value: c })),
  )
  if (chosen) (tree.goTo(chosen), positionChanged())
}

/** Strip and game-view marks, from the analyses already in the cache (no engine work). */
const markOf: MarkOf = (node) =>
  node.parent ? markFrom(node, analyzer.cached(node.parent.fen, analysisSettings()), analyzer.cached(node.fen, analysisSettings())) : undefined

/** Arrows: red = Maia's most likely move, blue = Stockfish's best move, orange = threat. */
function arrows(): DrawShape[] {
  const shapes: DrawShape[] = []
  if (hideMoves) return shapes // arrows would give the moves away
  const m = analysis?.main
  const maiaTop = m?.maia?.policy[0]?.uci
  const sfTop = m?.lines[0]?.pv[0]
  const arrow = (uci: string, brush: string, lineWidth?: number): DrawShape => ({
    orig: uci.slice(0, 2) as Key,
    dest: uci.slice(2, 4) as Key,
    brush,
    modifiers: lineWidth ? { lineWidth } : undefined,
  })
  // Threat: the opponent's best move if it were their turn (orange, thinner, under the others).
  const threat = analysis?.threats?.lines[0]?.pv[0]
  if (threat && settings.threatsMode !== 'off') shapes.push(arrow(threat, 'threat'))
  if (sfTop) shapes.push(arrow(sfTop, 'blue'))
  // Drawn after (on top of) Stockfish's; thinner when both are the same move,
  // so the red line shows inside the blue one.
  if (maiaTop) shapes.push(arrow(maiaTop, 'red', maiaTop === sfTop ? 5 : undefined))
  return shapes
}

function updateBoard() {
  const node = tree.current
  const chess = new Chess(node.fen)
  const turn = chess.turn() === 'w' ? 'white' : 'black'
  board.set({
    fen: node.fen,
    orientation,
    turnColor: turn,
    check: chess.inCheck(),
    lastMove: node.uci ? [node.uci.slice(0, 2) as Key, node.uci.slice(2, 4) as Key] : undefined,
    movable: { color: turn, dests: legalDests(chess) },
  })
  board.setAutoShapes(arrows())
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/**
 * Vertical evaluation bar (optional): the white part's height = Stockfish's
 * expected score for White; the red mark = Maia's win probability for White.
 * White sits at the bottom when the board is seen from White's side.
 */
function renderEvalBar() {
  const bar = $('evalBarEl')
  bar.hidden = !settings.evalBar
  if (!settings.evalBar) return
  const m = analysis?.main
  const best = m?.lines[0]
  const sf = best ? whiteWinProb(best.mate !== undefined ? { mate: best.mate } : { cp: best.scoreCp }) : 0.5
  const maiaWp = m?.maia?.whiteWinProb
  bar.classList.toggle('black-bottom', orientation === 'black')
  bar.style.setProperty('--white-pos', `${(sf * 100).toFixed(1)}%`)
  bar.style.setProperty('--maia-pos', maiaWp === undefined ? '-100%' : `${(maiaWp * 100).toFixed(1)}%`)
}

/** The move that led here and the previous position's analysis, if it was done (for the text). */
function previousMove(): PreviousMoveRef | undefined {
  const node = tree.current
  if (!node.parent) return undefined
  const { number, whiteMove } = tree.moveNumber(node)
  return {
    fen: node.parent.fen,
    uci: node.uci,
    number: whiteMove ? `${number}.` : `${number}…`,
    whiteMoved: whiteMove,
    analysis: analyzer.cached(node.parent.fen, analysisSettings()),
  }
}

function renderPanel() {
  setViewOptions({
    notation: settings.notation,
    hideMoves,
    deltaCol: settings.deltaCol,
    maiaCol: settings.maiaCol,
    hevalCol: settings.hevalCol && settings.hevalCandidates > 0,
    book: settings.book && openingBook ? (fen) => openingBook!.lookup(fen) : undefined,
  })
  $('numbers').innerHTML = renderNumbers(analysis)
  renderEvalBar()
  // Top bar: it's still computed when hidden (the columns and arrows need it).
  $('meterMain').hidden = settings.meterMode === 'off'
  $('meterMain').innerHTML = renderMeter(analysis?.main, '', settings.meterMode !== 'moves', settings.meterMode !== 'bar')
  // data-done marks a block whose analysis is complete (used by scripts/ui-test.mjs).
  $('meterMain').dataset.done = String(!!analysis?.main.done)
  $('meterThreats').dataset.done = String(analysis?.threats === null || !!analysis?.threats?.done)
  $('meterThreats').hidden = settings.threatsMode === 'off'
  $('meterThreats').innerHTML = renderMeter(
    analysis?.threats,
    t('panel.threatsInCheck'),
    settings.threatsMode === 'bar', // 'moves' → only the legend line, no bar
  )
  $('maiaCol').innerHTML = renderMaiaCol(analysis?.main, settings.elo, settings.lines)
  $('sfCol').innerHTML = renderSfCol(analysis?.main, settings.variant === 'sf17' ? 'SF' : t('panel.sfClassic')) // or the endgame tables
  $('text').innerHTML = renderText(analysis, settings.elo, tree.current.fen, previousMove(), tree.current.comment)
  // A finished analysis can give the strip (and the game view) a new mark.
  if (analysis?.main.done) renderMoveStrip()
  refreshGameView()
  board.setAutoShapes(arrows())
}

function renderMoveStrip() {
  setViewOptions({ notation: settings.notation, hideMoves })
  const el = $('moves')
  el.innerHTML = renderMoves(tree, markOf)
  // Centre the current move by scrolling ONLY the strip. scrollIntoView() also
  // scrolled the whole page sideways on the iPhone (the eval bar went off screen,
  // José 2026-10-25), so it is not used here.
  const cur = el.querySelector<HTMLElement>('.current')
  if (cur) {
    const strip = el.getBoundingClientRect()
    const r = cur.getBoundingClientRect()
    el.scrollLeft += r.left + r.width / 2 - (strip.left + strip.width / 2)
  }
}

/** Called after every move / navigation / settings change. */
function positionChanged() {
  analysis = undefined
  updateBoard()
  renderMoveStrip()
  renderPanel()
  runAnalysis()
}

function runAnalysis() {
  analyzer.cancel()
  if (!enginesReady) return
  const fen = tree.current.fen
  const chess = new Chess(fen)
  if (chess.isGameOver()) {
    $('text').textContent = t(chess.isCheckmate() ? 'panel.checkmate' : 'panel.draw')
    return
  }
  void analyzer.analyse(fen, analysisSettings(), (a) => {
    if (fen !== tree.current.fen) return // stale update from a previous position
    analysis = a
    renderPanel()
  })
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

function fillSelect(id: string, values: number[], selected: number, label: (v: number) => string) {
  $<HTMLSelectElement>(id).innerHTML = values
    .map((v) => `<option value="${v}" ${v === selected ? 'selected' : ''}>${label(v)}</option>`)
    .join('')
}

function setupControls() {
  fillSelect('elo', ELOS, settings.elo, (v) => String(v))
  fillDepthSelects()
  fillHevalSelect()
  $('hevalCandidates').onchange = (ev) => {
    settings.hevalCandidates = Number((ev.target as HTMLSelectElement).value)
    saveSettings()
    positionChanged()
  }
  fillSelect('hashMb', HASH_SIZES, settings.hashMb, (v) => `${v} MB`)
  fillSelect('sfThreads', SF_THREADS, Math.min(settings.sfThreads, CORES), (v) => String(v))
  $('sfThreadsCores').textContent = t('set.sfThreads.cores', { n: CORES })
  $<HTMLSelectElement>('variant').value = settings.variant
  fillSelect('lines', LINE_COUNTS, settings.lines, (v) => String(v))
  $<HTMLSelectElement>('threatsMode').value = settings.threatsMode
  $<HTMLSelectElement>('meterMode').value = settings.meterMode
  $<HTMLSelectElement>('notation').value = settings.notation
  $<HTMLInputElement>('evalBar').checked = settings.evalBar
  // Middle columns of the panels (iteration 5): on/off, only redraw needed.
  // (checkbox ids "show…": "maiaCol" is already the Maia panel's id)
  const COL_SETTING = { deltaCol: 'showDeltaCol', maiaCol: 'showMaiaCol', hevalCol: 'showHevalCol' } as const
  for (const [key, id] of Object.entries(COL_SETTING) as [keyof typeof COL_SETTING, string][]) {
    $<HTMLInputElement>(id).checked = settings[key]
    $(id).onchange = (ev) => {
      settings[key] = (ev.target as HTMLInputElement).checked
      saveSettings()
      renderPanel()
    }
  }
  $<HTMLInputElement>('tablebase').checked = settings.tablebase
  $<HTMLInputElement>('book').checked = settings.book
  $('book').onchange = (ev) => {
    settings.book = (ev.target as HTMLInputElement).checked
    saveSettings()
    if (settings.book) void loadOpeningBook()
    renderPanel()
  }
  // Usernames per site (also editable in the 📂 panel; same saved values).
  const USER_SETTING: Record<OnlineSite, { key: 'lichessUser' | 'chesscomUser'; input: string }> = {
    lichess: { key: 'lichessUser', input: 'lichessUserSetting' },
    chesscom: { key: 'chesscomUser', input: 'chesscomUserSetting' },
  }
  for (const { key, input } of Object.values(USER_SETTING)) {
    $<HTMLInputElement>(input).value = settings[key]
    $(input).onchange = (ev) => {
      settings[key] = (ev.target as HTMLInputElement).value.trim()
      saveSettings()
    }
  }
  // 📂 Lichess / Chess.com games: open one at the initial position, board facing
  // the user whose username is set (José: "always oriented for that player").
  $('gamesBtn').onclick = () => {
    showPanel(null)
    analyzer.cancel()
    openGames({
      getUser: (site) => settings[USER_SETTING[site].key],
      setUser: (site, name) => {
        settings[USER_SETTING[site].key] = name
        $<HTMLInputElement>(USER_SETTING[site].input).value = name
        saveSettings()
      },
      onPick: (game) => {
        try {
          tree = treeFromPgn(game.pgn)
        } catch {
          alert(t('msg.invalidFen'))
          return
        }
        gameHeaders = parsePgnHeaders(game.pgn)
        savedId = game.site === 'local' ? game.id : undefined
        orientation = userColor(game, ownerName(game, (s) => settings[USER_SETTING[s].key])) ?? 'white'
        positionChanged()
        renderEvalBar()
      },
      current: () => ({ headers: gameHeaders, savedId }),
      buildPgn: (headers) => gamePgn(tree, new Date(), headers),
      onSaved: (id, headers) => {
        savedId = id
        gameHeaders = headers
      },
    })
  }

  // Language: re-translate the static texts and redraw everything generated in code.
  $<HTMLSelectElement>('lang').innerHTML = LANGUAGES.map((l) => `<option value="${l.code}">${l.flag} ${l.name}</option>`).join('')
  $<HTMLSelectElement>('lang').value = settings.lang
  $('lang').onchange = (ev) => {
    settings.lang = (ev.target as HTMLSelectElement).value as Lang
    saveSettings()
    setLang(settings.lang)
    applyStaticTranslations()
    $('sfThreadsCores').textContent = t('set.sfThreads.cores', { n: CORES }) // generated text, not in the HTML
    showSpeed()
    fillDepthSelects() // "Auto (N)" is translated
    fillHevalSelect()
    $('hideMoves').title = t(hideMoves ? 'btn.show' : 'btn.hide')
    $('hideMoves').setAttribute('aria-label', $('hideMoves').title)
    retranslateEditor()
    retranslateGames()
    renderMoveStrip()
    renderPanel()
  }
  $('tablebase').onchange = (ev) => {
    settings.tablebase = (ev.target as HTMLInputElement).checked
    saveSettings()
    positionChanged()
  }
  $('notation').onchange = (ev) => {
    settings.notation = (ev.target as HTMLSelectElement).value as Notation
    saveSettings()
    renderMoveStrip()
    renderPanel()
  }
  $('evalBar').onchange = (ev) => {
    settings.evalBar = (ev.target as HTMLInputElement).checked
    saveSettings()
    renderEvalBar()
    board.redrawAll() // the board width changes when the bar appears/disappears
  }

  const onNumber = (key: 'elo' | 'lines') => (ev: Event) => {
    settings[key] = Number((ev.target as HTMLSelectElement).value)
    saveSettings()
    positionChanged()
  }
  // Depths: a number, or "auto" (from the measured speed).
  const onDepth = (key: 'depth' | 'threatDepth') => (ev: Event) => {
    const v = (ev.target as HTMLSelectElement).value
    settings[key] = v === 'auto' ? 'auto' : Number(v)
    saveSettings()
    fillDepthSelects() // "Auto (N)" of the threats follows the main depth
    positionChanged()
  }
  $('elo').onchange = onNumber('elo')
  $('depth').onchange = onDepth('depth')
  $('threatDepth').onchange = onDepth('threatDepth')
  $('lines').onchange = onNumber('lines')
  $('meterMode').onchange = (ev) => {
    settings.meterMode = (ev.target as HTMLSelectElement).value as MeterMode
    saveSettings()
    renderPanel() // display only: the analysis doesn't change
  }
  $('threatsMode').onchange = (ev) => {
    settings.threatsMode = (ev.target as HTMLSelectElement).value as ThreatsMode
    saveSettings()
    positionChanged()
  }
  $('hashMb').onchange = async (ev) => {
    settings.hashMb = Number((ev.target as HTMLSelectElement).value)
    saveSettings()
    analyzer.cancel()
    await stockfish.configure([`setoption name Hash value ${settings.hashMb}`]) // waits for the engine to be idle
    positionChanged()
  }
  // Theme: the function lives in index.html (it also runs before the first paint).
  $<HTMLSelectElement>('theme').value = settings.theme
  $('theme').onchange = (ev) => {
    settings.theme = (ev.target as HTMLSelectElement).value as AppSettings['theme']
    saveSettings()
    window.applyTheme(settings.theme)
  }
  // Speed test (José, 2026-10-28): Stockfish searches a middlegame for 1 s with the
  // current threads; the result (nodes per second) is shown and kept.
  showSpeed()
  $('sfMeasure').onclick = () => void measureSpeed(true)
  // Threads can change while the engine is loaded (UCI "Threads"), like the hash.
  $('sfThreads').onchange = async (ev) => {
    settings.sfThreads = Number((ev.target as HTMLSelectElement).value)
    saveSettings()
    analyzer.cancel()
    await stockfish.configure([`setoption name Threads value ${settings.sfThreads}`])
    await measureSpeed(true) // the speed (and "Auto" depth) depends on the threads
  }
  // A different Stockfish build means loading another WASM module: simplest is a reload.
  $('variant').onchange = (ev) => {
    settings.variant = (ev.target as HTMLSelectElement).value as StockfishVariant
    saveSettings()
    location.reload()
  }

  $('first').onclick = () => (tree.toStart(), positionChanged())
  $('prev').onclick = () => (tree.back(), positionChanged())
  $('next').onclick = () => void stepForward()
  // 📜 The whole game, large: tap a move to go there (José, 2026-10-26).
  $('gameViewBtn').onclick = () =>
    openGameView({
      render: () => renderGameView(tree, gameHeaders, markOf),
      goTo: (id) => {
        const node = findNode(tree.root, id)
        if (node) (tree.goTo(node), positionChanged())
      },
    })
  $('last').onclick = () => (tree.toEnd(), positionChanged())
  document.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement).tagName === 'INPUT') return
    if (e.key === 'ArrowLeft') $('prev').click()
    if (e.key === 'ArrowRight') $('next').click()
  })

  $('flip').onclick = () => {
    orientation = orientation === 'white' ? 'black' : 'white'
    updateBoard()
    renderEvalBar()
  }
  // 🙈 (moves visible) hides the suggested moves but keeps the evaluations;
  // 💡 (moves hidden) shows them again. José: the eye "seemed to be watching me".
  $('hideMoves').onclick = () => {
    hideMoves = !hideMoves
    const btn = $('hideMoves')
    btn.textContent = hideMoves ? '💡' : '🙈'
    const label = t(hideMoves ? 'btn.show' : 'btn.hide')
    btn.title = label
    btn.setAttribute('aria-label', label)
    btn.setAttribute('aria-pressed', String(hideMoves))
    renderPanel()
  }
  // Export the whole game with its variations: the iPhone share sheet
  // (copy, Notes, Mail, other apps…) or, where not available, the clipboard.
  $('exportPgn').onclick = async () => {
    const pgn = gamePgn(tree, new Date(), gameHeaders) // keeps the headers of an opened game
    try {
      if (navigator.share) await navigator.share({ title: t('pgn.title'), text: pgn })
      else {
        await navigator.clipboard.writeText(pgn)
        alert(t('msg.pgnCopied'))
      }
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return // user closed the share sheet
      await navigator.clipboard.writeText(pgn).catch(() => undefined)
      alert(t('msg.pgnCopied'))
    }
  }
  // Same URL format as task_01: FEN with "_" instead of spaces.
  $('lichess').onclick = () =>
    window.open(`https://lichess.org/analysis/${tree.current.fen.replace(/ /g, '_')}?color=${orientation}`, '_blank')

  // Footer link "Ver créditos: ⚙ > Créditos y licencias": open ⚙ with the credits unfolded.
  $('openCredits').onclick = (e) => {
    e.preventDefault()
    showPanel('settings')
    $<HTMLDetailsElement>('creditsDetails').open = true
    $('creditsDetails').scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  $('menu').onclick = () => togglePanel('settings')
  // 📋 Position and game (José, 2026-10-26): FEN, editor, new game, PGN.
  $('positionBtn').onclick = () => {
    $<HTMLInputElement>('fenInput').value = tree.current.fen
    togglePanel('positionPanel')
  }
  // Position editor (full screen): starts from the current position; "Analizar"
  // starts a new game from the edited position, like "Cargar FEN".
  $('editPosition').onclick = () => {
    showPanel(null)
    analyzer.cancel() // no engine work while editing
    openEditor(tree.current.fen, orientation, (fen) => {
      startNewGame(new GameTree(fen))
      positionChanged()
    })
  }
  $('loadFen').onclick = () => {
    try {
      startNewGame(new GameTree($<HTMLInputElement>('fenInput').value.trim()))
      showPanel(null)
      positionChanged()
    } catch {
      alert(t('msg.invalidFen'))
    }
  }
  $('newGame').onclick = () => {
    startNewGame(new GameTree())
    showPanel(null)
    positionChanged()
  }

  // One listener for every clickable move (panel) and every move in the strip.
  document.querySelector('.panel-col')!.addEventListener('click', (e) => {
    const target = e.target as HTMLElement
    const move = target.closest<HTMLElement>('[data-move]')?.dataset.move
    if (move) return playMove(move)
    const nodeId = target.closest<HTMLElement>('[data-node]')?.dataset.node
    if (nodeId) {
      const node = tree.displayLine().find((n) => String(n.id) === nodeId)
      if (node) (tree.goTo(node), positionChanged())
    }
  })
}

// ---------------------------------------------------------------------------
// Engine loading (first visit downloads ~125 MB, then it comes from the cache)
// ---------------------------------------------------------------------------

async function loadEngines() {
  const status = $('status')
  const progress = { maia: 0, sf: 0 }
  const show = () => {
    // Weighted by download size (classic Stockfish downloads nothing extra).
    const sfMb = settings.variant === 'sf17' ? 78.4 : 0
    const total = (progress.maia * 45.7 + progress.sf * sfMb) / (45.7 + sfMb)
    status.innerHTML = `${t('msg.loading', { pct: Math.round(total * 100) })} <progress value="${total}"></progress>`
  }
  show()
  try {
    await Promise.all([
      maia.init(Math.min(4, CORES), (f) => ((progress.maia = f), show())),
      stockfish.init(settings.variant, Math.min(settings.sfThreads, CORES), settings.hashMb, (f) => ((progress.sf = f), show())),
    ])
    status.textContent = ''
    enginesReady = true
    // First time on this device: measure the speed (1 s) so "Auto" depths fit it.
    if (!settings.sfNps) await measureSpeed(false)
    runAnalysis()
    if (settings.book) void loadOpeningBook() // after the engines: they matter more on a first visit
  } catch (e) {
    status.textContent = t('msg.loadError', { detail: e instanceof Error ? e.message : String(e) })
  }
}

/**
 * Downloads the opening book once (then IndexedDB) and redraws. A failure only
 * means no 📖: the analysis works the same without it.
 */
async function loadOpeningBook() {
  if (openingBook) return
  try {
    openingBook = await loadBook()
    renderPanel()
  } catch (e) {
    console.warn('opening book not available', e)
  }
}

// No zoom (iteration 4): iOS Safari ignores user-scalable=no, so block its pinch
// gestures here; double-tap zoom is disabled with `touch-action: manipulation` (CSS).
for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(type, (e) => e.preventDefault(), { passive: false })
}

setLang(settings.lang)
applyStaticTranslations()
setupControls()
positionChanged()
void loadEngines()
