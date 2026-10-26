// End-to-end test of the translations in WebKit emulating an iPhone 13.
//
//   1. A French device opens the app in French by default (device language).
//   2. For each of the 7 languages, chosen in ⚙ → language:
//      static texts (⚙ buttons), texts generated in code (column headers,
//      explanatory text) and the editor change language; the page never gets
//      wider than the screen and the top line is not cut off.
//   3. Screenshots of the main screen + ⚙ panel per language.
//   4. Leaves the profile in Spanish.
//
// Usage (server running): node scripts/i18n-test.mjs http://localhost:4173 <shots-dir>
import { webkit, devices } from 'playwright'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const base = process.argv[2] ?? 'http://localhost:4173'
const outDir = process.argv[3] ?? '.'
mkdirSync(outDir, { recursive: true })
let failed = false
const check = (ok, msg) => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${msg}`); if (!ok) failed = true }
// Also waits for the opening book line (iteration 6): the book loads after the engines, and
// its line appearing mid-test moved the page under a pending tap (seen 2026-10-26).
// Taps ⚙, leaving 0.7 s after the previous tap. In WebKit's iPhone emulation a tap on ⚙ less
// than ~0.5 s after tapping the help's title fires pointer/mouse events but no click (measured
// 2026-10-26: 300 ms fails, 700 ms works; the same with touch taps; no app listener involved),
// and every later ⚙ tap of the test was then inverted.
const menu = async (page) => { await page.waitForTimeout(700); await page.click('#menu') }
const analysed = (page) => page.waitForFunction(() => document.getElementById('meterMain').dataset.done === 'true' && document.getElementById('text').textContent.length > 20 && document.querySelector('#text .book-line'), null, { timeout: 300_000 })

// Expected texts per language (from src/i18n/*.ts); `book` = start of the opening
// book line (iteration 6), which comes before the explanatory text. The explanatory text starts
// with "balanced" or "White has a slight advantage" depending on Stockfish's
// eval in that run (+0.3x is right at the ±0.35 boundary).
const EXPECT = {
  es: { exportPgn: 'Exportar PGN', evalHeader: 'eval', textStart: ['La posición', 'Las blancas'], editorApply: 'Analizar', book: '📖 Libro' },
  en: { exportPgn: 'Export PGN', evalHeader: 'eval', textStart: ['The position', 'White has'], editorApply: 'Analyse', book: '📖 Book' },
  fr: { exportPgn: 'Exporter PGN', evalHeader: 'éval', textStart: ['La position', 'Les Blancs'], editorApply: 'Analyser', book: '📖 Livre' },
  it: { exportPgn: 'Esporta PGN', evalHeader: 'val', textStart: ['La posizione', 'Il Bianco'], editorApply: 'Analizza', book: '📖 Libro' },
  ru: { exportPgn: 'Экспорт PGN', evalHeader: 'оценка', textStart: ['Позиция', 'У белых'], editorApply: 'Анализ', book: '📖 Книга' },
  de: { exportPgn: 'PGN exportieren', evalHeader: 'Bew.', textStart: ['Die Stellung', 'Weiß hat'], editorApply: 'Analysieren', book: '📖 Buch' },
  pt: { exportPgn: 'Exportar PGN', evalHeader: 'aval', textStart: ['A posição', 'As brancas'], editorApply: 'Analisar', book: '📖 Livro' },
}

// 1. Fresh French device (own temporary profile, no saved settings) → French.
{
  const ctx = await webkit.launchPersistentContext(join(tmpdir(), `maia-i18n-fr-${Date.now()}`), { ...devices['iPhone 13'], locale: 'fr-FR' })
  const page = await ctx.newPage()
  await page.goto(base)
  await page.waitForSelector('#exportPgn', { state: 'attached' }) // inside the closed ⚙ panel
  check((await page.textContent('#exportPgn')) === 'Exporter PGN' && (await page.getAttribute('html', 'lang')) === 'fr',
    `French device → French by default ("${await page.textContent('#exportPgn')}", lang=${await page.getAttribute('html', 'lang')})`)
  await ctx.close()
}

// 2. Every language through ⚙ (shared test profile, engines cached).
const ctx = await webkit.launchPersistentContext(process.env.UI_TEST_PROFILE ?? join(tmpdir(), 'maia-ui-test-webkit-profile'), { ...devices['iPhone 13'], locale: 'es-ES' })
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('pageerror:', e.message))
await page.goto(base)
await analysed(page)
for (const [lang, exp] of Object.entries(EXPECT)) {
  await menu(page)
  await page.selectOption('#lang', lang)
  await menu(page)
  await analysed(page)
  const got = {
    exportPgn: await page.textContent('#exportPgn'),
    evalHeader: await page.textContent('#sfCol th:last-child'),
    // The opening book line (iteration 6) comes first; the engines' text follows it.
    book: (await page.textContent('#text .book-line').catch(() => '')) ?? '',
    // The engines' paragraph (about the side to move), without its first icon (♙/♟, 2026-10-26).
    text: ((await page.textContent('#text .side-text').catch(() => '')) ?? '').replace(/^[♙♟]\uFE0E?\s*/, '').trim(),
    htmlLang: await page.getAttribute('html', 'lang'),
  }
  const widths = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, vp: document.documentElement.clientWidth, top: document.getElementById('numbers').scrollWidth <= document.getElementById('numbers').clientWidth }))
  check(got.exportPgn === exp.exportPgn && got.evalHeader === exp.evalHeader && exp.textStart.some((start) => got.text.startsWith(start)) && got.book.startsWith(exp.book) && got.htmlLang === lang,
    `${lang}: "${got.exportPgn}" | "${got.evalHeader}" | "${got.book.slice(0, 40)}…" | "${got.text.slice(0, 50)}…"`)
  check(widths.doc <= widths.vp && widths.top, `${lang}: no overflow (page ${widths.doc}/${widths.vp} px, top line fits: ${widths.top})`)
  // Editor texts (opened from ⚙ and cancelled).
  await menu(page); await page.click('#editPosition')
  check((await page.textContent('#edApply')) === exp.editorApply, `${lang}: editor "${await page.textContent('#edApply')}"`)
  await page.screenshot({ path: `${outDir}/i18n-${lang}-editor.png` })
  await page.click('#edCancel')
  await analysed(page)
  await page.screenshot({ path: `${outDir}/i18n-${lang}.png`, fullPage: true })
  await menu(page); await page.click('.help summary')
  // Screen-sized, not full-page: after a full-page screenshot of this (now longer) page,
  // WebKit stopped delivering the following taps on ⚙ (seen 2026-10-26, Playwright 1.64).
  await page.screenshot({ path: `${outDir}/i18n-${lang}-settings.png` })
  await page.click('.help summary'); await menu(page)
}
// 4. Back to Spanish.
await menu(page); await page.selectOption('#lang', 'es'); await menu(page)
await ctx.close()
process.exit(failed ? 1 : 0)
