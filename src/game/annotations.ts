/**
 * Move annotations (José, 2026-10-29): the chess symbols of a move ("!", "?!",
 * "±", "N"…), stored as PGN NAGs (Numeric Annotation Glyphs, "$1"…), the
 * standard that Lichess, Chess.com and every chess program read.
 *
 * Three groups, as in the ✏️ panel:
 *  - move:     how good the move is (only one: "!" replaces "?");
 *  - position: who stands better after it (only one);
 *  - other:    ideas (novelty, initiative…), any combination.
 * Codes and symbols follow the PGN standard (section 10) and Lichess's glyphs.
 *
 * Pure: no UI here (src/ui/annotate.ts shows the panel).
 */

export type NagGroup = 'move' | 'position' | 'other'

export interface NagInfo {
  code: number // the NAG number ($code in PGN)
  symbol: string // what is shown after the move
  group: NagGroup
}

/** Every symbol offered, in the order they are shown (and written) per group. */
export const NAGS: NagInfo[] = [
  { code: 3, symbol: '!!', group: 'move' },
  { code: 1, symbol: '!', group: 'move' },
  { code: 5, symbol: '!?', group: 'move' },
  { code: 6, symbol: '?!', group: 'move' },
  { code: 2, symbol: '?', group: 'move' },
  { code: 4, symbol: '??', group: 'move' },
  { code: 7, symbol: '□', group: 'move' }, // only move
  { code: 18, symbol: '+−', group: 'position' }, // White is winning
  { code: 16, symbol: '±', group: 'position' },
  { code: 14, symbol: '⩲', group: 'position' },
  { code: 10, symbol: '=', group: 'position' },
  { code: 13, symbol: '∞', group: 'position' }, // unclear
  { code: 44, symbol: '=∞', group: 'position' }, // compensation for the material
  { code: 15, symbol: '⩱', group: 'position' },
  { code: 17, symbol: '∓', group: 'position' },
  { code: 19, symbol: '−+', group: 'position' }, // Black is winning
  { code: 146, symbol: 'N', group: 'other' }, // novelty
  { code: 36, symbol: '↑', group: 'other' }, // initiative
  { code: 40, symbol: '→', group: 'other' }, // attack
  { code: 132, symbol: '⇆', group: 'other' }, // counterplay
  { code: 22, symbol: '⨀', group: 'other' }, // zugzwang
  { code: 138, symbol: '⊕', group: 'other' }, // time trouble
]
export const NAG_GROUPS: NagGroup[] = ['move', 'position', 'other']

const BY_CODE = new Map(NAGS.map((n) => [n.code, n]))
const ORDER = new Map(NAGS.map((n, i) => [n.code, i]))

/** Known NAGs only, without repeats, in display order (move, position, other). */
export function normalizeNags(codes: number[]): number[] {
  return [...new Set(codes)].filter((c) => BY_CODE.has(c)).sort((a, b) => ORDER.get(a)! - ORDER.get(b)!)
}

/**
 * Taps a symbol: on → off; off → on, replacing the other symbol of its group
 * for "move" and "position" (a move can't be "!" and "?" at once).
 */
export function toggleNag(codes: number[], code: number): number[] {
  if (codes.includes(code)) return codes.filter((c) => c !== code)
  const group = BY_CODE.get(code)?.group
  const kept = group === 'other' ? codes : codes.filter((c) => BY_CODE.get(c)?.group !== group)
  return normalizeNags([...kept, code])
}

/** "!" for 1, etc.; '' for an unknown code. */
export const nagSymbol = (code: number) => BY_CODE.get(code)?.symbol ?? ''

/**
 * The symbols after a move as they are shown: the move's own symbol stuck to it
 * ("Nxe5!"), each of the rest after a space ("Nxe5! ± N", "e4 ±"). '' without symbols.
 */
export function nagsText(codes: number[] | undefined): string {
  return normalizeNags(codes ?? [])
    .map((c) => (BY_CODE.get(c)!.group === 'move' ? '' : ' ') + nagSymbol(c))
    .join('')
}

/** Suffix symbols written straight after a move in PGN ("e4!?") → their NAG. */
export const SUFFIX_NAG: Record<string, number> = { '!': 1, '?': 2, '!!': 3, '??': 4, '!?': 5, '?!': 6 }

/**
 * Your symbols (✏️) together with the automatic ones (iteration 7): in "move"
 * and "position" a symbol of yours replaces the automatic one of that group;
 * "other" keeps both. `auto` marks the ones shown in grey.
 */
export function displayNags(manual: number[] | undefined, auto: number[] | undefined): Array<{ code: number; auto: boolean }> {
  const mine = normalizeNags(manual ?? [])
  const groupOf = (c: number) => BY_CODE.get(c)?.group
  const taken = new Set<NagGroup | undefined>(mine.map(groupOf).filter((g) => g !== 'other')) // groups you already set
  const extra = normalizeNags(auto ?? []).filter((c) => !mine.includes(c) && !taken.has(groupOf(c)!))
  return normalizeNags([...mine, ...extra]).map((code) => ({ code, auto: extra.includes(code) }))
}

/** Same, as plain codes (what is written to the PGN). */
export const mergedNags = (manual: number[] | undefined, auto: number[] | undefined) => displayNags(manual, auto).map((d) => d.code)
