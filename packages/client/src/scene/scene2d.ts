import { GRASS_H, clamp } from "./layout.js";
import type { AntDot, CNode, Tree } from "./tree.js";
import { SPRITE_BY_CASTE, FLORA_BY_NAME, FUNGUS_BY_NAME, drawSprite } from "./sprites.js";

const ANT_PX = 1.0; // world size of one ant-sprite pixel
const FLORA_PX = 2.6; // world size of one foliage-sprite pixel
const LEAF_PX = 1.2;  // world size of one leaf-sprite pixel (leaves in chambers)
const EMOTE_ZOOM = 1.15; // only draw ant emotes when zoomed in this close (else clutter)

const COL = {
  sky: "#0e0b08",
  grassTop: "#3f5430", grassBot: "#2c3d22",
  soilTop: "#35281c", soilBot: "#130d07",
  // tunnels & chambers are EXCAVATED: a dark hollow ringed by freshly-dug
  // (lighter) soil. The rim is what reads as "carved into dirt".
  dugRim: "#6b4f34", dugRimDeep: "#4a3622",
  cavity: "#0c0805", cavityCore: "#1d140c",
  queenFloor: "#3a2a12", queenRim: "#caa044", queenGlow: "#e8b04b",
  egg: "#e8dcbb", larva: "#d8c79a",
  hole: "#120c07",
  highlight: "#e8b04b", highlightDim: "rgba(232,176,75,0.4)",
  pebble: "#4a3a2b", pebbleLit: "#63503c", pebbleDk: "#2a2014",
  root: "rgba(48,34,20,0.55)",
  seam: "rgba(18,12,6,0.5)", seamLip: "rgba(150,120,80,0.16)",
  cobble: "#4a4031", cobbleLit: "#6b5c47", cobbleDk: "#2c241a", mortar: "#120c07",
  humus: "#1e150d", grassTip: "#536e3b",
  // a fungus-laden chamber's walls go blue/teal mossy (lerped from the dirt by crop)
  moss: "#3e7a6c", mossDeep: "#27514a", cavityMoss: "#13322c",
  // a blighted chamber (deletion turn / stuck frontier) goes sick jaundiced-olive —
  // the fungus gone bad. Yellow-GREEN, kept clear of the queen's warm orange-gold.
  blight: "#54562c", blightDeep: "#383a1e", blightCore: "#6e6a2e",
  // the queen's chamber: a gilded OUTLINE marks her; the hollow stays near-neutral
  gold: "#b8893a", goldDeep: "#7a5a22", goldGlow: "#6e5018",
  rock: "#3c352c", rockLit: "#564b3d", rockDk: "#241f18", rockEdge: "#15110c",
};
// The earth reads as DISTINCT horizons (a real soil cross-section): warm topsoil
// stepping down through clay and grit to a dark stony bedrock — each a flat band
// with a wavy seam, anchored to WORLD depth so the strata scroll with the colony.
const HORIZONS: Array<{ d: number; c: string }> = [
  { d: 0,    c: "#1e150d" }, // humus / organic — dark line under the grass
  { d: 60,   c: "#4e3a24" }, // topsoil A — warm, the lit band
  { d: 420,  c: "#3c2a19" }, // subsoil B — reddish clay
  { d: 1150, c: "#2c2114" }, // parent material C — coarse grit
  { d: 2150, c: "#231a10" }, // deep clay — the dim zone above the floor
  { d: 3000, c: "#181109" }, // bedrock R — stony base (cobbles drawn on top)
];
const BEDROCK_D = 3000;     // cobbles begin here — below the colony FLOOR (2650), unreachable
const SOIL_DEEP = 3000;
const ZMIN = 0.2, ZMAX = 2.5;
const FILL_OVERFILL = 1.45; // a width-bound (wide) colony zooms in up to this much past the width-fit to fill the frame's height (sides crop a little)
const AUTOFIT_IDLE = 780;   // ~13s of no manual pan/zoom before the camera resumes
const AUTOFIT_EASE = 0.045; // how quickly it tracks the active agent (lively, not snappy)
const IDLE_TO_WHOLE = 360;  // ~6s of no active digging before the idle camera kicks in
const FOLLOW_SWITCH = 3000; // ~50s trailing one ant before the idle camera picks another

interface Drop { x: number; y: number; len: number; speed: number; }

/** 2D-canvas renderer for the colony. Plain canvas (not WebGL) so it captures
 *  cleanly headless. World coords: y=0 surface, +y deeper. Camera only moves on
 *  user input. */
export class Scene {
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private vw = 1; private vh = 1;
  cam = { x: 0, y: 0, z: 0.85 };
  private tree: Tree | null = null;
  private alarm = false;
  private rainLevel = 0;
  private drops: Drop[] = [];
  private t = 0; // elapsed frames, for idle motion
  private lastManualT = -1e9; // when the user last panned/zoomed (frames)
  private lastActiveT = -1e9; // when an agent was last digging (frames)
  private focus: { minX: number; maxX: number; minY: number; maxY: number } | null = null;
  private activeOrder: string[] = []; // ids of ants digging right now, most-recently-busy first
  private forcedWhole = false;        // 'f' pinned the wide view until the next ant goes busy
  private trackedAntId: string | null = null; // the ant the idle camera is currently trailing
  private trackSwitchT = -1e9;        // when we last switched the trailed ant
  private idleFollowActive = false;   // is the camera trailing a random ant right now (vs busy/manual/whole)

