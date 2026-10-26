// End-to-end test of the interface (index.html) emulating an iPhone in WebKit.
//
// 1. Opens the app, waits for the engines and the first full analysis
//    (explanatory text present).
// 2. Plays Maia's first suggestion by tapping it, and checks that the move
//    strip and the analysis update; waits for the threats bar too.
// 3. Checks the threats modes: "only moves" (default, no bar) and "bar and moves".
// 3b. Iteration 5: top bar modes (default "only the bar", both, moves, off) and
//    the middle columns ("↓x.x" in Maia, Maia % in SF, SF eval with one decimal),
//    which can be hidden.
// 4. Saves screenshots (01-start, 02-after-move, 03-settings,
//    04-threats-only-moves, 05-threats-bar, 06-columns-hidden) to the folder
//    given as 2nd argument.
//
// Usage (preview server running, see app.md):
//   node scripts/ui-test.mjs http://localhost:4173 /tmp/shots
import { webkit, devices } from 'playwright'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const base = process.argv[2] ?? 'http://localhost:4173'
const outDir = process.argv[3] ?? '.'
mkdirSync(outDir, { recursive: true })

// Persistent browser profile (outside the vault) so the ~125 MB of models stay
// cached in IndexedDB between runs: faster, and less exposed to network drops.
const profileDir = process.env.UI_TEST_PROFILE ?? join(tmpdir(), 'maia-ui-test-webkit-profile')
const browser = await webkit.launchPersistentContext(profileDir, { ...devices['iPhone 13'], locale: 'es-ES' } /* Spanish device: these checks look for Spanish texts */)
const page = await browser.newPage()
page.on('pageerror', (e) => console.log('pageerror:', e.message))
page.on('console', (m) => m.type() === 'error' && console.log('console.error:', m.text()))

const t0 = Date.now()
await page.goto(base)
// Full analysis of the start position = explanatory text rendered.
// (or stop at once if the engines failed to load)
await page.waitForFunction(
  () => document.getElementById('text').textContent.length > 20 || document.getElementById('status').textContent.includes('Error'),
  null,
  { timeout: 600_000 },
)
const status = await page.textContent('#status')
if (status.includes('Error')) {
  console.log('FAILED:', status)
  await browser.close()
  process.exit(1)
}
console.log(`start position analysed in ${((Date.now() - t0) / 1000).toFixed(1)} s`)
console.log('numbers:', await page.textContent('#numbers'))
console.log('text   :', await page.textContent('#text'))
await page.screenshot({ path: `${outDir}/01-start.png`, fullPage: true })

