# Unified Implementation Plan

## Completed Sessions

| Order | Session | Status |
|-------|---------|--------|
| 1 | CE-1: Training events migration + event service + helpers | Done |
| 2 | CE-2: Wire training events into plan lifecycle + backfill | Done |
| 3 | CE-3: Training consumer migration (12+ consumers) | Done |
| 4 | NE-1: Nutrition events migration + event service + helpers | Done |
| 5 | NE-2: Wire nutrition events into plan lifecycle + backfill | Done |
| 6 | EX-1: Exercise catalog - master table, resolution service, wire into insertion paths | Done |
| 7 | CAL-1: Calendar backend - is_modified migration + move/duplicate service + API endpoints | Done |
| 8 | CAL-2: Calendar UI - multi-week grid + drag/move + duplicate week + session detail drawer | Done |
| 9 | NE-3: Nutrition consumer migration + training cascade | Done |

## Remaining Sessions

| Order | Session | Scope | Depends On |
|-------|---------|-------|------------|
| 10 | LIB-1 | Library backend: relational tables + CRUD service + API + single event deletion | EX-1 (done), CAL-2 (done) |
| 11 | LIB-2 | Preview UI + generation redirect + calorie surplus model: preview drawer, library pages, orchestrator changes, AI prompt update, all nutrition consumer updates for % model | LIB-1 |
| 12 | LIB-3 | Placement + calendar integration: cycle-aware placement with % nutrition cascade, library panel, save-from-calendar, atomic plan archival | LIB-2 |
| 13 | EL-1 | Rolling event window for no-roadmap clients + stale draft cleanup | NE-2 (done), LIB-1 (draft cleanup queries coach_saved_plans table) |
| 14 | CR-4 | Check-Ins tab (list + detail views) | NE-3 (done) |
| 15 | CR-5 | Dashboard + roadmap enrichment | CE-3 (done) |

**Notes:**
- LIB-1, CR-4, and CR-5 are all unblocked and can run now
- LIB-1 -> LIB-2 -> LIB-3 must be sequential
- EL-1 depends on LIB-1 (draft cleanup queries `coach_saved_plans` table from migration 084)
- CR-4 and CR-5 are independent and can run in parallel with LIB sessions

**Library-first architecture (LIB-1 + LIB-2 + LIB-3):**

The coach's library is the foundation for plan creation. AI and manual generation produce drafts in the library. The coach previews, edits, then places onto a client's calendar. Plans are ordered session sequences (programs) with cycle-aware duplication, not fixed weekly schedules.

1. **Plans are programs, not schedules.** A plan is an ordered list of sessions (e.g., Push, Pull, Legs, Rest). Which calendar dates they land on is decided at placement time, not generation time. No `day_of_week` binding at generation.
2. **Library-first generation.** AI and manual plan creation targets `coach_saved_plans` (with `status = 'draft'`). The coach previews on a full-page editor with full exercise editing, then saves to library, applies to a client, or discards.
3. **Transient drafts.** Drafts are not shown in the library list. The coach explicitly saves to library via "Save to Library" (promotes to `status = 'saved'`). Saving a plan also saves each session as a standalone reusable entry. Stale drafts (7+ days, never saved or applied) are auto-cleaned.
4. **Cycle-aware placement.** When applying to a client, the coach picks a start date. The system detects the cycle length (e.g., PPL+Rest = 4 days) and places sessions accordingly, repeating for the phase duration. A PPL+Rest plan starting on Wednesday places Push(Wed), Pull(Thu), Legs(Fri), Rest(Sat), Push(Sun), etc.
5. **Standalone sessions.** Coaches can create individual sessions from scratch in the library (not attached to any plan). These can be dragged onto specific calendar days for mix-and-match programming.
6. **Phase defines the grid.** The phase `start_date` to `end_date` determines the calendar dimensions and the valid date range for events. Coaches cannot place sessions or plans on dates outside the active phase. Dates outside the phase are greyed out and non-droppable. Plans without a phase have no boundary - all dates within the event range are valid.
7. **Calendar is the source of truth.** Once events are on the calendar, the coach works directly with them. Days without events are rest days (derived at render time, not stored). Sessions own exercises. Events own scheduling.
8. **Placement creates copies.** When placing from library, the system creates fresh `training_session` + `training_exercises` + `training_event` rows for the client. The saved template is never modified by client-side edits.
9. **Exercise catalog underpins everything.** A master `exercises` table gives exercises stable identities. Both client exercises (`training_exercises`) and library exercises (`coach_saved_exercises`) reference the catalog via `exercise_id` FK.
10. **No template-to-event sync for calendar-placed sessions.** Once events are on the calendar, the coach works directly with them. The `day_of_week` field on sessions is irrelevant for calendar-placed sessions (left null). Regeneration (`regenerateFutureEvents`) is the template-driven path still used by the weekly template editor. Calendar-placed sessions (from library placement or duplicate-week) have `day_of_week = null` and are managed directly. Both coexist during the transition.
11. **Three on-ramps to a populated calendar:**
    - **AI Generator** - generates a plan using client context. Lands as a draft in the library. Coach previews, edits, then applies to any start date.
    - **Library Plans** - coach applies a saved plan from their library onto any client's calendar from any start date. The fast path for experienced coaches.
    - **Library Sessions** - coach drags individual saved sessions onto specific calendar days. Mix and match for fully custom programming.

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
  diet_type TEXT,
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
   - Calculate **baseline** macros via `calculateDailyMacros(baselineCalories, proteinG, isTrainingDay, dietType)` — use `baselineCalories` only, NOT burn-inclusive total. Macros stored on events are always baseline. When `include_activity_burn` is on, the display helper recalculates macros from `baseline + burns` at render time using the snapshotted `diet_type`.
   - Build insert row: `{ client_id, nutrition_plan_id, date, day_of_week, baseline_calories, training_burn_calories, external_burn_calories, protein_g, carb_g, fat_g, diet_type, is_training_day, status: 'scheduled' }`
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
| Nutrition period summary | `buildNutritionSummary()` in `nutrition-period-summary.ts` | Plans + templates + training template for unlogged | `getNutritionEventsForDateRange()` for unlogged | **DONE** |

**NE-3 partial (done):** `buildNutritionSummary()` in `nutrition-period-summary.ts` now reads unlogged day targets from `nutrition_events` (with template fallback for pre-backfill dates). The remaining NE-3 consumers (Daily Pulse targets, weekly summary, check-in context) are not yet migrated.

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

## ~~PT-1: Plan Continuation Across Phase Transitions~~ (Removed)

**Removed.** The coach library (LIB-1/2/3) provides a better UX for plan reuse across phases. Instead of magic auto-cloning, the coach saves a plan to their library, then places it onto a new phase's calendar from any start date. This gives the coach full control and avoids the complexity of cloning events with their `is_modified` flags, date offsets, and edge cases around different phase durations.


---

## EL-1: Rolling Event Window for No-Roadmap Clients

**Goal:** Ensure events are continuously generated for clients without phases/roadmaps, so their plans don't silently expire after the 8-week default window. Also cleans up stale library drafts.

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
c. For each plan: call `regenerateFutureEvents(clientId, planId)` — this generates events from today through today + 8 weeks, skipping dates that already have events (upsert ignoreDuplicates). **Note (post-CAL-1):** uses `force = false` by default, so any `is_modified` events from calendar edits are preserved. New template events are generated only for dates without existing events.
d. Same query pattern for nutrition plans / nutrition events
e. Return counts for logging

```typescript
export async function extendExpiringNutritionEvents(): Promise<{ extended: number; skipped: number }>
```

Same pattern for nutrition events.

```typescript
export async function cleanupStaleDrafts(): Promise<{ deleted: number }>
```

