import type { Fact, FactKind } from "@antics/shared";

/**
 * Claude Code writes JSONL transcripts under ~/.claude/projects/<slug>/<uuid>.jsonl.
 * Each line is an entry; shapes vary across versions, so parse defensively and
 * extract only what we need. Returns null for lines we can't or shouldn't map.
 *
 * This is the one place that knows the transcript format. It only reads what's
 * there — labels are raw substrings, never summarized.
 */
export function parseLine(raw: string, fileSessionId: string): Fact | null {
  let entry: any;
  try {
    entry = JSON.parse(raw);
  } catch {
    return null;
  }

  // Subagents live in <parent>/subagents/agent-<id>.jsonl and — confusingly —
  // tag their lines with the PARENT's sessionId. So a sidechain line is its own
  // ant (keyed by the file's agent id), forked from the parent session.
  const isSidechain = entry.isSidechain === true;
  const sessionId: string = isSidechain ? fileSessionId : (entry.sessionId ?? fileSessionId);
  const parentSessionId: string | undefined = isSidechain ? entry.sessionId : undefined;
  const ts = toEpoch(entry.timestamp) ?? Date.now();

  // Bookkeeping lines carry no colony activity — skip before they become noise.
  if (
    entry.type === "summary" ||
    entry.type === "queue-operation" ||
    entry.type === "attachment" ||
    entry.type === "file-history-snapshot"
  ) {
    return null;
  }

  const message = entry.message ?? {};
  const content = message.content;

  // "Crumbs" = real work hauled, NOT re-reads. Each turn re-sends the whole
  // cached context (100k–1M tokens) — summing cache_read across a session balloons
  // to hundreds of millions of phantom crumbs. Count only newly generated output
  // and genuinely new (uncached) input.
  const usage = message.usage ?? {};
  const tokensIn: number | undefined = (usage.input_tokens ?? 0) || undefined;
  const tokensOut: number | undefined = (usage.output_tokens ?? 0) || undefined;
  // "end_turn" = the model finished its response (vs "tool_use" = still working).
  // Lets the colony seal the turn's chamber when the response ends, not at next prompt.
  // Only the final text entry carries it (a turn's last message is split into a
  // thinking entry + a text entry, both stamped end_turn — flag just the text one,
  // else the turn seals twice and a spurious empty chamber appears).
  const endsTurn: true | undefined = message.stop_reason === "end_turn" || undefined;
  const base = { sessionId, ts, tokensIn, tokensOut, parentSessionId };

  // Errors take precedence: a flagged API error or an error-level system line
  // becomes an error fact (a stuck session then drives the rain alarm).
  if (entry.isApiErrorMessage === true) return { ...base, kind: "error" };
  if (entry.type === "system") {
    const level = String(entry.level ?? entry.subtype ?? "").toLowerCase();
    return level.includes("error") ? { ...base, kind: "error" } : null;
  }

  // A "user" line is either a genuine prompt (new turn) or tool output coming
  // back. Tool output carries tool_result blocks; a real prompt does not.
  if (entry.type === "user") {
    const blocks = Array.isArray(content) ? content : null;
    const toolResult = blocks?.find((b) => b?.type === "tool_result");
    if (toolResult) {
      if (toolResult.is_error === true) return { ...base, kind: "error" };
      return { ...base, kind: "tool_result" };
    }
    return { ...base, kind: "user_prompt", label: clip(extractText(content)) };
  }

  // Assistant lines: tool calls and thinking are the richest signal.
  if (Array.isArray(content)) {
    for (const block of content) {
      if (block?.type === "tool_use") {
        const name = String(block.name ?? "unknown");
        const isTask = name.toLowerCase() === "task";
        const diff = diffLines(name, block.input);
        return {
          ...base,
          kind: "tool",
          tool: name,
          spawnsSubagent: isTask,
          verify: isVerify(name, block.input) || undefined,
          linesAdded: diff.added || undefined,
          linesRemoved: diff.removed || undefined,
          scouted: isScout(name) || undefined,
          committed: isCommit(name, block.input) || undefined,
          label: isTask ? clip(String(block.input?.description ?? block.input?.prompt ?? "")) : undefined,
        };
      }
      if (block?.type === "thinking") return { ...base, kind: "thinking" };
    }
  }

  if (entry.type === "assistant") return { ...base, kind: "assistant_text", endsTurn };
  return null;
}

// Defensive/verification work: known test+lint+typecheck runners, or a package
// script named test/lint/typecheck/check/ci. Read straight from the Bash command
// — never inferred. Word-boundary anchored so shell `test`/`[` don't false-match.
const VERIFY_BIN = /\b(vitest|jest|pytest|mocha|rspec|phpunit|eslint|tsc|pyright|mypy|ruff|flake8|stylelint|karma|playwright|cypress)\b|\b(cargo|go|dotnet|gradle|mvn)\s+test\b/i;
const VERIFY_SCRIPT = /\b(npm|pnpm|yarn|bun|npx|pnpx)\s+(run\s+)?(test|tests|lint|typecheck|type-check|check|ci)\b/i;
function isVerify(name: string, input: unknown): boolean {
  if (name.toLowerCase() !== "bash") return false;
  const cmd = (input as { command?: unknown })?.command;
  if (typeof cmd !== "string") return false;
  return VERIFY_BIN.test(cmd) || VERIFY_SCRIPT.test(cmd);
}

// Lines a tool changed, counted from the tool's OWN arguments — never read off
// disk (keeps the visualizer passive). Edit replaces old→new; Write/create adds
// content; MultiEdit sums its edits. A 10→10 rewrite reads as +10/−10 (churn).
function diffLines(name: string, input: unknown): { added: number; removed: number } {
  const i = input as any;
  if (!i || typeof i !== "object") return { added: 0, removed: 0 };
  const n = name.toLowerCase();
  if (n === "edit") return { added: countLines(i.new_string), removed: countLines(i.old_string) };
  if (n === "write" || n === "create") return { added: countLines(i.content), removed: 0 };
  if (n === "notebookedit") return { added: countLines(i.new_source), removed: 0 };
  if (n === "multiedit" && Array.isArray(i.edits)) {
    let added = 0, removed = 0;
    for (const e of i.edits) { added += countLines(e?.new_string); removed += countLines(e?.old_string); }
    return { added, removed };
  }
  return { added: 0, removed: 0 };
}
function countLines(s: unknown): number {
  return typeof s === "string" && s.length ? s.split("\n").length : 0;
}

/** Knowledge-gathering tools — the colony scouting (frequent, drives exploring). */
function isScout(name: string): boolean {
  const n = name.toLowerCase();
  return n === "read" || n === "grep" || n === "glob";
}

/** A `git commit` in a Bash command — the "granary" beat. */
const COMMIT_RE = /\bgit\s+commit\b/i;
function isCommit(name: string, input: unknown): boolean {
  if (name.toLowerCase() !== "bash") return false;
  const cmd = (input as { command?: unknown })?.command;
  return typeof cmd === "string" && COMMIT_RE.test(cmd);
}

/** Pull plain text out of a message content (string or block array). */
function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((b) => b?.type === "text" && typeof b.text === "string")
      .map((b) => b.text as string)
      .join(" ");
  }
  return "";
}

/** First line, collapsed whitespace, truncated — a label, not a summary. */
function clip(s: string, max = 140): string {
  const line = s.replace(/\s+/g, " ").trim();
  return line.length > max ? line.slice(0, max - 1) + "…" : line;
}

function toEpoch(v: unknown): number | null {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Date.parse(v);
    return Number.isNaN(n) ? null : n;
  }
  return null;
}
