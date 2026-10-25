// End-to-end test of the 📂 games panel in WebKit (iPhone 13, Spanish),
// against the real Lichess and Chess.com APIs with José's accounts (Ousland
// on both sites).
//
// Lichess:
//   1. 📂 → type the username → list of games, newest first (≤ 20).
//   2. "Blitz" filter → every game is blitz; a date range → games within it.
//   3. "Cargar más" → more games, still newest first.
//   4. ☆ → ⭐, and the game appears in the "Favoritas" tab (then removed).
//   5. Tapping a game where the user had BLACK → board oriented to black,
//      at the initial position, with all the moves in the move list.
//   6. The top line (now with 📂) still fits; no horizontal overflow.
// Chess.com (2026-10-25):
//   7. Site selector → Chess.com, username → games newest first, all from Chess.com;
//      no "Clásica" chip; the username is also in ⚙.
//   8. "Rápida" filter (rare for José: goes through several months) and "Cargar más".
//   9. Favourites mix both sites, each labelled with its site.
//  10. A Chess.com game with black → board oriented to black; back to Lichess
//      keeps the Lichess username.
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
// Filter changes are debounced (400 ms) before the download starts: wait for that first.
const listReady = async () => { await page.waitForTimeout(600); await page.waitForFunction(() => !document.getElementById('gamesStatus').textContent.includes('Descargando'), null, { timeout: 60_000 }) }
const newestFirst = (r) => r.every((x, i) => i === 0 || r[i - 1].created >= x.created)
const day = (ms) => new Date(ms).toISOString().slice(0, 10)

/** Finds a game where the user had black (looking at more pages if needed), opens it and checks the board. */
async function openGameAsBlack(label) {
  let r = await rows()
  for (let i = 0; i < 3 && !r.some((x) => x.me === 'black') && !(await page.isHidden('#gamesMore')); i++) {
    await page.click('#gamesMore'); await listReady(); r = await rows()
  }
  const asBlack = r.find((x) => x.me === 'black')
  check(!!asBlack, `${label}: found a game as black (${asBlack?.id})`)
  if (!asBlack) return
  await page.click(`#gamesList li[data-id="${asBlack.id}"] .info`)
  await page.waitForFunction(() => document.getElementById('games').hidden && document.querySelectorAll('#moves .mv').length > 5, null, { timeout: 30_000 })
  const loaded = await page.evaluate(() => ({
    orientation: document.querySelector('#board .cg-wrap, #board.cg-wrap')?.className.match(/orientation-(\w+)/)?.[1],
    moves: document.querySelectorAll('#moves .mv').length,
    current: document.querySelectorAll('#moves .mv.current').length,
  }))
  check(loaded.orientation === 'black', `${label}: board oriented to the user (black): ${loaded.orientation}`)
  check(loaded.moves > 5 && loaded.current === 0, `${label}: game loaded at the initial position: ${loaded.moves} moves in the list, none current`)
}

await page.goto(base)
await page.waitForFunction(() => document.getElementById('text').textContent.length > 20, null, { timeout: 300_000 })
const top = await page.evaluate(() => ({ fits: document.getElementById('numbers').scrollWidth <= document.getElementById('numbers').clientWidth, doc: document.documentElement.scrollWidth, vp: document.documentElement.clientWidth }))
check(top.fits && top.doc <= top.vp, `top line with 📂 fits, no overflow (page ${top.doc}/${top.vp})`)

// 1. Open the panel, clear filters from previous runs, load the user's games.
await page.click('#gamesBtn')
await page.evaluate(() => localStorage.removeItem('gamesFilters'))
await page.click('#site-lichess')
await page.fill('#gamesUser', USER)
await page.click('#gamesLoad')
await listReady()
let r = await rows()
check(r.length > 0 && r.length <= 20 && newestFirst(r), `${r.length} games, newest first (${day(r[0]?.created)} … ${day(r.at(-1)?.created)})`)
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

// 4. Favourite (kept until the Chess.com part, which checks mixed favourites).
const lichessFav = r[0]
await page.click(`#gamesList li[data-id="${lichessFav.id}"] .fav`)
r = await rows()
check(r[0].fav === '⭐', `☆ → ⭐ on ${lichessFav.id}`)
await page.click('#tabFavorites')
check((await rows()).some((x) => x.id === lichessFav.id), `"Favoritas" tab contains ${lichessFav.id}`)
await page.screenshot({ path: `${outDir}/games-03-favorites.png`, fullPage: true })
await page.click('#tabRecent')

