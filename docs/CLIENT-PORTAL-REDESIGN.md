# Client Portal Redesign: Day-Centric, Event-Driven

This document is the architecture reference for replacing the current Daily Pulse with a day-centric, event-driven client portal. It complements `CLIENT-PORTAL-EXECUTION-PLAN.md`, which breaks the work into executable sessions.

---

## Strategic purpose

The daily logs are not the product. They are the feedstock for the two systems that differentiate CoachHub:

1. **Coach attention feed** (`components/dashboard/needs-attention-feed.tsx`): passive signals derived from log data so coaches notice mood drops, adherence slips, and training misses without the client flagging them.
2. **Auto-populated weekly check-in** (`services/check-in-context-service.ts`): pre-fills the Sunday check-in form from the week's daily logs, so the client reviews and annotates rather than refilling.

Every design decision in this redesign must preserve or strengthen these two feeds. Concretely:
- Wellness, nutrition, and habits continue to write to the `daily_logs` spine children so `daily_logs_full` (the view both systems read) stays intact.
- Training moves to event-keyed writes, which fixes the edited-clone bleed that currently gives the check-in an ambiguous "sessions completed" count.
- The attention feed's training signals rewire to `training_events.status` directly (no denormalized flag).
- The check-in's AI summary gets enriched with `exercise_logs` data for richer progression insights.

If scope ever has to be cut, **Session 1.7 (attention feed rewire), Session 6.2 (check-in context switch), and Session 6.3 (AI summary enrichment)** are the load-bearing work. UI polish can slip.

---

## Context

Pre-launch, no users. The next milestones are iOS and Android app builds, then launch. Before committing to mobile, we are replacing Daily Pulse with a client portal that mirrors the coach-side event-driven model.

**Current portal:**
- `/client/dashboard` (Daily Pulse): one monolithic page. Wellness, training, nutrition, and habits all save atomically via `upsert_daily_log_atomic()` behind a single "Log Day" button.
- `/client/training`: flat list of `plan.sessions` (not events), keyed on `training_session_id`. Completion is binary. No per-exercise logging, even though `exercise_logs` schema supports it.

**Problems this redesign fixes:**
- **Edited-clone bleed.** A coach "Just this day" edit creates a cloned `training_sessions` row. The session-keyed client list shows duplicates forever, `WeeklyCompletionProgress` miscounts, and the completion-log fallback in `app/api/client/training/completions/route.ts` can link logs to the wrong event.
- **Monolithic save friction.** Logging only wellness today still requires interacting with an everything-at-once page.
- **No workout detail.** `exercise_logs` (migration 027, columns `actual_sets`, `actual_reps`, `actual_weight`, `weight_unit`, `notes`) has no write path or UI.
- **No client-side roadmap/phase visibility.** Coaches manage phases fully; clients see nothing.
- **Architecture drift.** `docs/ARCHITECTURE.md` states events are the source of truth. The coach calendar follows this; the client portal does not.
- **Known date bug** (TECHNICAL-DEBT.md): `saveUnplannedActivities` uses `new Date()` instead of the selected date. Past and future logging is already broken.
- **Duplicate type definitions** (TECHNICAL-DEBT.md): `TodaysActivity`, `UnplannedActivity`, `HabitLogWithDetails` repeated across 4 to 5 files.

---

## Target shape

### Home (`/client?date=YYYY-MM-DD`, today by default)

A compact summary of the selected day. The layout:
- Phase banner on top (hidden when no active roadmap).
- Four summary cards (training, nutrition, wellness, habits). Training becomes a list when multiple sessions are prescribed for that date.
- Previous/next day navigation via arrow buttons and horizontal swipe on touch devices.
- URL-param-driven date state so browser back/forward and deep links work naturally.

Each card shows summary data only: session name, logged-or-not state, and a simple progress indicator (for example "Pull Day A - 3/6 exercises logged"). Target response size is under 5KB.

