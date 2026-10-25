// Smoke test of prototype 0 in real browser engines (Playwright).
//
// Opens /proto.html?auto=1 (load Maia → load Stockfish → analyse) in WebKit
// (Safari's engine) and/or Chromium, waits until it finishes and prints the
// collected results (window.__proto) as JSON.
//
// Usage (the dev or preview server must be running, see app.md):
//   node scripts/smoke-test.mjs [url] [browsers]
//   node scripts/smoke-test.mjs http://localhost:4173 webkit,chromium
//
// Note: desktop WebKit is NOT an iPhone (no iOS memory limits), but it catches
// Safari-engine incompatibilities (e.g. missing APIs, WASM threads).
import { webkit, chromium } from 'playwright'

const base = process.argv[2] ?? 'http://localhost:4173'
const which = (process.argv[3] ?? 'webkit,chromium').split(',')
const variants = (process.env.SF_VARIANTS ?? 'sf17,sfhce').split(',')
const engines = { webkit, chromium }
const TIMEOUT_MS = 10 * 60 * 1000 // first run downloads ~125 MB

let failed = false
for (const name of which) {
  // One persistent profile per browser so the second variant reuses the cached files.
  const browser = await engines[name].launch()
  const context = await browser.newContext()
  for (const sf of variants) {
    const page = await context.newPage()
    page.on('console', (m) => { if (m.type() === 'error') console.log(`[${name}/${sf}] console.error: ${m.text()}`) })
    page.on('pageerror', (e) => console.log(`[${name}/${sf}] pageerror: ${e.message}`))
    await page.goto(`${base}/proto.html?auto=1&sf=${sf}&depth=14`)
    try {
      await page.waitForFunction(() => window.__proto?.done === true, null, { timeout: TIMEOUT_MS, polling: 1000 })
    } catch {
      console.log(`[${name}/${sf}] TIMEOUT`)
    }
    const res = await page.evaluate(() => window.__proto)
    const errors = Object.keys(res).filter((k) => k.endsWith('Error'))
    if (errors.length || !res.done) failed = true
    console.log(`\n===== ${name} / ${sf} =====\n` + JSON.stringify(res, null, 2))
    await page.close()
  }
  await browser.close()
}
process.exit(failed ? 1 : 0)
