import {
  chainPhases,
  isConformingChain,
  weeksBetween,
} from "@/lib/goals/phase-chain";
import {
  deriveDeadlineFromRate,
  deriveRateFromTarget,
} from "@/lib/goals/goal-rate";
import { goalState } from "@/lib/goals/goal-state";
import { weightFromKg, weightToKg } from "@/utils/nutrition-helpers";
import type { ClientPhase } from "@/services/client-phases-service";
import type { ClientGoal } from "@/types/client-goals";

/**
 * Every decision the Goal & plan panel makes, as pure functions.
 *
 * ## Two unit domains, one boundary
 *
 * **Display** — the form fields, `client_goals.goal_weight`,
 * `clients.current_weight`, `goalState`, and the projection. These are the
 * client's own unit (`clients.weight_unit`) and are NEVER converted on the way
 * to a store: `resolveEffectiveGoal` applies `weightToKg` when it READS
 * `client_goals.goal_weight`, so writing kg into that column would be read as
 * kg-of-kg. A 170 lb target stored as 77.11 comes back out as a 35 kg goal.
 *
 * **kg** — `lib/goals/goal-rate.ts` and `client_phases.rate_per_week_kg`.
 * Conversion INTO this domain is required and happens here, at one boundary,
 * in both directions.
 *
 * The deadline/rate arithmetic happens to be unit-agnostic (a same-unit
 * difference over a dimensionless quotient in one direction; the weight unit
 * cancels between numerator and denominator in the other), but this module does
 * not rely on that, because `getRateSafety` in the same module returns
 * ABSOLUTE kg thresholds. A display-unit rate meeting them is over-restrictive:
 * an lbs number is ~2.2x the kg it stands for, so 1.5 lb/wk (0.68 kg/wk, safe)
 * would trip the 1.0 kg/wk cap and be clamped slower than asked. That is the
 * OPPOSITE sign to the bug task 2.4 caught, where a kg rate met a display
 * ceiling and read looser than reality — same root cause, do not conflate them.
 *
 * ## The crossing is LOSSY, so an untouched rate is never re-converted
 *
 * kg → 2dp display → kg does not round-trip: −0.6 kg shows as −1.32 lb/wk and
 * comes back as −0.5986…, and `roundTo` alone loses a stored −0.625 kg as −0.62
 * even for a kg client. `toPhasesBody` therefore resends the STORED kg verbatim
 * for any row whose rate field still holds its seeded value, because the
 * consumers of that number compare it with `===` (`carryDailyTargets`) and hash
 * it (`computePhasesFingerprint`) — so a drifted rate turns a pure rename into a
 * numeric edit that nulls every generated grid and marks the plan stale. See
 * {@link rateToKg}.
 *
 * ## NaN never gets constructed
 *
 * `client.currentWeight` is `number | undefined`, and `weightToKg(undefined)` is
 * NaN — which does not throw. It would reach `deriveRateFromTarget` and render
 * as "NaN", and in `goalState` every comparison against NaN is false so it falls
 * through to `{state:"gap", amount: NaN}`. Every entry point below therefore
 * returns an absent result BEFORE converting, rather than filtering after.
 */

export type WeightUnit = "lbs" | "kg";

/** One editable Route row. `ratePerWeek` is in the client's DISPLAY unit. */
export type BlockRow = {
  /** Present for a stored block, absent for one the coach just added. */
  id?: string;
  name: string;
  weeks: number;
  ratePerWeek: number;
};

/** The same row as the form holds it — text inputs hand back strings. */
export type BlockRowInput = {
  id?: string;
  name: string;
  weeks: string;
  ratePerWeek: string;
};

// Display rates are shown to 2dp. The seed and the payload both round-trip
// through the same conversion, so an untouched form produces a byte-identical
// payload and `buildWrites` correctly reports "nothing changed" (see below).
const RATE_DP = 2;

function roundTo(value: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(value * f) / f;
}

