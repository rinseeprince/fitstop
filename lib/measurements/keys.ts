/**
 * The seven body measurements and the four places a reading can come from —
 * in lockstep with the two CHECK constraints in migration 158. Adding a key
 * means editing both; a wearable later widens the CHECK and this list together.
 *
 * Isomorphic: the zod schemas, the measurements service and the coach Journey
 * all read it, and it must never import a server module.
 */
export const MEASUREMENT_KEYS = [
  "weight",
  "bodyFat",
  "waist",
  "hips",
  "chest",
  "arms",
  "thighs",
] as const;

export type MeasurementKey = (typeof MEASUREMENT_KEYS)[number];

export const MEASUREMENT_SOURCES = [
  "check_in",
  "coach_entry",
  "client_log",
  "intake",
] as const;

export type MeasurementSource = (typeof MEASUREMENT_SOURCES)[number];

export function isMeasurementKey(key: string): key is MeasurementKey {
  return (MEASUREMENT_KEYS as readonly string[]).includes(key);
}

/** A bag of readings by key — what a check-in reported, or what a writer appends. */
export type MeasurementValues = Partial<Record<MeasurementKey, number>>;
