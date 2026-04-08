# Unified Implementation Plan — 9 Remaining Sessions

## Completed Sessions

| Session | Status |
|---------|--------|
| CHECK-IN Session 1: Bug fixes + notifications | Done |
| CHECK-IN Session 2: Training plan versioning | Done |
| CHECK-IN Session 3: Schedule generator + snapshots | Done |
| CHECK-IN Session 3b: Unlogged day visibility in data pages | Done |

## Remaining Sessions — Execution Order

| Order | Session | Source | Scope | Depends On |
|-------|---------|--------|-------|------------|
| 1 | CE-1 | Calendar Events | Migration + event service + helpers | Nothing |
| 2 | CE-2 | Calendar Events | Wire events into plan lifecycle + backfill | CE-1 |
| 3 | CE-3 | Calendar Events | Consumer migration (12+ consumers) | CE-1, CE-2 |
| 4 | CR-4 | Check-In Review | Check-Ins tab (list + detail views) | CE-3 (snapshots now read from events) |
| 5 | CR-5 | Check-In Review | Dashboard + roadmap enrichment | CE-3 |
| 6 | CE-4 | Calendar Events | Calorie burn follows training day | CE-1, CE-2 |
| 7 | CE-5 | Calendar Events | Nutrition regeneration keep-calories option | CE-1, CE-2 |

**Notes:**
- CE-3, CR-4, and CR-5 should be sequential (CE-3 first, then CR-4/CR-5 in parallel)
- CE-4 and CE-5 can run in parallel with CR-4/CR-5 after CE-2

---

## CE-1: Database Migration + Event Generation Service

**Goal:** Create the `training_events` table and a service that generates/queries events.

Prompt and full details: see [CALENDAR-EVENTS-PLAN.md](CALENDAR-EVENTS-PLAN.md) Session 1.

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

Duration logic: use `training_plans.program_duration_weeks` if set. If plan has `phase_id`, query `phases` for `end_date` (or `start_date + duration_weeks`). If neither, default to 8 weeks from `effective_from`.

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

## CE-2: Wire Events into Plan Lifecycle

**Goal:** Every path that creates, regenerates, or modifies training plans now also generates/regenerates events.

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
c. If event doesn't exist (edge case), that's fine — the session_log still works on its own.

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

## CE-3: Consumer Migration

**Goal:** Switch all 12+ consumers from template `day_of_week` matching to event-based queries. Delete dead code.

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
d. For exercises, fall back to the template's `training_session_id` to fetch exercises if needed (events don't store exercise detail).

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

## CR-4: Check-Ins Tab (List + Detail Views)

**Goal:** Build the new "Check-Ins" tab in the client sidebar with list and detail views. The detail view reads from `period_snapshot` for historical accuracy.

Full prompt: see [CHECK-IN-REVIEW-PLAN.md](CHECK-IN-REVIEW-PLAN.md) Session 4 Claude Code prompt (unchanged — it reads from snapshots which are now populated from events).

---

## CR-5: Dashboard + Roadmap Enrichment

**Goal:** Upgrade the dashboard check-in widget and enrich roadmap phase cards with data from snapshots.

Full prompt: see [CHECK-IN-REVIEW-PLAN.md](CHECK-IN-REVIEW-PLAN.md) Session 5 Claude Code prompt.

**One update:** The prompt references `countPlannedSessions()` in the phase weekly data service. After CE-3, this should use `countEventsInRange()` instead. When executing this session, use event counts rather than `countPlannedSessions`.

---

## CE-4: Calorie Burn Follows Training Day

**Goal:** Nutrition calorie calculations read from training events so moving a session automatically moves the calorie burn.

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

Replace template-based training calorie lookup:
```typescript
const event = await getEventForDate(clientId, date);
const trainingCalories = event?.estimatedCalories ?? 0;
```
External activity calories still come from the template.

**3. Update coach nutrition GET — modify `app/api/clients/[id]/nutrition/route.ts`**

Fetch current week's events, pass to `buildDailyTargetsFromPlan`:
```typescript
const weekStart = getTrainingWeekStart(getTodayDateString(), client?.expected_check_in_day);
const weekEnd = getTrainingWeekEnd(getTodayDateString(), client?.expected_check_in_day);
const events = await getEventsForDateRange(clientId, weekStart, weekEnd);
const dailyTargets = buildDailyTargetsFromPlan(plan, dailyTargetRows, trainingPlan, includeActivityBurn, dietType, events);
```

**4. Update client portal — modify `services/client-portal-service.ts`**

Same pattern: fetch events for current week, pass to `buildDailyTargetsFromPlan`.

**5. Update `getWeeklyNutritionTargets` if still used — modify `utils/nutrition-helpers.ts`**

Add optional `trainingEvents` parameter and pass through to `buildDailyTargetsFromPlan`.

**6. Update `getCheckInNutritionContext` — modify `services/check-in-context-service.ts`**

This function calls `getActiveTrainingPlan()` to detect training days for nutrition enrichment. Update to fetch events for the check-in period and use them for training day detection.

**7. Update `buildNutritionSummary` — modify `utils/nutrition-period-summary.ts`**

Currently receives `trainingPlans` and uses template `dayOfWeek` + `estimatedCalories` to estimate calorie burn for unlogged days. Update to accept optional `trainingEvents` parameter:
- When events provided: use event's `estimatedCalories` for the specific date
- When no events: fall back to template estimation (backward compat for old periods)

