// End-to-end test of iteration 10 (José, 2026-10-30) in WebKit emulating an
// iPhone 13 (Spanish), with touch taps. No network needed besides the app.
//
//   1. 📂: 💾 Guardar at the top left; the row Lichess | Chess.com | ⭐ | 📁 fits
//      (320 px, 7 languages; texts from 420 px).
//   2. 📁 Local: no username or filters; "📄 Abrir PGN…" reads a file of 3 games
//      (CRLF, a variation, a date "????"); its button has a shortened name
//      without extension; the games in file order.
//   3. Five files opened → only the last 4 stay.
//   4. 📜 bar: ⏪ / ⏩ go through the games of the file (disabled at the ends),
//      📂 shows the list again (the game highlighted), 💾 opens "Guardar".
//   5. "＋ Nueva" → "Mis análisis"; 💾 Guardar en «Mis análisis» → it is in the
//      list; again → "Guardar cambios" (no duplicate). The opened files are not
//      offered as destinations (read-only).
//   6. After a reload the databases and their games are still there; a local game
//      starred shows its database name in ⭐ Favoritas.
//   7. ⬇ Descargar PGN of "Mis análisis"; 🗑 Quitar deletes it.
//   8. ⚙ → Interfaz: the note under "Columna «h-eval» en Maia".
//
// Usage (server running): node scripts/local-test.mjs http://localhost:4173 <shots-dir>
import { webkit, devices } from 'playwright'
import { mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { plainPgn } from './lib/ui-helpers.mjs'

const base = process.argv[2] ?? 'http://localhost:4173'
const outDir = process.argv[3] ?? '.'
mkdirSync(outDir, { recursive: true })
const ctx = await webkit.launchPersistentContext(process.env.UI_TEST_PROFILE ?? join(tmpdir(), 'maia-ui-test-webkit-profile'), { ...devices['iPhone 13'], locale: 'es-ES', acceptDownloads: true })
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('pageerror:', e.message))
let failed = false
const check = (ok, msg) => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${msg}`); if (!ok) failed = true }

/** Starts with no local databases and no favourites. */
async function cleanUp() {
  await page.evaluate(async () => {
    for (const k of ['localDbs', 'gamesLocalDb', 'favoriteGames', 'favoritesPgn']) localStorage.removeItem(k)
    await new Promise((r) => { const req = indexedDB.deleteDatabase('jquads-local-dbs'); req.onsuccess = req.onerror = req.onblocked = r })
  })
}
await page.goto(base)
await cleanUp()
await page.reload()
await page.waitForSelector('#board .cg-wrap, #board.cg-wrap')
// Exact PGNs are compared: the automatic symbols and the opening names on the moves off (restored at the end).
const restoreAuto = await plainPgn(page)

const rows = () => page.$$eval('#gamesList li', (lis) => lis.map((li) => ({ id: li.dataset.id, players: li.querySelector('.players').textContent, meta: li.querySelector('.meta').textContent, picked: li.classList.contains('picked') })))
const dbButtons = () => page.$$eval('#localDbs .chip', (bs) => bs.map((b) => ({ text: b.textContent, title: b.title, on: b.classList.contains('on') })))
const status = () => page.textContent('#gamesStatus')
const pgnFile = (name, text) => ({ name, mimeType: 'application/octet-stream', buffer: Buffer.from(text) })
const openPgn = async (name, text) => {
  await page.setInputFiles('#localFile', pgnFile(name, text))
  await page.waitForFunction((n) => [...document.querySelectorAll('#localDbs .chip.on')].some((b) => b.title === n), name.replace(/\.[^.]+$/, ''))
}

// 1. The panel's top: 💾 at the left of the header, the row fits.
await page.tap('#gamesBtn')
const top = await page.evaluate(() => {
  const h = document.querySelector('#games .editor-top'), save = document.getElementById('gamesSaveBtn'), close = document.getElementById('gamesClose')
  return { first: h.firstElementChild.id, sameLine: Math.abs(save.getBoundingClientRect().top - close.getBoundingClientRect().top) < 4 }
})
check(top.first === 'gamesSaveBtn' && top.sameLine, `💾 Guardar at the top left, at the height of "Cerrar" (${JSON.stringify(top)})`)
const rowIds = await page.$$eval('.games-sites .tab', (bs) => bs.map((b) => b.id))
check(rowIds.join() === 'site-lichess,site-chesscom,tabFavorites,tabLocal', `row: ${rowIds.join(' | ')}`)

// 2. 📁 Local with a file of 3 games.
await page.tap('#tabLocal')
check(await page.isHidden('#gamesUserRow') && await page.isHidden('#gamesFilters') && await page.isVisible('#localOpen'), '📁 Local: no username or filters; "Abrir PGN…" shown')
check((await status()).includes('Abre un PGN'), `no databases yet: "${await status()}"`)
const G = (n, white, black, date, moves, result) => `[Event "Torneo ${n}"]\r\n[Date "${date}"]\r\n[White "${white}"]\r\n[Black "${black}"]\r\n[Result "${result}"]\r\n\r\n${moves} ${result}\r\n`
const FILE3 = '﻿' + [G(1, 'Ana', 'Ousland', '2026.01.10', '1. e4 e5 (1... c5) 2. Nf3', '0-1'), G(2, 'Ousland', 'Berta', '????.??.??', '1. d4 d5', '1-0'), G(3, 'Carla', 'Dani', '2025.06.01', '1. c4 e5 2. Nc3', '1/2-1/2')].join('\r\n')
const BIG = 'repertorio-blancas-italiana-2026.pgn'
await openPgn(BIG, FILE3)
let r = await rows()
const btn = (await dbButtons()).find((b) => b.on)
check(btn?.text === '📄 repertori…ana-2026' && btn.title === 'repertorio-blancas-italiana-2026', `button: "${btn?.text}" (title "${btn?.title}"): shortened, no extension`)
check(r.length === 3 && r.map((x) => x.players.split(' – ')[0]).join() === '♔ Ana,♔ Ousland,♔ Carla', `3 games in file order: ${r.map((x) => x.players).join(' | ')}`)
check(!/\d{4}/.test(r[1].meta) && r[0].meta.includes('2026'), `a game without date shows none ("${r[1].meta}" / "${r[0].meta}")`)
check(await page.isVisible('#listDownload') && await page.isVisible('#localRemove'), '⬇ Descargar PGN and 🗑 Quitar shown')
await page.screenshot({ path: `${outDir}/local-01-file.png` })

// 3. Four more files: the first one is forgotten.
for (const n of [1, 2, 3, 4]) await openPgn(`f${n}.pgn`, G(n, 'X', 'Y', '2026.10.30', '1. e4', '*'))
const names = (await dbButtons()).map((b) => b.title)
check(names.length === 4 && !names.includes('repertorio-blancas-italiana-2026') && names[0] === 'f4', `only the last 4 files: ${names.join(', ')}`)
await openPgn(BIG, FILE3) // open it again for the next steps (f1 goes)

// 4. 📜: previous / next game, back to the list, headers.
await page.tap('#gamesList li:nth-child(2) .info')
await page.waitForFunction(() => document.getElementById('games').hidden)
await page.tap('#gameViewBtn')
const bar = async () => page.evaluate(() => ({
  prev: !document.getElementById('gvPrevGame').disabled, next: !document.getElementById('gvNextGame').disabled,
  db: document.getElementById('gvDb').textContent, about: document.querySelector('#gameViewBody .pv-about')?.textContent ?? '',
}))
let b = await bar()
check(b.prev && b.next && b.db === '📂 repertori…ana-2026' && b.about.includes('Berta') && !b.about.includes('?'), `📜 bar on game 2: ⏪ ⏩ on, "${b.db}", "${b.about}"`)
await page.screenshot({ path: `${outDir}/local-02-gameview.png` })
await page.tap('#gvNextGame'); await page.waitForFunction(() => document.querySelector('#gameViewBody .pv-about')?.textContent.includes('Carla'))
b = await bar()
check(!b.next && b.prev, `⏩ → game 3 (${b.about}); ⏩ off at the end`)
await page.tap('#gvPrevGame'); await page.waitForFunction(() => document.querySelector('#gameViewBody .pv-about')?.textContent.includes('Berta'))
await page.tap('#gvPrevGame'); await page.waitForFunction(() => document.querySelector('#gameViewBody .pv-about')?.textContent.includes('Ana'))
b = await bar()
check(!b.prev && b.next && await page.isVisible('#gameView'), `⏪ ⏪ → game 1 (${b.about}); ⏪ off at the start; 📜 still open`)
const varOk = await page.evaluate(() => document.querySelectorAll('#gameViewBody .pv-var').length)
check(varOk === 1, `game 1 opened with its variation (${varOk})`)
await page.tap('#gvDb')
await page.waitForFunction(() => !document.getElementById('games').hidden)
r = await rows()
check(await page.isHidden('#gameView') && (await page.getAttribute('#tabLocal', 'class')).includes('active') && r[0].picked && !r[1].picked, '📂 → the file\'s list again, game 1 highlighted')
await page.tap('#gamesClose'); await page.tap('#gameViewBtn'); await page.tap('#gvHeaders')
check(await page.isVisible('#gamesSave') && (await page.inputValue('#pgnh-White')) === 'Ana', '💾 Cabeceras → "Guardar" with the game\'s headers')
let to = await page.$$eval('#saveTo option', (os) => os.map((o) => o.textContent))
check(to.length === 1 && to[0] === '⭐ Favoritas', `opened files are read-only: "Guardar en" offers ${to.join(', ')}`)

// 5. A database made here, and saving into it.
await page.tap('#tabLocal')
page.once('dialog', (d) => d.accept('Mis análisis'))
await page.tap('#localNew')
await page.waitForFunction(() => [...document.querySelectorAll('#localDbs .chip.on')].some((b) => b.title === 'Mis análisis'))
check((await status()).includes('aún no tiene partidas') && (await dbButtons())[0].text === '📝 Mis análisis', `new database first, empty: "${await status()}"`)
await page.tap('#gamesSaveBtn')
await page.selectOption('#saveTo', { label: '📁 Mis análisis' })
check((await page.textContent('#saveGame')) === '💾 Guardar en «Mis análisis»', `button: "${await page.textContent('#saveGame')}"`)
await page.fill('#pgnh-Event', 'Análisis de la 1')
await page.screenshot({ path: `${outDir}/local-03-save.png` })
await page.tap('#saveGame')
await page.waitForFunction(() => document.querySelectorAll('#gamesList li').length === 1)
r = await rows()
check((await status()) === 'Partida guardada en «Mis análisis».' && r[0].meta.includes('Análisis de la 1'), `saved: "${await status()}", ${r[0].players} · ${r[0].meta}`)
await page.tap('#gamesSaveBtn')
check((await page.inputValue('#saveTo')) !== 'fav' && (await page.textContent('#saveGame')) === '💾 Guardar cambios en «Mis análisis»', `again: "${await page.textContent('#saveGame')}"`)
await page.fill('#pgnh-Black', 'Ousland2')
await page.tap('#saveGame')
await page.waitForFunction(() => document.querySelector('#gamesList li .players')?.textContent.includes('Ousland2'))
check((await rows()).length === 1, 'updated in place, no duplicate')

// 6. After a reload; a local game in the favourites.
await page.reload()
await page.waitForSelector('#board .cg-wrap, #board.cg-wrap')
await page.tap('#gamesBtn'); await page.tap('#tabLocal')
await page.waitForFunction(() => document.querySelectorAll('#gamesList li').length === 1)
const kept = (await dbButtons()).map((b) => b.title)
check(kept.includes('Mis análisis') && kept.includes('repertorio-blancas-italiana-2026') && kept.length === 5, `after reload: ${kept.join(', ')} (the made-here one doesn't count among the 4 files)`)
await page.tap('#localDbs .chip[title="repertorio-blancas-italiana-2026"]')
await page.waitForFunction(() => document.querySelectorAll('#gamesList li').length === 3)
await page.tap('#gamesList li:nth-child(3) .fav')
await page.tap('#tabFavorites')
r = await rows()
check(r.length === 1 && r[0].meta.startsWith('repertorio-blancas-italiana-2026'), `⭐: a local game says its database ("${r[0]?.meta}")`)
await page.tap('#gamesList li .fav') // clean up

// 7. Download and remove "Mis análisis".
await page.tap('#tabLocal')
await page.tap('#localDbs .chip[title="Mis análisis"]')
await page.waitForFunction(() => document.querySelectorAll('#gamesList li').length === 1)
await page.evaluate(() => { navigator.canShare = () => false })
const [download] = await Promise.all([page.waitForEvent('download'), page.tap('#listDownload')])
const text = readFileSync(await download.path(), 'utf8')
// The browser may hand the name back decomposed (a + ´): compare it normalised.
check(download.suggestedFilename().normalize('NFC') === 'Mis análisis.pgn' && text.includes('[Event "Análisis de la 1"]') && text.includes('[Black "Ousland2"]') && text.includes('(1... c5)'), `downloaded ${download.suggestedFilename()} (${text.length} chars, with the variation)`)
page.once('dialog', (d) => d.accept())
await page.tap('#localRemove')
await page.waitForFunction(() => ![...document.querySelectorAll('#localDbs .chip')].some((b) => b.title === 'Mis análisis'))
check((await dbButtons()).length === 4, `🗑 Quitar: "Mis análisis" deleted, ${(await dbButtons()).length} files left`)
await page.screenshot({ path: `${outDir}/local-04-after.png` })
await page.tap('#gamesClose')

// 8. ⚙ → Interfaz: the h-eval column note.
const note = await page.evaluate(() => document.getElementById('showHevalCol').closest('label').nextElementSibling)
const noteText = await page.evaluate(() => document.getElementById('showHevalCol').closest('label').nextElementSibling?.textContent ?? '')
check(note !== null && noteText.includes('Candidatas h-eval'), `note under the h-eval column: "${noteText}"`)

// 1b. Widths: the row and the header fit in every language; texts only from 420 px.
for (const width of [320, 390, 420]) {
  await page.setViewportSize({ width, height: 700 })
  const bad = []
  let texts = 0
  for (const lang of ['es', 'en', 'fr', 'de', 'it', 'pt', 'ru']) {
    await page.evaluate((l) => { const s = document.getElementById('lang'); s.value = l; s.dispatchEvent(new Event('change')) }, lang)
    await page.evaluate(() => document.getElementById('gamesBtn').click())
    const fit = await page.evaluate(() => [document.querySelector('.games-sites'), document.querySelector('#games .editor-top'), ...document.querySelectorAll('.games-sites .tab')].every((e) => e.scrollWidth <= e.clientWidth + 1))
    if (!fit) bad.push(lang)
    texts += await page.$eval('#tabLocal .lbl', (e) => (getComputedStyle(e).display !== 'none' ? 1 : 0))
    await page.evaluate(() => document.getElementById('gamesClose').click())
  }
  check(!bad.length && texts === (width >= 420 ? 7 : 0), `${width} px: everything fits in the 7 languages${bad.length ? ` except ${bad}` : ''}; ⭐ 📁 texts shown in ${texts}`)
}
await page.evaluate(() => { const s = document.getElementById('lang'); s.value = 'es'; s.dispatchEvent(new Event('change')) })

await cleanUp()
await restoreAuto()
await ctx.close()
process.exit(failed ? 1 : 0)
