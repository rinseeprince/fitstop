import type {
  DaySlotDraft,
  ExerciseDraft,
  SessionDraft,
  WeekDraft,
} from "@/components/clients/training/program-builder/program-builder-types";
import type { ProgramDraft } from "@/components/clients/training/program-builder/program-builder-types";
import { normalizeDraft } from "@/components/clients/training/program-builder/program-builder-model";
import {
  applyDraftOp,
  type DraftOp,
} from "@/components/clients/training/program-builder/program-builder-ops";
import {
  formatLoads,
  formatReps,
  formatSetCount,
} from "@/components/clients/training/program-builder/progression-preview-model";
import type { SetSpec } from "@/utils/exercise-set-specs";
import type { DraftWorkspace } from "./draft-workspace";

// Shared plumbing for the assistant's tool executors: 1-based week/day/exercise
// addressing (the model speaks "week 3, day 5"), compact draft rendering for
// read tools, and the single commit path every write tool goes through.

/**
 * Execute one op against the workspace. Returns the skip reason (the executor
 * turns it into a tool error the model must relay — silent no-ops are a bug
 * class) or null on success. Mirrors the client replay exactly: applyDraftOp
 * then normalizeDraft, so the server's working copy and the client's draft
 * stay byte-identical.
 */
/**
 * CONCURRENCY INVARIANT — tool `run` functions must stay SYNCHRONOUS.
 *
 * The SDK executes a response's tool_use blocks via Promise.all, and the
 * system prompt actively encourages the model to batch independent calls into
 * one response (each response is a ~10-30s round trip the coach waits on).
 * That is safe only because every executor's body runs to completion before the
 * next one starts: a sync body has no await point for the event loop to
 * interleave at, so ws.draft mutations stay serialized. An `await` inside an
 * executor would let two batched calls read the same ws.draft and overwrite
 * each other — the coach asks for three edits, two land, and the assistant
 * reports three.
 *
 * This is currently UNREACHABLE by design, not by luck: the assistant is
 * scoped to the program in the builder and never reads client logs, history,
 * or metrics (owner decision 2026-07-21), and the exercise catalog is
 * preloaded once per turn — so no tool has anything to await. Serialization
 * was designed and deliberately not built on that basis.
 *
 * THEREFORE: adding a tool that needs a DB read (e.g. "what did this client
 * lift last week", "use their current 1RM") is not a drop-in change. Either
 * serialize execution at the tool-composition point first, or keep the tool
 * synchronous by preloading its data into the workspace like the catalog.
 */
export function commitOp(ws: DraftWorkspace, op: DraftOp): string | null {
  const outcome = applyDraftOp(ws.draft, op, {
    target: ws.target,
    lockedSlotUids: ws.lockedSlotUids,
  });
  if (outcome.skipped) return outcome.skipped;
  if (outcome.draft !== ws.draft) ws.draft = normalizeDraft(outcome.draft);
  // Labels interpolate session/exercise names (schema-legal up to 200 chars),
  // so a long name can push a label past draftOpSchema's 200-char cap — which
  // would make the CLIENT reject the whole turn after the server already
  // applied it and the model told the coach it landed. Clamp centrally: every
  // op passes through here, so no label template can reopen this.
  ws.ops.push(
    op.label && op.label.length > MAX_OP_LABEL
      ? { ...op, label: `${op.label.slice(0, MAX_OP_LABEL - 1)}…` }
      : op,
  );
  return null;
}

// Mirrors opLabel's .max(200) in lib/validations/assistant.ts.
const MAX_OP_LABEL = 200;

export type Resolved<T> = { ok: true; value: T } | { ok: false; error: string };

export function resolveWeek(ws: DraftWorkspace, week: number): Resolved<WeekDraft> {
  const found = ws.draft.weeks[week - 1];
  if (!found) {
    return {
      ok: false,
      error: `Week ${week} doesn't exist — the program has ${ws.draft.weeks.length} week(s).`,
    };
  }
  return { ok: true, value: found };
}

