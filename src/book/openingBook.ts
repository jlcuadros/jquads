/**
 * The app's opening book (iteration 6): Lichess games, both players 2300+,
 * rapid and classical (scripts/book/build_book.py). Served with the app from
 * public/book/ and kept in IndexedDB after the first download, like the
 * engines' files. The version is in the file name: a new book gets a new
 * name, so the cache never serves an old one.
 */
import { fetchCached } from '../lib/cache'
import { PolyglotBook } from './polyglot'

export const BOOK_FILE = 'book/lichess-2300-slow-v1.bin'

/** Book moves shown in the text: at least this share of the position's games. */
export const BOOK_MIN_SHARE = 0.01

export async function loadBook(): Promise<PolyglotBook> {
  const { data } = await fetchCached(`${location.origin}/${BOOK_FILE}`)
  return new PolyglotBook(data)
}
