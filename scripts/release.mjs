import { build } from "esbuild";
import { cpSync, rmSync, mkdirSync, writeFileSync, readFileSync, copyFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Assemble a clean, self-contained `antics` package for npm into ./release.
// SHIPS ONLY the minified runtime — no source, no design comments, no docs/plans.
// The server is bundled (with @antics/shared inlined) and minified; the npm runtime
// deps (fastify/chokidar/ws) stay external so npx installs them.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REL = join(ROOT, "release");
// single source of truth: bump the root package.json "version" (or `npm version patch
// --no-git-tag-version`), then `npm run release` — the published version follows it.
const VERSION = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;

rmSync(REL, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
mkdirSync(join(REL, "dist"), { recursive: true });

// 1. build shared (types) + client (vite → minified) + server (tsc), copying the
//    client into the server's dist/public along the way (the existing `build` script).
execSync("npm run build", { cwd: ROOT, stdio: "inherit" });

// 2. bundle the compiled server into ONE minified file (strips every comment), with
//    @antics/shared inlined and the real npm deps left external.
await build({
  entryPoints: [join(ROOT, "packages/server/dist/cli.js")],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node18",
  minify: true,
  legalComments: "none",
  external: ["fastify", "chokidar", "ws"],
  outfile: join(REL, "dist/cli.js"),
});

// 3. bring the built client in, and strip the design comments the bundler left in
//    index.html (CSS /* */ + HTML <!-- -->), so nothing internal ships.
cpSync(join(ROOT, "packages/server/dist/public"), join(REL, "dist/public"), { recursive: true });
const idx = join(REL, "dist/public/index.html");
const html = readFileSync(idx, "utf8").replace(/<!--[\s\S]*?-->/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
writeFileSync(idx, html);

// 4. a minimal, user-facing manifest — nothing about how it works or who built it.
const manifest = {
  name: "antics",
  version: VERSION,
  description: "Watch your Claude Code sessions grow into a living ant colony.",
  type: "module",
  bin: { antics: "dist/cli.js" },
  files: ["dist"],
  engines: { node: ">=18" },
  dependencies: { fastify: "^5.1.0", chokidar: "^4.0.1", ws: "^8.18.0" },
  keywords: ["claude-code", "ants", "colony", "terminal", "visualizer"],
  license: "MIT",
};
writeFileSync(join(REL, "package.json"), JSON.stringify(manifest, null, 2) + "\n");

// 5. LICENSE + a short usage-only README.
copyFileSync(join(ROOT, "LICENSE"), join(REL, "LICENSE"));
writeFileSync(
  join(REL, "README.md"),
  `# antics

Watch your Claude Code sessions grow into a living ant colony — a 16-bit cross-section
of the soil that digs, forages, and farms as your agents work.

## Usage

    npx antics          # watch your ~/.claude sessions, then open the printed URL
    npx antics --open   # ...and open the browser for you
    npx antics --demo   # a synthetic colony, no sessions needed

**Options:** \`--port <n>\` (default 4317) · \`--open\` · \`--demo\`

Runs a local server on 127.0.0.1 and serves a colony view in your browser. Read-only —
it only watches transcripts, never writes to them.
`
);

console.log("\n  release/ assembled — run:  cd release && npm publish\n");
