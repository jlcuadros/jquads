// End-to-end test of the interface (index.html) emulating an iPhone in WebKit.
//
// 1. Opens the app, waits for the engines and the first full analysis
//    (explanatory text present).
// 2. Plays Maia's first suggestion by tapping it, and checks that the move
//    strip and the analysis update; waits for the threats bar too.
// 3. Checks the threats modes: "only moves" (default, no bar) and "bar and moves".
// 4. Saves screenshots (01-start, 02-after-move, 03-settings,
//    04-threats-only-moves, 05-threats-bar) to the folder given as 2nd argument.
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
const browser = await webkit.launchPersistentContext(profileDir, { ...devices['iPhone 13'] })
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

// Hide moves (👁): moves become "--", evaluations stay, nothing playable, no arrows.
await page.tap('#hideMoves')
const hidden = await page.evaluate(() => ({
  maia: document.getElementById('maiaCol').textContent,
  sf: document.getElementById('sfCol').textContent,
  text: document.getElementById('text').textContent,
  playable: document.querySelectorAll('.panel-col [data-move]').length,
  arrows: document.querySelectorAll('#board svg.cg-shapes g g, #board .cg-shapes line').length,
}))
await iter4(hidden.maia.includes('--') && hidden.sf.includes('--') && /[+−]\d/.test(hidden.sf) && hidden.playable === 0,
  `hidden moves: maia="${hidden.maia.replace(/\s+/g, ' ').slice(0, 50)}" sf="${hidden.sf.replace(/\s+/g, ' ').slice(0, 50)}" playable=${hidden.playable} arrows=${hidden.arrows}`)
await iter4(!/[a-h][1-8]/.test(hidden.text), `hidden moves also in the text: "${hidden.text.slice(0, 80)}"`)
await page.screenshot({ path: `${outDir}/06-hidden-moves.png`, fullPage: true })
await page.tap('#hideMoves')

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
console.log('legend (moves by probability):', await page.textContent('#meterMain .meter-legend'))
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
await page.click('#menu')
await page.click('#exportPgn')
await page.waitForFunction(() => window.__shared !== null, null, { timeout: 5000 }).catch(() => {})
const pgn = await page.evaluate(() => window.__shared)
console.log(`${pgn && pgn.includes('[Site "https://jquads.pages.dev"]') && /1\. e4/.test(pgn) ? 'OK  ' : 'FAIL'} export PGN: ${JSON.stringify((pgn ?? '').split('\n').pop() || pgn)}`)
await page.click('#menu')

// Back to the start: should come from the cache (instant).
const t1 = Date.now()
await page.click('#prev')
await page.waitForFunction(() => document.getElementById('text').textContent.length > 20)
console.log(`back to start (cached) in ${Date.now() - t1} ms`)

await browser.close()
