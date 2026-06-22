/**
 * Loam protocol — the contract between the server (what's happening) and the
 * client (where things go and how the colony looks). The server only ever says
 * WHAT a session is doing; the client decides WHERE. Keep coordinates out of here.
 *
 * Simantics is a passive effort-visualizer: everything below is read/aggregated from
 * the transcript that already exists. Nothing here implies extra work, generation,
 * or instrumentation of the agent.
 */

/** A single parsed line from an agent transcript, normalized. */
export interface Fact {
  sessionId: string;
  /** epoch ms */
  ts: number;
  kind: FactKind;
  /** the tool name when kind === "tool", e.g. "Edit", "Bash", "WebFetch" */
  tool?: string;
  /** present on Task tool use — this session is spawning a subagent */
  spawnsSubagent?: boolean;
  tokensIn?: number;
  tokensOut?: number;
  /** the parent session id, if this fact belongs to a spawned subagent */
  parentSessionId?: string;
  /** raw text, no generation: a prompt's first line (user_prompt) or a Task
   *  description (Task tool). Used verbatim (truncated) to label a chamber. */
  label?: string;
  /** this tool call is defensive/verification work — running tests, lint, or a
   *  typecheck (read from the Bash command, not inferred). Mints a soldier. */
  verify?: boolean;
  /** the assistant ended its turn here (stop_reason "end_turn") — the response is
   *  done, so the turn's chamber can be sealed/dropped without waiting for the next
   *  prompt. */
  endsTurn?: boolean;
  /** lines added / removed by an Edit/Write/MultiEdit call, counted from the tool's
   *  own old_string/new_string/content — never read off disk. A turn's NET diff is
   *  its "vitality"; it grows the chamber's fungus crop (the colony's food). */
  linesAdded?: number;
  linesRemoved?: number;
  /** a knowledge-gathering call (Read/Grep/Glob) — the colony scouting. */
  scouted?: boolean;
  /** this Bash command ran a `git commit` — a "granary" beat. */
  committed?: boolean;
}

export type FactKind =
  | "session_start"
  | "user_prompt" // a genuine new prompt → a new turn → a new task/chamber
  | "thinking"
  | "tool"
  | "tool_result" // tool output coming back — NOT a new turn
  | "assistant_text"
  | "error" // a failed tool / API error — feeds the stuck → rain alarm
  | "session_end";

/** What an ant is doing right now (drives motion + the hover readout). */
export type BugState =
  | "thinking"
  | "digging" // actively working at the tunnel frontier
  | "hauling"
  | "resting"
  | "idle"
  | "returning";

/** The role an ant plays in the colony. */
export type Caste = "queen" | "worker" | "soldier" | "forager";

/** One completed (or in-progress) task = one chamber. All fields read from the
 *  transcript; nothing summarized. */
export interface TaskSnapshot {
  /** stable id, `${sessionId}#${index}` */
  id: string;
  /** raw prompt line / Task description, truncated — never generated */
  label: string;
  /** tokens this task cost (drives tunnel length to it + chamber size) */
  tokens: number;
  /** tool calls in this task */
  actions: number;
  /** wall-clock the task has taken so far (ms) */
  durationMs: number;
  /** epoch ms the task began — i.e. when its founding ant spawned (→ ant age) */
  startTs: number;
  /** subagents spawned during this task */
  children: number;
  /** did it edit/write a file (→ earns its own chamber vs. fattening) */
  edited: boolean;
  /** defensive turn: ran tests/lint/typecheck, or hit and recovered from an
   *  error (→ its digger patrols the colony as a soldier) */
  defended: boolean;
  /** the turn was cut short by an interrupt — the dig hit a rock and stopped here
   *  (rendered as a boulder, no room/egg). */
  blocked: boolean;
  /** false = the in-progress frontier task */
  done: boolean;
  /** the turn never sealed on its own — the session went idle mid-turn (killed/crashed,
   *  no end_turn) and we closed it out. Rendered as a trailing tunnel, no chamber. */
  hung: boolean;
  /** lines added / removed by edits in this turn — net diff = the chamber's
   *  vitality (lush fungus when positive, blighted/weeded when negative). */
  linesAdded: number;
  linesRemoved: number;
  /** Read/Grep/Glob calls in this turn — scouting. */
  reads: number;
  /** the turn ran a `git commit`. */
  committed: boolean;
}

/** A forager's round-trip: an external fetch's lifecycle. The ant leaves a
 *  chamber when the fetch fires and returns when it lands. */
export interface ForageSnapshot {
  id: string;
  /** the chamber (task) the forager set out from */
  taskId: string;
  /** epoch ms the fetch fired */
  startTs: number;
  /** epoch ms the result landed — undefined while still out foraging */
  doneTs?: number;
}

/** One ant = one session (or subagent). Its tasks are its chain of chambers. */
export interface BugSnapshot {
  id: string;
  caste: Caste;
  state: BugState;
  /** the tool driving the current state, for the hover readout */
  currentTool?: string;
  /** the session that spawned this one, if any */
  parentId?: string;
  /** the parent's task/chamber this ant forked from */
  parentTaskId?: string;
  /** the chain of chambers — sealed tasks plus the in-progress one at the end */
  tasks: TaskSnapshot[];
  /** totals, for the HUD */
  tokens: number;
  actions: number;
  /** epoch ms of the last fact seen for this session */
  lastActiveTs: number;
  /** short human label, e.g. the first prompt */
  label?: string;
  /** recent forager round-trips (external fetches) — in-flight + just-returned */
  forages: ForageSnapshot[];
  /** session totals (for the HUD / collective mood) */
  linesAdded: number;
  linesRemoved: number;
  reads: number;
  commits: number;
}

/** The whole colony at one instant. */
export interface ColonySnapshot {
  ts: number;
  bugs: BugSnapshot[];
  /** total tokens across the colony — the HUD's crumb count */
  foodStore: number;
  /** the rain beat: true while a session is stuck */
  alarm: boolean;
  /** total net diff across the colony (Σ max(0, added−removed)) — the standing
   *  crop available to harvest into the larder. */
  harvest: number;
}

/** Messages the server pushes over the WebSocket. */
export type ServerMessage =
  | { type: "snapshot"; data: ColonySnapshot }
  | { type: "hello"; data: { version: string; demo: boolean; scope: string } };

export const WS_PATH = "/colony";

/** Map a tool name to the behavior it implies — used only for the hover flavor. */
export function toolToState(tool: string | undefined): BugState {
  if (!tool) return "thinking";
  return "digging";
}
