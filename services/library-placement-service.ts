import { supabaseAdmin } from "./supabase-admin";
import { getSavedPlanById } from "./coach-saved-plan-service";
import { createTrainingPlanAtomic } from "./training-service";
import { cancelFutureEventsForPlans } from "./training-event-service";
import { deriveFrequencyPerWeek } from "./coach-library-helpers";
import {
  generateProgramEvents,
  expandProgramToWindow,
  resolvePlacementWindowEnd,
  type ProgramSession,
} from "./program-event-walk";
import {
  concatTrainingGroupRows,
  insertTrainingGroupRows,
  trainingGroupRowsFromCopy,
} from "./training-group-writes";
import {
  SAVED_SESSION_GROUPS_EMBED,
  mapSavedSessionTree,
  type SavedSessionTreeRow,
} from "@/lib/coach-mappers";
import type {
  TrainingEventInsert,
  TrainingEventRow,
  TrainingSessionInsert,
} from "@/lib/database-helpers";
import type { SavedSession, SavedExercise, SavedExerciseGroup } from "@/types/training";
import type { SetSpec } from "@/utils/exercise-set-specs";
import type { InlinePlanBody } from "@/lib/validations/training";
// Pure date maths, shared with the block chain rather than re-derived here —
// the block is what supplies this window's length.
import { inclusiveDays, weeksSpanned } from "@/lib/blocks/block-chain";
import { toPrescribedFields } from "@/utils/prescribed-fields";
import { sessionExercises } from "@/utils/exercise-groups";
import { programDays } from "@/utils/program-days";

/** Rows per INSERT statement — the placement clone can now run to hundreds. */
const INSERT_CHUNK = 500;

/**
 * The placement is on the calendar, but the earlier programs' sessions past
 * its window could not be removed. Raised AFTER the placement has committed
 * and never rolls it back: the route reports it with this message so the
 * coach knows the program landed and what is left to do.
 */
export class PlacementSupersedeError extends Error {}

/** The result every placement returns. */
type PlacementResult = {
  planId: string;
  sessionsCreated: number;
  eventsCreated: number;
};

/** The rows the placement RPC rewrites besides the new one: every live plan
 *  starting on or before the new start is capped at the day before it, and a
 *  same-day one archived (migration 167). Snapshotted before the RPC so a
 *  failed clone can put them back exactly. */
type EarlierPlanSnapshot = { id: string; effective_until: string; status: string };

async function snapshotEarlierPlans(
  clientId: string,
  startDate: string,
): Promise<EarlierPlanSnapshot[]> {
  const { data, error } = await supabaseAdmin
    .from("training_plans")
    .select("id, effective_until, status")
    .eq("client_id", clientId)
    .is("deleted_at", null)
    .neq("status", "archived")
    .lte("effective_from", startDate);
  if (error) throw new Error(`Failed to snapshot the client's earlier programs: ${error.message}`);
  return data ?? [];
}

// --- Shape used by both DB-backed and inline (in-memory) placements ---

// NOTE: no derived length or frequency metadata here. Placement reads the
// program's days and its sessions per week from the session rows (see
// placePlaceablePlanOnCalendar) — the session rows are the only truth about
// program shape.
type PlaceablePlan = {
  name: string;
  splitType: string | null;
  programDurationWeeks: number | null;
  defaultSurplusPercentage: number | null;
  sessions: SavedSession[];
};

// --- Place a saved plan onto a client's calendar ---

export async function placePlanOnCalendar(params: {
  savedPlanId: string;
  coachId: string;
  clientId: string;
  startDate: string;
}): Promise<PlacementResult> {
  const { savedPlanId, coachId, clientId, startDate } = params;

  // 1. Fetch saved plan with sessions + exercises
  const savedPlan = await getSavedPlanById(savedPlanId, coachId);
  if (!savedPlan) throw new Error("Saved plan not found");
  if (savedPlan.status !== "saved") throw new Error("Only saved plans can be placed on calendar");

  return placePlaceablePlanOnCalendar({
    plan: savedPlan,
    savedPlanId,
    coachId,
    clientId,
    startDate,
  });
}

// --- Place an EDITED working copy (not a saved template) onto a calendar ---

/**
 * Apply-without-overwrite: materialize a coach's edited working copy onto a
 * client's calendar WITHOUT mutating the library template. Stamps
 * saved_plan_id = NULL — an edited copy is not a copy of any single template, so
 * it carries no template link (this is both IDOR-safe, since no body-supplied
 * template id is trusted, and semantically honest; see the Phase 1 plan). Any
 * exercise_id from the (client-tampered) working copy that isn't in the coach's
 * own+global catalog is nulled before it is written.
 */
