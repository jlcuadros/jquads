#!/usr/bin/env python3
"""
Builds the app's opening book: a Polyglot .bin made from human games played on
Lichess (José, iteration 6, 2026-10-26).

Which games
  - rated, standard chess, starting from the initial position;
  - BOTH players rated >= --min-elo (2300);
  - rapid or classical only: Lichess's own speed rule, estimated duration =
    base + 40 x increment (seconds); < 3 min bullet, < 8 min blitz, so we keep
    games with an estimated duration >= 480 s.

What goes into the book (common practice for statistics books, agreed with José)
  - only the first --max-ply half-moves of each game (30 = 15 moves per side);
  - a position is included only if at least --min-position-games games (12)
    reached it: with fewer there is no statistic, just anecdotes. Where the
    book ends, the app simply shows no book. (Agreed value 25, lowered to 12
    so the book reaches José's 5–8 MB: 25 → 3.4 MB, 20 → 3.9, 15 → 4.8,
    12 → 5.5, 10 → 6.2 MB with the 1.13 M games available, 2026-10-26.)
  - in an included position, a move is kept only if at least --min-move-games
    games (3) played it (a single game is noise, e.g. a mouse slip);
  - no quality filter: the book says what strong humans play; the app's
    Stockfish colours say how good it is.

Polyglot format (16 bytes per entry, big-endian, sorted by key)
  key (u64, python-chess's zobrist_hash = the Polyglot key), move (u16),
  weight (u16), learn (u32).
  - weight = the move's share of the position's games, scaled to 1..65535, so
    any Polyglot reader picks moves by how often humans play them;
  - learn = the number of games that played the move (the app shows it).

Input: Lichess game files (.pgn, or .zip containing .pgn), given as arguments.
Lichess's game database is CC0 (public domain), and so is this book.

Usage (from app/, Python 3.9+ with the packages in requirements.txt):
  python3 -m venv .venv-book && .venv-book/bin/pip install -r scripts/book/requirements.txt
  .venv-book/bin/python scripts/book/build_book.py --cache /tmp/book-cache \\
      --out public/book/lichess-2300-slow.bin  games/*.zip
The per-file results are cached (--cache), so changing only the thresholds
re-runs in seconds. A JSON file next to the book records how it was built.
"""
import argparse
import hashlib
import io
import json
import os
import re
import struct
import sys
import time
import zipfile
from datetime import datetime, timezone
from multiprocessing import Pool

import chess
import chess.polyglot
import numpy as np

BULLET_BLITZ_LIMIT_S = 480  # Lichess: rapid starts at an estimated 8 minutes
CACHE_VERSION = 1  # bump when what a cache file contains changes

# Movetext tokens that are not moves: {comments}, move numbers, NAGs, results.
NON_MOVES = re.compile(r"\{[^}]*\}|\d+\.+|\$\d+|1-0|0-1|1/2-1/2|\*")
HEADER = re.compile(r'\[(\w+) "(.*)"\]')


# ---------------------------------------------------------------------------
# Reading games
# ---------------------------------------------------------------------------

def open_text(path):
    """Text stream of a .pgn, or of the single .pgn inside a .zip (streamed, not extracted)."""
    if path.endswith(".zip"):
        z = zipfile.ZipFile(path)
        names = [n for n in z.namelist() if n.endswith(".pgn")]
        if len(names) != 1:
            raise ValueError(f"{path}: expected one .pgn inside, found {names}")
        return io.TextIOWrapper(z.open(names[0]), encoding="utf-8", errors="replace")
    return open(path, encoding="utf-8", errors="replace")


def games(stream):
    """Yields (headers dict, movetext) for every game of a PGN stream."""
    headers, moves = {}, []
    for line in stream:
        if line.startswith("["):
            if moves:
                yield headers, " ".join(moves)
                headers, moves = {}, []
            m = HEADER.match(line)
            if m:
                headers[m.group(1)] = m.group(2)
        elif line.strip():
            moves.append(line.strip())
    if moves:
        yield headers, " ".join(moves)


