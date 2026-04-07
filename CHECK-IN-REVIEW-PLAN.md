# Check-In Review Flow Redesign - 5 Session Plan

## Background

The check-in review system has four core problems:
1. **KPI calculation bugs** - Coach sees wrong training count (3/3 vs 4/4) and wrong calorie hit/miss because the coach view uses daily log iteration instead of `session_logs` + `countPlannedSessions()`, and compares weekly totals instead of daily averages with 50 cal grace.
2. **"Unknown Client" bug** - Review page shows "Unknown Client" because `mapCheckInRow()` drops the joined client relation.
3. **Data mismatch** - Coach sees daily log reconstructions, NOT what the client submitted. 9 fields are invisible (body measurements, photos, nutrition notes, external activities, exercise highlights for struggles/notes, session completions).
4. **No dedicated check-in view** - Check-ins only accessible via dashboard metric card and a modal. No client sidebar tab.

Additionally:
- Training plans lack date-effective versioning, so mid-cycle plan changes break historical accuracy.
- Missing daily logs are invisible (absence vs explicit "not logged"), making AI interpretation unreliable.
- Check-ins reconstruct data from live plans at read time, meaning plan changes retroactively alter historical check-in views.
- Roadmap phase cards need enriched weekly data (BF%, workouts vs planned, avg calories vs target).

---

## Session 1: Bug Fixes + Notifications

**Goal:** Fix the broken data, fix Unknown Client, and add coach notifications. After this session you can test: correct KPI numbers, client names showing, and notification bell/toasts working.

