# Calendar Events Migration + Nutrition Improvements — 5 Session Plan

## Background

The platform uses template-based training schedules where `training_sessions.day_of_week` defines "Push Day on Mondays." 12+ consumers resolve "what's prescribed on date X" by matching the current template's `day_of_week` — meaning in-place edits (moving sessions to different days, renaming) retroactively change history. Industry incumbents (Trainerize, Everfit) use concrete calendar events: one row per scheduled session per date, immutable once the day passes.

Additionally:
- When a coach moves a training session to a different day, the calorie burn doesn't move with it in the nutrition calculator's stored targets.
- When a coach regenerates a training plan, the nutrition plan should be regenerated to match — but the calorie calculator recalculates from TDEE/deficit using the client's current weight and remaining days to goal. If the client hasn't checked in recently, this produces different (usually more aggressive) calories.

This plan migrates to a `training_events` table, makes calorie burn follow training day via events, and adds a "keep current calories" option for nutrition regeneration.

### What stays from Session 3/3b
- `types/schedule.ts` — snapshot types
- `utils/nutrition-period-summary.ts` — nutrition summary generator
- `services/check-in-snapshot-service.ts` — just changes training data source
- AI prompt builder updates, history type `is_logged`, nutrition + wellness history APIs, all table UI components

### What gets replaced
- `utils/training-schedule-generator.ts` — DELETED (events ARE the schedule)
- Template `day_of_week` matching in 12+ consumers → event queries
- `countPlannedSessions()` → event count queries

### Event duration
- If plan is linked to a phase (`phase_id`): generate events until the phase `end_date` (or `start_date + duration_weeks`)
- If no phase: default to 8 weeks from `effective_from`
- All edits only affect future days. Past/completed events are never touched.

---

## Session 1: Database Migration + Event Generation Service

**Goal:** Create the `training_events` table and a service that generates/queries events. After this session: you can call `generateTrainingEvents()` to materialize a plan into concrete date rows, and query them back.

### What gets done
- Migration: create `training_events` table with indexes
- `TrainingEvent` type added to `types/training.ts`
- Event service with generate, regenerate, delete, query, count, and link functions
- Event helper with pure mapping functions (events → ScheduleDay[], events → calories by day)

### How to test
1. Run the migration against local Supabase
2. Call `generateTrainingEvents()` with a mock plan — verify rows created in `training_events`
3. Call `getEventsForDateRange()` — verify correct events returned sorted by date
4. Call `regenerateFutureEvents()` — verify only future scheduled events are deleted and regenerated
5. `npx tsc --noEmit` — no type errors

### Claude Code prompt

```
Read CALENDAR-EVENTS-PLAN.md for full context, then read CONVENTIONS.md and docs/ARCHITECTURE.md.

This is Session 1 of 5. Create the training_events table and event generation service.

**Read first:**
- `supabase/migrations/073_add_training_plan_versioning.sql` — latest migration for naming convention
- `types/training.ts` — existing training types (TrainingPlan, TrainingSession, etc.)
- `types/schedule.ts` — ScheduleDay type used by snapshot system
- `services/training-service.ts` — `getActiveTrainingPlan()`, `mapSessionRow()` patterns
- `utils/training-schedule-generator.ts` — the `buildTrainingSchedule()` function this will replace (understand its output shape)
- `utils/training-calorie-helpers.ts` — `getTrainingSessionCaloriesByDay()` which the event helper will replace
- `lib/date-helpers.ts` — date utility functions (getTodayDateString, getDateString, DAY_NUM map)
- `services/supabase-admin.ts` — supabaseAdmin import pattern
- `types/roadmap.ts` — phase type with `end_date`, `duration_weeks`, `start_date`

**1. Migration: `supabase/migrations/075_create_training_events.sql`**

```sql
CREATE TABLE training_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  training_plan_id UUID NOT NULL REFERENCES training_plans(id) ON DELETE CASCADE,
  training_session_id UUID REFERENCES training_sessions(id) ON DELETE SET NULL,
  date DATE NOT NULL,
  session_name TEXT NOT NULL,
  session_focus TEXT,
  estimated_calories INTEGER,
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'completed', 'partial', 'missed', 'skipped')),
  session_log_id UUID REFERENCES session_logs(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(client_id, training_session_id, date)
);