// Iteration 4 checks: figurines, "Maia: NN%" without "blancas", vertical eval bar.
const iter4 = async (ok, msg) => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${msg}`); if (!ok) process.exitCode = 1 }
const maiaColText = await page.textContent('#maiaCol')
await iter4(/[♔♕♖♗♘♚♛♜♝♞]/.test(maiaColText), `figurine notation in Maia column: ${maiaColText.replace(/\s+/g, ' ').slice(0, 60)}`)
await iter4(!(await page.textContent('#numbers')).includes('blancas'), `top line without "blancas": ${await page.textContent('#numbers')}`)
const evalBar = await page.evaluate(() => {
  const el = document.getElementById('evalBarEl')
  return { visible: !el.hidden && el.offsetWidth > 0, width: el.offsetWidth, white: el.style.getPropertyValue('--white-pos'), maia: el.style.getPropertyValue('--maia-pos') }
})
await iter4(evalBar.visible && evalBar.white && evalBar.maia, `vertical eval bar: ${JSON.stringify(evalBar)}`)

// The page must never be wider than the screen: otherwise it can shift sideways
// after a move and hide the eval bar (bug reported by José on 2026-10-25).
const widths = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth }))
await iter4(widths.doc <= widths.viewport, `no horizontal overflow: page ${widths.doc} px vs screen ${widths.viewport} px`)

// Hide moves: button 🙈 (moves visible) → moves become "--", evaluations stay,
// nothing playable, no arrows; the button then shows 💡 (tap to show them again).
const iconBefore = await page.textContent('#hideMoves')
await page.tap('#hideMoves')
const iconHidden = await page.textContent('#hideMoves')
await iter4(iconBefore === '🙈' && iconHidden === '💡', `hide button icon: visible=${iconBefore} hidden=${iconHidden}`)
const hidden = await page.evaluate(() => ({
  maia: document.getElementById('maiaCol').textContent,
  sf: document.getElementById('sfCol').textContent,
  // The engines' paragraph (the previous-move summary shows the move already played on purpose).
  text: document.querySelector('#text .side-text')?.textContent ?? '',
  playable: document.querySelectorAll('.panel-col [data-move]').length,
  arrows: document.querySelectorAll('#board svg.cg-shapes g g, #board .cg-shapes line').length,
}))
await iter4(hidden.maia.includes('--') && hidden.sf.includes('--') && /[+−]\d/.test(hidden.sf) && hidden.playable === 0,
  `hidden moves: maia="${hidden.maia.replace(/\s+/g, ' ').slice(0, 50)}" sf="${hidden.sf.replace(/\s+/g, ' ').slice(0, 50)}" playable=${hidden.playable} arrows=${hidden.arrows}`)
await iter4(!/[a-h][1-8]/.test(hidden.text), `hidden moves also in the text: "${hidden.text.slice(0, 80)}"`)
await page.screenshot({ path: `${outDir}/06-hidden-moves.png`, fullPage: true })
await page.tap('#hideMoves')
await iter4((await page.textContent('#hideMoves')) === '🙈', 'hide button back to 🙈 after showing the moves again')

// Tap Maia's most likely move.
const first = await page.textContent('#maiaCol tr[data-move] .move-chip')
const tMove = Date.now()
await page.click('#maiaCol tr[data-move]')
await page.waitForFunction(() => document.querySelectorAll('#moves .mv').length === 1)
await page.waitForFunction(() => document.getElementById('text').textContent.length > 20, null, { timeout: 120_000 })
console.log(`played ${first}; strip: ${await page.textContent('#moves')}`)
console.log('text   :', await page.textContent('#text'))
await page.waitForFunction(() => document.getElementById('meterThreats').dataset.done === 'true', null, { timeout: 120_000 })
console.log('threats:', await page.textContent('#meterThreats'))
console.log(`full analysis after the move (incl. threats) in ${((Date.now() - tMove) / 1000).toFixed(1)} s`)
// Summary of the previous move (2026-10-26): White's pawn first (who it is about), and Maia's
// first suggestion from the start is a good move.
const prevMove = (await page.textContent('#text .prev-move').catch(() => '')) ?? ''
// Order of the paragraphs (José, 2026-10-26): book, position, previous move.
const order = await page.$$eval('#text > div', (ds) => ds.map((d) => d.className))
console.log(`${order.join(',') === 'book-line,side-text,prev-move' ? 'OK  ' : 'FAIL'} text paragraphs in order: ${order.join(', ')}`)
console.log(`${/^♙\uFE0E? 1\.\S+ fue (la mejor jugada \([+−]?\d\.\d\)|buena jugada \([+−]?\d\.\d → [+−]?\d\.\d\))\./ /* the best move: one evaluation */.test(prevMove) ? 'OK  ' : 'FAIL'} previous move summary: "${prevMove}"`)
// Every move shown in the bar legends must have been evaluated (coloured dot).
const uncoloured = await page.locator('.meter-legend .move-chip.plain').allTextContents()
console.log('legend moves without colour:', uncoloured.length ? uncoloured.join(' ') : 'none')
if (uncoloured.length) process.exitCode = 1
await page.screenshot({ path: `${outDir}/02-after-move.png`, fullPage: true })

// Settings panel (⚙) with the help section open, for the documentation.
await page.click('#menu')
await page.click('.help summary')
await page.screenshot({ path: `${outDir}/03-settings.png`, fullPage: true })
await page.click('#menu')

// Threats: default is "only moves" (iteration 4) → no bar; then check "bar and moves".
console.log('threats default: bar present =', await page.locator('#meterThreats .meter').count())
// Top bar (iteration 5): default "only the bar"; then the other three modes.
const topBar = () => page.evaluate(() => ({ hidden: document.getElementById('meterMain').hidden, bar: !!document.querySelector('#meterMain .meter'), moves: !!document.querySelector('#meterMain .meter-legend') }))
const setMeter = async (mode) => { await page.click('#menu'); await page.selectOption('#meterMode', mode); await page.click('#menu') }
let tb = await topBar()
console.log(`${!tb.hidden && tb.bar && !tb.moves ? 'OK  ' : 'FAIL'} top bar default "Solo barra": ${JSON.stringify(tb)}`)
await setMeter('both'); tb = await topBar()
const legendUncoloured = await page.locator('#meterMain .meter-legend .move-chip.plain').count()
const okBoth = tb.bar && tb.moves && legendUncoloured === 0
await setMeter('moves'); const tbMoves = await topBar()
await setMeter('off'); const tbOff = await topBar()
await setMeter('bar') // back to the default for the persistent profile
console.log(`${okBoth && !tbMoves.bar && tbMoves.moves && tbOff.hidden ? 'OK  ' : 'FAIL'} top bar modes: both=${JSON.stringify(tb)} moves=${JSON.stringify(tbMoves)} off=${JSON.stringify(tbOff)}`)

// Middle columns (iteration 5): "↓x.x" in Maia, "NN%" in SF, eval with one decimal; both can be hidden.
const cols = () => page.evaluate(() => ({
  maiaHead: [...document.querySelectorAll('#maiaCol th')].map((t) => t.textContent),
  sfHead: [...document.querySelectorAll('#sfCol th')].map((t) => t.textContent),
  deltas: [...document.querySelectorAll('#maiaCol tr[data-move] td.num')].filter((_, i) => i % 2 === 0).map((t) => t.textContent),
  maiaPct: [...document.querySelectorAll('#maiaCol tr[data-move] td:last-child')].map((t) => t.textContent),
  sfMid: [...document.querySelectorAll('#sfCol tr[data-move] td.num')].filter((_, i) => i % 2 === 0).map((t) => t.textContent),
  sfEval: [...document.querySelectorAll('#sfCol tr[data-move] td:last-child')].map((t) => t.textContent),
}))
let c = await cols()
const colsOk = c.maiaHead[1] === 'Δ eval' && c.deltas.every((d) => /^(0\.0|↓\d+\.\d|↓M[+−]\d+|↓M\?|⇵.+)$/.test(d)) && !c.deltas.includes('↓0.0') && c.maiaPct.every((p) => /^\d+%$/.test(p)) &&
  c.sfHead[0].startsWith('SF') && c.sfHead[1] === 'Maia' && c.sfMid.every((p) => /^\d+%$/.test(p)) && c.sfEval.every((e) => /^([+−]?\d+\.\d|[+−]M\d+)$/.test(e))
console.log(`${colsOk ? 'OK  ' : 'FAIL'} middle columns: ${JSON.stringify(c)}`)
await page.click('#menu'); await page.uncheck('#showDeltaCol'); await page.uncheck('#showMaiaCol'); await page.click('#menu')
c = await cols()
console.log(`${c.maiaHead.length === 2 && c.sfHead.length === 2 ? 'OK  ' : 'FAIL'} middle columns hidden: ${JSON.stringify([c.maiaHead, c.sfHead])}`)
await page.screenshot({ path: `${outDir}/06-columns-hidden.png`, fullPage: true })
await page.click('#menu'); await page.check('#showDeltaCol'); await page.check('#showMaiaCol'); await page.click('#menu')
await page.screenshot({ path: `${outDir}/04-threats-only-moves.png`, fullPage: true })
await page.click('#menu')
await page.selectOption('#threatsMode', 'bar')
await page.click('#menu')
await page.waitForFunction(() => !document.getElementById('meterThreats').textContent.includes('calculando'), null, { timeout: 120_000 })
console.log('threats "bar and moves": bar present =', await page.locator('#meterThreats .meter').count(), '; legend =', await page.textContent('#meterThreats'))
console.log('maia rows =', await page.locator('#maiaCol tr[data-move]').count(), '; sf rows =', await page.locator('#sfCol tr[data-move]').count())
await page.screenshot({ path: `${outDir}/05-threats-bar.png`, fullPage: true })
// Back to the default so the persistent test profile keeps it.
await page.click('#menu')
await page.selectOption('#threatsMode', 'moves')
await page.click('#menu')

// Export PGN: intercept the share sheet and check the text.
await page.evaluate(() => { window.__shared = null; navigator.share = async (d) => { window.__shared = d.text } })
await page.click('#positionBtn') // 📋 (moved out of ⚙, 2026-10-26)
await page.click('#exportPgn')
await page.waitForFunction(() => window.__shared !== null, null, { timeout: 5000 }).catch(() => {})
const pgn = await page.evaluate(() => window.__shared)
console.log(`${pgn && pgn.includes('[Site "https://jquads.pages.dev"]') && /1\. e4/.test(pgn) ? 'OK  ' : 'FAIL'} export PGN: ${JSON.stringify((pgn ?? '').split('\n').pop() || pgn)}`)
await page.click('#positionBtn')

// 📋 panel and Stockfish threads (José, 2026-10-26): 📋 first in the top line, FEN/editor/new
// game/PGN in its panel and no longer in ⚙, no "· d18" in the top line, threads in ⚙
// (1 … cores, max 8; default min(4, cores)).
const layout = await page.evaluate(() => ({
  first: document.querySelector('.infobar')?.firstElementChild?.id,
  inSettings: document.querySelectorAll('#settings #exportPgn, #settings #fenInput, #settings #editPosition, #settings #newGame').length,
  inPanel: document.querySelectorAll('#positionPanel #exportPgn, #positionPanel #fenInput, #positionPanel #editPosition, #positionPanel #newGame, #positionPanel #loadFen').length,
  numbers: document.getElementById('numbers').textContent,
  threads: [...document.querySelectorAll('#sfThreads option')].map((o) => o.value),
  threadsValue: document.getElementById('sfThreads').value,
  cores: navigator.hardwareConcurrency,
}))
const expectedDefault = String(Math.min(4, layout.cores))
console.log(`${layout.first === 'positionBtn' && layout.inSettings === 0 && layout.inPanel === 5 && !/· d\d/.test(layout.numbers) && layout.threads.length === Math.min(8, layout.cores) && layout.threadsValue === expectedDefault ? 'OK  ' : 'FAIL'} 📋 panel and threads: ${JSON.stringify(layout)}`)

// Back to the start: should come from the cache (instant).
const t1 = Date.now()
await page.click('#prev')
await page.waitForFunction(() => document.getElementById('text').textContent.length > 20)
console.log(`back to start (cached) in ${Date.now() - t1} ms`)

/**
 * Opens a panel (its button: ⚙ or 📋) and makes sure it opened: in WebKit's iPhone emulation a
 * tap is sometimes delivered without a click (see i18n-test.mjs; traced 2026-10-26), so
 * it retries after a pause. A person would simply tap again.
 */
async function openPanel(button, panel) {
  for (let i = 0; i < 3 && (await page.isHidden(panel)); i++) {
    if (i) await page.waitForTimeout(700)
    await page.click(button)
  }
}
/** 📋 Position and game (FEN, editor, new game, PGN; moved out of ⚙ on 2026-10-26). */
const openPosition = () => openPanel('#positionBtn', '#positionPanel')

// Δ eval with mates (José, 2026-10-26): Scholar's mate position, Qxf7# = +M1.
// The mating move shows "0.0"; moves that give the mate away show "⇵" + their eval.
await openPosition()
await page.fill('#fenInput', 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4')
await page.click('#loadFen')
await page.waitForFunction(() => document.getElementById('meterMain').dataset.done === 'true', null, { timeout: 120_000 })
const mateRows = await page.$$eval('#maiaCol tr[data-move]', (trs) => trs.map((tr) => [tr.dataset.move, tr.querySelectorAll('td')[1]?.textContent]))
const qxf7 = mateRows.find(([m]) => m === 'h5f7')
console.log(`${qxf7?.[1] === '0.0' && mateRows.some(([m, d]) => m !== 'h5f7' && /^⇵[+−]?\d+\.\d$/.test(d)) ? 'OK  ' : 'FAIL'} Δ eval with a mate: ${JSON.stringify(mateRows)}`)
await page.screenshot({ path: `${outDir}/07-delta-mate.png`, fullPage: true })
await openPosition(); await page.click('#newGame')


await browser.close()
