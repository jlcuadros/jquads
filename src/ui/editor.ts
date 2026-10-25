/**
 * Full-screen position editor (⚙ → "Introducir posición"), like Lichess' board
 * editor. Built on chessground, which already supports what an editor needs:
 *   - movable.free: pieces can be moved anywhere (no chess rules);
 *   - draggable.deleteOnDropOff: dragging a piece off the board removes it;
 *   - dragNewPiece(): dragging a piece from the palette onto the board.
 *
 * Tools (palettes above/below the board):
 *   ✋ move  — drag pieces around (default);
 *   a piece  — tap squares to place that piece (tap again to keep placing);
 *   🗑 erase — tap squares to remove pieces.
 * Options: side to move and castling rights (checkboxes enabled only when the
 * king and rook are on their original squares). "Analizar" validates the
 * position (game/position.ts) and hands the FEN to the app.
 */
import { Chessground } from 'chessground'
import type { Api } from 'chessground/api'
import { dragNewPiece } from 'chessground/drag'
import type { Color, Key, Piece, Role } from 'chessground/types'
import { buildFen, possibleCastling, validatePosition, EMPTY_BOARD, type CastlingRights, type Turn } from '../game/position'
import { START_FEN } from '../game/tree'
import { t, type MessageKey } from '../i18n/i18n'

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T

const ROLES: Role[] = ['king', 'queen', 'rook', 'bishop', 'knight', 'pawn']
const CASTLING_KEYS = ['K', 'Q', 'k', 'q'] as const

/** Current tool: move pieces, place a given piece, or erase. */
type Tool = { kind: 'move' } | { kind: 'erase' } | { kind: 'piece'; piece: Piece }

let board: Api | null = null // created on first open (chessground needs a visible element)
let tool: Tool = { kind: 'move' }
let onApply: (fen: string) => void = () => {}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Opens the editor starting from `fen` (usually the current position, so it
 * can be tweaked). `apply` receives the validated FEN when "Analizar" is tapped.
 */
export function openEditor(fen: string, orientation: Color, apply: (fen: string) => void) {
  onApply = apply
  $('editor').hidden = false
  $('editor').scrollTop = 0 // always start with the header (Cancelar / Analizar) visible
  document.body.style.overflow = 'hidden' // no page scroll behind the editor
  if (!board) setup()
  const [boardFen, turn, castling] = fen.split(' ')
  board!.set({ fen: boardFen, orientation })
  board!.redrawAll() // the element was hidden until now: recompute sizes
  $<HTMLSelectElement>('edTurn').value = turn
  for (const c of CASTLING_KEYS) $<HTMLInputElement>(`ed${c}`).checked = castling.includes(c)
  setTool({ kind: 'move' })
  refresh()
}

/** Re-applies the current language to the texts generated in code (hint, error). */
export function retranslateEditor() {
  if (!board) return
  setTool(tool)
  refresh()
}

function closeEditor() {
  $('editor').hidden = true
  document.body.style.overflow = ''
}

// ---------------------------------------------------------------------------
// Setup (once)
// ---------------------------------------------------------------------------

function setup() {
  board = Chessground($('editorBoard'), {
    movable: { free: true, color: 'both', showDests: false },
    draggable: { deleteOnDropOff: true, showGhost: true },
    premovable: { enabled: false },
    blockTouchScroll: true, // touches on the board edit it, never scroll the page
    highlight: { lastMove: false, check: false },
    animation: { duration: 100 },
    events: {
      change: refresh, // any piece moved, added or removed
      select: onSquare,
    },
  })

  renderPalette('paletteBlack', 'black', { kind: 'move' }, '✋')
  renderPalette('paletteWhite', 'white', { kind: 'erase' }, '🗑')

  $('edCancel').onclick = closeEditor
  $('edApply').onclick = apply
  $('edStart').onclick = () => setBoard(START_FEN.split(' ')[0], true)
  $('edClear').onclick = () => setBoard(EMPTY_BOARD, false)
  $('edFlip').onclick = () => board!.toggleOrientation()
  $('edTurn').onchange = refresh
  for (const c of CASTLING_KEYS) $(`ed${c}`).onchange = refresh
}

