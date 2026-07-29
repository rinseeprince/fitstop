# CoachHub Architecture Reference

This file documents the platform architecture, database schema, and data flow patterns. Unlike CONVENTIONS.md (which contains stable coding rules), this file evolves with the schema. **Update it when shipping migrations.**

> ⚠️ **Legacy-section map — read before trusting any section below.** A client-portal redesign is in flight (`docs/CLIENT-PORTAL-REDESIGN.md` + `docs/CLIENT-PORTAL-EXECUTION-PLAN.md`). Several sections here describe patterns that are already retired or scheduled to change. **Precedence rules:** where this file and the redesign docs disagree about a client-portal write path or data flow, **the redesign docs win**; where this file and **CONVENTIONS.md** disagree about a coding/auth rule, **CONVENTIONS.md wins** (it is the stable rule-of-record; this file lags it).
>
> | Section | Status | Authoritative source |
> |---------|--------|----------------------|
> | Auth Model → "Database clients" | **Accurate / migrated** — the codebase is on **Shape B**: services default to `supabaseAdmin`, the route layer is the security perimeter. RLS is a safety net **for the app path only** — `service_role` bypasses it, so if the route layer is broken RLS does nothing there. **It is NOT merely defence-in-depth overall:** the anon key ships in the browser bundle, so for any request that reaches PostgREST directly (`/rest/v1/…`) RLS is the *only* perimeter. Migrations 105–108 (2026-06-10) and 122–126 (2026-07-21) hardened it: enabled RLS on five tables that never had it, dropped permissive and anon-reachable policies, pinned `security_invoker` on `daily_logs_full`, locked `SECURITY DEFINER` RPCs to `service_role`. Check the current state with `npm run check:rls`, which reads the live catalog rather than the migration tree. | **CONVENTIONS.md §8** |
> | "JSONB Conventions" (`training_data`/`activityStatuses`) | **Orphaned cache** — legacy `training_logs` rows only; no active read/write path. | redesign docs |
> | "Activation Flow" · "Training Completion Hierarchy" (`session_logs` identity) | **Accurate / landed** — `session_logs` event-keyed identity shipped (migration 097, Session 5.2); the onboarding walkthrough was reworked for the day-centric portal (Session 6.1). | this file |

---

## Platform Overview

CoachHub is a fitness coaching platform built with Next.js 14 (App Router). It connects two user types:

- **Coaches** (role: `trainer`) - manage clients, create training/nutrition plans, review check-ins, monitor wellness alerts. Dashboard at `/dashboard`.
- **Clients** (role: `client`) - track daily wellness, log workouts (per-set), manage nutrition, and complete weekly check-ins via the day-centric client portal. Home at `/client` (date-driven day view; see Client Portal Architecture).

**Tech stack:** Next.js 14, Supabase (PostgreSQL + RLS + Auth), SWR (coach-side), Upstash Redis (rate limiting), Vitest, Tailwind CSS, shadcn/ui, Lucide icons, Framer Motion. **Two AI providers:** OpenAI GPT-4o (check-in summaries, `services/ai-service.ts`) and Anthropic via `@anthropic-ai/sdk` (the program-builder draft assistant, `services/assistant/`).

---

## Data Hierarchy

```
coaches
  ├── coach_saved_plans             -- library plan templates (status: draft/saved)
  │     └── coach_saved_sessions    -- reusable sessions (saved_plan_id NULL = standalone)
  │           └── coach_saved_exercises  -- exercise_id FK to exercises catalog
  │
  └── clients                        -- coach_id FK, one coach per client
        ├── training_plans            -- MANY coexisting provenance rows (date-range, no singleton); saved_plan_id FK tracks library provenance (nullable)
        │     ├── training_sessions   -- carries calorie_surplus_percentage (source for nutrition cascade)
        │     │     └── training_exercises  -- exercise_id FK to exercises catalog
        │     └── training_events        -- one row per session per date (calendar SOT; training_plan_id FK is SET NULL)
        ├── nutrition_plans           -- ONE durable active plan per client (in-place upsert; no versioning)
        │     └── nutrition_events       -- one row per client per date (SOT; nutrition_plan_id FK is SET NULL)
        │
        ├── exercises (catalog)          -- two-tier: global (coach_id=NULL) + coach-specific
        ├── daily_habits
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
        ├── client_notes              -- coach notes about the client (one pinned max)
        └── body_metrics              -- immutable measurement events
```

---

## Client Goals & Body Metrics

### client_goals table

Versioned goals using the `effective_from` / `superseded_at` pattern:
- New goals are created as new rows (never update existing records)
- The previous active goal gets `superseded_at = NOW()` when a new goal is set
- Unique index ensures one active (non-superseded) goal per client
- Fields: `goal_weight`, `goal_body_fat_percentage`, `goal_deadline`, `primary_goal`, `set_by`, `notes`

### Effective goal resolution

A single pure resolver, `resolveEffectiveGoal()` (`lib/goals/resolve-effective-goal.ts`), turns the live `client_goals` record into the goal that drives nutrition + pace. It is the **one** place display-unit goal weights are normalized to kg; a NULL weight means **maintenance** (`goalWeightKg: null`). `startDate` falls back to `today` when `client_goals.goal_start_date` (migration 104) is unset. Callers: `services/nutrition-plan-orchestrator.ts` (plan creation), `services/comparison-service.ts` (check-in weight pace — weight **and** deadline come from one scope), the nutrition GET's goal-drift check, and the coach Metrics page.

### body_metrics table

Immutable event log with source provenance:
- Each measurement is a new row (no `updated_at` column - intentionally immutable)
- `source` field tracks origin: `check_in` / `metrics_api` / `intake_sync` / `nutrition_plan` / `coach_entry`
- `source_id` (nullable UUID) references the originating record
- Indexed on `(client_id, recorded_at DESC)` for efficient latest-first queries (with a `created_at` tiebreak for same-timestamp coach entries)
- Fields: `weight`, `weight_unit`, `body_fat_percentage`, `bmr`, `tdee`

### client_metric_entries table (migration 132)

