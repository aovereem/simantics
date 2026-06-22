import type { Caste } from "@simantics/shared";
import type { AntDot, CNode, ForageInfo, Pt, Tree, Tunnel } from "./tree.js";
import { SURFACE } from "./tree.js";
import { cropTarget, CROP_REGROW, CROP_SEED, LEAF_YIELD, clamp } from "./layout.js";

/**
 * The living colony. The layout hands over a blueprint (collision-free chamber
 * positions + meandering tunnel paths); this sim animates it into being:
 *
 *   - It steps through the chambers in the order they were dug. For each, a
 *     digger ant leaves the parent chamber and CARVES the tunnel as it walks —
 *     the tunnel only exists as far as the ant has dug.
 *   - When the ant arrives it opens the new chamber, then stays on as a resident
 *     and WANDERS the colony, so the place stays busy instead of dead.
 *   - The founding digger becomes the queen, who keeps to her chamber.
 *
 * Positions come straight from the blueprint, so nothing the ants build ever
 * jumps; the sim only owns motion and reveal timing.
 */

// Ants crawl at a believable pace — the historical backlog is loaded instantly
// (see fastForward), so only NEW/live digs animate, and they do so at ant speed.
const DIG_SPEED = 1.4;     // world units / frame while carving
const WALK_SPEED = 0.55;   // ... while wandering
const GROW = 0.12;         // how fast a freshly-dug chamber opens to full size
const MAX_DIGS = 3;        // diggers carving at once
const MAX_WALKERS = 22;    // residents roaming at once (others rest in rooms) — a livelier warren
const REST_MIN = 40, REST_MAX = 180; // frames an ant lingers before its next outing
const JOURNEY_MIN = 2, JOURNEY_VAR = 4; // rooms an ant roams through per outing (2..5), not one hop
const PATROL_HOPS_MIN = 3, PATROL_HOPS_VAR = 4; // out-leg budget (3..6 rooms deep); the inbound leg runs until home
// harvest economy: workers grow hungry, ferry fungus crop home to the queen's
// larder, and eat from it; a few become living-larder "repletes" in her chamber.
const HUNGER_RATE = 0.0005;        // how fast a worker gets hungry (per frame) — occasional, not constant
const HUNGER_HUNGRY = 0.6;         // above this, a worker heads home to eat
const CARRY_LOAD = 0.22;           // crop a worker hauls per trip
const LARDER_BITE = 0.04;          // larder drawn down when a hungry worker feeds from the reserve
const LARDER_IDLE_DRAIN = 0.0002;  // larder slowly eaten down when the colony's idle (the reserve persists)
const REPLETE_TARGET = 8;          // cap on living-larder ants hanging in the queen's chamber
const REPLETE_MIN = 0.04;          // a replete returns to work once the reserve is eaten down below this (depleted, not timed)
const RECRUIT_CHANCE = 0.09;       // chance a roaming worker is enlisted as a replete (while short of target)
const REPLETE_BULK_RATE = 0.0008;  // how fast repletes consume the chamber pile to swell their bulk
const QUEEN_SPEED = 0.16;  // she ambles slowly about her chamber
const AMBLE_SPEED = 0.34;  // resting ants mosey around their room (not frozen)
// A turn is ONE chamber, but the agent keeps working it long after the tunnel is
// carved. While facts are still landing on the frontier chamber (within this
// window of the last one) its ant stays "working" — so the colony doesn't fall
// quiet and the camera doesn't pull away while the agent is plainly still busy.
// Sized to bridge the gaps in how the transcript is written: it's appended in
// bursts (mostly ~1/s during work, but with 30–60s lulls on heavy thinking
// steps), so a tight window would flicker to "quiet" mid-turn. The cost is the
// colony lingers "busy" ~this long after work actually stops, then settles.
const ACTIVE_MS = 60000;

// surface foliage: each turn one plant may sprout, and any plant may grow a stage
const FLORA_STAGES: Record<string, string[]> = {
  grass: ["grass · sprout", "grass · growing", "grass · tuft"],
  dandelion: ["dandelion · sprout", "dandelion · flower", "dandelion · fluff", "dandelion · bare"],
  mushroom: ["mushroom · button", "mushroom · grown", "mushroom · large"],
  clover: ["clover · sprout", "clover · pair", "clover · trefoil"],
};
const GROW_CHANCE = 0.26;
const FLORA_MAX = 130;

interface Plant { type: string; stage: number; x: number; }

// forager round-trip: out (empty) up to the surface, roam the grass while the
// fetch is in flight, then home (with a leaf) when the result lands.
const FORAGE_SPEED = 4.2;
const FORAGE_ROAM_MIN = 60;
const FORAGE_ROAM_VAR = 180;
const MAX_LEAVES = 160;
const FADE_RATE = 0.04;    // how fast a delivered forager fades out
// scouting: reads (Read/Grep/Glob = surveying code) send foragers on a SHORT near-surface
// trip that banks a leaf — so a planning/reading session feeds the colony too. The web
// fetch keeps its full surface trek (rarer, further), so it stays the premium forage.
const READS_PER_SCOUT = 7;     // reads per scout trip launched (rate-limit; reads fire constantly)
const MAX_TRIPS = 14;          // cap on concurrent foragers so scouts never swarm
const SCOUT_ROAM_MIN = 40;
const SCOUT_ROAM_VAR = 80;
interface Trip {
  id: string; chamberId: string; path: Pt[]; len: number;
  state: "out" | "roam" | "home" | "fade";
  dist: number; roamT: number; rx: number; ry: number;
  x: number; y: number; angle: number; done: boolean; scout?: boolean; fade?: number; remove?: boolean;
}

interface SCham { node: CNode; x: number; y: number; r: number; tr: number; revealed: boolean; crop: number; cropCap: number; blight: number; }
interface STun { fromId: string; toId: string; pts: Pt[]; w: number; len: number; carve: number; }
interface Nbr { pts: Pt[]; other: string; tun: STun; }
interface SAnt {
  caste: Caste; x: number; y: number; angle: number;
  state: "dig" | "walk" | "rest";
  pts?: Pt[]; len?: number; dist?: number; speed?: number;
  carveTun?: string; walkTun?: STun; arrive?: string; at?: string; rest?: number;
  queen?: boolean; qx?: number; qy?: number; hops?: number; // rooms left in the current outing
  outbound?: boolean; prev?: string; // soldier patrol: heading out from the queen vs back; last room (anti-backtrack)
  hunger?: number; carrying?: number; traveled?: number; mood?: string; // drives + harvest + lifetime distance
  replete?: boolean; goalReplete?: boolean; repleteSlot?: number; // a living larder: enlisted, hangs in its own slot in the queen's chamber until depleted
  founded?: string; name: string; // the chamber this ant dug (its identity); foragers found none
}