def speed(time_control):
    """Lichess speed of a "base+increment" time control (seconds): bullet, blitz, rapid, classical or None."""
    try:
        base, inc = time_control.split("+")
        est = int(base) + 40 * int(inc)
    except ValueError:
        return None  # "-" = correspondence / unlimited
    if est < 180:
        return "bullet"
    if est < BULLET_BLITZ_LIMIT_S:
        return "blitz"
    return "rapid" if est < 1500 else "classical"


def accepted(h, min_elo):
    """The game filter (see the module docstring). Returns its speed, or None if rejected."""
    if "Rated" not in h.get("Event", "") or h.get("Variant", "Standard") != "Standard" or "FEN" in h:
        return None
    try:
        if min(int(h.get("WhiteElo", "0")), int(h.get("BlackElo", "0"))) < min_elo:
            return None
    except ValueError:
        return None  # unrated / "?"
    s = speed(h.get("TimeControl", "-"))
    return s if s in ("rapid", "classical") else None


# ---------------------------------------------------------------------------
# Polyglot encoding
# ---------------------------------------------------------------------------

def polyglot_move(board, move):
    """
    Move as Polyglot's u16: to-square in bits 0-5, from-square in bits 6-11
    (square = file + 8 x rank, as python-chess), promotion piece in bits 12-14
    (1 knight .. 4 queen). Castling is written as "king takes own rook"
    (e1h1, e1a1…), as Polyglot requires.
    """
    to = move.to_square
    if board.is_castling(move):
        rank = chess.square_rank(move.from_square)
        to = chess.square(7 if chess.square_file(move.to_square) > 4 else 0, rank)
    promo = move.promotion - 1 if move.promotion else 0  # python-chess: knight = 2 … queen = 5
    return to | move.from_square << 6 | promo << 12


# ---------------------------------------------------------------------------
# Step 1 (parallel, one input file per worker): game → (position key, move) pairs
# ---------------------------------------------------------------------------

def cache_path(cache_dir, path, args):
    tag = f"v{CACHE_VERSION}-elo{args.min_elo}-ply{args.max_ply}"
    return os.path.join(cache_dir, f"{os.path.basename(path)}.{tag}.npz")


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def process_file(job):
    """Reads one input file and returns/caches its observations and counters."""
    path, cache_dir, args = job
    out = cache_path(cache_dir, path, args)
    if os.path.exists(out):
        d = np.load(out, allow_pickle=False)
        return path, json.loads(str(d["meta"]))
    t0 = time.time()
    keys, moves = [], []
    meta = {"games_read": 0, "games_used": 0, "rapid": 0, "classical": 0, "unreadable": 0}
    with open_text(path) as stream:
        for h, movetext in games(stream):
            meta["games_read"] += 1
            sp = accepted(h, args.min_elo)
            if not sp:
                continue
            meta["games_used"] += 1
            meta[sp] += 1
            board = chess.Board()
            for san in NON_MOVES.sub(" ", movetext).split()[: args.max_ply]:
                try:
                    move = board.parse_san(san)
                except ValueError:
                    meta["unreadable"] += 1
                    break
                keys.append(chess.polyglot.zobrist_hash(board))
                moves.append(polyglot_move(board, move))
                board.push(move)
    meta["observations"] = len(keys)
    meta["sha256"] = sha256(path)
    meta["seconds"] = round(time.time() - t0, 1)
    np.savez(out, keys=np.array(keys, dtype=np.uint64), moves=np.array(moves, dtype=np.uint16), meta=json.dumps(meta))
    return path, meta


# ---------------------------------------------------------------------------
# Step 2: count, filter, write the book
# ---------------------------------------------------------------------------