### Detail pages (one per card type)

Clicking a card navigates to a dedicated detail page that fetches only its own data:
- `/client/training?date=X&eventId=Y`: per-set exercise tracker.
- `/client/nutrition?date=X`: calories and macro numeric entry.
- `/client/wellness?date=X`: mood/energy/sleep/stress inputs.
- `/client/habits?date=X`: habit checklist.

Saves are per-page and independent. There is no shared "Log Day" button. The browser back button returns to the home with the date preserved.

### Program view (`/client/program`)

Read-only roadmap and phases. Active phase highlighted; completed phases collapsed; future phases shown with start dates. Accessible via the phase banner tap or the Program tab in the bottom nav. Clients cannot edit roadmap data.

### Navigation structure (bottom tab bar)

The client portal gets a persistent bottom tab bar (native-app feel) with five destinations:

1. **Home** (`/client`): the day view with summary cards.
2. **Check-in** (`/client/check-in`): the existing weekly check-in submission. The tab badge hints when a check-in is in window.
3. **Program** (`/client/program`): the read-only roadmap/phase view.
4. **Content** (`/client/resources`): the existing content library already built (assigned content + coach library, `app/client/resources/page.tsx`).
5. **Settings**: accessed via a profile avatar in the top-right corner, not as a 5th tab, to keep the bar tight.

The old header-only layout (`app/client/layout.tsx`) is replaced with a layout that renders the bottom tab bar at the bottom of the viewport and the avatar/settings trigger in the top-right.

### Settings page (`/client/settings`)

New page. The data layer is already in place on the `clients` table; only UI plus a mutation endpoint are missing. Scope for v1:

- **Profile**: read-only name and email (changes via auth flow; out of scope here).
- **Weight unit**: `weight_unit` toggle (lbs/kg).
- **Unit preference**: `unit_preference` toggle (metric/imperial).
- **Reminder preferences**: `reminder_preferences` JSONB (fields already defined in the `ReminderPreferences` type; surface relevant toggles).
- **Timezone**: if Session 0.1 identifies it as missing, add a timezone selector here; the save endpoint writes to the column added in prep.
- **Sign out** button.

Out of scope for v1: avatar upload, password change (uses Supabase auth flow elsewhere), notification channel management beyond what `reminder_preferences` exposes.

New endpoint: `PATCH /api/client/settings` with zod validation for the supported fields.

### Phase completion

When a phase ends, the first time the client opens the app after the transition, a `PhaseCompletionCard` appears at the top of the home view (coach reflection, summary stats, next phase). Dismissal sets `completion_seen = true`. The existing component relocates from Daily Pulse to the new home; no rebuild.

---

## Fetch pattern: click-through

### Home endpoint (lightweight)

`GET /api/client/day-summary?date=YYYY-MM-DD` returns:
```
{
  phase: PhaseSummary | null,
  training: TrainingCardSummary[],
  nutrition: NutritionCardSummary,
  wellness: WellnessCardSummary,
  habits: HabitCardSummary
}
```
Each summary is minimal: name, logged-state boolean, progress counts. Target under 100ms, under 5KB.

### Detail endpoints

- `GET /api/client/training/events/[eventId]`: full event plus resolved session, exercises, existing `session_log` + `exercise_logs`.
- `GET /api/client/daily-logs/[date]/nutrition`: nutrition event target plus any existing log.
- `GET /api/client/daily-logs/[date]/wellness`: wellness log.
- `GET /api/client/daily-logs/[date]/habits`: habits plus the day's logs.
- `GET /api/client/program`: active roadmap plus phases.

### Coach drill-down

`GET /api/clients/[id]/training/session-logs/[sessionLogId]`: full session log plus exercise logs plus prescribed snapshots. Powers the new session drill-down dialog on the client training history table.

### Write endpoints