const NAMES = [
  "Vex", "Mara", "Tibb", "Sol", "Nim", "Cobb", "Wren", "Pax", "Bruo", "Kit",
  "Fenn", "Gus", "Lor", "Milo", "Oda", "Rue", "Sib", "Tavi", "Ulla", "Vol",
  "Wisp", "Yara", "Zib", "Cael", "Dote", "Esk", "Fray", "Gile", "Hesp", "Ona",
  "Bix", "Dax", "Pell", "Quill", "Tam", "Bram", "Hob", "Nix", "Pip", "Sage",
  "Thorn", "Burr", "Mott", "Gad", "Lum", "Vesh", "Tace", "Wim", "Yon", "Zell",
  "Bly", "Dorn", "Emm", "Fro", "Grub", "Hux", "Ivo", "Jib", "Kel", "Lark",
  "Moss", "Nub", "Orr", "Plim", "Quib", "Rix", "Snit", "Tull", "Umb", "Vire",
  "Wodge", "Xel", "Yarl", "Zane", "Arn", "Beck", "Cleo", "Drift", "Ember", "Fig",
  "Glim", "Hark", "Iro", "Jott", "Knox", "Loam", "Murk", "Noll", "Obb", "Prim",
  "Quen", "Roan", "Sten", "Tarn", "Uda", "Vesp", "Wadd", "Yarn", "Zeb", "Ash",
  "Brack", "Clay", "Dune", "Elm", "Flint", "Gorse", "Husk", "Inle", "Jute", "Kip",
  "Marl", "Nettle", "Ochre", "Peat", "Reed", "Sedge", "Tine", "Vetch", "Whin", "Bole",
  "Coom", "Delf", "Eft", "Grist", "Holt", "Jess", "Keld", "Mire", "Nape", "Pook",
  "Quirt", "Scurf", "Tansy", "Brock", "Cleat", "Gorm", "Hodge", "Jolt", "Kelp", "Linn",
  "Mulch", "Nyx", "Olm", "Pone", "Roe", "Spore", "Tuft", "Vole", "Wort", "Zinn",
];
/** A stable base name for a chamber id (hash-pick from the pool). */
function nameBase(seed: string): string {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  return NAMES[(h >>> 0) % NAMES.length];
}
/** Roman numeral, for distinguishing ants that drew the same base name. */
function roman(n: number): string {
  const tbl: [number, string][] = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
  let out = "", x = n;
  for (const [v, s] of tbl) while (x >= v) { out += s; x -= v; }
  return out;
}

export class ColonySim {
  private cham = new Map<string, SCham>();
  private tun = new Map<string, STun>();      // main galleries, keyed by toId
  private cross = new Map<string, STun>();     // junction links, keyed by from|to
  private adj = new Map<string, Nbr[]>();
  private order: string[] = [];
  private revealIdx = 0;
  private ants: SAnt[] = [];
  private booted = false; // first sync loads the existing colony instantly
  private flora: Plant[] = [];
  private trips: Trip[] = [];
  private leaves: Pt[] = []; // leaves foragers have hauled home, lying in chambers
  private leafPool = 0;      // spendable leaves banked at the colony — consumed to grow fungus
  private leavesTotal = 0;   // cumulative leaves ever foraged (the top HUD counter)
  private readsSeen = 0;     // colony-wide reads tally last sync (to spawn scouts on the delta)
  private scoutDebt = 0;     // fractional reads accrued toward the next scout trip
  private topY = 0;          // shallowest revealed chamber (entrance band)
  private queenId: string | null = null; // the queen's chamber — soldiers patrol out from it and guard it
  private qx = 0; private qy = 360;       // her position (anchor for soldier patrols)
  private pile = 0;                       // fresh hauled fungus heaped on the queen's chamber floor (0..1)
  private larder = 0;                     // the repletes' bulk (0..1) — the colony's stored reserve, eaten from the pile
  private harvest = 0;                    // colony-wide standing crop (Σ net diff), from the snapshot
  private repleteCount = 0;               // how many living-larder ants are hanging in the queen's chamber
  private foragersBorn = 0;               // cumulative foragers ever sent out — they fade, but still count toward the colony's total
  private nameSeq = new Map<string, number>(); // how many ants have drawn each base name
  private activeId: string | null = null; // frontier chamber of the most-recently-active session
  private activeTs = 0;                    // epoch ms of its last fact (drives "still working")
  private working = false;                 // is that frontier producing facts right now
  private alarm = false;                    // a session is STUCK (hit an error, not recovered) — its garden blights + soldiers rush to defend the frontier
  private meta = {
    bounds: { minX: 0, maxX: 0, minY: 0, maxY: 0 },
    newest: null as Pt | null, hole: { x: 0, y: 0 },
  };

  /** The colony's distress flag (a stuck session) — set from the snapshot's alarm. */
  setAlarm(on: boolean): void { this.alarm = on; }

  /** Fold a fresh blueprint in: add any newly-dug chambers/tunnels, update sizes. */
  sync(bp: Tree): void {
    this.meta = { bounds: bp.bounds, newest: bp.newest, hole: bp.hole };
    this.activeId = bp.newestId ?? null;
    this.activeTs = bp.newestTs ?? 0;
    this.harvest = bp.harvest ?? 0;
    for (const n of bp.nodes) {
      const cb = cropFor(n);
      const c = this.cham.get(n.id);
      // a fresh coding turn drops a SEED of fungus right away (diff spawns initial crop);
      // leaves grown later fill it toward cap. Boot chambers start at 0 — fastForward fills them.
      if (!c) { this.cham.set(n.id, { node: n, x: n.x, y: n.y, r: 0, tr: n.r, revealed: false, crop: this.booted && cb.cap > 0 ? Math.min(cb.cap, CROP_SEED) : 0, cropCap: cb.cap, blight: cb.blight }); this.order.push(n.id); }
      // a revealed room is fixed; an in-progress one still extends. Re-derive the
      // crop CAP from the latest diff, but never reset the live crop (sim owns it).
      else { c.node = n; c.tr = n.r; c.cropCap = cb.cap; c.blight = cb.blight; if (!c.revealed) { c.x = n.x; c.y = n.y; } }
    }
    for (const t of bp.tunnels) {
      if (t.cross) {
        const k = `${t.fromId}|${t.toId}`;
        if (!this.cross.has(k)) this.cross.set(k, { ...t, len: pathLen(t.pts), carve: 0 });
      } else {
        const ex = this.tun.get(t.toId);
        if (!ex) this.tun.set(t.toId, { ...t, len: pathLen(t.pts), carve: 0 }); // dug by its ant, not pre-drawn
        else if (!this.cham.get(t.toId)?.revealed) { ex.pts = t.pts; ex.len = pathLen(t.pts); } // frontier tunnel keeps extending until its room is dropped
      }
    }
    this.buildAdj();
    if (!this.booted) { this.fastForward(); this.booted = true; this.readsSeen = bp.nodes.reduce((s, n) => s + (n.reads ?? 0), 0); }
    this.syncForages(bp.forages);
    this.syncScouts(bp);
  }

