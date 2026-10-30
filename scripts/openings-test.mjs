// End-to-end test of the opening names (iteration 11, José 2026-10-30) in WebKit
// emulating an iPhone 13 (Spanish). No network needed besides the app.
//
//   1. ⚙ → Interfaz: "Nombre de la apertura" and "Apertura en las jugadas" on by default;
//      the names file is served.
//   2. A Dragon game opened from a PGN file (📁 Local): at its end the text says
//      "🏷 Apertura: Sicilian Defense: Dragon Variation · B70"; two moves after the
//      list's theory the name stays; at the start there is none.
//   3. Exported PGN: [ECO "B70"], [Opening "…Dragon Variation"], {King's Pawn Game}
//      on 1. e4 and the Dragon on 5… g6, each name only where it changes.
//   4. 📜 shows the same comments.
//   4b. Where the name goes (José, 2026-10-30): first while in the book (📖 line shown)
//       and two half-moves after it, last from then on.
//   5. "Apertura en las jugadas" off → headers but no comments; "Nombre…" off → no
//      line in the text and no [Opening].
//
// Usage (server running): node scripts/openings-test.mjs http://localhost:4173 <shots-dir>
import { webkit, devices } from 'playwright'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openPanel, closePanel, openSettings, closeSettings } from './lib/ui-helpers.mjs'

const base = process.argv[2] ?? 'http://localhost:4173'
const outDir = process.argv[3] ?? '.'
mkdirSync(outDir, { recursive: true })
const ctx = await webkit.launchPersistentContext(process.env.UI_TEST_PROFILE ?? join(tmpdir(), 'maia-ui-test-webkit-profile'), { ...devices['iPhone 13'], locale: 'es-ES' })
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('pageerror:', e.message))
let failed = false
const check = (ok, msg) => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${msg}`); if (!ok) failed = true }

await page.goto(base)
await page.waitForSelector('#board .cg-wrap, #board.cg-wrap')

// 1. Settings and file.
await openSettings(page)
const defaults = await page.evaluate(() => ({ name: document.getElementById('openingName').checked, comments: document.getElementById('openingComments').checked }))
check(defaults.name && defaults.comments, `both settings on by default (${JSON.stringify(defaults)})`)
await closeSettings(page)
const file = await page.evaluate(async () => {
  const res = await fetch('openings/lichess-openings-712a58b.json')
  const j = await res.json()
  return { ok: res.ok, n: Object.keys(j.openings).length, license: j.license }
})
check(file.ok && file.n > 3800 && file.license === 'CC0-1.0', `names file served: ${file.n} positions, ${file.license}`)

// 2. A Dragon game from a PGN file.
// Ends with king walks that are surely out of the book (2300+ games).
const DRAGON = '[Event "Test"]\n[White "A"]\n[Black "B"]\n[Result "*"]\n\n1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 g6 6. a3 a6 7. Kd2 Kd7 8. Ke1 Ke8 9. Kd2 Kd7 *\n'
await page.tap('#gamesBtn'); await page.tap('#tabLocal')
await page.setInputFiles('#localFile', { name: 'dragon-test.pgn', mimeType: 'application/octet-stream', buffer: Buffer.from(DRAGON) })
await page.waitForSelector('#gamesList li')
await page.tap('#gamesList li .info')
await page.waitForFunction(() => document.getElementById('games').hidden)
const openingLine = () => page.evaluate(() => document.querySelector('#text .opening-line')?.textContent ?? '')
await page.waitForFunction(() => document.querySelector('#text .opening-line') === null) // at the start: no name
check(true, 'starting position: no opening line')
await page.tap('#last')
await page.waitForFunction(() => document.querySelector('#text .opening-line')?.textContent.includes('Dragon'), null, { timeout: 30_000 })
check((await openingLine()) === '🏷 Apertura: Sicilian Defense: Dragon Variation · B70', `at the end (out of the list) the name stays: "${await openingLine()}"`)

// 4b. Walk back from the end: at each position, is the name first or last, and is there a 📖 line?
const seen = [] // from the end backwards: { book, place }
for (let i = 0; i < 12; i++) {
  // Wait for the engines' paragraph: alone, the name would be both first and last.
  await page.waitForFunction(() => document.querySelector('#text .opening-line') && document.querySelector('#text .side-text'), null, { timeout: 120_000 })
  seen.push(await page.evaluate(() => {
    const divs = [...document.querySelectorAll('#text > div')]
    const at = divs.findIndex((d) => d.classList.contains('opening-line'))
    return { book: !!document.querySelector('#text .book-line'), place: at === 0 ? 'first' : at === divs.length - 1 ? 'last' : `#${at}` }
  }))
  await page.tap('#prev')
}
// Expected: first if this position or one of the two before it (later in `seen`) shows 📖.
const expected = seen.map((_, i) => (seen.slice(i, i + 3).some((s) => s.book) ? 'first' : 'last'))
check(seen.every((s, i) => s.place === expected[i]) && seen.some((s) => s.place === 'last') && seen.some((s) => s.place === 'first'),
  `name first in the book and 2 half-moves after, then last (from the end back): ${seen.map((s) => `${s.book ? '📖' : '·'}${s.place[0]}`).join(' ')}`)
