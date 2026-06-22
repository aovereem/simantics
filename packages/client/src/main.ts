import type { ColonySnapshot } from "@simantics/shared";
import { connect } from "./net.js";
import { Scene } from "./scene/scene2d.js";
import { TreeLayout, SURFACE, type AntDot, type CNode, type Tree } from "./scene/tree.js";
import { ColonySim } from "./scene/sim.js";

const el = {
  stage: document.getElementById("stage")!,
  ants: document.getElementById("stat-ants")!,
  rooms: document.getElementById("stat-rooms")!,
  food: document.getElementById("stat-food")!,
  leaves: document.getElementById("stat-leaves")!,
  deep: document.getElementById("stat-deep")!,
  health: document.getElementById("stat-health")!,
  healthWrap: document.getElementById("stat-health-wrap")!,
  healthTip: document.getElementById("health-tip")!,
  detail: document.getElementById("detail")!,
  modal: document.getElementById("modal")!,
  status: document.getElementById("status")!,
  event: document.getElementById("event")!,
  eventLabel: document.getElementById("event-label")!,
  eventTip: document.getElementById("event-tip")!,
};

const canvas = document.createElement("canvas");
canvas.style.display = "block";
el.stage.appendChild(canvas);

const scene = new Scene(canvas);
scene.resize(window.innerWidth, window.innerHeight);

const layout = new TreeLayout();
const sim = new ColonySim();
let tree: Tree | null = null;     // the live (animated) colony the sim renders
let blueprint: Tree | null = null; // full target colony, for framing/jump-to-newest
let centered = false;
let vw = window.innerWidth, vh = window.innerHeight;

connect({
  onStatus: (s) => {
    el.status.textContent = s === "live" ? "live" : s === "lost" ? "reconnecting…" : "connecting…";
    el.status.className = s === "live" ? "live" : "";
  },
  onSnapshot: (snap: ColonySnapshot) => {
    blueprint = layout.update(snap);
    sim.sync(blueprint);
    scene.setAlarm(snap.alarm);
    sim.setAlarm(snap.alarm); // a stuck session blights its frontier + rallies the soldiers
    alarm = snap.alarm;
    foodStore = snap.foodStore;
    // NOTE: the commit signal (Σ snap.bugs[].commits, also per-task `committed`) is parsed
    // and available but currently UNASSIGNED to any visual — see the unassigned registry.
  },
});

let foodStore = 0;
let alarm = false;

// What the colony is doing right now, with a plain-words explanation on hover.
// Reads the live scene only — no new work, just naming the activity already shown.
const EVENTS: Record<string, { label: string; cls: string; tip: string }> = {
  rain: { label: "rain", cls: "ev-rain", tip: "<b>Rain</b> — a session is stuck. It hit an error and hasn't recovered, so the colony takes cover until the work moves again." },
  digging: { label: "digging", cls: "ev-dig", tip: "<b>Digging</b> — an agent is at work: it carves a chamber for the turn and keeps gnawing it wider as the work goes on (edits, commands, thinking)." },
  foraging: { label: "foraging", cls: "ev-forage", tip: "<b>Foraging</b> — ants reached out for material. A web fetch or a reading/planning pass sends foragers up for leaves; they come home and the leaves grow the fungus." },
  harvesting: { label: "harvesting", cls: "ev-harvest", tip: "<b>Harvesting</b> — workers are ferrying ripe fungus from the gardens to the queen's pile, stocking the colony's stores." },
  feeding: { label: "feeding", cls: "ev-feed", tip: "<b>Feeding</b> — a lean spell: lots of ants are off grazing the gardens and the reserve. Foraging (reads / web) grows more fungus to refill them." },
  quiet: { label: "quiet", cls: "ev-quiet", tip: "<b>Quiet</b> — no active work right now. The ants tend the warren and wander the tunnels until the next turn lands." },
};
function currentEvent(t: Tree): string {
  if (alarm) return "rain";
  const hungry = t.ants.reduce((n, a) => n + (a.mood === "hungry" || a.mood === "seeking food" ? 1 : 0), 0);
  if (hungry >= 6) return "feeding"; // a lean-times beat — many ants chasing food at once
  if (t.ants.some((a) => a.digging)) return "digging";
  const hauling = t.ants.reduce((n, a) => n + (a.mood === "hauling food" ? 1 : 0), 0);
  if (hauling >= 4) return "harvesting"; // crop flowing to the pantry
  if (t.ants.some((a) => a.caste === "forager")) return "foraging";
  return "quiet";
}
let shownEvent = "";
function updateEvent(t: Tree) {
  const k = currentEvent(t);
  if (k === shownEvent) return;
  shownEvent = k;
  const e = EVENTS[k];
  el.eventLabel.textContent = e.label;
  el.event.className = e.cls;
  el.eventTip.innerHTML = e.tip;
}
el.event.addEventListener("mouseenter", () => { el.eventTip.style.display = "block"; });
el.event.addEventListener("mouseleave", () => { el.eventTip.style.display = "none"; });
function updateStats(t: Tree) {
  el.ants.textContent = String(t.antsTotal ?? t.ants.length); // cumulative ants ever (founders + every forager)
  el.rooms.textContent = String(t.nodes.length);
  el.food.textContent = compact(foodStore);
  el.leaves.textContent = String(t.leavesTotal ?? t.leaves.length); // cumulative leaves ever foraged
  el.deep.textContent = `${Math.max(0, Math.round(t.bounds.maxY / 12))}m`;
}