  /** Reads (Read/Grep/Glob = scouting) launch SHORT near-surface forager trips that bank
   *  leaves — so a planning/reading session feeds the colony too. Rate-limited per the
   *  read delta and capped, so the constant stream of reads never floods the warren. */
  private syncScouts(bp: Tree): void {
    let total = 0;
    for (const n of bp.nodes) total += n.reads ?? 0;
    const delta = total - this.readsSeen;
    this.readsSeen = total;
    if (delta <= 0 || !this.activeId) return;
    this.scoutDebt += delta;
    while (this.scoutDebt >= READS_PER_SCOUT && this.trips.length < MAX_TRIPS) {
      this.scoutDebt -= READS_PER_SCOUT;
      this.spawnScout(this.activeId);
    }
  }

  /** Send a scout up from a chamber on a short near-surface forage that banks one leaf. */
  private spawnScout(chamberId: string): void {
    const path = this.buildUpPath(chamberId, false); // false → stop at the mouth, don't emerge into the grass
    if (path.length < 2) return;
    this.trips.push({
      id: `scout#${this.foragersBorn}`, chamberId, path, len: pathLen(path), state: "out",
      dist: 0, roamT: 0, rx: 0, ry: 0, x: path[0].x, y: path[0].y, angle: -Math.PI / 2, done: true, scout: true,
    });
    this.foragersBorn++;
  }

  /** Spawn/retire foragers from the live forage list (external fetches). */
  private syncForages(forages: ForageInfo[]): void {
    const seen = new Set<string>();
    for (const f of forages) {
      seen.add(f.id);
      const trip = this.trips.find((t) => t.id === f.id);
      if (!trip) {
        if (!f.inFlight) continue; // missed its outbound leg — skip
        const path = this.buildUpPath(f.chamberId);
        if (path.length < 2) continue;
        this.trips.push({
          id: f.id, chamberId: f.chamberId, path, len: pathLen(path), state: "out", dist: 0, roamT: 0,
          rx: 0, ry: 0, x: path[0].x, y: path[0].y, angle: -Math.PI / 2, done: false,
        });
        this.foragersBorn++; // a new forager went out — counts toward the colony total even after it fades
      } else if (!f.inFlight) {
        trip.done = true; // result landed → head home
      }
    }
    for (const t of this.trips) if (!seen.has(t.id)) t.done = true; // forage pruned → home
  }

  /** A route up the existing tunnels from a chamber to the surface. `emerge` adds the
   *  final step above ground (web foragers roam the grass); scouts pass false and turn
   *  around at the tunnel mouth. */
  private buildUpPath(chamberId: string, emerge = true): Pt[] {
    const pts: Pt[] = [];
    let id: string | undefined = chamberId, guard = 0;
    while (id && id !== SURFACE && guard++ < 120) {
      const t = this.tun.get(id);
      if (!t) break;
      for (const p of [...t.pts].reverse()) pts.push(p); // chamber-end → parent-end
      id = t.fromId;
    }
    if (!pts.length) { const c = this.cham.get(chamberId); if (c) pts.push({ x: c.x, y: c.y }); }
    const top = pts.length ? pts[pts.length - 1] : { x: 0, y: 0 };
    if (emerge) pts.push({ x: top.x, y: -30 }); // web forage emerges above the surface
    return pts;
  }

  private stepForagers(dt: number): void {
    for (const t of this.trips) {
      if (t.state === "out") {
        t.dist += FORAGE_SPEED * dt;
        const d = Math.min(t.dist, t.len);
        const here = pointAt(t.path, d), ahead = pointAt(t.path, Math.min(t.len, d + 5));
        t.x = here.x; t.y = here.y;
        if (ahead.x !== here.x || ahead.y !== here.y) t.angle = Math.atan2(ahead.y - here.y, ahead.x - here.x);
        if (t.dist >= t.len) { t.state = "roam"; t.roamT = t.scout ? SCOUT_ROAM_MIN + Math.random() * SCOUT_ROAM_VAR : FORAGE_ROAM_MIN + Math.random() * FORAGE_ROAM_VAR; t.rx = t.x; t.ry = t.y; }
      } else if (t.state === "roam") {
        t.roamT -= dt;
        if (Math.hypot(t.rx - t.x, t.ry - t.y) < 4) {
          if (t.scout) { t.rx = t.x + (Math.random() - 0.5) * 60; t.ry = t.y + (Math.random() - 0.5) * 40; } // a scout mills at the tunnel mouth
          else { t.rx = t.x + (Math.random() - 0.5) * 90; t.ry = -22 - Math.random() * 18; }            // a web forager roams the grass
        }
        const dx = t.rx - t.x, dy = t.ry - t.y, dd = Math.hypot(dx, dy) || 1;
        const step = Math.min(WALK_SPEED * dt, dd);
        t.x += (dx / dd) * step; t.y += (dy / dd) * step;
        if (dd > 0.5) t.angle = Math.atan2(dy, dx);
        if (t.done && t.roamT <= 0) t.state = "home";
      } else if (t.state === "home") { // heading back down to drop the leaf
        t.dist -= FORAGE_SPEED * dt;
        const d = Math.max(0, t.dist);
        const here = pointAt(t.path, d), behind = pointAt(t.path, Math.max(0, d - 5));
        t.x = here.x; t.y = here.y;
        if (here.x !== behind.x || here.y !== behind.y) t.angle = Math.atan2(behind.y - here.y, behind.x - here.x);
        if (t.dist <= 0) {
          const spot = this.spotIn(t.chamberId); // drop the leaf where it lands
          if (spot) { this.leaves.push(spot); if (this.leaves.length > MAX_LEAVES) this.leaves.shift(); }
          this.leafPool += 1; this.leavesTotal += 1; // bank the leaf: it'll be spent growing fungus, and counts forever at the top
          t.state = "fade"; t.fade = 1;
        }
      } else { // fade — leaf delivered, the forager dissolves away (no crowding)
        t.fade = (t.fade ?? 1) - FADE_RATE * dt;
        if ((t.fade ?? 0) <= 0) t.remove = true;
      }
    }
    this.trips = this.trips.filter((t) => !t.remove);
  }

  /** Load the colony that already existed before we opened — instantly, no dig
   *  animation — so the ants only crawl for NEW work, at a believable pace. */
  private fastForward(): void {
    for (const id of this.order) {
      const c = this.cham.get(id);
      if (!c) continue;
      if (c.node.done === false) continue; // an in-progress turn → dig it live, don't pre-drop it
      c.revealed = true; c.r = c.tr; c.crop = c.cropCap; // a pre-existing garden is already grown
      const isQ = !!c.node.isQueen;
      // a rock-blocked dig: its ant backed out to the parent room — never sits on the boulder
      let home = id;
      if (c.node.blocked) { const pid = this.tun.get(id)?.fromId; if (pid && pid !== SURFACE && this.cham.get(pid)) home = pid; }
      const spot = this.spotIn(home) ?? { x: c.x, y: c.y };
      this.ants.push({
        caste: this.casteOf(c), x: spot.x, y: spot.y, angle: Math.PI / 2,
        state: "rest", at: home, rest: rest(), founded: id,
        name: isQ ? `${this.nameFor(id)} The Queen` : this.nameFor(id), queen: isQ || undefined,
      });
      this.onTurn(); // grow the surface to match the session's length
    }
    for (const t of this.tun.values()) { if (this.cham.get(t.toId)?.revealed) t.carve = 1; }
    for (const t of this.cross.values()) t.carve = 1;
    // leave revealIdx at 0: step() skips already-revealed rooms and digs the in-progress ones live
    this.revealIdx = 0;
  }

