/**
 * Every route the request budgets cover (CONVENTIONS §14 "Request budgets"),
 * one row each: its method and path, who calls it, the screen that sends a
 * read and the query it sends, its budget, and, in BASELINES below, the count
 * scripts/perf-count.ts measured. The routes are every handler under
 * app/api/clients/**, app/api/client/**, app/api/check-in/**,
 * app/api/check-ins/**, app/api/training/** and app/api/content/**;
 * scripts/perf-routes.test.ts fails on a handler without a row and on a row
 * without a handler.
 *
 * A read is requested as its screen sends it, by the perf client
 * (scripts/perf-fixtures.ts) or by the perf client's own coach: a path's
 * `[param]` and a query's `{name}` are filled with a value perf-count reads
 * from the fixture (FixtureKey). A save is never requested here: it changes
 * the fixture. Its count is the proof server's [db] lines for the proof that
 * drives it, and the row says so.
 */

export type PerfRole = "coach" | "client";
type SaveMethod = "POST" | "PUT" | "PATCH" | "DELETE";

/** A read's budget after auth: its database calls, how many of them ran one after another, and its body (null: no size budget). */
export type ReadBudget = { calls: number; serial: number; bytes: number | null };
/** A save's budget after auth: its reads, and the one RPC or one statement that writes. */
export type SaveBudget = { reads: number; writes: number };

/** A value perf-count reads once from the perf fixtures, for a path's `[param]` or a query's `{name}`. */
export type FixtureKey =
  | "client" // the perf client
  | "plan" // its training plan (PERF_PLAN_ID)
  | "planSession" // a live, non-rest session of that plan
  | "event" // its next workout on or after today
  | "sessionLog" // its newest logged workout
  | "checkIn" // its newest sent check-in
  | "exercise" // the exercise it has logged most
  | "today" // its today
  | "fortnightStart" // today − 13 days
  | "monthStart" // the Monday on or before the 1st of today's month
  | "monthEnd" // the Sunday on or after its last day
  | "weekStart" // the first day of its current check-in week
  | "weekEnd" // and the last
  | "savedPlan" // its coach's saved program with the most sessions
  | "contentItem"; // its coach's newest content item

export type ReadRoute = {
  key: string;
  method: "GET";
  path: string;
  /** The query the screen sends, `{name}` for a fixture value; "" for none. */
  query: string;
  role: PerfRole;
  screen: string;
  budget: ReadBudget;
  params: Readonly<Record<string, FixtureKey>>;
  /** Why perf-count does not request it; absent when it does. */
  unmeasured?: string;
};

export type SaveRoute = { key: string; method: SaveMethod; path: string; role: PerfRole; budget: SaveBudget; unmeasured: string };

export type PerfRoute = ReadRoute | SaveRoute;

/** A read's measured count: calls after auth, how many ran one after another, auth's own calls, the request's time and its body. */
export type Measured = { calls: number; serial: number; auth: number; ms: number; bytes: number; status: number };

/** A body's size as the table prints it: bytes under a kilobyte, else kilobytes to a tenth. */
export const formatSize = (bytes: number) => (bytes < 1000 ? `${bytes} B` : `${(bytes / 1000).toFixed(1)} kB`);

/** What puts a measured read over its budget, in words; none when it is within it. */
export function overBudget(measured: Measured, budget: ReadBudget): string[] {
  const over: string[] = [];
  if (measured.calls > budget.calls) over.push(`${measured.calls} calls > ${budget.calls}`);
  if (measured.serial > budget.serial) over.push(`${measured.serial} in a row > ${budget.serial}`);
  if (budget.bytes !== null && measured.bytes > budget.bytes) over.push(`${formatSize(measured.bytes)} > ${formatSize(budget.bytes)}`);
  return over;
}

/** ≤ 6 database calls after auth, ≤ 3 of them one after another, a body ≤ 50 kB. */
const READ: ReadBudget = { calls: 6, serial: 3, bytes: 50_000 };
/** The plan editor's read and the builder's template read return a whole program: the same calls, no size budget. */
const WHOLE_PROGRAM: ReadBudget = { calls: 6, serial: 3, bytes: null };
/** The client app's catalog sync returns the whole dictionary on a full sync (CONVENTIONS §8): the same calls, no size budget. */
const WHOLE_CATALOG: ReadBudget = { calls: 6, serial: 3, bytes: null };
/** ≤ 3 reads after auth and one RPC, or one statement. */
const SAVE: SaveBudget = { reads: 3, writes: 1 };

