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
  │     └── coach_saved_sessions    -- reusable sessions (saved_plan_id NULL = standalone); a day's sessions share its position, each at its day_order (mig 180)
  │           └── coach_saved_exercise_groups  -- the session's groups, in order: format + settings (mig 178)
  │                 └── coach_saved_exercises  -- its group and its place in it; exercise_id FK to exercises catalog
  │
  ├── check_in_questions            -- the coach's question bank (edited in place, archived not deleted)
  ├── check_in_forms                -- client_id NULL = a named reusable TEMPLATE in the library
  │     ├── check_in_form_fields        -- (form_id, field_key) — row present = the form asks it
  │     └── check_in_form_questions     -- (form_id, question_id) + position + enabled
  │
  └── clients                        -- coach_id FK, one coach per client
        ├── training_plans            -- MANY coexisting placements, each with a stored [effective_from, effective_until] (mig 167); saved_plan_id FK tracks library provenance (nullable)
        │     ├── training_sessions   -- carries calorie_surplus_percentage (copied onto each event; a nutrition day reads it off the event); a day's sessions share its position, each at its day_order (mig 180)
        │     │     └── training_exercise_groups  -- the session's groups, in order: format + settings (mig 178)
        │     │           └── training_exercises  -- its group and its place in it; exercise_id FK to exercises catalog
        │     └── training_events        -- one row per session per date, a day's sessions in order (calendar SOT; training_plan_id FK is SET NULL)
        ├── nutrition_plans           -- DATE-RANGED VERSIONS, each a PLACEMENT with a stored end (mig 166); a day's target is COMPUTED from the version covering it -- there is no day table; the save's coach_note rides the row (mig 172)
        │     └── nutrition_plan_daily_targets  -- the version's per-weekday grid, the numbers a computed day takes verbatim
        ├── nutrition_day_edits       -- the coach's per-day override, one row per (client, date) (mig 169)
        │
        ├── exercises (catalog)          -- two-tier: global (coach_id=NULL) + coach-specific; every row carries its exercise_type (mig 185)
        ├── daily_habits
        │
        ├── daily_logs (spine)        -- one per client per day
        │     ├── wellness_logs
        │     ├── nutrition_logs         -- what the client ate; the target is computed (see "A logged day carries no target")
        │     ├── training_logs
        │     │     └── session_logs
        │     │           ├── session_log_group_scores  -- a timed group's score on the log: rounds + reps, or a finish time (mig 186)
        │     │           └── exercise_logs
        │     │                 └── set_logs   -- per-set actuals: every measure a coach can prescribe, as real columns (mig 184)
        │     └── daily_habit_logs
        │
        ├── check_in_forms            -- the CLIENT's own form (at most one; no row = the full default form)
        ├── check_ins                 -- weekly structured submissions
        │     └── check_in_answers    -- one per (check-in, custom question); prompt read through the FK
        ├── client_goals              -- versioned goal records
        ├── client_phases             -- journey blocks: name, focus, [starts_on, ends_on], archived_at
        ├── client_notes              -- coach notes about the client (one pinned max)
        ├── client_metric_entries     -- coach-logged WELLNESS entries (one per client, metric, day)
        └── client_measurements       -- every body measurement, one row per reading (edited in place, removed by a mark, never deleted)
