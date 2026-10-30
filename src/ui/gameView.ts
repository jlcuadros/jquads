/**
 * Full-screen view of the whole game (José, 2026-10-26), opened with the small
 * button in the middle of the navigation bar: every move with its variations
 * and comments in large type (render.ts → renderGameView). Tapping a move goes
 * there (the board follows behind) and the view stays open, with that move
 * highlighted, until "Cerrar".
 * Above it (José, iteration 10, 2026-10-30): ⏪ previous game, 📂 the list
 * the game came from (Lichess, Chess.com, ⭐, a 📁 Local database), 💾 its
 * headers (the "Guardar" form) and ⏩ next game.
 */
import type { MoveNode } from '../game/tree'
import { t } from '../i18n/i18n'

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T

interface Hooks {
  render: () => string // the view's HTML for the current state
  goTo: (nodeId: number) => void
  /** The list the game came from (gamesPanel.ts → pickedInfo), undefined for a game made here. */
  source: () => { label: string; hasPrev: boolean; hasNext: boolean } | undefined
  /** Opens the previous / next game of that list; false if none (or the user kept this one). */
  neighbour: (dir: 1 | -1) => Promise<boolean>
  /** 📂 the panel on that list; 💾 the panel on "Guardar" (the headers). Both close this view first. */
  openList: () => void
  editHeaders: () => void
}

let hooks: Hooks | undefined

export function openGameView(h: Hooks) {
  hooks = h
  $('gameViewClose').onclick = closeGameView
  for (const [id, dir] of [['gvPrevGame', -1], ['gvNextGame', 1]] as const) {
    $(id).onclick = async () => {
      if (!(await hooks?.neighbour(dir))) return
      refreshGameView()
      $('gameView').scrollTop = $('gameViewBody').scrollTop = 0
    }
  }
  $('gvDb').onclick = () => (closeGameView(), hooks?.openList())
  $('gvHeaders').onclick = () => (closeGameView(), hooks?.editHeaders())
  $('gameViewBody').onclick = (e) => {
    const id = (e.target as HTMLElement).closest<HTMLElement>('[data-node]')?.dataset.node
    if (id === undefined) return
    hooks?.goTo(Number(id))
    refreshGameView()
  }
  $('gameView').hidden = false
  document.body.style.overflow = 'hidden'
  refreshGameView()
  $('gameViewBody').querySelector<HTMLElement>('.current')?.scrollIntoView({ block: 'center' })
}

export function closeGameView() {
  $('gameView').hidden = true
  document.body.style.overflow = ''
}

/** Redraws the view if it is open (after a move, an analysis update or a language change). */
export function refreshGameView() {
  if (!hooks || $('gameView').hidden) return
  $('gameViewBody').innerHTML = hooks.render()
  // The bar: ⏪ ⏩ only inside a list; 📂 says which list ("Partidas" for a game made here).
  const source = hooks.source()
  $<HTMLButtonElement>('gvPrevGame').disabled = !source?.hasPrev
  $<HTMLButtonElement>('gvNextGame').disabled = !source?.hasNext
  $('gvDb').textContent = `📂 ${source?.label ?? t('games.title')}`
}

/** Finds a node of the tree by id (the view's moves carry data-node). */
export function findNode(root: MoveNode, id: number): MoveNode | undefined {
  if (root.id === id) return root
  for (const c of root.children) {
    const found = findNode(c, id)
    if (found) return found
  }
  return undefined
}