  private buildAdj(): void {
    this.adj.clear();
    const link = (id: string, nbr: Nbr) => {
      const a = this.adj.get(id) ?? []; a.push(nbr); this.adj.set(id, a);
    };
    const both = (t: STun) => {
      if (t.fromId !== SURFACE) link(t.fromId, { pts: t.pts, other: t.toId, tun: t });
      link(t.toId, { pts: [...t.pts].reverse(), other: t.fromId, tun: t });
    };
    for (const t of this.tun.values()) both(t);
    for (const t of this.cross.values()) both(t);
  }

  step(dt: number): void {
    this.stepForagers(dt);
    // the frontier chamber is "still being worked" while its session keeps emitting
    // facts — even with no new tunnel to carve. Drives the busy ant, camera, chip.
    this.working = this.activeId !== null && Date.now() - this.activeTs < ACTIVE_MS;
    let top = Infinity;
    for (const c of this.cham.values()) {
      if (!c.revealed) continue;
      if (c.r < c.tr) c.r = Math.min(c.tr, c.r + (c.tr - c.r) * GROW + 0.4);
      // fungus grows toward its diff-derived cap ONLY by spending foraged leaves — the
      // real leafcutter cycle (leaves feed the fungus). No leaves → no growth, but no
      // decay either, so the standing garden persists. A coding turn already seeded it;
      // leaves fill it the rest of the way, and harvesting draws it back down.
      if (c.crop < c.cropCap && this.leafPool > 0) {
        const want = (c.cropCap - c.crop) * CROP_REGROW * dt;
        const afford = Math.min(want / LEAF_YIELD, this.leafPool);
        c.crop += afford * LEAF_YIELD;
        this.leafPool -= afford;
      }
      if (c.y < top) top = c.y;
      if (c.node.isQueen) { this.queenId = c.node.id; this.qx = c.x; this.qy = c.y; }
    }
    this.repleteCount = this.ants.reduce((n, a) => n + (a.replete ? 1 : 0), 0);
    // the repletes slowly consume the chamber pile and swell with it (the larder = their bulk)
    if (this.repleteCount > 0 && this.pile > 0.005 && this.larder < 1) {
      const take = Math.min(REPLETE_BULK_RATE * dt, this.pile, 1 - this.larder);
      this.pile -= take; this.larder += take;
    }
    if (!this.working) this.larder = Math.max(0, this.larder - LARDER_IDLE_DRAIN * dt); // idle → the reserve is slowly eaten down
    this.topY = top === Infinity ? 0 : top;

    // launch diggers for the next chambers whose parent is already open
    let digging = this.ants.reduce((n, a) => n + (a.state === "dig" ? 1 : 0), 0);
    while (digging < MAX_DIGS && this.revealIdx < this.order.length) {
      const id = this.order[this.revealIdx];
      if (this.cham.get(id)?.revealed) { this.revealIdx++; continue; } // already up (fast-forwarded)
      const t = this.tun.get(id);
      if (!t) { this.revealIdx++; continue; }
      const ready = t.fromId === SURFACE || this.cham.get(t.fromId)?.revealed;
      if (!ready) break;
      const start = t.pts[0];
      const c = this.cham.get(id)!;
      const isQ = !!c.node.isQueen;
      this.ants.push({
        caste: this.casteOf(c),
        x: start.x, y: start.y, angle: Math.PI / 2, state: "dig",
        pts: t.pts, len: t.len, dist: 0, speed: DIG_SPEED, carveTun: id, arrive: id,
        founded: id, name: isQ ? `${this.nameFor(id)} The Queen` : this.nameFor(id),
      });
      this.revealIdx++; digging++;
    }

    let freeWalk = MAX_WALKERS - this.ants.reduce((n, a) => n + (a.state === "walk" ? 1 : 0), 0);

    for (const a of this.ants) {
      if (a.queen) { this.stepQueen(a, dt); continue; }
      if (a.replete) {
        // a replete hangs as a living larder until it's DEPLETED — i.e. the colony has
        // eaten the reserve down to near-empty (a deep famine) — then it rejoins the
        // workers. No time limit: while there's stored food, it stays. (Stagger so they
        // don't all leave the same instant.)
        if (this.larder < REPLETE_MIN && Math.random() < 0.012) { a.replete = false; a.goalReplete = false; a.mood = undefined; a.state = "rest"; a.rest = this.restFor(a); }
        else continue;
      }
      // workers graze the fungus wherever they are: hunger falls where there's crop,
      // builds where there's none (bare read/plan rooms). Keeps the colony fed without famine.
      if (a.caste === "worker") {
        const here = this.cham.get(a.at!);
        a.hunger = clamp((a.hunger ?? 0) + ((here?.crop ?? 0) > 0.05 ? -HUNGER_RATE * 2.5 : HUNGER_RATE) * dt, 0, 1);
        if (this.wantsFood(a) && a.state === "rest" && (here?.crop ?? 0) < 0.05 && (a.rest ?? 0) > 24) a.rest = 24; // hungry in a bare room → stop dallying, go find fungus
      }
      // the ant whose chamber is the live frontier tends it in place (ambles like
      // the queen) until the turn is done — it never wanders or patrols off, so the
      // "digging" the camera follows actually happens AT the chamber being worked,
      // even if that founder is a soldier who'd otherwise be off patrolling.
      if (this.working && a.founded === this.activeId && a.state !== "dig" && !this.cham.get(this.activeId ?? "")?.node.done) { this.tendFrontier(a, dt); continue; }
      if (a.state === "rest") {
        a.rest = (a.rest ?? 0) - dt;
        this.ambleIn(a, dt); // mill gently in the room instead of standing frozen
        // soldiers patrol uncapped (they're few, and patrolling is the point);
        // workers share the MAX_WALKERS budget so most of them rest in rooms.
        const canWalk = a.caste === "soldier" || freeWalk > 0 || this.wantsFood(a); // a hungry worker always gets to go find food
        if ((a.rest ?? 0) <= 0 && canWalk) {
          if (a.caste === "soldier") {
            // a soldier bases at the queen: patrol OUT only when already home, otherwise
            // climb back to her first — so they gravitate to the queen and guard her.
            a.outbound = a.at === this.queenId; a.prev = undefined;
            if (this.wander(a)) a.hops = PATROL_HOPS_MIN + Math.floor(Math.random() * PATROL_HOPS_VAR);
            else a.rest = this.restFor(a);
          } else if (this.startWorkerOuting(a)) { // carry food home / go feed, else roam & harvest
            freeWalk--;
          } else a.rest = this.restFor(a);
        }
        continue;
      }

      // dig or walk: advance along the path (mobilized soldiers double-time toward the trouble)
      a.dist = (a.dist ?? 0) + (a.speed ?? WALK_SPEED) * (this.alarm && a.caste === "soldier" ? 1.8 : 1) * dt;
      if (a.state === "dig" && a.carveTun) {
        const t = this.tun.get(a.carveTun);
        if (t) { a.pts = t.pts; a.len = t.len; t.carve = Math.min(1, a.dist / t.len); } // follow the tunnel as it extends
      }
      const len = a.len ?? 1;
      // an ant exploring an un-dug junction carves it open as it goes
      if (a.state === "walk" && a.walkTun && a.walkTun.carve < 1) {
        a.walkTun.carve = Math.max(a.walkTun.carve, Math.min(1, a.dist / len));
      }
      const d = Math.min(a.dist, len);
      const here = pointAt(a.pts!, d), ahead = pointAt(a.pts!, Math.min(len, d + 5));
      const px = a.x, py = a.y;
      a.x = here.x; a.y = here.y;
      a.traveled = (a.traveled ?? 0) + Math.hypot(a.x - px, a.y - py); // lifetime distance, for the ant card
      if (ahead.x !== here.x || ahead.y !== here.y) a.angle = Math.atan2(ahead.y - here.y, ahead.x - here.x);

      if (a.dist >= len) {
        const ch = this.cham.get(a.arrive!);
        if (a.state === "dig" && ch && ch.node.done === false) {
          // the turn isn't sealed yet — keep gnawing at the tip; the tunnel extends
          // on the next sync. Don't drop the chamber or its egg until the turn's done.
          a.dist = len;
        } else if (a.state === "dig") {
          if (ch) { ch.revealed = true; if (ch.cropCap > 0) ch.crop = Math.max(ch.crop, Math.min(ch.cropCap, CROP_SEED)); this.onTurn(); } // a fresh turn seeds its starter fungus at once
          const t = this.tun.get(a.carveTun!); if (t) t.carve = 1;
          if (ch?.node.isQueen) { a.queen = true; a.at = a.arrive; a.state = "rest"; a.rest = Infinity; a.pts = undefined; a.dist = 0; }
          else if (ch?.node.blocked) { a.at = a.arrive; a.hops = 1; if (!this.wander(a)) this.settle(a, a.arrive!); } // hit a rock → back out, never sit on it
          else this.settle(a, a.arrive!); // crawl off the tunnel mouth into the room
        } else { // a walk leg arrived
          a.prev = a.at; // remember where we came from so a patrol won't ping-pong straight back
          a.at = a.arrive; a.pts = undefined; a.dist = 0; a.walkTun = undefined;
          a.hops = (a.hops ?? 1) - 1;
          if (a.caste === "soldier") {
            // patrol: range out until the out-leg budget is spent, then head home to the
            // queen and guard her — the inbound leg ignores the budget so it always makes
            // it back. Purposeful loops anchored on the queen, not streaming between rooms.
            if (this.alarm && a.at === this.activeId) { a.state = "rest"; a.rest = REST_MIN + Math.random() * REST_MIN; } // reached the stuck frontier → hold and guard it
            else if (a.at === this.queenId) { a.state = "rest"; a.rest = this.restFor(a); }
            else {
              if (a.outbound && (a.hops ?? 0) <= 0) a.outbound = false; // out-budget spent → turn back
              if (!this.wander(a)) { a.state = "rest"; a.rest = this.restFor(a); }
            }
          } else this.workerArrive(a);
        }
      }
    }
  }