// 5. Open a game where the user had black. Both dates cleared quickly: with
// the debounce this makes ONE request.
await page.fill('#gamesFrom', ''); await page.dispatchEvent('#gamesFrom', 'change')
await page.fill('#gamesTo', ''); await page.dispatchEvent('#gamesTo', 'change'); await listReady()
await openGameAsBlack('Lichess')
await page.waitForFunction(() => document.getElementById('text').textContent.length > 20, null, { timeout: 120_000 })
await page.screenshot({ path: `${outDir}/games-04-loaded.png`, fullPage: true })

// ---------------------------------------------------------------------------
// Chess.com
// ---------------------------------------------------------------------------
await page.click('#gamesBtn')
await page.click('#site-chesscom')
// The panel keeps the filters in memory (Blitz is still on from the Lichess
// part): turn every chip off so the list starts unfiltered.
for (const chip of await page.$$('#speedChips .chip.on')) await chip.click()
await page.fill('#gamesUser', USER)
await page.click('#gamesLoad')
await listReady()
r = await rows()
const sites = await page.$$eval('#gamesList li', (lis) => [...new Set(lis.map((li) => li.dataset.site))])
check(r.length > 0 && r.length <= 20 && newestFirst(r) && sites.join() === 'chesscom', `Chess.com: ${r.length} games, newest first (${day(r[0]?.created)} … ${day(r.at(-1)?.created)}), sites: ${sites}`)
const chips = await page.$$eval('#speedChips .chip', (cs) => cs.map((c) => c.dataset.speed))
check(!chips.includes('classical') && chips.length === 4, `Chess.com chips without "Clásica": ${chips.join(', ')}`)
check((await page.inputValue('#chesscomUserSetting')) === USER, 'Chess.com username also saved in ⚙')
await page.screenshot({ path: `${outDir}/games-05-chesscom.png`, fullPage: true })

// 8. Rapid filter (José plays few: the app goes through several months) + load more.
await page.click('#speedChips .chip[data-speed="rapid"]')
await listReady()
r = await rows()
check(r.length > 0 && r.every((x) => x.meta.includes('Rápida')) && newestFirst(r), `Chess.com "Rápida" filter: ${r.length} games, all rapid (${day(r[0]?.created)} … ${day(r.at(-1)?.created)})`)
await page.click('#speedChips .chip[data-speed="rapid"]') // back to all speeds
await listReady()
r = await rows()
const ccBefore = r.length
if (!(await page.isHidden('#gamesMore'))) {
  await page.click('#gamesMore'); await listReady(); r = await rows()
}
check(r.length > ccBefore && newestFirst(r) && new Set(r.map((x) => x.id)).size === r.length, `Chess.com load more: ${ccBefore} → ${r.length}, newest first, no duplicates`)

// 9. Favourites from both sites, labelled.
const ccFav = r[0]
await page.click(`#gamesList li[data-id="${ccFav.id}"] .fav`)
await page.click('#tabFavorites')
const favs = await rows()
const favOf = (id) => favs.find((x) => x.id === id)
check(favOf(ccFav.id)?.meta.startsWith('Chess.com') && favOf(lichessFav.id)?.meta.startsWith('Lichess'), `favourites mix both sites, labelled: ${favs.map((x) => x.meta.split(' · ')[0]).join(', ')}`)
await page.screenshot({ path: `${outDir}/games-06-favorites-both.png`, fullPage: true })
for (const id of [ccFav.id, lichessFav.id]) await page.click(`#gamesList li[data-id="${id}"] .fav`) // clean up
await page.click('#tabRecent')
await listReady()

// 10. A Chess.com game with black; then back to Lichess keeps its username.
await openGameAsBlack('Chess.com')
await page.waitForFunction(() => document.getElementById('text').textContent.length > 20, null, { timeout: 120_000 })
await page.screenshot({ path: `${outDir}/games-07-chesscom-loaded.png`, fullPage: true })
await page.click('#gamesBtn')
await page.click('#site-lichess')
check((await page.inputValue('#gamesUser')) === USER, 'back to Lichess: its username is still there')

await page.evaluate(() => localStorage.removeItem('gamesFilters'))
await ctx.close()
process.exit(failed ? 1 : 0)
