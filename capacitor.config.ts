/**
 * Capacitor: the iOS app of jquads (App Store release, 2026-10-30; task_03.1 → ios).
 * The iOS app ships the same built website (dist/) inside a native shell.
 * Bundle id com.jlcuadros.jquads: permanent once published (José's GitHub name, not his e-mail).
 */
import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.jlcuadros.jquads',
  appName: 'jquads',
  webDir: 'dist',
  ios: {
    // The page needs cross-origin isolation (SharedArrayBuffer for Stockfish's threads):
    // the COOP/COEP headers are added by a patch to Capacitor's WebViewAssetHandler (patches/).
    contentInset: 'never',
  },
}

export default config
