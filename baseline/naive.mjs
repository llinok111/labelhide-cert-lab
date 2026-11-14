// baseline/naive.mjs — the comparison baseline: fixed-step sampling.
// It answers "are there conflicts?" by checking a uniform grid of times and
// checking a uniform grid of frames. Independent of src/core.mjs.
export function detectBySampling(scene, samples = 10000) {
  const t0 = scene.t0 ?? 0;
  const t1 = scene.t1 ?? 1;
  const seen = new Set();
  let firstHit = null;
  let runs = 0;
  let inRun = false;
  for (let k = 0; k <= samples; k++) {
    const t = t0 + ((t1 - t0) * k) / samples;
    let hitHere = false;
    const L = scene.labels;
    for (let i = 0; i < L.length; i++) {
      const a = L[i];
      const ax = a.p[0] + a.v[0] * t;
      const ay = a.p[1] + a.v[1] * t;
      for (let j = i + 1; j < L.length; j++) {
        const b = L[j];
        if (
          Math.abs(ax - (b.p[0] + b.v[0] * t)) < a.h[0] + b.h[0] &&
          Math.abs(ay - (b.p[1] + b.v[1] * t)) < a.h[1] + b.h[1]
        ) {
          seen.add(`overlap:${a.id}:${b.id}`);
          hitHere = true;
          if (!firstHit) firstHit = { kind: "overlap", a: a.id, b: b.id, t };
        }
      }
      for (const o of scene.occluders || []) {
        if (!(o.depth < a.depth)) continue;
        if (Math.abs(ax - (o.p[0] + o.v[0] * t)) < o.h[0] && Math.abs(ay - (o.p[1] + o.v[1] * t)) < o.h[1]) {
          seen.add(`occlusion:${a.id}:${o.id}`);
          hitHere = true;
          if (!firstHit) firstHit = { kind: "occlusion", label: a.id, occluder: o.id, t };
        }
      }
    }
    if (hitHere && !inRun) runs++;
    inRun = hitHere;
  }
  return { detected: [...seen], count: seen.size, runs, firstHit };
}

export function framesWithConflicts(scene, frames = 240) {
  const t0 = scene.t0 ?? 0;
  const t1 = scene.t1 ?? 1;
  const bad = [];
  for (let k = 0; k <= frames; k++) {
    const t = t0 + ((t1 - t0) * k) / frames;
    const hits = detectBySamplingAt(scene, t);
    if (hits.length) bad.push({ frame: k, t, hits });
  }
  return bad;
}

function detectBySamplingAt(scene, t) {
  const out = [];
  const L = scene.labels;
  for (let i = 0; i < L.length; i++) {
    const a = L[i];
    const ax = a.p[0] + a.v[0] * t;
    const ay = a.p[1] + a.v[1] * t;
    for (let j = i + 1; j < L.length; j++) {
      const b = L[j];
      if (Math.abs(ax - (b.p[0] + b.v[0] * t)) < a.h[0] + b.h[0] && Math.abs(ay - (b.p[1] + b.v[1] * t)) < a.h[1] + b.h[1]) {
        out.push(`overlap:${a.id}:${b.id}`);
      }
    }
    for (const o of scene.occluders || []) {
      if (!(o.depth < a.depth)) continue;
      if (Math.abs(ax - (o.p[0] + o.v[0] * t)) < o.h[0] && Math.abs(ay - (o.p[1] + o.v[1] * t)) < o.h[1]) {
        out.push(`occlusion:${a.id}:${o.id}`);
      }
    }
  }
  return out;
}
