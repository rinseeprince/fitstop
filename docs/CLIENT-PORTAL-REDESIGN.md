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
2. **Check-in** (`/client/check-in`): the weekly check-in hub — submission form when a check-in is in window, plus a list of past check-ins with drill-down detail. The tab badge hints when a check-in is in window.
3. **Program** (`/client/program`): the read-only roadmap/phase view.
4. **Content** (`/client/resources`): the existing content library already built (assigned content + coach library, `app/client/resources/page.tsx`).
5. **Settings**: accessed via a profile avatar in the top-right corner, not as a 5th tab, to keep the bar tight.

The old header-only layout (`app/client/layout.tsx`) is replaced with a layout that renders the bottom tab bar at the bottom of the viewport and the avatar/settings trigger in the top-right.

### Check-in hub (`/client/check-in`)

The Check-in tab is a hub, not a single-purpose submission form. Shows:
- **Submission form** at top when a check-in is in window (driven by `clients.expected_check_in_day` + `calculateCheckInPeriod()`). When not in window, a friendly "Next check-in opens on [date]" notice replaces the form.
- **Past check-ins list** below: chronological, newest first. Each row shows date, status badge (pending/ai_processed/reviewed), and a short AI-summary preview.
- Tapping a past check-in opens a full detail view (`/client/check-in/[id]` already exists per `app/client/progress/check-in/[id]/page.tsx` — reuse it, just route to it from the new hub).

If `/client/progress` today contains only check-in history (no other progress metrics), it gets retired in Session 5.1 cleanup; the hub replaces it. If it contains non-check-in content (e.g. weight trends), it remains reachable via a link from the check-in hub or Settings and is evaluated separately.

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

## Viewer-relative unit display

### Goal

Every weight value in the app renders in the **viewer's** preferred unit, not the recorded unit. A coach in metric viewing a client who logs in imperial sees kg; the same client viewing their own data sees lbs. The system handles all conversions transparently.

This applies first to weight (the most common cross-unit case) and follows for height + body measurements (per-record `measurement_unit` already exists on relevant tables).

### Why this is launch-critical

Without it, a coach managing multiple clients with different unit preferences sees a mixed-unit roster, and switching client contexts repeatedly forces them to do mental conversions. That is a daily-use friction point at the heart of the coaching workflow. Shipping the client portal redesign without this means coaches will hit the friction on day one. The fix is bounded (one schema add, one helper, a render-path sweep, two toggles) so it ships at launch rather than after.

### Data model

Two-column model on every record that holds a weight, two-column model on profile rows. Stored values are NOT canonicalised; conversion happens at render time.

- **Per-record `weight_unit`** stays as-is on `check_ins`, `body_metrics`, `exercise_logs`, etc. It records the unit the value was originally entered in. Audit trail; never used for display.
- **Per-profile `unit_preference`** drives display. `clients.unit_preference` (`'metric' | 'imperial'`, exists today from migration 011) and a new `coaches.unit_preference` (added in Session 8.1) are the only sources of truth for "what unit should we render in for this viewer."
- **`clients.weight_unit`** stays as the per-client default for write-time labelling on records the client creates. Settings UI keeps it in sync with `clients.unit_preference` (imperial → lbs, metric → kg). They never independently diverge from a user perspective.
- **No canonical-storage migration.** Stored values keep their original units paired with `weight_unit`. The conversion happens at render time (read path), not on save (write path). Pre-launch this is a tradeoff in favour of simplicity: no risk of botched data conversion, no need to update historical rows, no per-row backfill.

### Render rule

Every place that renders a weight value goes through one helper:

```ts
formatWeight(value: number, valueUnit: 'lbs' | 'kg', viewerPreference: 'metric' | 'imperial'): { value: number; unit: 'lbs' | 'kg' }
```

The function reads from the per-record `weight_unit`, converts to the viewer's preferred unit, and returns the converted value plus the label. Components render `{value} {unit}` directly. Companion `formatLength(value, valueUnit, viewerPreference): { value, unit }` for height + measurements.

**No render path bypasses this helper.** Exception: explicit audit views that should show the recorded unit verbatim ("client logged 180 lbs at 7:42pm") may render the recorded `weight_unit` directly with an inline comment explaining why. There are very few of these (probably zero at launch).

### Viewer resolver

Request-scoped helper:

```ts
getViewerUnitPreference(request: NextRequest): Promise<'metric' | 'imperial'>
```

- For coach-authenticated requests, returns `coach.unit_preference`.
- For client-authenticated requests, returns `client.unit_preference`.
- For unauthenticated public surfaces (none currently render weights, but future-proof), returns `'imperial'` as a safe default.

**Conversion happens at the API boundary, not in components.** Routes that return weight values resolve viewer preference once per request, run `formatWeight()` over response payloads, and return already-converted `{value, unit}` pairs. Keeps render code dumb and avoids 15+ components having to fetch viewer preference via context.

