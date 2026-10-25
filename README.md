# Maia + Stockfish analysis (web app)

A lightweight, mobile-first chess analysis board that runs **entirely in the browser**:
**Maia** predicts the moves a human of a chosen rating would play, and **Stockfish 17**
evaluates them. It is a reduced, personal take on the analysis page of
[maiachess.com](https://www.maiachess.com), designed to be used on an iPhone.

**Live:** https://jquads.pages.dev · UI in Spanish.

Created by **José Luis Cuadros** — say hi on [Lichess (Ousland)](https://lichess.org/@/Ousland)
or [LinkedIn](https://www.linkedin.com/in/jose-luis-cuadros-fernandez/).

## Features
- Board with move list and variations; tap a suggested move to play it.
- **Maia-3** with selectable rating (600–2600): most human-like moves and win probability.
- **Stockfish 17** (NNUE) with configurable depth; best lines and evaluation.
- **Colour code** for every move shown (good / inaccuracy / blunder, by win probability lost
  versus Stockfish's best move) and a "Blunder Meter"-style bar.
- **Threats**: the same analysis as if the opponent were to move (orange arrow, triangles).
- Explanatory text (Spanish) generated from both engines.
- **Position editor** (full screen), FEN loading, "open in Lichess".
- Settings: Maia rating, depths, hash memory, light classic Stockfish, number of lines.

## How it works
No server: Maia-3 runs as an ONNX model with `onnxruntime-web` in a Web Worker and Stockfish
is the WebAssembly build used by Lichess (`lila-stockfish-web`). Both are multi-threaded, so
the page must be *cross-origin isolated* (COOP/COEP headers, see `public/_headers` and
`vite.config.ts`). Model weights (~125 MB) are downloaded once from GitHub and cached in
IndexedDB. Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Development
Requires Node.js (developed with Node 26).

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests (vitest)
npm run build      # production build in dist/
npm run preview    # serve dist/ at http://localhost:4173
npm run deploy     # publish to Cloudflare Pages (author's project)
```
Browser end-to-end tests (Playwright, WebKit emulating an iPhone) are described in
[docs/SCRIPTS.md](docs/SCRIPTS.md).

`docs/` is generated from the author's private notes with `node scripts/export-docs.mjs`.

## Credits
- [Maia Chess](https://www.maiachess.com) by the CSSLab, University of Toronto
  ([source](https://github.com/CSSLab/maia-platform-frontend), GPL-3.0): the Maia-3 model,
  the analysis-panel design, the colour code and the in-browser inference approach.
  The move encoding (`src/maia/encoding.ts`) and `src/maia/all_moves_maia3.json` are ported/copied
  from it. Papers: [Maia-3](https://arxiv.org/abs/2605.19091) (ICLR 2026),
  [Maia-2](https://www.cs.toronto.edu/~ashton/pubs/maia2-neurips2024.pdf) (NeurIPS 2024),
  [Maia](https://arxiv.org/abs/2006.01855) (KDD 2020).
- [Stockfish](https://stockfishchess.org) (GPL-3.0), WebAssembly build by Lichess:
  [lila-stockfish-web](https://github.com/lichess-org/lila-stockfish-web) (AGPL-3.0).
- [chessground](https://github.com/lichess-org/chessground) (GPL-3.0),
  [chess.js](https://github.com/jhlywa/chess.js) (BSD-2),
  [onnxruntime-web](https://github.com/microsoft/onnxruntime) (MIT).

Unofficial project, not affiliated with Maia Chess, Stockfish or Lichess.

## License
[AGPL-3.0-or-later](LICENSE). Copyright © 2026 José Luis Cuadros.