CREATE INDEX idx_training_events_client_date ON training_events(client_id, date);
CREATE INDEX idx_training_events_plan ON training_events(training_plan_id);
```

Key design: `session_name` is snapshotted at event creation — survives template renames. `ON DELETE SET NULL` on `training_session_id` preserves events when sessions are soft-deleted. `ON DELETE CASCADE` on `training_plan_id` cleans up events when a plan is fully deleted.

Also add `training_events` to the generated types in `types/database.ts` (Row, Insert, Update types) following the existing pattern for other tables.

**2. TrainingEvent type — add to `types/training.ts`**

```typescript
export type TrainingEvent = {
  id: string;
  clientId: string;
  trainingPlanId: string;
  trainingSessionId: string | null;
  date: string;
  sessionName: string;
  sessionFocus: string | null;
  estimatedCalories: number | null;
  status: 'scheduled' | 'completed' | 'partial' | 'missed' | 'skipped';
  sessionLogId: string | null;
};
```

**3. Event service — `services/training-event-service.ts` (new, ~250 lines)**

All functions use `supabaseAdmin` with RLS exception comments.

```typescript
export async function generateTrainingEvents(
  clientId: string,
  planId: string,
  sessions: Array<{ id: string; name: string; dayOfWeek?: string; sessionType: string; focus?: string; estimatedCalories?: number }>,
  startDate: string,
  endDate: string
): Promise<void>
```

Implementation:
a. Filter sessions to `sessionType === "training"` with a `dayOfWeek` assigned.
b. Build a map of `dayNumber → session` using the `DAY_NUM` pattern from `lib/date-helpers.ts` (sunday=0, monday=1, etc.).
c. Iterate dates from `startDate` to `endDate`. For each date, check if a session maps to that day's `getDay()`.
d. Build an array of insert objects: `{ client_id, training_plan_id, training_session_id, date, session_name, session_focus, estimated_calories, status: 'scheduled' }`.
e. Bulk insert with `supabaseAdmin.from("training_events").upsert(rows, { onConflict: 'client_id,training_session_id,date', ignoreDuplicates: true })`.

```typescript
export async function regenerateFutureEvents(clientId: string, planId: string): Promise<void>
```

Implementation:
a. Get today's date via `getTodayDateString()`.
b. Delete future scheduled events: `supabaseAdmin.from("training_events").delete().eq("training_plan_id", planId).gte("date", today).eq("status", "scheduled")`.
c. Fetch the current plan's active sessions: `supabaseAdmin.from("training_sessions").select("id, name, day_of_week, session_type, focus, estimated_calories").eq("plan_id", planId).eq("is_active", true)`.
d. Calculate end date: query `training_plans` for `phase_id`. If phase exists, query `phases` for `end_date` or `start_date + duration_weeks`. If no phase, default to 8 weeks from today.
e. Call `generateTrainingEvents(clientId, planId, sessions, today, endDate)`.

```typescript
export async function deleteFutureEventsForPlan(planId: string): Promise<void>
```

Implementation: Delete events where `training_plan_id = planId AND date >= today AND status = 'scheduled'`.

```typescript
export async function getEventsForDateRange(clientId: string, startDate: string, endDate: string): Promise<TrainingEvent[]>
```

Implementation: Query `training_events` with `client_id`, `date` between start/end, order by date ascending. Map rows to `TrainingEvent` type.

```typescript
export async function getEventForDate(clientId: string, date: string): Promise<TrainingEvent | null>
```

Implementation: Same query but `.eq("date", date).maybeSingle()`.

```typescript
export async function countEventsInRange(clientId: string, startDate: string, endDate: string): Promise<number>
```

Implementation: Count query with `{ count: "exact", head: true }`.

```typescript
export async function linkSessionLogToEvent(eventId: string, sessionLogId: string, status: 'completed' | 'partial' | 'skipped'): Promise<void>
```

Implementation: Update event's `session_log_id` and `status`.

**4. Event helper — `utils/training-event-helpers.ts` (new, ~80 lines)**

Pure mapping functions (no DB calls):

```typescript
export function mapEventsToScheduleDays(dates: string[], events: TrainingEvent[]): ScheduleDay[]
```

Build a `Map<date, TrainingEvent>` from events. For each date: if event exists, map to ScheduleDay (status from event, session name from event). If `event.status === 'scheduled'` and date is in the past, treat as `missed`. If no event, status is `rest`. Use the `DAY_NAMES` map for dayOfWeek string.

```typescript
export function getEventCaloriesByDay(events: TrainingEvent[]): Record<string, number>
```

Initialize `{ monday: 0, ..., sunday: 0 }`. Iterate events, convert each event's date to day-of-week string, add `estimatedCalories` to that key.

After implementing, run `npx tsc --noEmit` to verify no type errors. Commit when done.
```