For client-side flows where the component fetches its own data (settings page, intake review), a thin `useViewerPreference()` SWR hook backed by `/api/me/unit-preference` provides the preference; the component then calls `formatWeight()` directly.

### Write path

When a viewer enters a weight in a form:
- The form input shows the viewer's unit (lbs or kg) as the label.
- On submit, the value is sent to the API along with the unit it was entered in: `{ value, weight_unit: viewerPreference === 'imperial' ? 'lbs' : 'kg' }`.
- The API stores `(value, weight_unit)` as-entered. No conversion on the API write path.

When a coach edits a weight that the client originally logged in a different unit:
- The form pre-fills with the *viewer's* unit (after `formatWeight()` conversion).
- On save, the new value is stored with `weight_unit` set to the coach's preferred unit. The most recent edit wins for the unit label on that record.
- This is a deliberate choice: cross-edit unit provenance ("entered by client in lbs, edited by coach in kg") is recoverable from `updated_at` + audit history if ever needed; we are not building a per-edit history of which unit was used.

### Settings UI

- **Client side**: a single Imperial / Metric toggle in the client settings page. Session 2.6 ships the basic version writing only `unit_preference` + `weight_unit` for the client. Session 8.3 brings it under the unified write-path rule (no behaviour change, just consistent helper usage).
- **Coach side**: a parallel toggle in coach settings. Session 8.3 adds it (extending an existing settings page if one exists, or adding a minimal one if not).

The toggle is binary: Imperial or Metric. We do not expose the per-unit columns (`weight_unit`, `height_unit`, `measurement_unit`) as separate user controls — those are derived from the single preference.

### Out of scope

