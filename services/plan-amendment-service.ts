import { createHash } from "crypto";
import { supabaseAdmin } from "./supabase-admin";
import { getClientTodayString } from "./today-service";
import { deriveFrequencyPerWeek } from "./coach-library-helpers";
import { fetchVisibleExerciseIds } from "./library-placement-service";
import {
  generateProgramEvents,
  calculatePlacementEndDate,
  type ProgramSlot,
} from "./program-event-walk";
import { mapExerciseRow } from "./training-mappers";
import { fetchAllPages, fetchAllByChunkedIds, chunkIds } from "@/lib/paged-fetch";
import { differenceInDays } from "@/lib/date-helpers";
import type { z } from "zod";
import type { savedSessionInputSchema } from "@/lib/validations/training";
import type { TrainingExercise } from "@/types/training";
import type {
  TrainingSessionRow,
  TrainingExerciseRow,
  TrainingEventRow,
  TrainingEventInsert,
} from "@/lib/database-helpers";
import type { Json } from "@/types/database";
import { toPrescribedFields } from "@/utils/prescribed-fields";

// =============================================================================
// Plan amendment — rewrite a placed plan's FUTURE while the past stays frozen.
//
// The boundary authority is the SERVER: floor = max(effective_from, clientToday)
// and offset = daysBetween(effective_from, floor) are recomputed here, and
// incoming content at past positions is ignored (the walk resumes at offset).
// Drift between the coach's editor snapshot and the live calendar is caught by
// an amendmentToken — a hash over the plan's updated_at, the client's today,
// and every event the amendment's delete predicates would match.
//
// No RPC / no migrations: the writer uses the same app-side H3
// snapshot/compensate idiom as placement (library-placement-service.ts).
// =============================================================================

export type AmendSessionInput = z.infer<typeof savedSessionInputSchema>;

export class AmendmentConflictError extends Error {} // → 409
export class AmendmentValidationError extends Error {} // → 422
export class AmendmentEmptyFutureError extends AmendmentValidationError {} // → 422

// One string for both belts: the GET refuses to open the editor and the PUT
// refuses to save. They must not drift — a coach who gets past the first and
// hits the second should read the same reason, not a second vocabulary.
const RETIRED_PLAN_MESSAGE =
  "This program has been retired and can no longer be edited — apply a new program instead";

export type PlacedSlotEventLink = {
  id: string;
  date: string;
  status: string;
  isModified: boolean;
};

// One placed slot (training or rest) in canonical program order, full-fidelity —
// the client-portal reader is deliberately lossy (no set_specs detail shape the
// builder needs), so the amendment surface reads through this instead.
export type PlacedSlotRead = {
  id: string;
  name: string;
  focus: string | null;
  weekIndex: number;
  orderIndex: number;
  isRest: boolean;
  estimatedDurationMinutes: number | null;
  calorieSurplusPercentage: number | null;
  notes: string | null;
  sessionType: "training";
  createdAt: string;
  exercises: TrainingExercise[];
  events: PlacedSlotEventLink[];
};

export type PlacedPlanForBuilder = {
  plan: {
    id: string;
    name: string;
    splitType: string | null;
    programDurationWeeks: number | null;
    frequencyPerWeek: number;
    effectiveFrom: string;
    savedPlanId: string | null;
    status: string;
    updatedAt: string;
  };
  clientToday: string;
  windowEnd: string;
  isFullyPast: boolean;
  amendmentToken: string;
  sessions: PlacedSlotRead[];
  futureModifiedEvents: Array<{ id: string; date: string; sessionName: string }>;
};

export type AmendPlacedPlanResult = {
  planId: string;
  floor: string;
  offset: number;
  sessionsCreated: number;
  eventsCreated: number;
  deactivatedSessions: number;
};

// --- Canonical ordering -------------------------------------------------------

