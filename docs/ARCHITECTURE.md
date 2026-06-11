# CoachHub Architecture Reference

This file documents the platform architecture, database schema, and data flow patterns. Unlike CONVENTIONS.md (which contains stable coding rules), this file evolves with the schema. **Update it when shipping migrations.**

> ⚠️ **Legacy-section map — read before trusting any section below.** A client-portal redesign is in flight (`docs/CLIENT-PORTAL-REDESIGN.md` + `docs/CLIENT-PORTAL-EXECUTION-PLAN.md`). Several sections here describe patterns that are already retired or scheduled to change. **Precedence rules:** where this file and the redesign docs disagree about a client-portal write path or data flow, **the redesign docs win**; where this file and **CONVENTIONS.md** disagree about a coding/auth rule, **CONVENTIONS.md wins** (it is the stable rule-of-record; this file lags it).
>
> | Section | Status | Authoritative source |
> |---------|--------|----------------------|
> | Auth Model → "Database clients" | **Legacy** — described the old session-scoped-default model. The codebase is on **Shape B**: services default to `supabaseAdmin`, the route layer is the security perimeter, RLS is defense-in-depth. Corrected inline below. | **CONVENTIONS.md §8** |
> | "JSONB Conventions" (`training_data`/`activityStatuses`) | **Orphaned cache** — legacy `training_logs` rows only; no active read/write path. | redesign docs |
> | "Activation Flow" · "Training Completion Hierarchy" (`session_logs` identity) | **Accurate / landed** — `session_logs` event-keyed identity shipped (migration 097, Session 5.2); the onboarding walkthrough was reworked for the day-centric portal (Session 6.1). | this file |

---

## Platform Overview

CoachHub is a fitness coaching platform built with Next.js 14 (App Router). It connects two user types:

- **Coaches** (role: `trainer`) - manage clients, create training/nutrition plans, review check-ins, monitor wellness alerts. Dashboard at `/dashboard`.
- **Clients** (role: `client`) - track daily wellness, log workouts (per-set), manage nutrition, and complete weekly check-ins via the day-centric client portal. Home at `/client` (date-driven day view; see Client Portal Architecture).

**Tech stack:** Next.js 14, Supabase (PostgreSQL + RLS + Auth), SWR (coach-side), Upstash Redis (rate limiting), OpenAI GPT-4o / GPT-4o-mini (AI summaries, training generation), Vitest, Tailwind CSS, shadcn/ui, Lucide icons, Framer Motion.

---

## Data Hierarchy

```
coaches
  ├── coach_saved_plans             -- library plan templates (status: draft/saved)
  │     └── coach_saved_sessions    -- reusable sessions (saved_plan_id NULL = standalone)
  │           └── coach_saved_exercises  -- exercise_id FK to exercises catalog
  │
  └── clients                        -- coach_id FK, one coach per client
        ├── roadmaps                  -- opt-in, one active per client
        │     └── phases              -- time-bound strategy blocks
        │           ├── training_plans   -- phase_id FK (nullable)
        │           ├── nutrition_plans  -- phase_id FK (nullable)
        │           └── daily_habits     -- phase_id FK (nullable)
        │
        ├── training_plans            -- can exist without roadmap (phase_id = null); saved_plan_id FK tracks library provenance (nullable)
        │     ├── training_sessions   -- carries calorie_surplus_percentage (source for nutrition cascade)
        │     │     └── training_exercises  -- exercise_id FK to exercises catalog
        │     └── training_events        -- one row per session per date (calendar SOT)
        ├── nutrition_plans           -- can exist without roadmap (phase_id = null)
        │     └── nutrition_events       -- one row per client per date
        │
        ├── exercises (catalog)          -- two-tier: global (coach_id=NULL) + coach-specific
        ├── daily_habits              -- can exist without roadmap (phase_id = null)
        │
        ├── daily_logs (spine)        -- one per client per day
        │     ├── wellness_logs
        │     ├── nutrition_logs
        │     ├── training_logs
        │     │     └── session_logs
        │     │           └── exercise_logs
        │     │                 └── set_logs   -- per-set actuals (reps, weight, rpe)
        │     └── daily_habit_logs
        │
        ├── check_ins                 -- weekly structured submissions
        ├── client_goals              -- versioned goal records
        └── body_metrics              -- immutable measurement events
```

### Roadmaps are opt-in

Clients without roadmaps work exactly as before: plans link to `client_id` directly with `phase_id = NULL`. When a coach creates a roadmap for a client, new plans must be linked to a phase via `requirePhaseSelection()` middleware (`lib/require-phase-selection.ts`). This enforces that if an active roadmap exists, the coach must select a planned or active phase when creating a training plan, nutrition plan, or habit.

---

## Roadmap/Phase Architecture

```
roadmaps              -- long-term goal container, one active per client
  └── phases           -- time-bound strategy blocks (planned/active/completed/skipped)
        ├── training_plans  -- linked via phase_id (nullable, backward compat)
        ├── nutrition_plans -- linked via phase_id (nullable, backward compat)
        └── daily_habits    -- linked via phase_id (nullable, backward compat)
```

### Roadmaps

- Status lifecycle: `active` / `archived` / `draft`
- Unique index enforces one active roadmap per client
- ON DELETE RESTRICT prevents hard-deletion (forces archival instead)
- Fields: `name`, `long_term_goal`, `started_at`, `target_end_date`

### Phases

- Status lifecycle: `planned` / `active` / `completed` / `skipped`
- Unique index enforces one active phase per roadmap
- `order_index` controls display order within a roadmap
- `phase_goals_snapshot` JSONB captures the client's goal state at phase creation time
- `phase_goal_weight` (NUMERIC, nullable) - phase-specific goal weight in kg. NULL = fall back to client's overall goal
- `phase_goal_body_fat_percentage` (NUMERIC, nullable) - phase-specific goal body fat %. NULL = fall back to client's overall goal
- `coach_reflection` (text) and `phase_summary` (JSONB) are written during phase transitions
- `milestones` JSONB — array of milestone objects scoped to the phase (`{id, text, completed, completed_at}`)
- `completion_seen` (boolean) tracks whether the client has dismissed the completion card

### Phase goals — phase-is-king (Session 7.8)

A single pure resolver, `resolveEffectiveGoal()` (`lib/goals/resolve-effective-goal.ts`), decides which goal drives a client at any moment. **While a phase is active it ALWAYS drives** nutrition + pace — its target weight and its start/end dates. A **NULL phase weight means maintenance**; the system does **NOT** fall back to the client's long-term goal while a phase is active. With no active phase, the long-term `client_goals` record drives (a NULL client weight is likewise maintenance).

The resolver is the **one** place display-unit weights are normalized to kg (`client_goals.goal_weight` and `body_metrics.weight` are display units; `phase_goal_weight` is already kg and passes through). Maintenance / "zero active goal" is represented purely by `goalWeightKg: null` — there is no third `source` value; `source` stays `'phase' | 'client'`.

