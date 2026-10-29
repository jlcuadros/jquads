/**
 * Drawing on the board with a finger or the mouse (✏️ phase 2, 2026-10-29):
 * tap a square → that square; drag from one square to another → an arrow.
 *
 * chessground only draws with the right mouse button (no touch), so while the
 * ✏️ panel is open the board is view-only and these pointer events read the
 * squares themselves. `touch-action: none` (class .drawing) stops the page
 * from scrolling under the finger.
 */
export interface DrawInput {
  /** The board's orientation ('white' = a1 bottom left). */
  orientation: () => 'white' | 'black'
  /** While dragging: the arrow so far (to = undefined while still on the first square; nothing = clear). */
  preview: (from?: string, to?: string) => void
  /** Finger / button lifted: a square (no `to`) or an arrow. */
  done: (from: string, to?: string) => void
}

/** Starts reading drawings on `el` (the board); returns the function that stops it. */
export function startBoardDrawing(el: HTMLElement, input: DrawInput): () => void {
  let from: string | undefined
  let to: string | undefined

  /** Square under a point, or undefined outside the board. */
  const squareAt = (x: number, y: number): string | undefined => {
    const r = el.getBoundingClientRect()
    const col = Math.floor(((x - r.left) / r.width) * 8)
    const row = Math.floor(((y - r.top) / r.height) * 8)
    if (col < 0 || col > 7 || row < 0 || row > 7) return undefined
    const white = input.orientation() === 'white'
    return 'abcdefgh'[white ? col : 7 - col] + String(white ? 8 - row : row + 1)
  }

  const down = (e: PointerEvent) => {
    from = squareAt(e.clientX, e.clientY)
    if (!from) return
    to = undefined
    e.preventDefault()
    el.setPointerCapture(e.pointerId) // keep the moves even if the finger leaves the board
    input.preview(from)
  }
  const move = (e: PointerEvent) => {
    if (!from) return
    const sq = squareAt(e.clientX, e.clientY)
    const next = sq && sq !== from ? sq : undefined
    if (next !== to) input.preview(from, (to = next))
  }
  const up = () => {
    if (from) input.done(from, to)
    from = to = undefined
  }
  const cancel = () => {
    if (from) input.preview() // clear the preview
    from = to = undefined
  }

  el.classList.add('drawing')
  el.addEventListener('pointerdown', down)
  el.addEventListener('pointermove', move)
  el.addEventListener('pointerup', up)
  el.addEventListener('pointercancel', cancel)
  return () => {
    el.classList.remove('drawing')
    el.removeEventListener('pointerdown', down)
    el.removeEventListener('pointermove', move)
    el.removeEventListener('pointerup', up)
    el.removeEventListener('pointercancel', cancel)
  }
}
