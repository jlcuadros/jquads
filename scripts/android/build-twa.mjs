// Generates and builds the Google Play app (Trusted Web Activity) of jquads with @bubblewrap/core
// (store release, 2026-10-30; task_03.1 → android). Non-interactive, unlike `bubblewrap init/build`.
//
//   android/twa-manifest.json  →  Gradle project in android/ (TwaGenerator)  →  gradle bundleRelease
//   + assembleRelease  →  android/app/build/outputs/{bundle,apk}/release/  (unsigned: signed later
//   with José's upload key, see android.md).
//
// Bubblewrap downloads the icons from the website while generating. ICON_HOST lets them come from
// another host (e.g. https://preview.jquads.pages.dev before a new icon is in production); the app
// itself always opens the host of twa-manifest.json.
//
// Needs ~/.bubblewrap/config.json (scripts/android/setup-android.mjs).
// Usage: [ICON_HOST=https://preview.jquads.pages.dev] node scripts/android/build-twa.mjs [--no-generate]
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const require = createRequire(import.meta.url)
const { TwaManifest, TwaGenerator, Config, JdkHelper, AndroidSdkTools, GradleWrapper, ConsoleLog } = require('@bubblewrap/core')

const PROJECT = resolve('android')
const log = new ConsoleLog('twa')
const manifestFile = join(PROJECT, 'twa-manifest.json')

if (!process.argv.includes('--no-generate')) {
  const json = JSON.parse(readFileSync(manifestFile, 'utf8'))
  if (process.env.ICON_HOST) {
    for (const key of ['iconUrl', 'maskableIconUrl']) json[key] = json[key]?.replace(`https://${json.host}`, process.env.ICON_HOST)
  }
  const twaManifest = new TwaManifest(json)
  const errors = twaManifest.validate()
  if (errors) throw new Error(`twa-manifest.json: ${errors}`)
  await new TwaGenerator().createTwaProject(PROJECT, twaManifest, log)
  log.info('project generated in android/')
}

const { jdkPath, androidSdkPath } = JSON.parse(readFileSync(join(homedir(), '.bubblewrap', 'config.json'), 'utf8'))
const config = new Config(jdkPath, androidSdkPath)
const jdkHelper = new JdkHelper(process, config)
// The constructor, not AndroidSdkTools.create(): create() would install build-tools 36.1.0 with sdkmanager,
// whose packages the Android Gradle Plugin can't read (see setup-android.mjs). Gradle installs its own.
const sdk = new AndroidSdkTools(process, config, jdkHelper, log)
const gradle = new GradleWrapper(process, sdk, PROJECT)
await gradle.bundleRelease() // .aab: what Google Play takes
await gradle.assembleRelease() // .apk: to install directly on a phone for testing
log.info('built: android/app/build/outputs/bundle/release/app-release.aab and apk/release/app-release-unsigned.apk')