const SAVE_UNMEASURED = "a save, which would change the fixture: its count is its proof's";

/** The role a path's caller signs in as: the client app's routes are the client's, every other the coach's. */
const roleOf = (path: string): PerfRole => (path.startsWith("/api/client/") ? "client" : "coach");

type ReadOptions = { query?: string; params?: Record<string, FixtureKey>; budget?: ReadBudget; variant?: string; role?: PerfRole; unmeasured?: string };

function read(path: string, screen: string, options: ReadOptions = {}): ReadRoute {
  const clientParam: Record<string, FixtureKey> = path.startsWith("/api/clients/[id]") ? { id: "client" } : {};
  return {
    key: `GET ${path}${options.variant ? ` (${options.variant})` : ""}`,
    method: "GET",
    path,
    query: options.query ?? "",
    role: options.role ?? roleOf(path),
    screen,
    budget: options.budget ?? READ,
    params: { ...clientParam, ...options.params },
    ...(options.unmeasured ? { unmeasured: options.unmeasured } : {}),
  };
}

function save(method: SaveMethod, path: string): SaveRoute {
  return { key: `${method} ${path}`, method, path, role: roleOf(path), budget: SAVE, unmeasured: SAVE_UNMEASURED };
}

export const PERF_ROUTES: readonly PerfRoute[] = [
  // The coach's client page: /api/clients/[id]/**
  read("/api/clients/[id]", "Client page: the client record"),
  read("/api/clients/[id]/activation-readiness", "Overview: the activation card, while the client is set up"),
  read("/api/clients/[id]/adherence", "Overview: adherence", { query: "?days=14" }),
  read("/api/clients/[id]/blocks", "Journey: blocks"),
  read("/api/clients/[id]/blocks/facts", "Journey: the block cards' figures"),
  read("/api/clients/[id]/check-in-form", "Check-ins: the form editor"),
  read("/api/clients/[id]/check-ins", "Check-ins: the list", { query: "?limit=20" }),
  read("/api/clients/[id]/daily-logs", "Overview: the last 14 days", { query: "?startDate={fortnightStart}&endDate={today}" }),
  read("/api/clients/[id]/goals", "Overview: the goal"),
  read("/api/clients/[id]/goals/history", "Journey: goals"),
  read("/api/clients/[id]/habits", "Habits: the list"),
  read("/api/clients/[id]/habits/choices", "Habits: Add habits"),
  read("/api/clients/[id]/habits/week", "Habits: this week"),
  read("/api/clients/[id]/history/nutrition", "Nutrition: history", { query: "?limit=10&offset=0" }),
  read("/api/clients/[id]/history/nutrition/summary", "Nutrition: history's summary"),
  read("/api/clients/[id]/history/training", "Training: history", { query: "?limit=10&offset=0" }),
  read("/api/clients/[id]/history/training/summary", "Training: history's summary"),
  read("/api/clients/[id]/history/wellness", "Wellness: history", { query: "?limit=10&offset=0" }),
  read("/api/clients/[id]/history/wellness/summary", "Wellness: history's summary", { query: "?days=7" }),
  read("/api/clients/[id]/intake", "Intake review"),
  read("/api/clients/[id]/invitation", "The Invite box"),
  read("/api/clients/[id]/measurement-series", "Overview: body measurements"),
  read("/api/clients/[id]/notes", "Overview: notes"),
  read("/api/clients/[id]/nutrition", "Nutrition: the plan"),
  read("/api/clients/[id]/nutrition/events", "Nutrition: the calendar's month", { query: "?startDate={monthStart}&endDate={monthEnd}" }),
  read("/api/clients/[id]/nutrition/goal", "Nutrition: the drawer's goal", { query: "?date={today}" }),
  read("/api/clients/[id]/nutrition/goal/out-of-date", "Overview: the nutrition card"),
  read("/api/clients/[id]/overview-brief", "Overview: what's new"),
  read("/api/clients/[id]/overview-plan-summary", "Overview: the plan card"),
  read("/api/clients/[id]/training", "Training: the program"),
  read("/api/clients/[id]/training/[planId]", "No screen reads it", { params: { planId: "plan" } }),
  read("/api/clients/[id]/training/[planId]/edit", "The plan editor", { params: { planId: "plan" }, budget: WHOLE_PROGRAM }),
  read("/api/clients/[id]/training/[planId]/sessions/[sessionId]", "Training: a day's session in the tray", { params: { planId: "plan", sessionId: "planSession" } }),
  read("/api/clients/[id]/training/events", "Training: the calendar's month", { query: "?startDate={monthStart}&endDate={monthEnd}" }),
  read("/api/clients/[id]/training/exercise-history", "Exercise data: the list", { query: "?metric=list", variant: "list" }),
  read("/api/clients/[id]/training/exercise-history", "Exercise data: an exercise's progression", {
    query: "?metric=progression&exerciseId={exercise}&sessionCount=12",
    variant: "progression",
  }),
  read("/api/clients/[id]/training/exercise-history", "Exercise data: an exercise's records", { query: "?metric=prs&exerciseId={exercise}", variant: "prs" }),
  read("/api/clients/[id]/training/session-logs/[sessionLogId]", "Training: a logged workout", { params: { sessionLogId: "sessionLog" } }),
  read("/api/clients/[id]/wellness-series", "Journey: wellness"),

  // The coach's other screens
  read("/api/clients", "Clients: the roster", { query: "?includeInactive=true" }),
  read("/api/clients/due-soon", "Dashboard: due soon"),
  read("/api/clients/overdue", "Dashboard: overdue"),
  read("/api/check-in/[id]", "Check-in review", { params: { id: "checkIn" } }),
  read("/api/check-in/[id]/comparison", "Check-in review: the comparison", { params: { id: "checkIn" } }),
  read("/api/check-ins/forms", "Check-in form settings: the forms"),
  read("/api/check-ins/questions", "Check-in form settings: the questions"),
  read("/api/check-ins/recent", "Dashboard: recent check-ins"),
  read("/api/check-ins/unreviewed", "Dashboard: check-ins to review"),
  read("/api/training/exercises", "The builder: the exercise catalog"),
  read("/api/training/exercises/recent", "The builder: recent exercises"),
  read("/api/training/saved-plans", "Programs: the table", { query: "?status=all&limit=25&offset=0", variant: "Programs" }),
  read("/api/training/saved-plans", "Training: the calendar's library panel", { variant: "library panel" }),
  read("/api/training/saved-plans/[savedPlanId]", "The builder: a program", { params: { savedPlanId: "savedPlan" }, budget: WHOLE_PROGRAM }),
  read("/api/training/saved-plans/assignments", "Programs: who is on each"),
  read("/api/training/saved-plans/summary", "Programs: the figures", { query: "?status=all" }),
  read("/api/training/saved-sessions", "Sessions: the library"),
  read("/api/content/assignments/[contentId]", "Content: an item's clients", { params: { contentId: "contentItem" } }),
  read("/api/content/download/[contentId]", "Resources: open an item", { role: "client", unmeasured: "no content item is assigned to the perf client" }),
  read("/api/content/folders", "Content: folders"),
  read("/api/content/items", "Content: items"),
  read("/api/content/library", "Content: the library"),

  // The client app: /api/client/**
  read("/api/client/check-in-context", "Check-in: the wizard"),
  read("/api/client/check-in-status", "Home: the check-in card"),
  read("/api/client/check-ins", "Check-in: past check-ins", { query: "?limit=10" }),
  read("/api/client/check-ins/[id]", "Check-in: a past check-in", { params: { id: "checkIn" } }),
  read("/api/client/daily-logs/[date]/nutrition", "Nutrition: today's log", { params: { date: "today" } }),
  read("/api/client/daily-logs/[date]/wellness", "Wellness: today's log", { params: { date: "today" } }),
  read("/api/client/day-summary", "Home: today", { query: "?date={today}" }),
  read("/api/client/exercises", "Training: the exercise search", { query: "?search=squat" }),
  read("/api/client/exercises/catalog", "The app: the catalog's full sync", { budget: WHOLE_CATALOG }),
  read("/api/client/habits/day", "Habits: today", { query: "?date={today}" }),
  read("/api/client/habits/progress", "Progress: habits", { query: "?weeks=8" }),
  read("/api/client/habits/week", "Check-in: the habits step", { query: "?start={weekStart}&end={weekEnd}" }),
  read("/api/client/intake", "Onboarding: the intake", {
    unmeasured: "it writes the intake row on its first call, and the perf client, active, never opens the intake",
  }),
  read("/api/client/journey", "Program: the journey"),
  read("/api/client/me", "Every page: the client's profile"),
  read("/api/client/notifications", "The nav: notifications"),
  read("/api/client/nutrition", "The app: the nutrition plan"),
  read("/api/client/nutrition-plan", "Program: the nutrition plan"),
  read("/api/client/progress", "Progress: the charts", { query: "?days=90" }),
  read("/api/client/resources", "Resources"),
  read("/api/client/training-plan", "Program: the training plan"),
  read("/api/client/training/events/[eventId]", "Training: a workout's tracker", { params: { eventId: "event" } }),
  read("/api/client/training/exercise-history", "Progress: exercises", { query: "?metric=list", variant: "list" }),
  read("/api/client/training/exercise-history", "Progress: an exercise's progression", {
    query: "?metric=progression&exerciseId={exercise}&sessionCount=12",
    variant: "progression",
  }),
  read("/api/client/training/exercise-history", "Progress: an exercise's records", { query: "?metric=prs&exerciseId={exercise}", variant: "prs" }),
  read("/api/client/training/sessions/[sessionId]", "Training: a swapped session", { params: { sessionId: "planSession" } }),
  read("/api/client/training/week", "Program: this week", { query: "?date={today}" }),

  // Saves
  save("POST", "/api/clients/[id]/activate"),
  save("DELETE", "/api/clients/[id]/blocks/[blockId]"),
  save("PATCH", "/api/clients/[id]/blocks/[blockId]"),
  save("PUT", "/api/clients/[id]/blocks"),
  save("PATCH", "/api/clients/[id]/check-in-config"),
  save("PUT", "/api/clients/[id]/check-in-form"),
  save("PUT", "/api/clients/[id]/goals/[goalId]/deadline"),
  save("PUT", "/api/clients/[id]/goals/[goalId]/name"),
  save("PATCH", "/api/clients/[id]/goals/[goalId]"),
  save("DELETE", "/api/clients/[id]/goals/[goalId]"),
  save("POST", "/api/clients/[id]/goals"),
  save("POST", "/api/clients/[id]/habits/[habitId]/change"),
  save("PUT", "/api/clients/[id]/habits/[habitId]/days/[date]"),
  save("DELETE", "/api/clients/[id]/habits/[habitId]/days/[date]"),
  save("PATCH", "/api/clients/[id]/habits/[habitId]"),
  save("DELETE", "/api/clients/[id]/habits/[habitId]"),
  save("POST", "/api/clients/[id]/habits/[habitId]/stop"),
  save("PUT", "/api/clients/[id]/habits/order"),
  save("POST", "/api/clients/[id]/habits"),
  save("PATCH", "/api/clients/[id]/intake"),
  save("POST", "/api/clients/[id]/intake"),
  save("POST", "/api/clients/[id]/invitation"),
  save("POST", "/api/clients/[id]/measurements/[measurementId]/restore"),
  save("PATCH", "/api/clients/[id]/measurements/[measurementId]"),
  save("POST", "/api/clients/[id]/measurements/[measurementId]/void"),
  save("POST", "/api/clients/[id]/measurements"),
  save("PUT", "/api/clients/[id]/metrics"),
  save("PATCH", "/api/clients/[id]/notes/[noteId]"),
  save("DELETE", "/api/clients/[id]/notes/[noteId]"),
  save("POST", "/api/clients/[id]/notes"),
  save("DELETE", "/api/clients/[id]/nutrition/[planId]"),
  save("PATCH", "/api/clients/[id]/nutrition/events/range"),
  save("PATCH", "/api/clients/[id]/nutrition/events/reset"),
  save("POST", "/api/clients/[id]/nutrition/goal/out-of-date/keep"),
  save("POST", "/api/clients/[id]/nutrition"),
  save("DELETE", "/api/clients/[id]/nutrition"),
  save("POST", "/api/clients/[id]/overview-brief/seen"),
  save("POST", "/api/clients/[id]/reactivate"),
  save("POST", "/api/clients/[id]/reminder"),
  save("PATCH", "/api/clients/[id]"),
  save("DELETE", "/api/clients/[id]"),
  save("PUT", "/api/clients/[id]/training/[planId]/edit"),
  save("POST", "/api/clients/[id]/training/[planId]/events/[eventId]/move"),
  save("DELETE", "/api/clients/[id]/training/[planId]/events/[eventId]"),
  save("POST", "/api/clients/[id]/training/[planId]/move"),
  save("PATCH", "/api/clients/[id]/training/[planId]"),
  save("DELETE", "/api/clients/[id]/training/[planId]"),
  save("PUT", "/api/clients/[id]/training/[planId]/sessions/[sessionId]"),
  save("POST", "/api/clients/[id]/training/place-from-library"),
  save("DELETE", "/api/clients/[id]/training"),
  save("POST", "/api/clients"),
  save("POST", "/api/client/check-ins"),
  save("PATCH", "/api/client/daily-logs/[date]/nutrition"),
  save("PATCH", "/api/client/daily-logs/[date]/wellness"),
  save("PUT", "/api/client/habits/[habitId]/days/[date]"),
  save("DELETE", "/api/client/habits/[habitId]/days/[date]"),
  save("PUT", "/api/client/intake/step/[step]"),
  save("POST", "/api/client/intake/submit"),
  save("PATCH", "/api/client/settings"),
  save("POST", "/api/client/training/events/[eventId]/log"),
  save("DELETE", "/api/client/training/events/[eventId]/log"),
  save("POST", "/api/client/training/events/layout"),
  save("POST", "/api/client/walkthrough-seen"),
  save("POST", "/api/check-in/[id]/ai-summary"),
  save("POST", "/api/check-in/[id]/review"),
  save("POST", "/api/check-ins/forms"),
  save("PATCH", "/api/check-ins/questions/[questionId]"),
  save("POST", "/api/check-ins/questions"),
  save("POST", "/api/training/assistant"),
  save("PATCH", "/api/training/exercises/[exerciseId]"),
  save("DELETE", "/api/training/exercises/[exerciseId]"),
  save("POST", "/api/training/exercises"),
  save("POST", "/api/training/saved-plans/[savedPlanId]/duplicate"),
  save("POST", "/api/training/saved-plans/[savedPlanId]/overwrite"),
  save("POST", "/api/training/saved-plans/[savedPlanId]/promote"),
  save("PATCH", "/api/training/saved-plans/[savedPlanId]"),
  save("DELETE", "/api/training/saved-plans/[savedPlanId]"),
  save("POST", "/api/training/saved-plans"),
  save("POST", "/api/training/saved-sessions/[savedSessionId]/overwrite"),
  save("DELETE", "/api/training/saved-sessions/[savedSessionId]"),
  save("POST", "/api/training/saved-sessions/from-calendar"),
  save("POST", "/api/training/saved-sessions"),
  save("DELETE", "/api/content/assignments/[contentId]/[clientId]"),
  save("POST", "/api/content/assignments"),
  save("PATCH", "/api/content/folders/[id]"),
  save("DELETE", "/api/content/folders/[id]"),
  save("POST", "/api/content/folders"),
  save("DELETE", "/api/content/items/[id]"),
  save("POST", "/api/content/items"),
  save("POST", "/api/content/metadata"),
  save("POST", "/api/content/upload"),
];

