# Daily Pulse - Feature README

Daily Pulse is the daily check-in system on the client dashboard. Clients log wellness (mood, energy, sleep, stress), training completion, nutrition intake, and habits each day. Coaches see aggregated data via the wellness strip on the client overview page.

---

## Architecture

### Core Principles

1. **Lifted state** - `daily-pulse.tsx` owns ALL state. Child components are controlled/presentational. Props down, callbacks up. No child component manages its own data state.

2. **Single source of truth** - The `training_data` JSONB column on `daily_logs` stores the complete training UI state. On page load, everything restores from this column, not from cross-referencing other tables.

3. **No auto-save** - Nothing saves until the client clicks "Log Day" (wellness + training + nutrition). The one exception is habits, which auto-save independently on toggle/blur.

4. **Cache busting** - All fetches use `{ cache: 'no-store' }`. All GET API routes return `Cache-Control: no-store` headers.

5. **Single instance** - One `TrainingSection` rendered with an `isExpanded` prop. Not separate instances for compact/expanded views.

---

## Component Structure

```
components/daily-pulse/
├── daily-pulse.tsx              (249 lines) - Top-level container. Owns ALL state.
│                                              Handles save/restore. Renders content.
│                                              Manages date selection with debouncing.
├── daily-pulse-content.tsx      (244 lines) - Layout orchestrator. Renders wellness,
│                                              training, nutrition, habits sections.
│                                              Calculates savedTargets for nutrition.
├── daily-pulse-logged-view.tsx  (142 lines) - Extracted logged view for when day is complete.
│                                              Shows summary + collapsed sections with edit.
├── daily-pulse-summary.tsx      (57 lines)  - Compact view when day is logged.
│                                              Shows scores, training, calories at a glance.
├── day-nav-bar.tsx              (94 lines)  - 7-day navigation bar (Mon-Sun).
│                                              Visual states for logged/today/selected.
├── wellness-section.tsx         (124 lines) - Mood emoji selector, energy/sleep/stress
│                                              sliders, notes input. Presentational only.
├── training-section.tsx         (127 lines) - Orchestrator for training UI. Renders
│                                              session toggle, activity list, add form.
├── session-picker.tsx           (143 lines) - Alternative session selection dropdown.
│                                              Shows all sessions with "(scheduled)" label.
├── activity-list.tsx            (100 lines) - Renders planned activities with toggles
│                                              and unplanned activities with delete.
├── add-activity-form.tsx        (92 lines)  - Inline form for unplanned activities.
│                                              Name (with suggestions), intensity, duration.
├── nutrition-section.tsx        (205 lines) - Calorie input, macro inputs, dynamic
│                                              target display. Reads training state as
│                                              props for live recalculation.
├── nutrition-section-compact.tsx (40 lines) - Compact calorie display.
├── nutrition-target-display.tsx (68 lines)  - Plan target with "Assumes..." breakdown.
├── macro-inputs.tsx             (112 lines) - Protein/carbs/fat inputs with targets.
├── training-summary.tsx         (60 lines)  - Compact training summary for logged view.
├── habit-row.tsx                (87 lines)  - Individual habit row with toggle/input.
│                                              Handles optimistic updates.
├── habits-section.tsx           (200 lines) - ✅ COMPLETED Session 11. Boolean toggles,
│                                              numeric inputs. Auto-saves independently.
└── utils/
    ├── daily-pulse-handlers.ts  (113 lines) - handleSave, handleSessionCompletion.
    │                                          Includes form-data-helpers (merged in).
    ├── daily-pulse-event-handlers.ts (37 lines) - Extracted event handler factories
    │                                              for activities and training.
    └── nutrition-change-handlers.ts (52 lines) - Calorie/macro input change handlers.
```

### Coach-side components (Sessions 14-16)
```
components/daily-pulse/
├── daily-wellness-strip.tsx     - 28-day bar charts on coach client overview
├── wellness-bar-chart.tsx       - Reusable Recharts BarChart with colour coding
├── adherence-dot-row.tsx        - Nutrition/training/day detail on click
```