---

## Session 2: Wire Events into Plan Lifecycle

**Goal:** Every path that creates, regenerates, or modifies training plans now also generates/regenerates events. After this session: creating or editing a plan produces calendar events, and a backfill script populates events for existing plans.

### What gets done
- Event generation after AI plan creation
- Event generation after manual plan creation
- Future event regeneration after session reorder/move/update/add/delete
- Link session_log completions to events in Daily Pulse flow
- Backfill script for existing plans

### How to test
1. Create a new AI training plan — verify events appear in `training_events`
2. Create a manual plan — verify events appear
3. Move a session from Monday to Thursday — verify past events unchanged, future events regenerated
4. Add/delete a session — verify future events updated
5. Log a training session via Daily Pulse — verify event status updates to `completed`
6. Regenerate a plan — verify old plan's future events deleted, new plan's events created
7. Run backfill script — verify events created for all existing plans

### Claude Code prompt

```
Read CALENDAR-EVENTS-PLAN.md for full context, then read CONVENTIONS.md and docs/ARCHITECTURE.md.

This is Session 2 of 5. Wire event generation into all training plan lifecycle points.

**Read first:**
- `services/training-event-service.ts` — the event service built in Session 1
- `app/api/clients/[id]/training/route.ts` — AI plan creation POST handler (understand the full flow: validate → generate AI → createTrainingPlanAtomic RPC → insertTrainingSessions → external activities → calorie estimation → save history)
- `app/api/clients/[id]/training/manual/route.ts` — manual plan creation POST handler
- `app/api/clients/[id]/training/[planId]/sessions/reorder/route.ts` — session reorder endpoint
- `app/api/clients/[id]/training/[planId]/sessions/[sessionId]/route.ts` — session update PATCH and delete DELETE
- `app/api/clients/[id]/training/[planId]/sessions/route.ts` — session add POST
- `services/training-service.ts` — `getActiveTrainingPlan()`, `updateSession()`, `deleteSession()`, `addSession()`, `reorderSessions()`
- `services/client-portal-training.ts` — client-side training service (look for where `session_logs` are created)
- `app/api/client/session-completions/route.ts` — client-side session completion endpoint
- `lib/error-handler.ts` — `captureApiError()` for non-blocking error handling

**1. Plan creation (AI) — modify `app/api/clients/[id]/training/route.ts`**

After the plan is fully created (after `saveTrainingPlanHistory` and calorie estimation):
a. Before calling `createTrainingPlanAtomic`, get the current active plan ID (if any): `const existingPlan = await getActiveTrainingPlan(clientId)`.
b. After the atomic RPC returns and sessions/exercises are inserted and calories estimated:
   - If old plan existed: `await deleteFutureEventsForPlan(existingPlan.id).catch(err => captureApiError(err, { action: "delete-future-events", planId: existingPlan.id }))`
   - Calculate endDate: if plan has `phase_id`, query `phases` for `end_date`; else default 8 weeks from today
   - `await generateTrainingEvents(clientId, newPlanId, updatedPlan.sessions, today, endDate).catch(err => captureApiError(err, { action: "generate-training-events", planId: newPlanId }))`
c. Event generation should be non-blocking (`.catch()`) so plan creation succeeds even if event generation fails.

**2. Plan creation (manual) — modify `app/api/clients/[id]/training/manual/route.ts`**

Same pattern as step 1.

**3. Session reorder/move — modify `app/api/clients/[id]/training/[planId]/sessions/reorder/route.ts`**

After `await reorderSessions(planId, validation.data)`, add:
```typescript
await regenerateFutureEvents(clientId, planId)
  .catch(err => captureApiError(err, { action: "regenerate-events-after-reorder", planId }));
