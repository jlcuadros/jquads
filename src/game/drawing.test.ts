import { describe, expect, it } from 'vitest'
import { drawingsCommands, parseDrawings, toggleDrawing, type Drawing } from './drawing'
import { gamePgn, movetextTokens, treeFromPgn } from './pgn'

describe('✏️ drawings: arrows and coloured squares (2026-10-29)', () => {
  it('toggling: add, change colour, remove', () => {
    const arrow: Drawing = { color: 'G', from: 'e2', to: 'e4' }
    let list = toggleDrawing([], arrow)
    list = toggleDrawing(list, { color: 'R', from: 'd4' }) // a square
    expect(list).toEqual([arrow, { color: 'R', from: 'd4' }])
    list = toggleDrawing(list, { color: 'B', from: 'e2', to: 'e4' }) // same arrow, other colour
    expect(list).toEqual([{ color: 'R', from: 'd4' }, { color: 'B', from: 'e2', to: 'e4' }])
    expect(toggleDrawing(list, { color: 'R', from: 'd4' })).toEqual([{ color: 'B', from: 'e2', to: 'e4' }]) // same again: off
    expect(toggleDrawing(list, { color: 'R', from: 'e2' })).toHaveLength(3) // a square ≠ an arrow from it
  })

  it('PGN commands: Lichess / Chess.com format, both ways', () => {
    const list = parseDrawings('[%csl Gd4,Ye5] [%clk 0:01:00] [%cal Rd1d8, Bg1f3] text')
    expect(list).toEqual([
      { color: 'G', from: 'd4', to: undefined },
      { color: 'Y', from: 'e5', to: undefined },
      { color: 'R', from: 'd1', to: 'd8' },
      { color: 'B', from: 'g1', to: 'f3' },
    ])
    expect(drawingsCommands(list)).toBe('[%csl Gd4,Ye5][%cal Rd1d8,Bg1f3]')
    expect(parseDrawings('[%csl Gd4d5,Xe4][%cal Ge2]')).toEqual([]) // wrong kind / colour: ignored
    expect(drawingsCommands(undefined)).toBe('')
  })

  it('in the game: inside the comment, read back, and not shown as text', () => {
    const tree = treeFromPgn('{[%csl Ge4]} 1. e4 {[%cal Gg1f3] the knight next} e5 {[%csl Rf7]} *')
    const e4 = tree.root.children[0]
    expect(tree.root.drawings).toEqual([{ color: 'G', from: 'e4', to: undefined }])
    expect(e4.drawings).toEqual([{ color: 'G', from: 'g1', to: 'f3' }])
    expect(e4.comment).toBe('the knight next') // the command is not part of the text
    const pgn = gamePgn(tree, new Date(2026, 9, 29))
    expect(pgn).toContain('{[%csl Ge4]} 1. e4 {[%cal Gg1f3] the knight next} 1... e5 {[%csl Rf7]} *')
    // Round trip, and the game view's tokens keep the text apart from the commands.
    expect(treeFromPgn(pgn).root.children[0].children[0].drawings).toEqual([{ color: 'R', from: 'f7', to: undefined }])
    const comments = movetextTokens(tree).filter((tk) => tk.kind === 'comment')
    expect(comments.map((tk) => (tk.kind === 'comment' ? tk.text : ''))).toEqual(['', 'the knight next', ''])
  })
})
