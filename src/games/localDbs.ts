/**
 * 📁 Local databases (José, iteration 10, 2026-10-30): PGN files from the
 * device and databases made in the app.
 *   - "file": a .pgn opened with the file picker. The app keeps a copy (the
 *     web can't read the file again, nor write to it, nor know its path:
 *     only its name). **Read-only** (José's choice). Only the RECENT_FILES
 *     last opened ones are kept; opening a file with the same name again
 *     replaces its copy.
 *   - "app": made here with "＋ Nueva"; games are saved into it from
 *     📂 → 💾 Guardar. Never dropped automatically; "⬇ Descargar PGN" gives
 *     it as a file.
 * The list (names, kind, order) is in localStorage; each database's games, as
 * an array of single-game PGNs, in IndexedDB (a file can be several MB).
 * Game ids are `${db.id}#${index}`, so a game knows its database and place.
 */
import { kvStore } from '../lib/idb'
import { summaryFromPgn, type GameSummary } from './common'
import { parsePgnHeaders } from '../game/pgn'
import { toPgnFile } from './favorites'

export interface LocalDb {
  id: string
  name: string // the file name without extension, or the name given with "＋ Nueva"
  kind: 'file' | 'app'
  usedAt: number // ms: last opened or saved into (order of the buttons)
  count: number // games
}

/** Opened files remembered (José: "the last 4"). */
export const RECENT_FILES = 4
/** Longest name on a button; longer ones lose characters in the middle. */
export const NAME_MAX = 18

const META_KEY = 'localDbs'
const games = kvStore<string[]>('jquads-local-dbs', 'games')

// ---------------------------------------------------------------------------
// Pure helpers (unit tested in localDbs.test.ts)
// ---------------------------------------------------------------------------

/**
 * A PGN file → one PGN per game. A game starts at a tag line ("[Event …]")
 * that comes after some movetext; text before the first tag (a byte-order
 * mark, blank lines) is dropped, and so are pieces with no moves and no tags.
 */
export function splitPgnGames(text: string): string[] {
  const out: string[] = []
  let current: string[] = []
  let inMoves = false
  const flush = () => {
    const pgn = current.join('\n').trim()
    if (pgn) out.push(pgn + '\n')
    current = []
    inMoves = false
  }
  for (const line of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const isTag = /^\s*\[\w+\s+".*"\s*\]\s*$/.test(line)
    if (isTag && inMoves) flush()
    if (!isTag && line.trim() && !line.trim().startsWith('%')) inMoves = true // "%" = escape line (PGN spec 6)
    current.push(line)
  }
  flush()
  return out
}

/** File name → button name: no extension, never the path; middle characters cut if too long. */
export function shortName(fileName: string, max = NAME_MAX): string {
  const base = fileName.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, '') || fileName
  if (base.length <= max) return base
  const tail = Math.floor((max - 1) / 2)
  return `${base.slice(0, max - 1 - tail)}…${base.slice(base.length - tail)}`
}

/** "2026.10.25" → that day at noon UTC (ms); 0 when the date or part of it is unknown ("2026.??.??"). */
export function pgnDateMs(date?: string): number {
  const m = date?.match(/^(\d{4})\.(\d{2})\.(\d{2})$/)
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12) : 0
}

/** The games of a database as list rows (file order), labelled with the database name. */
export function dbSummaries(db: Pick<LocalDb, 'id' | 'name'>, pgns: string[]): GameSummary[] {
  return pgns.map((pgn, i) => ({ ...summaryFromPgn(pgn, `${db.id}#${i}`, pgnDateMs(parsePgnHeaders(pgn).Date)), source: db.name }))
}

