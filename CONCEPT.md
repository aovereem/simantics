# simantics — concept

> The name stacks three readings: **SimAnt** (it's an ant-colony sim), **semantics**
> (it watches the meaning of your code as it changes), and **antics** (agents → ants —
> the root Anthropic plays on). Works whether or not you catch all three.

**Watch your Claude Code sessions grow into a living ant colony.** A 16-bit cross-section
of the soil, in your browser, that digs, forages, and farms in real time as your agents
work. Every session is a colony; every turn carves a chamber; the code you ship grows the
fungus the ants harvest. No combat, no scores — just a quiet warren you can glance at out
of the corner of your eye.

The architecture is a clean split — a theme-agnostic data layer feeding a themed render
layer — and the world, the metaphor, the protocol, and the art are all ours.

---

## The world

An **underground cross-section** — a side view cut into the earth. A thin band of grass
and found foliage on top; beneath it, distinct soil horizons (topsoil, clay, grit,
bedrock) that scroll as the colony grows. The colony is dug into the soil: the queen's
chamber near the surface, tunnels meandering down and out, fresh chambers carved deeper
as the session does more work. One camera; the depth is real, not faked.

It runs as a browser view you keep in the corner of your screen — it breathes as you
code, then idles quietly when you stop.

## The colony (mapping)

A session spawning subagents *is* a queen spawning workers — eusociality is the backbone,
not a metaphor laid over it.

| Your agent…                | …in the colony                                          |
| -------------------------- | ------------------------------------------------------- |
| A Claude Code session      | A **colony** — a queen and the chambers she digs        |
| A turn (prompt → reply)    | A fresh **chamber**, carved deeper into the soil        |
| Subagents (Task)           | **Workers** spawned into their own chambers             |
| Edit / Write (the diff)    | **Fungus** blooms in that chamber — more code, more fungus |
| Read / Grep / Glob         | **Scouts** forage for leaves that feed the fungus       |
| WebSearch / WebFetch       | A **forager** treks up to the surface and back          |
| Tests / lint / recovery    | A **soldier** is minted and patrols the warren          |
| Deletions                  | The chamber **blights** sickly-olive; ants weed it      |
| A stuck session / error    | **Rain** — the colony takes cover, soldiers defend the frontier |
| Tokens                     | **Crumbs** hauled underground                           |

## The food economy

The heart of it is the real leafcutter cycle, driven entirely by what your agents do:

1. **Forage** — reading code (Read/Grep/Glob) and web fetches send foragers up for **leaves**.
2. **Farm** — leaves grow **fungus** in the chambers where you wrote code (sized to the diff).
3. **Harvest** — workers gather ripe fungus and haul it to the queen's **pile**.
4. **Store** — **repletes** (living-larder ants) swell with the surplus for lean spells.
5. **Eat** — the colony grazes the gardens; the HUD's **health** reading is how well-fed it is.

A busy session is a thriving farm; a quiet one lives off its stores; a planning-heavy
session is all foragers and full larders. Every quantity traces to a real signal in the
transcript — nothing is invented.

## Scope & lifecycle

Run it **inside a repo** and the colony is *that project's*, keeping **all of its work** —
every session you've run there, each as its own nest, persisting (it doesn't fade). `--all`
opts into the global backyard: every project at once, recent activity, idle nests pruned.

## Invariants

- **Passive.** It only reads and aggregates transcripts that already exist, and draws them.
  It never summarizes, calls a model, instruments the agent, or invents work.
- **What, never where.** The server reports *what* a session did (tokens, tools, diff
  counts, spawned workers); the client owns *all* the geometry — every ant, tunnel, stratum.
- **Local & read-only.** Binds `127.0.0.1`, tails `~/.claude` transcripts off disk, writes
  nothing back, sends nothing anywhere.
- **Lightweight.** A tiny dependency footprint; a single self-contained `npx` command.

## Stack

A small npm-workspaces monorepo:

| Package           | Stack                            | Job                                                    |
| ----------------- | -------------------------------- | ------------------------------------------------------ |
| `packages/shared` | TypeScript                       | The protocol — `Fact`, `BugSnapshot`, `ColonySnapshot`  |
| `packages/server` | Node + Fastify + `ws` + chokidar | Tail transcripts → parse → colony state machine → snapshots, demo, CLI |
| `packages/client` | Vite + 2D canvas                 | The pixel-art colony cross-section + HUD               |
