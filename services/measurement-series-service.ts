import { supabaseAdmin } from "./supabase-admin";
import {
  getBaseline,
  getMeasurementReadings,
  getMeasurementSeries,
  type MeasurementLogReading,
  type StandingReading,
} from "./measurements-service";
import { MEASUREMENT_KEYS, type MeasurementKey } from "@/lib/measurements/keys";
import type { DayValue } from "@/lib/measurements/day-values";
import type {
  MeasurementBaseline,
  MeasurementReadingEntry,
  MeasurementSeries,
  MeasurementSeriesPoint,
} from "@/types/coach-overview";

/**
 * The client's measurement journey for the coach: every metric's day-values
 * from the log, the derived baseline per metric, the start date, and the
 * list of every reading — one payload for the Overview progression chart and
 * status band, the Journey's Physique pane and its measurement log
 * (`GET /api/clients/[id]/measurement-series`).
 *
 * Four reads, in parallel and all complete: the series and the readings are
 * paged past PostgREST's row cap because they feed aggregates and the whole
 * list, the baseline is one view read, the start date one column. The
 * day-values come from the live view and the readings from the table, on
 * purpose: every figure sees live rows only, and only the list sees a
 * removed one.
 */

/** Pure assembly over fetched rows — unit-tested against fixtures. */
export function toMeasurementSeries(
  series: Map<MeasurementKey, DayValue[]>,
  baseline: Partial<Record<MeasurementKey, StandingReading>>,
  startDate: string | null,
  readings: readonly MeasurementLogReading[] = []
): MeasurementSeries {
  const byMetric = {} as Record<MeasurementKey, MeasurementSeriesPoint[]>;
  for (const key of MEASUREMENT_KEYS) {
    byMetric[key] = (series.get(key) ?? []).map((value) => ({
      date: value.date,
      value: value.value,
      source: value.source,
      note: value.note,
      id: value.id,
      recordedAt: value.recordedAt,
    }));
  }

  const baselineByMetric: Partial<Record<MeasurementKey, MeasurementBaseline>> = {};
  for (const key of MEASUREMENT_KEYS) {
    const reading = baseline[key];
    if (reading) {
      baselineByMetric[key] = {
        value: reading.value,
        date: reading.date,
        source: reading.source,
        id: reading.id,
      };
    }
  }

  const readingEntries: MeasurementReadingEntry[] = readings.map((reading) => ({
    id: reading.id,
    metricKey: reading.metricKey,
    date: reading.date,
    value: reading.value,
    source: reading.source,
    sourceId: reading.sourceId,
    note: reading.note,
    recordedAt: reading.recordedAt,
    updatedAt: reading.updatedAt,
    measuredAt: reading.measuredAt,
    voided: reading.voided,
  }));

  return { ...byMetric, baseline: baselineByMetric, startDate, readings: readingEntries };
}

export const getMeasurementSeriesPayload = async (
  clientId: string
): Promise<MeasurementSeries> => {
  const [series, baseline, readings, { data: client, error }] = await Promise.all([
    getMeasurementSeries(clientId),
    getBaseline(clientId),
    getMeasurementReadings(clientId),
    supabaseAdmin.from("clients").select("start_date").eq("id", clientId).maybeSingle(),
  ]);

  if (error) {
    console.error("Failed to read the client's start date:", error);
    throw new Error("Failed to read measurement data");
  }

  return toMeasurementSeries(series, baseline, client?.start_date ?? null, readings);
};