// Deterministic order over the raw active rows. NOT the slot list — see
// toSlotRows below, which is what maps position to date. This sort's job is to
// make the tie-break between colliding rows reproducible rather than an accident
// of query order, because diverged plans are real: cloneSessionForEvent (the
// tray's "just this day" scope) copies (week_index, order_index) verbatim from
// its source, placeSessionOnCalendar appends a dropped session at (lastWeek,
// lastOrder + 1), and historic duplicate-week rows carry the same shape.
function canonicalSortRows(rows: TrainingSessionRow[]): TrainingSessionRow[] {
  return [...rows].sort(
    (a, b) =>
      a.week_index - b.week_index ||
      a.order_index - b.order_index ||
      a.created_at.localeCompare(b.created_at) ||
      a.id.localeCompare(b.id),
  );
}

/**
 * THE SLOT LIST: one active row per distinct `(week_index, order_index)`, in
 * canonical order. This is the plan's day-slot blueprint — `slotRows[i]` is the
 * slot whose calendar day is `effective_from + i` — and everything derives from
 * it: the window, the elapsed/future partition, the date-walk's programSlots,
 * and the grid the coach edits.
 *
 * It exists because "active row" and "slot" are NOT the same thing, and every
 * caller used to assume they were. `cloneSessionForEvent` (the tray's "just this
 * day" scope) inserts a second active row at an existing coordinate by design,
 * and historic writers left others behind. One extra row shifted every later
 * index by one, which silently mis-partitioned elapsed vs future, stretched the
 * window by a day, and broke the editor's every-week-is-7-rows test.
 *
 * Tie-break is the canonical order's own — earliest `created_at`, then `id` —
 * which is correct for every reachable shape. After a per-event duplicate plus a
 * "just this day" override, the ORIGINAL row still backs the slot's own date
 * while the clone backs the duplicate's off-slot date; earliest-created keeps
 * the original, so a per-date override never becomes the slot's content. On the
 * duplicate this file used to mint, it keeps the row the client's early log is
 * attached to.
 *
 * Rows that lose the tie are left completely alone — not deactivated. They are
 * inert once they are out of the slot list, and repairing them is a separate
 * decision (TECHNICAL-DEBT.md).
 */
function toSlotRows(canonical: TrainingSessionRow[]): TrainingSessionRow[] {
  const seen = new Set<string>();
  const slots: TrainingSessionRow[] = [];
  for (const row of canonical) {
    const coord = `${row.week_index}|${row.order_index}`;
    if (seen.has(coord)) continue;
    seen.add(coord);
    slots.push(row);
  }
  return slots;
}

// --- Paged reads --------------------------------------------------------------

/** The plan's day-slots — see `toSlotRows`. Never returns two rows for one day. */
async function fetchSlotRows(planId: string): Promise<TrainingSessionRow[]> {
  const rows = await fetchAllPages<TrainingSessionRow>(
    (from, to) =>
      supabaseAdmin
        .from("training_sessions")
        .select("*")
        .eq("plan_id", planId)
        .eq("is_active", true)
        .order("week_index", { ascending: true })
        .order("order_index", { ascending: true })
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    { errorLabel: "placed plan sessions" },
  );
  return toSlotRows(canonicalSortRows(rows));
}

