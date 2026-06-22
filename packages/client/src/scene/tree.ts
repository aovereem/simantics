import type { Caste, ColonySnapshot, TaskSnapshot } from "@simantics/shared";
import { chamberRadius, relLength, SEG_BASE, TRIVIAL_TOKENS, clamp } from "./layout.js";

export type EggState = "none" | "egg" | "hatched";

export interface CNode {
  id: string; label: string; tokens: number; actions: number; durationMs: number; startTs: number;
  children: number; edited: boolean; defended: boolean; blocked: boolean; done: boolean; hung: boolean;
  linesAdded: number; linesRemoved: number; reads: number; committed: boolean;
  antId: string; caste: Caste; isQueen: boolean; isHub: boolean; egg: EggState;
  x: number; y: number; r: number;
  /** fungus crop (0..1) and blight (0..1) — set by the sim's render, not the blueprint. */
  crop?: number; blight?: number;
}
export interface Pt { x: number; y: number; }
export interface CEdge { ax: number; ay: number; bx: number; by: number; fromId: string; toId: string; cross?: boolean; }
export interface Tunnel { fromId: string; toId: string; pts: Pt[]; w: number; carve: number; cross?: boolean; durationMs?: number; }
export interface AntDot { antId: string; caste: Caste; x: number; y: number; digging: boolean; angle: number; name?: string; sprite?: string; alpha?: number; moving?: boolean; mood?: string; traveled?: number; replete?: number; startTs?: number; }
export interface Flora { name: string; x: number; }
export interface ForageInfo { id: string; chamberId: string; inFlight: boolean; }
export interface Tree {
  nodes: CNode[]; tunnels: Tunnel[]; ants: AntDot[]; flora: Flora[]; forages: ForageInfo[]; leaves: Pt[];
  hole: { x: number; y: number };
  /** every surface entrance — the queen's central hole plus one per later session. */
  holes: Pt[];
  newest: { x: number; y: number } | null;
  /** frontier chamber of the most-recently-active session + its last-fact time —
   *  lets the sim keep that chamber's ant "working" while the agent still is. */
  newestId?: string | null;
  newestTs?: number;
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
  /** colony-wide standing crop (Σ net diff) — the larder's replenishment budget. */
  harvest?: number;
  /** the queen's larder fill (0..1) — set by the sim's render. */
  larder?: number;
  /** fresh fungus heaped on the queen's chamber floor, before the repletes eat it (0..1). */
  pile?: number;
  /** cumulative ants the colony has produced (persistent founders + every forager ever),
   *  so retired/faded ants still count — diverges from the chamber count over a session. */
  antsTotal?: number;
  /** cumulative leaves ever foraged (web + scout) — the lifetime top-HUD counter. */
  leavesTotal?: number;
}
export const SURFACE = "__surface__";
/** ROOT is the queen's central anchor; every later session gets its OWN surface anchor,
 *  `__surface__#<id>`, so they all start with SURFACE — one colony, many doors. */
export const isSurface = (id: string | undefined): boolean => !!id && id.startsWith(SURFACE);

const ROOT = "__surface__";
const GAP = 12;            // soil between two chambers
const QUEEN_DEPTH = 360;   // entrance shaft to the queen — deep, but not a long empty drop
const ENTRY_DEPTH = 170;   // a later session's entry room sits in the SHALLOW strata, above the queen
const ENTRY_GAP = 320;     // clear soil between the warren's current edge and a new session's hole
const REACH = 0.95;        // tunnel length as a fraction of token-distance
const FLOOR = 2650;        // hard depth cap: digs turn UP near here and none pass it
                           // (the cobble bedrock lies below this, unreachable by the colony)
const FLOOR_BAND = 520;    // within this of the floor, digs bias upward & rooms brood less

/** Clamp a chamber's depth to the diggable range — never above the queen's level,
 *  never past the floor (so the colony can't grow down into the bedrock). */
function clampY(y: number): number { return Math.min(FLOOR, Math.max(QUEEN_DEPTH * 0.4, y)); }

