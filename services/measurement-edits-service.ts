import { supabaseAdmin } from "./supabase-admin";
import { recalculateClientEnergy } from "./client-energy-service";
import {
  appendCorrection,
  getMeasurementReading,
  type MeasurementLogReading,
} from "./measurements-service";
import {
  MeasurementNotFoundError,
  MeasurementStateError,
  MeasurementValueError,
  fromRpcMessage,
} from "@/lib/measurements/edit-errors";
import { isMeasurementKey, type MeasurementKey } from "@/lib/measurements/keys";
import { METRIC_VALUE_RANGES } from "@/lib/metrics/metric-entry-definitions";
import type { MeasurementReading } from "@/lib/measurements/day-values";

/**
 * The three row actions of the measurement log (docs/MEASUREMENT-LOG-PLAN.md
 * D9): a reading is CORRECTED, REMOVED or RESTORED — never deleted.
 *
 *  - Correct: a wrong VALUE. A new row carrying the original's metric, day
 *    and stamp (`appendCorrection` — an INSERT, the table's only write path),
 *    so the day's value, a stamped check-in's report and every "now" surface
 *    read the corrected number while the wrong one stays in the history.
 *  - Remove: a reading that should never have existed. A void mark through
 *    `void_measurement` (migration 160), the one UPDATE the table sees; the
 *    row leaves every calculation and every client surface at once through
 *    the live view, and stays in the coach's list, muted.
 *  - Restore: the mark cleared through `restore_measurement`.
 *
 * Scope belts: every read here is scoped by `client_id`, and the RPCs refuse
 * a row outside `p_client_id` in SQL — the route proves the coach owns the
 * CLIENT and cannot prove the row does. The RPCs answer with message
 * prefixes that `fromRpcMessage` maps to the typed errors the routes speak.
 *
 * Energy: removing or restoring the client's newest weight or body fat
 * recomputes the pair, on the RPC's word — the same trigger appending a
 * newest reading fires.
 */

type EnergyOutcome = "recomputed" | "not_newest";

type EditActor = {
  clientId: string;
  measurementId: string;
  /** `coaches.id` — the audit actor. */
  actor: string;
};

type MeasurementEditResult = {
  id: string;
  metricKey: MeasurementKey;
  /** The check-in stamp, when the reading carries one. */
  sourceId: string | null;
  energy: EnergyOutcome;
};

type CorrectMeasurementResult = MeasurementEditResult & {
  /** The row now standing for the reading. */
  reading: MeasurementReading;
  /** False when the value equalled what already stood — nothing was written. */
  inserted: boolean;
};

async function readOwn(clientId: string, measurementId: string): Promise<MeasurementLogReading> {
  const reading = await getMeasurementReading(clientId, measurementId);
  if (!reading) throw new MeasurementNotFoundError();
  return reading;
}

function assertWithinBounds(metricKey: MeasurementKey, value: number): void {
  const range = METRIC_VALUE_RANGES[metricKey];
  if (value < range.min || value > range.max) {
    throw new MeasurementValueError(
      `${metricKey} must be between ${range.min} and ${range.max}`
    );
  }
}

export async function correctMeasurement(
  input: EditActor & { value: number }
): Promise<CorrectMeasurementResult> {
  const original = await readOwn(input.clientId, input.measurementId);
  if (original.voided) {
    throw new MeasurementStateError("Restore the reading before correcting it.");
  }
  assertWithinBounds(original.metricKey, input.value);

  const result = await appendCorrection({
    clientId: input.clientId,
    original,
    value: input.value,
    actor: input.actor,
  });
  return {
    id: result.reading.id,
    metricKey: original.metricKey,
    sourceId: original.sourceId,
    energy: result.energy,
    reading: result.reading,
    inserted: result.inserted,
  };
}

type RpcRow = { metric: string; affects_current: boolean };

async function settle(
  clientId: string,
  measurementId: string,
  sourceId: string | null,
  rows: RpcRow[] | null,
  rpc: string
): Promise<MeasurementEditResult> {
  const row = rows?.[0];
  if (!row || !isMeasurementKey(row.metric)) {
    throw new Error(`${rpc} returned no row`);
  }
  let energy: EnergyOutcome = "not_newest";
  if (row.affects_current && (row.metric === "weight" || row.metric === "bodyFat")) {
    await recalculateClientEnergy(clientId);
    energy = "recomputed";
  }
  return { id: measurementId, metricKey: row.metric, sourceId, energy };
}

function rethrowRpc(rpc: string, error: { message: string }): never {
  const refusal = fromRpcMessage(error.message);
  if (refusal) throw refusal;
  console.error(`${rpc} failed:`, error);
  throw new Error(`Failed to update the reading: ${error.message}`);
}

export async function voidMeasurement(
  input: EditActor & { reason?: string | null }
): Promise<MeasurementEditResult> {
  // The stamp rides back for the caller's invalidation; the RPC is the belt
  // for existence and scope, and this read never replaces it.
  const reading = await readOwn(input.clientId, input.measurementId);

  const reason = input.reason?.trim();
  const { data, error } = await supabaseAdmin.rpc("void_measurement", {
    p_id: input.measurementId,
    p_client_id: input.clientId,
    p_actor: input.actor,
    // Omitted, never null: the parameter has a SQL default (CONVENTIONS §8).
    ...(reason ? { p_reason: reason } : {}),
  });
  if (error) rethrowRpc("void_measurement", error);
  return settle(input.clientId, input.measurementId, reading.sourceId, data, "void_measurement");
}

export async function restoreMeasurement(
  input: Omit<EditActor, "actor">
): Promise<MeasurementEditResult> {
  const reading = await readOwn(input.clientId, input.measurementId);

  const { data, error } = await supabaseAdmin.rpc("restore_measurement", {
    p_id: input.measurementId,
    p_client_id: input.clientId,
  });
  if (error) rethrowRpc("restore_measurement", error);
  return settle(input.clientId, input.measurementId, reading.sourceId, data, "restore_measurement");
}