- `POST /api/client/training/events/[eventId]/log`: bulk write of `session_logs` plus `exercise_logs` including `prescribed_session_snapshot` and `prescribed_exercise_snapshot`. Updates `training_events.status`. Cascades nutrition.
- `PATCH /api/client/daily-logs/[date]/nutrition`: kcal plus macros on `nutrition_logs`.
- `PATCH /api/client/daily-logs/[date]/wellness`: wellness fields on `wellness_logs`.
- Habits continue to use existing habit-log endpoints.

All write endpoints populate `daily_logs.phase_id` and child `*_plan_id` links from the authoritative plan for that date. All write endpoints enforce the past-day lock (see below) server-side.

---

## Workout logging (quick or detailed, client's choice)

Per-set detail matters for strength and hypertrophy clients tracking progression. For beginners, weight-loss focused clients, or anyone short on time, the friction of logging every set kills adherence. The tracker supports both modes via progressive disclosure, no coach-side configuration: the client picks per session.

### Two modes

1. **Quick log (default, prominent)**: three buttons at the top of the page (Mark complete / Mark partial / Mark skipped) plus an optional notes field. One tap and save. Writes `session_logs` with the chosen `completion_quality`; no `exercise_logs` rows. Event status follows completion quality. Nutrition cascade still fires.
2. **Detailed log (expandable)**: "Log detailed performance" toggle reveals per-set fields. Client can log some or all exercises; unlogged prescribed exercises are treated as skipped and overall status derives to `partial` if mixed. Writes `session_logs` plus one `exercise_logs` row per logged exercise, with prescribed snapshots.

Both modes use the same API endpoint and the same save button. The request schema accepts `completion_quality` plus optional `exercises[]` plus optional notes. Detailed logging is pure addition on top of the quick path.

### Tracker UI (training detail page)

Top of page, always visible:
- Three status buttons (Mark complete / Mark partial / Mark skipped).
- Optional notes field.
- Save button.

Below, collapsed by default: **"Log detailed performance"** disclosure.
- Expanded view shows each prescribed exercise as a block with N set rows (N = prescribed sets).
- Per set: reps, weight, optional RPE. Per-exercise notes field.
- "Copy previous set" button populates the current set from the last filled row.
- "Add exercise" button for unplanned additions.
- "Skip exercise" toggle for prescribed exercises the client did not perform.
- Big touch targets for mobile web + future native.

Save is a single bulk-replace write. No per-set auto-save. The payload always includes `completion_quality` plus optional notes; `exercises` array is present only if the client expanded detailed logging.

### Snapshots at log time

Every log write captures:
- `session_logs.prescribed_session_snapshot`: session name, focus, planned exercises at log time.
- `exercise_logs.prescribed_exercise_snapshot`: prescribed sets, reps, weight, RPE, rest, notes at log time.

These snapshots preserve history when plans are replaced or exercises deleted. The coach drill-down reads live data when available and falls back to the snapshot when the live reference is null.

### Coach drill-down

Replaces the chart-only `HistoryChartDialog`. Shows prescribed vs actual per exercise, set-by-set, plus client notes and status. Reads from the live row when available, snapshot when orphaned.

---

## Nutrition logging (scope)

Calories and macros only. No meal or food-item logging in this pass. The card logs four numbers per day: kcal, protein (g), carbs (g), fat (g). Writes to the `nutrition_logs` child of `daily_logs`.

The summary bar reads the nutrition target via the three-level priority already documented in `docs/ARCHITECTURE.md` (logged snapshot to event to template fallback).

Food logging is a deliberate future phase. The card contract will not change when it is added.

---

## Date edit rules

- **Today**: always editable, regardless of prior log state.
- **Past day, never logged**: editable (the client can fill in missed logs after the fact).
- **Past day, logged**: locked. Display-only, with clear messaging.
- **Future day**: view-only. The client can swipe/scroll forward to see what's on their plan but cannot log against it.

No retroactive nutrition cascade on past days (past nutrition is past).

