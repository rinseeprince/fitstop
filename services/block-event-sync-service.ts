import { supabaseAdmin } from "./supabase-admin";
import { addDaysToDateString } from "@/lib/date-helpers";
import { inclusiveDays } from "@/lib/blocks/block-chain";
import { expandProgramToWindow, generateProgramEvents } from "./program-event-walk";
import { regenerateFutureNutritionEvents } from "./nutrition-event-service";
import { getNutritionPlanIdForDate } from "./nutrition-plan-service";
import { orchestrateNutritionPlanCreation } from "./nutrition-plan-orchestrator";
import type { ClientBlock } from "@/types/client-blocks";
import type {
  ActivityLevel,
  DietType,
  GenerateNutritionPlanRequest,
  TrainingVolume,
} from "@/types/check-in";
import type { TablesInsert } from "@/types/database";

/**
 * Bringing a client's calendar in line with a block the coach has just re-dated.
 *
 * A block edit still writes NOTHING on its own — this runs only when the coach
 * picks it out of the confirm dialog, and it is the whole of what that dialog
 * offers. It reconciles rather than replaying a diff: "fill" means cover the
 * block, "clear" means remove what now sits outside it. So it does not need to
 * be told what the window used to be, and re-running it is idempotent.
 *
 * Both directions leave the past and everything logged alone, the same way every
 * other clear in the product does: scheduled rows from the client's today
 * forward, never a completed or missed one.
 */

const FILL_FLOOR = (blockStart: string, clientToday: string) =>
  blockStart > clientToday ? blockStart : clientToday;