```

**4. Session update — modify `app/api/clients/[id]/training/[planId]/sessions/[sessionId]/route.ts`**

In the PATCH handler, after `await updateSession(sessionId, validation.data)`:
```typescript
await regenerateFutureEvents(clientId, planId)
  .catch(err => captureApiError(err, { action: "regenerate-events-after-update", planId }));
```

Regenerate on any session update (not just dayOfWeek changes) since name/calorie changes should also update future events.

**5. Session add — modify `app/api/clients/[id]/training/[planId]/sessions/route.ts`**

After `await addSession(planId, ...)`, call `regenerateFutureEvents(clientId, planId)` with `.catch()`.

**6. Session delete — modify `app/api/clients/[id]/training/[planId]/sessions/[sessionId]/route.ts`**

In the DELETE handler, after `await deleteSession(sessionId)`, call `regenerateFutureEvents(clientId, planId)` with `.catch()`.

**7. Link completions to events**

Read `app/api/client/session-completions/route.ts` and `services/client-portal-training.ts` to find where `session_logs` are inserted.

After a session_log is created:
a. Look up the event for today: `const event = await getEventForDate(clientId, today)`
b. If event exists: `await linkSessionLogToEvent(event.id, sessionLogId, completionQuality)`
c. If event doesn't exist (edge case — completion without a scheduled event), that's fine — the session_log still works on its own.

**8. Backfill script — `scripts/backfill-training-events.ts`**

Create a standalone script runnable via `npx tsx scripts/backfill-training-events.ts`:

a. Query all training plans with sessions: `supabaseAdmin.from("training_plans").select("id, client_id, effective_from, effective_until, program_duration_weeks, phase_id, training_sessions(id, name, day_of_week, session_type, focus, estimated_calories, is_active)")`.
b. For each plan:
   - Filter sessions to `is_active !== false` and `session_type === "training"` with `day_of_week` assigned.
   - If `phase_id` exists, query `phases` for `end_date`. Calculate endDate as `min(effective_until, phase end_date, today)`.
   - If no phase: endDate = `min(effective_until, effective_from + 8 weeks, today)`.
   - Call `generateTrainingEvents(clientId, planId, sessions, effective_from, endDate)`.
c. After all plans: link existing `session_logs` to events:
   - Query `session_logs` with `training_session_id IS NOT NULL`.
   - For each, query `training_events` matching `(client_id, training_session_id, date = completed_at::date)`.
   - If found, update with `session_log_id` and status based on `completion_quality`.
d. Log progress to console.

After implementing, run `npx tsc --noEmit` to verify no type errors. Commit when done.
```

---

## Session 3: Consumer Migration

**Goal:** Switch all consumers from template `day_of_week` matching to event-based queries. Delete dead code. After this session: all training schedule resolution reads from `training_events`.

### What gets done
- Training history API reads from events
- Check-in snapshot service reads from events
- Training summary API uses event count
- Training period stats API uses event count
- Check-in context service (`getCheckInTrainingPeriodStats`) uses event count
- Check-in context service (`getCheckInTrainingContext`) reads events for check-in form session list
- Daily context service uses event lookup
- Attention feed service uses event count
- Delete `training-schedule-generator.ts`, its tests, `countPlannedSessions()`
- Simplify `schedule-data-service.ts` (remove training queries, keep nutrition)

### How to test
1. Open Training Data tab — verify correct sessions for each date
2. Move a session — verify past rows unchanged, future rows show new day
3. Hero summary strip — verify correct completed/planned counts
4. Daily Pulse — verify today's session shows correctly
5. Submit a check-in — verify snapshot reads from events
6. `npx tsc --noEmit` and `npx vitest run` pass

### Claude Code prompt