### Single source of truth for the rule

The rule above lives in one file — `lib/daily-log-permissions.ts` — as pure helpers:
- `canEditDay(date, loggedStatus, clientTimezone): boolean` — client-safe, drives UI disabled state.
- `assertCanEdit(clientId, date, resourceType): Promise<void>` — server-side wrapper that throws an HTTP-friendly error when violated.

Both are imported by every surface that cares (UI detail pages for disabled/notice state; every write endpoint for hard rejection). Neither UI nor server reimplements the date math, so they cannot disagree about whether a day is editable (which matters around client-local midnight).

Same pattern for plan context: `resolvePlanContextForDate(clientId, date): { phaseId, nutritionPlanId, trainingPlanId }` is the single function every write endpoint calls to populate `daily_logs.phase_id` and `*_plan_id` links. Do not duplicate this query per endpoint.

---

## Roadmap and phase awareness

### Banner on home

Phase name, week-in-phase, one-line goal. Hidden when no active roadmap. Handles mid-transition state: when the current phase is completed and the next is activating, the banner shows the incoming phase's name and goal.

### Program view

`/client/program` shows the full roadmap with its phases (coach-authored content, read-only). Current phase highlighted; past phases collapsible; future phases visible with start dates.

### Phase completion card

Existing `PhaseCompletionCard` relocates from `components/daily-pulse/` to `components/client-portal/day/`. Shown at the top of the home until the client dismisses it (`completion_seen = true`).

---

## Client weight-unit preference

`clients.weight_unit` already exists (migration 009, values `'lbs' | 'kg'`, default `'lbs'`). No new migration needed. Also `clients.unit_preference` exists (`'metric' | 'imperial'`) from migration 011.

- The tracker UI seeds weight inputs in the client's `weight_unit` preference.
- `exercise_logs.weight_unit` always stores the unit the client actually entered (supports per-set override).
- Coach drill-down renders values in their logged unit.
- Settings page lets the client change their `weight_unit` and `unit_preference`.

---

## Why fix web before mobile

1. **API contract is what mobile consumes.** Ship the right contract once. Changing it later means coordinating web, iOS, and Android simultaneously (forced updates, dual-write, data migration).
2. **Day-centric swipe UX is the mobile UX.** Validating it on web before writing it natively saves a rebuild.
3. **Data is already day-keyed.** `training_events`, `nutrition_events`, `daily_logs` with children, `daily_habit_logs` are all date-partitioned. The redesign is primarily a UI plus API-shape change; no schema migrations expected beyond the weight-unit column.
4. **Detailed workout logging is a mobile-first feature.** Clients log sets on their phone. Shipping empty `exercise_logs` to mobile launch means that surface has no implementation at all.

---

## Existing assets to reuse

- `services/training-event-service.ts`: `getEventForDate`, `getEventForSessionAndDate`, `linkSessionLogToEvent`, `mapCompletionQualityToEventStatus`.
- `lib/date-helpers.ts`: `getTodayDateString`, `getTrainingWeekStart`, `getDateString`. Replace every `.split('T')[0]` with `getDateString`.
- `components/daily-pulse/phase-completion-card.tsx`: relocate, do not rebuild.
- `components/client/onboarding/client-waiting-state.tsx`: the "waiting for coach" empty state exists already.
- `components/client/walkthrough/guided-walkthrough.tsx`: update copy and steps; do not rebuild the trigger logic.
- `services/training-event-calendar-service.ts` and `components/clients/training/calendar/training-calendar-view.tsx`: reference patterns for event-driven reads.
- `lib/rate-limit.ts` (`clientApiRateLimit`), `lib/csrf-protection.ts`, `lib/auth-helpers.ts` (`getAuthenticatedClientId`).

---

## UI surfaces

### New files

