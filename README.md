# 🐜 simantics

**Watch your Claude Code sessions grow into a living ant colony.**

[![npm version](https://img.shields.io/npm/v/simantics.svg)](https://www.npmjs.com/package/simantics)
![license](https://img.shields.io/badge/license-MIT-blue.svg)

A 16-bit cross-section of the soil, in your browser, that digs, forages, and farms in
real time as your agents work. Every session is a colony; every turn carves a new
chamber; the code you ship grows fungus the ants harvest. No combat, no scores — just a
quiet warren you can glance at out of the corner of your eye.

<!-- Add a screenshot or short gif of a live colony here. -->

## Run it

```bash
npx simantics          # watch your ~/.claude sessions — opens the colony in your browser
npx simantics --demo   # a synthetic colony, no real sessions needed
```

Options: `--port <n>` (default 4317) · `--no-open` · `--demo` · `--transcripts <dir>`

By default it watches `~/.claude/projects`. Point `--transcripts <dir>` at another
location to visualize a different Claude CLI's session logs (same transcript format).

It runs a local server on `127.0.0.1`, opens a colony view, and **exits when you close
the tab**. Close it and reopen whenever — it restores the colony and catches up on
whatever happened while it was away, so nothing is lost.

## What maps to what

| Your agent…                | …in the colony                                      |
| -------------------------- | --------------------------------------------------- |
| A Claude Code session      | A colony — a queen and the chambers she digs        |
| A turn (prompt → reply)    | A fresh chamber, carved deeper into the soil        |
| Edit / Write (the diff)    | Fungus gardens bloom — more code, more fungus        |
| Read / Grep / Glob         | Scouts forage for leaves that feed the fungus       |
| WebSearch / WebFetch       | A forager treks up to the surface and back          |
| Tests / lint / recovery    | A soldier is minted and patrols the warren          |
| Subagents (Task)           | Workers spawned into their own chambers             |
| Deletions                  | The chamber blights sickly-olive; ants weed it      |
| A stuck session            | Rain falls, the colony takes cover, soldiers defend |
| Tokens                     | Crumbs hauled underground                           |

The food loop ties it together: foragers bring **leaves**, leaves grow **fungus** in the
chambers where you wrote code, workers **harvest** it and haul it to the queen's pile,
and **repletes** (living larders) store it for lean spells. The HUD's **health** reading
is simply how well-fed the colony is right now.

## How it works

```
~/.claude transcript ─▶ watcher ─▶ parser ─▶ Colony state machine
                                                   │
                                  ColonySnapshot  (what, never where)
                                                   │
                                              WebSocket
                                                   │
                                  2D-canvas colony + HUD  (browser)
```

The server only ever says **what** a session did — tokens, tools, diff counts, spawned
workers — never where anything goes. The client owns all the geometry: where each ant
walks, how the tunnels meander, how deep the strata run.

## Private by design

- **Local only** — the server binds `127.0.0.1`; nothing leaves your machine.
- **Read-only** — it tails your `~/.claude` transcripts and never writes to them.
- **Passive** — it only reflects work you already did. It never prompts, instruments, or
  steers your agents, and adds no tokens of its own.

## Develop it

An npm-workspaces monorepo:

- `packages/shared` — the protocol (what a session is doing; no coordinates)
- `packages/server` — watcher → parser → colony state machine → WebSocket + CLI
- `packages/client` — Vite + a 2D-canvas pixel-art scene

```bash
npm install
npm run demo    # synthetic sessions — iterate on the scene with no real agents
npm run dev     # tail your real ~/.claude transcripts
```

Dev serves the client on `:5179` (Vite) and the server on `:4317`. `npm run build`
bundles the client into the server, and `npm run release` assembles the publishable
package. See [`CONCEPT.md`](./CONCEPT.md) for the full design.

## License

MIT
