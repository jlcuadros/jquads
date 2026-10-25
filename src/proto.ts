/**
 * Prototype 0: does Maia-3 + Stockfish run in this browser (especially iPhone Safari)?
 *
 * A diagnostics page, not the real UI: it loads both engines, analyses one FEN and
 * logs timings, so we can compare devices. Everything measured is also stored in
 * `window.__proto` for the automated WebKit/Chromium smoke test
 * (scripts/smoke-test.mjs). Served at /proto.html.
 *
 * URL parameters (handy on the phone):
 *   ?auto=1          run load Maia → load Stockfish → analyse automatically
 *   &sf=sfhce        Stockfish variant (sf17 | sfhce)
 *   &threads=2       engine threads      &depth=14   Stockfish depth
 */
import { Chess } from 'chess.js'
import { MaiaClient } from './maia/maiaClient'
import { StockfishClient, type EngineLine, type StockfishVariant } from './stockfish/stockfishClient'
import { clearCache } from './lib/cache'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const params = new URLSearchParams(location.search)

// Elo values offered by maiachess.com: 600..2600 in steps of 100.
const ELOS = Array.from({ length: 21 }, (_, i) => 600 + i * 100)
const DEFAULT_FEN = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3'

/** Results collected for the smoke test and for copying into the task note. */
const results: Record<string, unknown> = {}
;(window as unknown as { __proto: typeof results }).__proto = results

const maia = new MaiaClient()
const stockfish = new StockfishClient()
let maiaReady = false
let sfReady = false

// ---------------------------------------------------------------------------
// Small UI helpers
// ---------------------------------------------------------------------------

function log(msg: string) {
  const line = `${(performance.now() / 1000).toFixed(1)}s  ${msg}`
  $('log').textContent += line + '\n'
  console.log(line)
}

function setProgress(fraction: number | null) {
  const bar = $<HTMLProgressElement>('progress')
  bar.hidden = fraction === null
  if (fraction !== null) bar.value = fraction
}

/** UCI → SAN on the given position ("g1f3" → "Nf3"); falls back to UCI. */
function san(fen: string, uci: string): string {
  try {
    return new Chess(fen).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san
  } catch {
    return uci
  }
}

/** A whole PV in SAN, played move by move. */
function pvSan(fen: string, pv: string[], max = 6): string {
  const board = new Chess(fen)
  const out: string[] = []
  for (const uci of pv.slice(0, max)) {
    try {
      out.push(board.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san)
    } catch {
      break
    }
  }
  return out.join(' ')
}

function formatScore(l: EngineLine): string {
  if (l.mate !== undefined) return `${l.mate > 0 ? '+' : '-'}M${Math.abs(l.mate)}`
  const pawns = (l.scoreCp ?? 0) / 100
  return (pawns >= 0 ? '+' : '') + pawns.toFixed(2)
}

const fmtMs = (ms: number) => `${(ms / 1000).toFixed(2)} s`

// ---------------------------------------------------------------------------
// Diagnostics: what this browser supports
// ---------------------------------------------------------------------------

