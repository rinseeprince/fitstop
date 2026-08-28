import { supabaseAdmin } from "./supabase-admin";
import { buildMetricPoints, type MetricSeriesCheckIn } from "@/utils/metric-points";
import type { MetricEntry } from "@/types/metric-entries";
import type { MeasurementSeries, MeasurementSeriesPoint } from "@/types/coach-overview";

/**
 * The Overview progression chart's weight / body-fat series: the client's WHOLE
 * journey, from the day they started to today.
 *
 * Same two tables, same merge and same tie-break as the coach Physique view —
 * only the transport differs, and that is the whole point. Physique gets there
 * through `useAllClientCheckIns`, which pages the entire check-in history in
 * sequential requests of 20, each a `select("*")` over 37 columns including
 * four JSON blobs, to read two numbers per row. This reads the same history in
 * two unpaged selects of four and five columns. A weekly client of three years
 * is ~156 skinny rows per table — an order of magnitude under PostgREST's cap,
 * and one request instead of eight.
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

/**
 * @param from - The client's start date (YYYY-MM-DD), route-validated. Bounding
 *   on it is semantic as well as cheap: the chart draws the client's journey,
 *   and a measurement recorded before they started is not part of it. Omitted
 *   for a client who has no start date, where the unbounded read is the whole
 *   of a history that has barely begun.
 */
export const getMeasurementSeries = async (
  clientId: string,
  from?: string
): Promise<MeasurementSeries> => {
  const checkInQuery = supabaseAdmin
    .from("check_ins")
    .select("id, created_at, weight, body_fat_percentage")
    .eq("client_id", clientId);
  const entryQuery = supabaseAdmin
    .from("client_metric_entries")
    .select("id, entry_date, metric_key, value, note")
    .eq("client_id", clientId)
    .in("metric_key", ["weight", "bodyFat"]);

  const [checkIns, entries] = await Promise.all([
    from ? checkInQuery.gte("created_at", `${from}T00:00:00`) : checkInQuery,
    from ? entryQuery.gte("entry_date", from) : entryQuery,
  ]);

  for (const result of [checkIns, entries]) {
    if (result.error) {
      console.error("Failed to read measurement series rows:", result.error);
      throw new Error("Failed to read measurement data");
    }
  }

  return buildMeasurementSeries(checkIns.data ?? [], entries.data ?? []);
};