export async function placeInlineEditedPlanOnCalendar(params: {
  plan: InlinePlanBody;
  coachId: string;
  clientId: string;
  startDate: string;
}): Promise<PlacementResult> {
  const { plan, coachId, clientId, startDate } = params;

  const referencedExerciseIds = plan.sessions.flatMap((s) =>
    sessionExercises(s)
      .map((e) => e.exerciseId)
      .filter((id): id is string => Boolean(id)),
  );
  const ownedExerciseIds = await fetchVisibleExerciseIds(coachId, referencedExerciseIds);

  const placeable: PlaceablePlan = {
    name: plan.name,
    splitType: plan.splitType ?? null,
    programDurationWeeks: plan.programDurationWeeks ?? null,
    defaultSurplusPercentage: plan.defaultSurplusPercentage ?? null,
    sessions: plan.sessions.map((s) => inlineSessionToSaved(s, ownedExerciseIds)),
  };

  return placePlaceablePlanOnCalendar({
    plan: placeable,
    savedPlanId: null, // edited copy -> no template link (IDOR-safe + honest)
    coachId,
    clientId,
    startDate,
  });
}

// Max ids per `.in()` request. Neither `sessions[]` nor `exercises[]` is capped
// by the zod schema, so a long program's id list must be chunked to stay under
// the PostgREST request-line length ceiling.
const EXERCISE_ID_CHUNK = 150;

/**
 * Of `referencedIds`, the subset the coach may actually reference (their own +
 * the global catalog).
 *
 * Inverted on purpose. The previous shape loaded the WHOLE catalog and checked
 * membership, which silently truncated at PostgREST's 1000-row cap — the global
 * tier alone is 1512 rows, so ~512 valid ids fell out of the set and were nulled
 * as "foreign" on every placement, unrecoverably. Filtering by the ids this plan
 * actually references is bounded by plan size, not catalog size, and stays
 * correct at any scale. Same shape as coach-standalone-session-service.ts:67.
 *
 * Exported for the plan editor's save, which applies the same foreign-id belt
 * to the days it writes.
 */
export async function fetchVisibleExerciseIds(
  coachId: string,
  referencedIds: string[],
): Promise<Set<string>> {
  const unique = [...new Set(referencedIds)];
  const visible = new Set<string>();

  for (let i = 0; i < unique.length; i += EXERCISE_ID_CHUNK) {
    const chunk = unique.slice(i, i + EXERCISE_ID_CHUNK);
    const { data, error } = await supabaseAdmin
      .from("exercises")
      .select("id")
      .in("id", chunk)
      .or(`coach_id.eq.${coachId},coach_id.is.null`);
    if (error) throw new Error(`Failed to validate exercise ids: ${error.message}`);
    for (const row of data ?? []) visible.add(row.id);
  }

  return visible;
}

// Map a validated inline-body session/group/exercise to the SavedSession shape
// placePlaceablePlanOnCalendar consumes. Ids/timestamps are placeholders — the
// placement inserts fresh rows and never reads the source ids — and positions
// are array places. A foreign exercise_id (not in the coach's own+global
// catalog) is nulled.
function inlineSessionToSaved(
  s: InlinePlanBody["sessions"][number],
  ownedExerciseIds: Set<string>,
): SavedSession {
  return {
    id: "",
    coachId: "",
    savedPlanId: null,
    name: s.name,
    focus: s.focus ?? null,
    orderIndex: s.orderIndex,
    weekIndex: s.weekIndex ?? 0,
    dayOrder: s.dayOrder,
    isRest: s.isRest,
    estimatedDurationMinutes: s.estimatedDurationMinutes ?? null,
    calorieSurplusPercentage: s.calorieSurplusPercentage ?? null,
    notes: s.notes ?? null,
    // SavedSessionType is the single literal 'training'; the placement path
    // doesn't read this field anyway (it clones into training_sessions).
    sessionType: "training",
    groups: s.groups.map((group, groupIndex): SavedExerciseGroup => ({
      id: "",
      savedSessionId: "",
      orderIndex: groupIndex,
      format: group.format,
      rounds: group.rounds ?? null,
      timeCapSeconds: group.timeCapSeconds ?? null,
      intervalSeconds: group.intervalSeconds ?? null,
      restBetweenExercisesSeconds: group.restBetweenExercisesSeconds ?? null,
      restBetweenRoundsSeconds: group.restBetweenRoundsSeconds ?? null,
      notes: group.notes ?? null,
      exercises: group.exercises.map((e, exerciseIndex) =>
        inlineExerciseToSaved(e, exerciseIndex, ownedExerciseIds),
      ),
    })),
    createdAt: "",
    updatedAt: "",
  };
}

