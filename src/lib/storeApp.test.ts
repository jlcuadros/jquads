import { afterEach, describe, expect, it } from 'vitest'
import { openOwnPagesOnWebsite, storeApp } from './storeApp'

// Minimal browser globals for the three ways jquads can run.
function browser({ search = '', referrer = '', capacitor = false } = {}) {
  const store: Record<string, string> = {}
  Object.assign(globalThis, {
    location: { search },
    document: { referrer },
    sessionStorage: { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => void (store[k] = v) },
    Capacitor: capacitor ? { isNativePlatform: () => true } : undefined,
  })
  return store
}

afterEach(() => {
  for (const k of ['location', 'document', 'sessionStorage', 'Capacitor']) delete (globalThis as Record<string, unknown>)[k]
})

describe('storeApp (hide the donations link inside store apps)', () => {
  it('a plain browser or home-screen app: none', () => {
    browser()
    expect(storeApp()).toBeNull()
  })

  it('Google Play TWA: by its start URL, or by the android-app:// referrer; remembered for reloads', () => {
    const store = browser({ search: '?app=android' })
    expect(storeApp()).toBe('android')
    Object.assign(globalThis, { location: { search: '' } }) // a reload without the parameter
    expect(storeApp()).toBe('android')
    expect(store.storeApp).toBe('android')
    browser({ referrer: 'android-app://dev.pages.jquads.twa/' })
    expect(storeApp()).toBe('android')
  })

  it('App Store (Capacitor shell): ios', () => {
    browser({ capacitor: true })
    expect(storeApp()).toBe('ios')
  })
})

describe('openOwnPagesOnWebsite (iOS app)', () => {
  it('own pages in a new tab → the website; external and in-page links unchanged', () => {
    const opened: string[] = []
    let listener: (e: unknown) => void = () => undefined
    const doc = { addEventListener: (_: string, f: (e: unknown) => void) => (listener = f) } as unknown as Document
    Object.assign(globalThis, { location: { assign: (u: string) => opened.push(u) } })
    openOwnPagesOnWebsite(doc)
    const click = (href: string | null, target = '_blank') => {
      let prevented = false
      const a = { getAttribute: () => href }
      listener({ target: { closest: (sel: string) => (sel.includes(target) ? a : null) }, preventDefault: () => (prevented = true) })
      return prevented
    }
    expect(click('privacy.html')).toBe(true)
    expect(click('licenses.txt')).toBe(true)
    expect(click('https://lichess.org/@/Ousland')).toBe(false)
    expect(click('#top')).toBe(false)
    expect(opened).toEqual(['https://jquads.pages.dev/privacy.html', 'https://jquads.pages.dev/licenses.txt'])
    delete (globalThis as Record<string, unknown>).location
  })
})
