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
export function commitOp(ws: DraftWorkspace, op: DraftOp): string | null {
  const outcome = applyDraftOp(ws.draft, op, { target: ws.target });
  if (outcome.skipped) return outcome.skipped;
  if (outcome.draft !== ws.draft) ws.draft = normalizeDraft(outcome.draft);
  ws.ops.push(op);
  return null;
}

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