- `app/client/layout.tsx`: rewritten with bottom tab bar plus top-right avatar/settings trigger.
- `app/client/page.tsx`: home.
- `app/client/training/page.tsx`: training detail (replaces current flat list).
- `app/client/nutrition/page.tsx`: nutrition detail.
- `app/client/wellness/page.tsx`: wellness detail.
- `app/client/habits/page.tsx`: habits detail.
- `app/client/program/page.tsx`: program view.
- `app/client/settings/page.tsx`: settings.
- `app/api/client/settings/route.ts`: PATCH settings mutation.
- `components/client-portal/nav/client-nav.tsx`: bottom tab bar + top avatar trigger in one file. Split only if it exceeds the 250-line component limit.
- `components/client-portal/day/day-header.tsx`: date nav plus phase banner.
- `components/client-portal/day/training-card-summary.tsx`, `nutrition-card-summary.tsx`, `wellness-card-summary.tsx`, `habits-card-summary.tsx`.
- `components/client-portal/day/phase-banner.tsx`, `phase-completion-card.tsx` (relocated), `locked-day-notice.tsx` (single component with a `reason` prop; do not split into variants).
- `components/client-portal/training/set-tracker.tsx`, `exercise-tracker-block.tsx`, `set-row.tsx`.
- `components/clients/training/session-log-detail-dialog.tsx` (coach-side).

Settings form: starts as a single `app/client/settings/page.tsx`. A `components/client-portal/settings/` subdirectory is only created if the page blows past the 250-line limit. No speculative form component splits.

Client program data (`getClientProgram`): lives in a new `services/client-program-service.ts`. This reverses the earlier "put in existing roadmap service" call. The existing roadmap service likely uses `supabaseAdmin` for coach cross-client reads; client-side reads must use session-scoped Supabase (RLS). Keeping access contexts in separate files prevents accidental use of the wrong client and the data leak risk that comes with it.

No `useClientDay` hook. `useSWR` is called directly in the page. Only create a wrapper hook if it grows actual reusable logic (retries, transforms, dependent fetches).

### Retired (pre-launch, no users exist)

- `app/client/dashboard/page.tsx` (Daily Pulse landing).
- `components/daily-pulse/*` (except already-relocated `PhaseCompletionCard`).
- `app/api/client/training/route.ts` (old flat list GET).
- `app/api/client/training/completions/route.ts` (old session-keyed completion).
- `services/client-portal-training.ts:markSessionComplete` and now-unused exports.
- `components/clients/training/history-chart-dialog.tsx`.

`upsert_daily_log_atomic()` stays in the DB as an unused RPC; removing it is a separate schema change.

---

## Type consolidation (per TECHNICAL-DEBT.md)

Before Phase 1:
- Consolidate `TodaysActivity`, `UnplannedActivity`, `HabitLogWithDetails` into single canonical types.
- Fix silent error handlers (`handleSessionCompletion`, `saveUnplannedActivities`) in code paths being replaced; surface errors via toast while the code still exists.
- Replace all `.split('T')[0]` date handling with `getDateString()`.

---

## Production edge cases handled

- **Multiple sessions per day**: home renders a list of training cards; summary endpoint returns an array.
- **Client timezone**: every date computation uses client timezone; server never uses UTC for "today." Past-day locking respects client-local midnight.
- **Past-day edit policy**: today always editable; past unlogged editable; past logged locked (server-enforced).
- **Plan replaced mid-use**: coach drill-down reads `prescribed_session_snapshot` and `prescribed_exercise_snapshot` when live references are null.
- **Mid-phase transition**: phase banner handles no-roadmap, active-phase, current-completed-plus-next-pending, and current-completed-plus-next-activating states.
- **Brand-new client**: pre-activation uses existing `client-waiting-state.tsx`. Post-activation with no plans yet: empty states per card ("Your coach is preparing this").
- **Weight unit**: `preferred_weight_unit` column on `clients`; UI seeds input in preferred unit but `exercise_logs.weight_unit` stores actual unit entered.
- **Rate limits**: `clientApiRateLimit` is 30 req / 10s. Bulk-replace save pattern keeps realistic workouts well under this. No per-set writes.
- **Coach drill-down payload**: a large workout is around 40 `exercise_logs` rows. Fine at this scale.

