# Unified Implementation Plan — 7 Remaining Sessions

## Completed Sessions

| Session | Status |
|---------|--------|
| CHECK-IN Session 1: Bug fixes + notifications | Done |
| CHECK-IN Session 2: Training plan versioning | Done |
| CHECK-IN Session 3: Schedule generator + snapshots | Done |
| CHECK-IN Session 3b: Unlogged day visibility in data pages | Done |
| CE-1: Training events migration + event service + helpers | Done |
| CE-2: Wire training events into plan lifecycle + backfill | Done |
| CE-3: Training consumer migration (12+ consumers) | Done |

## Remaining Sessions — Execution Order

| Order | Session | Source | Scope | Depends On |
|-------|---------|--------|-------|------------|
| 1 | NE-1 | Nutrition Events | Migration + nutrition event service + helpers | CE-2 (done) |
| 2 | NE-2 | Nutrition Events | Wire nutrition events into plan lifecycle + backfill | NE-1 |
| 3 | NE-3 | Nutrition Events | Nutrition consumer migration + training cascade | NE-1, NE-2, CE-3 (done) |
| 4 | PT-1 | Plan Transitions | Plan continuation across phase transitions | NE-2 (event extension functions exist) |
| 5 | EL-1 | Event Lifecycle | Rolling event window for no-roadmap clients | NE-2 (event extension functions exist) |
| 6 | CR-4 | Check-In Review | Check-Ins tab (list + detail views) | CE-3 (done), NE-3 |
| 7 | CR-5 | Check-In Review | Dashboard + roadmap enrichment | CE-3 (done) |

**Notes:**
- NE-1 → NE-2 → NE-3 must be sequential (each depends on the previous)
- PT-1 and EL-1 depend on NE-2 (the event regeneration functions) but NOT on NE-3 (consumer migration). They can run in parallel with NE-3 if desired.
- CR-5 only depends on CE-3 (done), so it can run in parallel with any session
- CR-4 depends on NE-3 so snapshots use both training and nutrition event types

**Why nutrition events?** The original CE-4/CE-5 planned to make nutrition calorie calculations read from training events while keeping the template-based nutrition plan model (7 day-of-week rows per plan). This had critical bugs:
1. ~~The `create_nutrition_plan_atomic` RPC always archives the old plan immediately and sets `effective_from = CURRENT_DATE`, even when the coach picks a future date. This creates a date gap where no plan covers the intervening days.~~ **Fixed:** RPC now accepts `p_effective_from` (migration 078). Future dates insert as `planned` status instead of immediately archiving the active plan (migration 080). Lazy promotion via `promoteNutritionPlanIfReady()` upgrades planned → active when `effective_from <= today`.
2. ~~`effective_from` is overwritten in a separate non-atomic UPDATE after the RPC, so a failure leaves the plan with the wrong date.~~ **Fixed:** `p_effective_from` is passed directly to the RPC. The post-RPC UPDATE hack has been removed from `nutrition-plan-service.ts`.
3. Historical nutrition targets are mutable because they derive from the current active plan template, not from immutable per-date records.

Nutrition events solve #3 by materializing one row per client per date with concrete calorie/macro targets. Past events are immutable. Future events regenerate when plans change. The `effective_from` date controls which events to regenerate, and the `planned` status ensures the active plan stays in place until the new plan's start date arrives.

**Planned status lifecycle (added post-NE-1):**
- `effective_from <= today` → archives old active plan, inserts as `active` (original behavior)
- `effective_from > today` → old active plan stays untouched, inserts as `planned`
- On next read: `promoteNutritionPlanIfReady(clientId)` checks for a planned plan with `effective_from <= today`, archives active, promotes planned → active with `effective_until = NULL`
- Promotion is wired into all 7 read paths that filter `.eq("status", "active")`: coach nutrition GET, skew POST, activation-readiness GET, comparison-service, client-portal-service, check-in-context-service
- The GET handler returns `upcomingPlan` (with daily targets) when a planned plan exists, shown in the UI below the active plan's breakdown
- Migrations: `079_add_planned_nutrition_status.sql` (partial unique index), `080_nutrition_rpc_planned_status.sql` (RPC branching)

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

## NE-1: Nutrition Events Migration + Event Service

**Goal:** Create the `nutrition_events` table, fix the `create_nutrition_plan_atomic` RPC to handle future effective dates correctly, and build a service that generates/queries nutrition events.

### Design decisions

**Why nutrition events?** The current nutrition plan model stores 7 template rows per plan (one per day-of-week). This means:
- Historical targets are mutable (they reflect the current plan template, not what was actually prescribed)
- Future effective dates create a gap (old plan archived, new plan not yet active)
- Training day swaps don't cascade to nutrition until the plan is regenerated

Nutrition events solve this by materializing one row per client per date. Each row stores the concrete calorie/macro targets for that specific date. Past events are immutable. Future events regenerate when plans change or training days move.

**What a nutrition event stores:** Each event captures the complete target picture for a single day:
- `baseline_calories` - the plan's rest-day calorie target (frozen at event creation)
- `training_burn_calories` - from the training event on that date (0 if rest day)
- `external_burn_calories` - from external activities mapped to that day-of-week
- `protein_g`, `carb_g`, `fat_g` - **baseline macros** (calculated from `baseline_calories` only, not burn-inclusive total)
- `diet_type` - snapshotted from plan at generation time, enables display-time macro recalculation when burns are included
- `is_training_day` - derived from training events at generation time

The `include_activity_burn` client toggle does NOT affect stored events. It is a display-layer concern: when off, the UI shows `baseline_calories` and stored baseline macros directly; when on, the display helper recalculates macros via `calculateDailyMacros(totalCalories, proteinG, isTrainingDay, dietType)` using the event's snapshotted `diet_type`. This avoids needing to regenerate events when the toggle changes.

**Upsert strategy:** Unlike training events which use `ignoreDuplicates: true` (their unique constraint includes `training_session_id`), nutrition events use upsert with **overwrite on conflict** (`onConflict: 'client_id,date'`, no `ignoreDuplicates`). This ensures new plan values always win if old events weren't deleted first.

### Claude Code prompt

```
Read IMPLEMENTATION-PLAN.md for full context, then read CONVENTIONS.md and docs/ARCHITECTURE.md.

This is NE-1: Nutrition Events Migration + Event Service.

**Read first:**
- `supabase/migrations/075_create_training_events.sql` — training events table for pattern reference
- `supabase/migrations/076_fix_training_events_constraint.sql` — partial unique index pattern

**Refactored file locations (type quality refactor moved code, re-exports preserve all import paths):**
- `services/training-mappers.ts` — `mapExerciseRow`, `mapSessionRow`, `mapPlanRow` (extracted from training-service.ts)
- `services/training-session-service.ts` — session CRUD: `updateSession`, `addSession`, `deleteSession`, `replaceSessionExercises`, `getSessionWithExercises` (extracted from training-service.ts)
- `services/training-exercise-service.ts` — exercise CRUD: `updateExercise`, `addExercise`, `deleteExercise` (extracted from training-service.ts)
- `services/training-plan-history-service.ts` — `saveTrainingPlanHistory`, `getTrainingPlanHistory` (extracted from training-service.ts)
- `services/nutrition-plan-orchestrator.ts` — nutrition plan creation orchestration (extracted from nutrition route POST handler)
- `services/training-plan-orchestrator.ts` — training plan creation orchestration (extracted from training route POST handler)
- `lib/attention-feed-helpers.ts` — `groupClientData`, `evaluateAndSortTriggers` (extracted from attention-feed-service.ts)
- `utils/weekly-nutrition-helpers.ts` — `calculateWeeklySummaryFromLogs`, `calculateWeeklyAdherence` (extracted from weekly-nutrition-service.ts)
- `utils/weekly-nutrition-mappers.ts` — `mapNutritionRowToDailyLog`, `mapRowToSummary` (extracted from weekly-nutrition-service.ts)
- All original import paths still work via re-exports. When modifying logic, edit the new source file directly.
- `supabase/migrations/066_add_phase_id_to_nutrition_rpc.sql` — current `create_nutrition_plan_atomic` RPC (the one with the effective_from bug)
- `supabase/migrations/044_create_nutrition_plans_tables.sql` — nutrition_plans + nutrition_plan_daily_targets schema
- `services/training-event-service.ts` — training event service (mirror this pattern)
- `utils/training-event-helpers.ts` — training event helpers (mirror this pattern)
- `types/training.ts` — `TrainingEvent` type for pattern reference
- `types/check-in.ts` — existing nutrition-related types
- `services/nutrition-plan-service.ts` — current `createNutritionPlan()` with the effectiveFrom hack (lines 114-119)
- `utils/nutrition-helpers.ts` — `DAYS_OF_WEEK`, `calculateDailyMacros()`, `getTrainingDays()`, `getExternalActivitiesForDay()`, `calculateExternalActivityCalories()`
- `utils/build-daily-targets.ts` — `buildDailyTargetsFromPlan()` (understand how baseline + burns + macros are composed today)
- `utils/training-calorie-helpers.ts` — `getTrainingSessionCaloriesByDay()` (template-based, being replaced)
- `services/training-event-service.ts` — `getEventsForDateRange()` (needed to look up training burns per date)
- `lib/date-helpers.ts` — `getTodayDateString()`, `getDateString()`, `DAY_NUM`, `getTrainingWeekStart()`, `getTrainingWeekEnd()`
- `lib/database-helpers.ts` — `TrainingEventRow`, `TrainingEventInsert` type pattern

**1. Migration: `supabase/migrations/077_create_nutrition_events.sql`**

```sql
-- Nutrition events: one row per client per date with concrete calorie/macro targets.
-- Past events are immutable. Future events regenerate on plan changes.

