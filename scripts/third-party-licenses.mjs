// Writes public/licenses.txt: the third-party components the app ships or
// downloads, with their licences and the full licence texts (each text once).
// Linked from ⚙ → "Créditos y licencias". The MIT and BSD licences ask for
// their copyright notice and text to go with every copy, and the bundler
// drops most licence comments from the minified code, hence this file.
//
// Run automatically by `npm run dev` and `npm run build` (after copy-vendor).
// See the task note, Investigation 9 (licence review, 2026-10-25).
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (path) => readFileSync(join(root, path), 'utf8').trim()

// Full licence texts, keyed by SPDX id. Sources are files already in the repo
// or in node_modules (onnxruntime-web's npm package has no LICENSE file, so
// a copy from github.com/microsoft/onnxruntime lives in licenses/).
const TEXTS = {
  'AGPL-3.0': read('LICENSE'),
  'GPL-3.0': read('node_modules/chessground/LICENSE'),
  'MIT (onnxruntime)': read('licenses/onnxruntime-LICENSE.txt'),
  'BSD-2-Clause (chess.js)': read('node_modules/chess.js/LICENSE'),
}

// [component, author, licence, URL, how it is used]
const COMPONENTS = [
  ['This app (jquads)', 'José Luis Cuadros', 'AGPL-3.0-or-later', 'https://github.com/jlcuadros/maia-stockfish-analysis', 'source code'],
  ['Maia-3 model (maia3_simplified.onnx)', 'CSSLab, University of Toronto', 'AGPL-3.0', 'https://github.com/CSSLab/maia3', 'downloaded at run time from maia-platform-frontend'],
  ['maia-platform-frontend (maiachess.com)', 'CSSLab, University of Toronto', 'GPL-3.0', 'https://github.com/CSSLab/maia-platform-frontend', 'move encoding and move list ported; design and colour code adapted'],
  ['Stockfish 17', 'The Stockfish developers', 'GPL-3.0', 'https://github.com/official-stockfish/Stockfish', 'chess engine (WebAssembly build)'],
  ['lila-stockfish-web', 'Lichess (lichess-org)', 'GPL-3.0 (LICENSE file; package.json says AGPL-3.0-or-later)', 'https://github.com/lichess-org/lila-stockfish-web', 'Stockfish compiled for the web, shipped in vendor/stockfish/'],
  ['Stockfish NNUE networks', 'The Stockfish developers', 'CC0-1.0', 'https://github.com/official-stockfish/networks', 'downloaded at run time'],
  ['chessground', 'Thibault Duplessis and contributors (Lichess)', 'GPL-3.0', 'https://github.com/lichess-org/chessground', 'board (bundled)'],
  ['cburnett piece set (in chessground)', 'Colin M.L. Burnett', 'GPL-2.0-or-later (used under GPL-3.0)', 'https://en.wikipedia.org/wiki/User:Cburnett', 'piece images'],
  ['chess.js', 'Jeff Hlywa', 'BSD-2-Clause', 'https://github.com/jhlywa/chess.js', 'chess rules (bundled)'],
  ['onnxruntime-web', 'Microsoft Corporation', 'MIT', 'https://github.com/microsoft/onnxruntime', 'runs Maia (bundled + vendor/ort/)'],
  ['Opening book (book/lichess-2300-slow-v1.bin)', 'built for jquads (scripts/book/build_book.py) from Lichess games', 'CC0-1.0 (as its source, the Lichess game database)', 'https://database.lichess.org/', 'Polyglot book: rated games, both players 2300+, rapid and classical'],
  ['Polyglot Random64 numbers (src/book/polyglotRandom.ts)', 'Polyglot book format; copied from python-chess', 'GPL-3.0 (python-chess)', 'https://github.com/niklasf/python-chess', 'position keys to look positions up in the book'],
]

const SERVICES = [
  'Lichess (https://lichess.org): public API for a user\'s games and the Syzygy endgame tablebase (tablebase.lichess.org). Used without login, one request at a time, as Lichess asks. Not affiliated with Lichess.',
  'Chess.com (https://www.chess.com/news/view/published-data-api): published-data API (PubAPI) for a user\'s monthly game archives. Read-only, without login, one request at a time. Not affiliated with Chess.com.',
  'Cloudflare Web Analytics (https://www.cloudflare.com/web-analytics/): anonymous visit statistics (pages, countries, devices, load speed), without cookies, without storing IP addresses or other personal data. Enabled 2026-10-28.',
]

const rule = '='.repeat(78)
const out = [
  'jquads — third-party components and licences',
  '',
  'Unofficial personal project. Not affiliated with or endorsed by Maia Chess / the',
  'CSSLab (University of Toronto), the Stockfish project, Lichess or Chess.com. Their names',
  'belong to their owners. Provided WITHOUT ANY WARRANTY (see the AGPL-3.0 below).',
  '',
  ...COMPONENTS.flatMap(([name, author, licence, url, use]) => [`- ${name}`, `    ${author} · ${licence}`, `    ${url}`, `    ${use}`]),
  '',
  'Online services:',
  ...SERVICES.map((s) => `- ${s}`),
  '',
  ...Object.entries(TEXTS).flatMap(([id, text]) => [rule, id, rule, '', text, '']),
].join('\n')

writeFileSync(join(root, 'public/licenses.txt'), out + '\n')
console.log(`third-party-licenses: public/licenses.txt (${COMPONENTS.length} components, ${Object.keys(TEXTS).length} licence texts)`)
