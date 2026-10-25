/**
 * PGN ⇄ GameTree, with all the variations (pure functions).
 *
 * Export (⚙ → "Exportar PGN", 📂 → "Guardar"):
 * - Headers: the Seven Tag Roster (Event, Site, Date, Round, White, Black,
 *   Result) with defaults, overridable by the caller (José edits them before
 *   saving a game, 2026-10-25), plus any extra tags (Elo…), and SetUp + FEN
 *   when the game does not start from the initial position.
 * - Movetext: main line = first child at each node; other children are
 *   variations in parentheses, as in any chess program.
 *
 * Import (`treeFromPgn`): our own movetext reader, because chess.js's
 * loadPgn drops the variations (checked 2026-10-25) and a saved game must
 * come back with them. Comments, NAGs and clock data are skipped.
 */
import { Chess } from 'chess.js'
import { GameTree, START_FEN, type MoveNode } from './tree'
import { t } from '../i18n/i18n'

/** "1. e4", "1... e5" or just "e5", following PGN numbering rules. */
function moveText(tree: GameTree, node: MoveNode, forceNumber: boolean): string {
  const { number, whiteMove } = tree.moveNumber(node)
  if (whiteMove) return `${number}. ${node.san}`
  return forceNumber ? `${number}... ${node.san}` : node.san
}

/**
 * Movetext from `parent` onwards: its main continuation, with the
 * alternatives (other children) as parenthesised variations after the main move.
 */
function lineFrom(tree: GameTree, parent: MoveNode, forceNumber: boolean): string[] {
  const out: string[] = []
  let node = parent
  let needNumber = forceNumber
  while (node.children.length) {
    const [main, ...alternatives] = node.children
    out.push(moveText(tree, main, needNumber))
    needNumber = false
    for (const alt of alternatives) {
      out.push(`(${[moveText(tree, alt, true), ...lineFrom(tree, alt, false)].join(' ')})`)
      needNumber = true // after a variation, the next black move needs "N..."
    }
    node = main
  }
  return out
}

export type PgnHeaders = Record<string, string>

/** The Seven Tag Roster, in its standard order (always written). */
export const ROSTER = ['Event', 'Site', 'Date', 'Round', 'White', 'Black', 'Result'] as const
export const RESULTS = ['*', '1-0', '0-1', '1/2-1/2']
/** Tags computed from the tree: never taken from the caller. */
const COMPUTED = ['SetUp', 'FEN']

/** "2026.10.25" (PGN date format). */
export const pgnDate = (d: Date) => `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`

/** Default headers of a game analysed here. */
export function defaultHeaders(date = new Date()): PgnHeaders {
  return { Event: t('pgn.event'), Site: 'https://jquads.pages.dev', Date: pgnDate(date), Round: '-', White: '?', Black: '?', Result: '*' }
}

/** Tag pairs `[Key "Value"]` of a PGN (first game only; escaped quotes handled). */
export function parsePgnHeaders(pgn: string): PgnHeaders {
  const headers: PgnHeaders = {}
  for (const m of pgn.matchAll(/^\s*\[(\w+)\s+"((?:[^"\\]|\\.)*)"\s*\]\s*$/gm)) headers[m[1]] = m[2].replace(/\\(.)/g, '$1')
  return headers
}

const escapeTag = (v: string) => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')

/**
 * The whole game as PGN. `headers` override the defaults (empty values are
 * left out, except the roster, which gets "?"). The movetext ends with the
 * Result tag, as PGN requires.
 */
export function gamePgn(tree: GameTree, date = new Date(), headers: PgnHeaders = {}): string {
  const all: PgnHeaders = { ...defaultHeaders(date) }
  for (const [k, v] of Object.entries(headers)) if (!COMPUTED.includes(k)) all[k] = v.trim()
  if (!RESULTS.includes(all.Result)) all.Result = '*'
  const pairs: [string, string][] = [
    ...ROSTER.map((k): [string, string] => [k, all[k] || '?']),
    ...Object.entries(all).filter(([k, v]) => !(ROSTER as readonly string[]).includes(k) && v),
  ]
  if (tree.root.fen !== START_FEN) pairs.push(['SetUp', '1'], ['FEN', tree.root.fen])
  const moves = lineFrom(tree, tree.root, true)
  return `${pairs.map(([k, v]) => `[${k} "${escapeTag(v)}"]`).join('\n')}\n\n${[...moves, all.Result].join(' ')}\n`
}

/**
 * PGN → GameTree, with the variations, positioned at the start (José: games
 * open at the initial position). Uses the [FEN] header when the game did not
 * start from the initial position. Throws on an illegal or unreadable move.
 */
export function treeFromPgn(pgn: string): GameTree {
  const tree = new GameTree(parsePgnHeaders(pgn).FEN || START_FEN)
  const movetext = pgn
    .replace(/^\s*\[.*\]\s*$/gm, '') // headers
    .replace(/\{[^}]*\}/g, ' ') // {comments}, including [%clk …]
    .replace(/;[^\n]*/g, ' ') // ; comments to end of line
    .replace(/\$\d+/g, ' ') // NAGs ($1…)
  // Where the next move is played from, and the last move played (a variation
  // replaces that last move, so it starts from its parent).
  let from = tree.root
  let last = tree.root
  const stack: { from: typeof from; last: typeof last }[] = []
  for (const token of movetext.match(/\(|\)|[^\s()]+/g) ?? []) {
    if (token === '(') {
      stack.push({ from, last })
      from = last.parent ?? tree.root
      continue
    }
    if (token === ')') {
      ;({ from, last } = stack.pop() ?? { from, last })
      continue
    }
    const san = token.replace(/^\d+\.+/, '').replace(/[!?]+$/, '') // "12.e4", "e4!?" → "e4"
    if (!san || RESULTS.includes(san)) continue // move number alone, or the result
    let uci: string
    try {
      const m = new Chess(from.fen).move(san)
      uci = m.from + m.to + (m.promotion ?? '')
    } catch {
      throw new Error(`Illegal move in PGN: ${san}`)
    }
    tree.goTo(from)
    last = from = tree.play(uci)!
  }
  tree.toStart()
  return tree
}