def build(paths, args):
    keys = np.concatenate([np.load(cache_path(args.cache, p, args))["keys"] for p in paths])
    moves = np.concatenate([np.load(cache_path(args.cache, p, args))["moves"] for p in paths])
    # Sort by (key, move) and count each distinct pair.
    order = np.lexsort((moves, keys))
    keys, moves = keys[order], moves[order]
    new_pair = np.ones(len(keys), dtype=bool)
    new_pair[1:] = (keys[1:] != keys[:-1]) | (moves[1:] != moves[:-1])
    starts = np.flatnonzero(new_pair)
    pair_keys, pair_moves = keys[starts], moves[starts]
    pair_counts = np.diff(np.append(starts, len(keys)))
    del keys, moves, order
    # Games per position = sum of its moves' counts (a game passes through once).
    new_pos = np.ones(len(pair_keys), dtype=bool)
    new_pos[1:] = pair_keys[1:] != pair_keys[:-1]
    pos_index = np.cumsum(new_pos) - 1
    pos_totals = np.bincount(pos_index, weights=pair_counts).astype(np.int64)
    totals = pos_totals[pos_index]
    keep = (totals >= args.min_position_games) & (pair_counts >= args.min_move_games)
    k, m, c, t = pair_keys[keep], pair_moves[keep], pair_counts[keep], totals[keep]
    weights = np.maximum(1, np.round(c * 65535 / t)).astype(np.uint16)
    # Polyglot order: by key, then the most played move first.
    order = np.lexsort((-c, k))
    entries = np.zeros(len(k), dtype=[("key", ">u8"), ("move", ">u2"), ("weight", ">u2"), ("learn", ">u4")])
    entries["key"], entries["move"], entries["weight"], entries["learn"] = k[order], m[order], weights[order], c[order]
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    entries.tofile(args.out)
    positions_kept = len(np.unique(k))
    return {
        "positions_seen": int(len(pos_totals)),
        "positions_in_book": int(positions_kept),
        "entries": int(len(entries)),
        "bytes": int(os.path.getsize(args.out)),
    }


def month_of(path):
    """"YYYY-MM" from an input file name (how the inputs are listed in the provenance), or the name."""
    m = re.search(r"\d{4}-\d{2}", os.path.basename(path))
    return m.group(0) if m else os.path.basename(path)


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("inputs", nargs="+", help="Lichess game files (.pgn or .zip with one .pgn)")
    p.add_argument("--out", required=True, help="output .bin (a .json with the provenance is written next to it)")
    p.add_argument("--cache", required=True, help="folder for the per-file intermediate results")
    p.add_argument("--min-elo", type=int, default=2300, help="both players at least this rating (default 2300)")
    p.add_argument("--max-ply", type=int, default=30, help="half-moves read per game (default 30)")
    p.add_argument("--min-position-games", type=int, default=12, help="games that must reach a position (default 12)")
    p.add_argument("--min-move-games", type=int, default=3, help="games that must play a move (default 3)")
    p.add_argument("--jobs", type=int, default=max(1, (os.cpu_count() or 2) - 1), help="parallel workers")
    args = p.parse_args()
    os.makedirs(args.cache, exist_ok=True)

    t0 = time.time()
    inputs = sorted(args.inputs)
    metas = {}
    with Pool(args.jobs) as pool:
        for path, meta in pool.imap_unordered(process_file, [(f, args.cache, args) for f in inputs]):
            metas[path] = meta
            print(f"{os.path.basename(path)}: {meta['games_used']:,} of {meta['games_read']:,} games ({meta['seconds']} s)", flush=True)
    stats = build(inputs, args)
    total = {k: sum(m[k] for m in metas.values()) for k in ("games_read", "games_used", "rapid", "classical", "unreadable", "observations")}
    provenance = {
        "book": os.path.basename(args.out),
        "built": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "Lichess rated games (Lichess game database, CC0)",
        "licence": "CC0-1.0",
        "games": {
            "filter": f"rated standard games from the initial position, both players rated >= {args.min_elo}, "
                      f"rapid or classical (base + 40 x increment >= {BULLET_BLITZ_LIMIT_S} s)",
            **total,
        },
        "parameters": {k: getattr(args, k) for k in ("min_elo", "max_ply", "min_position_games", "min_move_games")},
        "polyglot": "weight = share of the position's games (1..65535); learn = games that played the move",
        "book_statistics": stats,
        "inputs": [{"month": month_of(f), "sha256": metas[f]["sha256"], "games_used": metas[f]["games_used"]} for f in inputs],
        "tools": {"python": sys.version.split()[0], "python-chess": chess.__version__, "numpy": np.__version__},
        "seconds": round(time.time() - t0, 1),
    }
    with open(os.path.splitext(args.out)[0] + ".json", "w") as f:
        json.dump(provenance, f, indent=2)
    print(json.dumps({"games": total, "book": stats}, indent=2))


if __name__ == "__main__":
    main()