/** One palette row: the 6 pieces of `color` + an extra tool button. */
function renderPalette(id: string, color: Color, extra: Tool, extraLabel: string) {
  const el = $(id)
  el.innerHTML =
    ROLES.map((role) => `<button class="pal" data-role="${role}" data-color="${color}"><piece class="${role} ${color}"></piece></button>`).join('') +
    `<button class="pal tool" data-tool="${extra.kind}">${extraLabel}</button>`

  for (const btn of el.querySelectorAll<HTMLButtonElement>('button.pal')) {
    const role = btn.dataset.role as Role | undefined
    if (!role) {
      btn.onclick = () => setTool(extra)
      continue
    }
    const piece: Piece = { role, color }
    btn.onclick = () => setTool({ kind: 'piece', piece })
    // Dragging from the palette drops the piece directly on a square.
    const startDrag = (e: MouseEvent | TouchEvent) => {
      setTool({ kind: 'piece', piece })
      // force=true: drop it even though, outside the move tool, no colour is "movable".
      dragNewPiece(board!.state, piece, e, true)
    }
    btn.addEventListener('mousedown', startDrag)
    btn.addEventListener('touchstart', startDrag, { passive: false })
  }
}

// ---------------------------------------------------------------------------
// Interaction
// ---------------------------------------------------------------------------

function setTool(tl: Tool) {
  tool = tl
  // Highlight the active palette button.
  for (const btn of document.querySelectorAll<HTMLButtonElement>('#editor button.pal')) {
    const active =
      (tl.kind === 'piece' && btn.dataset.role === tl.piece.role && btn.dataset.color === tl.piece.color) ||
      (tl.kind !== 'piece' && btn.dataset.tool === tl.kind)
    btn.classList.toggle('active', active)
  }
  // Pieces can only be dragged around with the move tool.
  board?.set({ movable: { color: tl.kind === 'move' ? 'both' : undefined } })
  const hints: Record<Tool['kind'], MessageKey> = { move: 'ed.hint.move', piece: 'ed.hint.piece', erase: 'ed.hint.erase' }
  $('edHint').textContent = t(hints[tl.kind])
}

/** Square tapped: place or erase depending on the tool. */
function onSquare(key: Key) {
  if (!board || tool.kind === 'move') return
  const pieces = new Map<Key, Piece | undefined>([[key, tool.kind === 'piece' ? tool.piece : undefined]])
  board.setPieces(pieces)
  board.selectSquare(null)
  refresh()
}

function setBoard(boardFen: string, allCastling: boolean) {
  board!.set({ fen: boardFen })
  for (const c of CASTLING_KEYS) $<HTMLInputElement>(`ed${c}`).checked = allCastling
  refresh()
}

/** Current FEN from the board and the options. */
function currentFen(): string {
  const wanted = Object.fromEntries(CASTLING_KEYS.map((c) => [c, $<HTMLInputElement>(`ed${c}`).checked])) as CastlingRights
  return buildFen(board!.getFen(), $<HTMLSelectElement>('edTurn').value as Turn, wanted)
}

/** After any change: enable only possible castlings and show validation errors. */
function refresh() {
  if (!board) return
  const possible = possibleCastling(board.getFen())
  for (const c of CASTLING_KEYS) {
    const box = $<HTMLInputElement>(`ed${c}`)
    box.disabled = !possible[c]
    if (!possible[c]) box.checked = false
  }
  const error = validatePosition(currentFen())
  $('edError').textContent = error ?? ''
  $<HTMLButtonElement>('edApply').disabled = !!error
}

function apply() {
  const fen = currentFen()
  if (validatePosition(fen)) return // button is disabled anyway
  closeEditor()
  onApply(fen)
}