interface Placed { id: string; x: number; y: number; r: number; }
interface Ctx {
  pos: Map<string, { x: number; y: number; r: number }>;
  parentPos: Map<string, { x: number; y: number }>;
  node: Map<string, CNode>;
  placed: Placed[];
  edges: CEdge[];
  childCount: Map<string, number>;
  depth: Map<string, number>;
  fatten: Map<string, number>; // times a room has absorbed a boxed-in child → crowded
  durations: number[]; // turn durations seen so far, in dig order → running median
}

// (angle-offset, distance-multiplier) probes. The new tunnel keeps turning
// further from its heading until it finds a path clear of every chamber & tunnel.
const CAND: Array<[number, number]> = (() => {
  const out: Array<[number, number]> = [];
  // exhaust many ANGLES at the intended distance before ever pushing the chamber
  // farther out — so a tunnel's length stays tied to its duration, not crowding.
  const angles = [0, 0.2, -0.2, 0.4, -0.4, 0.62, -0.62, 0.86, -0.86, 1.12, -1.12, 1.5, -1.5, 2.0, -2.0];
  for (const dd of [0, 0.25, 0.6, 1.1]) for (const a of angles) out.push([a, dd]);
  return out;
})();

// Seeded once per session (page load): the colony's shape is random each run but
// stable within a run, so nothing already-dug ever jumps.
let LSEED = "";
function rs(s: string): number { return rnd(`${LSEED}~${s}`); }

/**
 * Lays out the colony as an anthill cross-section that GROWS BY EGGS.
 *
 *   - The queen chamber is the founding root, dug DEEP below the surface so the
 *     colony has room to fork up as well as down.
 *   - Every chamber holds at most one egg. To dig the next chamber an egg hatches
 *     into a digger (a turn that edited → carves down/out) or a forager (a
 *     gather-only turn → carves UP toward the surface). Hatching spends the egg;
 *     the source room can't dig again until one more chamber finishes (cooldown),
 *     so the colony forks instead of spining. The next digger is chosen among
 *     egg-holding rooms, weighted toward shallow, lightly-tunnelled ones — and
 *     headings are horizontal-dominant, so it spreads OUT more than it descends.
 *   - A real subagent is a hard branch off the chamber that spawned it.
 *   - Tunnels never cross. If a new room can't find a clear spot, its work
 *     fattens the parent chamber (which grows) instead of overlapping.
 *
 * Placement is deterministic and append-only: nothing already dug ever moves.
 */
export class TreeLayout {
  // a chamber's spot is frozen the first time it's placed, so blueprint re-shuffles
  // (the frontier accruing, trivial turns crossing the merge threshold) never drag
  // an already-dug chamber off its tunnel.
  private posCache = new Map<string, { x: number; y: number }>();
  // the heading a live-dug tunnel set out on — kept stable so the tunnel extends
  // straight as the turn is worked, instead of re-searching (and jittering) each frame.
  private headingCache = new Map<string, number>();

