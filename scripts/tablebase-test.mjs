// End-to-end test of the online endgame tables (Lichess Syzygy) in WebKit
// emulating an iPhone 13.
//
//   1. Starting position (32 pieces): NO request to the tablebase API.
//   2. Load K+R vs K by FEN: top line "TB: …", right column "TB Syzygy" (Maia % in the middle) with
//      "+M…" (signs in White's view, no words), vertical bar fully white, every legend move coloured, text
//      prefixed "Tablas de finales", threats computed too.
//   3. Going back and forth: answers come from the cache (no repeated requests).
//   4. ⚙ "Tablas de finales en línea" off → Stockfish again ("SF …").
//
// Usage (server running): node scripts/tablebase-test.mjs http://localhost:4173 <shots-dir>
import { webkit, devices } from 'playwright'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const base = process.argv[2] ?? 'http://localhost:4173'
const outDir = process.argv[3] ?? '.'
mkdirSync(outDir, { recursive: true })
const ctx = await webkit.launchPersistentContext(process.env.UI_TEST_PROFILE ?? join(tmpdir(), 'maia-ui-test-webkit-profile'), { ...devices['iPhone 13'], locale: 'es-ES' } /* Spanish device: these checks look for Spanish texts */)
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('pageerror:', e.message))
let failed = false
const check = (ok, msg) => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${msg}`); if (!ok) failed = true }
const tbRequests = []
page.on('request', (r) => { if (r.url().includes('tablebase.lichess.org')) tbRequests.push(r.url()) })
const analysed = () => page.waitForFunction(() => document.getElementById('meterThreats').dataset.done === 'true' && document.getElementById('text').textContent.length > 20, null, { timeout: 300_000 })

// Settings are persistent between runs: make sure the tables are on.
await page.goto(base)
await analysed()
await page.click('#menu')
if (!(await page.isChecked('#tablebase'))) await page.check('#tablebase')
await page.click('#menu')
await analysed()
check(tbRequests.length === 0, `start position (32 pieces): ${tbRequests.length} tablebase requests`)

// K+R vs K.
async function loadFen(fen) {
  await page.click('#menu')
  await page.fill('#fenInput', fen)
  await page.click('#loadFen')
  await analysed()
}
await loadFen('8/8/4k3/8/8/4K3/8/7R w - - 0 1')
const numbers = await page.textContent('#numbers')
const sfCol = (await page.textContent('#sfCol')).replace(/\s+/g, ' ')
const bar = await page.evaluate(() => document.getElementById('evalBarEl').style.getPropertyValue('--white-pos'))
const uncoloured = await page.locator('.meter-legend .move-chip.plain').count()
// The engines' paragraph starts with the pawn of the side to move (♙ here, 2026-10-26).
const text = (await page.textContent('#text .side-text')) ?? ''
check(/TB \+M\d+/.test(numbers), `top line: "${numbers}"`)
const fits = await page.evaluate(() => { const n = document.getElementById('numbers'); return n.scrollWidth <= n.clientWidth })
check(fits, 'top line fits (not cut off)')
check(sfCol.includes('TB Syzygy') && /[+−]M(\d+|\?)/.test(sfCol) && !/Gana|Pierde/.test(sfCol), `right column: "${sfCol.slice(0, 90)}"`)
check(bar === '100.0%', `vertical bar fully white: --white-pos=${bar}`)
check(uncoloured === 0, `every legend move coloured (uncoloured: ${uncoloured})`)
check(/^♙\uFE0E? Tablas de finales/.test(text), `text: "${text.slice(0, 110)}"`)
check(!(await page.textContent('#meterThreats')).includes('calculando'), `threats: "${(await page.textContent('#meterThreats')).slice(0, 60)}"`)
console.log(`tablebase requests so far: ${tbRequests.length} (position + threats)`)
await page.screenshot({ path: `${outDir}/tb-01-krk.png`, fullPage: true })

// Back and forth: play the best move and come back → cached, no new request for the start.
const before = tbRequests.length
await page.click('#sfCol tr[data-move]')
await analysed()
await page.click('#prev')
await analysed()
check(tbRequests.length - before <= 2, `after a move and back: ${tbRequests.length - before} new requests (only the new position + its threats)`)

// Tables off → Stockfish.
await page.click('#menu')
await page.uncheck('#tablebase')
await page.click('#menu')
await analysed()
check((await page.textContent('#numbers')).includes('SF'), `tables off → "${await page.textContent('#numbers')}"`)
await page.click('#menu'); await page.check('#tablebase'); await page.click('#menu') // leave the default

await ctx.close()
process.exit(failed ? 1 : 0)
