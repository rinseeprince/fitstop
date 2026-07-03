import {
  expandSetSpecs,
  type SetSpec,
} from "@/utils/exercise-set-specs";
import {
  exerciseScopeKey,
  type ProgressionRule,
} from "@/utils/progression-rules";
import type { Exercise } from "@/types/training";
import type { ExerciseDraft, WeekDraft } from "./program-builder-types";

// Pure view-model for the duplicate-week progression preview: pairs the
// source week with its progressed clone POSITIONALLY (progressWeek never
// adds/removes/reorders exercises) and formats the field the active rule
// touches as a before → after diff line. React-free so the formatting is
// unit-testable without a render.

export type ProgressionPreviewRow = {
  uid: string; // the progressed clone's uid (matches changedExerciseUids)
  scopeKey: string;
  name: string;
  changed: boolean;
  before: string;
  after: string | null; // null when the rule leaves this exercise unchanged
};

export type ProgressionPreviewDay = {
  dayIndex: number;
  sessionName: string;
  rows: ProgressionPreviewRow[];
};

/**
 * Compound classifier over the coach's exercise catalog: category "compound"
 * compared case-insensitively (the column is free text — seed data and coach
 * edits vary in casing). Draft exercises resolve by exerciseId first, then by
 * lowercased trimmed name (free-text rows carry exerciseId null); unknown
 * exercises are conservatively NOT compound.
 */
export function buildIsCompound(
  catalog: Exercise[],
): (ex: Pick<ExerciseDraft, "exerciseId" | "name">) => boolean {
  const byId = new Map<string, boolean>();
  const byName = new Map<string, boolean>();
  for (const entry of catalog) {
    const compound = (entry.category ?? "").trim().toLowerCase() === "compound";
    byId.set(entry.id, compound);
    byName.set(entry.name.trim().toLowerCase(), compound);
  }
  return (ex) =>
    ex.exerciseId != null
      ? (byId.get(ex.exerciseId) ?? false)
      : (byName.get(ex.name.trim().toLowerCase()) ?? false);
}

// Same working-set convention as the engine: missing set_type counts as working.
const isWorking = (s: SetSpec): boolean => (s.set_type ?? "working") === "working";

const workingSpecs = (ex: ExerciseDraft): SetSpec[] =>
  expandSetSpecs(ex).filter(isWorking);

const loadToken = (s: SetSpec): string => {
  if (s.load_value == null || s.load_type == null) return "—";
  return s.load_type === "absolute" ? `${s.load_value}kg` : `${s.load_value}%`;
};

export function formatLoads(ex: ExerciseDraft): string {
  const specs = workingSpecs(ex);
  if (specs.length === 0) return "—";
  if (specs.every((s) => s.load_type === "absolute" && s.load_value != null)) {
    return `${specs.map((s) => s.load_value).join(" / ")} kg`;
  }
  if (
    specs.every(
      (s) =>
        (s.load_type === "pct_1rm" || s.load_type === "pct_top") && s.load_value != null,
    )
  ) {
    return specs.map((s) => `${s.load_value}%`).join(" / ");
  }
  return specs.map(loadToken).join(" / ");
}

const repsToken = (s: SetSpec): string => {
  if (s.reps_min != null && s.reps_max != null) {
    return s.reps_min === s.reps_max ? `${s.reps_min}` : `${s.reps_min}–${s.reps_max}`;
  }
  if (s.reps_min != null) return `${s.reps_min}+`;
  if (s.reps_max != null) return `${s.reps_max}`;
  return s.reps_target?.trim() ? s.reps_target : "—";
};

export function formatReps(ex: ExerciseDraft): string {
  const tokens = workingSpecs(ex).map(repsToken);
  if (tokens.length === 0) return "—";
  return tokens.every((t) => t === tokens[0]) ? tokens[0] : tokens.join(" / ");
}

export function formatSetCount(ex: ExerciseDraft): string {
  const n = workingSpecs(ex).length;
  return `${n} ${n === 1 ? "set" : "sets"}`;
}

export function formatForRule(rule: ProgressionRule, ex: ExerciseDraft): string {
  if (rule.kind === "load") return formatLoads(ex);
  if (rule.kind === "reps") return formatReps(ex);
  return formatSetCount(ex);
}

export function buildPreviewRows(
  source: WeekDraft,
  progressed: WeekDraft,
  changedExerciseUids: ReadonlySet<string>,
  rule: ProgressionRule,
): ProgressionPreviewDay[] {
  const days: ProgressionPreviewDay[] = [];
  source.days.forEach((slot, dayIndex) => {
    const progressedSession = progressed.days[dayIndex]?.session;
    if (!slot.session || !progressedSession) return;
    const rows = slot.session.exercises.map((before, i): ProgressionPreviewRow => {
      const after = progressedSession.exercises[i];
      const changed = after != null && changedExerciseUids.has(after.uid);
      return {
        uid: after?.uid ?? before.uid,
        scopeKey: exerciseScopeKey(before),
        name: before.name,
        changed,
        before: formatForRule(rule, before),
        after: changed ? formatForRule(rule, after) : null,
      };
    });
    days.push({ dayIndex, sessionName: slot.session.name, rows });
  });
  return days;
}