function inlineExerciseToSaved(
  e: InlinePlanBody["sessions"][number]["groups"][number]["exercises"][number],
  orderIndex: number,
  ownedExerciseIds: Set<string>,
): SavedExercise {
  return {
    id: "",
    savedSessionId: "",
    groupId: "",
    exerciseId: e.exerciseId && ownedExerciseIds.has(e.exerciseId) ? e.exerciseId : null,
    name: e.name,
    orderIndex,
    sets: e.sets,
    repsMin: e.repsMin ?? null,
    repsMax: e.repsMax ?? null,
    repsTarget: e.repsTarget ?? null,
    rpeTarget: e.rpeTarget ?? null,
    percentage1rm: e.percentage1rm ?? null,
    tempo: e.tempo ?? null,
    restSeconds: e.restSeconds ?? null,
    isWarmup: e.isWarmup ?? false,
    notes: e.notes ?? null,
    setSpecs: (e.setSpecs ?? null) as SetSpec[] | null,
    videoUrl: e.videoUrl ?? null,
    prescribedFields: toPrescribedFields(e.prescribedFields),
    createdAt: "",
    updatedAt: "",
  };
}

// H3 recoverability: `createTrainingPlanAtomic` commits its window DELETE +
// plan INSERT, then the service clones sessions and generates events OUTSIDE any
// transaction. A failure between them would leave the client's scheduled events
// deleted with nothing (or a partial plan) to replace them. Snapshot the
// scheduled events the RPC is about to delete BEFORE calling it, and restore
// them if the post-RPC work throws. Best-effort: a hard process kill between the
// RPC and the catch still loses the window (repair = re-place, event gen is an
// idempotent upsert). Bounded to <= ~1yr of events by the H5 window cap; paged.
async function snapshotWindowEvents(
  clientId: string,
  from: string,
  to: string,
): Promise<TrainingEventRow[]> {
  const rows: TrainingEventRow[] = [];
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabaseAdmin
      .from("training_events")
      .select("*")
      .eq("client_id", clientId)
      .eq("status", "scheduled")
      .gte("date", from)
      .lte("date", to)
      .order("id", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) {
      throw new Error(`Failed to snapshot placement window: ${error.message}`);
    }
    if (!Array.isArray(data) || data.length === 0) break;
    rows.push(...(data as TrainingEventRow[]));
    if (data.length < PAGE) break;
  }
  return rows;
}

// Undo a failed placement: remove the partially-created plan (events FIRST — the
// event->plan FK is ON DELETE SET NULL, so deleting the plan first would strand
// ghost events), then restore the pre-RPC window snapshot. Never shadows the
// root cause — on a cleanup failure it augments the thrown message with the
// repair path.
async function compensatePlacement(params: {
  newPlanId: string;
  snapshot: TrainingEventRow[];
  earlierPlans: EarlierPlanSnapshot[];
  rootErr: unknown;
}): Promise<never> {
  const { newPlanId, snapshot, earlierPlans, rootErr } = params;
  const problems: string[] = [];

  const { error: evErr } = await supabaseAdmin
    .from("training_events")
    .delete()
    .eq("training_plan_id", newPlanId);
  if (evErr) problems.push(`event cleanup: ${evErr.message}`);

  const { error: planErr } = await supabaseAdmin
    .from("training_plans")
    .delete()
    .eq("id", newPlanId);
  if (planErr) problems.push(`plan cleanup: ${planErr.message}`);

  // The RPC capped the earlier programs at the day before the start and
  // archived a same-day one (migration 167); with the new plan gone their
  // windows are theirs again. Row by row: this path is rare, and a partial
  // restore is named below rather than hidden.
  for (const earlier of earlierPlans) {
    const { error: restoreErr } = await supabaseAdmin
      .from("training_plans")
      .update({ effective_until: earlier.effective_until, status: earlier.status })
      .eq("id", earlier.id);
    if (restoreErr) {
      problems.push(`earlier plan restore (${earlier.id}): ${restoreErr.message}`);
    }
  }

  // The window is now clear of scheduled events (RPC deleted the old ones; the
  // step above deleted the new plan's). Re-insert the snapshot verbatim.
  for (let i = 0; i < snapshot.length; i += 500) {
    const chunk = snapshot.slice(i, i + 500) as unknown as TrainingEventInsert[];
    const { error: restoreErr } = await supabaseAdmin
      .from("training_events")
      .insert(chunk);
    if (restoreErr) {
      problems.push(`window restore: ${restoreErr.message}`);
      break;
    }
  }

  const rootMsg = rootErr instanceof Error ? rootErr.message : String(rootErr);
  if (problems.length > 0) {
    throw new Error(
      `${rootMsg}; placement compensation incomplete (${problems.join("; ")}) — re-place the plan to repair the calendar window`,
    );
  }
  throw rootErr instanceof Error ? rootErr : new Error(rootMsg);
}

