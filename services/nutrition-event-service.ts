import { supabaseAdmin } from "./supabase-admin";
import type { NutritionEventInsert } from "@/lib/database-helpers";
import type { TrainingPlan } from "@/types/training";
import { addDaysToDateString, expandDateRange } from "@/lib/date-helpers";
import { getClientTodayString } from "@/services/today-service";
import { getActiveNutritionPlanVersionsOverlapping } from "@/services/nutrition-plan-service";
import { getEventsForDateRange } from "@/services/training-event-service";
import {
  nutritionDayOfWeek,
  resolveNutritionDay,
  type NutritionDayGridRow,
} from "@/services/nutrition-day-resolver";
import { captureApiError } from "@/lib/error-handler";
import { resolveEventDeletionFloor } from "@/services/event-deletion-floor";

// --- Plan metadata for event generation ---

type PlanInput = {
  baselineCalories: number;
  proteinTargetG: number;
  dietType: string;
};

type StoredDailyTarget = {
  day_of_week: string;
  calories: number;
  protein_g: number;
  carb_g: number;
  fat_g: number;
  is_training_day: boolean;
};

// --- Generate events ---

/**
 * Generate nutrition events for a plan within a date range.
 * Creates one event row per date with baseline macros + burn fields.
 * Uses upsert with overwrite on conflict (new plan values always win).
 *
 * Every number on a row comes from `resolveNutritionDay` — the same function
 * every reader now computes a day from — so what this writes and what a reader
 * shows agree by construction. The day table is read by nothing any more; this
 * writer survives only until its callers are removed.
 */
