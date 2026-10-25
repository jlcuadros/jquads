/**
 * Favourite games, stored on the device (localStorage) — José's choice
 * (2026-10-25): no login needed; not shared between devices. Each favourite
 * keeps the whole summary (with its PGN), so it opens even without connection.
 *
 * Besides, the favourites are kept as one PGN file (all the games, newest
 * first) under FAVORITES_PGN_KEY, rewritten on every change (José: "keep a
 * PGN with the favourites locally"); 📂 → ⭐ Favoritas → "Descargar PGN"
 * hands that file over.
 */
import type { GameSummary } from './common'

const KEY = 'favoriteGames'
export const FAVORITES_PGN_KEY = 'favoritesPgn'

function read(): Record<string, GameSummary> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}')
  } catch {
    return {}
  }
}

function write(favs: Record<string, GameSummary>) {
  try {
    localStorage.setItem(KEY, JSON.stringify(favs))
    localStorage.setItem(FAVORITES_PGN_KEY, toPgnFile(sorted(favs)))
  } catch {
    /* storage full or unavailable: favourites just won't persist */
  }
}

export function isFavorite(id: string): boolean {
  return id in read()
}

/** Adds or removes `game`; returns whether it is now a favourite. */
export function toggleFavorite(game: GameSummary): boolean {
  const favs = read()
  const nowFavorite = !(game.id in favs)
  if (nowFavorite) favs[game.id] = game
  else delete favs[game.id]
  write(favs)
  return nowFavorite
}

/** Adds `game`, or replaces the favourite with the same id (a saved game edited again). */
export function saveFavorite(game: GameSummary) {
  const favs = read()
  favs[game.id] = game
  write(favs)
}

const sorted = (favs: Record<string, GameSummary>) => Object.values(favs).sort((a, b) => b.createdAt - a.createdAt)

/** Several games as one PGN file: each game's PGN, separated by a blank line. */
export const toPgnFile = (games: GameSummary[]) => games.map((g) => g.pgn.trim()).join('\n\n') + (games.length ? '\n' : '')

/** All favourites, newest first (same order as the lists), from every site. */
export function listFavorites(): GameSummary[] {
  return sorted(read())
}

/** The favourites as one PGN file (what is kept under FAVORITES_PGN_KEY). */
export function favoritesPgn(): string {
  return toPgnFile(listFavorites())
}
