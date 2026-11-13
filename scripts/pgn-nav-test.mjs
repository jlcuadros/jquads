// End-to-end test of the changes of 2026-11-09 (José) in WebKit emulating an
// iPhone 13 (Spanish), with touch taps:
//
//   1. ⏪ ⏩ at the ends of the move strip: hidden for a game made here; shown for a game of a
//      📁 Local database, disabled at the ends, on the strip's line; ⏩ opens the next game.
//   2. The moves the game already has after the current position are
//      highlighted in the Maia / Stockfish columns: the next move of the line
//      (.pgn-next) and a variation's move (.pgn-var), visible (a tinted
//      background) in the light and the dark theme.
//      ⚙ can turn the highlight off and on.
//   3. The eval bar's edges: drawn (.has-prev) once the previous position was
//      analysed.
//   4. A 📁 Local database remembers the game last opened from it (↩, .last),
//      also after a reload.
//
// Needs the engines cached in the profile (run ui-test.mjs once), no network.
// Usage (server running): node scripts/pgn-nav-test.mjs http://localhost:4173 <shots-dir>
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

// Start with no local databases (the test's file is the only one).
await page.goto(base)
await page.evaluate(async () => {
  for (const k of ['localDbs', 'gamesLocalDb']) localStorage.removeItem(k)
  await new Promise((r) => { const req = indexedDB.deleteDatabase('jquads-local-dbs'); req.onsuccess = req.onerror = req.onblocked = r })
})
await page.reload()
await page.waitForSelector('#board .cg-wrap, #board.cg-wrap')
const theme = await page.evaluate(() => document.documentElement.dataset.theme)

/** Waits until Maia and Stockfish have answered for the position on the board. */
const analysed = () => page.waitForFunction(() => document.querySelectorAll('#maiaCol tr[data-move]').length > 2 && document.querySelectorAll('#sfCol tr[data-move]').length > 1 && document.getElementById('meterMain').dataset.done === 'true', null, { timeout: 180_000 })
const nav = () => page.evaluate(() => ['stripPrevGame', 'stripNextGame'].map((id) => { const b = document.getElementById(id); return { shown: !b.hidden, disabled: b.disabled } }))
/** The highlight class of each move's row in a column. */
const marked = (col) => page.$$eval(`#${col} tr.pgn-next, #${col} tr.pgn-var`, (trs) => trs.map((tr) => `${tr.className}:${tr.dataset.move}`))
const bgOf = (sel) => page.$eval(sel, (td) => getComputedStyle(td).backgroundColor)

// 1. A game made here: no ⏪ ⏩.
let n = await nav()
check(!n[0].shown && !n[1].shown, `game made here: ⏪ ⏩ hidden (${JSON.stringify(n)})`)

// A file of 2 games; the first with a variation on Black's first move.
const PGN = '[Event "A"]\n[White "Ana"]\n[Black "Ousland"]\n[Result "*"]\n\n1. e4 e5 (1... c5) 2. Nf3 Nc6 *\n\n[Event "B"]\n[White "Ousland"]\n[Black "Berta"]\n[Result "*"]\n\n1. d4 d5 *\n'
await page.tap('#gamesBtn')
await page.tap('#tabLocal')
await page.setInputFiles('#localFile', { name: 'nav-test.pgn', mimeType: 'application/octet-stream', buffer: Buffer.from(PGN) })
await page.waitForFunction(() => document.querySelectorAll('#gamesList li').length === 2)
check(!(await page.$('#gamesList li.last')), 'a file opened for the first time: no ↩ game')
await page.tap('#gamesList li .info')
await page.waitForFunction(() => document.getElementById('games').hidden)
n = await nav()
check(n[0].shown && n[0].disabled && n[1].shown && !n[1].disabled, `first game of the file: ⏪ shown and disabled, ⏩ enabled (${JSON.stringify(n)})`)
// ⏪ left of the strip and ⏩ right of it, on its line; the numbers on top are not cut.
const layout = await page.evaluate(() => {
  const r = (id) => document.getElementById(id).getBoundingClientRect()
  const p = r('stripPrevGame'), m = r('moves'), x = r('stripNextGame'), nums = document.getElementById('numbers')
  return { order: p.right <= m.left && m.right <= x.left, line: Math.abs(p.top + p.height / 2 - (m.top + m.height / 2)) < 6, strip: Math.round(m.width), numbersFit: nums.scrollWidth <= nums.clientWidth }
})
check(layout.order && layout.line && layout.numbersFit, `⏪ [moves] ⏩ on one line, the top numbers not cut (${JSON.stringify(layout)})`)

