/**
 * Full-screen "📂 games" panel (José, 2026-10-25), modelled on
 * maiachess.com's "Select game → Lichess":
 *   - site selector Lichess | Chess.com, each with its own username (José:
 *     "a tab for Lichess and another for Chess.com");
 *   - the user's games, newest first, PAGE_SIZE at a time ("Load more");
 *   - filters: speed chips (bullet / blitz / rapid / classical /
 *     correspondence) and a date range;
 *   - ☆ / ⭐ favourites stored on the device, with their own tab (one list
 *     for both sites, each game labelled with its site);
 *   - tapping a game hands it to the app, which opens it at the initial
 *     position with the board facing the user (José's requirement).
 *   - "💾 Guardar" next to the sites (José, 2026-10-25): edit the PGN
 *     headers of the game on the board and save it (with its variations) in
 *     the favourites; "⬇ Descargar PGN" in the favourites gives all of them
 *     as one .pgn file.
 * The usernames are the same settings as ⚙ → "Usuario de Lichess" /
 * "Usuario de Chess.com". Chess.com has no "classical" speed: its chip is hidden.
 */
import { t, getLang, type MessageKey } from '../i18n/i18n'
import {
  dayRange, scoreText, siteOf, summaryFromPgn, timeControlText, userColor, userResult, GamesError,
  PAGE_SIZE, SITES, SITE_NAMES, SPEEDS, type GameSummary, type GamesPage, type GamesQuery, type OnlineSite, type Speed,
} from '../games/common'
import { favoritesPgn, isFavorite, listFavorites, saveFavorite, toggleFavorite } from '../games/favorites'
import { RESULTS, ROSTER, defaultHeaders, pgnDate, type PgnHeaders } from '../game/pgn'
import { shareFile } from '../lib/download'
import { fetchLichessGames } from '../lichess/games'
import { fetchChessComGames, CHESSCOM_SPEEDS } from '../chesscom/games'

