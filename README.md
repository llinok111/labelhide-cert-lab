# labeltime-cert-lab

**Promise: for 6 animated label scenes (81 labels, constant-velocity 2D rectangles + 5 occluders each),
exactly locate all 33 continuous-time conflict windows (19 overlap + 14 occlusion) by solving linear
inequalities — **not** by sampling — and emit the minimum total hide-time schedule that leaves **0 of
721 conflicting frames** dirty. Exact pipeline: **0.2501 ms** for all six scenes (sum of medians) vs
**79.659 ms** for the in-repo 10,000-sample baseline (`baseline/naive.mjs`), i.e. **318×**, while that
baseline misses **21 / 33** windows, including **6 / 6** windows narrower than 1e-4 (min 2.0e-5).**

Upstream: none

## What this is

`src/core.mjs` treats each label as a rectangle `p(t) = p0 + v·t` and each pair check as the
intersection of two *linear* inequalities `|dx(t)| < Wx`, `|dy(t)| < Wy`. That intersection is an exact
interval, so the tool reports the true conflict windows `[lo,hi]` rather than an approximate scan.
Occlusion is exact too: a label is occluded where its centre lies strictly inside a strictly closer
rectangle.

On top of the windows, `solveSuppression` splits `[t0,t1]` at every window endpoint (59 elementary
cells), builds the conflict graph active in each cell (occluded labels are forced into the cover), and
enumerates bitmasks for a **minimum vertex cover per cell**. Because cost is additive over cells, the
per-cell minima sum to a matching lower bound — the reported hide-time is the optimum, not a heuristic.
In the browser the same core file draws the plan and prints, per frame, `conflicts after suppression`
(0 for every certified frame).

## How to run

```bash
node tools/gen-sample.mjs     # writes the 6 deterministic scenes into data/
node bench/verify.mjs         # 32 assertions, prints every measured value, exit 0
node bench/bench.mjs          # warmup + 7 repeats, cold start, writes bench/result.json
python3 -m http.server 4173   # then open http://localhost:4173 (single-file three.js via importmap)
```

Node v24.19.0 was used. `data/` is regenerated deterministically (`--check` reports `drifted=0`).

## Evidence (`bench/result.json`, committed run)

| metric | value | baseline / oracle |
| --- | --- | --- |
| scenes / labels / occluders | 6 / 81 / 30 | — |
| exact conflict windows | 33 (19 overlap, 14 occlusion) | 10k-sample baseline finds 12 runs → misses 21 |
| narrow windows missed by baseline | 6 (< 1e-4, min 2.0e-5) | 10k grid step is 1e-4, so all 6 are invisible to it |
| exact pipeline, all 6 scenes | 0.2501 ms (sum of medians) | naive 10k sampling: 79.659 ms median → **318×** |
| per-scene exact pipeline | 0.0267 – 0.0620 ms median | cold start 0.64 – 4.21 ms |
| elementary cells / optimal hide-time | 59 / 4.8301 label·time | average 0.805 labels hidden at any t, peak 4 |
| constant-free recompute (`bench/oracle.mjs`) | 120,006 samples, 0 unlisted, 0 remaining | 33/33 window midpoints re-witnessed |
| 240-frame grid | 721 conflicting frames → 0 after the plan | fixed-rate playback would show 108–143 bad frames per scene |
| scale invariance, 1e-6 … 1e6 | max time drift 1.0e-15, window count identical | space-only scaling; time domain untouched |

`bench/bench.mjs` reports `analyzeScene` and `solveSuppression` separately, with `min/median/p95/max/stddev`
over 7 repetitions after one warmup, plus cold start. All relStddev values for the exact pipeline are well
below 0.1; the **naive baseline** series is at 0.1104 (median 79.659 ms, p95 106.318 ms) because one batch
hit host scheduling noise — that is disclosed rather than smoothed away.

## 本轮创新

**Occlusion-aware minimum hide-time scheduling with a proven optimum (B档).** The night repo
`llinok111/labeltime-cert-lab` also computes closed-form overlap intervals, but its repair is an
explicitly *non-minimal* monotone `+y` stacking pass, its scenes are overlap-only, and it reports no
optimality bound. Here: (a) the conflict set includes **occlusion** (label centre inside a strictly
closer rectangle, 14 such windows; occluders cannot move, so those labels are forced into the cover);
(b) the repair is a 0/1 optimisation per elementary time cell — minimum vertex cover of the active
graph — so the per-cell minima sum to a lower bound the emitted plan attains exactly (59 cells,
4.8301 label·time, average 0.805 labels hidden at any `t`); (c) it is cross-checked by an oracle
sharing no constant with the solver (120,006 samples, 0 misses, 0 residue) and by a 10k-sample
baseline that misses 21/33 windows; (d) results are invariant over 12 decades of spatial scale, 0/721
dirty frames. Ledger: `labelcast-lab` static layout, `toi-cert-lab` one triangle pair — no
occlusion-aware optimal scheduling precedent.

## Known limitations

- **Absolute constant:** the only absolute number in the core is `BREAKPOINT_EPS = 1e-12` (timeline
  units), used to dedupe elementary-cell breakpoints. Conflict predicates themselves contain **no**
  tolerance, and the vertex-cover cost is integer, so window widths down to 2e-5 are reported, never
  rounded away. Valid for a normalised `[0,1]` timeline; rescaling the *time* domain by S makes the
  effective margin 1e-12·S. The 5-decade scale test above is **spatial only**.
- **Linear motion only.** `p(t)` must be affine. Quadratic paths would need the interval algebra
  rewritten (each axis becomes a quadratic sub-level set).
- **Occlusion = centre-in-rectangle.** Partial occlusion (a label corner peeking out) is not counted;
  occluder geometry cannot be hidden, so occluded labels are forced into the cover. Labels do not
  rotate and there is no frustum culling.
- **Exhaustive cover is exact only while a cell's free-label count is small** (bitmask enumeration;
  12–15 labels here means ≤ 8192 subsets per cell). Larger scenes need a real vertex-cover solver.
- **The hide-time optimum is discrete:** a label is hidden or drawn for a whole elementary cell. Partial
  alpha ramps are not modelled.
- Scene data is synthetic (deterministic generator, fixed seeds), not captured from a production app.

## Licence

MIT, © 2026 llinok111.