async function placePlaceablePlanOnCalendar(params: {
  plan: PlaceablePlan;
  savedPlanId: string | null;
  coachId: string;
  clientId: string;
  startDate: string;
}): Promise<PlacementResult> {
  const {
    plan: savedPlan,
    savedPlanId,
    coachId,
    clientId,
    startDate,
  } = params;

  // The whole authored program as its days (utils/program-days.ts): every
  // week's days in order, each holding its sessions in the day's order, placed
  // exactly once. A rest day holds none; it is cloned as its rest row so the
  // placed plan is self-describing about rest, and the walk below emits events
  // for sessions only. Every day is a real row or rows — a missing rest row
  // would collapse the week.
  const authoredDays = programDays(savedPlan.sessions);

  // 2. Compute the incoming plan's own window end FIRST (capped at the next
  //    coexisting plan's start). It bounds BOTH the RPC's additive delete and the
  //    event generation below to exactly the same range, so re-placing the same
  //    window is idempotent and non-overlapping plans coexist untouched.
  //
  //    The LENGTH is the block covering the start date when there is one, else
  //    the program's own day count. So the block is the length knob: a program
  //    shorter than its block repeats to fill it, a longer one is cut at its end.
  const endDate = await resolvePlacementWindowEnd({
    clientId,
    dayCount: authoredDays.length,
    startDate,
  });

  //    The days actually placed: the authored program repeated until it covers
  //    the window, then cut. Each cycle is CLONED below, never shared, so cycle
  //    three can be progressed past cycle one.
  const windowDays = expandProgramToWindow(
    authoredDays,
    inclusiveDays(startDate, endDate),
  );

  // H3: snapshot the scheduled events the RPC is about to delete, BEFORE it
  // commits, so a failure in the non-transactional clone/event-gen below can
  // restore them. Floor at startDate (a superset of the RPC's GREATEST(from,
  // today) delete) so the restore is exact regardless of the today boundary.
  const windowSnapshot = await snapshotWindowEvents(clientId, startDate, endDate);
  const earlierPlans = await snapshotEarlierPlans(clientId, startDate);

  // 3. Insert the new plan as provenance with its window on the row, clear its
  //    own future window, cap every earlier live program at the day before the
  //    start and archive a same-day one — one transaction (migration 167). The
  //    earlier programs' sessions PAST this window are removed after the
  //    commit, in step 6.
  const newPlanId = await createTrainingPlanAtomic({
    clientId,
    coachId,
    name: savedPlan.name,
    description: undefined,
    coachPrompt: "",
    splitType: savedPlan.splitType || "custom",
    // Sessions per week, from the program's own rows — a day can hold several,
    // so a week can hold more than seven.
    frequencyPerWeek: deriveFrequencyPerWeek(savedPlan.sessions),
    // The PLACED length, not the authored one: with the block as the length knob
    // a 4-week program can occupy a 12-week window, and the Overview's plan chip
    // derives its "Ended" date from this column — left at the authored value it
    // would contradict the calendar.
    programDurationWeeks: weeksSpanned(startDate, endDate),
    effectiveFrom: startDate,
    windowEnd: endDate,
    // null -> inline placement (edited working copy), don't link back to any
    // library template. The helper normalizes falsy values to null for the RPC.
    savedPlanId: savedPlanId ?? undefined,
  });

  // Everything below runs OUTSIDE the RPC's committed transaction. On any
  // failure, undo the partial plan and restore the pre-RPC window snapshot (H3).
  try {
  // 4. Clone EVERY day in program order: a rest day as its rest row (no
  //    exercises, null surplus), a training day as one row per session at its
  //    place in the day (day_order). Every row's id is minted here, so its
  //    groups and its calendar entry name it before anything is written and
  //    nothing is matched back from RETURNING (Postgres does not promise it
  //    follows the VALUES order) — a day's sessions share its position, so no
  //    coordinate could tell them apart. `placedDays` is the ordered program the
  //    event walk maps onto calendar dates.
  //
  //    BATCHED, not one insert per row. With the block as the length knob a
  //    short program repeats to fill a long block — a one-week program in a
  //    52-week block is 364 days, more rows when its days hold several sessions —
  //    and a round trip each would take the placement past any request budget.
  //    Chunked because a single statement of unbounded width is its own problem.
  const sessionRows: TrainingSessionInsert[] = [];
  const groupRows: ReturnType<typeof trainingGroupRowsFromCopy>[] = [];
  const placedDays: ProgramSession[][] = windowDays.map((day) => {
    const place = {
      plan_id: newPlanId,
      day_of_week: null,
      order_index: day.orderIndex,
      week_index: day.weekIndex,
      notes: null,
      is_active: true,
    };
    if (day.sessions.length === 0) {
      sessionRows.push({
        ...place,
        id: crypto.randomUUID(),
        name: "Rest",
        day_order: 0,
        is_rest: true,
        focus: null,
        estimated_duration_minutes: null,
        calorie_surplus_percentage: null,
      });
      return [];
    }
    return day.sessions.map((session, dayOrder): ProgramSession => {
      const id = crypto.randomUUID();
      const surplus =
        session.calorieSurplusPercentage ?? savedPlan.defaultSurplusPercentage ?? null;
      sessionRows.push({
        ...place,
        id,
        name: session.name,
        day_order: dayOrder,
        is_rest: false,
        focus: session.focus ?? null,
        estimated_duration_minutes: session.estimatedDurationMinutes ?? null,
        calorie_surplus_percentage: surplus,
      });
      // Groups and their exercises, in their order. Splat the per-set model
      // verbatim — the source row's compact columns are already the correct
      // projection of its set_specs.
      if (session.groups.length > 0) {
        groupRows.push(trainingGroupRowsFromCopy(id, session.groups));
      }
      return {
        id,
        name: session.name,
        focus: session.focus ?? null,
        calorieSurplusPercentage: surplus,
        estimatedCalories: null,
      };
    });
  });

  for (let from = 0; from < sessionRows.length; from += INSERT_CHUNK) {
    const { error: sessionError } = await supabaseAdmin
      .from("training_sessions")
      .insert(sessionRows.slice(from, from + INSERT_CHUNK));
    if (sessionError) {
      throw new Error(`Failed to clone the program's sessions: ${sessionError.message}`);
    }
  }

  try {
    await insertTrainingGroupRows(concatTrainingGroupRows(groupRows));
  } catch (cloneError) {
    const detail = cloneError instanceof Error ? cloneError.message : String(cloneError);
    throw new Error(`Failed to clone exercises: ${detail}`);
  }

  // 5. Generate the events (same window the RPC just cleared). A rest day
  //    advances the walk but emits no event; a day's sessions land on its date
  //    in the day's order.
  const eventsCreated = await generateProgramEvents({
    clientId,
    planId: newPlanId,
    programDays: placedDays,
    startDate,
    endDate,
  });

  // 6. Supersede: the earlier programs' sessions from the start day onward go
  //    — inside the window the RPC already removed them, past it they are the
  //    stale tail a block carved out of a longer program used to leave. Logged
  //    days are detached, not deleted. The placement is committed by now, so a
  //    failure here is reported as such and never compensated.
  await cancelFutureEventsForPlans(
    earlierPlans.map((plan) => plan.id),
    startDate,
  ).catch((err: unknown) => {
    const detail = err instanceof Error ? err.message : String(err);
    throw new PlacementSupersedeError(
      `The program is on the calendar, but the previous program's sessions from ${startDate} could not be removed (${detail}). Delete them from the calendar, or place the program again.`,
    );
  });

  return {
    planId: newPlanId,
    sessionsCreated: placedDays.reduce((sum, day) => sum + day.length, 0),
    eventsCreated,
  };
  } catch (err) {
    // A supersede failure is not a failed placement: the plan is committed and
    // the message says so. Everything else restores the calendar to its
    // pre-placement state, then rethrows (never shadows the root cause;
    // augments it if cleanup itself fails).
    if (err instanceof PlacementSupersedeError) throw err;
    return await compensatePlacement({
      newPlanId,
      snapshot: windowSnapshot,
      earlierPlans,
      rootErr: err,
    });
  }
}

