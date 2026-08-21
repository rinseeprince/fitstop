import { computeEnergyPair } from "@/services/client-energy-calc";
import type { Client } from "@/types/check-in";

/**
 * Is this client's profile complete enough for the nutrition calculator?
 *
 * "Do BMR and TDEE exist?" is the WRONG question and this module exists
 * because of it. `computeEnergyPair` hard-gates on weight, height and gender —
 * but it SILENTLY DEFAULTS the other two inputs, substituting
 * `DEFAULT_BMR_AGE_YEARS` for a missing birth date and
 * `DEFAULT_WORK_ACTIVITY_LEVEL` for a missing activity level. So a client with
 * neither still gets a BMR and a TDEE, and a `tdee != null` check would report
 * that client ready while the number the entire calculator solves against
 * rests on two guesses.
 *
 * The computation reports what it assumed (`ageSource`, `activityLevelSource`),
 * so this is an exact read of the calculator's own answer rather than a
 * re-derivation that could drift from it.
 */

/** One thing still to fill in, worded for a coach. */
export type ProfileGap =
  | "weight"
  | "height"
  | "gender"
  | "age"
  | "activity level";

/** Only the fields the energy pair is computed from, so a caller does not need
 *  a whole `Client` and the dependency stays honest about what it reads. */
export type ProfileEnergyFields = Pick<
  Client,
  | "currentWeight"
  | "height"
  | "gender"
  | "currentBodyFatPercentage"
  | "dateOfBirth"
  | "workActivityLevel"
  | "tdeeManualOverride"
>;

export function findProfileGaps(client: ProfileEnergyFields): ProfileGap[] {
  const energy = computeEnergyPair({
    weightKg: client.currentWeight,
    heightCm: client.height,
    gender: client.gender,
    bodyFatPercentage: client.currentBodyFatPercentage,
    dateOfBirth: client.dateOfBirth,
    activityLevel: client.workActivityLevel,
  });

  // A hard-missing input means there is no pair at all — nothing downstream has
  // a TDEE to solve against. Report only those: the assumed-input clauses below
  // read metadata this branch does not carry, and "add weight" is the ask
  // anyway.
  if (energy.status === "insufficient") return [...energy.missing];

  const gaps: ProfileGap[] = [];

  // Age is reported only where it CHANGES the answer. Katch-McArdle works off
  // lean body mass and has no age term, so `ageSource` comes back
  // `"not_required"` when body fat is known and a missing birth date costs
  // nothing — the same rule the profile form's birth-date nudge already
  // applies, kept in step with it deliberately.
  if (energy.ageSource === "assumed_default") gaps.push("age");

  // Activity level feeds the TDEE multiplier and nothing else, so a coach who
  // typed a custom TDEE has already overridden the only thing it touches.
  // Without this a deliberate override would nag forever.
  if (
    energy.activityLevelSource === "default" &&
    client.tdeeManualOverride !== true
  ) {
    gaps.push("activity level");
  }

  return gaps;
}

/**
 * Weight is a logged MEASUREMENT, not a profile field — the Overview's profile
 * editor holds gender, birth date, height and activity level, and nothing
 * else. So the two gaps have two different homes, and a caller offering "fix
 * this" has to send the coach to the right one.
 */
export function gapsNeedMeasurement(gaps: ProfileGap[]): boolean {
  return gaps.includes("weight");
}
