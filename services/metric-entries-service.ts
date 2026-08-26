import { supabaseAdmin } from "./supabase-admin";
import {
  getLatestBodyMetrics,
  recordBodyMetrics,
} from "./body-metrics-service";
import { recalculateClientEnergy } from "./client-energy-service";
import { fetchAllPages } from "@/lib/paged-fetch";
import type { MetricEntry, MetricEntryRow } from "@/types/metric-entries";
import type { MetricEntryKey } from "@/lib/metrics/metric-entry-definitions";
import { inToCm } from "@/utils/unit-conversions";

type UpsertMetricEntryInput = {
  metricKey: MetricEntryKey;
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

/** Girth keys, which the coach surface still collects in INCHES. */
const GIRTH_KEYS: ReadonlySet<MetricEntryKey> = new Set<MetricEntryKey>([
  "waist",
  "hips",
  "chest",
  "arms",
  "thighs",
]);

/**
 * Coach-entered value → canonical storage.
 *
 * `client_metric_entries.value` is canonical since migration 141 (kilograms for
 * weight, centimetres for girths). The coach's Log-measurement dialog still
 * labels girths "in" — `use-merged-metrics.ts:27` hardcodes `MEASUREMENT_UNIT =
 * "in"` and feeds `METRIC_DEFINITIONS.getUnit` — so a girth arrives in inches
 * and must be converted here. Without this the column mixes inches (new coach
 * entries) with the centimetres migration 141 converted the history to, and
 * nothing distinguishes them.
 *
 * Weight is stored canonical kg (migration 141 dropped the per-client unit
 * columns); the coach's OWN preference converts at the presentation boundary
 * (CONVENTIONS §20), never here.
 *
 * Phase 3 fixes the stale "in" label; until then this matches the check-in girth
 * path, which converts on write for the same reason.
 */
function toCanonicalEntryValue(key: MetricEntryKey, value: number): number {
  return GIRTH_KEYS.has(key) ? inToCm(value) : value;
}

export const upsertMetricEntry = async (
  clientId: string,
  input: UpsertMetricEntryInput
): Promise<MetricEntry> => {
  const canonicalValue = toCanonicalEntryValue(input.metricKey, input.value);

  // created_at is intentionally absent from the payload: the insert default
  // applies and a conflict-update (same-date replace) never touches it.
  const { data, error } = await supabaseAdmin
    .from("client_metric_entries")
    .upsert(
      {
        client_id: clientId,
        metric_key: input.metricKey,
        value: canonicalValue,
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

  const entry = mapMetricEntryRow(data);

  if (input.metricKey === "weight" || input.metricKey === "bodyFat") {
    // Pass the canonical value, not the raw input — weight is already kilograms
    // here, but routing the converted value keeps the two writes impossible to
    // diverge if a future key needs converting.
    await dualWriteBodyMetrics(clientId, { ...input, value: canonicalValue }, entry.id);
  }

  return entry;
};

// Weight/bodyFat entries also land in the immutable body_metrics event log so
// clients.current_weight (the status-card source) and goal comparisons stay
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

    // The clients.weight_unit lookup that used to sit here is gone with
    // migration 141 — one fewer round trip, and the value needs no tag: weight
    // entries are kilograms and girth entries centimetres, canonically.
    await recordBodyMetrics({
      clientId,
      weight: isWeight ? input.value : undefined,
      bodyFatPercentage: isWeight ? undefined : input.value,
      source: "coach_entry",
      sourceId: entryId,
      // Midday UTC keeps the event on the intended calendar date across zones.
      recordedAt: `${input.entryDate}T12:00:00.000Z`,
      updateClientCache: isCurrent,
    });

    // Same no-regression rule as the cache write above: only an entry dated
    // on/after the latest known event may move the profile, so a backdated
    // measurement recomputes nothing.
    if (isCurrent) {
      await recalculateClientEnergy(clientId);
    }
  } catch (error) {
    console.error("Failed to dual-write body metrics for coach entry:", error);
  }
}

export const listMetricEntries = async (
  clientId: string
): Promise<MetricEntry[]> => {
  // Paged: this read feeds the merged metric series on BOTH the coach Metrics
  // page and the client journey endpoint, so it must be complete — an unpaged
  // read silently truncates at PostgREST's ~1000-row cap, and the two surfaces
  // stay in parity only if they share one complete source. The order is
  // deterministic with no extra tiebreak: (entry_date, metric_key) is unique
  // per client via the table's upsert key (client_id, metric_key, entry_date).
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
