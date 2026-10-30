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
 *   - "💾 Guardar" (José, 2026-10-25; at the top left since iteration 10):
 *     edit the PGN headers of the game on the board and save it (with its
 *     variations) in the favourites or in a 📁 Local database made here;
 *     "⬇ Descargar PGN" gives the favourites or a local database as one .pgn.
 *   - 📁 Local (iteration 10, 2026-10-30): open a PGN of the device (the last
 *     RECENT_FILES stay as buttons, read-only) or make a database here
 *     ("＋ Nueva", games are saved into it). See games/localDbs.ts.
 *   - The list the game on the board came from is remembered (`picked`), so
 *     📜 can go to the previous / next game and back to that list.
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
import {
  createDb, dbPgnFile, dbSummaries, findDb, gameRef, listDbs, loadDb, openFile, removeDb, saveToDb, shortName, touchDb, writableDbs,
} from '../games/localDbs'
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
  /** Opens `game` on the board; false if the user kept the current one (unsaved annotations). */
  onPick: (game: GameSummary) => boolean
  /** Headers of the game on the board (from the PGN it was opened from), and where it is saved: a favourite id or a 📁 Local game id. */
  current: () => { headers: PgnHeaders; savedId?: string }
  /** PGN of the game on the board with these headers. */
  buildPgn: (headers: PgnHeaders) => string
  /** The game on the board was saved as favourite or local game `id` with `headers`. */
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
type Tab = 'recent' | 'favorites' | 'local'
let tab: Tab = 'recent' // recent = the games of the selected site
let games: GameSummary[] = [] // loaded so far (recent tab)
let loadedFor = '' // query key the list belongs to (user + filters)
let exhausted = false // the site said there are no older games
let setupDone = false

/** 📁 Local: the selected database (remembered) and its games; shown LOCAL_PAGE at a time. */
const LOCAL_KEY = 'gamesLocalDb'
const LOCAL_PAGE = 100
let localDb = (() => {
  try {
    return localStorage.getItem(LOCAL_KEY) ?? ''
  } catch {
    return ''
  }
})()
let localGames: GameSummary[] = []
let localShown = LOCAL_PAGE

/**
 * Where the game on the board was picked from (iteration 10): the tab, site or
 * database, its list and its place in it. 📜 uses it for "previous / next game"
 * and to come back to that list. Forgotten when another game is started.
 */
interface Picked {
  tab: Tab
  site: OnlineSite
  dbId?: string
  list: GameSummary[] // for the recent games, the live array ("Cargar más" makes it grow)
  index: number
  key: string // queryKey() then: the recent list may only grow while it is the same query
}
let picked: Picked | undefined

const user = () => hooks.getUser(site)
const queryKey = () => JSON.stringify([site, user().toLowerCase(), filters])

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Opens the panel. `start`: 'save' = straight to 💾 Guardar (📜 → headers);
 * 'picked' = the list the game on the board came from, scrolled to it (📜 → 📂).
 */
export function openGames(h: Hooks, start?: 'save' | 'picked') {
  hooks = h
  if (!setupDone) setup()
  $('games').hidden = false
  $('games').scrollTop = 0
  document.body.style.overflow = 'hidden'
  view = 'list'
  if (start === 'picked' && picked) {
    tab = picked.tab
    site = picked.site
    if (picked.dbId) localDb = picked.dbId
  }
  renderSite()
  renderFilters()
  if (start === 'save') return openSave()
  // Reload only if the site, the user or the filters changed since the last time.
  if (tab === 'recent' && user() && loadedFor !== queryKey()) void reload()
  else if (tab === 'local') void showLocal(localDb).then(scrollToPicked)
  else (render(), scrollToPicked())
}

/** The game on the board, highlighted in view when its list is shown again. */
function scrollToPicked() {
  if (!picked) return
  const li = $('gamesList').querySelector<HTMLElement>(`li[data-id="${CSS.escape(picked.list[picked.index]?.id ?? '')}"]`)
  li?.classList.add('picked')
  li?.scrollIntoView({ block: 'center' })
}