After implementing, run `npx tsc --noEmit` and `npx vitest run`. Commit when done.
```

---

## CE-5: Nutrition Regeneration with Keep-Calories Option

**Goal:** Add a "keep current calories" option when regenerating nutrition plans, and ensure `is_training_day` flags derive from events.

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

Add `preserveCalories: z.boolean().optional()` to the nutrition plan creation schema.

**2. Update nutrition POST — modify `app/api/clients/[id]/nutrition/route.ts`**

When `body.preserveCalories === true`:
a. Fetch the current active plan's `baseline_calories`: `supabaseAdmin.from("nutrition_plans").select("baseline_calories").eq("client_id", clientId).eq("status", "active").maybeSingle()`.
b. If no active plan: return 400 error "No active nutrition plan to preserve calories from".
c. Use the existing `baseline_calories` (skip `calculateBaselineCalories()`).
d. Recalculate macros: `calculateDailyMacros(baselineCalories, proteinG, false, dietType)` where `proteinG = Math.round(currentWeightKg * body.proteinTargetGPerKg)`.
e. Continue with daily targets build and `createNutritionPlan` call.
f. Set `regeneration_reason: "regenerated_preserved_calories"`.
g. If `preserveCalories` is false or undefined: existing flow unchanged.

**3. Update `is_training_day` derivation — modify `services/nutrition-plan-service.ts`**

Find where `is_training_day` is set for each day when creating a nutrition plan. Update to derive from events:
a. Fetch current week's events: `await getEventsForDateRange(clientId, weekStart, weekEnd)`.
b. Build a Set of training days: `new Set(events.map(e => getDayOfWeek(e.date)))`.
c. For each day: `is_training_day = trainingDaySet.has(day)`.
d. Fall back to template if no events exist.

**4. UI — add keep-calories dialog — modify `components/clients/nutrition/nutrition-regeneration-banner.tsx`**

When coach clicks "Regenerate Nutrition Plan", show a dialog:
- "Recalculate calories" (default — recalculates from TDEE/goal)
- "Keep current calories" (preserves baseline, updates training day distribution)
- "Cancel"

Brief explanation:
- Recalculate: "Updates calories based on current weight, goal, and timeline"
- Keep current: "Preserves current calorie targets, updates training day distribution only"

Use the existing dialog/modal pattern from the codebase.

After implementing, run `npx tsc --noEmit` and `npx vitest run`. Commit when done.
```

---

## Final Summary

| Order | Session | What it does |
|-------|---------|-------------|
| 1 | **CE-1** | Create `training_events` table + event generation service |
| 2 | **CE-2** | Wire events into create/edit/regenerate/complete flows + backfill |
| 3 | **CE-3** | Switch 12+ consumers to events, delete template reconstruction code |
| 4 | **CR-4** | Check-Ins tab with list + detail views (reads from snapshots) |
| 5 | **CR-5** | Dashboard queue card + roadmap phase enrichment |
| 6 | **CE-4** | Nutrition calorie burn follows training day via events |
| 7 | **CE-5** | "Keep current calories" option for nutrition regeneration |

---

## Post-Completion Cleanup

Once all 7 sessions are done and verified:

### 1. Delete plan documents
- DELETE `IMPLEMENTATION-PLAN.md` (this file)
- DELETE `CALENDAR-EVENTS-PLAN.md`
- DELETE `CHECK-IN-REVIEW-PLAN.md`

### 2. Update `docs/ARCHITECTURE.md`

Add/update the following sections to reflect the new reality:

**Data hierarchy** — add `training_events` to the diagram:
```
training_plans (template/blueprint)
  └── training_sessions (weekly blueprint)
        └── training_exercises
training_events (materialized schedule — one row per session per date)
  └── linked to session_logs on completion
```

**Training events lifecycle:**
- Plan created (AI or manual) → events generated for phase duration (or 8 weeks default)
- Coach moves a session → past events frozen, future events regenerated
- Coach edits session name/exercises → future events regenerated with new snapshot
- Coach regenerates plan → old plan's future events deleted, new plan's events generated
- Client completes a session → event status updated, `session_log_id` linked
- Past events are immutable — they represent what was actually scheduled

**Templates vs events:**
- `training_sessions.day_of_week` = the blueprint (what the recurring week looks like)
- `training_events` = the materialized schedule (concrete dates with snapshotted session names)
- The Plans tab reads from templates (coach's blueprint view)
- The Data tab, Daily Pulse, check-in snapshots, and nutrition calorie calculations read from events

**Nutrition calorie flow:**
- Daily nutrition target = plan baseline + training event estimated calories + external activity calories
- When a session moves to a different day, future events regenerate → nutrition targets update automatically
- `nutrition_plan_daily_targets.is_training_day` derived from events at plan creation

**Nutrition regeneration options:**
- "Recalculate calories" — recalculates from TDEE/deficit using current weight and goal timeline
- "Keep current calories" — preserves existing baseline, only updates training day distribution and macros

**Check-in snapshot:**
- `check_ins.period_snapshot` JSONB — frozen day-by-day training + nutrition schedule
- Training data reads from `training_events` (accurate per-date history)
- Nutrition data reads from `nutrition_logs` stored targets (includes activity burn) + plan targets for unlogged days
- Written at submission time, never updated

### 3. Verify nothing references deleted code
Run `npx tsc --noEmit` and `npx vitest run` one final time to confirm clean build.
