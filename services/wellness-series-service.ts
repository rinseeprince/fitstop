import { supabaseAdmin } from "./supabase-admin";
import { fetchAllPages } from "@/lib/paged-fetch";
import { WELLNESS_KEYS, type WellnessKey } from "@/lib/wellness/keys";
import {
  wellnessDayValues,
  type WellnessDayValue,
  type WellnessLogDay,
} from "@/lib/wellness/day-values";
import type { WellnessSeries, WellnessSeriesPoint } from "@/types/coach-overview";
import type { Database } from "@/types/database";

/**
 * The client's wellness journey for the coach: the five wellness metrics as
 * day-values from the client's own daily log — one payload for the Journey's
 * Wellness pane (`GET /api/clients/[id]/wellness-series`). The physique shape
 * (`measurement-series-service.ts`) over wellness's one store: no baseline,
 * no start date, no readings list (docs/MEASUREMENT-LOG-PLAN.md §6 commit 7,
 * D16–D20).
 *
 * One read, complete: `wellness_logs` is paged past PostgREST's row cap
 * because it feeds a series. A stale column name in the select is a
 * PostgREST 400 that `tsc` cannot see, so `WellnessLogRow` ties the select to
 * the key list: `Pick` fails to compile if a wellness key is not a column.
 */

const WELLNESS_LOG_COLUMNS = "id, date, mood, energy, sleep, stress, soreness, updated_at";

type WellnessLogRow = Pick<
  Database["public"]["Tables"]["wellness_logs"]["Row"],
  "id" | "date" | "updated_at" | WellnessKey
>;

function toLogDay(row: WellnessLogRow): WellnessLogDay {
  return {
    id: row.id,
    date: row.date,
    updatedAt: row.updated_at,
    mood: row.mood,
    energy: row.energy,
    sleep: row.sleep,
    stress: row.stress,
    soreness: row.soreness,
  };
}

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
  return rows.map(toLogDay);
}

/** Pure assembly over the kernel's day-values — unit-tested against fixtures. */
export function toWellnessSeries(
  series: ReadonlyMap<WellnessKey, readonly WellnessDayValue[]>
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
  return byMetric;
}

export const getWellnessSeriesPayload = async (clientId: string): Promise<WellnessSeries> => {
  const logs = await readWellnessLogDays(clientId);
  return toWellnessSeries(wellnessDayValues(logs));
};
