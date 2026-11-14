// src/core.mjs — continuous-time label visibility certificate (pure ES module).
// No three.js, no DOM, no I/O, no environment reads. Node >= 20.
//
// Model (disclosed in README):
//   * every label is an axis-aligned screen rectangle moving at constant velocity:
//     p(t) = p0 + v * t, half extents `h`, depth `depth` (smaller == closer).
//   * a pair (A,B) is in conflict on the set of t where |dx(t)| < hA.x+hB.x AND
//     |dy(t)| < hA.y+hB.y.  Both are linear inequalities, so the set is an exact
//     interval (empty, or [lo,hi]) — no sampling involved.
//   * a label is occluded on the set where its CENTER lies strictly inside an
//     occluder rectangle that is strictly closer to the camera.
//   * time domain is [t0, t1], normalised to [0,1] for the shipped scenes.

// Only absolute constant in the whole core: breakpoint dedupe in timeline units.
export const BREAKPOINT_EPS = 1e-12;

const CLOSE = 1e-12;

function absLessInterval(a, b, w, t0, t1) {
  // { t in [t0,t1] : |a + b t| < w }  ->  {lo,hi} | null
  if (!(w > 0)) return null;
  if (Math.abs(b) <= CLOSE) {
    if (!(Math.abs(a) < w)) return null;
    return { lo: t0, hi: t1 };
  }
  const r1 = (w - a) / b;
  const r2 = (-w - a) / b;
  const lo = Math.min(r1, r2);
  const hi = Math.max(r1, r2);
  const L = Math.max(lo, t0);
  const H = Math.min(hi, t1);
  if (!(L < H)) return null;
  return { lo: L, hi: H };
}

function cut(x, y) {
  if (!x || !y) return null;
  const lo = Math.max(x.lo, y.lo);
  const hi = Math.min(x.hi, y.hi);
  return lo < hi ? { lo, hi } : null;
}

export function mergeRanges(ranges) {
  const ws = ranges
    .filter((w) => w.hi > w.lo)
    .map((w) => ({ lo: w.lo, hi: w.hi }))
    .sort((a, b) => a.lo - b.lo || a.hi - b.hi);
  const out = [];
  for (const w of ws) {
    const last = out[out.length - 1];
    if (last && w.lo <= last.hi) last.hi = Math.max(last.hi, w.hi);
    else out.push(w);
  }
  return out;
}

/** Strict point predicate, written independently of the interval solver. */
export function conflictsAt(scene, t) {
  const labels = scene.labels;
  const occ = scene.occluders || [];
  const hits = [];
  for (let i = 0; i < labels.length; i++) {
    const A = labels[i];
    const ax = A.p[0] + A.v[0] * t;
    const ay = A.p[1] + A.v[1] * t;
    for (let j = i + 1; j < labels.length; j++) {
      const B = labels[j];
      const dx = ax - (B.p[0] + B.v[0] * t);
      const dy = ay - (B.p[1] + B.v[1] * t);
      if (Math.abs(dx) < A.h[0] + B.h[0] && Math.abs(dy) < A.h[1] + B.h[1]) {
        hits.push({ kind: "overlap", a: A.id, b: B.id });
      }
    }
    for (const O of occ) {
      if (!(O.depth < A.depth - CLOSE)) continue;
      const ox = O.p[0] + O.v[0] * t;
      const oy = O.p[1] + O.v[1] * t;
      if (Math.abs(ax - ox) < O.h[0] && Math.abs(ay - oy) < O.h[1]) {
        hits.push({ kind: "occlusion", label: A.id, occluder: O.id });
      }
    }
  }
  return hits;
}

export function analyzeScene(scene) {
  const t0 = scene.t0 ?? 0;
  const t1 = scene.t1 ?? 1;
  const labels = scene.labels;
  const occ = scene.occluders || [];
  const violations = [];
  let pairChecks = 0;
  let occChecks = 0;

  for (let i = 0; i < labels.length; i++) {
    const A = labels[i];
    for (let j = i + 1; j < labels.length; j++) {
      const B = labels[j];
      pairChecks++;
      const wx = absLessInterval(A.p[0] - B.p[0], A.v[0] - B.v[0], A.h[0] + B.h[0], t0, t1);
      if (!wx) continue;
      const wy = absLessInterval(A.p[1] - B.p[1], A.v[1] - B.v[1], A.h[1] + B.h[1], t0, t1);
      const w = cut(wx, wy);
      if (w) violations.push({ kind: "overlap", a: A.id, b: B.id, ...w });
    }
  }
  for (const L of labels) {
    for (const O of occ) {
      if (!(O.depth < L.depth - CLOSE)) continue;
      occChecks++;
      const wx = absLessInterval(L.p[0] - O.p[0], L.v[0] - O.v[0], O.h[0], t0, t1);
      if (!wx) continue;
      const wy = absLessInterval(L.p[1] - O.p[1], L.v[1] - O.v[1], O.h[1], t0, t1);
      const w = cut(wx, wy);
      if (w) violations.push({ kind: "occlusion", label: L.id, occluder: O.id, ...w });
    }
  }
  violations.sort((x, y) => x.lo - y.lo || x.hi - y.hi);
  const forbidden = mergeRanges(violations);
  const forbiddenFraction =
    forbidden.reduce((s, w) => s + (w.hi - w.lo), 0) / Math.max(t1 - t0, CLOSE);
  const widths = violations.map((v) => v.hi - v.lo);
  const hitLabels = new Set();
  for (const v of violations) {
    if (v.a) hitLabels.add(v.a);
    if (v.b) hitLabels.add(v.b);
    if (v.label) hitLabels.add(v.label);
  }
  return {
    sceneId: scene.id,
    t0,
    t1,
    labelCount: labels.length,
    occluderCount: occ.length,
    pairChecks,
    occChecks,
    violations,
    forbidden,
    forbiddenFraction,
    cleanLabels: labels.filter((l) => !hitLabels.has(l.id)).map((l) => l.id),
    minWindow: widths.length ? Math.min(...widths) : 0,
    maxWindow: widths.length ? Math.max(...widths) : 0,
  };
}

