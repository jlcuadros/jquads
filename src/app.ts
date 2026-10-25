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
import { GameTree } from './game/tree'
import { gamePgn, treeFromPgn } from './game/pgn'
import type { Notation } from './game/notation'
import { whiteWinProb } from './analysis/classify'
import { TablebaseClient } from './analysis/tablebase'
import { LANGUAGES, applyStaticTranslations, detectLang, setLang, t, type Lang } from './i18n/i18n'
import { MaiaClient } from './maia/maiaClient'
import { StockfishClient, type StockfishVariant } from './stockfish/stockfishClient'
import { Analyzer, type PositionAnalysis, type Settings } from './analysis/analyzer'
import { openEditor, retranslateEditor } from './ui/editor'
import { openGames, retranslateGames } from './ui/gamesPanel'
import { userColor } from './lichess/games'
import { setViewOptions, renderMaiaCol, renderMeter, renderMoves, renderNumbers, renderSfCol, renderText } from './ui/render'

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T

// ---------------------------------------------------------------------------
// Settings (remembered in localStorage when available)
// ---------------------------------------------------------------------------

const ELOS = Array.from({ length: 21 }, (_, i) => 600 + i * 100) // as maiachess
const DEPTHS = [10, 12, 14, 16, 18, 20, 22, 24]
const THREAT_DEPTHS = [8, 10, 12, 14, 16]
const HASH_SIZES = [16, 32, 64, 128, 256] // MB
const LINE_COUNTS = [3, 4, 5, 6] // moves shown per engine column
const DEFAULTS: AppSettings = {
  elo: 1500,
  depth: 18,
  threatDepth: 12,
  lines: 4,
  threatsMode: 'moves', // José, iteration 3
  hashMb: 16,
  variant: 'sf17',
  notation: 'figurine', // iteration 4: chess figurines by default
  evalBar: true, // iteration 4: thin vertical evaluation bar beside the board
  tablebase: true, // Lichess online endgame tables when ≤ 7 pieces (José: on by default)
  lang: detectLang(), // device language if supported, otherwise English (José, 2026-10-25)
  lichessUser: '', // ⚙ / 📂: the board faces this player when opening their Lichess games
}

/** Bumped when a default changes and saved settings must be migrated (see loadSettings). */
const SETTINGS_VERSION = 2

/** How threats are shown: bar + moves, only the moves (legend), or not computed. */
type ThreatsMode = 'bar' | 'moves' | 'off'

/** Analysis settings + UI/engine settings, all editable in the ⚙ panel. */
interface AppSettings extends Omit<Settings, 'threats'> {
  version?: number // settings format version (SETTINGS_VERSION)
  threatsMode: ThreatsMode
  hashMb: number // Stockfish hash (shared by the main analysis and the threats)
  variant: StockfishVariant // changing it reloads the page
  notation: Notation // move notation: figurine (♘f3) or letters (Nf3)
  evalBar: boolean // show the vertical evaluation bar
  lang: Lang // UI language (⚙)
  lichessUser: string // Lichess username (⚙ and 📂 panel)
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
    saved.version = SETTINGS_VERSION
    return { ...DEFAULTS, ...saved }
  } catch {
    return { ...DEFAULTS }
  }
}

/** What the Analyzer needs from the app settings. */
const analysisSettings = (): Settings => ({ ...settings, threats: settings.threatsMode !== 'off' })
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

function playMove(uci: string) {
  if (tree.play(uci)) positionChanged()
}

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

function renderPanel() {
  setViewOptions({ notation: settings.notation, hideMoves })
  $('numbers').innerHTML = renderNumbers(analysis)
  renderEvalBar()
  $('meterMain').innerHTML = renderMeter(analysis?.main, '')
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
  $('sfCol').innerHTML = renderSfCol(analysis?.main, settings.variant === 'sf17' ? 'Stockfish 17' : t('panel.sfClassic')) // or the endgame tables
  $('text').innerHTML = renderText(analysis, settings.elo)
  board.setAutoShapes(arrows())
}

