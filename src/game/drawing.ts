/**
 * Drawings on the board (✏️ phase 2, José, 2026-10-29): arrows and coloured
 * squares attached to a position, in the four colours Lichess uses.
 *
 * In PGN they live inside the move's comment as the commands Lichess and
 * Chess.com read and write:
 *   [%csl Gd4,Re5]      coloured squares (csl = "coloured squares list")
 *   [%cal Ge2e4,Rd1d8]  arrows (cal = "coloured arrows list")
 * Letter = colour: G green, R red, B blue, Y yellow.
 *
 * Pure: no UI here (src/ui/annotate.ts draws them with the board).
 */

export type DrawColor = 'G' | 'R' | 'B' | 'Y'
export const DRAW_COLORS: DrawColor[] = ['G', 'R', 'B', 'Y']

/** One drawing: an arrow `from` → `to`, or a coloured square when there is no `to`. */
export interface Drawing {
  color: DrawColor
  from: string // square, "e2"
  to?: string
}

const same = (a: Drawing, b: Drawing) => a.from === b.from && a.to === b.to

/**
 * Draws on top of what is there: the same arrow / square in the same colour
 * removes it; in another colour, changes its colour; otherwise it is added.
 */
export function toggleDrawing(list: Drawing[], d: Drawing): Drawing[] {
  const old = list.find((x) => same(x, d))
  if (!old) return [...list, d]
  const rest = list.filter((x) => x !== old)
  return old.color === d.color ? rest : [...rest, d]
}

/** The drawings in a PGN comment's [%csl …] and [%cal …] commands (others ignored). */
export function parseDrawings(comment: string): Drawing[] {
  const out: Drawing[] = []
  for (const [, kind, items] of comment.matchAll(/\[%(csl|cal)\s+([^\]]*)\]/g)) {
    for (const item of items.split(',')) {
      const m = item.trim().match(/^([GRBY])([a-h][1-8])([a-h][1-8])?$/)
      if (!m || (kind === 'cal') !== !!m[3]) continue // csl = squares only, cal = arrows only
      out.push({ color: m[1] as DrawColor, from: m[2], to: m[3] })
    }
  }
  return out
}

/** Drawings → PGN commands: "[%csl Gd4][%cal Ge2e4]" ('' without drawings). */
export function drawingsCommands(list: Drawing[] | undefined): string {
  const squares = (list ?? []).filter((d) => !d.to).map((d) => d.color + d.from)
  const arrows = (list ?? []).filter((d) => d.to).map((d) => d.color + d.from + d.to)
  return (squares.length ? `[%csl ${squares.join(',')}]` : '') + (arrows.length ? `[%cal ${arrows.join(',')}]` : '')
}
