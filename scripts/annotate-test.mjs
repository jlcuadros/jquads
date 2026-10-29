// End-to-end test of ✏️ annotations (José, 2026-10-29): symbols, a comment and
// drawings on the current move, in WebKit emulating an iPhone 13 (Spanish), with taps.
//
//   1. 1. e4 e5, ✏️ → the panel shows "1…e5", the symbol rows and an empty comment.
//   2. Symbols: "?!" then "!" (replaces it) and "±" → strip "e5! ±", pressed chips,
//      their meaning under the rows.
//   3. Comment → "✏️ …" at the top of the text.
//   3b. Drawing (phase 2): tapping squares colours them (twice = off) and doesn't move
//       pieces; a red arrow dragged g1→f3; the engines' arrows hidden meanwhile.
//   4. The panel's ◀ ▶ go to e4 (nothing on it) and back (everything still there).
//   5. At the start of the game: the symbols shown but disabled, with the reason (in PGN a
//      symbol needs a move); comment and drawings allowed.
//   6. Unsaved annotations: "Nueva partida" asks first (cancel keeps the game).
//   7. Exported PGN: "e5 $1 $16 {[%csl Gd4][%cal Rg1f3] comment}"; after exporting, no question.
//
// Usage (server running): node scripts/annotate-test.mjs http://localhost:4173 <shots-dir>
import { webkit, devices } from 'playwright'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const base = process.argv[2] ?? 'http://localhost:4173'
const outDir = process.argv[3] ?? '.'
mkdirSync(outDir, { recursive: true })
const ctx = await webkit.launchPersistentContext(process.env.UI_TEST_PROFILE ?? join(tmpdir(), 'maia-ui-test-webkit-profile'), { ...devices['iPhone 13'], locale: 'es-ES' })
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('pageerror:', e.message))
let failed = false
const check = (ok, msg) => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${msg}`); if (!ok) failed = true }

await page.goto(base)
const analysed = () => page.waitForFunction(() => document.getElementById('meterMain').dataset.done === 'true', null, { timeout: 300_000 })
await analysed()

// Taps a square of the main board (white at the bottom), like the other tests.
async function tapSquare(sq) {
  const b = await page.locator('#board cg-board').boundingBox()
  const file = sq.charCodeAt(0) - 97, rank = Number(sq[1])
  await page.touchscreen.tap(b.x + (file + 0.5) * (b.width / 8), b.y + (8.5 - rank) * (b.height / 8))
}
/** What the panel shows: move, pressed chips, meaning, comment, whether the symbol rows are visible. */
const panel = () => page.evaluate(() => ({
  open: !document.getElementById('annotate').hidden,
  move: document.getElementById('annMove').textContent,
  rows: !document.getElementById('annNags').hidden && document.querySelectorAll('#annNags .nag-chip').length === 22,
  disabled: document.querySelectorAll('#annNags .nag-chip:disabled').length,
  pressed: [...document.querySelectorAll('#annNags [aria-pressed="true"]')].map((b) => b.textContent),
  meaning: document.getElementById('annMeaning').textContent,
  comment: document.getElementById('annComment').value,
}))
const currentInStrip = () => page.textContent('#moves .mv.current')
/** Centre of a square on the screen (white at the bottom). */
async function center(sq) {
  const b = await page.locator('#board cg-board').boundingBox()
  return { x: b.x + (sq.charCodeAt(0) - 96.5) * (b.width / 8), y: b.y + (8.5 - Number(sq[1])) * (b.height / 8) }
}
/** Drags from one square to another with the mouse (pointer events, like a finger). */
async function drag(from, to) {
  const a = await center(from), z = await center(to)
  await page.mouse.move(a.x, a.y); await page.mouse.down()
  await page.mouse.move(z.x, z.y, { steps: 6 }); await page.mouse.up()
}
/** What the board shows: coloured squares (class → squares) and the number of arrows
 * (after a short wait: chessground redraws on the next animation frames). */
const boardDrawings = async () => (await page.waitForTimeout(400), page.evaluate(() => ({
  squares: [...document.querySelectorAll('#board cg-board square[class*="ann-"]')].map((s) => s.className),
  arrows: document.querySelectorAll('#board svg.cg-shapes line').length,
})))
/** Next confirm(): its message, answered with `accept`. */
const nextDialog = (accept) => new Promise((resolve) => page.once('dialog', (d) => { resolve(d.message()); accept ? d.accept() : d.dismiss() }))

// This test is about your own annotations: the automatic symbols (iteration 7) off, since
// whether they show depends on which analyses finished in time. Restored at the end.
const autoWasOn = await page.evaluate(() => document.getElementById('autoSymbols').checked)
if (autoWasOn) await page.evaluate(() => document.getElementById('autoSymbols').click())

// 1. New game, 1. e4 e5, ✏️.
await page.tap('#positionBtn'); await page.tap('#newGame'); await analysed()
await tapSquare('e2'); await tapSquare('e4'); await analysed()
await tapSquare('e7'); await tapSquare('e5'); await analysed()
await page.tap('#annotateBtn')
let p = await panel()
check(p.open && p.move === '1…e5' && p.rows && p.pressed.length === 0 && p.comment === '' && /arrastra/.test(p.meaning), `✏️ opens on the current move: ${JSON.stringify(p)}`)

// 2. Symbols: "?!" then "!" (same group: replaces it) and "±".
await page.tap('[data-nag="6"]')
const dubious = await currentInStrip()
await page.tap('[data-nag="1"]')
await page.tap('[data-nag="16"]')
p = await panel()
check(dubious === 'e5?!' && (await currentInStrip()) === 'e5! ±' && p.pressed.join(' ') === '! ±' && p.meaning === '! Buena jugada · ± Ventaja clara de las blancas',
  `symbols: "${dubious}" → "${await currentInStrip()}", pressed ${JSON.stringify(p.pressed)}, "${p.meaning}"`)

// 3. Comment.
await page.tap('#annComment')
await page.keyboard.type('Respuesta clásica')
const text = await page.textContent('#text')
check(text.startsWith('✏️ Respuesta clásica'), `comment at the top of the text: "${text.slice(0, 30)}"`)

// 3b. Drawing: green squares d4 and c4, c4 again (off); then a red arrow g1→f3.
await page.tap('#annComment'); await page.evaluate(() => document.activeElement.blur()) // keyboard away
await tapSquare('d4'); await tapSquare('c4'); await tapSquare('c4')
await page.tap('[data-color="R"]')
await drag('g1', 'f3')
const drawnOpen = await boardDrawings()
check(drawnOpen.squares.join() === 'ann-G' && drawnOpen.arrows === 1 && (await page.$$eval('#moves .mv', (ms) => ms.length)) === 2,
  `drawing: squares ${JSON.stringify(drawnOpen.squares)}, ${drawnOpen.arrows} arrow (engines' hidden), no move played`)
await page.screenshot({ path: `${outDir}/annotate-01-panel.png` })

// 4. The panel's ◀ ▶.
await page.tap('#annPrev')
p = await panel()
const onE4 = p.move === '1.e4' && p.pressed.length === 0 && p.comment === '' && (await boardDrawings()).squares.length === 0
await page.tap('#annNext')
p = await panel()
const back = await boardDrawings()
check(onE4 && p.move === '1…e5' && p.pressed.join(' ') === '! ±' && p.comment === 'Respuesta clásica' && back.squares.length === 1 && back.arrows === 1,
  `◀ to e4 (empty) and ▶ back: ${JSON.stringify({ ...p, ...back })}`)

// 5. At the start: only the comment.
await page.tap('#annPrev'); await page.tap('#annPrev')
p = await panel()
check(p.move === 'Inicio de la partida' && p.rows && p.disabled === 22 && /van con una jugada/.test(p.meaning),
  `start of the game: symbols shown but disabled, with the reason: ${JSON.stringify({ move: p.move, rows: p.rows, disabled: p.disabled, meaning: p.meaning })}`)
await page.tap('#annNext'); await page.tap('#annNext') // back to e5
await page.tap('#annDone')
const closed = await boardDrawings()
await page.screenshot({ path: `${outDir}/annotate-02-closed.png` }) // drawings + engines' arrows
check(!(await panel()).open && closed.squares.length === 1 && closed.arrows >= 2, `Hecho closes the panel; drawings stay, engines' arrows back: ${JSON.stringify(closed)}`)

// 6. Unsaved annotations: "Nueva partida" asks; cancelling keeps the game.
await page.tap('#positionBtn')
const asked = nextDialog(false)
await page.tap('#newGame')
const message = await asked
const kept = await page.$$eval('#moves .mv', (ms) => ms.map((m) => m.textContent))
check(/sin guardar/.test(message) && kept.join(' ') === 'e4 e5! ±', `asks before losing them: "${message}", game kept ${JSON.stringify(kept)}`)

// 7. Export PGN (share sheet intercepted); after that, no question.
await page.evaluate(() => { window.__shared = null; navigator.share = async (d) => { window.__shared = d.text } })
await page.tap('#exportPgn')
const pgn = await page.waitForFunction(() => window.__shared).then((h) => h.jsonValue())
check(pgn.includes('1. e4 e5 $1 $16 {[%csl Gd4][%cal Rg1f3] Respuesta clásica} *'), `exported PGN: ${JSON.stringify(pgn.trim().split('\n').pop())}`)
let askedAgain = false
page.once('dialog', (d) => { askedAgain = true; d.accept() })
await page.tap('#newGame')
await page.waitForTimeout(300)
check(!askedAgain && (await page.$$('#moves .mv')).length === 0, 'after exporting, "Nueva partida" without asking')

if (autoWasOn) await page.evaluate(() => document.getElementById('autoSymbols').click())
await ctx.close()
process.exit(failed ? 1 : 0)
