/**
 * World constants for the anthill cross-section. The surface is at worldY = 0;
 * deeper = larger y. The colony grows downward and outward; the client owns all
 * of this geometry — the server never sends coordinates.
 */

export const SURFACE_Y = 0; // grass meets soil here
export const GRASS_H = 46; // how much air/grass sits above the surface line

// chamber sizing (from a task's tokens) — the room is the headline "effort"
// signal, so it scales hard with tokens and never gets smaller than an ant.
export const R_MIN = 17;
export const R_MAX = 84;
export const R_PER_SQRT_TOKEN = 0.24;

// tunnel length — tied to TIME, but RELATIVE to how long this session's turns
// usually take, so "long" means long-for-this-session. Mapped in log space
// around the running median, so a session that's all-long doesn't peg every
// tunnel at the cap, and a genuine outlier still stands out.
export const SEG_BASE = 46;
export const SEG_MAX = 360;
export const LEN_SPREAD = 3; // octaves of duration-ratio spread across the range

// horizontal breathing room between sibling subtrees
export const H_GAP = 30;

// a "trivial" finished task fattens its predecessor instead of earning a room
export const TRIVIAL_TOKENS = 4000;

export function chamberRadius(tokens: number, isQueen = false): number {
  const r = R_MIN + Math.sqrt(Math.max(0, tokens)) * R_PER_SQRT_TOKEN;
  return clamp(isQueen ? r + 46 : r, isQueen ? R_MIN + 46 : R_MIN, R_MAX + (isQueen ? 72 : 0));
}

export function relLength(durationMs: number, medianMs: number): number {
  const ratio = (Math.max(0, durationMs) + 1000) / (Math.max(0, medianMs) + 1000);
  const norm = clamp(0.5 + Math.log2(ratio) / (2 * LEN_SPREAD), 0, 1);
  return SEG_BASE + (SEG_MAX - SEG_BASE) * norm;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// fungus economy: a chamber's net diff (added − removed) sets how much crop it can
// hold; the crop grows toward that cap while fed and settles to a standing-culture
// floor when idle (the garden persists, like a real fungus farm kept on a seed culture).
export const CROP_FULL_LINES = 60; // a ~60-net-line turn = a full fungus patch
export const CROP_REGROW = 0.03;   // per-frame ease of crop toward cap WHILE leaves feed it
export const CROP_SEED = 0.25;     // starter fungus a coding turn drops at once (before any leaves arrive)
export const LEAF_YIELD = 2.5;     // crop grown per leaf spent — high yield keeps the colony sustainable on few leaves
export const LARDER_FULL = 320;    // colony harvest (Σ net lines) that fills the larder shelf

/** Map a chamber's net diff to its crop capacity (0..1). */
export function cropTarget(net: number): number {
  return clamp(net / CROP_FULL_LINES, 0, 1);
}
