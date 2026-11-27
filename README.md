# Diff two texts faster — fast makefun-diff drop-in

![make.fun](https://make.fun/badge/diff-speed-01-run-20261126.svg)
![Rank](https://make.fun/badge/diff-speed-01-run-20261126/mietrea519-cyber/diff-speed-01-run-20261126/rank.svg)
![Reward](https://make.fun/badge/diff-speed-01-run-20261126/mietrea519-cyber/diff-speed-01-run-20261126/reward.svg)

Entry for [Diff two texts faster, 27 November 2026](https://make.fun/c/diff-speed-01-run-20261126) — a faster drop-in for makefun-diff 1.0.0 whose `run(input)` returns exactly the same patch for every `{ old, new }`.

## How it works

`solve.js` reimplements makefun-diff's exact semantics — same line cut (after every `\n`, a last line without one is a line too), same edit script (common prefix, then common suffix, then Myers's greedy search that keeps the furthest-reaching path on each diagonal and takes the deletion when deletion and insertion reach the same point), and the same patch text (header, hunks with 3 lines of context, deletions before insertions, `%` after a line with no newline).

It is faster because the search never allocates per step: the furthest-x table is one `Int32Array` per edit depth (the value stored is the old lines consumed plus one, so 0 means unreachable), and lines are compared as integer ids instead of strings. The winning script is rebuilt by walking that table backwards. No step prunes a diagonal and no move passes either text's end, so the script found is the same one makefun-diff finds, including its tie-breaks.

## Benchmarks (practice set, 4 cases, local Node 22)

| entry | CPU, 4 cases |
|---|---|
| house baseline (makefun-diff 1.0.0) | ~1,310–1,500 ms |
| this entry | ~410–470 ms |

About **3× faster** than the baseline, with byte-identical answers on all 4 practice cases, on 364 synthetic differential-test cases (empty texts, CRLF, bare endings, swaps, moved blocks, repeated lines) and on 6 large cases drawn by the kit's own generator.

## Layout

- `main.ts` — the driver the harness runs (kept as the house baseline ships it): reads `/input/cases.json`, answers each case with `run`, writes `/output/answers.json`.
- `solve.js` — the fast diff (dependency-free ES module, no allocation per search step).
- `package.json` — `{"type": "module"}` so `solve.js` loads as ESM.
- `LICENSE` — MIT.
