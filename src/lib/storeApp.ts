/**
 * Is jquads running as a store app (store release, 2026-10-30)?
 *  - **Google Play**: the Trusted Web Activity opens the website with
 *    `?app=android` (its start URL, set in the Bubblewrap twa-manifest.json), and
 *    the first page load of a TWA has an `android-app://` referrer. Remembered
 *    in sessionStorage, so reloads inside the app keep knowing it.
 *  - **App Store**: the Capacitor shell injects `window.Capacitor`, whose
 *    `isNativePlatform()` is true inside the iOS app.
 * Why: the stores forbid links to outside payment methods inside their apps,
 * so the ☕ Ko-fi line is hidden there (task_03.1 → Investigation 1).
 */
export type StoreApp = 'android' | 'ios' | null

const KEY = 'storeApp'

export function storeApp(): StoreApp {
  const capacitor = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
  if (capacitor?.isNativePlatform?.()) return 'ios'
  try {
    const fromPlay = new URLSearchParams(location.search).get('app') === 'android' || document.referrer.startsWith('android-app://')
    if (fromPlay) sessionStorage.setItem(KEY, 'android')
    return sessionStorage.getItem(KEY) === 'android' ? 'android' : null
  } catch {
    return null // no storage: a plain browser
  }
}

/** The public website: where the iOS app opens its own pages (privacy, support, licences). */
export const WEBSITE = 'https://jquads.pages.dev/'

/**
 * iOS app: links that open a new tab (target="_blank") to one of the app's own files
 * (privacy.html, support.html, licenses.txt) would point to capacitor://localhost/…, which
 * Capacitor hands to iOS and iOS can't open — nothing would happen. Such clicks go to the same
 * page on the website instead: Capacitor cancels any navigation to another site and opens it in
 * Safari, leaving the app where it was (WebViewDelegationHandler.decidePolicyFor). A navigation
 * works without a "user gesture", unlike window.open (checked in the simulator, 2026-10-30).
 * One listener for the whole document, so links re-created by a language change are covered too.
 */
export function openOwnPagesOnWebsite(doc: Document = document) {
  doc.addEventListener('click', (e) => {
    const a = (e.target as Element | null)?.closest?.('a[target="_blank"]')
    const href = a?.getAttribute('href')
    if (!href || /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('#')) return // external or in-page: unchanged
    e.preventDefault()
    location.assign(new URL(href, WEBSITE).href)
  })
}