// 2. At the start, 1. e4 is the game's next move.
await analysed()
const atStart = [...(await marked('maiaCol')), ...(await marked('sfCol'))]
check(atStart.includes('pgn-next:e2e4') && atStart.every((m) => m === 'pgn-next:e2e4'), `start: only 1. e4 highlighted as the next move (${atStart.join(', ')})`)
// After 1. e4: e5 is the line's move, c5 a variation's.
await page.tap('#next')
await analysed()
const afterE4 = await marked('maiaCol')
check(afterE4.includes('pgn-next:e7e5') && afterE4.includes('pgn-var:c7c5'), `after 1. e4, Maia: e5 = next move, c5 = variation (${afterE4.join(', ')})`)
const plain = await bgOf('#maiaCol tr[data-move]:not(.pgn-next):not(.pgn-var) td')
const next = await bgOf('#maiaCol tr.pgn-next td')
const vari = await bgOf('#maiaCol tr.pgn-var td')
check(next !== plain && vari !== plain && next !== vari, `${theme} theme: next / variation / plain rows differ (${next} | ${vari} | ${plain})`)
await page.screenshot({ path: join(outDir, `pgn-highlight-${theme}.png`) })
const other = theme === 'dark' ? 'light' : 'dark'
await page.evaluate((th) => (document.documentElement.dataset.theme = th), other)
await page.waitForTimeout(300) // WebKit gives an empty computed colour right after the switch
const next2 = await bgOf('#maiaCol tr.pgn-next td')
const vari2 = await bgOf('#maiaCol tr.pgn-var td')
const plain2 = await bgOf('#maiaCol tr[data-move]:not(.pgn-next):not(.pgn-var) td')
check(next2 !== plain2 && vari2 !== plain2 && next2 !== vari2, `${other} theme: next / variation / plain rows differ (${next2} | ${vari2} | ${plain2})`)
await page.screenshot({ path: join(outDir, `pgn-highlight-${other}.png`) })
await page.evaluate((th) => (document.documentElement.dataset.theme = th), theme)

// 2b. ⚙ "Resaltar en Maia y SF las jugadas de la partida" off → no highlight; on again → back.
const setHighlight = (on) => page.evaluate((v) => { const c = document.getElementById('pgnHighlight'); c.checked = v; c.dispatchEvent(new Event('change')) }, on)
await setHighlight(false)
const off = [...(await marked('maiaCol')), ...(await marked('sfCol'))]
await setHighlight(true)
const on = await marked('maiaCol')
check(!off.length && on.includes('pgn-next:e7e5'), `⚙ highlight off: none (${off.length}); on again: back (${on.join(', ')})`)

// 3. The start was analysed: the eval bar shows it on its edges.
const bar = await page.$eval('#evalBarEl', (b) => ({ prev: b.classList.contains('has-prev'), pos: b.style.getPropertyValue('--prev-pos'), now: b.style.getPropertyValue('--white-pos'), edge: getComputedStyle(b.querySelector('.prev.prev-l')).display,
  maia: b.classList.contains('has-prev-maia'), maiaPos: b.style.getPropertyValue('--prev-maia-pos'), maiaEdges: [...b.querySelectorAll('.prev-maia')].map((e) => getComputedStyle(e).display).join() }))
check(bar.prev && bar.edge === 'block' && bar.pos !== '', `eval bar after 1. e4: edges with the start's evaluation (${JSON.stringify(bar)})`)
check(bar.maia && bar.maiaEdges === 'block,block' && bar.maiaPos !== '', `eval bar: Maia's previous evaluation as red ticks on both edges (${bar.maiaPos})`)

// 1b. ⏩ opens the second (last) game.
await page.tap('#stripNextGame')
await page.waitForFunction(() => document.getElementById('stripNextGame').disabled)
n = await nav()
check(!n[0].disabled && n[1].disabled, `second game: ⏪ enabled, ⏩ disabled (${JSON.stringify(n)})`)
check((await page.$eval('#moves', (m) => m.textContent)).includes('d4'), 'the second game is on the board (1. d4)')

// 4. Opening the database again: the second game is the ↩ one, also after a reload.
const lastShown = async () => {
  await page.tap('#gamesBtn')
  await page.tap('#tabLocal')
  await page.waitForFunction(() => document.querySelectorAll('#gamesList li').length === 2)
  const li = await page.$$eval('#gamesList li', (lis) => lis.map((l) => (l.classList.contains('last') ? `last:${l.dataset.id.split('#')[1]}:${l.querySelector('.last-mark') ? '↩' : ''}` : '')).filter(Boolean))
  await page.tap('#gamesClose')
  return li
}
check((await lastShown()).join() === 'last:1:↩', 'database opened again: the second game marked ↩')
await page.reload()
await page.waitForSelector('#board .cg-wrap, #board.cg-wrap')
check((await lastShown()).join() === 'last:1:↩', 'after a reload: still the second game')

// Leave the profile without the test's database.
await page.evaluate(() => { localStorage.removeItem('localDbs'); localStorage.removeItem('gamesLocalDb'); indexedDB.deleteDatabase('jquads-local-dbs') })
await ctx.close()
console.log(failed ? 'SOME CHECKS FAILED' : 'all checks passed')
process.exit(failed ? 1 : 0)