/** `undefined` for anything that is not a finite number — never NaN. */
export function parseNumber(value: string): number | undefined {
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Form rows → model rows for the LIVE PREVIEW only.
 *
 * A half-typed length must not make the preview jump or invert, so an
 * unparseable `weeks` previews as 1 and an unparseable rate as 0. The save is
 * governed by zod, not by this.
 */
export function parseBlockRows(rows: BlockRowInput[]): BlockRow[] {
  return rows.map((row) => {
    const weeks = parseNumber(row.weeks);
    const rate = parseNumber(row.ratePerWeek);
    return {
      ...(row.id ? { id: row.id } : {}),
      name: row.name,
      weeks: weeks != null && weeks >= 1 ? Math.round(weeks) : 1,
      ratePerWeek: rate ?? 0,
    };
  });
}

/**
 * The 2dp display rate a stored block seeds into the form.
 *
 * One function so {@link seedBlockRows} and {@link toPhasesBody}'s
 * untouched-rate lookup cannot drift on what "unchanged" means.
 */
function seededDisplayRate(phase: ClientPhase, unit: WeightUnit): number {
  return roundTo(weightFromKg(phase.ratePerWeekKg, unit), RATE_DP);
}

/**
 * Stored blocks → form rows, converting each rate out of kg exactly once.
 *
 * Only meaningful for a conforming chain — see {@link seedGoalPlan}.
 */
export function seedBlockRows(
  phases: ClientPhase[],
  unit: WeightUnit
): BlockRowInput[] {
  return phases.map((phase) => ({
    id: phase.id,
    name: phase.name,
    weeks: String(weeksBetween(phase.startsOn, phase.endsOn)),
    ratePerWeek: String(seededDisplayRate(phase, unit)),
  }));
}

export type GoalPlanFormValues = {
  startDate: string;
  goalWeight: string;
  goalBodyFat: string;
  deadline: string;
  blocks: BlockRowInput[];
};

export type GoalPlanSeed = {
  values: GoalPlanFormValues;
  /**
   * False when the stored chain could not have come from `chainPhases` — a
   * hand-written span that is not a whole number of weeks, or a gap. The panel
   * renders the Route section read-only and sends no phases write; see
   * `isConformingChain` for why normalizing would be unrecoverable.
   */
  conforming: boolean;
};

/**
 * Seed the whole form from the server's two records.
 *
 * **The start date comes from the blocks when there are any.** That value IS
 * the phases PUT's `startDate`, so seeding it from `goal_start_date` instead
 * would show `today` for a client whose blocks start next month (the goal
 * column is nullable and `resolveEffectiveGoal` falls back to today), and the
 * first save would drag every block to today and null every generated grid.
 * When the two disagree, saving reconciles the goal column to the blocks —
 * which is also what retries a goal write that failed after the blocks one
 * succeeded.
 */
export function seedGoalPlan(input: {
  goal: ClientGoal | null;
  phases: ClientPhase[];
  unit: WeightUnit;
  clientToday: string;
}): GoalPlanSeed {
  const { goal, phases, unit, clientToday } = input;
  const conforming = isConformingChain(phases);

  return {
    conforming,
    values: {
      startDate:
        phases.length > 0
          ? phases[0].startsOn
          : (goal?.goalStartDate ?? clientToday),
      goalWeight: goal?.goalWeight != null ? String(goal.goalWeight) : "",
      goalBodyFat:
        goal?.goalBodyFatPercentage != null
          ? String(goal.goalBodyFatPercentage)
          : "",
      deadline: goal?.goalDeadline ?? "",
      blocks: conforming ? seedBlockRows(phases, unit) : [],
    },
  };
}

// ---------------------------------------------------------------------------
// The live readout
// ---------------------------------------------------------------------------

export type PlanVerdict =
  | { kind: "reached" }
  | { kind: "short"; amount: number }
  | { kind: "past"; amount: number };

export type PlanProjection = {
  totalWeeks: number;
  startsOn: string;
  endsOn: string;
  /** Display units. Null when the client has no current weight on file. */
  projectedWeight: number | null;
  /** Null when there is nothing to be on track FOR, or nothing to project. */
  verdict: PlanVerdict | null;
};

/**
 * "15 weeks · 4 Aug – 16 Nov · projects 76.4 kg", as data.
 *
 * Runs wholly in DISPLAY units: `rows[].ratePerWeek` has already been converted
 * out of kg by {@link seedBlockRows}, and `currentWeight` / `goalWeight` are
 * display-unit by definition. Mixing a kg rate into this sum is task 2.4's bug.
 *
 * Returns null for an empty chain — there is no plan to describe.
 */
export function projectPlan(input: {
  rows: BlockRow[];
  startDate: string;
  currentWeight?: number;
  goalWeight?: number;
}): PlanProjection | null {
  const { rows, startDate, currentWeight, goalWeight } = input;
  if (rows.length === 0) return null;

  const chained = chainPhases(startDate, rows);
  const totalWeeks = rows.reduce((sum, row) => sum + row.weeks, 0);

  // Guard BEFORE arithmetic: `undefined + n` is NaN and renders as "NaN".
  if (currentWeight == null) {
    return {
      totalWeeks,
      startsOn: chained[0].startsOn,
      endsOn: chained[chained.length - 1].endsOn,
      projectedWeight: null,
      verdict: null,
    };
  }

  const change = rows.reduce((sum, row) => sum + row.ratePerWeek * row.weeks, 0);
  const projectedWeight = roundTo(currentWeight + change, 1);

  // `goalState` needs `start` to know the direction of travel; without a goal
  // it returns null, which is the honest answer — there is nothing to be on
  // track for.
  const state = goalState({
    start: currentWeight,
    current: projectedWeight,
    goal: goalWeight ?? null,
  });

  let verdict: PlanVerdict | null = null;
  if (state?.state === "reached") verdict = { kind: "reached" };
  else if (state?.state === "beyond") verdict = { kind: "past", amount: state.amount };
  else if (state?.state === "gap") verdict = { kind: "short", amount: state.amount };

  return {
    totalWeeks,
    startsOn: chained[0].startsOn,
    endsOn: chained[chained.length - 1].endsOn,
    projectedWeight,
    verdict,
  };
}

// ---------------------------------------------------------------------------
// The deadline <-> rate widget (kg-internal)
// ---------------------------------------------------------------------------

/** Deadline → the weekly rate it implies, in DISPLAY units. */
export function rateForDeadline(input: {
  currentWeight?: number;
  goalWeight?: number;
  deadline: string;
  today: string;
  startDate?: string | null;
  unit: WeightUnit;
}): number | null {
  const { currentWeight, goalWeight, deadline, today, startDate, unit } = input;
  if (currentWeight == null || goalWeight == null || !deadline) return null;

  const derived = deriveRateFromTarget({
    currentWeightKg: weightToKg(currentWeight, unit),
    goalWeightKg: weightToKg(goalWeight, unit),
    deadline,
    today,
    startDate,
  });
  if (!derived) return null;

  return roundTo(weightFromKg(derived.rateKgPerWeek, unit), RATE_DP);
}

/** A weekly rate in DISPLAY units → the deadline it lands on. */
export function deadlineForRate(input: {
  currentWeight?: number;
  goalWeight?: number;
  ratePerWeek: number;
  today: string;
  startDate?: string | null;
  unit: WeightUnit;
}): string | null {
  const { currentWeight, goalWeight, ratePerWeek, today, startDate, unit } = input;
  if (currentWeight == null || goalWeight == null) return null;

  const derived = deriveDeadlineFromRate({
    currentWeightKg: weightToKg(currentWeight, unit),
    goalWeightKg: weightToKg(goalWeight, unit),
    rateKgPerWeek: weightToKg(ratePerWeek, unit),
    today,
    startDate,
  });
  return derived?.deadline ?? null;
}

// ---------------------------------------------------------------------------
// What to write
// ---------------------------------------------------------------------------

export type GoalWriteBody = {
  goalWeight: number;
  goalBodyFatPercentage: number | null;
  goalDeadline: string | null;
  goalStartDate: string | null;
};

export type PhasesWriteBody = {
  startDate: string;
  phases: Array<{ id?: string; name: string; weeks: number; ratePerWeekKg: number }>;
};

export type GoalPlanWrites = {
  goal?: GoalWriteBody;
  phases?: PhasesWriteBody;
};

/**
 * A row's rate in kg — the STORED value verbatim when the coach has not touched
 * the field, rather than a re-conversion of the 2dp number on screen.
 *
 * **kg → 2dp display → kg is LOSSY**, so re-converting an untouched rate sends a
 * numeric edit the coach never made. `buildWrites` emits the WHOLE chain on any
 * change, so one rename would send a drifted rate for every row, and downstream:
 *
 *   - `carryDailyTargets` (`client-phases-service.ts:117`) compares rates with
 *     `===`, so every block's `daily_targets` grid is nulled;
 *   - `computePhasesFingerprint` hashes the rate, so the plan reads "Nutrition is
 *     out of date" — contradicting `phase-fingerprint.ts`'s own docstring
 *     ("`name` is deliberately NOT an input") and `ARCHITECTURE.md`'s "a grid
 *     survives a rename and nothing else";
 *   - with the grids nulled, task 2.5's per-date resolver has nothing to resolve
 *     to and every in-block date falls back to the plan grid.
 *
 * The loss has two independent causes, so this is not an lbs-only concern:
 * `weightToKg`'s 2.205 divisor, AND `roundTo`'s 2dp truncation, which runs in the
 * kg branch too (a stored −0.625 shows as −0.62). Raising `RATE_DP` narrows the
 * gap and never closes it.
 *
 * The comparison is on the parsed NUMBER, not the raw string: `parseNumber`
 * trims, so `" -1.32 "` and `"-1.320"` are the same rate but different strings,
 * and treating those as edits would reintroduce the bug on a no-op keystroke. Any
 * genuine change at 2dp display precision yields a different number, so nothing
 * is missed.
 */
function rateToKg(
  input: BlockRowInput,
  parsedRate: number,
  storedById: Map<string, ClientPhase>,
  unit: WeightUnit
): number {
  const existing = input.id ? storedById.get(input.id) : undefined;
  if (existing && parsedRate === seededDisplayRate(existing, unit)) {
    return existing.ratePerWeekKg;
  }
  return weightToKg(parsedRate, unit);
}

/**
 * Form rows → the phases PUT's payload, converting each rate INTO kg once.
 *
 * `stored` is REQUIRED rather than defaulted: it is what lets an untouched rate
 * resend its exact stored kg (see {@link rateToKg}), and a default would let a
 * future call site silently take the lossy path. Pass `[]` when there is
 * genuinely nothing stored to match against.
 */
export function toPhasesBody(
  startDate: string,
  rows: BlockRowInput[],
  unit: WeightUnit,
  stored: ClientPhase[]
): PhasesWriteBody {
  const storedById = new Map(stored.map((phase) => [phase.id, phase]));

  // parseBlockRows is a 1:1 map over `rows`, so index i is the same row in both.
  return {
    startDate,
    phases: parseBlockRows(rows).map((row, i) => ({
      ...(row.id ? { id: row.id } : {}),
      name: row.name.trim(),
      weeks: row.weeks,
      ratePerWeekKg: rateToKg(rows[i], row.ratePerWeek, storedById, unit),
    })),
  };
}

/**
 * Which of the two independent writes actually need to happen (invariant 7).
 *
 * **The blocks are diffed as PAYLOADS, not as raw values.** The stored rate is
 * kg, the form's is a rounded display number, and comparing across that boundary
 * would report a change on every open. Rendering the stored chain back through
 * the same seed→payload path makes an untouched form produce a byte-identical
 * body, so "nothing changed" is exact rather than approximate.
 *
 * **The goal is diffed against the STORED record, not the form's defaults.**
 * That is what makes a partial failure self-heal: if the goals PUT failed after
 * the phases PUT succeeded, the next open seeds `startDate` from the blocks, the
 * diff still sees the goal as outstanding, and the next save retries it.
 */
export function buildWrites(input: {
  goal: ClientGoal | null;
  phases: ClientPhase[];
  values: GoalPlanFormValues;
  unit: WeightUnit;
  conforming: boolean;
}): GoalPlanWrites {
  const { goal, phases, values, unit, conforming } = input;
  const writes: GoalPlanWrites = {};

  const goalWeight = parseNumber(values.goalWeight);
  if (goalWeight != null) {
    const bodyFat = parseNumber(values.goalBodyFat) ?? null;
    const deadline = values.deadline || null;
    const startDate = values.startDate || null;

    const changed =
      goalWeight !== (goal?.goalWeight ?? null) ||
      bodyFat !== (goal?.goalBodyFatPercentage ?? null) ||
      deadline !== (goal?.goalDeadline ?? null) ||
      startDate !== (goal?.goalStartDate ?? null);

    if (changed) {
      writes.goal = {
        goalWeight,
        goalBodyFatPercentage: bodyFat,
        goalDeadline: deadline,
        goalStartDate: startDate,
      };
    }
  }

  // A refused chain is never written back — the panel showed stored dates it
  // cannot faithfully reproduce from lengths.
  if (!conforming) return writes;

  // Nothing to say when the client has no blocks and the coach added none.
  if (phases.length === 0 && values.blocks.length === 0) return writes;

  const next = toPhasesBody(values.startDate, values.blocks, unit, phases);
  const current = toPhasesBody(
    phases.length > 0 ? phases[0].startsOn : values.startDate,
    seedBlockRows(phases, unit),
    unit,
    phases
  );

  if (JSON.stringify(next) !== JSON.stringify(current)) writes.phases = next;
  return writes;
}
