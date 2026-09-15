import { supabaseAdmin } from "./supabase-admin";
import { fetchAllPages } from "@/lib/paged-fetch";
import type { Database } from "@/types/database";

/**
 * The coach's per-day nutrition override (`nutrition_day_edits`, migration
 * 169): one row per (client, date). A computed day takes the row's numbers
 * verbatim and no training surplus; a day with no row is the plan's own.
 *
 * Shape B: routes prove the coach owns the client; every statement here is
 * scoped by the passed clientId. One statement per act — a range read, one
 * upsert for every day of an edit, one delete for every day of a reset.
 */

type EditRow = Pick<
  Database["public"]["Tables"]["nutrition_day_edits"]["Row"],
  "date" | "calories" | "protein_g" | "carb_g" | "fat_g" | "note"
>;

const EDIT_COLUMNS = "date, calories, protein_g, carb_g, fat_g, note";

export type NutritionDayEdit = {
  date: string;
  calories: number;
  proteinG: number;
  carbG: number;
  fatG: number;
  note: string | null;
};

function mapEditRow(row: EditRow): NutritionDayEdit {
  return {
    date: row.date,
    calories: row.calories,
    proteinG: row.protein_g,
    carbG: row.carb_g,
    fatG: row.fat_g,
    note: row.note ?? null,
  };
}

/**
 * Every edit dated inside `[startDate, endDate]`, oldest first. Paged: the
 * block facts read a whole journey span through the day reader, and a
 * truncated page would silently show a plan's numbers on a day the coach
 * overrode. `date` is unique per client, so it orders the pages alone.
 */
export async function getNutritionDayEditsForRange(
  clientId: string,
  startDate: string,
  endDate: string
): Promise<NutritionDayEdit[]> {
  const rows = await fetchAllPages<EditRow>(
    (from, to) =>
      supabaseAdmin
        .from("nutrition_day_edits")
        .select(EDIT_COLUMNS)
        .eq("client_id", clientId)
        .gte("date", startDate)
        .lte("date", endDate)
        .order("date", { ascending: true })
        .range(from, to),
    { errorLabel: "nutrition day edits" }
  );
  return rows.map(mapEditRow);
}

/**
 * Write the coach's numbers for every day in `edits` — one upsert on
 * (client_id, date), so re-editing a day replaces its row in place and keeps
 * its id. `coachId` is the audit actor stamped on each row.
 */
export async function upsertNutritionDayEdits(
  clientId: string,
  coachId: string,
  edits: NutritionDayEdit[]
): Promise<void> {
  if (edits.length === 0) return;

  const now = new Date().toISOString();
  const { error } = await supabaseAdmin.from("nutrition_day_edits").upsert(
    edits.map((edit) => ({
      client_id: clientId,
      coach_id: coachId,
      date: edit.date,
      calories: edit.calories,
      protein_g: edit.proteinG,
      carb_g: edit.carbG,
      fat_g: edit.fatG,
      note: edit.note,
      updated_at: now,
    })),
    { onConflict: "client_id,date" }
  );

  if (error) {
    throw new Error(`Failed to save the nutrition day edits: ${error.message}`);
  }
}

/**
 * Remove the edits on `dates`, returning how many days actually held one. A
 * day with no edit is simply not counted — there was nothing to reset.
 */
export async function deleteNutritionDayEdits(
  clientId: string,
  dates: string[]
): Promise<number> {
  if (dates.length === 0) return 0;

  const { count, error } = await supabaseAdmin
    .from("nutrition_day_edits")
    .delete({ count: "exact" })
    .eq("client_id", clientId)
    .in("date", dates);

  if (error) {
    throw new Error(`Failed to remove the nutrition day edits: ${error.message}`);
  }
  return count ?? 0;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Remove every edit dated inside any of `ranges` — the days a plan delete or a
 * block trim has just uncovered — in ONE statement, returning how many rows
 * went. An edit is a fact about a date, and a date no version covers has no
 * day for the coach to see or revert it on, so an edit left behind would sit
 * dormant and answer again under whatever version next covers the date (owner
 * decision 2026-09-10: the act that uncovers a day removes the coach's edit on
 * it; edits on past days are never in a range, because they are part of what
 * the client saw).
 *
 * The ranges are the windows of the versions being ended or cut, from today,
 * spelled as one `or` of per-range `and`s so a surviving version's days in
 * between are never touched. Every bound is a DATE the caller read off a
 * version row or resolved as the client's today; the shape check is the belt
 * that keeps anything else out of a filter string.
 */
export async function deleteNutritionDayEditsInRanges(
  clientId: string,
  /** Inclusive date spans, YYYY-MM-DD at both ends. */
  ranges: Array<{ from: string; to: string }>
): Promise<number> {
  const live = ranges.filter((range) => range.from <= range.to);
  if (live.length === 0) return 0;

  for (const { from, to } of live) {
    if (!ISO_DATE.test(from) || !ISO_DATE.test(to)) {
      throw new Error(`Invalid date range for the nutrition day edits: ${from}..${to}`);
    }
  }

  const { count, error } = await supabaseAdmin
    .from("nutrition_day_edits")
    .delete({ count: "exact" })
    .eq("client_id", clientId)
    .or(live.map(({ from, to }) => `and(date.gte.${from},date.lte.${to})`).join(","));

  if (error) {
    throw new Error(`Failed to remove the uncovered nutrition day edits: ${error.message}`);
  }
  return count ?? 0;
}
