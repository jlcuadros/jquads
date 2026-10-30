// Android build environment for the Google Play app (store release, 2026-10-30; task_03.1 → android).
//
// Installs into ~/.bubblewrap (nothing system-wide) and writes ~/.bubblewrap/config.json, the file the
// bubblewrap CLI and @bubblewrap/core read:
//   - JDK 17 (Eclipse Temurin 17.0.11+9, the version Bubblewrap 1.27 pins), checked against Adoptium's SHA-256;
//   - Android command-line tools, the LATEST from Google's repository index (checked against its SHA-1);
//   - the Android SDK licences, accepted (José authorised it on 2026-10-30).
// The SDK packages themselves (platform android-36, build-tools 35.0.0) are downloaded by Gradle on the
// first build (the Android Gradle Plugin installs what it needs once the licences are accepted): the
// command-line tools 23 install them through Google's new "Android CLI", which writes package.xml in a
// newer format (repository2/04) that the template's Android Gradle Plugin 8.9.1 doesn't read — it then
// re-downloaded them into "android-36-2"… and failed (2026-10-30).
//
// Why not Bubblewrap's own installers (JdkInstaller / AndroidSdkToolsInstaller of @bubblewrap/cli): under
// Node 26 their unzip step never finished ("unsettled top-level await" after "Decompressing the JDK 17
// Sources"), and they pin command-line tools from 2020 (6609375). Here: curl + tar/unzip (macOS tools).
// Re-running skips what is already installed.
//
// Usage: node scripts/android/setup-android.mjs
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'


const ROOT = join(homedir(), '.bubblewrap')
const JDK_ROOT = join(ROOT, 'jdk')
const SDK_ROOT = join(ROOT, 'android_sdk')
const JDK = {
  version: '17.0.11+9',
  file: 'OpenJDK17U-jdk_aarch64_mac_hotspot_17.0.11_9.tar.gz', // Apple silicon
  base: 'https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.11%2B9/',
}

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', ...opts })
const fetchText = (url) => execFileSync('curl', ['-fsSL', url]).toString()
const sha = (algo, file) => createHash(algo).update(readFileSync(file)).digest('hex')
function download(url, file, algo, expected) {
  run('curl', ['-fL', '--progress-bar', '-o', file, url])
  const got = sha(algo, file)
  if (got !== expected) throw new Error(`${algo} mismatch for ${file}: ${got} ≠ ${expected}`)
  console.log(`${file}: ${algo} OK`)
}

// 1. JDK 17 → ~/.bubblewrap/jdk/jdk-17.0.11+9 (a macOS JDK bundle: Contents/Home inside).
mkdirSync(JDK_ROOT, { recursive: true })
const jdkPath = join(JDK_ROOT, `jdk-${JDK.version}`)
if (!existsSync(join(jdkPath, 'Contents', 'Home', 'bin', 'java'))) {
  const archive = join(JDK_ROOT, JDK.file)
  const expected = fetchText(`${JDK.base}${JDK.file}.sha256.txt`).split(/\s+/)[0]
  download(`${JDK.base}${JDK.file}`, archive, 'sha256', expected)
  run('tar', ['-xzf', archive, '-C', JDK_ROOT])
  rmSync(archive)
}
// Leftovers of Bubblewrap's installer (the JDK sources, only needed when redistributing): removed.
for (const d of readdirSync(JDK_ROOT)) if (d.startsWith('jdk17u-') || d.endsWith('.zip')) rmSync(join(JDK_ROOT, d), { recursive: true, force: true })
console.log('JDK:', jdkPath)

// 2. Android command-line tools (latest) → ~/.bubblewrap/android_sdk/cmdline-tools/latest, Google's standard layout.
//    (Not in the SDK root, as Bubblewrap's installer does: a source.properties there makes the Android Gradle
//    Plugin take the whole SDK for one "legacy package" and see no platform — "Failed to find target
//    android-36", 2026-10-30.)
const TOOLS = join(SDK_ROOT, 'cmdline-tools', 'latest')
if (!existsSync(join(TOOLS, 'bin', 'sdkmanager'))) {
  mkdirSync(SDK_ROOT, { recursive: true })
  const index = fetchText('https://dl.google.com/android/repository/repository2-3.xml')
  const block = index.match(/<remotePackage path="cmdline-tools;latest">([\s\S]*?)<\/remotePackage>/)[1]
  const archives = [...block.matchAll(/<checksum[^>]*>([^<]+)<\/checksum>\s*<url>([^<]+)<\/url>/g)]
  const [, sha1, file] = archives.find(([, , url]) => url.includes('mac_arm64'))
  const zip = join(SDK_ROOT, file)
  download(`https://dl.google.com/android/repository/${file}`, zip, 'sha1', sha1)
  run('unzip', ['-q', zip, '-d', SDK_ROOT]) // → android_sdk/cmdline-tools/{bin,lib,…}
  renameSync(join(SDK_ROOT, 'cmdline-tools'), join(SDK_ROOT, 'cmdline-tools-tmp'))
  mkdirSync(join(SDK_ROOT, 'cmdline-tools'))
  renameSync(join(SDK_ROOT, 'cmdline-tools-tmp'), TOOLS)
  rmSync(zip)
}
console.log('Android SDK:', SDK_ROOT)

// 3. Config shared with the bubblewrap CLI and @bubblewrap/core.
writeFileSync(join(ROOT, 'config.json'), JSON.stringify({ jdkPath, androidSdkPath: SDK_ROOT }, null, 2) + '\n')

// 4. Licences (authorised by José). The packages come with the first Gradle build (see the top).
const env = { ...process.env, JAVA_HOME: join(jdkPath, 'Contents', 'Home'), ANDROID_HOME: SDK_ROOT }
const sdkmanager = join(TOOLS, 'bin', 'sdkmanager')
run('/bin/sh', ['-c', `yes | "${sdkmanager}" --licenses --sdk_root="${SDK_ROOT}" > /dev/null`], { env })
console.log('ready: JDK, command-line tools, licences accepted')
