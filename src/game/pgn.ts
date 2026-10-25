/**
 * PGN export of the game being analysed, with all its variations
 * (⚙ → "Exportar PGN"). Pure function over GameTree.
 *
 * - Headers: Event/Site/Date/Result, and SetUp + FEN when the game does not
 *   start from the initial position (e.g. made with the position editor).
 * - Movetext: main line = first child at each node; other children are
 *   variations in parentheses, as in any chess program.
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

export function gamePgn(tree: GameTree, date = new Date()): string {
  const d = `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`
  const headers = [
    ['Event', t('pgn.event')],
    ['Site', 'https://jquads.pages.dev'],
    ['Date', d],
    ['White', '?'],
    ['Black', '?'],
    ['Result', '*'],
  ]
  if (tree.root.fen !== START_FEN) headers.push(['SetUp', '1'], ['FEN', tree.root.fen])
  const moves = lineFrom(tree, tree.root, true)
  return `${headers.map(([k, v]) => `[${k} "${v}"]`).join('\n')}\n\n${[...moves, '*'].join(' ')}\n`
}

/**
 * PGN → GameTree with the game's moves as the main line, positioned at the
 * start (José: games open at the initial position). Uses the [FEN] header when
 * the game did not start from the initial position. Throws on invalid PGN.
 */
export function treeFromPgn(pgn: string): GameTree {
  const chess = new Chess()
  chess.loadPgn(pgn)
  const fen = chess.getHeaders().FEN
  const tree = new GameTree(fen || START_FEN)
  for (const m of chess.history({ verbose: true })) {
    if (!tree.play(m.from + m.to + (m.promotion ?? ''))) throw new Error(`Illegal move in PGN: ${m.san}`)
  }
  tree.toStart()
  return tree
}
