// End-to-end test of the opening book (iteration 6, 2026-10-26) in WebKit
// emulating an iPhone 13 (Spanish):
//
//   1. The book file is served and downloaded once (then IndexedDB).
//   2. Starting position: the text starts with "📖 Libro (2300+, …): e4 …%
//      · d4 …% … — N partidas"; book moves carry 📖 in the Maia and SF columns.
//   3. A position far from the opening (loaded by FEN): no book line, no 📖.
//   4. ⚙ → "Libro de aperturas" off: no book anywhere; on again: back.
//   5. No horizontal overflow with the 📖 marks.
//
// Usage (server running): node scripts/book-test.mjs http://localhost:4173 <shots-dir>
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
const state = () => page.evaluate(() => ({
  bookLine: document.querySelector('#text .book-line')?.textContent ?? '',
  textStart: document.getElementById('text').textContent.slice(0, 2),
  maiaMarks: document.querySelectorAll('#maiaCol .book-mark').length,
  sfMarks: document.querySelectorAll('#sfCol .book-mark').length,
  overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
}))

const bookRequests = []
page.on('request', (r) => { if (r.url().includes('/book/')) bookRequests.push(r.url()) })
await page.goto(base)
// Ensure the book is on and the language Spanish (persistent profile) and wait for the full analysis + the book.
await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('settings') ?? '{}'); s.book = true; s.lang = 'es'; localStorage.setItem('settings', JSON.stringify(s)) })
await page.reload()
await page.waitForFunction(() => document.getElementById('meterMain').dataset.done === 'true', null, { timeout: 300_000 })
await page.waitForFunction(() => document.querySelector('#text .book-line'), null, { timeout: 120_000 })

// 1–2. Starting position.
let s = await state()
// GET, not HEAD: Cloudflare's HEAD answer has no content-length (seen in production 2026-10-26).
const file = await page.request.get(new URL('book/lichess-2300-slow-v1.bin', page.url()).href)
const size = (await file.body()).length
check(file.ok() && size > 1e6 && size % 16 === 0, `book file served: ${file.status()}, ${size} bytes (16-byte entries)`)
check(s.textStart === '📖' && /^📖 Libro \(2300\+, rápidas y clásicas\): e4 \d+% · d4 \d+%/.test(s.bookLine) && /— [\d.]+ partidas$/.test(s.bookLine), `book line: "${s.bookLine}"`)
check(s.maiaMarks >= 2 && s.sfMarks >= 2, `📖 marks: Maia ${s.maiaMarks}, SF ${s.sfMarks}`)
check(!s.overflow, 'no horizontal overflow with the 📖 marks')
await page.screenshot({ path: `${outDir}/book-01-start.png`, fullPage: true })

// 3. Out of the book: a middlegame position by FEN.
await page.click('#menu')
await page.fill('#fenInput', 'r1bq1rk1/pp2bppp/2n1pn2/3p4/2PP4/2N1PN2/P3BPPP/R1BQ1RK1 w - - 0 9')
await page.click('#loadFen')
await page.waitForFunction(() => document.getElementById('meterMain').dataset.done === 'true', null, { timeout: 120_000 })
s = await state()
check(!s.bookLine && s.maiaMarks === 0 && s.sfMarks === 0, `out of the book: no line, no marks (${JSON.stringify(s)})`)

// 4. Turn the book off and on (back at the start position).
await page.click('#menu'); await page.click('#newGame')
await page.waitForFunction(() => document.querySelector('#text .book-line'), null, { timeout: 60_000 })
await page.click('#menu'); await page.uncheck('#book'); await page.click('#menu')
s = await state()
check(!s.bookLine && s.maiaMarks === 0 && s.sfMarks === 0, 'book off: no line, no marks')
await page.click('#menu'); await page.check('#book'); await page.click('#menu')
s = await state()
check(!!s.bookLine && s.maiaMarks > 0, 'book on again: line and marks back')
check(bookRequests.length <= 1, `book downloaded at most once (${bookRequests.length} request${bookRequests.length === 1 ? '' : 's'}; 0 = from the cache)`)

await ctx.close()
process.exit(failed ? 1 : 0)
