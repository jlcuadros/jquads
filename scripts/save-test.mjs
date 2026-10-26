// End-to-end test of 📂 → 💾 Guardar and ⭐ → ⬇ Descargar PGN (José,
// 2026-10-25) in WebKit emulating an iPhone 13 (Spanish), with touch taps.
// No network needed besides the app itself.
//
//   1. New game: 1. e4 e5 2. Nf3 and a variation 1... c5 (tapping squares).
//   2. 📂 → 💾 Guardar: form with the default headers, no horizontal overflow;
//      edit White/Black/Result → saved: ⭐ Favoritas shows it, labelled "Guardada".
//   3. Save again → "Guardar cambios" updates the same favourite (no duplicate).
//   4. The local PGN (localStorage "favoritesPgn") has the game with its variation.
//   5. Open it from the favourites → the variation is back on the board's tree.
//   6. ⬇ Descargar PGN → the share sheet (iPhone) or a download gets the same file.
//   7. "Nueva partida" forgets the saved game: saving makes a second favourite.
//
// Usage (server running): node scripts/save-test.mjs http://localhost:4173 <shots-dir>
import { webkit, devices } from 'playwright'
import { mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const base = process.argv[2] ?? 'http://localhost:4173'
const outDir = process.argv[3] ?? '.'
mkdirSync(outDir, { recursive: true })
const ctx = await webkit.launchPersistentContext(process.env.UI_TEST_PROFILE ?? join(tmpdir(), 'maia-ui-test-webkit-profile'), { ...devices['iPhone 13'], locale: 'es-ES', acceptDownloads: true })
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('pageerror:', e.message))
let failed = false
const check = (ok, msg) => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${msg}`); if (!ok) failed = true }

await page.goto(base)
await page.evaluate(() => { localStorage.removeItem('favoriteGames'); localStorage.removeItem('favoritesPgn') })
await page.reload()
await page.waitForSelector('#board .cg-wrap, #board.cg-wrap')

// Centre of a square on the main board (white at the bottom).
async function tapSquare(sq) {
  const b = await page.locator('#board cg-board').boundingBox()
  const file = sq.charCodeAt(0) - 97, rank = Number(sq[1])
  await page.touchscreen.tap(b.x + (file + 0.5) * (b.width / 8), b.y + (8.5 - rank) * (b.height / 8))
}
async function move(from, to) {
  const before = await page.locator('#moves .mv').count()
  await tapSquare(from); await tapSquare(to)
  await page.waitForFunction((n) => document.querySelectorAll('#moves .mv').length !== n || document.querySelector('#moves .mv.current'), before)
}
const favRows = () => page.$$eval('#gamesList li', (lis) => lis.map((li) => ({ id: li.dataset.id, site: li.dataset.site, meta: li.querySelector('.meta').textContent, players: li.querySelector('.players').textContent })))
const field = (k) => `#pgnh-${k}`

// 1. A game with a variation.
await page.tap('#positionBtn'); await page.tap('#newGame')
await move('e2', 'e4'); await move('e7', 'e5'); await move('g1', 'f3')
await page.tap('#moves .mv >> text=e4') // back to after 1. e4
await tapSquare('c7'); await tapSquare('c5') // variation 1... c5: the game already continues with 1... e5,
await page.click('#choice button:has-text("Variante nueva")') // so the app asks (2026-10-26)
await page.waitForFunction(() => document.querySelector('#moves .mv.current')?.textContent === 'c5')

// 2. Save it.
await page.tap('#gamesBtn')
await page.tap('#site-save')
check(await page.isVisible('#gamesSave') && await page.isHidden('#gamesBrowse'), '💾 Guardar shows the header form instead of the list')
const defaults = { event: await page.inputValue(field('Event')), white: await page.inputValue(field('White')), result: await page.inputValue(field('Result')) }
check(defaults.event === 'Análisis' && defaults.white === '?' && defaults.result === '*', `default headers: ${JSON.stringify(defaults)}`)
const ov = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, vp: document.documentElement.clientWidth, panel: document.getElementById('games').scrollWidth, panelW: document.getElementById('games').clientWidth }))
check(ov.doc <= ov.vp && ov.panel <= ov.panelW, `form fits the screen (page ${ov.doc}/${ov.vp}, panel ${ov.panel}/${ov.panelW})`)
check((await page.textContent('#saveGame')).includes('Guardar en favoritas'), `button: "${await page.textContent('#saveGame')}"`)
await page.fill(field('White'), 'Ousland'); await page.fill(field('Black'), 'Rival'); await page.fill(field('WhiteElo'), '1900')
await page.selectOption(field('Result'), '1-0')
await page.screenshot({ path: `${outDir}/save-01-form.png` })
await page.tap('#saveGame')
let favs = await favRows()
check(await page.isVisible('#gamesBrowse') && (await page.getAttribute('#tabFavorites', 'class')).includes('active'), 'after saving: the favourites tab is shown')
check(favs.length === 1 && favs[0].site === 'local' && favs[0].meta.startsWith('Guardada') && favs[0].players.includes('Ousland 1900'), `favourite saved: ${JSON.stringify(favs[0])}`)
check((await page.textContent('#gamesStatus')).includes('guardada'), `status: "${await page.textContent('#gamesStatus')}"`)
check(await page.isVisible('#favDownload'), '⬇ Descargar PGN visible in the favourites')
await page.screenshot({ path: `${outDir}/save-02-favorites.png` })