/** Another game was started outside the lists (editor, FEN, "Nueva partida"…). */
export function forgetPicked() {
  picked = undefined
}

/** For 📜: the list the game came from (a short name) and whether there is a game before / after it. */
export function pickedInfo(): { label: string; hasPrev: boolean; hasNext: boolean } | undefined {
  if (!picked) return undefined
  // Plain name: 📜 puts it after 📂 ("📂 Lichess", "📂 Favoritas", "📂 mis partidas").
  const label = picked.tab === 'favorites' ? t('games.tab.favorites') : picked.tab === 'local' ? shortName(findDb(picked.dbId ?? '')?.name ?? '?') : SITE_NAMES[picked.site]
  return { label, hasPrev: picked.index > 0, hasNext: picked.index + 1 < picked.list.length || canLoadMoreFor(picked) }
}

/** The recent list of `p` can still grow: same query, and the site has older games. */
const canLoadMoreFor = (p: Picked) => p.tab === 'recent' && p.list === games && p.key === queryKey() && !exhausted && !!loadedFor

/** 📜 ⏪ / ⏩: opens the previous / next game of the same list (loading the next page if needed). */
export async function pickNeighbour(dir: 1 | -1): Promise<boolean> {
  const p = picked
  if (!p) return false
  if (dir === 1 && p.index + 1 >= p.list.length && canLoadMoreFor(p)) await loadPage()
  const game = p.list[p.index + dir]
  if (!game || !hooks.onPick(game)) return false
  picked = { ...p, index: p.index + dir } // onPick forgot it (a new game started): it is this list's again
  return true
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
  $('tabFavorites').onclick = () => {
    view = 'list' // also from 💾 Guardar
    setTab('favorites')
  }
  $('tabLocal').onclick = () => {
    view = 'list'
    setTab('local')
  }
  for (const s of SITES) $(`site-${s}`).onclick = () => setSite(s)
  $('gamesSaveBtn').onclick = openSave
  $('saveGame').onclick = () => void saveCurrentGame()
  $('saveTo').onchange = renderSaveButton
  $('listDownload').onclick = () => void downloadList()
  // 📁 Local: the file picker, "＋ Nueva", the database buttons, "🗑 Quitar".
  $('localOpen').onclick = () => $('localFile').click()
  $('localFile').onchange = () => void openLocalFile()
  $('localNew').onclick = () => void newLocalDb()
  $('localRemove').onclick = () => void removeLocalDb()
  $('localDbs').onclick = (e) => {
    const id = (e.target as HTMLElement).closest<HTMLElement>('[data-db]')?.dataset.db
    if (id) void showLocal(id)
  }
  $('gamesFrom').onchange = () => onFilterChange(() => (filters.from = $<HTMLInputElement>('gamesFrom').value))
  $('gamesTo').onchange = () => onFilterChange(() => (filters.to = $<HTMLInputElement>('gamesTo').value))
  $('gamesMore').onclick = () => {
    if (tab !== 'local') return void loadPage()
    localShown += LOCAL_PAGE
    render()
  }

  // One listener for the list: ☆ toggles a favourite, anything else opens the game.
  $('gamesList').onclick = (e) => {
    const li = (e.target as HTMLElement).closest<HTMLElement>('li[data-id]')
    if (!li) return
    const list = fullList()
    const index = list.findIndex((g) => g.id === li.dataset.id)
    const game = list[index]
    if (!game) return
    if ((e.target as HTMLElement).closest('.fav')) {
      toggleFavorite(game)
      render()
      return
    }
    if (!hooks.onPick(game)) return
    picked = { tab, site, dbId: tab === 'local' ? localDb : undefined, list, index, key: queryKey() }
    closeGames()
  }
}

