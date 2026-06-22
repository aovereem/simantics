#!/usr/bin/env node
import { serve } from "./server.js";

interface Args {
  port: number;
  demo: boolean;
  noOpen: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { port: 4317, demo: false, noOpen: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--demo") args.demo = true;
    else if (a === "--no-open") args.noOpen = true;
    else if (a === "--open") args.noOpen = false; // opening is the default; accepted for clarity
    else if (a === "--port") args.port = Number(argv[++i]) || args.port;
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
    onIdleExit: () => shutdown(`\n  🐜  the colony's window closed — see you next time.\n`),
  });
  closeServer = close;

  const banner = args.demo ? "demo mode — fake sessions" : "watching ~/.claude transcripts";
  console.log(`\n  🐜  antics — a backyard colony of your agents`);
  console.log(`      ${banner}`);
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