// 3. Save again: update, not duplicate.
await page.tap('#site-save')
check((await page.textContent('#saveGame')).includes('Guardar cambios') && (await page.inputValue(field('White'))) === 'Ousland', 'second time: "Guardar cambios", with the edited headers')
await page.fill(field('Black'), 'Rival2')
await page.tap('#saveGame')
favs = await favRows()
check(favs.length === 1 && favs[0].players.includes('Rival2'), `updated in place (${favs.length} favourite: ${favs[0]?.players})`)

// 4. The local PGN file.
const localPgn = await page.evaluate(() => localStorage.getItem('favoritesPgn'))
check(localPgn.includes('[White "Ousland"]') && localPgn.includes('[Black "Rival2"]') && localPgn.includes('1. e4 e5 (1... c5) 2. Nf3 1-0'), 'local PGN kept with the headers and the variation')

// 6. Download (before opening, while the favourites are on screen).
// a) iPhone: the share sheet with the .pgn file (simulated: headless WebKit has
//    navigator.share but no sheet to answer it).
await page.evaluate(() => {
  navigator.canShare = () => true
  navigator.share = async (d) => { window.__shared = { name: d.files[0].name, type: d.files[0].type, text: await d.files[0].text() } }
})
await page.tap('#favDownload')
const shared = await page.waitForFunction(() => window.__shared).then((h) => h.jsonValue())
check(shared.name.endsWith('.pgn') && shared.type === 'application/vnd.chess-pgn' && shared.text === localPgn, `share sheet gets ${shared.name} (${shared.type}) = the local PGN`)
// b) Without file sharing: an ordinary download.
await page.evaluate(() => { navigator.canShare = () => false })
const [download] = await Promise.all([page.waitForEvent('download'), page.tap('#favDownload')])
const file = await download.path()
const text = readFileSync(file, 'utf8')
check(download.suggestedFilename().match(/^jquads-favoritas-\d{4}-\d{2}-\d{2}\.pgn$/) && text === localPgn, `downloaded ${download.suggestedFilename()} = the local PGN (${text.length} chars)`)

// 5. Open it: the variation comes back.
await page.tap(`#gamesList li[data-id="${favs[0].id}"] .info`)
await page.waitForFunction(() => document.getElementById('games').hidden)
const opened = await page.evaluate(() => ({ moves: document.querySelectorAll('#moves .mv').length, current: document.querySelectorAll('#moves .mv.current').length }))
check(opened.moves >= 3 && opened.current === 0, `opened from the favourites at the initial position (${opened.moves} moves)`)
await page.tap('#gamesBtn'); await page.tap('#site-save')
check((await page.inputValue(field('Black'))) === 'Rival2' && (await page.textContent('#saveGame')).includes('Guardar cambios'), 'reopened game keeps its headers and its favourite (update)')
await page.tap('#saveGame')
const after = await page.evaluate(() => localStorage.getItem('favoritesPgn'))
check(after.includes('1. e4 e5 (1... c5) 2. Nf3 1-0'), 'saving the reopened game keeps the variation (it came back from the PGN)')

// 7. New game → a new favourite.
await page.tap('#gamesClose')
await page.tap('#positionBtn'); await page.tap('#newGame')
await move('d2', 'd4')
await page.tap('#gamesBtn'); await page.tap('#site-save')
check((await page.inputValue(field('White'))) === '?' && (await page.textContent('#saveGame')).includes('Guardar en favoritas'), 'new game: default headers, saves as a new favourite')
await page.tap('#saveGame')
favs = await favRows()
check(favs.length === 2, `two favourites now (${favs.map((f) => f.players).join(' | ')})`)

await page.evaluate(() => { localStorage.removeItem('favoriteGames'); localStorage.removeItem('favoritesPgn') }) // clean up
await ctx.close()
process.exit(failed ? 1 : 0)
