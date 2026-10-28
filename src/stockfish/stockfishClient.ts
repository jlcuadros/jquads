/**
 * Stockfish in the browser via lila-stockfish-web (the WASM builds Lichess uses).
 *
 * Two variants, to compare on the iPhone:
 *   - 'sf17'  : Stockfish 17 + NNUE nets (big 74.9 MB + small 3.5 MB, downloaded once
 *               and cached). Same build as maiachess.com.
 *   - 'sfhce' : Stockfish with the classical hand-crafted evaluation: no NNUE,
 *               nothing extra to download, much less memory, weaker.
 *
 * Both builds are multi-threaded and REQUIRE SharedArrayBuffer, i.e. the page must be
 * cross-origin isolated (COOP/COEP headers, see vite.config.ts and public/_headers).
 *
 * The engine speaks UCI: we send text commands and parse the "info ..." lines.
 */
import { fetchCached } from '../lib/cache'

export type StockfishVariant = 'sf17' | 'sfhce'

/** NNUE nets for sf17, pinned in the maiachess repo (CORS + CORP headers OK). */
const NNUE_BASE_URL =
  'https://raw.githubusercontent.com/CSSLab/maia-platform-frontend/e23a50e/public/stockfish'

const MODULE_FILE: Record<StockfishVariant, string> = {
  sf17: 'sf17-79.js',
  sfhce: 'sfhce.js',
}

/** Minimal typing of the lila-stockfish-web instance (see its stockfishWeb.d.ts). */
interface StockfishWeb {
  uci(command: string): void
  listen: (line: string) => void
  onError: (msg: string) => void
  setNnueBuffer(data: Uint8Array, index?: number): void
  getRecommendedNnue(index?: number): string
}

/** One principal variation from MultiPV. */
export interface EngineLine {
  multipv: number // 1 = best
  depth: number
  scoreCp?: number // centipawns from WHITE's point of view
  mate?: number // moves to mate from WHITE's point of view (+ = white mates)
  pv: string[] // UCI moves
}

/**
 * Shared WebAssembly memory for the engine threads. Tries a large maximum and
 * shrinks it if the browser refuses (low-memory devices), as Lichess does.
 */
function sharedWasmMemory(initialPages: number, maxPages = 32767): WebAssembly.Memory {
  for (;;) {
    try {
      return new WebAssembly.Memory({ shared: true, initial: initialPages, maximum: maxPages })
    } catch (e) {
      if (maxPages <= initialPages || !(e instanceof RangeError)) throw e
      maxPages = Math.max(initialPages, Math.floor(maxPages * 0.75))
    }
  }
}

export class StockfishClient {
  private engine: StockfishWeb | null = null
  private lineHandler: (line: string) => void = () => {}

  /** Loads the WASM module (+ NNUE nets for sf17) and runs the UCI handshake. */
  async init(
    variant: StockfishVariant,
    threads: number,
    hashMb: number,
    onProgress?: (fraction: number) => void,
  ): Promise<{ ms: number; nnueFromCache?: boolean }> {
    const t0 = performance.now()
    const url = `${location.origin}/vendor/stockfish/${MODULE_FILE[variant]}`
    // Loaded at runtime from public/vendor (not bundled): the Emscripten loader
    // finds its .wasm and spawns its threads relative to its own URL.
    const factory = (await import(/* @vite-ignore */ url)).default
    const engine: StockfishWeb = await factory({
      wasmMemory: sharedWasmMemory(2560),
      locateFile: (name: string) => `${location.origin}/vendor/stockfish/${name}`,
    })
    engine.listen = (line) => this.lineHandler(line)
    engine.onError = (msg) => console.error('stockfish:', msg)

    let nnueFromCache: boolean | undefined
    if (variant === 'sf17') {
      // index 0 = big net, 1 = small net; both downloaded in parallel.
      const names = [engine.getRecommendedNnue(0), engine.getRecommendedNnue(1)]
      const progress = [0, 0]
      const files = await Promise.all(
        names.map((name, i) =>
          fetchCached(`${NNUE_BASE_URL}/${name}`, (f) => {
            progress[i] = f
            onProgress?.((progress[0] * 74.9 + progress[1] * 3.5) / 78.4) // weighted by size
          }),
        ),
      )
      files.forEach((f, i) => engine.setNnueBuffer(new Uint8Array(f.data), i))
      nnueFromCache = files.every((f) => f.fromCache)
    }

    this.engine = engine
    await this.send('uci', (l) => l === 'uciok')
    engine.uci(`setoption name Threads value ${threads}`)
    engine.uci(`setoption name Hash value ${hashMb}`)
    await this.send('isready', (l) => l === 'readyok')
    return { ms: performance.now() - t0, nnueFromCache }
  }

  /** Sends a command and resolves when a line satisfies `until`. */
  private send(command: string, until: (line: string) => boolean): Promise<void> {
    return new Promise((resolve) => {
      this.lineHandler = (line) => {
        if (until(line)) resolve()
      }
      this.engine!.uci(command)
    })
  }

