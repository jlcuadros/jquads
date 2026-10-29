/**
 * ✏️ Annotate the current move (José, 2026-10-29): chess symbols, a comment
 * and drawings on the board, in a panel that comes up from the bottom and
 * leaves the board in sight. ◀ ▶ inside it go through the moves without closing it.
 *
 * - Symbols: one tap puts it, another removes it; "move" and "position" allow
 *   one symbol each (game/annotations.ts → toggleNag). Under the rows, the
 *   meaning of the symbols set ("± White is better").
 * - Comment: what was written with ✏️ in the text, saved as the PGN comment.
 * - Drawings (phase 2): while the panel is open the board draws instead of
 *   moving pieces (ui/boardDraw.ts): tap a square to colour it, drag for an
 *   arrow, in the colour chosen in the header (game/drawing.ts → toggleDrawing:
 *   the same again removes it). 🗑 erases this position's drawings.
 * - At the start of the game there is no move: the symbols are shown but
 *   disabled, with the reason (José missed them there, 2026-10-29: in PGN a
 *   symbol needs a move); a comment and drawings are allowed (the PGN's
 *   comment before the first move).
 * - Automatic symbols (iteration 7): shown outlined in grey; tapping one makes it
 *   yours (stored), and one of yours replaces the automatic one of its group.
 * Everything is stored in the move tree, so 💾 Guardar and Exportar PGN take it.
 */
import { displayNags, NAGS, NAG_GROUPS, nagSymbol, toggleNag } from '../game/annotations'
import { DRAW_COLORS, toggleDrawing, type DrawColor, type Drawing } from '../game/drawing'
import type { MoveNode } from '../game/tree'
import { t, type MessageKey } from '../i18n/i18n'
import { startBoardDrawing } from './boardDraw'

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T

interface Hooks {
  node: () => MoveNode // the move being annotated (the board's current one)
  label: (node: MoveNode) => string // "12.♘xe5" (as in the move strip)
  changed: () => void // an annotation changed: redraw the board, the strip and the text
  prev: () => void // ◀ / ▶ of the panel: same as the navigation bar
  next: () => void
  board: () => HTMLElement // the board's squares (chessground's cg-board)
  orientation: () => 'white' | 'black'
  preview: (d?: Drawing) => void // the arrow being dragged (nothing = clear it)
  modeChanged: () => void // the panel opened / closed: the board moves or draws
  auto: (node: MoveNode) => number[] // its automatic symbols ([] when off)
}

let hooks: Hooks | undefined
/** The node whose comment is in the textarea (it is only refilled when the move changes). */
let shown: MoveNode | undefined
/** Colour of the next drawing (kept while the app is open). */
let color: DrawColor = 'G'
let stopDrawing: (() => void) | undefined

export const nagName = (code: number) => t(`nag.${code}` as MessageKey)

/** Changes one annotation of the current node and tells the app. */
function change(edit: (node: MoveNode) => void) {
  if (!hooks) return
  edit(hooks.node())
  hooks.changed()
  refreshAnnotate()
}

export function openAnnotate(h: Hooks) {
  hooks = h
  $('annDone').onclick = closeAnnotate
  $('annPrev').onclick = () => hooks?.prev()
  $('annNext').onclick = () => hooks?.next()
  // One listener for every symbol chip.
  $('annNags').onclick = (e) => {
    const code = (e.target as HTMLElement).closest<HTMLElement>('[data-nag]')?.dataset.nag
    if (code)
      change((node) => {
        const nags = toggleNag(node.nags ?? [], Number(code))
        node.nags = nags.length ? nags : undefined
      })
  }
  $('annColors').onclick = (e) => {
    const c = (e.target as HTMLElement).closest<HTMLElement>('[data-color]')?.dataset.color
    if (c) (color = c as DrawColor), refreshAnnotate()
  }
  $('annClear').onclick = () => change((node) => (node.drawings = undefined))
  $<HTMLTextAreaElement>('annComment').oninput = (e) => {
    if (!hooks) return
    hooks.node().comment = (e.target as HTMLTextAreaElement).value.trim() || undefined
    hooks.changed()
  }
  shown = undefined
  $('annotate').hidden = false
  $('annotateBtn').setAttribute('aria-pressed', 'true')
  stopDrawing?.()
  stopDrawing = startBoardDrawing(h.board(), {
    orientation: h.orientation,
    preview: (from, to) => hooks?.preview(from ? { color, from, to } : undefined),
    done: (from, to) => {
      hooks?.preview()
      change((node) => {
        const list = toggleDrawing(node.drawings ?? [], { color, from, to })
        node.drawings = list.length ? list : undefined
      })
    },
  })
  window.scrollTo({ top: 0 }) // the whole board in sight, above the panel
  h.modeChanged()
  refreshAnnotate()
}

export function closeAnnotate() {
  $('annotate').hidden = true
  $('annotateBtn').setAttribute('aria-pressed', 'false')
  $<HTMLTextAreaElement>('annComment').blur() // closes the iPhone keyboard
  stopDrawing?.()
  stopDrawing = undefined
  hooks?.modeChanged()
}

export const annotateOpen = () => !$('annotate').hidden

/** Redraws the panel if it is open (after a move, navigation or a language change). */
export function refreshAnnotate() {
  if (!hooks || !annotateOpen()) return
  const node = hooks.node()
  const isMove = !!node.parent
  $('annMove').textContent = isMove ? hooks.label(node) : t('ann.start')
  $('annColors').innerHTML = DRAW_COLORS.map(
    (c) => `<button class="ann-color c-${c}" data-color="${c}" aria-pressed="${c === color}" title="${t(`ann.color.${c}` as MessageKey)}" aria-label="${t(`ann.color.${c}` as MessageKey)}"></button>`,
  ).join('')
  $<HTMLButtonElement>('annClear').disabled = !node.drawings?.length
  const set = node.nags ?? []
  const display = displayNags(node.nags, hooks.auto(node)) // yours + automatic, merged per group
  const autoCodes = display.filter((d) => d.auto).map((d) => d.code)
  $('annNags').innerHTML = NAG_GROUPS.map(
    (g) =>
      `<div class="ann-row"><span class="ann-label">${t(`ann.${g}` as MessageKey)}</span>` +
      NAGS.filter((n) => n.group === g)
        .map((n) => `<button class="nag-chip${autoCodes.includes(n.code) ? ' auto' : ''}" data-nag="${n.code}"${isMove ? '' : ' disabled'} aria-pressed="${set.includes(n.code)}" title="${nagName(n.code)}" aria-label="${nagName(n.code)}">${n.symbol}</button>`)
        .join('') +
      '</div>',
  ).join('')
  // Without a move, why there are no symbols; else their meaning or, with none, how to draw.
  $('annMeaning').textContent = !isMove ? t('ann.noMove') : display.length ? display.map((d) => `${nagSymbol(d.code)} ${nagName(d.code)}${d.auto ? ` (${t('ann.auto')})` : ''}`).join(' · ') : t('ann.drawHint')
  const box = $<HTMLTextAreaElement>('annComment')
  box.placeholder = t('ann.comment')
  if (node !== shown) box.value = node.comment ?? '' // not while typing: it would move the cursor
  shown = node
}
