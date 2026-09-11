import type { NutritionEvent } from "@/types/check-in";
import { expandDateRange } from "@/lib/date-helpers";
import { fetchAllByChunkedIds } from "@/lib/paged-fetch";
import { mapNutritionEventToDisplayTarget } from "@/utils/nutrition-event-helpers";
import { supabaseAdmin } from "./supabase-admin";
import {
  getNutritionPlanGrids,
  getNutritionPrescriptionsForRange,
  versionCoversDate,
} from "./nutrition-plan-service";
import { getEventsForDateRange } from "./training-event-service";
import {
  getNutritionDayEditsForRange,
  type NutritionDayEdit,
} from "./nutrition-day-edits-service";
import {
  nutritionDayOfWeek,
  resolveNutritionDay,
  type NutritionDayGridRow,
} from "./nutrition-day-resolver";

/**
 * A client's nutrition days over a range, COMPUTED when asked (owner decision
 * 2026-09-10) — nothing is read from a day table, because there is nothing
 * stored per day but the coach's edit. The food log stores what the client ate
 * and nothing else (owner decision 2026-09-11): a logged day's target is the
 * computed day too, so every reader — the calendar, the client's day, the
 * history table, the check-in week, the Overview rail, the dashboard feed —
 * takes it from HERE and none can disagree.
 *
 * Batched, never per day: the versions overlapping the range with their
 * prescription (the save note rides that read), then in parallel their grids,
 * the training events in range and the edits in range — four reads for a
 * 31-day month and four for a single day, with the number of days deciding
 * nothing. Every date is then handed to the resolver with the version covering
 * it. A date no version covers yields NO day, exactly as "no row" did: a gap
 * between plans is a real state, and the meals still save there — a day with
 * no target is a day with no verdict.
 *
 * The range reader is the name every reader already calls; the day table's
 * readers were deleted so the compiler listed every caller. The two TARGET
 * readers under it are the display shape of the same days — the client's two
 * display switches applied — one per client and one across many clients (the
 * feed's), both over one pure assembly. A single day is the range over one day.
 */

/** The version covering a date, as the day reader prices a day from it. */
type DayVersion = {
  id: string;
  effectiveFrom: string;
  effectiveUntil: string;
  baselineCalories: number;
  proteinTargetG: number;
  dietType: string;
  coachNote: string | null;
};

/** A version's grid row, keyed by the version and the weekday it prices. */
type GridRowWithKey = NutritionDayGridRow & { planId: string; dayOfWeek: string };

/** What the day reads off a session placed on it — its date decides the day. */
type DaySession = {
  date: string;
  calorieSurplusPercentage: number | null;
  estimatedCalories: number | null;
};

/**
 * The one assembly: every date in the range handed to the resolver with the
 * version covering it, its grid row for the weekday, the sessions on the date
 * and the coach's edit. Pure over rows the callers have already read, so the
 * per-client reader and the cross-client reader cannot price a day differently.
 */
function assembleDays(
  clientId: string,
  startDate: string,
  endDate: string,
  versions: readonly DayVersion[],
  grids: readonly GridRowWithKey[],
  sessions: readonly DaySession[],
  edits: readonly NutritionDayEdit[]
): NutritionEvent[] {
  if (versions.length === 0) return [];

  const gridRowByVersionDay = new Map<string, NutritionDayGridRow>();
  for (const row of grids) {
    gridRowByVersionDay.set(`${row.planId}:${row.dayOfWeek}`, row);
  }

  const sessionsByDate = new Map<string, DaySession[]>();
  for (const session of sessions) {
    const dateKey = session.date.split("T")[0];
    const onDate = sessionsByDate.get(dateKey) ?? [];
    onDate.push(session);
    sessionsByDate.set(dateKey, onDate);
  }

  const editByDate = new Map(edits.map((edit) => [edit.date, edit]));

  return expandDateRange(startDate, endDate).flatMap((date): NutritionEvent[] => {
    const version = versions.find((candidate) => versionCoversDate(candidate, date));
    if (!version) return [];
    return [
      resolveNutritionDay({
        clientId,
        date,
        version,
        gridRow: gridRowByVersionDay.get(`${version.id}:${nutritionDayOfWeek(date)}`) ?? null,
        trainingEvents: sessionsByDate.get(date) ?? [],
        edit: editByDate.get(date) ?? null,
        // The version's save note shows on the day the version took effect
        // (migration 172) — the day the change it explains landed.
        coachNote: version.effectiveFrom === date ? version.coachNote : null,
      }),
    ];
  });
}

export async function getNutritionEventsForDateRange(
  clientId: string,
  startDate: string,
  endDate: string
): Promise<NutritionEvent[]> {
  if (endDate < startDate) return [];

  const versions = await getNutritionPrescriptionsForRange(clientId, startDate, endDate);
  if (versions.length === 0) return [];

  const [grids, trainingEvents, edits] = await Promise.all([
    getNutritionPlanGrids(versions.map((version) => version.id)),
    // The generator's own read: every event on the date, whatever its status —
    // a completed or missed session still made the day a training day.
    getEventsForDateRange(clientId, startDate, endDate),
    getNutritionDayEditsForRange(clientId, startDate, endDate),
  ]);

  return assembleDays(clientId, startDate, endDate, versions, grids, trainingEvents, edits);
}