**Resolution flow** (`resolveEffectiveGoal({ weightUnit, activePhase, clientGoal, today })`):
1. Active phase present → `source: 'phase'`, weight = `phase_goal_weight` (kg; null = maintenance), deadline = phase `end_date`, start = phase `start_date ?? today`.
2. No active phase → `source: 'client'`, weight = `weightToKg(client_goals.goal_weight)` (null = maintenance), deadline = `client_goals.goal_deadline`, start = `client_goals.goal_start_date ?? today`.

Callers: `services/nutrition-plan-orchestrator.ts` (plan creation — the active-phase guard means a present phase is the active one) and `services/comparison-service.ts` (the check-in weight pace — weight **and** deadline now come from one scope, fixing the cross-scope "Deadline unrealistic" false alarm). The nutrition response still includes `goalSource: "phase" | "client"`. `client_goals.goal_start_date` (migration 104) anchors the long-term pace window.

**Status guard**: Phase goals can only be edited while `status = 'planned'`. The guard in `updatePhase()` rejects the entire request (including non-goal fields in the same payload) if goal fields are present and the phase is not planned.

### Phase selection enforcement

`requirePhaseSelection(clientId, phaseId)` in `lib/require-phase-selection.ts`:
- No active roadmap: proceeds without phaseId (backward-compatible)
- Roadmap exists but no phaseId provided: returns 400
- Roadmap exists but zero selectable phases: returns 400
- phaseId not in selectable (planned/active) list: returns 400
- On success: returns `phaseId`, `phaseGoalWeight`, `phaseGoalBodyFatPercentage`, `phaseEndDate` from the matched phase

Called by plan creation routes (training, nutrition, habits) before the service layer.

---

## Client Goals & Body Metrics

### client_goals table

Versioned goals using the `effective_from` / `superseded_at` pattern:
- New goals are created as new rows (never update existing records)
- The previous active goal gets `superseded_at = NOW()` when a new goal is set
- Unique index ensures one active (non-superseded) goal per client
- Fields: `goal_weight`, `goal_body_fat_percentage`, `goal_deadline`, `primary_goal`, `set_by`, `notes`

### body_metrics table

Immutable event log with source provenance:
- Each measurement is a new row (no `updated_at` column - intentionally immutable)
- `source` field tracks origin: `check_in` / `metrics_api` / `intake_sync` / `nutrition_plan`
- `source_id` (nullable UUID) references the originating record
- Indexed on `(client_id, recorded_at DESC)` for efficient latest-first queries
- Fields: `weight`, `weight_unit`, `body_fat_percentage`, `bmr`, `tdee`

### Denormalized cache on clients table

The `clients` table retains `current_weight`, `current_body_fat_percentage`, `bmr`, `tdee` as a denormalized cache. These are updated on every body_metrics write for backward compatibility.

### Dual-write pattern

When a check-in submits body metrics (`services/client-check-in-service.ts`):
1. Updates `clients` table with new current metrics (the denormalized cache)
2. Recalculates BMR/TDEE from updated client data
3. Calls `recordBodyMetrics()` to write an immutable event to `body_metrics` (non-blocking)

### Read switch fallback

Services that read goals/metrics prefer the new tables but fall back to legacy `client.*` fields for pre-migration clients (`services/comparison-service.ts`):
```
goalWeight = currentGoals?.goalWeight ?? client.goalWeight
earliestWeight = earliestMetrics[0]?.weight ?? client.startingWeight
```

---

## Phase Transition Flow

When a coach completes a phase, the transition follows this sequence:

### 1. Review data gathering

`getPhaseReviewData()` in `services/phase-transition-service.ts` runs parallel queries (with `Promise.allSettled` for partial data tolerance):
- **Training adherence**: session_logs count vs training plan frequency_per_week across the phase date range
- **Nutrition adherence**: averaged nutrition_adherence scores from nutrition_logs (hit=1.0, partial=0.5, missed=0.0)
- **Habit completion**: daily_habit_logs completed percentage vs total expected
- **Body metrics delta**: weight/body_fat at phase start vs current (from body_metrics table)
- **Goals comparison**: phase_goals_snapshot vs current client_goals, plus phase-level goal overrides (`phaseGoals`)

### 2. Atomic RPC

`transition_phase_atomic` RPC executes in a single transaction:
- Marks current phase as `completed`, writes `coach_reflection` and `phase_summary` JSONB
- Based on `next_action` parameter:
  - `activate_next`: activates the next planned phase
  - `archive_roadmap`: archives the entire roadmap
- Based on `plan_handling` flags, archives or keeps training plans, nutrition plans, and habits

### 3. Client completion card

`PhaseCompletionCard` (`components/client-portal/day/phase-completion-card.tsx`):
- Fetches via SWR from `GET /api/client/phase-completion` (queries phases where `status='completed'`, `phase_summary IS NOT NULL`, `completion_seen=false`)
- Displays: phase name, coach reflection, summary stats (training %, nutrition %, weight change), next phase name
- On dismiss: `POST /api/client/phase-completion` sets `completion_seen = true`

---

## Daily Logs (spine + child tables)

Daily tracking data is split into a spine table and domain-specific child tables:
```
daily_logs (spine)         -- id, client_id, date, notes, phase_id
  ├── wellness_logs        -- mood, energy, sleep, stress (1:1 via daily_log_id FK)
  ├── nutrition_logs       -- consumed, targets, adherence (1:1 via daily_log_id FK)
  ├── training_logs        -- trained, training_session_id, training_data JSONB (legacy/orphaned) (1:1 via daily_log_id FK)
  └── daily_habit_logs     -- per-habit completion (1:many, FK to daily_habits)
```
- **Writes**: per-card independent writes. Each per-card endpoint (`PATCH /api/client/daily-logs/[date]/nutrition`, `/wellness`, and similar) ensures the day's `daily_logs` spine row exists (setting `phase_id`) and upserts only its own child table. (The old monolithic `/api/client/daily-logs` POST and its `today`/`streak`/`nutrition-target`/`week` siblings were removed in Session 5.1; the `upsert_daily_log_atomic()` RPC remains in the DB as an unused function — its removal is separate schema work — and must not be used for new writes.)
- **Domain-specific reads** query child tables directly (e.g. wellness history queries `wellness_logs`, not the view)
- **Cross-domain reads** use the `daily_logs_full` view (e.g. attention feed, AI summary generation)
- Each child table has `client_id` and `date` columns for direct querying without joining the spine
- Phase linkage for nutrition/training logs is derived via plan FKs: `nutrition_logs.nutrition_plan_id` -> `nutrition_plans.phase_id` -> `phases`. The spine (`daily_logs`) retains `phase_id` for direct phase context.
- The `DailyLog` TypeScript type remains flat. The split is DB + service layer only. Hooks, components, and utils are unaffected

---

## Nutrition & Training Events

Concrete calendar events materialize plan templates into per-date rows:

```
training_events    -- one row per training session per date
nutrition_events   -- one row per client per date
```

Events are the **source of truth for date-specific targets**. Plan templates (`nutrition_plan_daily_targets`, `training_sessions`) are blueprints used to generate events, not for display.

