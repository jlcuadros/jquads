// Maskable app icon for Android (store release, 2026-10-30; task_03.1 → android): Android crops icons to a
// circle, squircle or square depending on the phone, and only the centre 80 % circle is safe
// (https://web.dev/articles/maskable-icon). The jquads icon reaches the edges (the bomb's fuse is near the top),
// so it is drawn at 76 % on the app's blue → public/icons/icon-maskable-512.png, declared with
// "purpose": "maskable" in public/manifest.webmanifest and used by the Google Play app (twa-manifest.json).
// Usage: node scripts/android/maskable-icon.mjs
import { webkit } from 'playwright'
import { readFileSync } from 'node:fs'

const icon = `data:image/png;base64,${readFileSync('public/icons/icon-512.png').toString('base64')}`
const browser = await webkit.launch()
const page = await browser.newPage({ viewport: { width: 512, height: 512 } })
await page.setContent(`<body style="margin:0;width:512px;height:512px;display:flex;align-items:center;justify-content:center;
  background:linear-gradient(135deg, #1e3fc4, #0d1f6e)"><img src="${icon}" style="width:389px;height:389px;border-radius:72px"></body>`)
await page.screenshot({ path: 'public/icons/icon-maskable-512.png' })
await browser.close()
console.log('public/icons/icon-maskable-512.png')
