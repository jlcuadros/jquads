/**
 * Full-screen "📂 Lichess games" panel (José, 2026-10-25), modelled on
 * maiachess.com's "Select game → Lichess":
 *   - the user's games, newest first, PAGE_SIZE at a time ("Load more");
 *   - filters: speed chips (bullet / blitz / rapid / classical /
 *     correspondence) and a date range;
 *   - ☆ / ⭐ favourites stored on the device, with their own tab;
 *   - tapping a game hands it to the app, which opens it at the initial
 *     position with the board facing the user (José's requirement).
 * The username is the same setting as ⚙ → "Usuario de Lichess".
 */
import { t, getLang, type MessageKey } from '../i18n/i18n'
import {
  fetchGames, dayRange, scoreText, timeControlText, userColor, userResult, LichessGamesError,
  PAGE_SIZE, SPEEDS, type GameSummary, type Speed,
} from '../lichess/games'
import { isFavorite, listFavorites, toggleFavorite } from '../lichess/favorites'

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T

interface Hooks {
  getUser: () => string
  setUser: (name: string) => void
  onPick: (game: GameSummary) => void
}

/** Filters, remembered on the device between visits. */
interface Filters {
  speeds: Speed[]
  from: string // "YYYY-MM-DD" or ""
  to: string
}
const FILTERS_KEY = 'gamesFilters'
function loadFilters(): Filters {
  try {
    return { speeds: [], from: '', to: '', ...JSON.parse(localStorage.getItem(FILTERS_KEY) ?? '{}') }
  } catch {
    return { speeds: [], from: '', to: '' }
  }
}
function saveFilters() {
  try {
    localStorage.setItem(FILTERS_KEY, JSON.stringify(filters))
  } catch {
    /* not persisted */
  }
}

let hooks: Hooks
let filters = loadFilters()
let tab: 'recent' | 'favorites' = 'recent'
let games: GameSummary[] = [] // loaded so far (recent tab)
let loadedFor = '' // query key the list belongs to (user + filters)
let exhausted = false // the last page came back incomplete: no more games
let setupDone = false

const queryKey = () => JSON.stringify([hooks.getUser().toLowerCase(), filters])

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function openGames(h: Hooks) {
  hooks = h
  if (!setupDone) setup()
  $('games').hidden = false
  $('games').scrollTop = 0
  document.body.style.overflow = 'hidden'
  $<HTMLInputElement>('gamesUser').value = hooks.getUser()
  renderFilters()
  // Reload only if the user or the filters changed since the last time.
  if (tab === 'recent' && hooks.getUser() && loadedFor !== queryKey()) void reload()
  else render()
}

function closeGames() {
  $('games').hidden = true
  document.body.style.overflow = ''
}

/** Re-applies the current language to texts generated in code. */
export function retranslateGames() {
  if (setupDone && !$('games').hidden) {
    renderFilters()
    render()
  }
}

// ---------------------------------------------------------------------------
// Setup and events
// ---------------------------------------------------------------------------

function setup() {
  setupDone = true
  $('gamesClose').onclick = closeGames
  const load = () => {
    hooks.setUser($<HTMLInputElement>('gamesUser').value.trim())
    setTab('recent')
    void reload()
  }
  $('gamesLoad').onclick = load
  $('gamesUser').onkeydown = (e) => {
    if (e.key === 'Enter') load()
  }
  $('tabRecent').onclick = () => {
    setTab('recent')
    if (loadedFor !== queryKey()) void reload()
    else render()
  }
  $('tabFavorites').onclick = () => setTab('favorites')
  $('gamesFrom').onchange = () => onFilterChange(() => (filters.from = $<HTMLInputElement>('gamesFrom').value))
  $('gamesTo').onchange = () => onFilterChange(() => (filters.to = $<HTMLInputElement>('gamesTo').value))
  $('gamesMore').onclick = () => void loadPage()

  // One listener for the list: ☆ toggles a favourite, anything else opens the game.
  $('gamesList').onclick = (e) => {
    const li = (e.target as HTMLElement).closest<HTMLElement>('li[data-id]')
    if (!li) return
    const game = currentList().find((g) => g.id === li.dataset.id)
    if (!game) return
    if ((e.target as HTMLElement).closest('.fav')) {
      toggleFavorite(game)
      render()
      return
    }
    closeGames()
    hooks.onPick(game)
  }
}

function setTab(next: typeof tab) {
  tab = next
  $('tabRecent').classList.toggle('active', tab === 'recent')
  $('tabFavorites').classList.toggle('active', tab === 'favorites')
  render()
}

