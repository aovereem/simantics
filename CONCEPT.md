# Antics — concept

> The name carries two readings that stack rather than compete. The front door is
> a tiny bug colony sim — warm, playful, instantly gets the concept. Underneath is
> the wink: agents → ants (the same root Anthropic plays on). A name that works
> whether or not you catch the joke. npm package `antics` is available.

**A living backyard colony that grows while your agents work.** Every Claude Code
session becomes an ant in the grass. The tool it runs decides what the ant does;
subagents become workers streaming out of the nest; tokens become crumbs hauled
underground. A calm, glanceable strip docked to the bottom of your screen that
breathes in real time as you code. No combat, no scores — just a quiet colony
you can watch out of the corner of your eye.

The architecture is a clean split — a theme-agnostic data layer feeding a themed
render layer — and the world, the metaphor, the protocol, and the art are all ours.

---

## The world

A top-down patch of backyard. Tufted, semi-transparent grass over dark soil.
Found objects sit in the grass — a bottle cap, a fallen leaf, a sunflower seed, a
dewdrop. Beneath the surface, tunnels spread as the colony does more work, drawn as
trails that darken with depth. One camera, top-down, depth faked with shading. No
second projection.

Docked as a **horizontal strip along the bottom of the screen.** Wide and short,
which is exactly a lawn cross-strip: grass band on top, a shallow soil band beneath
showing tunnels through the bare patches. Trails run left-to-right. Foragers leave
the dark nest, cross the grass to an object, and haul a crumb home.

## The colony (mapping)

The backbone is a real eusocial colony — that's what made insects the right call.
A session spawning subagents *is* a queen spawning workers, not a metaphor for it.

| Concept              | In the backyard                                              |
| -------------------- | ----------------------------------------------------------- |
| Session              | An ant                                                      |
| Main / orchestrator  | The **queen** — stays in the nest underground               |
| Subagents (Task)     | **Workers** spawned from the queen, streaming up to the grass |
| File edits (Edit/Write) | **Building** — extending a tunnel, hauling material      |
| File reads (Read/Grep/Glob) | **Foraging** — crossing the grass, gathering crumbs  |
| Web search / fetch   | **Forager** heading to a glowing object (a dewdrop catching light) and back |
| Bash / terminal      | **Digging** underground                                     |
| Tests / lint         | **Soldiers** patrolling the perimeter (warriors, kept peaceful — guarding, not fighting) |
| Thinking             | Ant pauses, antennae twitch                                 |
| Tokens               | **Crumbs** hauled to the food store; the store grows with throughput |
| A project / repo     | A colony (multiple repos → multiple mounds, later)          |

## Behaviors (the state machine, kept from the original's vocabulary)

`thinking` · `foraging` · `digging` · `building` · `patrolling` · `hauling` ·
`resting` · `idle` · `returning`

Surface is where discovery happens (foraging, returning with crumbs). Underground
is where the colony *is* (queen, nest, stored food, spawned workers). Out-and-working
plays on top; nest / rest / idle / home plays below.

## The "uh oh" beat

The original uses a bird's shadow. In a backyard the native version is a **passing
shadow** — a cloud, a hand, a watering can. On an error or a stuck session, the
shadow crosses, the colony freezes and scatters, then resumes once it lifts. Same
beat, no combat, belongs to the world.

## What's genuinely new vs. the original

Most of this is a reskin of a proven idea, and that's fine. The one real *system*
we're adding is the **two-layer world**: a translucent grass surface over a soil
band with tunnels that accumulate as the session does work. The tunnel network is
our version of the original's filling storehouse — a visible record of activity
over the session. Build that deliberately; everything else is art on top of a
borrowed shape.

## Decisions locked

- Insect colony in a backyard, **not** indoor junk and **not** the *A Bug's Life*
  circus. Inspired by the film's mixed-bug, peaceful, found-object spirit; copying
  none of its designs.
- **Top-down** single camera. Tunnels = darkening trails under translucent grass.
  (Closest to the original, cheapest to build, no projection conflict.)
- **Horizontal bottom dock.** Agrees with the projection — wide lawn, left-to-right trails.
- Reuse the original's **data-layer architecture** (watcher → fact → per-session
  state machine → snapshot → WebSocket → render). Rebuild it as ours.
- Runs **locally** — it reads your `~/.claude` transcripts off disk. Not hosted.

## Decisions still open

- **Grass-to-soil ratio** in the strip — half/half, or surface-heavy with a shallow
  tunnel band? Depends on whether the underground is the star or just texture.
- **Always-on-top dock**: a desktop wrapper (Tauri preferred, Electron fallback) vs.
  a manually-placed browser window for now. The scaffold runs in a browser; the
  wrapper is a later layer that points at the same local server.
- Art source: procedural placeholders ship today; real sprites (hand-drawn, CC0
  pack, or generated) come later. Constraint: grass must be patchy/translucent or
  the tunnels never show.

## Stack

A small npm-workspaces monorepo. Borrowed shape, our code.

| Package           | Stack                          | Job                                                     |
| ----------------- | ------------------------------ | ------------------------------------------------------- |
| `packages/shared` | TypeScript                     | Protocol types — `Fact`, `BugSnapshot`, `ColonySnapshot` |
| `packages/server` | Node + Fastify + `ws` + chokidar | Tail transcripts, parse facts, run the state machine, broadcast snapshots, demo mode, CLI |
| `packages/client` | Vite + PixiJS v8               | The backyard scene, the strip, the HUD                  |

Privacy carries over from the original by design: server binds `127.0.0.1` only,
transcripts are read locally and read-only, nothing is written back or sent anywhere.
