// bench/oracle.mjs — independent recomputation, deliberately NOT importing src/core.mjs.
// Different algorithm (uniform sampling + own point predicate + own bitmask search),
// and it shares no tolerance constant with the main implementation.
export const ORACLE_SAMPLES = 20000;

export function oracleHitsAt(scene, t) {
  const out = [];
  const L = scene.labels;
  for (let i = 0; i < L.length; i++) {
    const a = L[i];
    const ax = a.p[0] + a.v[0] * t;
    const ay = a.p[1] + a.v[1] * t;
    for (let j = i + 1; j < L.length; j++) {
      const b = L[j];
      const bx = b.p[0] + b.v[0] * t;
      const by = b.p[1] + b.v[1] * t;
      const gapX = Math.abs(ax - bx);
      const gapY = Math.abs(ay - by);
      const limX = a.h[0] + b.h[0];
      const limY = a.h[1] + b.h[1];
      if (gapX < limX && gapY < limY) out.push(`overlap:${a.id}:${b.id}`);
    }
  }
  for (const a of L) {
    const ax = a.p[0] + a.v[0] * t;
    const ay = a.p[1] + a.v[1] * t;
    for (const o of scene.occluders || []) {
      if (!(o.depth < a.depth)) continue;
      if (Math.abs(ax - (o.p[0] + o.v[0] * t)) < o.h[0] && Math.abs(ay - (o.p[1] + o.v[1] * t)) < o.h[1]) {
        out.push(`occlusion:${a.id}:${o.id}`);
      }
    }
  }
  return out;
}

export function coveredByReport(hit, report) {
  const [kind, a, b] = hit.split(":");
  return report.violations.some((v) => {
    if (v.kind === "overlap") return kind === "overlap" && ((v.a === a && v.b === b) || (v.a === b && v.b === a));
    return kind === "occlusion" && v.label === a && v.occluder === b;
  });
}

export function reportedWindowHits(scene, report) {
  let checked = 0;
  let failed = 0;
  for (const v of report.violations) {
    const mid = (v.lo + v.hi) / 2;
    const key = v.kind === "overlap" ? `overlap:${v.a}:${v.b}` : `occlusion:${v.label}:${v.occluder}`;
    const hits = oracleHitsAt(scene, mid);
    checked++;
    if (!hits.includes(key)) failed++;
  }
  return { checked, failed };
}

export function hiddenSetAt(plan, scene, t) {
  const cell = plan.cells.find((c) => t < c.hi) || plan.cells[plan.cells.length - 1];
  if (!cell) return new Set();
  const hidden = new Set();
  scene.labels.forEach((l, i) => {
    if (cell.cover & (1 << i)) hidden.add(l.id);
  });
  return hidden;
}

export function remainingAt(scene, plan, t) {
  const hidden = hiddenSetAt(plan, scene, t);
  return oracleHitsAt(scene, t).filter((h) => {
    const parts = h.split(":");
    return !hidden.has(parts[1]) && !(parts[2] && hidden.has(parts[2]));
  });
}

function popcount(x) {
  let c = 0;
  for (; x; x &= x - 1) c++;
  return c;
}

/** Independent minimum vertex cover per cell (occluders force the label in). */
export function independentMinCover(scene, report) {
  const n = scene.labels.length;
  const idx = new Map(scene.labels.map((l, i) => [l.id, i]));
  const full = (1 << n) - 1;
  let cells = 0;
  let total = 0;
  // own breakpoints, recomputed here rather than reused from core.cells
  const bps = [...new Set([scene.t0 ?? 0, scene.t1 ?? 1, ...report.violations.flatMap((v) => [v.lo, v.hi])])].sort((x, y) => x - y);
  for (let k = 0; k + 1 < bps.length; k++) {
    const lo = bps[k];
    const hi = bps[k + 1];
    if (!(hi > lo + 1e-12)) continue;
    const mid = (lo + hi) / 2;
    let forced = 0;
    const edges = new Set();
    for (const v of report.violations) {
      if (!(v.lo <= mid && mid <= v.hi)) continue;
      if (v.kind === "occlusion") forced |= 1 << idx.get(v.label);
      else edges.add((1 << idx.get(v.a)) | (1 << idx.get(v.b)));
    }
    let best = Infinity;
    const free = full & ~forced;
    for (let s = free; ; s = (s - 1) & free) {
      const mask = forced | s;
      const size = popcount(mask);
      if (size < best) {
        let ok = true;
        for (const e of edges) if (!(mask & e)) ok = false;
        if (ok) best = size;
      }
      if (s === 0) break;
    }
    cells++;
    total += (hi - lo) * best;
  }
  return { cells, total };
}
