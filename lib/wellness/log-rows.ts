import type { Database } from "@/types/database";
import type { WellnessKey } from "./keys";
import type { WellnessLogDay } from "./day-values";

/**
 * A client's wellness log as both apps read it: the columns every read
 * selects, the row they come back as, and the day the kernel takes
 * (`./day-values.ts`). The coach's series (`services/wellness-series-service.ts`)
 * and the client's progress read (`services/client-portal-progress.ts`) share
 * them, so the two cannot select different columns or map a row differently.
 *
 * A stale column name in the select is a PostgREST 400 that `tsc` cannot see,
 * so `WellnessLogRow` ties the list to the key list: `Pick` fails to compile
 * if a wellness key is not a column of `wellness_logs`.
 */

export const WELLNESS_LOG_COLUMNS = "id, date, mood, energy, sleep, stress, soreness, updated_at";

export type WellnessLogRow = Pick<
  Database["public"]["Tables"]["wellness_logs"]["Row"],
  "id" | "date" | "updated_at" | WellnessKey
>;

export function toWellnessLogDay(row: WellnessLogRow): WellnessLogDay {
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