// ---------------------------------------------------------------------------
// The target readers: a computed day as the client is shown it.
// ---------------------------------------------------------------------------

/**
 * A day's target as displayed — the computed day through the client's two
 * display switches (`include_activity_burn`, `surplus_as_carbs`), the same
 * mapping the calendar and the program card apply, so the number a verdict is
 * judged against is the number the client was shown. `note` is the coach's
 * per-day note, shown to the client.
 */
export type NutritionDayTarget = {
  date: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  isTrainingDay: boolean;
  note: string | null;
};

/** A target with the client it belongs to — the cross-client reader's row. */
export type ClientNutritionDayTarget = NutritionDayTarget & { clientId: string };

type DisplayPrefs = { includeActivityBurn: boolean; surplusAsCarbs: boolean };

const DEFAULT_DISPLAY_PREFS: DisplayPrefs = { includeActivityBurn: true, surplusAsCarbs: false };

function toDisplayPrefs(row: {
  include_activity_burn: boolean | null;
  surplus_as_carbs: boolean | null;
}): DisplayPrefs {
  return {
    includeActivityBurn: row.include_activity_burn !== false,
    surplusAsCarbs: row.surplus_as_carbs === true,
  };
}

function toDisplayTarget(day: NutritionEvent, prefs: DisplayPrefs): NutritionDayTarget {
  const target = mapNutritionEventToDisplayTarget(day, prefs.includeActivityBurn, prefs.surplusAsCarbs);
  return {
    date: day.date,
    calories: target.calories,
    proteinG: target.proteinG,
    carbsG: target.carbsG,
    fatG: target.fatG,
    isTrainingDay: target.isTrainingDay,
    note: day.note ?? null,
  };
}

async function readDisplayPrefs(clientId: string): Promise<DisplayPrefs> {
  const { data, error } = await supabaseAdmin
    .from("clients")
    .select("include_activity_burn, surplus_as_carbs")
    .eq("id", clientId)
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to read the client's nutrition display settings: ${error.message}`);
  }
  return data ? toDisplayPrefs(data) : DEFAULT_DISPLAY_PREFS;
}

/**
 * The client's targets over a range, by date — one entry per date a version
 * covers, none for a gap. The day reader's four reads plus the client's
 * display switches, read together; the number of days decides nothing.
 */
export async function getNutritionTargetsForDateRange(
  clientId: string,
  startDate: string,
  endDate: string
): Promise<Map<string, NutritionDayTarget>> {
  if (endDate < startDate) return new Map();

  const [days, prefs] = await Promise.all([
    getNutritionEventsForDateRange(clientId, startDate, endDate),
    readDisplayPrefs(clientId),
  ]);
  return new Map(days.map((day) => [day.date, toDisplayTarget(day, prefs)]));
}

type VersionRow = {
  id: string;
  client_id: string;
  effective_from: string;
  effective_until: string;
  baseline_calories: number;
  protein_target_g: number;
  diet_type: string;
  coach_note: string | null;
};

type GridRow = {
  nutrition_plan_id: string;
  day_of_week: string;
  calories: number;
  protein_g: number;
  carb_g: number;
  fat_g: number;
};

type SessionRow = {
  client_id: string;
  date: string;
  calorie_surplus_percentage: number | null;
  estimated_calories: number | null;
};

type EditRow = {
  client_id: string;
  date: string;
  calories: number;
  protein_g: number;
  carb_g: number;
  fat_g: number;
  note: string | null;
};

type PrefsRow = {
  id: string;
  include_activity_burn: boolean | null;
  surplus_as_carbs: boolean | null;
};

function groupBy<T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const group = groups.get(key(row)) ?? [];
    group.push(row);
    groups.set(key(row), group);
  }
  return groups;
}

/**
 * Every client's targets over a range, in one pass — the attention feed's
 * read, beside the per-client reader above. The same four sources and the
 * same display switches, each read ONCE for the whole roster: chunked by
 * client id and paged within each chunk (`fetchAllByChunkedIds`), like the
 * feed's own window and event reads, because a coach's roster has two
 * independent ceilings — the request line and the row cap — and a truncated
 * read here would silently drop a client's verdicts. Resolved in memory with
 * the pure resolver, per client, so a day is priced exactly as the calendar
 * prices it. Empty for a client with no version in the window.
 */
