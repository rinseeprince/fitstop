import { supabaseAdmin } from "./supabase-admin";
import { listBlocks } from "./client-blocks-service";
import { getTrainingPlansOverlapping } from "./training-service";
import { versionCoversDate } from "./nutrition-plan-service";
import { fetchAllPages } from "@/lib/paged-fetch";
import type {
  BlockFacts,
  BlockNutritionFact,
  ClientBlock,
} from "@/types/client-blocks";

// Read-only facts for the Journey tab's expanded block cards (Session 3.2).
// The chain routes stay pure CRUD; this service decorates each block with the
// training and nutrition story of its window. Everything is fetched ONCE for
// the whole journey span and partitioned per block in memory — round trips
// are constant (blocks + 3 parallel reads), never per-block.

type EventCaloriesRow = {
  date: string;
  baseline_calories: number | null;
  is_modified: boolean;
};

/**
 * Complete narrow read of the span's event calories. Paged via fetchAllPages
 * because this feeds an aggregate (the modal baseline) — an unpaged read
 * silently truncates at PostgREST's ~1000-row cap, which a 20-block journey
 * at 12 weeks each (1,680 dense event days) already crosses. `date` is unique
 * per client (`nutrition_events UNIQUE(client_id, date)`), so ordering by it
 * satisfies the deterministic-order contract with no extra tiebreak. Worst
 * case: 20 blocks × 52 weeks = 7,280 rows ≈ 8 pages of 3 columns each;
 * a realistic 12–40-week journey is 84–280 rows, one page.
 */
async function fetchEventCalories(
  clientId: string,
  startDate: string,
  endDate: string
): Promise<EventCaloriesRow[]> {
  return fetchAllPages<EventCaloriesRow>(
    (from, to) =>
      supabaseAdmin
        .from("nutrition_events")
        .select("date, baseline_calories, is_modified")
        .eq("client_id", clientId)
        .gte("date", startDate)
        .lte("date", endDate)
        .order("date", { ascending: true })
        .range(from, to),
    { errorLabel: "block-facts nutrition events" }
  );
}

type VersionTdeeWindow = {
  id: string;
  effectiveFrom: string;
  effectiveUntil: string | null;
  tdee: number | null;
};

/**
 * Active versions overlapping the span, with `tdee`. Deliberately NOT
 * `getActiveNutritionPlanVersionsOverlapping`: that helper is the cascade's
 * segmentation primitive and its window type carries no tdee — widening a
 * write-path primitive for a read-only facts column couples the two. Same
 * overlap predicate and status filter; single-digit rows per client, unpaged.
 */
async function fetchVersionTdeeWindows(
  clientId: string,
  rangeStart: string,
  rangeEnd: string
): Promise<VersionTdeeWindow[]> {
  const { data, error } = await supabaseAdmin
    .from("nutrition_plans")
    .select("id, effective_from, effective_until, tdee")
    .eq("client_id", clientId)
    .eq("status", "active")
    .lte("effective_from", rangeEnd)
    .or(`effective_until.gte.${rangeStart},effective_until.is.null`)
    .order("effective_from", { ascending: true });

  if (error) {
    throw new Error(
      `Failed to fetch nutrition versions for block facts: ${error.message}`
    );
  }
  return (data ?? []).map((row) => ({
    id: row.id,
    effectiveFrom: row.effective_from,
    effectiveUntil: row.effective_until,
    tdee: row.tdee,
  }));
}

/** Modal value over date-ascending (date, value) pairs; ties break toward
 *  the value seen latest. Returns the winning value + its latest date. */
function modalCalories(
  days: { date: string; value: number }[]
): { calories: number; lastDate: string } | null {
  const counts = new Map<number, { count: number; lastDate: string }>();
  for (const day of days) {
    const entry = counts.get(day.value);
    if (entry) {
      entry.count += 1;
      entry.lastDate = day.date;
    } else {
      counts.set(day.value, { count: 1, lastDate: day.date });
    }
  }
  let best: { calories: number; count: number; lastDate: string } | null = null;
  for (const [value, entry] of counts) {
    if (
      !best ||
      entry.count > best.count ||
      (entry.count === best.count && entry.lastDate > best.lastDate)
    ) {
      best = { calories: value, ...entry };
    }
  }
  return best ? { calories: best.calories, lastDate: best.lastDate } : null;
}