  update(snap: ColonySnapshot): Tree {
    const queenId = (snap.bugs.find((b) => !b.parentId) ?? snap.bugs[0])?.id;
    // Seed the warren's shape from the (stable) session id, NOT Math.random — so the
    // same data always lays out the same colony, with the same chamber count, on every
    // refresh. Different sessions still differ (different id → different seed). Before,
    // a fresh random seed each load changed which chambers fattened into their parent,
    // so the chamber count visibly wobbled between refreshes.
    if (!LSEED) LSEED = queenId || "loam";

    const lineages = new Map<string, CNode[]>();
    const antHub = new Map<string, string>();
    const antLast = new Map<string, string>();
    const bugById = new Map(snap.bugs.map((b) => [b.id, b]));
    for (const b of snap.bugs) {
      const chambers = mergeTrivial(b.tasks, b.id, b.caste);
      if (!chambers.length) continue;
      chambers[0].isHub = true;
      if (b.id === queenId) chambers[0].isQueen = true;
      lineages.set(b.id, chambers);
      antHub.set(b.id, chambers[0].id);
      antLast.set(b.id, chambers[chambers.length - 1].id);
    }

    const ctx: Ctx = {
      pos: new Map([[ROOT, { x: 0, y: 0, r: 0 }]]),
      parentPos: new Map(), node: new Map(), placed: [], edges: [],
      childCount: new Map(), depth: new Map([[ROOT, 0]]), fatten: new Map(), durations: [],
    };
    const redirect = new Map<string, string>(); // chamber that fattened away → the room it grew

    // The founding queen first (+ her whole subtree), then each later top-level session,
    // then their subtrees — depth-first, so the warren's width is known when we site the
    // next session's hole off to the side.
    const order = orderLineages(snap.bugs, queenId, antHub);
    const holes: Pt[] = [{ x: 0, y: 0 }]; // the queen's central hole; each session adds its own
    const connectors: CEdge[] = [];        // a stitch from each session's entry room to the warren
    let satSide = 1;                       // alternate new holes left/right of the colony
    for (const id of order) {
      const chambers = lineages.get(id);
      if (!chambers) continue;
      const b = bugById.get(id)!;
      let rootParent: string;
      if (b.parentId) {
        // a subagent is a hard branch off the chamber/session that spawned it
        rootParent =
          b.parentTaskId && ctx.node.has(b.parentTaskId) ? b.parentTaskId :
          antHub.has(b.parentId) && ctx.node.has(antHub.get(b.parentId)!) ? antHub.get(b.parentId)! :
          ROOT;
      } else if (id === queenId) {
        rootParent = ROOT; // the central shaft down to the deep founding heart
      } else {
        // a later session: its OWN hole + a shallow entry room off to the side of the warren
        const { minX, maxX } = xSpan(ctx.placed);
        const entryX = satSide > 0 ? maxX + ENTRY_GAP : minX - ENTRY_GAP;
        satSide = -satSide;
        rootParent = `${SURFACE}#${id}`;
        ctx.pos.set(rootParent, { x: entryX, y: 0, r: 0 });
        ctx.depth.set(rootParent, 0);
        holes.push({ x: entryX, y: 0 });
      }
      const before = ctx.placed.length;
      this.placeLineage(chambers, rootParent, ctx, redirect);
      if (!b.parentId && id !== queenId) {
        // stitch the new session into the one colony: a connector tunnel from its entry
        // room to the nearest existing chamber, so ants can haul across (food economy holds).
        const hub = ctx.pos.get(antHub.get(id)!);
        const near = nearestPlaced(hub, ctx.placed.slice(0, before));
        if (hub && near) connectors.push({ ax: hub.x, ay: hub.y, bx: near.x, by: near.y, fromId: antHub.get(id)!, toId: near.id, cross: true });
      }
    }

    const resolve = (id: string | undefined) => {
      let cur = id, hop = 0;
      while (cur && redirect.has(cur) && hop++ < 999) cur = redirect.get(cur);
      return cur;
    };

    const nodes = [...ctx.node.values()];
    const ants: AntDot[] = [];
    let newest: { x: number; y: number } | null = null, newestTs = -1, newestId: string | null = null;
    for (const b of snap.bugs) {
      const id = resolve(b.id === queenId ? antHub.get(b.id) : antLast.get(b.id));
      const node = id ? ctx.node.get(id) : undefined;
      if (!node) continue;
      const pp = ctx.parentPos.get(node.id);
      let angle = Math.PI / 2;
      if (pp && (node.x !== pp.x || node.y !== pp.y)) angle = Math.atan2(node.y - pp.y, node.x - pp.x);
      ants.push({
        antId: b.id, caste: b.id === queenId ? "queen" : b.caste,
        x: node.x, y: node.y, digging: b.state === "digging", angle,
      });
      if (b.lastActiveTs > newestTs) {
        newestTs = b.lastActiveTs;
        // point `newest` at the live FRONTIER (the session's last turn), even for the
        // queen — whose dot sits on the hub, so `node` here is the hub, not the work.
        const fid = resolve(antLast.get(b.id));
        const fnode = fid ? ctx.node.get(fid) : undefined;
        newestId = fnode ? fid! : node.id;
        newest = fnode ? { x: fnode.x, y: fnode.y } : { x: node.x, y: node.y };
      }
    }

    const allEdges = [...ctx.edges, ...connectors, ...crossLinks(ctx)];
    const tunnels: Tunnel[] = allEdges.map((e) => {
      // an in-progress (still-extending) tunnel uses an arc-length meander so its
      // dug part doesn't reshuffle each frame as it lengthens; sealed ones meander normally.
      const node = !e.cross ? ctx.node.get(e.toId) : undefined;
      const m = node && !node.done ? livePath(e, e.toId) : meanderPath(e);
      return { fromId: e.fromId, toId: e.toId, pts: m.pts, w: e.cross ? m.w * 0.82 : m.w, carve: 1, cross: e.cross };
    });
    const forages: ForageInfo[] = [];
    for (const b of snap.bugs) {
      for (const f of b.forages ?? []) {
        let cid = resolve(f.taskId);                       // the forage's own chamber…
        if (!cid || !ctx.node.has(cid)) cid = resolve(antLast.get(b.id)); // …else the session's frontier
        if (cid && ctx.node.has(cid)) forages.push({ id: f.id, chamberId: cid, inFlight: f.doneTs === undefined });
      }
    }
    return { nodes, tunnels, ants, flora: [], forages, leaves: [], hole: { x: 0, y: 0 }, holes, newest, newestId, newestTs, bounds: bounds(nodes), harvest: snap.harvest };
  }

