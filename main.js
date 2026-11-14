// main.js — render + interaction only. Every number on screen comes from src/core.mjs.
import * as THREE from "three";
import { analyzeScene, solveSuppression, hiddenMaskAt, conflictsAfterSuppression, conflictsAt } from "./src/core.mjs";

const SCENES = ["scene-01", "scene-02", "scene-03", "scene-04", "scene-05", "scene-06"];
const FRAMES = 240;

const stage = document.getElementById("stage");
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
stage.appendChild(renderer.domElement);
const scene3 = new THREE.Scene();
scene3.background = new THREE.Color(0x0b0e14);
const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
camera.position.set(0, -0.4, 5.6);
camera.lookAt(0, 0, 0);
const root = new THREE.Group();
scene3.add(root);
scene3.add(new THREE.AmbientLight(0xffffff, 1.1));

const state = { data: null, report: null, plan: null, sprites: [], grid: null, ok: 0, play: false, frame: 0, last: 0 };

function resize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener("resize", resize);

function textureFor(label) {
  const c = document.createElement("canvas");
  c.width = 256; c.height = 128;
  const g = c.getContext("2d");
  g.fillStyle = "rgba(20,28,40,0.92)";
  g.fillRect(2, 2, 252, 124);
  g.strokeStyle = "#5f7fa8"; g.lineWidth = 3; g.strokeRect(2, 2, 252, 124);
  g.fillStyle = "#dbe7f5"; g.font = "bold 56px monospace"; g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(label, 128, 66);
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  return tex;
}

function buildMesh(item, kind) {
  const w = item.h[0] * 2, h = item.h[1] * 2;
  const geo = new THREE.PlaneGeometry(w, h);
  const mat =
    kind === "occluder"
      ? new THREE.MeshBasicMaterial({ color: 0x2b3444, transparent: true, opacity: 0.85 })
      : new THREE.MeshBasicMaterial({ map: textureFor(item.id), transparent: true });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.userData = { item, kind, baseZ: kind === "occluder" ? -item.depth * 1.2 - 0.01 : -item.depth * 1.2 };
  root.add(mesh);
  return mesh;
}

function frameTime(frame) {
  const t0 = state.data.t0 ?? 0, t1 = state.data.t1 ?? 1;
  return t0 + ((t1 - t0) * frame) / FRAMES;
}

function load(idx) {
  const name = SCENES[idx];
  fetch(`./data/${name}.json`)
    .then((r) => r.json())
    .then((data) => {
      root.clear();
      state.data = data;
      state.report = analyzeScene(data);
      state.plan = solveSuppression(data, state.report);
      state.sprites = [
        ...data.labels.map((l) => buildMesh(l, "label")),
        ...(data.occluders || []).map((o) => buildMesh(o, "occluder")),
      ];
      const grid = new THREE.GridHelper(8, 16, 0x1b2230, 0x141a24);
      grid.rotation.x = Math.PI / 2;
      grid.position.z = -0.6;
      scene3.add(grid);
      state.grid = grid;
      document.getElementById("stats").innerHTML = [
        ["labels", data.labels.length],
        ["exact conflict windows", state.report.violations.length],
        ["overlap / occlusion", `${state.report.violations.filter((v) => v.kind === "overlap").length} / ${state.report.violations.filter((v) => v.kind === "occlusion").length}`],
        ["elementary time cells", state.plan.cells.length],
        ["minimum hide-time (label·t)", state.plan.totalHidden.toFixed(4)],
        ["avg simultaneously hidden", state.plan.hiddenFraction.toFixed(3)],
        ["peak hidden", state.plan.maxSimultaneousHidden],
        ["uniform 240f conflicts", state.report.violations.length ? countUniform() : 0],
      ]
        .map(([k, v]) => `<div class="kv"><span>${k}</span><b>${v}</b></div>`)
        .join("");
      update(0);
    });
}

function countUniform() {
  let bad = 0;
  for (let k = 0; k <= FRAMES; k++) if (conflictsAt(state.data, frameTime(k)).length) bad++;
  return bad;
}

function update(frame) {
  state.frame = frame;
  const t = frameTime(frame);
  const result = conflictsAfterSuppression(state.data, state.plan, t);
  const raw = conflictsAt(state.data, t);
  const hidden = state.plan.cells.find((c) => t < c.hi) || state.plan.cells[state.plan.cells.length - 1];
  const mask = hidden ? hidden.cover : 0;
  state.data.labels.forEach((l, i) => {
    const mesh = state.sprites[i];
    const x = l.p[0] + l.v[0] * t, y = l.p[1] + l.v[1] * t;
    mesh.position.set(x, y, mesh.userData.baseZ);
    const isHidden = (mask & (1 << i)) !== 0;
    const inConflict = raw.some((c) => c.a === l.id || c.b === l.id || c.label === l.id);
    mesh.material.opacity = isHidden ? 0.12 : 1;
    if (mesh.material.map) mesh.material.color.set(inConflict ? 0xff7070 : isHidden ? 0x8792a2 : 0xffffff);
  });
  (state.data.occluders || []).forEach((o, i) => {
    const mesh = state.sprites[state.data.labels.length + i];
    mesh.position.set(o.p[0] + o.v[0] * t, o.p[1] + o.v[1] * t, mesh.userData.baseZ);
  });
  document.getElementById("frameNo").textContent = String(frame);
  document.getElementById("frameMax").textContent = String(FRAMES);
  document.getElementById("tNow").textContent = t.toFixed(4);
  const cert = document.getElementById("cert");
  cert.className = result.length === 0 ? "ok" : "bad";
  cert.textContent = `conflicts after suppression at t: ${result.length} (raw ${raw.length})`;
  const slider = document.getElementById("time");
  slider.value = String(frame);
}

function tick(now) {
  requestAnimationFrame(tick);
  if (state.play && state.data) {
    if (now - state.last > 1000 / 30) {
      state.last = now;
      update((state.frame + 1) % (FRAMES + 1));
    }
  }
  renderer.render(scene3, camera);
}

const sel = document.getElementById("sceneSel");
SCENES.forEach((s, i) => {
  const o = document.createElement("option");
  o.value = String(i);
  o.textContent = s;
  sel.appendChild(o);
});
sel.addEventListener("change", () => load(Number(sel.value)));
document.getElementById("play").addEventListener("click", (e) => {
  state.play = !state.play;
  e.target.textContent = state.play ? "pause" : "play";
});
document.getElementById("time").addEventListener("input", (e) => update(Number(e.target.value)));

resize();
load(0);
requestAnimationFrame(tick);
