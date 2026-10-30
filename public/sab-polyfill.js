/*
 * SharedArrayBuffer for the iOS app (store release, 2026-10-30; task_03.1 → ios, Investigation 1).
 *
 * Inside the iOS app (WKWebView) the page is cross-origin isolated (AppDelegate.swift adds
 * COOP/COEP) and shared memory works — new WebAssembly.Memory({ shared: true }).buffer IS a
 * SharedArrayBuffer and can be posted to workers — but the global NAME SharedArrayBuffer is not
 * defined, in the page nor in its workers, and Stockfish (Emscripten threads) uses it.
 *
 * This file restores the name from that buffer's constructor. Loaded:
 *   - by the page, first thing (<script src="/sab-polyfill.js"> in index.html);
 *   - by every module worker the page creates: when the name was missing, `Worker` is wrapped
 *     so each module worker first imports this file, then its own script (static imports run
 *     in order and the worker's messages wait until both have run).
 * Where the name exists (browsers, the Android app) it does nothing at all.
 *
 * Also, in the same places: WKWebView refuses to RESERVE very large shared memories ("RangeError:
 * Out of memory" from onnxruntime, which asks for a 4 GB maximum). Shared WebAssembly.Memory is
 * retried with half the maximum until it fits (as src/stockfish/stockfishClient.ts already does
 * for Stockfish); the memory still grows on demand up to that maximum.
 */
(function () {
  if (typeof SharedArrayBuffer !== 'undefined') return
  try {
    self.SharedArrayBuffer = new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true }).buffer.constructor
  } catch (e) {
    return // no shared memory at all: nothing to restore
  }
  var NativeMemory = WebAssembly.Memory
  WebAssembly.Memory = function (descriptor) {
    for (var d = descriptor; ; ) {
      try {
        return new NativeMemory(d)
      } catch (e) {
        var smaller = d && d.shared && d.maximum > d.initial * 2 && e instanceof RangeError
        if (!smaller) throw e
        d = Object.assign({}, d, { maximum: Math.max(d.initial, Math.floor(d.maximum / 2)) })
      }
    }
  }
  WebAssembly.Memory.prototype = NativeMemory.prototype
  if (typeof Worker === 'undefined' || typeof document === 'undefined') return // inside a worker: done
  var NativeWorker = Worker
  var polyfill = new URL('/sab-polyfill.js', location.href).href
  self.Worker = function (url, options) {
    if (!options || options.type !== 'module') return new NativeWorker(url, options)
    var script = new URL(url, location.href).href
    var shim = 'import ' + JSON.stringify(polyfill) + ';\nimport ' + JSON.stringify(script) + ';\n'
    return new NativeWorker(URL.createObjectURL(new Blob([shim], { type: 'text/javascript' })), options)
  }
  self.Worker.prototype = NativeWorker.prototype
})()