### Supporting files

#### Hooks
```
hooks/
├── use-daily-pulse.ts           (300 lines) - Main data fetching hook. Takes selectedDate param.
│                                              Single Promise.all for 6 endpoints. Manages
│                                              isLoading, isSaving, weekly logs.
├── use-daily-pulse-helpers.ts   (36 lines)  - fetchWithRetry (handles 429 rate limits),
│                                              fetchWeeklyLogs for nav bar.
├── use-daily-pulse-state.ts     (107 lines) - Extracted state management. All form data,
│                                              training state, nutrition, habits.
└── use-training-restoration.ts  (93 lines)  - Restores training data from saved log.
                                              Handles orphaned sessions.
```

#### Services
```
services/
├── daily-logs-service.ts        (359 lines) - Server-side daily logs CRUD operations.
├── daily-habits-service.ts      (311 lines) - Habits CRUD and log operations.
├── daily-habits-logic.ts        (51 lines)  - Business logic for habit validation.
├── daily-habits-stats.ts        (54 lines)  - Habit statistics and aggregation.
└── daily-activities-service.ts  (213 lines) - External/unplanned activities CRUD.
```

#### Libraries & Utilities
```
lib/
├── constants.ts                 (14 lines)  - DEBOUNCE_DELAY_MS (300ms),
│                                              RATE_LIMIT_RETRY_DELAY_MS (1500ms),
│                                              Nutrition adherence thresholds.
├── date-helpers.ts              (91 lines)  - Date formatting, getTodayDateString.
└── validation-helpers.ts        (76 lines)  - Input validation utilities.

utils/
├── nutrition-tracking-helpers.ts (139 lines) - calculateAdjustedDayTarget,
│                                               calculateAdjustedMacros, getCalorieFeedback,
│                                               getNutritionAdherence. Unit tested.
└── daily-logs-aggregation.ts    (140 lines) - Log aggregation for analytics.
```

---

## View States

DailyPulse has three distinct view states based on log status and user interaction:

### 1. Unlogged Day (Default)
Rendered in `daily-pulse-content.tsx`:
- Full form with all sections expanded
- "Log Day" button at bottom
- Day navigation bar at top
- All inputs editable

### 2. Logged Day - Collapsed View  
Rendered via `daily-pulse-logged-view.tsx`:
- Summary card shows wellness scores, training status, calories
- All sections collapsed to single-line displays
- "Edit" button in top-right to expand
- Habits still editable (auto-save independent)
- Uses saved targets from `todayLog` to survive plan changes

### 3. Logged Day - Expanded View (Editing)
Back to `daily-pulse-content.tsx` with `isExpanded=true`:
- Full form like unlogged, but pre-filled
- "Update" button instead of "Log Day"
- Can modify any values
- Uses current plan targets for live recalculation

---

## Data Flow

### Date Navigation & Debouncing

1. **Date selection**: User clicks day in `DayNavBar` → `setSelectedDate(date)`
2. **Debounce**: Changes debounced by `DEBOUNCE_DELAY_MS` (300ms) before fetch
3. **Week logs**: `fetchWeeklyLogs()` loads current week on mount for nav bar indicators

### Fetch (on date change)

`use-daily-pulse.ts` fires a single `Promise.all` with `{ cache: 'no-store' }` and `selectedDate` parameter:

```
Promise.all([
  GET /api/client/daily-logs/today?date={selectedDate}        → todayLog (or null)
  GET /api/client/daily-logs/streak                           → { currentStreak, longestStreak }
  GET /api/client/daily-logs/nutrition-target?date={selectedDate} → { nutritionTarget, trainingSession, plannedActivities }
  GET /api/client/training                                    → allTrainingSessions
  GET /api/client/habits                                      → habits list
  GET /api/client/habits/logs/today?date={selectedDate}       → selected day's habit logs
])
```

