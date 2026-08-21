import { supabaseAdmin } from "./supabase-admin";
import { upsertMetricEntry } from "./metric-entries-service";
import type { MetricEntryKey } from "@/lib/metrics/metric-entry-definitions";

/**
 * A client's ORIGIN — the day coaching began, and what they measured on it.
 *
 * ONE definition, one writer. `clients.start_date` is the day; the start
 * measurements are ordinary `client_metric_entries` rows dated on it. There is
 * no separate "start weight" store: the start weight IS the measurement on the
 * start date, which is why it turns up as the Physique chart's first point with
 * no chart code at all, and why the check-in comparison reads the same number
 * (the entry's existing dual-write puts a `body_metrics` event on that date).
 *
 * `clients.starting_weight` / `starting_body_fat_percentage` survive as a
 * denormalized CACHE of those entries — the same relationship
 * `clients.current_weight` has to the latest measurement. Four readers depend
 * on the columns (`comparison-service`, the client portal twice, the status
 * card); caching means none of them has to learn to query entries, and one
 * writer means the two cannot disagree.
 *
 * Deliberately NOT the origin (each was considered and rejected):
 *   - a plan's `effective_from` — there are many per client, one can be queued
 *     in the future, and a queued nutrition version can be hard-deleted
 *     (migration 144). An origin that can vanish is not an origin.
 *   - `client_goals.goal_start_date` — versioned per goal, and it answers a
 *     different question ("spread this deficit from when").
 *   - the earliest measurement — that is where the DATA starts, not where the
 *     coaching did; the gap between them is exactly what this records.
 */

/** The physique metrics an activation can seed. Nothing captures girths at
 *  intake or manual add, so there is nothing to record for the other five. */
export const START_METRIC_KEYS = ["weight", "bodyFat"] as const satisfies
  readonly MetricEntryKey[];

export type ClientStartInput = {
  /** YYYY-MM-DD. Omitted = keep the stored start date. */
  startsOn?: string;
  /** KILOGRAMS. Omitted = keep the stored start weight. */
  weightKg?: number;
  /** Omitted = keep the stored start body fat. */
  bodyFatPercentage?: number;
  /** Caller-verified; written to the entries' nullable `created_by`. */
  coachId?: string;
};

type StoredStart = {
  startDate: string | null;
  weight: number | null;
  bodyFat: number | null;
};

async function readStoredStart(clientId: string): Promise<StoredStart> {
  const { data, error } = await supabaseAdmin
    .from("clients")
    .select("start_date, starting_weight, starting_body_fat_percentage")
    .eq("id", clientId)
    .single();

  if (error) {
    console.error("Failed to read client start:", error);
    throw new Error(`Failed to read client start: ${error.message}`);
  }
  return {
    startDate: data.start_date ?? null,
    weight: data.starting_weight ?? null,
    bodyFat: data.starting_body_fat_percentage ?? null,
  };
}

/**
 * Set the client's origin and keep everything that describes it in step.
 *
 * Used by activation (which supplies the date), by the status card's start
 * weight / body-fat edits (which supply a value), and by a start-date change
 * (which supplies a new date and MOVES the pair with it — the entries are keyed
 * by date, so leaving them behind would orphan the pair at the old date and the
 * chart's first point would stop being the start weight).
 *
 * Moving is a delete-then-upsert on `client_metric_entries`, which is a mutable
 * table by design (`updated_at`, upsert-replace on `(client, metric, date)`).
 * The `body_metrics` events those entries wrote are NOT rewound — that log is
 * append-only by design (ARCHITECTURE → body_metrics), and no read prefers it
 * over the cached columns, so a superseded event is inert provenance.
 */
export async function recordClientStart(
  clientId: string,
  input: ClientStartInput
): Promise<void> {
  const stored = await readStoredStart(clientId);

  const nextDate = input.startsOn ?? stored.startDate;
  const nextWeight = input.weightKg ?? stored.weight;
  const nextBodyFat = input.bodyFatPercentage ?? stored.bodyFat;

  const cache: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.startsOn !== undefined) cache.start_date = input.startsOn;
  if (input.weightKg !== undefined) cache.starting_weight = input.weightKg;
  if (input.bodyFatPercentage !== undefined) {
    cache.starting_body_fat_percentage = input.bodyFatPercentage;
  }

  const { error: cacheError } = await supabaseAdmin
    .from("clients")
    .update(cache)
    .eq("id", clientId);

  if (cacheError) {
    console.error("Failed to write client start:", cacheError);
    throw new Error(`Failed to save start details: ${cacheError.message}`);
  }

  // No start date yet — a client set up but not activated. The values sit on
  // the columns until activation gives them a day to be measured on.
  if (!nextDate) return;

  const movedFrom =
    stored.startDate && stored.startDate !== nextDate ? stored.startDate : null;
  if (movedFrom) {
    const { error } = await supabaseAdmin
      .from("client_metric_entries")
      .delete()
      .eq("client_id", clientId)
      .eq("entry_date", movedFrom)
      .in("metric_key", [...START_METRIC_KEYS]);
    if (error) {
      console.error("Failed to move start measurements:", error);
      throw new Error(`Failed to move start measurements: ${error.message}`);
    }
  }

  const values: Partial<Record<(typeof START_METRIC_KEYS)[number], number | null>> = {
    weight: nextWeight,
    bodyFat: nextBodyFat,
  };

  for (const metricKey of START_METRIC_KEYS) {
    const value = values[metricKey];
    if (value == null) continue;
    // Sequential, not parallel: each upsert dual-writes a body_metrics event
    // and reads the latest one to decide whether it may touch the denormalized
    // current values. Two of those racing would read the same "latest".
    await upsertMetricEntry(clientId, {
      metricKey,
      value,
      entryDate: nextDate,
      coachId: input.coachId,
    });
  }
}
