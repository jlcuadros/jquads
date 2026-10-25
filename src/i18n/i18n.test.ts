import { afterEach, describe, expect, it } from 'vitest'
import { MESSAGES, detectLang, setLang, t, type Lang, type MessageKey } from './i18n'
import { describePosition, type Segment } from '../analysis/describe'
import { classifyMoves } from '../analysis/classify'
import { tbLabel } from '../analysis/tablebase'

const LANGS = Object.keys(MESSAGES) as Lang[]
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
const links = (s: string) => [...s.matchAll(/href="([^"]+)"/g)].map((m) => m[1]).sort()

afterEach(() => setLang('es'))

describe('translations', () => {
  it('has the 7 requested languages', () => {
    expect(LANGS.sort()).toEqual(['de', 'en', 'es', 'fr', 'it', 'pt', 'ru'])
  })

  for (const lang of LANGS) {
    it(`${lang}: no empty texts, same {placeholders} and links as Spanish`, () => {
      for (const key of Object.keys(MESSAGES.es) as MessageKey[]) {
        const text = MESSAGES[lang][key]
        expect(text.trim().length, `${lang} ${key} empty`).toBeGreaterThan(0)
        expect(placeholders(text), `${lang} ${key} placeholders`).toEqual(placeholders(MESSAGES.es[key]))
        expect(links(text), `${lang} ${key} links`).toEqual(links(MESSAGES.es[key]))
      }
    })
  }
})

describe('t / detectLang', () => {
  it('fills placeholders', () => {
    setLang('en')
    expect(t('msg.loading', { pct: 42 })).toBe('Loading engines… 42%')
  })
  it("picks the first supported device language, English otherwise", () => {
    expect(detectLang(['ja-JP', 'fr-CA', 'en'])).toBe('fr')
    expect(detectLang(['pt-BR'])).toBe('pt')
    expect(detectLang(['ja-JP'])).toBe('en')
  })
})

describe('generated texts in other languages', () => {
  const text = (segs: Segment[]) => segs.map((s) => ('text' in s ? s.text : s.san)).join('')
  const input = () => ({
    whiteToMove: true,
    elo: 1500,
    best: { cp: 30 },
    classified: classifyMoves(new Map([['e2e4', { cp: 30 }], ['d2d4', { cp: 28 }], ['g2g4', { cp: -150 }]]), true),
    policy: [{ uci: 'e2e4', prob: 0.6 }, { uci: 'd2d4', prob: 0.25 }, { uci: 'g2g4', prob: 0.15 }],
    san: (u: string) => ({ e2e4: 'e4', d2d4: 'd4', g2g4: 'g4' })[u] ?? u,
  })

  it('English', () => {
    setLang('en')
    expect(text(describePosition(input()))).toBe(
      'The position is balanced. The good moves are e4 and d4, and a 1500 player would find them easily (85 %). Beware of g4: 15 % would play it, but it is a blunder (−1.50). ',
    )
    expect(tbLabel({ cp: 0 }, 'draw', true)).toBe('Draw (50 m.)')
  })

  it('Russian', () => {
    setLang('ru')
    expect(text(describePosition(input()))).toContain('Позиция равная. Хорошие ходы: e4 и d4')
    expect(tbLabel({ cp: 0 }, 'draw')).toBe('Ничья')
  })
})
