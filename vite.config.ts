import { defineConfig, type Connect, type Plugin } from 'vite'

// Cross-origin isolation headers: required for SharedArrayBuffer, which both
// multi-threaded Stockfish and multi-threaded onnxruntime need.
// The same headers are set in production by public/_headers (Cloudflare Pages).
const isolationHeaders: Record<string, string> = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
}

/**
 * Adds the isolation headers to EVERY response, including "304 Not Modified".
 * Vite's own `server.headers` option omits them on 304s, and WebKit (Safari)
 * then refuses to start Stockfish's worker threads ("Worker load was blocked by
 * Cross-Origin-Embedder-Policy"). See the task note, Investigation 2.
 */
function crossOriginIsolation(): Plugin {
  const middleware: Connect.NextHandleFunction = (_req, res, next) => {
    for (const [name, value] of Object.entries(isolationHeaders)) res.setHeader(name, value)
    next()
  }
  return {
    name: 'cross-origin-isolation',
    configureServer: (server) => void server.middlewares.use(middleware),
    configurePreviewServer: (server) => void server.middlewares.use(middleware),
  }
}

export default defineConfig({
  plugins: [crossOriginIsolation()],
  // Allow temporary https tunnels (cloudflared quick tunnels) used to test on the
  // iPhone: Vite rejects unknown Host headers with 403 by default.
  server: { allowedHosts: ['.trycloudflare.com'] },
  preview: { allowedHosts: ['.trycloudflare.com'] },
  worker: { format: 'es' },
  // Two pages: the app (index.html) and the engine diagnostics page (proto.html).
  build: { rollupOptions: { input: { main: 'index.html', proto: 'proto.html' } } },
  // onnxruntime-web ships its own wasm loader; don't let Vite pre-bundle it.
  optimizeDeps: { exclude: ['onnxruntime-web'] },
})