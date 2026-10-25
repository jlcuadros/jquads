// End-to-end test of the 📂 Lichess games panel in WebKit (iPhone 13, Spanish),
// against the real Lichess API with José's account (Ousland).
//
//   1. 📂 → type the username → list of games, newest first (≤ 20).
//   2. "Blitz" filter → every game is blitz; a date range → games within it.
//   3. "Cargar más" → more games, still newest first.
//   4. ☆ → ⭐, and the game appears in the "Favoritas" tab (then removed).
//   5. Tapping a game where the user had BLACK → board oriented to black,
//      at the initial position, with all the moves in the move list.
//   6. The top line (now with 📂) still fits; no horizontal overflow.
//
// Usage (server running): node scripts/games-test.mjs http://localhost:4173 <shots-dir>
import { webkit, devices } from 'playwright'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const base = process.argv[2] ?? 'http://localhost:4173'
const outDir = process.argv[3] ?? '.'
const USER = 'Ousland'
mkdirSync(outDir, { recursive: true })
const ctx = await webkit.launchPersistentContext(process.env.UI_TEST_PROFILE ?? join(tmpdir(), 'maia-ui-test-webkit-profile'), { ...devices['iPhone 13'], locale: 'es-ES' })
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('pageerror:', e.message))
let failed = false
const check = (ok, msg) => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${msg}`); if (!ok) failed = true }
const rows = () => page.$$eval('#gamesList li', (lis) => lis.map((li) => ({ id: li.dataset.id, created: Number(li.dataset.created), me: li.dataset.me, meta: li.querySelector('.meta').textContent, fav: li.querySelector('.fav').textContent })))
const listReady = () => page.waitForFunction(() => !document.getElementById('gamesStatus').textContent.includes('Descargando'), null, { timeout: 60_000 })
const newestFirst = (r) => r.every((x, i) => i === 0 || r[i - 1].created >= x.created)

await page.goto(base)
await page.waitForFunction(() => document.getElementById('text').textContent.length > 20, null, { timeout: 300_000 })
const top = await page.evaluate(() => ({ fits: document.getElementById('numbers').scrollWidth <= document.getElementById('numbers').clientWidth, doc: document.documentElement.scrollWidth, vp: document.documentElement.clientWidth }))
check(top.fits && top.doc <= top.vp, `top line with 📂 fits, no overflow (page ${top.doc}/${top.vp})`)

// 1. Open the panel, clear filters from previous runs, load the user's games.
await page.click('#gamesBtn')
await page.evaluate(() => localStorage.removeItem('gamesFilters'))
await page.fill('#gamesUser', USER)
await page.click('#gamesLoad')
await listReady()
let r = await rows()
check(r.length > 0 && r.length <= 20 && newestFirst(r), `${r.length} games, newest first (${new Date(r[0]?.created).toISOString().slice(0, 10)} … ${new Date(r.at(-1)?.created).toISOString().slice(0, 10)})`)
await page.screenshot({ path: `${outDir}/games-01-list.png`, fullPage: true })

// 2. Blitz only.
await page.click('#speedChips .chip[data-speed="blitz"]')
await listReady()
r = await rows()
check(r.length > 0 && r.every((x) => x.meta.includes('Blitz')), `Blitz filter: ${r.length} games, all blitz`)

// 3. Load more.
const before = r.length
await page.click('#gamesMore')
await listReady()
r = await rows()
check(r.length > before && newestFirst(r) && new Set(r.map((x) => x.id)).size === r.length, `load more: ${before} → ${r.length}, still newest first, no duplicates`)

// Date range: one month ago … 20 days ago.
const iso = (d) => new Date(Date.now() - d * 86400e3).toISOString().slice(0, 10)
await page.fill('#gamesFrom', iso(30)); await page.dispatchEvent('#gamesFrom', 'change')
await listReady()
await page.fill('#gamesTo', iso(20)); await page.dispatchEvent('#gamesTo', 'change')
await listReady()
r = await rows()
const lo = new Date(iso(30) + 'T00:00:00').getTime(), hi = new Date(iso(20) + 'T23:59:59').getTime()
check(r.every((x) => x.created >= lo && x.created <= hi), `date filter ${iso(30)}…${iso(20)}: ${r.length} games, all inside`)
await page.screenshot({ path: `${outDir}/games-02-filters.png`, fullPage: true })

// 4. Favourite.
const first = r[0]
await page.click(`#gamesList li[data-id="${first.id}"] .fav`)
r = await rows()
check(r[0].fav === '⭐', `☆ → ⭐ on ${first.id}`)
await page.click('#tabFavorites')
const favIds = (await rows()).map((x) => x.id)
check(favIds.includes(first.id), `"Favoritas" tab contains ${first.id}`)
await page.screenshot({ path: `${outDir}/games-03-favorites.png`, fullPage: true })
await page.click(`#gamesList li[data-id="${first.id}"] .fav`) // clean up
await page.click('#tabRecent')

// 5. Open a game where the user had black (clear the date filter to find one quickly).
await page.fill('#gamesFrom', ''); await page.dispatchEvent('#gamesFrom', 'change'); await listReady()
await page.fill('#gamesTo', ''); await page.dispatchEvent('#gamesTo', 'change'); await listReady()
r = await rows()
// The most recent page may have only games with White: look further if needed.
for (let i = 0; i < 3 && !r.some((x) => x.me === 'black') && !(await page.isHidden('#gamesMore')); i++) {
  await page.click('#gamesMore'); await listReady(); r = await rows()
}
const asBlack = r.find((x) => x.me === 'black')
check(!!asBlack, `found a game as black (${asBlack?.id})`)
await page.click(`#gamesList li[data-id="${asBlack.id}"] .info`)
await page.waitForFunction(() => document.getElementById('games').hidden && document.querySelectorAll('#moves .mv').length > 5, null, { timeout: 30_000 })
const loaded = await page.evaluate(() => ({
  orientation: document.querySelector('#board .cg-wrap, #board.cg-wrap')?.className.match(/orientation-(\w+)/)?.[1],
  moves: document.querySelectorAll('#moves .mv').length,
  current: document.querySelectorAll('#moves .mv.current').length,
}))
check(loaded.orientation === 'black', `board oriented to the user (black): ${loaded.orientation}`)
check(loaded.moves > 5 && loaded.current === 0, `game loaded at the initial position: ${loaded.moves} moves in the list, none current`)
await page.waitForFunction(() => document.getElementById('text').textContent.length > 20, null, { timeout: 120_000 })
await page.screenshot({ path: `${outDir}/games-04-loaded.png`, fullPage: true })

await page.evaluate(() => localStorage.removeItem('gamesFilters'))
await ctx.close()
process.exit(failed ? 1 : 0)