export async function getNutritionTargetsForClients(
  clientIds: string[],
  startDate: string,
  endDate: string
): Promise<ClientNutritionDayTarget[]> {
  if (clientIds.length === 0 || endDate < startDate) return [];

  const versionRows = await fetchAllByChunkedIds<VersionRow, string>(
    clientIds,
    (chunk, from, to) =>
      supabaseAdmin
        .from("nutrition_plans")
        .select(
          "id, client_id, effective_from, effective_until, baseline_calories, protein_target_g, diet_type, coach_note"
        )
        .in("client_id", chunk)
        .eq("status", "active")
        .gte("effective_until", startDate)
        .lte("effective_from", endDate)
        .order("client_id", { ascending: true })
        .order("effective_from", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    { errorLabel: "nutrition versions for the clients" }
  );
  if (versionRows.length === 0) return [];

  // Only the clients a version covers in the window have days to price; the
  // three per-day sources and the switches are read for them alone.
  const coveredClientIds = [...new Set(versionRows.map((row) => row.client_id))];

  const [gridRows, sessionRows, editRows, prefsRows] = await Promise.all([
    fetchAllByChunkedIds<GridRow, string>(
      versionRows.map((row) => row.id),
      (chunk, from, to) =>
        supabaseAdmin
          .from("nutrition_plan_daily_targets")
          .select("nutrition_plan_id, day_of_week, calories, protein_g, carb_g, fat_g")
          .in("nutrition_plan_id", chunk)
          .order("nutrition_plan_id", { ascending: true })
          .order("day_of_week", { ascending: true })
          .range(from, to),
      { errorLabel: "nutrition plan grids for the clients" }
    ),
    fetchAllByChunkedIds<SessionRow, string>(
      coveredClientIds,
      (chunk, from, to) =>
        supabaseAdmin
          .from("training_events")
          .select("client_id, date, calorie_surplus_percentage, estimated_calories")
          .in("client_id", chunk)
          .gte("date", startDate)
          .lte("date", endDate)
          .order("client_id", { ascending: true })
          .order("date", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to),
      { errorLabel: "training events for the clients' nutrition days" }
    ),
    fetchAllByChunkedIds<EditRow, string>(
      coveredClientIds,
      (chunk, from, to) =>
        supabaseAdmin
          .from("nutrition_day_edits")
          .select("client_id, date, calories, protein_g, carb_g, fat_g, note")
          .in("client_id", chunk)
          .gte("date", startDate)
          .lte("date", endDate)
          .order("client_id", { ascending: true })
          .order("date", { ascending: true })
          .range(from, to),
      { errorLabel: "nutrition day edits for the clients" }
    ),
    fetchAllByChunkedIds<PrefsRow, string>(
      coveredClientIds,
      (chunk, from, to) =>
        supabaseAdmin
          .from("clients")
          .select("id, include_activity_burn, surplus_as_carbs")
          .in("id", chunk)
          .order("id", { ascending: true })
          .range(from, to),
      { errorLabel: "nutrition display settings for the clients" }
    ),
  ]);

  const versionsByClient = groupBy(versionRows, (row) => row.client_id);
  const gridsByVersion = groupBy(gridRows, (row) => row.nutrition_plan_id);
  const sessionsByClient = groupBy(sessionRows, (row) => row.client_id);
  const editsByClient = groupBy(editRows, (row) => row.client_id);
  const prefsByClient = new Map(prefsRows.map((row) => [row.id, toDisplayPrefs(row)]));

  const targets: ClientNutritionDayTarget[] = [];
  for (const clientId of coveredClientIds) {
    const versions: DayVersion[] = (versionsByClient.get(clientId) ?? []).map((row) => ({
      id: row.id,
      effectiveFrom: row.effective_from,
      effectiveUntil: row.effective_until,
      baselineCalories: row.baseline_calories,
      proteinTargetG: Number(row.protein_target_g),
      dietType: row.diet_type,
      coachNote: row.coach_note,
    }));
    const grids = versions.flatMap((version) =>
      (gridsByVersion.get(version.id) ?? []).map((row) => ({
        planId: row.nutrition_plan_id,
        dayOfWeek: row.day_of_week,
        calories: row.calories,
        proteinG: Number(row.protein_g),
        carbG: Number(row.carb_g),
        fatG: Number(row.fat_g),
      }))
    );
    const sessions: DaySession[] = (sessionsByClient.get(clientId) ?? []).map((row) => ({
      date: row.date,
      calorieSurplusPercentage: row.calorie_surplus_percentage,
      estimatedCalories: row.estimated_calories,
    }));
    const edits: NutritionDayEdit[] = (editsByClient.get(clientId) ?? []).map((row) => ({
      date: row.date,
      calories: row.calories,
      proteinG: row.protein_g,
      carbG: row.carb_g,
      fatG: row.fat_g,
      note: row.note,
    }));
    const prefs = prefsByClient.get(clientId) ?? DEFAULT_DISPLAY_PREFS;

    for (const day of assembleDays(clientId, startDate, endDate, versions, grids, sessions, edits)) {
      targets.push({ clientId, ...toDisplayTarget(day, prefs) });
    }
  }
  return targets;
}
