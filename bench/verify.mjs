// bench/verify.mjs — assertions with real values printed; exits 0 iff all pass.
import { readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeScene, solveSuppression, scaleScene, conflictsAfterSuppression } from "../src/core.mjs";
import { ORACLE_SAMPLES, oracleHitsAt, coveredByReport, reportedWindowHits, remainingAt, independentMinCover } from "./oracle.mjs";
import { detectBySampling, framesWithConflicts } from "../baseline/naive.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0;
let fail = 0;
const check = (name, ok, detail) => {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${detail}`);
};

const genOut = execFileSync(process.execPath, ["tools/gen-sample.mjs", "--check"], { cwd: ROOT, encoding: "utf8" }).trim();
check("deterministic generator", /drifted=0/.test(genOut), genOut);

const files = readdirSync(join(ROOT, "data")).filter((f) => f.endsWith(".json")).sort();
check("scene count", files.length === 6, `data/*.json = ${files.length}`);

const totals = { windows: 0, samples: 0, unlisted: 0, midFailed: 0, midChecked: 0, remaining: 0, hidden: 0, cells: 0, frameBad: 0, misses: 0, narrowMissed: 0, runtimeMs: 0 };
const perScene = [];

for (const f of files) {
  const scene = JSON.parse(readFileSync(join(ROOT, "data", f), "utf8"));
  const t0 = performance.now();
  const report = analyzeScene(scene);
  const plan = solveSuppression(scene, report);
  totals.runtimeMs += performance.now() - t0;
  totals.windows += report.violations.length;
  totals.hidden += plan.totalHidden;
  totals.cells += plan.cells.length;

  // 1) every reported window has a real midpoint witness (no false positives)
  const mid = reportedWindowHits(scene, report);
  totals.midChecked += mid.checked;
  totals.midFailed += mid.failed;

  // 2) oracle sampling finds no conflict that the interval report missed
  let unlisted = 0;
  for (let k = 0; k <= ORACLE_SAMPLES; k++) {
    const t = (k / ORACLE_SAMPLES) * ((scene.t1 ?? 1) - (scene.t0 ?? 0)) + (scene.t0 ?? 0);
    for (const h of oracleHitsAt(scene, t)) {
      if (!coveredByReport(h, report)) unlisted++;
    }
  }
  totals.samples += ORACLE_SAMPLES + 1;
  totals.unlisted += unlisted;

  // 3) the suppression plan really removes every conflict on the same sampling
  let remaining = 0;
  for (let k = 0; k <= ORACLE_SAMPLES; k++) {
    const t = (k / ORACLE_SAMPLES) * ((scene.t1 ?? 1) - (scene.t0 ?? 0)) + (scene.t0 ?? 0);
    remaining += remainingAt(scene, plan, t).length;
  }
  totals.remaining += remaining;

  // 4) independent minimum-cover recomputation must agree on cost
  const indep = independentMinCover(scene, report);
  const coverOk = indep.cells === plan.cells.length && Math.abs(indep.total - plan.totalHidden) < 1e-12;
  check(`cover optimality ${scene.id}`, coverOk, `oracle cells=${indep.cells} cost=${indep.total.toFixed(6)} | core cells=${plan.cells.length} cost=${plan.totalHidden.toFixed(6)}`);

  // 5) baseline: 10000-sample grid vs exact intervals
  const base = detectBySampling(scene, 10000);
  const missed = report.violations.filter((v) => v.hi - v.lo < 1 / 10000);
  totals.misses += report.violations.length - base.runs;
  totals.narrowMissed += missed.length;
  check(
    `baseline misses narrow windows ${scene.id}`,
    base.runs < report.violations.length,
    `exact windows=${report.violations.length} baseline runs=${base.runs} narrow(<1e-4)=${missed.length}`
  );

  // 6) fixed 240-frame schedule: bad frames before vs after suppression
  const badBefore = framesWithConflicts(scene, 240);
  let badAfter = 0;
  for (const b of badBefore) {
    const hits = conflictsAfterSuppression(scene, plan, b.t);
    badAfter += hits.length;
  }
  totals.frameBad += badBefore.length;
  check(
    `240-frame grid ${scene.id}`,
    badBefore.length > 0 && badAfter === 0,
    `bad before=${badBefore.length}/${badBefore.length + 241 - badBefore.length} after-suppression=${badAfter}`
  );

  // 7) scale invariance 1e-6 .. 1e6
  let drift = 0;
  let countMismatch = 0;
  for (const s of [1e-6, 1e-3, 1, 1e3, 1e6]) {
    const r2 = analyzeScene(scaleScene(scene, s));
    if (r2.violations.length !== report.violations.length) countMismatch++;
    for (let i = 0; i < Math.min(r2.violations.length, report.violations.length); i++) {
      drift = Math.max(drift, Math.abs(r2.violations[i].lo - report.violations[i].lo), Math.abs(r2.violations[i].hi - report.violations[i].hi));
    }
  }
  check(`scale invariance ${scene.id}`, countMismatch === 0 && drift < 1e-9, `countMismatch=${countMismatch} maxTimeDrift=${drift.toExponential(3)}`);

  perScene.push({
    id: scene.id,
    labels: scene.labels.length,
    windows: report.violations.length,
    overlap: report.violations.filter((v) => v.kind === "overlap").length,
    occlusion: report.violations.filter((v) => v.kind === "occlusion").length,
    minWindow: report.minWindow,
    cells: plan.cells.length,
    hiddenFraction: plan.hiddenFraction,
    maxSimultaneousHidden: plan.maxSimultaneousHidden,
    badFrames240: badBefore.length,
    baselineRuns: base.runs,
  });
}

check("oracle samples", totals.samples >= 6 * 20000, `samples=${totals.samples}`);
check("no missed window by oracle", totals.unlisted === 0, `unlisted hits=${totals.unlisted}`);
check("all reported windows witnessed", totals.midFailed === 0, `midpoints checked=${totals.midChecked} failed=${totals.midFailed}`);
check("suppression removes all conflicts", totals.remaining === 0, `remaining oracle hits=${totals.remaining}`);
check("baseline misses every scene", totals.misses >= 6, `baseline run deficit=${totals.misses} narrow windows=${totals.narrowMissed}`);
check("per-scene solve under 50 ms", totals.runtimeMs < 6 * 50, `total analyze+solve=${totals.runtimeMs.toFixed(2)} ms`);

console.log("\nsummary");
console.log(`  scenes=${files.length} windows=${totals.windows} oracleSamples=${totals.samples} narrowWindows=${totals.narrowMissed}`);
console.log(`  totalHiddenTime=${totals.hidden.toFixed(4)} (label x time) cells=${totals.cells} bad240FramesBefore=${totals.frameBad}`);
for (const s of perScene) console.log("  " + JSON.stringify(s));
console.log(`\nRESULT ${fail === 0 ? "PASS" : "FAIL"}: ${pass} passed / ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
