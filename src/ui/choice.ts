/**
 * A small choice dialog (José, 2026-10-26), used for the variations:
 *   - a move is played where the game already continues differently:
 *     "Variante nueva" / "Sobrescribir";
 *   - ▶ at a position with several continuations: which one to follow.
 * Resolves with the chosen value, or null if cancelled (button, tap outside
 * the box, or Escape). Built on demand; only one at a time.
 */
import { t } from '../i18n/i18n'

export interface ChoiceOption<T> {
  label: string // HTML (moves may carry figurines)
  value: T
}

export function askChoice<T>(title: string, options: ChoiceOption<T>[]): Promise<T | null> {
  document.getElementById('choice')?.remove()
  return new Promise((resolve) => {
    const overlay = document.createElement('div')
    overlay.id = 'choice'
    overlay.className = 'choice-overlay'
    overlay.innerHTML =
      `<div class="choice-box" role="dialog" aria-modal="true"><p>${title}</p>` +
      options.map((o, i) => `<button class="choice-option" data-i="${i}">${o.label}</button>`).join('') +
      `<button class="choice-cancel">${t('choice.cancel')}</button></div>`
    const close = (value: T | null) => {
      overlay.remove()
      document.removeEventListener('keydown', onKey)
      resolve(value)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(null)
    }
    overlay.onclick = (e) => {
      const target = e.target as HTMLElement
      const option = target.closest<HTMLElement>('.choice-option')
      if (option) close(options[Number(option.dataset.i)].value)
      else if (target === overlay || target.closest('.choice-cancel')) close(null)
    }
    document.addEventListener('keydown', onKey)
    document.body.append(overlay)
  })
}
