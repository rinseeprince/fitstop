import { supabaseAdmin } from "./supabase-admin";
import { captureApiError } from "@/lib/error-handler";
import { computeEnergyPair } from "./client-energy-calc";
import type {
  EnergyComputationMeta,
  EnergyInputField,
} from "./client-energy-calc";

// NEVER re-export computeEnergyPair as a value from here: this module imports
// supabaseAdmin, and scripts/check-service-key-leak.ts fails on any "use client"
// module reachable through value imports.

/**
 * THE single writer of UPDATES to `clients.bmr` / `clients.tdee`.
 *
 * Before this existed the pair had no owner: six sites wrote it, three wrote
 * only half of it, and two derived TDEE from a hardcoded ×1.2 or from the
 * PLAN's activity level rather than the client's. That is how a profile came to
 * state BMR 3712 beside TDEE 3515 — an arithmetically impossible metabolism.
 *
 * Invariants:
 *  - BMR and TDEE are never written separately. Every UPDATE carries both keys.
 *  - An override flag freezes exactly its own half; the other half keeps
 *    recomputing. A custom TDEE plus a moving weight moves BMR and pins TDEE.
 *  - Activity level is a CLIENT fact, read from `clients.work_activity_level`.
 *  - No plan row is touched. Plans snapshot the pair at generation and only a
 *    regeneration inherits new numbers.
 *
 * `createClient` sets the pair once, in its INSERT, through the same pure
 * calculator — see the note beside the repo guard in the test file. The
 * invariant is one writer for UPDATES; row birth is deliberately not in scope.
 */

type EnergyOverrideInstruction =
  | { action: "set"; value: number }
  | { action: "clear" };

export type ClientEnergyOverrides = {
  bmr?: EnergyOverrideInstruction;
  tdee?: EnergyOverrideInstruction;
};

type RecalculateClientEnergyOptions = {
  /** Tenant scoping as defence in depth (CONVENTIONS §2): when supplied the
   *  UPDATE also filters `coach_id`, so a forged id matches zero rows — and a
   *  zero-row match is detected rather than silently succeeding. */
  coachId?: string;
  /** From the metrics route. Absent means a plain recompute under stored flags. */
  overrides?: ClientEnergyOverrides;
  /** Injected clock, threaded to the calculator. */
  now?: Date;
};

type EnergyHalfDisposition =
  /** recomputed from the client's measurements */
  | "computed"
  /** override flag set: the stored value was written back unchanged */
  | "frozen"
  /** flag set but the stored value was NULL — nothing to freeze, so computed */
  | "backfilled"
  /** not frozen, inputs insufficient — stored value written back */
  | "carried";

type ClientEnergyStatus =
  | "written"
  | "noop_all_frozen"
  | "skipped_insufficient_data"
  | "skipped_client_not_found"
  /** An explicit override was physically impossible and nothing was written —
   *  see the guard in the writer. */
  | "rejected_invalid_override"
  | "failed";

type ClientEnergyResult = {
  status: ClientEnergyStatus;
  /** The pair as it stands in `clients` after this call: what was written on
   *  "written", the stored value otherwise, null when the row was unreadable.
   *  A caller reporting the pair back (the metrics PUT's response, the client
   *  `updateClient` returns) MUST use these rather than recomputing, or the
   *  response and the profile can disagree. */
  bmr: number | null;
  tdee: number | null;
  bmrManualOverride: boolean;
  tdeeManualOverride: boolean;
  bmrDisposition: EnergyHalfDisposition | null;
  tdeeDisposition: EnergyHalfDisposition | null;
  computation: EnergyComputationMeta | null;
  missing: EnergyInputField[];
  /** `clients.date_of_birth IS NULL` — for LOGGING. A UI nudge reads the row,
   *  because this is transient per-write state. */
  missingDateOfBirth: boolean;
  /** Set only on "rejected_invalid_override" — a coach-facing sentence. */
  rejection: string | null;
};

// The client's weight and body fat are their NEWEST readings in the measurement
// log, embedded from `client_current_measurements` in the same read as the
// profile facts — there is no column to read them from.
const ENERGY_COLUMNS =
  "height, gender, date_of_birth, work_activity_level, bmr, tdee, bmr_manual_override, tdee_manual_override, " +
  "client_current_measurements(metric_key, value)";

type CurrentReadingEmbed = { metric_key: string | null; value: number | null };

// Named because the embed defeats postgrest-js's select-string type parser.
type EnergyRow = {
  height: number | null;
  gender: string | null;
  date_of_birth: string | null;
  work_activity_level: string | null;
  bmr: number | null;
  tdee: number | null;
  bmr_manual_override: boolean | null;
  tdee_manual_override: boolean | null;
  client_current_measurements: CurrentReadingEmbed[] | null;
};

