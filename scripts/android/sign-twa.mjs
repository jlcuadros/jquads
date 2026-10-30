// Signs the Google Play app with José's upload key (store release, 2026-10-30; task_03.1 → android).
//
// The keystore password is NEVER written anywhere: it is read from the environment variable
// JQUADS_KEYSTORE_PASSWORD, which José sets in his own Terminal without echo:
//     read -s JQUADS_KEYSTORE_PASSWORD && export JQUADS_KEYSTORE_PASSWORD
//     node scripts/android/sign-twa.mjs
// and the tools receive it by name (jarsigner/keytool "-storepass:env", apksigner "env:"), never on a
// command line.
//
// In:  android/app/build/outputs/{bundle/release/app-release.aab, apk/release/app-release-unsigned.apk}
//      (scripts/android/build-twa.mjs); keystore path and alias from android/twa-manifest.json.
// Out: android/release/jquads-<version>.aab (for Google Play) and jquads-<version>.apk (to install on a
//      phone), plus the SHA-256 fingerprint of the upload certificate (public: it goes in
//      /.well-known/assetlinks.json so the app opens without the browser bar).
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const VAR = 'JQUADS_KEYSTORE_PASSWORD'
if (!process.env[VAR]) throw new Error(`${VAR} is not set (read -s ${VAR} && export ${VAR})`)

const manifest = JSON.parse(readFileSync('android/twa-manifest.json', 'utf8'))
const { path: keystore, alias } = manifest.signingKey
const version = manifest.appVersionName
const { jdkPath, androidSdkPath } = JSON.parse(readFileSync(join(homedir(), '.bubblewrap', 'config.json'), 'utf8'))
const bin = (tool) => join(jdkPath, 'Contents', 'Home', 'bin', tool)
const buildTools = join(androidSdkPath, 'build-tools', readdirSync(join(androidSdkPath, 'build-tools')).sort().at(-1)) // installed by Gradle
// apksigner is a shell script that runs `java`: the Mac has no system Java, so JAVA_HOME and PATH point to
// the private JDK (first try, 2026-10-30, failed at apksigner for that reason).
const javaHome = join(jdkPath, 'Contents', 'Home')
const env = { ...process.env, JAVA_HOME: javaHome, PATH: `${join(javaHome, 'bin')}:${process.env.PATH}` }
const run = (cmd, args) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'inherit'], env }).toString()

const outputs = resolve('android/app/build/outputs')
const out = resolve('android/release')
mkdirSync(out, { recursive: true })

// 1. The bundle (.aab) for Google Play: signed like a jar.
const aab = join(out, `jquads-${version}.aab`)
copyFileSync(join(outputs, 'bundle/release/app-release.aab'), aab)
run(bin('jarsigner'), ['-sigalg', 'SHA256withRSA', '-digestalg', 'SHA-256', '-keystore', keystore, `-storepass:env`, VAR, aab, alias])
run(bin('jarsigner'), ['-verify', aab])
console.log('signed:', aab)

// 2. The APK to install directly: aligned, then signed with apksigner.
const apk = join(out, `jquads-${version}.apk`)
const aligned = join(out, 'aligned.apk')
run(join(buildTools, 'zipalign'), ['-f', '-p', '4', join(outputs, 'apk/release/app-release-unsigned.apk'), aligned])
run(join(buildTools, 'apksigner'), ['sign', '--ks', keystore, '--ks-key-alias', alias, '--ks-pass', `env:${VAR}`, '--out', apk, aligned])
run(join(buildTools, 'apksigner'), ['verify', apk])
execFileSync('rm', ['-f', aligned, `${apk}.idsig`])
console.log('signed:', apk)

// 3. The upload certificate's SHA-256 fingerprint (public).
const list = run(bin('keytool'), ['-list', '-v', '-keystore', keystore, '-alias', alias, '-storepass:env', VAR])
const sha256 = list.match(/SHA256:\s*([0-9A-F:]+)/)[1]
console.log('upload certificate SHA-256:', sha256)
if (!existsSync(join(out, 'upload-cert-sha256.txt'))) execFileSync('/bin/sh', ['-c', `printf '%s\\n' "${sha256}" > "${join(out, 'upload-cert-sha256.txt')}"`])