```
Read CALENDAR-EVENTS-PLAN.md for full context, then read CONVENTIONS.md and docs/ARCHITECTURE.md.

This is Session 3 of 5. Switch all training schedule consumers from template day_of_week matching to reading from training_events.

**Read first:**
- `services/training-event-service.ts` — `getEventsForDateRange`, `getEventForDate`, `countEventsInRange`
- `utils/training-event-helpers.ts` — `mapEventsToScheduleDays`, `getEventCaloriesByDay`
- `utils/training-schedule-generator.ts` — `buildTrainingSchedule()` to be DELETED
- `utils/training-week-helpers.ts` — `countPlannedSessions()` to be DELETED
- `services/schedule-data-service.ts` — `fetchTrainingDataForPeriod()` to be simplified
- `app/api/clients/[id]/history/training/route.ts` — training history API
- `services/check-in-snapshot-service.ts` — snapshot generation
- `app/api/clients/[id]/history/training/summary/route.ts` — training summary API
- `app/api/clients/[id]/training/period-stats/route.ts` — period stats API
- `services/check-in-context-service.ts` — `getCheckInTrainingPeriodStats()` AND `getCheckInTrainingContext()` (feeds check-in form session list)
- `services/daily-context-service.ts` — `getTodaysTrainingSession()`
- `services/attention-feed-service.ts` — planned session count (lines 124-137)
- `components/check-in/training-session-checklist.tsx` — renders session list with dayOfWeek labels (consumes getCheckInTrainingContext)

**1. Training history API — modify `app/api/clients/[id]/history/training/route.ts`**

Replace the `fetchTrainingDataForPeriod` + `buildTrainingSchedule` flow with:
```typescript
const events = await getEventsForDateRange(clientId, phaseStartDate, today);
const schedule = mapEventsToScheduleDays(dates, events);
```
Map schedule to `TrainingHistoryRow[]` using the existing `mapScheduleDayToRow` function.
Remove imports of `fetchTrainingDataForPeriod` and `buildTrainingSchedule`.

**2. Check-in snapshot service — modify `services/check-in-snapshot-service.ts`**

Replace `buildTrainingSchedule(dates, trainingData.plans, ...)` with:
```typescript
const events = await getEventsForDateRange(clientId, periodStart, periodEnd);
const training = mapEventsToScheduleDays(dates, events);
```
Keep the `fetchNutritionDataForPeriod` call (nutrition is separate). Remove the `fetchTrainingDataForPeriod` call if it was only used for training schedule generation.

**3. Training summary API — modify `app/api/clients/[id]/history/training/summary/route.ts`**

Replace `countPlannedSessions(sessions, weekStart, weekEnd)` with:
```typescript
const totalPlanned = await countEventsInRange(clientId, weekStart, weekEnd);
const plannedUpToToday = await countEventsInRange(clientId, weekStart, today);
```
Remove the `getActiveTrainingPlan` call and `countPlannedSessions` import if no longer needed.

**4. Training period stats API — modify `app/api/clients/[id]/training/period-stats/route.ts`**

Same as step 3: replace `countPlannedSessions` with `countEventsInRange`.

**5. Check-in context service (period stats) — modify `services/check-in-context-service.ts`**

In `getCheckInTrainingPeriodStats()`, replace `countPlannedSessions` with `countEventsInRange(clientId, periodStart, periodEnd)`.

**6. Check-in context service (training context) — modify `services/check-in-context-service.ts`**

In `getCheckInTrainingContext()`, the function currently calls `getActiveTrainingPlan()` and returns the sessions list for the check-in form (so the client can mark sessions as completed). Replace with event-based lookup:
a. Calculate the check-in period dates (periodStart, periodEnd).
b. Call `getEventsForDateRange(clientId, periodStart, periodEnd)` to get all events for the period.
c. Map events to the return type: `{ sessionId: event.trainingSessionId, sessionName: event.sessionName, dayOfWeek, exercises: [] }`.
d. For exercises, either join from the template via `training_session_id` or include exercise data on the event. Since events snapshot the session name but not exercises, fall back to the template's `training_session_id` to fetch exercises if needed.

**7. Daily context service — modify `services/daily-context-service.ts`**

Replace `getTodaysTrainingSession()`:
```typescript
export const getTodaysTrainingSession = async (clientId: string, date?: string): Promise<TodaysTrainingSession> => {
  const dateStr = date ?? getTodayDateString();
  const event = await getEventForDate(clientId, dateStr);
  if (!event) return null;
  return {
    sessionId: event.trainingSessionId ?? event.id,
    sessionName: event.sessionName,
    estimatedCalories: event.estimatedCalories ?? 0,
  };
};
```

`getTodaysPlannedActivities()` stays template-based (external activities are not events).

**8. Attention feed service — modify `services/attention-feed-service.ts`**

Replace the template-based planned session count (lines 124-137) with `countEventsInRange` per client for the 28-day window.

**9. Delete dead code**

- DELETE `utils/training-schedule-generator.ts`
- DELETE `utils/__tests__/training-schedule-generator.test.ts`
- Remove `countPlannedSessions()` from `utils/training-week-helpers.ts` — grep first to verify no remaining callers. If the file is empty, delete it.
- Simplify `services/schedule-data-service.ts`: remove `fetchTrainingDataForPeriod()` if no callers remain (keep `fetchNutritionDataForPeriod`).

After implementing, run `npx tsc --noEmit` and `npx vitest run`. Commit when done.
```