/**
 * The block's nutrition fact from its events (a current block reads
 * [startsOn, today]; past and future blocks their whole window).
 *
 * The PRESCRIPTION days are the unmodified ones — per-day coach edits
 * (`is_modified`) are day-level overrides and are excluded from both the
 * modal and the change detection, so one hand-edited day can neither skew
 * the headline nor fake a "changed" flag. The headline is the MODAL baseline
 * over those days (the dominant era — a block-start read shows numbers that
 * may have governed two days of a twelve-week block; a newest-covering read
 * is the era-mixing bug one level up), and the deficit resolves the version
 * covering the modal's latest observed date — that era's tdee against that
 * era's baseline by construction, since 1B regenerates each version only
 * inside its own window. A change of prescription mid-block is REPORTED, not
 * silently averaged over: changeCount counts baseline transitions across
 * consecutive unmodified days; lastChangedOn is the first day of the newest
 * era seen. If every day in the window is modified, the headline falls back
 * to all days and the change marker is suppressed (hand-edits vary day to
 * day; transition-counting over them is noise). No rounding here; display
 * rounding belongs to the renderer.
 */
function deriveNutritionFact(
  events: EventCaloriesRow[],
  versions: VersionTdeeWindow[],
  block: ClientBlock,
  clientToday: string
): BlockNutritionFact | null {
  const isCurrent = block.startsOn <= clientToday && clientToday <= block.endsOn;
  const windowEnd = isCurrent ? clientToday : block.endsOn;

  const inWindow: { date: string; value: number; isModified: boolean }[] = [];
  for (const event of events) {
    if (event.baseline_calories == null) continue;
    if (event.date < block.startsOn || event.date > windowEnd) continue;
    inWindow.push({
      date: event.date,
      value: event.baseline_calories,
      isModified: event.is_modified,
    });
  }
  if (inWindow.length === 0) return null;

  const prescriptionDays = inWindow.filter((day) => !day.isModified);
  const headlineDays = prescriptionDays.length > 0 ? prescriptionDays : inWindow;

  const modal = modalCalories(headlineDays);
  if (!modal) return null;

  let changeCount = 0;
  let lastChangedOn: string | null = null;
  for (let i = 1; i < prescriptionDays.length; i++) {
    if (prescriptionDays[i].value !== prescriptionDays[i - 1].value) {
      changeCount += 1;
      lastChangedOn = prescriptionDays[i].date;
    }
  }

  const version = versions.find((v) => versionCoversDate(v, modal.lastDate));
  return {
    calories: modal.calories,
    deficitPerDay: version?.tdee != null ? version.tdee - modal.calories : null,
    changeCount,
    lastChangedOn,
  };
}

/** Per-block server facts for the whole chain, in chain order. */
export async function getBlockFacts(
  clientId: string,
  clientToday: string
): Promise<BlockFacts[]> {
  const blocks = await listBlocks(clientId);
  if (blocks.length === 0) return [];

  const spanStart = blocks[0].startsOn;
  const spanEnd = blocks[blocks.length - 1].endsOn;

  const [plans, versions, events] = await Promise.all([
    getTrainingPlansOverlapping(clientId, spanStart, spanEnd),
    fetchVersionTdeeWindows(clientId, spanStart, spanEnd),
    fetchEventCalories(clientId, spanStart, spanEnd),
  ]);

  return blocks.map((block) => ({
    blockId: block.id,
    training: plans
      .filter(
        (plan) =>
          plan.effectiveFrom <= block.endsOn &&
          (plan.effectiveUntil === null || plan.effectiveUntil >= block.startsOn)
      )
      .map((plan) => ({
        id: plan.id,
        name: plan.name,
        startsOn: plan.effectiveFrom,
      })),
    nutrition: deriveNutritionFact(events, versions, block, clientToday),
  }));
}