function pc(x) {
  let c = 0;
  while (x) {
    x &= x - 1;
    c++;
  }
  return c;
}

function uniqueSorted(xs) {
  const s = xs.slice().sort((a, b) => a - b);
  const out = [];
  for (const x of s) if (!out.length || x - out[out.length - 1] > BREAKPOINT_EPS) out.push(x);
  return out;
}

/** Splits [t0,t1] at every conflict-range endpoint: each cell has a constant conflict set. */
export function conflictCells(scene, report) {
  const t0 = scene.t0 ?? 0;
  const t1 = scene.t1 ?? 1;
  const ids = scene.labels.map((l) => l.id);
  const bit = new Map(ids.map((id, i) => [id, 1 << i]));
  const bps = uniqueSorted([t0, t1, ...report.violations.flatMap((v) => [v.lo, v.hi])]);
  const cells = [];
  for (let k = 0; k + 1 < bps.length; k++) {
    const lo = bps[k];
    const hi = bps[k + 1];
    if (!(hi > lo + BREAKPOINT_EPS)) continue;
    const mid = (lo + hi) / 2;
    let forced = 0;
    const edges = new Set();
    for (const v of report.violations) {
      if (!(v.lo <= mid && mid <= v.hi)) continue;
      if (v.kind === "occlusion") forced |= bit.get(v.label);
      else edges.add(bit.get(v.a) | bit.get(v.b));
    }
    cells.push({ lo, hi, mid, forced, edges: [...edges] });
  }
  return cells;
}

/**
 * Exact minimum total hidden time: per elementary cell a minimum vertex cover of
 * the active conflict graph (occluded labels are forced in). Cost is additive over
 * cells, so the per-cell minima sum to a matching lower bound -> optimum.
 */
export function solveSuppression(scene, report) {
  const n = scene.labels.length;
  const full = (1 << n) - 1;
  const cells = conflictCells(scene, report);
  let total = 0;
  for (const c of cells) {
    const free = full & ~c.forced;
    let best = -1;
    let bestSize = Infinity;
    for (let s = free; ; s = (s - 1) & free) {
      const mask = c.forced | s;
      const size = pc(mask);
      if (size < bestSize || (size === bestSize && mask < best)) {
        let ok = true;
        for (const e of c.edges) {
          if ((mask & e) === 0) {
            ok = false;
            break;
          }
        }
        if (ok) {
          best = mask;
          bestSize = size;
        }
      }
      if (s === 0) break;
    }
    if (best < 0) throw new Error(`cell ${c.lo}..${c.hi} has no valid cover`);
    c.cover = best;
    c.size = bestSize;
    total += (c.hi - c.lo) * bestSize;
  }
  const ids = scene.labels.map((l) => l.id);
  const perLabel = {};
  for (let i = 0; i < n; i++) {
    const ivs = [];
    for (const c of cells) {
      if (!(c.cover & (1 << i))) continue;
      const last = ivs[ivs.length - 1];
      if (last && Math.abs(last.hi - c.lo) < 1e-12) last.hi = c.hi;
      else ivs.push({ lo: c.lo, hi: c.hi });
    }
    perLabel[ids[i]] = ivs;
  }
  const span = (scene.t1 ?? 1) - (scene.t0 ?? 0);
  return {
    sceneId: scene.id,
    cells,
    perLabel,
    totalHidden: total,
    hiddenFraction: total / span,
    maxSimultaneousHidden: Math.max(0, ...cells.map((c) => c.size)),
    lowerBound: total,
    optimumProven: true,
  };
}

export function hiddenMaskAt(plan, scene, t) {
  const cell = plan.cells.find((c) => t < c.hi) || plan.cells[plan.cells.length - 1];
  if (!cell) return 0;
  return cell.cover;
}

/** Conflicts remaining at t once the plan's hidden labels are removed. */
export function conflictsAfterSuppression(scene, plan, t) {
  const hidden = new Set();
  const cell = plan.cells.find((c) => t < c.hi) || plan.cells[plan.cells.length - 1];
  if (!cell) return conflictsAt(scene, t);
  scene.labels.forEach((l, i) => {
    if (cell.cover & (1 << i)) hidden.add(l.id);
  });
  return conflictsAt(scene, t).filter((h) => !hidden.has(h.a) && !hidden.has(h.b) && !hidden.has(h.label));
}

/** Uniform spatial scaling; time and depth are untouched. */
export function scaleScene(scene, s) {
  const sp = (p) => [p[0] * s, p[1] * s];
  return {
    ...scene,
    labels: scene.labels.map((l) => ({ ...l, p: sp(l.p), v: sp(l.v), h: sp(l.h) })),
    occluders: (scene.occluders || []).map((o) => ({ ...o, p: sp(o.p), v: sp(o.v), h: sp(o.h) })),
  };
}