export async function generateNutritionEvents(
  clientId: string,
  planId: string,
  plan: PlanInput,
  dailyTargetRows: StoredDailyTarget[] | null,
  trainingPlan: TrainingPlan | null,
  dates: string[]
): Promise<void> {
  // An explicit date LIST, not a [start, end] range: a narrow cascade (a move, a
  // duplicate, one surplus edit) rewrites exactly the days it changed and leaves
  // the gaps alone. Contiguous callers expand their range with expandDateRange.
  const orderedDates = Array.from(new Set(dates)).sort();
  if (orderedDates.length === 0) return;

  const rangeStart = orderedDates[0];
  const rangeEnd = orderedDates[orderedDates.length - 1];

  // Fetch training events for burn calculation. Bracketed by the list's extremes
  // rather than queried per date — the per-date map below only reads the dates we
  // are actually writing, so a scattered list over-reads but never over-writes.
  const trainingEvents = await getEventsForDateRange(clientId, rangeStart, rangeEnd);

  // Build date → training events map
  const trainingEventsByDate = new Map<string, typeof trainingEvents>();
  for (const event of trainingEvents) {
    const dateKey = event.date.split("T")[0];
    const existing = trainingEventsByDate.get(dateKey) ?? [];
    existing.push(event);
    trainingEventsByDate.set(dateKey, existing);
  }

  // Build day-of-week → grid row map, in the resolver's shape.
  const gridRowByDay = new Map<string, NutritionDayGridRow>(
    (dailyTargetRows || []).map((dt) => [
      dt.day_of_week,
      {
        calories: dt.calories,
        proteinG: Number(dt.protein_g),
        carbG: Number(dt.carb_g),
        fatG: Number(dt.fat_g),
      },
    ])
  );

  // Iterate dates: resolve each day, then map the DTO back to the insert row.
  // The generator never writes an edited day (they are filtered below), so the
  // resolver is handed no edit; the stamped coach note is re-supplied below
  // from the existing row, not resolved here.
  const rows: NutritionEventInsert[] = [];

  for (const dateStr of orderedDates) {
    const day = resolveNutritionDay({
      clientId,
      date: dateStr,
      version: { id: planId, ...plan },
      gridRow: gridRowByDay.get(nutritionDayOfWeek(dateStr)) ?? null,
      trainingEvents: trainingEventsByDate.get(dateStr) ?? [],
      edit: null,
      coachNote: null,
    });

    rows.push({
      client_id: day.clientId,
      nutrition_plan_id: day.nutritionPlanId,
      date: day.date,
      day_of_week: day.dayOfWeek,
      baseline_calories: day.baselineCalories,
      training_burn_calories: day.trainingBurnCalories,
      protein_g: day.proteinG,
      carb_g: day.carbG,
      fat_g: day.fatG,
      diet_type: day.dietType,
      is_training_day: day.isTrainingDay,
      calorie_surplus_percentage: day.calorieSurplusPercentage,
      status: "scheduled",
    });
  }

  if (rows.length === 0) return;

  // One read, two jobs.
  //
  // (1) Preserve coach-edited days: an is_modified override that survived the
  // cascade delete must not be clobbered by this client-scoped
  // onConflict(client_id,date) upsert. Key on client_id + date range (NOT
  // nutrition_plan_id) — the conflict key is client-scoped, so an override
  // owned by a different plan in this window must still be protected.
  //
  // (2) Carry coach notes forward. Annotated days deliberately survive the
  // cascade delete, so they reach this upsert as a conflict and their targets
  // are rewritten. `coach_note` is set EXPLICITLY on every row below rather
  // than omitted-and-assumed-preserved: PostgREST builds its DO UPDATE SET
  // list from the payload keys, so omission would happen to work, but a
  // behaviour this easy to lose to a library change deserves to be stated.
  //
  // A failed read must NOT silently overwrite an edit or drop a note, so throw
  // (consistent with the delete/plan/targets/upsert errors here).
  //
  // Keyed on the exact date list, not [min,max] — a scattered narrow cascade must
  // not read (or reason about) days it is not writing.
  const { data: existingDays, error: protectedErr } = await supabaseAdmin
    .from("nutrition_events")
    .select("date, is_modified, coach_note")
    .eq("client_id", clientId)
    .in("date", orderedDates);

  if (protectedErr) throw protectedErr;

  const protectedDates = new Set(
    (existingDays ?? []).filter((r) => r.is_modified).map((r) => r.date)
  );
  const noteByDate = new Map(
    (existingDays ?? [])
      .filter((r) => r.coach_note != null)
      .map((r) => [r.date, r.coach_note as string])
  );

  const rowsToUpsert = (protectedDates.size
    ? rows.filter((r) => !protectedDates.has(r.date))
    : rows
  ).map((r) => ({ ...r, coach_note: noteByDate.get(r.date) ?? null }));

  if (rowsToUpsert.length === 0) return;

  // Upsert with overwrite on conflict (no ignoreDuplicates — new plan values always win)
  // supabaseAdmin: system-level write for event generation
  const { error } = await supabaseAdmin
    .from("nutrition_events")
    .upsert(rowsToUpsert, { onConflict: "client_id,date" });

  if (error) throw error;
}

// --- Regenerate future events ---

/**
 * Which dates a regeneration covers. Both kinds are clamped to the version's
 * own [effective_from, effective_until] window: the window IS the row
 * (migration 166), nothing resolves a horizon per call, and nothing bounds a
 * version but its own end.
 *
 * - `dates` — exactly these days. Pure upsert, NO delete: the conflict key is
 *   (client_id, date) and the generator already skips `is_modified` days and
 *   carries `coach_note` forward, so the delete bought nothing here and only
 *   opened a four-round-trip window in which those dates had no row at all
 *   (`getPlanTargetForDate` returns null for a missing row, and that null is
 *   snapshotted permanently into `nutrition_logs`).
 * - `from` — a floor; the version regenerates
 *   `[max(from, effective_from), effective_until]`, and its DELETE covers
 *   exactly that range. That equality is load-bearing: an unbounded delete
 *   paired with a bounded regenerate once deleted a tail it never rebuilt.
 * - `to` — how far the CASCADE's gap sweep reaches, for a caller that has just
 *   deleted training rows past every version's end: the plan-clear routes
 *   cancel a program's ENTIRE forward event ray, so every nutrition day that
 *   carried one of those events has to be rebuilt or removed, or it keeps a
 *   training surplus for a workout that no longer exists. A version never
 *   writes past its own end, so `to` widens the sweep and nothing else — and it
 *   only ever widens.
 */