  /** Run the egg simulation over one lineage and place (or fatten) each chamber. */
  private placeLineage(chambers: CNode[], rootParent: string, ctx: Ctx, redirect: Map<string, string>): void {
    const hasEgg = new Map<string, boolean>();
    const consumedAt = new Map<string, number>();
    const parentOf = new Map<string, string>();
    const live: CNode[] = [];

    chambers.forEach((c, k) => {
      for (const [cid, step] of [...consumedAt]) {
        if (step <= k - 2) { hasEgg.set(cid, true); consumedAt.delete(cid); }
      }
      let parent: string;
      if (k === 0) {
        parent = rootParent;
      } else {
        const eligible = live.filter((x) => hasEgg.get(x.id));
        const pick = eligible.length ? this.chooseDigger(eligible, c.id, ctx) : live[live.length - 1];
        parent = pick.id;
        hasEgg.set(parent, false);
        consumedAt.set(parent, k);
      }
      parentOf.set(c.id, parent);

      // the live, in-progress frontier must always place (never fatten away) — else
      // there's no chamber to dig live, and the turn just vanishes into a parent.
      const placed = this.placeChamber(c, parent, ctx, k === 0 || !c.done);
      if (placed) {
        live.push(c); hasEgg.set(c.id, !c.blocked); // a rock-blocked dig spawns nothing
      } else {
        // no clear room — the work fattens the parent chamber, which grows. Tally it
        // so chooseDigger stops picking this (now boxed-in) room for later turns.
        ctx.fatten.set(parent, (ctx.fatten.get(parent) ?? 0) + 1);
        growChamber(parent, c, ctx);
        redirect.set(c.id, parent);
      }
    });

    for (const c of live) c.egg = hasEgg.get(c.id) ? "egg" : "none";
    const last = live[live.length - 1];
    if (last && !last.done) {
      const p = parentOf.get(last.id);
      const pc = p ? live.find((x) => x.id === p) : undefined;
      if (pc) pc.egg = "hatched";
    }
  }

