import type { ActivityLevel } from "@/types/check-in";
import { getActivityMultiplier } from "@/utils/nutrition-helpers";
import {
  DEFAULT_BMR_AGE_YEARS,
  DEFAULT_WORK_ACTIVITY_LEVEL,
} from "@/lib/constants";

/**
 * The client's metabolic identity, computed. PURE — no database, no clock of its
 * own, no imports that reach `supabaseAdmin`.
 *
 * Kept in its own module rather than beside `recalculateClientEnergy` because
 * `scripts/check-service-key-leak.ts` walks value imports upward from
 * `services/supabase-admin.ts` and fails on any reachable `"use client"` module.
 * The browser needs this calculator (the settings dialog previews "auto would be
 * 2,850" live) and so do the seed scripts, which are deliberately DB-free. Same
 * split, same reason, as `services/nutrition-service.ts` being importable from
 * `hooks/use-nutrition-builder.ts`.
 *
 * BMR and TDEE are computed together, always. They are one fact about a person,
 * and every historical bug in this area came from writing one without the other.
 */

export type EnergyInputField = "weight" | "height" | "gender";

export type EnergyInputs = {
  /** KILOGRAMS, canonical (CONVENTIONS §20). */
  weightKg: number | null | undefined;
  /** CENTIMETRES, canonical. */
  heightCm: number | null | undefined;
  /** Raw `clients.gender`, which is `string | null`. Narrowed here rather than
   *  cast: `lib/mappers.ts` casts it, so nothing upstream guarantees the union
   *  and an unrecognized value would otherwise fall silently into Mifflin's
   *  "other" branch. */
  gender: string | null | undefined;
  /** > 0 selects Katch-McArdle; 0/null/undefined selects Mifflin-St Jeor. */
  bodyFatPercentage?: number | null;
  /** YYYY-MM-DD. Null means the age default is assumed, reported via `ageSource`. */
  dateOfBirth?: string | null;
  /** Raw `clients.work_activity_level`. Null or unrecognized falls back to the
   *  named default. */
  activityLevel?: string | null;
  /** Injected clock. The seed scripts guarantee byte-identical output per
   *  `--seed` (`scripts/seed-scale.ts`), and age-from-birth-date is the only
   *  wall-clock read in here. */
  now?: Date;
};

export type EnergyComputationMeta = {
  method: "katch_mcardle" | "mifflin_st_jeor";
  activityLevel: ActivityLevel;
  activityLevelSource: "client" | "default";
  activityMultiplier: number;
  ageYears: number;
  /** `not_required` on the Katch path — lean-body-mass math has no age term. */
  ageSource: "date_of_birth" | "assumed_default" | "not_required";
};

export type EnergyComputation =
  | ({ status: "ready"; bmr: number; tdee: number } & EnergyComputationMeta)
  | { status: "insufficient"; missing: EnergyInputField[] };

const ACTIVITY_LEVELS: readonly ActivityLevel[] = [
  "sedentary",
  "lightly_active",
  "moderately_active",
  "very_active",
  "extremely_active",
];

/**
 * Normalize `clients.work_activity_level`, which is `string | null` in the
 * generated types. Mirrors `toUnitSystem` (`utils/unit-conversions.ts`): warn on
 * an unexpected value, return the named default.
 *
 * Not optional politeness — `getActivityMultiplier` does an unguarded `Record`
 * lookup, so a junk string yields `undefined` and `Math.round(bmr * undefined)`
 * writes NaN into a NUMERIC(6,1) column. The DB CHECK makes that unreachable
 * today; nothing in TypeScript does.
 */
export function toActivityLevel(value: string | null | undefined): {
  level: ActivityLevel;
  source: "client" | "default";
} {
  if (ACTIVITY_LEVELS.includes(value as ActivityLevel)) {
    return { level: value as ActivityLevel, source: "client" };
  }
  if (value != null) {
    console.warn(
      "[energy] Unexpected work_activity_level, defaulting:",
      value
    );
  }
  return { level: DEFAULT_WORK_ACTIVITY_LEVEL, source: "default" };
}

