/**
 * Opening names (José, iteration 11, 2026-10-30): "Sicilian Defense: Dragon
 * Variation" and its ECO code, from the Lichess opening list
 * (github.com/lichess-org/chess-openings, CC0, English only), built into
 * public/openings/ by scripts/openings/build-openings.mjs.
 *
 * As Lichess does, a position without a name takes the name of the last named
 * position before it ("play moves backwards until a named position is found"),
 * so the name stays after leaving the list's theory. Used in:
 *   - the text below the board ("🏷 Apertura: …"): first while in the book and
 *     until two half-moves after leaving it, then last (José, 2026-10-30: "no tiene
 *     sentido tener lo mismo ahí arriba todo el rato");
 *   - the PGN headers [ECO] and [Opening] (the whole name in Opening, as Lichess);
 *   - optionally, a comment on each move where the name changes (like the
 *     evaluation symbol, which is only written when it changes).
 * Downloaded once and kept in IndexedDB, like the book.
 */
import { fetchCached } from '../lib/cache'
import type { GameTree, MoveNode } from '../game/tree'
import type { PgnHeaders } from '../game/pgn'
import { positionKey } from './positionKey'

export const OPENINGS_FILE = 'openings/lichess-openings-712a58b.json'

/**
 * Positions reached with this move number or later are not looked up (José, 2026-10-30:
 * "no gastar recursos en tonto"): the longest line of the list ends at move 18 (Marshall
 * Attack, Spassky Variation), so no name can appear later; the last one found stays.
 */
export const LAST_MOVE_LOOKED_UP = 21

/** Number of the move that led to this position: "… w … 5" was reached by Black's 4th move. */
export function moveNumberOf(fen: string): number {
  const [, side, , , , full] = fen.split(' ')
  return Number(full) - (side === 'w' ? 1 : 0)
}

export interface Opening {
  eco: string
  name: string
}

export class OpeningNames {
  constructor(private readonly byKey: Record<string, [string, string]>) {}

  /** The name of exactly this position, if the list has it (never after LAST_MOVE_LOOKED_UP). */
  exact(fen: string): Opening | undefined {
    if (moveNumberOf(fen) > LAST_MOVE_LOOKED_UP) return undefined // nothing to find there
    const e = this.byKey[positionKey(fen)]
    return e ? { eco: e[0], name: e[1] } : undefined
  }

  /** The name at `node`: its own, or the last named position before it (undefined before any). */
  at(node: MoveNode | null | undefined): Opening | undefined {
    for (let n = node; n; n = n.parent) {
      if (moveNumberOf(n.fen) > LAST_MOVE_LOOKED_UP) continue // only climb back, no lookup
      const o = this.exact(n.fen)
      if (o) return o
    }
    return undefined
  }

  /**
   * The comment for a move where the opening changes: the new name, when this
   * position has one different from the name before it (in a variation, before
   * it in that variation).
   */
  changeAt(node: MoveNode): string | undefined {
    if (!node.parent) return undefined
    const here = this.exact(node.fen)
    return here && here.name !== this.at(node.parent)?.name ? here.name : undefined
  }

  /** [ECO] and [Opening] of the game: the name at the end of the main line ({} if none). */
  headers(tree: GameTree): PgnHeaders {
    let end = tree.root
    while (end.children.length) end = end.children[0]
    const o = this.at(end)
    return o ? { ECO: o.eco, Opening: o.name } : {}
  }
}

export async function loadOpenings(): Promise<OpeningNames> {
  const { data } = await fetchCached(`${location.origin}/${OPENINGS_FILE}`)
  return new OpeningNames(JSON.parse(new TextDecoder().decode(data)).openings)
}
