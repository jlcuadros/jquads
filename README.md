# Maia + Stockfish analysis (web app)

A lightweight, mobile-first chess analysis board that runs **entirely in the browser**:
**Maia** predicts the moves a human of a chosen rating would play, and **Stockfish 17**
evaluates them. It is a reduced, personal take on the analysis page of
[maiachess.com](https://www.maiachess.com), designed to be used on an iPhone.

**Live:** https://jquads.pages.dev · UI in 7 languages (es, en, fr, it, ru, de, pt).

Created by **José Luis Cuadros** — say hi on [Lichess (Ousland)](https://lichess.org/@/Ousland)
or [LinkedIn](https://www.linkedin.com/in/jose-luis-cuadros-fernandez/).

## Features
- Board with move list and variations; tap a suggested move to play it.
- **Maia-3** with selectable rating (600–2600): most human-like moves and win probability.
- **Stockfish 17** (NNUE) with configurable depth; best lines and evaluation.
- **Colour code** for every move shown (good / inaccuracy / blunder, by win probability lost
  versus Stockfish's best move) and a "Blunder Meter"-style bar.
- **Δ eval** next to Maia's moves: how much worse than Stockfish's best — "↓1.6" pawns, "↓M+3" / "↓M−6"
  (the mate comes later / sooner), "⇵−M6" / "⇵+0.4" when a mate appears, disappears or changes side
  (the same for Stockfish's mates and the endgame tables'). In the Stockfish column, Maia's % of each move.
- **Threats**: the same analysis as if the opponent were to move (orange arrow, triangles).
- Explanatory text generated from both engines (in the selected language), in paragraphs with a
  first icon (📖 book, ♙ White, ♟ Black), including a summary of the previous move (best / good /
  inaccuracy / mistake, evaluation before → after, typical or rare for the chosen rating).
- **Position editor** (full screen), FEN loading, PGN export (variations and comments), "open in Lichess".
- **Variations**: playing another move asks "new variation" or "overwrite"; ▶ asks which continuation to
  follow; 📜 shows the whole game large (variations, comments) and jumps to a tapped move. Moves in the
  list carry a mark: colour = quality, ● / ■ / ◆ = how hard the good move was to find. PGN comments are
  shown with ✏️.
- **Online endgame tables** (Lichess Syzygy, ≤ 7 pieces): exact results ("+M12" / "−M20") instead of Stockfish.
- **Your games from Lichess or Chess.com** (no login, just the username): newest first, filters by
  speed and date, favourites on the device; a game opens with the board on your side.
- **Opening book** (📖): what players rated 2300+ play on Lichess in rapid and classical games, with
  percentages and number of games; built for this app (see [docs/BOOK.md](docs/BOOK.md)).
- **Save the game on the board** in the favourites (editable PGN headers, variations kept);
  the favourites are kept as a PGN file and can be downloaded in one `.pgn`.
- Settings: Maia rating, depths, hash memory, Stockfish threads, light classic Stockfish, number of lines.
  📋 (first in the top line): FEN, position editor, new game, PGN export.

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
  ([source](https://github.com/CSSLab/maia-platform-frontend), GPL-3.0): the analysis-panel design,
  the colour code and the in-browser inference approach. The move encoding (`src/maia/encoding.ts`)
  and `src/maia/all_moves_maia3.json` are ported/copied from it (GPL-3.0, combined here under
  AGPL-3.0 as GPL-3.0 section 13 allows).
- [Maia-3](https://github.com/CSSLab/maia3) model (CSSLab, AGPL-3.0), downloaded at run time.
  Papers: [Maia-3](https://arxiv.org/abs/2605.19091) (ICLR 2026),
  [Maia-2](https://www.cs.toronto.edu/~ashton/pubs/maia2-neurips2024.pdf) (NeurIPS 2024),
  [Maia](https://arxiv.org/abs/2006.01855) (KDD 2020).
- [Stockfish](https://stockfishchess.org) (GPL-3.0) with its
  [NNUE networks](https://github.com/official-stockfish/networks) (CC0), WebAssembly build by Lichess:
  [lila-stockfish-web](https://github.com/lichess-org/lila-stockfish-web) (GPL-3.0).
- [chessground](https://github.com/lichess-org/chessground) (GPL-3.0) with the cburnett pieces
  (Colin M.L. Burnett, GPL-2.0-or-later), [chess.js](https://github.com/jhlywa/chess.js) (BSD-2),
  [onnxruntime-web](https://github.com/microsoft/onnxruntime) (MIT).
- [Lichess public API](https://lichess.org/api): a user's games and the Syzygy endgame tablebase.
- [Chess.com published-data API](https://www.chess.com/news/view/published-data-api): a user's games.
- Opening book: built for this app from games of the [Lichess database](https://database.lichess.org/)
  (CC0) — both players rated 2300+, rapid and classical; the book is CC0 too ([docs/BOOK.md](docs/BOOK.md)).
  Book lookups use the Polyglot format's Random64 numbers, taken from
  [python-chess](https://github.com/niklasf/python-chess) (GPL-3.0).

The full licence texts of the shipped components are generated into `licenses.txt`
(`scripts/third-party-licenses.mjs`), linked from ⚙ → Credits and licences.

Unofficial project, not affiliated with or endorsed by Maia Chess / the University of Toronto,
Stockfish, Lichess or Chess.com. Their names belong to their owners. Provided without any warranty.

## License
[AGPL-3.0-or-later](LICENSE). Copyright © 2026 José Luis Cuadros.