- Uses `fetchWithRetry` helper - retries once on 429 rate limit errors after 1500ms delay
- Returns all at once. Components never fetch their own data
- Single `isLoading` flag is `true` until all resolve
- AbortController cancels previous requests when date changes

### Restore (from existing log)

A single `useEffect` in `daily-pulse.tsx` runs when `todayLog` loads:

```
if todayLog exists:
  - Set mood, energy, sleep, stress, notes from todayLog
  - Set sessionCompleted from todayLog.trained
  - Set calories, protein, carbs, fat from todayLog
  - Read training_data JSONB:
    - If trainingSessionId matches today's scheduled session → set as current
    - If trainingSessionId differs → set as selectedAlternativeSession
    - If trainingSessionId not in allTrainingSessions → create orphaned display object
      using trainingSessionName from training_data
    - Restore activityStatuses from training_data.activityStatuses
    - Restore unplannedActivities from training_data.unplannedActivities
```

Guard: only runs when `isLoading === false` AND `todayLog` is defined.

**Critical**: `training_data` JSONB is the ONLY source of truth for restore. The code does NOT cross-reference `client_session_completions` or `daily_external_activities` tables.

### Save (Log Day click)

`handleSave` in `daily-pulse-handlers.ts`:

```
1. Build training_data JSONB object:
   {
     sessionCompleted, trainingSessionId, trainingSessionName,
     isAlternativeSession, activityStatuses, unplannedActivities
   }

2. POST /api/client/daily-logs with:
   - mood, energy, sleep, stress, notes
   - trained: trained  (ALWAYS boolean, never || undefined)
   - trainingSessionId
   - caloriesConsumed, proteinG, carbsG, fatG
   - completedActivityIds (legacy JSONB array)
   - trainingData (JSONB object - source of truth)

3. Server auto-calculates and saves:
   - target_calories, target_protein_g, target_carbs_g, target_fat_g
   - calorie_surplus_deficit
   - nutrition_adherence ("hit" / "partial" / "missed")

4. If session completed: POST /api/client/session-completions
   If session NOT completed: DELETE /api/client/session-completions

5. For each unplanned activity: POST /api/client/daily-activities
```

### Habits (auto-save, independent of Log Day) ✅ COMPLETED

- Boolean toggle → immediate `POST /api/client/habits/log` with optimistic UI update
- Numeric input blur → immediate `POST /api/client/habits/log` with optimistic UI update  
- Date-aware: passes `selectedDate` to log habits for past days
- Not tied to the Log Day button at all
- Uses `habit-row.tsx` component for each habit with local state

---

## training_data JSONB Structure

Stored on the `training_data` column of `daily_logs`:

```json
{
  "sessionCompleted": true,
  "trainingSessionId": "uuid-string",
  "trainingSessionName": "Full Body Circuit",
  "isAlternativeSession": false,
  "activityStatuses": {
    "activity-uuid": {
      "completed": true,
      "activityName": "Running",
      "estimatedCalories": 507
    }
  },
  "unplannedActivities": [
    {
      "activityName": "Running",
      "intensityLevel": "moderate",
      "durationMinutes": 30
    }
  ]
}
```

**Important shape note**: `activityStatuses` is `Record<string, { completed: boolean; activityName: string; estimatedCalories: number }>`, NOT `Record<string, boolean>`. Always read the `.completed` field. Sessions 13, 15, 17, 19, and 20 all read this and must use the correct shape.

`trainingSessionName` enables historical display after plan regeneration. When the session ID becomes orphaned (plan regenerated), the stored name is used for display with a "(from previous plan)" indicator.

---

## Nutrition Target Logic

### Two calorie concepts

1. **Plan target** (displayed prominently, never changes): `nutritionTarget.calories` from the API. Assumes full plan compliance - all training and activities completed.

2. **Adjusted target** (used for surplus/deficit feedback): Builds up from baseline as the client toggles items ON.

```
adjustedTarget = baselineCalories + completedTrainingCals + completedActivityCals
```