---

## Session 4: Calorie Burn Follows Training Day

**Goal:** Nutrition calorie calculations read from training events so moving a session automatically moves the calorie burn. After this session: nutrition targets reflect the actual event schedule.

### What gets done
- `buildDailyTargetsFromPlan()` accepts optional `trainingEvents` parameter
- `getPlanTargetForDate()` looks up event calories instead of template
- Coach nutrition GET and client portal pass events to the builder
- `getCheckInNutritionContext()` uses events for training day detection
- `buildNutritionSummary()` uses events for unlogged day calorie estimation
- `getWeeklyNutritionTargets()` updated if still used

### How to test
1. Nutrition tab shows correct daily targets with training burn from events
2. Move a session from Monday to Thursday — Monday's target drops, Thursday's increases
3. External activity calories still work (template-based)
4. Client Daily Pulse shows correct nutrition target
5. `npx tsc --noEmit` passes

### Claude Code prompt

```
Read CALENDAR-EVENTS-PLAN.md for full context, then read CONVENTIONS.md and docs/ARCHITECTURE.md.

This is Session 4 of 5. Make nutrition calorie calculations read from training events.

**Read first:**
- `utils/training-event-helpers.ts` — `getEventCaloriesByDay()`
- `services/training-event-service.ts` — `getEventsForDateRange()`, `getEventForDate()`
- `utils/build-daily-targets.ts` — `buildDailyTargetsFromPlan()` (currently calls `getTrainingSessionCaloriesByDay(trainingPlan)` at line 34)
- `utils/training-calorie-helpers.ts` — `getTrainingSessionCaloriesByDay()` (template-based, being replaced for live views)
- `services/daily-context-service.ts` — `getPlanTargetForDate()` (lines 105-163)
- `app/api/clients/[id]/nutrition/route.ts` — GET handler that calls `buildDailyTargetsFromPlan`
- `services/client-portal-service.ts` — client-side nutrition target fetch
- `services/check-in-context-service.ts` — `getCheckInNutritionContext()` (line 55, calls `getActiveTrainingPlan` for training day detection)
- `utils/nutrition-helpers.ts` — `getWeeklyNutritionTargets()` calls `getTrainingSessionCaloriesByDay`, and `getTrainingDays()` (line 91) detects training days from template
- `utils/nutrition-period-summary.ts` — `buildNutritionSummary()` uses `trainingPlans` for unlogged day calorie estimation
- `hooks/use-nutrition-plan.ts` — client-side hook (check if it calls API or reads template directly)
- `lib/date-helpers.ts` — `getTrainingWeekStart()`, `getTrainingWeekEnd()`, `getTodayDateString()`
- `types/training.ts` — `TrainingEvent` type

**1. Update `buildDailyTargetsFromPlan` — modify `utils/build-daily-targets.ts`**

Add optional `trainingEvents` parameter:
```typescript
export function buildDailyTargetsFromPlan(
  plan: PlanBaseline,
  dailyTargetRows: StoredDailyTarget[] | null,
  trainingPlan: TrainingPlan | null,
  includeActivityBurn: boolean,
  dietType: DietType,
  trainingEvents?: TrainingEvent[]
): DailyNutritionTargets[]
```

At line 34, change:
```typescript
const trainingSessionCaloriesByDay = trainingEvents
  ? getEventCaloriesByDay(trainingEvents)
  : getTrainingSessionCaloriesByDay(trainingPlan);