export type NutritionRegenScope =
  | { kind: "dates"; dates: string[] }
  | { kind: "from"; from: string; to?: string };

/** The one place a scope becomes a concrete date list — inside the window. */
function datesInsideWindow(
  scope: NutritionRegenScope,
  effectiveFrom: string,
  effectiveUntil: string
): string[] {
  if (scope.kind === "dates") {
    return scope.dates.filter((d) => d >= effectiveFrom && d <= effectiveUntil);
  }
  const start = scope.from > effectiveFrom ? scope.from : effectiveFrom;
  return start > effectiveUntil ? [] : expandDateRange(start, effectiveUntil);
}

/**
 * Regenerate a plan VERSION's scheduled nutrition events over an explicit
 * scope, clamped to the version's own [effective_from, effective_until]
 * window — the window stored on the row at save (migration 166). Past events
 * and non-scheduled events (logged, missed) are preserved by the delete; the
 * upsert then overwrites any surviving row on a covered date with this
 * version's values (see ARCHITECTURE.md → Training → Nutrition cascade for
 * what that means for logged rows).
 */
export async function regenerateFutureNutritionEvents(
  clientId: string,
  planId: string,
  scope?: NutritionRegenScope
): Promise<void> {
  const resolvedScope: NutritionRegenScope =
    scope ?? { kind: "from", from: await getClientTodayString(clientId) };

  // The version FIRST (window columns included, error surfaced — a failed read
  // must never masquerade as "no plan"). Its window is the whole segmentation
  // story: this version can only ever write or delete inside it, so the cascade
  // hands the SAME scope to every version with days in range and each
  // regenerates exactly its own slice. A save's regenerate reads the window the
  // RPC just wrote, so a version laid in a block writes to the block's end and
  // not a day further.
  const { data: planRow, error: planError } = await supabaseAdmin
    .from("nutrition_plans")
    .select("baseline_calories, protein_target_g, diet_type, effective_from, effective_until")
    .eq("id", planId)
    .single();

  if (planError || !planRow) throw planError ?? new Error("Nutrition plan not found");

  // Resolve the dates BEFORE any write. The old code deleted first and only
  // then hit its range guard — an early return after a delete would clear the
  // window without regenerating it, turning a no-op into a wipe.
  const dates = datesInsideWindow(resolvedScope, planRow.effective_from, planRow.effective_until);
  if (dates.length === 0) return;

  // A `dates` scope skips the delete entirely (see NutritionRegenScope). A
  // `from` scope deletes over exactly the clamped range it is about to
  // regenerate — the upper bound is load-bearing: an unbounded ray paired
  // with the bounded regeneration below meant any cascade anchored
  // EARLIER than the anchor that wrote the rows deleted a tail it never
  // rebuilt. CLIENT-scoped since 1b.2: rows inside this version's window may
  // still carry a PRIOR version's id (or NULL after a version delete), and a
  // plan-id-scoped delete silently missed them — the clamp is what makes the
  // wider scoping safe, because this statement can never reach another
  // version's era.
  //
  // Always preserve coach-edited days (is_modified): nutrition preserves edits
  // across the cascade unconditionally (no force param, unlike training); an
  // explicit reset clears the flag before regenerating that date.
  //
  // Annotated days survive the delete too (`coach_note IS NULL`), and their
  // targets are still rewritten by the upsert below — a coach note describes
  // WHY the prescription changed on that date, so it must outlive the next
  // prescription change. Without this, any later training cascade anchored on
  // or before an annotated date would silently erase the note.
  if (resolvedScope.kind === "from") {
    const { error: deleteError } = await supabaseAdmin
      .from("nutrition_events")
      .delete()
      .eq("client_id", clientId)
      .gte("date", dates[0])
      .lte("date", dates[dates.length - 1])
      .eq("status", "scheduled")
      .eq("is_modified", false)
      .is("coach_note", null);

    if (deleteError) throw deleteError;
  }

  // Fetch daily target rows
  const { data: dailyTargetRows, error: targetsError } = await supabaseAdmin
    .from("nutrition_plan_daily_targets")
    .select("day_of_week, calories, protein_g, carb_g, fat_g, is_training_day")
    .eq("nutrition_plan_id", planId);

  if (targetsError) throw targetsError;

  // `nutrition_plan_daily_targets.is_training_day` is no longer synced here.
  // Under the current architecture training sessions live on dates (via
  // training_events), not days of week — getTrainingDays() used to read
  // session.dayOfWeek which is always null now, producing stale Mon/Tue/Thu/Fri
  // defaults and wrong badges. Display paths now derive isTrainingDay from the
  // actual event rows (the coach calendar reads them directly; the client
  // program card goes through buildDailyTargetsFromPlan), so the stored column
  // is no longer read. The per-date `nutrition_events.is_training_day`
  // written below by generateNutritionEvents remains the source of truth.

  await generateNutritionEvents(
    clientId,
    planId,
    {
      baselineCalories: planRow.baseline_calories,
      proteinTargetG: Number(planRow.protein_target_g),
      dietType: planRow.diet_type,
    },
    dailyTargetRows,
    null, // trainingPlan param is vestigial; training days derive from training_events
    dates
  );
}