CREATE TABLE nutrition_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  nutrition_plan_id UUID NOT NULL REFERENCES nutrition_plans(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  day_of_week TEXT NOT NULL,
  baseline_calories INTEGER NOT NULL,
  training_burn_calories INTEGER NOT NULL DEFAULT 0,
  external_burn_calories INTEGER NOT NULL DEFAULT 0,
  protein_g NUMERIC NOT NULL,
  carb_g NUMERIC NOT NULL,
  fat_g NUMERIC NOT NULL,
  is_training_day BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'logged', 'missed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(client_id, date)
);

CREATE INDEX idx_nutrition_events_client_date ON nutrition_events(client_id, date);
CREATE INDEX idx_nutrition_events_plan ON nutrition_events(nutrition_plan_id);

-- RLS policies (follows pattern from nutrition_plans in migration 044)
ALTER TABLE nutrition_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "coaches_view_client_nutrition_events" ON nutrition_events
  FOR SELECT USING (
    client_id IN (
      SELECT id FROM clients
      WHERE coach_id IN (SELECT id FROM coaches WHERE user_id = auth.uid())
    )
  );

CREATE POLICY "clients_view_own_nutrition_events" ON nutrition_events
  FOR SELECT USING (
    client_id IN (
      SELECT id FROM clients WHERE user_id = auth.uid()
    )
  );