### Training event fields
- `training_session_id` FK (SET NULL on delete, preserves events when sessions removed)
- `session_name`, `session_focus` - snapshotted at creation, survive template renames
- `estimated_calories` - from the session template
- `is_modified` - true when manually moved/duplicated via the calendar UI. Regeneration preserves modified events by default (`force = false`); coaches can override with `force = true` after a warning dialog
- `status`: `scheduled` / `completed` / `partial` / `missed` / `skipped`
- Unique constraint: `(client_id, training_session_id, date)` partial index where `training_session_id IS NOT NULL`

`training_sessions.calorie_surplus_percentage` (NUMERIC, nullable) is the source the nutrition cascade reads when materializing surplus onto nutrition events. Rest-day sessions have NULL.

### Nutrition event fields (percentage-surplus model, post-LIB-2)
- `baseline_calories` - plan's rest-day target, frozen at event creation
- `calorie_surplus_percentage` (NUMERIC, nullable) - read from the training session assigned to that date (e.g., 15 for +15%). NULL on rest days
- `training_burn_calories`, `external_burn_calories` - **deprecated**; 0 on new events, legacy values preserved on pre-LIB-2 events for backward compat
- `protein_g`, `carb_g`, `fat_g` - baseline macros (protein fixed; extra calories redistribute to carbs/fats per `diet_type` via `calculateDailyMacros()`)
- `diet_type` - snapshotted from plan, enables display-time macro recalculation when `include_activity_burn` is on
- `is_training_day` - derived from training events on that date
- `status`: `scheduled` / `logged` / `missed`

**Display total**: `baseline * (1 + surplus/100)` when `include_activity_burn` is on, else `baseline`. The toggle does not require event regeneration.

### Event lifecycle
- **Generation paths** (training):
  1. AI generator or manual builder → draft in coach library (`coach_saved_plans.status = 'draft'`) → coach previews and edits on full-page editor → place from any start date with cycle-aware placement
  2. Library plan → apply or drag onto calendar (creates fresh client-side `training_plans` + `training_sessions` + `training_exercises` + `training_events`)
  3. Library session → drag individual saved session onto a specific calendar day
  4. Direct plan creation via the legacy builder (still supported)
- **Generated** when a plan is created or regenerated
- **Cascaded** when training events change (training day swaps trigger nutrition event regeneration via `regenerateFutureNutritionEvents`)
- **Frozen once past** - only future `scheduled` events are deleted/regenerated. Past events and non-scheduled statuses are preserved
- **Calendar operations** (training events only): coaches can move events to different dates, duplicate individual events, and duplicate entire weeks. Duplicate-week clones sessions + exercises so each week is independent. Moved/duplicated events get `is_modified = true`

### Training → Nutrition cascade
- Training event changes invoke `regenerateFutureNutritionEvents()`. Nutrition events read `calorie_surplus_percentage` via `training_event.training_session_id` → `training_sessions.calorie_surplus_percentage`.
- Only future `scheduled` nutrition events are replaced; `logged` / `missed` events are immutable.
- Baseline is preserved across a cascade — only `calorie_surplus_percentage` and `is_training_day` change.

### Read priority for nutrition targets
1. **Logged days**: `nutrition_logs.target_calories` (snapshot written at log time, authoritative)
2. **Unlogged days with event**: `nutrition_events` row for that date (primary path since NE-3)
3. **Unlogged days without event**: template fallback via `getPlanTargetForDateFromTemplate()` for pre-backfill dates or coverage gaps

---

## Training Completion Hierarchy

