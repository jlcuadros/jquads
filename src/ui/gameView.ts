/**
 * Full-screen view of the whole game (José, 2026-10-26), opened with the small
 * button in the middle of the navigation bar: every move with its variations
 * and comments in large type (render.ts → renderGameView). Tapping a move goes
 * there (the board follows behind) and the view stays open, with that move
 * highlighted, until "Cerrar".
 */
import type { MoveNode } from '../game/tree'

const $ = (id: string) => document.getElementById(id)!

interface Hooks {
  render: () => string // the view's HTML for the current state
  goTo: (nodeId: number) => void
}

let hooks: Hooks | undefined

export function openGameView(h: Hooks) {
  hooks = h
  $('gameViewClose').onclick = closeGameView
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
  if (hooks && !$('gameView').hidden) $('gameViewBody').innerHTML = hooks.render()
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