export function resolveSlot(
  ws: DraftWorkspace,
  week: number,
  day: number,
): Resolved<DaySlotDraft> {
  const w = resolveWeek(ws, week);
  if (!w.ok) return w;
  const slot = w.value.days[day - 1];
  if (!slot) return { ok: false, error: `Day ${day} is out of range (days are 1-7).` };
  return { ok: true, value: slot };
}

export function resolveSession(
  ws: DraftWorkspace,
  week: number,
  day: number,
): Resolved<SessionDraft> {
  const slot = resolveSlot(ws, week, day);
  if (!slot.ok) return slot;
  if (!slot.value.session) {
    return {
      ok: false,
      error: `Week ${week} day ${day} is a rest day — add a session there first.`,
    };
  }
  return { ok: true, value: slot.value.session };
}

export function resolveExerciseRef(
  session: SessionDraft,
  ref: { exercisePosition?: number; exerciseName?: string },
): Resolved<{ exercise: ExerciseDraft; index: number }> {
  if (ref.exercisePosition != null) {
    const index = ref.exercisePosition - 1;
    const exercise = session.exercises[index];
    if (!exercise) {
      return {
        ok: false,
        error: `"${session.name}" has ${session.exercises.length} exercise(s) — position ${ref.exercisePosition} doesn't exist.`,
      };
    }
    return { ok: true, value: { exercise, index } };
  }
  const query = ref.exerciseName?.trim().toLowerCase();
  if (!query) {
    return { ok: false, error: "Provide exercisePosition or exerciseName." };
  }
  const exact = session.exercises.findIndex((e) => e.name.trim().toLowerCase() === query);
  if (exact >= 0) return { ok: true, value: { exercise: session.exercises[exact], index: exact } };
  const partial = session.exercises
    .map((e, index) => ({ e, index }))
    .filter(({ e }) => e.name.toLowerCase().includes(query));
  if (partial.length === 1) {
    return { ok: true, value: { exercise: partial[0].e, index: partial[0].index } };
  }
  const names = session.exercises.map((e, i) => `${i + 1}. ${e.name}`).join(", ");
  return {
    ok: false,
    error:
      partial.length === 0
        ? `No exercise matching "${ref.exerciseName}" in "${session.name}". It has: ${names}`
        : `"${ref.exerciseName}" matches several exercises in "${session.name}": ${names}. Use exercisePosition.`,
  };
}

// --- Compact rendering for read tools ---

const specLine = (s: SetSpec): string => {
  const reps =
    s.reps_min != null || s.reps_max != null
      ? `${s.reps_min ?? "?"}-${s.reps_max ?? "?"} reps`
      : (s.reps_target ?? "reps —");
  const load =
    s.load_value != null && s.load_type != null
      ? s.load_type === "absolute"
        ? ` @ ${s.load_value}kg`
        : ` @ ${s.load_value}% (${s.load_type})`
      : "";
  const rpe = s.rpe_target != null ? ` RPE${s.rpe_target}` : "";
  const drops = s.drops?.length ? ` +${s.drops.length} drop(s)` : "";
  return `S${s.set_number} ${s.set_type}: ${reps}${load}${rpe}${drops}`;
};

export function exerciseLine(ex: ExerciseDraft, position: number): string {
  const bits = [
    `${position}. ${ex.name}`,
    formatSetCount(ex),
    `reps ${formatReps(ex)}`,
    `load ${formatLoads(ex)}`,
  ];
  if (ex.rpeTarget != null) bits.push(`RPE ${ex.rpeTarget}`);
  if (ex.restSeconds != null) bits.push(`rest ${ex.restSeconds}s`);
  if (ex.exerciseId == null) bits.push("(unlinked free-text)");
  return bits.join(" — ");
}