- `baselineCalories` = rest day calories (no training baked in)
- `completedTrainingCals` = session calories IF toggled ON, else 0
- `completedActivityCals` = sum of each toggled-ON activity's calories
- Unplanned activities = ZERO calorie impact

### Macro recalculation

- **Protein**: stays FIXED (set by coach, never recalculated)
- **Carbs/Fat**: recalculated from remaining calories using the SAME RATIO as the original plan. E.g. if the coach set a 60/40 carb/fat split, that ratio is preserved when calories change.

### Saved targets

When a log exists:
- **Compact view**: uses `todayLog.target_calories`, `target_protein_g`, etc. (saved values, not recalculated)
- **Edit mode**: uses current plan targets for dynamic recalculation (accepted trade-off)
- **Fresh day**: calculates from current plan

This ensures logged data survives plan changes. If a coach regenerates the plan after a client logs, the logged day still shows the targets that were relevant when they saved.

### Adherence auto-calculation

| Status  | Condition              |
|---------|------------------------|
| hit     | Within 50 cal of target |
| partial | 51-200 cal from target |
| missed  | 200+ cal from target   |

Based on absolute distance. Direction stored in `calorie_surplus_deficit`.

---

## Session Completion Logic

- **On save (session completed)**: Upserts into `client_session_completions` for the current week's progress tracker
- **On save (session NOT completed)**: Deletes from `client_session_completions` for both the current and previously saved session ID
- **On plan regeneration**: Orphaned completion records are deleted from `client_session_completions`. Historical data in `daily_logs.training_data` is never touched.

`client_session_completions` is only for current week progress tracking. `training_data` JSONB is the permanent historical record.

---

## Orphaned Session Handling

When a coach regenerates a training plan, previously logged session IDs may no longer exist in `allTrainingSessions`. The restore logic handles this:

1. Detects that `training_data.trainingSessionId` is not in `allTrainingSessions`
2. Creates a display-only session object using `trainingSessionName` from `training_data`
3. Sets `estimatedCalories` to 0 (original value is no longer applicable)
4. UI shows "(from previous plan)" and disables session switching
5. Client can still edit other parts of their log

---

## Key Bugs Fixed

These are documented to prevent regressions:

| Bug | Root Cause | Fix |
|-----|-----------|-----|
| Calorie target double-counting | Addition model added training cals on top of a baseline that already included them | Changed to: adjustedTarget = baseline + completed items |
| Activity calories showing 0 | `getTodaysPlannedActivities` read from `estimated_calories` column (NULL for external activities) | Read from `activityMetadata.estimatedCalories` JSONB instead |
| Infinite re-render loops | `onDataChange` useEffect syncing child to parent state | Removed pattern. Lifted state, props only. |
| Toggle state not restoring | Used `hasRestoredRef` which had timing bugs | Single useEffect guarded by isLoading check |
| Session completion not cleaning up | DELETE used current session ID, not previously saved one | Delete for both current and `todayLog.training_session_id` |
| Compact view showing new plan targets after regeneration | Read targets from current plan instead of saved log | Use `todayLog.target_calories` etc. for compact view |
| Orphaned session crash | Session ID not found in allTrainingSessions | Create display-only object from `trainingSessionName` |
| Boolean false dropped | `trained: trained || undefined` converts false to undefined | Always use `trained: trained` |
| Activity completion check used truthy object instead of .completed field | `activityStatuses[id]` is an object which is always truthy even when completed is false | Check `.completed` property explicitly (line 81 in route.ts) |
| "Assumes..." text disappeared on session switch | Display looked up session name in original scheduled sessions array, which doesn't contain alternative sessions | Read from `currentTrainingSession` directly (nutrition-target-display.tsx) |
| Plan target headline didn't update on session switch | Displayed static `nutritionTarget.calories` instead of recalculating from baseline + current session + activities | Calculate dynamically from `currentTrainingSession` (nutrition-target-display.tsx lines 19-26) |
| Server saved wrong target on session switch | Used `getTodaysTrainingSession` (scheduled) instead of looking up `trainingData.trainingSessionId` (actually selected) | Look up selected session from training plan (route.ts lines 74-77) |
| Compact view ignored skipped activity calories | Compact nutrition display wasn't receiving the adjusted target that accounts for activity completion status | Pass `adjustedCalories` prop to NutritionSectionCompact (daily-pulse-content.tsx line 158) |

