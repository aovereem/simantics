import Fastify from "fastify";
import { WebSocketServer, type WebSocket } from "ws";
import { readFileSync, existsSync } from "node:fs";
import { join, extname, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { type ServerMessage, WS_PATH } from "@simantics/shared";
import { Colony } from "./colony.js";
import { TranscriptWatcher } from "./watcher.js";
import { startDemo } from "./demo.js";
import { loadCache, saveCache } from "./cache.js";

const VERSION = "0.0.1";
const HOST = "127.0.0.1";
const SNAPSHOT_MS = 250; // ~4 fps of state; the client interpolates motion
const PERSIST_MS = 5_000; // flush the colony to disk this often (only when dirty)
const IDLE_EXIT_MS = 4_000; // when the browser closes (and doesn't reconnect), exit after this grace — long enough to survive a reload

// The built client is copied next to the compiled server (dist/public) at build time.
// In dev there's no such dir (Vite serves the client + proxies the WS), so we skip this
// and only serve static when packaged — which is what makes `npx simantics` self-contained.
const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), "public");
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css",
  ".svg": "image/svg+xml", ".ico": "image/x-icon", ".png": "image/png", ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2", ".woff": "font/woff", ".json": "application/json", ".map": "application/json",
};

export interface ServeOptions {
  port: number;
  demo: boolean;
  /** Called once the last browser disconnects and doesn't return — used to exit when
   *  the window closes. Only ever fires when we're serving the client (packaged). */
  onIdleExit?: () => void;
}

export async function serve(opts: ServeOptions): Promise<{ url: string; close: () => Promise<void>; servesClient: boolean }> {
  const colony = new Colony();
  const app = Fastify({ logger: false });
  const clients = new Set<WebSocket>();

  app.get("/health", async () => ({ ok: true, version: VERSION, demo: opts.demo }));

  // Serve the bundled client when packaged (dist/public present). Any non-asset path
  // falls back to index.html. Skipped entirely in dev, where Vite owns the client.
  const servesClient = existsSync(PUBLIC_DIR);
  if (servesClient) {
    app.get("/*", async (req, reply) => {
      const rel = normalize(decodeURIComponent(req.url.split("?")[0])).replace(/^(\.\.[/\\])+/, "");
      const ext = extname(rel);
      const file = ext ? join(PUBLIC_DIR, rel) : join(PUBLIC_DIR, "index.html"); // SPA fallback
      if (!file.startsWith(PUBLIC_DIR) || !existsSync(file)) { reply.code(404).type("text/plain"); return "not found"; }
      reply.type(MIME[extname(file)] ?? "application/octet-stream");
      return readFileSync(file);
    });
  }

  const address = await app.listen({ host: HOST, port: opts.port });

  const wss = new WebSocketServer({ server: app.server, path: WS_PATH });
  let armed = false;                          // a browser has connected at least once
  let idleTimer: NodeJS.Timeout | undefined;  // grace period after the last one leaves
  wss.on("connection", (ws) => {
    clients.add(ws);
    armed = true;
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = undefined; } // a reconnect cancels a pending exit
    send(ws, { type: "hello", data: { version: VERSION, demo: opts.demo } });
    ws.on("close", () => {
      clients.delete(ws);
      // the browser closed → exit if it doesn't come back (a reload reconnects within the grace)
      if (servesClient && armed && clients.size === 0 && opts.onIdleExit) {
        idleTimer = setTimeout(opts.onIdleExit, IDLE_EXIT_MS);
      }
    });
  });

  // feed the colony
  let stopFeed: () => void = () => {};
  let persist: () => void = () => {}; // flush the colony cache (no-op in demo mode)
  let persistTimer: NodeJS.Timeout | undefined;
  if (opts.demo) {
    // Demo state is synthetic and ephemeral — never persisted.
    stopFeed = startDemo((fact) => colony.ingest(fact));
  } else {
    const watcher = new TranscriptWatcher();
    const root = watcher.watchRoot;

    // Restore from the disk cache if it's present + valid: hydrate the colony and
    // seed the watcher's read offsets BEFORE start(), so it resumes tailing from
    // where it left off instead of cold-draining the whole transcript tree.
    const cached = loadCache(root);
    if (cached) {
      colony.restore(cached.colony);
      watcher.seedOffsets(cached.offsets);
    }

    let dirty = false;
    watcher.start((fact) => {
      colony.ingest(fact);
      dirty = true;
    });

    persist = () => {
      if (!dirty) return;
      saveCache(root, watcher.getOffsets(), colony.serialize());
      dirty = false;
    };
    persistTimer = setInterval(persist, PERSIST_MS);
    stopFeed = () => void watcher.stop();
  }

  // broadcast snapshots
  const broadcast = setInterval(() => {
    const snapshot = colony.snapshot();
    const msg: ServerMessage = { type: "snapshot", data: snapshot };
    for (const ws of clients) send(ws, msg);
  }, SNAPSHOT_MS);

  // Last-chance flush if the loop drains without an explicit shutdown (e.g. the
  // process is about to exit normally). close() removes this so we don't double-fire.
  const flushOnExit = () => persist();
  process.on("beforeExit", flushOnExit);

  const close = async () => {
    process.off("beforeExit", flushOnExit);
    if (persistTimer) clearInterval(persistTimer);
    persist(); // final flush so a restart resumes from the latest offsets
    clearInterval(broadcast);
    stopFeed();
    wss.close();
    await app.close();
  };

  return { url: address.replace(HOST, "localhost"), close, servesClient };
}

function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}
