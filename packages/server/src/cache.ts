import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * A lightweight disk cache for the colony — the server's OWN file, written under
 * ~/.claude/simantics/ (NEVER inside ~/.claude/projects; transcripts stay read-only).
 * On a restart we hydrate the colony and resume tailing from saved file offsets
 * instead of cold-draining the whole transcript tree from scratch.
 *
 * Anything missing/stale/malformed → we ignore the cache and fall back to the
 * existing cold-drain path. The cache is an optimization, never a source of truth.
 */

// Bump when the serialized shape changes — an old cache is then ignored, not parsed.
const CACHE_VERSION = 4; // v4: continuation files are deduped (subsumed predecessors dropped) — older caches held the dupes, so cold-drain fresh

const CACHE_DIR = join(homedir(), ".claude", "simantics");

export interface CacheFile {
  version: number;
  /** the watched transcript root this cache belongs to (sanity check vs. the key) */
  root: string;
  /** epoch ms the cache was written */
  savedAt: number;
  /** per-file read offset at save time — keys are absolute .jsonl paths */
  offsets: Record<string, number>;
  /** the colony's full internal state (Colony.serialize() output) */
  colony: unknown;
}

/** A tiny FNV-1a hash → stable hex key. Avoids pulling in node:crypto; the key just
 *  needs to be a filesystem-safe, collision-rare fingerprint of the root path (and
 *  the stored `root` field guards against the rare collision anyway). */
function hashKey(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** One cache file per watched root, keyed by a short hash of its absolute path. */
function cachePath(root: string): string {
  return join(CACHE_DIR, `colony-${hashKey(root)}.json`);
}

/**
 * Load + validate the cache for `root`. Returns null (→ cold-drain) when the cache
 * is absent, the wrong version/root, unparseable, or any tracked file has since been
 * truncated/rotated/removed (shorter than its saved offset). Validating the whole
 * cache as a unit keeps recovery simple and safe — no partial-trust bookkeeping.
 */
export function loadCache(root: string): CacheFile | null {
  let parsed: CacheFile;
  try {
    parsed = JSON.parse(readFileSync(cachePath(root), "utf8")) as CacheFile;
  } catch {
    return null; // missing or unreadable — cold-drain
  }

  if (parsed?.version !== CACHE_VERSION) return null; // stale shape
  if (parsed.root !== root) return null; // hash collision / wrong root
  if (!parsed.offsets || typeof parsed.offsets !== "object") return null;

  // If any tracked file is now SHORTER than its saved offset (or gone), the
  // transcript was truncated/rotated under us — invalidate the WHOLE cache rather
  // than risk replaying from a stale offset into a different file.
  for (const [path, off] of Object.entries(parsed.offsets)) {
    let size: number;
    try {
      size = statSync(path).size;
    } catch {
      return null; // a tracked file vanished
    }
    if (typeof off !== "number" || size < off) return null;
  }

  return parsed;
}

/**
 * Write the cache atomically (temp file + rename) so a crash mid-write can't leave a
 * half-written, unparseable cache behind. mkdir is recursive + idempotent. Failures
 * are swallowed — persistence is best-effort and must never take the server down.
 */
export function saveCache(root: string, offsets: Record<string, number>, colony: unknown): void {
  const data: CacheFile = { version: CACHE_VERSION, root, savedAt: Date.now(), offsets, colony };
  const path = cachePath(root);
  const tmp = `${path}.tmp`;
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(tmp, JSON.stringify(data), "utf8");
    renameSync(tmp, path);
  } catch {
    // best-effort: a failed save just means the next boot cold-drains
  }
}