// --- Place a single saved session onto a client's calendar ---

export async function placeSessionOnCalendar(params: {
  savedSessionId: string;
  coachId: string;
  clientId: string;
  planId: string;
  targetDate: string;
}): Promise<{ sessionId: string; eventId: string }> {
  const { savedSessionId, coachId, clientId, planId, targetDate } = params;

  // 1. Fetch saved session with its groups and exercises
  const { data: savedSessionRow, error: fetchError } = await supabaseAdmin
    .from("coach_saved_sessions")
    .select(`*, ${SAVED_SESSION_GROUPS_EMBED}`)
    .eq("id", savedSessionId)
    .eq("coach_id", coachId)
    .single();

  if (fetchError || !savedSessionRow) throw new Error("Saved session not found");
  const savedSession = savedSessionRow as SavedSessionTreeRow;

  // 2. Resolve the slot position from the TARGET plan, never the template.
  //    A saved session's (week_index, order_index) describe where it sat in the
  //    program it was authored in; carried into a different plan they are
  //    meaningless. week_index is the dangerous one: the client read treats a
  //    plan as self-describing if ANY entry has week_index > 0, so one dropped
  //    session could flip a whole flat plan onto that branch and change how
  //    every rest day renders. An ad-hoc drop appends after the plan's last slot.
  //    Beside it, the last session already on the target day: a day can hold
  //    several sessions, and a dropped one joins it after them. Both are read
  //    before anything is cloned, so a failed read leaves no orphan rows.
  const [
    { data: lastSlot, error: slotError },
    { data: lastOnDay, error: dayError },
  ] = await Promise.all([
    supabaseAdmin
      .from("training_sessions")
      .select("week_index, order_index")
      .eq("plan_id", planId)
      .eq("is_active", true)
      .order("week_index", { ascending: false })
      .order("order_index", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabaseAdmin
      .from("training_events")
      .select("day_order")
      .eq("client_id", clientId)
      .eq("date", targetDate)
      .order("day_order", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (slotError) {
    throw new Error(`Failed to resolve plan slot position: ${slotError.message}`);
  }
  if (dayError) {
    throw new Error(`Failed to read the day's sessions: ${dayError.message}`);
  }

  const weekIndex = lastSlot?.week_index ?? 0;
  const orderIndex = (lastSlot?.order_index ?? -1) + 1;

  // 4. Clone session
  const { data: clonedSession, error: sessionError } = await supabaseAdmin
    .from("training_sessions")
    .insert({
      plan_id: planId,
      name: savedSession.name,
      day_of_week: null,
      order_index: orderIndex,
      week_index: weekIndex,
      is_rest: false,
      focus: savedSession.focus ?? null,
      notes: savedSession.notes ?? null,
      estimated_duration_minutes: savedSession.estimated_duration_minutes ?? null,
      calorie_surplus_percentage: savedSession.calorie_surplus_percentage ?? null,
      is_active: true,
    })
    .select("id")
    .single();

  if (sessionError || !clonedSession) {
    throw new Error(`Failed to clone session: ${sessionError?.message}`);
  }

  // 5. Clone its groups and their exercises, in order
  try {
    await insertTrainingGroupRows(
      trainingGroupRowsFromCopy(clonedSession.id, mapSavedSessionTree(savedSession).groups),
    );
  } catch (cloneError) {
    const detail = cloneError instanceof Error ? cloneError.message : String(cloneError);
    throw new Error(`Failed to clone exercises: ${detail}`);
  }

  // 6. Create single event, last on its day
  const { data: event, error: eventError } = await supabaseAdmin
    .from("training_events")
    .insert({
      client_id: clientId,
      training_plan_id: planId,
      training_session_id: clonedSession.id,
      date: targetDate,
      day_order: (lastOnDay?.day_order ?? -1) + 1,
      session_name: savedSession.name,
      session_focus: savedSession.focus ?? null,
      calorie_surplus_percentage: savedSession.calorie_surplus_percentage ?? null,
      status: "scheduled",
      is_modified: true,
    })
    .select("id")
    .single();

  if (eventError || !event) {
    throw new Error(`Failed to create event: ${eventError?.message}`);
  }

  return { sessionId: clonedSession.id, eventId: event.id };
}

// The date-walk (generateProgramEvents) and the window cap (resolveWindowCap)
// live in ./program-event-walk; the cap is shared with the plan editor, which
// keeps an edited program inside the same bound.
