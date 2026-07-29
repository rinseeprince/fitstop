import { createHash } from "crypto";

/**
 * The blocks staleness fingerprint stored on `nutrition_plans.phases_fingerprint`
 * (migration 138).
 *
 * It answers one question: are the blocks the coach has now the same blocks that
 * produced the numbers currently on the client's calendar? Stale is simply
 * `computePhasesFingerprint(live) !== plan.phases_fingerprint`.
 *
 * SERVER-ONLY, and deliberately not in `lib/goals/` beside `goal-rate.ts`. Node's
 * `createHash` does not exist in a browser bundle, `next.config.mjs` declares no
 * `resolve.fallback`, and the Web Crypto equivalent (`crypto.subtle.digest`) is
 * ASYNC and has no base64url digest — so a browser copy could not share this code
 * and would risk drifting from it. Nothing needs one: the amendment drift token is
 * produced AND compared server-side (plan-amendment-service.ts:362, :450) with the
 * browser only carrying the opaque string, and the coach UI needs a boolean, not a
 * hash. Keep this module out of any "use client" import graph.
 *
 * Inputs and canonicalization follow `computeAmendmentToken` so the two cannot
 * drift in style: sha256 over `JSON.stringify` of fixed positional tuples,
 * base64url-encoded.
 */

export type PhaseFingerprintInput = {
  startsOn: string;
  endsOn: string;
  ratePerWeekKg: number;
};

/**
 * Returns null for an empty block list — NOT the hash of an empty array.
 *
 * NULL is the stored value meaning "no block set drove this generation", and it
 * has to cover pre-migration-138 plans, block-less clients and custom-macros
 * saves identically. If an empty list hashed to a sentinel string instead, every
 * existing plan (stored NULL) would compare unequal and render a spurious
 * "Nutrition is out of date" row on the day the coach UI ships.
 *
 * `name` is deliberately NOT an input: renaming a block changes nothing numeric,
 * so it must not mark the plan stale.
 */
export function computePhasesFingerprint(
  phases: PhaseFingerprintInput[]
): string | null {
  if (phases.length === 0) return null;

  const tuples = [...phases]
    .map((p) => [p.startsOn, p.endsOn, Number(p.ratePerWeekKg)] as const)
    // Ordered by starts_on, the same single ordering source the schema uses (no
    // `position` column exists, precisely so two orderings cannot disagree).
    // Plain string comparison, not localeCompare: these are ISO dates, so
    // lexicographic order IS chronological order, and it cannot vary by locale.
    // `endsOn` is a deterministic tie-break; the chain makes ties unreachable.
    .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1));

  return createHash("sha256").update(JSON.stringify({ tuples })).digest("base64url");
}