---

## Rules That Must Not Be Violated

1. **No `onDataChange` useEffect** - causes infinite loops. State flows down via props only.
2. **No object refs in useEffect dependency arrays** - objects get new references every render. Use primitive values.
3. **No `as any`** - use proper types from `types/database.ts`.
4. **No `JSON.stringify()` on JSONB** - Supabase handles serialization automatically.
5. **`trained: trained`** - never `trained: trained || undefined` (drops false).
6. **`{ cache: 'no-store' }`** on all fetches + `Cache-Control: no-store` on all GET routes.
7. **Components under 250 lines** - extract sub-components if needed.
8. **Habits auto-save, everything else waits for Log Day**.
9. **Planned activity calories from `activityMetadata.estimatedCalories`** (JSONB), not `estimated_calories` column.
10. **`activityStatuses` shape** - Record with `{ completed, activityName, estimatedCalories }`, read `.completed` field.
11. **Always check `activityStatuses[id]?.completed`**, never use `activityStatuses[id]` as a truthy check. The object is always truthy regardless of completion status.
12. **Use `currentTrainingSession` for display and calculations**, never the originally scheduled session from the plan, since the client may have switched sessions.

---

## Remaining Sessions

| Session | Feature | Dependencies | Status |
|---------|---------|-------------|--------|
| 1 | Database Migration | Supabase tables and RLS | ✅ COMPLETED |
| 2 | TypeScript Types + Zod Schemas | Type definitions and validation | ✅ COMPLETED |
| 3 | Daily Logs Service | Server-side service functions | ✅ COMPLETED |
| 4 | Daily Logs API Routes | Client and coach API endpoints | ✅ COMPLETED |
| 5 | Daily Habits Service | Habits CRUD and stats | ✅ COMPLETED |
| 6 | Daily Habits API Routes | Coach and client habit endpoints | ✅ COMPLETED |
| 7 | Daily Activities Service + API | External activities CRUD | ✅ COMPLETED |
| 8 | DailyPulse - Wellness Section | Mood, energy, sleep, stress UI | ✅ COMPLETED |
| 9 | DailyPulse - Training & Activities | Training toggles, activities, save/restore | ✅ COMPLETED |
| 10 | DailyPulse - Nutrition Section | Calorie input, macro tracking, dynamic targets | ✅ COMPLETED |
| 11 | Habits section in DailyPulse | Services from Session 5, API from Session 6 | ✅ COMPLETED |
| 12 | Check-in Step 1 refactor (auto-populate from daily logs) | daily_logs data | ✅ COMPLETED |
| 13 | Check-in Step 4 refactor (training auto-summary) | training_data JSONB (new activityStatuses shape) | ✅ COMPLETED |
| Day Nav | 7-day navigation bar | Weekly logs fetch, date helpers | ✅ COMPLETED |
| 14 | Coach wellness strip (bar charts) | Coach daily-logs API | Planned |
| 15 | Expandable day detail | training_data JSONB (trainingSessionName, activityStatuses) | Planned |
| 16 | Alerts + badges | Wellness strip, check-in timeline | Planned |
| 17 | Coach habits management + analytics tab (merged) | Habits service + API | Planned |
| 18 | Client habits on progress page | Habit chart card from Session 17 | Planned |
| 19 | AI check-in review context | training_data JSONB, daily_logs, habits | Planned |
| 20 | Needs attention feed | Alert triggers, training_data activityStatuses | Planned |
| 21 | Roster summary + per-client toggle | Attention feed, AI service | Planned |