---

## Deliberate reversals of existing documented principles

1. **"No auto-save" principle (old Daily Pulse rule).** Per-card independent saves replace the monolithic "Log Day" button. This reversal is intentional and reflected in `docs/ARCHITECTURE.md` (the principle is removed there).
2. **"Props down, callbacks up" for the phase completion card.** The relocated `PhaseCompletionCard` fetches its own data and POSTs its own dismissal via SWR, which technically violates the CONVENTIONS rule that child components be controlled/presentational. We deliberately keep this because Session 2.5 is scoped to relocation, not refactor, and the card's self-contained fetch pattern works today. Do not imitate this for new components.

---

## Coach-side improvements (bundled into this effort)

Two coach-side gaps surfaced during planning and are included in the execution plan because they're related to the same domain and small enough to fold in.

### Roadmap end-and-replace flow

Backend CRUD exists (`POST /api/clients/[id]/roadmap` creates, `PATCH` updates, `DELETE` archives if no started/completed phases exist). Coach-side UI exposes create and edit, but there is no clear "end this roadmap and start a new one" workflow visible to the coach. Add:

- An "End roadmap" button on `/components/clients/roadmap/roadmap-tab-content.tsx` that confirms intent, calls the existing archive path (likely via status change to `archived` rather than DELETE, since DELETE is blocked once phases have started), and then opens the existing `create-roadmap-dialog.tsx`.
- Confirmation dialog copy makes clear the current roadmap becomes read-only history and a new one can be set up.

### Phase edit unlock for active phases

Today phase goal fields (`phase_goal_weight`, `phase_goal_body_fat_percentage`) lock once `phase.status !== 'planned'` (`components/clients/roadmap/edit-phase-dialog.tsx:50` plus server guard in `updatePhase()`). Loosen to:

- **Planned**: fully editable (current behavior).
- **Active**: fully editable (new behavior). Show a small warning banner in the dialog that goal changes may affect downstream nutrition plan targets for this phase.
- **Completed / skipped**: remain read-only (history is history).

Implementation: remove the `goalsDisabled` status check for active; update the `updatePhase()` guard to allow edits on `['planned', 'active']`.

Known downstream implication: nutrition plans calculated with the old phase goal won't auto-recalculate. Flag in the confirmation dialog; a recalc workflow is out of scope for this change.

---

## Adjacent systems touched later

Two systems are partially coupled to the old model and get addressed in Phase 6.

**Weekly check-in system**: the context API already reads events for targets but uses session-keyed `session_logs` for completion counts and `daily_logs_full` for 7-day wellness/nutrition history. Since wellness plus nutrition keep writing to the `daily_logs` spine (per-card, not monolithic), `daily_logs_full` keeps working. Training writes move to event-keyed, which fixes the ambiguous "X of Y completed" count for cloned sessions. Phase 6 scope: switch the completion count query from `session_logs` to `training_events.status`, optionally enrich the AI summary with `exercise_logs` data, UX refresh if desired.

**Needs-attention feed**: 7 of 8 signals derive from the `daily_logs` spine (wellness, nutrition adherence, logging gap, habit dropoff, logging metadata). These survive unchanged. The "training missed" signal already reads `training_events`. The "activity-calorie mismatch" signal currently reads `training_logs.trained`. The rewire happens as part of Phase 1 (no denormalized flag ever; Phase 7 removed).

---

## Timezone handling

Session 0.1 records the current state and decision here after reading the code. Until then, every new endpoint must compute "today" using a client-local date (not server UTC). If the `clients` table lacks an explicit timezone column, Session 0.1 documents the gap and either proposes adding one or a workaround.
