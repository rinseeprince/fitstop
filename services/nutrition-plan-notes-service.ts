import { supabaseAdmin } from "./supabase-admin";
import { fetchAllPages } from "@/lib/paged-fetch";
import type { NutritionPlanNote } from "@/types/nutrition-plan-notes";

/**
 * The coach's plan-save note (`nutrition_plan_notes`, migration 147).
 *
 * Shape B: routes verify the coach owns the client; every query here filters on
 * the passed clientId.
 */

type NoteRow = {
  id: string;
  effective_on: string;
  body: string;
};

const NOTE_COLUMNS = "id, effective_on, body";

function mapNoteRow(row: NoteRow): NutritionPlanNote {
  return { id: row.id, effectiveOn: row.effective_on, body: row.body };
}

/**
 * Record the coach's note about a plan change.
 *
 * One store. The `nutrition_plan_notes` INSERT is append-only by design (no
 * unique constraint on `(client_id, effective_on)` — two notes on one date is
 * the history the timeline needs), dated the day the change takes effect: the
 * note describes the CHANGE, and the calendar reads it on that one date
 * through the computed day (`services/nutrition-days-service.ts`), not from a
 * stamp of its own.
 *
 * The write is not swallowed (CONVENTIONS §2 item 12). The note is
 * coach-authored content the CLIENT will read; a green toast over a lost note
 * is a silent divergence, and it is exactly the silence the column this
 * replaces was built on. The caller surfaces a failure as a failed save whose
 * retry is safe: the insert that failed wrote nothing, so the retry inserts
 * exactly once.
 */
export async function recordPlanSaveNote(params: {
  clientId: string;
  coachId: string;
  planId: string;
  effectiveOn: string;
  body: string | undefined;
}): Promise<void> {
  const trimmed = params.body?.trim();
  if (!trimmed) return;

  const { error: insertError } = await supabaseAdmin
    .from("nutrition_plan_notes")
    .insert({
      client_id: params.clientId,
      coach_id: params.coachId,
      nutrition_plan_id: params.planId,
      effective_on: params.effectiveOn,
      body: trimmed,
    });

  if (insertError) {
    throw new Error(`Failed to save the plan note: ${insertError.message}`);
  }
}

/**
 * Every note whose effective date falls inside `[startDate, endDate]`, oldest
 * first — the order both readers render in.
 *
 * Paged because `effective_on` is not unique per client, so a busy client's
 * span can in principle cross PostgREST's ~1000-row cap, and a truncated read
 * would silently drop the oldest notes with no error. `(effective_on,
 * created_at, id)` is the deterministic order the paging contract requires:
 * `id` is the unique tiebreak, since two notes really can share both dates.
 */
export async function listNutritionPlanNotesInRange(
  clientId: string,
  startDate: string,
  endDate: string
): Promise<NutritionPlanNote[]> {
  const rows = await fetchAllPages<NoteRow>(
    (from, to) =>
      supabaseAdmin
        .from("nutrition_plan_notes")
        .select(NOTE_COLUMNS)
        .eq("client_id", clientId)
        .gte("effective_on", startDate)
        .lte("effective_on", endDate)
        .order("effective_on", { ascending: true })
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    { errorLabel: "nutrition plan notes" }
  );
  return rows.map(mapNoteRow);
}