  /** The ant the idle camera is currently trailing, or null when it isn't idle-following
   *  (a digger has the camera, the user is panning, or a selection is held). */
  get followingAntId(): string | null { return this.idleFollowActive ? this.trackedAntId : null; }

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d")!;
  }

  resize(vw: number, vh: number): void {
    this.vw = vw; this.vh = vh;
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(vw * this.dpr);
    this.canvas.height = Math.round(vh * this.dpr);
    this.canvas.style.width = vw + "px";
    this.canvas.style.height = vh + "px";
    this.ctx.imageSmoothingEnabled = false; // crisp nearest-neighbour scaling for the baked sprites (canvas resize resets ctx state)
    this.seedRain();
  }

  private selectedId: string | null = null;
  private selectedAntId: string | null = null;

  setTree(t: Tree): void { this.tree = t; }
  setAlarm(on: boolean): void { this.alarm = on; }
  select(id: string | null): void { this.selectedId = id; }
  /** Highlight a single ant (by its home-chamber id) — for clicking an ant,
   *  distinct from selecting a whole chamber. */
  selectAnt(id: string | null): void { this.selectedAntId = id; if (id) this.lastManualT = -1e9; } // selecting an ant → follow it straight away
  /** Name of the ant that founded (dug) a chamber, if it's around. */
  founderName(id: string): string | null {
    return this.tree?.ants.find((a) => a.antId === id)?.name ?? null;
  }

  panBy(dx: number, dy: number): void { this.cam.x += dx; this.cam.y += dy; this.lastManualT = this.t; }
  zoomAt(f: number, sx: number, sy: number): void {
    const z0 = this.cam.z, z = clamp(z0 * f, ZMIN, ZMAX);
    this.cam.x = sx - ((sx - this.cam.x) / z0) * z;
    this.cam.y = sy - ((sy - this.cam.y) / z0) * z;
    this.cam.z = z; this.lastManualT = this.t;
  }
  centerOn(wx: number, wy: number): void {
    this.cam.x = this.vw / 2 - wx * this.cam.z;
    this.cam.y = this.vh * 0.34 - wy * this.cam.z;
    this.lastManualT = this.t;
  }
  /** Snap to frame the whole colony. */
  fitBounds(b: { minX: number; maxX: number; minY: number; maxY: number }): void {
    const t = this.fitCam(b); this.cam.x = t.x; this.cam.y = t.y; this.cam.z = t.z;
  }
  /** 'f': pin the whole-colony view, overriding the busy-ant follow until a new
   *  ant starts digging (then the follow resumes on its own). */
  forceWhole(b: { minX: number; maxX: number; minY: number; maxY: number }): void {
    this.forcedWhole = true; this.focus = b;
    const t = this.fitCam(b); this.cam.x = t.x; this.cam.y = t.y; this.cam.z = t.z;
  }
  /** 'w': go to the current worker. If one's digging, jump to it and let the
   *  auto-follow track it; otherwise jump to where work last happened and hold. */
  /** Jump to the active digger (or the last-worked room) and return its ant id so the
   *  caller can surface that worker's card. */
  gotoWorker(): string | null {
    const t = this.tree;
    if (!t) return null;
    this.forcedWhole = false;
    this.cam.z = clamp(1.1, ZMIN, ZMAX);
    const id = this.activeOrder[0];
    const a = id ? t.ants.find((x) => x.antId === id) : null;
    if (a) {
      this.lastManualT = -1e9; // active digger → snap to it, then auto-follow takes over
      this.cam.x = this.vw / 2 - a.x * this.cam.z;
      this.cam.y = this.vh * 0.42 - a.y * this.cam.z;
      return a.antId;
    }
    // nobody digging → go to where work LAST happened (the frontier room). `newest`
    // now points there, not at the queen's hub.
    if (t.newest) this.centerOn(t.newest.x, t.newest.y);
    return t.newestId ?? null; // the last-worked room's founder
  }
  private fitCam(b: { minX: number; maxX: number; minY: number; maxY: number }) {
    // fit the whole DUG colony (surface → deepest), anchored with the surface near the
    // top. The floor makes colonies very WIDE, so a pure width-fit leaves the lower
    // viewport as a dead band of empty deep soil. So when the colony is width-bound,
    // bias the zoom UP to fill the frame's height — cropping the far left/right edges —
    // but never more than FILL_OVERFILL, so we don't slice the colony in half.
    const w = Math.max(1, b.maxX - b.minX), h = Math.max(1, b.maxY - b.minY);
    const zw = (this.vw * 0.92) / w, zh = (this.vh * 0.9) / h;
    let z = Math.min(zw, zh);
    if (zw < zh) z = Math.min(zh, zw * FILL_OVERFILL); // wide colony → fill, let the sides crop
    z = clamp(z, ZMIN, ZMAX);
    const cx = (b.minX + b.maxX) / 2;
    return { x: this.vw / 2 - cx * z, y: this.vh * 0.09 - b.minY * z, z };
  }

  /** Idle behaviour: trail a random MOVING ant from a comfortable distance, switching
   *  to a new one every so often — far livelier than easing out to the empty wide view. */
  private followRandomAnt(): void {
    if (!this.tree) return;
    let ant = this.trackedAntId ? this.tree.ants.find((a) => a.antId === this.trackedAntId) : undefined;
    // re-pick when there's no ant, the timer's up, or the one we're on has settled for a while
    const settled = ant && !ant.moving && this.t - this.trackSwitchT > FOLLOW_SWITCH * 0.4;
    if (!ant || this.t - this.trackSwitchT > FOLLOW_SWITCH || settled) {
      const movers = this.tree.ants.filter((a) => a.antId && a.moving); // travelling ants — fun to watch
      const pool = movers.length ? movers : this.tree.ants.filter((a) => a.antId);
      if (pool.length) { ant = pool[Math.floor(Math.random() * pool.length)]; this.trackedAntId = ant.antId; this.trackSwitchT = this.t; }
    }
    if (ant) {
      const pad = 220; // a safe distance — close enough to watch, not in its face
      this.focus = { minX: ant.x - pad, maxX: ant.x + pad, minY: ant.y - pad, maxY: ant.y + pad };
      this.idleFollowActive = true; // we're trailing this ant → the card can surface for it
    } else {
      this.focus = this.tree.bounds; // nobody to trail → the wide view
    }
  }

  screenToWorld(sx: number, sy: number) {
    return { x: (sx - this.cam.x) / this.cam.z, y: (sy - this.cam.y) / this.cam.z };
  }
  hitTest(sx: number, sy: number): CNode | null {
    if (!this.tree) return null;
    const w = this.screenToWorld(sx, sy);
    let best: CNode | null = null, bd = Infinity;
    for (const n of this.tree.nodes) {
      const d = Math.hypot(n.x - w.x, n.y - w.y);
      if (d < n.r + 4 && d < bd) { best = n; bd = d; }
    }
    return best;
  }
  /** The ant nearest the cursor, within a comfortable click radius (ants are tiny
   *  and on the move). Its antId is the chamber it dug — its identity/home. Skips
   *  transient forager trips, which carry no home chamber. */
  hitTestAnt(sx: number, sy: number): AntDot | null {
    if (!this.tree) return null;
    const w = this.screenToWorld(sx, sy);
    const reach = 15 / this.cam.z; // ~15px of slack in world units
    let best: AntDot | null = null, bd = reach;
    for (const a of this.tree.ants) {
      if (!a.antId) continue;
      const d = Math.hypot(a.x - w.x, a.y - w.y);
      if (d < bd) { best = a; bd = d; }
    }
    return best;
  }
  /** A tunnel under the cursor: main galleries carry the digging turn's time; a
   *  shortcut carries none (it isn't a turn, just a passage ants dug). */
  hitTestTunnel(sx: number, sy: number): { cross: boolean; durationMs: number } | null {
    if (!this.tree) return null;
    const w = this.screenToWorld(sx, sy);
    let best: Tree["tunnels"][number] | null = null, bd = Infinity;
    for (const tn of this.tree.tunnels) {
      const pts = partialPts(tn.pts, tn.carve);
      if (pts.length < 2) continue;
      const d = distToPath(w.x, w.y, pts);
      if (d < tn.w / 2 + 4 && d < bd) { bd = d; best = tn; }
    }
    if (!best) return null;
    const node = this.tree.nodes.find((n) => n.id === best!.toId);
    return { cross: !!best.cross, durationMs: best.durationMs ?? node?.durationMs ?? 0 }; // tunnel carries it (incl. the in-progress dig, whose chamber isn't in nodes yet)
  }

  /** Keep the recency stack of digging ants current: drop the ones that just
   *  finished, and push any newly-busy ant to the front (it takes the camera, and
   *  releases an 'f' override). When the front ant finishes, focus falls to the
   *  next still-busy ant behind it. */
  private updateActive(): void {
    const digging = new Set<string>();
    for (const a of this.tree!.ants) if (a.digging && a.antId) digging.add(a.antId);
    this.activeOrder = this.activeOrder.filter((id) => digging.has(id));
    for (const a of this.tree!.ants) {
      if (a.digging && a.antId && !this.activeOrder.includes(a.antId)) {
        this.activeOrder.unshift(a.antId);
        this.forcedWhole = false;
      }
    }
  }

  frame(dt: number): void {
    const ctx = this.ctx;
    this.t += dt;
    this.idleFollowActive = false; // set true only when followRandomAnt actually trails one
    if (this.tree) this.updateActive();

    // a manually-selected ant → FOLLOW it as it moves about (manual pan still pauses it)
    const selAnt = this.selectedAntId && this.tree ? this.tree.ants.find((a) => a.antId === this.selectedAntId) : null;
    if (selAnt && this.t - this.lastManualT > AUTOFIT_IDLE) {
      const pad = 200;
      const tgt = this.fitCam({ minX: selAnt.x - pad, maxX: selAnt.x + pad, minY: selAnt.y - pad, maxY: selAnt.y + pad });
      const k = Math.min(1, AUTOFIT_EASE * dt);
      this.cam.x += (tgt.x - this.cam.x) * k;
      this.cam.y += (tgt.y - this.cam.y) * k;
      this.cam.z += (tgt.z - this.cam.z) * k;
    } else
    // Idle camera: with no manual pan, ride the busy ant; we only ease out to the
    // whole colony once work is done (no ant has been digging for a short beat).
    // hold the view while the user is inspecting a selection — don't drift/auto-fit away
    if (this.tree && this.tree.nodes.length && !this.selectedId && !this.selectedAntId && this.t - this.lastManualT > AUTOFIT_IDLE) {
      const topId = this.activeOrder[0];
      const busy = topId ? this.tree.ants.find((a) => a.antId === topId) : undefined;
      if (this.forcedWhole) {
        this.focus = this.tree.bounds; // 'f' override — hold wide until a new ant digs
      } else if (busy) {
        const pad = 340; // ride the single most-recently-busy ant, close enough to watch it work
        this.focus = { minX: busy.x - pad, maxX: busy.x + pad, minY: busy.y - pad, maxY: busy.y + pad };
        this.lastActiveT = this.t;
        this.trackedAntId = null; // a digger took over — drop the idle follow
      } else if (!this.focus || this.t - this.lastActiveT > IDLE_TO_WHOLE) {
        this.followRandomAnt(); // work done → trail a random ant about the colony, not the empty wide view
      }
      const tgt = this.fitCam(this.focus ?? this.tree.bounds);
      const k = Math.min(1, AUTOFIT_EASE * dt);
      this.cam.x += (tgt.x - this.cam.x) * k;
      this.cam.y += (tgt.y - this.cam.y) * k;
      this.cam.z += (tgt.z - this.cam.z) * k;
    }
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawBackground(ctx);
    ctx.save();
    ctx.translate(this.cam.x, this.cam.y);
    ctx.scale(this.cam.z, this.cam.z);
    if (this.tree) { this.drawSoil(ctx, this.tree); this.drawColony(ctx, this.tree); this.drawFungus(ctx, this.tree); this.drawLeaves(ctx, this.tree); this.drawFlora(ctx, this.tree); this.drawAnts(ctx, this.tree); }
    ctx.restore();
    this.drawRain(ctx, dt);
  }

  private drawBackground(ctx: CanvasRenderingContext2D): void {
    const surf = this.cam.y, z = this.cam.z; // world y=0 in screen space
    ctx.fillStyle = COL.sky;
    ctx.fillRect(0, 0, this.vw, this.vh);
    const gh = GRASS_H * z;
    if (surf > 0) {
      // grass bank with a ROLLING top silhouette, sampled on a fixed WORLD grid so
      // its shape is zoom-invariant — no reshaping or flicker as you zoom/pan (the
      // old screen-space stepping undersampled the noise when zoomed out → jaggies).
      const gTop = surf - gh;
      const gg = ctx.createLinearGradient(0, gTop - 22 * z, 0, surf);
      gg.addColorStop(0, COL.grassTop); gg.addColorStop(1, COL.grassBot);
      ctx.fillStyle = gg;
      ctx.beginPath(); ctx.moveTo(-20, surf + 1);
      const ws = 20, wL = (-20 - this.cam.x) / z, wR = (this.vw + 20 - this.cam.x) / z;
      for (let wx = Math.floor(wL / ws) * ws; wx <= wR + ws; wx += ws) {
        const hill = (noise(wx * 0.006 + 3) - 0.5) * 36 + (noise(wx * 0.022 + 9) - 0.5) * 6; // broad roll + gentle bumps
        ctx.lineTo(this.cam.x + wx * z, gTop + hill * z);
      }
      ctx.lineTo(this.vw + 20, surf + 1); ctx.closePath(); ctx.fill();
    }

    // banded earth: each horizon a flat fill bounded by a wavy seam, keyed to
    // WORLD depth and mapped to screen — clear strata, not a smooth fade.
    const top = Math.max(0, surf);
    if (top < this.vh) {
      // also sampled on a fixed WORLD grid (same reason as the grass) so the wavy
      // seams between horizons hold their shape and don't shimmer when zoomed out.
      // BOTH edges sample the SAME fixed world grid (lo, lo+ws, … hi) so adjacent bands
      // share an identical boundary polyline — no sliding sliver/jitter on pan or zoom.
      const ws = 22, wL = (-ws - this.cam.x) / z, wR = (this.vw + ws - this.cam.x) / z;
      const lo = Math.floor(wL / ws) * ws;
      const hi = lo + Math.ceil((wR + ws - lo) / ws) * ws; // grid-aligned right edge
      const sy = (d: number, wx: number) => surf + (d === 0 ? 0 : seamY(d, wx)) * z;
      for (let i = 0; i < HORIZONS.length; i++) {
        const dTop = HORIZONS[i].d, dBot = i + 1 < HORIZONS.length ? HORIZONS[i + 1].d : SOIL_DEEP + 6000;
        if (surf + dTop * z > this.vh) break;   // this band (and every deeper one) is below the view
        if (surf + dBot * z < 0) continue;       // band entirely above the view
        ctx.beginPath();
        let k = 0;
        for (let wx = lo; wx <= hi; wx += ws, k++) { const sx = this.cam.x + wx * z; const y = sy(dTop, wx); k ? ctx.lineTo(sx, y) : ctx.moveTo(sx, y); }
        for (let wx = hi; wx >= lo; wx -= ws) ctx.lineTo(this.cam.x + wx * z, sy(dBot, wx));
        ctx.closePath();
        ctx.fillStyle = HORIZONS[i].c; ctx.fill();
      }
    }

    // surface dressing — a dark humus lip, tufted grass of varied height/lean,
    // scattered clods/stones, and the colony entrance: the ground isn't a flat line.
    if (surf > -12 && surf < this.vh + 12) {
      ctx.fillStyle = COL.humus; ctx.fillRect(0, surf, this.vw, Math.max(1.5, 4 * z));
      const bL = -this.cam.x / z, bR = (this.vw - this.cam.x) / z;
      if (z > 0.34) { // blades + clods turn to sub-pixel noise when zoomed out — skip them (the bank carries it)
        ctx.lineCap = "round"; ctx.lineWidth = Math.max(1, 1.4 * z);
        for (let wx = Math.floor(bL / 6) * 6; wx <= bR; wx += 6) { // blades on a fixed world grid — stable, no shimmer
          const n = noise(wx * 0.5 + 11);
          ctx.strokeStyle = n > 0.72 ? COL.grassTip : COL.grassTop;
          const h = (4 + n * 10) * z, lean = (n - 0.5) * 6 * z, sx = this.cam.x + wx * z;
          ctx.beginPath(); ctx.moveTo(sx, surf + 1); ctx.lineTo(sx + lean, surf - h); ctx.stroke();
        }
        for (let wx = Math.floor(bL / 40) * 40; wx <= bR; wx += 40) {
          const n = noise(wx * 0.3 + 4); if (n > 0.32) continue; // clods here and there, not everywhere
          const sx = this.cam.x + (wx + n * 28) * z, r = (2 + n * 14) * z * 0.5;
          ctx.fillStyle = n < 0.1 ? COL.pebbleDk : COL.pebble;
          ctx.beginPath(); ctx.ellipse(sx, surf - r * 0.25, r, r * 0.66, 0, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = COL.pebbleLit;
          ctx.beginPath(); ctx.ellipse(sx - r * 0.3, surf - r * 0.5, r * 0.34, r * 0.26, 0, 0, Math.PI * 2); ctx.fill();
        }
      }
      // one entrance per session — the queen's central hole plus each later session's own
      ctx.fillStyle = COL.hole;
      for (const h of this.tree?.holes ?? [{ x: 0, y: 0 }]) {
        const hx = this.cam.x + h.x * z;
        ctx.beginPath(); ctx.ellipse(hx, surf, 9 * z, 4 * z, 0, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  /** Detail in the UNDUG earth: faint strata seams, scattered pebbles, and roots
   *  dangling from the surface. Drawn in world space (scrolls with the colony) and
   *  BEHIND the excavation, which paints over it — so detail shows only in dirt,
   *  never in the hollows. */
  private drawSoil(ctx: CanvasRenderingContext2D, t: Tree): void {
    const z = this.cam.z;
    const wx0 = -this.cam.x / z, wx1 = (this.vw - this.cam.x) / z;
    const wy1 = (this.vh - this.cam.y) / z;
    if (wy1 <= 6) return; // surface at/below the bottom of the view → no soil on screen
    const wy0 = Math.max(4, -this.cam.y / z);

    // strata seams — a dark crease with a thin lighter lip just under it, riding
    // each horizon boundary: the compacted line where one layer meets the next.
    // Step MUST match the band-fill grid (ws=22) so the crease sits exactly on the
    // boundary polyline rather than a slightly different sampling of the same wave.
    const SEAM_STEP = 22;
    for (let i = 1; i < HORIZONS.length; i++) {
      const d = HORIZONS[i].d;
      if (d + 34 < wy0 || d - 34 > wy1) continue;
      for (let pass = 0; pass < 2; pass++) {
        ctx.strokeStyle = pass ? COL.seamLip : COL.seam;
        ctx.lineWidth = Math.max(0.6, (pass ? 0.7 : 1.5) / z);
        ctx.beginPath();
        for (let x = Math.floor(wx0 / SEAM_STEP) * SEAM_STEP, k = 0; x <= wx1 + SEAM_STEP; x += SEAM_STEP, k++) {
          const yy = seamY(d, x) + (pass ? 2.4 : 0);
          k ? ctx.lineTo(x, yy) : ctx.moveTo(x, yy);
        }
        ctx.stroke();
      }
    }

    if (z <= 0.3) return; // zoomed way out — grain would be sub-pixel; bands carry it

    // pebbles — denser AND bigger with depth (soil coarsens toward the parent rock)
    const G = 72;
    for (let gx = Math.floor(wx0 / G) * G; gx <= wx1; gx += G) {
      for (let gy = Math.max(0, Math.floor(wy0 / G) * G); gy <= Math.min(wy1, BEDROCK_D); gy += G) {
        const depth = clamp(gy / BEDROCK_D, 0, 1);
        const e = noise(gx * 0.013 + gy * 0.071 + 3.1);
        if (e > 0.22 + depth * 0.42) continue;
        const px = gx + noise(gx * 1.7 + gy) * G, py = gy + noise(gy * 1.3 + gx) * G;
        if (py < 30 || py > BEDROCK_D) continue;
        const r = 1.3 + noise(gx + gy * 0.5 + 9) * (2.2 + depth * 5.5);
        ctx.fillStyle = e < 0.08 ? COL.pebbleDk : COL.pebble;
        ctx.beginPath(); ctx.ellipse(px, py, r, r * 0.76, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = COL.pebbleLit;
        ctx.beginPath(); ctx.ellipse(px - r * 0.28, py - r * 0.3, r * 0.32, r * 0.26, 0, 0, Math.PI * 2); ctx.fill();
      }
    }

    // bedrock — packed cobbles below the deepest horizon
    this.drawBedrock(ctx, wx0, wx1, wy0, wy1);

    // roots dangling from the surface into the topsoil, along the colony's span
    if (wy0 < 230 && t.nodes.length) {
      ctx.strokeStyle = COL.root; ctx.lineWidth = Math.max(0.5, 1.5 / z);
      const x0 = Math.max(wx0, t.bounds.minX - 130), x1 = Math.min(wx1, t.bounds.maxX + 130);
      for (let x = Math.floor(x0 / 64) * 64; x <= x1; x += 64) {
        if (noise(x * 0.05 + 7) > 0.6) continue;
        this.drawRoot(ctx, x + (noise(x) - 0.5) * 34, 64 + noise(x * 0.3 + 2) * 120);
      }
    }
  }

  /** Packed cobblestone bedrock below the deepest horizon: chunky stones with a
   *  lit cap and dark mortar gaps, brick-staggered. World space, behind the
   *  excavation (chambers dug into it paint over → it shows only in undug rock). */
  private drawBedrock(ctx: CanvasRenderingContext2D, wx0: number, wx1: number, wy0: number, wy1: number): void {
    if (wy1 < BEDROCK_D) return;
    const G = 42;
    for (let gy = Math.floor(BEDROCK_D / G) * G; gy <= wy1; gy += G) {
      if (gy + G < wy0) continue;
      const row = ((gy / G) | 0) & 1 ? G * 0.5 : 0; // brick-stagger alternate rows
      for (let gx = Math.floor((wx0 - row) / G) * G + row; gx <= wx1 + G; gx += G) {
        const cx = gx + (noise(gx * 0.11 + gy * 0.37) - 0.5) * G * 0.5;
        const cy = gy + (noise(gx * 0.29 + gy * 0.13) - 0.5) * G * 0.5;
        if (cy < BEDROCK_D - 6) continue; // keep stones inside the band
        const r = G * (0.44 + noise(gx * 0.7 + gy * 0.5) * 0.2);
        const tone = noise(gx * 0.5 + gy * 1.3 + 2);
        blob(ctx, cx, cy, r, Math.floor(noise(gx * 0.5 + gy) * 9973));
        ctx.fillStyle = tone < 0.3 ? COL.cobbleDk : tone > 0.78 ? COL.cobbleLit : COL.cobble;
        ctx.fill();
        ctx.strokeStyle = COL.mortar; ctx.lineWidth = Math.max(0.7, 1.3 / this.cam.z); ctx.stroke();
        ctx.fillStyle = COL.cobbleLit; // lit cap
        ctx.beginPath(); ctx.ellipse(cx - r * 0.22, cy - r * 0.4, r * 0.42, r * 0.26, 0, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  /** A wavy, tapering root tendril from the surface straight down, maybe forking once. */
  private drawRoot(ctx: CanvasRenderingContext2D, x: number, len: number): void {
    let cx = x, cy = 0, ang = Math.PI / 2 + (noise(x + 5) - 0.5) * 0.4;
    const steps = Math.max(3, Math.round(len / 16)), seg = len / steps;
    ctx.beginPath(); ctx.moveTo(cx, cy);
    for (let i = 1; i <= steps; i++) {
      ang += (noise(x + i * 3.3) - 0.5) * 0.5;
      cx += Math.cos(ang) * seg; cy += Math.sin(ang) * seg;
      ctx.lineTo(cx, cy);
      if (i === Math.round(steps * 0.55) && noise(x + 2) > 0.5) { // a single fork
        const fa = ang + (noise(x + 4) - 0.5) * 1.3, fl = len * 0.32;
        ctx.lineTo(cx + Math.cos(fa) * fl, cy + Math.sin(fa) * fl);
        ctx.moveTo(cx, cy);
      }
    }
    ctx.stroke();
  }

  /** The whole excavation as ONE connected hollow: chambers and the tunnels
   *  between them are dug in the same layered passes (rim, then cavity), so a
   *  chamber's wall breaks open into its tunnels instead of being a closed ring.
   *  Tunnels meander with rough, uneven walls — hand-dug, not ruled. */
  /** A chamber wall/floor tint: teal-mossy when it holds fungus, sick jaundiced-olive
   *  when blighted (a deletion turn or a stuck frontier), plain dug soil otherwise.
   *  Blight wins when it outweighs the crop, so a wilted garden reads as sick, not lush. */
  private chamberTint(n: CNode, base: string, moss: string, blight: string, k: number): string {
    const c = n.crop ?? 0, b = n.blight ?? 0;
    return b > c ? mix(base, blight, Math.min(1, b) * k) : mix(base, moss, c * k);
  }

  /** Is this world point (with radius r) anywhere near the viewport? Skips drawing the
   *  off-screen majority of chambers/ants/fungus when zoomed in — the big panning win. */
  private inView(x: number, y: number, r: number): boolean {
    const sx = x * this.cam.z + this.cam.x, sy = y * this.cam.z + this.cam.y;
    const pad = r * this.cam.z + 48;
    return sx > -pad && sx < this.vw + pad && sy > -pad && sy < this.vh + pad;
  }

  private drawColony(ctx: CanvasRenderingContext2D, t: Tree): void {
    // each tunnel is only drawn as far as it's been carved (carve 0..1); skip the ones
    // whose whole span sits off-screen so panning a big colony stays cheap.
    const paths = t.tunnels
      .filter((tn) => this.inView(tn.pts[0].x, tn.pts[0].y, tn.w) || this.inView(tn.pts[tn.pts.length - 1].x, tn.pts[tn.pts.length - 1].y, tn.w))
      .map((tn) => ({ pts: partialPts(tn.pts, tn.carve), w: tn.w }));
    const vis = t.nodes.filter((n) => !n.hung && this.inView(n.x, n.y, n.r + 4)); // on-screen chambers only; a hung turn is just its trailing tunnel — no chamber

    // pass 1 — outer excavated soil (the darkest rim); fungus walls go mossy, blighted ones jaundiced, the queen's gilded
    for (const p of paths) strokeVary(ctx, p.pts, p.w * 1.55, COL.dugRimDeep);
    for (const n of vis) { blob(ctx, n.x, n.y, n.r + 4, hash(n.id) % 9973); ctx.fillStyle = n.isQueen ? COL.goldDeep : this.chamberTint(n, COL.dugRimDeep, COL.mossDeep, COL.blightDeep, 0.75); ctx.fill(); }

    // pass 2 — inner dug rim (teal-mossy with crop, jaundiced when blighted, gold for the queen)
    for (const p of paths) strokeVary(ctx, p.pts, p.w * 1.28, COL.dugRim);
    for (const n of vis) { blob(ctx, n.x, n.y, n.r + 1.8, hash(n.id) % 9973); ctx.fillStyle = n.isQueen ? COL.gold : this.chamberTint(n, COL.dugRim, COL.moss, COL.blight, 0.75); ctx.fill(); }

    // pass 3 — the hollow itself; drawn last so tunnel & chamber voids merge
    for (const p of paths) strokeVary(ctx, p.pts, p.w, COL.cavity);
    for (const n of vis) {
      blob(ctx, n.x, n.y, n.r, hash(n.id) % 9973);
      const g = ctx.createRadialGradient(n.x, n.y - n.r * 0.35, n.r * 0.15, n.x, n.y, n.r);
      // lush rooms get a faint teal cellar glow, blighted ones a sick olive; the queen's
      // hollow stays near-neutral (just a whisper of warmth) — her GOLD RIM is what marks her.
      g.addColorStop(0, n.isQueen ? mix(COL.cavityCore, COL.goldGlow, 0.1) : this.chamberTint(n, COL.cavityCore, COL.cavityMoss, COL.blightCore, 0.55));
      g.addColorStop(1, COL.cavity);
      ctx.fillStyle = g; ctx.fill();
    }

    // pass 4 — a boulder where a dig was interrupted (hit a rock, couldn't continue)
    for (const n of vis) if (n.blocked) this.drawRock(ctx, n);

    // pass 5 — what lives in the rooms
    for (const n of vis) this.drawEgg(ctx, n);

    if (this.selectedId) this.drawSelection(ctx, t);
  }

  /** A boulder plugging an interrupted dig: covers the little pocket and the tunnel
   *  mouth, so the tunnel reads as "dug this far, then hit rock". */
  private drawRock(ctx: CanvasRenderingContext2D, n: CNode): void {
    const r = Math.max(15, n.r) + 5;
    const seed = hash(n.id) % 9973;
    blob(ctx, n.x, n.y + 1.5, r + 2.5, seed); ctx.fillStyle = COL.rockEdge; ctx.fill(); // grounding shadow
    blob(ctx, n.x, n.y, r, seed);
    const g = ctx.createLinearGradient(n.x - r, n.y - r, n.x + r, n.y + r);
    g.addColorStop(0, COL.rockLit); g.addColorStop(0.55, COL.rock); g.addColorStop(1, COL.rockDk);
    ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = COL.rockDk; ctx.lineWidth = 1.1; // a few facets
    ctx.beginPath();
    ctx.moveTo(n.x - r * 0.32, n.y - r * 0.42); ctx.lineTo(n.x + r * 0.06, n.y + r * 0.08); ctx.lineTo(n.x + r * 0.42, n.y - r * 0.06);
    ctx.moveTo(n.x + r * 0.06, n.y + r * 0.08); ctx.lineTo(n.x - r * 0.1, n.y + r * 0.42);
    ctx.stroke();
    ctx.fillStyle = COL.rockLit; // specular glint
    ctx.beginPath(); ctx.ellipse(n.x - r * 0.36, n.y - r * 0.4, r * 0.2, r * 0.14, -0.5, 0, Math.PI * 2); ctx.fill();
  }

  /** Ring the selected chamber and the tunnel its founder dug. */
  private drawSelection(ctx: CanvasRenderingContext2D, t: Tree): void {
    const sel = t.nodes.find((n) => n.id === this.selectedId);
    if (!sel) return;
    const tun = t.tunnels.find((tn) => tn.toId === this.selectedId && !tn.cross);
    if (tun) {
      const pts = partialPts(tun.pts, tun.carve);
      if (pts.length > 1) { strokeVary(ctx, pts, tun.w * 0.5, COL.highlight); }
    }
    ctx.beginPath();
    ctx.ellipse(sel.x, sel.y, sel.r + 5, (sel.r + 5) * 0.86, 0, 0, Math.PI * 2);
    ctx.strokeStyle = COL.highlight; ctx.lineWidth = 2.4; ctx.stroke();
  }

  /** The chamber's single egg: intact, mid-hatch (cracked), or gone (just dug).
   *  Nestled off-centre against a wall, sized to the room. */
  private drawEgg(ctx: CanvasRenderingContext2D, n: CNode): void {
    if (n.egg === "none" || n.isQueen) return; // the queen herself sits here
    const s = SPRITE_BY_CASTE[n.egg === "hatched" ? "egg2" : "egg"];
    if (!s) return;
    const px = Math.min(1.05, (n.r * 1.7) / s.h);
    const seed = hash(n.id) % 9973;
    const side = hash(n.id) % 2 ? 1 : -1; // the brood sits on ONE side; the fungus grows on the other
    ctx.save();
    ctx.translate(n.x + side * n.r * 0.42, n.y - n.r * 0.05 + (noise(seed) - 0.5) * n.r * 0.22);
    drawSprite(ctx, s, px);
    ctx.restore();
  }

  /** The fungus the colony farms on its diff: a patch on each chamber's floor sized
   *  to its crop (spot → cluster → bloom), a dull blight on deletion turns, and the
   *  queen's central larder heap. Drawn on the chamber floor, under leaves and ants. */
  private drawFungus(ctx: CanvasRenderingContext2D, t: Tree): void {
    for (const n of t.nodes) {
      if (n.hung || !this.inView(n.x, n.y, n.r)) continue; // skip off-screen gardens + abandoned (hung) digs
      if (n.isQueen) { this.drawPile(ctx, n, t.pile ?? 0); continue; } // fresh hauled fungus heaps on her floor; the repletes (ants) eat it
      if (n.blocked) continue; // a boulder (interrupted dig) is bare rock — no fungus grows on it
      const crop = n.crop ?? 0, blight = n.blight ?? 0;
      const side = hash(n.id) % 2 ? 1 : -1;        // matches drawEgg — fungus on the OPPOSITE side from the brood
      const bx = n.x - side * n.r * 0.34;          // the fungus side of the chamber floor
      if (crop < 0.04 && blight > 0.05) {
        const s = FUNGUS_BY_NAME["fungus · blight"]; // a spent/deletion patch, awaiting weeding
        ctx.save();
        ctx.translate(bx, n.y + n.r * 0.42);
        drawSprite(ctx, s, Math.min(1.0, (n.r * 1.3) / s.w));
        ctx.restore();
        continue;
      }
      if (crop < 0.04) continue;
      // a chamber's fungus STASH scales with its diff — a big edit grows a big bed of
      // many small mushrooms (the colony's food store), filling in as the crop grows.
      const fs = SPRITE_BY_CASTE["fungus"];
      const seed = hash(n.id + "f") % 9973;
      const net = Math.max(0, (n.linesAdded ?? 0) - (n.linesRemoved ?? 0));
      const maxCaps = clamp(1 + Math.floor(net / 35), 1, 22); // large diffs → large stashes
      const count = Math.max(1, Math.ceil(crop * maxCaps));
      const px = clamp(n.r * 0.03, 0.8, 1.9);                 // small caps (there can be many)
      for (let i = 0; i < count; i++) {
        ctx.save();
        ctx.translate(bx + (noise(seed + i * 2) - 0.5) * n.r * 0.72, n.y + n.r * 0.36 + (noise(seed + i * 3) - 0.25) * n.r * 0.34); // a bed on the floor
        drawSprite(ctx, fs, px);
        ctx.restore();
      }
    }
  }

  /** The fresh fungus the haulers heap on the queen's chamber floor — it grows as food
   *  arrives and shrinks as the repletes (drawn as ants) eat it to bulk up. */
  private drawPile(ctx: CanvasRenderingContext2D, n: CNode, pile: number): void {
    if (pile < 0.02) return;
    const fs = SPRITE_BY_CASTE["fungus"];
    const seed = hash(n.id + "p") % 9973;
    const count = Math.ceil(pile * 16);          // a heap that grows with how much is stored
    const px = clamp(n.r * 0.04, 1.0, 2.4);
    for (let i = 0; i < count; i++) {
      ctx.save();
      ctx.translate(n.x + (noise(seed + i * 2) - 0.5) * n.r * 0.62, n.y + n.r * 0.08 + (noise(seed + i * 3) - 0.2) * n.r * 0.26);
      drawSprite(ctx, fs, px);
      ctx.restore();
    }
  }

  /** Leaves foragers have hauled home, lying where they were dropped in chambers. */
  private drawLeaves(ctx: CanvasRenderingContext2D, t: Tree): void {
    const s = FLORA_BY_NAME["leaf"];
    if (!s) return;
    for (const l of t.leaves) {
      if (!this.inView(l.x, l.y, 4)) continue;
      ctx.save();
      ctx.translate(l.x, l.y);
      drawSprite(ctx, s, LEAF_PX);
      ctx.restore();
    }
  }

  /** Surface foliage, rooted at y=0 and growing up into the grass band. */
  private drawFlora(ctx: CanvasRenderingContext2D, t: Tree): void {
    for (const f of t.flora) {
      const s = FLORA_BY_NAME[f.name];
      if (!s) continue;
      ctx.save();
      ctx.translate(f.x, -(s.h / 2) * FLORA_PX); // base sits on the surface line
      drawSprite(ctx, s, FLORA_PX);
      ctx.restore();
    }
  }

  private drawAnts(ctx: CanvasRenderingContext2D, t: Tree): void {
    if (this.rainLevel > 0.4) return; // taken cover
    // when a chamber is selected: its founder glows, the brood it spawned (its
    // children's founders) gets a fainter ring.
    const brood = this.selectedId
      ? new Set(t.tunnels.filter((tn) => tn.fromId === this.selectedId && !tn.cross).map((tn) => tn.toId))
      : null;
    for (const a of t.ants) {
      if (!this.inView(a.x, a.y, 16)) continue; // skip off-screen ants
      const s = SPRITE_BY_CASTE[a.sprite ?? a.caste] ?? SPRITE_BY_CASTE["worker"];
      if (!s) continue;
      if (a.digging) { // a soft pulse marks an agent actively working
        const ph = 0.5 + 0.5 * Math.sin(this.t * 0.12);
        ctx.beginPath(); ctx.arc(a.x, a.y, 12 + ph * 4, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(232,176,75,${0.22 + 0.3 * ph})`; ctx.lineWidth = 1.6; ctx.stroke();
      }
      if (this.selectedId && a.antId) {
        if (a.antId === this.selectedId) this.antRing(ctx, a.x, a.y, COL.highlight, 1.8);
        else if (brood?.has(a.antId)) this.antRing(ctx, a.x, a.y, COL.highlightDim, 1.2);
      }
      if (this.selectedAntId && a.antId === this.selectedAntId) { // a clicked ant: pulse, no chamber fuss
        const ph = 0.5 + 0.5 * Math.sin(this.t * 0.12);
        ctx.beginPath(); ctx.arc(a.x, a.y, 9 + ph * 3, 0, Math.PI * 2);
        ctx.strokeStyle = COL.highlight; ctx.lineWidth = 1.8; ctx.stroke();
      }
      // Everyone faces the way they're moving; the queen is just bigger.
      ctx.save();
      if (a.alpha !== undefined) ctx.globalAlpha = a.alpha;
      ctx.translate(a.x, a.y);
      if (a.replete !== undefined) {
        // a living larder (honeypot replete): the sprite fattens as the colony's reserve
        // fills (larder → larder1 → larder2). Hangs un-rotated, abdomen dangling.
        const name = a.replete < 0.34 ? "larder" : a.replete < 0.7 ? "larder1" : "larder2";
        const ph = a.x * 0.07; // a gentle hang-sway + breathing so they're alive, not frozen
        ctx.rotate(Math.sin(this.t * 0.025 + ph) * 0.05);
        drawSprite(ctx, SPRITE_BY_CASTE[name] ?? SPRITE_BY_CASTE["larder"], ANT_PX * 1.7 * (1 + Math.sin(this.t * 0.045 + ph) * 0.025)); // swollen, bigger than a worker
      } else {
        ctx.rotate(a.angle + Math.PI / 2);
        drawSprite(ctx, s, a.caste === "queen" ? ANT_PX * 2.5 : ANT_PX);
      }
      ctx.restore();
      if (this.cam.z >= EMOTE_ZOOM) this.drawEmote(ctx, a); // a little mood glyph, only when looking close
    }
  }

  /** A small blinking mood glyph above an ant — hungry "!", sleepy "z", a tending
   *  spore — out of sync per ant, shown only ~40% of the time so it reads as a blink. */
  private drawEmote(ctx: CanvasRenderingContext2D, a: AntDot): void {
    if (a.replete !== undefined || a.digging) return;
    let kind = 0; // 1 = hungry, 2 = resting, 3 = tending
    if (a.mood === "hungry" || a.mood === "seeking food") kind = 1;
    else if (a.mood === "resting") kind = 2;
    else if (a.mood === "tending the fungus") kind = 3;
    if (!kind) return;
    const seed = hash((a.antId || "") + (a.name || "")) % 997;
    const cyc = (this.t * 0.012 + seed / 997) % 1;
    if (cyc > 0.4) return;                       // hidden most of the time → a blink
    const fade = Math.sin((cyc / 0.4) * Math.PI); // ease in and out
    const x = a.x, y = a.y - 9 - Math.sin(this.t * 0.05 + seed) * 0.6;
    ctx.save();
    ctx.globalAlpha = 0.9 * fade;
    if (kind === 1) { // hungry "!"
      ctx.fillStyle = "#e8b04b";
      ctx.fillRect(x - 0.55, y - 3, 1.1, 2.1);
      ctx.fillRect(x - 0.55, y - 0.3, 1.1, 1.0);
    } else if (kind === 2) { // sleepy "z"
      ctx.strokeStyle = "rgba(190,200,220,0.9)"; ctx.lineWidth = 0.7; ctx.lineJoin = "round";
      ctx.beginPath(); ctx.moveTo(x - 1.3, y - 2.6); ctx.lineTo(x + 1.3, y - 2.6); ctx.lineTo(x - 1.3, y); ctx.lineTo(x + 1.3, y); ctx.stroke();
    } else { // tending: a little spore
      ctx.fillStyle = "#7fd6c0";
      ctx.beginPath(); ctx.arc(x, y - 1.5, 1.0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }


  private antRing(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, w: number): void {
    ctx.beginPath(); ctx.arc(x, y, 11, 0, Math.PI * 2);
    ctx.strokeStyle = color; ctx.lineWidth = w; ctx.stroke();
  }

  private drawRain(ctx: CanvasRenderingContext2D, dt: number): void {
    const target = this.alarm ? 1 : 0;
    if (target === 0 && this.rainLevel === 0) return;
    this.rainLevel += (target - this.rainLevel) * Math.min(1, 0.09 * dt);
    if (this.rainLevel < 0.01 && target === 0) { this.rainLevel = 0; return; }
    const lvl = this.rainLevel;
    ctx.fillStyle = `rgba(16,20,31,${0.26 * lvl})`;
    ctx.fillRect(0, 0, this.vw, this.vh);
    ctx.strokeStyle = `rgba(169,194,216,${0.5 * lvl})`; ctx.lineWidth = 1;
    for (const d of this.drops) {
      d.y += d.speed * dt; d.x += 1.4 * dt;
      if (d.y > this.vh) { d.y -= this.vh + Math.random() * 20; d.x = Math.random() * this.vw; }
      else if (d.x > this.vw) d.x -= this.vw;
      ctx.beginPath(); ctx.moveTo(d.x, d.y); ctx.lineTo(d.x - 3, d.y - d.len); ctx.stroke();
    }
  }

  private seedRain(): void {
    const n = Math.max(40, Math.floor(this.vw / 11));
    this.drops = Array.from({ length: n }, () => ({
      x: Math.random() * this.vw, y: Math.random() * this.vh,
      len: 6 + Math.random() * 9, speed: 6 + Math.random() * 6,
    }));
  }
}

/** Irregular closed cavity path centered at (cx,cy), radius r — stable per seed,
 *  squashed slightly so chambers read wider than tall (dug, not drawn). */
function blob(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, seed: number): void {
  const pts = 12;
  ctx.beginPath();
  for (let i = 0; i <= pts; i++) {
    const a = (i / pts) * Math.PI * 2;
    // wrap the noise index so the last point matches the first — no seam/notch
    const rr = r * (1 + (noise(seed + (i % pts) * 3) - 0.5) * 0.34);
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr * 0.84;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/** The leading portion of a polyline, cut at fraction `carve` of its length —
 *  so a half-dug tunnel is drawn only halfway. */
function partialPts(pts: Array<{ x: number; y: number }>, carve: number): Array<{ x: number; y: number }> {
  if (carve >= 1 || pts.length < 2) return pts;
  if (carve <= 0) return [pts[0]];
  let total = 0;
  const seg: number[] = [];
  for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); seg.push(l); total += l; }
  let target = total * carve;
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const l = seg[i - 1];
    if (target >= l) { out.push(pts[i]); target -= l; }
    else { const f = target / l; out.push({ x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * f, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * f }); break; }
  }
  return out;
}

/** Shortest distance from a point to a polyline. */
function distToPath(px: number, py: number, pts: Array<{ x: number; y: number }>): number {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const ax = pts[i - 1].x, ay = pts[i - 1].y, bx = pts[i].x, by = pts[i].y;
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy || 1e-6;
    let t = ((px - ax) * dx + (py - ay) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    best = Math.min(best, Math.hypot(px - (ax + t * dx), py - (ay + t * dy)));
  }
  return best;
}

/** Stroke a polyline as a channel whose width breathes along its length —
 *  drawn segment-by-segment with round caps so the walls read hand-dug, not
 *  ruled. Width is keyed to position so it's steady frame-to-frame. */
function strokeVary(ctx: CanvasRenderingContext2D, pts: Array<{ x: number; y: number }>, base: number, color: string): void {
  if (pts.length < 2) return;
  ctx.strokeStyle = color; ctx.lineCap = "round"; ctx.lineJoin = "round";
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    // width breathes but never narrows below ~ant-width (the cavity must fit them)
    const wf = 0.88 + 0.18 * noise(Math.round(a.x + b.x) + Math.round(a.y + b.y) * 0.137);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
    ctx.lineWidth = base * wf; ctx.stroke();
  }
}

/** Wavy world-y of a horizon boundary at world-x — gives strata an organic,
 *  non-ruled edge (two octaves). Deterministic; a band always waves the same. */
function seamY(d: number, x: number): number {
  return d + (noise(x * 0.021 + d) - 0.5) * 12 + (noise(x * 0.0065 + d * 0.5) - 0.5) * 7;
}

/** Lerp between two #rrggbb colours (t clamped 0..1) → an rgb() string. */
function mix(a: string, b: string, t: number): string {
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const r = Math.round((pa >> 16) + (((pb >> 16) - (pa >> 16)) * t));
  const g = Math.round(((pa >> 8) & 255) + ((((pb >> 8) & 255) - ((pa >> 8) & 255)) * t));
  const bl = Math.round((pa & 255) + (((pb & 255) - (pa & 255)) * t));
  return `rgb(${r},${g},${bl})`;
}

/** Deterministic [0,1) noise from an integer-ish seed. */
function noise(i: number): number {
  const x = Math.sin(i * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