```

Import `TrainingEvent` from `@/types/training` and `getEventCaloriesByDay` from `@/utils/training-event-helpers`. External activity calories still come from `getExternalActivitiesForDay(trainingPlan, day)` — unchanged.

**2. Update `getPlanTargetForDate` — modify `services/daily-context-service.ts`**

Replace the template-based training calorie lookup with event lookup:
```typescript
const event = await getEventForDate(clientId, date);
const trainingCalories = event?.estimatedCalories ?? 0;
```
External activity calories still come from the template. Remove the `getActiveTrainingPlan` call and `getTrainingSessionCaloriesByDay` usage from this function.

**3. Update coach nutrition GET — modify `app/api/clients/[id]/nutrition/route.ts`**

In the GET handler, fetch current week's events and pass to `buildDailyTargetsFromPlan`:
```typescript
const weekStart = getTrainingWeekStart(getTodayDateString(), client?.expected_check_in_day);
const weekEnd = getTrainingWeekEnd(getTodayDateString(), client?.expected_check_in_day);
const events = await getEventsForDateRange(clientId, weekStart, weekEnd);
const dailyTargets = buildDailyTargetsFromPlan(plan, dailyTargetRows, trainingPlan, includeActivityBurn, dietType, events);
```

**4. Update client portal — modify `services/client-portal-service.ts`**

Same pattern: fetch events for current week, pass to `buildDailyTargetsFromPlan` (or `getWeeklyNutritionTargets` if that's what the client portal uses).

**5. Update `getWeeklyNutritionTargets` if still used — modify `utils/nutrition-helpers.ts`**

If this function is called from the client portal or check-in context, add an optional `trainingEvents` parameter and pass through to `buildDailyTargetsFromPlan`.

**6. Update `getCheckInNutritionContext` — modify `services/check-in-context-service.ts`**

This function calls `getActiveTrainingPlan()` at line 75 to detect training days for nutrition enrichment. Update to fetch events for the check-in period and use them for training day detection instead of the template. Pass events to `getWeeklyNutritionTargets` (or `buildDailyTargetsFromPlan` if that's what it uses internally).

**7. Update `buildNutritionSummary` — modify `utils/nutrition-period-summary.ts`**

Currently receives `trainingPlans` and uses template `dayOfWeek` + `estimatedCalories` to estimate calorie burn for unlogged days. Update to accept optional `trainingEvents` parameter:
- When events provided: use event's `estimatedCalories` for the specific date (more accurate than template)
- When no events: fall back to template estimation (backward compat for old periods)

After implementing, run `npx tsc --noEmit` and `npx vitest run`. Commit when done.
```

---

## Session 5: Nutrition Regeneration with Keep-Calories Option

**Goal:** Add a "keep current calories" option when regenerating nutrition plans, and ensure `is_training_day` flags derive from events. After this session: coach can regenerate nutrition without stale weight/goal data producing unexpected calorie changes.

### What gets done
- `preserveCalories` field added to nutrition validation schema
- Nutrition POST supports preserving baseline calories
- `is_training_day` derived from events instead of template
- Keep-calories dialog in the regeneration UI

### How to test
1. "Recalculate calories" works as before
2. "Keep current calories" preserves baseline, recalculates macros, updates training days from events
3. Move a session, regenerate nutrition — `is_training_day` reflects new schedule
4. Dialog renders with correct options
5. `npx tsc --noEmit` passes

### Claude Code prompt