```
training_logs            -- did the client train today? (1:1 per day, child of daily_logs)
  └── session_logs       -- one row per logged session, keyed to a training_event (renamed from client_session_completions)
        └── exercise_logs    -- per-exercise metadata (renamed from client_exercise_completions)
              └── set_logs   -- per-set actuals (added in migration 090)
```
### Event-keyed identity (migration 097, Session 5.2)
- `session_logs` is keyed by **`training_event_id`** (FK → `training_events`, `ON DELETE SET NULL`), with a partial unique index `session_logs_training_event_id_key ON (training_event_id) WHERE training_event_id IS NOT NULL`. The old session-week composite `UNIQUE(client_id, training_session_id, week_start_date)` is **dropped** — it silently overwrote two cycle-plan events that shared a session in one week.
- Write semantics (`services/training-log-service.ts:writeSessionLog`): if the event already has a `session_log_id` → UPDATE that row by id; else INSERT, stamping `training_event_id = event.id`. A `23505` on the partial index (concurrent submit / half-failed prior link) recovers by updating the conflicting row — never a duplicate. `linkSessionLogToEvent` writes both directions (`event.session_log_id` + status, and `session_log.training_event_id`).
- `completed_at` is the **attribution date** — `event.date` for event-keyed logs (NOT the entry day), the logged date for event-less. A late backfill therefore attributes to the prescribed day.
- `session_logs.training_session_id` holds the **performed** session. `prescribed_session_snapshot` captures the **prescribed** session (the event's session for matched logs; the chosen session for unmatched extras). Both SET NULL on delete; history preserved via the snapshot JSONB.

### Alternative-session logging (Session 5.3/5.4)
- A client can log a **different** session than prescribed (planned-day swap) or train on a **rest day** (event-less). Event-less writes go through `POST /api/client/training/session-logs` → `logTrainingSessionForDate`, which is idempotent on `(client, performed session, completed_at::date)` (range-matched) **before** running the matcher, killing retry/double-tap and matched-then-retried phantom dupes.
- **Matcher** (`findMatchingEvent`): links an event-less log to a prescribed event among unlinked events (`session_log_id IS NULL AND status IN scheduled/missed/skipped`) in the log's week — priority (1) same `training_session_id`, earliest date; (2) same date as the log, any session; (3) none. Deterministic tie-break: earliest date, then `created_at`.
- **Signals:** swap = `session_log.training_session_id != event.training_session_id`; truly-extra rest-day-trained = `session_log.training_event_id IS NULL`. The coach history table renders an "Alt" badge (`is_alternative`); the drill-down dialog shows a session-level "Prescribed X · Performed Y" line. The client day-view shows a "Trained for {weekday} {session}" line (`DaySummary.trainedFor`) when a log dated D links to an event on D2≠D.
- `exercise_logs.training_exercise_id` is SET NULL on delete (nullable). History preserved via `prescribed_exercise_snapshot` JSONB
- Snapshots are written at completion time and backfilled for existing data
- `set_logs` (migration 090) holds per-set actuals: `(set_number, reps, weight, rpe)`. Replaces the legacy scalar aggregates `actual_sets`/`actual_reps`(csv)/`actual_weight` that lived on `exercise_logs` before 090. ON DELETE CASCADE from `exercise_logs`.
- `exercise_logs.exercise_id` (added in 090) is a nullable FK to the global `exercises` catalog. Populated when the client picked an exercise from the typeahead picker (Add unplanned, Swap). NULL for prescribed-without-swap (catalog identity is reachable via `training_exercise_id → training_exercises.exercise_id`) and for freehand entries.
- `exercise_logs.performed_name` (added in 090) is the canonical display name for the logged exercise. Differs from `prescribed_exercise_snapshot.name` when the client swapped a prescribed exercise or added a freehand unplanned one. Display rule: `performed_name ?? prescribed_exercise_snapshot?.name ?? "Unknown exercise"`. This is the per-**exercise** swap (Session 1.5), independent of the per-**session** swap above.
- Session-level status: `training_events.status` maps directly from `payload.completionQuality` (full→completed / partial / skipped). Per-exercise data does NOT override the client's tap — clients have legitimate reasons to mark "complete" with partial set data.

---

## Exercise Catalog

```
exercises                    -- master catalog, two-tier ownership
  ├── training_exercises     -- client exercises reference via exercise_id FK (nullable)
  ├── coach_saved_exercises  -- library exercises reference via exercise_id FK (nullable)
  └── exercise_logs          -- per-completion catalog ref (nullable; populated for picker-selected unplanned/swap rows)
```

### Two-tier ownership
- **Global exercises** (`coach_id = NULL`) - platform-seeded, read-only for coaches. Common exercises with aliases.
- **Coach-specific exercises** (`coach_id = UUID`) - created when AI generates a novel exercise or coach manually adds one. Only visible to that coach.

### Resolution strategy
When an exercise name is encountered (AI generation, manual add, import):
1. Case-insensitive exact match on `name` (coach-specific first, then global)
2. Alias match via `aliases` text array (e.g., "DB Bench Press" matches "Dumbbell Bench Press")
3. Abbreviation normalization (DB to Dumbbell, BB to Barbell, OHP to Overhead Press, etc.) then retry steps 1-2
4. No match: create as coach-specific exercise

Batch resolution via `resolveExercises()` fetches all coach + global exercises in one query and matches in memory.

### Schema
- Unique index: `COALESCE(coach_id, '00000000-...'), LOWER(name)` - one exercise per name per coach (or globally)
- `exercise_id` FK on `training_exercises` is nullable for backward compatibility (pre-EX-1 exercises have `exercise_id = NULL`)
- ON DELETE SET NULL preserves client/library exercises if a catalog entry is removed

---

## Coach Library

The coach library is the source of reusable training templates. AI or manual generation lands here as a draft; the coach previews, edits, and either saves or places the plan onto a client calendar.

```
coach_saved_plans              -- plan templates (status: draft / saved)
  └── coach_saved_sessions     -- reusable sessions (saved_plan_id NULL = standalone)
        └── coach_saved_exercises  -- exercise_id FK to exercises catalog
```

### `coach_saved_plans`
- `coach_id` (FK), `name`, `description`
- `split_type`, `frequency_per_week`
- `status`: `'draft'` (generated, awaiting coach review) | `'saved'` (coach-confirmed)
- `cycle_length` (INTEGER) — number of days in the training cycle. Non-weekly splits like PPL+Rest are `4`
- `rest_pattern` (INTEGER[]) — which slots in the cycle are rest days (0-indexed)
- `default_surplus_percentage`, `source`, `coach_prompt`, `program_duration_weeks`

### `coach_saved_sessions`
- `saved_plan_id` (FK, nullable) — NULL means a standalone session usable for mix-and-match
- `name`, `focus`
- `order_index` — position in the cycle
- `is_rest` (BOOLEAN) — marks a rest day slot
- `estimated_duration_minutes`, `calorie_surplus_percentage`, `session_type`

### `coach_saved_exercises`
- `saved_session_id` (FK), `exercise_id` (FK to `exercises` catalog, SET NULL)
- Full prescription fields: `sets`, `reps_min`/`reps_max`/`reps_target`, `rpe_target`, `percentage_1rm`, `tempo`, `rest_seconds`, `superset_group`, `is_warmup`

### Library-first generation flow
1. AI generator or manual builder creates a `coach_saved_plans` row with `status = 'draft'` plus its sessions and exercises
2. Coach opens the full-page preview editor, tweaks sessions/exercises/surplus, then saves (sets `status = 'saved'` and creates standalone copies of each non-rest session for reuse) or discards
3. Placement creates fresh client-side rows — `training_plans`, `training_sessions`, `training_exercises`, `training_events` — from the library template. Library templates are never referenced live; each placement is a copy
4. `training_plans.saved_plan_id` FK (nullable, SET NULL) tracks which library plan was placed (provenance for analytics and reapply)

### Cycle-aware placement
`coach_saved_plans.cycle_length` + session `order_index` let placement map any start date onto the correct position. For example, a PPL+Rest plan (cycle_length=4) starting on a Wednesday places Push/Pull/Legs/Rest/Push/... from that Wednesday onward, regardless of calendar week boundaries.

### Atomic placement (migration 087)
`create_training_plan_atomic()` runs event cleanup in the same transaction as plan creation/archival. STEP 0 deletes scheduled `training_events` from `v_effective_from` onward so an outgoing plan's events cannot collide with the incoming plan. Archival of the previous `training_plan` and insertion of the new plan/sessions/events happen atomically.

### Stale drafts
EL-1 (not currently in scope) specifies a cron that deletes draft plans older than 7 days. Until then, abandoned drafts accumulate in `coach_saved_plans` with `status = 'draft'`.

---

## Client Portal Architecture

The client portal at `/client` is a day-centric, event-driven interface: the client picks a date and sees that day's prescribed training, nutrition, wellness, and habits, then logs each independently. It mirrors the coach-side event model (`training_events` / `nutrition_events` as the source of truth for date-specific targets). The web app is a **test harness** for this surface; React Native is the real client, and the `/api/client/**` subset is the RN contract. Build to the contract, not the web rendering.

### Core principles

1. **Day-centric, URL-driven.** Home is `/client?date=YYYY-MM-DD` (today by default). Date lives in the URL so back/forward and deep links work. Prev/next via arrows + horizontal swipe on touch.
2. **Event-keyed, not session-keyed.** Training reads/writes key on `training_events.id`, not `training_session_id`. This fixes the edited-clone bleed that gave the check-in an ambiguous "sessions completed" count.
3. **Per-card independent saves.** No monolithic "Log Day" button. Each detail page saves only its own domain. The old Daily Pulse "lifted state / no auto-save / single atomic write" rule is retired.
4. **Spine writes preserved.** Wellness, nutrition, and habits still write to the `daily_logs` spine children so `daily_logs_full` (read by the attention feed and check-in context) stays intact.
5. **Render-ready payloads.** The API emits display-ready, locale-neutral data (ISO dates on the wire, server-side aggregation/summaries). Clients render weights in the user's own unit preference via `formatWeight(weightKg, unitPreference)` (`utils/nutrition-helpers.ts`), a client-side display formatter. (Viewer-relative per-record weight units — a stored `weight_unit` + conversion at the API boundary — are planned Phase 8 work, not yet shipped.)

### Page / navigation structure

A persistent bottom tab bar (`components/client-portal/nav/client-nav.tsx`, `ClientBottomTabBar`) has four tabs: **Home** (`/client`), **Metrics** (`/client/metrics`), **Program** (`/client/program`), **Content** (`/client/resources`). The top bar (`ClientTopBar`) holds the logo, a notifications dropdown, and an avatar menu → **Settings** (`/client/settings`) + Sign out. Layout in `app/client/layout.tsx` (also owns the `pending_intake` onboarding gate). Check-in is **not** a tab.

- **Home** (`app/client/page.tsx`): phase banner (hidden with no active roadmap) + day-summary cards (training, nutrition, wellness, habits) and a check-in summary card. Training renders a list when multiple sessions are prescribed. `PhaseCompletionCard` surfaces on first open after a phase transition.
- **Detail pages** (each fetches only its own data): `/client/training?date=X&eventId=Y`, `/client/nutrition?date=X`, `/client/wellness?date=X`, `/client/habits?date=X`. Back returns to home with the date preserved.
- **Metrics** (`/client/metrics`, `components/client-portal/metrics/metrics-hub.tsx`): progress hub — body metrics, habit progress + streaks, and trends.
- **Program** (`/client/program`): read-only roadmap + phases. Roadmaps are opt-in — no-phase is a first-class state and the banner/program view simply hide when no active roadmap exists.
- **Check-in** (`/client/check-in`): reached from the Home check-in card (`components/client-portal/day/check-in-card-summary.tsx`) and from notifications (`actionUrl: "/client/check-in"`), not a bottom tab. The hub shows the in-window submission form (gated by `clients.expected_check_in_day` + `calculateCheckInPeriod()`) plus a newest-first history list drilling into `/client/check-in/[id]`.

### Data model

Reads/writes the existing day-keyed tables — no portal-specific schema:
- **Targets (read):** `training_events` (one row per session per date), `nutrition_events` (one per client per date).
- **Daily-logs spine + children (write):** `daily_logs` → `wellness_logs`, `nutrition_logs`, `training_logs`, `daily_habit_logs`.
- **Training completion:** `training_logs` → `session_logs` → `exercise_logs` → `set_logs` (per-set actuals). `prescribed_session_snapshot` / `prescribed_exercise_snapshot` JSONB preserve history when plans change.

### API surface

**Reads:** `GET /api/client/day-summary?date=` (home payload `{ phase, training[], nutrition, wellness, habits }`, `no-store`) · `GET /api/client/training/events/[eventId]` · `GET /api/client/daily-logs/[date]/{wellness,nutrition,habits}` · `GET /api/client/program` · `GET /api/client/training/exercise-history` (bounded full return) · `GET /api/client/check-ins` (**keyset-default**, opaque base64url `{createdAt,id}` cursor via `lib/cursor.ts`; legacy `?offset=` opt-in).

**Writes:** `POST /api/client/training/events/[eventId]/log` (bulk-replace `session_logs` + `exercise_logs` with snapshots; updates `training_events.status`) · `PATCH /api/client/daily-logs/[date]/{wellness,nutrition}` · `PATCH /api/client/settings` (`weight_unit`, `unit_preference`, `reminder_preferences`, `timezone` — IANA-validated).

Every write resolves plan context once via `resolvePlanContextForDate(clientId, date)` to stamp `daily_logs.phase_id` + `*_plan_id`, and enforces the past-day lock server-side.

### Workout logging (progressive disclosure)

Two modes, client's choice per session, no coach config — both hit the same endpoint/save button (`components/client-portal/training/`):
- **Quick log (default):** complete / partial / skipped + optional notes → `session_logs` with the chosen `completion_quality`, no `exercise_logs`.
- **Detailed log (collapsed disclosure):** per-set reps/weight/optional RPE, "Copy previous set", "Add exercise" (unplanned), "Skip exercise" → `session_logs` + one `exercise_logs` row per logged exercise with snapshots. Unlogged prescribed exercises count as skipped; mixed → `partial`. Save is a single bulk-replace (no per-set auto-save).

### Alternative-session handling

Clients can swap on a planned day or train on a rest day via the active-plan session picker. On write, each `session_log` links to an unlinked, matchable `training_event` (`status IN ('scheduled','missed','skipped')`, `session_log_id IS NULL`) in the same week — by performed session id, then date, then session id in-week; no match leaves `training_event_id NULL` as a surplus session. Snapshots (Option A): `prescribed_session_snapshot` from the **matched event** (calendar story); `prescribed_exercise_snapshot` from the **chosen session** (what they did). Adherence counts only `training_events.status='completed'`; the coach calendar is unchanged.

### Date-edit permissions

One rule in `lib/daily-log-permissions.ts` (pure, client-safe): today always editable; past-never-logged editable (backfill); past-logged locked; future view-only. `canEditDay(date, loggedStatus, clientTimezone)` drives UI disabled state; the server wrapper `assertCanEdit()` (`services/daily-log-permissions-service.ts`) throws `DayLockedError` → 403. Habits lock per-habit (optional `habitId` narrows the "logged" check), not per-day.

### Timezone model

**Locked model (Sessions 7.81–7.84): "today" is computed in the device timezone of the person whose calendar the date is on — never the server's UTC clock.** A client's day, plan placement, promotion, check-in window, streaks → the **client's** zone. A coach's dashboard windows (attention feed, current-week metrics, history summaries) → the **coach's** zone. The cross-person cases (a coach viewing a client's check-in due/overdue; background reminders) → the **client's** zone. One question decides every site: *whose calendar is this date on?*

