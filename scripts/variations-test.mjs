// End-to-end test of variations, move marks, PGN comments and the whole-game
// view (José, 2026-10-26) in WebKit emulating an iPhone 13 (Spanish), with taps.
//
//   1. Navigation bar: ⏮ 📜 ⏭ less than half as wide as ◀ ▶.
//   2. After 1. e4 (start position analysed): the strip shows a mark on e4.
//   3. A different move where the game continues: "Variante nueva" keeps the
//      main line and adds the variation; ▶ then asks which one to follow.
//   4. "Sobrescribir" replaces what followed; "Cancelar" leaves everything as it was.
//   5. 📜: the whole game with variations; tapping a move goes there.
//   6. A PGN with comments (opened from the favourites): "✏️ …" first in the
//      text, and the comments are in the exported PGN.
//
// Usage (server running): node scripts/variations-test.mjs http://localhost:4173 <shots-dir>
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
await page.waitForFunction(() => document.getElementById('meterMain').dataset.done === 'true', null, { timeout: 300_000 })

// Taps a square of the main board (white at the bottom), like the save test.
async function tapSquare(sq) {
  const b = await page.locator('#board cg-board').boundingBox()
  const file = sq.charCodeAt(0) - 97, rank = Number(sq[1])
  await page.touchscreen.tap(b.x + (file + 0.5) * (b.width / 8), b.y + (8.5 - rank) * (b.height / 8))
}
const strip = () => page.$$eval('#moves .mv', (ms) => ms.map((m) => m.textContent))
const current = () => page.textContent('#moves .mv.current').catch(() => '')
const analysed = () => page.waitForFunction(() => document.getElementById('meterMain').dataset.done === 'true', null, { timeout: 120_000 })
/** The choice dialog's buttons (null if no dialog appeared). */
async function dialog() {
  await page.waitForSelector('#choice', { timeout: 3000 }).catch(() => {})
  return (await page.$('#choice')) ? page.$$eval('#choice button', (bs) => bs.map((b) => b.textContent)) : null
}
const choose = (label) => page.click(`#choice button:has-text("${label}")`)
/** The movetext shown by 📜 (opens and closes it). */
async function gameView() {
  await page.tap('#gameViewBtn')
  const text = (await page.textContent('#gameViewBody .pv-moves')).replace(/\s+/g, ' ').trim()
  await page.tap('#gameViewClose')
  return text
}

// 1. Navigation bar widths.
const w = await page.evaluate(() => Object.fromEntries(['first', 'prev', 'gameViewBtn', 'next', 'last'].map((id) => [id, Math.round(document.getElementById(id).getBoundingClientRect().width)])))
check(['first', 'gameViewBtn', 'last'].every((id) => w[id] < w.prev / 2), `⏮ 📜 ⏭ small (< half of ◀ ▶): ${JSON.stringify(w)}`)

// 2. New game, 1. e4 (the start position is analysed) → a mark on e4.
await page.tap('#positionBtn'); await page.tap('#newGame'); await analysed()
await tapSquare('e2'); await tapSquare('e4'); await analysed()
const mark = await page.evaluate(() => document.querySelector('#moves .mv .mark')?.className)
check(/shape-(circle|square|triangle)/.test(mark ?? ''), `mark on 1.e4 in the strip: "${mark}"`)
await tapSquare('e7'); await tapSquare('e5'); await analysed()

// 3. Back to after 1. e4 and play 1... c5 → "Variante nueva".
await page.tap('#moves .mv >> text=e4')
await tapSquare('c7'); await tapSquare('c5')
const opts = await dialog()
check(opts?.join('|') === 'Variante nueva|Sobrescribir (borra lo que seguía)|Cancelar', `dialog on a new move: ${JSON.stringify(opts)}`)
await page.screenshot({ path: `${outDir}/var-01-dialog.png` })
await choose('Variante nueva'); await analysed()
check((await current()) === 'c5', `variation played: current = ${await current()}`)
let movetext = await gameView()
check(movetext === '1. e4 e5 (1... c5)', `📜 main line + variation: "${movetext}"`)

// ▶ from after 1. e4: two continuations → asks which one.
await page.tap('#moves .mv >> text=e4')
await page.tap('#next')
const forward = await dialog()
check(forward?.length === 3 && forward[0].includes('e5') && forward[0].includes('principal') && forward[1].includes('c5'), `▶ asks which continuation: ${JSON.stringify(forward)}`)
await choose('c5')
check((await current()) === 'c5', `▶ followed the variation: current = ${await current()}`)

// 4. Cancel leaves everything; overwrite replaces what followed.
await page.tap('#moves .mv >> text=e4')
await tapSquare('d7'); await tapSquare('d5')
await dialog(); await choose('Cancelar')
check((await current()) === 'e4' && (await gameView()) === movetext, 'cancel: same position, same game')
await tapSquare('d7'); await tapSquare('d5')
await dialog(); await choose('Sobrescribir'); await analysed()
movetext = await gameView()
check(movetext === '1. e4 d5', `overwrite: "${movetext}"`)

// 5. 📜: tap a move to go there.
await page.tap('#gameViewBtn')
await page.screenshot({ path: `${outDir}/var-02-game-view.png` })
await page.tap('#gameViewBody .pv-mv >> text=e4')
const highlighted = await page.textContent('#gameViewBody .pv-mv.current')
await page.tap('#gameViewClose')
check((await current()) === 'e4' && highlighted?.includes('e4'), `📜 tap goes to the move: current = ${await current()}`)

// 6. PGN comments: a saved game with comments, opened from the favourites.
const pgn = '[Event "Comentada"]\n[White "Ousland"]\n[Black "Rival"]\n[Result "*"]\n\n{Una partida de prueba} 1. e4 {[%clk 0:03:00] El peón rey} e5 (1... c5 {La siciliana}) 2. Nf3 *\n'
await page.evaluate((p) => {
  const fav = { site: 'local', id: 'local-test', createdAt: Date.now(), speed: '', rated: false, status: 'started', white: { name: 'Ousland' }, black: { name: 'Rival' }, pgn: p }
  localStorage.setItem('favoriteGames', JSON.stringify({ [fav.id]: fav }))
}, pgn)
await page.tap('#gamesBtn'); await page.tap('#tabFavorites')
await page.tap('#gamesList li[data-id="local-test"] .info')
await analysed()
const rootText = await page.textContent('#text')
await page.tap('#next'); await analysed()
const e4Text = await page.textContent('#text')
check(rootText.startsWith('✏️ Una partida de prueba') && e4Text.startsWith('✏️ El peón rey'), `comments first in the text: "${rootText.slice(0, 30)}" / "${e4Text.slice(0, 20)}"`)
await page.screenshot({ path: `${outDir}/var-03-comment.png`, fullPage: true })
await page.evaluate(() => { window.__shared = null; navigator.share = async (d) => { window.__shared = d.text } })
await page.tap('#positionBtn'); await page.tap('#exportPgn')
const exported = await page.waitForFunction(() => window.__shared).then((h) => h.jsonValue())
check(exported.includes('{Una partida de prueba} 1. e4 {El peón rey} 1... e5 (1... c5 {La siciliana}) 2. Nf3'), 'exported PGN keeps comments and variations (no clocks)')

await page.evaluate(() => localStorage.removeItem('favoriteGames')) // clean up
await ctx.close()
process.exit(failed ? 1 : 0)
