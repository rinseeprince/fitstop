import { supabaseAdmin } from "./supabase-admin";
import { recalculateClientEnergy } from "./client-energy-service";
import { getMeasurementReading, type MeasurementLogReading } from "./measurements-service";
import {
  MeasurementNotFoundError,
  MeasurementStateError,
  MeasurementValueError,
  fromRpcMessage,
} from "@/lib/measurements/edit-errors";
import { isMeasurementKey, type MeasurementKey } from "@/lib/measurements/keys";
import { METRIC_VALUE_RANGES } from "@/lib/metrics/metric-entry-definitions";

/**
 * The three row actions of the measurement log (docs/MEASUREMENT-LOG-PLAN.md
 * commit 8, D9 and D23): a reading is EDITED in place, REMOVED or RESTORED —
 * never deleted, and never duplicated by an edit.
 *
 *  - Edit: a wrong VALUE. `update_measurement` (migration 161) changes the
 *    row's value and stamps `updated_at`, keeping its id, day, source,
 *    check-in stamp and place in the day (`recorded_at` decides, `updated_at`
 *    records), so a stamped check-in's report follows it, and the day's
 *    value and every "now" surface follow it when it is the reading written
 *    last. An unchanged value writes nothing and says so, and the route
 *    audits nothing.
 *  - Remove: a reading that should never have existed. A void mark through
 *    `void_measurement` (migration 160); the row leaves every calculation and
 *    every client surface at once through the live view, and stays in the
 *    coach's list, muted.
 *  - Restore: the mark cleared through `restore_measurement`.
 *
 * The three RPCs are every UPDATE the table sees; the app role holds SELECT
 * and INSERT. Scope belts: every read here is scoped by `client_id`, and the
 * RPCs refuse a row outside `p_client_id` in SQL — the route proves the coach
 * owns the CLIENT and cannot prove the row does. The RPCs answer with message
 * prefixes that `fromRpcMessage` maps to the typed errors the routes speak.
 *
 * Energy: editing, removing or restoring the client's newest weight or body
 * fat recomputes the pair, on the RPC's word — the same trigger appending a
 * newest reading fires.
 */

type EnergyOutcome = "recomputed" | "not_newest";

type EditTarget = {
  clientId: string;
  measurementId: string;
};

type EditActor = EditTarget & {
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

type UpdateMeasurementResult = MeasurementEditResult & {
  /** YYYY-MM-DD, the reading's day — the audit row names it. */
  date: string;
  /** False when the value equalled what stood — nothing was written. */
  updated: boolean;
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

/** The RPC's one row, its metric typed — or the failure a missing row is. */
function rpcRow<T extends { metric: string }>(
  rows: T[] | null,
  rpc: string
): { row: T; metricKey: MeasurementKey } {
  const row = rows?.[0];
  if (!row || !isMeasurementKey(row.metric)) {
    throw new Error(`${rpc} returned no row`);
  }
  return { row, metricKey: row.metric };
}

/** The pair follows the newest weight or body fat; a girth feeds no formula. */
async function energyOn(
  clientId: string,
  metricKey: MeasurementKey,
  affectsCurrent: boolean
): Promise<EnergyOutcome> {
  if (!affectsCurrent || (metricKey !== "weight" && metricKey !== "bodyFat")) {
    return "not_newest";
  }
  await recalculateClientEnergy(clientId);
  return "recomputed";
}

function rethrowRpc(rpc: string, error: { message: string }): never {
  const refusal = fromRpcMessage(error.message);
  if (refusal) throw refusal;
  console.error(`${rpc} failed:`, error);
  throw new Error(`Failed to update the reading: ${error.message}`);
}

export async function updateMeasurement(
  input: EditTarget & { value: number }
): Promise<UpdateMeasurementResult> {
  // The row's metric decides the bounds, and its stamp rides back for the
  // caller's invalidation; the RPC is the belt for existence, scope and
  // state, and this read never replaces it.
  const original = await readOwn(input.clientId, input.measurementId);
  if (original.voided) {
    throw new MeasurementStateError("Restore the reading before editing it.");
  }
  assertWithinBounds(original.metricKey, input.value);

  const { data, error } = await supabaseAdmin.rpc("update_measurement", {
    p_id: input.measurementId,
    p_client_id: input.clientId,
    p_value: input.value,
  });
  if (error) rethrowRpc("update_measurement", error);
  const { row, metricKey } = rpcRow(data, "update_measurement");
  // An unchanged value wrote nothing: the day's value did not move, so
  // neither does the pair.
  const energy = row.changed ? await energyOn(input.clientId, metricKey, row.affects_current) : "not_newest";
  return {
    id: input.measurementId,
    metricKey,
    sourceId: original.sourceId,
    date: original.date,
    updated: row.changed,
    energy,
  };
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
  const { row, metricKey } = rpcRow(data, "void_measurement");
  const energy = await energyOn(input.clientId, metricKey, row.affects_current);
  return { id: input.measurementId, metricKey, sourceId: reading.sourceId, energy };
}

export async function restoreMeasurement(input: EditTarget): Promise<MeasurementEditResult> {
  const reading = await readOwn(input.clientId, input.measurementId);

  const { data, error } = await supabaseAdmin.rpc("restore_measurement", {
    p_id: input.measurementId,
    p_client_id: input.clientId,
  });
  if (error) rethrowRpc("restore_measurement", error);
  const { row, metricKey } = rpcRow(data, "restore_measurement");
  const energy = await energyOn(input.clientId, metricKey, row.affects_current);
  return { id: input.measurementId, metricKey, sourceId: reading.sourceId, energy };
}
