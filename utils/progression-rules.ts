import {
  compactFromSpecs,
  expandSetSpecs,
  MAX_SET_SPECS,
  MAX_WORKING_SETS,
  type SetSpec,
} from "./exercise-set-specs";

// Duplicate-week progression engine (Training Builder S4). Pure math over the
// per-set model: given one exercise's specs and a rule, produce the next
// week's prescription. Invariants (owner-decided, tested):
// - WORKING-TYPE sets only ((set_type ?? 'working') === 'working' — missing
//   type counts as working, matching countWorkingSets). Warm-up/AMRAP/drop/
//   failure specs copy by reference, a deliberate divergence from the
//   non-warmup definition analytics use; drops[].weight is never scaled.
// - Never fabricates a load_type (load_value with null type is skipped),
//   never mutates input, never returns [], never changes set_type — the
//   ≥1-non-warmup zod refine cannot be violated.
// - null = the rule changes nothing (compact-only exercises then stay
//   compact, per the applySetSpecEdit discipline). Negative amounts are
//   deloads on every rule; the sets rule removes working sets from the end,
//   flooring at one. AMRAP-result-keyed rules are a future seam (no logged
//   results exist at library-authoring time).

export type ProgressionRule =
  | { kind: "load"; unit: "kg" | "percent"; amount: number }
  | { kind: "reps"; amount: number }
  | { kind: "sets"; amount: number };

export type ProgressionScope =
  | { kind: "all" }
  | { kind: "compounds" }
  | { kind: "selected"; keys: ReadonlySet<string> };

// Structural subset of the builder's ExerciseDraft (which satisfies it with
// no cast) — utils must not import component types.
export type ProgressionExercise = {
  exerciseId: string | null;
  name: string;
  isWarmup?: boolean;
  setSpecs?: SetSpec[] | null;
  sets: number;
  repsMin?: number | null;
  repsMax?: number | null;
  repsTarget?: string | null;
  rpeTarget?: number | null;
  percentage1rm?: number | null;
  tempo?: string | null;
  restSeconds?: number | null;
};

// Merged-fields result: the caller spreads { ...exercise, ...result } so the
// compact-projection invariant (landmine #2) is enforced HERE, not delegated.
export type ProgressionResult = {
  setSpecs: SetSpec[];
  sets: number;
  repsMin: number | null;
  repsMax: number | null;
  percentage1rm: number | null;
};

const clamp = (n: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, n));
const round2 = (n: number): number => Math.round(n * 100) / 100;
const round1 = (n: number): number => Math.round(n * 10) / 10;
const roundHalf = (n: number): number => Math.round(n * 2) / 2;

const isWorking = (s: SetSpec): boolean => (s.set_type ?? "working") === "working";

const cloneSpec = (s: SetSpec): SetSpec => ({
  ...s,
  drops: s.drops ? s.drops.map((d) => ({ ...d })) : s.drops,
});

function progressLoad(s: SetSpec, unit: "kg" | "percent", amount: number): SetSpec {
  // load_type null with a load_value set is schema-legal — skip, never guess.
  if (s.load_value == null || s.load_type == null) return s;
  let next: number;
  if (unit === "kg") {
    if (s.load_type !== "absolute") return s;
    next = clamp(round2(s.load_value + amount), 0, 2000); // 2dp scrubs float dust
  } else if (s.load_type === "absolute") {
    next = clamp(roundHalf(s.load_value * (1 + amount / 100)), 0, 2000); // plate math
  } else {
    next = clamp(round1(s.load_value + amount), 0, 100); // percentage points
  }
  // Post-rounding comparison: a snap-back-to-same is a genuine no-op.
  return next === s.load_value ? s : { ...s, load_value: next };
}

function progressReps(s: SetSpec, amount: number): SetSpec {
  // Same monotone transform on both ends preserves min ≤ max under the clamp.
  const min = s.reps_min == null ? s.reps_min : clamp(Math.round(s.reps_min + amount), 0, 100);
  const max = s.reps_max == null ? s.reps_max : clamp(Math.round(s.reps_max + amount), 0, 100);
  if (min === s.reps_min && max === s.reps_max) return s;
  return { ...s, reps_min: min, reps_max: max };
}

const renumber = (specs: SetSpec[]): SetSpec[] =>
  // Reference-preserving: specs whose position didn't shift keep identity.
  specs.map((s, i) => (s.set_number === i + 1 ? s : { ...s, set_number: i + 1 }));