  /**
   * Analyses `fen` to `depth` with `multiPv` lines. `onUpdate` is called with
   * the current lines every time the engine reports progress.
   *
   * Searches are serialised: a new call waits until the previous one has
   * finished (call `stop()` first to cut it short). With `searchMoves`, only
   * those moves are searched (used to evaluate Maia's candidates that are not
   * among Stockfish's best lines).
   */
  analyse(
    fen: string,
    depth: number,
    multiPv: number,
    onUpdate?: (lines: EngineLine[]) => void,
    searchMoves?: string[],
  ): Promise<{ lines: EngineLine[]; ms: number; nodes: number }> {
    const job = this.queue.then(() => this.runSearch(fen, `depth ${depth}`, multiPv, onUpdate, searchMoves))
    this.queue = job.catch(() => undefined) // a failed job must not block the next ones
    return job
  }

  /**
   * Speed test (José, 2026-10-28): searches a typical middlegame position for
   * `ms` milliseconds with the current threads and hash, and returns the
   * nodes per second. Queued like any search (call `stop()` first to free the
   * engine). Used to show the device's speed in ⚙ and, later, to pick a
   * default depth that suits the device.
   */
  benchmark(ms = 1000): Promise<number> {
    const job = this.queue.then(async () => {
      const r = await this.runSearch(BENCH_FEN, `movetime ${ms}`, 1)
      return Math.round(r.nodes / (r.ms / 1000))
    })
    this.queue = job.catch(() => undefined)
    return job
  }

  /**
   * Sends option commands (e.g. "setoption name Hash value 64") once the
   * engine is idle (queued after any running search), then waits for readyok.
   */
  configure(commands: string[]): Promise<void> {
    const job = this.queue.then(() => {
      for (const c of commands) this.engine?.uci(c)
      return this.send('isready', (l) => l === 'readyok')
    })
    this.queue = job.catch(() => undefined)
    return job
  }

  /** Interrupts the running search (it then resolves with what it has so far). */
  stop() {
    if (this.searching) this.engine?.uci('stop')
  }

  private queue: Promise<unknown> = Promise.resolve()
  private searching = false

  /** One search; `limit` is the UCI "go" argument: "depth 18" or "movetime 1000". */
  private runSearch(
    fen: string,
    limit: string,
    multiPv: number,
    onUpdate?: (lines: EngineLine[]) => void,
    searchMoves?: string[],
  ): Promise<{ lines: EngineLine[]; ms: number; nodes: number }> {
    if (!this.engine) throw new Error('Stockfish is not loaded yet')
    const engine = this.engine
    const whiteToMove = fen.split(' ')[1] !== 'b'
    const lines: EngineLine[] = []
    let nodes = 0
    const t0 = performance.now()
    this.searching = true

    return new Promise((resolve) => {
      this.lineHandler = (line) => {
        if (line.startsWith('bestmove')) {
          this.searching = false
          resolve({ lines: lines.filter(Boolean), ms: performance.now() - t0, nodes })
          return
        }
        const parsed = parseInfo(line, whiteToMove)
        if (!parsed) return
        nodes = parsed.nodes ?? nodes
        lines[parsed.line.multipv - 1] = parsed.line
        onUpdate?.(lines.filter(Boolean))
      }
      engine.uci(`setoption name MultiPV value ${multiPv}`)
      engine.uci(`position fen ${fen}`)
      const restrict = searchMoves?.length ? ` searchmoves ${searchMoves.join(' ')}` : ''
      engine.uci(`go ${limit}${restrict}`)
    })
  }
}

/** Position of the speed test: a quiet, typical middlegame (Queen's Gambit Declined). */
const BENCH_FEN = 'r1bq1rk1/pp2bppp/2n1pn2/3p4/2PP4/2N1PN2/P3BPPP/R1BQ1RK1 w - - 0 9'

/**
 * Parses a UCI "info" line with a score and pv, e.g.
 *   info depth 18 seldepth 25 multipv 1 score cp 32 nodes 123 ... pv e2e4 e7e5
 * Scores are converted to WHITE's point of view (UCI reports side to move).
 */
export function parseInfo(line: string, whiteToMove: boolean): { line: EngineLine; nodes?: number } | null {
  if (!line.startsWith('info ') || !line.includes(' pv ') || !line.includes(' score ')) return null
  const tok = line.split(' ')
  const val = (key: string) => {
    const i = tok.indexOf(key)
    return i >= 0 ? Number(tok[i + 1]) : undefined
  }
  const sign = whiteToMove ? 1 : -1
  const scoreIdx = tok.indexOf('score')
  const kind = tok[scoreIdx + 1]
  const raw = Number(tok[scoreIdx + 2])
  return {
    nodes: val('nodes'),
    line: {
      multipv: val('multipv') ?? 1,
      depth: val('depth') ?? 0,
      scoreCp: kind === 'cp' ? raw * sign : undefined,
      mate: kind === 'mate' ? raw * sign : undefined,
      pv: tok.slice(tok.indexOf('pv') + 1),
    },
  }
}