/** `${dbId}#${index}` → its parts, or undefined for any other id (favourites, Lichess…). */
export function gameRef(id?: string): { dbId: string; index: number } | undefined {
  const m = id?.match(/^(ldb-[\w-]+)#(\d+)$/)
  return m ? { dbId: m[1], index: Number(m[2]) } : undefined
}

// ---------------------------------------------------------------------------
// The list (localStorage)
// ---------------------------------------------------------------------------

function readMeta(): LocalDb[] {
  try {
    return JSON.parse(localStorage.getItem(META_KEY) ?? '[]')
  } catch {
    return []
  }
}

function writeMeta(dbs: LocalDb[]) {
  try {
    localStorage.setItem(META_KEY, JSON.stringify(dbs))
  } catch {
    /* not persisted */
  }
}

/** The databases for the buttons: the ones made here (by name), then the opened files, most recent first. */
export function listDbs(): LocalDb[] {
  const dbs = readMeta()
  const app = dbs.filter((d) => d.kind === 'app').sort((a, b) => a.name.localeCompare(b.name))
  const files = dbs.filter((d) => d.kind === 'file').sort((a, b) => b.usedAt - a.usedAt)
  return [...app, ...files]
}

export const findDb = (id: string) => readMeta().find((d) => d.id === id)

/** Databases games can be saved into (📂 → 💾 Guardar). */
export const writableDbs = () => listDbs().filter((d) => d.kind === 'app')

const newId = () => `ldb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`

// ---------------------------------------------------------------------------
// Opening, creating, saving, removing
// ---------------------------------------------------------------------------

/**
 * A file from the picker becomes a "file" database (a new one, or the one with
 * the same name, refreshed). Only the RECENT_FILES most recent files stay.
 * Throws if the file has no games.
 */
export async function openFile(file: File): Promise<LocalDb> {
  const pgns = splitPgnGames(await file.text())
  if (!pgns.length) throw new Error('no games')
  const name = file.name.replace(/\.[^.]+$/, '') || file.name
  let dbs = readMeta()
  const db: LocalDb = { ...(dbs.find((d) => d.kind === 'file' && d.name === name) ?? { id: newId(), name, kind: 'file' }), usedAt: Date.now(), count: pgns.length }
  await games.put(db.id, pgns)
  dbs = [db, ...dbs.filter((d) => d.id !== db.id)]
  // Forget the oldest files beyond the limit (the made-here ones always stay).
  const files = dbs.filter((d) => d.kind === 'file').sort((a, b) => b.usedAt - a.usedAt)
  for (const old of files.slice(RECENT_FILES)) {
    dbs = dbs.filter((d) => d.id !== old.id)
    await games.delete(old.id).catch(() => undefined)
  }
  writeMeta(dbs)
  return db
}

/** "＋ Nueva": an empty database made here. */
export async function createDb(name: string): Promise<LocalDb> {
  const db: LocalDb = { id: newId(), name: name.trim(), kind: 'app', usedAt: Date.now(), count: 0 }
  await games.put(db.id, [])
  writeMeta([db, ...readMeta()])
  return db
}

/** The games of a database (single-game PGNs, file order). */
export async function loadDb(id: string): Promise<string[]> {
  return (await games.get(id)) ?? []
}

/** Marks a database as just used (it moves first among the files). */
export function touchDb(id: string) {
  writeMeta(readMeta().map((d) => (d.id === id ? { ...d, usedAt: Date.now() } : d)))
}

/**
 * Saves a game into a database made here: replaces game `index` if given and
 * present, otherwise adds it at the end. Returns the game's id.
 */
export async function saveToDb(id: string, pgn: string, index?: number): Promise<string> {
  const db = findDb(id)
  if (db?.kind !== 'app') throw new Error('read-only database')
  const pgns = await loadDb(id)
  const at = index !== undefined && index < pgns.length ? index : pgns.length
  pgns[at] = pgn.trim() + '\n'
  await games.put(id, pgns)
  writeMeta(readMeta().map((d) => (d.id === id ? { ...d, usedAt: Date.now(), count: pgns.length } : d)))
  return `${id}#${at}`
}

/** Removes a database from the list (a file: only the app's copy; one made here: with its games). */
export async function removeDb(id: string) {
  writeMeta(readMeta().filter((d) => d.id !== id))
  await games.delete(id).catch(() => undefined)
}

/** A database as one PGN file (⬇ Descargar PGN). */
export async function dbPgnFile(id: string): Promise<string> {
  return toPgnFile((await loadDb(id)).map((pgn) => ({ pgn }) as GameSummary))
}
