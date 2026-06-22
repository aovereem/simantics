import { watch, type FSWatcher } from "chokidar";
import { createReadStream, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { basename } from "node:path";
import type { Fact } from "@antics/shared";
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

  constructor(private root: string = DEFAULT_TRANSCRIPT_GLOB) {}

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

  start(onFact: (fact: Fact) => void): void {
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
    const pending: Promise<void>[] = [];
    let ready = false;
    const emit = (fact: Fact) => { if (ready) onFact(fact); else buffer.push(fact); };

    const handle = (path: string) => {
      if (!path.endsWith(".jsonl")) return;
      const p = this.drain(path, emit);
      if (!ready) pending.push(p);
    };
    this.watcher.on("add", handle).on("change", handle);
    this.watcher.on("ready", async () => {
      await Promise.allSettled(pending);
      buffer.sort((a, b) => a.ts - b.ts);
      for (const fact of buffer) onFact(fact);
      buffer.length = 0;
      ready = true;
    });
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
      if (!this.offsets.has(path) && Date.now() - st.mtimeMs > RECENT_MS) return;
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
