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

  6. **Historical snapshots** - Both training and nutrition data are snapshotted at save time. `training_data` JSONB preserves the training state. `target_calories`, `target_protein_g`, `target_carbs_g`, `target_fat_g` columns preserve the nutrition targets. Coach-side views always read these saved values, never the current plan. This ensures historical accuracy survives plan regeneration.

  7. **Date-aware saves** - The server-side save flow uses the log's `date` field (not today's date) when looking up nutrition targets and planned activities. This prevents incorrect targets when editing a past day's log.

  ---

  ## Component Structure

  ### Client-side components (Sessions 8-13)
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
  ├── habit-row.tsx                (87 lines)  - Individual habit row. ALL habits render as
  │                                              simple toggle switches (done/not done),
  │                                              regardless of boolean or numeric type.
  │                                              Target info shown as context label
  │                                              (e.g. "Take Creatine · 10 Grams").
  ├── habits-section.tsx           (200 lines) - ✅ COMPLETED Session 11. All habits render
  │                                              as boolean toggles. Auto-saves independently.
  │                                              Filters habits by created_at date - only
  │                                              shows habits that existed on the selected day.
  └── utils/
      ├── daily-pulse-handlers.ts  (113 lines) - handleSave, handleSessionCompletion.
      │                                          Includes form-data-helpers (merged in).
      ├── daily-pulse-event-handlers.ts (37 lines) - Extracted event handler factories
      │                                              for activities and training.
      └── nutrition-change-handlers.ts (52 lines) - Calorie/macro input change handlers.
  ```

  ### Coach-side components (Sessions 14-17)
  ```
  components/clients/daily-pulse/
  ├── daily-wellness-strip.tsx     - Main component on coach client overview tab.
  │                                  Fetches 28-day rolling window of daily logs
  │                                  AND habit logs in parallel via Promise.all.
  │                                  Renders 2x2 bar chart grid + adherence dots.
  │                                  Runs detectAlerts() on loaded data.
  │                                  Shows alert badge with count in header.
  │                                  Manages selectedDate state for day detail overlay.
  │                                  Positioned above Check-In Schedule on overview tab.
  ├── wellness-bar-chart.tsx       - Reusable Recharts BarChart with Cell component
  │                                  for per-bar conditional colouring. Shows
  │                                  min/avg/max stats and current value.
  │                                  Imports getBarColor from shared utility
  │                                  utils/wellness-color-thresholds.ts.
  ├── adherence-dot-row.tsx        - Dot row for nutrition adherence (green/amber/red/grey)
  │                                  and training completion (green/grey). Clickable -
  │                                  clicking a dot opens the day detail overlay.
  └── day-detail-card.tsx          - Overlay popover centered over the charts area.
                                    Shows full day detail: wellness, training,
                                    nutrition (calories + indented macros), habits.
                                    Habits filtered by created_at date - only shows
                                    habits that existed on the displayed day.
                                    Uses completed field for display (not value/isBoolean).
                                    Uses Framer Motion fade + scale animation.
                                    Click outside or X button to close.
                                    Styled per DESIGN-SYSTEM.md (overline section
                                    labels, design system colours, text hierarchy).
  ```

  ### Coach-side habits components (Session 17)
  ```
  components/clients/habits/
  ├── habits-tab-content.tsx       (90 lines)  - Main tab layout with sidebar + analytics grid.
  │                                              Manages showInactive state and selectedHabitId.
  │                                              Passes habits data to both sidebar and grid.
  ├── habits-sidebar.tsx           (173 lines) - Sidebar with search, Active/All toggle,
  │                                              Add Habit button, and habit list. Toggle
  │                                              switches between active-only and all habits
  │                                              (including soft-deleted). Uses bg-gray-100
  │                                              segmented control pattern from DESIGN-SYSTEM.md.
  ├── habits-grid.tsx              (133 lines) - Analytics grid with date range selector
  │                                              (7d, 30d, 90d, All time). Renders chart
  │                                              cards for each habit. Handles scroll-to
  │                                              and highlight when habit selected from sidebar.
  ├── habit-chart-card.tsx         (175 lines) - Individual card with Recharts BarChart.
  │                                              All habits render as boolean-style charts:
  │                                              green bar for completed, gap for missed.
  │                                              Shows current streak, 7d/30d completion rates.
  │                                              Target info displayed as context text.
  │                                              Highlight animation (ring pulse) on selection.
  ├── habit-list-item.tsx          (151 lines) - Habit row with selection state, hover actions.
  │                                              Active habits: edit, delete, reorder actions.
  │                                              Inactive habits: greyed out with "Inactive"
  │                                              label, shows "Reactivate" button only.
  │                                              Two-row layout: name + badge, then type info.
  ├── add-habit-dialog.tsx         (146 lines) - Form dialog for creating habits. Name,
  │                                              description, optional numeric target
  │                                              (value + unit). Duplicate name detection.
  ├── edit-habit-inline.tsx        (118 lines) - Inline editing. Enter to save, Escape to
  │                                              cancel. Updates name and description.
  ├── habit-actions.tsx            (104 lines) - Action buttons: edit, delete (with confirm),
  │                                              reorder up/down. Only shown on hover.
  ├── completion-badge.tsx         (25 lines)  - Completion rate with colour coding.
  │                                              Green ≥80%, yellow ≥60%, red <60%.
  └── habit-empty-state.tsx        (35 lines)  - Empty state with example habit suggestions
                                                and "Create First Habit" button.
  ```

  ### Check-in review components (Session 19)
  ```
  components/check-in/
  ├── check-in-detail-modal.tsx    - Coach-side check-in review modal. Fetches check-in
  │                                  data, comparison data, AND daily tracking context
  │                                  (daily logs + habit logs) for the check-in period.
  │                                  Shows spinner until ALL data loads (including daily
  │                                  context) to prevent layout shift. Accepts clientName
  │                                  prop so title renders immediately without waiting
  │                                  for fetch. Renders DailyContextSummary at top of
  │                                  "Current Check-In" tab when daily logs exist.
  │                                  Date range for daily context calculated from:
  │                                  - Day after previous check-in to current check-in
  │                                  - Or 7 days back if no previous check-in
  │                                  Uses one-shot fetch in useEffect (not SWR) since
  │                                  this is a transient modal. useEffect depends on
  │                                  data?.checkIn?.id (primitive), not the data object.
  ├── daily-context-summary.tsx    (171 lines) - Orchestrator component. Receives dailyLogs,
  │                                              habitLogs, startDate, endDate as props.
  │                                              Returns null if no daily logs (section hidden).
  │                                              Renders DailyContextCharts + text summaries.
  │                                              Nutrition: avg cal vs avg target with "X of Y
  │                                              days logged", adherence counts (hit/partial/
  │                                              missed) using constants from lib/constants.ts.
  │                                              Training: sessions completed, activities done,
  │                                              unplanned count. Reads activityStatuses with
  │                                              .completed field correctly.
  │                                              Habits: completion rate per habit with proper
  │                                              denominator based on days existed in period
  │                                              (max(habitCreatedAt, startDate) to endDate).
  │                                              All sections hidden when zero relevant data.
  ├── daily-context-charts.tsx     (105 lines) - Compact bar charts for mood, energy, sleep,
  │                                              stress. Uses getBarColor from shared utility.
  │                                              Builds full date range with null values for
  │                                              missing days (renders as grey bars). Charts
  │                                              cover the check-in's full date range (not
  │                                              hardcoded to 7 days). 2x2 grid layout.
  │                                              Y-axis: mood 0-5, others 0-10.
  └── ... (other existing check-in components unchanged)
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
  ├── use-training-restoration.ts  (93 lines)  - Restores training data from saved log.
  │                                              Handles orphaned sessions.
  ├── use-client-habits.ts         (300 lines) - ✅ Session 17. Coach-side habits CRUD hook
  │                                              with SWR caching. Create, update, delete
  │                                              (soft delete), reorder, reactivate.
  │                                              Supports includeInactive param for Active/All
  │                                              toggle. Fetches habits + stats in parallel.
  │                                              Duplicate name error handling. Soft-deleted
  │                                              habits reactivated on re-create (same name).
  └── use-habit-logs.ts            (179 lines) - ✅ Session 17. Habit logs fetch with date
                                                range filtering (7d, 30d, 90d, all time).
                                                Transforms logs to chart-ready format.
                                                SWR with error retry config (3 retries,
                                                1s interval), deduping (2s), and onError
                                                logging for debugging.
  ```

  #### Services
  ```
  services/
  ├── daily-logs-service.ts        (359 lines) - Server-side daily logs CRUD operations.
  ├── daily-habits-service.ts      (311 lines) - Habits CRUD and log operations.
  │                                              Supports includeInactive param on
  │                                              getClientHabits. updateHabit accepts
  │                                              isActive field for reactivation.
  │                                              createHabit checks for inactive habit
  │                                              with same name and reactivates instead
  │                                              of inserting (avoids unique constraint).
  ├── daily-habits-logic.ts        (51 lines)  - Business logic for habit validation.
  ├── daily-habits-stats.ts        (54 lines)  - Habit statistics and aggregation.
  │                                              getHabitStats queries daily_habit_logs
  │                                              by habitId only (no is_active filter),
  │                                              so stats work for inactive habits too.
  ├── daily-activities-service.ts  (213 lines) - External/unplanned activities CRUD.
  ├── check-in-service.ts                      - Extended in Session 16 to calculate
  │                                              dailyLogsCount and expectedDays per
  │                                              check-in period (server-side, not client-side).
  ├── client-check-in-service.ts               - ✅ Updated Session 19. triggerAISummaryGeneration
  │                                              now calculates check-in date range, fetches
  │                                              daily logs + habit logs for the period, and
  │                                              passes them to generateCheckInSummary.
  └── ai-service.ts                            - ✅ Updated Session 19. AI check-in analysis.
                                                generateCheckInSummary and regenerateAISummary
                                                accept optional dailyLogs, habitLogs, startDate,
                                                endDate params. Shared AI_SYSTEM_PROMPT constant
                                                used by both functions. System prompt instructs
                                                AI to reference daily patterns, correlate energy
                                                with nutrition, note contradictions with self-
                                                reports, mention habits by name, note session
                                                swaps. Daily context only included when logs
                                                exist - otherwise works exactly as before.
  ```

  #### Libraries & Utilities
  ```
  lib/
  ├── constants.ts                 (14 lines)  - DEBOUNCE_DELAY_MS (300ms),
  │                                              RATE_LIMIT_RETRY_DELAY_MS (1500ms),
  │                                              Nutrition adherence thresholds
  │                                              (NUTRITION_ADHERENCE_HIT_THRESHOLD = 50,
  │                                               NUTRITION_ADHERENCE_PARTIAL_THRESHOLD = 200).
  ├── date-helpers.ts              (91 lines)  - Date formatting, getTodayDateString.
  ├── validation-helpers.ts        (76 lines)  - Input validation utilities.
  └── daily-wellness-alerts.ts                 - ✅ Session 16. detectAlerts(dailyLogs[])
                                                returns array of alerts. Triggers:
                                                mood/energy drop, no log gap, nutrition
                                                missed, training missed, high stress.
                                                Each alert: { type, severity, message,
                                                affectedDays[] }.

  utils/
  ├── nutrition-tracking-helpers.ts (139 lines) - calculateAdjustedDayTarget,
  │                                               calculateAdjustedMacros, getCalorieFeedback,
  │                                               getNutritionAdherence. Unit tested.
  ├── daily-logs-aggregation.ts    (140 lines) - Log aggregation for analytics.
  ├── wellness-color-thresholds.ts (28 lines)  - ✅ Session 19. Shared getBarColor function
  │                                              extracted from wellness-bar-chart.tsx.
  │                                              Exports WellnessMetric type and getBarColor.
  │                                              Colour thresholds: Mood green 4-5, amber 3,
  │                                              red 1-2. Energy/Sleep green 7-10, amber 4-6,
  │                                              red 1-3. Stress inverted: green 1-3, amber
  │                                              4-6, red 7-10. Null returns grey (#e5e7eb).
  │                                              Used by wellness-bar-chart.tsx and
  │                                              daily-context-charts.tsx.
  └── ai-daily-context-builder.ts  (157 lines) - ✅ Session 19. Transforms daily logs + habit
                                                logs into structured text summary for AI
                                                prompt. Single export: buildDailyContextForAI(
                                                dailyLogs, habitLogs, startDate, endDate).
                                                Per-day summaries: wellness metrics, calories
                                                vs target with adherence status, training
                                                session name + activity completion + skipped
                                                activities by name, habit toggles per day.
                                                Weekly patterns section: avg calories, nutrition
                                                adherence counts, session completion + swap
                                                details by name and day, habit completion rates
                                                with proper denominators, energy/nutrition
                                                correlation detection. Uses constants from
                                                lib/constants.ts for adherence thresholds.
                                                Returns empty string if no logs (AI prompt
                                                works as before). Never dumps raw JSON.
  ```

  #### Types
  ```
  types/
  ├── database.ts                  - Supabase generated types.
  ├── daily-log.ts                 - DailyLog type with camelCase fields.
  │                                  date is YYYY-MM-DD string.
  │                                  caloriesConsumed, targetCalories, etc.
  │                                  trainingData typed with activityStatuses shape.
  └── daily-habit.ts               - ✅ Session 19. Shared HabitLogWithDetails type.
                                    Includes: id, dailyHabitId, clientId, date,
                                    completed, value?, notes?, habitName,
                                    targetValue?, targetUnit?, isBoolean,
                                    habitCreatedAt. Used by daily-context-summary.tsx
                                    and ai-daily-context-builder.ts. Single source
                                    of truth - no duplicate type definitions.
  ```

  #### Tests
  ```
  __tests__/
  ├── utils/daily-logs-aggregation.test.ts     - Aggregation logic tests.
  ├── lib/daily-wellness-alerts.test.ts        - ✅ Session 16. Tests all alert triggers:
  │                                              mood drop, energy drop, no log gap,
  │                                              nutrition missed, training missed,
  │                                              high stress. Edge cases: empty array,
  │                                              single day. Uses vitest.
  └── services/client-check-in-service.test.ts - ✅ Updated Session 19. Mocks updated for
                                                new generateCheckInSummary signature (7
                                                params with optional dailyLogs, habitLogs,
                                                startDate, endDate). Mocks getDailyLogs
                                                and getHabitLogs services. Mock check-in
                                                objects include createdAt timestamps.
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
      (using the log's date for plan lookup, NOT today's date)
    - calorie_surplus_deficit
    - nutrition_adherence ("hit" / "partial" / "missed")

  4. If session completed: POST /api/client/session-completions
    If session NOT completed: DELETE /api/client/session-completions

  5. For each unplanned activity: POST /api/client/daily-activities
  ```

  ### Habits (auto-save, independent of Log Day) ✅ COMPLETED

  - All habits render as simple toggle switches on the client side (done/not done)
  - Numeric habits show target as context label (e.g. "Take Creatine · 10 Grams") but client just toggles
  - Boolean toggle → immediate `POST /api/client/habits/log` with `completed: true/false`
  - Date-aware: passes `selectedDate` to log habits for past days
  - Only shows habits where `created_at <= selectedDate` (habits don't appear for days before they existed)
  - Not tied to the Log Day button at all
  - Uses `habit-row.tsx` component for each habit with local state

  ---

  ## Coach-Side Data Flow (Sessions 14-17)

  ### DailyWellnessStrip - Initial Load

  `daily-wellness-strip.tsx` fetches all data upfront in a single `Promise.all`:

  ```
  Promise.all([
    GET /api/clients/[id]/daily-logs    → 28 days of daily logs (rolling window)
    GET /api/clients/[id]/habits/logs   → 28 days of habit logs (same date range)
  ])
  ```

  This eliminates per-click loading delays. All data is available immediately when the coach clicks a day.

  ### 28-Day Rolling Window

  The wellness strip always shows the last 28 days (not a calendar month). This ensures the coach always sees 4 full weeks regardless of what day it is.

  ### Bar Chart Rendering

  - 2x2 grid: Mood (1-5), Energy (1-10), Sleep Quality (1-10), Stress Level (1-10)
  - Each bar = one day. No bar for days with no log.
  - Recharts `Cell` component required for conditional per-bar colouring (CSS approach doesn't work with Recharts)
  - Colour thresholds defined in `utils/wellness-color-thresholds.ts` (shared utility):
    - Mood: Green (#10b981) 4-5, Amber (#f59e0b) 3, Red (#ef4444) 1-2
    - Energy: Green 7-10, Amber 4-6, Red 1-3
    - Sleep: Green 7-10, Amber 4-6, Red 1-3
    - Stress (INVERTED): Green 1-3, Amber 4-6, Red 7-10
    - Null: Grey (#e5e7eb) for missing data
  - Shows min/avg/max below each chart and current value (most recent log) prominently

  ### Adherence Dot Rows

  Below the charts:
  - **Nutrition adherence**: Green dot (hit), amber dot (partial), red dot (missed), grey dot (no log)
  - **Training completion**: Green dot (trained), grey dot (rest/no log)

  Both rows are clickable - clicking a dot opens the day detail overlay.

  ### Day Detail Overlay

  When coach clicks a bar or dot:
  1. `selectedDate` state is set
  2. Habit logs for that date are filtered from the pre-loaded 28-day data (no API call)
  3. Habits filtered by `created_at` - only habits that existed on the selected date are shown
  4. `day-detail-card.tsx` renders as a centered overlay over the charts area
  5. Uses `position: absolute` relative to the wellness strip card container
  6. Framer Motion animation: fade + scale (0.95 to 1)
  7. Semi-transparent backdrop behind overlay (`bg-black/5`) - clicking it closes the overlay
  8. Card has `onClick={(e) => e.stopPropagation()}` so clicking inside doesn't close
  9. X button in top-right also closes

  Data displayed in the overlay:
  - **Wellness**: "Mood 5/5 · Energy 8/10 · Sleep 6/10 · Stress 3/10"
  - **Training**: Session name from `training_data.trainingSessionName` + "Completed" or "Missed"
  - **Nutrition**: "4448 cal / 4448 cal" (actual / target, no "Target" prefix). Macros indented below as sub-items: "Protein 205g / 205g", "Carbs 635g / 635g", "Fat 121g / 121g"
  - **Habits**: Each habit with "Completed" or "Not logged" status. Display uses `completed` field only (not `value` or `isBoolean`).
  - **Header**: Date, logged timestamp, close button
  - **Section labels**: UPPERCASE overline pattern per DESIGN-SYSTEM.md (`text-xs font-medium text-gray-400 uppercase tracking-wider`)

  ### Alert Detection

  `detectAlerts()` in `lib/daily-wellness-alerts.ts` runs on the already-loaded 28-day data. No additional API call.

  Triggers:
  | Trigger | Condition | Severity |
  |---------|-----------|----------|
  | Mood drop | 2+ points below 7-day rolling average for 3+ consecutive days | High |
  | Energy drop | 2+ points below 7-day rolling average for 3+ consecutive days | High |
  | No log gap | 3+ consecutive days without a log (within provided date range only) | Medium |
  | Nutrition missed | `nutrition_adherence = "missed"` for 3+ consecutive days | Medium |
  | Training missed | 2+ missed assigned sessions in current week (uses `training_data.sessionCompleted === false` where `training_data.trainingSessionId` is set) | High |
  | High stress | Stress 8+ for 3 consecutive days | High |

  Each alert returns: `{ type, severity, message, affectedDays[] }` with `affectedDays` sorted chronologically (ascending).

  If alerts exist, a warning badge shows on the wellness strip header ("Daily Wellness [!2]"). Clicking the badge opens a popover listing the active alerts.

  ### Check-In Timeline Badge

  `check-in-timeline.tsx` shows "X/Y days logged" badge on each check-in card. The daily log count per check-in period is calculated server-side in `check-in-service.ts` and returned alongside the check-in data (via `includeDailyLogCounts: true` flag). Uses `CheckInWithLogCounts` extended interface (local to the component) to avoid `as any` casts.

  ### Daily Habits Tab (Session 17)

  The "Daily Habits" tab on the coach client page provides full habit management and analytics.

  **Tab layout**: Sidebar (left, ~30%) + Analytics Grid (right, ~70%).

  **Sidebar features**:
  - Search filter for habits
  - Active/All toggle (segmented control) - defaults to Active
  - Add Habit button (opens dialog with name, description, optional numeric target)
  - Habit list with click-to-select, hover actions (edit, delete, reorder)
  - Inactive habits shown greyed out with "Inactive" label and "Reactivate" button
  - Selected habit highlighted with blue accent

  **Analytics Grid features**:
  - Date range selector: 7 days, 30 days (default), 90 days, All time
  - One chart card per habit with Recharts BarChart
  - All charts are boolean-style: green bar for completed, gap for missed (no numeric value charts)
  - Each card shows: habit name, target info, current streak, 7d completion rate, 30d completion rate
  - Completion badge colour coding: green ≥80%, yellow ≥60%, red <60%
  - Click habit in sidebar → grid scrolls to and highlights that chart card (ring pulse animation)

  **Habit CRUD**:
  - **Create**: Name + optional description + optional numeric target (value + unit). Duplicate name detection shows user-friendly error.
  - **Edit**: Inline editing (Enter to save, Escape to cancel)
  - **Delete**: Soft delete (sets `is_active = false`). Preserves `daily_habit_logs` for historical analytics.
  - **Reorder**: Up/down arrows change `sort_order`
  - **Reactivate**: Inactive habits can be reactivated via button. Sets `is_active = true`.
  - **Re-create**: Creating a habit with the same name as an inactive habit reactivates it instead of failing on unique constraint.

  **Data flow**:
  - `use-client-habits.ts` fetches habits + stats via SWR (two parallel fetches)
  - `use-habit-logs.ts` fetches logs for the selected date range via SWR
  - Stats come from the existing hook (no duplicate fetching for chart cards)
  - Logs fetched separately for chart visualization only
  - SWR config: error retry (3 attempts, 1s interval), deduping (2s), onError logging

  ---

  ## Check-In Review Daily Context (Session 19)

  When a coach opens a check-in review modal, daily tracking data from the check-in period is displayed above the existing check-in content, and fed to the AI for richer analysis.

  ### Check-In Detail Modal - Daily Context Fetch

  `check-in-detail-modal.tsx` adds a second useEffect (depends on `data?.checkIn?.id`, not the `data` object) that fetches daily context when the check-in data is available:

  ```
  1. Fetch previous check-in via GET /api/check-in/{id}/previous
  2. Calculate date range:
     - If previous check-in exists: day after previous check-in to current check-in date
     - If no previous check-in: 7 days back from current check-in date
  3. Store calculated startDate and endDate in state (contextStartDate, contextEndDate)
  4. Promise.all with { cache: 'no-store' }:
     GET /api/clients/{id}/daily-logs?startDate=X&endDate=Y
     GET /api/clients/{id}/habits/logs?startDate=X&endDate=Y
  ```

  - Main spinner shows until BOTH check-in data AND daily context finish loading (prevents layout shift)
  - If daily context fetch fails, modal still works - daily context section is hidden
  - `clientName` prop passed from parent so title renders immediately (no "Loading..." flash)

  ### Daily Context Summary UI

  `daily-context-summary.tsx` renders at the top of the "Current Check-In" tab. Only renders if at least one daily log exists for the period. Uses check-in period dates (from state), NOT dates derived from log data.

  **Sections displayed:**
  - **Charts**: Compact 2x2 bar charts for mood/energy/sleep/stress via `daily-context-charts.tsx`. Covers the full check-in date range. Grey bars for missing days (null values). Uses shared `getBarColor` from `utils/wellness-color-thresholds.ts`.
  - **Nutrition**: "Avg X cal/day vs Y avg target (Z of N days logged)". Adherence counts using thresholds from `lib/constants.ts`. Reads saved `targetCalories` from daily_log rows (historical accuracy), not current plan.
  - **Training**: "Completed X/Y sessions". Activity completion from `training_data.activityStatuses` (reads `.completed` field). Unplanned activity count from `training_data.unplannedActivities`.
  - **Habits**: Per-habit "Habit Name: X/Y days" where Y = days the habit existed in the period, calculated as `max(habitCreatedAt, startDate)` to `endDate`. Not based on log entry count.

  All sections handle partial data: "3 of 7 days logged". Sections with zero relevant data are hidden.

  ### AI Analysis Enhancement

  `ai-service.ts` now accepts optional `dailyLogs`, `habitLogs`, `startDate`, `endDate` parameters on both `generateCheckInSummary` and `regenerateAISummary`. When daily logs exist:

  1. `buildDailyContextForAI()` in `utils/ai-daily-context-builder.ts` transforms raw data into structured readable text (not raw JSON dumps)
  2. The text block is appended to the check-in analysis prompt
  3. A shared `AI_SYSTEM_PROMPT` constant (used by both generate and regenerate functions) instructs the AI to:
     - Reference specific daily patterns with actual dates and numbers
     - Correlate low energy/mood with nutrition misses or poor sleep
     - Note when daily data contradicts the client's weekly self-report
     - Mention habit adherence by name
     - Note session swaps or skipped activities by name
     - Be specific with numbers, not generic

  When no daily logs exist, both functions work exactly as before (optional params).

  `client-check-in-service.ts` and the AI summary regeneration route both calculate the date range, fetch daily logs + habit logs, and pass them to the AI functions.

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

  ### Saved targets (historical accuracy)

  When a log is saved, the server snapshots the nutrition targets onto the `daily_logs` row:
  - `target_calories` - adjusted total including training/activity calories
  - `target_protein_g` - fixed from plan
  - `target_carbs_g` - recalculated from adjusted calories
  - `target_fat_g` - recalculated from adjusted calories

  These values use the **log's date** for plan lookup (not today's date), ensuring correct targets even when editing a past day's log.

  When a log exists:
  - **Compact view (client)**: uses `todayLog.target_calories`, `target_protein_g`, etc. (saved values, not recalculated)
  - **Edit mode (client)**: uses current plan targets for dynamic recalculation (accepted trade-off)
  - **Fresh day (client)**: calculates from current plan
  - **Coach detail card**: always reads saved values from the `daily_logs` row (historical accuracy)
  - **Check-in review summary**: reads saved `targetCalories` from daily_log rows (historical accuracy)

  This ensures logged data survives plan changes. If a coach regenerates the nutrition plan after a client logs, the logged day still shows the targets that were relevant when they saved.

  **Edge case**: If a client opens edit mode on an old log after a plan change, the live recalculation uses the current plan targets. The saved values are only overwritten if they actually click Update Log. This is an accepted trade-off since it's rare.

  ### Adherence auto-calculation

  | Status  | Condition              |
  |---------|------------------------|
  | hit     | Within 50 cal of target |
  | partial | 51-200 cal from target |
  | missed  | 200+ cal from target   |

  Based on absolute distance. Direction stored in `calorie_surplus_deficit`. Thresholds defined in `lib/constants.ts` as `NUTRITION_ADHERENCE_HIT_THRESHOLD` and `NUTRITION_ADHERENCE_PARTIAL_THRESHOLD`. Always import from constants, never hardcode.

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
  | React hooks order violation in DailyWellnessStrip | useEffect for habit log fetching was called conditionally (behind early return), violating Rules of Hooks | Moved conditional logic inside the useEffect, not around it. All hooks called unconditionally at top level. |
  | Day detail card training calories display | Showed estimated calories "(~350 cal)" next to training completion status unnecessarily | Removed calorie display from training line. Now shows "Leg Day - Completed" only. |
  | Nutrition calories formatting stray "0" | When surplus/deficit was exactly 0, the display appended "0" to the end of the string | Fixed to hide surplus/deficit when exactly 0 or show "(on target)" |
  | Day detail overlay not closing on outside click | Outer motion.div had `stopPropagation()` which blocked clicks from reaching the backdrop | Changed outer div to `onClick={onClose}`, kept `stopPropagation()` only on the inner Card |
  | Double divider under day detail header | Two `border-t` elements rendering below the date header | Removed the duplicate divider |
  | Macro targets saved with wrong day's values | `getTodaysNutritionTarget(clientId)` and `getTodaysPlannedActivities(clientId)` used today's date instead of log's date | Pass `data.date` to both functions so editing Thursday's log on Friday saves Thursday's targets |
  | Habits loading delay in day detail | Habit logs fetched on-demand per click via useEffect, causing visible delay | Prefetched all 28 days of habit logs in initial Promise.all, filtered client-side on click |
  | Alert detection false positive for single day | No-log-gap detection checked between last log and today, triggering falsely for single entries | Only check gaps within the provided date range, not against today |
  | Alert affectedDays wrong sort order | Some triggers iterated backwards, returning dates in descending order | Changed to forward iteration or sorted before returning. All affectedDays now ascending. |
  | Coach day detail showed "Not logged" for completed habits | Display text logic branched on `value` and `isBoolean` instead of `completed` field | Check `completed` field only: true → "Completed", false → "Not completed", no log → "Not logged" |
  | Numeric habit charts showed no data | `use-habit-logs.ts` set `value = log.value ?? 0` for numeric habits, which was null since clients only save `completed` | Changed to `value = log.completed ? 1 : 0` for all habits (boolean-style charts) |
  | Duplicate habit name on re-create after delete | Soft delete (`is_active = false`) preserved the row, unique constraint on `(client_id, name)` blocked re-creation | `createHabit` checks for inactive habit with same name, reactivates it instead of inserting |
  | Check-in daily context used log dates for period | `startDate` passed to DailyContextSummary was derived from `dailyLogs[0].date` (first log) instead of the calculated check-in period start date | Store calculated `contextStartDate` and `contextEndDate` in state, pass those to the component |
  | Hardcoded adherence thresholds in daily context | Adherence calculation in daily-context-summary.tsx and ai-daily-context-builder.ts used magic numbers 50 and 200 | Import `NUTRITION_ADHERENCE_HIT_THRESHOLD` and `NUTRITION_ADHERENCE_PARTIAL_THRESHOLD` from `lib/constants.ts` |
  | Habit denominator based on log count | Habit completion showed "X/Y" where Y was number of log entries, not days the habit existed | Calculate denominator as days from `max(habitCreatedAt, startDate)` to `endDate` |
  | Duplicate HabitLogWithDetails type | Type defined locally in both daily-context-summary.tsx and ai-daily-context-builder.ts, could drift apart | Extracted to shared `types/daily-habit.ts`, both files import from there |
  | Object ref in useEffect dependency (check-in modal) | useEffect for daily context fetch depended on `data` object, which gets new reference every render | Changed dependency to `data?.checkIn?.id` (primitive value) |
  | regenerateAISummary missing daily tracking prompt | `regenerateAISummary` had a minimal system prompt without daily tracking instructions, so regenerated summaries lost daily context awareness | Extracted shared `AI_SYSTEM_PROMPT` constant used by both generate and regenerate functions |
  | AI service recalculated check-in date range | `buildCheckInAnalysisPrompt` independently calculated the date range, risking inconsistency with the modal's calculation | Added optional `startDate` and `endDate` params to AI functions, passed from caller |
  | Check-in modal title showed "Loading..." | Title used `data?.client?.name || "Loading..."` which flashed before fetch resolved | Added `clientName` prop passed from parent, title renders immediately |

  ---

  ## Rules That Must Not Be Violated

  1. **No `onDataChange` useEffect** - causes infinite loops. State flows down via props only.
  2. **No object refs in useEffect dependency arrays** - objects get new references every render. Use primitive values.
  3. **No `as any`** - use proper types from `types/database.ts`. If extending an existing type, create a local interface (e.g. `CheckInWithLogCounts extends CheckIn`).
  4. **No `JSON.stringify()` on JSONB** - Supabase handles serialization automatically.
  5. **`trained: trained`** - never `trained: trained || undefined` (drops false).
  6. **`{ cache: 'no-store' }`** on all fetches + `Cache-Control: no-store` on all GET routes.
  7. **Components under 250 lines** - extract sub-components if needed.
  8. **Habits auto-save, everything else waits for Log Day**.
  9. **Planned activity calories from `activityMetadata.estimatedCalories`** (JSONB), not `estimated_calories` column.
  10. **`activityStatuses` shape** - Record with `{ completed, activityName, estimatedCalories }`, read `.completed` field.
  11. **Always check `activityStatuses[id]?.completed`**, never use `activityStatuses[id]` as a truthy check. The object is always truthy regardless of completion status.
  12. **Use `currentTrainingSession` for display and calculations**, never the originally scheduled session from the plan, since the client may have switched sessions.
  13. **Coach-side components in `components/clients/daily-pulse/`**, client-side in `components/daily-pulse/`. Never mix them.
  14. **React hooks must be called unconditionally** at the top level of a component. Conditional logic goes inside the hook, not around it.
  15. **Date-aware saves** - always pass the log's `date` field to `getTodaysNutritionTarget()` and `getTodaysPlannedActivities()`. Never rely on today's date for target lookups during save.
  16. **Prefetch data upfront** - coach-side components load all data (daily logs + habit logs) in the initial fetch. No per-click API calls for data that can be loaded in bulk.
  17. **Style per DESIGN-SYSTEM.md** - section labels use overline pattern (`text-xs font-medium text-gray-400 uppercase tracking-wider`), status colours use design system tokens (`text-success`, `text-destructive`, `text-warning`), not hardcoded hex values.
  18. **Framer Motion for overlays** - preferred over CSS transitions for expand/collapse and overlays because it handles `height: auto` properly and provides smoother animations.
  19. **All habits are boolean toggles on client side** - regardless of whether the habit has a numeric target. Coach defines the target for context, client just toggles done/not done. No numeric input fields on the client.
  20. **Habits filtered by `created_at` date** - only show habits where `created_at <= selectedDate`. Prevents habits appearing on days before they were created. Applies on both client Daily Pulse and coach day detail overlay.
  21. **Soft delete for habits** - delete sets `is_active = false`, never hard deletes. Preserves `daily_habit_logs` for historical analytics. Coach can view inactive habits via Active/All toggle and reactivate them.
  22. **Habit display text uses `completed` field only** - never branch on `isBoolean` or `value` for display. `completed: true` → "Completed", `completed: false` → "Not completed", no log → "Not logged".
  23. Client-side uses fetch with { cache: 'no-store' }, coach-side uses SWR - Daily Pulse, client portal, and progress page components fetch data directly using fetch with { cache: 'no-store' } in Promise.all patterns. Only coach-side components (components/clients/) use SWR hooks. Never use SWR on the client side. When creating new hooks, check hooks/ for existing hooks with similar names to avoid duplicates (e.g. use-client-habits.ts is a coach-side hook, not a client-side one).
  24. **Nutrition adherence thresholds from constants** - always import `NUTRITION_ADHERENCE_HIT_THRESHOLD` and `NUTRITION_ADHERENCE_PARTIAL_THRESHOLD` from `lib/constants.ts`. Never hardcode 50/200 values.
  25. **Colour thresholds from shared utility** - always import `getBarColor` from `utils/wellness-color-thresholds.ts`. Never duplicate colour threshold definitions in individual components.
  26. **Shared types in dedicated files** - types used by multiple files must be in `types/` directory (e.g. `HabitLogWithDetails` in `types/daily-habit.ts`). Never define the same type locally in multiple files.
  27. **Habit completion denominators** - when showing habit completion rates (e.g. "Water: 3/7 days"), the denominator must be calculated as days from `max(habitCreatedAt, startDate)` to `endDate`. Never use log entry count as the denominator.
  28. **Check-in period dates from calculation, not log data** - when displaying daily context for a check-in period, always use the calculated period dates (day after previous check-in to current check-in). Never derive the date range from the first/last daily log dates.

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
  | 14 | Coach wellness strip (bar charts) | Coach daily-logs API | ✅ COMPLETED |
  | 15 | Expandable day detail | training_data JSONB (trainingSessionName, activityStatuses) | ✅ COMPLETED |
  | 16 | Alerts + badges | Wellness strip, check-in timeline, daily-wellness-alerts.ts | ✅ COMPLETED |
  | 17 | Coach habits tab + analytics + Active/All toggle | Habits service + API, soft delete, reactivation | ✅ COMPLETED |
  | 18 | Client habits on progress page | Habit chart card from Session 17 | Planned |
  | 19 | AI check-in review context | training_data JSONB, daily_logs, habits | ✅ COMPLETED |
  | 20 | Needs attention feed | Alert triggers, training_data activityStatuses | Planned |
  | 21 | Roster summary + per-client toggle | Attention feed, AI service | Planned |