/**
 * The five wellness metrics — the one home of the list, in lockstep with the
 * five columns of `wellness_logs`, the client's own daily log and wellness's
 * source of truth. The day-value kernel beside it walks this list to turn a
 * day's row into readings, and the coach's Log-measurement dialog spreads it
 * into its key list (until commit 8 of docs/MEASUREMENT-LOG-PLAN.md takes the
 * wellness keys out of the dialog). Adding a metric means adding the column
 * and this entry together.
 *
 * Isomorphic, like `lib/measurements/keys.ts`: the services and the coach
 * Journey both read it, and it must never import a server module.
 */
export const WELLNESS_KEYS = ["mood", "energy", "sleep", "stress", "soreness"] as const;

export type WellnessKey = (typeof WELLNESS_KEYS)[number];
