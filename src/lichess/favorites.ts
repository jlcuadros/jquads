/**
 * Favourite games, stored on the device (localStorage) — José's choice
 * (2026-10-25): no login needed; not shared between devices. Each favourite
 * keeps the whole summary (with its PGN), so it opens even without connection.
 */
import type { GameSummary } from './games'

const KEY = 'favoriteGames'

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

/** All favourites, newest first (same order as the Lichess list). */
export function listFavorites(): GameSummary[] {
  return Object.values(read()).sort((a, b) => b.createdAt - a.createdAt)
}