function renderDiagnostics() {
  const nav = navigator as Navigator & { deviceMemory?: number }
  const rows: Array<[string, string, boolean?]> = [
    ['crossOriginIsolated', String(self.crossOriginIsolated), self.crossOriginIsolated],
    ['SharedArrayBuffer', String(typeof SharedArrayBuffer !== 'undefined'), typeof SharedArrayBuffer !== 'undefined'],
    ['Núcleos (hardwareConcurrency)', String(navigator.hardwareConcurrency)],
    ['Memoria (deviceMemory)', nav.deviceMemory ? `${nav.deviceMemory} GB` : 'n/d (Safari no lo expone)'],
    ['Navegador', navigator.userAgent],
  ]
  $('diag').innerHTML = rows
    .map(([k, v, ok]) => `<tr><th>${k}</th><td class="${ok === undefined ? '' : ok ? 'ok' : 'bad'}">${v}</td></tr>`)
    .join('')
  results.diagnostics = Object.fromEntries(rows.map(([k, v]) => [k, v]))
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

async function loadMaia() {
  log('Maia: cargando modelo (45.7 MB la primera vez)…')
  setProgress(0)
  const threads = Number($<HTMLInputElement>('threads').value)
  const r = await maia.init(threads, setProgress)
  setProgress(null)
  maiaReady = true
  results.maiaLoad = r
  log(`Maia: lista en ${fmtMs(r.ms)} (${r.fromCache ? 'desde caché' : 'descargado'}, ${r.threads} hilo/s)`)
}

async function loadStockfish() {
  const variant = $<HTMLSelectElement>('variant').value as StockfishVariant
  const threads = Number($<HTMLInputElement>('threads').value)
  const hash = Number($<HTMLInputElement>('hash').value)
  log(`Stockfish: cargando ${variant} (${threads} hilos, hash ${hash} MB)…`)
  setProgress(variant === 'sf17' ? 0 : null)
  const r = await stockfish.init(variant, threads, hash, setProgress)
  setProgress(null)
  sfReady = true
  results.sfLoad = { variant, threads, hash, ...r }
  const nnue = r.nnueFromCache === undefined ? '' : r.nnueFromCache ? ', NNUE desde caché' : ', NNUE descargado'
  log(`Stockfish: listo en ${fmtMs(r.ms)}${nnue}`)
}

async function analyse() {
  const fen = $<HTMLInputElement>('fen').value.trim()
  const elo = Number($<HTMLSelectElement>('elo').value)
  const depth = Number($<HTMLInputElement>('depth').value)

  if (maiaReady) {
    // 1) Selected Elo only (what the panel needs on each move).
    const one = await maia.predict(fen, [elo])
    const p = one.predictions[0]
    // 2) All 21 Elos in one batch (what "Moves by Rating" will need).
    const all = await maia.predict(fen, ELOS)
    results.maia = {
      elo,
      top: p.policy.slice(0, 5).map((m) => ({ san: san(fen, m.uci), prob: m.prob })),
      whiteWinProb: p.whiteWinProb,
      msOneElo: one.ms,
      msAllElos: all.ms,
    }
    $('maia').innerHTML =
      `<p>Maia ${elo} · Win % blancas: <b>${(p.whiteWinProb * 100).toFixed(1)}%</b> · ` +
      `1 Elo: ${fmtMs(one.ms)} · 21 Elos: ${fmtMs(all.ms)}</p>` +
      '<table><tr><th>jugada</th><th>prob</th></tr>' +
      p.policy.slice(0, 5).map((m) => `<tr><td>${san(fen, m.uci)}</td><td>${(m.prob * 100).toFixed(1)}%</td></tr>`).join('') +
      '</table>'
    log(`Maia: predicción 1 Elo en ${fmtMs(one.ms)}, 21 Elos en ${fmtMs(all.ms)}`)
  }

  if (sfReady) {
    log(`Stockfish: analizando a profundidad ${depth}…`)
    const render = (lines: EngineLine[]) => {
      $('sf').innerHTML =
        '<table><tr><th>eval</th><th>prof.</th><th>línea</th></tr>' +
        lines.map((l) => `<tr><td>${formatScore(l)}</td><td>${l.depth}</td><td>${pvSan(fen, l.pv)}</td></tr>`).join('') +
        '</table>'
    }
    const r = await stockfish.analyse(fen, depth, 4, render)
    render(r.lines)
    const nps = r.ms > 0 ? Math.round(r.nodes / (r.ms / 1000)) : 0
    results.stockfish = {
      depth,
      ms: r.ms,
      nodes: r.nodes,
      nps,
      lines: r.lines.map((l) => ({ score: formatScore(l), depth: l.depth, pv: pvSan(fen, l.pv) })),
    }
    $('sf').insertAdjacentHTML('beforeend', `<p>${fmtMs(r.ms)} · ${(nps / 1000).toFixed(0)} k nodos/s</p>`)
    log(`Stockfish: profundidad ${depth} en ${fmtMs(r.ms)} (${(nps / 1000).toFixed(0)} k nodos/s)`)
  }

  if (!maiaReady && !sfReady) log('Carga primero Maia y/o Stockfish.')
}

/** Runs an action, reporting errors in the log instead of failing silently. */
function guarded(name: string, fn: () => Promise<void>) {
  return async () => {
    try {
      await fn()
    } catch (e) {
      setProgress(null)
      const msg = e instanceof Error ? e.message : String(e)
      results[`${name}Error`] = msg
      log(`ERROR (${name}): ${msg}`)
    }
  }
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

function setup() {
  renderDiagnostics()
  $<HTMLInputElement>('fen').value = params.get('fen') ?? DEFAULT_FEN
  $<HTMLSelectElement>('elo').innerHTML = ELOS.map(
    (e) => `<option value="${e}" ${e === 1500 ? 'selected' : ''}>Maia ${e}</option>`,
  ).join('')
  $<HTMLSelectElement>('variant').value = params.get('sf') ?? 'sf17'
  $<HTMLInputElement>('threads').value = params.get('threads') ?? String(Math.min(4, navigator.hardwareConcurrency || 1))
  if (params.get('depth')) $<HTMLInputElement>('depth').value = params.get('depth')!

  const doLoadMaia = guarded('maia', loadMaia)
  const doLoadSf = guarded('stockfish', loadStockfish)
  const doAnalyse = guarded('analyse', analyse)
  $('loadMaia').onclick = doLoadMaia
  $('loadSf').onclick = doLoadSf
  $('analyse').onclick = doAnalyse
  $('clear').onclick = guarded('clear', async () => {
    await clearCache()
    log('Caché borrada (la próxima carga volverá a descargar).')
  })

  // Copies log + measured results as text, to paste them into a chat/note
  // (easier than screenshots when testing on the phone).
  $('copy').onclick = guarded('copy', async () => {
    const text = `${$('log').textContent}\n${JSON.stringify(results, null, 1)}`
    await navigator.clipboard.writeText(text)
    log('Resultados copiados al portapapeles.')
  })

  if (params.get('auto') === '1') {
    void (async () => {
      await doLoadMaia()
      await doLoadSf()
      await doAnalyse()
      results.done = true
      log('Auto: terminado.')
    })()
  }
}

setup()
