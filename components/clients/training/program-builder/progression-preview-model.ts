import {
  expandSetSpecs,
  setSpecCount,
  type SetSpec,
} from "@/utils/exercise-set-specs";
import {
  exerciseScopeKey,
  isWorkingSpec,
  type ProgressionRule,
} from "@/utils/progression-rules";
import type { Exercise } from "@/types/training";
import type { ExerciseDraft, WeekDraft } from "./program-builder-types";
import { formatLoad, type UnitSystem } from "@/utils/unit-conversions";
import { formatTargetReadout } from "@/utils/target-range";
import { isSupersetOrCircuit } from "./program-builder-groups";

// Pure view-model for the duplicate-week progression preview: pairs the
// source week with its progressed clone POSITIONALLY (progressWeek never
// adds/removes/reorders sessions or exercises) and formats the field the
// active rule touches as a before → after diff. React-free so the formatting
// is unit-testable without a render.
//
// One line when one value says it all — every working set shares the value, or
// the rule is Sets — and one line PER SET under the exercise's name when the
// sets differ, so a long prescription grows the preview down, never sideways.

/** One working set's before → after, when the sets differ. */
type ProgressionPreviewSetLine = {
  /** "S2" for a set, "R2" for a round of a superset or circuit. */
  label: string;
  before: string;
  /** The value after the rule, carrying the unit ("102.5 kg", "72.5%", "9"). */
  after: string;
};

type ProgressionPreviewRow = {
  uid: string; // the progressed clone's uid (matches changedExerciseUids)
  scopeKey: string;
  name: string;
  changed: boolean;
  before: string;
  after: string | null; // null when the rule leaves this exercise unchanged
  /** One line per working set when they differ; null when `before → after` says it all. */
  perSet: ProgressionPreviewSetLine[] | null;
};

// One session of the week: its day, its place within the day, and its rows.
export type ProgressionPreviewSession = {
  dayIndex: number;
  place: number;
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

const workingSpecs = (ex: ExerciseDraft): SetSpec[] =>
  expandSetSpecs(ex).filter(isWorkingSpec);

const hasLoad = (s: SetSpec): boolean =>
  s.load_type != null && (s.load_min != null || s.load_max != null);

// A load's value or range as a number string: "100", "100–105"; an absolute
// load converted (and snapped — this is a readout) to the viewer's unit.
const loadRange = (s: SetSpec, viewer: UnitSystem): string => {
  const convert = (kg: number | null | undefined) =>
    kg == null ? null : s.load_type === "absolute" ? formatLoad(kg, viewer).value : kg;
  return formatTargetReadout({ min: convert(s.load_min), max: convert(s.load_max) }) ?? "—";
};

const loadToken = (s: SetSpec, viewer: UnitSystem): string => {
  if (!hasLoad(s)) return "—";
  if (s.load_type !== "absolute") return `${loadRange(s, viewer)}%`;
  return `${loadRange(s, viewer)}${formatLoad(0, viewer).unit}`;
};

/** The working sets' values, and the unit they share (empty when each token carries its own). */
type Tokens = { tokens: string[]; unit: string };

const allEqual = (tokens: string[]): boolean => tokens.every((t) => t === tokens[0]);

/** One line for equal values, the values joined for differing ones, then the shared unit. */
const joinTokens = ({ tokens, unit }: Tokens): string => {
  if (tokens.length === 0) return "—";
  return `${allEqual(tokens) ? tokens[0] : tokens.join(" / ")}${unit}`;
};

function loadTokens(ex: ExerciseDraft, viewer: UnitSystem): Tokens {
  const specs = workingSpecs(ex);
  if (specs.every((s) => s.load_type === "absolute" && hasLoad(s))) {
    return { tokens: specs.map((s) => loadRange(s, viewer)), unit: ` ${formatLoad(0, viewer).unit}` };
  }
  if (
    specs.every(
      (s) => (s.load_type === "pct_1rm" || s.load_type === "pct_top") && hasLoad(s),
    )
  ) {
    return { tokens: specs.map((s) => `${loadRange(s, viewer)}%`), unit: "" };
  }
  return { tokens: specs.map((s) => loadToken(s, viewer)), unit: "" };
}

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
  return joinTokens(loadTokens(ex, viewer));
}