/** Katch-McArdle: 370 + (21.6 × lean body mass in kg). */
function calculateKatchMcArdle(weightKg: number, bodyFatPercentage: number): number {
  const leanBodyMass = weightKg * (1 - bodyFatPercentage / 100);
  return 370 + 21.6 * leanBodyMass;
}

/**
 * Mifflin-St Jeor: (10 × kg) + (6.25 × cm) − (5 × age), then +5 male / −161
 * female / −78 for "other" (the average of the two).
 */
function calculateMifflinStJeor(
  weightKg: number,
  heightCm: number,
  age: number,
  gender: "male" | "female" | "other"
): number {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  if (gender === "male") return base + 5;
  if (gender === "female") return base - 161;
  return base - 78;
}

/** Whole years from a YYYY-MM-DD birth date, measured against `now`. */
export function calculateAge(dateOfBirth: string, now: Date): number {
  const birthDate = new Date(dateOfBirth);
  let age = now.getFullYear() - birthDate.getFullYear();
  const monthDiff = now.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
}

function isKnownGender(value: string): value is "male" | "female" | "other" {
  return value === "male" || value === "female" || value === "other";
}

/**
 * Compute the BMR/TDEE pair from a client's measurements.
 *
 * Requires weight, height and gender — the same gate the previous
 * `updateClientBMR` applied, now enforced in exactly one place. An unrecognized
 * non-null gender counts as MISSING rather than falling into the "other"
 * branch, because that branch should be a coach's explicit choice.
 *
 * TDEE is derived from the ROUNDED BMR, not the raw one. Three reasons: the
 * stored pair stays reproducible from the stored BMR (a UI preview cannot differ
 * by ±1 from the column); it agrees exactly with `calculateTDEE`, which receives
 * an already-rounded `client.bmr`; and `clients.bmr`/`clients.tdee` are
 * NUMERIC(6,1) rather than integers, so an unrounded value would be silently
 * re-rounded by Postgres and the stored number would stop matching the computed
 * one.
 */
export function computeEnergyPair(inputs: EnergyInputs): EnergyComputation {
  const missing: EnergyInputField[] = [];
  if (!inputs.weightKg) missing.push("weight");
  if (!inputs.heightCm) missing.push("height");
  if (!inputs.gender || !isKnownGender(inputs.gender)) missing.push("gender");

  if (missing.length > 0) {
    return { status: "insufficient", missing };
  }

  const weightKg = inputs.weightKg as number;
  const heightCm = inputs.heightCm as number;
  const gender = inputs.gender as "male" | "female" | "other";

  const { level: activityLevel, source: activityLevelSource } = toActivityLevel(
    inputs.activityLevel
  );
  const activityMultiplier = getActivityMultiplier(activityLevel);

  const usesBodyFat =
    inputs.bodyFatPercentage != null && inputs.bodyFatPercentage > 0;

  let rawBmr: number;
  let method: EnergyComputationMeta["method"];
  let ageYears: number;
  let ageSource: EnergyComputationMeta["ageSource"];

  if (usesBodyFat) {
    rawBmr = calculateKatchMcArdle(weightKg, inputs.bodyFatPercentage as number);
    method = "katch_mcardle";
    ageYears = DEFAULT_BMR_AGE_YEARS;
    ageSource = "not_required";
  } else {
    const now = inputs.now ?? new Date();
    ageYears = inputs.dateOfBirth
      ? calculateAge(inputs.dateOfBirth, now)
      : DEFAULT_BMR_AGE_YEARS;
    ageSource = inputs.dateOfBirth ? "date_of_birth" : "assumed_default";
    rawBmr = calculateMifflinStJeor(weightKg, heightCm, ageYears, gender);
    method = "mifflin_st_jeor";
  }

  const bmr = Math.round(rawBmr);

  return {
    status: "ready",
    bmr,
    tdee: Math.round(bmr * activityMultiplier),
    method,
    activityLevel,
    activityLevelSource,
    activityMultiplier,
    ageYears,
    ageSource,
  };
}
