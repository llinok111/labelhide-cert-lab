// bench/bench.mjs — warmup + >=5 repeats, cold start reported separately.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeScene, solveSuppression } from "../src/core.mjs";
import { ORACLE_SAMPLES, oracleHitsAt, reportedWindowHits, independentMinCover, remainingAt } from "./oracle.mjs";
import { detectBySampling, framesWithConflicts } from "../baseline/naive.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPS = 7;

function stats(xs) {
  const s = xs.slice().sort((a, b) => a - b);
  const n = s.length;
  const mean = s.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(s.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  const p95 = s[Math.min(n - 1, Math.ceil(0.95 * n) - 1)];
  return { min: s[0], median: s[Math.floor(n / 2)], p95, max: s[n - 1], mean, stddev: sd, relStddev: mean === 0 ? 0 : sd / mean, n };
}

const scenes = readdirSync(join(ROOT, "data"))
  .filter((f) => f.endsWith(".json"))
  .sort()
  .map((f) => JSON.parse(readFileSync(join(ROOT, "data", f), "utf8")));

// --- cold start: very first full pass, one scene at a time, before any warmup
const cold = {};
for (const s of scenes) {
  const t = performance.now();
  const r = analyzeScene(s);
  solveSuppression(s, r);
  cold[s.id] = performance.now() - t;
}

const analyze = {};
const solve = {};
for (const s of scenes) {
  const runs = [];
  const runsSolve = [];
  for (let i = 0; i <= REPS; i++) {
    const t1 = performance.now();
    const r = analyzeScene(s);
    const t2 = performance.now();
    solveSuppression(s, r);
    const t3 = performance.now();
    if (i === 0) continue; // warmup
    runs.push(t2 - t1);
    runsSolve.push(t3 - t1);
  }
  analyze[s.id] = stats(runs);
  solve[s.id] = stats(runsSolve);
}

const oracleRuns = [];
const naiveRuns = [];
for (let i = 0; i <= REPS; i++) {
  const t1 = performance.now();
  for (const s of scenes) {
    for (let k = 0; k <= ORACLE_SAMPLES; k++) oracleHitsAt(s, k / ORACLE_SAMPLES);
  }
  const t2 = performance.now();
  for (const s of scenes) detectBySampling(s, 10000);
  const t3 = performance.now();
  if (i === 0) continue;
  oracleRuns.push(t2 - t1);
  naiveRuns.push(t3 - t2);
}

const perScene = [];
for (const s of scenes) {
  const report = analyzeScene(s);
  const plan = solveSuppression(s, report);
  const base = detectBySampling(s, 10000);
  const mid = reportedWindowHits(s, report);
  const indep = independentMinCover(s, report);
  let remaining = 0;
  for (let k = 0; k <= ORACLE_SAMPLES; k++) remaining += remainingAt(s, plan, k / ORACLE_SAMPLES).length;
  perScene.push({
    id: s.id,
    labels: s.labels.length,
    windows: report.violations.length,
    overlapWindows: report.violations.filter((v) => v.kind === "overlap").length,
    occlusionWindows: report.violations.filter((v) => v.kind === "occlusion").length,
    narrowWindows: report.violations.filter((v) => v.hi - v.lo < 1e-4).length,
    minWindow: report.minWindow,
    forbiddenFraction: report.forbiddenFraction,
    cells: plan.cells.length,
    totalHidden: plan.totalHidden,
    hiddenFraction: plan.hiddenFraction,
    maxSimultaneousHidden: plan.maxSimultaneousHidden,
    oracleCost: indep.total,
    coverMatchesOracle: Math.abs(indep.total - plan.totalHidden) < 1e-12,
    baselineRuns: base.runs,
    baselineMissed: report.violations.length - base.runs,
    midpointWitnessFailures: mid.failed,
    oracleRemainingHits: remaining,
    badFrames240: framesWithConflicts(s, 240).length,
    coldStartMs: cold[s.id],
    analyzeMs: analyze[s.id],
    solveMs: solve[s.id],
  });
}

const allAnalyze = perScene.flatMap((p) => [p.analyzeMs.median]);
const result = {
  generatedAt: new Date().toISOString(),
  node: process.version,
  repeats: REPS,
  scenes: perScene.length,
  totals: {
    labels: perScene.reduce((a, p) => a + p.labels, 0),
    windows: perScene.reduce((a, p) => a + p.windows, 0),
    narrowWindows: perScene.reduce((a, p) => a + p.narrowWindows, 0),
    overlapWindows: perScene.reduce((a, p) => a + p.overlapWindows, 0),
    occlusionWindows: perScene.reduce((a, p) => a + p.occlusionWindows, 0),
    cells: perScene.reduce((a, p) => a + p.cells, 0),
    totalHidden: perScene.reduce((a, p) => a + p.totalHidden, 0),
    baselineMissed: perScene.reduce((a, p) => a + p.baselineMissed, 0),
    oracleSamples: scenes.length * (ORACLE_SAMPLES + 1),
    oracleRemainingHits: perScene.reduce((a, p) => a + p.oracleRemainingHits, 0),
  },
  coldStartMs: cold,
  analyzePipelineMs: analyze,
  solvePipelineMs: solve,
  oracleAllScenesMs: stats(oracleRuns),
  naive10kAllScenesMs: stats(naiveRuns),
  perScene,
};
writeFileSync(join(ROOT, "bench", "result.json"), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify({ totals: result.totals, coldStartMs: result.coldStartMs, oracleAllScenesMs: result.oracleAllScenesMs, naive10kAllScenesMs: result.naive10kAllScenesMs, medianPipelineMs: Object.fromEntries(Object.entries(analyze).map(([k, v]) => [k, +v.median.toFixed(4)])) }, null, 2));