/** Each read's count when it was last measured, by key: written by `npx tsx scripts/perf-count.ts --write`. */
// perf-count --write: begin
export const BASELINES: Readonly<Record<string, Measured>> = {
  "GET /api/clients/[id]": { calls: 2, serial: 2, auth: 5, ms: 2327, bytes: 1004, status: 200 },
  "GET /api/clients/[id]/activation-readiness": { calls: 8, serial: 5, auth: 5, ms: 2994, bytes: 89, status: 200 },
  "GET /api/clients/[id]/adherence": { calls: 12, serial: 4, auth: 5, ms: 2782, bytes: 1545, status: 200 },
  "GET /api/clients/[id]/blocks": { calls: 4, serial: 3, auth: 5, ms: 2328, bytes: 978, status: 200 },
  "GET /api/clients/[id]/blocks/facts": { calls: 5, serial: 4, auth: 5, ms: 2962, bytes: 1627, status: 200 },
  "GET /api/clients/[id]/check-in-form": { calls: 2, serial: 2, auth: 5, ms: 2154, bytes: 199, status: 200 },
  "GET /api/clients/[id]/check-ins": { calls: 2, serial: 2, auth: 5, ms: 2517, bytes: 8558, status: 200 },
  "GET /api/clients/[id]/daily-logs": { calls: 8, serial: 4, auth: 5, ms: 3472, bytes: 6124, status: 200 },
  "GET /api/clients/[id]/goals": { calls: 7, serial: 3, auth: 5, ms: 2376, bytes: 524, status: 200 },
  "GET /api/clients/[id]/goals/history": { calls: 6, serial: 3, auth: 5, ms: 2402, bytes: 1508, status: 200 },
  "GET /api/clients/[id]/habits": { calls: 3, serial: 2, auth: 5, ms: 2113, bytes: 2361, status: 200 },
  "GET /api/clients/[id]/habits/choices": { calls: 3, serial: 3, auth: 5, ms: 2421, bytes: 1498, status: 200 },
  "GET /api/clients/[id]/habits/week": { calls: 6, serial: 3, auth: 5, ms: 2427, bytes: 8684, status: 200 },
  "GET /api/clients/[id]/history/nutrition": { calls: 9, serial: 5, auth: 5, ms: 3083, bytes: 2533, status: 200 },
  "GET /api/clients/[id]/history/nutrition/summary": { calls: 4, serial: 3, auth: 5, ms: 2557, bytes: 113, status: 200 },
  "GET /api/clients/[id]/history/training": { calls: 4, serial: 4, auth: 5, ms: 2659, bytes: 1485, status: 200 },
  "GET /api/clients/[id]/history/training/summary": { calls: 4, serial: 3, auth: 5, ms: 2416, bytes: 88, status: 200 },
  "GET /api/clients/[id]/history/wellness": { calls: 3, serial: 3, auth: 5, ms: 2415, bytes: 782, status: 200 },
  "GET /api/clients/[id]/history/wellness/summary": { calls: 4, serial: 4, auth: 5, ms: 2627, bytes: 118, status: 200 },
  "GET /api/clients/[id]/intake": { calls: 2, serial: 2, auth: 5, ms: 2172, bytes: 43, status: 404 },
  "GET /api/clients/[id]/invitation": { calls: 3, serial: 2, auth: 5, ms: 2146, bytes: 61, status: 200 },
  "GET /api/clients/[id]/measurement-series": { calls: 8, serial: 3, auth: 5, ms: 3363, bytes: 673366, status: 200 },
  "GET /api/clients/[id]/notes": { calls: 3, serial: 3, auth: 5, ms: 2614, bytes: 26, status: 200 },
  "GET /api/clients/[id]/nutrition": { calls: 7, serial: 3, auth: 5, ms: 2386, bytes: 521, status: 200 },
  "GET /api/clients/[id]/nutrition/events": { calls: 5, serial: 3, auth: 5, ms: 2369, bytes: 15762, status: 200 },
  "GET /api/clients/[id]/nutrition/goal": { calls: 3, serial: 2, auth: 5, ms: 2147, bytes: 623, status: 200 },
  "GET /api/clients/[id]/nutrition/goal/out-of-date": { calls: 4, serial: 3, auth: 5, ms: 2352, bytes: 69, status: 200 },
  "GET /api/clients/[id]/overview-brief": { calls: 28, serial: 7, auth: 5, ms: 3590, bytes: 2973, status: 200 },
  "GET /api/clients/[id]/overview-plan-summary": { calls: 31, serial: 10, auth: 5, ms: 4167, bytes: 633, status: 200 },
  "GET /api/clients/[id]/training": { calls: 8, serial: 6, auth: 5, ms: 3413, bytes: 21250, status: 200 },
  "GET /api/clients/[id]/training/[planId]": { calls: 4, serial: 4, auth: 5, ms: 2698, bytes: 21144, status: 200 },
  "GET /api/clients/[id]/training/[planId]/edit": { calls: 9, serial: 5, auth: 5, ms: 2911, bytes: 67618, status: 200 },
  "GET /api/clients/[id]/training/[planId]/sessions/[sessionId]": { calls: 5, serial: 5, auth: 5, ms: 3231, bytes: 10330, status: 200 },
  "GET /api/clients/[id]/training/events": { calls: 2, serial: 2, auth: 5, ms: 2173, bytes: 10307, status: 200 },
  "GET /api/clients/[id]/training/exercise-history (list)": { calls: 2, serial: 2, auth: 5, ms: 2179, bytes: 1049, status: 200 },
  "GET /api/clients/[id]/training/exercise-history (progression)": { calls: 3, serial: 3, auth: 5, ms: 2470, bytes: 10322, status: 200 },
  "GET /api/clients/[id]/training/exercise-history (prs)": { calls: 2, serial: 2, auth: 5, ms: 2249, bytes: 764, status: 200 },
  "GET /api/clients/[id]/training/session-logs/[sessionLogId]": { calls: 7, serial: 5, auth: 5, ms: 3927, bytes: 22326, status: 200 },
  "GET /api/clients/[id]/wellness-series": { calls: 3, serial: 2, auth: 5, ms: 2271, bytes: 223306, status: 200 },
  "GET /api/clients": { calls: 1, serial: 1, auth: 5, ms: 2040, bytes: 62493, status: 200 },
  "GET /api/clients/due-soon": { calls: 1, serial: 1, auth: 5, ms: 2028, bytes: 24, status: 200 },
  "GET /api/clients/overdue": { calls: 1, serial: 1, auth: 5, ms: 2007, bytes: 28073, status: 200 },
  "GET /api/check-in/[id]": { calls: 7, serial: 5, auth: 5, ms: 3162, bytes: 10238, status: 200 },
  "GET /api/check-in/[id]/comparison": { calls: 8, serial: 6, auth: 5, ms: 3469, bytes: 1280, status: 200 },
  "GET /api/check-ins/forms": { calls: 2, serial: 2, auth: 5, ms: 2620, bytes: 1610, status: 200 },
  "GET /api/check-ins/questions": { calls: 1, serial: 1, auth: 5, ms: 2066, bytes: 1639, status: 200 },
  "GET /api/check-ins/recent": { calls: 2, serial: 2, auth: 5, ms: 2703, bytes: 4104, status: 200 },
  "GET /api/check-ins/unreviewed": { calls: 2, serial: 2, auth: 5, ms: 2516, bytes: 99092, status: 200 },
  "GET /api/training/exercises": { calls: 2, serial: 2, auth: 5, ms: 2830, bytes: 504896, status: 200 },
  "GET /api/training/exercises/recent": { calls: 1, serial: 1, auth: 5, ms: 1926, bytes: 1040, status: 200 },
  "GET /api/training/saved-plans (Programs)": { calls: 1, serial: 1, auth: 5, ms: 1967, bytes: 9167, status: 200 },
  "GET /api/training/saved-plans (library panel)": { calls: 1, serial: 1, auth: 5, ms: 2939, bytes: 936880, status: 200 },
  "GET /api/training/saved-plans/[savedPlanId]": { calls: 2, serial: 2, auth: 5, ms: 2660, bytes: 230520, status: 200 },
  "GET /api/training/saved-plans/assignments": { calls: 1, serial: 1, auth: 5, ms: 2038, bytes: 281, status: 200 },
  "GET /api/training/saved-plans/summary": { calls: 1, serial: 1, auth: 5, ms: 2039, bytes: 110, status: 200 },
  "GET /api/training/saved-sessions": { calls: 1, serial: 1, auth: 5, ms: 2093, bytes: 8829, status: 200 },
  "GET /api/content/assignments/[contentId]": { calls: 2, serial: 2, auth: 5, ms: 2339, bytes: 26, status: 200 },
  "GET /api/content/folders": { calls: 1, serial: 1, auth: 5, ms: 1949, bytes: 477, status: 200 },
  "GET /api/content/items": { calls: 1, serial: 1, auth: 5, ms: 1947, bytes: 2571, status: 200 },
  "GET /api/content/library": { calls: 2, serial: 1, auth: 5, ms: 1936, bytes: 3102, status: 200 },
  "GET /api/client/check-in-context": { calls: 29, serial: 5, auth: 5, ms: 3472, bytes: 18152, status: 200 },
  "GET /api/client/check-in-status": { calls: 1, serial: 1, auth: 5, ms: 2429, bytes: 71, status: 200 },
  "GET /api/client/check-ins": { calls: 1, serial: 1, auth: 5, ms: 2474, bytes: 4407, status: 200 },
  "GET /api/client/check-ins/[id]": { calls: 5, serial: 3, auth: 5, ms: 2759, bytes: 1755, status: 200 },
  "GET /api/client/daily-logs/[date]/nutrition": { calls: 7, serial: 2, auth: 5, ms: 2673, bytes: 200, status: 200 },
  "GET /api/client/daily-logs/[date]/wellness": { calls: 8, serial: 2, auth: 5, ms: 2292, bytes: 95, status: 200 },
  "GET /api/client/day-summary": { calls: 17, serial: 2, auth: 5, ms: 2320, bytes: 439, status: 200 },
  "GET /api/client/exercises": { calls: 3, serial: 3, auth: 5, ms: 2732, bytes: 38328, status: 200 },
  "GET /api/client/exercises/catalog": { calls: 3, serial: 3, auth: 5, ms: 3463, bytes: 312754, status: 200 },
  "GET /api/client/habits/day": { calls: 3, serial: 2, auth: 5, ms: 2277, bytes: 2555, status: 200 },
  "GET /api/client/habits/progress": { calls: 4, serial: 2, auth: 5, ms: 2372, bytes: 33284, status: 200 },
  "GET /api/client/habits/week": { calls: 3, serial: 2, auth: 5, ms: 2302, bytes: 8546, status: 200 },
  "GET /api/client/journey": { calls: 10, serial: 3, auth: 5, ms: 2723, bytes: 1376, status: 200 },
  "GET /api/client/me": { calls: 6, serial: 3, auth: 5, ms: 2569, bytes: 1037, status: 200 },
  "GET /api/client/notifications": { calls: 1, serial: 1, auth: 5, ms: 2108, bytes: 554, status: 200 },
  "GET /api/client/nutrition": { calls: 11, serial: 6, auth: 5, ms: 3523, bytes: 3043, status: 200 },
  "GET /api/client/nutrition-plan": { calls: 10, serial: 5, auth: 5, ms: 2967, bytes: 3043, status: 200 },
  "GET /api/client/progress": { calls: 11, serial: 3, auth: 5, ms: 2629, bytes: 36298, status: 200 },
  "GET /api/client/resources": { calls: 4, serial: 2, auth: 5, ms: 2326, bytes: 1661, status: 200 },
  "GET /api/client/training-plan": { calls: 6, serial: 4, auth: 5, ms: 3843, bytes: 167398, status: 200 },
  "GET /api/client/training/events/[eventId]": { calls: 2, serial: 2, auth: 5, ms: 2508, bytes: 5672, status: 200 },
  "GET /api/client/training/exercise-history (list)": { calls: 1, serial: 1, auth: 5, ms: 2053, bytes: 1049, status: 200 },
  "GET /api/client/training/exercise-history (progression)": { calls: 2, serial: 2, auth: 5, ms: 2331, bytes: 10322, status: 200 },
  "GET /api/client/training/exercise-history (prs)": { calls: 1, serial: 1, auth: 5, ms: 2260, bytes: 764, status: 200 },
  "GET /api/client/training/sessions/[sessionId]": { calls: 4, serial: 2, auth: 5, ms: 2273, bytes: 5195, status: 200 },
  "GET /api/client/training/week": { calls: 3, serial: 2, auth: 5, ms: 2388, bytes: 938, status: 200 },
};
// perf-count --write: end
