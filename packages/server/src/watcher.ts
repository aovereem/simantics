import { watch, type FSWatcher } from "chokidar";
import { createReadStream, statSync, openSync, readSync, closeSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { basename } from "node:path";
import type { Fact } from "@simantics/shared";
import { parseLine } from "./parser.js";

export const DEFAULT_TRANSCRIPT_GLOB = join(homedir(), ".claude", "projects");

const RECENT_MS = 30 * 60_000; // only cold-load transcripts touched this recently

/**
 * Tails Claude Code transcripts. Tracks a read offset per file so we only parse
 * newly appended lines. Read-only; never writes anything back.
 */
export class TranscriptWatcher {
  private watcher?: FSWatcher;
  private offsets = new Map<string, number>();
  private rootCache = new Map<string, string>(); // file path → its conversation root (first message uuid)

  constructor(private root: string = DEFAULT_TRANSCRIPT_GLOB, private loadAll = false) {}

  /** The watched transcript root — used to key the disk cache. */
  get watchRoot(): string {
    return this.root;
  }

  /** Snapshot the per-file read offsets so a restart can resume tailing. */
  getOffsets(): Record<string, number> {
    return Object.fromEntries(this.offsets);
  }

  /**
   * Seed offsets BEFORE start() so the initial scan skips already-read bytes and
   * only parses lines appended since the cache was written. A file present here is
   * also treated as "already touched", so the RECENT_MS skip won't drop it.
   */
  seedOffsets(offsets: Record<string, number>): void {
    for (const [path, off] of Object.entries(offsets)) {
      if (typeof off === "number" && off >= 0) this.offsets.set(path, off);
    }
  }

  start(onFact: (fact: Fact) => void, onDropSession: (sessionId: string) => void = () => {}): void {
    // chokidar v4 dropped glob support — watch the projects dir itself
    // (recursive by default) and filter to .jsonl ourselves. Watching a literal
    // glob string here silently matched nothing on Windows (backslash paths).
    this.watcher = watch(this.root, {
      ignoreInitial: false,
      persistent: true,
      awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 40 },
    });

    // The initial scan reads files in arbitrary order, but a subagent only links
    // to its parent chamber if facts arrive in time order. So buffer everything
    // from the initial scan, then flush it sorted by timestamp; after that, stream
    // live facts straight through (they already arrive in order).
    const buffer: Fact[] = [];
    let ready = false;
    const emit = (fact: Fact) => { if (ready) onFact(fact); else buffer.push(fact); };

    // A continued conversation (--continue / a fresh session after the old one filled
    // its context) REPLAYS its predecessor verbatim into a new file — same message uuids,
    // same conversation root. Draining both would count the same work twice (or thrice).
    // So we key files by conversation root and only ever drain the LATEST one per root.
    const initial: string[] = [];                  // files seen during the initial scan
    const chosen = new Map<string, string>();      // conversation root → the live file we drain
    const mtimeOf = (path: string) => { try { return statSync(path).mtimeMs; } catch { return 0; } };

    const handle = (path: string) => {
      if (!path.endsWith(".jsonl")) return;
      if (!ready) { initial.push(path); return; } // collect; the root grouping happens at 'ready'
      // live: a file appeared/changed after the initial scan
      const root = this.fileRoot(path);
      const cur = chosen.get(root);
      if (!cur || cur === path) { chosen.set(root, path); void this.drain(path, emit); return; }
      if (mtimeOf(path) > mtimeOf(cur)) {           // a fresh continuation supersedes its predecessor
        onDropSession(basename(cur, ".jsonl"));     // its nest moves to the new (fuller) session
        this.offsets.delete(cur);
        chosen.set(root, path);
        void this.drain(path, emit);
      }
      // else: an older predecessor of an already-chosen file → ignore (its work lives in `cur`)
    };
    this.watcher.on("add", handle).on("change", handle);
    this.watcher.on("ready", async () => {
      // group the initial files by conversation root, keep the newest per root, drain those
      const latest = new Map<string, string>();
      for (const path of initial) {
        const root = this.fileRoot(path);
        const cur = latest.get(root);
        if (!cur || mtimeOf(path) > mtimeOf(cur)) latest.set(root, path);
      }
      const drains: Promise<void>[] = [];
      for (const [root, path] of latest) { chosen.set(root, path); drains.push(this.drain(path, emit)); }
      await Promise.allSettled(drains);
      buffer.sort((a, b) => a.ts - b.ts);
      for (const fact of buffer) onFact(fact);
      buffer.length = 0;
      ready = true;
    });
  }

  /** A file's conversation root = the first message uuid in it. Continuations replay
   *  from the same root, so they share it; independent conversations don't. Reads only
   *  the head (cheap, cached). Falls back to the file's own name → its own group. */
  private fileRoot(path: string): string {
    const cached = this.rootCache.get(path);
    if (cached) return cached;
    let root = basename(path, ".jsonl");
    try {
      const fd = openSync(path, "r");
      const buf = Buffer.alloc(524288); // 512 KB head — the first uuid'd entry sits well within this
      const n = readSync(fd, buf, 0, buf.length, 0);
      closeSync(fd);
      for (const line of buf.toString("utf8", 0, n).split("\n").slice(0, 24)) {
        if (!line.trim()) continue;
        try { const o = JSON.parse(line); if (typeof o.uuid === "string") { root = o.uuid; break; } } catch { /* partial/oversized line — skip */ }
      }
    } catch { /* unreadable — fall back to the file's own name */ }
    this.rootCache.set(path, root);
    return root;
  }

  async stop(): Promise<void> {
    await this.watcher?.close();
  }

  private async drain(path: string, onFact: (fact: Fact) => void): Promise<void> {
    let size: number;
    try {
      const st = statSync(path);
      // Skip files we've never touched that haven't changed in a while — their
      // sessions are long gone (the colony would prune them anyway). When such a
      // file is appended to (re-activated), its mtime is fresh and we pick it up.
      if (!this.loadAll && !this.offsets.has(path) && Date.now() - st.mtimeMs > RECENT_MS) return; // scoped → load the whole history; global → recent only
      size = st.size;
    } catch {
      return;
    }
    const start = this.offsets.get(path) ?? 0;
    if (size <= start) {
      this.offsets.set(path, size);
      return;
    }

    const fileSessionId = basename(path, ".jsonl");
    const stream = createReadStream(path, { start, end: size - 1, encoding: "utf8" });
    const rl = createInterface({ input: stream, crlfDelay: Infinity });

    for await (const line of rl) {
      if (!line.trim()) continue;
      const fact = parseLine(line, fileSessionId);
      if (fact) onFact(fact);
    }
    this.offsets.set(path, size);
  }
}