// Unified partial policy for both directions (the preview always shows the
// exact result): append up to the joint headroom of both ceilings; no
// headroom (or no working set to clone) = no-op.
function appendWorkingSets(specs: SetSpec[], count: number): SetSpec[] | null {
  const lastWorking = specs.reduce((acc, s, i) => (isWorking(s) ? i : acc), -1);
  if (lastWorking < 0) return null;
  const workingCount = specs.filter(isWorking).length;
  const headroom = Math.min(MAX_SET_SPECS - specs.length, MAX_WORKING_SETS - workingCount);
  const n = Math.min(count, headroom);
  if (n < 1) return null;
  // Insert right after the last working set so finishers (drop/failure) stay last.
  const clones = Array.from({ length: n }, () => cloneSpec(specs[lastWorking]));
  return renumber([...specs.slice(0, lastWorking + 1), ...clones, ...specs.slice(lastWorking + 1)]);
}

// Deload direction: remove the LAST working sets (back-offs go first, the top
// set survives); warm-ups/finishers are never removed and every exercise
// keeps at least ONE working set (partial removal down to the floor).
function removeWorkingSets(specs: SetSpec[], count: number): SetSpec[] | null {
  const workingIdx: number[] = [];
  specs.forEach((s, i) => {
    if (isWorking(s)) workingIdx.push(i);
  });
  const n = Math.min(count, workingIdx.length - 1);
  if (n < 1) return null;
  const drop = new Set(workingIdx.slice(-n));
  return renumber(specs.filter((_, i) => !drop.has(i)));
}

/** Math kernel over already-materialized specs. null = rule changes nothing. */
export function progressSetSpecs(specs: SetSpec[], rule: ProgressionRule): SetSpec[] | null {
  if (!Number.isFinite(rule.amount) || rule.amount === 0) return null;
  if (rule.kind === "sets") {
    const n = Math.trunc(rule.amount);
    if (n >= 1) return appendWorkingSets(specs, n);
    if (n <= -1) return removeWorkingSets(specs, -n);
    return null; // fractional between -1 and 1
  }
  const next = specs.map((s) => {
    if (!isWorking(s)) return s;
    return rule.kind === "load"
      ? progressLoad(s, rule.unit, rule.amount)
      : progressReps(s, rule.amount);
  });
  return next.every((s, i) => s === specs[i]) ? null : next;
}

/**
 * Exercise-level entry: guard → materialize → kernel → merge. Legacy
 * whole-exercise warm-ups (isWarmup) are skipped for every rule — their specs
 * expand as 'working' and would otherwise progress. Compact-only exercises
 * materialize via expandSetSpecs only when the rule actually changes them.
 * Under the percent rule the compact percentage1rm moves by the same points —
 * compactFromSpecs doesn't maintain it, and legacy readers would otherwise
 * show a stale percent for every progressed week.
 */
export function progressExercise(
  ex: ProgressionExercise,
  rule: ProgressionRule,
): ProgressionResult | null {
  if (ex.isWarmup) return null;
  const specs = ex.setSpecs && ex.setSpecs.length > 0 ? ex.setSpecs : expandSetSpecs(ex);
  const next = progressSetSpecs(specs, rule);
  const pct = ex.percentage1rm ?? null;
  // Same finite/non-zero guard as the kernel — a no-op rule must not move the
  // compact percent through rounding alone.
  const pctMirror =
    rule.kind === "load" &&
    rule.unit === "percent" &&
    pct != null &&
    Number.isFinite(rule.amount) &&
    rule.amount !== 0
      ? clamp(round1(pct + rule.amount), 0, 100)
      : pct;
  if (next == null && pctMirror === pct) return null;
  const finalSpecs = next ?? specs;
  const compact = compactFromSpecs(finalSpecs);
  return {
    setSpecs: finalSpecs,
    sets: compact.sets,
    repsMin: compact.repsMin,
    repsMax: compact.repsMax,
    percentage1rm: pctMirror,
  };
}

/** Identity for scope selection: catalog id when resolved, else the name. */
export function exerciseScopeKey(
  ex: Pick<ProgressionExercise, "exerciseId" | "name">,
): string {
  return ex.exerciseId ?? ex.name.trim().toLowerCase();
}

// isCompound is required (no silent-false default): an accidentally-missing
// classifier would turn the compounds scope into a whole-week no-op.
export function buildScopePredicate(
  scope: ProgressionScope,
  isCompound: (ex: ProgressionExercise) => boolean,
): (ex: ProgressionExercise) => boolean {
  switch (scope.kind) {
    case "all":
      return () => true;
    case "compounds":
      return isCompound;
    case "selected":
      return (ex) => scope.keys.has(exerciseScopeKey(ex));
  }
}
