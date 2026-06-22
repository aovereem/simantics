#!/usr/bin/env node
import { serve } from "./server.js";
import { homedir } from "node:os";
import { join, resolve, basename } from "node:path";

interface Args {
  port: number;
  demo: boolean;
  noOpen: boolean;
  all: boolean; // watch ALL projects (the global backyard) instead of just this one
  project?: string; // a repo path → watch just that project
  transcripts?: string; // a raw transcript dir to watch
}

function expand(p: string): string {
  return resolve(p.startsWith("~") ? p.replace(/^~/, homedir()) : p);
}

// Claude Code keeps a project's transcripts under ~/.claude/projects/<mangled-abs-path>,
// where the path separators (and the drive colon / dots) become dashes —
// e.g. E:\dev\antics → E--dev-antics.
function projectDir(repoPath: string): string {
  return join(homedir(), ".claude", "projects", expand(repoPath).replace(/[:\\/.]/g, "-"));
}

function parseArgs(argv: string[]): Args {
  const args: Args = { port: 4317, demo: false, noOpen: false, all: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--demo") args.demo = true;
    else if (a === "--no-open") args.noOpen = true;
    else if (a === "--open") args.noOpen = false; // opening is the default; accepted for clarity
    else if (a === "--all") args.all = true;
    else if (a === "--port") args.port = Number(argv[++i]) || args.port;
    else if (a === "--project") { const p = argv[++i]; if (p) args.project = p; }
    else if (a === "--transcripts" || a === "--dir") { const d = argv[++i]; if (d) args.transcripts = expand(d); }
  }
  return args;
}

function openBrowser(url: string): void {
  import("node:child_process").then(({ spawn }) => {
    const [cmd, cmdArgs] = process.platform === "win32"
      ? ["cmd", ["/c", "start", "", url]]
      : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
    try { spawn(cmd, cmdArgs as string[], { stdio: "ignore", detached: true }).unref(); } catch { /* no browser → just print the url */ }
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // What to watch + whether to persist. DEFAULT: just THIS project (the cwd), keeping all
  // of its work forever. `--all` is the opt-in global backyard (every project, recent +
  // auto-pruned). `--project <path>` / `--transcripts <dir>` aim it elsewhere.
  let watchDir: string | undefined; // undefined → the default ~/.claude/projects (all)
  let persistent = false;
  let label: string;  // the long terminal banner line
  let scope: string;  // the short HUD tag — which colony you're looking at
  if (args.demo) { label = "demo mode — fake sessions"; scope = "demo"; }
  else if (args.all) { watchDir = undefined; label = "watching all projects"; scope = "all projects"; }
  else if (args.transcripts) { watchDir = args.transcripts; persistent = true; label = `watching ${args.transcripts}`; scope = basename(args.transcripts); }
  else { const repo = resolve(args.project ?? process.cwd()); watchDir = projectDir(repo); persistent = true; label = `watching this project · ${repo}`; scope = basename(repo); }

  let closeServer: () => Promise<void> = async () => {};
  let closing = false;
  const shutdown = async (msg?: string) => {
    if (closing) return;
    closing = true;
    if (msg) console.log(msg);
    await closeServer();
    process.exit(0);
  };

  const { url, close, servesClient } = await serve({
    port: args.port,
    demo: args.demo,
    transcriptsDir: watchDir,
    persistent,
    scope,
    onIdleExit: () => shutdown(`\n  🐜  the colony's window closed — see you next time.\n`),
  });
  closeServer = close;

  console.log(`\n  🐜  simantics — a backyard colony of your agents`);
  console.log(`      ${label}`);
  console.log(`      ${url}\n`);

  // Packaged runs open the browser themselves; closing that window then exits the server.
  if (servesClient && !args.noOpen) openBrowser(url);

  process.on("SIGINT", () => shutdown());
  process.on("SIGTERM", () => shutdown());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
