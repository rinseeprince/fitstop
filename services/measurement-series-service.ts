import { supabaseAdmin } from "./supabase-admin";
import {
  getBaseline,
  getMeasurementSeries,
  type StandingReading,
} from "./measurements-service";
import { MEASUREMENT_KEYS, type MeasurementKey } from "@/lib/measurements/keys";
import type { DayValue } from "@/lib/measurements/day-values";
import type {
  MeasurementBaseline,
  MeasurementSeries,
  MeasurementSeriesPoint,
} from "@/types/coach-overview";

/**
 * The client's measurement journey for the coach: every metric's day-values
 * from the log, the derived baseline per metric, and the start date — one
 * payload for the Overview progression chart, the Journey's Physique pane and
 * its measurement log (`GET /api/clients/[id]/measurement-series`).
 *
 * Three reads, in parallel and all complete: the series is paged past
 * PostgREST's row cap because it feeds aggregates, the baseline is one view
 * read, the start date one column.
 */

/** Pure assembly over fetched rows — unit-tested against fixtures. */
export function toMeasurementSeries(
  series: Map<MeasurementKey, DayValue[]>,
  baseline: Partial<Record<MeasurementKey, StandingReading>>,
  startDate: string | null
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

  return { ...byMetric, baseline: baselineByMetric, startDate };
}

export const getMeasurementSeriesPayload = async (
  clientId: string
): Promise<MeasurementSeries> => {
  const [series, baseline, { data: client, error }] = await Promise.all([
    getMeasurementSeries(clientId),
    getBaseline(clientId),
    supabaseAdmin.from("clients").select("start_date").eq("id", clientId).maybeSingle(),
  ]);

  if (error) {
    console.error("Failed to read the client's start date:", error);
    throw new Error("Failed to read measurement data");
  }

  return toMeasurementSeries(series, baseline, client?.start_date ?? null);
};
