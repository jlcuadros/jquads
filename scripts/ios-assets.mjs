// Icon and launch screen of the iOS app (store release, 2026-10-30; task_03.1 → ios):
//   - ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png: 1024 × 1024, the jquads icon
//     (one universal 1024 image: Xcode makes every size from it);
//   - Splash.imageset (the launch screen, shown "aspect fill"): 2732 × 2732, the icon centred on the
//     app's blue. A phone shows only the middle ~45 % of its width, so the icon stays small and centred.
// Usage: node scripts/ios-assets.mjs <original-icon.png>
import { webkit } from 'playwright'
import { readFileSync } from 'node:fs'
import { squareIcon } from './lib/icon.mjs'

const [originalIcon] = process.argv.slice(2)
if (!originalIcon) throw new Error('usage: node scripts/ios-assets.mjs <original-icon.png>')
const ASSETS = 'ios/App/App/Assets.xcassets'

squareIcon(originalIcon, 1024, `${ASSETS}/AppIcon.appiconset/AppIcon-512@2x.png`)

// Launch screen: same blue gradient as the Google Play feature graphic (scripts/store-images.mjs).
const icon = `data:image/png;base64,${readFileSync(`${ASSETS}/AppIcon.appiconset/AppIcon-512@2x.png`).toString('base64')}`
const browser = await webkit.launch()
const page = await browser.newPage({ viewport: { width: 2732, height: 2732 } })
await page.setContent(`<body style="margin:0;width:2732px;height:2732px;display:flex;align-items:center;justify-content:center;
  background:linear-gradient(135deg, #1e3fc4, #0d1f6e)"><img src="${icon}" style="width:560px;height:560px;border-radius:124px"></body>`)
// The three scales of the Splash image set use the same picture (as Capacitor's template does).
for (const name of ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png']) {
  await page.screenshot({ path: `${ASSETS}/Splash.imageset/${name}` })
}
await browser.close()
console.log('iOS icon and launch screen written')