// --- Cascade helper ---

/**
 * Regenerate a client's nutrition events after a training change, across
 * every plan VERSION the scope touches. Each version receives the SAME scope;
 * `regenerateFutureNutritionEvents` clamps to the version's own window, so
 * the loop IS the segmentation — a training edit inside an old era rebuilds
 * those days from that era's grid, never from the current template (the
 * pre-window baseline leak, closed by construction).
 *
 * Per-version regeneration failures are logged to Sentry so a failing regen
 * doesn't block the caller's primary operation (recorded trade-off — see
 * TECHNICAL-DEBT "Nutrition cascade"). The VERSION LOOKUP is different: its
 * error is surfaced loudly, because a failed read silently impersonating
 * "no plan" is how every training cascade used to no-op.
 *
 * @param scope which dates this change actually touched. Routes that know their
 *   exact dates pass `{kind:"dates"}` (move = [source, target]; duplicate =
 *   [targetDate]; a surplus edit = [eventDate]) and get a pure upsert over just
 *   those days. Routes whose change is open-ended forward pass `{kind:"from"}`:
 *   every version with days on or after the anchor regenerates to its OWN end.
 */
export async function cascadeNutritionAfterTrainingChange(
  clientId: string,
  scope: NutritionRegenScope,
  actionTag: string,
): Promise<void> {
  let versions;
  try {
    if (scope.kind === "dates") {
      const orderedDates = [...scope.dates].sort();
      if (orderedDates.length === 0) return;
      versions = await getActiveNutritionPlanVersionsOverlapping(
        clientId,
        orderedDates[0],
        orderedDates[orderedDates.length - 1]
      );
    } else {
      versions = await getActiveNutritionPlanVersionsOverlapping(clientId, scope.from);
    }
  } catch (err) {
    console.error(`Nutrition cascade version lookup failed (${actionTag}):`, err);
    captureApiError(err, { action: actionTag, clientId });
    return;
  }

  if (versions.length === 0) return;

  // From-scope only: the days no version covers — between two windows, or past
  // the last — keep nothing. Nothing regenerates them, so without this they
  // would survive as stale targets from an era that no longer reaches them.
  // Narrow (dates) scopes stay pure-upsert by contract and leave uncovered
  // dates untouched. Logged like the per-version failures: the training write
  // has committed, and a failed sweep is a stale day, not a lost one.
  if (scope.kind === "from") {
    try {
      await sweepUncoveredNutritionDays(clientId, scope.from, versions, scope.to);
    } catch (gapError) {
      console.error(`Nutrition cascade gap sweep failed (${actionTag}):`, gapError);
      captureApiError(gapError, { action: actionTag, clientId });
    }
  }

  // Sequential on purpose: overlapping versions are single-digit per client,
  // and each version's failure is isolated from its neighbours'.
  for (const version of versions) {
    await regenerateFutureNutritionEvents(clientId, version.id, scope).catch((err) =>
      captureApiError(err, { action: actionTag, planId: version.id }),
    );
  }
}

