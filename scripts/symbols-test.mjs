// End-to-end test of iteration 7 (José, 2026-10-29) in WebKit emulating an iPhone 13
// (Spanish), with taps:
//
//   1. ⚙: the arrow checkboxes (SF, Maia, Amenazas) and "Símbolos automáticos" on by
//      default; all three off → no arrow on the board.
//   2. Scholar's mate line 1.e4 e5 2.Qh5 Nc6 3.Bc4 Nf6?? → the automatic "??" in grey
//      on Nf6 in the strip; the evaluation symbol next to ♙ / ♟ in the text.
//   3. The exported PGN carries the automatic symbols ("$4").
//   4. "Símbolos automáticos" off → no grey symbols.
//   5. 📜 of a Lichess and a Chess.com game: Elo after each name, names linking to
//      lichess.org/@/… and chess.com/member/….
//
// Usage (server running): node scripts/symbols-test.mjs http://localhost:4173 <shots-dir>
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
async function tapSquare(sq) {
  const b = await page.locator('#board cg-board').boundingBox()
  await page.touchscreen.tap(b.x + (sq.charCodeAt(0) - 96.5) * (b.width / 8), b.y + (8.5 - Number(sq[1])) * (b.height / 8))
}
/** Clicks a ⚙ checkbox (fires its change event even inside a folded group). */
const toggle = (id) => page.evaluate((i) => document.getElementById(i).click(), id)
const arrowCount = async () => (await page.waitForTimeout(400), page.$$eval('#board svg.cg-shapes line', (ls) => ls.length))

// 1. Defaults, then all arrows off.
const defaults = await page.evaluate(() => ['arrowSF', 'arrowMaia', 'arrowThreat', 'autoSymbols'].map((id) => document.getElementById(id).checked))
await page.tap('#positionBtn'); await page.tap('#newGame'); await analysed()
const withArrows = await arrowCount()
for (const id of ['arrowSF', 'arrowMaia', 'arrowThreat']) await toggle(id)
const without = await arrowCount()
for (const id of ['arrowSF', 'arrowMaia', 'arrowThreat']) await toggle(id)
check(defaults.every(Boolean) && withArrows >= 1 && without === 0, `⚙ defaults ${JSON.stringify(defaults)}; arrows ${withArrows} → ${without} with SF/Maia/Amenazas off`)

// 2. Scholar's mate line, every position analysed.
// After each move, wait for that move in the strip AND its analysis (the "done" flag of the
// previous position is still set for a moment: waiting only for it skipped analyses).
for (const [i, [a, b]] of [['e2', 'e4'], ['e7', 'e5'], ['d1', 'h5'], ['b8', 'c6'], ['f1', 'c4'], ['g8', 'f6']].entries()) {
  await tapSquare(a); await tapSquare(b)
  await page.waitForFunction((n) => document.querySelectorAll('#moves .mv').length === n && document.getElementById('meterMain').dataset.done === 'true', i + 1, { timeout: 300_000 })
}
await page.waitForTimeout(300)
const nf6 = await page.evaluate(() => {
  const mv = [...document.querySelectorAll('#moves .mv')].pop()
  return { text: mv.textContent, auto: [...mv.querySelectorAll('.nag.auto')].map((n) => n.textContent) }
})
const evalSym = await page.textContent('#text .side-text .eval-sym').catch(() => '')
check(nf6.auto.includes('??'), `Nf6 gets an automatic "??" (grey): ${JSON.stringify(nf6)}`)
check(['=', '⩲', '⩱', '±', '∓', '+−', '−+'].includes(evalSym), `evaluation symbol next to the pawn in the text: "${evalSym}"`)
await page.screenshot({ path: `${outDir}/symbols-01-auto.png`, fullPage: true })

// 3. Export.
await page.evaluate(() => { window.__shared = null; navigator.share = async (d) => { window.__shared = d.text } })
await page.tap('#positionBtn'); await page.tap('#exportPgn')
const pgn = await page.waitForFunction(() => window.__shared).then((h) => h.jsonValue())
check(/Nf6 \$4/.test(pgn), `exported PGN with the automatic symbols: ${JSON.stringify(pgn.trim().split('\n').pop())}`)
await page.tap('#positionBtn')

// 4. Off.
await toggle('autoSymbols')
const greyOff = await page.$$eval('#moves .nag.auto', (n) => n.length)
await toggle('autoSymbols')
check(greyOff === 0, `"Símbolos automáticos" off: ${greyOff} grey symbols`)

// 5. 📜 players: a Lichess and a Chess.com game in the favourites.
const games = {
  li: '[Event "Rated blitz game"]\n[Site "https://lichess.org/abcd1234"]\n[White "Ousland"]\n[Black "Rival"]\n[WhiteElo "2150"]\n[BlackElo "2100"]\n[Result "*"]\n\n1. e4 e5 *\n',
  cc: '[Event "Live Chess"]\n[Site "Chess.com"]\n[White "Ousland"]\n[Black "Rival"]\n[WhiteElo "1900"]\n[BlackElo "1950"]\n[Result "*"]\n[Link "https://www.chess.com/game/live/1"]\n\n1. d4 d5 *\n',
}
const players = {}
for (const [id, p] of Object.entries(games)) {
  await page.evaluate(([i, text]) => {
    const fav = { site: 'local', id: `local-${i}`, createdAt: Date.now(), speed: '', rated: false, status: 'started', white: { name: 'Ousland' }, black: { name: 'Rival' }, pgn: text }
    localStorage.setItem('favoriteGames', JSON.stringify({ [fav.id]: fav }))
  }, [id, p])
  page.once('dialog', (d) => d.accept()) // the Scholar's line may have unsaved annotations: no, but just in case
  await page.tap('#gamesBtn'); await page.tap('#tabFavorites')
  await page.tap(`#gamesList li[data-id="local-${id}"] .info`)
  await page.tap('#gameViewBtn')
  players[id] = await page.evaluate(() => ({
    about: document.querySelector('#gameViewBody .pv-about')?.textContent,
    links: [...document.querySelectorAll('#gameViewBody .pv-about a')].map((a) => a.href),
  }))
  await page.tap('#gameViewClose')
}
check(players.li.about?.startsWith('Ousland (2150) – Rival (2100)') && players.li.links.join() === 'https://lichess.org/@/Ousland,https://lichess.org/@/Rival',
  `📜 Lichess game: ${JSON.stringify(players.li)}`)
check(players.cc.about?.startsWith('Ousland (1900) – Rival (1950)') && players.cc.links.join() === 'https://www.chess.com/member/Ousland,https://www.chess.com/member/Rival',
  `📜 Chess.com game: ${JSON.stringify(players.cc)}`)

await page.evaluate(() => localStorage.removeItem('favoriteGames')) // clean up
await ctx.close()
process.exit(failed ? 1 : 0)
