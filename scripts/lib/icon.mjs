// The app icon at any size, from José's original picture (1168 × 1166, a white pawn with a lit bomb
// on blue; __Attachment__/Pasted image 20261029185419.png in the vault): cropped to its centred
// 1166 × 1166 square and resized with `sips` (macOS). No transparency, as the App Store requires.
// Shared by scripts/store-images.mjs (store icons) and scripts/ios-assets.mjs (the iOS app's icon).
import { execFileSync } from 'node:child_process'
import { rmSync } from 'node:fs'

export function squareIcon(original, size, out) {
  const square = `${out}.square.png`
  execFileSync('sips', ['-c', '1166', '1166', original, '--out', square], { stdio: 'ignore' })
  execFileSync('sips', ['-z', String(size), String(size), square, '--out', out], { stdio: 'ignore' })
  rmSync(square)
}
