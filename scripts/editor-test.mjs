// End-to-end test of the position editor (⚙ → "Introducir posición") in WebKit
// emulating an iPhone 13, using touch taps like a real finger.
//
//   1. Opens the editor, empties the board → must show the "rey blanco" error
//      and disable "Analizar".
//   2. Places K e1, R h1, k e8 with the palette (tap piece, tap square)
//      → castling "O-O ♔" must become available; error gone.
//   3. "Analizar" → editor closes and the app analyses that position.
//   4. Saves screenshots (editor-01-empty, editor-02-placed, editor-03-analysed).
//
// Usage (preview server running): node scripts/editor-test.mjs http://localhost:4173 <shots-dir>
import { webkit, devices } from 'playwright'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const base = process.argv[2] ?? 'http://localhost:4173'
const outDir = process.argv[3] ?? '.'
mkdirSync(outDir, { recursive: true })
const profileDir = process.env.UI_TEST_PROFILE ?? join(tmpdir(), 'maia-ui-test-webkit-profile')
const ctx = await webkit.launchPersistentContext(profileDir, { ...devices['iPhone 13'], locale: 'es-ES' } /* Spanish device: these checks look for Spanish texts */)
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('pageerror:', e.message))
let failed = false
const check = (ok, msg) => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${msg}`); if (!ok) failed = true }

await page.goto(base)
await page.waitForFunction(() => document.getElementById('text').textContent.length > 20, null, { timeout: 600_000 })

// Open the editor.
await page.tap('#positionBtn') // 📋 (the editor moved out of ⚙, 2026-10-26)
await page.tap('#editPosition')
check(await page.isVisible('#editor'), 'editor opens full screen')

// Centre of a square on the editor board (white at the bottom).
async function tapSquare(sq) {
  const b = await page.locator('#editorBoard').boundingBox()
  const file = sq.charCodeAt(0) - 97
  const rank = Number(sq[1])
  await page.touchscreen.tap(b.x + (file + 0.5) * (b.width / 8), b.y + (8.5 - rank) * (b.height / 8))
}
const tool = (color, role) => page.tap(`#editor button.pal[data-color="${color}"][data-role="${role}"]`)

// 1. Empty board → invalid.
await page.tap('#edClear')
check((await page.textContent('#edError')).includes('rey blanco'), `empty board shows error: "${await page.textContent('#edError')}"`)
check(await page.isDisabled('#edApply'), '"Analizar" disabled while invalid')
await page.screenshot({ path: `${outDir}/editor-01-empty.png` })

// 2. Place pieces.
await tool('white', 'king'); await tapSquare('e1')
await tool('white', 'rook'); await tapSquare('h1')
await tool('black', 'king'); await tapSquare('e8')
// chessground calls its event handlers in a setTimeout, so the editor updates a few ms
// after the tap: wait for the state instead of reading it immediately.
const valid = await page.waitForFunction(() => document.getElementById('edError').textContent === '', null, { timeout: 2000 }).then(() => true, () => false)
check(valid, 'valid after placing both kings (3 pieces)')
check(!(await page.isDisabled('#edK')), 'white short castling available (K e1 + R h1)')
check(await page.isDisabled('#edQ'), 'white long castling not available (no rook on a1)')
await page.check('#edK')
await page.screenshot({ path: `${outDir}/editor-02-placed.png` })

// 3. Analyse it.
await page.tap('#edApply')
check(!(await page.isVisible('#editor')), 'editor closes on "Analizar"')
await page.waitForFunction(() => document.getElementById('text').textContent.length > 20, null, { timeout: 120_000 })
console.log('analysis:', (await page.textContent('#text')).trim())
console.log('Stockfish:', (await page.textContent('#sfCol')).replace(/\s+/g, ' ').trim())
await page.screenshot({ path: `${outDir}/editor-03-analysed.png`, fullPage: true })

await ctx.close()
process.exit(failed ? 1 : 0)
