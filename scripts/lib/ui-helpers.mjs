// Helpers shared by the end-to-end tests (2026-10-28).

/**
 * Opens a panel (its button: ⚙ "#menu" or 📋 "#positionBtn") and makes sure it
 * opened: in WebKit's iPhone emulation a tap is sometimes delivered without a
 * click (traced 2026-10-26, see i18n-test.mjs), so it retries after a pause.
 * A person would simply tap again.
 */
export async function openPanel(page, button, panel) {
  for (let i = 0; i < 3 && (await page.isHidden(panel)); i++) {
    if (i) await page.waitForTimeout(700)
    await page.click(button)
  }
}

/** Closes a panel the same way (retrying), if it is open. */
export async function closePanel(page, button, panel) {
  for (let i = 0; i < 3 && !(await page.isHidden(panel)); i++) {
    if (i) await page.waitForTimeout(700)
    await page.click(button)
  }
}

/** Opens ⚙ with its folded groups ("Motor", "Interfaz", 2026-10-28) unfolded, so their controls can be used. */
export async function openSettings(page) {
  await openPanel(page, '#menu', '#settings')
  await page.evaluate(() => document.querySelectorAll('#settings details.settings-group').forEach((d) => (d.open = true)))
}

/** Closes ⚙. */
export const closeSettings = (page) => closePanel(page, '#menu', '#settings')