  /** A worker finished a walk leg: deposit/eat at the queen's larder, keep heading
   *  home if it's carrying or hungry, grab any crop in this room to haul home, or
   *  roam on. Some workers that reach the queen enlist as living-larder repletes. */
  private workerArrive(a: SAnt): void {
    const cham = this.cham.get(a.at!);
    // hungry and standing in fungus → settle in and graze it down instead of wandering on
    if (a.at !== this.queenId && this.wantsFood(a) && (cham?.crop ?? 0) > 0.05) {
      a.state = "rest"; a.rest = this.restFor(a); a.hops = 0; return;
    }
    if (a.at === this.queenId) {
      this.atLarder(a); // deposit carried crop + feed from the reserve if hungry
      if (a.goalReplete && !a.replete && this.repleteCount < REPLETE_TARGET) { this.makeReplete(a); return; }
      a.goalReplete = false;
      // DON'T linger in the queen's chamber — head straight back out to work (else
      // haulers pile up here resting/starving, since the queen's room grows no fungus)
      if (this.wander(a)) { a.hops = JOURNEY_MIN + Math.floor(Math.random() * JOURNEY_VAR); return; }
    } else if (cham && !a.carrying && !this.wantsFood(a) && cham.crop > 0.1) {
      a.carrying = Math.min(CARRY_LOAD, cham.crop); cham.crop -= a.carrying; // gather surplus to haul home
    } else if (this.wantsFood(a) && (cham?.crop ?? 0) < 0.05 && this.pile + this.larder > 0.05) {
      if (this.headHome(a)) return; // hungry with no fungus here → trek to the queen's store
    }
    if ((a.carrying ?? 0) > 0) { if (!this.headHome(a)) { a.state = "rest"; a.rest = this.restFor(a); } return; } // haul it home
    if (!((a.hops ?? 0) > 0 && this.wander(a))) { a.state = "rest"; a.rest = this.restFor(a); }
  }

  private wantsFood(a: SAnt): boolean { return (a.hunger ?? 0) > HUNGER_HUNGRY; }

  /** At the queen's larder: drop any carried crop into the reserve, and — when hungry
   *  — feed from it (the famine buffer: workers eat the stash when fresh fungus is gone,
   *  which visibly deflates the repletes). */
  private atLarder(a: SAnt): void {
    if ((a.carrying ?? 0) > 0) { this.pile = Math.min(1, this.pile + (a.carrying ?? 0)); a.carrying = 0; } // heap it onto the queen's pile
    if (this.wantsFood(a)) { // famine: eat the fresh pile first, then draw on the repletes' reserve
      if (this.pile > 0.02) { this.pile = Math.max(0, this.pile - LARDER_BITE); a.hunger = 0; }
      else if (this.larder > 0.02) { this.larder = Math.max(0, this.larder - LARDER_BITE); a.hunger = 0; }
    }
  }

