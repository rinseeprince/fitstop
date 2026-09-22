import { expandSetSpecs, type SetSpec } from "@/utils/exercise-set-specs";
import { formatTargetReadout } from "@/utils/target-range";
import type { ExerciseDraft } from "@/components/clients/training/program-builder/program-builder-types";

// An exercise's working sets as the model reads them on the exercise's line of
// the program state (draft-tool-helpers.ts): how many, their reps and their
// loads. Working-TYPE sets only — a set with no type counts as one — so a
// warm-up, a drop or a set to failure reads in get_session, set by set. One
// value when every working set shares it, the values joined when they differ.
// Loads read in canonical kilograms, the unit the model speaks in every prompt
// and tool: an lbs string reaching it would corrupt its arithmetic silently.

const isWorkingSpec = (s: SetSpec): boolean => (s.set_type ?? "working") === "working";

const workingSpecs = (ex: ExerciseDraft): SetSpec[] => expandSetSpecs(ex).filter(isWorkingSpec);

const hasLoad = (s: SetSpec): boolean =>
  s.load_type != null && (s.load_min != null || s.load_max != null);

// A load's value or range as a number string: "100", "100–105".
const loadRange = (s: SetSpec): string =>
  formatTargetReadout({ min: s.load_min ?? null, max: s.load_max ?? null }) ?? "—";

const loadToken = (s: SetSpec): string => {
  if (!hasLoad(s)) return "—";
  return s.load_type === "absolute" ? `${loadRange(s)}kg` : `${loadRange(s)}%`;
};

/** The working sets' values, and the unit they share (empty when each value carries its own). */
type Tokens = { tokens: string[]; unit: string };

const allEqual = (tokens: string[]): boolean => tokens.every((t) => t === tokens[0]);

/** One value when every set shares it, else the values joined, then the shared unit. */
const joinTokens = ({ tokens, unit }: Tokens): string => {
  if (tokens.length === 0) return "—";
  return `${allEqual(tokens) ? tokens[0] : tokens.join(" / ")}${unit}`;
};

function loadTokens(ex: ExerciseDraft): Tokens {
  const specs = workingSpecs(ex);
  if (specs.every((s) => s.load_type === "absolute" && hasLoad(s))) {
    return { tokens: specs.map(loadRange), unit: " kg" };
  }
  if (
    specs.every(
      (s) => (s.load_type === "pct_1rm" || s.load_type === "pct_top") && hasLoad(s),
    )
  ) {
    return { tokens: specs.map((s) => `${loadRange(s)}%`), unit: "" };
  }
  return { tokens: specs.map(loadToken), unit: "" };
}

/** "100 kg", "100 / 90 kg", "70% / 85%", "100kg / 70% / —". */
export function formatLoads(ex: ExerciseDraft): string {
  return joinTokens(loadTokens(ex));
}

const repsToken = (s: SetSpec): string => {
  if (s.reps_min != null && s.reps_max != null) {
    return s.reps_min === s.reps_max ? `${s.reps_min}` : `${s.reps_min}–${s.reps_max}`;
  }
  if (s.reps_min != null) return `${s.reps_min}+`;
  if (s.reps_max != null) return `${s.reps_max}`;
  return s.reps_target?.trim() ? s.reps_target : "—";
};

/** "8–10", "5 / 5 / 3", "12+ / 15 / max". */
export function formatReps(ex: ExerciseDraft): string {
  return joinTokens({ tokens: workingSpecs(ex).map(repsToken), unit: "" });
}

/** "1 set", "4 sets". */
export function formatSetCount(ex: ExerciseDraft): string {
  const n = workingSpecs(ex).length;
  return `${n} ${n === 1 ? "set" : "sets"}`;
}
