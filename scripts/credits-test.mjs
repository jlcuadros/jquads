// End-to-end check of ⚙ → "Créditos y licencias" (licence review, 2026-10-25)
// in WebKit emulating an iPhone 13 with a Spanish device:
//   1. the footer link opens the credits;
//   2. every shipped component and its licence is named;
//   3. the "not affiliated / no warranty" notice is there;
//   4. "Textos completos de las licencias" points to licenses.txt, which is
//      served and contains the four licence texts.
//
// Usage (server running): node scripts/credits-test.mjs http://localhost:4173 <shots-dir>
import { webkit, devices } from 'playwright'

const [base = 'http://localhost:4173', outDir = '.'] = process.argv.slice(2)
let failed = 0
const check = (ok, msg) => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${msg}`)
  if (!ok) failed++
}

const browser = await webkit.launch()
const page = await browser.newPage({ ...devices['iPhone 13'], locale: 'es-ES' })
await page.goto(base)
await page.click('#openCredits')
const credits = page.locator('#creditsDetails')
check(await credits.evaluate((d) => d.open), 'footer link opens the credits')
const text = await credits.innerText()
const expected = ['AGPL-3.0', 'Maia-3', 'Stockfish', 'NNUE', 'CC0', 'lila-stockfish-web', 'chessground', 'cburnett', 'GPLv2+', 'chess.js', 'BSD-2', 'onnxruntime-web', 'MIT', 'Lichess']
const missing = expected.filter((w) => !text.includes(w))
check(!missing.length, `components and licences named (missing: ${missing.join(', ') || 'none'})`)
check(/sin relación con/.test(text) && /sin ninguna garantía/.test(text), 'not-affiliated and no-warranty notice')
const href = await credits.locator('a', { hasText: 'Textos completos de las licencias' }).getAttribute('href')
check(href === 'licenses.txt', `licence texts link: ${href}`)
const res = await page.request.get(new URL(href ?? '', page.url()).href)
const body = await res.text()
const texts = ['GNU AFFERO GENERAL PUBLIC LICENSE', 'GNU GENERAL PUBLIC LICENSE', 'MIT License', 'Jeff Hlywa']
check(res.ok() && texts.every((t) => body.includes(t)), `licenses.txt served (${res.status()}) with the 4 licence texts`)
await credits.screenshot({ path: `${outDir}/credits.png` })
await browser.close()
process.exit(failed ? 1 : 0)