function renderMoveStrip() {
  setViewOptions({ notation: settings.notation, hideMoves })
  const el = $('moves')
  el.innerHTML = renderMoves(tree)
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
  fillSelect('depth', DEPTHS, settings.depth, (v) => String(v))
  fillSelect('threatDepth', THREAT_DEPTHS, settings.threatDepth, (v) => String(v))
  fillSelect('hashMb', HASH_SIZES, settings.hashMb, (v) => `${v} MB`)
  $<HTMLSelectElement>('variant').value = settings.variant
  fillSelect('lines', LINE_COUNTS, settings.lines, (v) => String(v))
  $<HTMLSelectElement>('threatsMode').value = settings.threatsMode
  $<HTMLSelectElement>('notation').value = settings.notation
  $<HTMLInputElement>('evalBar').checked = settings.evalBar
  $<HTMLInputElement>('tablebase').checked = settings.tablebase
  // Lichess username (also editable in the 📂 panel; same saved value).
  $<HTMLInputElement>('lichessUserSetting').value = settings.lichessUser
  $('lichessUserSetting').onchange = (ev) => {
    settings.lichessUser = (ev.target as HTMLInputElement).value.trim()
    saveSettings()
  }
  // 📂 Lichess games: open one at the initial position, board facing the user
  // whose username is set (José: "always oriented for that player").
  $('gamesBtn').onclick = () => {
    $('settings').hidden = true
    analyzer.cancel()
    openGames({
      getUser: () => settings.lichessUser,
      setUser: (name) => {
        settings.lichessUser = name
        $<HTMLInputElement>('lichessUserSetting').value = name
        saveSettings()
      },
      onPick: (game) => {
        try {
          tree = treeFromPgn(game.pgn)
        } catch {
          alert(t('msg.invalidFen'))
          return
        }
        orientation = userColor(game, settings.lichessUser) ?? 'white'
        positionChanged()
        renderEvalBar()
      },
    })
  }

  // Language: re-translate the static texts and redraw everything generated in code.
  $<HTMLSelectElement>('lang').innerHTML = LANGUAGES.map((l) => `<option value="${l.code}">${l.name}</option>`).join('')
  $<HTMLSelectElement>('lang').value = settings.lang
  $('lang').onchange = (ev) => {
    settings.lang = (ev.target as HTMLSelectElement).value as Lang
    saveSettings()
    setLang(settings.lang)
    applyStaticTranslations()
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

  const onNumber = (key: 'elo' | 'depth' | 'threatDepth' | 'lines') => (ev: Event) => {
    settings[key] = Number((ev.target as HTMLSelectElement).value)
    saveSettings()
    positionChanged()
  }
  $('elo').onchange = onNumber('elo')
  $('depth').onchange = onNumber('depth')
  $('threatDepth').onchange = onNumber('threatDepth')
  $('lines').onchange = onNumber('lines')
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
  // A different Stockfish build means loading another WASM module: simplest is a reload.
  $('variant').onchange = (ev) => {
    settings.variant = (ev.target as HTMLSelectElement).value as StockfishVariant
    saveSettings()
    location.reload()
  }

  $('first').onclick = () => (tree.toStart(), positionChanged())
  $('prev').onclick = () => (tree.back(), positionChanged())
  $('next').onclick = () => (tree.forward(), positionChanged())
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
    const pgn = gamePgn(tree)
    try {
      if (navigator.share) await navigator.share({ title: t('pgn.title'), text: pgn })
      else {
        await navigator.clipboard.writeText(pgn)
        alert('PGN copiado al portapapeles')
      }
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return // user closed the share sheet
      await navigator.clipboard.writeText(pgn).catch(() => undefined)
      alert('PGN copiado al portapapeles')
    }
  }
  // Same URL format as task_01: FEN with "_" instead of spaces.
  $('lichess').onclick = () =>
    window.open(`https://lichess.org/analysis/${tree.current.fen.replace(/ /g, '_')}?color=${orientation}`, '_blank')

  // Footer link "Ver créditos: ⚙ > Créditos y licencias": open ⚙ with the credits unfolded.
  $('openCredits').onclick = (e) => {
    e.preventDefault()
    $('settings').hidden = false
    $<HTMLDetailsElement>('creditsDetails').open = true
    $('creditsDetails').scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  $('menu').onclick = () => {
    const s = $('settings')
    s.hidden = !s.hidden
    $<HTMLInputElement>('fenInput').value = tree.current.fen
  }
  // Position editor (full screen): starts from the current position; "Analizar"
  // starts a new game from the edited position, like "Cargar FEN".
  $('editPosition').onclick = () => {
    $('settings').hidden = true
    analyzer.cancel() // no engine work while editing
    openEditor(tree.current.fen, orientation, (fen) => {
      tree = new GameTree(fen)
      positionChanged()
    })
  }
  $('loadFen').onclick = () => {
    try {
      tree = new GameTree($<HTMLInputElement>('fenInput').value.trim())
      $('settings').hidden = true
      positionChanged()
    } catch {
      alert(t('msg.invalidFen'))
    }
  }
  $('newGame').onclick = () => {
    tree = new GameTree()
    $('settings').hidden = true
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
  const threads = Math.min(4, navigator.hardwareConcurrency || 1)
  try {
    await Promise.all([
      maia.init(threads, (f) => ((progress.maia = f), show())),
      stockfish.init(settings.variant, threads, settings.hashMb, (f) => ((progress.sf = f), show())),
    ])
    status.textContent = ''
    enginesReady = true
    runAnalysis()
  } catch (e) {
    status.textContent = t('msg.loadError', { detail: e instanceof Error ? e.message : String(e) })
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
