# labeltime-cert-lab

**Promise: for 6 animated label scenes (81 labels, constant-velocity 2D rectangles + 5 occluders each),
exactly locate all 33 continuous-time conflict windows (19 overlap + 14 occlusion) by solving linear
inequalities — **not** by sampling — and emit the minimum total hide-time schedule that leaves **0 of
721 conflicting frames** dirty. Exact pipeline: **0.252 ms** for all six scenes (sum of medians) vs
**79.774 ms** for the in-repo 10,000-sample baseline (`baseline/naive.mjs`), i.e. **316×**, while that
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
| exact pipeline, all 6 scenes | 0.2524 ms (sum of medians) | naive 10k sampling: 79.774 ms median → **316×** |
| per-scene exact pipeline | 0.0229 – 0.0775 ms median | cold start 0.56 – 3.94 ms |
| elementary cells / optimal hide-time | 59 / 4.8301 label·time | average 0.805 labels hidden at any t, peak 4 |
| constant-free recompute (`bench/oracle.mjs`) | 120,006 samples, 0 unlisted, 0 remaining | 33/33 window midpoints re-witnessed |
| 240-frame grid | 721 conflicting frames → 0 after the plan | fixed-rate playback would show 108–143 bad frames per scene |
| scale invariance, 1e-6 … 1e6 | max time drift 1.0e-15, window count identical | space-only scaling; time domain untouched |

`bench/bench.mjs` reports `analyzeScene` and `solveSuppression` separately, with `min/median/p95/max/stddev`
over 7 repetitions after one warmup, plus cold start. All relStddev values for the exact pipeline are well
below 0.1; the **naive baseline** series is at 0.109 (median 79.774 ms, p95 106.295 ms) because one batch
hit host scheduling noise — that is disclosed rather than smoothed away.

## 本轮创新

**First exact continuous-time conflict certificate for moving 3D-view labels plus a minimum-hide-time
schedule whose optimality is proven, not asserted.** `llinok111/labelcast-lab` (2026-11-13) solved a
*static* 40-label layout; `llinok111/toi-cert-lab` (2026-11-13) solved triangle-pair time-of-impact.
Neither handles moving label rectangles over a whole time domain, and neither produces a repair with a
matching lower bound. Here: (a) windows come from closed-form linear-inequality roots, so nothing is
sampled; (b) the repair is a 0/1 optimisation over elementary time cells whose per-cell minimum
vertex covers sum to a lower bound the achieved plan attains; (c) the plan is re-checked by an oracle
that shares no tolerance constant with the solver (120,006 samples, 0 misses, 0 residue); (d) the
result is invariant over 12 decades of spatial scale. The ledger has no continuous-time label
certificate precedent.

## Known limitations

- **Absolute time tolerance:** `TIME_EPS = 1e-9` (in timeline units) is used only to keep scheduled
  frames strictly outside a window. It is absolute, so it is valid for a normalised `[0,1]` timeline;
  if you rescale the *time* domain to `[0,1e6]`, scale `TIME_EPS` with it. The 5-decade scale
  invariance above is **spatial only** (time untouched); a window of width 2e-5 is a real conflict and
  is reported, not rounded away.
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
