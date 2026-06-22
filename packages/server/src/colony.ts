import {
  type BugSnapshot,
  type BugState,
  type Caste,
  type ColonySnapshot,
  type Fact,
  type TaskSnapshot,
} from "@simantics/shared";

const IDLE_MS = 30_000; // no facts for this long → resting
const RETURN_MS = 120_000; // ... this long → heading home
const GONE_MS = 600_000; // ... this long → drop from the colony
const STUCK_MS = 8_000; // a session must stay errored (no recovery) this long to be stuck

interface Task {
  label: string;
  tokens: number;
  actions: number;
  startTs: number;
  endTs: number;
  children: number;
  edited: boolean;
  defended: boolean;
  blocked: boolean;
  done: boolean;
  linesAdded: number;
  linesRemoved: number;
  reads: number;
  committed: boolean;
}

interface ForageRec {
  id: string;
  taskId: string;
  startTs: number;
  doneTs?: number;
}

interface Session {
  id: string;
  caste: Caste;
  parentSessionId?: string;
  parentTaskId?: string;
  state: BugState;
  currentTool?: string;
  tasks: Task[];
  totalTokens: number;
  totalActions: number;
  lastActiveTs: number;
  errored: boolean;
  erroredSince: number;
  label?: string;
  forages: ForageRec[];
  forageSeq: number;
  linesAdded: number;
  linesRemoved: number;
  reads: number;
  commits: number;
}

/**
 * Holds the live colony. Feed it facts; ask it for a snapshot. Each session is a
 * chain of tasks (chambers); subagents record which parent task they forked from.
 */
export class Colony {
  private sessions = new Map<string, Session>();

  /** persistent = a project/dir-scoped colony: keep every session, never auto-prune. */
  constructor(private persistent = false) {}

  /**
   * Dump the FULL internal state (not the rendered snapshot view) so a restart can
   * keep accumulating exactly where it left off. The only non-JSON piece is the
   * sessions Map; its values (Session/Task/ForageRec) are already plain objects.
   */
  serialize(): { sessions: Session[] } {
    return { sessions: [...this.sessions.values()] };
  }

  /**
   * Rehydrate from a serialize() dump. Defensive: anything malformed is skipped so
   * a partially-bad cache degrades gracefully rather than crashing the boot. Rebuilds
   * the sessions Map verbatim — the accumulators (tokens, tasks, forages …) resume.
   */
  restore(data: unknown): void {
    const list = (data as { sessions?: unknown })?.sessions;
    if (!Array.isArray(list)) return;
    for (const raw of list) {
      const s = raw as Session;
      if (s && typeof s.id === "string") this.sessions.set(s.id, s);
    }
  }

  ingest(fact: Fact): void {
    const s = this.session(fact.sessionId, fact.parentSessionId);
    s.lastActiveTs = fact.ts;

    // any new activity means a fetch that was in flight has landed → forager home
    for (const f of s.forages) if (f.doneTs === undefined && fact.ts > f.startTs) f.doneTs = fact.ts;

    if (fact.kind === "error") {
      if (!s.errored) {
        s.errored = true;
        s.erroredSince = fact.ts;
      }
      const open = this.openTask(s);
      if (open) open.defended = true; // a turn that hit an error is defensive work
      return; // keep state; whether it's an alarm is decided at snapshot
    }
    s.errored = false; // any other activity = the session is moving again

    if (fact.kind === "user_prompt") {
      this.startTurn(s, fact);
      return;
    }
    if (fact.kind === "session_end") {
      s.state = "returning";
      this.sealOpen(s, fact.ts);
      return;
    }

    // tool / thinking / tool_result / assistant_text / session_start → accrue work
    const t = this.ensureTask(s, fact.ts);
    if (fact.tokensIn) { s.totalTokens += fact.tokensIn; t.tokens += fact.tokensIn; }
    if (fact.tokensOut) { s.totalTokens += fact.tokensOut; t.tokens += fact.tokensOut; }

    switch (fact.kind) {
      case "tool":
        s.currentTool = fact.tool;
        s.state = "digging";
        s.totalActions += 1;
        t.actions += 1;
        if (isEdit(fact.tool)) t.edited = true;
        if (fact.linesAdded) { t.linesAdded += fact.linesAdded; s.linesAdded += fact.linesAdded; }
        if (fact.linesRemoved) { t.linesRemoved += fact.linesRemoved; s.linesRemoved += fact.linesRemoved; }
        if (fact.scouted) { t.reads += 1; s.reads += 1; }
        if (fact.committed) { t.committed = true; s.commits += 1; }
        if (fact.verify) t.defended = true;
        if (fact.spawnsSubagent) t.children += 1;
        if (isForage(fact.tool)) {
          s.forages.push({ id: `${s.id}#f${s.forageSeq++}`, taskId: `${s.id}#${s.tasks.indexOf(t)}`, startTs: fact.ts });
          if (s.forages.length > 10) s.forages.splice(0, s.forages.length - 10);
        }
        break;
      case "thinking":
        s.state = "thinking";
        s.currentTool = undefined;
        break;
      case "assistant_text":
        s.state = "hauling";
        break;
      case "session_start":
        s.state = "thinking";
        break;
      case "tool_result":
        break;
    }

    // the model finished its response → seal the turn now, so its chamber drops
    // when the work ends (not when the next prompt arrives). A later prompt still
    // seals as a fallback for turns that never emitted an end_turn (e.g. interrupted).
    if (fact.endsTurn) this.sealOpen(s, fact.ts);
  }

  /** mark a session as errored — becomes the rain alarm if it stays stuck */
  markError(sessionId: string, now = Date.now()): void {
    const s = this.sessions.get(sessionId);
    if (s && !s.errored) {
      s.errored = true;
      s.erroredSince = now;
    }
  }

