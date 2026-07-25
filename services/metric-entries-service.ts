import { supabaseAdmin } from "./supabase-admin";
import {
  getLatestBodyMetrics,
  recordBodyMetrics,
} from "./body-metrics-service";
import type { MetricEntry, MetricEntryRow } from "@/types/metric-entries";
import type { MetricEntryKey } from "@/lib/metrics/metric-entry-definitions";

export type UpsertMetricEntryInput = {
  metricKey: MetricEntryKey;
  value: number;
  /** YYYY-MM-DD; route-validated and bounded to the coach's today */
  entryDate: string;
  note?: string;
  /** caller-verified; written to created_by */
  coachId: string;
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

export const upsertMetricEntry = async (
  clientId: string,
  input: UpsertMetricEntryInput
): Promise<MetricEntry> => {
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
        created_by: input.coachId,
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

  const entry = mapMetricEntryRow(data);

  if (input.metricKey === "weight" || input.metricKey === "bodyFat") {
    await dualWriteBodyMetrics(clientId, input, entry.id);
  }

  return entry;
};

// Weight/bodyFat entries also land in the immutable body_metrics event log so
// clients.current_weight (the phase-chip source) and phase comparisons stay
// coherent. Non-blocking: a dual-write failure never loses the entry itself.
async function dualWriteBodyMetrics(
  clientId: string,
  input: UpsertMetricEntryInput,
  entryId: string
): Promise<void> {
  try {
    const isWeight = input.metricKey === "weight";
    const latest = await getLatestBodyMetrics(clientId, {
      requireFields: [isWeight ? "weight" : "body_fat_percentage"],
    });
    // No-regression rule: only an entry dated on/after the latest known event
    // may update the clients denormalized cache — a backdated measurement must
    // never move current_weight/current_body_fat_percentage backwards.
    const isCurrent =
      latest === null || input.entryDate >= latest.recordedAt.slice(0, 10);

    let weightUnit: string | undefined;
    if (isWeight) {
      const { data: client } = await supabaseAdmin
        .from("clients")
        .select("weight_unit")
        .eq("id", clientId)
        .maybeSingle();
      weightUnit = client?.weight_unit ?? "lbs";
    }

    await recordBodyMetrics({
      clientId,
      weight: isWeight ? input.value : undefined,
      weightUnit,
      bodyFatPercentage: isWeight ? undefined : input.value,
      source: "coach_entry",
      sourceId: entryId,
      // Midday UTC keeps the event on the intended calendar date across zones.
      recordedAt: `${input.entryDate}T12:00:00.000Z`,
      updateClientCache: isCurrent,
    });
  } catch (error) {
    console.error("Failed to dual-write body metrics for coach entry:", error);
  }
}

export const listMetricEntries = async (
  clientId: string
): Promise<MetricEntry[]> => {
  const { data, error } = await supabaseAdmin
    .from("client_metric_entries")
    .select("*")
    .eq("client_id", clientId)
    .order("entry_date", { ascending: false })
    .order("metric_key", { ascending: true });

  if (error) {
    console.error("Failed to fetch metric entries:", error);
    throw new Error(`Failed to fetch metric entries: ${error.message}`);
  }

  return (data || []).map((row: MetricEntryRow) => mapMetricEntryRow(row));
};