const repsToken = (s: SetSpec): string => {
  if (s.reps_min != null && s.reps_max != null) {
    return s.reps_min === s.reps_max ? `${s.reps_min}` : `${s.reps_min}–${s.reps_max}`;
  }
  if (s.reps_min != null) return `${s.reps_min}+`;
  if (s.reps_max != null) return `${s.reps_max}`;
  return s.reps_target?.trim() ? s.reps_target : "—";
};

const repsTokens = (ex: ExerciseDraft): Tokens => ({
  tokens: workingSpecs(ex).map(repsToken),
  unit: "",
});

export function formatReps(ex: ExerciseDraft): string {
  return joinTokens(repsTokens(ex));
}

export function formatSetCount(ex: ExerciseDraft): string {
  const n = workingSpecs(ex).length;
  return `${n} ${n === 1 ? "set" : "sets"}`;
}

// In a superset or circuit an exercise's sets are the group's rounds, and the
// Sets rule adds or removes rounds.
function formatRoundCount(ex: ExerciseDraft): string {
  const n = setSpecCount(ex);
  return `${n} ${n === 1 ? "round" : "rounds"}`;
}

function tokensForRule(
  rule: ProgressionRule,
  ex: ExerciseDraft,
  viewer: UnitSystem,
): Tokens | null {
  if (rule.kind === "load") return loadTokens(ex, viewer);
  if (rule.kind === "reps") return repsTokens(ex);
  return null;
}

function formatForRule(
  rule: ProgressionRule,
  ex: ExerciseDraft,
  viewer: UnitSystem,
  inRounds: boolean,
): string {
  const tokens = tokensForRule(rule, ex, viewer);
  if (tokens) return joinTokens(tokens);
  return inRounds ? formatRoundCount(ex) : formatSetCount(ex);
}

/**
 * One line per working set when the sets differ before or after the rule —
 * each labelled by the set's own number (a round's, in a superset or circuit),
 * so a warm-up ahead of them doesn't shift the count. Null when one line says
 * it all.
 */
function perSetLines(
  rule: ProgressionRule,
  before: ExerciseDraft,
  after: ExerciseDraft,
  viewer: UnitSystem,
  inRounds: boolean,
): ProgressionPreviewSetLine[] | null {
  const b = tokensForRule(rule, before, viewer);
  const a = tokensForRule(rule, after, viewer);
  if (!b || !a || b.tokens.length < 2) return null;
  if (allEqual(b.tokens) && allEqual(a.tokens)) return null;
  const numbers = workingSpecs(before).map((s) => s.set_number);
  return b.tokens.map((token, i) => ({
    label: `${inRounds ? "R" : "S"}${numbers[i] ?? i + 1}`,
    before: token,
    after: `${a.tokens[i] ?? "—"}${a.unit}`,
  }));
}

export function buildPreviewRows(
  source: WeekDraft,
  progressed: WeekDraft,
  changedExerciseUids: ReadonlySet<string>,
  rule: ProgressionRule,
  viewer: UnitSystem,
): ProgressionPreviewSession[] {
  const sessions: ProgressionPreviewSession[] = [];
  source.days.forEach((slot, dayIndex) => {
    slot.sessions.forEach((session, place) => {
      const progressedSession = progressed.days[dayIndex]?.sessions[place];
      if (!progressedSession) return;
      // progressWeek keeps every session, group and exercise in place, so the
      // two sessions pair up group by group, exercise by exercise.
      const rows = session.groups.flatMap((group, g) => {
        const inRounds = isSupersetOrCircuit(group);
        return group.exercises.map((before, e): ProgressionPreviewRow => {
          const after = progressedSession.groups[g]?.exercises[e];
          const changed = after != null && changedExerciseUids.has(after.uid);
          return {
            uid: after?.uid ?? before.uid,
            scopeKey: exerciseScopeKey(before),
            name: before.name,
            changed,
            before: formatForRule(rule, before, viewer, inRounds),
            after: changed ? formatForRule(rule, after, viewer, inRounds) : null,
            perSet: changed ? perSetLines(rule, before, after, viewer, inRounds) : null,
          };
        });
      });
      sessions.push({ dayIndex, place, sessionName: session.name, rows });
    });
  });
  return sessions;
}