  /** Pick the worker's next outing: haul a carried load home, trek home to feed from
   *  the reserve when hungry with no local fungus, else roam out to forage/eat. */
  private startWorkerOuting(a: SAnt): boolean {
    if (a.at === this.queenId && (a.carrying ?? 0) > 0) this.atLarder(a);
    const here = this.cham.get(a.at!);
    // hungry but standing in fungus → stay put and graze it down before any errand
    if (this.wantsFood(a) && (here?.crop ?? 0) > 0.05 && !(a.carrying ?? 0)) return false;
    // hungry, with nothing growing underfoot, and not already on an errand → make for the
    // richest GARDEN a room or so away and graze it. Food grew wherever the diff did, so
    // there's almost always fungus nearby; the distant queen's reserve is only the fallback.
    if (this.wantsFood(a) && (here?.crop ?? 0) < 0.05 && !(a.carrying ?? 0) && !a.goalReplete && this.seekGarden(a)) {
      a.hops = JOURNEY_MIN + Math.floor(Math.random() * JOURNEY_VAR);
      return true;
    }
    const needLarder = this.wantsFood(a) && (here?.crop ?? 0) < 0.05 && this.pile + this.larder > 0.05;
    // while the queen is short of living larders, the odd roaming worker is enlisted
    if (this.repleteCount < REPLETE_TARGET && !a.goalReplete && a.at !== this.queenId && Math.random() < RECRUIT_CHANCE) a.goalReplete = true;
    const goHome = (a.carrying ?? 0) > 0 || a.goalReplete || needLarder;
    const ok = goHome && a.at !== this.queenId ? this.headHome(a) : this.wander(a);
    if (ok) a.hops = JOURNEY_MIN + Math.floor(Math.random() * JOURNEY_VAR);
    return ok;
  }

  /** Walk one hop toward the queen (the root): climb the parent chain, else aim for
   *  the neighbour nearest her. Carries food home / brings a hungry worker to eat. */
  private headHome(a: SAnt): boolean {
    const open = (this.adj.get(a.at!) ?? []).filter((n) => { const c = this.cham.get(n.other); return c?.revealed && !c.node.blocked; });
    if (!open.length) return false;
    const parent = this.tun.get(a.at!)?.fromId;
    let n = open.find((x) => x.other === parent);
    if (!n) { let bd = Infinity; n = open[0]; for (const x of open) { const c = this.cham.get(x.other); const dq = c ? Math.hypot(c.x - this.qx, c.y - this.qy) : 1e9; if (dq < bd) { bd = dq; n = x; } } }
    const spot = n.tun.carve < 1 ? null : this.spotIn(n.other);
    const path = [{ x: a.x, y: a.y }, ...n.pts]; if (spot) path.push(spot);
    a.state = "walk"; a.pts = path; a.len = pathLen(path); a.dist = 0; a.speed = WALK_SPEED; a.arrive = n.other; a.walkTun = n.tun;
    return true;
  }

  /** Enlist a worker as a living larder (a honeypot replete): it hangs in the queen's
   *  chamber, abdomen swelling with the colony's stored food, instead of wandering. */
  private makeReplete(a: SAnt): void {
    a.replete = true; a.goalReplete = false; a.carrying = 0; a.pts = undefined; a.dist = 0;
    // take the first FREE hanging slot so repletes line up along the ceiling in rows
    // instead of stacking on top of each other.
    const used = new Set(this.ants.filter((x) => x.replete && x !== a).map((x) => x.repleteSlot));
    let slot = 0; while (used.has(slot)) slot++;
    a.repleteSlot = slot;
    const c = this.cham.get(this.queenId!);
    if (c) {
      const cols = 4, col = slot % cols, row = Math.floor(slot / cols);
      a.x = c.x + (col - (cols - 1) / 2) * c.r * 0.42; // spread across the width, up high
      a.y = c.y - c.r * 0.52 + row * c.r * 0.34;       // a couple of rows, out of the queen's path
      a.at = this.queenId!;
    }
    a.state = "rest"; a.rest = Infinity; a.mood = "a living larder";
  }

  /** A resting ant moseys gently around its room — mostly paused, occasionally
   *  drifting to a new spot — so the colony mills instead of looking frozen. */
  private ambleIn(a: SAnt, dt: number): void {
    const c = this.cham.get(a.at!);
    if (!c) return;
    const inRoom = a.qx !== undefined && Math.hypot(a.qx - c.x, (a.qy ?? c.y) - c.y) <= c.r;
    const reached = a.qx === undefined || Math.hypot(a.x - a.qx, a.y - (a.qy ?? a.y)) < 1.5;
    if (!inRoom || (reached && Math.random() < 0.04)) { // pause, then mosey to a new spot fairly often
      const ang = Math.random() * Math.PI * 2, rad = Math.sqrt(Math.random()) * c.r * 0.55;
      a.qx = c.x + Math.cos(ang) * rad; a.qy = c.y + Math.sin(ang) * rad * 0.78;
    }
    const dx = (a.qx ?? c.x) - a.x, dy = (a.qy ?? c.y) - a.y, d = Math.hypot(dx, dy);
    if (d > 1) {
      const step = Math.min(AMBLE_SPEED * dt, d);
      a.x += (dx / d) * step; a.y += (dy / d) * step;
      a.traveled = (a.traveled ?? 0) + step;
      a.angle = Math.atan2(dy, dx);
    }
  }

  /** The queen ambles slowly between random spots inside her own chamber. */
  private stepQueen(a: SAnt, dt: number): void {
    const c = this.cham.get(a.at!);
    if (!c) return;
    if (a.qx === undefined || Math.hypot(a.x - a.qx, a.y - (a.qy ?? a.y)) < 2) {
      // pace side-to-side along the chamber FLOOR, out of the central traffic where
      // she'd otherwise be constantly walked over.
      a.qx = c.x + (Math.random() - 0.5) * c.r * 0.95;
      a.qy = c.y + c.r * 0.34 + Math.random() * c.r * 0.26;
    }
    const dx = a.qx - a.x, dy = (a.qy ?? a.y) - a.y, d = Math.hypot(dx, dy) || 1;
    const step = Math.min(QUEEN_SPEED * dt, d);
    a.x += (dx / d) * step; a.y += (dy / d) * step;
    if (d > 0.4) a.angle = Math.atan2(dy, dx);
  }

  /** The ant tending the live frontier ambles within the chamber it dug (like the
   *  queen) — pulled home first if it had wandered off, then kept there while the
   *  turn is being worked. */
  private tendFrontier(a: SAnt, dt: number): void {
    const c = this.cham.get(a.founded!);
    if (!c) return;
    a.state = "rest"; a.pts = undefined; a.dist = 0; a.at = a.founded; a.walkTun = undefined;
    const far = Math.hypot(a.x - c.x, a.y - c.y) > c.r * 0.9;
    if (far) { a.qx = c.x; a.qy = c.y; } // head straight back to the chamber it's working
    else if (a.qx === undefined || Math.hypot(a.x - a.qx, a.y - (a.qy ?? a.y)) < 2) {
      const ang = Math.random() * Math.PI * 2, rad = Math.random() * c.r * 0.42;
      a.qx = c.x + Math.cos(ang) * rad; a.qy = c.y + Math.sin(ang) * rad * 0.7;
    }
    const dx = (a.qx ?? c.x) - a.x, dy = (a.qy ?? c.y) - a.y, d = Math.hypot(dx, dy) || 1;
    const step = Math.min(WALK_SPEED * dt, d);
    a.x += (dx / d) * step; a.y += (dy / d) * step;
    if (d > 0.4) a.angle = Math.atan2(dy, dx);
  }