- **Per-record unit override at edit time** (e.g. coach forcing one client's records into a specific unit regardless of preference). YAGNI.
- **Mid-string mixed units in coach-authored notes.** Notes are free-text; we are not parsing them.
- **Historical re-canonicalisation** of pre-existing records into a single stored unit. The render rule still applies — they convert at render time — but no DB migration backfills older rows to canonical kg.
- **Volume / energy units** (calories vs kJ, etc.). Same principle would apply but no demand at launch; defer.

### Execution

Phase 8 in `CLIENT-PORTAL-EXECUTION-PLAN.md`:
- **Session 8.1**: schema + helper foundation. New `coaches.unit_preference` column, `getViewerUnitPreference()` resolver, consolidated `formatWeight()` + `formatLength()` helpers.
- **Session 8.2**: render-path refactor. Sweep every render path; route through `formatWeight()` with viewer preference. Convert at API boundary where possible.
- **Session 8.3**: write-path + settings toggles. Coach settings UI, client settings UI cleanup (extends Session 2.6's toggle), forms-convert-on-submit logic.

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

Several coach-side gaps surfaced during planning and are bundled because they touch the same domain and benefit from the same under-the-hood changes.

### Roadmap end-and-replace flow

Backend CRUD exists (`POST /api/clients/[id]/roadmap` creates, `PATCH` updates, `DELETE` archives if no started/completed phases exist). Coach-side UI exposes create and edit, but there is no clear "end this roadmap and start a new one" workflow visible to the coach. Add:

- An "End roadmap" button on `components/clients/roadmap/roadmap-tab-content.tsx` that confirms intent, calls the existing archive path (likely via status change to `archived` rather than DELETE, since DELETE is blocked once phases have started), and then opens the existing `create-roadmap-dialog.tsx`.
- Confirmation copy makes clear the current roadmap becomes read-only history and a new one can be set up.

### Phase edit unlock for active phases

Today phase goal fields (`phase_goal_weight`, `phase_goal_body_fat_percentage`) lock once `phase.status !== 'planned'` (`components/clients/roadmap/edit-phase-dialog.tsx:50` plus server guard in `updatePhase()`). Loosen to:

- **Planned**: fully editable (current behavior).
- **Active**: fully editable (new behavior). Show a small warning banner that goal changes may affect downstream nutrition plan targets for this phase.
- **Completed / skipped**: remain read-only (history is history).

Implementation: remove the `goalsDisabled` status check for active; update the `updatePhase()` guard to allow edits on `['planned', 'active']`.

Known downstream implication: nutrition plans calculated with the old phase goal won't auto-recalculate. Flag in the confirmation; a recalc workflow is out of scope for this change.

### Archived-roadmap browsing

Today the coach can archive a roadmap but cannot view archived ones afterwards. Add a "Past roadmaps" surface to `roadmap-tab-content.tsx` (collapsible section or dropdown) that lists archived roadmaps for this client. Selecting one renders its phases read-only — same component as the active roadmap's phase list, but nothing is editable. Archived phase goals, reflections, and summaries visible for historical reference.

Backend: read endpoint needs to accept `status=archived` filter on `GET /api/clients/[id]/roadmap` (or a separate list route). No write path.

### Per-client Check-ins tab (coach side)

Today coaches review check-ins through `/check-ins/review/page.tsx` (global unreviewed queue). There is no per-client historical view — a coach wanting to see a specific client's check-in timeline has to dig through the global queue or hit the database. Add a **Check-ins** tab to `app/clients/[id]/page.tsx` positioned between **Daily Habits** and **Notes** in the tab order.

The new tab shows:
- A list of the client's check-ins (all statuses: pending, ai_processed, reviewed), newest first.
- Each row: date, status badge, AI summary preview, coach response snippet if any.
- Click a row to open full detail (same rendering pattern as the existing review page's detail modal, or a new read-only detail pane — decided during implementation).

API `/api/clients/[id]/check-ins` already supports status filtering. This is primarily a UI surface.

### Metrics page phase filter

`MetricsTabContent` today filters by date range only (7d, 30d, 90d, all time) and metric category (body vs wellness). Add phase scoping so coaches can see trends within a single phase (useful for comparing what happened during a cut vs a bulk, for example):

- Add a filter chip row or dropdown: "All time" (current default), "Active phase," plus one entry per past phase on the roadmap.
- Selecting a phase scopes all charts (body metrics, wellness, adherence) to that phase's date range.
- Works for clients with and without roadmaps; when no roadmap exists, only "All time" is available (filter is hidden or disabled).

Implementation touches `components/clients/metrics/metrics-tab-content.tsx` and its data hook (`use-metrics-data.ts`) to accept an optional phase scope and pass it through to chart date ranges.

---

## Adjacent systems touched later

Two systems are partially coupled to the old model and get addressed in Phase 6.

**Weekly check-in system**: the context API already reads events for targets but uses session-keyed `session_logs` for completion counts and `daily_logs_full` for 7-day wellness/nutrition history. Since wellness plus nutrition keep writing to the `daily_logs` spine (per-card, not monolithic), `daily_logs_full` keeps working. Training writes move to event-keyed, which fixes the ambiguous "X of Y completed" count for cloned sessions. Phase 6 scope: switch the completion count query from `session_logs` to `training_events.status`, optionally enrich the AI summary with `exercise_logs` data, UX refresh if desired.

**Needs-attention feed**: 7 of 8 signals derive from the `daily_logs` spine (wellness, nutrition adherence, logging gap, habit dropoff, logging metadata). These survive unchanged. The "training missed" signal already reads `training_events`. The "activity-calorie mismatch" signal currently reads `training_logs.trained`. The rewire happens as part of Phase 1 (no denormalized flag ever; Phase 7 removed).

---

## Timezone handling

### Current state (as of Session 0.1 audit)

- **No client timezone column exists.** The `clients` table has no `timezone` / `time_zone` column in any migration under `supabase/migrations/`, and no `timezone` field appears in `types/`, `lib/mappers.ts`, or the client-service layer.
- **"Today" is computed in server-local time.** All date helpers in `lib/date-helpers.ts` (`getTodayDateString`, `getTomorrowDateString`, `getDateString`, `getDateDaysAgo`, `getDateDaysFrom`, `calculateCheckInPeriod`, `getCheckInStatus`) derive the current day from `new Date()` using the Node process's local timezone. There is no client-timezone parameter anywhere in the helper signatures.
- **Check-in period gating uses server day.** `calculateCheckInPeriod()` calls `checkInDate.getDay()` on a server-constructed `Date`, so the 7-day window endpoints collapse to the server's perception of "today." Same for `getCheckInStatus()`.
- **Downstream impact.** `services/client-check-in-service.ts:50-70` resolves the AI summary period via server-local dates; `daily-logs` reads/writes, training week start (`getTrainingWeekStart`), and the attention feed's "today" comparisons all inherit this.

In practice, on Vercel (UTC process timezone), "today" rolls over at 00:00 UTC for every client regardless of where they live. A client in PST sees their Sunday check-in close at 4 PM Saturday local; a client in AEDT sees theirs open a day early.

### Decision for the redesign

The redesign's past-day lock (home view, detail-page edits, server-side `assertCanEdit`) requires a stable, client-local definition of "today." Using server UTC would let a client in PST edit "tomorrow" for eight hours after midnight local.

**Add a `timezone` column (TEXT, IANA zone e.g. `"America/Los_Angeles"`, NOT NULL, default `"UTC"`) to `clients`.** Migration lands in **Session 0.3**. The Settings page (Session 5.x) surfaces a timezone selector. The `canEditDay()` and `assertCanEdit()` helpers in `lib/daily-log-permissions.ts` take `clientTimezone` as an argument; `resolvePlanContextForDate` and every new client portal endpoint read the client's timezone and derive "today" via `Intl.DateTimeFormat(timezone, ...)` rather than `new Date()`.

Pre-activation fallback: if `clients.timezone IS NULL` (legacy rows before backfill) or defaults to `"UTC"`, the helper uses UTC — acceptable because pre-launch there are no users, and the Settings UI prompts the client to confirm their zone during walkthrough.

No runtime code outside `lib/date-helpers.ts` + the new permission helpers should reconstruct timezone math; they are the only surfaces that own `Intl.DateTimeFormat` calls.