// Colony health = food on hand: how lush the fungus gardens are + the queen's reserve.
let healthTip = "";
function updateHealth(t: Tree) {
  const gardens = t.nodes.filter((n) => (n.crop ?? 0) > 0.02);
  const avgCrop = gardens.length ? gardens.reduce((s, n) => s + (n.crop ?? 0), 0) / gardens.length : 0;
  const reserve = t.larder ?? 0;
  const h = Math.min(1, Math.max(0, 0.65 * avgCrop + 0.35 * reserve));
  const [word, cls] = h >= 0.7 ? ["thriving", "h-thrive"] : h >= 0.45 ? ["steady", "h-steady"] : h >= 0.2 ? ["lean", "h-lean"] : ["hungry", "h-hungry"];
  el.health.textContent = word;
  el.healthWrap.className = `stat health ${cls}`;
  healthTip = `<b>Colony health</b> — the food the colony has on hand. Lush fungus gardens (now ${Math.round(avgCrop * 100)}%) plus the queen's stored reserve (${Math.round(reserve * 100)}%). Foraged leaves — ${t.leavesTotal ?? 0} so far — keep the gardens growing.`;
  if (el.healthTip.style.display === "block") el.healthTip.innerHTML = healthTip; // live-refresh while hovering
}
el.healthWrap.addEventListener("mouseenter", () => { el.healthTip.innerHTML = healthTip; el.healthTip.style.display = "block"; });
el.healthWrap.addEventListener("mouseleave", () => { el.healthTip.style.display = "none"; });

let last = performance.now();
const loop = (now: number) => {
  const dt = Math.min(3, (now - last) / 16.67);
  last = now;
  if (vw !== window.innerWidth || vh !== window.innerHeight) {
    vw = window.innerWidth; vh = window.innerHeight; scene.resize(vw, vh);
  }
  sim.step(dt);
  tree = sim.render();
  scene.setTree(tree);
  if (!centered && tree.nodes.length) { scene.fitBounds(tree.bounds); centered = true; }
  updateStats(tree);
  updateHealth(tree);
  updateEvent(tree);
  if (modalAnt) renderModal(); // an ant card: refresh each frame so mood + distance stay live
  else if (modalId && broodIds(modalId).join(",") !== modalBrood) renderModal();
  scene.frame(dt);
  syncFollowCard(); // surface/dismiss the auto card for the idle-followed ant
  requestAnimationFrame(loop);
};
requestAnimationFrame(loop);

// ---- camera: drag to pan, wheel to zoom, "n" jumps to newest ----
let down = false, lastX = 0, lastY = 0, downX = 0, downY = 0, moved = false;
const localPos = (e: { clientX: number; clientY: number }) => {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
};
canvas.addEventListener("pointerdown", (e) => { down = true; lastX = e.clientX; lastY = e.clientY; downX = e.clientX; downY = e.clientY; moved = false; });
window.addEventListener("pointerup", (e) => {
  if (down && !moved) { // a click, not a drag → open the ant/chamber under it (or close)
    if (followCardId) followSuppressed = true; // a click dismisses the idle follow-card
    const p = localPos(e);
    const ant = scene.hitTestAnt(p.x, p.y);
    if (ant) { openAnt(ant); }
    else { const node = scene.hitTest(p.x, p.y); if (node) openChamber(node.id); else closeModal(); }
  }
  down = false;
});
canvas.addEventListener("pointermove", (e) => {
  if (down) {
    scene.panBy(e.clientX - lastX, e.clientY - lastY);
    lastX = e.clientX; lastY = e.clientY;
    if (Math.hypot(e.clientX - downX, e.clientY - downY) > 4) { moved = true; el.detail.style.display = "none"; }
    return;
  }
  const p = localPos(e);
  const ant = scene.hitTestAnt(p.x, p.y);
  if (ant) { showAntRecord(ant, p.x, p.y); return; }
  const node = scene.hitTest(p.x, p.y);
  if (node) { showRecord(node, p.x, p.y); return; }
  const tun = scene.hitTestTunnel(p.x, p.y);
  if (tun) { showTunnel(tun, p.x, p.y); return; }
  el.detail.style.display = "none";
});
canvas.addEventListener("pointerleave", () => (el.detail.style.display = "none"));
canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  const p = localPos(e);
  scene.zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, p.x, p.y);
}, { passive: false });
window.addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase();
  if (k === "w" || k === "n" || e.key === " ") {
    const id = scene.gotoWorker();
    const a = id ? tree?.ants.find((x) => x.antId === id) : null;
    if (a) openAnt(a); // surface the active/last worker's card too
  } else if (k === "f" && tree) scene.forceWhole(tree.bounds);
});