/** Each site: how to download a page, and which speed chips make sense. */
const SOURCES: Record<OnlineSite, { fetch: (q: GamesQuery) => Promise<GamesPage>; speeds: Speed[] }> = {
  lichess: { fetch: fetchLichessGames, speeds: SPEEDS },
  chesscom: { fetch: fetchChessComGames, speeds: CHESSCOM_SPEEDS },
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T

interface Hooks {
  getUser: (site: OnlineSite) => string
  setUser: (site: OnlineSite, name: string) => void
  onPick: (game: GameSummary) => void
  /** Headers of the game on the board (from the PGN it was opened from), and its favourite id if it was saved here. */
  current: () => { headers: PgnHeaders; savedId?: string }
  /** PGN of the game on the board with these headers. */
  buildPgn: (headers: PgnHeaders) => string
  /** The game on the board was saved as favourite `id` with `headers`. */
  onSaved: (id: string, headers: PgnHeaders) => void
}

/** Headers editable in "Guardar", in this order (Result is a list; the rest text). */
const SAVE_FIELDS = [...ROSTER.filter((k) => k !== 'Result'), 'WhiteElo', 'BlackElo', 'Result']

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

/** Selected site, remembered on the device. */
const SITE_KEY = 'gamesSite'
function loadSite(): OnlineSite {
  try {
    const v = localStorage.getItem(SITE_KEY) as OnlineSite | null
    return v && SITES.includes(v) ? v : 'lichess'
  } catch {
    return 'lichess'
  }
}

let hooks: Hooks
let site: OnlineSite = loadSite()
let view: 'list' | 'save' = 'list' // "💾 Guardar" shows the header form instead of the list
let filters = loadFilters()
let tab: 'recent' | 'favorites' = 'recent'
let games: GameSummary[] = [] // loaded so far (recent tab)
let loadedFor = '' // query key the list belongs to (user + filters)
let exhausted = false // the site said there are no older games
let setupDone = false

const user = () => hooks.getUser(site)
const queryKey = () => JSON.stringify([site, user().toLowerCase(), filters])

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function openGames(h: Hooks) {
  hooks = h
  if (!setupDone) setup()
  $('games').hidden = false
  $('games').scrollTop = 0
  document.body.style.overflow = 'hidden'
  view = 'list'
  renderSite()
  renderFilters()
  // Reload only if the site, the user or the filters changed since the last time.
  if (tab === 'recent' && user() && loadedFor !== queryKey()) void reload()
  else render()
}

function closeGames() {
  $('games').hidden = true
  document.body.style.overflow = ''
}

/** Re-applies the current language to texts generated in code. */
export function retranslateGames() {
  if (setupDone && !$('games').hidden) {
    renderSite()
    renderFilters()
    render()
    if (view === 'save') renderSaveForm()
  }
}

// ---------------------------------------------------------------------------
// Setup and events
// ---------------------------------------------------------------------------

function setup() {
  setupDone = true
  $('gamesClose').onclick = closeGames
  const load = () => {
    hooks.setUser(site, $<HTMLInputElement>('gamesUser').value.trim())
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
  for (const s of SITES) $(`site-${s}`).onclick = () => setSite(s)
  $('site-save').onclick = openSave
  $('saveGame').onclick = saveCurrentGame
  $('favDownload').onclick = () => void downloadFavorites()
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

/** Lichess | Chess.com: each keeps its username; the list reloads for the new site. */
function setSite(next: OnlineSite) {
  if (next === site && tab === 'recent' && view === 'list') return
  site = next
  view = 'list'
  try {
    localStorage.setItem(SITE_KEY, site)
  } catch {
    /* not persisted */
  }
  setStatus('')
  renderSite()
  renderFilters()
  setTab('recent')
  if (user() && loadedFor !== queryKey()) void reload()
  else if (!user()) {
    games = []
    loadedFor = ''
    setStatus(t('games.needUser', { site: SITE_NAMES[site] }))
    render()
  }
}

function renderSite() {
  for (const s of SITES) $(`site-${s}`).classList.toggle('active', view === 'list' && s === site)
  $('site-save').classList.toggle('active', view === 'save')
  $('gamesBrowse').hidden = view === 'save'
  $('gamesSave').hidden = view === 'list'
  const input = $<HTMLInputElement>('gamesUser')
  input.value = user()
  input.setAttribute('aria-label', t(site === 'lichess' ? 'games.user' : 'games.userChesscom'))
  input.placeholder = input.getAttribute('aria-label')!
}

// ---------------------------------------------------------------------------
// 💾 Guardar: the game on the board → favourites, with edited PGN headers
// ---------------------------------------------------------------------------

function openSave() {
  view = 'save'
  renderSite()
  renderSaveForm()
}

/** The form, filled with the game's headers (or the defaults of a game analysed here). */
function renderSaveForm() {
  const { headers, savedId } = hooks.current()
  const values: PgnHeaders = { ...defaultHeaders(), ...headers }
  $('saveFields').innerHTML = SAVE_FIELDS.map((k) => {
    const id = `pgnh-${k}`
    const input =
      k === 'Result'
        ? `<select id="${id}">${RESULTS.map((r) => `<option${r === values.Result ? ' selected' : ''}>${r}</option>`).join('')}</select>`
        : `<input id="${id}" type="text" value="${escapeHtml(values[k] ?? '')}" autocapitalize="off" autocomplete="off" spellcheck="false"${k.endsWith('Elo') ? ' inputmode="numeric"' : ''} />`
    return `<label><span>${t(`pgnh.${k}` as MessageKey)}</span> ${input}</label>`
  }).join('')
  // A game saved here and still a favourite is updated, not duplicated.
  $('saveGame').textContent = t(savedId && isFavorite(savedId) ? 'games.save.update' : 'games.save.button')
  $('saveStatus').textContent = ''
}

function saveCurrentGame() {
  const { headers, savedId } = hooks.current()
  // Tags not in the form (Lichess/Chess.com extras: TimeControl, ECO…) are kept.
  const edited: PgnHeaders = { ...headers }
  for (const k of SAVE_FIELDS) edited[k] = $<HTMLInputElement>(`pgnh-${k}`).value.trim()
  const id = savedId && isFavorite(savedId) ? savedId : `local-${Date.now()}`
  saveFavorite(summaryFromPgn(hooks.buildPgn(edited), id, Date.now()))
  hooks.onSaved(id, edited)
  // Show it in the favourites.
  view = 'list'
  renderSite()
  setTab('favorites')
  setStatus(t('games.save.done'))
}

/** All the favourites as one .pgn file (share sheet on the iPhone → "Save to Files"). */
async function downloadFavorites() {
  await shareFile(favoritesPgn(), `jquads-favoritas-${pgnDate(new Date()).replace(/\./g, '-')}.pgn`, t('pgn.favoritesTitle'))
}

function setTab(next: typeof tab) {
  tab = next
  $('tabRecent').classList.toggle('active', tab === 'recent')
  $('tabFavorites').classList.toggle('active', tab === 'favorites')
  render()
}

/**
 * Filter changes wait FILTER_DEBOUNCE_MS before asking Lichess, so several quick
 * changes (e.g. clearing both dates) make a single request: Lichess limits
 * requests and, when it does, answers without CORS headers (2026-10-25).
 */
const FILTER_DEBOUNCE_MS = 400
let filterTimer: ReturnType<typeof setTimeout> | undefined

function onFilterChange(change: () => void) {
  change()
  saveFilters()
  renderFilters()
  if (tab !== 'recent') return render()
  clearTimeout(filterTimer)
  filterTimer = setTimeout(() => void reload(), FILTER_DEBOUNCE_MS)
}

// ---------------------------------------------------------------------------
// Loading (Lichess API, see lichess/games.ts)
// ---------------------------------------------------------------------------

/**
 * Each reload has a number; a page that arrives for an older reload is
 * dropped. Without it, changing a filter and tapping "Cargar" within the
 * debounce made two loads with the same query, and the list came out twice
 * (found by games-test, 2026-10-25).
 */
let loadSeq = 0

async function reload() {
  clearTimeout(filterTimer) // a pending filter reload would repeat this one
  loadSeq++
  games = []
  exhausted = false
  loadedFor = queryKey()
  await loadPage()
}

/** Next page: games older than the last one shown ("until"). */
async function loadPage() {
  const username = user()
  const siteName = SITE_NAMES[site]
  if (!username) return setStatus(t('games.needUser', { site: siteName }))
  const key = queryKey()
  const seq = loadSeq
  const since = filters.from ? dayRange(filters.from)[0] : undefined
  let until = filters.to ? dayRange(filters.to)[1] : undefined
  if (games.length) until = games[games.length - 1].createdAt - 1
  setStatus(t('games.loading'))
  $('gamesMore').hidden = true
  try {
    const page = await SOURCES[site].fetch({ username, speeds: filters.speeds, since, until, max: PAGE_SIZE })
    if (key !== queryKey() || seq !== loadSeq) return // a newer load is running
    games.push(...page.games)
    exhausted = page.exhausted
    // Chess.com can stop after a few months without matches: "Load more" goes on.
    setStatus(!games.length && !exhausted ? t('games.emptySoFar') : '')
  } catch (e) {
    if (seq !== loadSeq) return // error of a load nobody is waiting for
    const err = e instanceof GamesError ? e : new GamesError('network', String(e))
    if (err.kind === 'notFound') setStatus(t('games.err.notFound', { user: username, site: siteName }))
    else if (err.kind === 'rateLimited') setStatus(t('games.err.rateLimited', { site: siteName }))
    else setStatus(t('games.err.network', { detail: err.message, site: siteName }))
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
  $('speedChips').innerHTML = SOURCES[site].speeds.map(
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

/**
 * Whose game it is: the username of its site; for a game saved here, whichever
 * of the two usernames appears in it (or "" if none).
 */
export function ownerName(g: GameSummary, getUser: (s: OnlineSite) => string = (s) => hooks.getUser(s)): string {
  const site = siteOf(g)
  if (site !== 'local') return getUser(site)
  return SITES.map(getUser).find((u) => u && userColor(g, u)) ?? ''
}

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

function render() {
  $('gamesFilters').hidden = tab === 'favorites'
  const list = currentList()
  $('favDownload').hidden = tab !== 'favorites' || !list.length
  if (tab === 'favorites' && !list.length) setStatus(t('games.noFavorites'))
  else if (tab === 'recent' && !list.length && $('gamesStatus').textContent === '' && user() && exhausted) setStatus(t('games.empty'))
  else if (tab === 'favorites') setStatus('')

  const dateFmt = new Intl.DateTimeFormat(getLang(), { day: 'numeric', month: 'short', year: 'numeric' })
  $('gamesList').innerHTML = list
    .map((g) => {
      const gameUser = ownerName(g) // favourites mix the sites
      const result = userResult(g, gameUser)
      const me = userColor(g, gameUser)
      const player = (color: 'white' | 'black') => {
        const p = g[color]
        const name = `${escapeHtml(p.name)}${p.rating ? ` ${p.rating}` : ''}`
        return me === color ? `<span class="me">${name}</span>` : name
      }
      const site = siteOf(g)
      // Saved games have no speed: their Event goes where the opening goes.
      const speed = g.speed ? `${timeControlText(g)} ${t(`games.speed.${g.speed === 'ultraBullet' ? 'bullet' : g.speed}` as MessageKey)}` : ''
      // In the favourites (several sites) each game says where it comes from.
      const meta = [tab === 'favorites' ? (site === 'local' ? t('games.site.local') : SITE_NAMES[site]) : '', dateFmt.format(g.createdAt), speed, g.rated || site === 'local' ? '' : t('games.casual'), g.opening ? escapeHtml(g.opening) : '']
        .filter(Boolean)
        .join(' · ')
      const fav = isFavorite(g.id)
      return (
        // data-created / data-me: used by scripts/games-test.mjs (order and board orientation)
        `<li data-id="${g.id}" data-site="${site}" data-created="${g.createdAt}" data-me="${me ?? ''}">` +
        `<span class="res ${result ?? 'draw'}">${scoreText(g)}</span>` +
        `<span class="info"><div class="players">♔ ${player('white')} – ♚ ${player('black')}</div><div class="meta">${meta}</div></span>` +
        `<button class="fav" aria-label="${t(fav ? 'games.unfavorite' : 'games.favorite')}">${fav ? '⭐' : '☆'}</button>` +
        `</li>`
      )
    })
    .join('')
  $('gamesMore').hidden = tab !== 'recent' || exhausted || !loadedFor
}