Coach-logged measurement entries backing the redesigned client Metrics page:
- One row per `(client_id, metric_key, entry_date)` — re-logging the same metric on a date **replaces** the earlier value (upsert), so rows are mutable and carry `updated_at` (deliberately unlike the immutable `body_metrics`)
- `metric_key` stores the Metrics page's canonical metric ids verbatim (camelCase `bodyFat`; CHECK-constrained to the 12 known keys incl. wellness + soreness)
- Values are stored in the client's display units (no per-row unit snapshot); `note` is an optional per-entry coach note surfaced in the Measurement Log (and labeled as shown to the client)
- Weight/bodyFat entries **dual-write a `body_metrics` event** (`source: 'coach_entry'`, `recorded_at` = the entry date at 12:00Z, `source_id` = the entry id) so goal comparisons stay coherent; the `clients` denormalized cache updates **only when the entry is dated on/after the latest known event** — a backdated entry never regresses `current_weight` (`recordBodyMetrics`'s `updateClientCache` param)
- Write path: `GET/POST /api/clients/[id]/metric-entries` (coach-only; future dates rejected against the coach's timezone; audited as `metric_entry.upsert` with no measurement value in metadata)
- The Metrics page merges these entries with check-in-derived values client-side (`utils/metric-points.ts` + `utils/metric-derived-stats.ts`); `check_ins` rows are never written by this feature

### client_notes table (migration 134)

Coach-authored notes about a client, backing the Overview's Coach-notes card and the Notes tab:
- `client_id` FK (CASCADE), `coach_id` FK (SET NULL), `body` TEXT NOT NULL, `is_pinned` BOOLEAN NOT NULL DEFAULT false, `created_at`/`updated_at`
- Index `(client_id, created_at DESC)`; **partial unique index on `(client_id) WHERE is_pinned`** — at most one pinned note per client. Pinning therefore unpins whatever held the pin, in two non-transactional writes: the existence/ownership check MUST stay ahead of the unpin sweep, or a 404 on a stale/foreign `noteId` clears the client's pin first. Readers must revalidate the whole list after a pin, since the other row's change is invisible in the PATCH response.
- RLS enabled with **no policies**, `GRANT ALL … TO service_role` only (CONVENTIONS §8)
- Seeded from the legacy `clients.notes` column (one unpinned row per non-empty value). **`clients.notes` is seeded-from, not migrated-away** — the column still exists and is still written by the intake/onboarding paths; nothing in the notes surface reads or writes it any more.
- Routes: `GET`+`POST /api/clients/[id]/notes`, `PATCH`+`DELETE /api/clients/[id]/notes/[noteId]` (PATCH body `{ isPinned }`). GET returns pinned-first then newest-first.
- **DELETE is a hard delete**, deviating from CONVENTIONS §8's soft-delete rule (owner decision, 2026-07-26): a coach note is the coach's own scratch text rather than client history, and the table carries no soft-delete column. `deleteClientNote` filters on **both** `id` and `client_id` — that scope filter is the entire safety story, since a guessed note id would otherwise reach another coach's note. Never widen it. The UI gates it behind the destructive-confirm dialog because the row is unrecoverable.

### clients.phone (migration 135)

Nullable free-text phone (no shape constraint — formats vary too much). Exposed through `updateClientSchema`, `updateClient`, and `lib/mappers.ts`, and written from the Overview's Client-settings dialog via the existing `PATCH /api/clients/[id]`.

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

## Daily Logs (spine + child tables)

Daily tracking data is split into a spine table and domain-specific child tables:
```
daily_logs (spine)         -- id, client_id, date, notes
  ├── wellness_logs        -- mood, energy, sleep, stress, soreness (1:1 via daily_log_id FK)
  ├── nutrition_logs       -- consumed, targets, adherence (1:1 via daily_log_id FK)
  ├── training_logs        -- trained, training_session_id, training_data JSONB (legacy/orphaned) (1:1 via daily_log_id FK)
  └── daily_habit_logs     -- per-habit completion (1:many, FK to daily_habits)
```
- **Writes**: per-card independent writes. Each per-card endpoint (`PATCH /api/client/daily-logs/[date]/nutrition`, `/wellness`, and similar) ensures the day's `daily_logs` spine row exists and upserts only its own child table. (The old monolithic `/api/client/daily-logs` POST and its `today`/`streak`/`nutrition-target`/`week` siblings were removed in Session 5.1; the `upsert_daily_log_atomic()` RPC remains in the DB as an unused function — its removal is separate schema work — and must not be used for new writes.)
- **Domain-specific reads** query child tables directly (e.g. wellness history queries `wellness_logs`, not the view)
- **Cross-domain reads** use the `daily_logs_full` view (e.g. attention feed, AI summary generation)
- Each child table has `client_id` and `date` columns for direct querying without joining the spine
- The `DailyLog` TypeScript type remains flat. The split is DB + service layer only. Hooks, components, and utils are unaffected

---

## Nutrition & Training Events

Concrete calendar events materialize plan templates into per-date rows:

```
training_events    -- one row per training session per date
nutrition_events   -- one row per client per date
```

Events are the **source of truth for date-specific targets**. Plan templates (`nutrition_plan_daily_targets`, `training_sessions`) are blueprints used to generate events, not for display.

### Plans as templates/provenance (events-as-SOT)

The events-as-SOT overhaul (Sessions 1-5, migrations 113-118) demoted plans from the live read path to **templates/provenance** — the events carry the date-specific truth, and a plan's deletion no longer destroys history:

- **Event→plan FKs are `ON DELETE SET NULL` + nullable** (migration 113). Both `training_events.training_plan_id` and `nutrition_events.nutrition_plan_id` survive a plan/template hard-delete (was `ON DELETE CASCADE` + NOT NULL). Past/logged events are never orphaned by deleting their source plan.
- **Deliberate asymmetry — do NOT "consistency-refactor" the two tracks into one model:**
  - **Training = many coexisting provenance plans.** A distinct `training_plans` row per placement coexists with others; there is **no singleton, no `planned`/promotion concept**. "The active plan" is resolved **by date** (the provenance plan whose `[effective_from, effective_until]` covers today), not by `status='active'`. Placement is **additive** (see "Atomic placement").
  - **Nutrition = one durable mutable plan.** Exactly one active `nutrition_plans` row per client (`idx_nutrition_plans_active_unique`), edited **in place** (upsert) with **no versioning/archival**. One target per day is correct, not a limitation (`nutrition_events UNIQUE(client_id, date)`). Per-day coach edits are **materialized onto the events** (`is_modified`), not minted as new plan rows.

### Training event fields
- `training_session_id` FK (SET NULL on delete, preserves events when sessions removed)
- `session_name`, `session_focus` - snapshotted at creation, survive template renames
- `estimated_calories` - from the session template
- `calorie_surplus_percentage` (NUMERIC, nullable, migration 085) - the per-date training surplus, denormalized onto the event at generation from `training_sessions.calorie_surplus_percentage`. The nutrition cascade reads it directly from the event (see "Training → Nutrition cascade"). NULL on rest days
- `is_modified` - true when a coach moved or duplicated the event on the calendar, or edited its surplus. It drives the calendar card's edited badge and is hashed into the amendment drift token. It is **not a write predicate**: the amendment rewrite deletes and re-lays future scheduled events without consulting it. (An earlier `force = false` / override-after-warning regeneration flow is described in older revisions of this file; no such parameter exists in the code.)
- `status`: `scheduled` / `completed` / `partial` / `missed` / `skipped`
- Unique constraint: `(client_id, training_session_id, date)` partial index where `training_session_id IS NOT NULL`

`training_sessions.calorie_surplus_percentage` (NUMERIC, nullable) is the **origin** of the surplus: it is copied onto each `training_events.calorie_surplus_percentage` at event generation, and the nutrition cascade then reads it from the event (not from the session). Rest-day sessions have NULL.

### Client-side plan tier (`training_sessions` / `training_exercises`)

The placed mirror of the library tier — same shape, one row per authored slot:

- `week_index` (INTEGER NOT NULL DEFAULT 0, migration 121) and `order_index` — ordering is always `(week_index, order_index)`. **`day_of_week` is always NULL** for anything placed post-121; placement is a sequential date-walk, not a weekday map. (The seed script `scripts/seed-scale-client.ts` still authors the pre-121 weekday shape, so fixture data is the one place you may see it set.)
- `is_rest` (BOOLEAN NOT NULL DEFAULT false, migration 121) — rest slots are **real rows**, so the client read is self-describing. They carry no exercises and spawn no `training_event`. Applied-side readers that count workouts filter `is_rest = false`.
- `set_specs` (JSONB) + `video_url` (TEXT), migration 119 — identical shape to `coach_saved_exercises`; see "Coach Library".

**Client read — `getClientTrainingPlan` (`services/client-training-plan-service.ts`) is self-describing.** It returns `{ planId, planName, sessions[], state, startsOn, endsOn }` — the plan's rows in `(week_index, order_index)` order, rest days carried as real `isRest` entries. No library-template join, no `saved_plan_id` read.

**Both audiences resolve by DATE, through one shared window predicate.** `coversDate()` (`services/training-plan-window.ts`) owns the `effective_from <= date AND (effective_until >= date OR NULL)` half for `getTrainingPlanForDate`, `getTrainingPlanIdForDate` and the client reader alike. The **status** half deliberately stays at each call site: coach reads exclude only `archived`, the client read requires `active`, because `PATCH /api/clients/[id]/training/[planId]` can write any of the four CHECK values and a `draft`/`planned` plan must never reach a client. Ordering is identical on both sides (`effective_from DESC, created_at DESC`), so the two audiences pick the same row.

The client reader previously took the newest-**created** active row with `effective_until IS NULL` — a different question, wrong at both ends: a program placed to start next month became the client's current one immediately, and a finished one stayed current forever. That divergence was reachable, not theoretical: `SessionPicker` lists from `GET /api/client/training-plan` while `GET /api/client/training/sessions/[sessionId]` validates the pick against `getActiveTrainingPlanId` (date-driven), so whenever the two resolvers disagreed **every session the client picked 404'd**. The picker now gates its list on `state === "active"`, which makes that mismatch unreachable rather than merely unlikely.

`state` is `active` | `upcoming` | `ended`, resolved in that priority order (a queued program is live information; a finished one is history). `null` still means the client has no active, non-deleted plan at all.

> **Two "Ended" definitions exist, deliberately.** The client reader and the amendment surface (`isFullyPast`) both derive the last day from the **slot count** via `calculatePlacementEndDate`, so a client's app and their coach's editor agree on the day a program ends. The Overview's plan chip derives its own from **authored duration** via `utils/plan-week.ts` (see "Coach client Overview"). They diverge only on plans whose active row count doesn't match `program_duration_weeks × 7` — which is exactly the corruption `TECHNICAL-DEBT.md → "The amendment writer breaks one active row per slot position"` describes. Fixing that removes most of the divergence; unifying the two definitions is a separate decision.

### Nutrition plan (durable) + daily-targets template

The single durable `nutrition_plans` row per client is the **template** that generates `nutrition_events`. It holds the plan-level prescription — `baseline_calories`, `protein_target_g` / `carb_target_g` / `fat_target_g`, `diet_type`, `protein_target_g_per_kg`, the custom-macros override (`custom_macros_enabled` + `custom_calories`/`custom_protein_g`/`custom_carb_g`/`custom_fat_g`), the calculator inputs (`base_weight_kg`, `bmr`, `tdee`, `work_activity_level`, `training_volume_hours`), and the goal snapshot (`goal_weight_kg`, `goal_deadline`, `goal_source`) that drives the "active since {date}" / weight-drift banners. `nutrition_plan_daily_targets` is its **per-weekday grid** (`(nutrition_plan_id, day_of_week)` → `calories`, `protein_g`, `carb_g`, `fat_g`) — the source used to generate/regenerate the dense per-date `nutrition_events`. It is replaced **DELETE-then-INSERT** on each plan upsert and is **not** the display SOT (events are). The TDEE/macro formula that computes these values is implemented in `utils/nutrition-helpers.ts` (its calculator doc was retired — git history of `docs/NUTRITION_PLAN_CALCULATOR.md` holds the prose walkthrough). The plan is edited **in place** (`create_nutrition_plan_atomic` upsert, migration 115): a cascade/in-place regen (`p_recalc_snapshots=false`) preserves the goal snapshot + `created_at`/`effective_from`; only an explicit "Recalculate plan" (`p_recalc_snapshots=true`) re-stamps them.

### Nutrition event fields (percentage-surplus model, post-LIB-2)
- `baseline_calories` - plan's rest-day target, frozen at event creation
- `calorie_surplus_percentage` (NUMERIC, nullable) - copied from the training event assigned to that date (e.g., 15 for +15%). NULL on rest days
- `training_burn_calories`, `external_burn_calories` - **deprecated**; 0 on new events, legacy values preserved on pre-LIB-2 events for backward compat
- `protein_g`, `carb_g`, `fat_g` - baseline macros (protein fixed; extra calories redistribute to carbs/fats per `diet_type` via `calculateDailyMacros()`)
- `diet_type` - snapshotted from plan, enables display-time macro recalculation when `include_activity_burn` is on
- `is_training_day` - derived from training events on that date
- `is_modified` (BOOLEAN, migration 113) - true when a coach **materializes a per-day edit** (range edit). On a modified day `baseline_calories` + macros are frozen to the edited values and `calorie_surplus_percentage` is set to NULL (no surplus stacking); the day **survives regeneration and the training cascade** (delete/upsert skip `is_modified=true` rows). Cleared by reset.
- `note` (TEXT, migration 118) - optional per-day coach note; rides `is_modified=true` so it survives regen, is cleared on reset, and surfaces on the coach calendar tag + the client nutrition day card.
- `status`: `scheduled` / `logged` / `missed`

**Display total**: `baseline * (1 + surplus/100)` when `include_activity_burn` is on, else `baseline`. The toggle does not require event regeneration. How the surplus calories distribute across macros honors `clients.surplus_as_carbs` (migration 117) via the shared `applySurplusSplit()` (`utils/nutrition-helpers.ts`): protein is held; **keep-split** (default) scales carbs+fat preserving the plan ratio; **carbs-only** holds fat and adds the surplus to carbs. The same helper backs both the event mapper (`mapNutritionEventToDisplayTarget`) and the plan-based "typical week" path (`buildDailyTargetsFromPlan`).

### Event lifecycle
- **Generation paths** (training):
  1. Program builder → draft in coach library (`coach_saved_plans.status = 'draft'`) → coach previews and edits on full-page editor → place from any start date (whole-program date-walk)
  2. Library plan → apply or drag onto calendar (creates fresh client-side `training_plans` + `training_sessions` + `training_exercises` + `training_events`)
  3. Library session → drag individual saved session onto a specific calendar day
  4. Direct plan creation via the legacy builder (still supported)
- **Generated** when a plan is created or regenerated
- **Cascaded** when training events change (training day swaps trigger nutrition event regeneration via `regenerateFutureNutritionEvents`)
- **Frozen once past** - only future `scheduled` events are deleted/regenerated. Past events and non-scheduled statuses are preserved
- **Calendar operations** (training events): coaches can move an event to another date, duplicate a single event onto a chosen day, clear a week, and delete an event. Moved/duplicated events get `is_modified = true`. **One session per client per day** — see "Whole-program placement" below. Week-level duplication ("to next week" / "to all remaining") and "Save as plan" were removed on 2026-07-27, along with the move's "this and all future X sessions" scope, which could never match a sibling once every placed day owned its own session row
- **Per-day nutrition editing** (Session 4): coaches edit nutrition events directly on the nutrition calendar over a `dates[]` selection (absolute or %-delta) via `PATCH /api/clients/[id]/nutrition/events/range`, which **materializes** the edit (`materializeNutritionEventDays` → baseline+macros set, surplus NULL, `is_modified=true`, optional `note`); `PATCH …/nutrition/events/[date]/reset` (`resetNutritionEvent`) clears `is_modified`+`note` **then** regenerates that date back to the plan baseline. Both are server-guarded to `date >= clientToday`. The read is `GET …/nutrition/events?startDate&endDate`.

### Training → Nutrition cascade
- The 8 training event-write routes — `place-from-library`, `events/[eventId]/move`, `events/[eventId]/duplicate`, `events/[eventId]` (PATCH/DELETE), `[planId]/sessions/[sessionId]`, `[planId]/amendment`, `[planId]` and the client-level `training` DELETE — invoke one consolidated helper, `cascadeNutritionAfterTrainingChange()` (`services/nutrition-event-service.ts`), which fetches the durable nutrition plan and calls `regenerateFutureNutritionEvents()`. The consolidation de-dupes the loop logic only — **each route still computes and threads its own anchor date** (move = `min(source, target)`; delete = client-today; duplicate = `targetDate`; amendment = the rewrite floor).
- Nutrition events read the day's surplus **directly from `training_events.calorie_surplus_percentage`** (denormalized from the session at event generation, migration 085) — not by traversing the `training_session_id` FK.
- Only future `scheduled`, **non-`is_modified`** nutrition events are replaced; `logged` / `missed` events and coach-edited (`is_modified=true`) days are immutable across the cascade (preserves the Session 1 edit-preservation guard).
- Baseline is preserved across a cascade — only `calorie_surplus_percentage` and `is_training_day` change.

### Read priority for nutrition targets

The **per-date day-view path** — `getPlanTargetForDate()` / `getNutritionForDate()` (`services/daily-context-service.ts`):
1. **Logged days**: `nutrition_logs` snapshot (written at log time, authoritative)
2. **Unlogged days with event**: the `nutrition_events` row for that date (via `mapNutritionEventToDisplayTarget`, honoring `include_activity_burn` + `surplus_as_carbs`)
3. **Unlogged days without event**: returns `null` — **the level-3 template fallback is currently unbuilt** (there is no `getPlanTargetForDateFromTemplate`). Dense event generation/backfill is expected to cover the window, so a missing event reads as "no target".

The **plan-based "typical week" / client program-card path** — `buildDailyTargetsFromPlan()` (`utils/build-daily-targets.ts`) — is event-first too, but for no-event days it **does** derive the target from the durable plan's `nutrition_plan_daily_targets` template (applying the same surplus-split), so the program card never shows a hole.

---

## Training Completion Hierarchy

```
training_logs            -- did the client train today? (1:1 per day, child of daily_logs)
  └── session_logs       -- one row per logged session, keyed to a training_event (renamed from client_session_completions)
        └── exercise_logs    -- per-exercise metadata (renamed from client_exercise_completions)
              └── set_logs   -- per-set actuals (added in migration 090)
```
### Event-keyed identity (migration 097, Session 5.2)
- `session_logs` is keyed by **`training_event_id`** (FK → `training_events`, `ON DELETE SET NULL`), with a partial unique index `session_logs_training_event_id_key ON (training_event_id) WHERE training_event_id IS NOT NULL`. The old session-week composite `UNIQUE(client_id, training_session_id, week_start_date)` is **dropped** — it silently overwrote two events that shared a session in one week.
- Write semantics (public `logTrainingEvent` / `logTrainingSessionForDate` in `services/training-log-service.ts`, both delegating to the internal `writeSessionLog` helper): if the event already has a `session_log_id` → UPDATE that row by id; else INSERT, stamping `training_event_id = event.id`. A `23505` on the partial index (concurrent submit / half-failed prior link) recovers by updating the conflicting row — never a duplicate. `linkSessionLogToEvent` writes both directions (`event.session_log_id` + status, and `session_log.training_event_id`).
- `completed_at` is the **attribution date** — `event.date` for event-keyed logs (NOT the entry day), the logged date for event-less. A late backfill therefore attributes to the prescribed day.
- `session_logs.training_session_id` holds the **performed** session. `prescribed_session_snapshot` captures the **prescribed** session (the event's session for matched logs; the chosen session for unmatched extras). Both SET NULL on delete; history preserved via the snapshot JSONB.

### Alternative-session logging (Session 5.3/5.4)
- A client can log a **different** session than prescribed (planned-day swap) or train on a **rest day** (event-less). Event-less writes go through `POST /api/client/training/session-logs` → `logTrainingSessionForDate`, which is idempotent on `(client, performed session, completed_at::date)` (range-matched) **before** running the matcher, killing retry/double-tap and matched-then-retried phantom dupes.
- **Matcher** (`findMatchingEvent`): links an event-less log to a prescribed event among unlinked events (`session_log_id IS NULL AND status IN scheduled/missed/skipped`) in the log's week — priority (1) same `training_session_id`, earliest date; (2) same date as the log, any session; (3) none. Deterministic tie-break: earliest date, then `created_at`.
- **Signals:** swap = `session_log.training_session_id != event.training_session_id`; truly-extra rest-day-trained = `session_log.training_event_id IS NULL`. The coach history table renders an "Alt" badge (`is_alternative`); the drill-down dialog shows a session-level "Prescribed X · Performed Y" line. The client day-view shows a "Trained for {weekday} {session}" line (`DaySummary.trainedFor`) when a log dated D links to an event on D2≠D.
- `exercise_logs.training_exercise_id` is SET NULL on delete (nullable). History preserved via `prescribed_exercise_snapshot` JSONB
- Snapshots are written at completion time and backfilled for existing data
- `set_logs` (migration 090) holds per-set actuals: `(set_number, reps, weight, rpe)`. Replaces the legacy scalar aggregates `actual_sets`/`actual_reps`(csv)/`actual_weight` that lived on `exercise_logs` before 090. ON DELETE CASCADE from `exercise_logs`.
- `set_logs.set_type` (migration 119) — `TEXT NOT NULL DEFAULT 'working' CHECK (set_type IN ('warmup','working','amrap','drop','failure'))`. The per-set type of a logged set. It is **coach-prescribed** (seeded from the prescription's `set_specs` at log time), not client-chosen — the log schema accepts-but-ignores any client value, and the writer seeds each row from the prescription snapshot's per-set specs. Warm-up / AMRAP / drop rows are written today. The analytics RPCs (`get_exercise_progression_window` returns it; `get_exercise_prs` filters on it — migration 120) exclude warm-up sets from volume/compliance/PRs; `services/exercise-analytics-service.ts` counts only non-warmup sets and reads the prescribed working-set count from the snapshot's `set_specs`.
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

**Step 4 is create-on-miss, and that default is load-bearing** — manual/overwrite/standalone save paths rely on it so a coach can type a free-text exercise name and have it stick. The AI assistant is the one caller that must NOT create: an invented exercise name would silently pollute the catalog. It uses the read-only `matchExerciseInRows()` / `suggestExerciseCandidates()` pair instead (steps 1-3 only, then repair candidates). Never "unify" these by flipping the shared resolver's default.

### Schema
- Unique index: `COALESCE(coach_id, '00000000-...'), LOWER(name)` - one exercise per name per coach (or globally)
- `exercise_id` FK on `training_exercises` is nullable for backward compatibility (pre-EX-1 exercises have `exercise_id = NULL`)
- ON DELETE SET NULL preserves client/library exercises if a catalog entry is removed

---

## Coach Library

The coach library is the source of reusable training templates. Coaches author programs directly in the full-page builder at `/dashboard/programs` — a new program is created as a `status='draft'` row and promoted to `'saved'` on first successful save. Standalone sessions and the exercise catalog are browsed and edited from the same surface.

```
coach_saved_plans              -- plan templates (status: draft / saved)
  └── coach_saved_sessions     -- reusable sessions (saved_plan_id NULL = standalone)
        └── coach_saved_exercises  -- exercise_id FK to exercises catalog
```

### `coach_saved_plans`
- `coach_id` (FK), `name`, `description`
- `split_type`, `frequency_per_week`
- `status`: `'draft'` (generated, awaiting coach review) | `'saved'` (coach-confirmed)
- `frequency_per_week` — a per-week **average** of non-rest slots, clamped 1..7 (a raw multi-week total violates `training_plans.frequency_per_week`'s CHECK at placement). Re-derived from the session list on every save/overwrite/inline-placement by `deriveFrequencyPerWeek()` (`services/coach-library-helpers.ts`), so the paths cannot drift
- `program_duration_weeks` — the authored program length in weeks, kept truthful by the builder's post-save duration PATCH (and written by every create path). The Programs library derives its Length column and "longest" sort from it; slot/rest counts come from the session rows themselves (migration 128 dropped the old denormalized length columns)
- `default_surplus_percentage`, `source`, `coach_prompt`

### `coach_saved_sessions`
- `saved_plan_id` (FK, nullable) — NULL means a standalone session usable for mix-and-match
- `name`, `focus`
- `week_index` (INTEGER NOT NULL DEFAULT 0, migration 121) — which authored week the slot belongs to. **No calendar/Mon–Sun meaning**; it is slot ordering only. Ordering everywhere is `(week_index, order_index)`
- `order_index` — position within the whole program. The builder writes a global `weekIndex * 7 + day`
- `is_rest` (BOOLEAN) — marks a rest slot. **Every day of an authored week is a real row** (session or `is_rest = true`): "empty === rest", there is no implicit gap
- `estimated_duration_minutes`, `calorie_surplus_percentage`, `session_type`

### `coach_saved_exercises`
- `saved_session_id` (FK), `exercise_id` (FK to `exercises` catalog, SET NULL)
- Full prescription fields: `sets`, `reps_min`/`reps_max`/`reps_target`, `rpe_target`, `percentage_1rm`, `tempo`, `rest_seconds`, `superset_group`, `is_warmup`
- **`superset_group` and `is_warmup` have no program-builder authoring path.** The builder's draft model seeds `null` / `false`, and both round-trip untouched through save, placement and `getClientTrainingPlan`. In the builder a warm-up is a `set_type: 'warmup'` entry inside an exercise's `set_specs`, not a separate exercise. `is_warmup` is still rendered in the client tracker (`exercise-tracker-block.tsx`); its last writer (the legacy calendar drawer's add-exercise dialog) was deleted with the drawer in the placed-plan editing overhaul, so it now only round-trips. `superset_group` has no reader at all. Add no new UI for either.
- `set_specs` (JSONB, migration 119) + `video_url` (TEXT, migration 119) — **also on `training_exercises`** (same shape in both tiers). `set_specs` is the authoritative per-set prescription list (`{ set_number, set_type, reps_min?, reps_max?, reps_target?, load_type?, load_value?, rpe_target?, tempo?, rest_seconds?, drops? }[]`). When NULL the compact columns are the source of truth and `expandSetSpecs()` synthesizes N `working` specs from them, so every prescription yields per-set rows carrying a `set_type`.

  **When specs exist, `sets`/`reps_min`/`reps_max` are a maintained projection, never independent truth.** `projectExerciseCompact()` (`utils/exercise-set-specs.ts`) is the single input-side write helper — it writes `set_specs`/`video_url` verbatim and re-derives the compact trio via `compactFromSpecs` (counting non-warmup sets, clamped to the `training_exercises.sets` CHECK [1,20]). Clone sites splat the source row's columns instead of re-deriving. Editing goes through one pure kernel, `applySetSpecEdit()` (`utils/set-spec-edits.ts`), shared by the builder hook and the assistant's server executors: ≤30 specs, ≤20 drops/set, never all-warmup, and deleting the last set reverts `setSpecs` to `null` (never `[]`).

### Program authoring surface (`/dashboard/programs`)

All training authoring lives here. `/dashboard/training-library`, `/dashboard/programs/sessions` and `/dashboard/programs/exercises` are `redirect("/dashboard/programs")` stubs kept so old links resolve — the Sessions and Exercises libraries live in the builder's tabbed `builder-library-panel.tsx`.

- `layout.tsx` wraps the section in `ProgramsShell`; `page.tsx` is the library table (drafts surfaced with a Draft badge; browse/duplicate/delete only — no apply-to-client here).
- `[savedPlanId]/layout.tsx` mounts `ProgramDraftProvider key={savedPlanId}` with a `{children}{modal}` parallel-route pair, so **program state is owned by the route layout, not the page** — the intercepted `@modal/(.)sessions/new` slide-over mutates the same tree.
- The builder is a weeks × **Day 1–7** grid inside one `DndContext` (`MAX_WEEKS = 52`). Days are **positional, not weekdays** — nothing writes `day_of_week`. A day holds ONE session or is rest; there is no third state.
- One component tree, three `target` modes: `library` (this route), `client-draft` (remounted full-screen inside the client Training drawer; Save/Delete hidden, "Apply to client" shown, program/session name+focus locked as template identity), and `placed-plan` (the amendment surface over a client's live placed plan — past slots locked, identity editable, saves via the amendment PUT; see "Plan amendment"). Apply is wired **through the provider** (`use-client-apply.ts`) — `onApply` is not a prop.

### Authoring + save pipeline

1. `POST /api/training/saved-plans` creates a `status='draft'` row; the coach edits it in the builder. Draft state is seeded ONCE from SWR — refreshes are deliberate no-ops so a revalidation can't clobber unsaved edits.
2. **Save is a 3-step, non-atomic pipeline** (`use-program-save.ts`): client-side zod belt → `POST …/overwrite` (whole tree; delete-all then row-by-row insert) → `PATCH` for `programDurationWeeks` (overwrite never writes it) → if still a draft, `POST …/promote`. Promote is called with **no `saveSessionsIndividually` flag** — a pure status flip, no standalone session copies. A **409 from promote means the content COMMITTED** and only the name collides; never report it as "nothing saved". Because the pipeline is non-atomic, the in-memory draft is the only full copy until success and is never discarded on error.
3. Placement creates fresh client-side rows — `training_plans`, `training_sessions`, `training_exercises`, `training_events`. Library templates are never referenced live; each placement is a copy.
4. `training_plans.saved_plan_id` (nullable, SET NULL) records provenance **only for `type:"plan"` placements**. Every apply-with-edits places `type:"inline"` with `saved_plan_id = NULL` (an edited copy is a copy of no single template). **Do not reason about "which template is this client on" from `saved_plan_id`** — it is NULL for the dominant path.

### AI program assistant (`services/assistant/`, builder S6a)

A chat assistant docked in the program builder executes natural-language edits on the coach's draft ("duplicate week 1 twelve times, week 6 a deload, +5% bench each week"). Its shape is **unlike every other AI feature here** — one-shot generation writes to the DB; this writes nothing.

**The turn.** The draft lives only in browser memory (`ProgramDraftProvider`). Each turn POSTs `{command, text-only transcript, full draft snapshot}` to `POST /api/training/assistant`. The route runs an Anthropic tool loop over a **per-request workspace** (validated snapshot + the coach's catalog, fetched once) and returns `{assistantText, ops, skipped, stopReason}`. **The server performs no database write anywhere in a turn** — the entire blast radius of a bad turn is the returned op list, which the client re-validates before applying. There is no server-side draft state between turns; each turn re-uploads, so mid-turn manual edits are automatically visible to the next command with nothing to reconcile.

**One shared mutation module.** Tool executors (server) and op replay (client) both go through `program-builder-ops.ts` (`applyDraftOp`). This is the load-bearing decision: the two sides cannot drift semantically, and replay runs through the provider's normal `apply()` path, so AI edits get identical dirty-tracking, revision-counter, save and inline-apply semantics to a hand edit. Ops are **uid-addressed with server-minted uids in fully-materialized payloads** — `applyDraftOp` never mints a uid, because a uid minted at replay time would differ from the server's copy and break every later op in the same turn. An op whose target uid vanished (the coach edited mid-turn) **skips with a reason**; it never clobbers.

**Four belts keep AI content out of the catalog.** Read-only resolution at the tool → non-null `exerciseId` required by the op schema → a pre-return sweep that discards the whole turn if an unresolved exercise leaks → client-side re-validation. Template identity in the client editor (program/session name + focus) is likewise enforced per-tool, inside `applyDraftOp`, and by a final diff sweep — a bulk tool cannot bypass it.

**Scope boundary (owner decision, 2026-07-21 — load-bearing, not incidental).** The assistant reads and edits **only the program open in the builder**. It never reads client logs, session history, body metrics, or check-ins, and it never writes to the database. That keeps the feature simple for launch, and it is also what makes the concurrency invariant below unreachable: with the exercise catalog preloaded once per turn, no tool has anything to `await`. **A tool that needs a DB read would cross this line** — the tempting ones being "what did this client lift last week" or "use their current 1RM" — and cannot simply be added. Either serialize tool execution at the composition point first, or keep the new tool synchronous by preloading its data into the workspace the way the catalog is.

**Two silent-failure invariants.** (1) The cacheable tools+system prefix must stay above the model's prompt-cache floor (4096 tokens on Opus 4.8); below it the API caches nothing with **no error** — cost rises and no test fails. `prompt-size.test.ts` guards the size; the telemetry's `cacheEngaged` flag is the live check. (2) Tool `run` bodies must stay **synchronous**: the SDK executes a response's tool calls via `Promise.all` and the prompt encourages batching, which is safe only because a sync body gives the event loop no interleave point while mutating the shared workspace.

Latency is `iterations x round-trip`, so the levers are structural (fewer round trips: front-loaded program context, batched parallel tool calls, tools expressive enough to avoid one-call-per-week) before they are model choice. Every turn logs `assistant_turn` telemetry; read it before optimising.

**Operational surface.** Guards run in order: CSRF → `getAuthenticatedCoachId(request)` → `assistantRateLimit(request, coachId)` (a dedicated tier, 20 req / 5 min, coach-keyed) → zod `safeParse` → when `clientId` is present, an IDOR ownership check. The request body carries `{ command, transcript, draft snapshot, target }`; `clientId` is **required** for both client-scoped targets (`client-draft`, `placed-plan`), and `placed-plan` additionally requires `planId` (route-verified as belonging to that client — a plan-read for authorization only, still zero DB writes in a turn) plus the serialized `lockedSlotUids` (≤400). Caps: command 1..2000 chars, transcript ≤24 messages × ≤4000 chars. The dock is mounted once (`program-builder.tsx`) and reached from both surfaces. Env: `ANTHROPIC_API_KEY`, plus optional `ASSISTANT_MODEL` (default `claude-opus-4-8`), `ASSISTANT_EFFORT`, `ASSISTANT_THINKING`.

**Deployment prerequisite — this route needs a >240s function timeout.** `app/api/training/assistant/route.ts` exports `maxDuration = 300`, deliberately above the SDK client's 240s timeout so a long turn fails as a handled SDK timeout rather than an opaque platform kill. There is **no `vercel.json` in the repo**, so nothing declares this to a host. Any platform capping functions below that (Vercel Hobby is 60s) will kill long turns mid-flight, and it presents to the coach as "the assistant is broken", not as a timeout. Raising either number means raising both. This has never been exercised against a real platform ceiling — the longest recorded turn ran locally.

**A turn is buffered end-to-end** — there is no streaming or per-op live apply, so a slow turn and a hung turn look identical to the coach.

### Whole-program placement (the date-walk)

**The whole authored program is placed exactly once** — a sequential date-walk, not a weekday map. `placePlaceablePlanOnCalendar` (`services/library-placement-service.ts`) builds `programSlots` = ALL sessions across ALL weeks sorted by `(week_index, order_index)`, then:

1. **Computes the window first** — `calculatePlacementEndDate()` = `max(1, programSlots.length)` days (one pass of the program), then **capped, never stretched**, by `getNextPlanStartCap` (the start of the next coexisting plan).
2. **Clones EVERY slot — training and rest** — into `training_sessions` with `day_of_week: null`, `week_index`, `is_rest`. Rest rows are forced to name "Rest", null focus, null surplus, and carry no exercises. Exercises clone only for non-rest slots, splatting `set_specs`/`video_url` verbatim.
3. `generateProgramEvents` walks calendar dates start→end mapping each day to `programSlots[slotPosition]`: **a rest slot advances the position but emits no `training_event`.** The upsert is `onConflict: (client_id, training_session_id, date), ignoreDuplicates: true`, so re-placing the same window is idempotent. Per-event surplus = session override ?? plan default.

> **One scheduled session per client per day (launch scope, migration 136).** A partial unique index on `training_events (client_id, date) WHERE status = 'scheduled'`, plus a status-agnostic pre-check, `assertDateFree` (`services/training-event-occupancy.ts`). It exists because the calendar's original guards all keyed on `training_session_id`, which stopped meaning anything once placement gave each day its own cloned session row — they had been silent no-ops, and the result was stacked sessions on dates the UI could not clear. **Deliberately temporary:** drop the index when multi-session days ship.
>
> **The pre-check is on the three single-date paths, not on every writer** — move, duplicate, and the library-session drop. Whole-program placement and the amendment deliberately skip it: each first deletes the future `scheduled` events in the window it is about to fill, so a per-date question is one it has already answered, and pre-checking would make it reject the window it just vacated. What that clear does not remove is a non-scheduled survivor (an early log), and a concurrent write can still land one between the clear and the upsert. The generated-event upsert arbitrates on `(client_id, training_session_id, date)`, which does NOT cover this index, so such a collision arrives as a raw `23505` — `generateProgramEvents` translates it through `rethrowIfAnyDateOccupied` (the bulk sibling, which recovers the date from the Postgres error detail since the caller cannot know which row collided).

> **Load-bearing invariant — every day-slot is a materialized row; empty === rest.** The date-walk relies on every authored week being a full 7 rows. A missing or implicit rest slot collapses the week to fewer than 7 days and slides every later date. This is why the builder has no "empty" cell state and why placement clones rest rows it will never emit an event for.

The placed rows describe themselves — nothing but the session rows drives the walk.

### Atomic placement (additive — migration 114)
`create_training_plan_atomic()` (the 23-arg signature, with `p_window_end`) inserts the new plan + sessions + events in one transaction as a **coexisting provenance row** (`status='active'`, `effective_until=NULL`). Placement is **additive**: it deletes only **future `scheduled` events within the incoming plan's own date window** (`GREATEST(effective_from, today) … p_window_end`) so the freshly generated events have empty slots to land in. There is **no STEP-0 cross-plan wipe and no archival of the previous plan** (the old behavior of migration 087); non-overlapping plans coexist and reads resolve "active" by date. `services/library-placement-service.ts` computes the window via `calculatePlacementEndDate()` and caps it at the start of the next coexisting plan (`getNextPlanStartCap`) so two placements never bleed into each other. Every generated event keeps carrying `calorie_surplus_percentage` (the nutrition-cascade contract).

### Plan amendment (rewrite-future — placed-plan editing overhaul, Job 2)

A coach can amend a plan **already placed on a client's calendar** mid-flight ("client isn't coping 5 weeks in — reduce everything remaining"): the shared Program builder mounts full-screen over the placed plan (`ProgramDraftProvider target="placed-plan"`, `components/clients/training/builder/plan-amendment-overlay.tsx`), with every elapsed day **locked** and the future fully editable — structure included. Entry points: the Plans-subtab hero's "Edit plan" and the placed-session tray's "Edit whole plan". No RPC, no migrations — the writer uses the same app-side snapshot/compensate idiom as placement.

- **Route pair** `GET`+`PUT /api/clients/[id]/training/[planId]/amendment` (`services/plan-amendment-service.ts`). The GET returns the full-fidelity placed plan — every active session row (rest included) in the canonical `(week_index, order_index, created_at, id)` order with complete exercises and per-slot event linkage — plus the recomputed window, `isFullyPast`, the list of manually-moved future events, and a **drift token**.
- **The plan's active rows ARE its day-slots — one per `(week_index, order_index)`.** `slotRows[i]` is the slot whose day is `effective_from + i`. That is not a property of the table: `cloneSessionForEvent` adds a second active row at an existing coordinate by design, and one extra row shifts every later index, which mis-partitions elapsed vs future, stretches the window by a day, and breaks the editor's every-week-is-7-rows test. `toSlotRows` (`plan-amendment-service.ts`) makes the list explicit — canonical order, first row per coordinate (earliest `created_at`, then `id`). Losers are left alone, never deactivated. **Derive positions from `slotRows`, never from a raw active-row query.**
- **One lock source, three routes.** Locks derive from a serializable `lockedSlotUids: string[]` computed at seed (`program-builder-lock-model.ts`): a slot is locked iff its date-walk day (`effective_from + position`) is before the client's today, **or** a linked event left the `scheduled` state (early log), **or** a linked event is dated before today (the coach moved it forward and the calendar overtook it). Grid rendering, dnd gating, the provider's wrapped mutators (`use-locked-mutators.ts`), `applyDraftOp`'s ctx, and the assistant's server executors all consume the same set. **`amendPlacedPlanFuture` derives its frozen positions from the same three clauses against live DB state, and the two must not drift** — a slot the editor locked and the writer replaced is exactly how a plan ended up with two active rows claiming one day. A frozen position keeps its row, is skipped by the insert loop, and is passed to the walk as `skipPositions` so its day is not re-emitted. Shrinking the grid past a frozen position is a 422. The third route is the only one that can lock a slot in a *future* column, so it carries its own message (`MOVED_PAST_LOCKED`); `computeMovedPastSlotUids` is presentation-only and stays out of the serialized lock contract.
- **The server is the boundary authority.** The PUT recomputes `floor = max(effective_from, clientToday)` and `offset = daysBetween(effective_from, floor)` itself and **ignores incoming content at past positions**. Drift since the GET — a plan write, a calendar move/delete, an early log, the client's midnight flip — is caught by the token (sha256 over `{plan.updated_at, clientToday, delete-candidate tuples}`) → **409**, surfacing a reload-vs-keep-editing dialog with the draft intact.
- **The rewrite** (all steps idempotent-or-compensated): insert fresh future rows first (verbatim `set_specs`/`video_url` splat, foreign-exercise-id belt) → soft-delete replaced rows, KEEPING elapsed positions and any row referenced by a surviving event (the belt that makes diverged plans safe) → delete future **scheduled** events under both placement-mirror predicates (plan-scoped unbounded + client-scoped window; **no `is_modified` filter** — manually-moved future events are re-laid, behind an explicit pre-save warning) → resume the shared date-walk (`services/program-event-walk.ts`, `startPosition: offset`) so every regenerated event carries its surplus/name snapshots → plan meta (`program_duration_weeks`, re-derived `frequency_per_week`, `updated_at` bump; `effective_until` untouched). A mid-flight failure restores sessions, exercises, and the event snapshot, preserving the root error. Success cascades nutrition from the floor and records a `training_plan.amend` audit event.
- **Blocked states:** an ended plan (window fully past) can't be amended or extended — 422, entry disabled ("apply a new program" is the gesture). Shrinking the grid below the elapsed days is 422. An all-rest future is legal (an explicit deload).
- **Identity is editable here** (unlike `client-draft`): renames propagate to future scheduled events only; past events keep their snapshots, which is correct history.

The assistant works on this surface too (`target: "placed-plan"`): the request carries `planId` (route-verified against the client) + the serialized `lockedSlotUids`; executors and client replay refuse locked slots identically, a pre-return **locked sweep** discards any turn whose final locked-slot content differs from entry, and the identity sweep is deliberately NOT applied — renames survive.

### Stale drafts
EL-1 (not currently in scope) specifies a cron that deletes draft plans older than 7 days. Until then abandoned drafts accumulate, but they are **no longer invisible**: the Programs library table surfaces them with a Draft badge (reads default to saved-only; `?status=all` / `includeDrafts` opts them in), so a coach can open or delete them. Only `status='saved'` plans can be placed by id — `placePlanOnCalendar` throws otherwise.

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

- **Home** (`app/client/page.tsx`): day-summary cards (training, nutrition, wellness, habits) and a check-in summary card. Training renders a list when multiple sessions are prescribed.
- **Detail pages** (each fetches only its own data): `/client/training?date=X&eventId=Y`, `/client/nutrition?date=X`, `/client/wellness?date=X`, `/client/habits?date=X`. Back returns to home with the date preserved.
- **Metrics** (`/client/metrics`, `components/client-portal/metrics/metrics-hub.tsx`): progress hub — body metrics, habit progress + streaks, and trends.
- **Program** (`/client/program`): the client's current training plan + nutrition plan cards.
- **Check-in** (`/client/check-in`): reached from the Home check-in card (`components/client-portal/day/check-in-card-summary.tsx`) and from notifications (`actionUrl: "/client/check-in"`), not a bottom tab. The hub shows the in-window submission form (gated by `clients.expected_check_in_day` + `calculateCheckInPeriod()`) plus a newest-first history list drilling into `/client/check-in/[id]`.

### Data model

Reads/writes the existing day-keyed tables — no portal-specific schema:
- **Targets (read):** `training_events` (one row per session per date), `nutrition_events` (one per client per date).
- **Daily-logs spine + children (write):** `daily_logs` → `wellness_logs`, `nutrition_logs`, `training_logs`, `daily_habit_logs`.
- **Training completion:** `training_logs` → `session_logs` → `exercise_logs` → `set_logs` (per-set actuals). `prescribed_session_snapshot` / `prescribed_exercise_snapshot` JSONB preserve history when plans change.

### API surface

**Reads:** `GET /api/client/day-summary?date=` (home payload `{ training[], nutrition, wellness, habits }`, `no-store`) · `GET /api/client/training/events/[eventId]` · `GET /api/client/daily-logs/[date]/{wellness,nutrition}` · `GET /api/client/habits` + `GET /api/client/habits/logs` (habits are **not** under `/daily-logs/[date]`) · `GET /api/client/training-plan` (date-resolved; carries `state`/`startsOn`/`endsOn` — see "Client-side plan tier") + `GET /api/client/nutrition-plan` (Program tab) · `GET /api/client/training/exercise-history` (bounded full return) · `GET /api/client/check-ins` (**keyset-default**, opaque base64url `{createdAt,id}` cursor via `lib/cursor.ts`; legacy `?offset=` opt-in).

**Writes:** `POST /api/client/training/events/[eventId]/log` (bulk-replace `session_logs` + `exercise_logs` with snapshots; updates `training_events.status`) · `POST /api/client/training/session-logs` (event-less log for a rest-day or alternative session; plan-active guard) · `PATCH /api/client/daily-logs/[date]/{wellness,nutrition}` (nutrition is plan-active-guarded; wellness is ungated) · `POST /api/client/habits/log` (per-habit toggle for a date; ungated) · `PATCH /api/client/settings` (`weight_unit`, `unit_preference`, `reminder_preferences`, `timezone` — IANA-validated).

Every write resolves plan context once via `resolvePlanContextForDate(clientId, date)` to stamp the `*_plan_id` links, and enforces the past-day lock server-side.

### Workout logging (progressive disclosure)

Two modes, client's choice per session, no coach config — both hit the same endpoint/save button (`components/client-portal/training/`):
- **Quick log (default):** complete / partial / skipped + optional notes → `session_logs` with the chosen `completion_quality`, no `exercise_logs`.
- **Detailed log (collapsed disclosure):** per-set reps/weight/optional RPE, "Copy previous set", "Add exercise" (unplanned), "Skip exercise" → `session_logs` + one `exercise_logs` row per logged exercise with snapshots. Unlogged prescribed exercises count as skipped; mixed → `partial`. Save is a single bulk-replace (no per-set auto-save).

### Alternative-session handling

Clients can swap on a planned day or train on a rest day via the active-plan session picker. On write, each `session_log` links to an unlinked, matchable `training_event` (`status IN ('scheduled','missed','skipped')`, `session_log_id IS NULL`) in the same week — by performed session id, then date, then session id in-week; no match leaves `training_event_id NULL` as a surplus session. Snapshots (Option A): `prescribed_session_snapshot` from the **matched event** (calendar story); `prescribed_exercise_snapshot` from the **chosen session** (what they did). Adherence counts only `training_events.status='completed'`; the coach calendar is unchanged.

### Date-edit permissions

One rule in `lib/daily-log-permissions.ts` (pure, client-safe): today always editable; past-never-logged editable (backfill); past-logged locked; future view-only. `canEditDay(date, loggedStatus, clientTimezone)` drives UI disabled state; the server wrapper `assertCanEdit()` (`services/daily-log-permissions-service.ts`) throws `DayLockedError` → 403. Habits lock per-habit (optional `habitId` narrows the "logged" check), not per-day.

### Timezone model

**Locked model (Sessions 7.81–7.86): "today" is computed in the device timezone of the person whose calendar the date is on — never the server's UTC clock.** A client's day, plan placement, check-in window, streaks → the **client's** zone. A coach's dashboard windows (attention feed, current-week metrics, history summaries) → the **coach's** zone. The cross-person cases (a coach viewing a client's check-in due/overdue; background reminders) → the **client's** zone. One question decides every site: *whose calendar is this date on?*

- **Storage**: `clients.timezone` (migration 089) and `coaches.timezone` (migration 109), both `TEXT NOT NULL DEFAULT 'UTC'`, IANA.
- **Capture is device-synced, no manual picker** (Session 7.81 — intentionally reverses Session 2.6's "no silent overwrites"): the shared `useTimezoneSync` hook (`hooks/use-timezone-sync.ts`) compares the device zone against the stored value on every app load and fires a fire-and-forget PATCH on mismatch (client shell → `PATCH /api/client/settings`; coach shell → `PATCH /api/coach/settings`). Travel re-syncs on next open.
- **Read side**: server code derives "today" via `getTodayDateStringInTimezone()` in `lib/date-helpers.ts` — the only surface owning `Intl.DateTimeFormat` math. (Sanctioned exception: the two settings routes validate input zones with `Intl.supportedValuesOf("timeZone")` — validation, not date math.)
- **Helper inventory**: `lib/date-helpers.ts` owns the pure helpers — `getTodayDateStringInTimezone(tz, now?)` (string), `getTodayInTimezone(tz, now?)` (local-midnight `Date` for the injectable check-in helpers; NOT `parseISODate`, which parses as UTC midnight), `getDeviceTimeZone()` (browser capture). `services/today-service.ts` owns the DB-fetching ones — `getClientTodayString(clientId)` (client tz → coach tz fallback while the client is on the unsynced `'UTC'` sentinel → UTC) and `getCoachTodayString(coachId)`. **Rule:** when a `Client` record with `timezone` is already in scope, use the pure helpers (zero extra fetches — the overdue/attention-feed loops rely on this); the fetching helpers are for call sites holding a bare id.
- A stored `'UTC'` is the "never device-synced" sentinel; coach-initiated placement on a never-synced client's calendar falls back to the coach's zone (`getClientTodayString`, Session 7.82), then UTC.
- **Where each anchor applies** (Sessions 7.82–7.86): client tz — plan placement RPCs (`p_today`), calendar move/duplicate/delete guards, the client home week, check-in gate/window, streaks/habit defaults, goal-pace `today`, goal-deadline days-remaining (Session 7.86, `services/comparison-service.ts`), the coach calendar's drag/delete *gating* (Session 7.86 — the visual today ring stays coach-device), check-in due/overdue, and the placement-path event window-delete (`clientToday` threaded from the route as the additive RPC's `p_today` floor, `GREATEST(effective_from, today)`; migration 114 replaced the old STEP-0 cross-plan wipe). Coach tz — attention-feed window, coach "current week" metrics/history anchors, the attention-dismissal `dismissed_at` (migration 112 drops the column's UTC `CURRENT_DATE` default so a writer that forgets the date fails loudly), and the goal-deadline write bound (Session 7.86 — the coach is the setter, so the past-date check is route-side via `getCoachTodayString`; the zod schema is format-only). The placement RPCs additionally take `p_effective_from DATE DEFAULT NULL` coalescing to `p_today` (migration 110, carried into the additive 114/115 rewrites).

### Scale / payload contracts

Keyset-by-default is scoped to paginated, time-ordered "load older" history (check-ins). Small bounded sets return in full with no cursor (habits, a 1-week completions window, the exercise list). History rows are ID-first (`exercise_id` + `performed_name` fallback), never the catalog dictionary; the dictionary syncs separately via `GET /api/client/exercises/catalog?since=` (a read-only delta returning rows with `updated_at` after `since`; the client upserts them into its cached catalog — deletes are invisible to the delta, so a periodic full resync, by omitting `since`, catches them; internally paged past the ~1000-row PostgREST cap). Weight is rendered client-side in the user's unit preference via `formatWeight(weightKg, unitPreference)` (no `formatWeight` calls in `app/api/client/**`); viewer-relative per-record units (stored `weight_unit` + conversion at the API boundary) are Phase 8, not yet built.

### Coach-side wellness strip (unmounted)

`components/clients/daily-pulse/daily-wellness-strip.tsx` — frozen legacy, and **no longer mounted anywhere** since the Overview redesign replaced it with the five-card Daily-wellness section. The files stay (nothing is scheduled to delete them); `hooks/use-wellness-data.ts` is still its data source and remains shared with the Overview.
- Fetched a 28-day rolling window of daily_logs + habit_logs via `Promise.all`
- Rendered a 2x2 bar chart grid (mood, energy, sleep, stress) + adherence dots
- Ran `detectAlerts()` client-side — a second, independent alert computation from the server-side attention feed
- **Intentionally 4-metric**: it never rendered soreness. The Overview's replacement renders all five (see below)

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
| Overview | `ClientOverviewTab` | Six sections, top to bottom: Waiting on you + Since your last visit · Coach notes · Client & Schedule + Client Status · Current plan · Adherence · Daily wellness. See "Coach client Overview" below |
| Metrics | `MetricsTabContent` | Metric hero + progression chart + measurement log over merged check-in ⊕ coach-logged series (`client_metric_entries`); "Log measurement" modal |
| Training Plan | `TrainingPlanCard` → `TrainingPlanBuilder` (Data / Plans / Exercise Data) | Calendar + hero, exercise analytics. "Apply program" opens the library drawer, which remounts the shared `/dashboard/programs` builder in `client-draft` mode; "Edit plan" (hero) / "Edit whole plan" (session tray) open the same builder in `placed-plan` mode over the live placed plan (see "Plan amendment"). (The plan-history list below the calendar was removed with the dead `training_plan_history` read chain — the table has had no writer since P7.) |
| Nutrition | `NutritionCalculatorCardEnhanced` + `NutritionHistoryTable` | Plan builder, per-day nutrition calendar, weekly adherence history |
| Wellness | `WellnessTabContent` | Wellness trends and analysis |
| Daily Habits | `HabitsTabContent` + `HabitsHistoryTable` | Habit management, analytics |
| Notes | `NotesTabContent` | `client_notes` list — pinned first, newest-first, add + pin/unpin. Same endpoints as the Overview card |

Tab changes call `router.replace(/clients/${clientId}?tab=${tab}, { scroll: false })` to sync URL without scroll.

### Builder flows

- **Training (authoring)**: `ProgramDraftProvider` (`components/clients/training/program-builder/`) owns the draft tree, revision-counter dirty tracking, set-spec mutations and the save/apply/amend pipelines. It is the **only** training authoring state, used identically in `target="library"`, `target="client-draft"`, and `target="placed-plan"` (the amendment surface — see "Plan amendment" under Coach Library). It deliberately lives beside the builder rather than in `contexts/`, because a route layout mounts it.
- **Training (client tab, read-only)**: `TrainingBuilderProvider` / `useTrainingBuilderContext()` wraps `useTrainingPlan` and supplies the client's current plan + `fetchPlan` to the Plans tab. Read surface only — do not add authoring to it.
- **Nutrition**: `NutritionBuilderProvider` wraps `useNutritionBuilder`. Manages calorie targets, macro breakdown, custom macros toggle. Calculates adjusted targets from client metrics (BMR, activity level). This is the one remaining `generatePlan()` caller.

Each context is a thin wrapper: it provides the hook's return value, and consumers access it via the context hook.

### Coach client Overview

`components/clients/client-overview-tab.tsx` + `components/clients/overview/**`. Six sections reading top to bottom as *what needs my attention → what happened → what I said last time → who this client is → what they are on → how consistent they are → how they feel*. Every summarising card links to the tab that owns its data; every unset state names what is missing and offers the action that fixes it.

Four SWR reads back it, all coach-scoped under `/api/clients/[id]/`:

| Endpoint | Serves | Notes |
|---|---|---|
| `GET …/overview-brief` | Waiting on you, the activity feed, the check-in timing strip | **Read-only** — it does not touch the `last_viewed_at` anchor |
| `POST …/overview-brief/seen` | "Mark seen" | The ONLY writer of `coach_client_views.last_viewed_at`; returns `{ lastViewedAt }` nested under `data` |
| `GET …/overview-plan-summary` | Current-plan cards + the status card's training-block chips | `training`, `upcomingTraining` and `nutrition` are independently nullable |
| `GET …/adherence?days=` | The three-rail adherence card | `days` clamped to [7, 28]; rails are index-aligned with `dates` |
| `GET`/`POST …/notes`, `PATCH …/notes/[noteId]` | Coach-notes card + Notes tab | See `client_notes` above |

Load-bearing details:
- **The anchor moves only on "Mark seen".** The GET was made read-only so a page load cannot silently clear the coach's unread feed. A first visit (null anchor) returns an empty feed and renders a first-visit state rather than a caught-up one.
- **No roadmap or phase concept exists.** The status card's chips describe the active *training block* — plan name · `Week X of Y` (via `utils/plan-week.ts`) · Active/Ended. "Ended" here means today is past the **authored duration** — a different derivation from the slot-count one the client reader and the amendment surface share (see "Client-side plan tier" above for why both exist).
- **Training has three states, not two.** `getTrainingPlanForDate` resolves strictly by date (`.lte("effective_from", today)`), and placement deliberately permits a future start date (`place-from-library` rejects only the past), so a program starting tomorrow leaves `training` null. The window-flipped twin, **`getNextFutureTrainingPlan`** (`services/training-service.ts`), is the ONE owner of the "starts later" predicate — client-scoped, `deleted_at IS NULL`, **`status <> 'archived'`**, earliest first. This card and the Training tab both read through it. They previously hand-rolled it separately and the Training tab's copy omitted the archived exclusion, so a retired program resurfaced there as the client's current plan while this card correctly said "No plan". Never write a fourth copy. `upcomingTraining` carries that queued program so the Overview reports "Starts Mon, 27 Jul" rather than "No plan" — the old copy told a coach who had just assigned a program that none existed, and its "Open Training" call to action invited them to place a *second* one alongside it, which the additive placement model accepts. A program whose window has **ended** deliberately keeps the "no plan, place one" invitation: an ended plan cannot be amended, so assigning a new one is the correct gesture. Do not widen `getTrainingPlanForDate` to fix this — write paths stamp `training_plan_id` from it and need "the plan governing today" to keep meaning exactly that.
- **Goal chips come from `lib/goals/goal-state.ts`** (reached / beyond / gap). The under-vs-over wording needs the direction of travel, which only the call site's `start` value knows.
- **Alert rows route through `lib/attention-alert-destinations.ts`**, the same map the dashboard feed uses, so the two surfaces cannot disagree about where an alert leads. Each row also carries a hover-revealed dismiss that posts to the **dashboard's** `POST /api/dashboard/attention-feed/dismiss` — one `attention_dismissals` store serves both surfaces, and `evaluateSingleClientAlerts` already filters on it, so dismissing here clears the alert on the coach dashboard too and lapses when a newer day trips the same trigger.
- **A mono datum inside a sans line uses `InlineMono`** (`overview/overview-primitives.tsx`), never a literal space. At 13px an Instrument Sans space measures **2.5px** against JetBrains Mono's **7.8px** (CDP-measured), so `Starts <date>` written with a plain space leaves the label glued to the value while the value's own internal spaces look 3× wider. `InlineMono` carries `ml-[1ch]`, which resolves against its own font and therefore always matches the datum's rhythm at any size — call sites must not add a space of their own.
- **Two cards must be told when their data is still loading.** `CoachNotesCard` (`isLoading`) and `ClientScheduleCard`'s check-in strip (`isTimingLoading`) both receive empty-shaped data while pending *and* when the client genuinely has none. Without the flag they render a confident "no notes" / "never asked to check in" and contradict it a moment later. Covered by `overview/loading-states.test.tsx` — keep the flag threaded through any new consumer.
- **Five wellness cards**, Soreness included. Stress and soreness are inverted (lower is better) through `getWellnessTone()` in `utils/wellness-color-thresholds.ts` — the single source for that inversion, shared with `components/check-in/mini-bar-sparkline.tsx`. **Sleep has no trigger in `lib/wellness-triggers.ts`, so its card can never flag; do not invent one.**
- Wellness values come from `GET …/daily-logs` narrowed to 7 days through `useWellnessData(clientId, { daysBack, withHabitLogs })`.

### Attention feed

Wellness/tracking/activity triggers evaluate across all coach's clients:
- `lib/wellness-triggers.ts` - mood/energy drops, stress/soreness spikes
- `lib/tracking-triggers.ts` - logging gaps, nutrition/training misses
- `lib/activity-triggers.ts` - habit dropoff, activity-calorie mismatch
- `lib/engagement-triggers.ts` - no-engagement / disengaged-client detection (absence signal)
- `services/attention-feed-service.ts` - aggregates triggers into prioritized feed
- `components/dashboard/needs-attention-feed.tsx` - renders on coach dashboard via SWR

The nine wellness/tracking/activity triggers are pattern detectors over existing `daily_logs`, so they can only fire for clients who have logged. `evaluateAndSortTriggers` (`lib/attention-feed-helpers.ts`) therefore evaluates any client with **prescribed work** (training events or habits) even before their first daily log — it skips only clients with nothing logged AND nothing prescribed. `evaluateNoEngagement` is the one *absence* signal: it flags an active client who has prescribed work but no activity across any surface (daily_logs, daily_habit_logs, or completed/partial training_events) within the silence window, past an activation grace period. This is why a never-logged client with an assigned plan now surfaces instead of being silently counted "on track".

---

## Auth Model

### Dual role system

- `profiles` table: `user_id`, `role` (`trainer` | `client`)
- `coaches` table: created by the `handle_new_user` signup trigger (migration 107) at `auth.users` INSERT for trainers; `GET /api/auth/me` re-creates it idempotently if missing
- `clients` table: `user_id`, `coach_id` for ownership
- Role is derived from **server state** (a `client_invitations` row matching the signup email case-insensitively ⇒ `client`, else `trainer`) — never from client-supplied user metadata (migration 107 anti-privilege-escalation)

### Middleware routing (`middleware.ts`)

- Public routes: `/check-in/*`, `/api/check-in/*`, `/invite/*`, `/api/invitations/*`, password reset
- Trainers: restricted to `/dashboard`, `/clients`, `/check-ins`, etc.
- Clients: restricted to `/client/*` routes
- Role mismatch: redirects to appropriate dashboard

### Auth helpers (`lib/auth-helpers.ts`)

- `getAuthenticatedCoachId()`: validates JWT via `supabase.auth.getUser()`, queries `coaches` table, returns coach ID or null
- `getAuthenticatedClientId()`: same pattern against `clients` table

### Session bootstrap (`GET /api/auth/me`)

The browser `AuthProvider` (`contexts/auth-context.tsx`) is session-lifecycle-only: `supabase.auth` for login/signup/OAuth/logout/reset, with a **synchronous** `onAuthStateChange` callback (supabase-js holds an origin-wide Navigator lock while the callback runs; an awaited supabase query inside it deadlocks — the historical `fetchProfile timeout`). Profile and coach come from `GET /api/auth/me` via SWR, keyed on the user id. The route chain is `apiRateLimit → getUser() → getOrCreateProfileAndCoach()` (`services/auth-profile-service.ts`, `supabaseAdmin`), returning `{ profile, coach }` (`coach: null` for clients) with `Cache-Control: no-store`. The service mirrors the trigger's invitation-derived role and uses `ON CONFLICT (user_id) DO NOTHING` semantics, so it is race-safe against the trigger and against concurrent requests; on success `role === "trainer" ⟺ coach` is present. The browser anon-key client never reads `profiles`/`coaches`. Note: middleware fail-closes profile-less sessions (`/login?error=profile_unavailable`) before any route runs, so the route's profile-create branch is defense-in-depth; the coach-row self-heal is reachable and verified.

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

### Audit logging (migration 108)

An immutable, append-only `audit_logs` table records security-relevant actions on client-owned data for incident investigation and accountability (`services/audit-log-service.ts`, `supabase/migrations/108_create_audit_logs.sql`).

- **Table**: `audit_logs` — RLS deny-all for anon/authenticated; written via `service_role` only. Fields: `actor_id` (coach/client id, or null for system), `actor_role` (`trainer` | `client` | `system`), `action` (dotted key, e.g. `goal.create`), `target_table`, `target_id`, `client_id` (tenant scope), `metadata` (small non-sensitive context — never health PII), `ip_hash` (SHA-256 prefix, never the raw IP), `created_at`. Indexed `(client_id, created_at DESC)` and `(actor_id, created_at DESC)`.
- **Usage**: routes call `recordAuditEvent(...)` **fire-and-forget** (`void`-prefixed) after a successful, already-authorized write. Action names come from `AUDIT_ACTIONS` (`lib/constants.ts`). Live call sites include client invitation/activation, goal create, training placement, plan amendment, metric entries, nutrition plan creation, and intake metrics sync. Failures go to Sentry, never to the user.
- **Design**: the audit trail records what the route already authorized — it never authorizes anything and never blocks the request path.

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
     tap-a-card-to-log + alt-session callout, swipe days, settings via avatar)
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

Uses `Promise.all` with `safeQuery()` wrapper for partial failure tolerance. The coach sees the `ClientActivationBanner` component which shows the checklist status. `activation-readiness` is advisory — `POST /api/clients/[id]/activate` does not enforce it. The orphan-log perimeter lives at the per-card **nutrition** writer and the **event-less training** writer (see `assertHasActivePlan` in `services/daily-context-service.ts`): each rejects a write whose `*_plan_id` stamp would be null, because those stamps feed adherence reads. The **event-keyed** training writer (`POST /api/client/training/events/[eventId]/log`) needs no guard — the event already carries its `training_plan_id` from plan generation. Wellness and habits writes are deliberately ungated (Session 3.1C) — wellness has no plan or adherence concept, and all wellness analytics are date-windowed.

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

---

## Check-in System