function showRecord(n: CNode, x: number, y: number) {
  const founder = scene.founderName(n.id);
  el.detail.innerHTML =
    `<div class="caste">${n.isQueen ? "queen's chamber" : "chamber"}</div>` +
    (founder ? `<div class="row">dug by ${esc(founder)}</div>` : "") +
    `<div class="row">${n.label ? esc(n.label) : "—"}</div>` +
    `<div class="row">${compact(n.tokens)} crumbs · ${dur(n.durationMs)} · ${n.actions} tools` +
    (n.children ? ` · ${n.children} spawned` : "") + `</div>` +
    (n.done ? "" : `<div class="row">digging…</div>`);
  el.detail.style.left = `${Math.min(x + 14, window.innerWidth - 240)}px`;
  el.detail.style.top = `${Math.max(y - 12, 8)}px`;
  el.detail.style.display = "block";
}

function showAntRecord(a: AntDot, x: number, y: number) {
  const n = tree?.nodes.find((q) => q.id === a.antId);
  const ts = a.startTs ?? n?.startTs; // the ant carries its own startTs → age shows even while still digging
  const age = ts ? ago(Date.now() - ts) : "—";
  const moved = a.traveled !== undefined ? ` · ${compact(Math.round(a.traveled))} paces` : "";
  el.detail.innerHTML =
    `<div class="caste">${casteWord(a.caste)}</div>` +
    `<div class="row"><b>${esc(a.name ?? "an ant")}</b></div>` +
    `<div class="row">${esc(a.mood ?? "—")}</div>` +
    `<div class="row">age · ${age}${moved}</div>`;
  el.detail.style.left = `${Math.min(x + 14, window.innerWidth - 240)}px`;
  el.detail.style.top = `${Math.max(y - 12, 8)}px`;
  el.detail.style.display = "block";
}

// ---- modal: an ant card (name · caste · age) or a chamber card (founder + brood) ----
let modalId: string | null = null;
let modalAnt: { name: string; caste: string; chamberId: string } | null = null;
let modalBrood = "";

