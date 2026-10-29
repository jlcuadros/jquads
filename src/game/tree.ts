/**
 * Move tree: the game being analysed, with variations (pure logic, no UI).
 *
 * Every node is a position. The root is the starting position; each child is
 * reached by one move. `children[0]` is the main continuation, further
 * children are variations. Playing a move that already exists just moves to
 * that node (no duplicates).
 */
import { Chess } from 'chess.js'
import type { Drawing } from './drawing'

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

export interface MoveNode {
  id: number
  fen: string // position AFTER the move (root: initial position)
  uci: string // move that led here ('' for the root)
  san: string // same move in SAN ('' for the root)
  ply: number // half-moves from the root position (root = 0)
  parent: MoveNode | null
  children: MoveNode[]
  // Comment from the PGN after this move (on the root: before the first move).
  // Shown with ✏️ in the text and kept when exporting (2026-10-26).
  comment?: string
  // Chess symbols of this move ("!", "±", "N"…) as PGN NAG codes (game/annotations.ts),
  // set in the ✏️ panel or read from a PGN (2026-10-29).
  nags?: number[]
  // Arrows and coloured squares drawn on this position (game/drawing.ts), saved in the
  // PGN comment as [%cal …] / [%csl …] (✏️ phase 2, 2026-10-29).
  drawings?: Drawing[]
}

export class GameTree {
  readonly root: MoveNode
  current: MoveNode
  private nextId = 1
  /** Move number of the root position (from its FEN), to number the moves. */
  readonly rootFullmove: number
  readonly rootWhiteToMove: boolean

  constructor(fen: string = START_FEN) {
    const normalized = new Chess(fen).fen() // validates the FEN (throws if invalid)
    this.root = { id: 0, fen: normalized, uci: '', san: '', ply: 0, parent: null, children: [] }
    this.current = this.root
    this.rootFullmove = Number(normalized.split(' ')[5]) || 1
    this.rootWhiteToMove = normalized.split(' ')[1] === 'w'
  }

  /**
   * Plays `uci` from the current node. Returns the resulting node, or null if
   * the move is illegal. If that move was already in the tree, it is reused.
   */
  play(uci: string): MoveNode | null {
    const existing = this.current.children.find((c) => c.uci === uci)
    if (existing) return (this.current = existing)

    const board = new Chess(this.current.fen)
    let san: string
    try {
      san = board.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san
    } catch {
      return null // illegal move
    }
    const node: MoveNode = {
      id: this.nextId++,
      fen: board.fen(),
      uci,
      san,
      ply: this.current.ply + 1,
      parent: this.current,
      children: [],
    }
    this.current.children.push(node)
    return (this.current = node)
  }

  /**
   * "Sobrescribir" (José, 2026-10-26): forgets everything that followed the
   * current position (its continuation and all its variations), so the next
   * move played becomes the only continuation.
   */
  clearContinuation() {
    this.current.children = []
  }

  // --- Navigation -----------------------------------------------------------

  goTo(node: MoveNode) {
    this.current = node
  }
  back() {
    if (this.current.parent) this.current = this.current.parent
  }
  /** Forward along the main continuation of the current node. */
  forward() {
    if (this.current.children[0]) this.current = this.current.children[0]
  }
  toStart() {
    this.current = this.root
  }
  /** To the end of the main continuation from the current node. */
  toEnd() {
    while (this.current.children[0]) this.current = this.current.children[0]
  }

  /** Nodes from the root to `node` (excluding the root). */
  pathTo(node: MoveNode = this.current): MoveNode[] {
    const path: MoveNode[] = []
    for (let n: MoveNode | null = node; n && n.parent; n = n.parent) path.unshift(n)
    return path
  }

  /**
   * The line to show in the move list: from the root to the current node, then
   * onwards along the main continuation. Keeps the whole game visible when
   * stepping back, and switches to a variation when you enter one.
   */
  displayLine(): MoveNode[] {
    const line = this.pathTo()
    for (let n = this.current.children[0]; n; n = n.children[0]) line.push(n)
    return line
  }

  /** "1." / "1…" style numbering for a node in the move list. */
  moveNumber(node: MoveNode): { number: number; whiteMove: boolean } {
    // Absolute half-move index counting from White's first move of move 1.
    const half = (this.rootFullmove - 1) * 2 + (this.rootWhiteToMove ? 0 : 1) + node.ply - 1
    return { number: Math.floor(half / 2) + 1, whiteMove: half % 2 === 0 }
  }
}

/**
 * Position with the turn passed to the other side (a "null move"), used for
 * threats: "what would the opponent play if it were their turn?".
 * Returns null when the side to move is in check (passing would leave a king
 * capturable → illegal position).
 */
export function nullMoveFen(fen: string): string | null {
  if (new Chess(fen).inCheck()) return null
  const parts = fen.split(' ')
  parts[1] = parts[1] === 'w' ? 'b' : 'w'
  parts[3] = '-' // en passant is only possible immediately after the pawn move
  const result = parts.join(' ')
  try {
    new Chess(result) // chess.js validates the resulting FEN
  } catch {
    return null
  }
  return result
}