Delete `coach_saved_plans` where `status = 'draft'` AND `created_at < NOW() - INTERVAL '7 days'`. CASCADE deletes child sessions and exercises. Return count of deleted drafts.

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
    const draftCleanup = await cleanupStaleDrafts();

    return NextResponse.json({
      success: true,
      training: trainingResult,
      nutrition: nutritionResult,
      draftsDeleted: draftCleanup.deleted,
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

## CAL-1: Calendar Backend — Migration + Event Service + API Endpoints

**Goal:** Add `is_modified` flag to `training_events`, create service functions for move/duplicate, create API endpoints, and update regeneration to warn about modified events.

**Why a calendar?** Coaches are currently limited to a 7-day weekly template view, which forces a Mon-Sun mental model and prevents proactive programming across a full phase. The calendar adds a multi-week view reading from `training_events` (already in the DB), letting coaches move, duplicate, and edit individual events. The template editor stays for bulk changes; the calendar is the fine-tuning layer on top.

### Claude Code prompt

```
Read IMPLEMENTATION-PLAN.md for full context, then read CONVENTIONS.md and docs/ARCHITECTURE.md.

This is CAL-1: Calendar Backend — Migration + Event Service + API Endpoints.

**Read first:**
- `services/training-event-service.ts` — all exported functions, especially `regenerateFutureEvents()`, `mapEventRow()`, `getEventsForDateRange()`
- `supabase/migrations/075_create_training_events.sql` — training_events table schema
- `supabase/migrations/076_fix_training_events_constraint.sql` — partial unique index on (client_id, training_session_id, date)
- `app/api/clients/[id]/training/[planId]/regenerate-events/route.ts` — regeneration endpoint (understand full flow including nutrition cascade)
- `services/nutrition-event-service.ts` — `regenerateFutureNutritionEvents()` for cascade pattern
- `types/training.ts` — `TrainingEvent` type
- `types/database.ts` — `training_events` Row/Insert/Update types
- `lib/date-helpers.ts` — `getTodayDateString()`, `getDateString()`, `DAY_NUM`
- `services/supabase-admin.ts` — supabaseAdmin import pattern
- `lib/error-handler.ts` — `captureApiError()` for non-blocking error handling

**1. Migration: `supabase/migrations/082_add_is_modified_to_training_events.sql`**

```sql
-- Tracks events manually moved or duplicated by the coach via the calendar UI.
-- Regeneration warns before overwriting modified events.
ALTER TABLE training_events ADD COLUMN is_modified BOOLEAN NOT NULL DEFAULT false;
```

No index needed on `is_modified` alone — the existing `idx_training_events_client_date` covers queries that filter by client + date range.

**2. Update types**

**`types/training.ts`** — Add `isModified: boolean` to the `TrainingEvent` type (after `sessionLogId`).

**`types/database.ts`** — Add `is_modified: boolean` to the `training_events` Row type, `is_modified?: boolean` to Insert and Update types.

**3. Update existing service: `services/training-event-service.ts`**

a. Update `mapEventRow()` to include `isModified: row.is_modified`.

b. Add `force?: boolean` parameter to `regenerateFutureEvents()`:
   - Current behavior: deletes all events where `status = 'scheduled' AND date >= fromDate`
   - New behavior: when `force` is false (default), add `.eq("is_modified", false)` to the delete query — preserves manually adjusted events
   - When `force` is true, delete all `scheduled` events regardless (current behavior, used when coach confirms the warning)

**4. New service: `services/training-event-calendar-service.ts` (~150 lines)**

All functions use `supabaseAdmin` (system-level writes for calendar operations).

```typescript
export async function moveEvent(
  eventId: string,
  newDate: string,
  clientId: string,
  planId: string
): Promise<void>
```

Implementation:
a. Fetch the event: `.select("*").eq("id", eventId).single()`.
b. Validate: event belongs to `clientId` and `planId`, event `status === "scheduled"`, `newDate >= getTodayDateString()`.
c. Phase boundary check: if the plan has a `phase_id`, query `phases` for `start_date` and `end_date`. Validate `newDate` falls within range. If not, throw with "Target date is outside the current phase".
d. Conflict check: query for existing event with same `training_session_id` on `newDate`. If found, throw with "Session is already scheduled on this date".
e. Update: `.update({ date: newDate, is_modified: true, updated_at: new Date().toISOString() }).eq("id", eventId)`.

```typescript
export async function moveEventAndFuture(
  trainingSessionId: string,
  newDayOfWeek: string,
  clientId: string,
  planId: string,
  draggedEventId: string,
  draggedNewDate: string
): Promise<void>
```

Implementation:
a. Update the template session: `supabaseAdmin.from("training_sessions").update({ day_of_week: newDayOfWeek }).eq("id", trainingSessionId)`.
b. Update the dragged event directly: `.update({ date: draggedNewDate, is_modified: true }).eq("id", draggedEventId)`.
c. Call `regenerateFutureEvents(clientId, planId, effectiveFrom, true)` with `force = true` — the coach is explicitly choosing to update all future events, so any previously modified events should also be reset to the new template. Use the day after `draggedNewDate` as `effectiveFrom` so the dragged event itself is preserved (it was already updated in step b).

```typescript
export async function duplicateEvent(
  sourceEventId: string,
  targetDate: string,
  clientId: string,
  planId: string
): Promise<string>
```

Implementation:
a. Fetch source event.
b. Validate: `targetDate >= today`, target within phase bounds (same check as moveEvent).
c. Conflict check: same `training_session_id` on `targetDate`.
d. Insert new row copying `client_id`, `training_plan_id`, `training_session_id`, `session_name`, `session_focus`, `estimated_calories` from source, with `date = targetDate`, `status = 'scheduled'`, `is_modified = true`.
e. Return new event ID.

```typescript
export async function countModifiedFutureEvents(
  clientId: string,
  planId: string
): Promise<number>
```

Implementation: Count query with `{ count: "exact", head: true }` where `training_plan_id = planId AND is_modified = true AND date >= today AND status = 'scheduled'`.

**5. Events GET API: `app/api/clients/[id]/training/[planId]/events/route.ts`**

GET endpoint. Query params: `startDate` (YYYY-MM-DD), `endDate` (YYYY-MM-DD).

Standard middleware: `coachApiRateLimit` → `getAuthenticatedCoachId` → IDOR check (client belongs to coach, **plan belongs to client**). No CSRF needed (GET request).

Calls `getEventsForDateRange(clientId, startDate, endDate)`. Returns `{ success: true, events: TrainingEvent[] }`.

This endpoint is required by the calendar data hook in CAL-2. Creating it here (not in CAL-2) so all backend work is in one session.

**6. Move API: `app/api/clients/[id]/training/[planId]/events/[eventId]/move/route.ts`**

POST endpoint. Standard middleware ordering: `coachApiRateLimit` → `requireCSRFProtection` → `getAuthenticatedCoachId` → IDOR check (client belongs to coach, plan belongs to client).

Zod schema:
```typescript
const moveEventSchema = z.object({
  targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD format"),
  scope: z.enum(["single", "all_future"]),
});
```

For `scope === "single"`: call `moveEvent(eventId, targetDate, clientId, planId)`.

For `scope === "all_future"`:
a. Fetch the event to get its `training_session_id`.
b. Calculate the new day_of_week from targetDate: `const dayNum = new Date(targetDate + "T00:00:00").getDay()`, then reverse-lookup in `DAY_NUM`.
c. Call `moveEventAndFuture(trainingSessionId, newDayOfWeek, clientId, planId, eventId, targetDate)`.

After either path: cascade nutrition events for affected dates (reuse the pattern from `regenerate-events/route.ts` lines 58-70 — fetch active/planned nutrition plans, call `regenerateFutureNutritionEvents` for each).

Return `{ success: true }` on success. Return 400/409 for validation/conflict errors.

**7. Duplicate API: `app/api/clients/[id]/training/[planId]/events/[eventId]/duplicate/route.ts`**

POST endpoint. Same middleware pattern.

Zod schema:
```typescript
const duplicateEventSchema = z.object({
  targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD format"),
});
```

Call `duplicateEvent(eventId, targetDate, clientId, planId)`. Cascade nutrition events for the target date. Return `{ success: true, eventId: newEventId }`.

**8. Modified count API: `app/api/clients/[id]/training/[planId]/events/modified-count/route.ts`**

GET endpoint. Standard middleware (coachApiRateLimit, auth, IDOR). No CSRF needed (GET request).

Call `countModifiedFutureEvents(clientId, planId)`. Return `{ success: true, count: number }`.

**9. Update regeneration endpoint: `app/api/clients/[id]/training/[planId]/regenerate-events/route.ts`**

a. Add `force: z.boolean().optional()` to the Zod schema.
b. Before calling `regenerateFutureEvents`:
   - If `force` is not set, call `countModifiedFutureEvents(clientId, planId)`.
   - If count > 0, return `{ success: false, modifiedCount: count, requiresConfirmation: true }` with status 200. This lets the UI show a warning dialog.
   - If count === 0 or `force === true`, proceed with regeneration.
c. Pass `force` through to `regenerateFutureEvents(clientId, planId, effectiveFrom, force)`.

After implementing, run `npx tsc --noEmit` and `npx vitest run`. Commit when done.
```

---

## EX-1: Exercise Catalog — Master Table + Resolution Service

**Goal:** Create a master `exercises` table that gives every exercise a stable identity. Wire it into all exercise insertion paths so `training_exercises` rows link to the catalog via `exercise_id` FK. This is the foundation for the coach library (CAL-3a) and future exercise logging/progression tracking.

### Design

**Two-tier catalog:**
- Global exercises (`coach_id = NULL`) — seeded with 1000+ common exercises, read-only for coaches. Maintained by the platform.
- Coach-specific exercises (`coach_id = UUID`) — created when AI generates a novel exercise or coach manually adds one. Only visible to that coach.

**Resolution strategy (Option B):**
- Case-insensitive exact match on `name`
- Alias matching via `aliases` text array (e.g., "DB Bench Press" matches "Dumbbell Bench Press" via aliases)
- Common abbreviation normalization before matching (DB → Dumbbell, BB → Barbell, OHP → Overhead Press, etc.)
- Resolution order: coach-specific exact → global exact → coach-specific alias → global alias → normalize and retry → create as coach-specific

### Claude Code prompt

```
Read IMPLEMENTATION-PLAN.md for full context, then read CONVENTIONS.md and docs/ARCHITECTURE.md.

This is EX-1: Exercise Catalog — Master Table + Resolution Service.

**Read first:**
- `types/database.ts` — `training_exercises` Row/Insert/Update types
- `types/training.ts` — `TrainingExercise` type
- `services/training-session-service.ts` — `insertTrainingSessions()`, `replaceSessionExercises()`, `addExercise()` (all exercise insertion paths)
- `services/training-plan-orchestrator.ts` — plan creation flow that calls `insertTrainingSessions()`
- `app/api/clients/[id]/training/[planId]/sessions/[sessionId]/exercises/route.ts` — exercise CRUD API (if exists, check `app/api/clients/[id]/training/[planId]/sessions/[sessionId]/` directory)
- `lib/database-helpers.ts` — type exports pattern
- `services/supabase-admin.ts` — supabaseAdmin import pattern

**1. Migration: `supabase/migrations/083_create_exercises_catalog.sql`**

```sql
-- Master exercise catalog with two-tier ownership:
-- coach_id = NULL → global (platform-seeded, read-only for coaches)
-- coach_id = UUID → coach-specific (AI-generated or manually created)

CREATE TABLE exercises (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id UUID REFERENCES coaches(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  muscle_group TEXT,
  equipment TEXT,
  category TEXT,
  aliases TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique per coach (or globally when coach_id is NULL)
CREATE UNIQUE INDEX idx_exercises_coach_name
  ON exercises(COALESCE(coach_id, '00000000-0000-0000-0000-000000000000'), LOWER(name));

CREATE INDEX idx_exercises_coach ON exercises(coach_id);
CREATE INDEX idx_exercises_name ON exercises(LOWER(name));

-- Add exercise_id FK to training_exercises (nullable for backward compat)
ALTER TABLE training_exercises ADD COLUMN exercise_id UUID REFERENCES exercises(id) ON DELETE SET NULL;
CREATE INDEX idx_training_exercises_exercise ON training_exercises(exercise_id);
```

**2. Update types**

**`types/database.ts`** — Add `exercises` table types (Row/Insert/Update) and add `exercise_id: string | null` to `training_exercises` Row, `exercise_id?: string | null` to Insert and Update.

**`types/training.ts`** — Add to `TrainingExercise` type: `exerciseId: string | null`. Add new type:

```typescript
export type Exercise = {
  id: string;
  coachId: string | null;
  name: string;
  muscleGroup: string | null;
  equipment: string | null;
  category: string | null;
  aliases: string[];
  createdAt: string;
  updatedAt: string;
};
```

**`lib/database-helpers.ts`** — Add `ExerciseRow`, `ExerciseInsert` type exports.

**3. Resolution service: `services/exercise-catalog-service.ts` (~200 lines)**

All functions use `supabaseAdmin` (system-level writes for catalog operations).

**Abbreviation map** (constant at top of file):

```typescript
const ABBREVIATIONS: Record<string, string> = {
  "db": "dumbbell", "bb": "barbell", "ohp": "overhead press",
  "rdl": "romanian deadlift", "cgbp": "close grip bench press",
  "sldl": "stiff leg deadlift", "ez": "ez-bar",
  "kb": "kettlebell", "bw": "bodyweight",
};
```

```typescript
export async function resolveExercise(
  name: string,
  coachId: string
): Promise<string>
```

Implementation:
a. Normalize input: `name.trim()`.
b. Case-insensitive exact match (coach-specific first, then global):
   - Query `exercises` where `LOWER(name) = LOWER(input)` AND (`coach_id = coachId` OR `coach_id IS NULL`), ordered by `coach_id NULLS LAST` (coach-specific takes precedence).
   - If found, return `id`.
c. Alias match: query where `LOWER(input) = ANY(SELECT LOWER(unnest(aliases)))` with same coach filter.
   - If found, return `id`.
d. Abbreviation normalization: apply `ABBREVIATIONS` map to each word in the input string (split by spaces, replace matching words, rejoin). Re-run steps b and c with the normalized string.
   - If found, return `id`.
e. No match: insert new exercise with `coach_id = coachId`, `name = input (original casing)`. Return new `id`.

```typescript
export async function resolveExercises(
  names: string[],
  coachId: string
): Promise<Map<string, string>>
```

Batch version: resolves multiple exercise names efficiently. Fetches all coach + global exercises in one query, matches in memory, creates missing ones in a batch insert. Returns `Map<originalName, exerciseId>`.

```typescript
export async function getExercisesForCoach(
  coachId: string,
  search?: string
): Promise<Exercise[]>
```

Returns all exercises visible to the coach (global + coach-specific), optionally filtered by search term (ILIKE on name). Ordered alphabetically. Used by exercise picker UI.

```typescript
export async function createExercise(
  coachId: string,
  data: { name: string; muscleGroup?: string; equipment?: string; category?: string; aliases?: string[] }
): Promise<Exercise>
```

Creates a coach-specific exercise. Returns the new exercise.

```typescript
function normalizeExerciseName(name: string): string
```

Private helper: applies abbreviation map to each word, lowercases. Used internally for matching.

**4. Wire into exercise insertion paths**

**`services/training-session-service.ts`** — Update `insertTrainingSessions()`:
- Before inserting exercises, call `resolveExercises(exerciseNames, coachId)` to get exercise IDs.
- Add `exercise_id` to each `training_exercises` insert.
- The `coachId` must be passed through from the API route. Add it as a parameter to `insertTrainingSessions()`.

**`services/training-session-service.ts`** — Update `replaceSessionExercises()`:
- Same pattern: resolve exercise names before inserting.
- Add `coachId` parameter.

**`services/training-session-service.ts`** — Update `addExercise()` (if it exists as a single-exercise insert):
- Resolve single exercise name before inserting.

Update all callers of these functions to pass `coachId`:
- `services/training-plan-orchestrator.ts` — `orchestrateTrainingPlanCreation()` already has `coachId` available
- `app/api/clients/[id]/training/manual/route.ts` — has `coachId` from auth
- Any exercise CRUD API routes

**5. Update `mapExerciseRow()` in `services/training-mappers.ts`**

Add `exerciseId: row.exercise_id` to the mapped output.

**6. Exercise catalog API: `app/api/training/exercises/route.ts`**

Note: lives under `/api/training/` (coach-level resource, not client-specific).

GET handler: `coachApiRateLimit` → `getAuthenticatedCoachId()` → `getExercisesForCoach(coachId, searchParam)`. Query param: `search` (optional, for filtering). Returns `{ success: true, exercises: Exercise[] }`.

POST handler: `coachApiRateLimit` → `requireCSRFProtection` → `getAuthenticatedCoachId()` → validate body `{ name, muscleGroup?, equipment?, category?, aliases? }` → `createExercise(coachId, data)`. Returns `{ success: true, exercise: Exercise }`.

**7. Seed data structure: `scripts/seed-exercise-catalog.ts`**

Create a seed script that reads from a CSV/JSON file and inserts global exercises (coach_id = NULL). Structure:

```typescript
type SeedExercise = {
  name: string;
  muscleGroup: string;
  equipment: string;
  category: string;
  aliases: string[];
};
```

The actual seed data (1000+ exercises) will be prepared separately as a JSON file. The script reads it and upserts into `exercises` with `coach_id = NULL`. Run via `npx tsx scripts/seed-exercise-catalog.ts`.

Do NOT generate the seed data in this session. Just create the script structure that reads from `scripts/data/exercises.json` and upserts. The JSON file will be populated separately.

**8. Unit tests: `services/exercise-catalog-service.test.ts`**

Follow the pattern of `services/training-event-service.test.ts` (vi.mock supabaseAdmin, createMockQuery helpers).

Test `resolveExercise`:
- Returns existing exercise ID on exact name match (case-insensitive)
- Returns existing exercise ID on alias match
- Normalizes abbreviations and matches (e.g., "DB Bench Press" resolves to "Dumbbell Bench Press")
- Creates a new coach-specific exercise when no match found
- Coach-specific exercises take precedence over global exercises with the same name

Test `resolveExercises` (batch):
- Resolves multiple names in one call, returns correct Map
- Creates missing exercises while reusing existing ones

Test `normalizeExerciseName`:
- Applies abbreviation map correctly ("db" to "dumbbell", "bb" to "barbell")
- Handles mixed case and multiple abbreviations in one name

After implementing, run `npx tsc --noEmit` and `npx vitest run`.
```

---

## CAL-2: Calendar View + Interactions + Duplicate Week with Session Cloning

**Goal:** Build the multi-week calendar UI where the calendar is the source of truth for the client's training program. The phase defines the grid dimensions. Coaches drag to move events, duplicate individual events, duplicate entire weeks (with independent session cloning), and edit session exercises via a detail drawer. This replaces the weekly template view as the primary scheduling interface.

### Claude Code prompt

```
Read IMPLEMENTATION-PLAN.md for full context (especially the "Calendar-as-SOT architecture" section), then read CONVENTIONS.md and docs/ARCHITECTURE.md.

This is CAL-2: Calendar View + Interactions + Duplicate Week with Session Cloning.

**Key architectural principle:** The calendar is the source of truth for the client's training program. The phase defines the grid (start_date to end_date). Days without events are rest days. Sessions own exercises. Events own scheduling. Duplicate-week clones sessions so each week is independent.

**Read first:**
- `services/training-event-calendar-service.ts` — move/duplicate service functions built in CAL-1
- `services/training-event-service.ts` — `getEventsForDateRange()`, `countEventsInRange()`, `regenerateFutureEvents()` (with force param), `generateTrainingEvents()`
- `app/api/clients/[id]/training/[planId]/events/route.ts` — GET events endpoint from CAL-1
- `app/api/clients/[id]/training/[planId]/events/[eventId]/move/route.ts` — move endpoint from CAL-1
- `app/api/clients/[id]/training/[planId]/events/[eventId]/duplicate/route.ts` — duplicate endpoint from CAL-1
- `app/api/clients/[id]/training/[planId]/events/modified-count/route.ts` — modified count endpoint from CAL-1
- `services/exercise-catalog-service.ts` — exercise resolution from EX-1
- `components/clients/training/schedule/weekly-schedule-view.tsx` — existing 7-day grid (pattern reference for layout, styling, DnD)
- `components/clients/training/schedule/droppable-day-cell.tsx` — existing droppable cell pattern
- `components/clients/training/schedule/sortable-schedule-item.tsx` — existing draggable item pattern
- `components/clients/training/schedule/weekly-schedule-item.tsx` — existing session card in grid
- `components/clients/training/schedule/day-headers-grid.tsx` — existing Mon-Sun labels
- `hooks/use-schedule-dnd.ts` — existing drag/drop hook (follow this pattern)
- `components/clients/training/sessions/training-session-card.tsx` — session accordion with exercise editing
- `components/clients/training/sessions/training-exercise-row.tsx` — inline exercise editing
- `components/clients/training/sessions/add-exercise-dialog.tsx` — add exercise dialog
- `components/clients/training/builder/training-builder-right-panel.tsx` — right panel with viewMode toggle (week/list)
- `components/clients/training/builder/training-plan-helpers.tsx` — EditModeButton with ApplyDateDialog
- `components/clients/training/builder/training-plan-builder.tsx` — Plans/Data subtab container with Regenerate button
- `components/ui/sheet.tsx` — Sheet component for drawer pattern
- `components/ui/dialog.tsx` — Dialog component for modals
- `contexts/training-builder-context.tsx` — training builder context
- `hooks/use-training-plan.ts` — training plan hook (plan data, phases)
- `lib/swr-fetcher.ts` — SWR fetcher pattern
- `types/training.ts` — TrainingEvent, TrainingSession, Exercise types
- `types/roadmap.ts` — Phase type (start_date, end_date, status, name)
- `lib/constants/days.ts` — DAYS_OF_WEEK constant
- `services/training-session-service.ts` — session/exercise insertion (for duplicate-week cloning)
- `utils/training-event-helpers.ts` — `mapEventsToScheduleDays()` (existing day-by-day mapping)

**1. Duplicate-week backend: `services/training-event-calendar-service.ts` (add ~100 lines)**

Add to the existing calendar service from CAL-1.

```typescript
export async function duplicateWeek(
  clientId: string,
  planId: string,
  coachId: string,
  sourceStartDate: string,
  targetStartDate: string
): Promise<{ eventsCreated: number }>
```

Implementation:
a. Fetch all events in the source week (7 days from sourceStartDate): `getEventsForDateRange(clientId, sourceStartDate, sourceEndDate)`.
b. Filter to `status === "scheduled"` events only (don't duplicate completed/missed events).
c. For each source event with a `training_session_id`:
   - Fetch the source session with exercises: `supabaseAdmin.from("training_sessions").select("*, training_exercises(*)").eq("id", event.trainingSessionId).single()`.
   - Clone the session: insert a new `training_sessions` row copying all fields except `id` (new UUID), `day_of_week` (set to null - calendar-placed sessions don't use template day matching), and `created_at`/`updated_at` (new timestamps).
   - Clone the exercises: insert new `training_exercises` rows for the cloned session, copying all fields including `exercise_id` FK (preserving catalog link from EX-1).
   - Calculate the target date: offset from source week to target week (e.g., source Monday to target Monday).
   - Insert a new `training_event` row: `client_id`, `training_plan_id = planId`, `training_session_id = clonedSessionId`, `date = targetDate`, `session_name`, `session_focus`, `estimated_calories` from source event, `status = "scheduled"`, `is_modified = true`.
d. Return `{ eventsCreated: count }`.

```typescript
export async function duplicateWeekToRemaining(
  clientId: string,
  planId: string,
  coachId: string,
  sourceStartDate: string,
  phaseEndDate: string
): Promise<{ weeksCreated: number; eventsCreated: number }>
```

Implementation:
a. Calculate all target week start dates from `sourceStartDate + 7 days` through `phaseEndDate`.
b. For each target week: call `duplicateWeek(clientId, planId, coachId, sourceStartDate, targetStartDate)`.
c. Return totals.

**2. Duplicate-week API: `app/api/clients/[id]/training/[planId]/events/duplicate-week/route.ts`**

POST endpoint. Standard middleware: `coachApiRateLimit` -> `requireCSRFProtection` -> `getAuthenticatedCoachId` -> IDOR.

Zod schema:
```typescript
const duplicateWeekSchema = z.object({
  sourceStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  targetStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  fillRemaining: z.boolean().optional(),
  phaseEndDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
```

If `fillRemaining === true` and `phaseEndDate` provided: call `duplicateWeekToRemaining()`.
If `targetStartDate` provided: call `duplicateWeek()` for a single target week.

After either path: cascade nutrition events (same pattern as move/duplicate endpoints - fetch active/planned nutrition plans, regenerate from earliest affected date).

Return `{ success: true, eventsCreated, weeksCreated? }`.

**3. Calendar data hook: `hooks/use-calendar-events.ts` (~100 lines)**

```typescript
export function useCalendarEvents(clientId: string, planId: string, plan: TrainingPlan | null)
```

Returns `{ events, eventsByDate, isLoading, error, mutate }`.

Implementation:
a. Compute date range from plan: `startDate = plan.effectiveFrom ?? getTodayDateString()`. For `endDate`: if plan has `phase_id`, fetch phase end date. Otherwise use `effectiveFrom + programDurationWeeks * 7` or fallback 8 weeks.
b. SWR fetch: `GET /api/clients/${clientId}/training/${planId}/events?startDate=${startDate}&endDate=${endDate}` using `swrFetcher`.
c. Memoize `eventsByDate: Map<string, TrainingEvent[]>` from the events array for O(1) cell lookup.
d. SWR config: `revalidateOnFocus: false`.

**4. Calendar DnD hook: `hooks/use-calendar-dnd.ts` (~200 lines)**

Follow the pattern of `hooks/use-schedule-dnd.ts` but operate on `TrainingEvent` objects and calendar dates.

```typescript
export function useCalendarDnd(
  eventsByDate: Map<string, TrainingEvent[]>,
  clientId: string,
  planId: string,
  mutate: () => void
)
```

Returns `{ sensors, handleDragStart, handleDragEnd, activeEvent, pendingMove, handleMoveConfirm, handleMoveCancel }`.

Implementation:
a. Sensors: `PointerSensor` with `distance: 8` + `KeyboardSensor` (same as existing).
b. `handleDragStart`: set `activeEvent` state for the `DragOverlay`.
c. `handleDragEnd`: determine source date (from dragged event) and target date (from droppable cell ID). If they differ and target is a future date, set `pendingMove = { event, sourceDate, targetDate }` to open the move scope dialog.
d. `handleMoveConfirm(scope: "single" | "all_future")`: POST to move endpoint with the pending move data. Optimistic update: temporarily move event in local state, revert on error. Toast on success/failure. Call `mutate()` after.
e. `handleMoveCancel`: clear `pendingMove`.
f. Only allow dragging events where `status === "scheduled"` and date is >= today.

**5. Calendar grid: `components/clients/training/calendar/training-calendar-view.tsx` (~200 lines)**

Multi-week scrollable grid showing the full phase duration. The phase defines the grid - days without events are rest days.

Implementation:
a. Compute weeks array: from plan start date to end date, grouped into 7-day weeks (Mon-Sun).
b. Layout: `DndContext` wrapping a scrollable container. Header row with Mon-Sun labels (reuse pattern from `DayHeadersGrid`). Left gutter showing week numbers (W1, W2, etc.).
c. For each week: render a row of 7 `CalendarDayCell` components. Pass `eventsByDate.get(dateString)` to each cell.
d. `DragOverlay`: render a compact `CalendarEventCard` for the active dragged event.
e. **Week action menu:** Each week row header (W1, W2, etc.) has a dropdown menu with:
   - "Duplicate to next week"
   - "Duplicate to all remaining weeks" (with confirmation: "This will create events for weeks N-M. Existing events in target weeks will not be removed.")
   - "Clear week" (delete all scheduled events in this week, with confirmation)
f. **Live date anchoring:** on mount, scroll to the row containing today's date. Use `scrollIntoView({ behavior: 'smooth', block: 'center' })`.
g. Today indicator: ring highlight (ring-2 ring-teal-500) on today's cell.
h. Past dates: dimmed opacity (opacity-60). Events show status badges but are not draggable.
i. **For plans without a phase** (`phase_id = NULL`): all dates from plan start to plan end are interactive. No phase boundary markers.
j. Render `MoveScopeDialog` when `pendingMove` is set.

**6. Day cell: `components/clients/training/calendar/calendar-day-cell.tsx` (~120 lines)**

Implementation:
a. `useDroppable({ id: dateString, disabled: isPast })`.
b. Show date number (day of month) in the top-right corner.
c. Map events for this date to `CalendarEventCard` components. If 3+ events exist on one date, show the first 2 and a "+N more" indicator with tooltip.
d. Empty future cells: show "Rest" in muted text (`text-[#93b0b4] text-[10px]`).
e. Min height: ~80px for compact multi-week display.
f. Drag-over highlight: `ring-2 ring-teal-500/50` when `isOver && !disabled`.

**7. Event card: `components/clients/training/calendar/calendar-event-card.tsx` (~80 lines)**

Compact card for displaying a training event within a calendar cell.

Implementation:
a. Show: session name (truncated), status dot (colors: scheduled=teal, completed=green, partial=amber, missed=red, skipped=gray).
b. If `event.isModified`: show a small pencil icon to indicate manual adjustment.
c. Click handler: `onClick` callback to open session detail drawer (pass `event.trainingSessionId`).
d. Action dropdown (three-dot button): "Duplicate" and "Delete" options. Only on future scheduled events.
e. Styling: match `WeeklyScheduleItem` card pattern (rounded-[4px], subtle border, teal accent).
f. Drag visual: `opacity-50` while dragging.

**8. Move scope dialog: `components/clients/training/calendar/move-scope-dialog.tsx` (~80 lines)**

Standard `Dialog` component following existing dialog patterns.

Implementation:
a. Props: `open`, `onOpenChange`, `event: TrainingEvent`, `sourceDate: string`, `targetDate: string`, `onConfirm: (scope: "single" | "all_future") => void`, `isLoading: boolean`.
b. Title: "Move {event.sessionName}?"
c. Body: "From {formatted sourceDate} to {formatted targetDate}"
d. Two radio options: "Just this date" and "This and all future {sessionName} sessions"
e. Footer: Cancel button + Confirm button (shows Loader2 when isLoading).

**9. Duplicate event flow**

Handled within `CalendarEventCard`'s action dropdown and `TrainingCalendarView`'s state.

Implementation:
a. `TrainingCalendarView` manages `pendingDuplicate: { eventId: string, sessionName: string } | null` state.
b. When "Duplicate" is clicked on a card: set `pendingDuplicate`.
c. Show a banner at the top of the calendar: "Click a day to place a copy of {sessionName}" with a "Cancel" button.
d. When cell is clicked while `pendingDuplicate` is set: POST to duplicate endpoint.
e. On success: `mutate()`, clear `pendingDuplicate`, toast "Session duplicated".
f. Press Escape or click Cancel: clear `pendingDuplicate`.

**10. Session detail drawer: `components/clients/training/calendar/session-detail-drawer.tsx` (~150 lines)**

Right-side Sheet for viewing and editing a session's exercises directly from the calendar.

Implementation:
a. Props: `open`, `onOpenChange`, `trainingSessionId: string | null`, `clientId: string`, `planId: string`, `onUpdate: () => void`.
b. Uses `Sheet` / `SheetContent` (side="right") from `@/components/ui/sheet`.
c. Fetch session data: SWR fetch to get session with exercises.
d. SheetHeader: session name, focus, duration badge.
e. Edit mode toggle: local `editMode` state with Edit/Done button.
f. Body: render exercises using the same `TrainingExerciseRow` component. Reuses existing inline edit pattern.
g. "Add Exercise" button: opens `AddExerciseDialog`. Update the add exercise dialog to use the exercise catalog from EX-1 (search/select from `GET /api/training/exercises?search=...` instead of free-text name input).
h. All exercise edits use existing PATCH/POST/DELETE endpoints. **Important scope note:** If the session was cloned via duplicate-week, edits only affect this copy. If it was generated via AI (shared across weeks), edits affect all events sharing the same `training_session_id`. Show a toast: "Session updated across all weeks using this session." This makes the scope explicit.
i. On any edit success: call `onUpdate()` which triggers `mutate()`.

**11. Integration into right panel: modify `components/clients/training/builder/training-builder-right-panel.tsx`**

a. Change viewMode type from `"week" | "list"` to `"week" | "list" | "calendar"`.
b. Add a third button to the segmented control:
   ```tsx
   <button onClick={() => setViewMode("calendar")} className={cn(...)}>
     <CalendarRange className="h-3 w-3" />
     Calendar
   </button>
   ```
c. `viewMode === "calendar"` renders `<TrainingCalendarView>`.
d. Pass required props: `clientId`, `planId`, `plan`, `editMode`, `onUpdate`.

**12. Regeneration warning: modify `components/clients/training/builder/training-plan-helpers.tsx`**

Update `handleApply` in `EditModeButton`:
a. Before calling the regenerate endpoint, fetch `GET /api/clients/${clientId}/training/${planId}/events/modified-count`.
b. If count > 0: show `RegenerationWarningDialog`.
c. If count === 0: proceed with regeneration as normal.

Create `components/clients/training/calendar/regeneration-warning-dialog.tsx` (~70 lines):
a. Destructive confirm dialog.
b. Title: "Reset manually adjusted sessions?"
c. Body: "You have {count} manually adjusted sessions in the future. Regenerating will reset them to the template schedule."
d. Confirm: calls regenerate with `force: true`. Cancel: returns to edit mode.

**13. New plan generation protection: modify `components/clients/training/builder/training-plan-builder.tsx`**

Add confirmation dialog before opening the generator drawer when a plan exists:
a. Dialog text: "Generating a new plan will archive your current plan and delete all future scheduled sessions. This cannot be undone."
b. If modified events exist: add "You have X manually arranged sessions that will be lost."
c. Confirm opens the generator drawer. Cancel does nothing.

**14. Unit tests: add to `services/training-event-calendar-service.test.ts`**

Follow the pattern of `services/training-event-service.test.ts`.

Test `duplicateWeek`:
- Clones sessions and exercises for each event in the source week
- Preserves `exercise_id` FKs on cloned exercises
- Sets `is_modified = true` on new events
- Sets `day_of_week = null` on cloned sessions (calendar-placed, not template-driven)
- Skips non-scheduled events (completed, missed, skipped)
- Calculates correct target dates (source Monday to target Monday, etc.)

Test `duplicateWeekToRemaining`:
- Creates the correct number of target weeks between source and phase end
- Returns accurate `weeksCreated` and `eventsCreated` totals

After implementing, run `npx tsc --noEmit` and `npx vitest run`.
```

---

## Calorie Burn Model Change: Percentage-Based Surplus

**Problem:** The current system uses AI (GPT-4o-mini) to estimate absolute calorie burn per training session (e.g., "Push Day burns 350 cal"). This estimate is not personalized - it's the same whether the client is a 55kg woman or a 100kg man. The flat number is then added to baseline calories for training day nutrition targets.

**New model:** Replace absolute calorie burns with a coach-defined **training day surplus percentage** per session. The percentage scales with the client's individual baseline calories (which are already personalized via TDEE/goal calculations).

**How it works:**
- Coach sets a surplus percentage per session when building the plan (e.g., Push Day +15%, Leg Day +20%)
- Plan-level default percentage (e.g., 15%) applies to sessions without an override
- Rest day calories = baseline (from nutrition plan TDEE calculation)
- Training day calories = baseline * (1 + surplus_percentage / 100)
- Macros: protein stays fixed, the extra calories distribute to carbs and fats proportionally per diet type (uses existing `calculateDailyMacros()` function - just pass the boosted total instead of baseline + flat burn)
- The `include_activity_burn` client toggle controls whether the surplus is applied or ignored (same as before, just controls percentage application instead of flat burn addition)
- Free numeric input (not presets) - coach types any value (12%, 17.5%, etc.)

**What gets removed:**
- `estimated_calories` on `training_events` - no longer populated (column stays nullable, stops being written)
- `training_burn_calories` on `nutrition_events` - replaced by reading surplus % from the training session
- `external_burn_calories` on `nutrition_events` - external activities are client-specific, not part of library plans. External activity calories were also AI-estimated and suffer the same personalization problem. Remove from nutrition event generation.
- `estimateSessionCalories()` AI calls in `training-calorie-service.ts` - no longer called during plan creation
- `getTrainingSessionCaloriesByDay()`, `getEventCaloriesByDay()`, `calculateExternalActivityCalories()` - replaced by percentage lookup

**What stays:**
- `nutrition_events.baseline_calories` - unchanged
- `nutrition_events.is_training_day` - unchanged (derived from training events on that date)
- `include_activity_burn` client toggle - unchanged (controls whether surplus % is applied)
- `calculateDailyMacros(totalCalories, proteinG, isTrainingDay, dietType)` - unchanged, just receives boosted calories instead of baseline + burn

**Full consumer audit - files that change:**

| File | What changes |
|------|-------------|
| `services/nutrition-event-service.ts` | `generateNutritionEvents()`: replace burn sum with percentage lookup from training session. `updateNutritionEventTrainingBurn()`: remove (no longer needed) |
| `utils/nutrition-event-helpers.ts` | `getTotalCalories()`: `includeActivityBurn ? baseline * (1 + surplus/100) : baseline`. `mapNutritionEventToDisplayTarget()`: same logic, recalculate macros with boosted total |
| `utils/build-daily-targets.ts` | `buildDailyTargetsFromPlan()`: replace burn addition with percentage calculation |
| `utils/training-calorie-helpers.ts` | Remove `getTrainingSessionCaloriesByDay()`, `calculateWeeklyTrainingCalories()`, `getTrainingCaloriesByDay()`. Keep `getTrainingSessionsSummary()` (name-only, no calories) |
| `utils/training-event-helpers.ts` | Remove `getEventCaloriesByDay()` |
| `utils/nutrition-helpers.ts` | Remove `calculateExternalActivityCalories()`, `getExternalActivitiesForDay()`. Keep `getTrainingDays()`, `calculateDailyMacros()` |
| `services/daily-context-service.ts` | `getTodaysNutritionTarget()`: use percentage from training event's session. Remove external activity calorie lookups |
| `services/client-portal-service.ts` | `getClientNutritionTargets()`: pass surplus % instead of flat burns to `buildDailyTargetsFromPlan()` |
| `services/check-in-context-service.ts` | `getCheckInNutritionContext()`: use percentage from events |
| `services/training-plan-orchestrator.ts` | Remove `estimateSessionCalories()` calls. No AI calorie estimation on plan creation |
| `services/training-calorie-service.ts` | `estimateSessionCalories()` no longer called during plan creation. Keep file but mark functions as deprecated or remove |
| `app/api/client/training/completions/route.ts` | Remove `updateNutritionEventTrainingBurn()` call |
| `app/api/client/session-completions/route.ts` | Remove `updateNutritionEventTrainingBurn()` call |
| `components/daily-pulse/nutrition-target-display.tsx` | Display surplus % instead of flat calorie burn. "Training day: +15%" instead of "+350 cal" |
| `components/clients/nutrition/builder/nutrition-training-calories-display.tsx` | Show percentage surplus instead of absolute calorie breakdown |
| `hooks/use-nutrition-builder.ts` | `include_activity_burn` toggle stays but label changes to "Apply training day surplus" |
| `utils/nutrition-period-summary.ts` | `buildNutritionSummary()`: use percentage for unlogged day targets |
| `lib/validations/training.ts` | Update response schemas |
| `types/check-in.ts` | `NutritionEvent`: add `calorieSurplusPercentage`, keep `trainingBurnCalories`/`externalBurnCalories` as deprecated (read as 0 for new events) |
| `types/training.ts` | `TrainingSession`: add `calorieSurplusPercentage`. `TrainingEvent`: keep `estimatedCalories` nullable (stops being written) |

**Migration strategy:** New nutrition events use percentage model. Old events with flat burns still work - `getTotalCalories()` checks: if event has `calorie_surplus_percentage`, use it; otherwise fall back to legacy `baseline + burns`. This means no backfill needed.

**Where percentage is stored:**
- `coach_saved_sessions.calorie_surplus_percentage NUMERIC` - set by coach on preview page
- `coach_saved_plans.default_surplus_percentage NUMERIC DEFAULT 15` - plan-level default
- `training_sessions.calorie_surplus_percentage NUMERIC` - copied from saved session at placement time
- `nutrition_events.calorie_surplus_percentage NUMERIC` - snapshotted at event generation time (for historical accuracy)

This change is woven into LIB-1 (schema), LIB-2 (preview UI for setting percentages), and LIB-3 (placement generates nutrition events with percentage model).

---

## LIB-1: Library Backend + Calorie Surplus Schema + Single Event Deletion

**Goal:** Create the coach library tables with draft/saved lifecycle and calorie surplus percentage fields, build full CRUD service and API, implement single event deletion, and add the `calorie_surplus_percentage` column to `training_sessions` and `nutrition_events`.

### Design changes from original CAL-3a

- `coach_saved_plans` gains: `status` (draft/saved), `cycle_length`, `rest_pattern`, `source`, `coach_prompt`, `program_duration_weeks`
- `coach_saved_sessions` loses `day_offset` (replaced by `order_index` only), gains `is_rest` for rest day markers
- Plans are programs (ordered session sequences), not weekly schedules
- Saving a plan to library also saves each session as a standalone entry

### Claude Code prompt

```
Read IMPLEMENTATION-PLAN.md for full context (especially the "Library-first architecture" section), then read CONVENTIONS.md and docs/ARCHITECTURE.md.

This is LIB-1: Library Backend - Relational Tables + CRUD Service + Single Event Deletion.

**Read first:**
- `services/exercise-catalog-service.ts` - exercise resolution service from EX-1 (`resolveExercise`, `resolveExercises`)
- `services/training-session-service.ts` - `insertTrainingSessions()` pattern for creating sessions + exercises
- `services/training-mappers.ts` - `mapSessionRow()`, `mapExerciseRow()` for data shapes
- `services/training-event-calendar-service.ts` - existing calendar operations (move, duplicate, duplicateWeek) + `validatePhaseBounds()`
- `services/training-event-service.ts` - `deleteFutureEventsForPlan()` pattern for event deletion
- `services/nutrition-event-service.ts` - `regenerateFutureNutritionEvents()` for cascade pattern
- `types/training.ts` - `TrainingSession`, `TrainingExercise`, `Exercise`, `TrainingEvent` types
- `types/database.ts` - existing table type patterns
- `lib/database-helpers.ts` - type export pattern
- `services/supabase-admin.ts` - supabaseAdmin import
- `lib/auth-helpers.ts` - `getAuthenticatedCoachId()`
- `app/api/training/exercises/route.ts` - exercise catalog API from EX-1 (pattern reference for coach-level routes)
- `components/clients/training/calendar/training-calendar-view.tsx` - line 285-288, the TODO stub for event deletion

**1. Migration: `supabase/migrations/084_create_coach_library_tables.sql`**

```sql
-- Coach's library of reusable training plans and sessions.
-- Plans are ordered session sequences (programs) with cycle-aware placement.
-- Sessions can belong to a plan or exist independently for mix-and-match use.
-- Exercises reference the master exercises catalog (EX-1).

CREATE TABLE coach_saved_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id UUID NOT NULL REFERENCES coaches(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  split_type TEXT,
  frequency_per_week INTEGER,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'saved')),
  cycle_length INTEGER,
  rest_pattern INTEGER[] DEFAULT '{}',
  default_surplus_percentage NUMERIC DEFAULT 15,
  source TEXT DEFAULT 'manual',
  coach_prompt TEXT,
  program_duration_weeks INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_coach_saved_plans_coach ON coach_saved_plans(coach_id);
CREATE INDEX idx_coach_saved_plans_coach_status ON coach_saved_plans(coach_id, status);

CREATE TABLE coach_saved_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id UUID NOT NULL REFERENCES coaches(id) ON DELETE CASCADE,
  saved_plan_id UUID REFERENCES coach_saved_plans(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  focus TEXT,
  order_index INTEGER NOT NULL DEFAULT 0,
  is_rest BOOLEAN DEFAULT false,
  estimated_duration_minutes INTEGER,
  calorie_surplus_percentage NUMERIC,
  notes TEXT,
  session_type TEXT NOT NULL DEFAULT 'training',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_coach_saved_sessions_coach ON coach_saved_sessions(coach_id);
CREATE INDEX idx_coach_saved_sessions_plan ON coach_saved_sessions(saved_plan_id);

CREATE TABLE coach_saved_exercises (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  saved_session_id UUID NOT NULL REFERENCES coach_saved_sessions(id) ON DELETE CASCADE,
  exercise_id UUID REFERENCES exercises(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  order_index INTEGER NOT NULL DEFAULT 0,
  sets INTEGER NOT NULL DEFAULT 3,
  reps_min INTEGER,
  reps_max INTEGER,
  reps_target TEXT,
  rpe_target NUMERIC,
  percentage_1rm NUMERIC,
  tempo TEXT,
  rest_seconds INTEGER,
  superset_group TEXT,
  is_warmup BOOLEAN DEFAULT false,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_coach_saved_exercises_session ON coach_saved_exercises(saved_session_id);
CREATE INDEX idx_coach_saved_exercises_exercise ON coach_saved_exercises(exercise_id);

-- Add provenance FK to training_plans (tracks which library plan was placed)
ALTER TABLE training_plans ADD COLUMN saved_plan_id UUID REFERENCES coach_saved_plans(id) ON DELETE SET NULL;

-- Add calorie surplus percentage to existing training tables
ALTER TABLE training_sessions ADD COLUMN calorie_surplus_percentage NUMERIC;
ALTER TABLE nutrition_events ADD COLUMN calorie_surplus_percentage NUMERIC;
```

Key design: `status = 'draft'` for AI/manual generation drafts (not shown in library list), `status = 'saved'` for permanent library entries. `cycle_length` + `rest_pattern` enable non-weekly placement (e.g., PPL+Rest = cycle_length 4, rest_pattern {3}). `order_index` on sessions determines position within the cycle. `is_rest` marks rest day slots. `coach_saved_exercises.name` is denormalized from `exercises.name` for display without joins. `default_surplus_percentage` on plans provides the plan-level default; `calorie_surplus_percentage` on sessions allows per-session override (null = use plan default). `estimated_calories` is removed from saved sessions (replaced by surplus %). Existing `training_sessions` and `nutrition_events` gain the new column for the percentage model.

**2. Update types**

**`types/database.ts`** - Add Row/Insert/Update types for all three new tables. Add `saved_plan_id: string | null` to `training_plans` Row/Insert/Update. Add `calorie_surplus_percentage: number | null` to `training_sessions` and `nutrition_events` Row/Insert/Update types.

**`types/training.ts`** - Add `calorieSurplusPercentage: number | null` to the existing `TrainingSession` type. Add to existing `TrainingEvent` type (stops being populated but stays on type for backward compat). Add new types:

```typescript
export type SavedPlanStatus = 'draft' | 'saved';

export type SavedPlan = {
  id: string;
  coachId: string;
  name: string;
  description: string | null;
  splitType: string | null;
  frequencyPerWeek: number | null;
  status: SavedPlanStatus;
  cycleLength: number | null;
  restPattern: number[];
  defaultSurplusPercentage: number | null;
  source: string;
  coachPrompt: string | null;
  programDurationWeeks: number | null;
  sessions: SavedSession[];
  createdAt: string;
  updatedAt: string;
};

export type SavedSession = {
  id: string;
  coachId: string;
  savedPlanId: string | null;
  name: string;
  focus: string | null;
  orderIndex: number;
  isRest: boolean;
  estimatedDurationMinutes: number | null;
  calorieSurplusPercentage: number | null;
  notes: string | null;
  sessionType: string;
  exercises: SavedExercise[];
  createdAt: string;
  updatedAt: string;
};

// Update existing NutritionEvent type in types/check-in.ts:
// Add: calorieSurplusPercentage: number | null;
// Keep trainingBurnCalories/externalBurnCalories for backward compat (read as 0 for new events)

export type SavedExercise = {
  id: string;
  savedSessionId: string;
  exerciseId: string | null;
  name: string;
  orderIndex: number;
  sets: number;
  repsMin: number | null;
  repsMax: number | null;
  repsTarget: string | null;
  rpeTarget: number | null;
  percentage1rm: number | null;
  tempo: string | null;
  restSeconds: number | null;
  supersetGroup: string | null;
  isWarmup: boolean;
  notes: string | null;
  createdAt: string;
};
```

**`lib/database-helpers.ts`** - Add type exports for all three tables.

**3. Service: `services/coach-library-service.ts` (~300 lines)**

All functions use `supabaseAdmin` (system-level writes for library operations).

```typescript
export async function createSavedPlanFromAI(
  coachId: string,
  aiPlan: AIGeneratedPlan,
  coachPrompt: string
): Promise<string>
```

Implementation:
a. Auto-detect cycle_length and rest_pattern from AI output:
   - If sessions have `dayOfWeek` assigned: `cycle_length = 7`, `rest_pattern` = unassigned day positions
   - If sessions lack `dayOfWeek`: `cycle_length = sessions.length + inferred rest days` based on `frequencyPerWeek`
b. Insert `coach_saved_plans` row with `status = 'draft'`, `source = 'ai'`, `coach_prompt`, `program_duration_weeks`, detected `cycle_length` and `rest_pattern`
c. Resolve all exercise names to catalog IDs via `resolveExercises()`
d. For each AI session: insert `coach_saved_sessions` row with `order_index` based on position
e. For each exercise: insert `coach_saved_exercises` row with all prescription fields + `exercise_id`
f. Return new saved plan ID

```typescript
export async function createSavedPlanManual(
  coachId: string,
  name: string,
  splitType: string,
  sessions: ManualSessionDraft[]
): Promise<string>
```

Same pattern as AI, but `source = 'manual'`, `status = 'draft'`.

```typescript
export async function promoteDraftToSaved(
  planId: string,
  coachId: string,
  options: { saveSessionsIndividually: boolean }
): Promise<{ nameConflict?: string }>
```

Implementation:
a. Verify ownership
b. Name conflict check: query `coach_saved_plans` and `coach_saved_sessions` for this coach where `name` matches (case-insensitive). If conflict found, return `{ nameConflict: "A session or plan with this name already exists" }` without promoting. The UI shows the conflict and lets the coach rename.
c. Update `status = 'saved'`
d. If `saveSessionsIndividually === true`: for each non-rest session in the plan, check for name conflicts against existing standalone sessions, then create a standalone copy with `saved_plan_id = NULL`. Skip sessions whose names already exist as standalone entries for this coach (deduplication).

```typescript
export async function createStandaloneSession(
  coachId: string,
  data: { name: string; focus?: string; exercises: Array<{ name: string; sets: number; repsTarget?: string; rpeTarget?: number; restSeconds?: number; notes?: string }> }
): Promise<string>
```

Creates a session from scratch in the library (`saved_plan_id = NULL`). Resolves exercise names to catalog IDs.

```typescript
export async function getSavedPlans(coachId: string): Promise<SavedPlan[]>
```

Filters to `status = 'saved'` only. Three-level join. Order by `created_at DESC`.

```typescript
export async function getStandaloneSessions(coachId: string): Promise<SavedSession[]>
```

Fetches sessions where `saved_plan_id IS NULL`. Includes exercises. Order by `created_at DESC`.

Additional CRUD functions (standard patterns):
- `getSavedPlanById(planId, coachId)` - single plan with sessions/exercises, IDOR check
- `updateSavedPlan(planId, coachId, updates)` - update plan metadata
- `deleteSavedPlan(planId, coachId)` - CASCADE deletes children
- `addSavedSession(planId, coachId, session)` - add session to plan
- `updateSavedSession(sessionId, coachId, updates)` - update session
- `removeSavedSession(sessionId, coachId)` - delete session
- `reorderSavedSessions(planId, coachId, order)` - bulk reorder
- `addSavedExercise(sessionId, coachId, exercise)` - add exercise, resolves catalog ID
- `updateSavedExercise(exerciseId, coachId, updates)` - update exercise
- `removeSavedExercise(exerciseId, coachId)` - delete exercise
- `savePlanFromCalendar(coachId, clientId, planId, weekStartDate, name)` - save from calendar as `status = 'saved'`
- `saveSessionFromCalendar(coachId, sourceSessionId, name)` - save single session from calendar

**4. Library API routes (all coach-level, under `/api/training/`)**

All follow standard middleware: `coachApiRateLimit` -> `requireCSRFProtection` (mutating) -> `getAuthenticatedCoachId` -> IDOR via `coach_id`.

- `GET/POST /api/training/saved-plans/route.ts` - list saved plans + create from source
- `GET/PATCH/DELETE /api/training/saved-plans/[savedPlanId]/route.ts` - single plan CRUD
- `POST /api/training/saved-plans/[savedPlanId]/promote/route.ts` - promote draft to saved
- `POST /api/training/saved-plans/[savedPlanId]/sessions/route.ts` - add session
- `PATCH/DELETE /api/training/saved-plans/[savedPlanId]/sessions/[sessionId]/route.ts` - session CRUD
- `POST /api/training/saved-plans/[savedPlanId]/sessions/[sessionId]/exercises/route.ts` - add exercise
- `PATCH/DELETE /api/training/saved-plans/[savedPlanId]/sessions/[sessionId]/exercises/[exerciseId]/route.ts` - exercise CRUD
- `PATCH /api/training/saved-plans/[savedPlanId]/sessions/reorder/route.ts` - bulk reorder
- `GET/POST /api/training/saved-sessions/route.ts` - list standalone sessions + create from scratch
- `GET/PATCH/DELETE /api/training/saved-sessions/[savedSessionId]/route.ts` - standalone session CRUD

**5. Single event deletion - `services/training-event-calendar-service.ts` ADD `deleteEvent()`**

```typescript
export async function deleteEvent(eventId: string, clientId: string, planId: string): Promise<void>
```

Implementation:
a. Fetch event, validate ownership (client_id, training_plan_id)
b. Validate: `status = 'scheduled'` and `date >= today` (cannot delete past or completed events)
c. Hard delete the `training_events` row
d. Cascade: `regenerateFutureNutritionEvents()` for affected nutrition plans (training burn removed for that date)

**6. Delete event API: `DELETE /api/clients/[id]/training/[planId]/events/[eventId]/route.ts`**

Standard middleware: `coachApiRateLimit` -> `requireCSRFProtection` -> `getAuthenticatedCoachId` -> IDOR (client belongs to coach, plan belongs to client) -> call `deleteEvent()`.

**7. Wire delete UI: modify `components/clients/training/calendar/training-calendar-view.tsx`**

Replace the TODO stub at line 285-288 with: confirmation dialog ("Delete {sessionName} on {date}?") -> DELETE API call -> `mutate()` on success -> toast "Session removed".

**8. Unit tests: `services/coach-library-service.test.ts`**

Follow the pattern of `services/training-event-service.test.ts`.

Test `createSavedPlanFromAI`:
- Creates plan with `status = 'draft'`, `source = 'ai'`, correct cycle_length detection
- Resolves exercise names to catalog IDs
- Creates sessions with correct order_index

Test `promoteDraftToSaved`:
- Updates status to 'saved'
- Returns nameConflict if plan name already exists for this coach
- When `saveSessionsIndividually = true`: creates standalone copies of each non-rest session
- When `saveSessionsIndividually = false`: does not create standalone copies
- Deduplicates: skips standalone session creation if a session with that name already exists for this coach

Test `createStandaloneSession`:
- Creates session with `saved_plan_id = NULL`
- Resolves exercise names to catalog IDs

Test `getSavedPlans`:
- Filters to `status = 'saved'` only (excludes drafts)
- Returns nested sessions and exercises

Test `deleteEvent` (in calendar service test file):
- Validates ownership before deleting
- Only deletes future scheduled events
- Rejects past or completed events

After implementing, run `npx tsc --noEmit` and `npx vitest run`.
```

---

## LIB-2: Preview UI + Generation Redirect + Calorie Surplus Model

**Goal:** Build the library list page and plan preview drawer (on client page). Redirect AI and manual generation to create drafts in the library. Update the AI prompt to not assign `dayOfWeek`. Build the calorie surplus percentage UI on session cards. Implement all breaking changes from the orchestrator return type change. Update all nutrition consumers to use percentage model instead of flat burns.

### Claude Code prompt

```
Read IMPLEMENTATION-PLAN.md for full context (especially "Library-first architecture" and "Calorie Burn Model Change" sections), then read CONVENTIONS.md and docs/ARCHITECTURE.md.

This is LIB-2: Preview UI + Generation Redirect + Calorie Surplus Model.

**Read first:**
- `services/coach-library-service.ts` - all CRUD functions from LIB-1
- `services/training-plan-orchestrator.ts` - current `orchestrateTrainingPlanCreation()` (will be changed)
- `services/training-ai-service.ts` - `generateTrainingPlanAI()`, `TRAINING_PLAN_SYSTEM_PROMPT`, `AIGeneratedPlan` type
- `services/training-calorie-service.ts` - `estimateSessionCalories()` AI calorie estimation (being removed)
- `services/nutrition-event-service.ts` - `generateNutritionEvents()`, `updateNutritionEventTrainingBurn()` (consumers of burn data)
- `services/daily-context-service.ts` - `getTodaysNutritionTarget()`, `getPlanTargetForDate()` (burn consumers)
- `services/client-portal-service.ts` - `getClientNutritionTargets()` (burn consumer)
- `services/check-in-context-service.ts` - `getCheckInNutritionContext()` (burn consumer)
- `utils/nutrition-event-helpers.ts` - `getTotalCalories()`, `mapNutritionEventToDisplayTarget()` (burn consumers)
- `utils/build-daily-targets.ts` - `buildDailyTargetsFromPlan()` (burn consumer)
- `utils/training-calorie-helpers.ts` - `getTrainingSessionCaloriesByDay()`, `calculateWeeklyTrainingCalories()` (being removed)
- `utils/training-event-helpers.ts` - `getEventCaloriesByDay()` (being removed)
- `utils/nutrition-helpers.ts` - `calculateExternalActivityCalories()`, `getExternalActivitiesForDay()` (being removed), `calculateDailyMacros()` (stays)
- `utils/nutrition-period-summary.ts` - `buildNutritionSummary()` (burn consumer)
- `app/api/clients/[id]/training/route.ts` - AI plan creation POST handler
- `app/api/clients/[id]/training/manual/route.ts` - manual plan creation POST handler
- `app/api/client/training/completions/route.ts` - calls `updateNutritionEventTrainingBurn()` (being removed)
- `app/api/client/session-completions/route.ts` - same
- `hooks/use-training-plan.ts` - `generate()` function (breaking change)
- `hooks/use-manual-sessions.ts` - `saveManualPlan()` function (breaking change)
- `lib/validations/training.ts` - `generateTrainingPlanApiResponseSchema`, `parseSaveManualResponse` (breaking change)
- `components/clients/training/builder/training-plan-generator-drawer.tsx` - auto-close logic (breaking change)
- `components/clients/training/builder/drawer-footer.tsx` - generation trigger
- `components/clients/training/builder/training-builder-right-panel.tsx` - plan display
- `components/daily-pulse/nutrition-target-display.tsx` - calorie display with burns
- `components/clients/nutrition/builder/nutrition-training-calories-display.tsx` - burn toggle + display
- `hooks/use-nutrition-builder.ts` - `include_activity_burn` toggle
- `types/training.ts` - SavedPlan, SavedSession types from LIB-1
- `types/check-in.ts` - NutritionEvent type

**1. Modify AI system prompt: `services/training-ai-service.ts`**

Update `TRAINING_PLAN_SYSTEM_PROMPT` to explicitly instruct AI NOT to assign `dayOfWeek` on sessions:
- Change: `"dayOfWeek": "monday" | "tuesday" | etc. (optional)` to `"dayOfWeek": null (do NOT assign - the coach decides placement dates)`
- The coach picks which calendar dates sessions land on at placement time. AI generates an ordered sequence of sessions, not a weekly schedule.

**2. Modify orchestrator: `services/training-plan-orchestrator.ts`**

Rename `orchestrateTrainingPlanCreation()` to `orchestrateTrainingPlanGeneration()`. Change it to:
a. Gather client context (metrics, goals, check-ins) - same as today
b. Call AI service (`generateTrainingPlanAI()`) - same as today
c. Call `createSavedPlanFromAI(coachId, aiPlan, coachPrompt)` instead of creating client-side records
d. Return `{ success: true, savedPlanId }` instead of `{ plan }`
e. Remove: `createTrainingPlanAtomic`, `insertTrainingSessions`, `addExternalActivity`, `estimateSessionCalories`, `saveTrainingPlanHistory`, event generation, nutrition cascade - all moves to placement (LIB-3)
f. Remove the `estimateSessionCalories()` AI calls entirely - calorie burns are now percentage-based, set by the coach on the preview page

**3. Modify AI plan route: `app/api/clients/[id]/training/route.ts` POST handler**

Update to call `orchestrateTrainingPlanGeneration()`. Return `{ success: true, savedPlanId }` instead of `{ plan }`.

**4. Modify manual route: `app/api/clients/[id]/training/manual/route.ts`**

Call `createSavedPlanManual()` instead of `createTrainingPlanAtomic` + `insertTrainingSessions`. Return `{ success: true, savedPlanId }`.

**5. Breaking change chain - ALL files that must update for the new response format:**

The response changes from `{ success: true, plan: TrainingPlan }` to `{ success: true, savedPlanId: string }`. This breaks:

a. **`lib/validations/training.ts`** - Update `generateTrainingPlanApiResponseSchema` and `saveManualPlanApiResponseSchema` to accept `{ savedPlanId: string }` instead of `{ plan: TrainingPlan }`. Update `parseGeneratePlanResponse()` and `parseSaveManualResponse()` parse functions.

b. **`hooks/use-training-plan.ts`** - `generate()` function: on success, instead of `setPlan(data.plan)` + `fetchPlan()`, set a `draftSavedPlanId` state and open the preview drawer. Remove `data.plan.name` access for toast. New toast: "Plan draft created".

c. **`hooks/use-manual-sessions.ts`** - `saveManualPlan()`: same pattern - set `draftSavedPlanId` state, open preview drawer.

d. **`components/clients/training/builder/training-plan-generator-drawer.tsx`** - Auto-close logic (lines 34-40) watches `builder.plan?.id` changing to detect success. This no longer works because `setPlan()` is not called. Change auto-close to watch `builder.draftSavedPlanId` - when it becomes non-null, close the generator drawer and open the preview drawer.

e. **`components/clients/training/builder/training-builder-right-panel.tsx`** - The existing plan display (`builder.plan`) continues to show the currently active client plan (if one exists). The draft preview is shown in a separate drawer, not in this panel. No change needed here for the response format change.

f. **`components/clients/training/builder/drawer-footer.tsx`** - Success handling stays the same (it calls `builder.generate()` and checks the boolean return). No change needed.

**6. Preview drawer (on client page, NOT a separate page)**

The preview lives as a full-width Sheet/drawer on the client's training page, not a standalone route. The coach stays on `/clients/[id]?tab=training` throughout.

Create `components/clients/training/builder/plan-preview-drawer.tsx` (~250 lines):
a. Props: `{ open, onOpenChange, savedPlanId, clientId, onApply }`
b. Fetches plan via `useSavedPlan(savedPlanId)`
c. Full-width Sheet (side="right", width: 100% or 80%)
d. **Top bar:** plan name (editable inline), split type badge, cycle length display with edit override, default surplus percentage (editable)
e. **Action buttons:** "Save to Library" (with name conflict check + "Also save sessions individually?" checkbox), "Discard" (deletes draft), "Apply to Client" (placement dialog - LIB-3, disabled placeholder for now)
f. **Main content:** vertically stacked session cards in `order_index` order. Rest day markers between sessions. Each card shows:
   - Session name (editable), focus (editable)
   - **Calorie surplus: free numeric input** showing "Training day surplus: __%" (defaults to plan's `default_surplus_percentage`, overridable per session)
   - Exercise list with full prescription fields (reuse `TrainingExerciseRow` pattern)
   - "Add Exercise" button -> `AddExerciseDialog` with catalog autocomplete
g. "Add Session" and "Add Rest Day" buttons at bottom
h. Session cards draggable for reorder (dnd-kit sortable)
i. All edits auto-save via PATCH endpoints

**7. Library list page: `app/dashboard/training-library/page.tsx` (~200 lines)**

Coach-level page for browsing and managing saved plans/sessions.

Two tabs: **Plans** and **Sessions**.

**Plans tab:** Grid of saved plan cards (fetched via `useSavedPlans()`, filters `status = 'saved'`). Each card: name, split type badge, session count, cycle length, source badge, created date. Click opens plan in a preview drawer (same component as step 6, but with a client selector in the "Apply" dialog). Delete with confirmation.

**Sessions tab:** Grid of standalone session cards. Each card: name, focus, exercise count, created date. "New Session" button opens creation dialog (name, focus, add exercises via catalog autocomplete). Click to edit. Delete with confirmation.

The workout builder (AI prompt + manual builder from `training-plan-generator-drawer.tsx`) should be reusable from this page too - a "Generate Plan" button opens the same builder but without client context (or with an optional client selector for AI personalization).

**8. New hooks:**

`hooks/use-saved-plan.ts` (~60 lines): SWR fetch single saved plan with sessions/exercises. Config: `revalidateOnFocus: false`.

`hooks/use-saved-plans.ts` (~40 lines): SWR fetch list of saved plans (`status = 'saved'`). Config: `revalidateOnFocus: false`.

**9. Calorie surplus model - update all nutrition consumers:**

The percentage model replaces flat calorie burns. For each file:

a. **`utils/nutrition-event-helpers.ts`** - `getTotalCalories()`: change from `baseline + trainingBurn + externalBurn` to:
   - If event has `calorie_surplus_percentage` (new model): `includeActivityBurn ? baseline * (1 + surplusPercentage/100) : baseline`
   - If event has legacy burn fields (old events): fall back to `baseline + burns` for backward compat
   `mapNutritionEventToDisplayTarget()`: same logic. When surplus is applied, recalculate macros via `calculateDailyMacros(boostedTotal, proteinG, isTrainingDay, dietType)` - protein stays fixed, extra calories go to carbs/fats per diet type.

b. **`services/nutrition-event-service.ts`** - `generateNutritionEvents()`: instead of summing `event.estimatedCalories` for `training_burn_calories`, look up the training session's `calorie_surplus_percentage` and store it on the nutrition event. Set `training_burn_calories = 0` and `external_burn_calories = 0` on new events (deprecated fields).
   Remove `updateNutritionEventTrainingBurn()` function entirely (no longer called on session completion).

c. **`utils/build-daily-targets.ts`** - `buildDailyTargetsFromPlan()`: replace burn addition with surplus percentage. When `includeActivityBurn` is true and a training event exists for that day, compute `calories = baseline * (1 + surplusPercentage/100)`. Remove calls to `getTrainingSessionCaloriesByDay()`, `getEventCaloriesByDay()`, `calculateExternalActivityCalories()`, `getExternalActivitiesForDay()`.

d. **`services/daily-context-service.ts`** - `getTodaysNutritionTarget()` and `getPlanTargetForDate()`: use percentage from nutrition event. Remove external activity calorie lookups. The template fallback (`getPlanTargetForDateFromTemplate`) should also use percentage if available on the session.

e. **`services/client-portal-service.ts`** - `getClientNutritionTargets()`: pass surplus percentages to `buildDailyTargetsFromPlan()` instead of flat burns.

f. **`services/check-in-context-service.ts`** - `getCheckInNutritionContext()`: use percentage from events.

g. **`utils/nutrition-period-summary.ts`** - `buildNutritionSummary()`: for unlogged days with events, use percentage model.

h. **`app/api/client/training/completions/route.ts`** - Remove call to `updateNutritionEventTrainingBurn()`.

i. **`app/api/client/session-completions/route.ts`** - Remove call to `updateNutritionEventTrainingBurn()`.

j. **`components/daily-pulse/nutrition-target-display.tsx`** - Display "Training day: +X%" instead of "+350 cal". When `includeActivityBurn` is off, show baseline only.

k. **`components/clients/nutrition/builder/nutrition-training-calories-display.tsx`** - Show percentage surplus per day instead of absolute calorie breakdown. Toggle label changes from "Add activity burn to calorie targets" to "Apply training day surplus".

l. **`hooks/use-nutrition-builder.ts`** - `include_activity_burn` toggle stays, label/description update.

**10. Remove dead code:**

After all consumers updated, grep to verify no remaining callers then remove:
- `estimateSessionCalories()` from `services/training-calorie-service.ts` (or the entire file if nothing else uses it)
- `getTrainingSessionCaloriesByDay()`, `calculateWeeklyTrainingCalories()`, `getTrainingCaloriesByDay()` from `utils/training-calorie-helpers.ts`
- `getEventCaloriesByDay()` from `utils/training-event-helpers.ts`
- `calculateExternalActivityCalories()`, `getExternalActivitiesForDay()`, `getWeeklyNutritionTargets()` from `utils/nutrition-helpers.ts`
- `updateNutritionEventTrainingBurn()` from `services/nutrition-event-service.ts`
- Keep: `getTrainingDays()`, `calculateDailyMacros()`, `getTrainingSessionsSummary()` (name-only, used for display)
- Grep each function before deleting to verify no remaining callers. `getWeeklyNutritionTargets()` may have been partially removed in NE-3 - verify.

After implementing, run `npx tsc --noEmit` and `npx vitest run`.
```

---

## LIB-3: Placement + Calendar Integration

**Goal:** Build the cycle-aware placement service with percentage-based nutrition cascade, the "Apply to Client" dialog on the preview drawer, the calendar library panel for drag-to-place, and save-from-calendar functionality. Handle atomic plan archival, partial cycle truncation at phase boundaries, and external activities as client-level concerns (not library).

### Claude Code prompt

```
Read IMPLEMENTATION-PLAN.md for full context (especially the "Library-first architecture" section), then read CONVENTIONS.md and docs/ARCHITECTURE.md.

This is LIB-3: Placement + Calendar Integration.

**Read first:**
- `services/coach-library-service.ts` - all CRUD functions from LIB-1
- `services/training-event-calendar-service.ts` - existing calendar operations (move, duplicate, duplicateWeek, deleteEvent)
- `services/training-event-service.ts` - `generateTrainingEvents()`, `deleteFutureEventsForPlan()`, `regenerateFutureEvents()`
- `services/training-session-service.ts` - `insertTrainingSessions()` for creating client sessions
- `services/nutrition-event-service.ts` - `regenerateFutureNutritionEvents()` for cascade
- `services/exercise-catalog-service.ts` - exercise resolution from EX-1
- `app/api/clients/[id]/training/[planId]/events/duplicate-week/route.ts` - duplicate-week route (nutrition cascade pattern)
- `app/dashboard/training-library/[savedPlanId]/page.tsx` - preview page from LIB-2 (wire "Apply to Client" button)
- `components/clients/training/calendar/training-calendar-view.tsx` - calendar grid from CAL-2
- `components/clients/training/calendar/calendar-day-cell.tsx` - day cell from CAL-2
- `components/clients/training/calendar/session-detail-drawer.tsx` - session drawer from CAL-2
- `hooks/use-calendar-events.ts` - calendar data hook from CAL-2
- `hooks/use-calendar-dnd.ts` - calendar DnD hook from CAL-2
- `components/ui/sheet.tsx` - Sheet component for panel
- `types/training.ts` - SavedPlan, SavedSession types
- `lib/require-phase-selection.ts` - `requirePhaseSelection()` for phase-aware placement
- `lib/date-helpers.ts` - date utilities

**1. Placement service: `services/library-placement-service.ts` (~200 lines)**

```typescript
export async function placePlanOnCalendar(params: {
  savedPlanId: string;
  coachId: string;
  clientId: string;
  startDate: string;
  repeatCycles?: number;
  phaseId?: string;
}): Promise<{ planId: string; sessionsCreated: number; eventsCreated: number }>
```

Implementation:
a. Fetch saved plan with sessions and exercises
b. IDOR check on coach_id
c. Verify client belongs to coach
d. **Atomic plan archival:** Use `createTrainingPlanAtomic` RPC (or a new `place_plan_from_library_atomic` RPC) to archive the existing active plan and create the new one in a single transaction. Set `effective_until = startDate - 1` on the old plan, `effective_from = startDate` on the new one. This preserves the historical date range for queries like "what plan was active on date X?"
e. Create `training_plans` row: `status = 'active'`, `effective_from = startDate`, copy metadata from saved plan, set `saved_plan_id` FK, `phase_id` if provided
f. For each non-rest session in order_index order: create `training_sessions` row with `plan_id`, `day_of_week = NULL`, copy `calorie_surplus_percentage` from saved session (or plan's `default_surplus_percentage` if session override is null). Create `training_exercises` rows copying all fields including `exercise_id`
g. Generate cycle-aware events: iterate from `startDate`, walk through cycle positions 0..cycle_length-1. If position is in `rest_pattern`, skip. Otherwise create `training_event` for the corresponding session on that date. `is_modified = false`, `status = 'scheduled'`. **Partial cycle truncation:** if a session's date exceeds the end date (phase boundary), skip it - don't generate events outside the phase. This means the last cycle may be incomplete.
h. Calculate end date: phase `end_date` (hard boundary), or `program_duration_weeks * 7`, or `repeatCycles * cycle_length`, or 8-week fallback. Phase `end_date` always wins if set.
i. **Nutrition cascade with percentage model:** `regenerateFutureNutritionEvents()` for active/planned nutrition plans. The regeneration reads `calorie_surplus_percentage` from `training_sessions` (via the `training_event.training_session_id` join) and stores it on `nutrition_events.calorie_surplus_percentage`. Sets `training_burn_calories = 0`, `external_burn_calories = 0` (deprecated fields).
j. **External activities are client-level, not library-level.** External activities (BJJ, cycling, etc.) are NOT part of the saved plan. They remain on the client's existing plan/profile. Nutrition event generation reads external activities from the client's data, not the library template. Since external activity calorie estimation has the same personalization problem as training burns, external burns are also excluded from the percentage model - the `include_activity_burn` toggle now only controls the training day surplus percentage.
k. Return counts

```typescript
export async function placeSessionOnCalendar(params: {
  savedSessionId: string;
  coachId: string;
  clientId: string;
  planId: string;
  targetDate: string;
}): Promise<{ sessionId: string; eventId: string }>
```

Implementation: same as original CAL-3b spec - creates fresh session + exercises + event for a single date. `is_modified = true`. Cascades nutrition.

**2. Placement API: `POST /api/clients/[id]/training/place-from-library/route.ts`**

Standard middleware: `coachApiRateLimit` -> `requireCSRFProtection` -> `getAuthenticatedCoachId` -> IDOR -> Zod validation.

Zod schema:
```typescript
const placeFromLibrarySchema = z.object({
  type: z.enum(["plan", "session"]),
  savedPlanId: z.string().uuid().optional(),
  savedSessionId: z.string().uuid().optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  repeatCycles: z.number().int().positive().optional(),
  phaseId: z.string().uuid().optional(),
  planId: z.string().uuid().optional(),
});
```

If `type === "plan"`: call `placePlanOnCalendar()`.
If `type === "session"`: call `placeSessionOnCalendar()` (requires `planId` for existing client plan).

Return `{ success: true, planId?, sessionsCreated, eventsCreated }`.

**3. "Apply to Client" dialog**

Two entry points for the Apply dialog:

a. **From client page preview drawer** (`plan-preview-drawer.tsx`): Coach generated a plan for this client. "Apply" pre-selects the current client. Dialog fields: start date picker, cycle info display ("PPL+Rest, 4-day cycle - will create events for 8 weeks"), optional phase selection (if client has active roadmap), repeat cycles override. On success: close preview drawer, refresh calendar view.

b. **From library list page** (`/dashboard/training-library/`): Coach is browsing saved plans and wants to apply to any client. Dialog adds a client selector (search/dropdown) before the start date picker. On success: navigate to `/clients/[clientId]?tab=training`.

Create `components/training-library/apply-to-client-dialog.tsx` (~150 lines). Props include optional `preselectedClientId` to handle both entry points.

**4. Save-from-calendar: `POST /api/training/saved-plans/from-calendar/route.ts`**

POST handler: `coachApiRateLimit` -> `requireCSRFProtection` -> `getAuthenticatedCoachId` -> validate body `{ clientId, planId, weekStartDate, name, description? }`.

Calls `savePlanFromCalendar()` from library service. Returns `{ success: true, savedPlanId }`.

**5. Save-from-calendar UI: modify calendar components**

`training-calendar-view.tsx` - add "Save as plan" to week dropdown menu. Opens dialog with name/description fields. On submit: POST to from-calendar endpoint. Toast on success.

`session-detail-drawer.tsx` - add "Save to Library" button in drawer header. Opens name dialog. On submit: POST to saved-sessions endpoint with `{ sourceSessionId, name }`. Toast on success.

**6. Library panel: `components/clients/training/calendar/library-panel.tsx` (~200 lines)**

Left-side Sheet alongside the calendar for drag-to-place.

a. Toggle button on calendar toolbar: "Library" icon
b. Two tabs: "Plans" and "Sessions" (fetches saved plans + standalone sessions)
c. Search input for client-side filtering
d. **Drag from library**: each card uses `useDraggable` from dnd-kit with data payload `{ type: "library-plan" | "library-session", id }`
e. **Drop onto calendar**: extend `CalendarDayCell` to accept library drops. Session drop: POST place-from-library with `type: "session"`. Plan drop: POST with `type: "plan"`, `startDate = cell date`
f. Visual feedback during drag

**7. Extend calendar DnD: modify `hooks/use-calendar-dnd.ts`**

Add `handleLibraryDrop` callback that detects library item drops (check `active.data.current.type`). Calls placement API instead of move API. `mutate()` on success.

**8. Unit tests: `services/library-placement-service.test.ts`**

Test `placePlanOnCalendar`:
- Creates training_plan with correct metadata and saved_plan_id FK
- Clones sessions with `day_of_week = null` and `calorie_surplus_percentage` copied from saved session
- Clones exercises with `exercise_id` FK preserved
- Generates cycle-aware events (respects rest_pattern, correct dates)
- Truncates partial cycle at phase boundary (e.g., 30-day phase with 4-day cycle stops at day 28+partial)
- Archives existing active plan atomically (effective_until set correctly)
- Cascades nutrition events with percentage model (calorie_surplus_percentage on nutrition events)

Test `placeSessionOnCalendar`:
- Creates session, exercises, event for single date
- Copies `calorie_surplus_percentage` from saved session
- Sets `is_modified = true` on event
- Returns correct IDs

After implementing, run `npx tsc --noEmit` and `npx vitest run`.
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
| 4 | **NE-1** | Create `nutrition_events` table + event service + fix effective_from RPC bug (DONE) |
| 5 | **NE-2** | Wire nutrition events into plan lifecycle + training cascade + keep-calories + backfill (DONE) |
| 6 | **EX-1** | Exercise catalog: master `exercises` table + resolution service + wire into insertion paths (DONE) |
| 7 | **CAL-1** | Calendar backend: `is_modified` migration + move/duplicate service + API endpoints (DONE) |
| 8 | **CAL-2** | Calendar UI: multi-week phase grid + drag/move + duplicate week + session detail drawer (DONE) |
| 9 | **NE-3** | Switch all nutrition consumers to events, delete template estimation code (DONE) |
| 10 | **LIB-1** | Library backend: relational tables (draft/saved, cycle-aware, surplus %), CRUD service, API, single event deletion |
| 11 | **LIB-2** | Preview drawer + generation redirect + calorie surplus model: preview UI, AI prompt update, orchestrator change, all nutrition consumer updates for % model, dead code removal |
| 12 | **LIB-3** | Placement + calendar integration: cycle-aware placement with % nutrition cascade, atomic plan archival, library panel, save-from-calendar |
| 13 | **EL-1** | Rolling event window for no-roadmap clients + stale draft cleanup |
| 14 | **CR-4** | Check-Ins tab with list + detail views (reads from both event types) |
| 15 | **CR-5** | Dashboard queue card + roadmap phase enrichment |
| -- | ~~PT-1~~ | ~~Plan continuation across phase transitions~~ (Removed: library gives coaches direct control) |
| -- | ~~CAL-3a/3b~~ | ~~Original library spec~~ (Replaced by LIB-1/LIB-2/LIB-3 with library-first architecture) |

---

## Post-Completion Cleanup

Once all sessions are done and verified:

### 1. Delete plan documents
- DELETE `IMPLEMENTATION-PLAN.md` (this file)
- DELETE `CALENDAR-EVENTS-PLAN.md`
- DELETE `CHECK-IN-REVIEW-PLAN.md`

### 2. Update `docs/ARCHITECTURE.md`

Add/update the following sections to reflect the new reality:

**Data hierarchy** - add `exercises`, `training_events`, `nutrition_events`, and coach library tables to the diagram:
```
exercises (master catalog - global + coach-specific)
  └── referenced by training_exercises.exercise_id and coach_saved_exercises.exercise_id

training_plans (plan container)
  └── training_sessions (exercise container - sessions own exercises)
        └── training_exercises (exercise_id FK to exercises catalog)
training_events (calendar SOT - one row per session per date)
  ├── is_modified: tracks manually moved/duplicated/library-placed events
  └── linked to session_logs on completion

nutrition_plans (template/blueprint)
  └── nutrition_plan_daily_targets (7-row weekly blueprint)
nutrition_events (materialized schedule - one row per client per date)
  └── status tracks logged/missed

coach_saved_plans (coach-level plan templates, status: draft/saved)
  └── coach_saved_sessions (reusable sessions, can be standalone via saved_plan_id = NULL)
        └── coach_saved_exercises (exercise_id FK to exercises catalog)
training_plans.saved_plan_id FK tracks provenance (which library plan was placed)
```

**Training events lifecycle (calendar-as-SOT):**
- The calendar is the source of truth for the client's training program. Sessions own exercises, events own scheduling.
- Three on-ramps to a populated calendar: AI generator (draft in library, preview, then place from any start date), library plans (apply or drag onto calendar), library sessions (drag individual sessions onto specific days)
- AI/manual plan created → draft in coach library. Coach previews, edits exercises, then applies to client from any start date with cycle-aware placement
- Library placement → fresh `training_session` + `training_exercises` + `training_event` rows created (copies, never references to saved template)
- Duplicate-week → clones sessions + exercises so each week is independently editable
- Coach moves a session via calendar → single event date updated (`is_modified = true`), or template + future events regenerated ("all future" scope)
- Coach duplicates a session via calendar → new event row created (`is_modified = true`)
- Coach edits exercises in session drawer → changes apply to all events sharing that `training_session_id` (cloned sessions are independent)
- Client completes a session → event status updated, `session_log_id` linked
- Past events are immutable. `is_modified` flag tracks manually adjusted events; regeneration skips them unless `force = true`
- Phase boundaries enforce where events can be moved/duplicated (backend validation + UI non-droppable cells)

**Nutrition events lifecycle:**
- Plan created/regenerated → nutrition events generated for phase duration (or 8 weeks default)
- Coach applies plan from future date → old plan's events preserved up to effective_from - 1, new events from effective_from onward
- Coach moves a training session day → training events regenerate → nutrition events cascade-regenerate (training burn moves to correct day, baseline unchanged)
- Coach saves custom day distribution (skew) → events regenerate with per-day calorie overrides
- Client logs nutrition → event status updated to `logged`
- Past events are immutable — they represent what was actually prescribed

**Templates vs events (both domains):**
- `training_sessions` = exercise containers (what exercises are in this workout). `day_of_week` is null for calendar-placed sessions.
- `training_events` = the schedule (calendar SOT - which session happens on which date)
- `nutrition_plan_daily_targets` = nutrition blueprint (7 day-of-week target rows)
- `nutrition_events` = nutrition reality (concrete dates with calorie/macro targets)
- The calendar view is the primary scheduling interface (reads from events)
- The Plans tab reads from templates (coach's initial generation/editing view)
- The Data tab, Daily Pulse, check-in snapshots, weekly summaries read from events

**Training calendar (coach-side):**
- Multi-week scrollable view reading from `training_events` for the full plan/phase duration
- Anchored to the current week on load; scrollable backward (history) and forward (future)
- Phase bands: coloured left-border per week row (teal=active, gray=completed, blue=planned) with phase name labels and start/end boundary markers
- Move: drag event to different date. "Just this date" updates one event; "All future" updates the template + regenerates
- Duplicate: copy a session to an empty day (creates new event with `is_modified = true`)
- Edit: click event to open session detail drawer with inline exercise editing (reuses existing exercise CRUD endpoints)
- Phase boundary enforcement: events cannot be moved/duplicated outside the phase date range (plans without a phase have no boundary — all dates within the plan's event range are valid)
- Regeneration protection: warning dialog when modified events exist before template regeneration; confirmation dialog before generating a new plan from AI

**Coach library (LIB-1/2/3):**
- `coach_saved_plans` table: coach-level plan templates with `status` (draft/saved), `cycle_length`, `rest_pattern` for non-weekly splits
- `coach_saved_sessions` table: reusable sessions (can belong to a plan or stand alone). `order_index` determines cycle position. `is_rest` marks rest day slots
- `coach_saved_exercises` table: exercise prescriptions referencing the master catalog via `exercise_id` FK
- AI/manual generation creates drafts (`status = 'draft'`) in the library. Coach previews on full-page editor, then saves/discards/applies
- Saving a plan also saves each session as a standalone entry for mix-and-match use
- Placement creates fresh client-side `training_plans` + `training_sessions` + `training_exercises` + `training_events` from library templates
- Cycle-aware placement: PPL+Rest (4-day) places Push/Pull/Legs/Rest/Push/Pull... from any start date
- `training_plans.saved_plan_id` FK tracks which library plan was placed (provenance)
- Stale drafts (7+ days old) cleaned up by the EL-1 cron

**Nutrition event calorie composition (percentage model, post-LIB-2):**
- `baseline_calories` — plan's rest-day calorie target (frozen at event creation)
- `calorie_surplus_percentage` — from the training session assigned to that date (e.g., 15 for +15%). NULL on rest days.
- `training_burn_calories` / `external_burn_calories` — deprecated (0 on new events, legacy values preserved on old events for backward compat)
- Display total = `baseline * (1 + surplus/100)` when `include_activity_burn` is on, or `baseline` when off
- Macros: protein stays fixed, extra calories distribute to carbs/fats per diet type via `calculateDailyMacros()`
- The `include_activity_burn` toggle controls whether the surplus percentage is applied - does not require event regeneration

**Nutrition regeneration options:**
- "Recalculate calories" — recalculates TDEE/deficit using current weight and goal timeline
- "Keep current calories" — preserves existing baseline, only updates training day distribution and macros

**Training → Nutrition cascade:**
- Training event changes trigger nutrition event regeneration
- Nutrition events read `calorie_surplus_percentage` from the training session (via `training_event.training_session_id`)
- Only future `scheduled` events are replaced; `logged`/`missed` events are immutable
- The cascade preserves baseline calories — only the surplus percentage and `is_training_day` flag change

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
| `docs/TRAINING_PLAN_FEATURE.md` | Describes AI generation UX, not calendar or event architecture. Add a note about the calendar view and saved plans after CAL-2/CAL-3 ship. |
| `docs/newdesignsystem.md` | Visual design tokens |
| `schema_dump.md` | Auto-generated schema snapshot, regenerated after migrations |

### 4. Verify nothing references deleted code
Run `npx tsc --noEmit` and `npx vitest run` one final time to confirm clean build.