```
Read CALENDAR-EVENTS-PLAN.md for full context, then read CONVENTIONS.md and docs/ARCHITECTURE.md.

This is Session 5 of 5. Add "keep current calories" option for nutrition regeneration and derive is_training_day from events.

**Read first:**
- `app/api/clients/[id]/nutrition/route.ts` — POST handler (full flow: validate → calculate baseline → build daily targets → createNutritionPlan RPC)
- `services/nutrition-service.ts` — `generateNutritionPlan()`, `calculateBaselineCalories()`
- `services/nutrition-plan-service.ts` — `createNutritionPlan()` wrapper
- `supabase/migrations/048_create_nutrition_plan_atomic.sql` — the RPC
- `lib/validations/nutrition.ts` — Zod schema for nutrition plan creation
- `utils/nutrition-helpers.ts` — `calculateDailyMacros()`
- `components/clients/nutrition/nutrition-regeneration-banner.tsx` — existing regeneration UI
- `services/training-event-service.ts` — `getEventsForDateRange()`
- `lib/date-helpers.ts` — `getTrainingWeekStart()`, `getTrainingWeekEnd()`

**1. Update validation schema — modify `lib/validations/nutrition.ts`**

Add `preserveCalories: z.boolean().optional()` to the nutrition plan creation schema (find the exact schema name).

**2. Update nutrition POST — modify `app/api/clients/[id]/nutrition/route.ts`**

Add a new code path when `body.preserveCalories === true`:
a. Fetch the current active plan's `baseline_calories`: `supabaseAdmin.from("nutrition_plans").select("baseline_calories").eq("client_id", clientId).eq("status", "active").maybeSingle()`.
b. If no active plan: return 400 error "No active nutrition plan to preserve calories from".
c. Use the existing `baseline_calories` (skip `calculateBaselineCalories()`).
d. Recalculate macros: `calculateDailyMacros(baselineCalories, proteinG, false, dietType)` where `proteinG = Math.round(currentWeightKg * body.proteinTargetGPerKg)`.
e. Continue with daily targets build and `createNutritionPlan` call.
f. Set `regeneration_reason: "regenerated_preserved_calories"`.
g. If `preserveCalories` is false or undefined: existing flow unchanged.

**3. Update `is_training_day` derivation — modify `services/nutrition-plan-service.ts`**

Find where `is_training_day` is set for each day when creating a nutrition plan. Currently it reads from the training plan template's sessions.

Update to derive from events:
a. Before building daily targets, fetch current week's events: `await getEventsForDateRange(clientId, weekStart, weekEnd)`.
b. Build a Set of training days: `new Set(events.map(e => getDayOfWeek(e.date)))` where `getDayOfWeek` converts date to lowercase day name.
c. For each day: `is_training_day = trainingDaySet.has(day)`.
d. Fall back to template if no events exist.

**4. UI — add keep-calories dialog — modify or create near `components/clients/nutrition/nutrition-regeneration-banner.tsx`**

When coach clicks "Regenerate Nutrition Plan", show a dialog with:
- "Recalculate calories" — sends `preserveCalories: false` (default)
- "Keep current calories" — sends `preserveCalories: true`
- "Cancel"

Brief explanation text:
- Recalculate: "Updates calories based on current weight, goal, and timeline"
- Keep current: "Preserves current calorie targets, updates training day distribution only"

Use the existing dialog/modal pattern from the codebase.

After implementing, run `npx tsc --noEmit` and `npx vitest run`. Commit when done.
```

---

## Summary

| Session | Scope | Key Test | Depends On |
|---------|-------|----------|------------|
| 1 | Migration + event service + helpers | Events generated, queries return correct data | Nothing |
| 2 | Wire events into plan lifecycle + backfill | Create/edit/regenerate produces correct events | Session 1 |
| 3 | Consumer migration (12+ consumers) | Data tabs read from events, dead code deleted | Sessions 1-2 |
| 4 | Calorie burn follows training day | Moving a session moves calories in nutrition | Sessions 1-2 |
| 5 | Keep-calories option for nutrition regeneration | Coach preserves baseline, training days updated | Sessions 1-2 |

Sessions 3, 4, and 5 can run in parallel after Session 2.