await page.tap('#last')
await page.waitForFunction(() => document.querySelector('#text > div:last-child')?.classList.contains('opening-line'))
await page.screenshot({ path: `${outDir}/openings-03-last.png` })
await page.screenshot({ path: `${outDir}/openings-01-text.png` })
await page.tap('#first'); await page.tap('#next')
await page.waitForFunction(() => document.querySelector('#text .opening-line')?.textContent.includes("King's Pawn"))
check((await openingLine()).includes("King's Pawn Game · B00"), `after 1. e4: "${await openingLine()}"`)

// 3. Exported PGN (📋 → Exportar PGN, share sheet intercepted).
const exportPgn = async () => {
  await page.evaluate(() => { window.__shared = null; navigator.share = async (d) => { window.__shared = d.text } })
  await openPanel(page, '#positionBtn', '#positionPanel') // 📋
  await page.tap('#exportPgn')
  const pgn = await page.waitForFunction(() => window.__shared).then((h) => h.jsonValue())
  await closePanel(page, '#positionBtn', '#positionPanel')
  return pgn
}
let pgn = await exportPgn()
const dragonComments = (pgn.match(/\{Sicilian Defense: Dragon Variation\}/g) ?? []).length
check(pgn.includes('[ECO "B70"]') && pgn.includes('[Opening "Sicilian Defense: Dragon Variation"]'), 'PGN headers ECO + Opening')
check(pgn.includes("1. e4 {King's Pawn Game}") && pgn.includes('g6 {Sicilian Defense: Dragon Variation} 6. a3') /* + $146 (N) if the automatic symbols are on */ && !/a6 \{/.test(pgn) && dragonComments === 1,
  `comments where the name changes: ${pgn.trim().split('\n').pop()}`)

// 4. 📜 shows them too.
await page.tap('#gameViewBtn')
const view = await page.textContent('#gameViewBody')
check(view.includes("King's Pawn Game") && view.includes('Sicilian Defense: Dragon Variation'), '📜 shows the opening names on the moves')
await page.screenshot({ path: `${outDir}/openings-02-gameview.png` })
await page.tap('#gameViewClose')

// 5. Settings off.
const toggle = async (id) => { await openSettings(page); await page.evaluate((i) => document.getElementById(i).click(), id); await closeSettings(page) }
await toggle('openingComments')
pgn = await exportPgn()
check(pgn.includes('[Opening "Sicilian Defense: Dragon Variation"]') && !pgn.includes('{'), '"Apertura en las jugadas" off: headers, no comments')
await toggle('openingName')
pgn = await exportPgn()
check(!pgn.includes('[Opening') && !pgn.includes('[ECO') && (await openingLine()) === '', '"Nombre de la apertura" off: no headers, no line in the text')
await toggle('openingName'); await toggle('openingComments') // back to the defaults

// Clean up the local database of the test.
await page.evaluate(() => { localStorage.removeItem('localDbs'); localStorage.removeItem('gamesLocalDb'); indexedDB.deleteDatabase('jquads-local-dbs') })
await ctx.close()
process.exit(failed ? 1 : 0)
