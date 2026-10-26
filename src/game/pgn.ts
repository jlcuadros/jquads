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
 * come back with them. Comments are kept (shown with ✏️, exported again),
 * without the engine/clock commands inside them ([%clk …], [%eval …]); NAGs
 * are skipped.
 */
import { Chess } from 'chess.js'
import { GameTree, START_FEN, type MoveNode } from './tree'
import { t } from '../i18n/i18n'

/**
 * The movetext as tokens (DRY: the PGN export writes them as text, the full
 * game view shows them as tappable moves — 2026-10-26):
 *  - a move, with its PGN numbering ("1. e4", "1... e5" or just "e5");
 *  - a comment;
 *  - the start / end of a variation.
 * Main line = first child at each node; the other children follow the main
 * move as parenthesised variations, as in any chess program.
 */
export type MovetextToken =
  | { kind: 'move'; node: MoveNode; text: string }
  | { kind: 'comment'; text: string }
  | { kind: 'open' }
  | { kind: 'close' }

/** "1. e4", "1... e5" or just "e5", following PGN numbering rules. */
function moveText(tree: GameTree, node: MoveNode, forceNumber: boolean): string {
  const { number, whiteMove } = tree.moveNumber(node)
  if (whiteMove) return `${number}. ${node.san}`
  return forceNumber ? `${number}... ${node.san}` : node.san
}

/** A move and, if it has one, its comment. After a comment a black move needs "N...". */
function moveTokens(tree: GameTree, node: MoveNode, forceNumber: boolean): { tokens: MovetextToken[]; commented: boolean } {
  const tokens: MovetextToken[] = [{ kind: 'move', node, text: moveText(tree, node, forceNumber) }]
  if (node.comment) tokens.push({ kind: 'comment', text: node.comment })
  return { tokens, commented: !!node.comment }
}

/** Movetext from `parent` onwards (its main continuation and the variations). */
function lineFrom(tree: GameTree, parent: MoveNode, forceNumber: boolean): MovetextToken[] {
  const out: MovetextToken[] = []
  let node = parent
  let needNumber = forceNumber
  while (node.children.length) {
    const [main, ...alternatives] = node.children
    const m = moveTokens(tree, main, needNumber)
    out.push(...m.tokens)
    needNumber = m.commented
    for (const alt of alternatives) {
      const a = moveTokens(tree, alt, true)
      out.push({ kind: 'open' }, ...a.tokens, ...lineFrom(tree, alt, a.commented), { kind: 'close' })
      needNumber = true // after a variation, the next black move needs "N..."
    }
    node = main
  }
  return out
}

/** The whole game's movetext as tokens: the root comment (before the first move), then the moves. */
export function movetextTokens(tree: GameTree): MovetextToken[] {
  const intro: MovetextToken[] = tree.root.comment ? [{ kind: 'comment', text: tree.root.comment }] : []
  return [...intro, ...lineFrom(tree, tree.root, true)]
}

/** Tokens → PGN movetext: "1. e4 {comment} e5 (1... c5) 2. Nf3". "}" can't appear inside a comment. */
function movetextString(tokens: MovetextToken[]): string {
  return tokens
    .map((tk) => (tk.kind === 'move' ? tk.text : tk.kind === 'comment' ? `{${tk.text.replace(/}/g, ')')}}` : tk.kind === 'open' ? '(' : ')'))
    .join(' ')
    .replace(/\( /g, '(')
    .replace(/ \)/g, ')')
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
  const moves = movetextString(movetextTokens(tree))
  return `${pairs.map(([k, v]) => `[${k} "${escapeTag(v)}"]`).join('\n')}\n\n${moves ? `${moves} ` : ''}${all.Result}\n`
}

/** A comment's text without engine/clock commands ([%clk 0:03:00], [%eval 0.3]…) and extra spaces. */
export function commentText(raw: string): string {
  return raw.replace(/\[%[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * PGN → GameTree, with the variations and comments, positioned at the start (José: games
 * open at the initial position). Uses the [FEN] header when the game did not
 * start from the initial position. Throws on an illegal or unreadable move.
 */
export function treeFromPgn(pgn: string): GameTree {
  const tree = new GameTree(parsePgnHeaders(pgn).FEN || START_FEN)
  const movetext = pgn
    .replace(/^\s*\[.*\]\s*$/gm, '') // headers
    .replace(/;([^\n]*)/g, (_, c: string) => `{${c.replace(/}/g, ')')}}`) // ; comments to end of line → {…}
    .replace(/\$\d+/g, ' ') // NAGs ($1…)
  // Where the next move is played from, and the last move played (a variation
  // replaces that last move, so it starts from its parent).
  let from = tree.root
  let last = tree.root
  const stack: { from: typeof from; last: typeof last }[] = []
  for (const token of movetext.match(/\{[^}]*\}|\(|\)|[^\s(){}]+/g) ?? []) {
    if (token.startsWith('{')) {
      // A comment belongs to the move before it (to the root before the first move).
      const text = commentText(token.slice(1, -1))
      if (text) last.comment = last.comment ? `${last.comment} ${text}` : text
      continue
    }
    if (token === '(') {
      stack.push({ from, last })
      from = last.parent ?? tree.root
      last = from // a comment right after "(" goes with the position the variation starts from
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