/** Lichess | Chess.com: each keeps its username; the list reloads for the new site. Also back from ⭐ / 💾. */
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
  // One active button: 💾 Guardar (top left) or one of Lichess | Chess.com | ⭐ Favoritas | 📁 Local.
  for (const s of SITES) $(`site-${s}`).classList.toggle('active', view === 'list' && tab === 'recent' && s === site)
  $('tabFavorites').classList.toggle('active', view === 'list' && tab === 'favorites')
  $('tabLocal').classList.toggle('active', view === 'list' && tab === 'local')
  $('gamesSaveBtn').classList.toggle('active', view === 'save')
  $('gamesBrowse').hidden = view === 'save'
  $('gamesUserRow').hidden = tab !== 'recent' // the favourites and the local databases don't depend on the username
  $('localBar').hidden = tab !== 'local'
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

/** "Guardar en": ⭐ Favoritas or a 📁 Local database made here (the opened files are read-only). */
const FAVORITES = 'fav'

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
  // Where: the database the game is saved in, if it is one made here; the favourites otherwise.
  const ref = gameRef(savedId)
  const dbs = writableDbs()
  $('saveTo').innerHTML = [`<option value="${FAVORITES}">⭐ ${escapeHtml(t('games.tab.favorites'))}</option>`, ...dbs.map((d) => `<option value="${d.id}">📁 ${escapeHtml(d.name)}</option>`)].join('')
  $<HTMLSelectElement>('saveTo').value = ref && dbs.some((d) => d.id === ref.dbId) ? ref.dbId : FAVORITES
  renderSaveButton()
  $('saveStatus').textContent = ''
}

/** "Guardar en favoritas / en «X»", or "Guardar cambios" when the game is already saved there (it is updated, not duplicated). */
function renderSaveButton() {
  const { savedId } = hooks.current()
  const to = $<HTMLSelectElement>('saveTo').value
  if (to === FAVORITES) $('saveGame').textContent = t(savedId && isFavorite(savedId) ? 'games.save.update' : 'games.save.button')
  else $('saveGame').textContent = t(gameRef(savedId)?.dbId === to ? 'games.save.updateDb' : 'games.save.buttonDb', { db: findDb(to)?.name ?? '' })
}

async function saveCurrentGame() {
  const { headers, savedId } = hooks.current()
  // Tags not in the form (Lichess/Chess.com extras: TimeControl, ECO…) are kept.
  const edited: PgnHeaders = { ...headers }
  for (const k of SAVE_FIELDS) edited[k] = $<HTMLInputElement>(`pgnh-${k}`).value.trim()
  const pgn = hooks.buildPgn(edited)
  const to = $<HTMLSelectElement>('saveTo').value
  view = 'list'
  if (to === FAVORITES) {
    const id = savedId && isFavorite(savedId) ? savedId : `local-${Date.now()}`
    saveFavorite(summaryFromPgn(pgn, id, Date.now()))
    hooks.onSaved(id, edited)
    setTab('favorites') // show it there
    setStatus(t('games.save.done'))
    return
  }
  const ref = gameRef(savedId)
  try {
    const id = await saveToDb(to, pgn, ref?.dbId === to ? ref.index : undefined)
    hooks.onSaved(id, edited)
  } catch (e) {
    $('saveStatus').textContent = t('games.local.error', { detail: String(e) })
    view = 'save'
    return
  }
  tab = 'local'
  await showLocal(to)
  setStatus(t('games.save.doneDb', { db: findDb(to)?.name ?? '' }))
}

/**
 * ⬇ Descargar PGN: the favourites, or the selected local database, as one .pgn
 * file (share sheet on the iPhone → "Save to Files").
 */
async function downloadList() {
  const day = pgnDate(new Date()).replace(/\./g, '-')
  if (tab === 'favorites') return void (await shareFile(favoritesPgn(), `jquads-favoritas-${day}.pgn`, t('pgn.favoritesTitle')))
  const db = findDb(localDb)
  if (db) await shareFile(await dbPgnFile(db.id), `${db.name}.pgn`, db.name)
}