export function sessionDetail(session: SessionDraft, week: number, day: number): string {
  const header = [
    `Week ${week} day ${day}: "${session.name}"`,
    session.focus ? `focus ${session.focus}` : null,
    session.estimatedDurationMinutes != null
      ? `${session.estimatedDurationMinutes}min`
      : null,
    session.calorieSurplusPercentage != null
      ? `surplus ${session.calorieSurplusPercentage}%`
      : "surplus inherits program default",
  ]
    .filter(Boolean)
    .join(" — ");
  const lines = session.exercises.flatMap((ex, i) => {
    const out = [exerciseLine(ex, i + 1)];
    if (ex.setSpecs) out.push(...ex.setSpecs.map((s) => `   ${specLine(s)}`));
    return out;
  });
  const notes = session.notes ? [`Notes: ${session.notes}`] : [];
  return [header, ...lines, ...notes].join("\n") || header;
}

export function weekOneLiner(week: WeekDraft): string {
  const days = week.days
    .map((slot, i) =>
      slot.session
        ? `D${i + 1} ${slot.session.name}(${slot.session.exercises.length}ex)`
        : `D${i + 1} rest`,
    )
    .join(" | ");
  return `W${week.weekIndex + 1}: ${days}`;
}

// Front-loading budget, in characters (~3.4k tokens). Every read tool call the
// model has to make is a FULL sequential round trip — tens of seconds of the
// coach staring at a spinner. Shipping the whole program up front instead costs
// a fraction of a cent in input tokens, so the trade is lopsided: pay tokens,
// buy latency. Only genuinely large programs fall back to the skeleton.
const FULL_DETAIL_BUDGET_CHARS = 12_000;

/**
 * The program state the model receives with the command. Returns the FULL
 * prescription when it fits the budget (`complete: true` — the model can plan
 * every edit without a single read call), otherwise the per-week skeleton it
 * must drill into with get_week / get_session.
 */
export function programContext(draft: ProgramDraft): {
  text: string;
  complete: boolean;
} {
  const full = programFullDetail(draft);
  if (full.length <= FULL_DETAIL_BUDGET_CHARS) {
    return { text: full, complete: true };
  }
  return { text: programSkeleton(draft), complete: false };
}

function programFullDetail(draft: ProgramDraft): string {
  const lines: string[] = [programHeader(draft)];
  draft.weeks.forEach((week, w) => {
    lines.push(`Week ${w + 1}:`);
    week.days.forEach((slot, d) => {
      if (!slot.session) {
        lines.push(`  Day ${d + 1}: rest`);
        return;
      }
      const s = slot.session;
      const meta = [
        s.focus ? s.focus : null,
        s.calorieSurplusPercentage != null ? `surplus ${s.calorieSurplusPercentage}%` : null,
      ]
        .filter(Boolean)
        .join(", ");
      lines.push(`  Day ${d + 1}: "${s.name}"${meta ? ` (${meta})` : ""}`);
      s.exercises.forEach((ex, i) => lines.push(`    ${exerciseLine(ex, i + 1)}`));
    });
  });
  return lines.join("\n");
}

function programHeader(draft: ProgramDraft): string {
  return [
    `Program "${draft.name}"`,
    draft.splitType ? `focus: ${draft.splitType}` : null,
    `${draft.weeks.length} week(s)`,
    draft.defaultSurplusPercentage != null
      ? `default surplus ${draft.defaultSurplusPercentage}%`
      : "no default surplus",
  ]
    .filter(Boolean)
    .join(" — ");
}

export function programSkeleton(draft: ProgramDraft): string {
  const header = [
    `Program "${draft.name}"`,
    draft.splitType ? `focus: ${draft.splitType}` : null,
    `${draft.weeks.length} week(s)`,
    draft.defaultSurplusPercentage != null
      ? `default surplus ${draft.defaultSurplusPercentage}%`
      : "no default surplus",
  ]
    .filter(Boolean)
    .join(" — ");
  return [header, ...draft.weeks.map(weekOneLiner)].join("\n");
}