### What gets done
- Fix training tab hero bug (sessions completed counts previous week's data because no server-side week filtering)
- Fix KPI training calculation (use `session_logs` + `countPlannedSessions()` instead of daily log counting)
- Fix KPI calorie calculation (daily average comparison with 50 cal grace instead of weekly totals)
- Fix "Unknown Client" bug (extract client name/avatar from joined relation in unreviewed API)
- Add unreviewed check-ins to notification bell dropdown
- Add toast notification listener for new check-in arrivals
- Polish the review queue page (avatars, AI summary preview, urgency coloring)

### How to test
1. Open a client's Training tab on the first day of their training week (day after check-in day) - verify hero shows 0 sessions completed, 0% adherence, not carryover from the previous week
2. Open the existing check-in review modal for a client who has daily logs - verify training shows correct completed/planned (e.g. 4/4 not 3/3) and calories show daily avg with correct HIT/PARTIAL/MISSED
3. Go to `/check-ins/review` - verify client names and avatars show correctly (not "Unknown Client")
4. Submit a new check-in via magic link - verify toast notification appears and bell dropdown shows it
5. Verify review queue rows show AI summary preview and time-based urgency colors

### Claude Code prompt

```
Read CHECK-IN-REVIEW-PLAN.md for full context, then read CONVENTIONS.md and docs/ARCHITECTURE.md.

This is Session 1 of 5. Implement the following in this order:

**1. Fix Training Tab Hero Bug**
The training tab hero in `components/clients/training/training-history-table.tsx` (lines 100-132) calculates "Sessions Completed", "Adherence", and "Missed This Week" by filtering paginated rows from `getTrainingHistory()` in `services/training-history-service.ts`. But `getTrainingHistory()` fetches ALL training logs with no date range filter (lines 47-56), so the hero stats include sessions from previous weeks.

The nutrition tab works correctly because it has a dedicated week-scoped summary endpoint (`app/api/clients/[id]/history/nutrition/summary/route.ts`) that filters `nutrition_logs` between `weekStart` and `weekEnd`.

Fix: Create a dedicated summary endpoint for training, mirroring the nutrition pattern:
- Create `app/api/clients/[id]/history/training/summary/route.ts` - uses `coachApiRateLimit`, `requireCoachOwnsClient`.
- Fetches client's `expected_check_in_day` to calculate training week boundaries using `getTrainingWeekStart()` and `getTrainingWeekEnd()` from `lib/date-helpers.ts`. If `expected_check_in_day` is null (new client, not yet configured), default to `'monday'`.
- Queries `session_logs` for the client where `completed_at` is between weekStart and weekEnd. Counts rows where `completion_quality = 'full'`.
- Calls `countPlannedSessions(sessions, weekStart, weekEnd)` for total planned and `countPlannedSessions(sessions, weekStart, today)` for planned up to today.
- Returns `{ success: true, data: { completed, totalPlanned, plannedUpToToday, streak, missed } }`.
- Add `TrainingWeekSummary` type to `types/history.ts`:
  ```typescript
  export type TrainingWeekSummary = {
    completed: number;
    totalPlanned: number;
    plannedUpToToday: number;
    streak: number;
    missed: number;
  };
  ```
- In `components/clients/training/training-history-table.tsx`, fetch this summary endpoint via SWR (same pattern as nutrition-history-table.tsx uses for its summary). Replace the client-side row filtering calculation (lines 100-132) with the server-provided stats.

**2. Fix Check-In KPI Training Bug**
The coach's KPI ribbon in `components/check-in/kpi-ribbon.tsx` (lines 82-91) counts training from daily logs (`log.trainingData?.trainingSessionId`), showing 3/3 instead of 4/4. The client-side uses `getCheckInTrainingPeriodStats()` in `services/check-in-context-service.ts` which queries `session_logs` + `countPlannedSessions()` from `utils/training-week-helpers.ts`.

Fix:
- Create `app/api/clients/[id]/training/period-stats/route.ts` - accepts `?start=&end=` query params, uses `getCheckInTrainingPeriodStats()` logic (query `session_logs` for `completion_quality='full'` in period, call `countPlannedSessions()` for planned count). Use `coachApiRateLimit`. Return `{ success: true, data: { sessionsCompleted, sessionsPlanned } }`.
- In `hooks/use-check-in-detail-data.ts`, fetch this endpoint alongside daily logs (in the same Promise.all) using `contextStartDate`/`contextEndDate`. Store as `trainingPeriodStats` state.
- In `components/check-in/kpi-ribbon.tsx`, add optional `trainingPeriodStats?: { sessionsCompleted: number; sessionsPlanned: number }` prop. When provided, use it for the Training card instead of the daily log reduction.
- Pass `trainingPeriodStats` from `check-in-detail-modal.tsx` through to KPIRibbon.

**3. Fix KPI Calorie Bug**
In `components/check-in/kpi-ribbon.tsx`, the calorie calculation (lines 58-79) compares weekly totals with `50 * daysDiff` threshold. Change to daily average comparison:
- If `calStats.daysLogged === 0`, display "No data" as the Calories card value, skip HIT/PARTIAL/MISSED determination, and set subText to "No nutrition logs"
- Otherwise: `avgConsumed = calStats.total / calStats.daysLogged`, `avgTarget = calStats.target / calStats.daysLogged`
- HIT if `Math.abs(avgConsumed - avgTarget) <= 50`, PARTIAL if <= 150, else MISSED
- Display daily averages (not weekly totals) in the Calories card value
- Update subText to show `avg/day` with days logged count

**4. Fix "Unknown Client" Bug**
In `app/api/check-ins/unreviewed/route.ts` (lines 73-75), after `mapCheckInRow()`, manually extract client data from the joined relation:
```
clientName: typed.client?.name || "Unknown Client"
clientEmail: typed.client?.email || ""
clientAvatarUrl: typed.client?.avatar_url || null
```
Add `clientAvatarUrl?: string | null` to the CheckIn type in `types/check-in.ts` if not present. Note: `mapCheckInRow()` intentionally maps only check-in table columns and does not include joined relations — the caller is responsible for extracting client data from the join.

**5. Notification Bell Enhancement**
In `components/navbar/notifications-dropdown.tsx`:
- Import `useUnreviewedCheckIns` from `hooks/use-check-in-data`
- Add "New Check-Ins" section at top (before "Critically Overdue") with ClipboardList icon
- Show up to 3 recent unreviewed check-ins with client initials, name, "Submitted X ago"
- Each links to `/check-ins/review`
- Include unreviewed count in `totalNotifications`
- Add "Review all check-ins" link at bottom

**6. Toast Notification Listener**
Create `components/check-in-notification-listener.tsx`:
- "use client" component, renders null
- Uses `useUnreviewedCheckIns()` (shares SWR cache)
- `useRef` tracks previously seen check-in IDs
- On new arrival: fires toast with client name + "Review" action
- Batches multiple arrivals
Mount it in `components/app-layout.tsx`.

**7. Review Queue Polish**
In `app/check-ins/review/page.tsx` (lines 94-119):
- Use `clientAvatarUrl` for avatar display (fallback to initials)
- Add AI summary preview (first sentence of `checkIn.aiSummary`) as secondary text
- Add urgency coloring based on time since submission: green (<24h), yellow (24-48h), red (>48h). Note: urgency thresholds use UTC timestamps — acceptable given 24h/48h granularity.

After implementing, run `npx tsc --noEmit` to verify no type errors. Do NOT touch any files outside the scope above. Do NOT refactor unrelated code. Commit when done.
```

---

## Session 2: Training Plan Versioning

**Goal:** Add date-effective versioning to training plans, mirroring the existing nutrition plan pattern. After this session: training plans have `effective_from`/`effective_until`, replacement is atomic, and you can query which plan was active on any historical date.

### Why this comes first
Everything downstream (schedule generation, snapshots, accurate check-in views) depends on answering "what was prescribed on date X?" Nutrition plans already support this via `effective_from`/`effective_until` and `create_nutrition_plan_atomic()`. Training plans only have status-based archiving with no date range, making mid-cycle changes invisible to historical queries.

### What gets done
- Migration: add `effective_from` (DATE NOT NULL) and `effective_until` (DATE nullable) to `training_plans`
- Backfill `effective_from` from `created_at::date` for all existing rows
- Create `create_training_plan_atomic()` RPC mirroring the nutrition pattern
- Update training plan creation routes to use the atomic RPC
- Add a utility to query the active training plan for a given date (not just "current")
- Update `getActiveTrainingPlan()` to use `effective_until IS NULL` instead of just `status = 'active'`

### How to test
1. Create a training plan for a client - verify `effective_from` is set to today and `effective_until` is null
2. Replace the plan with a new one - verify old plan gets `effective_until = yesterday` and new plan gets `effective_from = today`
3. Query `getTrainingPlanForDate(clientId, pastDate)` - verify it returns the plan that was active on that date, not the current one
4. Verify existing training plan reads (Daily Pulse, coach view) still work unchanged
5. Check that the backfill migration set `effective_from` correctly for all existing plans

### Claude Code prompt

```
Read CHECK-IN-REVIEW-PLAN.md for full context, then read CONVENTIONS.md and docs/ARCHITECTURE.md.

This is Session 2 of 5. Add date-effective versioning to training plans, mirroring the nutrition plan pattern.

**Reference implementation:** Read these files first to understand the existing nutrition plan pattern:
- `supabase/migrations/048_create_nutrition_plan_atomic.sql` - the atomic RPC for nutrition plans
- `services/daily-context-service.ts` (lines 105-119) - date-range query for historical nutrition plan lookup
- `app/api/clients/[id]/nutrition/route.ts` - how nutrition plan creation uses the atomic RPC

**1. Migration**
Create a new migration file (follow the existing numbering convention in `supabase/migrations/`).

Add columns:
- `effective_from` DATE NOT NULL DEFAULT CURRENT_DATE on `training_plans`
- `effective_until` DATE nullable on `training_plans`

Backfill: `UPDATE training_plans SET effective_from = created_at::date`

Add index: `CREATE INDEX idx_training_plans_date_range ON training_plans (client_id, effective_from, effective_until)`

**2. Atomic RPC**
Create `create_training_plan_atomic()` in the same migration. It should:
- Accept: all training plan fields (client_id, coach_id, name, description, status, coach_prompt, ai_response_raw, split_type, frequency_per_week, program_duration_weeks, phase_id, plus client metric snapshot fields)
- In a single transaction:
  a. Archive existing active plan: `UPDATE training_plans SET status = 'archived', effective_until = (p_effective_from - INTERVAL '1 day')::date WHERE client_id = p_client_id AND status = 'active'`
  b. Insert new plan with `effective_from = p_effective_from` (defaults to CURRENT_DATE), `effective_until = NULL`, `status = 'active'`
  c. Return the new plan's id
- Mirror the error handling pattern from `create_nutrition_plan_atomic()`

**3. Update training plan creation routes**
Read these files:
- `app/api/clients/[id]/training/route.ts` - AI-generated plan creation
- `app/api/clients/[id]/training/manual/route.ts` - manual plan creation

Both currently call `getActiveTrainingPlan()` then `archiveTrainingPlan()` manually. Update both to use the new `create_training_plan_atomic()` RPC instead. The RPC handles archiving the old plan atomically.

Keep the existing session/exercise insertion logic that runs after plan creation - only replace the plan row creation + archive step.

**4. Historical plan lookup utility**
In `services/training-service.ts`, add:

```typescript
export async function getTrainingPlanForDate(clientId: string, date: string) {
  // Returns the training plan (with sessions + exercises) that was active on the given date
  // Query: effective_from <= date AND (effective_until >= date OR effective_until IS NULL)
  // Include sessions and exercises (same joins as getActiveTrainingPlan)
}
```

Also update `getActiveTrainingPlan()` to filter on `effective_until IS NULL` in addition to `status = 'active'` for correctness.

**5. Verify backward compatibility**
After all changes, verify these consumers still work:
- Daily Pulse training fetch (`app/api/client/training/route.ts`) - uses `getActiveTrainingPlan()`
- Coach training tab - uses `getActiveTrainingPlan()`
- Check-in context service (`services/check-in-context-service.ts`) - uses `getActiveTrainingPlan()`
- `countPlannedSessions()` callers - still receive session arrays, unaffected

After implementing, run `npx tsc --noEmit` to verify no type errors. Run `npx vitest run` to check existing tests. Commit when done.
```

---

## Session 3: Schedule Generator + Snapshot Infrastructure

**Goal:** Build the schedule generation utility and the check-in period snapshot. After this session: the system can produce a day-by-day "prescribed vs logged" grid for any date range, and check-in submissions freeze this as an immutable record.

### Why this matters
Currently, missing days are invisible (absence vs "not logged"), and check-in views reconstruct data from live plans. This session creates:
1. A computed schedule that makes missed days explicit
2. A frozen snapshot so historical check-ins survive future plan changes

### What gets done
- Schedule generation utility: takes a client + date range, returns day-by-day training prescribed vs logged
- Nutrition period summary utility: same for nutrition (leverages existing date-effective nutrition plans)
- Migration: add `period_snapshot` JSONB column to `check_ins`
- Update check-in submission to generate and freeze the snapshot
- Backfill utility for existing check-ins (optional, can run manually)

### How to test
1. Call `generateTrainingSchedule(clientId, periodStart, periodEnd)` for a client with logged and unlogged days - verify output shows "completed", "partial", and "missed" statuses with correct session names
2. Test with a mid-cycle plan change: create Plan A, log Monday, replace with Plan B, log Wednesday. Verify Monday shows Plan A's session, Wednesday shows Plan B's session
3. Test session swap: client does Pull Day on Push Day's slot - verify status is `"completed_swap"` with both prescribed and actual session names
4. Test rest-day training: client trains on a rest day - verify status is `"rest_trained"` with actual session details
5. Submit a new check-in - verify `period_snapshot` JSONB is populated on the check_ins row
6. Change the training plan after submission - verify the old check-in's snapshot is unchanged
7. Verify existing check-in submission flow still works (subjective, body metrics, AI trigger)

### Claude Code prompt

```
Read CHECK-IN-REVIEW-PLAN.md for full context, then read CONVENTIONS.md and docs/ARCHITECTURE.md.

This is Session 3 of 5. Build the schedule generation utility and snapshot infrastructure.

**Read first:**
- `services/training-service.ts` - `getActiveTrainingPlan()` and the new `getTrainingPlanForDate()` from Session 2
- `services/check-in-context-service.ts` - current `getCheckInTrainingPeriodStats()` (aggregate counts)
- `utils/training-week-helpers.ts` - `countPlannedSessions()` (day-of-week counting)
- `services/daily-context-service.ts` - existing date-range nutrition plan lookup
- `services/client-check-in-service.ts` - check-in submission flow
- `app/api/client/check-ins/route.ts` - POST endpoint

**1. Training schedule generator**
Create `utils/training-schedule-generator.ts`:

```typescript
type SessionInfo = {
  sessionId: string;
  sessionName: string;
  focus: string | null;
  exercises: {
    name: string;
    sets: number;
    repsTarget: string | null;
    rpeTarget: number | null;
  }[];
};

type ScheduleDay = {
  date: string;                    // YYYY-MM-DD
  planId: string | null;
  planName: string | null;
  prescribedSession: SessionInfo | null;  // null = rest day
  status:
    | "completed"          // prescribed session done as planned
    | "completed_swap"     // prescribed session existed, but client did a different one
    | "partial"            // prescribed session partially done
    | "missed"             // prescribed session not logged
    | "rest"               // rest day, no training
    | "rest_trained";      // rest day, but client trained anyway
  logged?: {
    sessionLogId: string;
    completionQuality: string;
    sessionName: string;           // the session actually performed
    isAlternativeSession: boolean; // from training_data JSONB
    exercises: {
      name: string;
      actualSets: number | null;
      actualReps: string | null;
      actualWeight: number | null;
      weightUnit: string | null;
      prescribed: { name: string; sets: number; repsTarget: string | null } | null;
    }[];
  };
};

export async function generateTrainingSchedule(
  clientId: string,
  periodStart: string,
  periodEnd: string
): Promise<ScheduleDay[]>
```

Implementation:
a. Query all training plans for the client that overlap the period: `effective_from <= periodEnd AND (effective_until >= periodStart OR effective_until IS NULL)`. Include sessions (where `is_active = true`) and exercises (where `is_active = true`).
b. Query all `session_logs` for the client in the period (join `exercise_logs` with `prescribed_exercise_snapshot`).
c. Query `training_logs` for the period to get `training_data` JSONB (specifically `isAlternativeSession` flag and `trainingSessionName`).
d. For each date in the range:
   - Find which plan was active on that date (effective_from <= date AND (effective_until >= date OR effective_until IS NULL))
   - Find if a session was prescribed (match day_of_week to the date's day)
   - Find if a session_log/training_log exists for that date
   - Determine status using this logic:
     - Prescribed + logged + same session = `"completed"` (or `"partial"` if completion_quality is partial)
     - Prescribed + logged + different session (isAlternativeSession=true or session IDs don't match) = `"completed_swap"`
     - Prescribed + no log = `"missed"`
     - No prescription + logged = `"rest_trained"`
     - No prescription + no log = `"rest"`
   - When status is `"completed_swap"`, both `prescribedSession` and `logged.sessionName` are populated so the coach/AI can see what was supposed to happen vs what actually happened
e. Return the array sorted by date.

Use `supabaseAdmin` for queries (this runs in server context during check-in submission).

**2. Nutrition period summary**
Create `utils/nutrition-period-summary.ts`:

```typescript
type NutritionDay = {
  date: string;
  planId: string | null;
  targets: { calories: number; proteinG: number; carbsG: number; fatG: number } | null;
  actuals: { calories: number; proteinG: number; carbsG: number; fatG: number } | null;
  adherence: "hit" | "partial" | "missed" | "not_logged";
};

export async function generateNutritionSummary(
  clientId: string,
  periodStart: string,
  periodEnd: string
): Promise<NutritionDay[]>
```

Implementation:
a. Query all nutrition plans for the client that overlap the period (same date-range pattern, already supported). Include `nutrition_plan_daily_targets` for day-specific targets.
b. Query `nutrition_logs` for the client in the period.
c. For each date: resolve the active plan's targets for that day_of_week, join with nutrition_log if exists.
d. Adherence: abs(actual - target) <= 50 = "hit", <= 150 = "partial", > 150 = "missed", no log = "not_logged".

**3. Migration: add period_snapshot to check_ins**
Create a new migration:

```sql
ALTER TABLE check_ins ADD COLUMN period_snapshot JSONB;
COMMENT ON COLUMN check_ins.period_snapshot IS 'Frozen day-by-day schedule of prescribed vs logged training and nutrition for the check-in period. Written at submission time, never updated.';
```

**4. Generate snapshot at check-in submission**
In `services/client-check-in-service.ts` (or a new `services/check-in-snapshot-service.ts` if the file is near the size limit), create:

```typescript
export async function generateAndSaveCheckInSnapshot(
  checkInId: string,
  clientId: string,
  periodStart: string,
  periodEnd: string
): Promise<void>
```

This calls `generateTrainingSchedule()` and `generateNutritionSummary()`, combines them into:
```typescript
{
  generatedAt: string;       // ISO timestamp
  periodStart: string;
  periodEnd: string;
  training: ScheduleDay[];
  nutrition: NutritionDay[];
}
```

And writes it to `check_ins.period_snapshot`.

Hook this into the check-in submission flow in `app/api/client/check-ins/route.ts` - call it after the check-in is created but before the AI summary trigger. The snapshot should be available for the AI to read.

**5. Update AI prompt builder to use snapshot**
In `utils/ai-prompt-builder.ts` or `utils/ai-daily-context-builder.ts`, when `period_snapshot` exists on the check-in, prefer it over reconstructing from live data. The training section should show each day with status, and the nutrition section should show daily actuals vs targets. Fall back to the existing daily log reconstruction for old check-ins without snapshots.

After implementing, run `npx tsc --noEmit` to verify no type errors. Run `npx vitest run`. Commit when done.
```

---

## Session 4: Check-Ins Tab (List + Detail Views)

**Goal:** Build the new "Check-Ins" tab in the client sidebar with list and detail views. The detail view reads from `period_snapshot` for historical accuracy. After this session you can test: navigating to the tab, filtering check-ins, clicking into a detail view with full client-submitted data that survives plan changes.

### What gets done
- Add "Check-Ins" tab to client sidebar between Habits and Notes
- Remove "Check-In History" empty section from Overview tab
- Build list view with filter controls, summary cards, metric chips
- Build detail view with dark summary strip, 2x2 content grid, AI summary, collapsible sections
- Detail view reads from `period_snapshot` JSONB (with fallback to live reconstruction for old check-ins)
- New lightweight summaries API endpoint
- Fix data mismatches (show ALL client-submitted data)

### How to test
1. Navigate to any client - verify "Check-Ins" tab appears between Habits and Notes
2. Click Check-Ins tab - verify list view shows with correct cards, filters work (All/Pending/Reviewed)
3. Verify metric chips show correct weight, BF%, calories (avg/day), training, mood
4. Click a check-in card - verify detail view shows with dark summary strip and 2x2 grid
5. Verify training card shows the day-by-day schedule with completed/missed status per session
6. Verify body measurements, progress photos, nutrition notes, external activities are all visible
7. Verify all exercise highlight types show (trophy=PR, alert=struggle, note=info)
8. Change the training plan, then reopen an old check-in - verify it still shows the original plan data from the snapshot
9. Verify Overview tab no longer has "Check-In History" empty section
10. Verify the existing check-in review modal still works from other entry points

### Claude Code prompt

```
Read CHECK-IN-REVIEW-PLAN.md for full context, then read CONVENTIONS.md and docs/ARCHITECTURE.md.

This is Session 4 of 5. Implement the new "Check-Ins" tab in the client sidebar. The detail view should read from `period_snapshot` JSONB on the check-in record (built in Session 3) for historical accuracy, with fallback to live data reconstruction for old check-ins that lack a snapshot.

Read the existing tab pattern first:
- `lib/client-tabs.ts` for tab definitions
- `app/clients/[id]/page.tsx` for how tabs are wired up (VALID_TABS set, TabsContent blocks)
- `components/clients/client-detail-layout.tsx` for sidebar rendering
- Look at an existing tab component (e.g. `components/clients/wellness/wellness-tab-content.tsx`) for the pattern to follow
- `types/check-in.ts` for existing check-in types

**1. Add tab definition**
In `lib/client-tabs.ts`, add `{ value: "check-ins", label: "Check-Ins" }` between "daily-habits" and "notes".

In `app/clients/[id]/page.tsx`:
- Add `"check-ins"` to the VALID_TABS set
- Add `<TabsContent value="check-ins">` rendering `<CheckInsTabContent />` with props: `client`, `checkIns` (from existing `useCheckInData`), and a callback to open check-in detail

**2. Remove "Check-In History" from Overview**
In `components/clients/client-overview-tab.tsx`, remove the third OverviewEmptySection (lines 77-82) for "Check-In History". Keep "Progress Tracking" and "Progress Photos".

**3. Create summaries API**
Create `app/api/clients/[id]/check-ins/summaries/route.ts`:
- Uses `coachApiRateLimit`, `getAuthenticatedCoachId()`, verifies coach owns client
- Fetches all check-ins for the client with their `period_start`, `period_end`, `period_snapshot`
- When `period_snapshot` exists: derive stats directly from it (avg calories, sessions completed/planned, adherence)
- When `period_snapshot` is null (old check-ins): fall back to querying `daily_logs_full` view + `session_logs` + `countPlannedSessions()` per period
- Returns array of summary objects with: id, periodStart, periodEnd, createdAt, status, weight, bodyFatPercentage, mood, dailyLogStats
- Response format: `{ success: true, data: CheckInSummary[] }`

**4. Create Check-Ins tab components**
Create directory `components/clients/check-ins/` with these files:

`check-ins-tab-content.tsx` (~100 lines):
- Parent component with `useState<string | null>(selectedCheckInId)`
- When null: renders CheckInListView
- When set: renders CheckInDetailView with onBack callback

`check-in-list-view.tsx` (~200 lines):
- Fetches from the summaries API via SWR
- Top section: "CHECK-INS" section label with count badge + segmented filter (All/Pending/Reviewed) + "X pending review" counter
- Renders CheckInSummaryCard for each check-in, newest first
- Staggered entrance animations (0.04s incremental delay)
- Pending reviews get subtle left border accent in amber

`check-in-summary-card.tsx` (~120 lines):
- Row 1: Calendar icon + week date range (13px, semibold) + "Submitted [date]" muted + "X/Y days logged" mono (teal if 5+, amber if <5)
- Row 2: Status badge right-aligned - "Reviewed" (teal check-circle) or "Pending review" (amber clock)
- Row 3: 5-column metric chips on brand-subtle backgrounds: Weight, Body Fat, Calories (avg/day + "of X,XXX"), Training (completed/planned), Avg Mood (/5)
- Hover: translateY(-1px) with teal shadow
- onClick calls parent's select handler

`check-in-detail-view.tsx` (~250 lines, split into sub-components if needed to stay under 250 line limit):
- "Back to check-ins" link at top
- Header: "Check-In Review" title + week date range + submitted date + days logged badge + "Review" button
- Dark summary strip (#0f2027, 6px radius): 5 columns with rgba(255,255,255,0.06) dividers - Weight, Body Fat, Calories (avg/day + adherence badge), Training, Avg Mood. Labels: 9px uppercase rgba(255,255,255,0.30). Values: 22px mono white.
- **Training card reads from `period_snapshot.training`** when available:
  - Day-by-day list: date + session name + status icon (check=completed, x=missed, half=partial, dash=rest)
  - For completed sessions: expandable exercise detail from snapshot
  - Fallback: when no snapshot, use `session_logs` + `countPlannedSessions()` reconstruction
- **Nutrition card reads from `period_snapshot.nutrition`** when available:
  - Large avg cal/day (28px mono) + "of X,XXX target"
  - Daily breakdown showing actuals vs targets with adherence badges
  - Macro bars (Protein=#2d8fb5, Carbs=#c8923a, Fats=#c06060) with "Xg / Xg"
  - Fallback: when no snapshot, use daily log nutrition data
- Wellness card: 2x2 sub-grid (Mood, Energy, Sleep, Stress) with progress bars. Energy=teal, others=#c8923a
- Habits card: habit list with completion ratio + dot indicators
- AI Summary card: Star icon + "Summary" title + "Regenerate" button + summary text
- Collapsible sections: Recommended Coach Actions, Key Insights, Share with Client
- Uses `useCheckInDetailData` hook (existing) for fetching single check-in data + snapshot

**5. Fix data mismatches in detail view**
The detail view MUST show everything the client submitted:
- Body measurements (waist, hips, chest, arms, thighs) - add a "Measurements" section
- Progress photos (front/side/back) - add photo gallery
- Nutrition notes from `nutritionAdherence.notes` - show in Nutrition card
- External activities - show in Training card as "Additional Activities"
- Exercise highlights - show ALL types (trophy=PR, alert=struggle, note=info), not just PRs
- Session completions from check-in - use as fallback when snapshot and daily logs don't have training data
- Client's submitted mood/energy/sleep/stress values shown prominently, daily log averages as context

Data for the detail view: extend existing fetch pattern from `hooks/use-check-in-detail-data.ts` to also return `period_snapshot` from the check-in record.

After implementing, run `npx tsc --noEmit` to verify no type errors. Do NOT touch files outside scope. Commit when done.
```

---

## Session 5: Dashboard + Roadmap Enrichment

**Goal:** Upgrade the dashboard check-in widget and enrich roadmap phase cards with data from snapshots. After this session you can test: dashboard queue card with review actions, and enriched phase weekly tables showing accurate historical data.

### What gets done
- Replace basic "Recent Check-ins" dashboard card with smarter queue
- Enrich roadmap phase weekly check-in table (add BF%, replace nutrition days with avg calories, replace sessions with workouts vs planned)
- Phase weekly table reads from `period_snapshot` when available for historical accuracy

### How to test
1. Go to coach dashboard - verify the check-in card now shows unreviewed items first with "Review" button, highlighted border, and AI summary preview
2. Navigate to a client's Roadmap tab - expand an active phase - verify "Weekly Check-Ins" table shows: Wk, Period, Weight, BF%, Workouts (X/Y), Calories (avg/avg target)
3. Verify workouts column shows completed vs planned (e.g. "4/5") - derived from snapshot when available
4. Verify calories column shows daily averages (e.g. "2100/2200") - derived from snapshot when available
5. Change a training plan, verify old phase check-in rows still show accurate historical data

### Claude Code prompt

```
Read CHECK-IN-REVIEW-PLAN.md for full context, then read CONVENTIONS.md and docs/ARCHITECTURE.md.

This is Session 5 of 5. Implement dashboard queue card and roadmap phase card enrichment.

**1. Dashboard Check-In Queue Card**
Read `app/dashboard/page.tsx` to understand the current "Recent Check-ins" card (lines 86-154).

Create `components/dashboard/check-in-queue-card.tsx`:
- Uses `useUnreviewedCheckIns()` for unreviewed items + existing `/api/check-ins/recent` SWR data for reviewed items
- Unreviewed items render first with `border-l-2 border-primary` highlight and "Review" button
- Each row: client avatar/initials, client name, time ago (using `formatRelativeTime`), AI summary preview (first sentence of `aiSummary`)
- Reviewed items below in muted style
- Header: "Check-Ins" with badge count for unreviewed
- Max 5 items total, "View all" link to `/check-ins/review`
- Match the existing card styling (motion.div with delay, rounded-lg bg-card border)

In `app/dashboard/page.tsx`, replace the "Recent Check-ins" motion.div block (lines 86-154) with `<CheckInQueueCard />`.

**2. Enrich Roadmap Phase Weekly Check-In Table**
Read these files first:
- `services/phase-weekly-data-service.ts` - current data fetching
- `types/roadmap.ts` - PhaseWeeklyDataRow type
- `components/clients/roadmap/phase-weekly-table.tsx` - current table rendering
- `components/clients/roadmap/phase-expanded-content.tsx` - where the table is used
- `utils/training-week-helpers.ts` - countPlannedSessions utility

Changes to make:

a) Update `types/roadmap.ts` - replace `PhaseWeeklyDataRow`:
```
{
  weekNumber, periodStart, periodEnd, checkInDate,
  weight: number | null,
  bodyFatPercentage: number | null,       // NEW
  workoutsCompleted: number,              // RENAMED from trainingSessions  
  workoutsPlanned: number | null,         // NEW
  avgCaloriesConsumed: number | null,     // NEW (replaces nutritionDaysOnTarget)
  avgCalorieTarget: number | null,        // NEW
}
```

b) Update `services/phase-weekly-data-service.ts`:
- Add `body_fat_percentage` and `period_snapshot` to the check_ins select. Remove `nutrition_days_on_target`.
- **When `period_snapshot` exists on a check-in**: derive workoutsCompleted/workoutsPlanned from `period_snapshot.training` (count statuses), derive avgCaloriesConsumed/avgCalorieTarget from `period_snapshot.nutrition` (average actuals and targets).
- **When `period_snapshot` is null** (old check-ins): fall back to current behavior - query `daily_logs_full` view for AVG(calories_consumed) and AVG(target_calories), query `session_logs` + `countPlannedSessions()` for workout counts.
- Map results to the new PhaseWeeklyDataRow shape.

c) Update `components/clients/roadmap/phase-weekly-table.tsx`:
- New columns: Wk | Period | Weight | BF% | Workouts | Calories
- BF%: `X.X%` or dash
- Workouts: `completed/planned` (e.g. "4/5") or just completed if no plan
- Calories: `avgConsumed/avgTarget` (e.g. "2100/2200") rounded to nearest integer, or just avgConsumed if no target, or dash

d) Update `components/clients/roadmap/phase-expanded-content.tsx` if it passes props that changed (e.g. the prop name change from trainingSessions to workoutsCompleted).

After implementing, run `npx tsc --noEmit` to verify no type errors. Check that `phase-weekly-table.tsx` consumers are updated for the renamed fields. Commit when done.
```

---

## Summary

| Session | Scope | Key Test | Depends On |
|---------|-------|----------|------------|
| 1 | Bug fixes + notifications | KPI shows 4/4, client names correct, bell/toast work | Nothing |
| 2 | Training plan versioning | Plans have date ranges, atomic replacement works | Nothing |
| 3 | Schedule generator + snapshots | Day-by-day grid generated, snapshot frozen at submission | Session 2 |
| 4 | Check-Ins tab (list + detail) | New tab renders, reads from snapshot, all client data visible | Session 3 |
| 5 | Dashboard + roadmap enrichment | Queue card works, phase table shows BF%/workouts/calories from snapshots | Session 3 |

Sessions 1 and 2 can run in parallel (no dependencies). Sessions 4 and 5 can run in parallel after Session 3.
