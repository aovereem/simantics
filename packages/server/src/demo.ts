import type { Fact } from "@simantics/shared";

const PROMPTS = [
  "refactor the auth flow",
  "fix the failing watcher test",
  "add the backyard scene",
  "wire up the websocket",
  "investigate the memory leak",
  "rename the protocol types",
  "add pan and zoom to the client",
  "split the colony module",
];
const TASKDESCS = [
  "search the codebase for usages",
  "run the test suite",
  "audit the parser",
  "find all call sites",
  "check the build output",
];
const DIG = ["Edit", "Write", "Bash", "Edit", "Bash"];
const READ = ["Read", "Grep", "Glob"];

/**
 * Emits a believable transcript-shaped stream that exercises the task model: a
 * queen working through turns (some big, some trivial), spawning the odd subagent,
 * occasionally reaching the web, and now and then getting stuck (→ rain). No real
 * transcripts touched. Returns a stop function.
 */
export function startDemo(onFact: (fact: Fact) => void): () => void {
  const queen = "demo-queen";
  let booted = false;
  let stuckUntil = 0;
  let nWorkers = 0;

  type Step = () => void;
  interface Actor { id: string; queue: Step[]; }
  const actors: Actor[] = [];

  const T = () => Date.now();
  const tok = (big = false) => ({
    tokensIn: big ? rnd(9000, 18000) : rnd(300, 2600),
    tokensOut: big ? rnd(1500, 4000) : rnd(60, 600),
  });

  // Plan one turn for a session as a queue of steps the ticker plays out.
  function planTurn(id: string, parent?: string): Step[] {
    const steps: Step[] = [];
    const label = parent ? pick(TASKDESCS) : pick(PROMPTS);
    steps.push(() => onFact({ sessionId: id, ts: T(), kind: "user_prompt", label, parentSessionId: parent }));

    // a quarter of the queen's turns are trivial — one quick read, no edits
    if (!parent && Math.random() < 0.25) {
      steps.push(() => onFact({ sessionId: id, ts: T(), kind: "tool", tool: pick(READ), scouted: true, ...tok() }));
      return steps;
    }

    const n = rnd(3, 9);
    for (let i = 0; i < n; i++) {
      const big = Math.random() < 0.18;
      const tool = pick(DIG);
      const edit = tool === "Edit" || tool === "Write";
      steps.push(() => onFact({
        sessionId: id, ts: T(), kind: "tool", tool, parentSessionId: parent,
        linesAdded: edit ? rnd(3, big ? 80 : 30) : undefined,            // diff grows the fungus crop
        linesRemoved: edit && Math.random() < 0.4 ? rnd(0, 18) : undefined,
        ...tok(big),
      }));
      if (Math.random() < 0.2) {
        steps.push(() => onFact({ sessionId: id, ts: T(), kind: "tool", tool: pick(READ), scouted: true, parentSessionId: parent, ...tok() })); // scouting
      }
      if (Math.random() < 0.14) {
        steps.push(() => onFact({ sessionId: id, ts: T(), kind: "tool", tool: "WebFetch", parentSessionId: parent, ...tok() })); // reaches the web → a forager
      }
    }
    // the queen now and then commits — a granary beat
    if (!parent && Math.random() < 0.3) {
      steps.push(() => onFact({ sessionId: id, ts: T(), kind: "tool", tool: "Bash", committed: true, ...tok() }));
    }
    // the queen sometimes dispatches a subagent mid-turn
    if (!parent && nWorkers < 5 && Math.random() < 0.5) {
      const wid = `demo-worker-${++nWorkers}`;
      steps.push(() => {
        onFact({ sessionId: id, ts: T(), kind: "tool", tool: "Task", spawnsSubagent: true, label: pick(TASKDESCS) });
        enqueue(wid, queen);
      });
    }
    steps.push(() => onFact({ sessionId: id, ts: T(), kind: "assistant_text", ...tok() }));
    return steps;
  }

  function enqueue(id: string, parent?: string): void {
    actors.push({ id, queue: planTurn(id, parent) });
  }

  const tick = () => {
    const now = T();
    if (!booted) {
      booted = true;
      onFact({ sessionId: queen, ts: now, kind: "session_start" });
      enqueue(queen);
    }

    // a stuck spell: the queen hangs, the colony takes cover (rain)
    if (stuckUntil) {
      if (now >= stuckUntil) {
        stuckUntil = 0;
        onFact({ sessionId: queen, ts: now, kind: "thinking", tokensOut: rnd(200, 500) });
      }
      return;
    }
    if (Math.random() < 0.015) {
      onFact({ sessionId: queen, ts: now, kind: "error" });
      stuckUntil = now + 12_000; // outlasts the server's STUCK_MS so rain shows
      return;
    }

    for (const a of actors) {
      const step = a.queue.shift();
      if (step) step();
    }
    // drop finished workers; keep the queen working with fresh turns
    for (let i = actors.length - 1; i >= 0; i--) {
      if (actors[i].queue.length === 0 && actors[i].id !== queen) actors.splice(i, 1);
    }
    const q = actors.find((a) => a.id === queen);
    if (q && q.queue.length === 0) q.queue = planTurn(queen);
  };

  const interval = setInterval(tick, 700);
  tick();
  return () => clearInterval(interval);
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
function rnd(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min));
}
