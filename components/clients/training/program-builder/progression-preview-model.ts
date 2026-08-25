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
import { formatLoad, type UnitSystem } from "@/utils/unit-conversions";

// Pure view-model for the duplicate-week progression preview: pairs the
// source week with its progressed clone POSITIONALLY (progressWeek never
// adds/removes/reorders exercises) and formats the field the active rule
// touches as a before → after diff line. React-free so the formatting is
// unit-testable without a render.

type ProgressionPreviewRow = {
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

const loadToken = (s: SetSpec, viewer: UnitSystem): string => {
  if (s.load_value == null || s.load_type == null) return "—";
  if (s.load_type !== "absolute") return `${s.load_value}%`;
  const load = formatLoad(s.load_value, viewer);
  return `${load.value}${load.unit}`;
};

/**
 * FORK POINT. Two callers with opposite requirements:
 *
 * - duplicate-week-dialog.tsx renders this to a COACH, who must see their own
 *   unit, so it passes their useUnits() preference.
 * - services/assistant/** feeds it back to the MODEL, which speaks canonical
 *   kilograms in every prompt and tool schema (draft-agent-service.ts's
 *   "load_kg", draft-tool-helpers.ts's specLine). Those callers pin "metric"
 *   explicitly rather than inheriting a default — an lbs string reaching the
 *   assistant would silently corrupt its arithmetic.
 *
 * Hence the required parameter: there is no safe default for both.
 */
export function formatLoads(ex: ExerciseDraft, viewer: UnitSystem): string {
  const specs = workingSpecs(ex);
  if (specs.length === 0) return "—";
  if (specs.every((s) => s.load_type === "absolute" && s.load_value != null)) {
    const loads = specs.map((s) => formatLoad(s.load_value!, viewer));
    return `${loads.map((l) => l.value).join(" / ")} ${loads[0].unit}`;
  }
  if (
    specs.every(
      (s) =>
        (s.load_type === "pct_1rm" || s.load_type === "pct_top") && s.load_value != null,
    )
  ) {
    return specs.map((s) => `${s.load_value}%`).join(" / ");
  }
  return specs.map((s) => loadToken(s, viewer)).join(" / ");
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

function formatForRule(
  rule: ProgressionRule,
  ex: ExerciseDraft,
  viewer: UnitSystem,
): string {
  if (rule.kind === "load") return formatLoads(ex, viewer);
  if (rule.kind === "reps") return formatReps(ex);
  return formatSetCount(ex);
}

export function buildPreviewRows(
  source: WeekDraft,
  progressed: WeekDraft,
  changedExerciseUids: ReadonlySet<string>,
  rule: ProgressionRule,
  viewer: UnitSystem,
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
        before: formatForRule(rule, before, viewer),
        after: changed ? formatForRule(rule, after, viewer) : null,
      };
    });
    days.push({ dayIndex, sessionName: slot.session.name, rows });
  });
  return days;
}
