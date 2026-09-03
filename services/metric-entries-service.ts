import { supabaseAdmin } from "./supabase-admin";
import { appendMeasurements } from "./measurements-service";
import { fetchAllPages } from "@/lib/paged-fetch";
import { isMeasurementKey, type MeasurementKey } from "@/lib/measurements/keys";
import type { MetricEntry, MetricEntryRow } from "@/types/metric-entries";
import type { MetricEntryKey } from "@/lib/metrics/metric-entry-definitions";

type UpsertMetricEntryInput = {
  metricKey: MetricEntryKey;
  /** Canonical: kilograms, centimetres, percent or a unitless score. The
   *  Log-measurement dialog converts from the viewer's unit before sending
   *  (CONVENTIONS §20); nothing here converts again. */
  value: number;
  /** YYYY-MM-DD; route-validated and bounded to the coach's today */
  entryDate: string;
  note?: string;
  /** Caller-verified; written to the nullable `created_by`. Optional because
   *  not every writer has a coach in hand — a data backfill has none. */
  coachId?: string;
};

function mapMetricEntryRow(row: MetricEntryRow): MetricEntry {
  return {
    id: row.id,
    clientId: row.client_id,
    metricKey: row.metric_key as MetricEntryKey,
    value: row.value,
    entryDate: row.entry_date,
    note: row.note ?? undefined,
    createdBy: row.created_by ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * A coach's Log-measurement entry. Two stores, by what the key is:
 *
 *  - the seven PHYSIQUE keys append to the measurement log
 *    (services/measurements-service.ts — rule 3 skips a value equal to the
 *    day's standing coach entry, the energy pair recomputes when the row is
 *    the client's newest);
 *  - the five WELLNESS keys keep their replace-per-day row on
 *    client_metric_entries (owner decision D2: wellness has its own model).
 *
 * One response shape for both, so the Journey's caller does not care which.
 */
export const upsertMetricEntry = async (
  clientId: string,
  input: UpsertMetricEntryInput
): Promise<MetricEntry> => {
  if (isMeasurementKey(input.metricKey)) {
    return appendPhysiqueEntry(clientId, input, input.metricKey);
  }

  // created_at is intentionally absent from the payload: the insert default
  // applies and a conflict-update (same-date replace) never touches it.
  const { data, error } = await supabaseAdmin
    .from("client_metric_entries")
    .upsert(
      {
        client_id: clientId,
        metric_key: input.metricKey,
        value: input.value,
        entry_date: input.entryDate,
        note: input.note ?? null,
        created_by: input.coachId ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "client_id,metric_key,entry_date" }
    )
    .select()
    .single();

  if (error) {
    console.error("Failed to upsert metric entry:", error);
    throw new Error(`Failed to save measurement: ${error.message}`);
  }

  return mapMetricEntryRow(data);
};

async function appendPhysiqueEntry(
  clientId: string,
  input: UpsertMetricEntryInput,
  metricKey: MeasurementKey
): Promise<MetricEntry> {
  const result = await appendMeasurements({
    clientId,
    source: "coach_entry",
    recordedOn: input.entryDate,
    values: { [metricKey]: input.value },
    note: input.note ?? null,
    createdBy: input.coachId ?? null,
  });
  const row = result.rows[metricKey];
  if (!row) throw new Error("Failed to save measurement");

  return {
    id: row.id,
    clientId,
    metricKey,
    value: row.value,
    entryDate: row.date,
    note: row.note ?? undefined,
    createdBy: input.coachId,
    createdAt: row.recordedAt,
    updatedAt: row.updatedAt,
  };
}

export const listMetricEntries = async (
  clientId: string
): Promise<MetricEntry[]> => {
  // Paged: this read feeds the merged WELLNESS series on the coach Journey, so
  // it must be complete — an unpaged read silently truncates at PostgREST's
  // ~1000-row cap. The order is deterministic with no extra tiebreak:
  // (entry_date, metric_key) is unique per client via the table's upsert key
  // (client_id, metric_key, entry_date).
  const rows = await fetchAllPages<MetricEntryRow>(
    (from, to) =>
      supabaseAdmin
        .from("client_metric_entries")
        .select("*")
        .eq("client_id", clientId)
        .order("entry_date", { ascending: false })
        .order("metric_key", { ascending: true })
        .range(from, to),
    { errorLabel: "metric entries" }
  );

  return rows.map((row) => mapMetricEntryRow(row));
};
