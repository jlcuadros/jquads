// Images for the App Store and Google Play listings (store release, 2026-10-30;
// task_03.1 → store). Everything is generated, so it can be redone whenever the
// app changes:
//   - icons: App Store 1024 × 1024 (no transparency) and Google Play 512 × 512,
//     from José's original picture (cropped to a square and resized with `sips`,
//     macOS);
//   - Google Play feature graphic 1024 × 500, Spanish and English;
//   - screenshots in Spanish and English: iPhone 6.9" (1320 × 2868, the size App
//     Store Connect asks for) and Android phone (1080 × 2160, 2:1, within Google's
//     limits), of: analysis, games list, whole game (📜), annotations, endgame table.
// Store rules for the listing (screenshots are part of it):
//   - taken as the store app (`?app=android` → storeApp()): no Ko-fi link visible;
//   - the games list uses DEMO games with invented opponents (the Lichess API answer
//     is replaced only inside this script), so no real third-party usernames appear;
//   - JPEG: App Store and Google Play refuse images with an alpha channel.
//
// Usage (server running with the current build, engines cached in the profile):
//   UI_TEST_PROFILE=<profile> node scripts/store-images.mjs http://localhost:4173 <out-dir> <original-icon.png>
// Needs network (Lichess for the games list, the endgame tablebase).
import { webkit } from 'playwright'
import { squareIcon } from './lib/icon.mjs'
import { mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const [base = 'http://localhost:4173', outDir = '.', originalIcon] = process.argv.slice(2)
mkdirSync(outDir, { recursive: true })
const out = (name) => join(outDir, name)

// ---------------------------------------------------------------------------
// Icons (sips: crop the 1168 × 1166 original to its centred square, then resize)
// ---------------------------------------------------------------------------
if (originalIcon) {
  squareIcon(originalIcon, 1024, out('appstore-icon-1024.png'))
  squareIcon(originalIcon, 512, out('play-icon-512.png'))
  console.log('icons: appstore-icon-1024.png, play-icon-512.png')
}

// ---------------------------------------------------------------------------
// Texts per language (screenshot captions and feature graphic)
// ---------------------------------------------------------------------------
// Feature graphic texts per language (the store listing's subtitle and a short claim).
const LANGS = {
  es: { tagline: 'Analiza ajedrez como un humano', sub: 'Maia + Stockfish · gratis · sin anuncios' },
  en: { tagline: 'Analyse chess like a human', sub: 'Maia + Stockfish · free · no ads' },
}
const JPEG = { type: 'jpeg', quality: 92 } // no alpha channel (store requirement)
const BLUE = '#1e3fc4'
const iconData = `data:image/png;base64,${readFileSync('public/icons/icon-512.png').toString('base64')}`

// ---------------------------------------------------------------------------
// Feature graphic (Google Play, 1024 × 500): icon + name + tagline on the app's blue
// ---------------------------------------------------------------------------
{
  const browser = await webkit.launch()
  const page = await browser.newPage({ viewport: { width: 1024, height: 500 } })
  for (const [lang, t] of Object.entries(LANGS)) {
    await page.setContent(`<html><body style="margin:0;width:1024px;height:500px;display:flex;align-items:center;gap:56px;padding:0 72px;box-sizing:border-box;
      background:linear-gradient(135deg, ${BLUE}, #0d1f6e);font-family:-apple-system,'Helvetica Neue',sans-serif;color:#fff">
      <img src="${iconData}" style="width:260px;height:260px;border-radius:58px;box-shadow:0 12px 40px #0006">
      <div><div style="font-size:96px;font-weight:800;letter-spacing:-2px">jquads</div>
      <div style="font-size:40px;font-weight:600;margin-top:8px">${t.tagline}</div>
      <div style="font-size:28px;opacity:.8;margin-top:18px">${t.sub}</div></div></body></html>`)
    await page.screenshot({ path: out(`play-feature-${lang}.jpg`), ...JPEG })
  }
  await browser.close()
  console.log('feature graphics: play-feature-es.jpg, play-feature-en.jpg')
}

// ---------------------------------------------------------------------------
// Screenshots
// ---------------------------------------------------------------------------
const DEVICES = {
  ios: { viewport: { width: 440, height: 956 }, deviceScaleFactor: 3 }, // → 1320 × 2868 (iPhone 6.9")
  android: { viewport: { width: 360, height: 720 }, deviceScaleFactor: 3 }, // → 1080 × 2160 (2:1)
}
// A Dragon game (in the book, named opening) and a rook endgame (tablebase), opened as a 📁 Local file.
const DRAGON = '[Event "Club championship"]\n[Site "jquads"]\n[Date "2026.10.30"]\n[White "Alice"]\n[Black "Bob"]\n[Result "*"]\n\n1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 g6 6. Be3 Bg7 7. f3 O-O 8. Qd2 Nc6 9. Bc4 *\n'
const ENDGAME = '[Event "Endgame study"]\n[White "Alice"]\n[Black "Bob"]\n[Result "*"]\n[SetUp "1"]\n[FEN "8/8/8/4k3/8/8/2K5/R7 w - - 0 1"]\n\n*\n'

/** Demo Lichess games (NDJSON lines as the API gives them) for `me`, with invented opponents. */
function demoLichessGames(me) {
  // Every rating random between 2010 and 2100 (José: "me niego a que salgan capturas de mi usuario como si
  // tuviera menos de 2000 de elo" … "pon números aleatorios entre 2010 y 2100"), with a fixed seed so that
  // regenerating gives the same pictures.
  let seed = 20261030
  const rating = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648 // small LCG: reproducible "random"
    return 2010 + (seed % 91)
  }
  const rivals = ['knight_rider', 'elena_k', 'pawnstorm77', 'tactico88', 'quietmove', 'rookie_lift',
    'bishop_pair', 'zugzwang_z', 'caissa_fan', 'endgame_eli', 'gambit_gus', 'fianchetto'].map((name) => [name, rating()])
  const openings = ['Sicilian Defense: Dragon Variation', 'Italian Game', 'Queen\'s Gambit Declined', 'French Defense: Advance Variation', 'Caro-Kann Defense',
    'Ruy Lopez: Berlin Defense', 'King\'s Indian Defense', 'English Opening', 'Scandinavian Defense', 'London System', 'Pirc Defense', 'Slav Defense']
  const results = ['white', 'black', undefined, 'white', 'white', 'black', 'black', 'white', undefined, 'white', 'black', 'white']
  return rivals.map(([name, r], i) => {
    const meWhite = i % 2 === 0
    const mine = rating()
    const players = { white: { user: { name: meWhite ? me : name }, rating: meWhite ? mine : r }, black: { user: { name: meWhite ? name : me }, rating: meWhite ? r : mine } }
    return JSON.stringify({ id: `demo${i}`, rated: true, variant: 'standard', speed: i % 3 ? 'blitz' : 'rapid', status: results[i] ? 'resign' : 'draw',
      winner: results[i], createdAt: Date.now() - i * 26 * 3600e3, clock: i % 3 ? { initial: 180, increment: 2 } : { initial: 600, increment: 5 },
      opening: { name: openings[i] }, players, pgn: '[Event "Demo"]\n\n1. e4 e5 *' })
  }).join('\n')
}