function broodIds(id: string): string[] {
  return (tree?.tunnels ?? []).filter((t) => t.fromId === id && !t.cross).map((t) => t.toId);
}
function openChamber(id: string) {
  followCardId = null; modalAnt = null; modalId = id; scene.selectAnt(null); scene.select(id); renderModal();
}
function openAnt(a: AntDot) {
  followCardId = null; // a user-clicked card, not the auto follow-card
  modalAnt = { name: a.name ?? "an ant", caste: a.caste, chamberId: a.antId };
  modalId = null; scene.select(null); scene.selectAnt(a.antId); renderModal();
}
// the idle camera's auto card: show the trailed ant WITHOUT selecting it (so the
// camera keeps following) — it pops in, and is dismissed by a click or a camera move.
let followCardId: string | null = null;
let followSuppressed = false;
let lastFollowFid: string | null = null;
function openFollowAnt(a: AntDot) {
  modalAnt = { name: a.name ?? "an ant", caste: a.caste, chamberId: a.antId };
  modalId = null; renderModal();
}
function syncFollowCard() {
  const fid = scene.followingAntId;
  if (fid !== lastFollowFid) { followSuppressed = false; lastFollowFid = fid; } // new ant (or stopped) → re-arm
  if (fid && !followSuppressed && !modalId) {
    if (followCardId !== fid) {
      const a = tree?.ants.find((x) => x.antId === fid);
      if (a) { openFollowAnt(a); followCardId = fid; }
    }
  } else if (followCardId) { // stopped trailing, or suppressed → drop the auto card
    if (modalAnt && modalAnt.chamberId === followCardId) closeModal();
    followCardId = null;
  }
}
function renderModal() {
  if (modalAnt) { renderAntCard(modalAnt); return; }
  if (!modalId) return;
  const n = tree?.nodes.find((x) => x.id === modalId);
  if (!n) { closeModal(); return; }
  const founder = scene.founderName(modalId);
  const parentId = (tree?.tunnels ?? []).find((t) => t.toId === modalId && !t.cross)?.fromId;
  const upOk = !!parentId && parentId !== SURFACE && !!tree?.nodes.some((x) => x.id === parentId);
  const founderRow = !founder
    ? `<div class="m-row">founder · —</div>`
    : upOk
      ? `<div class="brow" data-id="${parentId}">↑ founder · <b>${esc(founder)}</b></div>`
      : `<div class="m-row">founder · ${esc(founder)}</div>`;
  const kids = broodIds(modalId);
  modalBrood = kids.join(",");
  const rows = kids.map((kid) => {
    const kn = tree!.nodes.find((x) => x.id === kid);
    const name = scene.founderName(kid);
    return `<div class="brow" data-id="${kid}">↳ <b>${name ? esc(name) : "…"}</b> · ${kn ? compact(kn.tokens) + " crumbs" : "digging…"}</div>`;
  }).join("");
  el.modal.innerHTML =
    `<div class="m-head"><span class="m-title">${n.isQueen ? "Queen's Chamber" : "Chamber"}</span><span class="m-x">×</span></div>` +
    `<div class="m-row">${n.label ? esc(n.label) : "—"}</div>` +
    `<div class="m-row">${compact(n.tokens)} crumbs · ${dur(n.durationMs)} · ${n.actions} tools</div>` +
    founderRow +
    (kids.length ? `<div class="m-sub">brood · ${kids.length}</div>${rows}` : `<div class="m-sub">no brood yet</div>`);
  el.modal.style.display = "block";
}
function renderAntCard(a: { name: string; caste: string; chamberId: string }) {
  const n = tree?.nodes.find((x) => x.id === a.chamberId);
  const live = tree?.ants.find((x) => x.antId === a.chamberId); // the live ant, for mood + distance + age
  const ts = live?.startTs ?? n?.startTs; // the ant carries its own startTs, so age shows even mid-dig (chamber not yet revealed)
  const age = ts ? ago(Date.now() - ts) : "—";
  modalBrood = broodIds(a.chamberId).join(",");
  const moved = live?.traveled !== undefined ? ` · ${compact(Math.round(live.traveled))} paces` : "";
  el.modal.innerHTML =
    `<div class="m-head"><span class="m-title">${esc(a.name)}</span><span class="m-x">×</span></div>` +
    `<div class="caste">${casteWord(a.caste)}</div>` +
    `<div class="m-row">mood · ${esc(live?.mood ?? "—")}</div>` +
    `<div class="m-row">age · ${age}${moved}</div>` +
    (n
      ? `<div class="brow" data-id="${a.chamberId}">↳ dug <b>${n.isQueen ? "the Queen's Chamber" : "a chamber"}</b> · ${compact(n.tokens)} crumbs</div>`
      : `<div class="m-row">still digging its first chamber…</div>`);
  el.modal.style.display = "block";
}
function closeModal() {
  followCardId = null; modalId = null; modalAnt = null; el.modal.style.display = "none"; scene.select(null); scene.selectAnt(null);
}
el.modal.addEventListener("click", (e) => {
  const t = e.target as HTMLElement;
  if (t.classList.contains("m-x")) { closeModal(); return; }
  const row = t.closest(".brow") as HTMLElement | null;
  if (row?.dataset.id) openChamber(row.dataset.id);
});

function showTunnel(t: { cross: boolean; durationMs: number }, x: number, y: number) {
  el.detail.innerHTML = t.cross
    ? `<div class="caste">shortcut</div><div class="row">a passage ants dug between chambers</div>`
    : `<div class="caste">tunnel</div><div class="row">${dur(t.durationMs)} of digging</div>`;
  el.detail.style.left = `${Math.min(x + 14, window.innerWidth - 240)}px`;
  el.detail.style.top = `${Math.max(y - 12, 8)}px`;
  el.detail.style.display = "block";
}

function dur(ms: number): string {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}
/** Coarser elapsed for ant age — can span hours/days, so carry hours and days. */
function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}
function casteWord(c: string): string {
  return c === "queen" ? "the queen" : c; // worker · soldier · forager read fine as-is
}
function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
function esc(s: string): string {
  return s.replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"));
}
