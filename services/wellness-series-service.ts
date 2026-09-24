import { supabaseAdmin } from "./supabase-admin";
import { getClientTodayString } from "./today-service";
import { fetchAllPages } from "@/lib/paged-fetch";
import { WELLNESS_KEYS, type WellnessKey } from "@/lib/wellness/keys";
import {
  wellnessDayValues,
  type WellnessDayValue,
  type WellnessLogDay,
} from "@/lib/wellness/day-values";
import {
  WELLNESS_LOG_COLUMNS,
  toWellnessLogDay,
  type WellnessLogRow,
} from "@/lib/wellness/log-rows";
import type { WellnessSeries, WellnessSeriesPoint } from "@/types/coach-overview";

/**
 * The client's wellness journey for the coach: the five wellness metrics as
 * day-values from the client's own daily log — one payload for the Journey's
 * Wellness pane (`GET /api/clients/[id]/wellness-series`). The physique shape
 * (`measurement-series-service.ts`) over wellness's one store: no baseline,
 * no start date, no readings list (docs/MEASUREMENT-LOG-PLAN.md §6 commit 7,
 * D16–D20); the client's today, as there.
 *
 * Two reads, in parallel: `wellness_logs`, complete — paged past PostgREST's
 * row cap because it feeds a series — and the client's today. The columns and
 * the row's mapping are the ones the client's progress read uses
 * (`lib/wellness/log-rows.ts`).
 */

async function readWellnessLogDays(clientId: string): Promise<WellnessLogDay[]> {
  // Ordered by day then id: the paged reader's contract wants a unique
  // tiebreak, and the store's one-row-per-day guarantee lives on the spine,
  // not on this table. `idx_wellness_logs_client_date` serves the scan.
  const rows = await fetchAllPages<WellnessLogRow>(
    (from, to) =>
      supabaseAdmin
        .from("wellness_logs")
        .select(WELLNESS_LOG_COLUMNS)
        .eq("client_id", clientId)
        .order("date", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    { errorLabel: "wellness logs" }
  );
  return rows.map(toWellnessLogDay);
}

/** Pure assembly over the kernel's day-values — unit-tested against fixtures. */
export function toWellnessSeries(
  series: ReadonlyMap<WellnessKey, readonly WellnessDayValue[]>,
  clientToday: string
): WellnessSeries {
  const byMetric = {} as Record<WellnessKey, WellnessSeriesPoint[]>;
  for (const key of WELLNESS_KEYS) {
    byMetric[key] = (series.get(key) ?? []).map((value) => ({
      date: value.date,
      value: value.value,
      id: value.id,
      recordedAt: value.recordedAt,
    }));
  }
  return { ...byMetric, clientToday };
}

export const getWellnessSeriesPayload = async (clientId: string): Promise<WellnessSeries> => {
  const [logs, clientToday] = await Promise.all([
    readWellnessLogDays(clientId),
    getClientTodayString(clientId),
  ]);
  return toWellnessSeries(wellnessDayValues(logs), clientToday);
};
