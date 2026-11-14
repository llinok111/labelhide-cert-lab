// tools/gen-sample.mjs — deterministic scene generator (fixed seeds, no network).
// Usage: node tools/gen-sample.mjs            # writes data/scene-0N.json
//        node tools/gen-sample.mjs --check    # regenerates in memory, byte-compares
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const DATA = join(ROOT, "data");

const SCENE_SPECS = [
  { id: "orbit-cluster", seed: 0x51f0, n: 10 },
  { id: "crossing-streams", seed: 0x51f1, n: 11 },
  { id: "sweeper-alley", seed: 0x51f2, n: 9 },
  { id: "tight-ring", seed: 0x51f3, n: 12 },
  { id: "occluder-gate", seed: 0x51f4, n: 10 },
  { id: "near-miss-corner", seed: 0x51f5, n: 11 },
];

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const round = (x) => Math.round(x * 1e6) / 1e6;

function rawScene(spec) {
  const rnd = mulberry32(spec.seed);
  const labels = [];
  for (let i = 0; i < spec.n; i++) {
    const ang = (i / spec.n) * Math.PI * 2 + (rnd() - 0.5) * 0.35;
    const rad = 1.05 + rnd() * 0.55;
    const tangent = 0.25 + rnd() * 0.55;
    const spin = rnd() < 0.5 ? 1 : -1;
    labels.push({
      id: `L${i}`,
      p: [round(Math.cos(ang) * rad), round(Math.sin(ang) * rad)],
      v: [round(-Math.sin(ang) * tangent * spin + (rnd() - 0.5) * 0.3), round(Math.cos(ang) * tangent * spin + (rnd() - 0.5) * 0.3)],
      h: [round(0.06 + rnd() * 0.05), round(0.055 + rnd() * 0.045)],
      depth: 1,
    });
  }
  label: {
    // engineered sliver pair: the intersection of the two overlap intervals is
    // 2e-5 wide, centred at t=0.600013 — invisible to a 1/10000 sampling grid.
    labels.push({ id: "S-A", p: [0, 0], v: [0, 0], h: [0.25, 0.25], depth: 1 });
    labels.push({
      id: "S-B",
      p: [round(-0.5 + 0.7 * -0.600003), round(0.5 + 0.7 * -0.600023)],
      v: [0.7, 0.7],
      h: [0.25, 0.25],
      depth: 1,
    });
  }
  label2: {
    // engineered occlusion: a closer rectangle sweeps across a label centre
    labels.push({ id: "OCC-L", p: [1.05, -0.9], v: [0, 0], h: [0.09, 0.09], depth: 1 });
  }
  const occluders = [];
  for (let i = 0; i < 4; i++) {
    occluders.push({
      id: `O${i}`,
      p: [round((rnd() - 0.5) * 2.6), round((rnd() - 0.5) * 2.0)],
      v: [round((rnd() - 0.5) * 0.6), round((rnd() - 0.5) * 0.6)],
      h: [round(0.14 + rnd() * 0.16), round(0.12 + rnd() * 0.14)],
      depth: 0.5,
    });
  }
  occluders.push({ id: "OCC-SWEEP", p: [0.45, -0.9], v: [1.2, 0], h: [0.08, 0.08], depth: 0.5 });
  return { id: spec.id, t0: 0, t1: 1, labels, occluders };
}

function analyze(scene) {
  // local, independent window arithmetic used only for deterministic acceptance
  const iv = (a, b, w) => {
    if (Math.abs(b) < 1e-12) return Math.abs(a) < w ? [-Infinity, Infinity] : null;
    const r1 = (w - a) / b;
    const r2 = (-w - a) / b;
    let lo = Math.min(r1, r2);
    let hi = Math.max(r1, r2);
    lo = Math.max(lo, 0);
    hi = Math.min(hi, 1);
    return lo < hi ? [lo, hi] : null;
  };
  const cut = (x, y) => {
    if (!x || !y) return null;
    const lo = Math.max(x[0], y[0]);
    const hi = Math.min(x[1], y[1]);
    return lo < hi ? [lo, hi] : null;
  };
  const wins = [];
  const L = scene.labels;
  let occ = 0;
  let overlap = 0;
  for (let i = 0; i < L.length; i++) {
    for (let j = i + 1; j < L.length; j++) {
      const w = cut(
        iv(L[i].p[0] - L[j].p[0], L[i].v[0] - L[j].v[0], L[i].h[0] + L[j].h[0]),
        iv(L[i].p[1] - L[j].p[1], L[i].v[1] - L[j].v[1], L[i].h[1] + L[j].h[1])
      );
      if (w) {
        wins.push(w);
        overlap++;
      }
    }
  }
  for (const a of L) {
    for (const o of scene.occluders) {
      if (!(o.depth < a.depth)) continue;
      const w = cut(iv(a.p[0] - o.p[0], a.v[0] - o.v[0], o.h[0]), iv(a.p[1] - o.p[1], a.v[1] - o.v[1], o.h[1]));
      if (w) {
        wins.push(w);
        occ++;
      }
    }
  }
  wins.sort((a, b) => a[0] - b[0]);
  let covered = 0;
  let cur = null;
  for (const w of wins) {
    if (!cur || w[0] > cur[1]) {
      if (cur) covered += cur[1] - cur[0];
      cur = [w[0], w[1]];
    } else cur[1] = Math.max(cur[1], w[1]);
  }
  if (cur) covered += cur[1] - cur[0];
  return { overlap, occ, fraction: covered, windows: wins.length };
}

function buildScene(spec) {
  for (let salt = 0; salt < 400; salt++) {
    const scene = rawScene({ ...spec, seed: (spec.seed + salt * 0x9e37) >>> 0 });
    const a = analyze(scene);
    if (a.overlap >= 3 && a.occ >= 1 && a.fraction <= 0.62 && a.windows <= 45) return scene;
  }
  throw new Error(`no acceptable scene for ${spec.id}`);
}

export function buildAll() {
  return SCENE_SPECS.map(buildScene);
}

const files = () => SCENE_SPECS.map((s, i) => join(DATA, `scene-0${i + 1}.json`));

function render(scene) {
  return JSON.stringify(scene, null, 2) + "\n";
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--check")) {
    const scenes = buildAll();
    let drift = 0;
    scenes.forEach((s, i) => {
      const f = files()[i];
      const want = render(s);
      if (!existsSync(f) || readFileSync(f, "utf8") !== want) drift++;
    });
    const digest = createHash("sha256").update(JSON.stringify(scenes)).digest("hex");
    console.log(`gen-sample --check: ${scenes.length} scenes, drifted=${drift}, sha256=${digest}`);
    process.exit(drift === 0 ? 0 : 1);
  } else {
    mkdirSync(DATA, { recursive: true });
    const scenes = buildAll();
    scenes.forEach((s, i) => writeFileSync(files()[i], render(s)));
    const sizes = files().map((f) => readFileSync(f).length);
    console.log(`wrote ${scenes.length} scenes to data/ (${sizes.reduce((a, b) => a + b, 0)} bytes)`);
    for (const s of scenes) {
      const a = analyze(s);
      console.log(`  ${s.id}: labels=${s.labels.length} occluders=${s.occluders.length} overlap=${a.overlap} occlusion=${a.occ} forbidden=${(a.fraction * 100).toFixed(1)}%`);
    }
  }
}
