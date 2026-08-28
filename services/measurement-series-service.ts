import { supabaseAdmin } from "./supabase-admin";
import { getClientTodayString } from "./today-service";
import { addDaysToDateString } from "@/lib/date-helpers";
import { buildMetricPoints, type MetricSeriesCheckIn } from "@/utils/metric-points";
import type { MetricEntry } from "@/types/metric-entries";
import type { MeasurementSeries, MeasurementSeriesPoint } from "@/types/coach-overview";

/**
 * The Overview progression chart's weight / body-fat series.
 *
 * Same two tables, same merge and same tie-break as the coach Physique view —
 * only the transport differs. Physique gets there through `useAllClientCheckIns`,
 * which pages the client's entire check-in history in sequential requests of 20,
 * each a `select("*")` over 37 columns including four JSON blobs, to read two
 * numbers per row. Here the window is at most 60 days, so that would mean
 * pulling years of AI-annotated check-ins to draw eight dots.
 */

/** The two body metrics this chart offers, as `buildMetricPoints` names them. */
const SERIES_DEFINITIONS = [
  { id: "weight", key: "weight", category: "body" },
  { id: "bodyFat", key: "bodyFatPercentage", category: "body" },
] as const;

type CheckInRow = {
  id: string;
  created_at: string | null;
  weight: number | null;
  body_fat_percentage: number | null;
};

type EntryRow = {
  id: string;
  entry_date: string;
  metric_key: string;
  value: number;
  note: string | null;
};

/**
 * Pure assembly over fetched rows — unit-tested against fixtures.
 *
 * The merge is `buildMetricPoints` rather than a local one **because** of its
 * deterministic total order `date | source rank | timestamp | id`: a coach
 * entry dated D sorts AFTER that day's check-ins and so wins ties for "latest".
 * Re-implementing that here is exactly how this chart and the Physique chart
 * would start disagreeing about which value is current on a day both sources
 * touched.
 *
 * Duplicate dates are KEPT, not collapsed. A check-in and a coach entry on the
 * same day are two real readings; the Physique chart draws both and a rolling
 * mean is unbothered by them.
 */
export function buildMeasurementSeries(
  checkIns: CheckInRow[],
  entries: EntryRow[]
): MeasurementSeries {
  // A four-column projection onto the camelCase shape the merge reads. `weight`
  // and `bodyFatPercentage` are the only two columns the definitions name.
  const projected: MetricSeriesCheckIn[] = checkIns
    .filter((row): row is CheckInRow & { created_at: string } => row.created_at !== null)
    .map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      weight: row.weight ?? undefined,
      bodyFatPercentage: row.body_fat_percentage ?? undefined,
    }));

  const mappedEntries = entries.map(
    (row) =>
      ({
        id: row.id,
        entryDate: row.entry_date,
        metricKey: row.metric_key,
        value: row.value,
        note: row.note ?? undefined,
      }) as MetricEntry
  );

  const byMetric = buildMetricPoints(projected, mappedEntries, [...SERIES_DEFINITIONS]);
  const project = (id: string): MeasurementSeriesPoint[] =>
    (byMetric.get(id) ?? []).map((point) => ({ date: point.date, value: point.value }));

  return { weight: project("weight"), bodyFat: project("bodyFat") };
}

export const getMeasurementSeries = async (
  clientId: string,
  days: number
): Promise<MeasurementSeries> => {
  // The SAME client-local anchor `getClientAdherence` uses. The chart and the
  // Signals card sit under one window control, so they must not disagree by a
  // day about where that window starts.
  const today = await getClientTodayString(clientId);
  const windowStart = addDaysToDateString(today, -(days - 1));

  const [checkIns, entries] = await Promise.all([
    supabaseAdmin
      .from("check_ins")
      .select("id, created_at, weight, body_fat_percentage")
      .eq("client_id", clientId)
      .gte("created_at", `${windowStart}T00:00:00`),
    supabaseAdmin
      .from("client_metric_entries")
      .select("id, entry_date, metric_key, value, note")
      .eq("client_id", clientId)
      .in("metric_key", ["weight", "bodyFat"])
      .gte("entry_date", windowStart),
  ]);

  for (const result of [checkIns, entries]) {
    if (result.error) {
      console.error("Failed to read measurement series rows:", result.error);
      throw new Error("Failed to read measurement data");
    }
  }

  return buildMeasurementSeries(checkIns.data ?? [], entries.data ?? []);
};