- **Storage**: `clients.timezone` (migration 089) and `coaches.timezone` (migration 109), both `TEXT NOT NULL DEFAULT 'UTC'`, IANA.
- **Capture is device-synced, no manual picker** (Session 7.81 — intentionally reverses Session 2.6's "no silent overwrites"): the shared `useTimezoneSync` hook (`hooks/use-timezone-sync.ts`) compares the device zone against the stored value on every app load and fires a fire-and-forget PATCH on mismatch (client shell → `PATCH /api/client/settings`; coach shell → `PATCH /api/coach/settings`). Travel re-syncs on next open.
- **Read side**: server code derives "today" via `getTodayDateStringInTimezone()` in `lib/date-helpers.ts` — the only surface owning `Intl.DateTimeFormat` math. (Sanctioned exception: the two settings routes validate input zones with `Intl.supportedValuesOf("timeZone")` — validation, not date math.)
- **Helper inventory**: `lib/date-helpers.ts` owns the pure helpers — `getTodayDateStringInTimezone(tz, now?)` (string), `getTodayInTimezone(tz, now?)` (local-midnight `Date` for the injectable check-in helpers; NOT `parseISODate`, which parses as UTC midnight), `getDeviceTimeZone()` (browser capture). `services/today-service.ts` owns the DB-fetching ones — `getClientTodayString(clientId)` (client tz → coach tz fallback while the client is on the unsynced `'UTC'` sentinel → UTC) and `getCoachTodayString(coachId)`. **Rule:** when a `Client` record with `timezone` is already in scope, use the pure helpers (zero extra fetches — the overdue/attention-feed loops rely on this); the fetching helpers are for call sites holding a bare id.
- A stored `'UTC'` is the "never device-synced" sentinel; coach-initiated placement on a never-synced client's calendar falls back to the coach's zone (`getClientTodayString`, Session 7.82), then UTC.
- **Where each anchor applies** (Sessions 7.82–7.85): client tz — plan placement RPCs (`p_today`), calendar move/duplicate/delete guards, plan promotion, the client home week, check-in gate/window, streaks/habit defaults, goal-pace `today`, check-in due/overdue, and the placement-path planned-plan event wipe (`clientToday` threaded from the route — anchoring it at `startDate` would no-op against the RPC's STEP 0 and orphan the old plan's earlier events). Coach tz — attention-feed window, coach "current week" metrics/history anchors, phase-review adherence bound, phase-transition stamps (`transition_phase_atomic` `p_today`, migration 111: the completed phase's `end_date` + the activated next phase's `start_date`), and the attention-dismissal `dismissed_at` (migration 112 drops the column's UTC `CURRENT_DATE` default so a writer that forgets the date fails loudly). The plan-status RPCs additionally take `p_effective_from DATE DEFAULT NULL` coalescing to `p_today` (migration 110).

### Scale / payload contracts

Keyset-by-default is scoped to paginated, time-ordered "load older" history (check-ins). Small bounded sets return in full with no cursor (habits, a 1-week completions window, the exercise list). History rows are ID-first (`exercise_id` + `performed_name` fallback), never the catalog dictionary; the dictionary syncs separately via `GET /api/client/exercises/catalog?since=` (UPSERT-only delta on `updated_at`, internally paged past the ~1000-row PostgREST cap; periodic full resync catches deletes). Weight is rendered client-side in the user's unit preference via `formatWeight(weightKg, unitPreference)` (no `formatWeight` calls in `app/api/client/**`); viewer-relative per-record units (stored `weight_unit` + conversion at the API boundary) are Phase 8, not yet built.

### Coach-side wellness strip

`daily-wellness-strip.tsx` on the client overview tab:
- Fetches 28-day rolling window of daily_logs + habit_logs via `Promise.all`
- Renders 2x2 bar chart grid (mood, energy, sleep, stress) + adherence dots
- Runs `detectAlerts()` on loaded data for the attention feed

---

## Coach-side Data Flow

### SWR fetching

All coach-side data fetching uses SWR with:
- `revalidateOnFocus: false`
- `swrFetcher` from `lib/swr-fetcher.ts` (throws on non-OK responses)
- `isLoading` for initial load skeletons (not `isValidating`)

### Client page tab structure

`app/clients/[id]/page.tsx` renders tabs synced to the URL via `?tab=` search param:

| Tab | Component | Description |
|-----|-----------|-------------|
| Overview | `ClientOverviewTab` | Quick metrics, wellness strip, recent check-ins |
| Roadmap | `RoadmapTabContent` | Phase timeline, create/transition dialogs |
| Metrics | `MetricsTabContent` | Body metrics charts, check-in history |
| Training Plan | `TrainingPlanCard` + `TrainingHistoryTable` | Plan builder, session history |
| Nutrition | `NutritionCalculatorCardEnhanced` + `NutritionHistoryTable` | Plan builder, weekly history |
| Wellness | `WellnessTabContent` | Wellness trends and analysis |
| Daily Habits | `HabitsTabContent` + `HabitsHistoryTable` | Habit management, analytics |
| Notes | Coach notes (inline) | Free-text notes |

Tab changes call `router.replace(/clients/${clientId}?tab=${tab}, { scroll: false })` to sync URL without scroll.

### Builder flows

Plan creation uses context providers wrapping custom hooks:

- **Training**: `TrainingBuilderProvider` wraps `useTrainingBuilder` hook. Manages sessions, exercises, reorder, add/edit/delete. State stored in context, consumed via `useTrainingBuilderContext()`.
- **Nutrition**: `NutritionBuilderProvider` wraps `useNutritionBuilder` hook. Manages calorie targets, macro breakdown, custom macros toggle. Calculates adjusted targets from client metrics (BMR, activity level).

Both contexts are thin wrappers: the context provides the hook's return value, and consumers access it via the context hook.

### Attention feed

Wellness/tracking/activity triggers evaluate across all coach's clients:
- `lib/wellness-triggers.ts` - mood/energy drops, stress spikes
- `lib/tracking-triggers.ts` - logging gaps, nutrition/training misses
- `lib/activity-triggers.ts` - habit dropoff, activity-calorie mismatch
- `lib/engagement-triggers.ts` - no-engagement / disengaged-client detection (absence signal)
- `services/attention-feed-service.ts` - aggregates triggers into prioritized feed
- `components/dashboard/needs-attention-feed.tsx` - renders on coach dashboard via SWR

The eight wellness/tracking/activity triggers are pattern detectors over existing `daily_logs`, so they can only fire for clients who have logged. `evaluateAndSortTriggers` (`lib/attention-feed-helpers.ts`) therefore evaluates any client with **prescribed work** (training events or habits) even before their first daily log — it skips only clients with nothing logged AND nothing prescribed. `evaluateNoEngagement` is the one *absence* signal: it flags an active client who has prescribed work but no activity across any surface (daily_logs, daily_habit_logs, or completed/partial training_events) within the silence window, past an activation grace period. This is why a never-logged client with an assigned plan now surfaces instead of being silently counted "on track".

---

## Auth Model

### Dual role system

- `profiles` table: `user_id`, `role` (`trainer` | `client`)
- `coaches` table: auto-created on first login for trainers
- `clients` table: `user_id`, `coach_id` for ownership

### Middleware routing (`middleware.ts`)

- Public routes: `/check-in/*`, `/api/check-in/*`, `/invite/*`, `/api/invitations/*`, password reset
- Trainers: restricted to `/dashboard`, `/clients`, `/check-ins`, etc.
- Clients: restricted to `/client/*` routes
- Role mismatch: redirects to appropriate dashboard

### Auth helpers (`lib/auth-helpers.ts`)

- `getAuthenticatedCoachId()`: validates JWT via `supabase.auth.getUser()`, queries `coaches` table, returns coach ID or null
- `getAuthenticatedClientId()`: same pattern against `clients` table

### Database clients (Shape B — see CONVENTIONS.md §8 for the authoritative rule)

> The authoritative rule is **CONVENTIONS §8 ("Auth & data-access architecture (Shape B)")** — read it first; this is a summary, and §8 wins on any disagreement.

- `supabaseAdmin` (`services/supabase-admin.ts`): bypasses RLS. **This is the service-layer default**, used with an explicit caller-verified scope (`clientId` / `coachId`). Most DB traffic goes through it — authenticated client/coach reads, cross-client coach aggregation, token-based contexts, and system writes alike.
- `createServerSupabaseClient()` (`lib/supabase-server.ts`): session-scoped, respects RLS. Used to **validate the session** (the auth helpers call `getUser()` through it), and otherwise only in the rare case where an RLS policy doing real work needs `auth.uid()` in-database and the admin-plus-scope pattern genuinely doesn't fit (see §8 "When to use createServerSupabaseClient()").

### IDOR prevention

Because the route layer is the perimeter (Shape B), every authenticated route manually verifies the ownership chain before calling a service. Auth proves identity, not permission — never skip the ownership step because authentication succeeded.

**Coach routes** (`/api/clients/[id]/*`):
1. **Auth**: `getAuthenticatedCoachId()` - returns 401 if not authenticated
2. **Client ownership**: `client.coachId === coachId` - returns 403/404 if mismatch
3. **Resource ownership**: `resource.clientId === clientId` - returns 404 if mismatch

**Client routes** (`/api/client/*`): use `requireClientAuth(request)` (`lib/require-client-auth.ts`) for rate-limit → CSRF → auth, then verify the resource's `client_id === authedClientId` (return 404 to avoid leaking existence). The helper returns the authed `clientId` but does **not** perform the resource-ownership step — the caller still must.

---

## Client Onboarding Flow

Client-led onboarding. The coach sends an invite, the client completes a structured intake questionnaire, the coach reviews the intake and builds plans from it, and the client receives a guided walkthrough on first login post-activation. Replaces manual coach data entry, external intake forms, and cold first-login experiences.

### Data flow

```
Coach adds client (name + email)
  -> client_invitations row created with token
  -> Invitation email sent via Resend
  -> client_intake row created (status: pending)
  -> clients.onboarding_status = 'pending_intake'

Client clicks invite link
  -> /invite/[token] -> creates Supabase auth account (or signs in)
  -> Redirected to intake form
  -> Each step PATCHes client_intake via API
  -> On submit: client_intake.status = 'completed'
  -> clients.onboarding_status = 'intake_completed'

Coach reviews intake
  -> Reads formatted intake on review page
  -> Adds private coach notes (never visible to client)
  -> "Sync Metrics to Profile" button pushes weight/height/age/goals from
     client_intake into the clients table
  -> Builds nutrition / training / habits using existing builders
  -> clients.onboarding_status = 'setup_in_progress'

Coach activates client
  -> Sets welcome message + first check-in day
  -> clients.onboarding_status = 'active'
  -> Activation email sent
  -> walkthrough_completed_at remains NULL until first login

Client first login post-activation
  -> Guided walkthrough renders (day-centric portal tour: bottom tabs, home day-cards,
     tap-a-card-to-log + alt-session callout, swipe days, program/phase banner, settings via avatar)
  -> walkthrough_completed_at timestamp set on completion
  -> Client lands on the day-centric portal home (see Client Portal Architecture)
```

> Note: the walkthrough component was reworked for the day-centric portal (Session 6.1) but is **not currently mounted** in the web shell (`components/client/walkthrough/guided-walkthrough.tsx` has no caller) — re-mounting is a separate concern (likely the RN client), so the "renders on first login" step above is prospective.

### `client_intake` table

One row per client. Stores the questionnaire responses verbatim (client's own words for goals, motivation, challenges, injuries) plus structured fields (DOB, height, weight, dietary requirements as array). Status lifecycle: `pending` → `in_progress` → `completed` → `reviewed`.

### Intake step structure

The form is mobile-first, one section per step, auto-saves on Continue:

| Step | Section | Key fields |
|------|---------|------------|
| 1 | About You | DOB, gender, height, weight, body fat % (optional) |
| 2 | Your Goals | Primary goal type, target weight (conditional), deadline, motivation |
| 3 | Your Lifestyle | Work activity, training days/week, time preference, location, equipment, session duration |
| 4 | Nutrition | Dietary requirements, allergies, current diet description, cooking frequency, macro tracking experience |
| 5 | History | Injuries / limitations, training experience level, previous coaching, open notes |

### Onboarding status state machine

`clients.onboarding_status` is the single source of truth for which screen the client and coach see:

| Status | Coach sees | Client sees |
|--------|-----------|-------------|
| `pending_intake` | "Pending Intake" badge | Intake form |
| `intake_completed` | "Intake Ready for Review" badge + review link | "Waiting for coach" screen |
| `setup_in_progress` | "Setting Up" badge | "Waiting for coach" screen |
| `active` | No badge (normal state) | Day-centric portal home |
| `paused` | "Paused" badge | Paused message |

Pre-onboarding clients (created before the intake feature shipped) default to `active` for backward compatibility. The manual coach-driven setup path still works — the intake flow is opt-in at the invitation level.

### Design principles

- **Coach stays in control.** Intake captures client data; the coach decides what to do with it. Metrics sync is explicit (button click), not automatic.
- **No coach notes visible to clients.** Review notes, coach reasoning, internal observations never leave the coach surface.
- **Progress saves automatically.** Each step PATCHes on Continue so a client can close mid-intake and resume later.
- **Backward compatible.** Existing clients are unaffected. The `active` default for pre-feature rows means no migration backfill is needed.

---

## Activation Flow

`GET /api/clients/[id]/activation-readiness` checks whether a client is ready for full activation.

**Required items** (must have all):
- `hasTrainingPlan` - an active training plan exists
- `hasNutritionPlan` - an active nutrition plan exists
- `hasHabits` - client has active daily habits

**Recommended items** (displayed but not blocking):
- `hasRoadmap` - an active roadmap exists
- `hasActivePhase` - roadmap has an active phase (with name/startDate)

Uses `Promise.all` with `safeQuery()` wrapper for partial failure tolerance. The coach sees the `ClientActivationBanner` component which shows required vs recommended status. `activation-readiness` is advisory — `POST /api/clients/[id]/activate` does not enforce it. The orphan-log perimeter lives at the per-card **nutrition and training** writers instead (see `assertHasActivePlan` in `services/daily-context-service.ts`): each rejects a write whose `*_plan_id` stamp would be null, because those stamps feed adherence reads. Wellness and habits writes are deliberately ungated (Session 3.1C) — wellness has no plan or adherence concept, and `daily_logs.phase_id` is nullable by design for no-roadmap clients (roadmaps are opt-in; all wellness/phase analytics are date-windowed, never `phase_id`-keyed).

---

## API Route Structure

### Middleware ordering

Every API handler follows this exact sequence:
1. Rate limiting (`apiRateLimit`, `coachApiRateLimit`, `clientApiRateLimit`)
2. CSRF protection (`requireCSRFProtection`) - mutating methods only (POST/PUT/PATCH/DELETE)
3. Authentication (`getAuthenticatedCoachId()` or `getAuthenticatedClientId()`)
4. Authorization / IDOR check (verify coach owns the client)
5. Input validation (`schema.safeParse(body)`)
6. Business logic (wrapped in try/catch)

### Response format

All endpoints return:
```json
{ "success": true, "data": { ... } }
{ "success": false, "error": "Human-readable message" }
```

Status codes: 200 (success), 201 (created), 400 (validation), 401 (auth), 403 (forbidden), 404 (not found), 409 (conflict), 429 (rate limited), 500 (server error).

### Route namespaces

- `/api/clients/[id]/*` - coach-side routes (use `coachApiRateLimit`, `getAuthenticatedCoachId`)
- `/api/client/*` - client-side routes (use `clientApiRateLimit`, `getAuthenticatedClientId`)
- `/api/check-in/*` - public token-based routes (use `checkInRateLimit`)
- `/api/dashboard/*` - coach dashboard aggregation routes

---

## JSONB Conventions

- `training_data` / `activityStatuses` were the Daily Pulse training UI cache (now deleted). These shapes are no longer written; they persist only as dead data on legacy `training_logs` rows.
- (Legacy shape, for anyone inspecting old rows) `activityStatuses` is `Record<string, { completed, activityName, estimatedCalories }>` — read the `.completed` field, never use the object as a truthy check.
- `training_data` JSONB on `training_logs` was the Daily Pulse UI restore cache; it is now **orphaned** — no current code reads or writes it. The **source of truth** for training completion is `session_logs` + `exercise_logs` + `set_logs` (post migration 090; per-set actuals were inline scalars on `exercise_logs` before).

### phase_goals_snapshot

Written to `phases.phase_goals_snapshot` when a phase is created. Captures the client's current goals at that point:
```json
{
  "goalWeight": 75,
  "goalBodyFatPercentage": 15,
  "primaryGoal": "Lose fat, build muscle"
}
```

### phase_summary

Written to `phases.phase_summary` during phase transition. Captures completion metrics:
```json
{
  "completedAt": "2026-03-25T00:00:00.000Z",
  "metricsSnapshot": {
    "startWeight": 85, "endWeight": 82,
    "startBodyFat": 20, "endBodyFat": 18
  },
  "adherence": {
    "training": 0.85,
    "nutrition": 0.72,
    "habits": 0.90
  },
  "phaseGoals": {
    "goalWeight": 75,
    "goalBodyFatPercentage": 15
  }
}
```

---

## Check-in System

**Daily logs are the single source of truth for the check-in (Session 6.4).** The check-in form is a *viewer* over the period's spine, not a parallel data-entry surface. There is no `check_in_session_completions` table — it was dropped in migration `098_drop_check_in_session_completions.sql`. Detail readers DERIVE per-session training completions from `training_events.status` left-joined to `session_logs`.

- **Detail readers** (`GET /api/check-in/[id]` coach, `GET /api/client/check-ins/[id]` client) call `deriveSessionCompletionsForCheckIn()` (`services/check-in-details-service.ts`). It resolves the window from the check-in's **stored `period_start`/`period_end`** (migration 038) — only legacy pre-038 rows (both null) fall back to `calculateCheckInPeriod()` against the check-in's own `created_at` date; a historical check-in is NEVER re-derived against a today-relative window. It maps `getTrainingEventDetailsForPeriod()` details to the preserved `CheckInSessionCompletion` camelCase shape the UI already reads (`trainingSessionId` may be null — an alt-session swap or unlinked event; React keys use `id`/`eventId`). The response field stays `sessionCompletions`; IDOR guards are unchanged (coach ownership via `requireCoachOwnsCheckIn`; client `.eq('client_id', auth.clientId)`).
- **The form** (`app/client/check-in/page.tsx`, authenticated client portal): wellness + nutrition are **read-only** summaries of the daily logs (`DailyLogsSummary` / `DailyLogsTrainingSummary`); the only interactive wellness/nutrition element is a single qualitative reflection textarea (`notes`). The training section is the one editable surface — it renders the period's `training_events`, locks display-only rows where `canEditDay(date, loggedStatus, tz) === false` (`canEditDay` is the ONLY lock rule; `loggedStatus` = whether the event has a `session_log`), and routes edits for never-logged editable days through the **per-card endpoint** `POST /api/client/training/events/[eventId]/log`. The submit handler flushes + awaits any in-flight training fill-gap POSTs *before* calling the check-in submit, so the server's submit-time derivation reads already-updated `training_events`.
- **The submit path** (`submitCheckIn`, `services/check-in-service.ts`) DERIVES the `check_ins` weekly-snapshot columns server-side for the period (keeping the AI's previous-check-in trend populated): `workouts_completed` from `getCheckInTrainingPeriodStats().sessionsCompleted`; `nutrition_days_on_target` + `adherence_percentage` (capped 0–100) from `getNutritionSummaryForPeriod()` (the same service fn the AI path uses, so the numbers match); `mood/energy/sleep/stress` from `calculateMetricAverages()` over the period's wellness rows read via `getDailyLogs()` (the consolidated `daily_logs_full` view — those metrics live in `wellness_logs`, not the bare `daily_logs` spine). None of these are read from the form body. `check_in_exercise_highlights` remains a real backing table (out of scope).

Training-completion counting reads `training_events.status='completed'` (the same source of truth as coach-side adherence); only `completed` counts toward `sessionsCompleted` (`getCheckInTrainingPeriodStats`). Per-event training detail for the AI prompt comes from `getTrainingEventDetailsForPeriod()` (`services/check-in-context-service.ts`) — events left-joined to their `session_logs` for notes/quality. For each logged session, `getExerciseSummariesForPeriod()` appends compact per-exercise top-set lines (heaviest set, RPE when present) walked from the `exercise_logs`→`set_logs` chain, plus an alt-session swap signal (prescribed vs performed session name) — additive enrichment that degrades to the per-event detail if the chain read fails.

### Submission flow

1. Client navigates to `/client/check-in` (authenticated portal) — or the coach sends a legacy magic-link (`/check-in/[token]`, `check_in_tokens` table, 7-day expiry; training is read-only in that unauthenticated flow since it can't satisfy `requireClientAuth`).
2. The multi-step form shows read-only wellness/nutrition summaries derived from daily logs plus a reflection textarea, body metrics, photos, and an editable training section (per-card fill-gap logging for never-logged days).
3. On submit: the form flushes any pending training POSTs, then `submitCheckIn` DERIVES the snapshot columns from the spine and creates the `check_ins` record with `status='pending'` (and persists `period_start`/`period_end`).

### AI processing pipeline

After submission, `triggerAISummaryGeneration()` (`services/client-check-in-service.ts`) runs asynchronously:
1. Fetches current check-in with details + previous 5 check-ins for trend analysis
2. Fetches daily logs, habit logs, and weekly nutrition summary for the check-in period
3. Calls `generateCheckInSummary()` (OpenAI GPT-4o via `services/ai-service.ts`) with all context
4. Updates check-in with AI summary in v2 format (`ai_insights` JSONB)
5. Status transitions: `pending` -> `ai_processed` -> `reviewed` (after coach reviews)

### Check-in period gating

- `clients.expected_check_in_day` controls the cadence; `clients.start_date` (set at activation) anchors the first window.
- **`resolveCheckInWindow()`** (`lib/date-helpers.ts`) computes the window: the fixed 7-day period ending on the check-in day (`calculateCheckInPeriod`), with `period_start` clamped forward to `start_date` for a **partial first week** — a mid-week-activated client's first check-in covers `[start_date … check-in day]`, not a full 7. Shared by the form, `submitCheckIn` (stored period), and the coach history-list denominators (`enrichWithDailyLogCounts`) so they agree.
- **`getCheckInStatus()`** is activation-aware: a check-in is available on its check-in day and stays **overdue (still loggable) until the day before the next check-in day**, then the window rolls. A missed *first* check-in is loggable the same way — unless its window predated activation, in which case it's pushed to the next period. Established-client behavior is unchanged.

### Metrics dual-write on check-in

`updateClientMetricsFromCheckIn()` handles the body metrics flow:
1. Updates `clients` table with current_weight, current_body_fat_percentage (denormalized cache)
2. Recalculates BMR and TDEE from updated client data
3. Writes immutable event to `body_metrics` table with `source: 'check_in'`