  snapshot(now = Date.now()): ColonySnapshot {
    const bugs: BugSnapshot[] = [];
    let foodStore = 0;
    let harvest = 0;
    let alarm = false;

    for (const s of this.sessions.values()) {
      const age = now - s.lastActiveTs;
      if (!this.persistent && age > GONE_MS) { // scoped colonies persist; the global view prunes idle sessions
        this.sessions.delete(s.id);
        continue;
      }

      let state = s.state;
      if (state !== "returning") {
        if (age > RETURN_MS) state = "returning";
        else if (age > IDLE_MS) state = "resting";
      }

      foodStore += s.totalTokens;
      harvest += Math.max(0, s.linesAdded - s.linesRemoved);
      if (s.errored && now - s.erroredSince >= STUCK_MS && age < RETURN_MS) alarm = true;

      const tasks: TaskSnapshot[] = s.tasks.map((t, i) => ({
        id: `${s.id}#${i}`,
        label: t.label,
        tokens: t.tokens,
        actions: t.actions,
        durationMs: (t.done ? t.endTs : now) - t.startTs,
        startTs: t.startTs,
        children: t.children,
        edited: t.edited,
        defended: t.defended,
        blocked: t.blocked,
        done: t.done,
        linesAdded: t.linesAdded,
        linesRemoved: t.linesRemoved,
        reads: t.reads,
        committed: t.committed,
      }));

      bugs.push({
        id: s.id,
        caste: s.caste,
        state,
        currentTool: s.currentTool,
        parentId: s.parentSessionId,
        parentTaskId: s.parentTaskId,
        tasks,
        tokens: s.totalTokens,
        actions: s.totalActions,
        lastActiveTs: s.lastActiveTs,
        label: s.label,
        forages: s.forages
          .filter((f) => f.doneTs === undefined || now - f.doneTs < 8000)
          .map((f) => ({ id: f.id, taskId: f.taskId, startTs: f.startTs, doneTs: f.doneTs })),
        linesAdded: s.linesAdded,
        linesRemoved: s.linesRemoved,
        reads: s.reads,
        commits: s.commits,
      });
    }

    return { ts: now, bugs, foodStore, alarm, harvest };
  }

  private session(id: string, parentId?: string): Session {
    let s = this.sessions.get(id);
    if (!s) {
      const isFirst = this.sessions.size === 0;
      const parent = parentId ? this.sessions.get(parentId) : undefined;
      const parentTask = parent ? this.openTask(parent) ?? parent.tasks[parent.tasks.length - 1] : undefined;
      const parentTaskId = parent && parentTask ? `${parent.id}#${parent.tasks.indexOf(parentTask)}` : undefined;
      s = {
        id,
        caste: parentId ? "worker" : isFirst ? "queen" : "forager",
        parentSessionId: parentId,
        parentTaskId,
        state: "thinking",
        tasks: [],
        totalTokens: 0,
        totalActions: 0,
        lastActiveTs: Date.now(),
        errored: false,
        erroredSince: 0,
        forages: [],
        forageSeq: 0,
        linesAdded: 0,
        linesRemoved: 0,
        reads: 0,
        commits: 0,
      };
      this.sessions.set(id, s);
    }
    return s;
  }

  private startTurn(s: Session, fact: Fact): void {
    // An interrupt ("[Request interrupted by user]") isn't a new turn — it just ends
    // the current one. Seal it (its chamber drops, tunnel stops extending) and wait
    // for the real next prompt, instead of spinning up a throwaway turn that yanks the dig.
    if (fact.label?.startsWith("[Request interrupted")) {
      const open = this.openTask(s);
      if (open) { open.blocked = true; this.seal(open, fact.ts); } // dig hit a rock → boulder, no room
      return;
    }
    if (!s.label && fact.label) s.label = fact.label;
    const cur = this.openTask(s);
    if (cur && cur.tokens === 0 && cur.actions === 0) {
      // an empty leading task (pre-prompt) — just name it
      if (fact.label) cur.label = fact.label;
      cur.startTs = fact.ts;
    } else {
      if (cur) this.seal(cur, fact.ts);
      s.tasks.push(this.newTask(fact.label ?? "", fact.ts));
    }
    s.state = "thinking";
  }

  private ensureTask(s: Session, ts: number): Task {
    const last = s.tasks[s.tasks.length - 1];
    if (last && !last.done) return last;
    const t = this.newTask("", ts);
    s.tasks.push(t);
    return t;
  }

  private openTask(s: Session): Task | undefined {
    const last = s.tasks[s.tasks.length - 1];
    return last && !last.done ? last : undefined;
  }

  private sealOpen(s: Session, ts: number): void {
    const cur = this.openTask(s);
    if (cur) this.seal(cur, ts);
  }

  private seal(t: Task, ts: number): void {
    t.done = true;
    t.endTs = ts;
  }

  private newTask(label: string, ts: number): Task {
    return { label, tokens: 0, actions: 0, startTs: ts, endTs: ts, children: 0, edited: false, defended: false, blocked: false, done: false, linesAdded: 0, linesRemoved: 0, reads: 0, committed: false };
  }
}

function isEdit(tool: string | undefined): boolean {
  if (!tool) return false;
  const t = tool.toLowerCase();
  return t === "edit" || t === "write" || t === "multiedit" || t === "notebookedit";
}

/** External fetches — the only thing that sends a forager to the surface. */
function isForage(tool: string | undefined): boolean {
  if (!tool) return false;
  const t = tool.toLowerCase();
  return t === "webfetch" || t === "websearch";
}