function currentReading(
  rows: CurrentReadingEmbed[] | null | undefined,
  metricKey: "weight" | "bodyFat"
): number | null {
  const row = rows?.find((candidate) => candidate.metric_key === metricKey);
  return row?.value == null ? null : Number(row.value);
}

function emptyResult(status: ClientEnergyStatus): ClientEnergyResult {
  return {
    status,
    bmr: null,
    tdee: null,
    bmrManualOverride: false,
    tdeeManualOverride: false,
    bmrDisposition: null,
    tdeeDisposition: null,
    computation: null,
    missing: [],
    missingDateOfBirth: false,
    rejection: null,
  };
}

/**
 * Recompute and store a client's BMR/TDEE pair.
 *
 * Never throws. Its callers — `appendMeasurements` after a newest reading
 * lands, `updateClient` after a profile input changes, the metrics PUT with an
 * override, the intake sync — have each committed their own write by the time
 * it runs, and a throw here would turn a committed save into a 500. Errors are
 * destructured, logged and sent to Sentry, and surface as `status: "failed"`
 * carrying the STORED pair.
 *
 * It reads the client row itself rather than accepting one, for two reasons:
 * importing `getClientById` from `client-service` would be an import cycle (that
 * module imports this one), and callers invoke this AFTER their own input write
 * commits, so any row they already hold is pre-write and stale.
 */