  /** One turn dug → the surface grows: grass is common (often a few tufts a turn),
   *  with the occasional clover/dandelion/mushroom; and any plant may advance. */
  private onTurn(): void {
    const sp = this.surfaceSpan();
    const plant = (type: string) => {
      this.flora.push({ type, stage: 0, x: sp.min + Math.random() * (sp.max - sp.min) });
      if (this.flora.length > FLORA_MAX) this.flora.shift();
    };
    for (let g = 1 + Math.floor(Math.random() * 3); g > 0; g--) if (Math.random() < 0.8) plant("grass");
    if (Math.random() < 0.35) plant(["clover", "clover", "dandelion", "mushroom"][Math.floor(Math.random() * 4)]);
    for (const p of this.flora) {
      if (p.stage < FLORA_STAGES[p.type].length - 1 && Math.random() < GROW_CHANCE) p.stage++;
    }
  }

  private surfaceSpan(): { min: number; max: number } {
    let min = -140, max = 140;
    for (const c of this.cham.values()) if (c.revealed) { min = Math.min(min, c.x); max = Math.max(max, c.x); }
    return { min: min - 90, max: max + 90 };
  }

  /** A unique display name for the ant that dug a chamber: its base name from the
   *  pool, plus a roman numeral if another ant already took that base (Vex, Vex II…).
   *  Counted in dig order, so the same colony always names the same ants. */
  private nameFor(id: string): string {
    const base = nameBase(id);
    const n = (this.nameSeq.get(base) ?? 0) + 1;
    this.nameSeq.set(base, n);
    return n === 1 ? base : `${base} ${roman(n)}`;
  }

  /** The role an ant takes from the chamber it dug: the founder is the queen, a
   *  defensive chamber (tests/lint/error-recovery) mints a soldier, else a worker. */
  private casteOf(c: SCham): Caste {
    if (c.node.isQueen) return "queen";
    if (c.node.defended) return "soldier";
    return "worker";
  }

  /** Soldier resting: at the queen's chamber they linger long (and mill, guarding
   *  her); out on patrol they only pause briefly between legs. Workers rest normally. */
  private restFor(a: SAnt): number {
    if (a.caste !== "soldier") return rest();
    if (this.alarm) return REST_MIN * 0.3 + Math.random() * REST_MIN * 0.4; // mobilized — keep pressing toward the trouble
    return a.at === this.queenId
      ? REST_MIN * 2 + Math.random() * REST_MAX          // guarding the queen — linger long and mill
      : REST_MIN * 0.4 + Math.random() * REST_MIN * 0.6; // out on patrol — only brief pauses
  }

  /** A soldier on patrol: it loops OUT from the queen's chamber to a set range and
   *  back, anchored on her — so it covers ground intentionally instead of streaming
   *  back and forth between two rooms. Won't immediately retrace its last step. */
  /** The chain of chambers from `id` up to the queen (inclusive) — soldiers descend it to the trouble. */
  private ancestorsOf(id: string): Set<string> {
    const set = new Set<string>(); let cur: string | undefined = id, guard = 0;
    while (cur && cur !== SURFACE && guard++ < 200) { set.add(cur); cur = this.tun.get(cur)?.fromId; }
    return set;
  }

  private soldierStep(open: Nbr[], a: SAnt): Nbr {
    let pool = open.filter((n) => n.other !== a.prev); // don't bounce straight back (the ping-pong)
    if (!pool.length) pool = open;
    // ALARM: a session is stuck → soldiers converge on the active chamber to defend it.
    // Walk the TREE toward it (topological, not Euclidean, which traps in tree dead-ends):
    // descend the active chamber's ancestor chain, or climb to the queen first to join it.
    if (this.alarm && this.activeId) {
      const path = this.ancestorsOf(this.activeId);
      if (path.has(a.at!) && a.at !== this.activeId) {
        const down = pool.find((n) => path.has(n.other) && this.tun.get(n.other)?.fromId === a.at); // step to the child continuing toward the trouble
        if (down) return down;
      } else if (!path.has(a.at!)) {
        const up = pool.find((n) => n.other === this.tun.get(a.at!)?.fromId); // off the chain → climb toward the queen (the common ancestor)
        if (up) return up;
      }
      const ac = this.cham.get(this.activeId); // on/at the trouble (or stuck) → mill near it
      if (ac) { let best = pool[0], bd = Infinity; for (const n of pool) { const c = this.cham.get(n.other); const d = c ? Math.hypot(c.x - ac.x, c.y - ac.y) : 1e9; if (d < bd) { bd = d; best = n; } } return best; }
    }
    const parentOf = (id: string) => this.tun.get(id)?.fromId; // the room that dug `id` → one step toward the queen
    if (a.outbound) {
      // range deeper into the tree — step to a CHILD (a room dug out from here)
      const kids = pool.filter((n) => parentOf(n.other) === a.at);
      const src = kids.length ? kids : pool;
      return src[Math.floor(Math.random() * src.length)];
    }
    // inbound — climb the PARENT chain, which always converges on the queen (the root)
    const up = pool.find((n) => n.other === parentOf(a.at!));
    if (up) return up;
    let best = pool[0], bd = Infinity; // no parent edge open here → fall back to the neighbour nearest the queen
    for (const n of pool) { const c = this.cham.get(n.other); const d = c ? Math.hypot(c.x - this.qx, c.y - this.qy) : 1e9; if (d < bd) { bd = d; best = n; } }
    return best;
  }

  /** A random point inside a chamber (area-uniform, kept off the walls). */
  private spotIn(id: string): Pt | null {
    const c = this.cham.get(id);
    if (!c) return null;
    const ang = Math.random() * Math.PI * 2;
    const rad = Math.sqrt(Math.random()) * c.r * 0.6;
    return { x: c.x + Math.cos(ang) * rad, y: c.y + Math.sin(ang) * rad * 0.78 };
  }

  /** A hungry worker heads for the richest adjacent garden to graze. Returns false when
   *  no neighbouring room has fungus worth the trip (then it falls back to the larder/roam). */
  private seekGarden(a: SAnt): boolean {
    let best: Nbr | null = null, bestCrop = 0.1;
    for (const n of this.adj.get(a.at!) ?? []) {
      const c = this.cham.get(n.other);
      if (!c?.revealed || c.node.blocked || n.tun.carve < 1) continue;
      if (c.crop > bestCrop) { bestCrop = c.crop; best = n; }
    }
    if (!best) return false;
    const spot = this.spotIn(best.other);
    const path = [{ x: a.x, y: a.y }, ...best.pts]; if (spot) path.push(spot);
    a.state = "walk"; a.pts = path; a.len = pathLen(path); a.dist = 0; a.speed = WALK_SPEED; a.arrive = best.other; a.walkTun = best.tun;
    return true;
  }