  /** Weighted pick among egg-holding rooms: favour shallow, lightly-tunnelled
   *  chambers so the colony spreads outward before plunging deep. */
  private chooseDigger(eligible: CNode[], newId: string, ctx: Ctx): CNode {
    let best = eligible[0], bestScore = -Infinity;
    for (const c of eligible) {
      const kids = ctx.childCount.get(c.id) ?? 0;
      const fat = ctx.fatten.get(c.id) ?? 0;
      const dep = ctx.depth.get(c.id) ?? 0;
      const py = ctx.pos.get(c.id)?.y ?? 0;
      // rooms approaching the floor brood less — the colony stops drilling down and
      // builds back up instead (0 well above the floor → ~1 right at it).
      const floorN = clamp((py - (FLOOR - FLOOR_BAND)) / FLOOR_BAND, 0, 1);
      // a room that already failed to fit a child is boxed in — weight it down hard
      // (each fatten counts like 4 children) so it stops swallowing every later turn.
      const base = (1 / (1 + kids + 4 * fat)) * (1 / (1 + 0.22 * dep)) * (1 - 0.75 * floorN);
      const score = base * (0.55 + 0.9 * rs(newId + "|" + c.id));
      if (score > bestScore) { bestScore = score; best = c; }
    }
    return best;
  }

  /** Returns true if a clear spot was found (and the chamber placed). When
   *  mustPlace is set (hubs), it always places, taking the roomiest spot. */
  private placeChamber(c: CNode, parentId: string, ctx: Ctx, mustPlace: boolean): boolean {
    const p = ctx.pos.get(parentId)!;
    const r = c.blocked ? 15 : chamberRadius(c.tokens, c.isQueen); // a blocked dig is a small rock-pocket, not a room
    const slot = ctx.childCount.get(parentId) ?? 0;
    ctx.durations.push(c.durationMs);

    let bx: number, by: number;
    const med = median(ctx.durations); // running median of turns dug so far
    const frozen = this.posCache.get(c.id);
    if (frozen) {
      bx = frozen.x; by = frozen.y; // sealed turn → fixed spot, never drifts
    } else if (!isSurface(parentId) && this.headingCache.has(c.id)) {
      // a turn being dug live: keep its established heading, set length from its
      // CURRENT duration so the tunnel keeps lengthening as the work piles up.
      const ang = this.headingCache.get(c.id)!;
      const reach = p.r + r + relLength(c.durationMs, med) * REACH;
      bx = p.x + Math.cos(ang) * reach;
      by = clampY(p.y + Math.sin(ang) * reach);
    } else {
      let baseAng: number, reach: number, vSign = 1;
      if (isSurface(parentId)) {
        // a straight shaft down from a surface hole: deep to the founding queen, shallow
        // to a later session's entry room.
        baseAng = Math.PI / 2; reach = parentId === ROOT ? QUEEN_DEPTH : ENTRY_DEPTH;
      } else {
        // near the floor the dig turns UP instead of down — the colony builds back
        // up rather than drilling into bedrock; the closer to the floor, the likelier.
        const upBias = clamp((p.y - (FLOOR - FLOOR_BAND)) / FLOOR_BAND, 0, 1);
        vSign = rs(c.id + "up") < upBias ? -1 : 1;
        // every chamber is dug by a worker: out and gently down (horizontal-
        // dominant). Length tracks the turn's TIME; the room's size its tokens.
        const side = slot === 0 ? (rs(c.id) < 0.5 ? -1 : 1) : (slot % 2 ? 1 : -1);
        const hx = side * 1.0 + (rs(c.id + "x") - 0.5) * 0.5;
        const hy = vSign * (0.32 + rs(c.id + "v") * 0.26);
        baseAng = Math.atan2(hy, hx);
        reach = p.r + r + relLength(c.durationMs, med) * REACH;
      }
      bx = p.x + Math.cos(baseAng) * reach; by = clampY(p.y + Math.sin(baseAng) * reach);
      let bestScore = -Infinity, found = false;
      for (const [da, dd] of CAND) {
        // keep the search in the digging hemisphere — down normally, up near the floor
        const lo = vSign > 0 ? Math.PI * 0.06 : -Math.PI * 0.94;
        const hi = vSign > 0 ? Math.PI * 0.94 : -Math.PI * 0.06;
        const a = isSurface(parentId) ? baseAng + da : clamp(baseAng + da, lo, hi);
        const d = reach * (1 + dd);
        const x = p.x + Math.cos(a) * d, y = clampY(p.y + Math.sin(a) * d);
        const s = clearance(x, y, r, parentId, ctx);
        if (s > 0) { bx = x; by = y; found = true; break; }
        if (s > bestScore) { bestScore = s; bx = x; by = y; }
      }
      if (!found && !mustPlace) return false;
      if (!isSurface(parentId)) this.headingCache.set(c.id, Math.atan2(by - p.y, bx - p.x));
    }
    // once the turn is sealed its length is final — freeze the spot so it never drifts
    if (c.done) this.posCache.set(c.id, { x: bx, y: by });

    ctx.pos.set(c.id, { x: bx, y: by, r });
    ctx.parentPos.set(c.id, { x: p.x, y: p.y });
    ctx.edges.push({ ax: p.x, ay: p.y, bx, by, fromId: parentId, toId: c.id });
    ctx.placed.push({ id: c.id, x: bx, y: by, r });
    ctx.childCount.set(parentId, slot + 1);
    ctx.depth.set(c.id, (ctx.depth.get(parentId) ?? 0) + 1);
    ctx.node.set(c.id, c);
    c.x = bx; c.y = by; c.r = r;
    return true;
  }
}