const ctx = await webkit.launchPersistentContext(process.env.UI_TEST_PROFILE ?? join(tmpdir(), 'maia-ui-test-webkit-profile'), { ...DEVICES.ios, isMobile: true, hasTouch: true, locale: 'es-ES' })
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('pageerror:', e.message))
// As the store app: storeApp() hides the donation links (kept for the session).
await page.goto(`${base}/?app=android`)
await page.waitForSelector('#board .cg-wrap, #board.cg-wrap')
const me = (await page.$eval('#lichessUserSetting', (i) => i.value)) || 'Ousland'
await page.route('https://lichess.org/api/games/user/**', (route) => route.fulfill({ status: 200, contentType: 'application/x-ndjson', body: demoLichessGames(me) }))
const prevLang = await page.$eval('#lang', (s) => s.value)
// Maia at 2000 for the pictures ("Maia 2000", "a 2000 player would find…"); the profile's own value comes back at the end.
const prevElo = await page.$eval('#elo', (s) => s.value)
const setElo = (v) => page.evaluate((x) => { const s = document.getElementById('elo'); s.value = x; s.dispatchEvent(new Event('change')) }, v)
await setElo('2000')

// Analysis finished: the engines' paragraph, Maia's rows and the threats bar.
const analysed = () => page.waitForFunction(() => document.querySelector('#text .side-text') && document.querySelectorAll('#maiaCol tr').length > 2 && document.getElementById('meterThreats').dataset.done === 'true', null, { timeout: 180_000 })
const setLang = (lang) => page.evaluate((l) => { const s = document.getElementById('lang'); s.value = l; s.dispatchEvent(new Event('change')) }, lang)
const click = (sel) => page.evaluate((s) => document.querySelector(s).click(), sel)
/** Opens a PGN as a 📁 Local database and its first game. */
async function openGame(name, pgn) {
  await click('#gamesBtn'); await click('#tabLocal')
  await page.setInputFiles('#localFile', { name, mimeType: 'application/octet-stream', buffer: Buffer.from(pgn) })
  // Wait until this file is the selected database (the previous one's games may still be listed).
  await page.waitForFunction((n) => document.querySelector('#localDbs .chip.on')?.title === n && document.querySelector('#gamesList li'), name.replace(/\.pgn$/, ''))
  await click('#gamesList li .info')
  await page.waitForFunction(() => document.getElementById('games').hidden)
}
/** Goes to half-move `ply` of the main line. */
async function goToPly(ply) {
  await click('#first')
  for (let i = 0; i < ply; i++) await click('#next')
}