function onFilterChange(change: () => void) {
  change()
  saveFilters()
  renderFilters()
  if (tab === 'recent') void reload()
  else render()
}

// ---------------------------------------------------------------------------
// Loading (Lichess API, see lichess/games.ts)
// ---------------------------------------------------------------------------

async function reload() {
  games = []
  exhausted = false
  loadedFor = queryKey()
  await loadPage()
}

/** Next page: games older than the last one shown ("until"). */
async function loadPage() {
  const username = hooks.getUser()
  if (!username) return setStatus(t('games.needUser'))
  const key = queryKey()
  const since = filters.from ? dayRange(filters.from)[0] : undefined
  let until = filters.to ? dayRange(filters.to)[1] : undefined
  if (games.length) until = games[games.length - 1].createdAt - 1
  setStatus(t('games.loading'))
  $('gamesMore').hidden = true
  try {
    const page = await fetchGames({ username, speeds: filters.speeds, since, until, max: PAGE_SIZE })
    if (key !== queryKey()) return // filters changed meanwhile: a newer load is running
    games.push(...page)
    exhausted = page.length < PAGE_SIZE
    setStatus('')
  } catch (e) {
    const err = e instanceof LichessGamesError ? e : new LichessGamesError('network', String(e))
    if (err.kind === 'notFound') setStatus(t('games.err.notFound', { user: username }))
    else if (err.kind === 'rateLimited') setStatus(t('games.err.rateLimited'))
    else setStatus(t('games.err.network', { detail: err.message }))
    loadedFor = '' // allow retrying
  }
  render()
}

function setStatus(text: string) {
  $('gamesStatus').textContent = text
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const currentList = () => (tab === 'favorites' ? listFavorites() : games)

function renderFilters() {
  $('speedChips').innerHTML = SPEEDS.map(
    (s) => `<button class="chip${filters.speeds.includes(s) ? ' on' : ''}" data-speed="${s}">${t(`games.speed.${s}` as MessageKey)}</button>`,
  ).join('')
  for (const chip of $('speedChips').querySelectorAll<HTMLButtonElement>('.chip')) {
    chip.onclick = () =>
      onFilterChange(() => {
        const s = chip.dataset.speed as Speed
        filters.speeds = filters.speeds.includes(s) ? filters.speeds.filter((x) => x !== s) : [...filters.speeds, s]
      })
  }
  $<HTMLInputElement>('gamesFrom').value = filters.from
  $<HTMLInputElement>('gamesTo').value = filters.to
  $('gamesFilters').hidden = tab === 'favorites'
}

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

function render() {
  $('gamesFilters').hidden = tab === 'favorites'
  const list = currentList()
  const user = hooks.getUser()
  if (tab === 'favorites' && !list.length) setStatus(t('games.noFavorites'))
  else if (tab === 'recent' && !list.length && $('gamesStatus').textContent === '' && user) setStatus(t('games.empty'))
  else if (tab === 'favorites') setStatus('')

  const dateFmt = new Intl.DateTimeFormat(getLang(), { day: 'numeric', month: 'short', year: 'numeric' })
  $('gamesList').innerHTML = list
    .map((g) => {
      const result = userResult(g, user)
      const me = userColor(g, user)
      const player = (color: 'white' | 'black') => {
        const p = g[color]
        const name = `${escapeHtml(p.name)}${p.rating ? ` ${p.rating}` : ''}`
        return me === color ? `<span class="me">${name}</span>` : name
      }
      const speed = t(`games.speed.${g.speed === 'ultraBullet' ? 'bullet' : g.speed}` as MessageKey)
      const meta = [dateFmt.format(g.createdAt), `${timeControlText(g)} ${speed}`, g.rated ? '' : t('games.casual'), g.opening ? escapeHtml(g.opening) : '']
        .filter(Boolean)
        .join(' · ')
      const fav = isFavorite(g.id)
      return (
        // data-created / data-me: used by scripts/games-test.mjs (order and board orientation)
        `<li data-id="${g.id}" data-created="${g.createdAt}" data-me="${me ?? ''}">` +
        `<span class="res ${result ?? 'draw'}">${scoreText(g)}</span>` +
        `<span class="info"><div class="players">♔ ${player('white')} – ♚ ${player('black')}</div><div class="meta">${meta}</div></span>` +
        `<button class="fav" aria-label="${t(fav ? 'games.unfavorite' : 'games.favorite')}">${fav ? '⭐' : '☆'}</button>` +
        `</li>`
      )
    })
    .join('')
  $('gamesMore').hidden = tab !== 'recent' || exhausted || !games.length
}