  /** Start the ant walking to an open neighbouring room — never into a rock
   *  dead-end. Returns false if there's nowhere to go. */
  private wander(a: SAnt): boolean {
    const open = (this.adj.get(a.at!) ?? []).filter((n) => {
      const c = this.cham.get(n.other);
      return c?.revealed && !c.node.blocked; // boulders aren't a place to roam to
    });
    if (!open.length) return false;
    // soldiers patrol toward the entrance; others prefer carving an un-dug shortcut
    let n: Nbr;
    if (a.caste === "soldier") n = this.soldierStep(open, a);
    else { const undug = open.filter((x) => x.tun.carve < 1); const pool = undug.length ? undug : open; n = pool[Math.floor(Math.random() * pool.length)]; }
    // a carving walk must end at the room centre (so the tunnel reads as dug); else
    // head for a random spot, starting from where the ant actually is.
    const spot = n.tun.carve < 1 ? null : this.spotIn(n.other);
    const path = [{ x: a.x, y: a.y }, ...n.pts];
    if (spot) path.push(spot);
    a.state = "walk"; a.pts = path; a.len = pathLen(path); a.dist = 0; a.speed = WALK_SPEED; a.arrive = n.other; a.walkTun = n.tun;
    return true;
  }

  /** Walk the ant a short hop from where it is to a random spot in the room. */
  private settle(a: SAnt, id: string): void {
    const spot = this.spotIn(id);
    if (!spot) { a.state = "rest"; a.at = id; a.rest = this.restFor(a); a.pts = undefined; a.dist = 0; return; }
    a.state = "walk"; a.at = id; a.arrive = id; a.walkTun = undefined;
    a.pts = [{ x: a.x, y: a.y }, spot]; a.len = pathLen(a.pts); a.dist = 0; a.speed = WALK_SPEED;
  }

  render(): Tree {
    // bounds track only what's been DUG so far (plus the surface origin), so the
    // depth stat and camera reflect how deep we actually are, growing as we dig.
    const nodes: CNode[] = [];
    let minX = 0, maxX = 0, minY = 0, maxY = 0;
    for (const c of this.cham.values()) if (c.revealed) {
      // a stuck session blights its frontier chamber: the garden visibly wilts (crop→0,
      // blight up) until the work recovers, then it regrows. Render-only — never mutates crop.
      const distress = this.alarm && c.node.id === this.activeId;
      nodes.push({ ...c.node, r: c.r, crop: distress ? 0 : c.crop, blight: distress ? Math.max(c.blight, 0.6) : c.blight });
      minX = Math.min(minX, c.x - c.r); maxX = Math.max(maxX, c.x + c.r);
      minY = Math.min(minY, c.y - c.r); maxY = Math.max(maxY, c.y + c.r);
    }
    const tunnels: Tunnel[] = [];
    const push = (t: STun, cross: boolean) => { if (t.carve > 0) tunnels.push({ fromId: t.fromId, toId: t.toId, pts: t.pts, w: t.w, carve: t.carve, cross, durationMs: this.cham.get(t.toId)?.node.durationMs }); };
    for (const t of this.tun.values()) push(t, false);
    for (const t of this.cross.values()) push(t, true);
    const ants: AntDot[] = this.ants.map((a) => ({
      antId: a.founded ?? "", caste: a.caste, x: a.x, y: a.y, angle: a.angle,
      // carving a tunnel, OR still working the live frontier chamber → reads as busy
      digging: a.state === "dig",
      moving: a.state === "walk", // travelling the tunnels — eligible for the idle camera to trail
      name: a.name,
      sprite: a.replete ? undefined : (a.carrying ?? 0) > 0 ? "worker2" : a.caste === "forager" ? "forager2" : undefined, // carrying → the hauler sprite
      mood: moodOf(a, this.cham.get(a.at ?? "")?.crop ?? 0), traveled: a.traveled,
      replete: a.replete ? this.larder : undefined, // a living larder swells with the colony's reserve
      startTs: this.cham.get(a.founded ?? "")?.node.startTs, // its founding turn's start → the ant's age, even mid-dig (chamber not yet in nodes)
    }));
    for (const t of this.trips) {
      ants.push({
        antId: "", caste: "forager", x: t.x, y: t.y, angle: t.angle, digging: false,
        sprite: t.state === "home" ? "forager" : "forager2",
        alpha: t.state === "fade" ? Math.max(0, t.fade ?? 0) : undefined,
      });
    }
    const flora = this.flora.map((p) => ({ name: FLORA_STAGES[p.type][p.stage], x: p.x }));
    return { nodes, tunnels, ants, flora, forages: [], leaves: this.leaves, hole: this.meta.hole, newest: this.meta.newest, bounds: { minX, maxX, minY, maxY }, larder: this.larder, pile: this.pile, antsTotal: this.ants.length + this.foragersBorn, leavesTotal: this.leavesTotal };
  }
}

function rest(): number { return REST_MIN + Math.random() * (REST_MAX - REST_MIN); }

/** A short word for what an ant is doing right now — shown on its card. */
function moodOf(a: SAnt, crop: number): string {
  if (a.replete) return "a living larder";
  if (a.queen) return "tending the brood";
  if (a.state === "dig") return "digging";
  if ((a.carrying ?? 0) > 0) return "hauling food";
  if (a.caste === "soldier") return "patrolling";
  if ((a.hunger ?? 0) > HUNGER_HUNGRY) return a.state === "walk" ? "seeking food" : "hungry";
  if (a.state === "walk") return "exploring";
  if (a.caste === "worker" && crop > 0.1) return "tending the fungus"; // resting in a garden → gardening
  return "resting";
}

/** A chamber's fungus capacity + blight from its net diff: positive net → crop to
 *  harvest; negative net (a deletion turn) → blight to weed, no crop. */
function cropFor(n: CNode): { cap: number; blight: number } {
  if (n.blocked) return { cap: 0, blight: 0 }; // a boulder is bare rock — no fungus, nothing to harvest
  const net = (n.linesAdded ?? 0) - (n.linesRemoved ?? 0);
  return { cap: cropTarget(Math.max(0, net)), blight: net < 0 ? cropTarget(-net) : 0 };
}

function pathLen(pts: Pt[]): number {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return s;
}

/** Point at arc-distance d along the polyline. */
function pointAt(pts: Pt[], d: number): Pt {
  if (pts.length === 1) return pts[0];
  for (let i = 1; i < pts.length; i++) {
    const seg = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y) || 1e-6;
    if (d <= seg) { const f = d / seg; return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * f, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * f }; }
    d -= seg;
  }
  return pts[pts.length - 1];
}