/** A chamber absorbs a turn that had nowhere to go, growing to hold the extra work. */
function growChamber(id: string, extra: CNode, ctx: Ctx): void {
  const n = ctx.node.get(id);
  if (!n) return;
  n.tokens += extra.tokens; n.actions += extra.actions;
  n.children += extra.children; n.durationMs += extra.durationMs;
  n.edited = n.edited || extra.edited;
  n.defended = n.defended || extra.defended;
  n.linesAdded += extra.linesAdded; n.linesRemoved += extra.linesRemoved;
  n.reads += extra.reads; n.committed = n.committed || extra.committed;
  n.r = chamberRadius(n.tokens, n.isQueen);
  const pe = ctx.pos.get(id); if (pe) pe.r = n.r;
  const pl = ctx.placed.find((q) => q.id === id); if (pl) pl.r = n.r;
}

/** Signed clearance of a spot: >0 means the room and its new tunnel clear every
 *  existing chamber and tunnel; the more negative, the worse. */
function clearance(x: number, y: number, r: number, parentId: string, ctx: Ctx): number {
  const p = ctx.pos.get(parentId)!;
  let worst = Infinity;
  for (const q of ctx.placed) {
    if (q.id === parentId) continue;
    worst = Math.min(worst, Math.hypot(x - q.x, y - q.y) - (r + q.r + GAP));
    worst = Math.min(worst, distPointSeg(q.x, q.y, p.x, p.y, x, y) - (q.r + 4));
  }
  for (const e of ctx.edges) {
    worst = Math.min(worst, distPointSeg(x, y, e.ax, e.ay, e.bx, e.by) - (r + 4));
    if (segIntersect(p.x, p.y, x, y, e.ax, e.ay, e.bx, e.by)) worst = Math.min(worst, -50);
  }
  return worst === Infinity ? 1 : worst;
}

/** Depth-first: the queen's WHOLE subtree first, then each later top-level session with
 *  its whole subtree, so the warren's width is fully known before the next session's hole
 *  is sited off to the side. (antHub is unused now but kept for the call site's signature.) */
function orderLineages(bugs: ColonySnapshot["bugs"], queenId: string | undefined, _antHub: Map<string, string>): string[] {
  const kids = new Map<string, string[]>();
  for (const b of bugs) if (b.parentId) (kids.get(b.parentId) ?? kids.set(b.parentId, []).get(b.parentId)!).push(b.id);
  const order: string[] = [];
  const seen = new Set<string>();
  const visit = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id); order.push(id);
    for (const k of kids.get(id) ?? []) visit(k); // …then its subagents (and theirs)
  };
  if (queenId) visit(queenId);                       // the founding queen + her subtree
  for (const b of bugs) if (!b.parentId) visit(b.id); // each other top-level session + its subtree
  for (const b of bugs) visit(b.id);                  // any orphan (parent missing) — append
  return order;
}