for (const [device, size] of Object.entries(DEVICES)) {
  await page.setViewportSize(size.viewport)
  for (const [lang] of Object.entries(LANGS)) {
    await setLang(lang)
    const shot = (n) => page.screenshot({ path: out(`${device}-${lang}-${n}.jpg`), ...JPEG })

    // 1. Analysis: the Dragon after 8... Nc6 (book, arrows, columns, opening name).
    await openGame('dragon.pgn', DRAGON)
    await goToPly(16)
    await analysed()
    await page.waitForTimeout(500)
    await shot(1)

    // 2. Games list: Lichess, the username saved in this profile, demo games (route above).
    await click('#gamesBtn'); await click('#site-lichess'); await click('#gamesLoad')
    await page.waitForSelector('#gamesList li', { timeout: 60_000 }).catch(() => console.log(`${device}-${lang}-2: no Lichess games (network?)`))
    await shot(2)
    await click('#gamesClose')

    // 3. The whole game (📜) with the opening names on the moves.
    await click('#gameViewBtn')
    await page.waitForTimeout(400)
    await shot(3)
    await click('#gameViewClose')

    // 4. Annotations: ✏️ open on the current move.
    await click('#annotateBtn')
    await page.waitForTimeout(400)
    await shot(4)
    await click('#annotateBtn')

    // 5. Endgame with the online tablebase.
    await openGame('endgame.pgn', ENDGAME)
    await page.waitForFunction(() => /TB|DTZ|DTM|#/.test(document.getElementById('sfCol')?.textContent ?? ''), null, { timeout: 60_000 }).catch(() => console.log(`${device}-${lang}-5: tablebase not shown`))
    await page.waitForTimeout(500)
    await shot(5)
    console.log(`${device}-${lang}: 5 screenshots`)
  }
}

// Leave the profile as it was: language, no test databases.
await setLang(prevLang)
await setElo(prevElo)
await page.evaluate(() => { localStorage.removeItem('localDbs'); localStorage.removeItem('gamesLocalDb'); indexedDB.deleteDatabase('jquads-local-dbs') })
await ctx.close()