```

---

## Client Goals & Body Metrics

### client_goals table

Versioned goals using the `effective_from` / `superseded_at` pattern:
- New goals are created as new rows (never update existing records)
- The previous active goal gets `superseded_at = NOW()` when a new goal is set
- Unique index ensures one active (non-superseded) goal per client
- Fields: `goal_weight`, `goal_body_fat_percentage`, `goal_deadline`, `primary_goal`, `set_by`, `notes`
- **`primary_goal` is inert but not safely droppable.** Nothing branches on it — it is mapped, typed and validated and read by no logic — yet it is an **unconditional key** in `updateGoals`' merged INSERT, so a bare `DROP COLUMN` PGRST204s **every** goal write. Remove the code first. (Not to be confused with `client_intake.primary_goal`, a live discriminator with three real branches.) See `TECHNICAL-DEBT.md`.

**One writer, one read path, one editor** (Session 0b, invariant 16):

- **`updateGoals` (`services/client-goals-service.ts`) is the ONLY writer of the goal columns on
  BOTH stores.** The four callers that used to write `clients.goal_*` themselves — `createClient`,
  `updateClient`, the metrics PUT and the intake sync — no longer do, and none of them swallows a
  goal failure any more: a goal edit lands in `client_goals` or errors visibly. **It is still not
  atomic** (three autocommitted round trips; the inner mirror UPDATE is logged-and-swallowed), so
  divergence is single-sourced and loud rather than impossible. The fix is an RPC and needs a
  migration.
- **`updateGoals` supersedes-and-inserts on EVERY call with no change detection of its own.** Any
  caller must compare against what it seeded and skip the write when nothing changed, or it mints a
  goal version and an audit event per save.
- **`goalWeight` can be changed but never cleared** — `.optional()` and NOT `.nullable()` in
  `updateGoalsSchema`. The other three fields accept explicit `null`.
- **The editor is the client details sheet** (`use-client-profile-edit.ts` +
  `components/clients/details/**`) — goal weight, goal body fat and deadline, in its
  Goals & energy group. The nutrition drawer shows a read-only line; its editor was deleted.
  Setting a goal no longer requires opening a nutrition plan. The Overview page itself is
  read-only: the status band DISPLAYS both targets and the sheet is the one way to change them.
- **Routes:** `GET`+`PUT /api/clients/[id]/goals` (`data` is always `ClientGoal | null` — the old
  shape-switching `?history=true` branch is gone) and `GET …/goals/history`, which returns
  **superseded versions only**, newest first, bounded by `GOAL_HISTORY_LIMIT`. The past-deadline
  bound is route-side against the **coach's** local today, deliberately not in the schema.

### Effective goal resolution

A single pure resolver, `resolveEffectiveGoal()` (`lib/goals/resolve-effective-goal.ts`), turns the live `client_goals` record into the goal that drives nutrition + pace. It normalizes **nothing** — `client_goals.goal_weight` is canonical kilograms (migration 141), so the resolver reads it straight through and its old `weightUnit` parameter is gone rather than ignored. A NULL weight means **maintenance** (`goalWeightKg: null`). A goal has no start of its own: the window a nutrition deficit is spread over begins at the day the plan takes effect (see "Nutrition plan versions"), so the resolver takes no `today`.

**Six direct callers** (re-derived 2026-08-29 — the 2026-08-13 list missed `client-journey-service`, added the day before it was drawn up; the Overview joined them in Session 0b Task 0b.1. An older list still named the orchestrator, which has not called this resolver since it moved to `resolveNutritionCalcInputs`, and omitted `nutrition-calc-inputs.ts` entirely):

- `services/nutrition-calc-inputs.ts` — the shared calculator-input resolver, and the **only** route to `resolveEffectiveGoal` for both the nutrition write path (`nutrition-plan-orchestrator.ts` calls `resolveNutritionCalcInputs`, not this resolver) and the coach nutrition GET.
- `services/comparison-service.ts` — the check-in review's goal strip: the goal version in force at the check-in's instant (`getGoalAsOf`), so weight **and** deadline come from one version; the clock — the days remaining — is the check-in's day on the client's calendar (docs/MEASUREMENT-LOG-PLAN.md commit 8b). It composes its input from that `client_goals` row alone — no `clients.*` mirror leg — so a check-in older than every version has no goal on its page. The Overview and the Journey resolve the live goal at today.
- `app/api/clients/[id]/nutrition/route.ts` — the goal-drift check ("Goal changed — regenerate"), a second independent resolve in the same request as the one above.
- `components/clients/client-overview-tab.tsx` — the coach Overview's status band and its details sheet, fed by one SWR read of `GET /api/clients/[id]/goals` (`hooks/use-client-goals.ts`) and passed down as a prop. The card this band replaced previously read `clients.goal_weight` / `goal_body_fat_percentage` directly and was the last coach surface rendering an unresolved goal.
- `components/clients/metrics/hooks/use-merged-metrics.ts` — the coach Journey: the goal line and the "to go" figure on the Weight and Body Fat heroes.
- `services/client-journey-service.ts` — `GET /api/client/journey`'s goal weight and deadline (owner decision 2026-08-12: the one client-facing surface that reads `client_goals`, and the deadline, through this resolver). It composes its input inline from the `client_goals` row alone — no `clients.*` mirror leg, by that decision, and the service holds no `Client` record for `toClientGoalInput` to read one from — so it is not on the shared composer below either.

**The resolver's input is composed by one shared helper, `toClientGoalInput(currentGoals, client)`** (same module), used by the four callers above that hold a `Client` record and read the live goal — every one but `client-journey-service` and `comparison-service`, which each compose their input from a `client_goals` row alone with no mirror leg: the journey read by that decision, the check-in review because it reads the version in force at the check-in's instant, and a check-in older than every version had no goal then (commit 8b) — `use-merged-metrics` joined them in Session 0b Task 0b.3, replacing a private literal that hardcoded `deadline: null` after fetching the full goal. Weight and body fat carry a `?? client.*` mirror leg — the documented read switch for a client whose goal predates `client_goals`. **The deadline does not, and must never regain one:** `mapClientRow` has never mapped `clients.goal_deadline`, so `Client.goalDeadline` was permanently `undefined` and the three `?? client.goalDeadline` fallbacks were unreachable code. Both the field and the fallbacks were **deleted** in Session 0b Task 0b.1 (owner decision 2026-08-12) rather than the column being mapped: mapping would have made a mirror deadline that can silently diverge — `updateGoals`' mirror write is logged-and-swallowed — reachable in three calculator/pace paths for the first time. Pinned by test in `lib/goals/resolve-effective-goal.test.ts` and `services/nutrition-calc-inputs.test.ts`.

### Goal progress and pace

**Position reads the readings in force at the surface's date, never a check-in.** `deriveGoalProgress` (`lib/goals/goal-progress.ts`) is the one composer of the primitives below. It takes a goal and the readings in force at the caller's date — the position and the start, derived from the measurement log (see "client_measurements table") — plus the trend and the deadline arithmetic, and returns the goal rows (`GoalProgressRows`) with a row for **every goal that is set**. The date is the caller's. **The Overview and the Journey read today**: `Client.currentWeight` / `currentBodyFatPercentage`, the newest reading through `client_current_measurements`. **A check-in review reads its own day** (`services/comparison-service.ts`; owner decision 2026-09-03, docs/MEASUREMENT-LOG-PLAN.md commit 8b): the reading then — the check-in's own stamped row, else the newest live reading dated on or before its day (`getReadingsAsOf`, `services/measurements-service.ts`); the goal then — the version in force at the check-in's instant (`getGoalAsOf`, `services/client-goals-service.ts`: `effective_from <= at` and not superseded by then), read from the versions alone with no `clients.*` mirror leg, so a check-in older than every version shows no goal, because the client had none then; the clock then — days remaining counted from the check-in's day; the trend then — the ten check-ins up to and including it (`getClientCheckIns`' `upTo`); and the drift note against the nutrition version covering its day. The baseline is unchanged — the origin does not move — and a client with no baseline is judged from the reading then. `goalProgress.goalIsCurrent` says whether the version judged is still the live one. A check-in is a report of what the client typed that week, every field on it optional; the check-in object is not among the kernel's inputs, and a check-in without a weight is judged from the reading before it. A row's `position` is `null` when no reading exists as of the date, and the strip renders it as `No reading yet` — the goal is real, the verdict is not. `services/comparison-service.ts` is the only caller of the kernel and of the two as-of reads; `lib/goals/goal-progress-ownership.test.ts` fails if anything under `services/` or `lib/goals/` calls `calculateGoalProgress`, `deriveGoalStatus` or `computeGoalPace` directly, hands the kernel a check-in field, feeds the review's kernel call from the client record's reading rather than the as-of read, or calls `getReadingsAsOf` / `getGoalAsOf` from anywhere but the review.

`calculateGoalProgress` (`utils/comparison-utils.ts`) answers where a client stands relative to a goal. It returns two independent facts, and collapsing either into the other is what makes a goal card contradict itself:

- **`status`** — POSITION. `approaching` | `achieved` | `overshot`, from `sign(goal − start)`. With no starting value there is no direction to overshoot in, so the answer is `approaching`.
- **`isOnTrack`** — TREND. Whether the client is moving towards the goal.

`remaining` is **signed**. A renderer showing a magnitude reads `status` first: the magnitude answers "how far to go" only while a goal is being approached, and is the distance *back* to the target once it has been passed. `percentComplete` is clamped to 0-100 for the progress bar and reads 100 once a goal is met.

`computeGoalPace` (`lib/check-in/goal-pace.ts`) compares the rate **required** to hit the deadline against a safe ceiling of 1% of bodyweight per week, and returns `null` for an achieved or overshot goal. It measures the required rate, **not** the client's current pace: that is `isOnTrack`, the average change per week across the last ten check-ins pointed at the goal or away from it, and the two can legitimately disagree — a client losing steadily is on track and still behind pace when the deadline asks for more than the ceiling allows.

**The goal strip's state column reads `status` > `paceStatus` > `isOnTrack`.** A met goal renders no remaining distance and no pace check, and the strip's footer suggests a new target once every goal that could be judged is met and the goal judged is still the client's live one (`goalIsCurrent`) — a `No reading yet` row neither earns the note nor blocks it, and a page about a goal since replaced never invites replacing it again. Weight and body fat resolve through the same column, so the two rows cannot reach different verdicts about one client.

### client_measurements table (migration 158)

**Every body measurement is one row.** Weight, body fat, waist, hips, chest, arms and thighs (`metric_key`, CHECK-constrained; `lib/measurements/keys.ts` mirrors the two CHECKs), the `value` in canonical kg / cm / % (CONVENTIONS §20), `recorded_on` (the day the reading belongs to, on the CLIENT's calendar), `recorded_at` (when the row was written), `measured_at` (when the reading was TAKEN — null means the day is known and the time is not; the check-in writer sets it, a coach entry or an intake reading leaves it null), `source` (`check_in` / `coach_entry` / `client_log` / `intake`), `source_id` (the check-in id for a check-in's reading, which an edit keeps; null otherwise), `note`, `created_by` (`coaches.id` for a coach entry — the audit actor), and the removal mark — `voided_at`, `voided_by` (`coaches.id`, a real foreign key, SET NULL) and `void_reason` (migration 160), null while the reading is live. `updated_at` (migration 161) is when the value was last written or edited — equal to `recorded_at` until a row is edited — and records the edit; it orders nothing (rule 2). Indexed `(client_id, metric_key, recorded_on DESC, recorded_at DESC)` for every per-client read, partially on `source_id` for the check-in fold, and partially on `voided_by`.

`services/measurements-service.ts` holds the table's one INSERT path (`appendMeasurements`) and every read below; `services/measurement-edits-service.ts` drives the three row actions of rule 8 through their functions. The rules, each enforced once:

1. **Never deleted, and rewritten only by its three functions.** `service_role` holds `SELECT` and `INSERT` and nothing else — the migration revokes the default privileges first, then grants. Nothing deletes a row. Every UPDATE the table sees is one of three SECURITY DEFINER functions executable by `service_role` alone: `update_measurement` (migration 161) changes a value and stamps `updated_at`; `void_measurement` / `restore_measurement` (migration 160) set and clear the removal mark of rule 8.
2. **The value for a day is the reading written last** — the latest live row for that client, metric and day by `recorded_at`, a tie broken by id (`lib/measurements/day-values.ts`; owner decision D23). No source ranking: the coach logging after the check-in wins. An edit changes a value and nothing else — `recorded_at` is set once, so no edit can reorder a day or make an older reading the day's value; a coach who wants a different number to stand for a day logs a new reading.
3. **Writers append only on change.** A value equal to the day's standing value for the same source AND stamp is not written again. The stamp is part of the key deliberately: a check-in submitted on a day whose earlier check-in was deleted still gets its own rows, or it would report nothing.
4. **No cache.** "Now" is the newest row per metric, of any source, through the view `client_current_measurements`; the baseline is the reading as of `clients.start_date` through `client_baseline_measurements` (see "The client's origin"). `getClientById` / `mapClientRow` fill `Client.currentWeight`, `currentBodyFatPercentage`, `startingWeight` and `startingBodyFatPercentage` from those two views, embedded in the same read as the row (`CLIENT_MEASUREMENT_EMBEDS`), so every consumer of the object — `/api/client/me` included — reads derived numbers under the same names. The string-built column lists that select a client (`CLIENT_SELF_COLUMNS`, the portal progress read, `ENERGY_COLUMNS`) carry the embeds, and the intake sync reads `getCurrentMeasurements` beside its own select; a stale name in any of them is a PostgREST 400 that `tsc` cannot see, and the portal's `return null` turns it into an empty profile.
5. **A check-in owns no measurement column.** Its readings are rows with `source = 'check_in'` and `source_id = the check-in id`, written by `submitCheckIn` as a second statement after the INSERT (`measured_at` = the submission time, `recorded_on` = the client's day; the same seam as the custom answers — if it throws, the check-in stands without its readings, the POST 500s, and the retry meets migration 156's period-unique constraint). `getMeasurementsForCheckIns` folds the check-in's own live row per metric — the latest by `updated_at` per (stamp, metric), edited in place when a coach changes it — back into the `CheckIn` object (`mapCheckInRow(row, measurements)` keeps the seven fields in their place), so the object and every wire built from it keep their shape.
6. **"Where they stand" is read at a date; "what this check-in reported" reads the stamped rows.** The date is today on the Overview and the Journey, and the check-in's own day on its review (commit 8b): goal position and the drift note there take the reading as of that day — the check-in's stamped row, else the newest live reading dated on or before it (`getReadingsAsOf`, the review's alone) — while the Overview, the Journey and the energy pair take the client record's readings (rule 4). The review band, the AI prompt and the client's check-in detail take the stamped rows (rule 5). The band's "vs last check-in" compares this check-in's stamped rows with the previous check-in's stamped rows and nothing else — a reading logged between two check-ins belongs to the Journey series and to "now", never to that comparison. A check-in submitted without a weight has no weight row: the band's cell shows its empty state while the goal strip judges the reading before it.
7. **Every calculation reads `client_measurements_live`, never the table** — the view filters `voided_at IS NULL`, so a removed reading leaves every figure and every client surface at once and the filter is spelled once; every view carries `security_invoker`. The table has two readers, both in the service: `getMeasurementReadings`, the coach's measurement list, which shows a removed reading muted with who removed it and when; and `getMeasurementReading`, the row an edit acts on. Series reads are paged (`lib/paged-fetch.ts`): they feed aggregates and must be complete past PostgREST's row cap.
8. **A reading is edited in place, removed by a mark or restored — never deleted** (owner decisions D9 and D23). A wrong VALUE is edited: `update_measurement` changes the row's `value` and stamps `updated_at`, keeping its id, day, source, check-in stamp, `measured_at` and place in the day, so the check-in fold reads it as the check-in's reading (rule 5), and rule 2 and every "now" surface read it when it is the reading written last; it refuses a row outside `p_client_id` (the route proves the coach owns the client and cannot prove the row does) and a removed row, and an unchanged value writes nothing and audits nothing. A reading that should never have existed is removed: `void_measurement` sets the mark, and refuses a foreign row, a row already removed, and the client's only live weight (activation refuses without one and the pair cannot compute without one — edit it instead; body fat may go to none, the formula switches); `restore_measurement` clears it and refuses a live row. Each returns whether the row is, was, or becomes the client's newest reading of its metric, and the service recomputes the energy pair on that for weight and body fat — the trigger appending a newest reading fires. Coach only, from the Journey's measurement log: Edit reading and Remove reading (behind the destructive-confirm dialog, which names the reading and says when it is the current reading or the baseline) on any live reading, Restore reading on a removed one; audited as `measurement.update`, `measurement.void` and `measurement.restore` with the metric and date only. The routes are `PATCH /api/clients/[id]/measurements/[measurementId]` (zod `{ value }`, canonical) and `POST …/[measurementId]/{void,restore}` on the full coach chain; a foreign row is 404, a state refusal 409, a value outside the metric's bounds 400. A change reaches the client on their next read; the coach's series, the client record (for a weight or body fat) and the stamped check-in's detail are invalidated together (`use-reading-actions.ts`).

**Energy follows the newest reading.** `appendMeasurements` calls `recalculateClientEnergy` when a row it wrote is the client's newest weight or body fat (`client_current_measurements` after the insert); a backdated row that is not the newest recomputes nothing. Editing, removing or restoring a reading fires the same recompute when that reading is, was, or becomes the newest (rule 8).

**Security.** RLS enabled; one policy, `clients_view_own_measurements` — `SELECT` for `authenticated`, scoped by `clients.user_id = auth.uid()` and never by source, so a client sees every reading about them. It exists because the client app reads its own readings through the session client under RLS (`services/client-portal-progress.ts` → `GET /api/client/progress`; the profile embeds under `GET /api/client/me`); coach reads go through `service_role`. `npm run check:rls`.

**Writers**, all through `appendMeasurements` (an edit is not a writer — it changes a row through `update_measurement`, rule 8): check-in submit (`check_in`, stamped); the Journey's "Log measurement" for a physique key, the metrics PUT and a `currentWeight` / `currentBodyFatPercentage` carried by `PATCH /api/clients/[id]` (`coach_entry`, dated the coach's today); the details sheet's Baseline fields (`coach_entry` dated ON the start date; an `intake` row dated today before activation); `createClient` (`intake`, the weight and body fat it was given, dated the coach's today); the intake sync (`intake`, dated the questionnaire's completion day on the client's calendar, only for a metric the client has no reading of). A coach's write is audited as `measurement.create`, an edit as `measurement.update`, a removal and a restore as `measurement.void` / `measurement.restore` (metric and date only). The seeds write the log; `scripts/seed/teardown.ts` relies on the `ON DELETE CASCADE` from `clients`, because the app role has no `DELETE`.

**Readers:** the check-in object assembly (`services/check-in-service.ts`, every reader that maps a row); `GET /api/clients/[id]/measurement-series` (`services/measurement-series-service.ts` — every metric's day-values, the baseline per metric, the start date and `readings`, every row of the log newest first with its removal; one payload for the Overview chart and status band, the Journey's Physique pane, its measurement log and the blocks); `services/client-portal-progress.ts` (`GET /api/client/progress`, under the client's JWT); `services/comparison-service.ts` (the ten-check-in trend, through the folded objects); `services/client-journey-service.ts`; the activity feed (`coach_entry` rows since the coach's last visit); `services/nutrition-calc-inputs.ts` and `services/client-energy-service.ts` (through the current view).

### client_metric_entries table (migration 132; wellness keys since migration 159)

Coach-logged WELLNESS entries — mood, energy, sleep, stress, soreness — backing the Journey's Wellness pane:
- One row per `(client_id, metric_key, entry_date)` — re-logging the same metric on a date **replaces** the earlier value (upsert), so rows are mutable and carry `updated_at`
- `metric_key` is CHECK-constrained to the five wellness keys. `lib/metrics/metric-entry-definitions.ts` holds the twelve keys the Log-measurement dialog offers: `upsertMetricEntry` (`services/metric-entries-service.ts`) appends the seven physique keys to `client_measurements` and upserts the five wellness keys here, behind one response shape
- Values are unitless scores (mood 1-5, the rest 1-10); `note` is an optional coach note surfaced in the measurement log
- Write path: `GET/POST /api/clients/[id]/metric-entries` (coach-only; future dates rejected against the coach's timezone; audited as `metric_entry.upsert` for a wellness key and `measurement.create` for a physique key, with no value in metadata)
- The Wellness pane merges these with the check-ins' weekly wellness averages client-side (`buildMetricPoints`, `utils/metric-points.ts` — a coach entry wins a same-day tie) over `useAllClientCheckIns`, which pages the client's whole check-in history; recorded in `TECHNICAL-DEBT.md`
- RLS enabled with **no policies**, `GRANT ALL … TO service_role` only

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

### Journey blocks (`client_phases`, migration 145)

A **block** is a named, contiguous stretch of a client's calendar carrying a coach's intent, and the **time bound both tracks are placed to** — the nutrition version's end (see "Nutrition & Training Events" → "The window is the row") and the training placement window (see "Whole-program placement"). Those two are the only things that compute from a block, and both read its DATES alone: no other table carries a block id, and neither read consults `focus` or the block's name. The entire entity: `name`, `[starts_on, ends_on]` (DATE), optional `focus` sentence, and `archived_at` (migration 146). Archiving is a **curation control for both audiences**, not a coach-private view preference: only an ELAPSED block can be archived, an archived block leaves the coach's Journey list (reachable behind "View archive", restorable through `PATCH …/blocks/[blockId]`) and is filtered out of the client's payload server-side. It is a nullable timestamp rather than a status — no date derivation consults it. **The table keeps the `client_phases` name; routes, types and UI say "block"** — deliberate divergence recorded on the table comment; do not consistency-rename either half. Not the migration-133 roadmaps/phases feature returning: no `phase_id`/`block_id` on any other table (ever), no status column, no rate, no daily-targets grid, no target.

- **Everything date-derived at read time, in the CLIENT's timezone.** current/past/future and "week X of Y" are pure derivations (`lib/blocks/block-derivations.ts`) from today vs the range — crossing a boundary is a no-op (no scheduler exists). `weeks` on the wire = `weeksSpanned` (ceil), the same single derivation as `weekOfTotal.total`.
- **A block owns its own window** (migration 164 — an owner reversal of the derived-start chain, 2026-09-04). The PUT sends `{ blocks: [{ id?, name, startsOn?, endsOn?, focus? }] }` — every block carries BOTH dates, nothing is derived from its neighbour, **a stored block's start is fixed** — the PUT refuses a different one (`BLOCK_START_FIXED`, 422) and the block form shows it greyed, so a new start is a delete and a new block — and an end is never later than the one stored (below). **Gaps are allowed and mean nothing is planned** (the client is between programs; both placements read that as "no bound" and fall back). **Overlaps are refused** — in the service, with a sentence naming both blocks, and by the `client_phases_window_overlap` gist exclusion constraint, because "the block covering this date" decides the training placement window and the nutrition version's end and cannot have two answers. The service also rejects an end before its start, caps a block at 52 weeks of days, and refuses a NEW block opening in the past (a past-dated block prescribes nothing — placement and the nutrition save both refuse a past date). The payload carries every stored row, so checking it against itself IS checking it against the client's whole calendar. **Elapsed blocks (`ends_on <` client-today) keep their DATES pinned from storage** (they omit `endsOn` — elapsed history is not an input; a differing one 422s) **while their name and focus stay editable** (Session 3.6-C — the pin protects lived-day attribution, not typos in a finished label), and the **window floor** keeps an edit from re-labelling lived days: a stored current block must still contain today. Removal is not expressible through the PUT.
- **A block contains its plans.** Placement and the nutrition save are bounded by the block covering the start ("Whole-program placement", "The window is the row"), and a save whose blocks read FAILS is refused with a sentence rather than stored without that bound (`BlocksUnreadableError`, `BLOCKS_UNREADABLE`; 503) — the plan editor too, which asks the same read for its limit, on open and on save; drawing a block, or shortening one, over days that already hold a plan trims the plans to fit (`lib/blocks/block-plan-trims.ts`): a plan that started before a block that has not begun ends the day before it — a plan is one row, so its days after the block go too — one that starts inside and runs past the end ends on the block's last day, and a queued plan starting in the days a shortened block gave up is removed. A block already under way keeps its lived start edge, so a plan crossing it is judged at the end alone. The chain PUT finds the trims once the payload validates (`findBlockPlanTrims`, `services/block-plan-trim-service.ts` — both tracks' live plans with a day still ahead that reach the blocks the save draws or shortens; a rename trims nothing, an elapsed block is never a target) and refuses the save with them — 409, `data.trims` — until the payload carries `confirmTrims`; the blocks screen shows them as the one question over the open form (`block-trim-dialog.tsx`), and yes re-sends the same save. A trim ends a plan through its own delete's statements, on the day its block allows (`endNutritionVersionsAt`, `endTrainingPlansAt`): nutrition first — the hand edits on the days a version gives up, then its window — then training — the program's sessions after its new last day, never before the deletion floor (a removed program's from the floor, as Delete plan removes one), the session rows behind them unless another day still points at the row, then its window. **Not one transaction:** the trims land before the block rows and each step re-reads the calendar, where a trimmed plan already fits, so a failure leaves the plans trimmed and the block unsaved; the question stays open, and the same save re-sent finishes it. **A block's end never moves later.** The PUT refuses it with a sentence, for current and future blocks alike, and the form caps the end date at the stored end; more time is a new block after it, with its own program and targets.
- **Delete takes the block's plans** (`DELETE /api/clients/[id]/blocks/[blockId]`): the nutrition versions and the programs that start inside its window end — a running one at yesterday, a queued one removed — through the calendars' own deletes given the block window (`clearNutritionPlansForClient`, `clearTrainingPlansForClient`), then the row goes. With windows chosen rather than chained there is nothing to re-anchor: every other block stays where the coach put it, leaving a gap — a legitimate state. Elapsed blocks 422 before any plan is touched (archiving is how a finished block leaves the list). Nutrition, then training, then the row: the two clears are independent — each ends its own plans and writes nothing the other reads — and any failure stops before the row is deleted, because losing the label while the prescription survives is the one outcome the UI cannot undo. A block holding no plans is not an error.
- **Nothing computes from `focus`, and a block carries no target and no goal.** The client's goal lives in `client_goals` (see "Effective goal resolution") and is never read by a block; `focus` never reaches the nutrition calculator, and the blocks routes never call `updateGoals` (pinned by test).
- **Both setup surfaces carry a Block field above their start date** — the apply-to-client dialog and the nutrition drawer's settings form, one shared picker (`components/clients/metrics/blocks/block-start-picker.tsx`) over the pure option builder (`lib/blocks/block-start-options.ts`), fed by the chain payload and `planStartFloor` below. It lists a bare dash — the field's empty state, no block — then the client's blocks whose last day is on or after the surface's floor — the deletion floor on the apply dialog (see "The deletion floor" under Nutrition & Training Events), the client's today on the nutrition drawer — each with its range (`Cut · 6 Oct – 2 Nov`). Choosing a block FIXES the start: the plan begins on the later of that floor and the block's start — a block already under way starts a program today, or tomorrow once the client has logged a workout today, and starts targets today whatever they have logged (owner, 2026-09-11); never on the day it began — and the date input is disabled while a block is chosen, so a plan placed in a block always begins where the block does (owner, 2026-09-10). With the dash the date is the coach's own, floored at the same floor (`min`, natively; the server keeps its own check). Changing the block discards a typed date. A coach arriving from a block card's "place one" / "set targets" — or, on a block already set up, from an ended program's "update plan" or the targets' "update targets" beside the value on its own line — the value, a dash, the teal word, exactly where "place one" sits after "No program placed" — finds THAT block preselected: the surface captures the trip's block id on arrival, in the same effect that strips the return params (`useJourneyRoundTrip` on the drawer, `useJourneyReturnBlock` on the apply tray), and the host hands it down (`roundTripBlockId` into the nutrition builder; `preselectedBlockId` through the draft provider to the dialog) — a preselection, never a binding, and a block no longer listed falls through to the dash. Purely UX and the same on both tracks: each placement resolves its own window from the block covering its start, so the field only starts the plan where the block the coach means begins. **Route surface:** `GET`+`PUT /api/clients/[id]/blocks`, `DELETE …/blocks/[blockId]` — full coach chain (`coachApiRateLimit` → CSRF → `requireCoachOwnsClient`, foreign client 404), canonical kg on the wire, audit events `block.chain_update` / `block.delete`; the card's per-plan delete goes to `DELETE /api/clients/[id]/nutrition/[planId]` (the same chain; the version is proved the client's inside the service's select — a foreign, archived or finished id is 404; audit `nutrition_plan.version_delete`) or the training twin `DELETE …/training/[planId]`. The chain payload carries `clientToday` and `planStartFloor` — the training deletion floor, resolved server-side because it depends on the client's training log — on every handler that echoes it (GET, PUT, PATCH, DELETE), because `useSeedClientBlocks` writes a mutation's response straight into the chain cache; the apply dialog floors its date picker on it, the nutrition drawer floors on the client's today and reads the payload for its blocks alone, and a block itself is not constrained by it. RLS deny-all + `GRANT … TO service_role` only (CONVENTIONS §8). Plus the read-only **`GET …/blocks/facts`** (Session 3.2, `services/client-blocks-facts-service.ts`): per block, **the plans whose dates fall inside it** — the live training programs and the active nutrition versions whose windows meet the block's, found from those windows alone. One read per track for the whole journey span, partitioned per block in memory, and nothing per day on either track, so round trips are constant in the number of blocks. A plain intersection is the whole rule: live windows cannot overlap each other on either track (the `training_plans_live_window_overlap` and `nutrition_plans_active_window_overlap` exclusions), so no date has two plans to resolve between, and a block contains its plans. Both lists are in start order, which is what the headline below reads. Every entry carries the row's OWN window (`startsOn` / `endsOn`, which begins before the block for a plan that was already running when it was drawn) and its **state** — `active`, `upcoming` or `ended` against the CLIENT's today, stamped server-side (`derivePlanState`, `lib/blocks/block-derivations.ts`; the facts route resolves the day exactly as the chain route does, so the browser never derives a plan's standing from a day it obtained elsewhere). A version's entry also carries its own row's numbers (daily calories with the custom-macros override honoured, deficit = `tdee − calories`) and its save note. Hand edits and training surpluses are excluded by construction — the plan row holds neither; a re-save with the same numbers is its own entry, as a program placed twice is; a closed window is immutable, so an entry dated in the past never rewrites itself on a later save. **The card shows ONE entry per track — the headline** (`selectHeadlineFact`, `lib/blocks/block-headline.ts`, a precedence over the wire's states and never a date): the plan in force today, else the first one queued in the block, else the last one that ran — so a running block whose only plan starts tomorrow reads set, a future block shows the plan that will govern its first day, a finished block shows the plan that governed its last day, and a program that ended early with nothing queued after it still headlines its block, as ended, with "update plan" beside it (owner, 2026-09-11), where a running or planned headline carries "edit plan", which opens the plan editor on that plan (see "Edit plan"); anything queued later in the block is left to the timeline, and the day it takes over it becomes the headline because its state does. A state chip (Planned / Ended) follows the value when the headline is not in force, and the headline's own range — its `startsOn` – `endsOn`, in the grammar the card's header spells the block's ("24 Aug – 4 Oct"; one date for a plan that ran a single day, `formatBlockRange`) — sits under the value on both columns. **The "what happened" timeline lists the same plans**, each with its range in the date column and its state chip (Active / Planned / Ended), a version with its numbers, whether the block has begun or not; the block's own "started" / "ended" rows keep their single date, and a plan that was already running when the block was drawn sorts above the "started" row, on its own start. **A row whose plan is active or upcoming carries a hover-revealed delete** (owner, 2026-09-11) — on current and future blocks only (`blockAcceptsSetup`, the same gate as the way in), behind the destructive confirm (`delete-plan-dialog.tsx`: End plan / Remove plan / End targets / Remove targets, one sentence scoping the verb and nothing about what survives). It ends ONE plan: the training per-plan `DELETE …/training/[planId]`, or `DELETE …/nutrition/[planId]` (`clearNutritionPlanById`, the calendar delete's own retire path) — a running plan at yesterday, a queued one removed, the hand edits on the days it uncovers with it. Deleting a plan never touches another and nothing regrows: a queued plan's dates go empty and the coach fills them from the card or the calendar. Ended rows and block rows carry no icon; the subtab clears the training and nutrition areas, the facts, the Overview and the feed on success. **Until the facts land, both columns and the timeline read "Loading…", and a failed read "Couldn't load the plans"** — never an empty state, which is a statement only a settled read may make (`docs/newdesignsystem.md` → "Loading & async states"). The read answers for every block, so a block with no entry in the list is one the card has no answer for yet, and that absence IS the pending state — there is no second loading flag to drift from it. Kept off the chain GET so PUT/DELETE keep echoing that GET's exact payload.

### Client energy: the profile OWNS bmr/tdee (Session 4B)

The client's weight and body fat are their newest readings in the measurement log: `recalculateClientEnergy` reads them from `client_current_measurements`, embedded in the same select as the profile facts (`ENERGY_COLUMNS`). Nothing is copied onto `clients`.

**`clients.bmr` and `clients.tdee` are NOT a cache. They are the source of truth for the client's metabolism**, and they have exactly one UPDATE writer: `recalculateClientEnergy()` (`services/client-energy-service.ts`). The rules are load-bearing, not stylistic — each one is a bug that actually shipped:

- **The pair is written atomically.** Every UPDATE carries both keys. Six uncoordinated writers used to exist, three writing only half, which is how a profile came to read BMR 3712 beside TDEE 3515 — a TDEE derived from a BMR that no longer existed.
- **BMR = Katch-McArdle when body fat is known, else Mifflin-St Jeor. TDEE = BMR × multiplier(`clients.work_activity_level`).** Both formulas live once, in the pure `services/client-energy-calc.ts` (importable from the browser and the seed scripts; kept out of the `supabaseAdmin`-importing module so `check:service-key` stays green). TDEE derives from the **rounded** BMR so the stored pair is reproducible and agrees with `calculateTDEE`. `getActivityMultiplier` is imported from `utils/nutrition-helpers.ts`, never reimplemented, and a junk activity value is normalized rather than allowed to yield NaN into a `NUMERIC(6,1)` column.
- **An override flag freezes exactly its own half.** `bmr_manual_override` / `tdee_manual_override`: a custom TDEE plus a moving weight moves BMR and leaves TDEE pinned. A flag set over a NULL value is not a freeze and is recomputed.
- **Activity level is a CLIENT fact.** Nothing under `components/clients/nutrition/**` writes it.
- **A weight change never touches a plan row.** Plans snapshot bmr/tdee at generation; only a regeneration inherits the then-current profile numbers. `createNutritionPlan` touches the `clients` table zero times — it used to write `clients.tdee` from the *plan's* activity level, so the plan and the profile disagreed and the plan won.
- **`createClient`'s INSERT is the one sanctioned exception**, setting the pair once at row birth through the same pure calculator. The invariant is one writer for *updates*; `services/client-energy-ownership.test.ts` scans for violations and documents that carve-out beside the scan.

Who triggers a recompute: `appendMeasurements`, when a row it wrote is the client's newest weight or body fat — the one path every reading writer takes (check-in submit, the Journey's Log measurement, the metrics PUT, the details sheet, `createClient`, the intake sync); the three measurement functions — `update_measurement`, `void_measurement`, `restore_measurement` — when the edited, removed or restored reading is, was, or becomes the newest ("client_measurements table", rule 8); `updateClient`, when a profile input changes (height, gender, birth date, activity level); the metrics PUT, for an override instruction; the intake sync, after its profile fields land.

### The client's origin: the start date, and the baseline derived from it

**A client has exactly ONE origin — the day coaching began — and it is `clients.start_date`.** `services/client-start-service.ts` (`recordClientStart`) is its single writer, and it writes the date and nothing else: what the client measured when they began is not stored beside it but derived from the measurement log (below).

- **The date is set at activation, and only then becomes editable.** The activation dialog prefills the coach's today and they may backdate it; an existing stored date is kept rather than overwritten; the client's timezone today is the last resort. **One setter, then one editor:** the details sheet's "Started" field is read-only until the client is activated (it reads *"Set on activation"*) and editable after, routing through `updateClient` → `recordClientStart`. Editable *before* activation was worse than useless — the dialog always sends its own prefilled date, so a start date a coach set in advance was silently replaced the moment they activated. `paused` counts as started: they were activated once, and their origin does not stop being real because they are on hold.
- **The baseline is derived, never stored.** Per metric, the reading as of the start date: the latest live row on or before it, else the earliest after it — `client_baseline_measurements` (migration 158), read only through `getBaseline` (`services/measurements-service.ts`; `lib/measurements/baseline-ownership.test.ts` fails if anything else derives it). It cannot disagree with the series, because it IS a point of the series, and it cannot be edited into a number no reading carried. Every surface that shows it — the Overview band's "Since start", the Journey hero's "since start" figures, the check-in comparison's start leg, `startingWeight` / `startingBodyFatPercentage` on `/api/client/me` and `/api/client/progress` — shows the reading's own date and source. A client with no start date has no baseline.
- **Moving the start date re-derives the baseline and re-dates nothing.** A reading dated before the start date stays in the log, is listed on the Journey's measurement log under "Before start", and is excluded from the journey's chart and from every "since start" figure. A future start date is allowed: the Overview card's number and the Journey hero's Current are "now" — the newest reading, any date — and never wait for it; the chart line and every "since start" figure read `Starts d MMM` until it arrives. The Overview chart draws the baseline at the start date, as the value in force that day, with the reading's own date in its label.
- **The details sheet's Baseline fields append a reading**: a `coach_entry` row dated ON the start date, which the as-of rule then reads; before activation there is no start date, so it is an `intake` row dated today, picked up the moment the date is set. The sheet does not write a current reading — the current weight and body fat are read-only there, and the Journey's "Log measurement" is their writer.
- **A reading is not withdrawn through the profile.** `updateClientSchema` accepts `currentBodyFatPercentage: null` and `startingBodyFatPercentage: null` on the wire, and `updateClient` refuses both with a readable 400 (`ReadingRemovalUnavailableError`) naming the Journey's measurement log, where a reading is removed row by row ("client_measurements table", rule 8), before any write lands. A weight stays non-nullable: the pair cannot compute without one, and both add-client paths require it.
- **Nothing captures girths at intake or manual add**, so only weight and body fat have a reading before the first check-in or coach entry (`TECHNICAL-DEBT.md` → "Measurement log — follow-ups").

**Two things were considered as the origin and rejected**, each recorded on the service so it is not re-litigated: a plan's `effective_from` (there are many per client, one can be queued in the future, and a queued nutrition version can be archived by a delete — an origin that can vanish is not an origin); and the earliest measurement (that is where the DATA starts, not where the coaching did — the gap between the two is exactly what `start_date` records).

**Who already measures from it:** `resolveCheckInWindow` (`lib/date-helpers.ts`, called by `submitCheckIn` for every check-in) clamps `period_start` forward to it — which bites only on a partial first week — so the stored period, and the nutrition summary and AI prompt that are handed it, never count pre-start days; `weekly-nutrition-service.ts` itself reads nothing from `start_date` — it derives its day denominator from whatever period it is given, which is how a clamped first week reads 3/3 rather than 3/7; `engagement-triggers.ts` holds the no-engagement alert until `start_date + NO_ENGAGEMENT_ACTIVATION_GRACE_DAYS` — and **returns null without one**, so a client with no start date has that alert silently disabled.

**Both add-client paths require a weight**, so a client cannot be set up with no baseline: the intake questionnaire enforces it in `intakeStep1Schema`, and `createClientSchema` refuses a manual add without one (`setupMode !== "intake"` — the same predicate `createClient`'s `isIntakeMode` uses, since the field is optional on the wire and anything but `"intake"` is manual). Body fat stays optional on both; the details sheet's Baseline group is how it gets filled in later. `createClient` appends the weight (and body fat) it was given as an `intake` reading dated the coach's today and computes the energy pair from the same number in its INSERT; it stores `date_of_birth` alongside (the add-client form collects it and the energy calculator consumes it; a client whose birth date is dropped at creation carries an age-correct BMR that the next recalculation silently changes).

**The intake path is the gap those two schemas cannot close**, because the client row exists as `pending_intake` before the questionnaire is answered: the weight sits on `client_intake` until "Sync metrics" appends it to the measurement log as an `intake` reading. So the order is enforced rather than trusted — "Mark as reviewed" is disabled until the client has a weight reading, and `POST …/activate` returns **409** without one. `hasStartWeight` (`lib/client-profile-completeness.ts`) — the client record's current reading, the log's newest weight — is the single definition all three read, so a greyed button and the rule behind it cannot disagree.

### Read switch fallback

Services that read goals prefer `client_goals` but fall back to the legacy `client.*` goal mirror for pre-migration clients:
```
goalWeight = currentGoals?.goalWeight ?? client.goalWeight
```
The switch is written once, in `toClientGoalInput()` (see "Effective goal resolution"), because four callers held byte-identical copies and one of them only had to be edited alone for them to diverge. It covers goal weight and goal body fat **only**; the deadline has no mirror leg by decision.

Measurements have no switch. The client record's readings are derived from the measurement log (see "client_measurements table"), and the check-in comparison's start value is the baseline, else the reading as of the check-in's day — so a client with no start date still has a direction to be judged in, from then — and never the check-in object under review, which may carry no reading at all.

---

## Daily Logs (spine + child tables)

Daily tracking data is split into a spine table and domain-specific child tables:
```
daily_logs (spine)         -- id, client_id, date, notes
  ├── wellness_logs        -- mood, energy, sleep, stress, soreness (1:1 via daily_log_id FK)
  ├── nutrition_logs       -- what the client ate (1:1 via daily_log_id FK); the day's target and verdict are computed at read time (migration 173)
  ├── training_logs        -- trained, training_session_id, training_data JSONB (legacy/orphaned) (1:1 via daily_log_id FK)
  └── daily_habit_logs     -- per-habit completion (1:many, FK to daily_habits)
```
- **Writes**: per-card independent writes. Each per-card endpoint (`PATCH /api/client/daily-logs/[date]/nutrition`, `/wellness`, and similar) ensures the day's `daily_logs` spine row exists and upserts only its own child table. (The `upsert_daily_log_atomic()` RPC remains in the DB as an unused function — its removal is separate schema work — and must not be used for new writes; since migration 173 its body names food-log columns that no longer exist, so it cannot run at all.)
- **Domain-specific reads** query child tables directly (e.g. wellness history queries `wellness_logs`, not the view)
- **Cross-domain reads** use the `daily_logs_full` view (e.g. attention feed, AI summary generation)
- Each child table has `client_id` and `date` columns for direct querying without joining the spine
- The `DailyLog` TypeScript type remains flat. The split is DB + service layer only. Hooks, components, and utils are unaffected

**A logged day is derived, never stored, and never read off the spine.** "Did the client log today?" has one answer, `loggedDays` in `lib/logged-days.ts`: a day with any log the client made themselves, on their own calendar — a nutrition entry (any consumed value), a wellness reading (any of the five), a habit log (ticked or unticked, since either is the client acting), a workout log (a `training_event` whose status is `completed` — logged, at any quality) or a measurement they logged in the app (a `client_measurements_live` row with `source = 'client_log'`, empty until the client app can write one and read from the start so the definition cannot lose a source). One is enough. **Coach entries, intake readings and the check-in submission do not count** (owner decision D11, 2026-09-02): the question is daily engagement, not the coach's work or the weekly report. The spine row is the parent of the client's day-form (wellness, nutrition, the day note) and not an activity flag — workouts and habits never create one, so counting spine rows read a client who only trained as silent, and `lib/logged-days-ownership.test.ts` forbids it. The source predicates live beside the kernel, spelled once; the two readers that hold the rows assemble the five sources from them and ask the kernel: the Overview adherence kernel (`services/client-adherence-service.ts` — `AdherenceSummary.loggedDates`, which the habits rail reads for Missed versus No log and the check-in review's header prints over `dates`) and the attention feed (`loggedDaysFor` in `lib/attention-feed-helpers.ts`, for the logging-gap and no-engagement alerts).

---

## Nutrition & Training Events

The two tracks keep their date-specific truth differently:

```
training_events    -- one row per training session per date: a placed thing with identity (logged, moved, pointed at)
nutrition          -- NO day table: a day's target is computed when asked, from the version covering the date
```

Training events are the **source of truth for a date's session**; the placed program's slot rows (`training_sessions`, cloned per placement) are what the date-walk emits them from, never a display path. A nutrition day is a derived value nothing points at. The stored nutrition facts are the version rows (`nutrition_plans` — a window plus its per-weekday grid, `nutrition_plan_daily_targets`), the coach's per-day edits (`nutrition_day_edits`), each version's save note (`nutrition_plans.coach_note`); "what is the target on this date" is resolved from them at read time (see "The window is the row"). The food log (`nutrition_logs`) holds what the client ate and nothing else: a logged day's target is the computed day too, and the verdict is derived from the pair when read. No writer keeps days in sync — there is no cascade, no sweep and no regenerate — and a day table, a day-sync writer or a nutrition-day deletion floor must not be reintroduced.

### Plans as templates/provenance (events-as-SOT)

On the training track, plans are **templates/provenance** — the events carry the date-specific truth, and a plan's deletion never destroys history:

- **`training_events.training_plan_id` is `ON DELETE SET NULL` + nullable** (migration 113), so a past or logged event survives its plan's hard-delete and is never orphaned by it.
- **Both tracks are date-ranged placements with the END on the row:**
  - **Training = many coexisting programs, each a placement with a stored end (migration 167).** A distinct `training_plans` row per placement; its window is decided at placement (`resolvePlacementWindowEnd`: the block covering the start, else the program's own length capped at the day before the next block, either capped at the next plan) and moved only by the plan editor's save, a block trim, a start-date move — which shifts the whole window of a program that hasn't started (see "Moving a program's start") — and a later placement, which caps every earlier live program at the day before its own start and archives a same-day one. Live windows never overlap (`training_plans_live_window_overlap`, a gist exclusion scoped to live rows) and gaps between programs are normal. "The active plan" resolves **by date** via `coversDate`, so the day after a program's end the hero, the Overview, the client and the feed all read no program.
  - **Nutrition = coexisting date-ranged versions, each placed with an END on the row.** N `nutrition_plans` rows per client whose `[effective_from, effective_until]` windows never overlap (`nutrition_plans_active_window_overlap`, a gist exclusion scoped to active rows) and may leave gaps; `effective_until` is always written (migration 166). The coach never supplies the end — `resolveNutritionPlacementEnd` resolves it at save exactly as a training placement window is resolved: the block covering the start, else the furthest live program's end, else eight weeks, capped at the next queued version's start. A save caps its predecessor at `new_start − 1` and replaces in place a version starting on the same day (`create_nutrition_plan_atomic`); a delete ends the running version at yesterday and archives queued ones (see "Nutrition plan versions"). "The active version" resolves **by date** via the same `coversDate`; a day no version covers has no target, and the meals still save there — logged with no target, they carry no verdict (owner, 2026-09-11). **A day's target is computed from the covering version** — its grid row for the weekday, the session on the date and the coach's edit (see "The window is the row") — so one target per day is correct by construction, and per-day coach edits are rows in `nutrition_day_edits`, never minted as versions. Inside a block the two tracks end on the same day by construction, because both resolve the same bound; a version saved in a gap between blocks falls through to the program, then to the fixed window.

### Training event fields
- `training_session_id` FK (SET NULL on delete, preserves events when sessions removed)
- `session_name`, `session_focus` - snapshotted at creation, survive template renames
- `estimated_calories` - from the session template
- `calorie_surplus_percentage` (NUMERIC, nullable, migration 085) - the per-date training surplus, denormalized onto the event at generation from `training_sessions.calorie_surplus_percentage`. A nutrition day reads it directly off the events — every session's surplus on the date added, as a share of the covering version's baseline (see "The window is the row"). NULL on rest days
- `day_order` (INTEGER NOT NULL DEFAULT 0, migration 179) - the session's place among the client's sessions on its date, 0 first; every reader orders a day by `(day_order, id)`. See "Several sessions a day"
- `is_modified` - true when a coach moved the event on the calendar, or edited its surplus — or when the **client** moved it (the same badge, deliberately: no who-moved-it provenance is stored, owner decision 2026-08-26). Both moves go through `move_training_events_atomic` (migration 150), each side keeping its own rules in its own service (the coach's drag in `services/training-event-calendar-service.ts`, the client's week in `services/training-event-layout-service.ts`); the function refuses a move whose event is no longer on the date the caller saw, so a coach's drag on a calendar loaded before the session moved is refused (409), and the coach's calendar refetches when the coach comes back to the page. It drives the calendar card's edited badge; the plan editor's save keeps it on a session saved as it was laid and clears it on every session the coach changed (see "Edit plan"), and a program's start-date move carries every session to its new day with its mark as it was (see "Moving a program's start"). It is **not a write predicate**. (An earlier `force = false` / override-after-warning regeneration flow is described in older revisions of this file; no such parameter exists in the code.)
- `status` — whether the client has **logged** the workout, and nothing else. Two values, and the CHECK allows no others (migration 182): `scheduled` is not logged and is the word every write guard keys on (`assertSessionUnlogged`, the plan editor's save, the move function, placement's window-delete); `completed` is logged, **at any quality**, written with the link in one statement and cleared back by `clear_training_event_log`. `partial`, `skipped` and `missed` are gone — a partial workout was still done, a skip is not an outcome any more (see "Logging a workout"), and `missed` is derived by every screen from the day. **How a workout went is never read off this column**: see "How a workout reads" below
- Unique constraint: `(client_id, training_session_id, date)` partial index where `training_session_id IS NOT NULL`

`training_sessions.calorie_surplus_percentage` (NUMERIC, nullable) is the **origin** of the surplus: it is copied onto each `training_events.calorie_surplus_percentage` at event generation, and a nutrition day then reads it from the event (not from the session). Rest-day sessions have NULL.

### Several sessions a day (migrations 179, 180)

**Any day on a client's calendar can hold several sessions, in order, each its own workout** — a morning run and an evening lift. Each is opened, logged and counted on its own, and nothing refuses a day for holding one. Coaches write programs this way too: a program's day holds its sessions in order, and placing it lays them on the date in that order.

- **The order is `training_events.day_order`**, 0 first, read as `(day_order, id)` wherever a day is listed: the event range read (`getEventsForDateRange` — the coach calendar, the client's day, the check-in lists, the Data table), the client's week (`client-training-week-service.ts`), the Overview's next session, and the plan editor and the client's Program tab (`sessionsByDay`, `services/calendar-day-events.ts`). Nothing makes the order unique: two writes landing on one day at the same moment can share a place, and the id then decides.
- **A session moved onto a day joins it, last.** The client's week and the coach's drag (`move_training_events_atomic`), a library session dropped on the calendar (`placeSessionOnCalendar`, which reads the day's last place before it clones anything) and a program's start-date move (`move_training_plan_atomic`) put a session after the sessions already on its day; several arriving on one day in one write land in the order the write gives them — the client's week lists them in the order the client moved them, and a start-date move keeps the order they held on their own day. A swap is two moves. Both move functions park the moving rows far outside any real calendar before placing them, because `(client_id, training_session_id, date)` is unique and a single shifting update could trip it half way through.
- **A program's day holds its sessions in order** (migration 180). A day of a program is its `(week_index, order_index)`: the session rows sharing one are that day's sessions, each at its place in the day, `coach_saved_sessions.day_order` / `training_sessions.day_order` (0 first; a rest day is one rest row, alone on its day). `programDays` (`utils/program-days.ts`) is the one read of a program's rows as days — placement, the builder's read of a saved program and the save schemas all go through it, ordering a day's rows by `day_order` and then by the order they were read in, so rows that share a place (from before the column) still read in a fixed order. Every writer of a program's rows writes each row's place: the library save and the inline placement from the builder's `dayOrder` (the write schemas refuse two sessions at one place and a rest row sharing a day), the program duplicate verbatim, placement from the program, and Edit plan's function from each day's list. A standalone session and a session dropped on the calendar sit alone at 0.
- **Placement lays each day's sessions on its date, in order** — the date-walk writes every session of a day into the window it has cleared, each event at its session's place as its `day_order` — and **Edit plan saves every session of a day** (see "Edit plan").
- **Sessions per week count sessions.** `frequency_per_week` (on the library program and the placed plan) is the program's sessions per week, averaged over its weeks, with no ceiling: `training_plans.frequency_per_week` is checked `>= 1` alone (migration 180), and `deriveFrequencyPerWeek` is the one derivation (the library save, placement — from the program's own rows, both branches — and the plan editor's save).
- **Per-day views show one row per workout.** The coach's Data table and the check-in's frozen `period_snapshot.training` come from `mapEventsToScheduleDays` (`utils/training-event-helpers.ts`): a row per session, a rest day one row; the table pages over those rows, newest day first with a day's workouts in their order. Each row splits the two facts — `status` is attendance (`scheduled`, `completed`, `missed`, or `rest` for a day holding none), `completionQuality` is how it went, off the workout's log, and `isAlternative`, `loggedSessionName` and `notes` come from that log too. It is pure and takes the caller's own `today` (the coach's for the history table, the client's for the week a check-in freezes), which is what makes a still-scheduled workout on a day that has passed read as missed. The Overview's training rail stays one dot per day (its counts count every session), and a nutrition day adds every session's surplus (see "The window is the row").

### Client-side plan tier (`training_sessions` / `training_exercises`)

The placed mirror of the library tier — same shape, one row per authored slot:

- `week_index` (INTEGER NOT NULL DEFAULT 0, migration 121), `order_index` and `day_order` (INTEGER NOT NULL DEFAULT 0, migration 180) — ordering is always `(week_index, order_index, day_order)`: a day's sessions share its `(week_index, order_index)`, each at its place in the day (see "Several sessions a day"). **`day_of_week` is always NULL** for anything placed post-121; placement is a sequential date-walk, not a weekday map. (The seed script `scripts/seed-scale-client.ts` still authors the pre-121 weekday shape, so fixture data is the one place you may see it set.)
- `is_rest` (BOOLEAN NOT NULL DEFAULT false, migration 121) — rest slots are **real rows**, so the client read is self-describing. They carry no exercises and spawn no `training_event`. Applied-side readers that count workouts filter `is_rest = false`.
- `set_specs` (JSONB) + `video_url` (TEXT), migration 119 — identical shape to `coach_saved_exercises`; see "Coach Library".
- Every exercise sits in a group (`training_exercise_groups`, migration 178) — the same shape as the library tier; see "Groups".

**Client read — `getClientTrainingPlan` (`services/client-training-plan-service.ts`) is self-describing.** It returns `{ planId, planName, sessions[], state, startsOn, endsOn }` — one entry per session on each day of the program's window as it is on the client's calendar, in the day's order (a day holding several gives each its own entry at the day's `orderIndex`): each session read through the row its event points at (`sessionsByDay`, `services/calendar-day-events.ts`, shared with the plan editor), with its `groups` in order, each carrying its settings and its exercises in order; a day holding none is a rest day carried as a real `isRest` entry with no groups. No library-template join, no `saved_plan_id` read.

**Both audiences resolve by DATE, through one shared window predicate.** `coversDate()` (`services/training-plan-window.ts`) owns the `effective_from <= date AND effective_until >= date` half for `getTrainingPlanForDate`, `getTrainingPlanIdForDate` and the client reader alike. The **status** half deliberately stays at each call site: coach reads exclude only `archived`, the client read requires `active`, because `PATCH /api/clients/[id]/training/[planId]` can write any of the four CHECK values and a `draft`/`planned` plan must never reach a client. Ordering is identical on both sides (`effective_from DESC, created_at DESC`), so the two audiences pick the same row.

The client reader previously took the newest-**created** active row with `effective_until IS NULL` — a different question, wrong at both ends: a program placed to start next month became the client's current one immediately, and a finished one stayed current forever. That divergence was reachable, not theoretical: `SessionPicker` lists from `GET /api/client/training-plan` while `GET /api/client/training/sessions/[sessionId]` validates the pick against `getActiveTrainingPlanId` (date-driven), so whenever the two resolvers disagreed **every session the client picked 404'd**. The picker now gates its list on `state === "active"`, which makes that mismatch unreachable rather than merely unlikely.

`state` is `active` | `upcoming` | `ended`, resolved in that priority order (a queued program is live information; a finished one is history). `null` still means the client has no active, non-deleted plan at all.

> **One "Ended" definition (migration 167).** Every reader takes a program's end from the row: the client reader's `endsOn` and state, the plan editor's refusal to open an ended plan, the attention feed's windows, the block facts and the nutrition placement's program fallback. The Overview's week counter counts from `program_duration_weeks`, the placed length, which placement records from the same window.

### Nutrition plan versions + per-version daily-targets template

`nutrition_plans` holds **date-ranged versions, each a placement** (migration 166): N rows per client whose `[effective_from, effective_until]` windows never overlap and may leave gaps, every one carrying an end. Each version is the **template for its own era** — it holds the plan-level prescription — `baseline_calories`, `protein_target_g` / `carb_target_g` / `fat_target_g`, `diet_type`, `protein_target_g_per_kg`, the custom-macros override (`custom_macros_enabled` + `custom_calories`/`custom_protein_g`/`custom_carb_g`/`custom_fat_g`), the calculator inputs (`base_weight_kg`, `bmr`, `tdee`, `work_activity_level`; `training_volume_hours` is also stored but deprecated — accepted for backward compat and read by nothing), and the goal snapshot (`goal_weight_kg`, `goal_deadline`) that drives the weight-drift / goal-drift banners — plus its own `nutrition_plan_daily_targets` **per-weekday grid** (`(nutrition_plan_id, day_of_week)` → `calories`, `protein_g`, `carb_g`, `fat_g`), replaced with the version on every save of it, and the row a computed day takes its calories and macros from verbatim (see "The window is the row").

**The window is resolved at save and stored on the row, and it decides which days the version answers for.** `resolveNutritionPlacementEnd` (`services/nutrition-plan-service.ts`) answers the question `resolvePlacementWindowEnd` answers for a training program: the last day of the block covering the start (`getBlockBoundForDate` answering `covering` — the block COVERING the start, never the furthest the client has, so a later block the coach has not priced is not pulled into this version), else the furthest live training program's last day on or after the start (`getFurthestLiveProgramEnd`), else `NUTRITION_PLACEMENT_FALLBACK_DAYS` (eight weeks) from the start — those two fallbacks capped at the day before the NEXT block when the start is in a gap (`getBlockBoundForDate` answering `next`: a cap, never a length, so targets saved in a gap stop at a block the coach has not set up rather than running into it) — and capped, whichever it is, at the day before the next queued version (`getNextNutritionVersionStartCap`, training's `getNextPlanStartCap`). Inside a block the two tracks therefore end on the same day. Past the end there are deliberately no days: a client between plans reads as quiet — the meals still save, with no target to judge them — until the coach draws the next bound.

**The start is judged first, in the orchestrator**: a version may not start in the past — the orchestrator refuses a past date and the RPC's belt refuses it again — and nothing else bounds it (owner, 2026-09-11): today is the coach's to replace whatever the client has eaten, so a save from today replaces the running version from today, logged or not, and nutrition never asks the deletion floor (see "The deletion floor"). **The write path** is `create_nutrition_plan_atomic` (26 arguments since migration 172: 166's 25 with `p_effective_until` required, plus the optional `p_coach_note`): a **caller-cooperative belt** refuses `effective_from < p_today` and an end before the start; every active version of the client is locked `FOR UPDATE`; the end is capped once more at the next queued version's start, as a race belt; the **predecessor** — the active version that started before and still reaches the new start — is capped at `new_start − 1` (convergence, never deletion); then a version starting on the **same day** is **replaced in place** (it keeps its id, so its note rows and a retry after a failed note insert land on one row) and otherwise the new version is inserted; then the version's daily-target grid is replaced. **A save is the RPC and nothing else** — the coach's note is one of the RPC's arguments and lands in the same transaction (migration 172): no day is written, because every day inside the window is computed from the row the moment it commits, a today the client has already logged included (the log stores no target), and the capped predecessor's tail past this version's end is answered by nothing from that same moment. Windows can never overlap: the gist exclusion `nutrition_plans_active_window_overlap` (scoped to `status = 'active'`) is the backstop that must never fire, and racing first saves collide on it loudly. There is no open row. A save dated BEFORE a queued version runs until the day before it and leaves it standing; the drawer's Starts-on field says so under the date. `effective_from` means **"when this version's numbers took (or take) effect"** — birth and effect coincide per version (`created_at` keeps the row's birth) — and, for a calculated version, **the day the deficit is spread from**: the calculator's window runs from the later of `effective_from` and the client's today to the goal deadline, in the drawer's preview and in the save alike (`handleCalculatedPlan` hands the date to `generateNutritionPlan` as `startDate`; the drawer's "Starts on" setting hands the same date to the same pure module). **Resolution is by date everywhere**: `getNutritionPlanForDate` / `getNutritionPlanIdForDate` (via the shared `coversDate`), `getNextFutureNutritionPlan` (earliest queued), `getLatestNutritionPlan` (the latest-starting version — the drawer's seeds and the goal-drift comparison), `getActiveNutritionPlanId` (covering-today wrapper). The coach GET returns **three roles** — covering ("Active since", `hasCurrentTargets`), earliest-future (`scheduledFor`), latest (drawer seeds `latest ?? covering` + goal drift); a client whose every version has ended reads as having no plan. **Delete = a save of nothing from today** (`clearNutritionPlansForClient`, the training clear's shape; owner decision 2026-09-10): the RUNNING version ends at YESTERDAY and keeps its past — on the calendar and on every block it ran in — a QUEUED version is archived (it never ran a day of its own), a FINISHED version is untouched, and no day statement is issued — ending the versions IS removing the days (`services/nutrition-plan-clear-service.ts`) — but the hand edits on the days it uncovers go with them: one delete of the `nutrition_day_edits` rows dated from today inside the ended versions' windows, issued FIRST so a failure leaves the versions whole for the retry, while past days keep their version and their edits. The block delete does the same for the versions laid in the block, and the block card's per-plan delete does it for ONE version by id (`clearNutritionPlanById` — the same retire path; the statements are spelled once). Yesterday, never today, deliberately: a version closed AT today would keep covering it, so the hero would go on saying "Active since" until midnight, and today is the coach's to end whatever the client has eaten (owner, 2026-09-11). Every read resolves by date among `status = 'active'` rows, so from today nothing covers a day — the block card's headline reads Not set, and the client's meals still save on those days with no target to judge them. The baseline/deficit calculator is `services/nutrition-service.ts` (pure — the browser previews through the identical module), macro splitting in `utils/nutrition-helpers.ts`, rate⇄calorie conversion in `utils/energy-conversions.ts`; the retired calculator doc's prose walkthrough lives in git history of `docs/NUTRITION_PLAN_CALCULATOR.md`.

### `nutrition_day_edits` (migration 169)

The coach's per-day override — the one thing stored per nutrition day. One row per `(client_id, date)` (`UNIQUE`), holding `calories`, `protein_g`, `carb_g`, `fat_g` (integers, `CHECK >= 0`), the client-visible `note`, `coach_id` (`coaches.id`, SET NULL — the coach who last wrote the edit, the audit actor; NULL for a row copied from the retired day table), `created_at` and `updated_at`. `client_id` cascades from `clients`.

- **A computed day with an edit takes its numbers verbatim, carries its note, and takes no training surplus** (`isModified` true, burn 0, surplus null) — the coach's number is the whole answer for that date. A day with no row is the plan's own.
- **Three statements, one per act** (`services/nutrition-day-edits-service.ts`): a paged range read, one upsert on `(client_id, date)` for every day of an edit (re-editing a day replaces its row in place and keeps its id), and one delete for every day of a reset, which returns how many days actually held one.
- **An edit is resolved against the day as computed.** `materializeNutritionEventDays` (`services/nutrition-event-edit-service.ts`) reads the computed days once over the selection's span and writes only the selected dates: an absolute edit stores the coach's calories and macros verbatim on every selected day — the Edit-targets dialog is the macro balancer (`components/clients/nutrition/macro-balance.tsx`, opened on the first selected day's numbers), so every selected day gets the same four numbers, and a payload carrying calories alone, which only a raw API caller sends, holds protein and rebalances carbs and fat. A note-less edit keeps the day's standing note; an empty string clears it. A selected day no version covers has no computed day and is skipped.
- **The act that uncovers a day removes the edit on it.** The plan delete removes the edits dated from today inside the windows of the versions it ends or archives; a block trim removes those past a version's new end, and the whole window of one it removes. Both go through one statement, `deleteNutritionDayEditsInRanges`, an `or` of per-range `and`s, so a surviving version's days between the ranges and every past day keep theirs. No other act uncovers a day — a save caps its predecessor only up to the day before the new version, which covers from there — so an edit is never left dormant on a day the coach cannot see or revert.
- RLS enabled with **no policies**; `REVOKE ALL` then `GRANT ALL … TO service_role` (CONVENTIONS §8). The unique constraint indexes every per-client range read; `coach_id` is indexed partially, for the FK's SET NULL.

### The two notes, and why they are not one thing

Two note surfaces exist with two different lifetimes and two different audiences. Reaching for the wrong one is the recurring mistake here.

| Column / table | Audience | Scope | Written by |
|---|---|---|---|
| `nutrition_day_edits.note` (mig 169) | client-visible, **unconditionally** | per-day — part of the edit, set or cleared with it, gone on reset | the per-day range-edit path only |
| `nutrition_plans.coach_note` (mig 172) | client-visible **while the block its version starts in is current**; the coach's calendar on the day the version took effect and the Journey timeline while the version stands or ran | plan-level — the latest save's, empty included | the plan RPC, as one of the save's arguments |

The second row's qualifier is the point, not a footnote. **The coach's Journey timeline renders every version's note while the version stands or ran; the client's Program tab renders only those whose version starts inside their CURRENT block.** Two surfaces, two lifetimes, one store — the version row — and the coach's calendar reads the same row: the computed day carries the covering version's note as `coachNote` on the day the version took effect, and nothing stamps it anywhere else. A note goes where its version goes: a same-day re-save replaces it, a capped version keeps it, an archived version takes it out of every read, a plan that ran keeps it in its past. Every piece of coach-facing copy about this note — the builder drawer hint, the calendar popover — is worded against that difference and must stay that way: they name the condition ("it shows on their Program tab with the block it falls in") rather than asserting an outcome ("shown to Sam"), because a coach who believes the stronger claim writes an explanation that reaches nobody.

**That rule is enforced on the wire, not in the renderer.** `GET /api/client/journey` returns `currentBlockNotes: { blockId, notes[] } | null` — there is deliberately **no per-block `notes` field** on `ClientJourneyBlock`, so an elapsed block's notes never cross the contract at all. The endpoint is the RN contract surface; a rule expressed only in the web component would ship those notes to React Native and leave it to re-derive the same drop, or the two client apps would disagree about what a client may read. Widening visibility to finished blocks is therefore a deliberate **contract change**, not a filter removal. The `blockId` is carried so a client asserts rather than infers ownership, and it keeps the empty cases distinct: `null` = no current block, `{ blockId, notes: [] }` = a current block the coach has written nothing about.

### `nutrition_plans.coach_note` (migration 172)

The coach's "why am I adjusting this plan?" note is a column on the version it explains — nothing references it, nothing orders it, one version owns it, and it is rewritten only when the whole version is replaced in place (CONVENTIONS §8's test). Written by `create_nutrition_plan_atomic` as one of the save's arguments (`p_coach_note`, optional and omitted when the save carries none), so it lands in the version's transaction or not at all; **the latest save's note, empty included** — a same-day re-save replaces the version in place and its note with it, and there is no history of superseded notes by design: a coach re-saving the same day is correcting the save before it. It travels with the version — a capped predecessor keeps it, an archived version takes it out of every read, a plan that ran keeps it in its past — which is what keeps a block drawn over a deleted plan's dates from listing that plan's notes.

- **Read paths:** the day reader (the version read it already holds — `coachNote` on the version's start date, null on its other days), `GET /api/clients/[id]/blocks/facts` (`BlockNutritionFact.note`, off the same version read as the numbers; the timeline nests it under the version's own entry) and `GET /api/client/journey` (`listNutritionPlanNotesInRange`, `services/nutrition-plan-service.ts` — the active versions starting inside the current block that carry a note, on the unchanged `NutritionPlanNote` wire shape whose `id` is the version's).

**Display total**: `baseline * (1 + surplus/100)` when `include_activity_burn` is on, else `baseline`. The toggle is a display switch read at render; nothing stored changes with it. How the surplus calories distribute across macros honors `clients.surplus_as_carbs` (migration 117) via the shared `applySurplusSplit()` (`utils/nutrition-helpers.ts`): protein is held; **keep-split** (default) scales carbs+fat preserving the plan ratio; **carbs-only** holds fat and adds the surplus to carbs. The same helper backs both the event mapper (`mapNutritionEventToDisplayTarget`) and the plan-based "typical week" path (`buildDailyTargetsFromPlan`).

### Event lifecycle
- **Generation paths** (training):
  1. Program builder → draft in coach library (`coach_saved_plans.status = 'draft'`) → coach previews and edits on full-page editor → place from any start date (whole-program date-walk)
  2. Library plan → apply or drag onto calendar (creates fresh client-side `training_plans` + `training_sessions` + `training_exercises` + `training_events`)
  3. Library session → drag individual saved session onto a specific calendar day
  4. Direct plan creation via the legacy builder (still supported)
- **Generated** at placement (the date-walk), rewritten from the first editable day by the plan editor's save (`edit_training_plan_atomic`, migration 175), and shifted whole, with their program, by a start-date move (`move_training_plan_atomic`, migration 177)
- **Nothing cascades into nutrition.** A nutrition day is computed from the session on its date when asked, so a training write changes what the next read computes and writes nothing else; every training writer still invalidates the coach's SWR-cached nutrition calendar (CONVENTIONS §7)
- **Frozen once past** - only future `scheduled` events are deleted or re-laid. Past events and non-scheduled statuses are preserved
- **Calendar operations** (training events): coaches can move an event to another date, clear a week, delete an event, and edit a day's session in the placed-session tray. Moved events get `is_modified = true`. **A day can hold several sessions**, and a moved one joins its new day last — see "Several sessions a day" above. **The tray's Save rewrites the session row the day's event points at** (`PUT …/sessions/[sessionId]` → `replaceSessionFull`). Every writer that puts a day on the calendar — placement, the plan editor's save and a library session dropped on a day — gives the day a row of its own, so a save changes that day alone; changing a session across many days is the plan editor's (see "Edit plan"). The response carries the saved session, which the tray writes into its own read before it refreshes the training area and closes, so the day reopens on what was saved.
- **Per-day nutrition editing**: coaches edit computed days on the nutrition calendar over a `dates[]` selection — the Edit-targets dialog's macro balancer: one calorie target and split, the same four numbers for every selected day — via `PATCH /api/clients/[id]/nutrition/events/range`, which resolves the coach's numbers against each selected day as computed and writes one `nutrition_day_edits` row per day (`materializeNutritionEventDays`; the editing coach is stamped as `coach_id`); `PATCH …/nutrition/events/reset` (`resetNutritionEventDays`, over the same `dates[]` selection) deletes those rows and the plan's own numbers answer again — its response counts the days that held an edit. Both are server-guarded to `date >= clientToday`. The read is `GET …/nutrition/events?startDate&endDate`, the computed days over the range.

### The deletion floor

**One question, one answer: from which day may a client's training sessions be REMOVED, and from which day may a training PROGRAM start?** `resolveEventDeletionFloor` (`services/event-deletion-floor.ts`) is the only place it is answered — their today, or **tomorrow** if they have already trained today. It is training's alone (owner, 2026-09-11): nutrition asks nothing of it.

- **Replacing today is always fine; emptying it is the harm.** A placement overwrites the day in the same breath it clears it; an emptied day costs the client their session for the rest of it. So the training removals ask this, and so does the program start (next bullet).
- **A program may not START before it either — one function, both directions**, so a day the client has trained can be neither emptied nor re-prescribed. `POST …/place-from-library` (both program branches) refuses a start before the floor with a 400 naming the client, the day they logged and the first day a plan can start; the apply dialog floors its date picker on the same value (`planStartFloor`, on the blocks payload) and says why under the field. A program's start-date move asks the same question: a program whose start is before the floor has started and does not move, and a new start before it is refused; the Plans hero's calendar greys those days (`planStartFloor`, on the Training tab's plan read). There is no override: the earlier warn-and-override wrote the program's first session beside the one the client had already logged (the walk's upsert arbitrates on `(client_id, training_session_id, date)` and the completed event belongs to another session row), and the check-in counted the pair as a missed session.
- **"Trained" is one read**: a `training_events` row for the date that has left `scheduled`. A meal logged today moves nothing, on either track — the floor reads no `nutrition_logs` row, and must not regain one.
- **It fails CLOSED.** The read erroring returns tomorrow: a day skipped is a stale row the next removal clears, a day emptied is not undoable.
- **Nutrition has no floor.** Today's targets are the coach's to change or to end whatever the client has eaten: a version starts on any day from the client's today — the orchestrator's past-date check and the RPC's belt are the only bounds, so a save from today replaces the running version from today, logged or not — and the nutrition drawer floors its date picker on the client's today. The client's log is never lost: it holds what they ate, and a logged today reads the new target the moment the coach's change lands, because a day's target is computed and the log stores none (see "Read priority for nutrition targets").
- **A deleted plan governs nothing from today.** The delete ends the running version, or program, at yesterday and archives queued ones; every read resolves by date, so the hero, the Overview and the client's Program tab read "no plan" the moment it lands, while the past keeps its plan — and on the nutrition track that IS the removal of the days, since nothing stores one. On a logged today the history row shows the log against the target it was logged under, the calendar shows no target, and the client's next meal still saves.
- **Callers, and they do no arithmetic of their own:** a block trim (`applyBlockPlanTrims`), the training-plan clear (`clearTrainingPlansForClient` — the calendar's delete and the block delete) and the per-plan `DELETE /api/clients/[id]/training/[planId]` — plus, in the other direction, the placement's start guard (`place-from-library`), the start-date move (`services/training-plan-move-service.ts`, which hands the floor to `move_training_plan_atomic`), and the two reads that carry the floor to a picker: the blocks payload (the apply dialog) and the Training tab's plan read (the Plans hero). Neither the nutrition clear nor the nutrition save asks it. A removal that starts at the floor needs **no second "skip the day they trained" filter** — that day is never in range, and adding one would defend a state that cannot occur.

**There is no delete-the-days-but-keep-the-plan act on either track.** Deleting from the training calendar ends the program the client is on *and* removes their upcoming sessions; deleting from the nutrition calendar ends the version, and the upcoming targets go with it because they are computed from it — the running plan at yesterday, a queued one archived, a finished one untouched. Both are labelled "Delete plan" for that reason: on the training track a program left standing with no days is a program with nothing on the calendar, and on the nutrition track the days cannot be removed without ending the version, since nothing stores them.

### The window is the row

A version's `effective_until`, stored on the row at save (migration 166), decides which days the version ANSWERS FOR — no block, program or fixed window is consulted per read, and nothing is cached because nothing is derived. The end is resolved ONCE, at save, by `resolveNutritionPlacementEnd` (see "Nutrition plan versions"):

1. **The end of the block the START falls inside** (`getBlockBoundForDate`, `services/client-blocks-service.ts`, answering `covering`) — a block is the time-bound program the coach sells, so its last day is the answer whenever the version opens in one. The block **covering** the start, never the furthest the client has: a later block the coach has not priced yet must not pull targets into itself, or its card reads "Not set" while its days already hold numbers. Its own plan save opens inside it and resolves this then, which is when the coach has actually said what it costs. The same function answers the training placement window, so both tracks read one bound. When no block covers the start it answers `next` instead — the first block after it — and steps 2 and 3 below are capped at the day before that block: a cap, never a length, so a version saved in a gap stops at a block the coach has not set up rather than running into it.
2. **Else the furthest live training program's last day** (`getFurthestLiveProgramEnd`, `services/training-service.ts`) — the furthest `effective_until` among the client's live programs on or after the start, read off the row (migration 167). Carries the `deleted_at IS NULL` / `status <> 'archived'` exclusions both sibling readers document, and **no start predicate**, so a queued program counts like a running one.
3. **Else a fixed eight weeks** from the start (`NUTRITION_PLACEMENT_FALLBACK_DAYS`) — all a client with neither a block nor a live program has.

Capped, whichever it is, at the day before the next queued version (`getNextNutritionVersionStartCap`).

Inside a block the two tracks end on the same day by construction, because the placement window is that same block (below), and a block drawn or shortened over existing plans trims both tracks to it (see "Journey blocks").

Precedence, not a maximum: past the coach's declared bound there are deliberately no events, so a client between plans reads as quiet until the coach draws the next bound. A block that never actually bounded anything would be decoration. Two consequences to know: a client with no block whose program ends in three weeks gets three weeks of targets, not eight; and a version saved in a GAP between blocks falls through to the program, because no block covers its start.

The two declared-bound reads degrade to null on error (logged + Sentried) rather than throwing, so a failed lookup falls back to the fixed window instead of failing a coach's save.

**The day is computed from the row.** `resolveNutritionDay` (`services/nutrition-day-resolver.ts` — PURE, no database client) is the one answer to "what is this client's target on this date?", and every reader — the coach calendar, the client's day and Program tab, the check-in week and its submit-time snapshot, the coach history table — gets its numbers from it, so they cannot disagree. Four facts and nothing else go in: the version covering the date and its grid row for the weekday, the sessions placed on the date, and the coach's edit. In the order they decide a day:

- an **edited day** takes the coach's calories and macros verbatim, carries their note, and takes no training surplus (`isModified`, burn 0, surplus null);
- otherwise the **baseline** is the grid row's calories, else the version's `baseline_calories`;
- the **surplus** adds every session's `training_events.calorie_surplus_percentage` on the date (`sumSurplusPercentages`, shared with the client's week of targets) — read off the events, never through the session FK — and the burn is that share of the baseline; when no session carries a percentage, the legacy flat sum of the sessions' `estimated_calories`;
- the **macros** are the grid row's, verbatim (custom macros and the coach's split live there), else the diet split over the baseline with protein held at the version's target (`calculateDailyMacros`);
- `isTrainingDay` is "a session exists on the date", whatever its status — the TRAIN badge follows the calendar live, never a stored flag;
- `coachNote` is the covering version's save note, on the day the version took effect;
- `dayOfWeek` comes from `nutritionDayOfWeek`, the ONE weekday spelling a caller picking a grid row must use.

The DTO is `NutritionEvent` (`types/check-in.ts`): `id` is the date (stable and unique per client — the edit routes address days by date, never by id), `nutritionPlanId` is the covering version and never null, and `status` is always `scheduled` (a computed day has no lifecycle; the field survives because the coach calendar's edit gates read it). Every day from the client's today onward is editable; an edit or reset of a logged today reaches every reader of that log at once, because the log stores no target. "Logged" for nutrition is the existence of a `nutrition_logs` row for the date (`getNutritionForDate`).

**The reader is batched, never per day.** `getNutritionEventsForDateRange` (`services/nutrition-days-service.ts`) issues four reads for any range — the active versions overlapping it with their prescription and save note (`getNutritionPrescriptionsForRange`), their grids (`getNutritionPlanGrids`), the training events in range (`getEventsForDateRange`, status-agnostic) and the edits (paged) — then hand every date to the resolver with the version covering it. A date no active version covers yields NO day, which is what a gap between plans is: the meals still save there, with no target and no verdict. A single day is the range reader over one day. A month view is therefore a few small reads rather than one and a client's day a few point reads — collapsible into one RPC later if measured (owner, 2026-09-10). **The two target readers beside it** — `getNutritionTargetsForDateRange` (one client) and `getNutritionTargetsForClients` (the attention feed's roster: every source read once, chunked by client id and paged, resolved in memory with the same pure resolver) — are those days through the client's two display switches, the number every verdict is judged against.

**What keeps a derived past stable: a version's grid is never edited in place once its first day has passed.** Ended plans keep their windows, past sessions cannot move, edits before today are refused, and the same-day replace-in-place can only touch a version starting today. The orchestrator's past-date belt is the pin; a future "adjust the running plan's numbers" feature must mint a version, as every save does today.

**A logged day carries no target** (owner decision 2026-09-11): the food log holds what the client ate and nothing else — the spine link, the four consumed columns, the covering version's stamp when known — so the target for any day is the computed day, and the coach's change to today and a session landing on a logged day reach every reader at once. The history table, the calendar, the client's day, the check-in week, the Overview rail and the dashboard feed all take the target from the day reader and derive the verdict — hit / partial / missed, the surplus or deficit — from what was eaten against it (`calculateNutritionAdherence` / `calculateCalorieSurplusDeficit`, `lib/nutrition-verdict.ts` — pure, re-exported by `services/daily-logs-service.ts`). The check-in's figures are the nutrition kernel (`utils/nutrition-period-summary.ts`) over those days — a logged day with no target is counted as logged and is in no ratio — and the check-in submit is the one freeze (`period_snapshot`, `nutrition_days_on_target`). Every client wire keeps its shape — `{ consumed, target, source }` on the day GET; `targetCalories` / `nutritionAdherence` / `calorieSurplusDeficit` on `DailyLog` — now derived; the browser and React Native compute nothing.

### Read priority for nutrition targets

The **per-date day-view path** — `getPlanTargetForDate()` / `getNutritionForDate()` (`services/daily-context-service.ts`):
1. **Logged days**: the row's consumed values over the computed target — the target is never read off the row
2. **Unlogged days a version covers**: the computed day (`getNutritionTargetsForDateRange` over one day, via `mapNutritionEventToDisplayTarget`, honoring `include_activity_burn` + `surplus_as_carbs`)
3. **Days no version covers**: no target — a gap between plans, or the stretch a delete opened; the meals still save there and carry no verdict

The **plan-based "typical week" / client program-card path** — `buildDailyTargetsFromPlan()` (`utils/build-daily-targets.ts`) — is fed the same computed days for the week, so the two paths cannot disagree; a day no version covers has no entry.

**Each day carries its `date`, and the seven are emitted in the client's own week order** — the week ends on their check-in day, so it can begin on any weekday. The date is the payload's only statement of WHEN the week starts, and without it a renderer can only guess from weekday names: two independently guessed Monday-first, and a Saturday-to-Friday client was shown their week beginning three days in with its two earliest days last. `VerticalNutritionView` sorts on the date rather than a weekday list, the same way the training page sorts on the `orderIndex` the server hands it. **Never sort these by weekday name.**

---

## Training Completion Hierarchy

```
training_logs            -- did the client train today? (1:1 per day, child of daily_logs)
  └── session_logs       -- one row per logged session, keyed to a training_event (renamed from client_session_completions)
        ├── session_log_group_scores  -- a timed group's score: rounds + reps, or a finish time (migration 186)
        └── exercise_logs    -- per-exercise metadata (renamed from client_exercise_completions)
              └── set_logs   -- per-set actuals (added in migration 090)
```
### Event-keyed identity (migration 097, Session 5.2)
- `session_logs` is keyed by **`training_event_id`** (FK → `training_events`, `ON DELETE SET NULL`), with a partial unique index `session_logs_training_event_id_key ON (training_event_id) WHERE training_event_id IS NOT NULL`. The old session-week composite `UNIQUE(client_id, training_session_id, week_start_date)` is **dropped** — it silently overwrote two events that shared a session in one week.
- Write semantics (public `logTrainingEvent` / `logTrainingSessionForDate` in `services/training-log-service.ts`, both delegating to the internal `writeSessionLog` helper): if the event already has a `session_log_id` → UPDATE that row by id; else INSERT, stamping `training_event_id = event.id`. A `23505` on the partial index (concurrent submit / half-failed prior link) recovers by updating the conflicting row — never a duplicate. `linkSessionLogToEvent` writes both directions (`event.session_log_id` + status, and `session_log.training_event_id`).
- `completed_at` is the **attribution date** — `event.date` for event-keyed logs (NOT the entry day), the logged date for event-less. A late backfill therefore attributes to the prescribed day.
- `session_logs.training_session_id` holds the **performed** session. `prescribed_session_snapshot` captures the **prescribed** session (the event's session for matched logs; the chosen session for unmatched extras). Both SET NULL on delete; history preserved via the snapshot JSONB.

### How a workout reads (the display state)

Two facts, kept in two places, and one pure helper that puts them together —
`lib/training-display-state.ts`:

- **Did the client log it?** `training_events.status` — `completed` says yes, at any quality, and
  `scheduled` says no. Those are the only two it can hold (migration 182).
- **How did it go?** `session_logs.completion_quality`, on the log alone — `full` or `partial`, the
  two words `LoggedQuality` (`types/training.ts`) holds. There is no copy on the event, and no screen
  reads the status word as quality — that copy is what made one week read 4/5 on the client's
  check-in and 5/5 on the coach's review.

`trainingDisplayState(workout, today)` returns the one vocabulary every tick, dash, chip and pill
keys on — `scheduled`, `completed_full`, `completed_partial`, `missed` — and
`loggedDisplayQuality(workout)` is its quality half for surfaces that show only that. Three rules it
owns:

- **The log wins** whenever it carries one of the two words the product writes.
- **A workout logged before the link existed reads `full`** — 227 such rows on dev (September 2026):
  completed, with no log to have recorded a quality.
- **`missed` is derived, never stored** — still scheduled on a day that has passed — and the day is
  the caller's own: the client's today on their screens, the coach's on the coach's.

The status is read POSITIVELY — logged is `completed`, never "anything but scheduled" — so a
database read before its migration still answers truthfully: a word the product no longer stores is
not a workout done. `TrainingWorkoutRead.status` is a bare `string` for that reason.

**Every read of calendar workouts embeds the log**, through the NAMED foreign key
`session_logs!training_events_session_log_id_fkey` (two relationships exist between the tables, so an
unnamed embed is a PGRST201). `EVENT_WITH_LOG_COLUMNS` and the one `mapEventRow`
(`services/training-event-service.ts`) are where that happens, and `TrainingEvent.log` — the log's
id, quality, performed session and note — is what they hand every reader; the Overview's adherence
read and the attention feed's two cross-client reads carry the same embed on their own narrow column
lists. A read that dropped it would quietly show every partial workout as a full one.

What keys on it: the coach calendar card's thumb, the client's day card, the coach's Data table
(through the per-day schedule shape above), the check-in wizard's training rows, the check-in
review's pills, the check-in AI prompt's per-session lines, the attention feed's partial-workout
alert, and the Overview's training rail — where a day is classified from its own workouts (every one
full → complete, any done at all → partial, any missed → missed) while the figure beside it counts
full completions.

**Counting them is one function too.** `summariseTraining` (`lib/training-adherence.ts`) takes any
rows carrying a status and a log quality — calendar events through `eventWorkoutRead`, or the
per-workout detail a check-in read carries — classifies each through `loggedDisplayQuality` above,
and returns `{ planned, completed, full, partial, missed, pct }`: `completed` is full + partial,
`missed` is everything not done (still scheduled, never logged), and `pct` is
`completed / planned`, null when nothing was planned. **`completed` is the numerator of every
done-count in the product** — the check-in review's ribbon and AI prompt, the Training-tab hero, the
Overview's adherence card and its plan card, the client's check-in wizard and the figure the submit
freezes — and `full` / `partial` are the breakdown a surface prints beside it, never a second count.
The Overview's adherence kernel runs it over the same rows its rail is built from, so a day wearing a
partial dot is inside the number next to it (`services/client-adherence-service.ts`). See "The
figures, and what they divide by".

**The Training-tab hero and the Overview's plan card count CALENDAR WORKOUTS, by their date.**
`getTrainingWeekSummary` (`services/training-week-summary-service.ts`) reads the client's current
week — anchored on their check-in day, on the COACH's today, capped at today because a session still
to be done later in the week is neither planned-against nor missed — and puts those workouts through
`summariseTraining`. It serves `GET /api/clients/[id]/history/training/summary` (the hero) and
`GET …/overview-plan-summary` (`thisWeek`), so the two cannot disagree. Every figure it returns comes
out of `summariseTraining`, so `missed` is what is left of `planned` once the logged workouts are
taken off it. **No adherence figure reads `session_logs.completed_at`**: a log's stored date does not
move when its workout does, so a moved workout used to be counted in the week it left
(`TECHNICAL-DEBT.md` → "A moved workout leaves its log's stored date behind").

### The coach's logged-workout readout

`GET /api/clients/[id]/training/session-logs/[sessionLogId]` → `getSessionLogDetail` →
`components/clients/training/session-log-detail-dialog.tsx` → `session-log-exercise-card.tsx` →
`session-log-set-table.tsx`. The coach-side twin of the client's log form, and it obeys one
inversion: **the PRESCRIPTION drives the row list, not the log.**

- **Rows come from `buildPrescribedRows(snapshotToSpecs(snapshot))`** — the same flattening kernel
  the client grid and the `set_logs.set_type` stamping use, reached through the shared
  `snapshotToSpecs` (`utils/exercise-set-specs.ts`). A readout that flattened differently would show
  a coach a row beside a spec it was not typed against. The pairing itself is
  `buildLoggedSetRows` (`utils/logged-set-rows.ts`), and set display numbers come from
  `buildSetDisplayNumbers` (`utils/set-spec-rows.ts`), shared with the client grid for the same
  reason.
- **Alignment is by `set_logs.set_number`, a 1-BASED INDEX into the flattened list** — not the
  coach's set number, which drop children repeat. A prescribed set with no logged row renders **not
  done**; a logged set past the prescription is kept (the client appended rows, or the coach shrank
  the prescription afterwards), sized `max(prescribed, highest logged)` and capped at
  `MAX_PRESCRIBED_ROWS` — the same rule the client's reopen path uses.
- **A tick and a blank are different states.** A logged row with every value null is
  "did the set, recorded no numbers" and renders as logged-with-dashes; only a *missing* row reads
  as not done. Collapsing the two would erase per-set completion's locked decision 3.
- **`prescribedGroups` is on the wire for a reason.** An exercise the client never touched is
  absent from `exercise_logs` entirely, so the readout would silently omit it. `getSessionLogDetail`
  reads the PERFORMED session's active exercises in their groups — the same `loadSessionPrescription`
  the `completion_quality` denominator uses, so the readout and the recorded verdict describe one
  prescription — each group with its settings and its exercises in order, issued in a `Promise.all`
  with the performed-session-name read so it costs no extra round trip. Empty when the log has no
  `training_session_id`.
- **A timed group's score sits under its heading** (`session-log-group.tsx`,
  `SessionLogDetail.groupScores`): "7 rounds + 12 reps", "Finished in 8:32", "Capped · 2 rounds +
  15 reps", or "Not scored" where the client entered none; an EMOM has no score line. A score whose
  group the performed session no longer holds reads as the group its snapshot records, after the
  prescription, with no cards under it.
- **The grouping is the prescription's.** A lone exercise is a plain card. A linked group, and a
  timed group of any size, sits under a slim heading — its name, rounds, clock and rests, never the
  group's notes, which are the coach's own instructions to the client (owner, 2026-09-19) —
  with its cards on one rail
  (`session-log-group.tsx`; see "Groups" → "How a group reads"), and where its rows are rounds the
  first column reads Round. Exercises logged outside the prescription follow the groups, in none of
  them.
- **Target over actual, one column per measure** (owner, 2026-09-18). Each exercise's table is the
  Set column, then a column per box — Load, Reps, RPE, RIR, Tempo, Distance … % FTP, in the
  prescribed columns' order (`LOGGED_BOXES`) — and each cell reads the coach's target over what the
  client did: "100–105 kg" over "102.5", "5" over "4", "5 km" over "5.02 km". A strength exercise is
  Set, Load, Reps, RPE; a run is Set, Distance, Duration, Pace. The target is the words the client's
  box hinted (`formatBoxTarget`, `utils/measure-readout.ts`), the value what the box read back
  (`formatBoxActual` — the entry grammar's `formatEntry`, and a load as a bare number in the
  viewer's unit, snapped like every read-only load), and the headers are the client grid's
  (`boxHeader`: Load names the unit its bare values are in). There is no separate Prescribed column.
- **The columns follow the exercise and the data** (`loggedColumns`, `utils/logged-set-rows.ts`):
  every box the coach prescribed (`snapshotPrescribedFields`; a snapshot with no list reads as
  today's five), and any other box a row sets a target in or a set recorded a value in, so history
  never hides something recorded. Set type is the Set column's tag, never a column. Rest is not a
  box: a Rest column — the rest taken under the rest the set prescribes — appears only when a set
  recorded the rest taken, which only the React Native app's timer does.
- **A value outside its target reads amber, below as well as above; an RPE two or more above the
  top of its target reads red; a % load is never marked, because a percentage can't be compared
  with the kilograms lifted; a tempo that differs from the prescribed one reads amber**
  (`utils/target-gap.ts`, the judgement the check-in AI's lines name too). It is made at the
  precision both are shown, in the viewer's units, so a value and a target that read the same are
  never outside each other: an imperial client who types the "220 lbs" their hint showed has lifted
  99.79 kg against a 100 kg target, and a run recorded as 5,004 m reads "5 km". The rest taken is
  judged against the rest the set prescribes where the exercise's own rest applies — its Rest column
  on and its rows not a superset's or circuit's rounds, whose rests are the group's — and, rest being
  one number, any other rest taken is outside it. A marked value carries its words for a screen
  reader and on hover ("Above target").
- **Warm-ups are shown and never scored**: tagged "Warm-up", values and tick muted, never marked. A
  set type is named in full (Warm-up, Drop, Failure; a working set is untagged), and a drop
  set reads as its flattened sibling rows, matching what the client logged against.
- **The frame.** The dialog is the tray's 780px, capped at 85vh; its header stays put and only its
  body scrolls (`grid-rows-[auto_minmax(0,1fr)]` — never overflow on the `DialogContent` itself).
  An exercise whose columns don't fit scrolls sideways inside its own card, the Set column pinned.
- Two things were deliberately **removed** when this shipped: a "Prescribed 3x8-12" chip built from
  the compact snapshot columns (which cannot express warm-ups, per-set loads, drop sets or sets to failure —
  the exact lossiness `set_specs` exists to fix), and an "Incomplete" badge off the vestigial
  `exercise_logs.completed`. Do not reintroduce either; the per-set rows state both precisely.

### Alternative-session logging (Session 5.3/5.4)
- **A workout has one date — the event's — because the client moves the event to the day they train (owner decision 2026-08-26).** There is one training writer, `POST /api/client/training/events/[eventId]/log` → `logTrainingEvent`; `completed_at` is always `event.date`. On a rest day the client picks a session from THIS WEEK (`GET /api/client/training/week`), it **moves** to that day (`POST /api/client/training/events/layout`, migration 150) and opens; on a prescribed, unlogged day a pick of a still-scheduled other-day session **swaps** the two days, and a pick of a session already on the same day simply opens it — a day can hold several, each its own workout. Both go through one pure kernel, `lib/session-pick.ts`. The picker offers only sessions that can still be done — Today, Upcoming, Missed-but-still-scheduled — so a done session is never logged twice.
- **Retired with that decision:** the event-less log path (`POST …/session-logs`, `logTrainingSessionForDate`), the matcher (`findMatchingEvent`) that guessed which prescription a rest-day log fulfilled, and the "done on another day" receipt it produced (`TrainingEvent.loggedOn`, `withLoggedOn`, `TrainingEventSummary.loggedOn`, `DaySummary.trainedFor`, the read-only lock on the prescribed day). Two-dated logs made every reader carry the attribution rule; the coach's history table was the first not to, and rendered the same workout on different days depending on the query window. Do not reintroduce a cross-day link.
- **Signals:** a planned-day swap = `session_log.training_session_id != event.training_session_id` (the client chose "Do a different session" on a logged or already-done pick), read off the log embedded on the workout. The coach history table renders an "Alt" badge (`is_alternative`); the drill-down dialog shows a session-level "Prescribed X · Performed Y" line. `session_log.training_event_id IS NULL` no longer arises from the product (no event-less writer); rows carrying it are pre-retirement history and **appear on no screen** — the coach's history table is one row per calendar workout, and a log with no workout is not merged onto a day.
- `exercise_logs.training_exercise_id` is SET NULL on delete (nullable). History preserved via `prescribed_exercise_snapshot` JSONB — the exercise's prescription as logged: its compact columns, `set_specs`, `prescribed_fields`, its place in its group (`order_index`) and the group it sat in (`group`: its id, its place in the session, its format and every setting). `services/training-log-service.test.ts` pins both key sets
- Snapshots are written at completion time and backfilled for existing data
- `set_logs` holds per-set actuals — **one real column per measure a coach can prescribe** (migration 090 for `reps`, `weight`, `rpe`; migration 184 for `rir`, `tempo`, `distance_meters`, `duration_seconds`, `pace_seconds_per_km`, `split_seconds_per_500m`, `calories`, `cadence`, `stroke_rate`, `resistance`, `heart_rate_zone`, `heart_rate`, `power`, `ftp_percent` and `rest_seconds`, the rest the client actually took). Every one nullable, in its canonical unit (CONVENTIONS §20), CHECKed to its target's limit and scaled to its resolution. `SET_LOG_MEASURES` (`utils/set-log-measures.ts`) is the one table of them — keyed by the prescribed column, so Load's actual is `weight` and Rest's is `rest_seconds` — and the migration test, the wire schema, the log writer, the row mapper (`SetLog` carries every one, by wire key), the client's boxes, the coach's logged-workout table and the check-in AI's exercise lines derive from it. Replaces the legacy scalar aggregates `actual_sets`/`actual_reps`(csv)/`actual_weight` that lived on `exercise_logs` before 090. ON DELETE CASCADE from `exercise_logs`.
- `set_logs.set_type` (migrations 119 and 187) — `TEXT NOT NULL DEFAULT 'working' CHECK (set_type IN ('warmup','working','drop','failure'))`: the four set types, defined once as `SET_TYPES` in `utils/exercise-set-specs.ts`, which the CHECK mirrors (`utils/exercise-set-specs.test.ts` reads the migration). A set taken to failure has one type, `failure`; "AMRAP" names a group format and nothing else (owner, 2026-09-19), so no set type, stored or sent, spells it. The per-set type of a logged set. It is **coach-prescribed** (seeded from the prescription's `set_specs` at log time), not client-chosen — the log schema accepts-but-ignores any of the four from the client and refuses any other word, and the writer seeds each row from the prescription snapshot's per-set specs. Warm-up / drop / failure rows are written today. The analytics functions (`get_exercise_progression_window` returns it; `get_exercise_prs` filters on it — migrations 120 and 188) exclude warm-up sets from every chart marker, from compliance and from the PRs; `services/exercise-analytics-service.ts` hands a session's non-warmup sets to the marker kernel (`utils/exercise-session-markers.ts`) and reads the prescribed working-set count from the snapshot's `set_specs` (see "Exercise progress: charts and PRs").
- `exercise_logs.exercise_id` (added in 090) is a nullable FK to the global `exercises` catalog. Populated when the client picked an exercise from the typeahead picker (Add unplanned, Swap). NULL for prescribed-without-swap (catalog identity is reachable via `training_exercise_id → training_exercises.exercise_id`) and for freehand entries.
- `exercise_logs.performed_name` (added in 090) is the canonical display name for the logged exercise. Differs from `prescribed_exercise_snapshot.name` when the client swapped a prescribed exercise or added a freehand unplanned one. Display rule: `performed_name ?? prescribed_exercise_snapshot?.name ?? "Unknown exercise"`. This is the per-**exercise** swap (Session 1.5), independent of the per-**session** swap above.
- Session-level status: the log WRITE stamps `training_events.status = 'completed'` in the same statement as the link, whatever the quality, so the two cannot drift. There is no quality→status map and nothing to invert — every screen reads the quality off the log (see "How a workout reads"). **Where the quality itself comes from:** It is **server-derived** whenever the payload carries `exercises`: `deriveCompletionQuality` (`utils/completion-quality.ts`) counts the sets the client sent against the session's own prescription and **ignores any client-supplied value**. `full` means every prescribed WORKING set on EVERY exercise (each exercise judged against its own prescription, so a surplus on one cannot mask a deficit on another); anything short of that is `partial`, a save whose only ticks landed on warm-ups included — warm-ups are excluded from both halves of the ratio, and the save would have been refused if the client had recorded nothing at all. A group that takes a score joins the same verdict (`ScoredGroup`): an AMRAP is complete once scored, a For time once finished, and a capped or unscored one makes the workout `partial`; its exercises' rows are left out, and an EMOM's count like a circuit's (see "Workout logging"). The denominator therefore needs a read of its own (`loadSessionPrescription`), because an exercise the client never touched is absent from the payload entirely and must still count against them. A payload with **no** `exercises` — the check-in's fill-gap row, and any RN quick path — still uses the client's explicit `completionQuality`, and that is the only case where it is honoured.

### Exercise progress: charts and PRs

Each exercise's progress chart shows the markers that matter for its type, a table of its sessions
sits beneath it, and its PRs are its type's bests (docs/TRAINING-UPGRADE-EXECUTION-PLAN.md section
4.4). The coach's Journey → Training pane (`ExerciseDataView`) and the client's Performance view
(`performance-view.tsx`) read the same three metrics — `GET /api/clients/[id]/training/exercise-history`
and `GET /api/client/training/exercise-history`, `metric=list | progression | prs` — through the same
three functions (`services/exercise-analytics-service.ts`, over the three SQL functions of migration
188), so a coach and a client see one exercise the same way.

- **One table names the markers** — `PROGRESS_MARKER_SPECS` in `utils/exercise-progress-markers.ts`,
  the sibling of the column presets: for each of the twelve, its lens word, its chart words, the
  point key it plots, how its numbers read (`MarkerReadout`), which way is better, whether the best
  in the window is starred, and whether it is the coach's alone. `EXERCISE_TYPE_MARKERS` says which
  markers each type LEADS with, in the lens row's order, with the words the type gives them:
  Strength — Weight (the top set), e1RM, Volume, RPE, Compliance, exactly the five lenses it had
  before the other types had charts; Bodyweight — Best set reps; Endurance — Pace, Distance; Erg —
  Split, Watts; Carry & sled — Load (the heaviest carry, with its distance and time), Time; Holds —
  Longest hold. Compliance is the coach's on every type; RPE and Compliance are never offered to the
  client (`offeredMarkers(type, points, audience)`).
- **A chart follows what was actually logged when that differs from the type**, on columns, never
  names: a type's leads are always offered, and any other marker a session in the window has a value
  for follows them. The values are one session's, computed by `aggregateSessionMarkers`
  (`utils/exercise-session-markers.ts`) over its non-warmup sets: a load is a weight above zero, so
  the top set, the Epley e1RM, the volume and the rep maxes read sets with one (a typed 0 is no
  weight); reps logged with NO load are a bodyweight set, and best set reps reads those alone, so a
  weighted set never competes with a bodyweight one; a time logged WITH a distance is a timed
  distance, where the fastest counts (Time, best times); a time logged with NO distance is a hold,
  where the longest counts; pace, split, watts and distance read their own columns, the first three
  as the session's best set and the last as its total; RPE is the top set's, and in a session with
  no loaded set — no top set — the highest RPE logged. So a weighted set on a Bodyweight exercise
  offers Weight, e1RM and Volume after Best set reps; a plank typed Strength offers Longest time
  after Strength's five; a run, a hold or a bodyweight set whose sets recorded an RPE offers the
  coach RPE after the type's own.
- **The point is one shape for every type.** `ExerciseProgressionPoint` (`types/training.ts`) is one
  logged session: every marker's value beside the strength keys (`topSetWeight`, `topSetReps`,
  `estimatedOneRepMax`, `totalVolume`, `rpe` and `rir` — the top set's, or with no loaded set the
  highest RPE and the lowest RIR logged — the compliance pair), what the best set recorded with it —
  the top set's distance and time (a carry), the fastest pace's and split's distance, the fastest
  time's distance and load — and the Sessions table's other values: `totalCalories`, the highest
  cadence, stroke rate, resistance, HR zone, heart rate and % FTP (`maxCadence` … `maxFtpPercent`)
  and `averageRestSeconds`, the average rest taken, to the second. `get_exercise_progression_window`
  returns every numeric measure of a logged set (`utils/exercise-progress-markers.test.ts` reads the
  migration against `SET_LOG_MEASURES`), the service hands the kernel every one of them by that
  table, so the next marker or column is a row in a table, not a migration. The window, the identity
  union (the catalog id, direct or through the prescribed row, else the performed name) and the bound
  — twelve sessions unless a count or a date window is given — are migration 120's; the session
  window's All asks for `EXERCISE_HISTORY_MAX_SESSIONS` (500, `lib/training-constants.ts`), the count
  both routes refuse to exceed. `get_client_exercise_list` carries the catalog row's `exercise_type`
  beside each exercise, Strength for a freehand name, which is how both views know what leads. A
  point's `date` is its session's day stamp — the workout's date at UTC midnight — and every readout
  of it (the chart, the KPI strip's "days ago", the PR cards, the table) reads the day it names
  (`dayFromUtcStamp`, `lib/date-helpers.ts`), never the timestamp in the viewer's zone.
- **The lens shown derives, never remembers.** The coach's hero row and the client's switcher list
  what the exercise offers — the type's leads from the list the exercise was picked from, at once,
  and the followers when the progression lands — plus PRs on the coach's; the lens picked is kept
  while the exercise offers it and falls back to the first it offers, so a pick survives a switch to
  another exercise that offers it (`effectiveMarker`). The client's switcher disappears when an
  exercise offers one lens. The trend chart (`exercise-trend-chart.tsx`) plots the marker's key in
  the viewer's units (`utils/exercise-marker-format.ts`: loads and distances converted, a pace per
  the viewer's unit, the time-like readouts as clocks on the axis), stars the best point in the
  window for a marker that has a best — fastest for pace, split and time — and names what was never
  recorded ("No pace recorded for this exercise."). The coach's KPI strip keeps Strength's worded
  cards for its five lenses — and RPE's and Compliance's on every type, which name no unit — and
  reads any other lens as Latest, the best by the marker's own word (Heaviest, Most, Fastest,
  Longest, Highest) and the Change since the first session (`exercise-marker-kpis.ts`); the insight
  footer goes with the worded cards (`usesStrengthAnalytics`), and its RPE line names no weight,
  since a run's RPE reaches it. The session window (8/12/24/All on the coach's rail, 12/24/All on the
  client's) governs the chart and the Sessions table together and stays live on every lens: on the
  PRs lens it governs the table alone, and the rail reads "All-time" beside it, since the cards are.
  The progression is read on every lens, PRs included, so a lens switch fetches nothing; a read that
  fails with nothing in hand reads "Couldn't load the sessions" with Try again in the chart's slot and
  the table's alike (`sessions-load-error.tsx`), never "Not enough data yet".
- **Every chart has a table of its sessions beneath it** (`exercise-sessions-table.tsx`, shared by
  both views): beneath whatever the coach's hero shows — the chart of every lens, the PR cards on the
  PRs lens — and on the client's view between the chart and Personal records. One row per logged
  session in the window, newest first: Date, then one column per measure the window's sessions
  recorded, in one order — Load, Reps, Bodyweight reps, RPE, RIR, e1RM, Volume, Distance, Time, Hold,
  Pace, Split, Calories, Cadence, Stroke rate, Resistance, HR zone, Heart rate, Power, % FTP, Rest,
  Sets — a column nothing in the window recorded left out. The columns are one table,
  `SESSION_COLUMN_SPECS` (`utils/exercise-session-columns.ts`): each column's heading (a load's names
  the viewer's unit), the point key it reads — the chart marker's own where the column has a chart
  twin, so the RPE lens and the RPE column read one value — how its cell reads (the logged-workout
  table's grammar in the viewer's units; a Time cell the fastest time with its distance beside it,
  muted; Sets "3/3", or the count alone with no prescription) and which way its heading sorts first.
  Every cell is a value the kernel put on the point, one rule per measure, warm-ups counting toward
  none: the top set's load, reps, RPE and RIR — with no loaded set, the highest RPE and the lowest
  RIR logged; the e1RM and the volume; the most reps in a set with no load; the total distance and
  the total calories; the fastest time, pace and split; the highest watts, cadence, stroke rate,
  resistance, HR zone, heart rate and % FTP; the longest hold; the average rest taken; sets done over
  sets prescribed. Tempo is text and the read carries no text, so it has no column. The table reads
  the progression the chart already holds and pages it in memory — no read of its own.
- **The table's rail** — Sessions, on the coach's view a `SectionLabel` carrying the Columns menu
  (`session-columns-menu.tsx`: every recorded column but Date, grouped Strength, Endurance and
  Framework, each ticked on and off, the menu open across ticks) and the history tables' pager's
  chevrons alone (`PagerArrows`), ten sessions a page, with no count — the session window on the rail
  above already says how many (owner, 2026-09-21). **The column headings sort the table** (owner,
  2026-09-21; `SortHeading`): a heading's first click sorts by its column the way it leads —
  heaviest, most, fastest, longest, highest, newest first (`nextSessionSort`) — a second click the
  other way; the sorted heading is teal with an arrow and carries `aria-sort`, and every heading's
  title words what a click will do ("Lightest load first"). One sort at a time: ties go newest first,
  a session with no value in the sorted column goes last, and a sort whose column is ticked off or
  leaves the window shows as Newest first and returns with the column. On the client's view the
  rail is a heading like Personal records with the chevrons alone and no Columns menu — its headings
  sort the same way — and every recorded column shows. The view — the columns ticked, the sort, the
  page — is local, never the address: the host keys the table by the exercise, so another pick starts
  it on every column, Newest first, page 1; the window keys its page, so a new window starts on page 1
  with its columns and sort kept; a lens switch touches none of it.
- **PRs are the type's bests, every kind the logs carry.** `get_exercise_prs` returns typed rows
  (`ExercisePR`, `kind` ∈ `BEST_KINDS`): `rep_max` — the heaviest weight per rep count, as before;
  `best_reps` — the most reps in a set logged with no load; `best_time` — the fastest time per
  distance, exactly as logged (a 5 km run and a 5.02 km run are two rows; owner, 2026-09-20);
  `heaviest_carry` — the heaviest load per distance; `longest_hold` — the longest set logged with no
  distance. All-time, warm-ups excluded, first-achieved on a tie, bounded: reps are CHECKed to 100
  buckets, the two per-distance kinds keep the 50 shortest distances, the two single bests one row
  each. The PR grid (`exercise-pr-view.tsx` — the coach's PRs lens and the client's Personal records)
  lists the type's own kinds first, then the rest as logged (`orderedBestKinds`), a heading over each
  kind when there is more than one and the plain grid when there is one, "New" within 28 days, and an
  empty state whose hint names what the type logs (`PR_EMPTY_HINTS`).
- **The Overview announces every kind** ("Since your last visit", `services/client-activity-feed-service.ts`;
  owner, 2026-09-20): a new session's candidates — its heaviest lift (a load logged with no distance), its best
  bodyweight set, its fastest time and heaviest carry per distance, its longest hold
  (`collectNewExerciseBests`, on the same column rules) — are judged against the exercise's bests as they stood BEFORE the new sessions
  (`get_exercise_prs` with `p_exclude_dates`, the sessions' attribution days, excluded in SQL), and one
  that beats its prior best of the same kind, at the same distance, is a `pr` item carrying its
  `kind` (`PrActivity`, `types/coach-brief.ts`); a first-ever value is a first, not a PR. The row
  reads "Rowing · 1 km in 3:42.1, was 3:50", "Pull Up · 15 reps, was 12", "Farmers Carry · 40 m with
  64 kg, was 60 kg", "Plank · 2:00, was 1:45", and a lift as it always did.
- **Nothing is stored for any of this.** Every marker, every cell of the Sessions table and every
  best is computed when asked from the logged sets' real columns, inside the two functions, bounded as
  above; there is no per-session marker table, no bests table and no chart kind on the exercise row —
  the type decides what leads and the logged columns decide the rest at read.
- **The reads' keys** are built in `hooks/use-exercise-history.ts` alone. The coach's sit inside the
  training area (`useInvalidateTrainingData` reaches them); the client's workout save and Clear log
  drop the client's (`useInvalidateClientExerciseHistory`), since a logged set is what the charts and
  the PRs are built from.

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
- **Coach-specific exercises** (`coach_id = UUID`) - created from the exercise form (the Exercises tab's "New exercise"), or by a save that meets a typed name the catalog can't match (resolution step 4 below; the assistant never creates one). Only visible to that coach.

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
- `exercise_type` (`TEXT NOT NULL DEFAULT 'strength'`, migration 185) — **the exercise's type**: `strength`, `bodyweight`, `endurance`, `erg`, `carry_sled` or `holds`, defined once as `EXERCISE_TYPES` in `utils/exercise-types.ts`, which the CHECK mirrors (`utils/exercise-types.test.ts` reads the migration). A fact about the catalog row, never copied onto a library or client exercise row or a log snapshot — those reference the catalog by `exercise_id`, and the columns the coach chose are the prescription's own (`prescribed_fields`). It decides the column preset an exercise starts on when it is added to a session — the keys are the presets' keys, so `presetColumnsForType` (`utils/column-presets.ts`) is a lookup — and the markers its progress chart leads with (`EXERCISE_TYPE_MARKERS`, `utils/exercise-progress-markers.ts`; see "Exercise progress: charts and PRs"). Every row has one. A coach-made exercise starts as Strength and is edited in the exercise form's Type field (global rows stay read-only); a free-text name the builder can't match is created on save with the column's default. The global catalog was classified in the migration by name: compound and isolation are Strength except the carries, sleds and holds picked out by name, and the cardio and plyometric exercises were classified by hand (owner, 2026-09-19 — the bikes sit with the rower and ski as Erg, the climbers and elliptical are Endurance, Double Under and Jumping Jack are Bodyweight, the med ball throws and weighted jumps are Strength). `scripts/data/exercises.csv` carries the same classification in its Type column, row for row, which the same test proves, and `scripts/seed-exercise-catalog.ts` refuses a row with any other value. The Exercises tab's cards read the type after the muscle group and equipment; the client catalog reads (`GET /api/client/exercises` and the delta feed) carry it. Category stays separate free text: "Compounds only" in duplicate-with-progression reads it.
- `exercise_id` FK on `training_exercises` is nullable for backward compatibility (pre-EX-1 exercises have `exercise_id = NULL`)
- ON DELETE SET NULL preserves client/library exercises if a catalog entry is removed

---

## Coach Library

The coach library is the source of reusable training templates. Coaches author programs directly in the full-page builder at `/dashboard/programs` — a new program is created as a `status='draft'` row and promoted to `'saved'` on first successful save. Standalone sessions and the exercise catalog are browsed and edited from the same surface.

```
coach_saved_plans              -- plan templates (status: draft / saved)
  └── coach_saved_sessions     -- reusable sessions (saved_plan_id NULL = standalone)
        └── coach_saved_exercise_groups  -- the session's groups, in order
              └── coach_saved_exercises  -- its group and its place in it; exercise_id FK to exercises catalog
```

### `coach_saved_plans`
- `coach_id` (FK), `name`, `description`
- `split_type`, `frequency_per_week`
- `status`: `'draft'` (generated, awaiting coach review) | `'saved'` (coach-confirmed)
- `frequency_per_week` — the program's **sessions per week**, averaged over its weeks (a raw multi-week total would read 12 a week for 3 weeks × 4); a day can hold several sessions, so it can exceed seven. Re-derived from the session list on every save and overwrite by `deriveFrequencyPerWeek()` (`services/coach-library-helpers.ts`), which placement and the plan editor's save also use, so the paths cannot drift
- `program_duration_weeks` — the authored program length in weeks, kept truthful by the builder's post-save duration PATCH (and written by every create path). The Programs library derives its Length column and "longest" sort from it; slot/rest counts come from the session rows themselves (migration 128 dropped the old denormalized length columns)
- `default_surplus_percentage`, `source`, `coach_prompt`

### `coach_saved_sessions`
- `saved_plan_id` (FK, nullable) — NULL means a standalone session usable for mix-and-match
- `name`, `focus`
- `week_index` (INTEGER NOT NULL DEFAULT 0, migration 121) — which authored week the day belongs to. **No calendar/Mon–Sun meaning**; it is day ordering only. Ordering everywhere is `(week_index, order_index, day_order)`
- `order_index` — the day's position within the whole program, shared by the day's sessions. The builder writes a global `weekIndex * 7 + day`
- `day_order` (INTEGER NOT NULL DEFAULT 0, migration 180) — the session's place among its day's sessions, 0 first; 0 for a rest row and a standalone session
- `is_rest` (BOOLEAN) — marks a rest day's row. **Every day of an authored week is real rows** — its sessions, or one `is_rest = true` row: "empty === rest", there is no implicit gap
- `estimated_duration_minutes`, `calorie_surplus_percentage`, `session_type`

### `coach_saved_exercises`
- `saved_session_id` (FK), `group_id` (the group it sits in; see "Groups"), `order_index` (its place in that group), `exercise_id` (FK to `exercises` catalog, SET NULL)
- The compact columns: `sets`, `reps_min`/`reps_max`/`reps_target`, `rpe_target`, `percentage_1rm`, `tempo`, `rest_seconds`, `is_warmup` — one number each, the summary of an exercise with no per-set list. Every range lives in `set_specs`; `expandSetSpecs` synthesizes the pairs from these when the list is absent. `rpe_target` is CHECKed 1–10 on both tables (migrations 015, 183) and `tempo` takes the four-phase grammar below.
- `prescribed_fields` (`TEXT[] NOT NULL`, migrations 149 and 183; **also on `training_exercises`**) — **the measurement columns the coach prescribes for the exercise**: a non-empty subset of the nineteen defined once as `PRESCRIBED_FIELDS` in `utils/prescribed-fields.ts`, which the CHECK on both tables mirrors (`utils/prescribed-fields.test.ts` reads the migration and fails if the two differ). Strength: `load`, `reps`, `rpe`, `rir`, `tempo`. Endurance: `distance`, `duration`, `pace`, `split`, `calories`, `cadence`, `stroke_rate`, `resistance` (damper), `heart_rate_zone`, `heart_rate` (target HR), `power`, `ftp_percent`. Framework: `set_type`, `rest` — those two gate the row tag and the rest timer rather than being boxes of the client's grid. **No default and never null or empty**: every write schema requires the list, `projectExerciseCompact` takes it, and a writer that forgets it is refused rather than silently given the strength columns. A new exercise starts on its catalog type's preset (`presetColumnsForType`, see "Exercise Catalog"), on Strength's five (`DEFAULT_PRESCRIBED_FIELDS`: set type, reps, load, RPE, rest) for a free-text name that matches no catalog row, with a rep range only where those columns ask for reps (`defaultExerciseDraftFromCatalog`, the one draft every way of adding an exercise produces — the picker, a library drop and the assistant); a log snapshot written before migration 149 carries no list and reads as Strength's five (`toPrescribedFields` / `resolvePrescribedFields`, which also drop an unknown name). **The coach chooses each exercise's columns in its column selector** (`set-columns-menu.tsx`, on the set grid's header in every surface that hosts the session editor and on every builder target): the presets first, then every column grouped as Strength, Endurance and Framework, each ticked or unticked freely; an exercise keeps at least one column, and a tick writes the explicit list in the builder's one column order (`BUILDER_COLUMN_ORDER`, `utils/column-presets.ts`: set type, reps, load, RPE, RIR, tempo, the endurance measures, rest). **The presets are a fixed seven, one per exercise type plus Circuit** (`COLUMN_PRESET_FIELDS`, the one table the selector, the group edit and the assistant read; coaches don't save their own): Strength — set type, reps, load, RPE, rest; Bodyweight — set type, reps, RPE, rest; Endurance — set type, distance, duration, pace, HR zone, rest; Erg — set type, distance, duration, split, stroke rate, resistance, rest; Carry & sled — set type, load, distance, duration, rest; Holds — set type, RPE, duration, rest; Circuit — reps, load. A preset sets an exercise's columns to exactly its own, or every exercise's in a linked group (the heading's Columns menu, `columnsPreset` on the group patch); a column the selector doesn't offer where the exercise sits — Rest in a superset or circuit, whose rests are the group's — keeps its stored choice through every tick and preset. The preset the columns are on is ticked in the menu (`presetOf`, the hidden column left out of the comparison; on a group, `groupColumnsPreset`, the one every exercise is on), so a pick on collapsed cards is confirmed where it was made. Unticking a column stops the client collecting it; the targets behind it stay stored and return when it is re-ticked.
- **`is_warmup` has no program-builder authoring path.** The builder's draft model seeds `false`, and it round-trips untouched through save, placement and `getClientTrainingPlan`. In the builder a warm-up is a `set_type: 'warmup'` entry inside an exercise's `set_specs`, not a separate exercise. `is_warmup` is still rendered in the client tracker (`exercise-tracker-block.tsx`); its last writer (the legacy calendar drawer's add-exercise dialog) was deleted with the drawer in the placed-plan editing overhaul, so it only round-trips. Add no new UI for it.
- `set_specs` (JSONB, migration 119; ranges and every measure since migration 183) + `video_url` (TEXT, migration 119) — **also on `training_exercises`** (same shape in both tiers). `set_specs` is the authoritative per-set prescription list: `{ set_number, set_type, reps_target?, load_type?, tempo?, rest_seconds?, drops?, … }[]` plus **every numeric target as a `<measure>_min` / `<measure>_max` pair** — `reps`, `load` (kilograms or a percentage, by `load_type`), `rpe`, `rir`, `distance_meters`, `duration_seconds`, `pace_seconds_per_km`, `split_seconds_per_500m`, `calories`, `cadence`, `stroke_rate`, `resistance`, `heart_rate_zone`, `heart_rate`, `power`, `ftp_percent`. A single value is the same number at both ends; a range runs low to high. `SET_SPEC_MEASURES` (`utils/exercise-set-specs.ts`) is the one table of measures — each one's two keys, floor, ceiling and whether it is whole numbers — and the zod schema (`setSpecSchema`), the flattened rows (`PrescribedRow.ranges`) and the assistant's program view all derive from it, so a measure is added there once. Units are canonical (CONVENTIONS §20): metres, seconds, seconds per km, seconds per 500 m, kilograms. **Tempo is one compound value** — four phases, seconds (0–99) or `X` for explosive, written `3-1-X-0` (`TEMPO_PATTERN`, the same grammar on the exercise-level column). **Rest is one number**: it is what the rest timer counts down. A drop keeps its one `load_value` and one rep count. **RPE is 1–10 on every path** — both ends of the pair, the exercise-level column on both tables, the assistant's tools. Every stored spec — library and client exercises and the log snapshots alike — carries the pairs and no single-value `rpe_target` or `load_value` key, so nothing reads two spellings. When NULL the compact columns are the source of truth and `expandSetSpecs()` synthesizes N `working` specs from them, so every prescription yields per-set rows carrying a `set_type`. In the builder every chosen column is a box on each set row (`set-row-editor.tsx`, `measure-range-input.tsx`): reps, RPE, RIR and the plain-number measures are range boxes ("8-12", "7-8" — `utils/target-range.ts`, the one grammar), load is a value or range in its type's unit, tempo one compound value, and a distance, duration, pace, split or HR zone is typed and read in the entry grammar at each end, in the viewer's units and stored canonically ("400-800 m", "2:00-2:30", "3:45-3:50 /km" or "7:39 /mi", "1:52.3-1:55 /500m", "Z2-Z3" — `parseEntryRange` / `formatEntryRange`, `utils/target-range.ts`, over `parseEntry` / `formatEntry`; a unit written once on the right end reads for both). The grid scrolls sideways with its number cell pinned when the columns don't fit. Where the client's grid and the coach's logged-workout table read a target, a range reads with an en dash: "7–8", "100–105 kg", "70–75% 1RM" (`formatBoxTarget`, `utils/measure-readout.ts`). Duplicate-with-progression moves both ends of a load or rep range.

  **Three rules the flattening kernel owns, because every renderer would otherwise re-derive them:**
  - **A drop's load type belongs to its PARENT spec.** `drops` is `{ load_value, reps }` — there is deliberately no per-drop `load_type`, so every drop of one set shares the set's unit and "80kg, drop to 60%" is unexpressible. `buildPrescribedRows` copies the parent's type onto each drop row, the same way drop children already inherit `setNumber`. `weight` is the pre-`load_value` spelling (canonical kg, from when a drop could only be absolute); read both through `dropLoadValue`, write only `load_value`. Removing the `weight` key is destructive and needs a **prod** probe, not a dev one.
  - **A `failure` set prescribes no rep count.** `buildPrescribedRows` emits `repsMin`/`repsMax`/`repsTarget` as null for it. This is a READ rule, not a write-side clear: switching a set's type in the builder leaves the old range behind and the assistant can author one too, so a stored spec can carry a stale range that no clear would have reached. Expressing it here makes the stale value unreadable rather than tidied, and costs a coach nothing when they toggle a type back. The builder's reps input is disabled for it; the CLIENT still records the reps they achieved.
  - **Rest is a property of the BOUNDARY between rows, not of a row.** `restAfterRow(rows, i)` returns null when nothing follows or when the next row continues the same spec, else the rest of the SET this row belongs to — walking back to the parent for a drop child. `restSeconds` stays a faithful projection of the spec (null on drop children) rather than being relocated onto the last child, because a client asks *"is there a rest interval here?"* while a coach readout asks *"what rest does this set prescribe?"*, and moving it serves the first by destroying the second. In a linked group what follows a row is the group's to say (`restAfterGroupedRow`; see "Groups").
  - **Every measure reaches the rows.** A `PrescribedRow` carries `repsMin`/`repsMax`, `loadType` with `loadMin`/`loadMax`, `rpeMin`/`rpeMax`, `tempo`, and `ranges` — every measure's pair by name, for a renderer that walks the exercise's columns rather than naming each one. A drop child carries only its reps and its one load (at both ends, in the parent's type); a to-failure row reads no reps in `ranges` either.

  **When specs exist, `sets`/`reps_min`/`reps_max` are a maintained projection, never independent truth.** `projectExerciseCompact()` (`utils/exercise-set-specs.ts`) is the single input-side write helper — it writes `set_specs`/`video_url` verbatim and re-derives the compact trio via `compactFromSpecs` (counting non-warmup sets, clamped to the `training_exercises.sets` CHECK [1,20]). Clone sites splat the source row's columns instead of re-deriving. Editing goes through one pure kernel, `applySetSpecEdit()` (`utils/set-spec-edits.ts`), shared by the builder hook and the assistant's server executors: ≤30 specs, ≤20 drops/set, never all-warmup, and deleting the last set reverts `setSpecs` to `null` (never `[]`).

### Groups (migration 178)

**A session is an ordered list of groups; a group is an ordered list of exercises; every exercise sits in a group.** A group has a format — `straight_sets`, `circuit` (superset or circuit: a loop through its exercises, for its rounds), `amrap` (as many rounds as possible inside its time cap), `emom` (work starts on every interval's 0-second mark and what is left of the interval is rest; a round is one interval, so its rounds are its minutes — owner, 2026-09-19), `for_time` (a fixed amount of work, its rounds, as fast as possible, usually with a time cap) — and its settings: `rounds`, `time_cap_seconds`, `interval_seconds`, `rest_between_exercises_seconds`, `rest_between_rounds_seconds`, `notes`, each nullable. A lone exercise is a straight-sets group of one with every setting null. **The three timed formats run on a clock, and two of them score** (`utils/group-scores.ts`): an AMRAP's score is rounds plus extra reps; a For time's is its finish time, or the rounds and reps reached when the cap ran out, so the SHAPE says whether it was capped; an EMOM takes no score and logs its rows like any round-based group. A score is stored as that group's result on the workout's log: `session_log_group_scores` (migration 186), one row per scored group — `session_log_id` (cascade), `group_id` (the client group scored, SET NULL when it goes, as `exercise_logs.training_exercise_id`), `prescribed_group_snapshot` (the group's nine-key snapshot as logged, so a scored group whose exercises the client never ticked describes itself once the session is gone), and `rounds`, `reps`, `finish_seconds` under CHECKs that allow the two shapes on the two formats and nothing else; deny-all RLS, `service_role` only. Written only by `services/training-log-group-scores.ts` from the log writer (see "Logging a workout"); read beside the exercise logs on both detail payloads (`TrainingEventDetail.groupScores`, `SessionLogDetail.groupScores`). A coach makes a timed group in the session editor from one exercise or more (see "Building groups"). The settings each format uses and needs are one table, `GROUP_FORMAT_SETTINGS` (`utils/exercise-groups.ts`): straight sets — rest between exercises, notes; a superset or circuit — rounds (needed), both rests, notes; an AMRAP — its time cap (needed), notes; an EMOM — its interval and rounds (both needed), notes; a For time — rounds (needed), an optional time cap, both rests, notes. A group stores none of the others (`clearUnusedGroupSettings`), and every write schema refuses a group that carries one, lacks one it needs, or whose exercises have the wrong rows (`groupRuleIssue`, the one statement of the rules). The formats and the settings' bounds are `utils/exercise-groups.ts`, mirrored by the migration's CHECKs (rounds 1–100, time cap 1–14,400 s, interval 1–3,600 s, both rests 0–3,600 s, notes ≤1,000). The client's workout, their program page, the coach's workout log view and the builder's session editor and week grid show groups ("How a group reads" and "Building groups", below); every other screen lists a session's exercises in order, group by group (`sessionExercises`), and a library card or the calendar's library panel counts them — a superset of two is two exercises.

- **Two tables, mirroring the two tiers.** `coach_saved_exercise_groups (saved_session_id, order_index, …settings)` and `training_exercise_groups (session_id, order_index, …settings)`. A group's `order_index` is its place in its session; an exercise's `order_index` is its place in its group. An exercise keeps its session id, and its foreign key to its group is on `(group_id, session id)` → the group's `(id, session id)` (`coach_saved_exercises_group_fkey`, `training_exercises_group_fkey`, ON DELETE CASCADE), so an exercise can never sit in another session's group. Deny-all RLS; `service_role` holds ALL.
- **A client group has no soft-delete flag: it is read through its live exercises.** Every read of client exercises selects `EXERCISE_WITH_GROUP_COLUMNS` (`services/training-mappers.ts` — the row with its group embedded by the named foreign key) and nests the rows into ordered groups (`mapExerciseRowsToGroups`, over `nestRowsIntoGroups`, which orders groups by `(order_index, id)` and each group's exercises the same way). The tray's replace inserts new groups and exercises and retires the old exercises; the old groups stay with the retired rows that point at them, and nothing reads them again. The client's workout read (`getTrainingEventDetail`) returns the workout as groups (`TrainingEventDetail.groups`, over `asLiveGroups`) beside a session header that holds none, and the log's timed-group scores (`groupScores`, read beside the exercise logs); a logged exercise the live session no longer holds follows as the group its snapshot records (`snapshotGroup`, `utils/exercise-groups.ts`) — a snapshot exercise **named by the `training_exercise_id` its log is keyed to** (`ResolvedExercise`'s snapshot variant carries `trainingExerciseId`), so the client's form pairs it with its logged sets and shows it once, its reps, RPE and rest read off the snapshot's own snake_case keys — and a snapshot written before this migration, which records none, reads as a straight-sets group of one whose id is the exercise's own and whose place is the exercise's old place in the session — what the backfill made of the row. A library session is read with its groups embedded under it (`SAVED_SESSION_GROUPS_EMBED`, `lib/coach-mappers.ts`) and mapped by `mapSavedSessionTree`, which orders them the same way and drops a group row holding no exercise.
- **Every write goes through one row builder per tier.** Library: `savedGroupRowsFromInput` (an authoring write, compact columns re-projected through `projectExerciseCompact`) and `copySavedGroupRows` (a copy, every column as it is), written by `insertSavedGroupRows` (`services/coach-library-helpers.ts`). Client: `trainingGroupRowsFromInput` and `trainingGroupRowsFromCopy`, written by `insertTrainingGroupRows` (`services/training-group-writes.ts`). Group ids are minted before the write, so every exercise row names its group up front and no row is matched back from `RETURNING`; the groups land first, then the exercises, chunked. Positions are array places — no write input carries an exercise's position. The paths: the library save, create, duplicate and promote; standalone create and overwrite; saving a client's session to the library; placement (from the library and from an edited client draft); dropping a library session on the calendar; the tray's save; and Edit plan's function, which inserts each session day's groups and their exercises from its payload in one statement per day. `services/exercise-groups-survival.test.ts` proves each carries every group setting and position with each exercise's `prescribed_fields` and `set_specs` — and, through each path's real route schema, every one of the nineteen columns and every target key of a set spec (the validators strip unknown keys silently, so the matrix parses a maximal exercise first and hands the parsed body to the service; the copy paths read rows carrying it and must write it verbatim).
- **The builder draft holds groups** (`SessionDraft.groups: ExerciseGroupDraft[]`), and every group edit — the coach's and the assistant's — is made by one pure module, `program-builder-groups.ts`. Four rules hold after every edit: **a straight-sets group of one is a plain exercise** with nothing set, while a timed group of one keeps its format and settings, because its clock and its score must stay in view; **where rounds are a setting — a superset or circuit, an EMOM, a For time — every exercise has exactly one row per round** (`setSpecCount`: its set specs, else its compact set count), so the group's rounds and each exercise's rows cannot disagree; **in an AMRAP every exercise has one row**, the work of a round, repeated until the cap; and **a group stores no setting its format doesn't use** (`GROUP_FORMAT_SETTINGS`). The edits keep them, `normalizeGroups` (run by `normalizeDraft` after every edit and on every seed) applies the first and last, and every write schema refuses a group that breaks any of them (`groupRuleIssue`, through `savedExerciseGroupsSchema` / `bulkExerciseGroupsSchema`, `lib/validations/training.ts`, which also require at least one exercise per group, a format, and at most 50 exercises across a session's groups). A picked exercise joins as a plain exercise, and every serializer emits `groups` (`groupDraftToInput`).
- **Building groups** — the session editor, the same in the builder's session sheet, the new-session slide-over, the calendar tray and the standalone workout editor, on every builder target (`session-exercises.tsx`, `exercise-group-block.tsx`, `group-settings-popover.tsx`). A lone exercise is its card; a linked group sits under the heading every screen shares (`GroupHeadingLines`) with its cards on one rail; exercises are numbered straight through the session. **Link**, on the Exercises rail, picks exercises — any of them, lone or linked — and makes them one new group where the first of them was, in session order, in the format the coach chooses: a superset (two) or circuit (three or more), or an AMRAP, EMOM or For time, which take one exercise or more (`linkExercises`). Where rounds are a setting the group takes as many as the exercise with the most sets (the others gain copies of their last set); an AMRAP fits every exercise to one row. A new AMRAP starts with a 10-minute cap and a new EMOM at every minute (`DEFAULT_AMRAP_TIME_CAP_SECONDS`, `DEFAULT_EMOM_INTERVAL_SECONDS`), with no rests or notes; an exercise taken from a group leaves it. **Unlink**, on the heading, makes every exercise plain in place, keeping its sets, and returns a timed group of one to a plain exercise (`unlinkGroup`). **The heading's settings** (`updateGroup`, `group-settings-popover.tsx`): the format, a dropdown of Superset or Circuit (from two exercises), Straight sets, AMRAP, EMOM and For time; then the rows that format uses — rounds (1–30, the per-exercise row limit), a time cap and an interval typed as minutes or m:ss and read back as m:ss (`commitDuration`, stored as seconds), rest between exercises, rest between rounds — and notes. Changing rounds adds a copy of every exercise's last set or removes every exercise's last set, through the per-set kernel (`applySetSpecEdit`), so a refusal (an exercise left with only warm-ups) is its sentence in a toast; switching format keeps the exercises and the settings the new format uses — to straight sets every set, to an AMRAP one row each and a 10-minute cap unless one is set, to an EMOM the rounds and every minute unless an interval is set, to a For time the rounds — and a setting the format doesn't use is refused in the format's words (`GROUP_RULE_WORDS`). **The heading's Columns menu** offers the column presets alone, and a pick sets every exercise in the group (`columnsPreset`, on the same group patch, so a format switch and a preset land in one edit), each keeping its own Rest choice where the rows are rounds. Where the rows are rounds — a superset or circuit, or a timed group of any size — an exercise's grid heads its rows Round, adds or removes no row, and shows no Rest column, because the group's rests are what the client gets — its own rests and its Rest column choice stay stored; in an AMRAP the one row is the work of a round. **Dragging** (`exercise-drop.ts`): the dragged card or group stays in its place while a copy follows the pointer (a `DragOverlay` portaled to `<body>`, mounted only during the drag, `exercise-drag-copy.tsx`), and a line shows where it will land — inside a group's rail it joins that group there and takes the rows its format asks for — the group's rounds, one row in an AMRAP; anywhere else it stands alone (`moveExercise`); a heading's grip drags the whole group (`moveGroup`). The plan editor's lock checks wrap every group edit (`use-locked-mutators.ts`). The week grid's day cell joins a group's lines on the same rail — a timed group's under its heading, "AMRAP · 12m" — and reads an exercise's rounds where its rows are rounds, "3×8-10", or "21-15-9" when rounds differ, an AMRAP's the reps of its one round (`formatRoundRepsShort`, `formatRoundRepsOnce`). Duplicate-with-progression walks groups: Load and Reps change each round as they change sets, and Sets adds or removes rounds for a whole superset, circuit, EMOM or For time when any exercise in it is included (`progressGroupRounds`); an AMRAP's rows never change.
- **The assistant builds them with the coach's rules.** Its draft snapshot schema carries every group with its settings, so a session it copies or places from the server's working copy is built from groups the schema kept. Its group ops — `link_exercises`, `move_exercise`, `move_group`, `update_group` — make their edits through `program-builder-groups.ts` inside `applyDraftOp`, each carrying the uid any new group takes and the landing place resolved on the server, so the client's replay repeats them exactly; `update_exercise` skips a change to how many sets an exercise has where its rows are its group's rounds. Its tools are the coach's gestures: `link_exercises` in any format (`superset_or_circuit`, `straight_sets`, `amrap`, `emom`, `for_time` — a timed group from one exercise or more, its cap or interval in the same call), `add_to_group`, `unlink_exercises` (a group's first exercise goes just before the group, any other just after; a timed group of one becomes a plain exercise in place), `move_group` and `update_group` (the format and every setting the format uses, refusing the others); `reorder_exercise` keeps an exercise inside its group, never moves a standalone exercise into one (it goes to the first group boundary at or after the position asked), and reports where the exercise landed; `set_exercise_sets` on an exercise whose rows are rounds takes exactly its rounds, one set in an AMRAP. Its system prompt states the formats' rules in the coach's words, and its program state prints every group that reads as a group — a timed group of one included — under its heading. `add_exercise` carries a fully materialized straight-sets group of one with a server-minted uid, and its exercise patch schema is strict and names no group field. Positions it speaks count a session's exercises straight through, and the program state it reads prints a linked group's heading, in the words every screen uses, above its exercises.
- **The library save stays several separate writes.** The new session rows together, each id minted before the write (chunked), then every session's groups together and every session's exercises together (chunked), then the old sessions' delete (chunked by id) and the plan row. A failure at any of the inserts rolls the new sessions back, their groups and exercises with them, and the old program stands; a process killed mid-save leaves new sessions — some possibly holding groups with no exercises, which the reader drops — beside the old ones, the duplicates a re-save clears.
- **How a group reads** — one set of rules for every screen that shows groups (`utils/exercise-group-display.ts`; `CLIENT-APP-REFERENCE.md` states them for React Native). A straight-sets group of one is a plain exercise, exactly as before groups existed. A linked group — two or more exercises — and a timed group of any size read as a group (`readsAsGroup`: a timed group of one keeps its cap, its timer and its score in view), known by the format's name and never by a letter (owner, 2026-09-16): Superset for a looped pair, Circuit for three or more, Straight sets, AMRAP, EMOM, For time (`groupName`). It sits under one heading with its rounds (every format but straight sets), its clock — an AMRAP's cap "AMRAP · 12m", a For time's "For time · 3 rounds · 12m cap", an EMOM's interval "EMOM · 8 rounds · every 1m" (`timing`, absent where the coach set none) — its rests ("30s rest between exercises · 1m 30s rest between rounds"; 0 reads "No rest between …", and a rest the coach didn't set isn't mentioned) and its notes (`groupHeading`). A timed group's score reads in one grammar everywhere (`formatGroupScore`): "7 rounds + 12 reps" (an AMRAP; "7 rounds" when no extra reps), "Finished in 8:32" (a For time, the duration readout), "Capped · 2 rounds + 15 reps" (a For time that ran out of time). In every format but straight sets a linked group loops through its exercises, so each exercise's rows are its rounds: the column reads Round, the line under an exercise reads its reps round by round ("21-15-9 reps", `formatRoundReps`) rather than a set count and its own rest, and the client adds a round rather than a set; in an AMRAP every exercise has one row, the work of one round, repeated until the cap. The rest after a row (`restAfterGroupedRow`): where rows are rounds, the rest between exercises after a row of any exercise but the last, the rest between rounds after a row of the last, and nothing after the final round — an exercise's own per-set rest is not used, and its Rest column gates only its own rests; in a linked straight-sets group, the exercise's own rests between its sets and the rest between exercises after its last set. Letters, names and rests are derived at read and stored nowhere. Logging is untouched: a round is a row of its exercise (see "Workout logging (per-set completion)").

### Program authoring surface (`/dashboard/programs`)

All training authoring lives here. `/dashboard/training-library`, `/dashboard/programs/sessions` and `/dashboard/programs/exercises` are `redirect("/dashboard/programs")` stubs kept so old links resolve (the client portal keeps one twin of the same shape: `app/client/progress/page.tsx` → `/client/metrics`) — the Sessions and Exercises libraries live in the builder's tabbed `builder-library-panel.tsx`.

- `layout.tsx` wraps the section in `ProgramsShell`; `page.tsx` is the library table (drafts surfaced with a Draft badge; browse/duplicate/delete only — no apply-to-client here).
- `[savedPlanId]/layout.tsx` mounts `ProgramDraftProvider key={savedPlanId}` with a `{children}{modal}` parallel-route pair, so **program state is owned by the route layout, not the page** — the intercepted `@modal/(.)sessions/new` slide-over mutates the same tree.
- The builder is a weeks × **Day 1–7** grid inside one `DndContext` (`MAX_WEEKS = 52`). Days are **positional, not weekdays** — nothing writes `day_of_week`. A day holds its sessions, in order, or is rest; there is no third state. The day cell stacks one card per session, each opened, edited, dragged and removed on its own, on every target. **Building a day's sessions** (`program-builder-model.ts` — `addSessionToDay`, `moveSessionToDay`, `reorderSessionInDay` — shared by the coach's gestures and the assistant's ops): a session added to a day — from a rest cell, from a card's **Add session** (every card of a day with room), from the create-blank slide-over or from a library session dropped on the day — joins it, last; a session dragged onto another day joins that day, last, and the day it left keeps its others; dragged over its own day, a line between the day's cards shows the place it takes, and the drop moves it there (`use-program-dnd.ts`: the cards are `day-session` droppables for that place alone, and a drop that would change nothing draws no line). A day holds at most `MAX_SESSIONS_PER_DAY` (20): a full day offers no Add session and takes no drop. The plan editor's day rule wraps each of these (`use-locked-mutators.ts`).
- One component tree, three `target` modes: `library` (this route), `client-draft` (remounted full-screen inside the client Training drawer; Save/Delete hidden, "Apply to client" shown, program/session name+focus locked as template identity), and `placed-plan` (the plan editor over a client's plan as it is laid on the calendar — locked and greyed days refused, identity editable, saved through the plan editor's PUT; see "Edit plan"). Apply is wired **through the provider** (`use-client-apply.ts`) — `onApply` is not a prop.

### Authoring + save pipeline

1. `POST /api/training/saved-plans` creates a `status='draft'` row; the coach edits it in the builder. Draft state is seeded ONCE from SWR — refreshes are deliberate no-ops so a revalidation can't clobber unsaved edits.
2. **Save is a 3-step, non-atomic pipeline** (`use-program-save.ts`): client-side zod belt → `POST …/overwrite` (whole tree, each session with its groups and their exercises; the new sessions are inserted before the old ones are deleted — see "Groups" for what a failure partway leaves) → `PATCH` for `programDurationWeeks` (overwrite never writes it) → if still a draft, `POST …/promote`. Promote is called with **no `saveSessionsIndividually` flag** — a pure status flip, no standalone session copies. A **409 from promote means the content COMMITTED** and only the name collides; never report it as "nothing saved". Because the pipeline is non-atomic, the in-memory draft is the only full copy until success and is never discarded on error.
3. Placement creates fresh client-side rows — `training_plans`, `training_sessions`, `training_exercises`, `training_events`. Library templates are never referenced live; each placement is a copy.
4. `training_plans.saved_plan_id` (nullable, SET NULL) records provenance **only for `type:"plan"` placements**. Every apply-with-edits places `type:"inline"` with `saved_plan_id = NULL` (an edited copy is a copy of no single template). **Do not reason about "which template is this client on" from `saved_plan_id`** — it is NULL for the dominant path.

### AI program assistant (`services/assistant/`, builder S6a)

A chat assistant docked in the program builder executes natural-language edits on the coach's draft ("duplicate week 1 twelve times, week 6 a deload, +5% bench each week"). Its shape is **unlike every other AI feature here** — one-shot generation writes to the DB; this writes nothing.

**The turn.** The draft lives only in browser memory (`ProgramDraftProvider`). Each turn POSTs `{command, text-only transcript, full draft snapshot}` to `POST /api/training/assistant`. The route runs an Anthropic tool loop over a **per-request workspace** (validated snapshot + the coach's catalog, fetched once) and returns `{assistantText, ops, skipped, stopReason}`. **The server performs no database write anywhere in a turn** — the entire blast radius of a bad turn is the returned op list, which the client re-validates before applying. There is no server-side draft state between turns; each turn re-uploads, so mid-turn manual edits are automatically visible to the next command with nothing to reconcile.

**One shared mutation module.** Tool executors (server) and op replay (client) both go through `program-builder-ops.ts` (`applyDraftOp`). This is the load-bearing decision: the two sides cannot drift semantically, and replay runs through the provider's normal `apply()` path, so AI edits get identical dirty-tracking, revision-counter, save and inline-apply semantics to a hand edit. Ops are **uid-addressed with server-minted uids in fully-materialized payloads** — `applyDraftOp` never mints a uid, because a uid minted at replay time would differ from the server's copy and break every later op in the same turn. An op whose target uid vanished (the coach edited mid-turn) **skips with a reason**; it never clobbers.

**A day's sessions.** A day holds its sessions in order and can hold several, so every tool that addresses a session by week and day also takes its place on the day (`session`, 1 first); the program state prints a day's places only when it holds several (`D3 Run(1ex) + Lift(4ex)`). The tools follow the builder's rules (`program-builder-model.ts`, shared by the coach's gestures and the ops): `add_session` adds a session to any day, last (`place_session`; a replayed place carrying a uid the day holds skips); `move_session` moves one onto another day, where it joins, last; `reorder_session` changes a session's place in its day (`reorder_session`, clamped to the day by the tool); `remove_session` removes one session (destructive, previewed like `clear_slot`); `clear_day` clears every session on the day. A full day refuses a session with "A day holds at most 20 sessions". The snapshot carries at most 20 sessions a day.

**Targets.** `set_exercise_sets` and `update_exercise` write RPE and load as one value or a range (`rpe` / `rpeMax`, `loadKg` / `loadKgMax`, `loadPercent1rm` / `loadPercent1rmMax`; a range runs low to high), RPE 1–10 and tempo four phases in their schemas. `set_exercise_sets` refuses, with a sentence naming them, an exercise carrying targets it can't write — RIR and the endurance measures — rather than rebuilding its sets without them; `update_exercise`'s load keeps every other key of a set. The program state the model reads prints every target of every set in canonical units. **Columns.** `add_exercise` and `update_exercise` take `columns` (the exact list) or `columnsPreset` (a preset by name), through the same table and the same hidden-Rest rule as the coach's selector; `update_group` and `link_exercises` take `columnsPreset` for every exercise in the group; columns apply beside per-set programming, since they are the exercise's. A new exercise starts on its catalog type's preset — `search_exercises` prints each exercise's type — and one whose columns don't ask for reps starts with no rep range; `add_exercise`'s reply names the columns whenever they aren't the strength ones. The program state names an exercise's preset, or its columns, only when they aren't the strength ones.

**Four belts keep AI content out of the catalog.** Read-only resolution at the tool → non-null `exerciseId` required by the op schema → a pre-return sweep that discards the whole turn if an unresolved exercise leaks → client-side re-validation. Template identity in the client editor (program/session name + focus) is likewise enforced per-tool, inside `applyDraftOp`, and by a final diff sweep — a bulk tool cannot bypass it.

**Scope boundary (owner decision, 2026-07-21 — load-bearing, not incidental).** The assistant reads and edits **only the program open in the builder**. It never reads client logs, session history, body metrics, or check-ins, and it never writes to the database. That keeps the feature simple for launch, and it is also what makes the concurrency invariant below unreachable: with the exercise catalog preloaded once per turn, no tool has anything to `await`. **A tool that needs a DB read would cross this line** — the tempting ones being "what did this client lift last week" or "use their current 1RM" — and cannot simply be added. Either serialize tool execution at the composition point first, or keep the new tool synchronous by preloading its data into the workspace the way the catalog is.

**Two silent-failure invariants.** (1) The cacheable tools+system prefix must stay above the model's prompt-cache floor (4096 tokens on Opus 4.8); below it the API caches nothing with **no error** — cost rises and no test fails. `prompt-size.test.ts` guards the size; the telemetry's `cacheEngaged` flag is the live check. (2) Tool `run` bodies must stay **synchronous**: the SDK executes a response's tool calls via `Promise.all` and the prompt encourages batching, which is safe only because a sync body gives the event loop no interleave point while mutating the shared workspace.

Latency is `iterations x round-trip`, so the levers are structural (fewer round trips: front-loaded program context, batched parallel tool calls, tools expressive enough to avoid one-call-per-week) before they are model choice. Every turn logs `assistant_turn` telemetry; read it before optimising.

**Operational surface.** Guards run in order: CSRF → `getAuthenticatedCoachId(request)` → `assistantRateLimit(request, coachId)` (a dedicated tier, 20 req / 5 min, coach-keyed) → zod `safeParse` → when `clientId` is present, an IDOR ownership check. The request body carries `{ command, transcript, draft snapshot, target }`; `clientId` is **required** for both client-scoped targets (`client-draft`, `placed-plan`), and `placed-plan` additionally requires `planId` (route-verified as belonging to that client — a plan-read for authorization only, still zero DB writes in a turn) plus the editable days as positions, `editableDays: { from, through }` (see "Edit plan"). Caps: command 1..2000 chars, transcript ≤24 messages × ≤4000 chars. The assistant's state — the chat, whether its panel is open, the command being typed — is owned once by `AssistantProvider`, which `ProgramDraftProvider` mounts inside itself, so it lives and dies with the draft and sits above every host of the panel: the builder page, the route's create-session slide-over (the `@modal` slot beside the page) and the client-draft and plan-editor mounts. The panel is hosted by whichever surface is on top: the corner dock over the grid (`assistant-dock.tsx`, portaled to the body), or a sheet over the builder that edits the program — the session sheet while a session is open (`session-editor-sheet.tsx`) and the "Create blank session" slide-over (`create-session-slide-over.tsx`) — as a child of the sheet's own content, so the modal sheet's pointer-events, focus, screen-reader and scroll rules include it by construction: no layer of its own, and nothing exempted from the sheet's outside-click. Both sheets take the one shape in `assistant/sheet-assistant-host.tsx`: the Assistant button first in the footer opens the same panel, and Escape belongs to whatever it was pressed in — inside the panel it collapses the panel (the panel's own key handler; the sheet's `onEscapeKeyDown` declines a key pressed in it), anywhere else in the sheet it closes the sheet. The corner chip hides while any sheet is over the builder, derived in `program-builder.tsx` from each sheet's one owner — the session sheet's subject, the create slide-over's address (`create-session-route.ts`, the one spelling of that path) and the library panel's session editor's subject, which the builder owns for that reason. The library's New session / Edit session sheet (`StandaloneSessionEditor`) offers no assistant, because it edits a library session and the assistant edits only the program. The transcript, a pending preview and a half-typed command survive a sheet opening or closing and the panel collapsing; a hosting sheet's content is a still frame with no entrance of its own — transparent, the body inside it carrying the look, the slide-in and the sheet's close — so the panel, anchored to the frame, holds its corner while the sheet slides in beneath it; on a close it is already back in the corner under the leaving sheet, whose slide-out stays on the content (the create slide-over, closed by its address, leaves at once). A pick in the session editor's add-exercise popover toasts "Exercise added" with the name, and the popover stays open for the next pick. Env: `ANTHROPIC_API_KEY`, plus optional `ASSISTANT_MODEL` (default `claude-opus-4-8`), `ASSISTANT_EFFORT`, `ASSISTANT_THINKING`.

**Deployment prerequisite — this route needs a >240s function timeout.** `app/api/training/assistant/route.ts` exports `maxDuration = 300`, deliberately above the SDK client's 240s timeout so a long turn fails as a handled SDK timeout rather than an opaque platform kill. There is **no `vercel.json` in the repo**, so nothing declares this to a host. Any platform capping functions below that (Vercel Hobby is 60s) will kill long turns mid-flight, and it presents to the coach as "the assistant is broken", not as a timeout. Raising either number means raising both. This has never been exercised against a real platform ceiling — the longest recorded turn ran locally.

**A turn is buffered end-to-end** — there is no streaming or per-op live apply, so a slow turn and a hung turn look identical to the coach.

### Whole-program placement (the date-walk)

**The program fills its block** — a sequential date-walk, not a weekday map. `placePlaceablePlanOnCalendar` (`services/library-placement-service.ts`) reads the program's rows as its days (`programDays`, `utils/program-days.ts`: ALL days across ALL weeks in `(week_index, order_index)` order, each holding its sessions in `day_order`, a rest day holding none), then:

1. **Computes the window first** — `resolvePlacementWindowEnd()` (`services/program-event-walk.ts`): **the last day of the block covering the start date** when one covers it (`getBlockBoundForDate` answering `covering`), else `max(1, days)` days (one pass of the authored program) capped at the day before the NEXT block when the start is in a gap (`getBlockBoundForDate` answering `next` — a cap, never a length, so a program placed in a gap stops at a block the coach has not set up rather than filling the gap or running into the block); either way **capped, never stretched**, by `getNextPlanStartCap` (the start of the next coexisting plan). **The block is the length knob**, so a program shorter than its block repeats to fill it and a longer one is cut at the block's end. A placement on a day no block covers and no block follows is unchanged from before blocks bounded anything.
   > The window is decided here and stored on the row (`effective_until`, migration 167); nothing derives an existing program's end from its rows. `resolveWindowCap` (same module) is the one bound placement and the plan editor share: the covering block's end, else the day before the next block, either capped at the next plan.
2. **Expands to the window, then clones EVERY day — training and rest.** `expandProgramToWindow` repeats the authored program's days until they cover the window and cuts a final partial cycle mid-program; each cycle's `weekIndex` is offset by the authored program's own week span so `(week_index, order_index)` keeps climbing, and a single pass is byte-identical to the authored program. **Cloned, never shared** — every cycle gets its own `training_sessions` rows, so cycle three can be progressed past cycle one; sharing would make one edit rewrite every cycle at once. A training day clones one row per session at its place in the day (`day_order`, renumbered 0 first from the program's order); a rest day clones its one rest row. Rows carry `day_of_week: null`, `week_index`, `is_rest`; rest rows are forced to name "Rest", null focus, null surplus, and carry no exercises. Groups and their exercises clone only for sessions, in order, every group setting and exercise column (`set_specs`, `video_url`, `prescribed_fields`) carried verbatim (`trainingGroupRowsFromCopy`).
   > **The inserts are BATCHED and chunked**, because a one-week program in a 52-week block is 364 days — more rows when its days hold several sessions — and a round trip each would take the placement past any request budget. Every session row's id is **minted before the write**, so its groups, its exercises and its calendar event name it up front and nothing is matched back from `RETURNING` — Postgres does not promise `RETURNING` follows the `VALUES` order, and a day's sessions share their coordinate, so no coordinate could tell them apart.
   >
   > `training_plans.program_duration_weeks` records the **placed** length, not the authored one — the Overview's plan chip derives its "Ended" date from that column and would otherwise contradict the calendar. `frequency_per_week` is the program's sessions per week, from its own rows.
3. `generateProgramEvents` walks calendar dates start→end mapping each date to the next placed day: **each of the day's sessions becomes an event on the date at its place (`day_order`), and a rest day advances the walk but emits no `training_event`.** The upsert is `onConflict: (client_id, training_session_id, date), ignoreDuplicates: true`, so re-placing the same window is idempotent. Per-event surplus = session override ?? plan default.

> **A logged day's prescription is frozen.** An assertion in `services/training-session-lock.ts`, `assertSessionUnlogged`, throws `SessionLoggedError` when ANY `training_event` linked to a session has left `status = 'scheduled'`. It is called INSIDE `replaceSessionFull` — after it has proved the session belongs to the client, so a foreign `sessionId` still reads as not found rather than as locked — and the tray's save route translates it to a **409** carrying the service's own message, which names the day. Without it the save rewrites the `training_exercises` rows the client's `exercise_logs` point at — `bulkReplaceExercises` soft-deletes and replaces them outright — so the logged session renders its exercises twice and a full workout reads as `partial`, because `completion_quality` is server-derived. **The predicate is `status !== "scheduled"`, deliberately the same one `program-builder-lock-model.ts:63` applies to a plan-builder slot.** Three places spell it: that line, the assertion, and the tray's own gate (`use-placed-session-editor.ts`, which cannot import the service module — it reaches `supabaseAdmin`). The tray opens a locked day read-only (`SessionEditorBody mode="view"`, the same treatment `program-builder.tsx` gives a locked slot) with Save hidden rather than disabled, so a coach sees the lock instead of a save that 409s. `replaceSessionFull` is the only path that rewrites a placed session's exercises.
>
> **A program cannot start on a day the client has already trained.** `POST …/place-from-library` (plan and inline branches) refuses a start before the deletion floor — the client's today, or tomorrow once they have logged a workout today (`resolveEventDeletionFloor`, see "The deletion floor"); a meal logged today moves nothing — with a 400 naming the client, the day they logged and the first day a plan can start, after the same past-date guard judged against the client's local today. `ApplyToClientDialog` floors its picker on the same value (`planStartFloor`, on the blocks payload; the timezone-derived today stands in until it lands), opens on it — or, with a block chosen in the Block field above it, fixed and disabled on that block's first available day (see "Journey blocks") — and says why today is greyed under the field. There is no override: the earlier warn-and-override placed the program's first session beside the one the client had logged that day, and the check-in counted the pair as a missed session.


> **Load-bearing invariant — every day is materialized; empty === rest.** The date-walk relies on every authored week being seven days, each its session rows or one rest row. A missing or implicit rest row collapses the week to fewer than 7 days and slides every later date. This is why the builder has no "empty" cell state and why placement clones rest rows it will never emit an event for.

The placed rows describe themselves — nothing but the session rows drives the walk.

### Atomic placement (additive — migration 114)
`create_training_plan_atomic()` (the 22-arg signature since migration 133, restated with the window model by migration 168) inserts the new plan in one transaction as a **coexisting placement** (`status='active'`, `effective_until = p_window_end`, which it requires). Placement is **additive on the past and supersedes the future**: inside the transaction it caps every earlier live program that still reaches the start at the day before it, archives a live program starting on the same day, raises when a later live program sits inside the requested window (a race — the service capped the window at the next plan before calling), and deletes only **future `scheduled` events within the incoming plan's own date window** (`GREATEST(effective_from, today) … p_window_end`) so the freshly generated events have empty slots to land in. After the commit the service removes the earlier programs' scheduled days from the start onward (`cancelFutureEventsForPlans`, logged days detached); a failure there is a `PlacementSupersedeError` the route returns as a 500 carrying its own sentence, never a rollback. Before the RPC the service snapshots the earlier programs' ends and statuses beside the window's events, so a failed clone restores both. Every generated event keeps carrying `calorie_surplus_percentage` (a nutrition day reads it off the event).

### Edit plan

The coach edits a client's plan as it is laid on the calendar: the shared Program builder mounts full-screen (`ProgramDraftProvider target="placed-plan"`, `components/clients/training/builder/plan-editor-overlay.tsx`), and whatever the coach leaves in it becomes the plan from the first day that can still change.

- **Ways in.** The Plans pane hero's "Edit plan" (the plan the hero shows, running or queued) and a Journey block card's "edit plan" on a running or planned headline. The editor is a place, `?plan=<planId>`, owned by the Training tab's host (`training-plan-builder.tsx`): opening pushes, the arrow pops, a save completes the entry — back to the block when a card opened it (`useJourneyReturnBlock`, `journeyPlanTripParams`). An ended plan is not opened: the read refuses it.
- **The read** — `GET /api/clients/[id]/training/[planId]/edit` (`services/plan-edit-service.ts`; `hooks/use-plan-edit.ts`, read fresh on every open): one day per date from the plan's start to the end of its last whole week. A day holds every session on its date, in the day's order (`sessionsByDay`), each read through the row its event points at — whatever the coach or the client moved there — with the event's surplus and the event's id; a day with none is rest. It returns the first editable day (the deletion floor, never before the plan's start), the plan's limit (`resolveWindowCap`: the block covering its start, else the day before the next block, capped at the next plan) and a version — everything the editor was built from: the plan row's `updated_at` and every event from the first editable day on, with the rows they point at.
- **One date rule** (`program-builder-lock-model.ts`), by position from the plan's start: days before the first editable day are locked, days past the limit are greyed and can't hold a session, and today's slot is ringed. It is applied to the grid as it stands, so a week insert, duplicate or move that would push a session onto a greyed day is refused, Add week is disabled once the next week would start past the limit, and nothing re-dates a day of history. The grid, the dnd gates, the provider's guarded mutators (`use-locked-mutators.ts`) and the assistant's ops all ask it.
- **The save** — `PUT` the same path with the whole grid, day by day, each day its sessions in order (none = rest), and the version. Each session the editor opened from the calendar carries its event's id (`eventId`), from the map the seed made of the sessions it laid (`use-placed-plan-source.ts`); a copied or new session carries none. The server recomputes the first editable day and the limit (a change is a refusal), takes the grid's end capped at the limit (never before the day before the first editable day) as the new last day, and calls `edit_training_plan_atomic` (migrations 179, 180) — ONE transaction that locks the plan and its events and refuses (`stale:` → 409, the editor's "This plan changed while you were editing" dialog) when anything in the version changed, a day's order included. It then writes every day from the first editable day to the new last day: a fresh session row per session, at its place in the day (`day_order`), and one per rest day, each session's groups and their exercises in the order the grid holds them; on a day with sessions, a session KEEPS the scheduled event it was opened from while that event is still on the session's day (same id, so a client halfway through logging it keeps their entry), the day's other sessions take its remaining scheduled events in the day's order, and a session left over gets a new event; every event a day keeps takes its session's place as its `day_order`, and the day's events no session kept are deleted — as are a rest day's. A session saved as it was laid, on the event it was opened from — the same name, focus, notes, duration, surplus, and groups with their settings and exercises in order (`isSessionUnchanged`, `services/plan-edit-same-day.ts`, judged against the calendar the service re-reads over the days it writes, which the stale check proves is the one the editor opened) — keeps that event's `is_modified`; every other event it writes has none. Scheduled events after the new last day, up to the old one, are deleted; the plan's old rows from the first editable day on are retired unless an event or a session log still points at them; and the plan row takes its new end, name, focus, week count and frequency. It stays the same plan, and the editor opens again at once.
- **Identity is editable** (unlike `client-draft`): the plan's name and focus and every session's name.

The assistant works in the editor (`target: "placed-plan"`): the request carries `planId` (route-verified against the client) and `editableDays: { from, through }`; the server executors and the client replay apply the same rule to the draft as it stands, and a pre-return sweep discards a turn that changed a day of history or left a session on a greyed day.

### Moving a program's start

A coach who placed a program on the wrong day moves it rather than deleting it and customising it again. Under the program's name the Plans hero shows a line for it — "Starts <date>" ("Starts today" on its first day) with a pencil and a bin while it hasn't started, "Ends <date>" with a bin once it has — and "Next: <name>, starts <date>" with a pencil and a bin for the program that starts after it, whether the hero's program is running or queued (`components/clients/training/plan-hero-line.tsx`). A program has started once its start is before the deletion floor (see "The deletion floor"), so a program starting today swaps its Starts line for its Ends line once the client logs a workout. The bin is "Deleting one program from the Plans hero" below.

- **The picker** is a month calendar in a popover (`start-date-calendar.tsx`), Monday first, opening on the current start: the start filled, the client's today ringed, every day before the floor greyed and unreachable. Picking a day closes it and opens a confirm in the same click (`move-plan-dialog.tsx`: "Move Upper Lower?" — "It will start on Fri, 18 Sept, and every session moves 2 days later with it." — Cancel / Move program); picking the current start closes it and asks nothing. Cancel, Escape and a click outside move nothing.
- **The move** — `POST /api/clients/[id]/training/[planId]/move` `{ startsOn }` (full coach chain; audited as `training_plan.move`, dates only) → `moveTrainingPlanStart` (`services/training-plan-move-service.ts`) → `move_training_plan_atomic` (migrations 177, 179), one transaction: the program shifts by the same number of days — its start, its end and every calendar session dated between them, whichever plan row the session points at. A session keeps its id, the row it points at, its surplus and its edited mark; only its date changes, and on a day that already holds a session it lands after the sessions already there, keeping the order it held on its own day. The program keeps its length and gains no day it lost when it was placed. Its session rows stay as they are, because they count their days from the plan's start, and nothing on the nutrition track is written, because a day is computed from the sessions on its date.
- **Refusals** are checked inside the function, with the plan and every day it touches locked, and each reaches the coach as a 409 carrying one sentence: a program that has started (its start before the floor the service passes in, or one of its days logged since); a new start before the floor; another live program's window meeting the new dates ("That would overlap Strength."); the new dates crossing a block's start or end, because a block contains its plans ("That would run into the Peak block." / "That would take it past the end of the Build block."). Nothing is shortened or trimmed to fit. The live-window exclusion stays the backstop, read back as the overlap's sentence.
- **An open plan editor goes stale.** The move rewrites the plan row's `updated_at` and its sessions' dates, so an editor opened on the program before it refuses its save ("This plan changed while you were editing").
- **Refresh.** On success the nutrition calendar is invalidated and the Overview, the attention feed and the block facts are cleared; the training area — the calendar and the hero's plan read — revalidates in place. Move program spins, and the confirm can't be closed, until it has; then the confirm closes onto the new dates and "Program moved" is toasted. A refusal closes the confirm, refreshes nothing and toasts "Program not moved" with its sentence.

### Deleting one program from the Plans hero

Each program line's bin deletes that program alone; the calendar's Delete plan still ends every program at once (see "The deletion floor").

- **The confirm** (`delete-program-dialog.tsx`, the design system's destructive confirm) says what happens by the program's state: one that hasn't started — "Remove plan?" / "Removes Strength, 5 Oct – 18 Oct." / Remove plan; a running one — "End plan?" / "Ends Upper Lower. Its sessions from today onwards are removed." (from tomorrow once the client has logged a workout today) / End plan.
- **The delete** is the per-plan `DELETE /api/clients/[id]/training/[planId]`: a program that hasn't started is archived, a running one ends yesterday and keeps its past, and the program's own scheduled sessions from the deletion floor are removed — a session on a day the client has already logged stays. It takes the program's sessions by the program, not by its dates, so a session belonging to no program that sits inside its dates stays.
- **The hero owns the confirm**, rendered beside both of its frames, because the delete removes the line that asked for it. The button spins and the dialog can't be closed while the delete runs; on success the nutrition calendar is invalidated, the Overview, the feed and the block facts are cleared, and the training area revalidates in place — the confirm closes once it has, onto a hero that already shows the next program, and toasts `"Strength" removed` / `"Upper Lower" ended`. A failure toasts "Delete failed" and leaves the dialog open as the retry.

### Stale drafts
EL-1 (not currently in scope) specifies a cron that deletes draft plans older than 7 days. Until then abandoned drafts accumulate, but they are **no longer invisible**: the Programs library table surfaces them with a Draft badge (reads default to saved-only; `?status=all` / `includeDrafts` opts them in), so a coach can open or delete them. Only `status='saved'` plans can be placed by id — `placePlanOnCalendar` throws otherwise.

---

## Client Portal Architecture

The client portal at `/client` is a day-centric, event-driven interface: the client picks a date and sees that day's prescribed training, nutrition, wellness, and habits, then logs each independently. It mirrors the coach-side model (`training_events` as the source of truth for a date's session; a nutrition day computed from the version covering the date). The web app is a **test harness** for this surface; React Native is the real client, and the `/api/client/**` subset is the RN contract. Build to the contract, not the web rendering.

### Core principles

1. **Day-centric, URL-driven.** Home is `/client?date=YYYY-MM-DD` (today by default). Date lives in the URL so back/forward and deep links work. Prev/next via arrows + horizontal swipe on touch.
2. **Event-keyed, not session-keyed.** Training reads/writes key on `training_events.id`, not `training_session_id`. This fixes the edited-clone bleed that gave the check-in an ambiguous "sessions completed" count.
3. **Per-card independent saves.** No monolithic "Log Day" button. Each detail page saves only its own domain. The old Daily Pulse "lifted state / no auto-save / single atomic write" rule is retired.
4. **Spine writes preserved.** Wellness, nutrition, and habits still write to the `daily_logs` spine children so `daily_logs_full` (read by the attention feed and check-in context) stays intact.
5. **Render-ready payloads.** The API emits display-ready, locale-neutral data (ISO dates on the wire, server-side aggregation/summaries) and speaks **canonical kg/cm** — there is no per-record unit on the wire and no conversion at the API boundary. The client renders in the viewer's own unit at the presentation layer, through `utils/unit-conversions.ts` with the preference from `useUnits()`: `formatWeight` for body weight, `formatLoad` for a barbell load (it snaps to a loadable increment), `formatLength` for girths, `formatHeight` for height. See `CONVENTIONS.md §20 Units`. (The old `formatWeight(weightKg, unitPreference)` in `utils/nutrition-helpers.ts` is deleted, along with that module's other conversion helpers.)

### Page / navigation structure

A persistent bottom tab bar (`components/client-portal/nav/client-nav.tsx`, `ClientBottomTabBar`) has four tabs: **Home** (`/client`), **Metrics** (`/client/metrics`), **Program** (`/client/program`), **Content** (`/client/resources`). The top bar (`ClientTopBar`) holds the logo, a notifications dropdown, and an avatar menu → **Settings** (`/client/settings`) + Sign out. Layout in `app/client/layout.tsx` (also owns the `pending_intake` onboarding gate). Check-in is **not** a tab.

- **Home** (`app/client/page.tsx`): day-summary cards (training, nutrition, wellness, habits) and a check-in summary card. Training lists every session on the day, in the day's order, each opening its own workout.
- **Detail pages** (each fetches only its own data): `/client/training?date=X&eventId=Y`, `/client/nutrition?date=X`, `/client/wellness?date=X`, `/client/habits?date=X`. Back returns to home with the date preserved.
- **Metrics** (`/client/metrics`, `components/client-portal/metrics/metrics-hub.tsx`): progress hub — body metrics, habit progress + streaks, and trends.
- **Program** (`/client/program`): the client's current training plan + nutrition plan cards, with the **week view** above them (`components/client-portal/program/training-week-layout.tsx`): the current training week from `GET /api/client/training/week`; tap a session, then a day, to move it. A session put on a day that holds some joins it, after them, in the order the client moves them — the order the write lists them and the server lands them — so a swap is two moves, and any rearrangement can be saved. Save is ONE `POST /api/client/training/events/layout` carrying every changed session with the day it was read on, so a 409 (the week changed since it was read) shows the server's sentence with a Reload. The arithmetic — the week with unsaved moves applied and the write — is the pure `lib/week-layout.ts`; the component only renders and taps. Tap-to-move, no drag: the web app is the harness.
- **Check-in** (`/client/check-in`): reached from the Home check-in card (`components/client-portal/day/check-in-card-summary.tsx`) and from notifications (`actionUrl: "/client/check-in"`), not a bottom tab. The hub shows the submission form behind `getCheckInGate` (see "Check-in System") plus a newest-first history list drilling into `/client/check-in/[id]`. `unscheduled` and `not_due` each render their own refusal screen rather than the form.

### Data model

Reads/writes the existing day-keyed tables — no portal-specific schema:
- **Targets (read):** `training_events` (one row per session per date); nutrition targets computed per date from the covering version (see "The window is the row").
- **Daily-logs spine + children (write):** `daily_logs` → `wellness_logs`, `nutrition_logs`, `training_logs`, `daily_habit_logs`.
- **Training completion:** `training_logs` → `session_logs` → `exercise_logs` → `set_logs` (per-set actuals). `prescribed_session_snapshot` / `prescribed_exercise_snapshot` JSONB preserve history when plans change.

### Database access (which client, and why)

Portal services follow the Shape B default (CONVENTIONS §8): **`supabaseAdmin` with a caller-verified scope.** The `/api/client/**` routes resolve `clientId` through `requireClientAuth(request)` (`lib/require-client-auth.ts`, which keys on `clients.user_id = auth.uid()`) and pass only that authenticated id down; services filter on it with `.eq("client_id", clientId)`.

The one exception is `getClientForCurrentUser` (`services/client-portal-service.ts`), which genuinely needs the session: it resolves the caller's own row from `auth.getUser()` and has no `clientId` to scope by. It uses `createPortalClient` — a bare re-export of `createServerSupabaseClient` — and that alias is also used by `services/client-portal-progress.ts` (a consolidation candidate, see `TECHNICAL-DEBT.md`).

`getClientNutritionTargets` previously read `clients` / `nutrition_plans` / `nutrition_plan_daily_targets` through the session-scoped client too. Those three reads moved to `supabaseAdmin` (2026-07-30): the route layer had already proven the `clientId`, so the RLS gate was duplicating a check rather than adding one — and leaving it in place meant a future "standardise onto `supabaseAdmin`" refactor would have silently removed the *only* control on a function that fans out to three service-role readers. See `TECHNICAL-DEBT.md → Opened by the 2026-07-30 anon-path read trace`.

### API surface

**Reads:** `GET /api/client/day-summary?date=` (home payload `{ training[], nutrition, wellness, habits }`, `no-store`) · `GET /api/client/training/week?date=` (`ClientTrainingWeek`, `types/client-training-week.ts` — every session in the check-in-anchored week containing `date`, by date and each day's sessions in the day's order, each with a `state` of done / today / upcoming / missed derived against the client's today; a day can hold several, so a week can hold more than seven; `no-store`. Powers the session picker and the week view, and is exactly the set a layout write may touch) · `GET /api/client/training/events/[eventId]` · `GET /api/client/daily-logs/[date]/{wellness,nutrition}` · `GET /api/client/habits` + `GET /api/client/habits/logs` (habits are **not** under `/daily-logs/[date]`) · `GET /api/client/training-plan` (date-resolved; carries `state`/`startsOn`/`endsOn` — see "Client-side plan tier") + `GET /api/client/nutrition-plan` (Program tab) · `GET /api/client/journey` (Program tab's blocks; carries `currentBlockNotes: { blockId, notes[] } | null` — the coach-note visibility policy is enforced **here on the wire**, not in the renderer, so RN inherits it rather than re-deriving it; see "The two notes" above) · `GET /api/client/training/exercise-history` (bounded full return) · `GET /api/client/check-ins` (**keyset-default**, opaque base64url `{createdAt,id}` cursor via `lib/cursor.ts`; legacy `?offset=` opt-in).

**Writes:** `POST /api/client/training/events/[eventId]/log` (a list present replaces, an absent list leaves alone: `exercises` replaces the log's `exercise_logs` and their snapshots — an empty list clears them — and `groupScores` replaces the timed groups' scores; a payload with neither records the outcome alone; updates `training_events.status`; **400** when the payload records no work, or a score doesn't fit its group; **404** for a score naming a group outside the performed session) · `DELETE` the same path (**Clear log** — one transaction, the log and its rows gone and the workout back to `scheduled`; see "Logging a workout") · `POST /api/client/training/events/layout` (**client week layout** — `{ moves: [{ eventId, fromDate, toDate }] }`, 1–`MAX_WEEK_LAYOUT_MOVES` entries; a single move, a two-day swap and a whole-week rearrangement are the same request at different sizes, applied in one transaction by `move_training_events_atomic` (migrations 150, 179). Policy lives in `services/training-event-layout-service.ts`: only still-`scheduled` sessions move; each stays inside the training week it currently sits in; neither end of a move may fall in a week a check-in has closed (the same day rule the log writes obey). A session moved onto a day that holds some joins it after them, and several moved onto one day land in the order the list gives them (see "Several sessions a day"). `fromDate` is the drift check — a concurrent coach move answers 409 "your week changed", never a half-applied week. Nutrition follows the moved sessions on the next read: a day's target is computed from the sessions on it) · `PATCH /api/client/daily-logs/[date]/{wellness,nutrition}` (both ungated: a meal is refused only by the day rule, and a day no version covers saves with no stamp) · `POST /api/client/habits/log` (per-habit toggle for a date; ungated) · `PATCH /api/client/settings` (`unitPreference`, `timezone` — IANA-validated; `lib/validations/client.ts`. No `weight_unit`: that column is gone and was never accepted here anyway. `reminder_preferences` is a different endpoint. Reachable pre-activation — `getAuthenticatedClientId` gates on `clients.active`, not `onboarding_status` — which is what lets the intake form set a client's units before their coach activates them).

Every write resolves plan context once via `resolvePlanContextForDate(clientId, date)` to stamp the `*_plan_id` links, and enforces the closed-period lock server-side (see "Date-edit permissions").

### Workout logging (per-set completion)

**A tick means "I did this set", and it is the only thing that decides completion.** One mode, one primary button, and no outcome selector anywhere: an unticked row already says "not done", and the ticks answer what a selector would have asked (`components/client-portal/training/`):

- **The row list mirrors the flattened prescription.** `seedDefaultValues` builds it from `buildPrescribedRows`, reopening a logged session restores the FULL prescription with the logged rows ticked, and a **prescribed row cannot be deleted** — only rows the client appended past it. That is what makes a row's position its `setNumber` end to end. Sizing keeps both ends: a logged set past the prescription (an appended row, or a prescription the coach later shrank) survives the round trip, because the write path full-replaces and a row missing from the form is deleted on the next save.
- **Groups lay the blocks out and change nothing underneath** (`components/client-portal/training/tracker-exercise-list.tsx`). The form stays one flat list — the prescription group by group, then anything unplanned — so an exercise in a superset logs to its own entry and a round is that exercise's row: `setNumber` is still the row's place in the exercise's own flattened prescription, and completion counts its rows as it counts any exercise's. A group changes only what is on screen: a linked group's heading, Round for Set where its rows are rounds, and the rest timers (see "Groups" → "How a group reads").
- **One box per column the coach prescribes** (`utils/set-log-measures.ts`, owner 2026-09-18): the exercise's `prescribedFields` decide the boxes, in the columns' order, with the coach's target as each box's hint ("7–8", "100–105 kg", "3:45–3:50 /km"). Load's box is the weight box — what they lifted, hinted by the prescribed load, the header carrying the viewer's unit — so an exercise without Load has no weight box; set type stays the row's tag and rest the timer between rows. A box is typed in the client's own units and grammar and shows what it recorded when they leave it ("120" reads back "2:00:00", "5.2" reads "5.2 km"; `parseEntry` / `formatEntry`, `utils/unit-conversions.ts`); a box that can't be read keeps what was typed, and the save refuses with the box named and focused. When the boxes don't fit, the grid scrolls sideways with the tick and Set columns pinned.
- **A timed group shows its timer and its score boxes under its heading** (`timed-group-section.tsx`, `group-timer.tsx`): an AMRAP a countdown from its cap (Start / Pause / Reset, "Time" at zero) over Rounds and Reps; an EMOM the interval cue alone ("Minute 3 of 8", the seconds left in it; an interval that isn't a minute reads "Interval"), its rows logged like a circuit's; a For time a stopwatch to a tenth with its cap beside it (Start / Stop / Reset, "Use this time" puts the time in the box) over a Finish time box typed as a duration ("8:32", "8:32.5"), which "Didn't finish" swaps for Rounds and Reps and "Finished" swaps back. Entering a score ticks no rows; the rows still take ticks and values, optional. The score is its own entry in the form (`groupScores`, one per group that takes a score, by group id), parsed on save (`parseGroupScore`: whole numbers within their limits, or a duration within a day to a tenth; a box that can't be read, or one of a pair left empty, is marked and focused with the group named). A finish time reads back at its stored tenth, so it needs no seed. **A group that takes a score is done by its score** (owner, 2026-09-19; `ScoredGroup`, `utils/completion-quality.ts`): an AMRAP once its score is entered; a For time in full when a finish time is entered, while a capped one — rounds and reps — makes the workout Partial, because the prescribed work was not all done; an AMRAP or For time left unscored makes the workout Partial whatever its rows say. Its rows are optional detail outside the "N of M working sets" count, on the live prescription and on the snapshot fallback alike. An EMOM's rows count like a circuit's, so an EMOM stopped early is Partial. The client's outcome line says it before they save — "2 of 2 groups scored · 1 group capped · 6 of 6 working sets logged. Will be recorded as partial." (the groups part only where the workout has a scoring group, the capped part only when a For time was capped, the sets part only where anything counts) — and the server derives the same verdict (`deriveCompletionQuality`, the exercises' rows beside the scoring groups), judging the scores the log holds after the save: the payload's list, or the stored rows when the payload leaves the list out.
- **Values are optional detail on top.** Entering any value and leaving the box auto-ticks the row (so a client recording numbers never touches a tick), copying a previous set copies every box and banks the row, and a **ticked set with every box empty is still sent** — doing the work is the claim. An exercise-level tick banks one exercise; "Mark all complete" banks the session. **Every box carries the canonical value it was seeded from beside its string** (`SetRowValues.seeds`), and an untouched box resubmits that seed byte-identical while a dirty one is parsed from what is in it — the weight rule of CONVENTIONS §20, applied per box, never per row. Reopening a logged workout restores every value the log carries into its seed, box on screen or not (a column the coach has since stopped prescribing, the rest the React Native app's timer recorded), so a save — which full-replaces the log's sets — never erases one.
- **The payload carries exactly the ticked sets**, each with its 1-based `setNumber` into the flattened prescription. An unticked set is absent; an exercise with no ticks is absent entirely. `exercise_logs.completed` is vestigial — `true` for any exercise that reached the payload.
- **Warm-ups are recorded but never scored.** They render, are tickable, and are written to `set_logs` with `set_type: 'warmup'` so a coach investigating an injury can see them — and they are excluded from `full`, from the client's own outcome line, and from every performance metric.
- **The client is told what will be recorded before it is**, on one line above the button ("9 of 12 working sets logged. Will be recorded as partial."). It and the server's verdict come from one module (`utils/completion-quality.ts`), because that sentence is a promise about the coach's adherence number.
- Save is a single bulk-replace (no per-set auto-save, no draft persistence, no `localStorage`). The web form is the harness; the RN app keeps the in-progress workout in device storage and POSTs once. **Live coach visibility mid-workout is explicitly not a feature.**

### Logging a workout: a save records something, and Clear log undoes it

**There is no skip.** A workout is logged or it is not, and a client who did not train logs nothing — the workout reads missed once its day has passed. Two rules carry that, and both are the client's to see before the server says it:

- **A save that records no work is refused**, with one sentence: *"Tick at least one set to log this workout."* The rule is `trainingLogRecordsWork` (`lib/training-log-content.ts`, pure and client-safe): the form holds its button and prints the sentence in place of the outcome line, and `logTrainingEvent` throws `EmptyTrainingLogError` → **400** carrying the same words. Its sources are a LIST — a set, whatever it carries (a tick alone, or any of its measures: the client's boxes tick a row the moment any value is entered, and a set on the wire IS a set that was done), and a timed group's score (§4.7 amendment 1) — so a later source joins the list rather than rewriting the rule. On a workout that holds a timed group the form's sentence is "Tick a set or enter a score to log this workout."; the server keeps the one above. `POST /api/client/training/events/[eventId]/log` accepts `completionQuality` of `full` or `partial` and nothing else, on every path including the React Native quick one.
- **Clear log** is "I did not do this after all": `DELETE /api/client/training/events/[eventId]/log` → `clearTrainingEventLog` → `clear_training_event_log` (migration 181), ONE transaction that deletes the log keyed to the workout — its `exercise_logs` cascade, their `set_logs` with them — and puts the event back to `scheduled` with no link. It is allowed **exactly where the day-edit rule allows editing** (see "Date-edit permissions"), the same `assertCanEdit` the log write obeys, so a week a check-in has closed keeps its shape; a foreign or missing workout is 404, and clearing a workout that carries no log is `{ cleared: false }`, not an error. Clearing also unfreezes the day for the coach, because `assertSessionUnlogged` keys on the event's status. On the web the action is on the workout screen, behind a destructive confirm, whenever the workout has a log and its day is open.

**A save replaces exactly what it carries — a list that is present replaces, an absent list leaves things alone, for `exercises` and `groupScores` alike.** A payload with an `exercises` list full-replaces the log's exercise rows, an empty list clearing them (a client who unticks every row and keeps a score has the sets go); a payload without the key records the outcome and the note and touches no exercise row. That is what keeps the check-in's fill-gap row — which posts `{completionQuality, notes}` alone — from erasing sets the client already logged; the replace had nothing to put back, and the unconditional DELETE wiped them. The scores follow the same rule: a `groupScores` list replaces the log's score rows (an empty list clears them), an absent key leaves them; each score is judged before anything is written — its group must be in the performed session's prescription (client-scoped, so a foreign id is 404 like a foreign exercise id) or already scored on this log (the snapshot fallback once the session is gone), and its shape must be one the format takes (`InvalidGroupScoreError` → **400** with its sentence: "Only an AMRAP or For time group takes a score.", "An AMRAP's score is rounds and reps.", "A score is a finish time, or rounds and reps."). The score rows are written after the exercise rows and before the event link, two statements like the exercise replace; a failure between them leaves the log with its sets and no scores, and the client's retry recovers through the unique-conflict path. The web form always sends both lists; the check-in's row and any quick path send neither.

### Alternative-session handling

A client trains on a day other than prescribed by **moving the session there first** (owner decision 2026-08-26): the rest-day "Log a session" picker lists this week's still-to-do sessions (`GET /api/client/training/week`) and a pick moves the chosen one onto that day and opens it (`POST /api/client/training/events/layout`); on a prescribed, unlogged day "Do a different session" swaps the two days, or opens a session already on the same day. Any other rearrangement — "I'll do Thursday's session on Saturday" — is the Program tab's week view (`lib/week-layout.ts`), the same write at whole-week size. The write is `logTrainingEvent` in every case — there is no event-less writer — so every `session_log` is event-keyed and dated to its event. Snapshots: `prescribed_session_snapshot` from the event's session; `prescribed_exercise_snapshot` from the session performed. Adherence counts every workout the client logged — `training_events.status='completed'`, at any quality; a moved session completes on the day it is done, and the coach calendar shows it there with the same edited badge a coach move sets.

### Date-edit permissions

**A client logs the week their CURRENT check-in covers, plus every day since, up to and including today. That week closes when they submit the check-in, or when the next check-in day arrives — whichever comes first. Everything older is locked; the future is locked.** So a client is normally logging across about two weeks: the seven days their outstanding check-in reports on, plus the days that have passed since. A check-in they never sent is simply missed — its week locks on the next check-in day and never reopens. A day's LOG STATE decides nothing; the only question is which reporting period a day belongs to, and nutrition, wellness, habits and training all lock together with their day.

One rule in `lib/daily-log-permissions.ts` (pure, client-safe). `resolveLogsOpenFrom(client, lastSubmittedPeriodEnd)` is the ONE derivation of the boundary — the later of the start of the window `resolveCheckInWindow` gives for the client's today, and the day after the newest submitted `check_ins.period_end`. Taking the window from the same function the check-in FORM uses is what makes the lock and the form agree about which check-in is outstanding, and it is what makes the roll land on the check-in weekday itself: on that morning the form would submit for the new week, so the old week stops being sendable and its days lock the same day. `null` means no lower bound — a client with no schedule can never check in, so nothing ever closes a week for them (owner, 2026-09-04). `canEditDay(date, logsOpenFrom, clientTimezone)` drives UI disabled state; the server wrapper `assertCanEdit()` (`services/daily-log-permissions-service.ts`) throws `DayLockedError` → 403 carrying the one sentence, "This day is locked." — true of a closed week and of the future alike.

The boundary rides on **two** wires, from that one derivation: `GET /api/client/me` (the client-level read every screen already holds, refetched after a submit through `useInvalidateClientProfile`) and `clientInfo.logsOpenFrom` on `GET /api/client/check-in-context` (the check-in form's training checklist locks per row and that page never reads the profile). `services/training-event-layout-service.ts` applies the same boundary to **both ends** of every move, so a session can be neither dropped into nor lifted out of a week a check-in has reported on.

This REPLACED the "past logged → locked" rule on 2026-09-04 (today editable; a past day editable until it was logged; a never-logged past day open for ever). Gone with it: `DayLogStatus`, the per-resource child-table read and its `RESOURCE_TABLE`, the per-habit `habitId` narrowing, `assertCanEditTrainingDay`, the layout service's `session_logs` backfill read, the `loggedStatus` field on the wellness GET (it had no reader left) and the 201-on-first-log branch on the two daily-log saves, which existed only because that read was already being made. **Nothing on the coach side changed**: the coach never logs for a client, and the frozen-prescription rule on the coach's calendar (`assertSessionUnlogged`) is a different rule.

### Timezone model

**Locked model (Sessions 7.81–7.86): "today" is computed in the device timezone of the person whose calendar the date is on — never the server's UTC clock.** A client's day, plan placement, check-in window, streaks → the **client's** zone. A coach's dashboard windows (attention feed, current-week metrics, history summaries) → the **coach's** zone. The cross-person cases (a coach viewing a client's check-in due/overdue; background reminders) → the **client's** zone. One question decides every site: *whose calendar is this date on?*

- **Storage**: `clients.timezone` (migration 089) and `coaches.timezone` (migration 109), both `TEXT NOT NULL DEFAULT 'UTC'`, IANA.
- **Capture is device-synced, no manual picker** (Session 7.81 — intentionally reverses Session 2.6's "no silent overwrites"): the shared `useTimezoneSync` hook (`hooks/use-timezone-sync.ts`) compares the device zone against the stored value on every app load and fires a fire-and-forget PATCH on mismatch (client shell `app/client/layout.tsx` → `PATCH /api/client/settings`; coach shell `CoachTimezoneSync` under `app/(coach)/layout.tsx` → `PATCH /api/coach/settings`). Travel re-syncs on next open.
- **Read side**: server code derives "today" via `getTodayDateStringInTimezone()` in `lib/date-helpers.ts` — the only surface owning `Intl.DateTimeFormat` math. (Sanctioned exception: the two settings routes validate input zones with `Intl.supportedValuesOf("timeZone")` — validation, not date math.)
- **Helper inventory**: `lib/date-helpers.ts` owns the pure helpers — `getTodayDateStringInTimezone(tz, now?)` (string), `getTodayInTimezone(tz, now?)` (local-midnight `Date` for the injectable check-in helpers; NOT `parseISODate`, which parses as UTC midnight), `getDeviceTimeZone()` (browser capture). `services/today-service.ts` owns the DB-fetching ones — `getClientTodayString(clientId)` (client tz → coach tz fallback while the client is on the unsynced `'UTC'` sentinel → UTC) and `getCoachTodayString(coachId)`. **Rule:** when a `Client` record with `timezone` is already in scope, use the pure helpers (zero extra fetches — the overdue/attention-feed loops rely on this); the fetching helpers are for call sites holding a bare id.
- A stored `'UTC'` is the "never device-synced" sentinel; coach-initiated placement on a never-synced client's calendar falls back to the coach's zone (`getClientTodayString`, Session 7.82), then UTC.
- **Where each anchor applies** (Sessions 7.82–7.86): client tz — plan placement RPCs (`p_today`), calendar move/delete guards, the client home week, check-in gate/window, streaks/habit defaults, the check-in review's goal clock — the check-in's own day on the client's calendar, for its pace window and its days remaining (Session 7.86, commit 8b, `services/comparison-service.ts`), the coach calendar's drag/delete *gating* (Session 7.86 — the visual today ring stays coach-device), check-in due/overdue, and the placement-path event window-delete (`clientToday` threaded from the route as the additive RPC's `p_today` floor, `GREATEST(effective_from, today)`; migration 114 replaced the old STEP-0 cross-plan wipe). Coach tz — attention-feed window, coach "current week" metrics/history anchors, the attention-dismissal `dismissed_at` (migration 112 drops the column's UTC `CURRENT_DATE` default so a writer that forgets the date fails loudly), and the goal-deadline write bound (Session 7.86 — the coach is the setter, so the past-date check is route-side via `getCoachTodayString`; the zod schema is format-only). The placement RPCs additionally take `p_effective_from DATE DEFAULT NULL` coalescing to `p_today` (migration 110, carried into the additive 114/115 rewrites).

### Scale / payload contracts

Keyset-by-default is scoped to paginated, time-ordered "load older" history (check-ins). Small bounded sets return in full with no cursor (habits, a 1-week completions window, the exercise list). History rows are ID-first (`exercise_id` + `performed_name` fallback), never the catalog dictionary; the dictionary syncs separately via `GET /api/client/exercises/catalog?since=` (a read-only delta returning rows with `updated_at` after `since`; the client upserts them into its cached catalog — deletes are invisible to the delta, so a periodic full resync, by omitting `since`, catches them; internally paged past the ~1000-row PostgREST cap). Weights and lengths cross the wire as canonical kg/cm and are rendered client-side in the viewer's unit via `utils/unit-conversions.ts` (no formatter calls in `app/api/client/**`). Per-record unit tags and API-boundary conversion are rejected: storage is canonical (migrations 140-141), so the value carries its unit by definition and a per-record tag could only contradict it.

---

## Coach-side Data Flow

### SWR fetching

All coach-side data fetching uses SWR with:
- `revalidateOnFocus: false` — except a read whose writer is in someone else's browser: the training calendar refetches when the coach comes back to the page (a client moves their own sessions), as the check-in queue does
- `swrFetcher` from `lib/swr-fetcher.ts` (throws on non-OK responses)
- `isLoading` for initial load skeletons (not `isValidating`)

### Coach client roster

`/clients` (`app/(coach)/clients/page.tsx` → `RosterShell` + `RosterStatBand` + `RosterTable`) is the coach's list of clients, in the same three-column frame as a client detail page. **`lib/roster-views.ts` is the single owner of its vocabulary** — the `?view=` param, the status ladder, and every pure predicate — and `hooks/use-roster.ts` is the only fetch-and-memo layer over it. "all" is the bare `/clients`, never `?view=all`; every writer of the param goes through `rosterViewUrl`.

**Six views in two groups.** Four *roster shapes* above the sidebar divider — All / Active / Onboarding / Inactive — and two **Attention queues** below it:

| Queue | A row is in it when | Row action |
|---|---|---|
| **Overdue check-ins** (`?view=overdue`, sidebar "Overdue") | `daysOverdue > 0`, threaded from `GET /api/clients/overdue` rather than recomputed | "Send reminder", hover-revealed |
| **Unreviewed check-ins** (`?view=review`, sidebar "Review due") | the client is not deactivated AND has an unreviewed check-in | "Review check-in" → `checkInReviewUrl`, always visible |

A type-level guard in the module fails the build if a seventh view is added without a sidebar group.

**The review view means an unreviewed CHECK-IN, not a submitted intake** (owner decision 2026-08-29, reversing the 2026-08-22 roster decision in `a1e875a`). It was called "Ready for review" until 2026-08-30, when the owner renamed it **"Unreviewed check-ins"** — "ready for review" never said what was ready, and the intake queue still uses those words for itself. `ROSTER_VIEWS` holds the one spelling: the roster's sticky title, the stat-band cell and the dashboard card all render `rosterViewLabel("review")`, and the band's overdue cell was moved onto `rosterViewLabel("overdue")` in the same commit so the two attention cells cannot drift apart again. **The SIDEBAR is the one exception**: its two attention tabs sit under a **"Check-ins"** group heading and read the short `rosterViewNavLabel` — **"Review due"** and **"Overdue"** — because the heading already supplies the subject, and the full names clipped in a 200px column that truncates rather than wraps (smoked 2026-08-30). Not a bare "Due" for the review queue: `due` is already spent on the SCHEDULE across this app (`next_check_in_due`, the roster's `due 24 Aug` sub-line, the bell's "Due Soon"), where it means scheduled and coming up rather than submitted and waiting on the coach. A view with no short form falls back to its full name, so the four roster shapes need no entry. **The label says check-ins; every count says CLIENTS** — deliberately, because each count sits beside a list with one row per client and must match the rows on screen. The visible edge: a client with two waiting is one row, so reviewing the newer one leaves the number where it was. The intake queue was not deleted, it was rehomed: it lives on the **Onboarding** view's own rows and their `/intake-review` link, the dashboard's `PendingIntakeBanner`, and the floating intake panel. In the review view the row click and the chevron address the check-in; the client's NAME stays a link to the client, because it names the client rather than the thing waiting.

**Three reads, all folded.** `useRoster` reads `/api/clients?includeInactive=true` (deactivated rows included, so Inactive and reactivation work), `/api/clients/overdue`, and `/api/check-ins/unreviewed`. The latter two are already mounted app-wide by `NotificationsDropdown`, so SWR serves them from cache and neither costs a request. All three are represented in `isLoading` / `isError` / `refresh`: a queue that failed alone would otherwise render its view's empty state as a settled all-clear, and a `refresh` missing a leg leaves a reactivated client in the wrong view until the next poll.

**The Clients nav badge is these two queues added up** (`hooks/use-client-attention.ts`, mounted by `sidebar-nav.tsx` and `collapsed-icon-strip.tsx`); the **dashboard's "Unreviewed check-ins" card is the review half alone**, through `useUnreviewedCheckInClientCount` in that same module — one body, so the card, the badge, the sidebar pill and the stat-band cell cannot disagree. Both count **clients, never check-ins** — two check-ins from one client are one thing to do, so `useUnreviewedCheckIns().total` belongs on neither the badge nor the roster — and it reaches that number through the roster's own `indexUnreviewedCheckIns`, so a second spelling of the predicate cannot make the badge disagree with the page beside it. It has done exactly that twice: first counting `/api/check-ins/recent` rows behind a hand-rolled `setInterval`, then counting submitted intakes after they stopped being an attention queue.

**Both halves are active-only at their endpoints**, not in the renderer: `getOverdueClients` filters `client.active`, and `GET /api/check-ins/unreviewed` scopes to the coach's *active* client ids. A deactivated client's detail page 404s (`getClientById` is active-filtered), so a queue row for one dead-ends — the same reason `getCoachPendingIntakes` filters `client.active`. `matchesRosterView`'s `status !== "inactive"` is the belt over those braces.

**Freshness is bounded by the queue's own 30s poll** (`useUnreviewedCheckIns`, `revalidateOnFocus: true`). The dominant writer of both numbers is someone else's session — a client submitting — which no coach-side invalidator can reach; `useInvalidateCheckInsQueue` (`hooks/use-check-in-data.ts`) covers the coach-side writes, and the Check-ins tab calls it after a reply is sent.

### Client page tab structure

`app/(coach)/clients/[id]/page.tsx` renders tabs synced to the URL via `?tab=` search param:

| Tab | Component | Description |
|-----|-----------|-------------|
| Overview | `ClientOverviewTab` | Seven sections, top to bottom: identity row · status band (whole-journey chart ∥ four structural cells) · Needs attention + Since your last visit · Current plan · Adherence (three dot rails) · Daily wellness (five cards) · Coach notes. Every editable fact lives in the details sheet, not on the page. See "Coach client Overview" below |
| Metrics (**labelled "Journey"**) | `MetricsTabContent` | Four panes via `?journey=` — **Physique** (the hero's switcher selects ONE metric, carried as `?metric=`, and the hero, the progression chart and the measurement log all describe it: the chart over the measurement log's day-values, the log listing ONE ROW PER READING of the selected metric — newest day first, within a day the most recently written first, each with its source, its note and its change against the previous day's standing value, a removed reading muted with who removed it and when; its pager counting that metric's readings ("Showing 10 of 12 weight entries") and its empty state naming it; all from `GET …/measurement-series`: the day-values, the derived baseline, the start date, the readings list, readings before the start under "Before start". Three hover-revealed row actions — Edit reading and Remove reading on any live reading (Remove behind the destructive confirm), Restore reading on a removed one — see "client_measurements table" rule 8), **Wellness** (the same hero, chart and log over the merged check-in weekly averages ⊕ coach-logged `client_metric_entries`), each with the "Log measurement" modal (a physique key appends to the log, a wellness key upserts an entry), **Training** (`ExerciseDataView`, moved here from the Training tab in Session 7.1 — analytics live in Journey, prescription stays on its own tab: an exercise's chart by its type's markers, the table of its sessions beneath it, and its PRs, see "Exercise progress: charts and PRs"), and **Blocks** (`client_phases`; see "Journey blocks"). `JourneySubtab` is deliberately WIDER than `MetricTab`: Training and Blocks key none of the metric shapes (`metricsByTab` / `logRowsByTab` / `DEFAULT_FOCUS`) and are mapped onto `"body"` by `toMetricTab()`, a whitelist so the next pane is safe without editing it |
| Training Plan | `TrainingPlanCard` → `TrainingPlanBuilder` (Data / Plans) | Calendar + hero. **Exercise analytics moved to Journey → Training** (Session 7.1) — do not hunt for an Exercise Data pane here; the history table's exercise drill-down now crosses tabs to it. "Apply program" opens the program list, a place of its own (`?apply=1`); a pick replaces it with the client editor, a place of its own (`?editor=<savedPlanId>`), the shared `/dashboard/programs` builder in `client-draft` mode; "Edit plan" (the hero, and a block card's "edit plan") opens the same builder in `placed-plan` mode over the plan as it is on the calendar, a place of its own (`?plan=<planId>`; see "Edit plan"). (The plan-history list below the calendar was removed with the dead `training_plan_history` read chain — the table has had no writer since P7.) |
| Nutrition | `NutritionCalculatorCardEnhanced` + `NutritionHistoryTable` | Plan builder, per-day nutrition calendar, weekly adherence history |
| Wellness | `WellnessTabContent` | Wellness trends and analysis |
| Daily Habits | `HabitsTabContent` + `HabitsHistoryTable` | Habit management, analytics |
| Check-ins | `CheckInsTabContent` | A `Check-in history` rail whose one action, "Customise check-in", opens the per-client form editor (see "The customisable form" under Check-in System) — it sits ABOVE the body's four states, because a coach shapes a form before the first check-in exists. Under it, the client's check-in history, newest first, over `useClientCheckInsInfinite` ("Load older", `CLIENT_CHECKINS_PAGE_SIZE` per page on a **keyset cursor**; `hooks/use-check-in-data.ts` owns the list key and its invalidator). Each row is a `<Link>` to `checkInReviewUrl`; with `?checkIn=<id>` present the tab renders the review surface, `CheckInDetailView` (`components/clients/check-ins/`), in place of the list — one page: the KPI ribbon over Training beside Nutrition, then Wellness, Habits, Client notes, Goal progress, the AI review (Regenerate) and the Reply (Send). See "The coach review surface" under Check-in System |
| Notes | `NotesTabContent` | `client_notes` list — pinned first, newest-first, add + pin/unpin. Same endpoints as the Overview card |

`activeTab` is DERIVED from `?tab=` on every render (CONVENTIONS.md §7 → URL-driven UI state). Tab changes go through `handleTabChange` → `buildClientTabUrl` (`lib/client-tabs.ts`): it is the URL **builder**, so cross-tab navigation runs through it to get the query assembled correctly (`?subtab=` stripped, `extraParams` applied), and it pushes a history entry on a tab change (scrolling to top) and replaces in place on a same-tab address. **A place pushes, a refinement replaces**: a tab, a pane (`?journey=`, `?training=`, `?nutrition=`), an opened check-in (`?checkIn=`) and a roster view (`?view=`) each push, so browser Back returns one step; the metric (`?metric=`), an exercise pick, a filter or a sort replaces; a one-shot param is stripped by a replace, so no entry re-opens a flow; overlays (drawers, dialogs) are not entries. Browser Back is one step. A page's arrow — the client sidebar's, the intake review's, the client page's error card, the library builder's exit — LEAVES the page: back over every entry of it to the one before it began when a coach page precedes it, else to its parent (`lib/coach-history.ts` keeps the count and the page start; `components/coach/back-link.tsx` is an arrow that is a link). A one-step return (`hooks/use-coach-back.ts`) serves the review's post-Send return and an editor's own exit. The Training tab's apply tray and its two editors are places of their own: `?apply=1`, the program list, pushed by "Apply program" and popped by its X; `?editor=<savedPlanId>`, the client editor, which a pick REPLACES the tray's entry with and whose arrow replaces back to the list; `?plan=<planId>`, the plan editor, pushed on open. Back closes each onto the calendar, a save completes the entry, and `buildClientTabUrl` drops all three on a tab change. `components/clients/url-writer-class.test.ts` pins each writer's class; `components/clients/training/builder/surface-ownership.test.ts` pins that the tray and the editors hold no state of their own. Every surface has one owner and no frame disagrees: CONVENTIONS §7 → "No frame disagrees". The training history table's exercise drill-down takes the handler as a prop, and the nutrition drawer's `GoalSummary` writes a sentence rather than a link. **Every tab owns a pane param named after itself** — `?journey=` (Physique/Training/Wellness/Blocks), `?training=` (Data/Plans), `?nutrition=` (Data/Plans). Single-owner is the whole contract: only its own tab reads it, so it rides through a tab switch and restores that pane on the return trip, and it is read *unconditionally* — a deep link resolves on the first render. Journey owns a second, `?metric=`, the selected metric of its Physique and Wellness panes: read unconditionally, validated against the pane's own list (an unknown value or the other pane's metric derives to the pane default, `DEFAULT_FOCUS`), written by the hero's switcher alone, and deleted by a pane switch in the same navigation, so the URL never asserts a metric the pane cannot show; the measurement log remounts on it (`key`), which is what returns its page to 1. The shared `?subtab=` that Training and Nutrition both used to write is retired (Session 7.2) — still read as a guarded fallback so old links resolve, still deleted on every tab change, written by nothing. `extraParams` ADDRESS a pane on arrival and a `null` value deletes a carried key.

**The Check-ins tab's single-owner param is `?checkIn=<id>`** — a record id, like Journey's `?block=`, read unconditionally, so a pasted `/clients/{id}?tab=check-ins&checkIn=<id>` opens the check-in on the first render and an open detail survives a sidebar round trip (see "The coach review surface" under Check-in System). `checkInReviewUrl(clientId, checkInId)` (`lib/client-tabs.ts`) is the ONE writer of that form, for every cross-page deep link: the roster's review rows and their "Review check-in" action, the bell's New Check-Ins rows, and the dashboard's "Recent check-ins" rows. (The legacy `/check-ins/review` queue was the first caller and was deleted 2026-08-30.) **The tab's list rows are real `<Link>`s to it**, and a cross-tab open (the Overview's "Review" row) goes through the handler as `{ checkIn: id }`; both push, so browser Back returns to the list or the Overview. The detail's back row closes the review to the list, clearing the param through the handler (`{ checkIn: null }`); the return after a reply is sent goes back one step instead, and clears the param the same way only when nothing in-app precedes the review — a pasted address.

**The Check-ins tab's list pages on a keyset cursor, the same contract as the client's own history**
(C7, 2026-08-30). `GET /api/clients/[id]/check-ins` is keyset by default — an opaque base64url
`{createdAt,id}` cursor through `lib/cursor.ts`, decoded and strictly validated before its values
reach the PostgREST predicate — with `?offset=` surviving as an explicit legacy opt-in and nothing
building it. Both infinite readers key **page n on page n-1's `nextCursor`**, and that derivation is
the contract, not an implementation detail: an offset page addresses "rows 20-39 of the list as it is
now", so two pages fetched either side of a client's submission describe two different lists and the
flattened result repeats a row (React's "two children with the same key") or skips one, silently. A
cursor page says "the rows after THIS row", which stays true however stale it is, and a changed page
n-1 changes page n's KEY so SWR refetches rather than serving an overlapping window. The exact
`total` is taken on the **first page only** (`withTotal`), because the rail renders it and a per-page
COUNT would buy nothing. Both readers also revalidate on focus and revalidate their first page — the
documented §7 exception `useOverdueClients` carries, for the same reason: the dominant writer of this
list is the CLIENT submitting in another session, which no coach-side invalidator can reach.

Four params are **one-shot**, consumed and stripped by the surface that receives them: `?edit=1` opens the Nutrition plan drawer, and `?returnTo=journey&returnBlock=<id>` names the Journey block to return to on a **successful save** (`hooks/use-journey-round-trip.ts`: `useJourneyRoundTrip` on the drawer consumes both; `useJourneyReturnBlock` on the Training apply tray captures the block and strips the return params alone, since `?apply=1` is the tray's address and stays); the return lands on `?journey=blocks&block=<id>`, and `?block=<id>` opens that block's card on the Blocks pane, winning over the default-expanded current block (`hooks/use-journey-focus-block.ts`). Stripping on arrival is not tidiness — the whole query is carried across every tab change, so a `returnTo` outliving its own flow would bounce a coach to Journey after a **later, unrelated** save, and a lingering open-param would re-open the surface on every hand-return to the tab (Radix unmounts inactive `TabsContent`, so each visit is a fresh mount). The drawer's hook drops the return target on any close without a save and on a hand open; the tray's captured block survives the pick and the editor's arrow (both replace the address) and is cleared by the X and by a hand open. Both ways in — the empty state's "place one" / "set targets" and the set state's "update plan" / "update targets" — go through one handler per track and are offered on **current and future** blocks only; elapsed and archived keep plain text (`blockAcceptsSetup`). The fourth, `?editProfile=1` (`OPEN_PROFILE_EDITOR_PARAM`, `hooks/use-profile-editor-trip.ts`), opens the Overview's client details sheet on arrival; the check-in goal strip's `Set new goals` sends a coach there with `checkIn` cleared in the same navigation, so the Overview's address carries no check-in.

### Builder flows

- **Training (authoring)**: `ProgramDraftProvider` (`components/clients/training/program-builder/`) owns the draft tree, revision-counter dirty tracking, set-spec mutations and the save/apply pipelines. It is the **only** training authoring state, used identically in `target="library"`, `target="client-draft"`, and `target="placed-plan"` (the plan editor — see "Edit plan" under Coach Library). It deliberately lives beside the builder rather than in `contexts/`, because a route layout mounts it.
- **Training (client tab, read-only)**: `TrainingBuilderProvider` / `useTrainingBuilderContext()` wraps `useTrainingPlan` (SWR; `useClearTrainingPlan` is its clearing form) and supplies the client's current plan (the program covering today, else the first one queued), the program that starts after it, the client's today and the deletion floor, its pending state and `refresh` to the Plans tab, which renders its frame throughout — the hero holds placeholders until the first answer, and a refresh never blanks the pane. Read surface only — do not add authoring to it; the hero's start-date move is a write of its own (see "Moving a program's start").
- **Nutrition**: `NutritionBuilderProvider` wraps `useNutritionBuilder`. Manages the protein multiplier, diet type, the day the plan takes effect ("Starts on" — with a block chosen in the Block field above it, fixed and disabled on the block's first available day: the client's today for a block under way, whatever they have logged (targets ask no floor; owner, 2026-09-11), a future block's own start otherwise; with the dash, the coach's pick, else the client's today; the Block field lists the dash then the client's blocks whose end is on or after the client's today, and preselects the block the coach came from (see "Journey blocks"); the preview and the save spread the deficit from the date, a pick before a queued version's start says these targets run until the day before it and a pick on it says it replaces it, and a saved plan resets both fields), and the targets block — Auto shows the four calculated numbers; "Edit manually" is the **macro balancer** (`components/clients/nutrition/macro-balance.tsx` over the pure `lib/nutrition/macro-balance.ts`): one calorie target over a two-thumb slider splitting it across carbs, fat and protein in whole percents, grams at 4 / 4 / 9 kcal per gram with carbs absorbing the rounding, seeded from the auto numbers, the calories held whatever the thumbs do — so the four numbers cannot disagree and there is no match button. The split is the coach's hand alone: the balancer offers no presets and reads no diet type, which belongs to the calculated path (owner, 2026-09-10). Generate posts the typed calories with the grams the split derives, and the drawer reopens seeded from the saved custom numbers, snapped to whole percents; `CUSTOM_MACRO_CALORIE_TOLERANCE` (10 kcal, in the plan schema's refine and the orchestrator's custom branch) is the server's belt against a raw API caller, not a rule the drawer can trip. The provider is the one remaining `generatePlan()` caller. **Anything that must happen only on a real save keys on `generatePlan`'s BOOLEAN, never on the drawer closing.** The drawer's auto-close watches `!isGenerating && hasPlan`, which stays true for a client who already had a plan — so it also fires when a *regenerate* failed, which makes "the drawer closed" the wrong success signal. **It does NOT own activity level or the energy pair** — those are client facts read from the profile (see "Client energy" above). The drawer shows TDEE read-only with a drift line when the covering version's snapshot differs from the live profile; the work-activity dropdown that used to live here was removed in Session 4B, because it gave activity two homes that disagreed and made "regenerate a plan" the accidental way to update a client's TDEE.

Each context is a thin wrapper: it provides the hook's return value, and consumers access it via the context hook.

### Coach client Overview

`components/clients/client-overview-tab.tsx` + `components/clients/overview/**`. Seven sections reading top to bottom as *who this client is → where they stand → what needs doing → what happened since I last looked → what they are on → how consistent they have been → how they feel → what I said*. The plan sits ABOVE the two consistency sections deliberately: adherence is adherence TO something, so the prescription reads first and the fortnight measuring it reads second. Every summarising card links to the tab that owns its data — the awaiting-review row deeper still, to the check-in itself (`?checkIn=`); every unset state names what is missing and offers the action that fixes it.

**The page has NO window control, and two deliberately different timescales.** It briefly had a 30/60 selector governing both; the owner removed it on 2026-08-28 because the two surfaces are answering different questions and a shared control implied they were not.

- **The progression chart is the client's WHOLE journey.** Its axis runs `[start date, today]` regardless of what the data does, so a client who stopped logging in July reads as a client who stopped logging in July rather than being cropped back to it. Raw dots come off above 40 readings; the trend line carries a long journey alone.
- **Both consistency surfaces read the same fixed fortnight** — `ADHERENCE_WINDOW_DAYS` and `WELLNESS_WINDOW_DAYS`, both 14. Wellness was 7 for a while, which meant two sections stacked together answered "how has this client been" over two different periods with only their rail metas saying so. Neither is selectable; long ranges live on the Journey tab. Copy in these sections stays window-neutral ("Not logged in this window", not "this week") so it cannot go stale when the number moves.

**A single "Signals" card briefly replaced both** — four rows on one grid, each expanding onto a detail panel, on a selectable 30/60 window. It shipped on 2026-08-28 and was reverted the same day: the owner preferred the dot rails, which say a client's fortnight in one glance rather than behind an expansion. Do not rebuild it. What died with it, deliberately: `AdherenceSummary.nutrition.calories` / `.protein` (window means against the target that applied on the day) and `habits.perHabit` (a per-habit breakdown that had to ride on this read rather than `/habits/logs`, because `logHabit` upserts only when the client acts and a habit they ignored has no rows at all). Both were free — same query, more columns — and both are in git history at `c7f3f8b` if a detail view ever wants them.

Everything else is STRUCTURAL: goal targets, the energy pair, the deadline, the plan's week and the next check-in describe a client rather than a period, and re-cutting them by any window would be meaningless. Two figures sit near period surfaces without being one, and each says so in its own copy — the status band's footer delta is lifetime (`Since start:` — mandatory, not decorative), and a wellness flag chip is a trigger's verdict over its own fixed window (`Flagged: high for 3 days`).

**Every editable fact lives in the details sheet** (`components/clients/details/**`), opened by the identity row's pencil, the "Set a schedule" action and the activation banner's Client-profile row. The page itself is read-only; there is no inline editing and no dark editable surface.

Seven SWR reads back it (eight with the lazy goal history), all coach-scoped under `/api/clients/[id]/`:

| Endpoint | Serves | Notes |
|---|---|---|
| `GET …/overview-brief` | Needs attention, the activity feed, the identity row's check-in cluster, the wellness flags | **Read-only** — it does not touch the `last_viewed_at` anchor. Key from `hooks/use-client-overview.ts`, whose `useClearClientOverview` every calendar writer calls (cleared, not revalidated: the rows are definite answers) |
| `GET …/goals` | The status band's goal targets and the details sheet's goal seeds | Via `hooks/use-client-goals.ts`, which owns the key builder and the matching area invalidator. The tab resolves the record through `resolveEffectiveGoal` and passes the result down; the card never touches the `clients` mirror. The hook returns the RAW goal, which the sheet seeds from — a resolver answers what drives the client, the editor shows what the coach set |
| `GET …/goals/history` | The footer's Goal-history popover | **Lazy** — the SWR key stays `null` until the popover opens, so the Overview does not pay for it on every load. Superseded versions only, bounded |
| `POST …/overview-brief/seen` | "Mark seen" | The ONLY writer of `coach_client_views.last_viewed_at`; returns `{ lastViewedAt }` nested under `data` |
| `GET …/overview-plan-summary` | Current-plan cards | `training`, `upcomingTraining`, `nutrition` and `upcomingNutrition` are independently nullable. Same key module and clearer as the brief |
| `GET …/adherence?days=` | The three-rail adherence card | The Overview passes `ADHERENCE_WINDOW_DAYS`; the route clamps to **[7, 60]**, wider than any caller needs since the 60-day window it was raised for was removed. Rails are index-aligned with `dates`; `loggedDates` carries the derived logged days over the window (see "Daily Logs") |
| `GET …/measurement-series` | The progression chart, and the status band's four reading figures — current and start weight and body fat, in the Since-start pill and the goal chips | The measurement log's day-values for every metric (`client_measurements_live`, paged past the row cap), the derived baseline per metric, the client's start date and the readings list — one payload, the same one the Journey's Physique pane, its measurement log and the blocks read (`hooks/use-measurement-series.ts` owns the key and the area invalidator). The band reads its four figures from HERE and never from the page-level client record: the record revalidates only on coach-side writes, so a check-in the client submitted reached the chart on the next visit and the pill only on a reload. No date param: the chart's axis runs from the start date to today, the baseline is drawn at the start date with the reading's own date in its label, and a reading dated before the start date is not a point |
| `GET …/daily-logs` | The five wellness cards | Through `useWellnessData(clientId, { daysBack, withHabitLogs: false })` — narrowed to `WELLNESS_WINDOW_DAYS`, and the habit fetch stays off because nothing on the Overview reads habit logs |
| `GET`/`POST …/notes`, `PATCH …/notes/[noteId]` | Coach-notes card + Notes tab | See `client_notes` above |

Load-bearing details:
- **The anchor moves only on "Mark seen".** The GET was made read-only so a page load cannot silently clear the coach's unread feed. A first visit (null anchor) returns an empty feed and renders a first-visit state rather than a caught-up one.
- **The Current-plan rail's `Week X of Y` describes the active *training* block — not a *journey* block.** Via `utils/plan-week.ts`. "Ended" here means today is past `program_duration_weeks`, the PLACED length placement records from the same window every other reader takes off the row (migration 167). A *journey* block (`client_phases`, migration 145 — see "Journey blocks" under Client Goals & Body Metrics) is an unrelated concept sharing the word: a coach-authored label on a stretch of the client's calendar that prescribes nothing, and neither surface reads the other. (The previous "no roadmap or phase concept exists" claim here died with migration 145; the roadmaps/phases *feature* that migration 133 removed remains removed — journey blocks are not its return, see the workstream plan's §1 for the shapes that must never come back.)
- **Training has three states, not two.** `getTrainingPlanForDate` resolves strictly by date (`.lte("effective_from", today)`), and placement deliberately permits a future start date (`place-from-library` rejects only a start before the deletion floor), so a program starting tomorrow leaves `training` null. The window-flipped twin, **`getNextFutureTrainingPlan`** (`services/training-service.ts`), is the ONE owner of the "starts later" predicate — client-scoped, `deleted_at IS NULL`, **`status <> 'archived'`**, earliest first. This card and the Training tab both read through it. They previously hand-rolled it separately and the Training tab's copy omitted the archived exclusion, so a retired program resurfaced there as the client's current plan while this card correctly said "No plan". Never write a fourth copy. `upcomingTraining` carries that queued program so the Overview reports "Starts Mon, 27 Jul" rather than "No plan" — the old copy told a coach who had just assigned a program that none existed, and its "Open Training" call to action invited them to place a *second* one alongside it, which the additive placement model accepts. A program whose window has **ended** deliberately keeps the "no plan, place one" invitation: an ended plan cannot be opened in the plan editor, so assigning a new one is the correct gesture. Do not widen `getTrainingPlanForDate` to fix this — write paths stamp `training_plan_id` from it and need "the plan governing today" to keep meaning exactly that. **Nutrition has the same three states:** `upcomingNutrition` carries the earliest queued version — through `getNextFutureNutritionPlan`, the predicate the nutrition hero's "Starts" line reads, so the two cannot disagree — and the card reports its daily target with "Starts Wed, 7 Oct" rather than "No nutrition plan yet"; a running version wins over a queued one, as on the training card. **Both queued cards share one layout** (owner, 2026-09-09): a generic title ("Training plan" / "Nutrition targets") carrying the identity chips, a fixed header hairline with the one-cell body under it (the program's name / the daily target at the name's size with its macros beside it on the same line, each a number then its unit), and the Starts footer pinned to the bottom under its own hairline, so the pair line up whichever is queued.
- **Goal chips come from `lib/goals/goal-state.ts`** (reached / beyond / gap). The under-vs-over wording needs the direction of travel, which only the call site's `start` value knows.
- **Alert rows route through `lib/attention-alert-destinations.ts`**, the same map the dashboard feed uses, so the two surfaces cannot disagree about where an alert leads. Each row also carries a hover-revealed dismiss that posts to the **dashboard's** `POST /api/dashboard/attention-feed/dismiss` — one `attention_dismissals` store serves both surfaces, and `evaluateSingleClientAlerts` already filters on it, so dismissing here clears the alert on the coach dashboard too and lapses when a newer day trips the same trigger.
- **A mono datum inside a sans line uses `InlineMono`** (`overview/overview-primitives.tsx`), never a literal space. At 13px an Instrument Sans space measures **2.5px** against JetBrains Mono's **7.8px** (CDP-measured), so `Starts <date>` written with a plain space leaves the label glued to the value while the value's own internal spaces look 3× wider. `InlineMono` carries `ml-[1ch]`, which resolves against its own font and therefore always matches the datum's rhythm at any size — call sites must not add a space of their own.
- **Three surfaces must be told when their data is still loading.** `CoachNotesCard` (`isLoading`), the identity row's check-in cluster (`isTimingLoading`) and the progression chart (`isLoading` with a null series) all receive empty-shaped data while pending *and* when the client genuinely has none. Without the flag they render a confident "no notes" / "Not scheduled" / "No measurements in this window" and contradict it a moment later. Covered by `overview/loading-states.test.tsx` and `progression-chart.test.tsx` — keep the flag threaded through any new consumer.
- **Five wellness cards**, Soreness included. Stress and soreness are inverted (lower is better) through `getWellnessTone()` in `utils/wellness-color-thresholds.ts` — the single source for that inversion, shared with `components/check-in/mini-bar-sparkline.tsx`. **Sleep has no trigger in `lib/wellness-triggers.ts`, so its card can never flag; do not invent one.** There is deliberately no composite wellness score anywhere — only per-metric tones — so wellness is five cards rather than a fourth rail with a percentage.
- **The training rail's `none` state renders a dash, not a dot.** No session was planned that day; losing that turns every rest day into a miss. Every other day is classified from its own workouts, each read as its display state (see "How a workout reads"): a day whose workout was partial keeps its partial dot, and a workout still scheduled on a day that has passed is a miss. The figure beside the rail is `summariseTraining` over the same workouts the rail is built from, so a day wearing a partial dot is inside it — matching the Training-tab hero.
- **Both cards in the second row show three rows, then offer the rest as a toggle.**
  `OVERVIEW_CARD_ROWS_SHOWN` (3) and `CardOverflowToggle` live in `overview/overview-primitives.tsx`
  and are shared by Needs attention and Since your last visit — **one number for both, because they
  share a single `items-stretch` grid row**: cap them differently and the taller one dictates the
  height again, padding the shorter with the white space the cap exists to remove. Unbounded, the
  feed ran to ~1,760px at its 20-row fetch cap and an all-clear Needs attention padded to match it.
  `ACTIVITY_FEED_CAP` (20) stays the FETCH cap, deliberately a different number so the footer has
  something to offer. **The remainder expands in place rather than being named in a count**,
  because "Mark seen" moves `last_viewed_at` and clears the feed: a line reading "+14 more" would
  have named fourteen things and destroyed them unread on the next click. The button TOGGLES —
  expanding was one-way for a day, on the reasoning that Mark seen comes next, but the Overview is
  a page you scroll through and a coach who expanded and carried on had restored the tall card for
  the rest of the visit, with only a tab round trip to undo it. Needs attention's three sources
  (the check-in row, the block-ending row, the severity-sorted alerts) are collected into ONE
  ordered list before slicing, so the cap can never drop a whole source.
- **Two density rules.** `WellnessSparkline` drops its interior dots above 20 points and keeps the last-point marker, which is the one carrying tone; the progression chart drops its raw dots above 40 readings for the same reason. At the shipped 7-day window the sparkline's rule is inert — it is there because the component takes any number of points, not because this caller needs it.
- **Alert copy is shared with the dashboard.** `lib/attention-alert-copy.ts` owns `getShortAlertText` / `getPriorityAlertText` (title and sub), `alertLines` (which returns a null sub when the two would be identical — `no_log_gap` falls through both switches) and `visibleAlerts` (which hides `no_log_gap` while `no_engagement` is live: the second is strictly stronger, and suppression rather than a merge keeps the dismissal 1:1). The alert thumb icon names the **destination**, not the type — eleven types share four destinations.

### Attention feed

Wellness/tracking/activity triggers evaluate across all coach's clients:
- `lib/wellness-triggers.ts` - mood/energy drops, stress/soreness spikes
- `lib/tracking-triggers.ts` - logging gaps, nutrition/training misses
- `lib/activity-triggers.ts` - habit dropoff, activity-calorie mismatch
- `lib/engagement-triggers.ts` - no-engagement / disengaged-client detection (absence signal)
- `lib/prescription-triggers.ts` - a prescription that stops with nothing after it, per track (the other absence signal)
- `services/attention-feed-service.ts` - aggregates triggers into prioritized feed
- `components/dashboard/needs-attention-feed.tsx` - renders on coach dashboard via SWR

The nine wellness/tracking/activity triggers are pattern detectors over existing `daily_logs`, so they can only fire for clients who have logged. `evaluateAndSortTriggers` (`lib/attention-feed-helpers.ts`) therefore evaluates any client with **prescribed work** (training events, habits, or a plan window on either track) even before their first daily log — it skips only clients with nothing logged AND nothing prescribed. `evaluateNoEngagement` is one *absence* signal: it flags an active client who has prescribed work but no logged day within the silence window, past an activation grace period. Both it and the logging-gap trigger read the one derived definition of a logged day (see "Daily Logs"), assembled per client by `loggedDaysFor` from the rows the feed already reads plus the client's own measurement logs, so a client who only trains or only ticks habits is never read as silent. This is why a never-logged client with an assigned plan surfaces instead of being silently counted "on track".

**A prescription that stops is the other absence signal** (`evaluatePrescriptionEnding`, `lib/prescription-triggers.ts`; alert types `nutrition_ending` / `training_ending`, one per track so each dismisses on its own). Past a version's end there are deliberately no days — the client's meals save with no target to judge them — and no surface told the coach. The feed reads every active nutrition version's window (`getNutritionWindowsForClients`) and every live program's window (`getLiveProgramWindowsForClients` — a plain read of each row's window, migration 167), two chunked cross-client reads that degrade like the habits and events reads. `findPrescriptionGap` merges a client's windows into stretches and walks from the feed's coach-local today to the next uncovered day; a plan queued to start the day after the current one ends is continuous coverage. **HIGH** once the stop has happened with nothing queued — "No nutrition targets from 16 Feb", anchored on today so it returns daily until the coach sets targets, places a program or deletes the plan (a delete archives on both tracks, and both readers filter archived out). **MEDIUM** while the stop is inside the final `PLAN_ENDING_LEAD_DAYS` (7, the end day included — the same lead the Overview's block-ending row reads), whether or not a plan is queued after the gap: "Nutrition targets end 13 Mar, nothing until 20 Mar". Anchored on the lead window's first day, fixed per end date, so one dismissal covers the whole heads-up and a later end date brings it back. **Nothing** during a gap that has a plan queued after it — a holiday or a rest period the coach laid out (owner, 2026-09-10) — and nothing for a client whose every window is still ahead, a queued first plan being setup rather than a stop. A client with blocks gets the block named (owner, 2026-09-10), from one more chunked read (`getBlockWindowsForClients`, non-archived only) that is context and never a bound: the HIGH names the block the client is sitting in with nothing ("…, in Cut"); the MEDIUM names the block the last day falls in — "the last day of Build" when the prescription ends with its block, "inside Build" when it stops before its block does — and, when nothing is queued on the track and a block follows, "and Cut has no targets set" / "has no program placed", the block card's own words. No block covering the day, plain form. The message carries the dates and is never parsed: both copy switches hand it back and the Overview row is one line. Every calendar writer clears the Overview's two reads (`useClearClientOverview`, `hooks/use-client-overview.ts`, the `/api/clients/[id]/overview` area) and this feed (`useClearAttentionFeed`, `hooks/use-attention-feed.ts`) on success — cleared rather than revalidated, because both render definite answers and SWR would serve the stale one for the whole refetch; `hooks/use-client-overview.test.ts` scans the tree for the writers.

---

## Auth Model

### Dual role system

- `profiles` table: `user_id`, `role` (`trainer` | `client`)
- `coaches` table: created by the `handle_new_user` signup trigger (migration 107) at `auth.users` INSERT for trainers; `GET /api/auth/me` re-creates it idempotently if missing
- `clients` table: `user_id`, `coach_id` for ownership
- Role is derived from **server state** (a `client_invitations` row matching the signup email case-insensitively ⇒ `client`, else `trainer`) — never from client-supplied user metadata (migration 107 anti-privilege-escalation)

### Middleware routing (`middleware.ts`)

- Public routes (skip auth entirely): `/invite/*`, `/api/invitations/*`, `/forgot-password`, `/reset-password`, `/auth/callback`. **`/check-in/*` and `/api/check-in/*` are NOT public** — the magic-link check-in flow went with migration 142; clients check in through the authenticated portal (`/client/check-in`), and `/api/check-in/[id]/*` is a coach route (see "Route namespaces")
- Trainers: restricted to `trainerRoutes` (exported from `middleware.ts`) — `/dashboard`, `/clients`, `/crm`, `/automation`, `/settings`, the five folders of `app/(coach)/` (see "Coach route group"). Any other path is left to Next, which 404s it for either role
- Clients: restricted to `/client/*` routes
- Role mismatch: redirects to appropriate dashboard

### Coach route group (`app/(coach)/`)

**Folder membership is what makes a route a coach route.** Every trainer-facing page lives under `app/(coach)/` — `dashboard/`, `clients/`, `crm/`, `automation/`, `settings/` (route groups do not appear in URLs) — and `app/(coach)/layout.tsx` is the coach application boundary: a server layout that renders the page plus the three concerns that must run on every coach page whichever shell it uses, `CheckInNotificationListener`, `CoachTimezoneSync` (`components/coach/coach-timezone-sync.tsx`, the coach twin of the `useTimezoneSync` call in `app/client/layout.tsx`) and `CoachHistoryTracker` (`components/coach/coach-history-tracker.tsx`, which keeps the count every back arrow reads — see "Client page tab structure"). Nothing else belongs there.

**Each shell owns its rail.** The layout renders no rail and holds no route classification, because which rail a surface gets is not a boundary-level question (`/dashboard` and `/dashboard/programs` are parent and child and want different rails, which nesting cannot express). The four shells decide: `AppLayout` mounts the full 80px `PersistentSidebar` (`lg:ml-20`); `RosterShell` and `ClientDetailLayout` mount the 52px `CollapsedIconStrip` beside their 200px section sidebar (`lg:ml-[252px]`); `ProgramsShell` mounts `CollapsedIconStrip` (`lg:ml-[52px]`). Nothing else mounts a rail — `components/rail-ownership.test.ts` scans for it — and the rail components read no route and check no role: they render on first paint, and only the footer's name/email and the attention badge are user data that fills in when `/api/auth/me` resolves. A shell keeps its rail outside any loading branch: loading content never takes the application chrome with it. `/clients` is the one coach route with request-dependent chrome (`?view=` decides its header title and sidebar highlight), so its page keeps the single `useSearchParams` reader alone behind a Suspense boundary whose fallback is the same `RosterFrame` with `view: null` (`components/clients/roster/roster-frame.tsx`): the frame — rail included — is in the statically prerendered HTML with nothing highlighted, and hydration re-renders it with the resolved view. `scripts/check-prerender.ts`, chained to `npm run build`, fails the build if a prerendered coach page loses its chrome, `/clients` stops prerendering, or its prerender claims a view.

**Authorization keeps its own literal list, bound to the folder by test.** Middleware runs on the Edge runtime with no filesystem, and Next's filesystem→URL map (`.next/app-path-routes-manifest.json`) is a build output, so neither can feed `trainerRoutes`. `middleware.test.ts` scans `app/(coach)/` and asserts the two agree in both directions: every top-level folder is protected (the load-bearing direction — a miss is an unprotected coach route), and every entry protects a folder that exists.

### Auth helpers (`lib/auth-helpers.ts`)

- `getAuthenticatedCoachId()`: validates JWT via `supabase.auth.getUser()`, queries `coaches` table, returns coach ID or null
- `getAuthenticatedClientId()`: same pattern against `clients` table

### Session bootstrap (`GET /api/auth/me`)

The browser `AuthProvider` (`contexts/auth-context.tsx`) is session-lifecycle-only: `supabase.auth` for login/signup/OAuth/logout/reset, with a **synchronous** `onAuthStateChange` callback (supabase-js holds an origin-wide Navigator lock while the callback runs; an awaited supabase query inside it deadlocks — the historical `fetchProfile timeout`). Profile and coach come from `GET /api/auth/me` via SWR, keyed on the user id. The route chain is `apiRateLimit → getUser() → getOrCreateProfileAndCoach()` (`services/auth-profile-service.ts`, `supabaseAdmin`), returning `{ profile, coach }` (`coach: null` for clients) with `Cache-Control: no-store`. The service mirrors the trigger's invitation-derived role and uses `ON CONFLICT (user_id) DO NOTHING` semantics, so it is race-safe against the trigger and against concurrent requests; on success `role === "trainer" ⟺ coach` is present. The browser anon-key client never reads `profiles`/`coaches`. Note: middleware fail-closes profile-less sessions (`/login?error=profile_unavailable`) before any route runs, so the route's profile-create branch is defense-in-depth; the coach-row self-heal is reachable and verified.

### Database clients (Shape B — see CONVENTIONS.md §8 for the authoritative rule)

> The authoritative rule is **CONVENTIONS §8 ("Auth & data-access architecture (Shape B)")** — read it first; this is a summary, and §8 wins on any disagreement.

- `supabaseAdmin` (`services/supabase-admin.ts`): bypasses RLS. **This is the service-layer default**, used with an explicit caller-verified scope (`clientId` / `coachId`). Most DB traffic goes through it — authenticated client/coach reads, cross-client coach aggregation, token-based contexts, and system writes alike.
- `createServerSupabaseClient()` (`lib/supabase-server.ts`): session-scoped, respects RLS. Used to **validate the session** (the auth helpers call `getUser()` through it), and otherwise only in the rare case where an RLS policy doing real work needs `auth.uid()` in-database and the admin-plus-scope pattern genuinely doesn't fit (see §8 "When to use createServerSupabaseClient()"). Re-exported as `createPortalClient` from `services/client-portal-service.ts`.

**There are two data paths, not one.** Shape B is the rule and carries the overwhelming majority of traffic, but a second, smaller anon-key + RLS path exists alongside it — the content library, client activation, check-in context, and the auth helpers' own lookups. On those routes **RLS is the enforcing control, not the route layer**, so a policy change there is a functional change, not defence-in-depth. (`scripts/assert-rls.ts:104` asserts the opposite — "this app's entire data path is service_role" — and is wrong; see `TECHNICAL-DEBT.md → Opened by the 2026-07-30 anon-path read trace`.)

> ⚠️ **Four of those anon reads are universal gates. Dropping any of their policies is total product lockout, not a degraded feature.**
> - `middleware.ts:105` → `profiles` — every non-exempt route in the product; a miss hard-redirects to `/login?error=profile_unavailable`
> - `lib/auth-helpers.ts:82` → `coaches` — the step-2 auth check of **every** coach route; every coach API 401s
> - `lib/auth-helpers.ts:135` → `clients` — every client-portal route, via `lib/require-client-auth.ts`

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
- **Usage**: routes call `recordAuditEvent(...)` **fire-and-forget** (`void`-prefixed) after a successful, already-authorized write. Action names come from `AUDIT_ACTIONS` (`lib/constants.ts`). Live call sites include client invitation/activation, goal create, training placement, the plan editor's save, a program's start-date move, measurements and wellness entries, nutrition plan creation, the nutrition plan deletes (the calendar's and the per-version one), and intake metrics sync. Failures go to Sentry, never to the user.
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
  -> "Sync metrics" pushes height/age/goals from client_intake onto the profile
     and appends the intake's weight and body fat to the measurement log as
     `intake` readings (only for a metric the client has no reading of).
     Available from the floating intake panel as well as the full page, and
     REQUIRED FIRST: "Mark as reviewed" stays disabled until the client has a
     weight reading (hasStartWeight, lib/client-profile-completeness.ts)
  -> Builds nutrition / training / habits using existing builders
  -> clients.onboarding_status = 'setup_in_progress'

Coach activates client
  -> Sets welcome message + FIRST CHECK-IN (a date, prefilled a week after the
     start date and re-prefilled when it moves) + START DATE (prefilled: today)
  -> REFUSED with 409 unless the client has a weight reading — activation is
     the origin, and the baseline derives from the log as of that date
  -> clients.onboarding_status = 'active'
  -> recordClientStart: start_date, and nothing else (see "The client's
     origin" — the baseline is derived, never stored)
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
- `hasNutritionPlan` - a nutrition version covers the client's today OR one is queued (covering-or-future, migration 144: a coach who queued a first plan HAS done the nutrition setup, so they read as ready).
- `hasHabits` - client has active daily habits

Uses `Promise.all` with `safeQuery()` wrapper for partial failure tolerance. The coach sees the `ClientActivationBanner` component which shows the checklist status.

**The card lists a fourth row that is NOT on the wire: "Client profile"**, and it leads the list because everything below it is priced off it — the nutrition calculator solves against the TDEE the profile produces. It is derived in the browser by `findProfileGaps` (`lib/client-profile-completeness.ts`) from the client record the Overview already holds, so it costs no query and this endpoint keeps answering *"is it there?"* rather than *"what is in it"*. **`clients.tdee != null` is deliberately NOT the check**: `computeEnergyPair` hard-gates on weight/height/gender but silently substitutes `DEFAULT_BMR_AGE_YEARS` and `DEFAULT_WORK_ACTIVITY_LEVEL` for a missing birth date and activity level, so a client missing both still has a BMR and a TDEE built on two guesses. The gap list reads the computation's own `ageSource` / `activityLevelSource`, which also makes it exact rather than blunt: age is not asked for on the Katch-McArdle path (no age term), and activity level is not asked for once `tdee_manual_override` is set (the coach has overridden the only thing it feeds). It is a **prerequisite, not a plan** — it stays out of the "N of 3 plans ready" counter, the footer sentence and the activation dialog's missing-list, because activation sends nothing for it. Its "Set up" forks by gap: a missing **weight** is a logged measurement and goes to Journey → Physique; everything else is a profile fact and opens the Overview's own inline editor. `activation-readiness` is advisory — `POST /api/clients/[id]/activate` does not enforce it. No client write is gated on a plan: a meal is refused only by the day rule (`lib/daily-log-permissions.ts`) and saves without a version stamp on a day nothing covers — the stamp is provenance, and nothing that judges adherence reads it; the training writer (`POST /api/client/training/events/[eventId]/log`) carries its `training_plan_id` from the event; wellness and habits writes have no plan or adherence concept, and all wellness analytics are date-windowed.

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
- `/api/check-in/[id]/*` - coach-side per-check-in routes (detail, comparison, review, AI regenerate) behind `requireCoachOwnsCheckIn` (the review POST spells the same chain inline: `getAuthenticatedCoachId` + ownership); `apiRateLimit`, with the coach-keyed `aiRateLimit` on the regenerate. Not public since migration 142 — `checkInRateLimit` has no live route today; it survives only as `requireClientAuth`'s uncalled `rateLimit: "checkIn"` tier
- `/api/dashboard/*` - coach dashboard aggregation routes

---

## JSONB Conventions

- `training_data` / `activityStatuses` were the Daily Pulse training UI cache (now deleted). These shapes are no longer written; they persist only as dead data on legacy `training_logs` rows.
- (Legacy shape, for anyone inspecting old rows) `activityStatuses` is `Record<string, { completed, activityName, estimatedCalories }>` — read the `.completed` field, never use the object as a truthy check.
- `training_data` JSONB on `training_logs` was the Daily Pulse UI restore cache; it is now **orphaned** — no current code reads or writes it. The **source of truth** for training completion is `session_logs` + `exercise_logs` + `set_logs` (post migration 090; per-set actuals were inline scalars on `exercise_logs` before).

---

## Check-in System

**One stored fact: `clients.next_check_in_due`** (DATE, nullable — migration 154). NULL means the
client has no schedule.

| Question | Answered by |
|---|---|
| When is the next check-in due? | the stored date, through `resolveCheckInDue` (`lib/check-in-schedule.ts`) |
| Is this client overdue? | their live due date is in the past — `getDaysUntilOrPastDue > 0` |
| Has one lapsed? | `today > due + CHECK_IN_GRACE_DAYS` (7) → roll forward by whole frequency steps |
| Which seven days does a submitted check-in report on? | `calculateCheckInPeriod` / `resolveCheckInWindow` (`lib/date-helpers.ts`) |
| Where does this client's week start and end? | `getTrainingWeekStart/End`, anchored by `checkInWeekday` |

`check_in_frequency` / `check_in_frequency_days` are the advance step. `frequency = 'none'` means
no schedule, as does a NULL date.

**Two writers, and only two.** The coach's date picker (details sheet → Check-ins, and the
activation dialog's "First check-in") sets it outright; a submitted check-in advances it by one
frequency step from the due date it satisfied (`submitCheckIn`). Nothing else writes it. A failed
advance leaves the check-in standing and self-heals within the grace window — the check-in is the
client's work, the schedule is bookkeeping.

**A past due date is not a bug — it is how overdue is defined**, and it drives the roster's Overdue
view, its counts, the sidebar badge and the reminder sweep. The lapse roll keeps the live date
inside `[today − 7, today]`, so a client who stopped a year ago reads as days overdue rather than
365.

### The week anchor

**A calculation, never a second stored copy.** `checkInWeekday` (`lib/check-in-week.ts`) takes the
WEEKDAY of the due date — the weekday, not the date, so a fortnightly client keeps a steady weekly
rhythm rather than leaving every other week unassigned. With no schedule it returns the anchor for a
**Mon–Sun** week.

It is the ONE place the anchor is derived, and all twelve `getTrainingWeekStart/End/Days` callers
route through it: training, nutrition targets, habits, wellness, the attention feed and the client
portal. The module is pure so `habits-tab-content.tsx` can run it in the browser;
`getClientWeekAnchor` (`services/check-in-week-service.ts`) is its DB-fetching twin — the same split
as `lib/date-helpers.ts` / `services/today-service.ts`.

**`lib/check-in-week.test.ts` scans the tree and fails if a new caller sources the anchor itself,
or spells a weekday default of its own.** That guard is the point: the bug it replaced was not a
wrong default but a default spelled twelve times, which disagreed with itself in one of them and
measured the same client over two different weeks depending on which surface asked.

### The client-side gate

`getCheckInGate` (`lib/check-in-schedule.ts`) — a pure read of the stored date that asks nothing
about the client's check-in history.

| Status | When | The home card reads |
|---|---|---|
| `unscheduled` | no due date | **Not scheduled**, and the row carries no link |
| `not_due` | the date is ahead | **Next check-in 3 Sep** |
| `available` | the date is today | **Due today** |
| `overdue` | the date has passed | **Overdue — submit now** |

**An unscheduled client is refused, not waved through.** They have no due date to report against
and no period for a submission to cover, so `/check-in-context` 403s and `POST /check-ins` 409s.

**`not_due` covers "already checked in" as well as "not your turn yet"** — submitting advances the
date, so those are one state. **Do not add a `completed` state back.** Distinguishing them needs a
rule about which cycle a submission belonged to, and every such rule shows a client who checked in
three days late "completed" on their NEXT due day, hiding a check-in they owe.

**The gate lives beside `resolveCheckInDue`, not among the period helpers in `lib/date-helpers.ts`.**
"Is a check-in due?" is a schedule question; a gate surrounded by period maths reaches for it, and
re-derives a period from a weekday instead of reading the date.

### One check-in per period

Enforced twice, because a duplicate advances `next_check_in_due` twice and the client silently skips
a cycle — and the realistic cause is a double-tap or a background retry, neither of which passes
back through the form screen.

- `POST /api/client/check-ins` re-checks the gate and returns **409**, *before* the photo uploads,
  so a refusal leaves no orphaned storage objects.
- A partial unique index on `check_ins (client_id, period_end) WHERE period_end IS NOT NULL`
  (migration 156) is the backstop that does not depend on a future caller remembering. `period_end`
  alone identifies the period — `period_start` is clamped forward for a partial first week and moves
  on its own. `submitCheckIn` translates the resulting `23505` into a readable sentence; a client
  never sees constraint text.

### A submitted check-in closes its period

A check-in is a record of its week, so once it is sent nothing in that week can change: the client
can no longer log, edit or move anything on or before its `period_end` (owner decision 2026-09-04 —
the full rule, including the roll on the next check-in day, is under "Date-edit permissions"). There
is no reopen and no same-day warning; after the close only the COACH changes anything about that
week, and only readings, from the Journey's measurement log.

That is what keeps the figures a check-in freezes at submit — `workouts_completed`,
`adherence_percentage`, `nutrition_days_on_target`, the five wellness averages and `period_snapshot`
— from going stale against the coach's review, which reads the period's logs live. Before the close
a client who backfilled a day after submitting moved the review while their own copy stood still.
The same index that enforces one check-in per period serves the boundary read
(`getLastSubmittedPeriodEnd`), so the close costs one indexed lookup.

The freeze is one INSERT: `submitCheckIn` derives the columns and builds `period_snapshot` from
the same kernel run (`getNutritionPeriod` → `buildPeriodSnapshot`, `lib/check-in/period-snapshot.ts`),
and the AI review's nutrition — on the client-submit path and on the coach's Regenerate — is those
frozen rows and the kernel over them (`getCheckInNutritionPeriod`). The coach's review page still
reads the period live, so a plan the coach changes after submit moves the review's targets while
the client's card keeps the frozen count; that gap is the open item in `docs/CHECK-IN-FINDINGS.md`.

### The customisable form (migration 157)

A coach chooses which of the check-in's built-in fields a client is asked, and
adds free-text questions of their own. Five tables, no column on `clients` or
`check_ins`.

| Table | Holds |
|---|---|
| `check_in_questions` | the coach's question bank — one row per question |
| `check_in_forms` | one form. `client_id NOT NULL` = that client's own (at most one); `client_id NULL` = a named TEMPLATE in the library |
| `check_in_form_fields` | `(form_id, field_key)` — row present = the form asks that field |
| `check_in_form_questions` | `(form_id, question_id)` + `position` + `enabled` |
| `check_in_answers` | one per `(check_in_id, question_id)` |

**No form row means the full form.** That default is the entire backward-
compatibility story: there is no backfill, and every client who has never been
customised is unaffected. `getClientCheckInForm` resolves absence to all 14
field keys and no questions.

**Fourteen field keys, and they are the complete set of fields the client fills
in** (`lib/check-in/form-fields.ts`, CHECK-constrained in the migration — adding
one means editing both). `mood` / `energy` / `sleep` / `stress` / `soreness` are
NOT among them and must not be added: Session 6.4 removed their pickers and
sliders, and `submitCheckIn` derives all five from `wellness_logs` over the
period, so a key there would promise a toggle over a field nobody fills in. The
Feeling step's weekly summary and the Training step's session checklist are
read-only viewers of the client's own week — and the checklist is a fill-gap
LOGGER writing to `training_events`, offering Completed or Partial and nothing
else, whose save records an outcome and leaves the workout's logged sets exactly
as they are — so they carry no key either, and the two steps are unconditional. With every key off a client still gets a two-step
"here is your week, confirm it" check-in. (Making those two viewers suppressible
is a 16th/15th key and a different feature; `TECHNICAL-DEBT.md` records it.)

**A question is a row, not a string copied onto each form.** Rewording it
changes the question everywhere it is asked AND relabels every past answer,
because it is the same question — `check_in_answers` carries no prompt snapshot
and resolves through the FK. An answered question cannot be deleted
(`check_in_answers.question_id` refuses it), so `archived_at` is the retirement
gesture; an archived question leaves every form's view while its answers keep
resolving. The FK is `ON DELETE NO ACTION`, not `RESTRICT`, deliberately: NO
ACTION defers to end-of-statement, so a full coach/client teardown that removes
the answers in the same statement still succeeds, while a bare delete of an
answered question still fails. RESTRICT would have made that a coin-flip on
cascade order, and there is a live coach-delete path (`scripts/seed-scale-client.ts`).

**Both writes are atomic.** `save_check_in_form_atomic` (a client's form) and
`create_check_in_form_template_atomic` (a template) each replace three tables in
one transaction, through a shared `check_in_form_write_children` helper that
re-proves in SQL that every referenced question belongs to the calling coach —
the route proves the coach owns the CLIENT and cannot prove that. Neither RPC
has an optional parameter: the generated `Args` type never emits `| null`, so a
`DEFAULT NULL` parameter would force an `as never` at the call site.

**Templates are copy-based**, like every other library object here: applying one
REPLACES the coach's editor state in the browser and they commit it through
`PUT /api/clients/[id]/check-in-form`. There is deliberately no server-side
apply route — a template is a starting point the coach reviews, not a write that
lands behind their back. The join rows are copied; the questions are shared.

**The form never touches a `clients` column.** `updateClientCheckInConfig` is a
full replace of the four scheduling columns, so routing a form save through it
would clear `next_check_in_due` (see "Two writers, and only two" above).

**The coach edits it from the Check-ins tab**, through the "Customise
check-in" action on that tab's `Check-in history` rail — deliberately not the
Overview, which is read-only. It opens a 780px sheet (`check-in-form-sheet.tsx`)
whose two cards are the 14 built-in fields, grouped by the wizard step each sits
on with a `Switch` per row, and the coach's own questions with drag order,
on/off, wording and membership. **The editor is mounted only once the form has
loaded**, inside the sheet's `SheetContent` — which Radix unmounts on close, so
one editor lifetime is one open and its draft state is initialised from the
saved form at mount rather than synced by an effect. That is what makes "a
revalidation cannot clobber edits in progress" structural, and it is why a
coach can never save an empty form over a real one: the editor does not exist
without data. **Rewording is edited here but belongs to the
bank row**, so the editor updates its own list as well as revalidating — an
invalidate-only reword would leave the old wording on screen while the card
promises the change lands everywhere.

**The client's wizard derives its steps from the form**, through
`stepsForFields`: Feeling and Training are unconditional (they read the client's
own week back to them), Metrics and Photos appear only if some field on them is
asked. `applyCheckInForm` runs in the browser too, so a saved draft that
predates a coach's change is shaped before it is sent — the server's own strip,
after its gate and before the photo uploads, remains the authority.

**Wire.** `GET /api/client/check-in-context` carries an additive
`form: { fields, questions }`; `POST /api/client/check-ins` accepts optional
`customAnswers: [{ questionId, answer }]` (≤ `MAX_CHECK_IN_QUESTIONS`).
`GET /api/client/check-ins/[id]` and `GET /api/check-in/[id]` return
`customAnswers` with prompts joined — the single-check-in reads only, never the
history LIST, which stays a sparse fieldset. A submission carrying a disabled
field is **stripped, never 400'd** (`applyCheckInForm`, shared by the browser and
the server): a payload with a disabled value is a client who loaded the form
before the coach changed it. The server strips **before the photo uploads**, so a
disabled photo is never uploaded and then discarded.

**The answers are a second statement after the check-in INSERT and are NOT
swallowed.** If they fail, the check-in stands without them, the POST 500s, and
the client's retry meets migration 156's period-unique constraint. Surfacing it
is deliberate — silently losing a client's typed answers is worse — and closing
the seam means moving the check-in INSERT itself into an RPC.

### The coach review surface

`components/clients/check-ins/check-in-detail-view.tsx`, rendered by the Check-ins tab in place of
its list whenever `?checkIn=<id>` is present (the tab's single-owner param — see "Client page tab
structure").

**One page, no switcher**, read in the order the review runs: the KPI ribbon (Weight, Body Fat,
Nutrition, Training), then Training beside Nutrition, Wellness, Habits, Client notes, Goal
progress, the AI review, and last the Reply. Training and Nutrition share a flex row rather than a
two-column grid: either returns null on an empty week, and a lone survivor takes the whole row
instead of leaving a hole. **Every section renders its own `SectionLabel` rail, inside the
component that decides whether it has anything to show** — five of them return null on an empty
week, so a rail owned by the page would stand over empty space, or the page would need a second
copy of each child's emptiness predicate. Every card is borderless white on the `#f4f7f6` page per
the SOT's "spacing does separation, not borders"; nothing animates in; names and body sit at 13px
like the rail. The header is the sidebar back-row grammar ("← Check-ins") over a mono meta line:
the week, the submitted date, `N/M days logged` (days in the period with any client log — the
derived definition in "Daily Logs", read as `periodAdherence.loggedDates` over
`periodAdherence.dates`, so the fraction and the cells below it share one date list; the chip is omitted on a legacy row whose period cannot be resolved) and
`N days since last check-in`. There is no prev/next between check-ins
and no window keydown listener. Weight and body fat appear twice on purpose: the band answers
"what changed since last time", the strip answers "where do they stand against the goal".

**The goal strip** (`check-in-goal-strip.tsx`) is one row per goal — weight, body fat — each a
value, a track and a state column resolved `status` > `paceStatus` > `isOnTrack`: `Reached` (with
the distance past target on an overshoot), `On track`, `Behind pace`, `Deadline unrealistic`,
`Needs attention`, the last four carrying the distance to go — or `No reading yet`, muted, when no
reading existed as of the check-in's day: the position is the reading as of that day — the
check-in's own stamped row, else the newest reading before it (see "Goal progress and pace") — never
today's, so a check-in submitted without a weight is judged from the reading before it, and a
check-in from May is judged as May: against the goal version in force then, with the days then
remaining to its deadline. `paceStatus` judges whether the RATE
REQUIRED to hit the deadline is safe; `isOnTrack` whether the client is moving towards the goal;
reading them in that order is what keeps "On track" off a client past a weight-loss target. Body
fat carries no pace status and falls through the same column, so the two rows cannot reach
different verdicts about one client. The deadline is the rail's meta (`deadline d MMM · N days`,
or `Overdue by N days`); with no goals — none set, or none in force on the check-in's day — the rail
stands over a verbatim empty state. **One advisory
footer, and goals outrank nutrition**: every judged goal met (a `No reading yet` row neither earns
the note nor blocks it) AND the goal judged still the client's live one (`goalIsCurrent`; a page
about a goal since replaced never invites replacing it again) → "Goal met - consider setting a new target."
with the `Set new goals` button, which sends the coach to the Overview with `?editProfile=1` and
`checkIn` cleared (the details sheet opens on arrival, and the Overview's address carries no
check-in); otherwise, the reading as of the check-in's day 3 kg or more from the base weight of the
nutrition version covering that day →
the drift note naming the distance and the date the targets took effect, with no button. Targets
built for a goal the client has passed need the goal reset first, so a nutrition note never
appears beside a met goal.

**The comparison read's states live on the strip.** Goal progress is the one section the
`…/comparison` read feeds on its own, so it carries that read's spinner and its failure notice
under its own rail; the band's deltas and the wellness deltas degrade in place (no comparison, no
delta), and every detail-fed section still renders. A `?checkIn=` id belonging to another client
renders the foreign notice and nothing else.

**The AI review is ONE card** — Regenerate as its header action, three blocks inside: Summary,
What to watch, Coach actions. Every one of them, and the Client Notes card's Reflection / Wins /
Challenges, renders through `components/clients/check-ins/review-block.tsx` (`ReviewBlock` /
`ReviewProse` / `ReviewList` + `ReviewListRow`). That primitive is the whole vocabulary — a
labelled block, a run of prose, a marked list — so the surface has one label treatment.
**`ReviewProse` sets `whitespace-pre-wrap`**: every string on this surface is free text a client
or the AI wrote, and their line breaks are content. It lives in the coach folder and is imported BY
the mixed `components/check-in/` tree, which is deliberately not relocated (it still holds
client-facing wizard steps with their own importers).

**What the review is given.** `getCheckInReviewInput` (`services/check-in-review-input-service.ts`)
assembles ONE input per check-in (`CheckInReviewInput`, `types/check-in-review-input.ts`) from the
page's own reads: the check-in with its answers and highlights, the period's workouts with their logs
(`getTrainingEventDetailsForPeriod`) and their exercise lines (`getExerciseSummariesForPeriod`), the
nutrition rows the check-in froze and the kernel over them (`getCheckInNutritionPeriod`), the habit
figures and the logged days (`getCheckInPeriodAdherence`), the day-form rows (`getDailyLogs`) and the
comparison behind the goal strip (`buildCheckInComparison`). `buildCheckInReviewPrompt`
(`utils/ai-prompt-builder.ts`, with `utils/ai-prompt-week.ts` and `utils/ai-prompt-day.ts`) writes it
out. The client's submit (`triggerAISummaryGeneration`) and the coach's Regenerate route both call the
same two functions, so a review written at submit and one regenerated later start from the same week;
the unit system is the owning coach's, resolved inside the input builder. `generateCheckInReview`
(`services/ai-service.ts`) sends the brief as the system message and the week as the user message to
gpt-4o, with `CHECK_IN_REVIEW_MAX_OUTPUT_TOKENS` of room and `CHECK_IN_REVIEW_TIMEOUT_MS` on the call
(`lib/constants.ts`); the Regenerate route's `maxDuration` sits above the timeout so the platform cannot
cut the call off first. `npm run print:check-in-prompt -- <check-in id>` prints what the model is given
for one check-in without calling it.

**The brief is a coach's job, described in full, not a rulebook** (`CHECK_IN_REVIEW_BRIEF`,
`utils/ai-system-prompt.ts`; owner decisions 2026-09-18). The model is told it is an experienced coach
reviewing the client's week for the coach who trains them, what it is given, and the report wanted: the full
report a coach would write for a fellow coach, not a summary — what happened; what is most likely driving
each thing and why, connecting days and measures; what to expect next week if nothing changes and what would
change that; what to do, with the reasoning behind every recommendation; an explanation offered as a
question where it cannot be sure; as much as the week deserves, in paragraphs — in British English, plain
text with paragraph breaks and short plain section lines, with one duty-of-care line: injury, persistent pain
or disordered eating raised first, gently. There are no if-then rules, no sentence or item counts, and no
"N of M days logged" count anywhere in what it is given. The output shape (`describeReviewShape`,
`utils/ai-analysis-format.ts`) names the card's parts — summary, watch items with a type, themes, coach
actions with a priority, the client message — and says what depth each carries, never a length; an
`analysis` field comes first, the model's working written before its conclusions, which the parser
(`lib/validations/check-in-review.ts`) drops and which caps no list either.

**The week is given day by day, every figure the page's own.** First the client's weight and body fat
with the change the ribbon shows (`metricComparison`) and the goal strip as it is drawn — the rows, the
deadline and the footer note through `lib/check-in/review-figures.ts`, which the strip and the ribbon
import too, so the model and the page cannot word one verdict two ways. Then the week's figures: the
session count through `summariseTraining` (a partial workout counts as done, the breakdown beside it),
the Nutrition card's sentence figure for figure, the wellness changes since the last check-in
(`formatDeltaValue`), and each habit's count over its eligible days. Then each day of the period: every
workout on it — a logged one with the quality off its log, its note and one line per logged exercise,
set by set, target beside result, measure by measure, in the coach's units, naming every measure outside
its target (`describeLoggedExercise`, `utils/logged-exercise-line.ts`: "Barbell Back Squat — 3 of 3
working sets: Load (kg) 102.5, 102.5, 107.5 (target 100–105 kg; 1 of 3 above target); Reps 5, 5, 4
(target 5; 1 of 3 below target); RPE 8, 9, 10 (target 8; 2 of 3 above target)"), with no cap on lines,
and a timed group as a line of its own above its exercises' — its heading and its score, or "not scored"
("AMRAP · 12m — 7 rounds + 12 reps", "For time · 3 rounds · 12m cap — Capped · 2 rounds + 15 reps",
"EMOM · 6 rounds · every 1m"), known from its exercises' snapshots and its score row, so a scored group
none of whose exercises were ticked still reaches the review; an exercise in an AMRAP or For time reads
"per round" rather than as a count of sets done;
a workout never logged as its name, missed — then the food row the check-in froze (what was eaten beside
the target, with the kernel's standing), the day's wellness scores, each habit ticked or not (by the
habit list's rail, so a habit the client ignored all week still appears), and the client's day note.
"Nothing logged" is written wherever nothing was, source by source, and a day with no log by the one
definition (`loggedDates`, see "Daily Logs") opens with it. Last come the client's own words —
Reflection, Wins, Challenges, exercise highlights, and the coach's questions with their answers — passed
whole up to `AI_PROMPT_TEXT_LIMIT`, every typed string through `sanitizeForAIPrompt`. The previous
check-in speaks only through the changes above. `utils/ai-prompt-builder.test.ts` pins the assembled
text for a fixture week.

**The nutrition rows are the frozen ones.** The model reads the rows the check-in froze at send, so an
old review regenerates against that week as it stood; the page's Nutrition card reads the current plan
(`getCheckInPeriodAdherence`), so the two agree unless the coach changed the client's targets after the
check-in was sent — the open item in `docs/CHECK-IN-FINDINGS.md`. Everything else the review is given is
read live, exactly as the page reads it.

**Empty states.** When the AI half is wholly empty the card shows a single placeholder ("No AI
review yet. Regenerate to write one.") rather than one per block. Regenerate reports a non-OK
response, the coach-keyed `aiRateLimit` 429 included.

**The Reply block** (`check-in-reply-block.tsx`) is the last section and the destination of the
page: everything above it is what the coach reads before writing it. Full width, one primary
button, Copy beside it. The draft is the review's `clientMessage`, a prop synced by effect, so a
Regenerate replaces it rather than leaving a stale draft to be sent. **A sent reply does not lock
the block**: the previous message becomes context above a live box, the rail dates it
(`Sent MMM d`) and the button reads `Send follow-up`. A successful Send refreshes the list and
returns the coach one step back — the list when they came from it. The block renders whether or not the AI has run — the coach's message is
not the AI's output.

**The comparison payload carries only what the page renders.**
`GET /api/check-in/[id]/comparison` returns `previous` (a null-check for "is there anything to
compare against"), `timeBetweenCheckIns`, the drift-note fields as of the check-in's day (the reading
then as `currentWeight`, with the base weight and effective date of the nutrition version covering
that day), `goalProgress` — position, trend and pace status per goal against the version in force at
the check-in's instant, nothing projected, plus `goalIsCurrent` — and seven `changes`: weight, body fat and the
five wellness metrics, each a signed difference against the previous check-in, present only when
both check-ins carry the metric — the readings being each check-in's own stamped rows in the
measurement log, so a reading logged between the two never enters the comparison. Every delta the
page draws goes through one rule
(`formatDeltaValue`, `components/check-in/delta-format.ts`): rounded to one decimal like the value
beside it, coloured by its direction, neutral only at 0.0. **There is no chart series
at all**: the band shows a value and a delta, and a trend line behind them read as chart junk on a
dark strip. Girths, `workoutsCompleted` and `adherencePercentage` are not on it either, and neither
is the current check-in (the caller fetched it by id). `workoutsCompleted` is why: deriving it cost a
second read of the period's workouts per request, one for each side, purely to render a
delta — the KPI ribbon's fraction and its `N partial · N missed` breakdown answer the same
question from data already in hand.

**Data: `hooks/use-check-in-detail-data.ts`, SWR throughout.** `GET /api/check-in/[id]` and
`…/comparison` read in parallel behind `checkInDetailKey` + `useInvalidateCheckInDetail` (the area
is the detail and everything under it). The window's daily and habit logs come through
`useWellnessData`'s explicit `range` — the same reader the Overview's wellness cards use, so those
two keys have one builder. The window is the stored `period_start`/`period_end`, else the six
days up to `created_at` (pre-Session-6.4 rows). Two stages — the detail and its comparison, then
the window's logs; SWR dedupes re-opens. The nutrition figures ride the detail wire from the
kernel and the period's workouts ride beside the check-in; the browser folds no target of its own and
counts nothing but that one `summariseTraining` run.

**The figures, and what they divide by.** The review's nutrition and habit
numbers are computed SERVER-side over the check-in's own reporting period and
arrive on `GET /api/check-in/[id]` as `periodAdherence`
(`getCheckInPeriodAdherence` → the shared Overview kernel's
`getClientAdherenceForRange`). Nutrition is the nutrition kernel's summary
(`utils/nutrition-period-summary.ts`) plus the rail: days on target over the
days a TARGET WAS PRESCRIBED — a skipped targeted day is a miss, a day with no
target is in no ratio, and a period with none reads "No targets set", never
0/7 — with the calorie total, the period HIT/PARTIAL/MISSED verdict and the
per-day averages all from the same run, each over its named day set. Habits
divide by eligible days, from `periodAdherence.dates` — never a day count
derived in the renderer, which resolves differently on a legacy row. The KPI
ribbon's **Nutrition** cell is that fraction; the Nutrition card renders the same summary and
computes nothing — it takes no log rows (`nutrition-section.test.tsx` scans
for it). Habits come from `perHabit`, built from the HABIT list, so a
habit the client ignored all week reads 0/7 instead of vanishing — `logHabit`
writes a row only when they act, and the old grid read `/habits/logs`. **Training
is deliberately NOT on that wire**: the review already carries the period's own
workouts and counts them once with `summariseTraining`, so putting a second
training figure on this payload would be a second derivation of the same
number.
`periodAdherence` is `null` when a legacy row's period cannot
be resolved (pre-038 and no schedule to anchor a week to), and the cells render
their empty states rather than fall back to a second definition.

**Training comes from the period's own workouts, counted once.** Both single
check-in reads carry them beside the check-in as `trainingEventDetails` — the
same per-workout rows the client's wizard is given
(`getTrainingEventDetailsForCheckIn` over `getTrainingEventDetailsForPeriod`,
each row its attendance word plus the quality on its own log, and empty when the
period cannot be resolved) — and `summariseTraining`
(`lib/training-adherence.ts`, see "How a workout reads") is the ONE function
that counts them. There is no stored per-session table and no second
per-check-in shape: the review's KPI ribbon and its pills, the wizard's Training
Summary, the AI prompt and the figure the submit freezes all come out of that
one summariser. A SECOND definition is what is forbidden, and
`lib/training-adherence-ownership.test.ts` scans every check-in surface for the
shape that has shipped twice: a read of the stored `check_ins.workouts_completed`
column, which is frozen at submit and never moves after (that column is the
client's — their own surfaces read it back legitimately). Rendering it beside a
live figure put "3/5" on the ribbon above an AI summary saying "completed only 2
out of 5" for the same week. The scan's second rule — no hand-rolled count over a
status or a quality — retired with migration 182: `status === 'completed'` is now
the same answer the summariser gives, so the rule was forbidding a spelling
rather than a defect.

**Three day sets, and every figure names its own** (owner decision
2026-09-11). LOGGED days are coverage, over the period. TARGETED days — the
days a target was prescribed — are the adherence denominator: an unlogged
targeted day counts against the client, exactly as a skipped session does on
the training side. JUDGED days — logged and targeted — are the only days
intake can be compared with a target, so every average of intake against
target divides by them, and a card compares calories and macros over the same
days. A logged day with no target is counted as logged and nothing else; the
review card names it ("1 logged day had no target and is not counted"). The
wellness means are unchanged: each metric divides by its OWN logged days
(stress and mood can be logged on different days), because an unlogged day is
**unknown, not zero** — dividing by days with no data does not make an average
smaller, it makes it wrong.

**The stored figures** — `check_ins.nutrition_days_on_target` and
`adherence_percentage` — are the kernel's `onTarget` (over the targeted days;
NULL when no day had a target) and its `calorieAdherencePct` (intake on the
targeted days the client logged, over the targets of every targeted day),
written by `submitCheckIn` from the ONE kernel run that also freezes
`period_snapshot`, so the count, the frozen rows and the client's card cannot
disagree. The client wire carries `nutritionTargetedDays`, counted from the
frozen rows, as the count's denominator, and both figures are RN-visible
(`CLIENT-APP-REFERENCE.md` → Adherence Calculations).

**`check_ins.workouts_completed` is the training one, and it counts every
workout the client LOGGED** — `summariseTraining`'s `completed`, full or
partial, over the same period's workouts the snapshot freezes. It is a
submit-time snapshot: it never moves after, so a day the client backfills later
shows on the coach's live surfaces and not on it. Check-ins submitted before
migration 182 keep the full-only number they stored; there is no backfill (§4.7
M13).

**The client-id guard.** The detail is fetched by check-in id but the context by the page's client
id, and `GET /api/check-in/[id]` refuses only a *foreign* coach — a coach's own other-client id in
the URL would pair one client's check-in with another's logs and targets. A check-in whose
`clientId` differs from the page's renders the error state and fetches no context.

**After Send** the rail reports done and the tab does three things before going back: its
own bound list `mutate()` (a filter mutate cannot reach a `useSWRInfinite` reader),
`useInvalidateClientCheckIns` (the Journey reader's page caches) and `useInvalidateCheckInsQueue`
(the bell and the toast listener). Regenerate revalidates the detail in place through its bound
mutate.

### The React Native contract

`/api/client/check-in-status`, `check-in-context` and `notifications` are read by the mobile client.
**Additive OPTIONAL keys are allowed.** Their three test files are the
guard — `check-in-context`'s asserts the exact sorted key set, so an addition is a deliberate edit
rather than a drift — and they exercise the real gate rather than mocking it, so the wire values
themselves are covered. "No schedule" is tested at the call site (`nextCheckInDue == null`), because
`checkInWeekday` never returns null.

**`CheckInContextResponse` (`types/check-in.ts`) is that contract, and it describes the WHOLE
payload.** It used to describe five of eleven keys while the route added the rest through a local
inline intersection and `hooks/use-client-check-in.ts` kept a third private copy of the same shape;
both were deleted when the `form` key landed. A payload key with no type is how the wire and this
document drift apart, and the RN work is read off that type.

Two keys have been added this way: `trainingEventDetails` (Session 6.2) and `form` (the customisable
form). Until a client app reads `form` it renders the full form and sees no custom questions — which
is exactly what every client gets today.

---

## External Consumers

Tables in this database written or read by a codebase **outside this repo**. Nothing in this codebase selects from them, so they look dead to any "unused tables" audit that only greps this repo. They are not dead. Confirm with the owning repo before dropping one.

### `waitlist_signups` (migration 138)

Private-beta waitlist for the public marketing site.

- **Written by:** the `atletafit-marketing` repo — separate repo, separate Vercel project, serves atletafit.com — from `app/api/waitlist/route.ts`, over PostgREST. It authenticates with its **own dedicated secret key**, not this repo's `SUPABASE_SERVICE_ROLE_KEY`, so it can be revoked on its own if it leaks.
- **Read by this repo:** nothing. No route and no service here touches it. It *does* appear in `types/database.ts`, because that file is a mechanical `supabase gen types --linked` mirror of the whole schema — omitting it would only mean the next schema change dropped a stray waitlist hunk into an unrelated diff. A type with no callers is not a sign anything here reads the table.
- **Why it lives in this project:** the alternative was a second Supabase project, and a free-tier one pauses after a week of inactivity — silently breaking the live form. This repo therefore owns the schema, by migration rather than by hand, so `supabase db reset` reproduces the table instead of dropping it.
- **Contract — do not change without changing the marketing repo first**, because that repo is not rebuilt when this one deploys, so a break here is silent in production:
  - Column names (`name`, `email`, `updates`, `consented_at`) are read directly by that route.
  - The unique index is on `LOWER(email)`, not `email`. The route detects a repeat signup by catching Postgres error `23505` and rendering "You're already on the list." An upsert, or dropping the index, removes that signal.
  - `updates` and `consented_at` are UK GDPR Art. 7(1) consent evidence, not preferences: the burden is on us to show what someone agreed to and when, so `updates = false` has to be a stored "no". Keep both `NOT NULL`; keep the default.
- **RLS is enabled with zero policies, deliberately.** Note that the default privileges on `public` still grant `anon` INSERT (`pg_default_acl` → `arwdDxtm`), so RLS is the *only* thing holding this table out of reach of the publishable key that ships in the browser bundle. Adding an `anon` policy would open a direct write path bypassing the marketing form's honeypot and Turnstile. Secret keys bypass RLS, which is how the route still writes. This table satisfies `npm run check:rls` clause 1 as-is.