/** The x-extent of everything placed so far (chamber edges), for siting the next hole. */
function xSpan(placed: Placed[]): { minX: number; maxX: number } {
  let minX = 0, maxX = 0;
  for (const p of placed) { minX = Math.min(minX, p.x - p.r); maxX = Math.max(maxX, p.x + p.r); }
  return { minX, maxX };
}

/** The placed chamber nearest a point — the stitch target for a new session's connector. */
function nearestPlaced(pt: { x: number; y: number } | undefined, placed: Placed[]): Placed | undefined {
  if (!pt) return undefined;
  let best: Placed | undefined, bd = Infinity;
  for (const q of placed) { const d = Math.hypot(q.x - pt.x, q.y - pt.y); if (d < bd) { bd = d; best = q; } }
  return best;
}

/** Merge trivial finished turns into their predecessor instead of digging a room. */
function mergeTrivial(tasks: TaskSnapshot[], antId: string, caste: Caste): CNode[] {
  const merged: CNode[] = [];
  let prev: CNode | null = null;
  for (const t of tasks) {
    const trivial = t.done && !t.hung && prev && !t.edited && !t.blocked && t.children === 0 && t.tokens < TRIVIAL_TOKENS; // a hung turn always keeps its own (trailing) tunnel
    if (trivial && prev) {
      prev.tokens += t.tokens; prev.actions += t.actions;
      prev.children += t.children; prev.durationMs += t.durationMs;
      prev.defended = prev.defended || t.defended; // a merged test/error turn still guards
      prev.linesAdded += t.linesAdded; prev.linesRemoved += t.linesRemoved; // and its diff feeds the crop
      prev.reads += t.reads; prev.committed = prev.committed || t.committed;
      continue;
    }
    const cn: CNode = {
      id: t.id, label: t.label, tokens: t.tokens, actions: t.actions, durationMs: t.durationMs, startTs: t.startTs,
      children: t.children, edited: t.edited, defended: t.defended, blocked: t.blocked, done: t.done, hung: t.hung,
      linesAdded: t.linesAdded, linesRemoved: t.linesRemoved, reads: t.reads, committed: t.committed,
      antId, caste, isQueen: false, isHub: false, egg: "none", x: 0, y: 0, r: 0,
    };
    merged.push(cn); prev = cn;
  }
  return merged;
}

function bounds(ns: CNode[]) {
  let minX = 0, maxX = 0, minY = 0, maxY = 0;
  for (const n of ns) {
    minX = Math.min(minX, n.x - n.r); maxX = Math.max(maxX, n.x + n.r);
    minY = Math.min(minY, n.y - n.r); maxY = Math.max(maxY, n.y + n.r);
  }
  return { minX, maxX, minY, maxY };
}

function distPointSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy || 1e-6;
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function segIntersect(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): boolean {
  const o = (px: number, py: number, qx: number, qy: number, rx: number, ry: number) =>
    Math.sign((qx - px) * (ry - py) - (qy - py) * (rx - px));
  if ((ax === cx && ay === cy) || (ax === dx && ay === dy) || (bx === cx && by === cy) || (bx === dx && by === dy)) return false;
  return o(ax, ay, bx, by, cx, cy) !== o(ax, ay, bx, by, dx, dy) &&
    o(cx, cy, dx, dy, ax, ay) !== o(cx, cy, dx, dy, bx, by);
}

/** A wandering tunnel between two chambers: endpoints pinned (so it meets the
 *  rooms) and interior points eased sideways by stable noise so it snakes.
 *  Returns the polyline plus a per-tunnel base width (galleries dug unevenly). */
function meanderPath(e: CEdge): { pts: Pt[]; w: number } {
  const dx = e.bx - e.ax, dy = e.by - e.ay;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len; // unit perpendicular
  const key = `${Math.round(e.ax)},${Math.round(e.ay)},${Math.round(e.bx)},${Math.round(e.by)}`;
  const segs = Math.max(2, Math.min(7, Math.round(len / 26)));
  const amp = Math.min(11, len * 0.12);
  const pts: Pt[] = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const off = (i === 0 || i === segs) ? 0 : (rs(`${key}~${i}`) - 0.5) * 2 * amp * Math.sin(Math.PI * t);
    pts.push({ x: e.ax + dx * t + nx * off, y: e.ay + dy * t + ny * off });
  }
  return { pts, w: 18 * (0.9 + rs(key) * 0.22) };
}

