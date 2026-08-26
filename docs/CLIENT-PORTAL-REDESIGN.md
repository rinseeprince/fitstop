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
- **No workout detail.** `exercise_logs` (migration 027, columns `actual_sets`, `actual_reps`, `actual_weight`, `notes`) has no write path or UI. (Its `weight_unit` column was dropped by migration 141 — loads are canonical kilograms.)
- **Architecture drift.** `docs/ARCHITECTURE.md` states events are the source of truth. The coach calendar follows this; the client portal does not.
- **Known date bug** (TECHNICAL-DEBT.md): `saveUnplannedActivities` uses `new Date()` instead of the selected date. Past and future logging is already broken.
- **Duplicate type definitions** (TECHNICAL-DEBT.md): `TodaysActivity`, `UnplannedActivity`, `HabitLogWithDetails` repeated across 4 to 5 files.

---

## Target shape

### Home (`/client?date=YYYY-MM-DD`, today by default)

A compact summary of the selected day. The layout:
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

The client's current training plan + nutrition plan cards, reached via the Program tab in the bottom nav. Read-only.

### Navigation structure (bottom tab bar)

The client portal gets a persistent bottom tab bar (native-app feel) with five destinations:

1. **Home** (`/client`): the day view with summary cards.
2. **Check-in** (`/client/check-in`): the weekly check-in hub — submission form when a check-in is in window, plus a list of past check-ins with drill-down detail. The tab badge hints when a check-in is in window.
3. **Program** (`/client/program`): the read-only plan view (training + nutrition cards).
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
- **Unit preference**: `unit_preference` toggle (metric/imperial) — the ONLY unit control. The separate `weight_unit` toggle specified here was never built and the column is gone (migration 141); storage is canonical kg/cm and this preference only decides what the client is shown.
- **Reminder preferences**: `reminder_preferences` JSONB (fields already defined in the `ReminderPreferences` type; surface relevant toggles).
- **Timezone**: if Session 0.1 identifies it as missing, add a timezone selector here; the save endpoint writes to the column added in prep.
- **Sign out** button.

Out of scope for v1: avatar upload, password change (uses Supabase auth flow elsewhere), notification channel management beyond what `reminder_preferences` exposes.

New endpoint: `PATCH /api/client/settings` with zod validation for the supported fields.


## Fetch pattern: click-through

### Home endpoint (lightweight)