-- Writes go through supabaseAdmin (service role bypass), so no INSERT/UPDATE/DELETE policies needed.
```

Key design: One event per client per date (unique constraint). Unlike training_events which can have multiple per date (multiple sessions), nutrition has exactly one target set per day. `baseline_calories` is snapshotted from the plan's `nutrition_plan_daily_targets` row for that day-of-week (this means custom day distribution and custom macros are automatically respected — the daily target rows ARE the source of truth for baseline). `training_burn_calories` and `external_burn_calories` are stored separately so the `include_activity_burn` toggle works at display time without regeneration.

Note: No `nutrition_log_id` column. Unlike training_events which link to `session_logs`, nutrition logs are accessed via the daily_logs spine pattern (`daily_logs.id` -> `nutrition_logs.daily_log_id`). There's no direct `nutrition_logs.id` to reference, and the event status (`logged`/`missed`) is sufficient for tracking.

Also add `nutrition_events` to the generated types in `types/database.ts` (Row, Insert, Update types) following the existing pattern for `training_events`. Add to `lib/database-helpers.ts`:
```typescript
export type NutritionEventRow = Database["public"]["Tables"]["nutrition_events"]["Row"];
export type NutritionEventInsert = Database["public"]["Tables"]["nutrition_events"]["Insert"];
```

**2. Fix the RPC: `supabase/migrations/078_fix_nutrition_plan_effective_from.sql`**

Update `create_nutrition_plan_atomic` to accept an effective date parameter and set dates correctly:

```sql
CREATE OR REPLACE FUNCTION create_nutrition_plan_atomic(
  p_client_id UUID,
  p_coach_id UUID,
  p_work_activity_level TEXT,
  p_training_volume_hours TEXT,
  p_protein_target_g_per_kg NUMERIC,
  p_diet_type TEXT,
  p_goal_weight_kg NUMERIC,
  p_goal_deadline DATE,
  p_baseline_calories INTEGER,
  p_protein_target_g NUMERIC,
  p_carb_target_g NUMERIC,
  p_fat_target_g NUMERIC,
  p_base_weight_kg NUMERIC,
  p_bmr NUMERIC,
  p_tdee NUMERIC,
  p_custom_macros_enabled BOOLEAN,
  p_custom_calories NUMERIC,
  p_custom_protein_g NUMERIC,
  p_custom_carb_g NUMERIC,
  p_custom_fat_g NUMERIC,
  p_regeneration_reason TEXT,
  p_daily_targets JSONB,
  p_phase_id UUID DEFAULT NULL,
  p_coach_notes TEXT DEFAULT NULL,
  p_goal_source TEXT DEFAULT NULL,
  p_effective_from DATE DEFAULT CURRENT_DATE  -- NEW: caller-controlled effective date
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_effective_from DATE := COALESCE(p_effective_from, CURRENT_DATE);
  v_archive_until DATE := v_effective_from - 1;
  v_new_plan_id UUID;
  v_target JSONB;
BEGIN
  -- 1. Archive current active plan (effective_until = day before new plan starts)
  UPDATE nutrition_plans
  SET status = 'archived',
      effective_until = v_archive_until,
      updated_at = NOW()
  WHERE client_id = p_client_id
    AND status = 'active';

  -- 2. Insert new active plan with correct effective_from
  INSERT INTO nutrition_plans (
    client_id, coach_id, status, effective_from,
    work_activity_level, training_volume_hours, protein_target_g_per_kg,
    diet_type, goal_weight_kg, goal_deadline,
    baseline_calories, protein_target_g, carb_target_g, fat_target_g,
    base_weight_kg, bmr, tdee,
    custom_macros_enabled, custom_calories, custom_protein_g, custom_carb_g, custom_fat_g,
    regeneration_reason, phase_id, coach_notes, goal_source
  ) VALUES (
    p_client_id, p_coach_id, 'active', v_effective_from,
    p_work_activity_level, p_training_volume_hours, p_protein_target_g_per_kg,
    p_diet_type, p_goal_weight_kg, p_goal_deadline,
    p_baseline_calories, p_protein_target_g, p_carb_target_g, p_fat_target_g,
    p_base_weight_kg, p_bmr, p_tdee,
    p_custom_macros_enabled, p_custom_calories, p_custom_protein_g, p_custom_carb_g, p_custom_fat_g,
    p_regeneration_reason, p_phase_id, p_coach_notes, p_goal_source
  )
  RETURNING id INTO v_new_plan_id;

  -- 3. Insert daily target rows from JSONB array
  FOR v_target IN SELECT * FROM jsonb_array_elements(p_daily_targets)
  LOOP
    INSERT INTO nutrition_plan_daily_targets (
      nutrition_plan_id, day_of_week, calories, protein_g, carb_g, fat_g, is_training_day
    ) VALUES (
      v_new_plan_id,
      v_target->>'day_of_week',
      (v_target->>'calories')::INTEGER,
      (v_target->>'protein_g')::NUMERIC,
      (v_target->>'carb_g')::NUMERIC,
      (v_target->>'fat_g')::NUMERIC,
      (v_target->>'is_training_day')::BOOLEAN
    );
  END LOOP;

  RETURN v_new_plan_id;
END;
$$;
```

Key fix: `p_effective_from` is passed by the caller. The old plan's `effective_until` is set to `effective_from - 1` (not hardcoded to yesterday). The new plan's `effective_from` is set correctly in the INSERT (not via a post-hoc UPDATE).

**3. Remove the effectiveFrom hack — modify `services/nutrition-plan-service.ts`**

Delete the post-RPC UPDATE at lines 114-119 (the `if (params.effectiveFrom)` block). Instead, pass `effectiveFrom` into the RPC call:

```typescript
// Add to the RPC params object:
p_effective_from: params.effectiveFrom || null,
```

This ensures the effective date is set atomically within the transaction.

**4. NutritionEvent type — add to `types/check-in.ts`**

```typescript
export type NutritionEventStatus = 'scheduled' | 'logged' | 'missed';

export type NutritionEvent = {
  id: string;
  clientId: string;
  nutritionPlanId: string;
  date: string;
  dayOfWeek: string;
  baselineCalories: number;
  trainingBurnCalories: number;
  externalBurnCalories: number;
  proteinG: number;
  carbG: number;
  fatG: number;
  isTrainingDay: boolean;
  status: NutritionEventStatus;
  createdAt: string;
  updatedAt: string;
};
```

**5. Nutrition event service — `services/nutrition-event-service.ts` (new, ~250 lines)**

All functions use `supabaseAdmin` with RLS exception comments (system-level writes for event generation).

```typescript
export async function generateNutritionEvents(
  clientId: string,
  planId: string,
  plan: { baselineCalories: number; proteinTargetG: number; dietType: string },
  dailyTargetRows: Array<{ day_of_week: string; calories: number; protein_g: number; carb_g: number; fat_g: number; is_training_day: boolean }> | null,
  trainingPlan: TrainingPlan | null,
  startDate: string,
  endDate: string
): Promise<void>
```

Implementation:
a. Fetch training events for the date range: `getEventsForDateRange(clientId, startDate, endDate)` from training-event-service.
b. Build a `Map<date, TrainingEvent[]>` from training events for quick lookup.
c. Build external activities by day-of-week from the training plan template (external activities are not events yet).
d. Iterate dates from `startDate` to `endDate` (same date loop pattern as `generateTrainingEvents`):
   - Get day-of-week string for the date (e.g. "monday")
   - Look up training events for this date; sum `estimatedCalories` for training burn
   - Look up external activities for this day-of-week; calculate external burn
   - Determine `is_training_day` from whether training events exist for this date
   - Get baseline calories: look up `dailyTargetRows` for this day-of-week. If found, use `stored.calories` as baseline (this handles both custom macros plans and custom day distribution — the stored row IS the baseline for that day). If no row found, fall back to `plan.baselineCalories`.
   - Get protein from the same stored row (`stored.protein_g`) if available, otherwise `plan.proteinTargetG`.
   - Calculate total calories = baseline + training burn + external burn
   - Calculate macros via `calculateDailyMacros(totalCalories, proteinG, isTrainingDay, dietType)`
   - Build insert row: `{ client_id, nutrition_plan_id, date, day_of_week, baseline_calories, training_burn_calories, external_burn_calories, protein_g, carb_g, fat_g, is_training_day, status: 'scheduled' }`
e. Bulk upsert: `supabaseAdmin.from("nutrition_events").upsert(rows, { onConflict: 'client_id,date', ignoreDuplicates: true })`

```typescript
export async function regenerateFutureNutritionEvents(
  clientId: string,
  planId: string,
  effectiveFrom?: string
): Promise<void>
```

Implementation:
a. Default `effectiveFrom` to `getTodayDateString()`.
b. Delete future scheduled events: `.delete().eq("nutrition_plan_id", planId).gte("date", effectiveFrom).eq("status", "scheduled")`. (Preserves logged/missed events.)
c. Fetch the current plan's metadata (baseline_calories, protein_target_g, diet_type).
d. Fetch daily target rows for the plan.
e. Fetch the active training plan.
f. Calculate end date using `calculateNutritionEndDate(planId, effectiveFrom)`.
g. Call `generateNutritionEvents(clientId, planId, plan, dailyTargetRows, trainingPlan, effectiveFrom, endDate)`.

```typescript
async function calculateNutritionEndDate(planId: string, today: string): Promise<string | null>
```

Same branching logic as training events:
- Plan has `phase_id` → query `phases` for `end_date` or `start_date + duration_weeks`
- No phase → default 8 weeks from today

**Edge case: effectiveFrom exceeds phase end date.** If the coach picks a future date that falls after the phase ends, there's no coverage window for events. This must be caught in two places:

1. **Frontend (ApplyDateDialog):** When the client has an active phase, the date picker's `max` should be set to the phase end date. This prevents the coach from selecting an impossible date.
2. **Backend (API validation):** In the nutrition POST handler, if `body.effectiveFrom` is set and the plan has a `phaseId`, validate that `effectiveFrom <= phaseEndDate`. If not, return 400 with error: "Start date cannot be after the phase end date ({phaseEndDate})". This gives the coach a clear toast notification explaining why the action was rejected.

The same guard should be applied to the training plan regeneration endpoint (`/regenerate-events`) for consistency.

```typescript
export async function deleteFutureNutritionEventsForPlan(planId: string): Promise<void>
```

Delete events where `nutrition_plan_id = planId AND date >= today AND status = 'scheduled'`.

```typescript
export async function getNutritionEventForDate(clientId: string, date: string): Promise<NutritionEvent | null>
```

Query `nutrition_events` with `client_id` and `date`, `.maybeSingle()`. Map row to `NutritionEvent` type.

```typescript
export async function getNutritionEventsForDateRange(clientId: string, startDate: string, endDate: string): Promise<NutritionEvent[]>
```

Query with date range, order by date ascending. Map rows to `NutritionEvent[]`.

```typescript
export async function markNutritionEventLogged(clientId: string, date: string): Promise<void>
```

Update event's `status` to `'logged'` and `updated_at` for the given client + date. Called from the daily log save flow after a nutrition log is created/updated.

```typescript
export async function markMissedNutritionEvents(clientId: string, beforeDate: string): Promise<void>
```

Update all events where `client_id = clientId AND date < beforeDate AND status = 'scheduled'` to `status = 'missed'`.

**6. Nutrition event helpers — `utils/nutrition-event-helpers.ts` (new, ~60 lines)**

```typescript
export function getTotalCalories(event: NutritionEvent, includeActivityBurn: boolean): number
```

Returns `event.baselineCalories + (includeActivityBurn ? event.trainingBurnCalories + event.externalBurnCalories : 0)`.

```typescript
export function mapNutritionEventToDisplayTarget(
  event: NutritionEvent,
  includeActivityBurn: boolean
): DailyNutritionTargets
```

Maps a single nutrition event to the existing `DailyNutritionTargets` type used by the UI. Computes percentages, labels, etc. When `includeActivityBurn` is false, zeros out burn fields and uses baseline calories for macro percentages.

After implementing, run `npx tsc --noEmit` to verify no type errors. Commit when done.
```

---

## NE-2: Wire Nutrition Events into Plan Lifecycle + Backfill

**Goal:** Every path that creates, regenerates, or modifies nutrition plans now also generates/regenerates nutrition events.

**Pre-NE-2 state (already done):**
- The `effective_from` bugs are fixed: RPC accepts `p_effective_from` directly (migration 078), future dates create `planned` plans (migration 080), lazy promotion via `promoteNutritionPlanIfReady()` is wired into all active-status read paths.
- `services/nutrition-plan-service.ts` — `promoteNutritionPlanIfReady(clientId)` promotes planned → active when `effective_from <= today`. Already called in: nutrition GET, skew POST, activation-readiness GET, comparison-service, client-portal-service, check-in-context-service.
- The nutrition GET handler returns `upcomingPlan` when a planned plan exists. The UI shows it below the active plan's daily breakdown.
- **For planned plans:** event generation should use the planned plan's `effective_from` as startDate (events cover the future window). When a planned plan is promoted to active, its events are already in place.

### Claude Code prompt

```
Read IMPLEMENTATION-PLAN.md for full context, then read CONVENTIONS.md and docs/ARCHITECTURE.md.

This is NE-2: Wire nutrition events into all nutrition plan lifecycle points.

**Read first:**
- `services/nutrition-event-service.ts` — the nutrition event service built in NE-1
- `services/nutrition-plan-service.ts` — `createNutritionPlan()` (effectiveFrom hack removed, p_effective_from passed to RPC) + `promoteNutritionPlanIfReady()` (lazy planned → active promotion, already wired into read paths)
- `supabase/migrations/080_nutrition_rpc_planned_status.sql` — RPC branches: future dates insert as `planned`, today/past insert as `active` and clean up orphaned planned plans
- `services/nutrition-plan-orchestrator.ts` — nutrition plan creation orchestration (extracted from route POST handler). **This is where event generation must be wired in**, not the route file.
- `app/api/clients/[id]/nutrition/route.ts` — thin route wrapper, delegates to orchestrator. GET handler already returns `upcomingPlan` when a planned plan exists. Read to understand validation and response shape.
- `app/api/clients/[id]/nutrition/skew/route.ts` — POST handler for custom day distribution saves. Creates a new plan version. Must regenerate events.
- `services/training-event-service.ts` — `regenerateFutureEvents()` (training). After training events regenerate, nutrition events must also regenerate (cascade).
- `services/training-plan-orchestrator.ts` — training plan creation orchestration (extracted from route POST handler). Wire nutrition event cascade here.
- `app/api/clients/[id]/training/[planId]/regenerate-events/route.ts` — training regeneration endpoint (where cascade call goes)
- `app/api/clients/[id]/training/[planId]/sessions/reorder/route.ts` — session reorder (if it triggers training event regen, it should also trigger nutrition event regen)

**Refactored file locations (type quality refactor moved code, re-exports preserve all import paths):**
- `services/nutrition-plan-orchestrator.ts` — contains the full nutrition plan creation flow (previously inline in the nutrition route POST handler). Modify this file for steps 1 and 5.
- `services/training-plan-orchestrator.ts` — contains the full training plan creation flow (previously inline in the training route POST handler). Modify this file for training cascade.
- `services/training-session-service.ts` — session CRUD (extracted from training-service.ts). Session add/update/delete routes call these functions.
- `utils/weekly-nutrition-helpers.ts` + `utils/weekly-nutrition-mappers.ts` — pure functions extracted from weekly-nutrition-service.ts.
- `app/api/clients/[id]/training/[planId]/sessions/[sessionId]/route.ts` — session update/delete
- `app/api/clients/[id]/training/[planId]/sessions/route.ts` — session add
- `lib/error-handler.ts` — `captureApiError()` for non-blocking error handling
- `lib/validations/nutrition.ts` — Zod schema for nutrition plan creation (needs `preserveCalories` field)

**1. Plan creation — modify `app/api/clients/[id]/nutrition/route.ts` POST handler**

Before plan creation, validate the effective date:
a. If `body.effectiveFrom` is set:
   - Validate it's not in the past: if `body.effectiveFrom < getTodayDateString()`, return 400 with `{ error: "Effective date cannot be in the past" }`
   - If `phaseCheck.phaseId` exists, compute `phaseEndDate` from the phase's `end_date` or `start_date + duration_weeks`. If `body.effectiveFrom > phaseEndDate`: return 400 with `{ error: "Start date cannot be after the phase end date (${phaseEndDate})" }`

Before calling `createNutritionPlan()`, capture the old plan ID:
b. Query for the existing active plan ID: `const { data: existingPlan } = await supabaseAdmin.from("nutrition_plans").select("id").eq("client_id", clientId).eq("status", "active").maybeSingle()`. This MUST happen before the RPC call because the RPC archives the old plan (for today-dated plans) or leaves it untouched (for future-dated planned plans).
c. `const oldPlanId = existingPlan?.id;`

After `createNutritionPlan()` returns the new plan ID successfully:
d. Calculate the event date range:
   - `startDate`: use `body.effectiveFrom` if set, otherwise today. **For planned plans (future effectiveFrom), events should start from that future date** — the active plan's events already cover today through effectiveFrom - 1.
   - `endDate`: if plan has `phaseId`, query phases for `end_date`; else default 8 weeks from startDate
e. If old plan existed AND the new plan is active (not planned): `await deleteFutureNutritionEventsForPlan(oldPlanId).catch(...)`. **Skip this for planned plans** — the active plan's events should remain until the planned plan takes effect.
f. Fetch the new plan's daily target rows and training plan context
g. `await generateNutritionEvents(clientId, newPlanId, plan, dailyTargetRows, trainingPlan, startDate, endDate).catch(err => captureApiError(err, { action: "generate-nutrition-events", planId: newPlanId }))`
h. Event generation is non-blocking (`.catch()`) so plan creation succeeds even if event generation fails.
i. **For planned plans:** events are generated for the future window (effectiveFrom → endDate). When `promoteNutritionPlanIfReady()` later promotes the plan to active, the events are already in place. The old active plan's events for dates before effectiveFrom remain untouched.

NOTE: The existing code in `handleCalculatedPlan()` already queries for `existingPlan` to determine `regeneration_reason`. Reuse that query result for the old plan ID — don't query twice. The RPC now returns the plan as either `active` or `planned` depending on the effective date — the orchestrator should use `regenerateFutureNutritionEvents(clientId, newPlanId, body.effectiveFrom)` which handles the date range correctly for both cases.

**2. Custom day distribution — modify `app/api/clients/[id]/nutrition/skew/route.ts`**

After the skew creates a new plan version:
a. Delete future events for the old plan
b. Regenerate events for the new plan (the skew route already creates new daily target rows with the custom per-day calories, so events will pick up the overrides)
c. Non-blocking with `.catch()`

**3. Training day swap cascade — modify `app/api/clients/[id]/training/[planId]/regenerate-events/route.ts`**

After `regenerateFutureEvents(clientId, planId, effectiveFrom)` for training:
a. Fetch the client's active nutrition plan ID
b. If exists: `await regenerateFutureNutritionEvents(clientId, nutritionPlanId, effectiveFrom).catch(err => captureApiError(err, { action: "cascade-nutrition-events-from-training" }))`
c. Also check for a planned nutrition plan: if exists, regenerate its events too (the training burn values on future dates may have changed)
d. This ensures that when a coach moves a training session to a different day and clicks "Done", nutrition events regenerate with the updated training burns on the correct days.

**4. Session-level changes that trigger training event regen — apply same cascade**

In the following routes, wherever `regenerateFutureEvents` (training) is called, add the same nutrition cascade pattern:
- `app/api/clients/[id]/training/[planId]/sessions/reorder/route.ts` (session reorder)
- `app/api/clients/[id]/training/[planId]/sessions/[sessionId]/route.ts` (session update PATCH, session delete DELETE)
- `app/api/clients/[id]/training/[planId]/sessions/route.ts` (session add POST)

Pattern for each: after training event regen, fetch active nutrition plan, if exists call `regenerateFutureNutritionEvents` non-blocking.

NOTE: Check these route files first. Session 2 (CE-2) added comments saying "Events are NOT regenerated here" for reorder/update/delete routes because the coach triggers regen via the Done button (/regenerate-events). If that is still the pattern, then only the /regenerate-events route needs the cascade, not the individual session routes. Read the routes to confirm.

**5. Keep-calories option — modify `lib/validations/nutrition.ts` + `app/api/clients/[id]/nutrition/route.ts`**

a. Add both `preserveCalories: z.boolean().optional()` and `effectiveFrom: z.string().optional()` to the nutrition plan creation Zod schema. The `effectiveFrom` field is already accepted in the POST handler body but was never in the Zod schema — it was passing through unvalidated.
b. In the POST handler, when `body.preserveCalories === true`:
   - Fetch the current active plan's `baseline_calories`
   - If no active plan: return 400 "No active nutrition plan to preserve calories from"
   - Skip `generateNutritionPlan()` (the TDEE/deficit calculation)
   - Use the existing `baseline_calories` as the new plan's baseline
   - Recalculate macros: `calculateDailyMacros(baselineCalories, proteinG, false, dietType)` where `proteinG = Math.round(currentWeightKg * body.proteinTargetGPerKg)`
   - Set `regeneration_reason: "regenerated_preserved_calories"`
   - Continue with plan creation + event generation as normal

**6. Keep-calories UI + date validation — modify `components/clients/nutrition/builder/drawer-footer.tsx` and `components/ui/apply-date-dialog.tsx`**

Update the `ApplyDateDialog` flow:
- Add a `maxDate` prop to `ApplyDateDialog`. When the client has an active phase with an end date, pass it as `maxDate`. The date picker's `max` attribute should use this value to prevent the coach from selecting a date past the phase end.
- Add a "Keep current calories" toggle/checkbox above the apply buttons
- When toggled on: pass `preserveCalories: true` to the `generatePlan()` call
- Brief helper text: "Preserves current calorie targets, updates training day distribution only"

The `drawer-footer.tsx` should pass the active phase end date (available via the builder context's `activePhase`) to `ApplyDateDialog` as `maxDate`.

Apply the same `maxDate` pattern to the training plan's `drawer-footer.tsx` (`components/clients/training/builder/drawer-footer.tsx`) for consistency.

**7. Backfill script — `scripts/backfill-nutrition-events.ts`**

Create a standalone script runnable via `npx tsx scripts/backfill-nutrition-events.ts`:

a. Query all nutrition plans with daily targets:
   ```typescript
   supabaseAdmin.from("nutrition_plans")
     .select("id, client_id, effective_from, effective_until, baseline_calories, protein_target_g, diet_type, phase_id, nutrition_plan_daily_targets(day_of_week, calories, protein_g, carb_g, fat_g, is_training_day)")
   ```
b. For each plan:
   - Calculate startDate = `effective_from`
   - Calculate endDate = `min(effective_until, today)` (no future events for archived plans)
   - For active plans: endDate = `min(phase end_date, effective_from + 8 weeks, today)` (future events will be generated by normal flow)
   - Fetch training events for the date range to determine training burns per date
   - Call `generateNutritionEvents(clientId, planId, plan, dailyTargetRows, null, startDate, endDate)`
   - The `null` training plan param is fine because we're looking up training events directly
c. After all plans: mark past events as missed where no nutrition_log exists:
   - Query `nutrition_events` where `date < today AND status = 'scheduled'`
   - Cross-reference with `nutrition_logs` for same `client_id + date`
   - If log exists: update to `logged`
   - If no log: update to `missed`
d. Log progress to console.

**8. Phase transition event cleanup — modify `services/phase-transition-service.ts`**

When a phase completes and plans are archived via `transition_phase_atomic`, orphaned future nutrition events remain in the database. After the RPC completes and plans are archived:
a. If `plan_handling` archived the nutrition plan, fetch the archived plan ID
b. Call `deleteFutureNutritionEventsForPlan(archivedPlanId).catch(...)` to clean up future scheduled events
c. Same pattern for training events if not already handled

This prevents stale future events from lingering after a phase transition.

After implementing, run `npx tsc --noEmit` and `npx vitest run`. Commit when done.
```

---

## NE-3: Nutrition Consumer Migration

**Goal:** Switch all nutrition consumers from template-based (7 day-of-week rows per plan) to event-based queries. The Plans tab continues to show the blueprint; all date-specific views read from events.

### Consumer audit

| Consumer | Location | Current source | New source |
|----------|----------|---------------|------------|
| Coach Plans tab (daily breakdown) | `GET /api/clients/[id]/nutrition` → `buildDailyTargetsFromPlan` | `nutrition_plan_daily_targets` + live training | `nutrition_events` for current week |
| Client nutrition targets | `getClientNutritionTargets()` in `client-portal-service.ts` | Same as above | `nutrition_events` for current week |
| Daily log target snapshot | `getTodaysNutritionTarget()` in `daily-context-service.ts` | Plan template + live training burn | `getNutritionEventForDate()` |
| Unlogged day fill (weekly summary) | `getPlanTargetForDate()` in `daily-context-service.ts` | Plan date range query + template + live training | `getNutritionEventForDate()` |
| Check-in snapshot | `fetchNutritionDataForPeriod()` in `schedule-data-service.ts` → `buildNutritionSummary()` | Plans + template + training template | `getNutritionEventsForDateRange()` |
| Check-in nutrition context | `getCheckInNutritionContext()` in `check-in-context-service.ts` | Active plan + `getWeeklyNutritionTargets()` | `getNutritionEventsForDateRange()` |
| Plan targets API (unlogged fill) | `GET /api/clients/[id]/nutrition/plan-targets` | `getPlanTargetForDate()` | `getNutritionEventForDate()` |
| Coaching week live summary | `getCoachingWeekSummaryLive()` in `weekly-nutrition-service.ts` | nutrition_logs + `getPlanTargetForDate()` for unlogged | nutrition_logs + `getNutritionEventForDate()` for unlogged |
| Nutrition period summary | `buildNutritionSummary()` in `nutrition-period-summary.ts` | Plans + templates + training template for unlogged | `getNutritionEventsForDateRange()` for unlogged |

### Claude Code prompt

```
Read IMPLEMENTATION-PLAN.md for full context, then read CONVENTIONS.md and docs/ARCHITECTURE.md.

This is NE-3: Switch all nutrition consumers from template day-of-week matching to reading from nutrition_events.

**Read first:**
- `services/nutrition-event-service.ts` — `getNutritionEventForDate`, `getNutritionEventsForDateRange`
- `utils/nutrition-event-helpers.ts` — `getTotalCalories`, `mapNutritionEventToDisplayTarget`
- `utils/build-daily-targets.ts` — `buildDailyTargetsFromPlan()` to be replaced for date-specific views
- `services/daily-context-service.ts` — `getTodaysNutritionTarget()`, `getPlanTargetForDate()`
- `services/client-portal-service.ts` — `getClientNutritionTargets()`
- `app/api/clients/[id]/nutrition/route.ts` — GET handler (thin wrapper; POST delegates to orchestrator)
- `services/nutrition-plan-orchestrator.ts` — nutrition plan creation orchestration (POST logic extracted here)
- `app/api/client/daily-logs/nutrition-target/route.ts` — client-side target fetch
- `services/weekly-nutrition-service.ts` — `upsertWeeklySummary()`, `getCoachingWeekSummaryLive()` (both call `getPlanTargetForDate()` for unlogged days)
- `utils/weekly-nutrition-helpers.ts` — `calculateWeeklySummaryFromLogs`, `calculateWeeklyAdherence` (extracted from weekly-nutrition-service.ts)
- `utils/weekly-nutrition-mappers.ts` — `mapNutritionRowToDailyLog`, `mapRowToSummary` (extracted from weekly-nutrition-service.ts)
- `services/check-in-snapshot-service.ts` — snapshot generation
- `services/check-in-context-service.ts` — `getCheckInNutritionContext()`
- `services/schedule-data-service.ts` — `fetchNutritionDataForPeriod()`
- `utils/nutrition-period-summary.ts` — `buildNutritionSummary()`
- `app/api/clients/[id]/nutrition/plan-targets/route.ts` — plan targets for specific dates
- `app/api/clients/[id]/history/nutrition/route.ts` — nutrition history
- `lib/attention-feed-helpers.ts` — `groupClientData`, `evaluateAndSortTriggers` (extracted from attention-feed-service.ts; trigger evaluation logic lives here now)

**1. Coach Plans tab (daily breakdown) — modify `app/api/clients/[id]/nutrition/route.ts` GET handler**

The Plans tab shows the blueprint view (Mon-Sun) of the active plan. This should still read from the plan template (`nutrition_plan_daily_targets`) enriched with live training data via `buildDailyTargetsFromPlan()`. However, update `buildDailyTargetsFromPlan` to read training burns from training events instead of the training plan template:

a. Fetch current week's training events: `getEventsForDateRange(clientId, weekStart, weekEnd)` from training-event-service
b. Pass events to `buildDailyTargetsFromPlan` (add optional `trainingEvents` parameter)
c. In `buildDailyTargetsFromPlan`: when `trainingEvents` provided, use `getEventCaloriesByDay(trainingEvents)` instead of `getTrainingSessionCaloriesByDay(trainingPlan)` for the burn lookup

This keeps the Plans tab showing the 7-day template view but with accurate training burns from events.

**2. Client nutrition targets — modify `services/client-portal-service.ts`**

`getClientNutritionTargets()` serves the client portal's weekly nutrition display (Daily Pulse). This should show the 7-day template blueprint (same as the coach Plans tab), NOT date-specific events. The client sees "what does my normal week look like" — the same as what the coach prescribed.

Update with the same training event enrichment as step 1: pass current week's training events to `buildDailyTargetsFromPlan` so training burns are accurate.

**3. Daily log target snapshot — modify `services/daily-context-service.ts`**

Replace `getTodaysNutritionTarget()` to read from nutrition events. **Critical: must handle missing events gracefully** because the daily log save flow calls this function to snapshot targets. If it returns null, the log would save with no target data.

```typescript
export const getTodaysNutritionTarget = async (clientId: string, date?: string) => {
  const dateStr = date ?? getTodayDateString();
  const event = await getNutritionEventForDate(clientId, dateStr);

  // Check include_activity_burn toggle
  const { data: clientRow } = await supabaseAdmin
    .from("clients").select("include_activity_burn").eq("id", clientId).single();
  const includeActivityBurn = clientRow?.include_activity_burn !== false;

  if (event) {
    return {
      calories: getTotalCalories(event, includeActivityBurn),
      proteinG: event.proteinG,
      carbsG: event.carbG,
      fatG: event.fatG,
      isTrainingDay: event.isTrainingDay,
    };
  }

  // Fallback: no event exists for this date (gap in events, plan just created
  // without event generation, or date outside event range). Read from the
  // active plan template so the client still sees targets.
  const fallback = await getPlanTargetForDateFromTemplate(clientId, dateStr, includeActivityBurn);
  return fallback;
};
```

Create a private helper `getPlanTargetForDateFromTemplate()` that preserves the current template-based lookup logic (query active plan → find daily target by day-of-week → add live training burns). This is the same logic that exists today in `getPlanTargetForDate()` — keep it as a fallback rather than deleting it entirely.

**4. Unlogged day fill — modify `getPlanTargetForDate()` in `services/daily-context-service.ts`**

Replace the template-based lookup with event lookup, with template fallback for missing events:
```typescript
export const getPlanTargetForDate = async (clientId: string, date: string): Promise<PlanDayTarget | null> => {
  const event = await getNutritionEventForDate(clientId, date);
  const { data: clientRow } = await supabaseAdmin
    .from("clients").select("include_activity_burn").eq("id", clientId).single();
  const includeActivityBurn = clientRow?.include_activity_burn !== false;

  if (event) {
    return {
      calories: getTotalCalories(event, includeActivityBurn),
      proteinG: event.proteinG,
      carbsG: event.carbG,
      fatG: event.fatG,
      isTrainingDay: event.isTrainingDay,
    };
  }

  // Fallback to template lookup for dates without events
  // (e.g., historical dates before backfill, or gaps in event coverage)
  return getPlanTargetForDateFromTemplate(clientId, date, includeActivityBurn);
};
```

This automatically fixes the weekly summary unlogged-day fill (`upsertWeeklySummary`, `getCoachingWeekSummaryLive`) since they call `getPlanTargetForDate`. The fallback ensures they always get a target even if events are missing for some dates.

This automatically fixes the weekly summary unlogged-day fill (`upsertWeeklySummary`, `getCoachingWeekSummaryLive`) since they call `getPlanTargetForDate`.

**5. Check-in snapshot — modify `services/check-in-snapshot-service.ts`**

Replace the `fetchNutritionDataForPeriod` + `buildNutritionSummary` flow for nutrition:
a. Fetch nutrition events: `getNutritionEventsForDateRange(clientId, periodStart, periodEnd)`
b. Fetch nutrition logs for the period (existing query)
c. Build the snapshot from events + logs: for logged days use the log's snapshotted targets; for unlogged days use the event's targets (with `include_activity_burn` applied)

**6. Nutrition history API — modify `app/api/clients/[id]/history/nutrition/route.ts`**

Replace `fetchNutritionDataForPeriod` + `buildNutritionSummary` with event-based queries:
a. Fetch `getNutritionEventsForDateRange(clientId, startDate, endDate)` for targets
b. Fetch nutrition_logs for the same range for actual consumption
c. Merge: each date gets targets from events and consumption from logs

**7. Check-in nutrition context — modify `services/check-in-context-service.ts`**

In `getCheckInNutritionContext()`, replace `getActiveTrainingPlan` + `getWeeklyNutritionTargets` with:
a. Calculate the check-in period dates
b. `getNutritionEventsForDateRange(clientId, periodStart, periodEnd)`
c. Map events to the return type the check-in form expects

**8. Plan targets API — modify `app/api/clients/[id]/nutrition/plan-targets/route.ts`**

Replace the loop over `getPlanTargetForDate()` with batch event query:
a. Parse the dates from query params
b. `getNutritionEventsForDateRange(clientId, minDate, maxDate)`
c. Build a Map by date, return targets for requested dates

**9. Nutrition period summary — simplify `utils/nutrition-period-summary.ts`**

`buildNutritionSummary()` currently accepts `NutritionPlanWithTargets[]` and `trainingPlans` to estimate unlogged day targets from templates. Update to accept `NutritionEvent[]` instead:
- For each date in the period: if log exists, use log targets; if no log but event exists, use event targets
- Remove the plan template + training template estimation logic

**10. Delete dead code**

After all consumers are migrated, grep each function to verify no callers remain before deleting:
- Remove `getTrainingSessionCaloriesByDay()` from `utils/training-calorie-helpers.ts` if no callers remain
- **Keep `getTrainingDays()`** in `utils/nutrition-helpers.ts` — it is still used by `createNutritionPlan()` in `services/nutrition-plan-service.ts` (line 57) for `is_training_day` on daily target rows. Do not delete.
- Remove `fetchNutritionDataForPeriod()` from `services/schedule-data-service.ts` if no callers remain (keep `fetchTrainingDataForPeriod` if CE-3 still uses it)
- Keep `getPlanTargetForDate()` as private helper `getPlanTargetForDateFromTemplate()` — it's the fallback for missing events (step 3 above)
- Simplify `buildDailyTargetsFromPlan()` — the training plan parameter may no longer be needed once all callers pass training events
- Remove `getWeeklyNutritionTargets()` from `utils/nutrition-helpers.ts` if no callers remain

**11. Update test files**

These test files will break due to changed function signatures and need updating:
- `utils/__tests__/nutrition-period-summary.test.ts` — `buildNutritionSummary()` signature changes from `NutritionPlanWithTargets[]` to `NutritionEvent[]`. Rewrite fixtures to use nutrition event data.
- `services/daily-logs-service.test.ts` — mocks `getClientNutritionTargets()`. Update mocks if the function signature changes.
- Any test that mocks `getPlanTargetForDate()` — update to reflect the new event-based implementation.

After implementing, run `npx tsc --noEmit` and `npx vitest run`. Commit when done.
```

---

## PT-1: Plan Continuation Across Phase Transitions

**Goal:** Allow coaches to continue an existing plan into the next phase instead of being forced to archive and recreate. The plan is cloned as a new row linked to the next phase, preserving the completed phase's full history.

### Design: Clone, don't re-link

The "continue" option **clones the plan** into the next phase rather than re-linking it:

1. The old plan is archived (same as today) — stays linked to the completed phase with `effective_until = transition date`
2. A new plan row is created with identical settings — linked to the next phase with `effective_from = transition date`
3. For nutrition: the existing `create_nutrition_plan_atomic` RPC handles archive-then-create. Feed it the old plan's settings.
4. For training: clone the plan row + clone all active sessions + exercises into the new plan, then generate events.
5. Events are generated for the new plan covering the new phase's date range.

**Why clone instead of re-link:**
- The completed phase retains a complete record of every plan version that was active during it. No orphaned references.
- Follows the existing pattern: every plan change already archives-then-creates. Continuation is just another archive-then-create with copied settings.
- No RPC restructuring needed for nutrition (the existing RPC works as-is).
- No cross-phase foreign keys, no JSONB snapshots to compensate for moved pointers.
- `regeneration_reason = "phase_continuation"` makes the intent clear in the history.

### Claude Code prompt

```
Read IMPLEMENTATION-PLAN.md for full context, then read CONVENTIONS.md and docs/ARCHITECTURE.md.

This is PT-1: Plan continuation across phase transitions.

**Read first:**
- `services/phase-transition-service.ts` — `TransitionOptions` type, `transitionPhase()` function
- `supabase/migrations/067_phase_transition_support.sql` — `transition_phase_atomic` RPC
- `services/nutrition-plan-service.ts` — `createNutritionPlan()` and `CreateNutritionPlanParams`
- `services/training-service.ts` — `createTrainingPlanAtomic()` (understand the params)
- `services/training-event-service.ts` — `generateTrainingEvents()`, `deleteFutureEventsForPlan()`
- `services/nutrition-event-service.ts` — `generateNutritionEvents()`, `deleteFutureNutritionEventsForPlan()`
- `components/clients/roadmap/phase-review-drawer.tsx` — the UI where coaches choose plan handling
- `app/api/clients/[id]/roadmap/phases/[phaseId]/transition/route.ts` — the API route with Zod validation

**1. Update the plan handling options — modify `services/phase-transition-service.ts`**

Change `TransitionOptions.planHandling` from:
```typescript
planHandling: {
  trainingPlan: "keep" | "archive";
  nutritionPlan: "keep" | "archive";
  habits: "keep" | "archive";
};
```

To:
```typescript
planHandling: {
  trainingPlan: "continue" | "archive";
  nutritionPlan: "continue" | "archive";
  habits: "continue" | "archive";
};
```

Also update the Zod schema in `app/api/clients/[id]/roadmap/phases/[phaseId]/transition/route.ts` from `z.enum(["keep", "archive"])` to `z.enum(["continue", "archive"])`.

"continue" means: archive the old plan, clone it into the next phase, generate events for the new phase.

**2. Update the RPC — `supabase/migrations/079_phase_transition_continue_option.sql`**

The RPC needs two changes:

a. Move the `v_next_phase_id` lookup and activation BEFORE the plan handling block (currently it's after). This is needed so the clone service knows which phase to link the new plan to.

b. The RPC itself always archives plans when instructed (`p_archive_training/nutrition/habits = true`). For the "continue" case, the RPC ALSO archives the old plan (same SQL) — the clone happens in the service layer after the RPC returns. This means the RPC's behavior for `p_archive_training = true` doesn't change. When "continue" is selected, the caller passes `p_archive_training = true` AND performs the clone after.

The key RPC restructuring:

```sql
CREATE OR REPLACE FUNCTION transition_phase_atomic(
  p_phase_id UUID,
  p_coach_reflection TEXT,
  p_phase_summary JSONB,
  p_next_action TEXT,
  p_archive_training BOOLEAN,
  p_archive_nutrition BOOLEAN,
  p_archive_habits BOOLEAN
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_roadmap_id UUID;
  v_next_phase_id UUID;
BEGIN
  -- 1. Complete the phase
  UPDATE phases
  SET status = 'completed',
      end_date = COALESCE(end_date, CURRENT_DATE),
      coach_reflection = p_coach_reflection,
      phase_summary = p_phase_summary,
      updated_at = NOW()
  WHERE id = p_phase_id
  RETURNING roadmap_id INTO v_roadmap_id;

  IF v_roadmap_id IS NULL THEN
    RAISE EXCEPTION 'Phase not found: %', p_phase_id;
  END IF;

  -- 2. Activate next phase FIRST (needed so clone knows the target phase)
  IF p_next_action = 'activate_next' THEN
    SELECT id INTO v_next_phase_id FROM phases
      WHERE roadmap_id = v_roadmap_id AND status = 'planned'
      ORDER BY order_index ASC LIMIT 1;
    IF v_next_phase_id IS NOT NULL THEN
      UPDATE phases SET status = 'active',
        start_date = COALESCE(start_date, CURRENT_DATE),
        updated_at = NOW()
      WHERE id = v_next_phase_id;
    END IF;
  ELSIF p_next_action = 'archive_roadmap' THEN
    UPDATE phases SET status = 'skipped', updated_at = NOW()
      WHERE roadmap_id = v_roadmap_id AND status = 'planned';
    UPDATE roadmaps SET status = 'archived', updated_at = NOW()
      WHERE id = v_roadmap_id;
  END IF;

  -- 3. Archive plans (always — for "continue", the clone happens in the service layer)
  IF p_archive_training THEN
    UPDATE training_plans SET status = 'archived',
      effective_until = CURRENT_DATE, updated_at = NOW()
      WHERE phase_id = p_phase_id AND status = 'active';
  END IF;
  IF p_archive_nutrition THEN
    UPDATE nutrition_plans SET status = 'archived',
      effective_until = CURRENT_DATE, updated_at = NOW()
      WHERE phase_id = p_phase_id AND status = 'active';
  END IF;
  IF p_archive_habits THEN
    UPDATE daily_habits SET is_active = false, updated_at = NOW()
      WHERE phase_id = p_phase_id AND is_active = true;
  END IF;

  -- 4. Write nextPhaseId into summary
  IF v_next_phase_id IS NOT NULL THEN
    UPDATE phases SET phase_summary = jsonb_set(
      phase_summary, '{nextPhaseId}', to_jsonb(v_next_phase_id::TEXT)
    ) WHERE id = p_phase_id;
  END IF;

  RETURN COALESCE(v_next_phase_id, p_phase_id);
END;
$$;
```

Key change: next phase activation moved before plan archival. The plan archival logic stays the same. For the "continue" case, the caller passes `p_archive_training = true` (archives the old plan) and then clones after the RPC.

**3. Clone plans after transition — modify `services/phase-transition-service.ts`**

Before calling the RPC, fetch the full plan data needed for cloning:

```typescript
// Before RPC: fetch plan data for potential cloning
let trainingPlanSnapshot = null;
let nutritionPlanSnapshot = null;

if (options.planHandling.trainingPlan === "continue") {
  // Fetch training plan + sessions + exercises for cloning
  trainingPlanSnapshot = await getActiveTrainingPlan(clientId);
}
if (options.planHandling.nutritionPlan === "continue") {
  // Fetch nutrition plan + daily target rows for cloning
  nutritionPlanSnapshot = await supabaseAdmin
    .from("nutrition_plans")
    .select("*, nutrition_plan_daily_targets(*)")
    .eq("client_id", clientId)
    .eq("status", "active")
    .maybeSingle();
}
```

When calling the RPC, ALWAYS pass `p_archive_training = true` / `p_archive_nutrition = true` for "continue" (the old plan gets archived regardless — the clone is the new plan):

```typescript
const rpcParams = {
  p_phase_id: phaseId,
  p_coach_reflection: options.coachReflection ?? null,
  p_phase_summary: phaseSummary,
  p_next_action: options.nextAction,
  // "continue" archives the old plan; the clone creates the new one
  p_archive_training: true,  // Always archive for both "continue" and "archive"
  p_archive_nutrition: true,
  p_archive_habits: options.planHandling.habits === "archive",
};
```

After the RPC returns the `nextPhaseId`:

a. **Training plan continuation:**
   If `trainingPlanSnapshot` was captured and `nextPhaseId` exists:
   - Call `createTrainingPlanAtomic()` with the old plan's settings + `phaseId: nextPhaseId`
   - Clone all active sessions via `insertTrainingSessions()` (copy session names, day_of_week, exercises, etc.)
   - Call `generateTrainingEvents(clientId, newPlanId, sessions, today, phaseEndDate)` for the new phase
   - Set `regeneration_reason` or plan description to indicate this is a continuation

b. **Nutrition plan continuation:**
   If `nutritionPlanSnapshot` was captured and `nextPhaseId` exists:
   - Call `createNutritionPlan()` with the old plan's settings copied over:
     - Same `baselineCalories`, `proteinTargetG`, `carbTargetG`, `fatTargetG`
     - Same `dietType`, `workActivityLevel`, `proteinTargetGPerKg`
     - Same `customMacrosEnabled`, `customCalories`, etc.
     - Same daily target row values (preserves custom day distribution)
     - `phaseId: nextPhaseId`
     - `effectiveFrom: today` (or phase start date)
     - `regenerationReason: "phase_continuation"`
   - The `createNutritionPlan` RPC handles archiving the old plan + creating the new one atomically
   - After creation, call `generateNutritionEvents()` for the new plan (wired in NE-2)

c. **Habits continuation:**
   If habits are "continue", the RPC does NOT archive them (pass `p_archive_habits = false`). Instead, clone each active habit to the new phase:
   - Fetch all active habits for the old phase
   - For each: insert a new row with `phase_id = nextPhaseId` and same name/description/settings
   - Deactivate the old habits: `UPDATE daily_habits SET is_active = false WHERE phase_id = oldPhaseId`

d. **Archive cases:**
   If a plan was archived (not continued):
   - Delete future training events: `deleteFutureEventsForPlan(oldPlanId).catch(...)`
   - Delete future nutrition events: `deleteFutureNutritionEventsForPlan(oldPlanId).catch(...)`

e. **No next phase (archive_roadmap):**
   When `nextAction = "archive_roadmap"`, there's no phase to clone into. In this case:
   - "continue" still archives the old plan but does NOT create a clone (no target phase)
   - The UI should show: "Plan will be archived with the roadmap" when archive_roadmap is selected, and disable/hide the "continue" option

**4. Update the transition UI**

Read `components/clients/roadmap/phase-review-drawer.tsx` — the current UI uses Switch toggles for archive decisions. Replace with radio button groups:
- "Continue into next phase" (default when `nextAction = "activate_next"`) — clones the plan into the next phase
- "Archive plan" — archives the plan, future events are cleaned up
- Brief helper text for "Continue": "Same settings carry over as a new plan in the next phase."

When `nextAction = "archive_roadmap"`:
- Hide the "continue" option (no next phase to clone into)
- Default to "archive"
- Show text: "Plans will be archived with the roadmap"

After implementing, run `npx tsc --noEmit` and `npx vitest run`. Commit when done.
```

---

## EL-1: Rolling Event Window for No-Roadmap Clients

**Goal:** Ensure events are continuously generated for clients without phases/roadmaps, so their plans don't silently expire after the 8-week default window.

### Design

Clients without roadmaps (or with plans that have `phase_id = NULL`) currently get events generated for 8 weeks from the plan's effective date. After that, events stop and the client sees no targets. This session adds a rolling extension mechanism.

**How it works:**
- A scheduled function runs daily (or weekly) and checks: for each active client with an active plan, are events about to run out (ending within the next 7 days)?
- If yes, call `regenerateFutureEvents` / `regenerateFutureNutritionEvents` which extends events by another 8 weeks from today
- Skip inactive clients (`active = false`) — when a coach deactivates a client, events naturally stop extending and expire
- Skip plans with a `phase_id` that points to a phase with a concrete `end_date` — those are bounded by the phase

**No explicit "archive on churn" needed.** When a coach deactivates a client:
1. Client `active = false`
2. Rolling window cron skips them
3. Events expire naturally (the last batch runs out, no new ones generated)
4. If the coach reactivates later, they regenerate the plan and events start fresh

### Claude Code prompt

```
Read IMPLEMENTATION-PLAN.md for full context, then read CONVENTIONS.md and docs/ARCHITECTURE.md.

This is EL-1: Rolling event window for clients without phases.

**Read first:**
- `services/training-event-service.ts` — `regenerateFutureEvents()`, `calculateEndDate()`, `fallbackEndDate()`
- `services/nutrition-event-service.ts` — `regenerateFutureNutritionEvents()`, `calculateNutritionEndDate()`
- `services/supabase-admin.ts` — supabaseAdmin import pattern
- `lib/date-helpers.ts` — `getTodayDateString()`, `getDateString()`

**1. Create event extension service — `services/event-extension-service.ts` (new, ~120 lines)**

```typescript
export async function extendExpiringEvents(): Promise<{ extended: number; skipped: number }>
```

Implementation:
a. Get today's date and a threshold date (today + 7 days)
b. Query active training plans where events are about to expire OR have zero events:
   ```sql
   SELECT DISTINCT tp.id AS plan_id, tp.client_id, tp.phase_id
   FROM training_plans tp
   JOIN clients c ON c.id = tp.client_id AND c.active = true
   WHERE tp.status = 'active'
     AND tp.deleted_at IS NULL
     AND (tp.phase_id IS NULL
       OR tp.phase_id IN (SELECT id FROM phases WHERE end_date IS NULL))
     AND (
       (SELECT MAX(te.date) FROM training_events te
        WHERE te.training_plan_id = tp.id AND te.status = 'scheduled'
       ) IS NULL  -- No events at all (generation failed or never ran)
       OR
       (SELECT MAX(te.date) FROM training_events te
        WHERE te.training_plan_id = tp.id AND te.status = 'scheduled'
       ) <= threshold_date  -- Events expiring within 7 days
     )
   ```
   This finds plans where: the client is active, the plan has no phase (or phase has no end date), and either the plan has zero scheduled events OR the latest scheduled event is within 7 days of expiry.
c. For each plan: call `regenerateFutureEvents(clientId, planId)` — this generates events from today through today + 8 weeks, skipping dates that already have events (upsert ignoreDuplicates)
d. Same query pattern for nutrition plans / nutrition events
e. Return counts for logging

```typescript
export async function extendExpiringNutritionEvents(): Promise<{ extended: number; skipped: number }>
```

Same pattern for nutrition events.

**2. Create the cron endpoint — `app/api/cron/extend-events/route.ts`**

A simple API route that can be called by a cron scheduler (Vercel Cron, external scheduler, or manual trigger):

```typescript
export async function POST(request: NextRequest) {
  // Cron auth: Vercel Cron injects Authorization: Bearer {CRON_SECRET}
  // This is intentionally different from standard API auth (no session, no CSRF)
  // because cron jobs are system-level, not user-triggered.
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error("CRON_SECRET environment variable is not set");
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const trainingResult = await extendExpiringEvents();
    const nutritionResult = await extendExpiringNutritionEvents();

    return NextResponse.json({
      success: true,
      training: trainingResult,
      nutrition: nutritionResult,
    });
  } catch (error) {
    console.error("Event extension cron failed:", error instanceof Error ? error.message : "Unknown error");
    return NextResponse.json({ error: "Event extension failed" }, { status: 500 });
  }
}
```

**3. Configure Vercel Cron — `vercel.json`**

Create `vercel.json` in the project root (does not currently exist):
```json
{
  "crons": [
    {
      "path": "/api/cron/extend-events",
      "schedule": "0 2 * * 1"
    }
  ]
}
```

Runs every Monday at 2am UTC. Weekly is sufficient since the threshold is 7 days — even if one run fails, there's a week of buffer before events expire.

**4. Add CRON_SECRET to environment**

Add `CRON_SECRET` to `.env.example` with documentation:
```
# Cron job authentication - used by Vercel Cron to call /api/cron/* endpoints
# Generate with: openssl rand -base64 32
CRON_SECRET=
```

Vercel Cron automatically includes the secret in the `authorization` header when configured in the project settings.

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

## Final Summary

| Order | Session | What it does |
|-------|---------|-------------|
| 1 | **CE-1** | Create `training_events` table + event generation service (DONE) |
| 2 | **CE-2** | Wire training events into create/edit/regenerate/complete flows + backfill (DONE) |
| 3 | **CE-3** | Switch 12+ training consumers to events, delete template reconstruction code (DONE) |
| 4 | **NE-1** | Create `nutrition_events` table + event service + fix effective_from RPC bug |
| 5 | **NE-2** | Wire nutrition events into plan lifecycle + training cascade + keep-calories + backfill |
| 6 | **NE-3** | Switch all nutrition consumers to events, delete template estimation code |
| 7 | **PT-1** | Plan continuation across phase transitions (re-link + extend events) |
| 8 | **EL-1** | Rolling event window for no-roadmap clients (weekly cron extends expiring events) |
| 9 | **CR-4** | Check-Ins tab with list + detail views (reads from both event types) |
| 10 | **CR-5** | Dashboard queue card + roadmap phase enrichment |

---

## Post-Completion Cleanup

Once all sessions are done and verified:

### 1. Delete plan documents
- DELETE `IMPLEMENTATION-PLAN.md` (this file)
- DELETE `CALENDAR-EVENTS-PLAN.md`
- DELETE `CHECK-IN-REVIEW-PLAN.md`

### 2. Update `docs/ARCHITECTURE.md`

Add/update the following sections to reflect the new reality:

**Data hierarchy** — add `training_events` and `nutrition_events` to the diagram:
```
training_plans (template/blueprint)
  └── training_sessions (weekly blueprint)
        └── training_exercises
training_events (materialized schedule — one row per session per date)
  └── linked to session_logs on completion

nutrition_plans (template/blueprint)
  └── nutrition_plan_daily_targets (7-row weekly blueprint)
nutrition_events (materialized schedule — one row per client per date)
  └── status tracks logged/missed
```

**Training events lifecycle:**
- Plan created (AI or manual) → events generated for phase duration (or 8 weeks default)
- Coach moves a session → past events frozen, future events regenerated
- Coach edits session name/exercises → future events regenerated with new snapshot
- Coach regenerates plan → old plan's future events deleted, new plan's events generated
- Client completes a session → event status updated, `session_log_id` linked
- Past events are immutable — they represent what was actually scheduled

**Nutrition events lifecycle:**
- Plan created/regenerated → nutrition events generated for phase duration (or 8 weeks default)
- Coach applies plan from future date → old plan's events preserved up to effective_from - 1, new events from effective_from onward
- Coach moves a training session day → training events regenerate → nutrition events cascade-regenerate (training burn moves to correct day, baseline unchanged)
- Coach saves custom day distribution (skew) → events regenerate with per-day calorie overrides
- Client logs nutrition → event status updated to `logged`
- Past events are immutable — they represent what was actually prescribed

**Templates vs events (both domains):**
- `training_sessions.day_of_week` = training blueprint (what the recurring week looks like)
- `training_events` = training reality (concrete dates with snapshotted session names)
- `nutrition_plan_daily_targets` = nutrition blueprint (7 day-of-week target rows)
- `nutrition_events` = nutrition reality (concrete dates with calorie/macro targets)
- The Plans tab reads from templates (coach's blueprint view)
- The Data tab, Daily Pulse, check-in snapshots, weekly summaries read from events

**Nutrition event calorie composition:**
- `baseline_calories` — plan's rest-day calorie target (frozen at event creation)
- `training_burn_calories` — from training event on that date (0 if rest day)
- `external_burn_calories` — from external activities on that day-of-week
- Display total = baseline + burns (when `include_activity_burn` is on) or baseline only (when off)
- The `include_activity_burn` toggle is display-only — does not require event regeneration

**Nutrition regeneration options:**
- "Recalculate calories" — recalculates from TDEE/deficit using current weight and goal timeline
- "Keep current calories" — preserves existing baseline, only updates training day distribution and macros

**Training → Nutrition cascade:**
- Training event regeneration triggers nutrition event regeneration
- Only future `scheduled` events are replaced; `logged`/`missed` events are immutable
- The cascade preserves baseline calories — only the training burn column changes

**Check-in snapshot:**
- `check_ins.period_snapshot` JSONB — frozen day-by-day training + nutrition schedule
- Training data reads from `training_events` (accurate per-date history)
- Nutrition data reads from `nutrition_events` for unlogged days, `nutrition_logs` stored targets for logged days
- Written at submission time, never updated

### 3. Update or delete legacy documentation

The following documentation files contain architecture descriptions that become outdated after the nutrition events migration. Future devs and Claude Code sessions should not follow the legacy patterns described in these files.

#### `NUTRITION-PLANNER-README.md` — HIGH PRIORITY: Rewrite or delete

This file comprehensively documents the pre-events nutrition architecture. Nearly every section becomes outdated:

| Section | Lines | What's outdated | What to update |
|---------|-------|-----------------|----------------|
| Core Principle 1 (baseline + additive model) | 26 | Still correct conceptually, but the additive burns are now baked into `nutrition_events` at generation time, not computed at render time | Update to explain events store the composed total |
| Core Principle 4 (two computation paths) | 36 | "Neither stores pre-computed daily targets in the database — they are always derived at render time" is now **false**. Nutrition events ARE stored per-date targets. | Rewrite: events are the source of truth; `buildDailyTargetsFromPlan` is only used for the Plans tab blueprint view |
| Core Principle 5 (calorie skewing) | 38 | "Training/activity burn remains additive and dynamic on top" — burn is now frozen into events at generation time, regenerated on changes | Update: skew saves trigger event regeneration |
| Core Principle 7 (plan history snapshots) | 42 | References `nutrition_plan_history` table which is deprecated | Replace with `nutrition_plans` with `status='archived'` |
| Hooks section | 115-136 | `use-nutrition-plan.ts` described as computing `weeklyTargets` by calling `getWeeklyNutritionTargets()` at render time | Update: hook fetches from API which reads events for date-specific views |
| Services section | 174-176 | `getClientNutritionTargets()` described as computing from stored fields | Update: reads from `nutrition_events` |
| Data Flow 1-5 | 336-411 | All 5 flows describe the pre-events template-based architecture | **Rewrite entirely** to show event-based flows |
| Key Design Decisions | 415-426 | Decision #1 "No stored daily targets" is now reversed; #3 "Dual computation paths" changes | Rewrite to reflect events architecture |
| Database Schema section | 273-304 | Lists nutrition columns on `clients` table and `nutrition_plan_history` as current | Add `nutrition_events` table; mark `nutrition_plan_history` as deprecated; note which `clients` columns are legacy cache |

**Recommended action:** Either rewrite this file to reflect the events architecture, or delete it and let `docs/ARCHITECTURE.md` be the single source of truth (preferred — avoids dual maintenance).

#### `docs/NUTRITION_PLANS_ARCHITECTURE.md` — MEDIUM PRIORITY: Add status header + deprecation notes

This file was the original spec for migrating from flat `clients` columns to `nutrition_plans` + `nutrition_plan_daily_targets` tables. That migration is complete (migrations 044, 048, 066). The file now describes an intermediate architecture that has been superseded by nutrition events.

Key outdated claims:
- **Line 122**: "Training session calories are NOT stored here; they are fetched live" — now false, `nutrition_events` stores `training_burn_calories`
- **Line 149-155**: "Training session calories are always fetched live... dynamic fetch continues" — now false, burns are frozen into events
- **Line 155**: "Freezing would require the coach to manually regenerate" — now irrelevant, the cascade handles this automatically
- **Lines 330-352**: Migration phases 1-3 describe migrating from `clients` columns to `nutrition_plans` table — this is done. The next migration (to events) is not documented here.
- **Lines 385-396**: Design decisions table says "Training calories fetched live, not frozen" — now reversed.

**Recommended action:** Add a header block at the top:
```
> **STATUS: SUPERSEDED** — This document describes the migration from flat `clients` columns
> to `nutrition_plans` + `nutrition_plan_daily_targets` tables (completed in migrations 044-069).
> The architecture has since evolved to include `nutrition_events` (one row per client per date)
> which replaced the template-based daily target lookups. See IMPLEMENTATION-PLAN.md (NE-1
> through NE-3) for the current architecture. Training burns are now frozen into events at
> generation time and cascade-regenerated when training days change.
```

#### `CALENDAR-EVENTS-PLAN.md` — LOW PRIORITY: Already scheduled for deletion

This file describes the original training events plan (CE-1 through CE-5). CE-4 and CE-5 (nutrition calorie integration) have been superseded by NE-1 through NE-3 in this implementation plan. The file references legacy patterns like:
- Line 8-9: "calorie burn doesn't move with it in the nutrition calculator's stored targets" — solved by nutrition events cascade
- Lines 429-443: CE-4 acceptance criteria reference template-based patterns that are being replaced

**Recommended action:** Delete after all sessions complete (already in cleanup step 1).

#### `DAILY-PULSE-README.md` — LOW PRIORITY: Minor clarification

- **Line 39**: "nutrition targets are snapshotted at save time" — still correct
- **Line 41**: "uses the log's `date` field when looking up nutrition targets" — still correct, but the lookup now goes to `nutrition_events` instead of `getPlanTargetForDate()` with template resolution

**Recommended action:** Update line 39 to clarify: "Nutrition targets come from `nutrition_events` (one row per client per date). When a client logs, the target from the event is snapshotted into `nutrition_logs.target_*` columns."

#### `docs/ARCHITECTURE.md` — Updated as part of step 2 above

The Data Hierarchy diagram (line 28) needs `nutrition_events` added alongside `training_events`. This is already covered in step 2 of this cleanup section.

#### `TECHNICAL-DEBT.md` — LOW PRIORITY: Update references

- **Line 186**: References RLS performance concern for `nutrition_plan_daily_targets` — still valid for the template table, but `nutrition_events` also needs RLS policies added to the monitoring list
- **Line 238**: References missing indexes on `nutrition_plan_daily_targets` — `nutrition_events` needs its own index review

**Recommended action:** Add `nutrition_events` to both items.

#### Files with NO changes needed

| File | Reason |
|------|--------|
| `CONVENTIONS.md` | No nutrition-specific architecture described |
| `CHECK_IN_SETUP.md` | No nutrition plan architecture references |
| `CLIENT-APP-REFERENCE.md` | Client-facing feature list, not architecture |
| `CLIENT-ONBOARDING-README.md` | Onboarding flow, not nutrition architecture |
| `DESIGN-ROLLOUT.md` | Visual design, not data architecture |
| `HISTORICAL_TABLES_PLAN.md` | Historical tables plan, separate concern |
| `MISSED_CHECKIN_TRACKING_PLAN.md` | Check-in tracking, not nutrition |
| `ROADMAP-REDESIGN-PLAN.md` | Roadmap features, not nutrition |
| `docs/NUTRITION_PLAN_CALCULATOR.md` | Calculation formulas (TDEE, macros) — still correct, these don't change with events |
| `docs/TRAINING_PLAN_FEATURE.md` | Training plan architecture, not nutrition |
| `docs/newdesignsystem.md` | Visual design tokens |
| `schema_dump.md` | Auto-generated schema snapshot, regenerated after migrations |

### 4. Verify nothing references deleted code
Run `npx tsc --noEmit` and `npx vitest run` one final time to confirm clean build.