/** A live-dug (still-extending) tunnel: its meander is pinned by ARC-LENGTH from
 *  the fixed parent end, with a stable per-tunnel seed — so as the tunnel lengthens
 *  the already-dug part never shifts (no distracting jitter); only fresh wiggle is
 *  added near the tip the digger is at. Eased to 0 where it meets the parent room.
 *
 *  Trade-off (accepted; revisit only if it's raised): this reads a touch more
 *  ANGULAR than the sealed tunnels' `meanderPath`, and re-smooths when the room
 *  drops. To smooth without losing the arc-length pinning, soften the profile —
 *  larger STEP, or interpolate the per-bend offsets / use continuous noise over s. */
function livePath(e: CEdge, id: string): { pts: Pt[]; w: number } {
  const dx = e.bx - e.ax, dy = e.by - e.ay;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;     // unit along the tunnel
  const nx = -uy, ny = ux;                 // unit perpendicular
  const STEP = 30, AMP = 10;
  const pts: Pt[] = [{ x: e.ax, y: e.ay }];
  const n = Math.floor(len / STEP);
  for (let i = 1; i <= n; i++) {
    const s = i * STEP;                     // fixed arc-length from the parent (never moves)
    const off = (rs(`${id}~L${i}`) - 0.5) * 2 * AMP * Math.min(1, s / 55);
    pts.push({ x: e.ax + ux * s + nx * off, y: e.ay + uy * s + ny * off });
  }
  pts.push({ x: e.bx, y: e.by });           // the tip the digger is carving
  return { pts, w: 18 * (0.9 + rs(id) * 0.22) };
}

const CROSS_DIST = 98;  // chambers closer than this may share a connecting gallery
const CROSS_PER = 1;    // extra links dug per chamber

/**
 * Extra galleries between chambers that ended up neighbours — so the colony is a
 * NETWORK with junctions (a chamber with 3+ tunnels is a decision point), not a
 * tree of dead-end tracks. Links only join two real chambers and never tunnel
 * through a third, so chambers stay the junctions.
 */
function crossLinks(ctx: Ctx): CEdge[] {
  const ps = ctx.placed;
  const joined = new Set<string>();
  const key = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  for (const e of ctx.edges) joined.add(key(e.fromId, e.toId));

  const out: CEdge[] = [];
  for (let i = 0; i < ps.length; i++) {
    if (ctx.node.get(ps[i].id)?.blocked) continue; // a rock is a dead-end — no shortcuts through it
    const near = ps
      .map((q, j) => ({ j, d: i === j ? Infinity : Math.hypot(ps[i].x - q.x, ps[i].y - q.y) }))
      .filter((c) => c.d < CROSS_DIST)
      .sort((a, b) => a.d - b.d);
    let added = 0;
    for (const { j } of near) {
      if (added >= CROSS_PER) break;
      if (ctx.node.get(ps[j].id)?.blocked) continue;
      const a = ps[i], b = ps[j], k = key(a.id, b.id);
      if (joined.has(k)) continue;
      if (!clearOfChambers(a, b, ps)) continue;
      joined.add(k); added++;
      out.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y, fromId: a.id, toId: b.id, cross: true });
    }
  }
  return out;
}

function clearOfChambers(a: Placed, b: Placed, ps: Placed[]): boolean {
  for (const q of ps) {
    if (q.id === a.id || q.id === b.id) continue;
    if (distPointSeg(q.x, q.y, a.x, a.y, b.x, b.y) < q.r + 6) return false;
  }
  return true;
}

function median(arr: number[]): number {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Stable [0,1) value from a string key. */
function rnd(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 100000) / 100000;
}