`GET /api/client/day-summary?date=YYYY-MM-DD` returns:
```
{
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
- `GET /api/client/training-plan` + `GET /api/client/nutrition-plan`: the Program tab's plan cards.

### Coach drill-down

`GET /api/clients/[id]/training/session-logs/[sessionLogId]`: full session log plus exercise logs plus prescribed snapshots. Powers the new session drill-down dialog on the client training history table.

### Write endpoints

- `POST /api/client/training/events/[eventId]/log`: bulk write of `session_logs` plus `exercise_logs` including `prescribed_session_snapshot` and `prescribed_exercise_snapshot`. Updates `training_events.status`. Cascades nutrition.
- `PATCH /api/client/daily-logs/[date]/nutrition`: kcal plus macros on `nutrition_logs`.
- `PATCH /api/client/daily-logs/[date]/wellness`: wellness fields on `wellness_logs`.
- Habits continue to use existing habit-log endpoints.

All write endpoints populate the child `*_plan_id` links from the authoritative plan for that date. All write endpoints enforce the past-day lock (see below) server-side.

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

### Alternative session logging

Clients sometimes train differently from what the coach prescribed: doing a different session on a planned day (a swap), or training on a prescribed rest day. The legacy Daily Pulse supported this via a session picker that wrote a flag in `training_logs.training_data` JSONB. The new event-keyed architecture supports the same behavior natively, without the JSONB cache.

**Two scenarios, one rule:**

- **Planned-day swap.** Monday is Push Day in the plan; the client decides to do Pull Day instead. They open the training detail page (the prescribed Push event) and tap "Do a different session" → picker shows other active-plan sessions → they pick Pull. The detailed-mode tracker rebinds to Pull's prescribed exercises; the save submits `performedSessionId = Pull.id` against Monday's event.
- **Rest-day training.** Wednesday is a rest day in the plan; the client wants to train anyway. They tap the rest-day card on home → picker shows active-plan sessions → they pick Pull. The detail page renders the tracker bound to Pull. Save submits to an event-less endpoint with `date` and `performedSessionId`.

**The matcher.** Every `session_log` write attempts to link to a prescribed `training_event` in the same training week:

1. Unlinked event with the same `training_session_id` as `performedSessionId`, earliest date in week. Catches "missed Tuesday's Pull, did it Wednesday" — Tuesday's event flips to `completed` via Wednesday's log.
2. Unlinked event on the same date as `completed_at`, regardless of session_id. Catches planned-day swap — Monday's Push event flips to `completed` via Monday's Pull log.
3. Any unlinked event of same `training_session_id` in the week. Catches "did Pull early before Tuesday."
4. No match. The log stays with `training_event_id IS NULL` — a truly-extra session that doesn't affect prescribed-completion counts.

An event is matchable when `status IN ('scheduled','missed','skipped')` and `session_log_id IS NULL`. `completed` and `partial` events are already linked and not re-matched.

**Snapshot semantics for swap (Option A).** Two snapshot fields carry different sources to preserve both stories:

- `session_log.prescribed_session_snapshot`: derived from the **matched event's** `training_session_id` (the calendar prescription — Push in the swap case). For unmatched extras, derived from the chosen session.
- `exercise_logs[].prescribed_exercise_snapshot`: always derived from the **chosen session's** exercises (Pull's prescription for each exercise the client performed).

The coach drill-down reads both: "Prescribed Push Day on Monday. Client performed Pull Day. Here's Pull's prescription per exercise vs. their actual sets."

**Day-view affordance (option B).** When `session_log.completed_at` differs from the linked `training_event.date` (e.g. rest-day-trained that caught up Tuesday's missed Pull on Wednesday), the day-view for the day the client actually trained shows a slim "Trained for {weekday} {session.name}" line. Restores the "where I physically trained" signal without confusing the calendar.

**Picker scope — narrowed 2026-08-26.** THIS WEEK's sessions only (`GET /api/client/training/week`), each with its weekday and state, because that is exactly the set a pick can act on: the session **moves** (rest day) or **swaps** (prescribed day) onto the day being logged. **Only sessions that can still be done are offered** — Today, Upcoming, Missed-but-still-scheduled; a done or skipped session has nothing left to do and is never listed (owner decision 2026-08-26 — offering it again only invited a duplicate log). The decision is one pure kernel, `lib/session-pick.ts`, shared by both entry points. It used to list every slot of the whole program — no day, no state — so a pick from week 6 logged week 6's prescription against a week-1 rest day. No freehand entries, no library browsing, no externally-defined workouts. `components/client-portal/training/session-picker.tsx`.

**What does NOT change:**

- **The calendar (coach-side) — REVERSED 2026-08-26 (owner decision).** A client may now rearrange their own week: `POST /api/client/training/events/layout` moves still-scheduled sessions between days (a swap is a two-entry layout) in one transaction (`move_training_events_atomic`, migration 150), bounded to the training week each session currently sits in. The coach calendar shows the result with the same edited badge a coach move sets. *Logging* still never mutates a prescription — only a move does, and only the client's own.
- **Adherence math.** Counts `training_events.status='completed'` in the period. Swaps and rest-day-trained-that-matched both flip status to completed, so both count. Truly-extra rest-day logs (no match) do not count — they are surplus training, not prescribed completion.
- **Nutrition cascade — REVERSED for moves 2026-08-26 (owner decision).** A client move cascades nutrition over every day it touched, so the training-day surplus follows the session to the day it is actually done; a day the client has already logged shows the refreshed target at their next food save (the snapshot is re-taken from the current event on every save). Log writes themselves still do not cascade.

**Coach surfacing.** The data tab (training history table) renders an "Alternative" badge on rows where `is_alternative = true` (the column is already computed and returned by the API; just unused in the current UI). The session-log detail dialog adds a session-level "Prescribed X · Performed Y" header above the existing per-exercise prescribed-vs-performed view. Neither the calendar nor any other coach surface changes.

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

**Habits lock per-habit, not per-day.** Nutrition/wellness are saved as one day record, so "logged" is the existence of any child row that day. Habits are toggled individually (each toggle is its own write), so `assertCanEdit`/`getDayEditState` accept an optional `habitId` that narrows the "logged" check to a single habit. This keeps the documented "past day, never logged: editable" backfill working for habits (fill in a missed day habit-by-habit), while each habit still locks once recorded. The pure `canEditDay` rule is unchanged; only what counts as "logged" is narrowed.

Same pattern for plan context: `resolvePlanContextForDate(clientId, date): { nutritionPlanId, trainingPlanId }` is the single function every write endpoint calls to populate the `*_plan_id` links. Do not duplicate this query per endpoint.

---

## Roadmap and phase awareness — REMOVED

Roadmaps/phases were removed entirely on 2026-07-25 (rebuild post-launch; the shipped design lives in git history, tag `roadmap-v2-pre-removal`). The phase banner, `/client/program` roadmap view, and `PhaseCompletionCard` this section specified no longer exist; the Program tab now shows the plan cards only.

---

## Viewer-relative unit display — ⊘ SUPERSEDED, spec removed

This section specified render-time conversion over per-record `weight_unit` tags,
with **no canonical-storage migration**. That was built the other way and shipped
2026-08-07 in migrations 140 + 141. The rule is `CONVENTIONS.md` §20 Units.

Its premise was that every record carries a trustworthy unit tag. It does not —
`set_logs` (236k weight rows) and `client_metric_entries` never had one, and the
tag that did exist was inferred from a mutable column, so flipping a preference
relabelled history. Render-time conversion cannot work on data that does not know
what it is.

**What shipped instead:** storage is canonical kilograms and centimetres, every
unit-tag column is dropped, the preference lives on the VIEWER (coach and client
each own theirs), and conversion happens only at the render boundary — not at the
API boundary. Formatters take `(value, viewerPreference)`, not a per-record unit.

**The current rule is `CONVENTIONS.md` §20 Units.** Read that, not this. Phase 8
of `CLIENT-PORTAL-EXECUTION-PLAN.md` (Sessions 8.1-8.3) is superseded with it.

## Why fix web before mobile

1. **API contract is what mobile consumes.** Ship the right contract once. Changing it later means coordinating web, iOS, and Android simultaneously (forced updates, dual-write, data migration).
2. **Day-centric swipe UX is the mobile UX.** Validating it on web before writing it natively saves a rebuild.
3. **Data is already day-keyed.** `training_events`, `nutrition_events`, `daily_logs` with children, `daily_habit_logs` are all date-partitioned. The redesign is primarily a UI plus API-shape change. (The weight-unit column anticipated here went the other way: migrations 140 + 141 made storage canonical kg/cm and DROPPED every unit-tag column.)
4. **Detailed workout logging is a mobile-first feature.** Clients log sets on their phone. Shipping empty `exercise_logs` to mobile launch means that surface has no implementation at all.

---

## Existing assets to reuse

- `services/training-event-service.ts`: `getEventForDate`, `linkSessionLogToEvent`, `mapCompletionQualityToEventStatus`.
- `lib/date-helpers.ts`: `getTodayDateString`, `getTrainingWeekStart`, `getDateString`. Replace every `.split('T')[0]` with `getDateString`.
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
- `components/client-portal/day/day-header.tsx`: date nav.
- `components/client-portal/day/training-card-summary.tsx`, `nutrition-card-summary.tsx`, `wellness-card-summary.tsx`, `habits-card-summary.tsx`.
- `components/client-portal/day/locked-day-notice.tsx` (single component with a `reason` prop; do not split into variants).
- `components/client-portal/training/set-tracker.tsx`, `exercise-tracker-block.tsx`, `set-row.tsx`.
- `components/clients/training/session-log-detail-dialog.tsx` (coach-side).

Settings form: starts as a single `app/client/settings/page.tsx`. A `components/client-portal/settings/` subdirectory is only created if the page blows past the 250-line limit. No speculative form component splits.

No `useClientDay` hook. `useSWR` is called directly in the page. Only create a wrapper hook if it grows actual reusable logic (retries, transforms, dependent fetches).

### Retired (pre-launch, no users exist)

- `app/client/dashboard/page.tsx` (Daily Pulse landing).
- `components/daily-pulse/*`.
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
- **Brand-new client**: pre-activation uses existing `client-waiting-state.tsx`. Post-activation with no plans yet: empty states per card ("Your coach is preparing this").
- **Weight unit**: storage is canonical kilograms; there is no per-record unit. `clients.unit_preference` decides what the client is SHOWN, and the log form converts on submit. See `CONVENTIONS.md` §20.
- **Rate limits**: two-tier (Session 3.10). Tier 1 is a loose IP burst guard (~1000 req / 10s, abuse-only) that runs first; tier 2 is a tight per-client limit (30 req / 10s, keyed by client id, applied post-auth). Bulk-replace save pattern keeps realistic workouts well under the per-client tier. No per-set writes. See "Scale conventions → Two-tier rate limiting" below and CONVENTIONS §9.
- **Coach drill-down payload**: a large workout is around 40 `exercise_logs` rows. Fine at this scale.

---

## Deliberate reversals of existing documented principles

1. **"No auto-save" principle (old Daily Pulse rule).** Per-card independent saves replace the monolithic "Log Day" button. This reversal is intentional and reflected in `docs/ARCHITECTURE.md` (the principle is removed there).

---

## Coach-side improvements (bundled into this effort)

Several coach-side gaps surfaced during planning and are bundled because they touch the same domain and benefit from the same under-the-hood changes.

### Roadmap flows — REMOVED

The roadmap end-and-replace flow and the active-phase goal-edit unlock this section specified shipped (Sessions 7.1/7.2) and were then deleted with the roadmaps/phases removal (2026-07-25). Their specs live in git history (tag `roadmap-v2-pre-removal`).

### Per-client Check-ins tab (coach side)

Today coaches review check-ins through `/check-ins/review/page.tsx` (global unreviewed queue). There is no per-client historical view — a coach wanting to see a specific client's check-in timeline has to dig through the global queue or hit the database. Add a **Check-ins** tab to `app/clients/[id]/page.tsx` positioned between **Daily Habits** and **Notes** in the tab order.

The new tab shows:
- A list of the client's check-ins (all statuses: pending, ai_processed, reviewed), newest first.
- Each row: date, status badge, AI summary preview, coach response snippet if any.
- Click a row to open full detail (same rendering pattern as the existing review page's detail modal, or a new read-only detail pane — decided during implementation).

API `/api/clients/[id]/check-ins` already supports status filtering. This is primarily a UI surface.



---

## Adjacent systems touched later

Two systems are partially coupled to the old model and get addressed in Phase 6.

**Weekly check-in system**: the context API already reads events for targets but uses session-keyed `session_logs` for completion counts and `daily_logs_full` for 7-day wellness/nutrition history. Since wellness plus nutrition keep writing to the `daily_logs` spine (per-card, not monolithic), `daily_logs_full` keeps working. Training writes move to event-keyed, which fixes the ambiguous "X of Y completed" count for cloned sessions. Phase 6 scope: switch the completion count query from `session_logs` to `training_events.status`, optionally enrich the AI summary with `exercise_logs` data, UX refresh if desired.

**Needs-attention feed**: 7 of 8 signals derive from the `daily_logs` spine (wellness, nutrition adherence, logging gap, habit dropoff, logging metadata). These survive unchanged. The "training missed" signal already reads `training_events`. The "activity-calorie mismatch" signal currently reads `training_logs.trained`. The rewire happens as part of Phase 1 (no denormalized flag ever; Phase 7 removed).

---

## Scale conventions (Sessions 3.8-3.10)

The data/API layer is where scale work is invested (the web app is a test harness; the native client is the real consumer). These conventions emerged across Sessions 3.8-3.10.

### Bounded AND keyset by default

Scoped to **paginated, time-ordered "load older" history streams** — not a blanket mandate to bolt a cursor onto every small full-return set. The keyset contract (opaque base64url `{createdAt, id}` via `lib/cursor.ts`, established Session 3.7) is the right tool when a list is genuinely unbounded and deep-paged. Per-endpoint judgment, with the calls actually made:

- `/api/client/habits` — a client's small set of assigned habits. **Full return**; no cursor.
- `/api/client/training/completions` — a fixed 1-week window. **Bounded by the window**; no cursor.
- `getClientExerciseList` — a frequency-sorted, distinct `GROUP BY` over a client's logged exercises, bounded by exercise *variety* (not history depth). **Left as a bounded full return.** Convert to keyset only if a genuinely unbounded/deep-paged list appears here; none did.
- `/api/client/check-ins` — the one genuinely deep history stream: keyset-default, `?offset=` legacy.

### Render-ready payloads / server-side aggregation

The API emits **display-ready, locale-neutral series**: ISO dates on the wire (`YYYY-MM-DD`), the client formats at render (e.g. date-fns `"MMM d"` in the chart card). Aggregation/trend/percent-change math is computed server-side (or in a shared pure helper, `utils/metric-shaping.ts`); the browser transform hooks (`use-client-progress-metrics`) are **thin readers** of the already-shaped arrays. This keeps the native client free of duplicated transform logic and locale assumptions.

### Index-with-the-query

Every keyset/delta read ships its index in the **same migration** that introduces the read: 094 (exercise analytics window), 095 (check-in keyset index + streak RPC), 096 (exercises `updated_at` trigger + `idx_exercises_updated_at` for the catalog delta).

### ID-first rows + catalog delta-sync

History/list rows carry `exercise_id` (+ a `performed_name` fallback for legacy name-only rows), **never** the catalog dictionary (`muscle_group`, `equipment`, `aliases`, `category`). The dictionary is synced separately via `GET /api/client/exercises/catalog?since=`, keyed on `updated_at`.

**Removal contract.** The delta is **UPSERT-ONLY** (`updated_at > since`). Hard-deletes (`ON DELETE CASCADE` when a coach is removed) and `coach_id` scope-changes (a row leaving a client's visible set) are **invisible to a delta** — there is no row to carry a newer `updated_at`. The native client therefore reconciles deletions/scope-exits by doing a periodic **FULL resync** (omit `since`): on cold start and/or every N days. Tombstones (a `deleted_at` column returned in the delta) are the documented escalation **if/when** deletes become frequent enough that the periodic full resync is too coarse.

**Complete by construction (1000-row cap).** PostgREST caps a single response at ~1000 rows, and the visible catalog (globals + coach) already exceeds it (1512 rows on the scale fixture — the first cut of this endpoint silently dropped ~500). So `getExerciseCatalogDelta` **pages internally** on a tie-safe keyset cursor `(updated_at, id)` and concatenates until a short page ends it; the returned delta is always complete regardless of size, and the client contract stays the simple `?since=<ISO>` (the dictionary is a full-return set, not a cursor-streamed history). The `id` tiebreak is **required**: the catalog is seeded in batches that share an `updated_at`, so paging on `updated_at` alone would skip tied rows (strict `>`) or loop forever (`>=`).

### Sparse fieldsets / narrow RPC rowtypes

Select only the columns the renderer needs. The catalog delta returns **5 columns** (`id, name, muscle_group, equipment, updated_at`), not `SELECT *`. RPC rowtypes are likewise narrowed to the post-aggregate shape the caller consumes.

### Two-tier rate limiting (Session 3.10)

- **Tier 1** — a loose IP burst guard (~1000 req / 10s, abuse-only). Mandatory first operation in the auth chain; it exists to absorb obvious flooding, not to shape normal usage. **It is a coarse pre-auth backstop, not a tuned DoS control.** Primary throttling is Tier 2; real volumetric/DoS protection is deferred upstream (the Vercel/Cloudflare edge). The cap is a starting point and is **tunable at scale**: if thousands of legitimate users ever sit behind a single carrier-grade NAT IP, ~1000/10s will begin clipping them, and the correct fix is upstream edge protection plus raising (or removing) this cap — **do not read the number as a precise security control.**
- **Tier 2** — a tight per-client limit (30 req / 10s), keyed by **client id**, applied **post-auth** in `require-client-auth` (the client id is only known after `getAuthenticatedClientId`). This is the real per-user throttle. The per-client tier **composes on top of** any first-tier override.

Cross-ref CONVENTIONS §9.

### Auth-resolution cache (Session 3.8)

A short-TTL (60s) Upstash cache of `user_id -> client id`. `getUser()` still runs **every request** (only the `clients` lookup is cached, not the Supabase session verification). Invalidation is **TTL-only**. The `{id, checkInDay}` variant is also cached, with a benign `<=60s` propagation delay if a coach changes the client's check-in day — that only shifts a *computed* training/nutrition week boundary; **no submission or gating route depends on it**, so the staleness is safe.

---

## Timezone handling

### The locked model (Sessions 7.81–7.84)

**"Today" is always computed in the device timezone of the person whose calendar the date is on — never the server's UTC clock.** Almost always that is the person making the request (a client on their own day; a coach on their own dashboard). The only cross-person cases — a coach viewing a client's check-in due/overdue, and background reminders — use the **client's** timezone. There is no separate "client logic vs coach logic"; the one question is: *whose calendar is this date on?* → read that person's stored, device-synced timezone via `getTodayDateStringInTimezone()`.

### Device-synced capture (Session 7.81)

Both roles store an IANA zone — `clients.timezone` (migration 089) and `coaches.timezone` (migration 109), both `TEXT NOT NULL DEFAULT 'UTC'` — **auto-synced from the device, with no manual picker**. The shared `useTimezoneSync(scope, storedTimezone)` hook (`hooks/use-timezone-sync.ts`) compares `getDeviceTimeZone()` (the `Intl` wrapper in `lib/date-helpers.ts`) against the stored value on every app load and fires a fire-and-forget PATCH when they differ — so a traveller's zone updates on next open. Mount points: the client shell (`app/client/layout.tsx`) PATCHes `/api/client/settings`; the coach shell (`components/persistent-sidebar.tsx`) PATCHes `/api/coach/settings`.

> **This intentionally reverses Session 2.6's "no silent overwrites" decision.** 2.6 shipped a manual combobox plus an opt-in "Use detected" hint; in practice nobody set it, every client stayed on the `'UTC'` default, and every date feature silently ran on server UTC. The device already knows the right answer — we capture it. The Settings page now shows the zone read-only ("synced from your device").

A stored `'UTC'` is the "never device-synced" sentinel: server code that must anchor to a client's calendar before that client has ever opened the portal (coach-initiated plan placement) falls back to the **coach's** timezone, then UTC. (That fallback ships in Session 7.82's `getClientTodayString`; until then placement still judges against server UTC.)

No runtime code outside `lib/date-helpers.ts` should reconstruct timezone math — it is the only surface that owns `Intl.DateTimeFormat` calls. (Sanctioned exception: the client/coach settings routes call `Intl.supportedValuesOf("timeZone")` for IANA *validation*, which is not date math.)
