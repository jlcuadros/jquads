// Builds the opening names file of the app (iteration 11, 2026-10-30) from the
// Lichess opening list, github.com/lichess-org/chess-openings (CC0): five TSV
// files a…e (ECO volumes) with the columns eco, name, pgn.
//
// Each line is played with chess.js; the final position's key
// (src/book/positionKey.ts, the same function the app uses) → [eco, name].
// A position named more than once (transpositions) keeps the entry with the
// fewest moves, and among equals the first one (file order) — the list itself
// says it may have several entries for transpositions.
//
// The commit is pinned and goes into the output file name, so a new list gets a
// new name and the app's cache never serves an old one.
//
// Usage (from app/): node scripts/openings/build-openings.mjs [commit]
//   → public/openings/lichess-openings-<commit7>.json
import { Chess } from 'chess.js'
import { mkdirSync, writeFileSync } from 'node:fs'
import { positionKey } from '../../src/book/positionKey.ts'

const REPO = 'lichess-org/chess-openings'
const COMMIT = process.argv[2] ?? '712a58be746c143f4ab935b68acc50f4bac813eb' // master on 2026-10-29
const FILES = ['a', 'b', 'c', 'd', 'e']

const byKey = new Map() // key → { eco, name, plies }
let lines = 0
let duplicates = 0
for (const f of FILES) {
  const url = `https://raw.githubusercontent.com/${REPO}/${COMMIT}/${f}.tsv`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`)
  const [header, ...rows] = (await res.text()).trim().split('\n')
  if (header !== 'eco\tname\tpgn') throw new Error(`unexpected columns in ${f}.tsv: ${header}`)
  for (const row of rows) {
    const [eco, name, pgn] = row.split('\t')
    const chess = new Chess()
    chess.loadPgn(pgn)
    const key = positionKey(chess.fen())
    const plies = chess.history().length
    lines++
    const old = byKey.get(key)
    if (old) duplicates++
    if (!old || plies < old.plies) byKey.set(key, { eco, name, plies })
  }
}

const short = COMMIT.slice(0, 7)
const out = {
  source: `https://github.com/${REPO}/tree/${COMMIT}`,
  license: 'CC0-1.0',
  built: new Date().toISOString().slice(0, 10),
  // key (positionKey) → [ECO, name]
  openings: Object.fromEntries([...byKey].map(([k, v]) => [k, [v.eco, v.name]])),
}
mkdirSync('public/openings', { recursive: true })
const file = `public/openings/lichess-openings-${short}.json`
writeFileSync(file, JSON.stringify(out))
console.log(`${lines} lines → ${byKey.size} positions (${duplicates} repeated) → ${file}`)
