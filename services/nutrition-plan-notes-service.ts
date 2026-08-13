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
 * Record the coach's note about a plan change, in BOTH of its homes.
 *
 * Deliberately one function rather than two calls the orchestrator sequences,
 * because the ORDER is load-bearing and a caller cannot be trusted to preserve
 * it across a future edit:
 *
 *   1. The `nutrition_events.coach_note` stamp is an idempotent UPDATE. Running
 *      it twice is a no-op.
 *   2. The `nutrition_plan_notes` INSERT is append-only by design (no unique
 *      constraint on `(client_id, effective_on)` — two notes on one date is the
 *      history the timeline needs). Running it twice leaves TWO rows.
 *
 * So the idempotent write goes FIRST and the duplicating write goes LAST. Both
 * throw, and the caller surfaces that as a failed save whose retry is safe: the
 * retry re-stamps harmlessly and inserts exactly once, because the insert that
 * failed wrote nothing. Reverse the order and a stamp failure after a
 * successful insert makes the retry mint a duplicate note.
 *
 * Neither write is swallowed (CONVENTIONS §2 item 12). The note is
 * coach-authored content the CLIENT will read; a green toast over a lost note
 * is a silent divergence, and it is exactly the silence the column this
 * replaces was built on.
 *
 * §2 item 13 — what is left inconsistent if the second write fails: the
 * calendar carries a note the timeline does not. Nothing is corrupted and a
 * retry closes it. There is no state where the durable record exists without
 * the caller having been told the save succeeded.
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

  // Lands the note on the DATE the change takes effect, where the coach looks
  // on the calendar. ONE date, not the whole regenerated window: the note
  // describes the CHANGE, and 57 identical markers would be noise.
  //
  // A zero-row match is NOT an error. A note dated past the dense event horizon
  // (8 weeks) has no event row to stamp, and the durable record below must
  // still land — the calendar marker is the optional half of this pair.
  const { error: stampError } = await supabaseAdmin
    .from("nutrition_events")
    .update({ coach_note: trimmed })
    .eq("client_id", params.clientId)
    .eq("date", params.effectiveOn);

  if (stampError) {
    throw new Error(`Failed to stamp the plan note on its date: ${stampError.message}`);
  }

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