function setTab(next: Tab) {
  tab = next
  if (tab === 'local') return void showLocal(localDb)
  renderSite()
  render()
}

// ---------------------------------------------------------------------------
// 📁 Local databases (games/localDbs.ts)
// ---------------------------------------------------------------------------

/** Selects a database (or none) and shows its games. */
async function showLocal(id: string) {
  const db = findDb(id)
  localDb = db ? id : ''
  try {
    localStorage.setItem(LOCAL_KEY, localDb)
  } catch {
    /* not remembered */
  }
  localShown = LOCAL_PAGE
  localGames = db ? dbSummaries(db, await loadDb(db.id)) : []
  if (db) touchDb(db.id)
  setStatus(!listDbs().length ? t('games.local.none') : db && !localGames.length ? t('games.local.empty') : '')
  renderSite()
  render()
}

/** "📄 Abrir PGN…": the chosen file becomes a database (read-only) and is shown. */
async function openLocalFile() {
  const input = $<HTMLInputElement>('localFile')
  const file = input.files?.[0]
  input.value = '' // the same file can be chosen again
  if (!file) return
  setStatus(t('games.local.reading'))
  try {
    const db = await openFile(file)
    await showLocal(db.id)
  } catch (e) {
    setStatus(t(e instanceof Error && e.message === 'no games' ? 'games.local.noGames' : 'games.local.error', { detail: String(e), name: file.name }))
  }
}

/** "＋ Nueva": asks a name; an existing database with that name is just selected. */
async function newLocalDb() {
  const name = prompt(t('games.local.newName'))?.trim()
  if (!name) return
  const same = writableDbs().find((d) => d.name === name)
  await showLocal(same ? same.id : (await createDb(name)).id)
}

/** "🗑 Quitar": a file leaves the list (the file on the device is not touched); a database made here is deleted. */
async function removeLocalDb() {
  const db = findDb(localDb)
  if (!db) return
  const question = db.kind === 'file' ? t('games.local.removeFile', { name: db.name }) : t('games.local.removeApp', { name: db.name, n: db.count })
  if (!confirm(question)) return
  await removeDb(db.id)
  if (picked?.dbId === db.id) picked = undefined
  await showLocal(listDbs()[0]?.id ?? '')
}

/** The database buttons: 📝 made here, 📄 opened files (name shortened, full name as title). */
function renderLocalBar() {
  $('localDbs').innerHTML = listDbs()
    .map((d) => `<button class="chip${d.id === localDb ? ' on' : ''}" data-db="${d.id}" title="${escapeHtml(d.name)}">${d.kind === 'app' ? '📝' : '📄'} ${escapeHtml(shortName(d.name))}</button>`)
    .join('')
  $('localRemove').hidden = !localDb
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

/** Every game of the current list; the local ones are shown LOCAL_PAGE at a time. */
const fullList = () => (tab === 'favorites' ? listFavorites() : tab === 'local' ? localGames : games)
const currentList = () => (tab === 'local' ? localGames.slice(0, localShown) : fullList())

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
  $('gamesFilters').hidden = tab !== 'recent'
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
  $('gamesFilters').hidden = tab !== 'recent'
  const list = currentList()
  $('listDownload').hidden = tab === 'recent' || !list.length
  if (tab === 'local') renderLocalBar()
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
      // In the favourites (several sites) each game says where it comes from; a local game, its database.
      const from = site === 'local' ? (g.source ?? t('games.site.local')) : SITE_NAMES[site]
      // Games of a PGN file may have no (full) date: createdAt 0.
      const meta = [tab === 'favorites' ? from : '', g.createdAt ? dateFmt.format(g.createdAt) : '', speed, g.rated || site === 'local' ? '' : t('games.casual'), g.opening ? escapeHtml(g.opening) : '']
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
  $('gamesMore').hidden = tab === 'local' ? localShown >= localGames.length : tab !== 'recent' || exhausted || !loadedFor
}