/** Where a clear may reach: the day before the next block, else the last event. */
async function clearCeiling(
  clientId: string,
  blockEndsOn: string
): Promise<string | null> {
  const { data: nextBlock } = await supabaseAdmin
    .from("client_phases")
    .select("starts_on")
    .eq("client_id", clientId)
    .gt("starts_on", blockEndsOn)
    .order("starts_on", { ascending: true })
    .limit(1)
    .maybeSingle();

  // Bounded by the next block so a clear can never reach into a window this
  // block does not own — the coach asked about THIS block's days.
  if (nextBlock?.starts_on) return addDaysToDateString(nextBlock.starts_on, -1);

  const [{ data: lastTraining }, { data: lastNutrition }] = await Promise.all([
    supabaseAdmin
      .from("training_events")
      .select("date")
      .eq("client_id", clientId)
      .gt("date", blockEndsOn)
      .order("date", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabaseAdmin
      .from("nutrition_events")
      .select("date")
      .eq("client_id", clientId)
      .gt("date", blockEndsOn)
      .order("date", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const dates = [lastTraining?.date, lastNutrition?.date].filter(
    (date): date is string => typeof date === "string"
  );
  return dates.length > 0 ? dates.sort().at(-1) ?? null : null;
}

/**
 * Remove the scheduled events in [from, to] on both tracks, and deactivate the
 * training slot rows behind them.
 *
 * The slots matter as much as the events: a placed plan's END is derived from
 * its active row count, so leaving them behind would keep the client's app and
 * the coach's editor saying the program runs to the old date while the calendar
 * says otherwise.
 *
 * Floored at the client's today and scoped to `status = 'scheduled'`, so the
 * past and everything logged survive — the same two guards every other clear in
 * the product uses.
 */
export async function clearScheduledEvents(params: {
  clientId: string;
  clientToday: string;
  from: string;
  to: string;
}): Promise<{ trainingCleared: number; nutritionCleared: number }> {
  const { clientId, clientToday, to } = params;
  const from = params.from > clientToday ? params.from : clientToday;
  if (to < from) return { trainingCleared: 0, nutritionCleared: 0 };

  const { data: removedTraining, error: trainingError } = await supabaseAdmin
    .from("training_events")
    .delete()
    .eq("client_id", clientId)
    .gte("date", from)
    .lte("date", to)
    .eq("status", "scheduled")
    .select("training_session_id");
  if (trainingError) throw trainingError;

  const orphanedSlots = (removedTraining ?? [])
    .map((row) => row.training_session_id)
    .filter((id): id is string => typeof id === "string");

  if (orphanedSlots.length > 0) {
    const { error: slotError } = await supabaseAdmin
      .from("training_sessions")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .in("id", orphanedSlots);
    if (slotError) throw slotError;
  }

  const { data: removedNutrition, error: nutritionError } = await supabaseAdmin
    .from("nutrition_events")
    .delete()
    .eq("client_id", clientId)
    .gte("date", from)
    .lte("date", to)
    .eq("status", "scheduled")
    .select("date");
  if (nutritionError) throw nutritionError;

  return {
    trainingCleared: removedTraining?.length ?? 0,
    nutritionCleared: removedNutrition?.length ?? 0,
  };
}

/**
 * The shorten arm: clear the days that have LEFT the block — everything after
 * its new end, bounded so the clear can never reach a window this block does not
 * own.
 */
export async function clearEventsOutsideBlock(params: {
  clientId: string;
  clientToday: string;
  blockEndsOn: string;
}): Promise<{ trainingCleared: number; nutritionCleared: number }> {
  const { clientId, clientToday, blockEndsOn } = params;

  const ceiling = await clearCeiling(clientId, blockEndsOn);
  if (!ceiling) return { trainingCleared: 0, nutritionCleared: 0 };

  return clearScheduledEvents({
    clientId,
    clientToday,
    from: addDaysToDateString(blockEndsOn, 1),
    to: ceiling,
  });
}

/**
 * Lay the client's training down through the block's last day by CONTINUING the
 * program already placed in it — not by restarting it.
 *
 * The placed rows are the authored program repeated (migration 164), and
 * `authored_slot_count` records how long one pass was, so the extension resumes
 * at `existingSlots % authoredSlotCount`. A block that stopped three days into a
 * week carries on with day four; restarting would hand the client week one again
 * without being asked.
 *
 * The authored pass is read from the PLACED rows rather than the library
 * template — a coach who amended week one meant that edit to be what repeats.
 *
 * Returns null when it cannot continue: no plan in the block, or one placed
 * before migration 165 recorded its pass length. The caller says so rather than
 * guessing a program.
 */
export async function extendTrainingToBlockEnd(params: {
  clientId: string;
  clientToday: string;
  blockStartsOn: string;
  blockEndsOn: string;
}): Promise<{ planId: string; slotsAdded: number; eventsCreated: number } | null> {
  const { clientId, clientToday, blockStartsOn, blockEndsOn } = params;

  const { data: plan, error: planError } = await supabaseAdmin
    .from("training_plans")
    .select("id, effective_from, authored_slot_count")
    .eq("client_id", clientId)
    .is("deleted_at", null)
    .neq("status", "archived")
    .gte("effective_from", blockStartsOn)
    .lte("effective_from", blockEndsOn)
    .order("effective_from", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (planError) throw planError;
  if (!plan?.authored_slot_count) return null;

  const { data: slotRows, error: slotError } = await supabaseAdmin
    .from("training_sessions")
    .select("id, name, focus, is_rest, week_index, order_index, calorie_surplus_percentage, estimated_duration_minutes")
    .eq("plan_id", plan.id)
    .eq("is_active", true)
    .order("week_index", { ascending: true })
    .order("order_index", { ascending: true });
  if (slotError) throw slotError;

  const placed = slotRows ?? [];
  const windowDays = inclusiveDays(plan.effective_from, blockEndsOn);
  const missing = windowDays - placed.length;
  if (placed.length === 0 || missing <= 0) return null;

  // One pass of the authored program, as it stands on this client's calendar.
  const authored = placed.slice(0, plan.authored_slot_count);
  // Expand a whole extra stretch, then take the slice that continues where the
  // placed grid stopped — `expandProgramToWindow` starts a pass at position 0,
  // so the offset is what resumes mid-pass.
  const offset = placed.length % plan.authored_slot_count;
  const continued = expandProgramToWindow(
    authored.map((slot) => ({ ...slot, weekIndex: slot.week_index, orderIndex: slot.order_index })),
    offset + missing
  ).slice(offset);

  const firstNewDate = addDaysToDateString(plan.effective_from, placed.length);
  const lastWeekIndex = placed[placed.length - 1].week_index;

  const rows: TablesInsert<"training_sessions">[] = continued.map((slot, i) => ({
    plan_id: plan.id,
    name: slot.is_rest ? "Rest" : slot.name,
    day_of_week: null,
    // Continue the grid's own coordinates: these rows sit AFTER every existing
    // one in (week_index, order_index) order, which is the date-walk's order.
    week_index: lastWeekIndex + 1 + Math.floor(i / 7),
    order_index: i % 7,
    is_rest: slot.is_rest,
    focus: slot.is_rest ? null : slot.focus,
    notes: null,
    estimated_duration_minutes: slot.estimated_duration_minutes,
    calorie_surplus_percentage: slot.is_rest ? null : slot.calorie_surplus_percentage,
    is_active: true,
  }));

  const { data: inserted, error: insertError } = await supabaseAdmin
    .from("training_sessions")
    .insert(rows)
    .select("id, week_index, order_index");
  if (insertError || !inserted || inserted.length !== rows.length) {
    throw new Error(
      `Failed to extend the program: ${insertError?.message ?? "row count mismatch"}`
    );
  }

  const idBySlot = new Map(
    inserted.map((row) => [`${row.week_index}:${row.order_index}`, row.id])
  );

  const eventsCreated = await generateProgramEvents({
    clientId,
    planId: plan.id,
    programSlots: rows.map((row) => ({
      id: idBySlot.get(`${row.week_index}:${row.order_index}`) as string,
      isRest: row.is_rest as boolean,
      name: row.name,
      focus: (row.focus as string | null) ?? null,
      calorieSurplusPercentage: (row.calorie_surplus_percentage as number | null) ?? null,
      estimatedCalories: null,
    })),
    startDate: firstNewDate > clientToday ? firstNewDate : clientToday,
    endDate: blockEndsOn,
  });

  return { planId: plan.id, slotsAdded: rows.length, eventsCreated };
}

/**
 * Cover the block's days with nutrition targets.
 *
 * `keep` regenerates the new days from the version already in force — no
 * recalculation and no new version, so a client eight weeks into a cut keeps the
 * numbers they are working to. `regenerate` is the caller's job to have done
 * first (it mints a version); this then materialises whatever version now covers
 * the days. Either way the horizon already resolves to the block's end, so this
 * is the ordinary from-scope regenerate.
 */
export async function fillNutritionAcrossBlock(params: {
  clientId: string;
  clientToday: string;
  blockStartsOn: string;
  blockEndsOn: string;
}): Promise<{ from: string } | null> {
  const { clientId, clientToday, blockStartsOn, blockEndsOn } = params;
  const from = FILL_FLOOR(blockStartsOn, clientToday);
  if (from > blockEndsOn) return null;

  const planId = await getNutritionPlanIdForDate(clientId, from);
  if (!planId) return null;

  await regenerateFutureNutritionEvents(clientId, planId, { kind: "from", from });
  return { from };
}

/**
 * Re-price the block's targets against the client's CURRENT weight and goal,
 * minting a new version from the day the fill starts.
 *
 * Headless on purpose (owner, 2026-09-04): the whole value of the block-edit
 * dialog is that a coach never leaves the blocks screen, so this reaches the
 * same orchestrator the drawer's Save calls rather than opening one. The
 * SETTINGS come from the version already in force — diet type, protein per kg,
 * activity, and the custom-macro override if the coach set one — because those
 * are the coach's decisions and re-deriving them would silently change the
 * prescription's shape. What moves is the client's own numbers, which is the
 * entire reason a coach eight weeks into a cut would pick "regenerate".
 *
 * The goal is NOT passed: the orchestrator resolves it, so a queued goal is
 * honoured by the same rule every other save follows.
 */
export async function regenerateNutritionForBlock(params: {
  clientId: string;
  clientToday: string;
  block: ClientBlock;
}): Promise<void> {
  const { clientId, clientToday, block } = params;
  const from = FILL_FLOOR(block.startsOn, clientToday);
  if (from > block.endsOn) return;

  const { data: version, error } = await supabaseAdmin
    .from("nutrition_plans")
    .select(
      "coach_id, work_activity_level, training_volume_hours, protein_target_g_per_kg, diet_type, goal_deadline, custom_macros_enabled, custom_calories, custom_protein_g, custom_carb_g, custom_fat_g"
    )
    .eq("client_id", clientId)
    .lte("effective_from", from)
    .or(`effective_until.gte.${from},effective_until.is.null`)
    .order("effective_from", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!version) return;

  const body: GenerateNutritionPlanRequest = {
    workActivityLevel: version.work_activity_level as ActivityLevel,
    trainingVolumeHours: version.training_volume_hours as TrainingVolume,
    proteinTargetGPerKg: Number(version.protein_target_g_per_kg),
    dietType: version.diet_type as DietType,
    ...(version.goal_deadline ? { goalDeadline: version.goal_deadline } : {}),
    ...(version.custom_macros_enabled
      ? {
          customMacrosEnabled: true,
          customCalories: version.custom_calories ?? undefined,
          customProteinG: version.custom_protein_g ?? undefined,
          customCarbG: version.custom_carb_g ?? undefined,
          customFatG: version.custom_fat_g ?? undefined,
        }
      : {}),
    effectiveFrom: from,
  };

  await orchestrateNutritionPlanCreation(clientId, version.coach_id, body, {});
}