async function fetchExercisesBySession(
  sessionIds: string[],
): Promise<Map<string, TrainingExercise[]>> {
  const rows = await fetchAllByChunkedIds<TrainingExerciseRow, string>(
    sessionIds,
    (chunk, from, to) =>
      supabaseAdmin
        .from("training_exercises")
        .select("*")
        .in("session_id", chunk)
        .eq("is_active", true)
        .order("session_id", { ascending: true })
        .order("order_index", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    { errorLabel: "placed plan exercises" },
  );
  const bySession = new Map<string, TrainingExercise[]>();
  for (const row of rows) {
    const list = bySession.get(row.session_id) ?? [];
    list.push(mapExerciseRow(row));
    bySession.set(row.session_id, list);
  }
  return bySession;
}

/**
 * Every SCHEDULED event the amendment's delete predicates would match, deduped:
 * (a) plan-scoped from the floor, unbounded — catches shrunk windows and events
 *     moved past the old window end;
 * (b) client-scoped inside [floor, windowEnd] — the amended window wins its
 *     contested dates, mirroring migration 114's placement delete.
 * Shared by the token (drift detection) and the H3 snapshot (compensation).
 */
async function fetchDeleteCandidates(
  clientId: string,
  planId: string,
  floor: string,
  windowEnd: string,
): Promise<TrainingEventRow[]> {
  const planScoped = await fetchAllPages<TrainingEventRow>(
    (from, to) =>
      supabaseAdmin
        .from("training_events")
        .select("*")
        .eq("training_plan_id", planId)
        .eq("status", "scheduled")
        .gte("date", floor)
        .order("id", { ascending: true })
        .range(from, to),
    { errorLabel: "amendment plan-scoped events" },
  );
  const windowScoped = await fetchAllPages<TrainingEventRow>(
    (from, to) =>
      supabaseAdmin
        .from("training_events")
        .select("*")
        .eq("client_id", clientId)
        .eq("status", "scheduled")
        .gte("date", floor)
        .lte("date", windowEnd)
        .order("id", { ascending: true })
        .range(from, to),
    { errorLabel: "amendment window events" },
  );
  const byId = new Map<string, TrainingEventRow>();
  for (const row of [...planScoped, ...windowScoped]) byId.set(row.id, row);
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

// --- Drift token --------------------------------------------------------------

/**
 * Deterministic fingerprint of everything the amendment is about to destroy or
 * depend on. Any concurrent change that alters the outcome invalidates it: a
 * plan-meta write or another amendment (updated_at), the client's midnight flip
 * (clientToday → floor), a calendar move/duplicate/delete, or an event leaving
 * the scheduled state (a completed event flips its slot's lock).
 */
export function computeAmendmentToken(params: {
  planUpdatedAt: string;
  clientToday: string;
  events: Array<Pick<TrainingEventRow, "id" | "date" | "training_session_id" | "status" | "is_modified">>;
}): string {
  const tuples = [...params.events]
    .map(
      (e) =>
        [e.id, e.date, e.training_session_id, e.status, e.is_modified ?? false] as const,
    )
    .sort((a, b) => a[0].localeCompare(b[0]));
  return createHash("sha256")
    .update(
      JSON.stringify({
        planUpdatedAt: params.planUpdatedAt,
        clientToday: params.clientToday,
        tuples,
      }),
    )
    .digest("base64url");
}

// --- Reader -------------------------------------------------------------------

/**
 * The full-fidelity placed plan for the amendment surface: every active session
 * row (rest included) in canonical order with complete exercises + per-slot
 * event linkage, plus the recomputed window, the drift token, and the list of
 * manually-moved future events the amendment would delete (pre-save warning).
 * Returns null when the plan doesn't exist for this client (route → 404).
 */
export async function getPlacedPlanForBuilder(
  clientId: string,
  planId: string,
): Promise<PlacedPlanForBuilder | null> {
  const { data: planRow, error } = await supabaseAdmin
    .from("training_plans")
    .select("*")
    .eq("id", planId)
    .eq("client_id", clientId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) throw new Error(`Failed to read plan: ${error.message}`);
  if (!planRow) return null;
  // Refuse to OPEN, not just to save. Without this a coach can rebuild an entire
  // program in the editor and only learn it is dead when the PUT 422s.
  if (planRow.status === "archived") {
    throw new AmendmentValidationError(RETIRED_PLAN_MESSAGE);
  }

  const clientToday = await getClientTodayString(clientId);
  const sessionRows = await fetchSlotRows(planId);
  const exercisesBySession = await fetchExercisesBySession(sessionRows.map((r) => r.id));

  const planEvents = await fetchAllPages<TrainingEventRow>(
    (from, to) =>
      supabaseAdmin
        .from("training_events")
        .select("*")
        .eq("training_plan_id", planId)
        .eq("client_id", clientId)
        .order("date", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    { errorLabel: "placed plan events" },
  );
  const eventsBySession = new Map<string, PlacedSlotEventLink[]>();
  for (const e of planEvents) {
    if (!e.training_session_id) continue;
    const list = eventsBySession.get(e.training_session_id) ?? [];
    list.push({ id: e.id, date: e.date, status: e.status, isModified: e.is_modified ?? false });
    eventsBySession.set(e.training_session_id, list);
  }

  const effectiveFrom = planRow.effective_from;
  const windowEnd = await calculatePlacementEndDate({
    clientId,
    slotCount: sessionRows.length,
    startDate: effectiveFrom,
  });
  const floor = effectiveFrom > clientToday ? effectiveFrom : clientToday;
  const deleteCandidates = await fetchDeleteCandidates(clientId, planId, floor, windowEnd);

  return {
    plan: {
      id: planRow.id,
      name: planRow.name,
      splitType: planRow.split_type ?? null,
      programDurationWeeks: planRow.program_duration_weeks ?? null,
      frequencyPerWeek: planRow.frequency_per_week,
      effectiveFrom,
      savedPlanId: planRow.saved_plan_id ?? null,
      status: planRow.status,
      updatedAt: planRow.updated_at,
    },
    clientToday,
    windowEnd,
    isFullyPast: windowEnd < clientToday,
    amendmentToken: computeAmendmentToken({
      planUpdatedAt: planRow.updated_at,
      clientToday,
      events: deleteCandidates,
    }),
    sessions: sessionRows.map((row) => ({
      id: row.id,
      name: row.name,
      focus: row.focus ?? null,
      weekIndex: row.week_index,
      orderIndex: row.order_index,
      isRest: row.is_rest,
      estimatedDurationMinutes: row.estimated_duration_minutes ?? null,
      calorieSurplusPercentage: row.calorie_surplus_percentage ?? null,
      notes: row.notes ?? null,
      // training_sessions has no session_type column — synthesized.
      sessionType: "training",
      createdAt: row.created_at,
      exercises: exercisesBySession.get(row.id) ?? [],
      events: eventsBySession.get(row.id) ?? [],
    })),
    futureModifiedEvents: deleteCandidates
      .filter((e) => e.is_modified)
      .map((e) => ({ id: e.id, date: e.date, sessionName: e.session_name }))
      .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)),
  };
}

// --- Writer -------------------------------------------------------------------

/**
 * Rewrite the plan's future to the incoming grid. Elapsed positions keep their
 * existing rows; rows referenced by any surviving event are kept too (the
 * event-reference belt that makes diverged plans safe); everything else is
 * soft-deleted and replaced by fresh rows. Future scheduled events are deleted
 * (no is_modified filter — decision 6) and regenerated by resuming the shared
 * date-walk at the elapsed offset. On any failure past the first mutation the
 * compensator restores sessions, exercises, and the event snapshot.
 */
export async function amendPlacedPlanFuture(params: {
  clientId: string;
  coachId: string;
  planId: string;
  sessions: AmendSessionInput[];
  planPatch?: { name?: string; splitType?: string | null };
  expectedToken: string;
}): Promise<AmendPlacedPlanResult> {
  const { clientId, coachId, planId, planPatch, expectedToken } = params;

  // 1. Load + verify the plan.
  const { data: plan, error: planError } = await supabaseAdmin
    .from("training_plans")
    .select("*")
    .eq("id", planId)
    .eq("client_id", clientId)
    .is("deleted_at", null)
    .maybeSingle();
  if (planError) throw new Error(`Failed to read plan: ${planError.message}`);
  if (!plan) throw new Error("Plan not found");
  if (plan.status === "archived") {
    throw new AmendmentValidationError(RETIRED_PLAN_MESSAGE);
  }

  // 2. Server-authoritative boundary math.
  const today = await getClientTodayString(clientId);
  const effectiveFrom = plan.effective_from;
  const floor = effectiveFrom > today ? effectiveFrom : today;
  const offset = differenceInDays(
    new Date(floor + "T00:00:00"),
    new Date(effectiveFrom + "T00:00:00"),
  );

  // 3. Drift token — recomputed over CURRENT DB state with the CURRENT window,
  //    exactly as the GET computed it. A fully-elapsed current window also stops
  //    here: extending an ended plan is blocked ("apply a new program" is the
  //    gesture — decision 8).
  const currentRows = await fetchSlotRows(planId);
  const currentWindowEnd = await calculatePlacementEndDate({
    clientId,
    slotCount: currentRows.length,
    startDate: effectiveFrom,
  });
  if (currentWindowEnd < floor) {
    throw new AmendmentEmptyFutureError(
      "This plan has already ended — apply a new program instead",
    );
  }
  const tokenCandidates = await fetchDeleteCandidates(clientId, planId, floor, currentWindowEnd);
  const recomputedToken = computeAmendmentToken({
    planUpdatedAt: plan.updated_at,
    clientToday: today,
    events: tokenCandidates,
  });
  if (recomputedToken !== expectedToken) {
    throw new AmendmentConflictError("This plan changed while you were editing");
  }

  // 4. Structural validation — the serializer emits a canonical grid
  //    (orderIndex = weekIndex*7+day); anything else corrupts the date-walk.
  const sessions = [...params.sessions].sort(
    (a, b) => (a.weekIndex ?? 0) - (b.weekIndex ?? 0) || a.orderIndex - b.orderIndex,
  );
  if (sessions.length % 7 !== 0) {
    throw new AmendmentValidationError("Program grid must be whole weeks (7 slots per week)");
  }
  for (let i = 0; i < sessions.length; i++) {
    if (sessions[i].orderIndex !== i || (sessions[i].weekIndex ?? 0) !== Math.floor(i / 7)) {
      throw new AmendmentValidationError(
        "Non-canonical program grid — slots must be ordered weekIndex*7+day",
      );
    }
  }
  if (offset >= sessions.length) {
    throw new AmendmentEmptyFutureError(
      "The amendment removes every remaining day of the plan",
    );
  }

  // 5. Recompute the window for the NEW grid (next-plan cap re-applied — a
  //    program can grow only into uncapped space).
  const windowEnd = await calculatePlacementEndDate({
    clientId,
    slotCount: sessions.length,
    startDate: effectiveFrom,
  });
  if (windowEnd < floor) {
    throw new AmendmentEmptyFutureError(
      "The plan window ends before today — nothing future to amend",
    );
  }

  // 6. Partition the slot list into FROZEN positions and rewritable ones.
  //
  //    A position is frozen when its day is already history — the same rule the
  //    editor locks on (`computeLockedSlotUids`), evaluated here against live DB
  //    state because the server is the boundary authority. The two must agree:
  //    when they disagreed, the editor locked a slot the writer went on to
  //    replace, and because the old row was ALSO kept (the event-reference belt)
  //    the plan ended up with two active rows claiming one day. Freezing the
  //    position — keep the row, skip the insert — is what closes that.
  const survivingEvents = await fetchAllPages<{
    training_session_id: string | null;
    date: string;
    status: string;
  }>(
    (from, to) =>
      supabaseAdmin
        .from("training_events")
        .select("training_session_id, date, status")
        .eq("training_plan_id", planId)
        .or(`date.lt.${floor},status.neq.scheduled`)
        .order("id", { ascending: true })
        .range(from, to),
    { errorLabel: "surviving events" },
  );
  const survivingSessionIds = new Set<string>();
  for (const e of survivingEvents) {
    if (e.training_session_id) survivingSessionIds.add(e.training_session_id);
  }

  const frozenPositions = new Set<number>();
  currentRows.forEach((row, position) => {
    if (position < offset || survivingSessionIds.has(row.id)) frozenPositions.add(position);
  });

  // Shrinking past a frozen position would delete a day the client has already
  // trained. The editor blocks it (canDeleteWeek refuses a week holding a locked
  // day); this is the server's mirror, not a new restriction.
  const lostFrozen = [...frozenPositions].filter((p) => p >= sessions.length);
  if (lostFrozen.length > 0) {
    throw new AmendmentEmptyFutureError(
      "The amendment removes a day the client has already trained",
    );
  }

  const keepIds = new Set<string>(
    [...frozenPositions].map((position) => currentRows[position].id),
  );
  const deactivateIds = currentRows.filter((r) => !keepIds.has(r.id)).map((r) => r.id);

  // 7. H3 snapshot of everything step 10 deletes, BEFORE any mutation.
  const snapshot = await fetchDeleteCandidates(clientId, planId, floor, windowEnd);

  // Capture the exercise ids that are active RIGHT NOW on the rows we are about
  // to deactivate — the compensator reactivates exactly these, never resurrecting
  // an exercise the coach had already soft-deleted.
  const deactivateExerciseIds = (
    await fetchAllByChunkedIds<{ id: string }, string>(
      deactivateIds,
      (chunk, from, to) =>
        supabaseAdmin
          .from("training_exercises")
          .select("id")
          .in("session_id", chunk)
          .eq("is_active", true)
          .order("id", { ascending: true })
          .range(from, to),
      { errorLabel: "deactivation exercises" },
    )
  ).map((r) => r.id);

  // Frozen positions keep their existing row, so no fresh row is minted for
  // them. Incoming content there is ignored exactly as it is for past positions;
  // the coach cannot have edited a frozen slot without the drift token catching
  // it first (the token hashes clientToday, so a midnight flip 409s, and a
  // mid-edit log drops that event out of fetchDeleteCandidates, which 409s too).
  const futureInputs = sessions
    .slice(offset)
    .filter((input) => !frozenPositions.has(input.orderIndex));
  const referencedExerciseIds = futureInputs.flatMap((s) =>
    s.exercises.map((e) => e.exerciseId).filter((id): id is string => Boolean(id)),
  );
  const visibleExerciseIds = await fetchVisibleExerciseIds(coachId, referencedExerciseIds);

  const freshSessionIds: string[] = [];
  const freshByPosition = new Map<number, { id: string; input: AmendSessionInput }>();

  try {
    // 8. Insert fresh future rows FIRST (placement clone shape) — an insert
    //    failure leaves the old rows fully intact.
    for (const input of futureInputs) {
      const surplus = input.isRest ? null : input.calorieSurplusPercentage ?? null;
      const { data: created, error: insertError } = await supabaseAdmin
        .from("training_sessions")
        .insert({
          plan_id: planId,
          name: input.isRest ? "Rest" : input.name,
          day_of_week: null,
          order_index: input.orderIndex,
          week_index: input.weekIndex ?? 0,
          is_rest: input.isRest,
          focus: input.isRest ? null : input.focus ?? null,
          notes: input.isRest ? null : input.notes ?? null,
          estimated_duration_minutes: input.estimatedDurationMinutes ?? null,
          calorie_surplus_percentage: surplus,
          is_active: true,
        })
        .select("id")
        .single();
      if (insertError || !created) {
        throw new Error(
          `Failed to create session "${input.name}": ${insertError?.message ?? "no row returned"}`,
        );
      }
      freshSessionIds.push(created.id);
      freshByPosition.set(input.orderIndex, { id: created.id, input });

      if (!input.isRest && input.exercises.length > 0) {
        // Verbatim splat — a copy's compact columns are already the correct
        // projection of its set_specs; never re-derive on a clone.
        const exerciseInserts = [...input.exercises]
          .sort((a, b) => a.orderIndex - b.orderIndex)
          .map((ex) => ({
            session_id: created.id,
            name: ex.name,
            exercise_id:
              ex.exerciseId && visibleExerciseIds.has(ex.exerciseId) ? ex.exerciseId : null,
            order_index: ex.orderIndex,
            sets: ex.sets,
            reps_min: ex.repsMin ?? null,
            reps_max: ex.repsMax ?? null,
            reps_target: ex.repsTarget ?? null,
            rpe_target: ex.rpeTarget ?? null,
            percentage_1rm: ex.percentage1rm ?? null,
            tempo: ex.tempo ?? null,
            rest_seconds: ex.restSeconds ?? null,
            notes: ex.notes ?? null,
            superset_group: ex.supersetGroup ?? null,
            is_warmup: ex.isWarmup ?? false,
            set_specs: (ex.setSpecs ?? null) as unknown as Json,
            video_url: ex.videoUrl ?? null,
            prescribed_fields: toPrescribedFields(ex.prescribedFields),
            is_active: true,
          }));
        const { error: exError } = await supabaseAdmin
          .from("training_exercises")
          .insert(exerciseInserts);
        if (exError) throw new Error(`Failed to create exercises: ${exError.message}`);
      }
    }

    // 9. Soft-delete the replaced rows (sessions + their currently-active
    //    exercises).
    for (const chunk of chunkIds(deactivateIds)) {
      const { error: deactivateError } = await supabaseAdmin
        .from("training_sessions")
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .in("id", chunk);
      if (deactivateError) {
        throw new Error(`Failed to retire sessions: ${deactivateError.message}`);
      }
    }
    for (const chunk of chunkIds(deactivateExerciseIds)) {
      const { error: exDeactivateError } = await supabaseAdmin
        .from("training_exercises")
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .in("id", chunk);
      if (exDeactivateError) {
        throw new Error(`Failed to retire exercises: ${exDeactivateError.message}`);
      }
    }

    // 10. Delete future SCHEDULED events — both predicates, no is_modified
    //     filter (manually-moved future events are re-laid; decision 6).
    const { error: planDeleteError } = await supabaseAdmin
      .from("training_events")
      .delete()
      .eq("training_plan_id", planId)
      .eq("status", "scheduled")
      .gte("date", floor);
    if (planDeleteError) {
      throw new Error(`Failed to clear plan events: ${planDeleteError.message}`);
    }
    const { error: windowDeleteError } = await supabaseAdmin
      .from("training_events")
      .delete()
      .eq("client_id", clientId)
      .eq("status", "scheduled")
      .gte("date", floor)
      .lte("date", windowEnd);
    if (windowDeleteError) {
      throw new Error(`Failed to clear window events: ${windowDeleteError.message}`);
    }

    // 11. Resume the shared date-walk at the elapsed offset. FROZEN positions
    //     keep their existing row — elapsed ones are never visited (the window
    //     can't wrap), and future frozen ones are visited but skipped, because
    //     the event that froze them already owns their day. Everything else is
    //     the fresh row. Every emitted event carries the surplus (the
    //     nutrition-cascade contract), name/focus snapshots, status scheduled.
    const programSlots: ProgramSlot[] = [];
    for (let i = 0; i < sessions.length; i++) {
      if (frozenPositions.has(i)) {
        const row = currentRows[i];
        programSlots.push({
          id: row.id,
          isRest: row.is_rest,
          name: row.name,
          focus: row.focus ?? null,
          calorieSurplusPercentage: row.calorie_surplus_percentage ?? null,
          estimatedCalories: row.estimated_calories ?? null,
        });
      } else {
        const fresh = freshByPosition.get(i);
        if (!fresh) throw new Error(`Missing fresh session at position ${i}`);
        programSlots.push({
          id: fresh.id,
          isRest: fresh.input.isRest,
          name: fresh.input.isRest ? "Rest" : fresh.input.name,
          focus: fresh.input.isRest ? null : fresh.input.focus ?? null,
          calorieSurplusPercentage: fresh.input.isRest
            ? null
            : fresh.input.calorieSurplusPercentage ?? null,
          estimatedCalories: null,
        });
      }
    }
    const eventsCreated = await generateProgramEvents({
      clientId,
      planId,
      programSlots,
      startDate: floor,
      endDate: windowEnd,
      startPosition: offset,
      // A frozen position's day is already represented by the event that froze
      // it. Left to the upsert arbiter this would only be a no-op while that
      // event still sits on its slot's own date; once it has been moved the
      // dates differ, nothing conflicts, and the session is written twice.
      skipPositions: frozenPositions,
    });

    // 12. Plan meta. The updated_at bump invalidates every other holder's token.
    //     effective_until stays untouched (plan resolution unchanged).
    const { error: metaError } = await supabaseAdmin
      .from("training_plans")
      .update({
        program_duration_weeks: sessions.length / 7,
        frequency_per_week: deriveFrequencyPerWeek(
          sessions.map((s) => ({ weekIndex: s.weekIndex, isRest: s.isRest })),
        ),
        ...(planPatch?.name !== undefined ? { name: planPatch.name } : {}),
        ...(planPatch?.splitType !== undefined
          ? { split_type: planPatch.splitType ?? "custom" }
          : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("id", planId);
    if (metaError) throw new Error(`Failed to update plan meta: ${metaError.message}`);

    return {
      planId,
      floor,
      offset,
      sessionsCreated: futureInputs.filter((s) => !s.isRest).length,
      eventsCreated,
      deactivatedSessions: deactivateIds.length,
    };
  } catch (err) {
    return await compensateAmendment({
      freshSessionIds,
      deactivateIds,
      deactivateExerciseIds,
      snapshot,
      rootErr: err,
    });
  }
}

// --- Compensation -------------------------------------------------------------

// Undo a failed amendment (mirrors compensatePlacement): remove the fresh rows
// (events first — the event FK is SET NULL, deleting sessions first would strand
// ghost events), reactivate exactly what step 9 retired, then restore the event
// snapshot. The restore upserts ignoring duplicates so a failure BEFORE the
// delete step (snapshot rows still present) stays clean. Never shadows the root
// cause — augments it if cleanup itself fails.
async function compensateAmendment(params: {
  freshSessionIds: string[];
  deactivateIds: string[];
  deactivateExerciseIds: string[];
  snapshot: TrainingEventRow[];
  rootErr: unknown;
}): Promise<never> {
  const { freshSessionIds, deactivateIds, deactivateExerciseIds, snapshot, rootErr } = params;
  const problems: string[] = [];

  for (const chunk of chunkIds(freshSessionIds)) {
    const { error } = await supabaseAdmin
      .from("training_events")
      .delete()
      .in("training_session_id", chunk);
    if (error) {
      problems.push(`event cleanup: ${error.message}`);
      break;
    }
  }
  for (const chunk of chunkIds(freshSessionIds)) {
    const { error } = await supabaseAdmin
      .from("training_exercises")
      .delete()
      .in("session_id", chunk);
    if (error) {
      problems.push(`exercise cleanup: ${error.message}`);
      break;
    }
  }
  for (const chunk of chunkIds(freshSessionIds)) {
    const { error } = await supabaseAdmin.from("training_sessions").delete().in("id", chunk);
    if (error) {
      problems.push(`session cleanup: ${error.message}`);
      break;
    }
  }

  for (const chunk of chunkIds(deactivateIds)) {
    const { error } = await supabaseAdmin
      .from("training_sessions")
      .update({ is_active: true, updated_at: new Date().toISOString() })
      .in("id", chunk);
    if (error) {
      problems.push(`session reactivation: ${error.message}`);
      break;
    }
  }
  for (const chunk of chunkIds(deactivateExerciseIds)) {
    const { error } = await supabaseAdmin
      .from("training_exercises")
      .update({ is_active: true, updated_at: new Date().toISOString() })
      .in("id", chunk);
    if (error) {
      problems.push(`exercise reactivation: ${error.message}`);
      break;
    }
  }

  for (let i = 0; i < snapshot.length; i += 500) {
    const chunk = snapshot.slice(i, i + 500) as unknown as TrainingEventInsert[];
    const { error } = await supabaseAdmin
      .from("training_events")
      .upsert(chunk, { ignoreDuplicates: true });
    if (error) {
      problems.push(`window restore: ${error.message}`);
      break;
    }
  }

  const rootMsg = rootErr instanceof Error ? rootErr.message : String(rootErr);
  if (problems.length > 0) {
    throw new Error(
      `${rootMsg}; amendment compensation incomplete (${problems.join("; ")}) — re-open the plan editor to verify the calendar window`,
    );
  }
  throw rootErr instanceof Error ? rootErr : new Error(rootMsg);
}