// --- The uncovered-days sweep ---

/** The three predicates every removal of a regenerable day shares. */
type UncoveredStretch = { from: string; to: string };

/**
 * Remove the regenerable nutrition days no ACTIVE version covers, from `from`
 * onward — the days between the versions' windows and the days past the last
 * one. A save caps its predecessor at the day before its own start
 * (migration 166), and the predecessor's days past the new version's end are
 * then governed by nothing; the training cascade's gap days are the same
 * state reached from the other side. Both call this.
 *
 * The reach is the furthest of the versions' ends, the caller's `to` (the
 * last day it cleared training on) and the client's last sweepable nutrition
 * day, read once — so a tail left by a predecessor that once ran further than
 * any window still reaches goes with it, however far. Each uncovered stretch
 * is one range delete; the three survival predicates are the regenerate's own
 * (scheduled, never hand-edited, no coach note).
 *
 * A removal asks the deletion floor. The only day a client can have logged is
 * today, and it can be in range only when the first stretch opens on the
 * anchor itself — so that is the one case the floor is resolved, and the
 * stretch starts at it. Every other stretch begins after a window's end, on a
 * day the client cannot have touched.
 */
export async function sweepUncoveredNutritionDays(
  clientId: string,
  from: string,
  versions: Array<{ effectiveFrom: string; effectiveUntil: string }>,
  to?: string
): Promise<void> {
  const sweepable = supabaseAdmin
    .from("nutrition_events")
    .select("date")
    .eq("client_id", clientId)
    .gte("date", from)
    .eq("status", "scheduled")
    .eq("is_modified", false)
    .is("coach_note", null)
    .order("date", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { data: last, error: lastError } = await sweepable;
  if (lastError) throw lastError;

  let sweepEnd = versions.reduce(
    (max, v) => (v.effectiveUntil > max ? v.effectiveUntil : max),
    from
  );
  if (to && to > sweepEnd) sweepEnd = to;
  if (last?.date && last.date > sweepEnd) sweepEnd = last.date;

  const stretches: UncoveredStretch[] = [];
  let cursor = from;
  const ordered = [...versions]
    .filter((v) => v.effectiveUntil >= from)
    .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  for (const version of ordered) {
    const start = version.effectiveFrom > from ? version.effectiveFrom : from;
    if (start > cursor) {
      stretches.push({ from: cursor, to: addDaysToDateString(start, -1) });
    }
    const after = addDaysToDateString(version.effectiveUntil, 1);
    if (after > cursor) cursor = after;
  }
  if (cursor <= sweepEnd) stretches.push({ from: cursor, to: sweepEnd });

  if (stretches.length > 0 && stretches[0].from === from) {
    const clientToday = await getClientTodayString(clientId);
    if (from <= clientToday) {
      const floor = await resolveEventDeletionFloor(clientId, clientToday);
      if (floor > stretches[0].from) stretches[0] = { ...stretches[0], from: floor };
      if (stretches[0].from > stretches[0].to) stretches.shift();
    }
  }

  for (const stretch of stretches) {
    const { error } = await supabaseAdmin
      .from("nutrition_events")
      .delete()
      .eq("client_id", clientId)
      .gte("date", stretch.from)
      .lte("date", stretch.to)
      .eq("status", "scheduled")
      .eq("is_modified", false)
      .is("coach_note", null);
    if (error) throw error;
  }
}