export async function recalculateClientEnergy(
  clientId: string,
  options?: RecalculateClientEnergyOptions
): Promise<ClientEnergyResult> {
  const { data: row, error: readError } = await supabaseAdmin
    .from("clients")
    .select(ENERGY_COLUMNS)
    .eq("id", clientId)
    .maybeSingle<EnergyRow>();

  if (readError) {
    console.error("Failed to read client for energy recalculation:", readError);
    captureApiError(readError, {
      action: "recalculate-client-energy.read",
      clientId,
    });
    return emptyResult("failed");
  }

  if (!row) {
    return emptyResult("skipped_client_not_found");
  }

  const storedBmr = row.bmr ?? null;
  const storedTdee = row.tdee ?? null;
  const storedBmrFrozen = row.bmr_manual_override === true;
  const storedTdeeFrozen = row.tdee_manual_override === true;
  const missingDateOfBirth = row.date_of_birth == null;

  const computation = computeEnergyPair({
    weightKg: currentReading(row.client_current_measurements, "weight"),
    heightCm: row.height,
    gender: row.gender,
    bodyFatPercentage: currentReading(row.client_current_measurements, "bodyFat"),
    dateOfBirth: row.date_of_birth,
    activityLevel: row.work_activity_level,
    now: options?.now,
  });

  const bmrInstruction = options?.overrides?.bmr;
  const tdeeInstruction = options?.overrides?.tdee;
  const hasInstruction = bmrInstruction != null || tdeeInstruction != null;

  // Flags after this write. An instruction is the only thing that changes one.
  const bmrFrozen =
    bmrInstruction?.action === "set"
      ? true
      : bmrInstruction?.action === "clear"
        ? false
        : storedBmrFrozen;
  const tdeeFrozen =
    tdeeInstruction?.action === "set"
      ? true
      : tdeeInstruction?.action === "clear"
        ? false
        : storedTdeeFrozen;

  // Both halves already pinned and nothing asks otherwise: writing would only
  // rewrite the same numbers.
  if (!hasInstruction && storedBmrFrozen && storedTdeeFrozen) {
    return {
      ...emptyResult("noop_all_frozen"),
      bmr: storedBmr,
      tdee: storedTdee,
      bmrManualOverride: true,
      tdeeManualOverride: true,
      missingDateOfBirth,
    };
  }

  // Nothing to compute and nothing asserted: never write half a pair, and never
  // null out values that are already stored.
  if (computation.status === "insufficient" && !hasInstruction) {
    return {
      ...emptyResult("skipped_insufficient_data"),
      bmr: storedBmr,
      tdee: storedTdee,
      bmrManualOverride: storedBmrFrozen,
      tdeeManualOverride: storedTdeeFrozen,
      missing: computation.missing,
      missingDateOfBirth,
    };
  }

  const computed = computation.status === "ready" ? computation : null;

  // BMR resolves first: TDEE is a function of it, so a custom BMR must be the
  // basis of the same write's TDEE.
  let nextBmr: number | null;
  let bmrDisposition: EnergyHalfDisposition;
  if (bmrInstruction?.action === "set") {
    nextBmr = bmrInstruction.value;
    bmrDisposition = "frozen";
  } else if (bmrFrozen && storedBmr != null) {
    nextBmr = storedBmr;
    bmrDisposition = "frozen";
  } else if (computed) {
    // Covers the vacuous freeze: a flag set over a NULL value is not a freeze,
    // there is nothing to freeze. Recompute it and leave the flag alone, so a
    // stray boolean cannot permanently block validateClientForNutrition.
    nextBmr = computed.bmr;
    bmrDisposition = bmrFrozen ? "backfilled" : "computed";
  } else {
    nextBmr = storedBmr;
    bmrDisposition = "carried";
  }

  let nextTdee: number | null;
  let tdeeDisposition: EnergyHalfDisposition;
  if (tdeeInstruction?.action === "set") {
    nextTdee = tdeeInstruction.value;
    tdeeDisposition = "frozen";
  } else if (tdeeFrozen && storedTdee != null) {
    nextTdee = storedTdee;
    tdeeDisposition = "frozen";
  } else if (computed && nextBmr != null) {
    // From the EFFECTIVE bmr for this write, not the computed one — a custom
    // BMR of 2000 must yield 2000 × multiplier.
    nextTdee = Math.round(nextBmr * computed.activityMultiplier);
    tdeeDisposition = tdeeFrozen ? "backfilled" : "computed";
  } else {
    nextTdee = storedTdee;
    tdeeDisposition = "carried";
  }

  // TDEE is BMR x a multiplier that is never below 1.2, so a TDEE under the
  // BMR is not a preference — it is arithmetically impossible, and every macro
  // downstream would be solved against it. Rejected rather than clamped: a
  // coach who typed 1,500 meant 1,500, and silently storing something else is
  // how the numbers stopped being explicable in the first place.
  if (
    tdeeInstruction?.action === "set" &&
    nextTdee != null &&
    nextBmr != null &&
    nextTdee < nextBmr
  ) {
    return {
      ...emptyResult("rejected_invalid_override"),
      bmr: storedBmr,
      tdee: storedTdee,
      bmrManualOverride: storedBmrFrozen,
      tdeeManualOverride: storedTdeeFrozen,
      missingDateOfBirth,
      rejection: `TDEE cannot be lower than BMR (${nextBmr} cal/day).`,
    };
  }

  // The mirror case: a custom BMR above the TDEE it would sit under.
  if (
    bmrInstruction?.action === "set" &&
    nextTdee != null &&
    nextBmr != null &&
    nextBmr > nextTdee
  ) {
    return {
      ...emptyResult("rejected_invalid_override"),
      bmr: storedBmr,
      tdee: storedTdee,
      bmrManualOverride: storedBmrFrozen,
      tdeeManualOverride: storedTdeeFrozen,
      missingDateOfBirth,
      rejection: `BMR cannot be higher than TDEE (${nextTdee} cal/day).`,
    };
  }

  // Always both keys. A flag key appears only when an instruction asked for it,
  // so a plain recompute cannot clobber a concurrently-set flag.
  // `updated_at` is not written: clients carries a BEFORE UPDATE trigger.
  const payload: Record<string, unknown> = { bmr: nextBmr, tdee: nextTdee };
  if (bmrInstruction) payload.bmr_manual_override = bmrFrozen;
  if (tdeeInstruction) payload.tdee_manual_override = tdeeFrozen;

  let update = supabaseAdmin.from("clients").update(payload).eq("id", clientId);
  if (options?.coachId) {
    update = update.eq("coach_id", options.coachId);
  }

  const { data: written, error: writeError } = await update
    .select("bmr, tdee")
    .maybeSingle();

  if (writeError) {
    console.error("Failed to write client energy:", writeError);
    captureApiError(writeError, {
      action: "recalculate-client-energy.write",
      clientId,
    });
    return {
      ...emptyResult("failed"),
      bmr: storedBmr,
      tdee: storedTdee,
      bmrManualOverride: storedBmrFrozen,
      tdeeManualOverride: storedTdeeFrozen,
      missingDateOfBirth,
    };
  }

  if (!written) {
    // Zero rows matched — a wrong clientId, or a coachId that does not own it.
    // Loud rather than a silent success.
    console.error("Client energy update matched no rows:", { clientId });
    return {
      ...emptyResult("failed"),
      bmr: storedBmr,
      tdee: storedTdee,
      bmrManualOverride: storedBmrFrozen,
      tdeeManualOverride: storedTdeeFrozen,
      missingDateOfBirth,
    };
  }

  return {
    status: "written",
    bmr: nextBmr,
    tdee: nextTdee,
    bmrManualOverride: bmrFrozen,
    tdeeManualOverride: tdeeFrozen,
    bmrDisposition,
    tdeeDisposition,
    rejection: null,
    computation: computed
      ? {
          method: computed.method,
          activityLevel: computed.activityLevel,
          activityLevelSource: computed.activityLevelSource,
          activityMultiplier: computed.activityMultiplier,
          ageYears: computed.ageYears,
          ageSource: computed.ageSource,
        }
      : null,
    missing: computation.status === "insufficient" ? computation.missing : [],
    missingDateOfBirth,
  };
}
