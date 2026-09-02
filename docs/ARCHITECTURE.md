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
  ├── check_in_questions            -- the coach's question bank (edited in place, archived not deleted)
  ├── check_in_forms                -- client_id NULL = a named reusable TEMPLATE in the library
  │     ├── check_in_form_fields        -- (form_id, field_key) — row present = the form asks it
  │     └── check_in_form_questions     -- (form_id, question_id) + position + enabled
  │
  └── clients                        -- coach_id FK, one coach per client
        ├── training_plans            -- MANY coexisting provenance rows (date-range, no singleton); saved_plan_id FK tracks library provenance (nullable)
        │     ├── training_sessions   -- carries calorie_surplus_percentage (source for nutrition cascade)
        │     │     └── training_exercises  -- exercise_id FK to exercises catalog
        │     └── training_events        -- one row per session per date (calendar SOT; training_plan_id FK is SET NULL)
        ├── nutrition_plans           -- DATE-RANGED VERSIONS tiling the client's timeline (close-and-insert; mig 144)
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
        ├── check_in_forms            -- the CLIENT's own form (at most one; no row = the full default form)
        ├── check_ins                 -- weekly structured submissions
        │     └── check_in_answers    -- one per (check-in, custom question); prompt read through the FK
        ├── client_goals              -- versioned goal records
        ├── client_notes              -- coach notes about the client (one pinned max)
        ├── client_metric_entries     -- coach-logged WELLNESS entries (one per client, metric, day)
        └── client_measurements       -- every body measurement, one row per reading (append-only log)
```

---

## Client Goals & Body Metrics

### client_goals table

Versioned goals using the `effective_from` / `superseded_at` pattern:
- New goals are created as new rows (never update existing records)
- The previous active goal gets `superseded_at = NOW()` when a new goal is set
- Unique index ensures one active (non-superseded) goal per client
- Fields: `goal_weight`, `goal_body_fat_percentage`, `goal_deadline`, `goal_start_date`, `primary_goal`, `set_by`, `notes`
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
  `updateGoalsSchema`. The other four fields accept explicit `null`.
- **`goalStartDate <= goalDeadline`** is refined in `updateGoalsSchema` (and mirrored in the
  Overview form for the inline message). A refine sees only the payload, so a **partial** update
  carrying one date can still land an invalid pair against the stored other one — the complete
  check belongs inside `updateGoals` after its merge and is not built.
- **The editor is the client details sheet** (`use-client-profile-edit.ts` +
  `components/clients/details/**`) — goal weight, goal body fat, goal start and deadline, in its
  Goals & energy group. The nutrition drawer shows a read-only line; its editor was deleted.
  Setting a goal no longer requires opening a nutrition plan. The Overview page itself is
  read-only: the status band DISPLAYS both targets and the sheet is the one way to change them.
- **Routes:** `GET`+`PUT /api/clients/[id]/goals` (`data` is always `ClientGoal | null` — the old
  shape-switching `?history=true` branch is gone) and `GET …/goals/history`, which returns
  **superseded versions only**, newest first, bounded by `GOAL_HISTORY_LIMIT`. The past-deadline
  bound is route-side against the **coach's** local today, deliberately not in the schema.

### Effective goal resolution

A single pure resolver, `resolveEffectiveGoal()` (`lib/goals/resolve-effective-goal.ts`), turns the live `client_goals` record into the goal that drives nutrition + pace. It normalizes **nothing** — `client_goals.goal_weight` is canonical kilograms (migration 141), so the resolver reads it straight through and its old `weightUnit` parameter is gone rather than ignored. A NULL weight means **maintenance** (`goalWeightKg: null`). `startDate` falls back to `today` when `client_goals.goal_start_date` (migration 104) is unset.

**Six direct callers** (re-derived 2026-08-29 — the 2026-08-13 list missed `client-journey-service`, added the day before it was drawn up; the Overview joined them in Session 0b Task 0b.1. An older list still named the orchestrator, which has not called this resolver since it moved to `resolveNutritionCalcInputs`, and omitted `nutrition-calc-inputs.ts` entirely):

- `services/nutrition-calc-inputs.ts` — the shared calculator-input resolver, and the **only** route to `resolveEffectiveGoal` for both the nutrition write path (`nutrition-plan-orchestrator.ts` calls `resolveNutritionCalcInputs`, not this resolver) and the coach nutrition GET.
- `services/comparison-service.ts` — check-in weight pace; weight **and** deadline come from one scope. Client-local `today`.
- `app/api/clients/[id]/nutrition/route.ts` — the goal-drift check ("Goal changed — regenerate"), a second independent resolve in the same request as the one above.
- `components/clients/client-overview-tab.tsx` — the coach Overview's status band and its details sheet, fed by one SWR read of `GET /api/clients/[id]/goals` (`hooks/use-client-goals.ts`) and passed down as a prop. Client-local `today`, resolved from the in-scope client record: the goal's start date is on the **client's** calendar, the same anchor and reasoning as `comparison-service`. The card this band replaced previously read `clients.goal_weight` / `goal_body_fat_percentage` directly and was the last coach surface rendering an unresolved goal.
- `components/clients/metrics/hooks/use-merged-metrics.ts` — the coach Journey: the goal line and the "to go" figure on the Weight and Body Fat heroes.
- `services/client-journey-service.ts` — `GET /api/client/journey`'s goal weight and deadline (owner decision 2026-08-12: the one client-facing surface that reads `client_goals`, and the deadline, through this resolver). Client-local `today`. It composes its input inline from the `client_goals` row alone — no `clients.*` mirror leg, by that decision, and the service holds no `Client` record for `toClientGoalInput` to read one from — so it is not on the shared composer below either.

**The resolver's input is composed by one shared helper, `toClientGoalInput(currentGoals, client)`** (same module), used by the five callers above that hold a `Client` record — every one but `client-journey-service` — `use-merged-metrics` joined them in Session 0b Task 0b.3, replacing a private literal that hardcoded `deadline: null, startDate: null` after fetching the full goal. Weight and body fat carry a `?? client.*` mirror leg — the documented read switch for a client whose goal predates `client_goals`. **The deadline does not, and must never regain one:** `mapClientRow` has never mapped `clients.goal_deadline`, so `Client.goalDeadline` was permanently `undefined` and the three `?? client.goalDeadline` fallbacks were unreachable code. Both the field and the fallbacks were **deleted** in Session 0b Task 0b.1 (owner decision 2026-08-12) rather than the column being mapped: mapping would have made a mirror deadline that can silently diverge — `updateGoals`' mirror write is logged-and-swallowed — reachable in three calculator/pace paths for the first time. Pinned by test in `lib/goals/resolve-effective-goal.test.ts` and `services/nutrition-calc-inputs.test.ts`.

### Goal progress and pace

**Position reads the client record, never a check-in.** `deriveGoalProgress` (`lib/goals/goal-progress.ts`) is the one composer of the primitives below. It takes the effective goal and the client record's readings — `Client.currentWeight` / `currentBodyFatPercentage` as the position, `startingWeight` / `startingBodyFatPercentage` as the start, all four derived from the measurement log (see "client_measurements table") — plus the trend and the deadline arithmetic, and returns `GoalProgress` with a row for **every goal that is set**. A check-in is a report of what the client typed that week, every field on it optional; it is not among the kernel's inputs, and a check-in without a weight changes nothing on the goal strip. A row's `position` is `null` when the record carries no reading for that metric, and the strip renders it as `No reading yet` — the goal is real, the verdict is not. `services/comparison-service.ts` is the only caller; `lib/goals/goal-progress-ownership.test.ts` fails if anything under `services/` or `lib/goals/` calls `calculateGoalProgress`, `deriveGoalStatus` or `computeGoalPace` directly, or hands the kernel a check-in field.

`calculateGoalProgress` (`utils/comparison-utils.ts`) answers where a client stands relative to a goal. It returns two independent facts, and collapsing either into the other is what makes a goal card contradict itself:

- **`status`** — POSITION. `approaching` | `achieved` | `overshot`, from `sign(goal − start)`. With no starting value there is no direction to overshoot in, so the answer is `approaching`.
- **`isOnTrack`** — TREND. Whether the client is moving towards the goal.

`remaining` is **signed**. A renderer showing a magnitude reads `status` first: the magnitude answers "how far to go" only while a goal is being approached, and is the distance *back* to the target once it has been passed. `percentComplete` is clamped to 0-100 for the progress bar and reads 100 once a goal is met.

`computeGoalPace` (`lib/check-in/goal-pace.ts`) compares the rate **required** to hit the deadline against a safe ceiling of 1% of bodyweight per week, and returns `null` for an achieved or overshot goal. It measures the required rate, **not** the client's current pace: that is `isOnTrack`, the average change per week across the last ten check-ins pointed at the goal or away from it, and the two can legitimately disagree — a client losing steadily is on track and still behind pace when the deadline asks for more than the ceiling allows.

**The goal strip's state column reads `status` > `paceStatus` > `isOnTrack`.** A met goal renders no remaining distance and no pace check, and the strip's footer suggests a new target once every goal the record can judge is met — a `No reading yet` row neither earns the note nor blocks it. Weight and body fat resolve through the same column, so the two rows cannot reach different verdicts about one client.

### client_measurements table (migration 158)

**Every body measurement is one row.** Weight, body fat, waist, hips, chest, arms and thighs (`metric_key`, CHECK-constrained; `lib/measurements/keys.ts` mirrors the two CHECKs), the `value` in canonical kg / cm / % (CONVENTIONS §20), `recorded_on` (the day the reading belongs to, on the CLIENT's calendar), `recorded_at` (when the row was written), `measured_at` (when the reading was TAKEN — null means the day is known and the time is not; the check-in writer sets it, a coach entry or an intake reading leaves it null), `source` (`check_in` / `coach_entry` / `client_log` / `intake`), `source_id` (the check-in id for a check-in's reading, and for a later correction of it; null otherwise), `note`, `created_by` (`coaches.id` for a coach entry — the audit actor). No `updated_at`: an immutable log (CONVENTIONS §8). Indexed `(client_id, metric_key, recorded_on DESC, recorded_at DESC)` for every per-client read, and partially on `source_id` for the check-in fold.

`services/measurements-service.ts` is the ONE writer (`appendMeasurements`) and the home of every read below. Its rules, each enforced once:

1. **Append-only.** `service_role` holds `SELECT` and `INSERT` and nothing else — the migration revokes the default privileges first, then grants. Nothing updates or deletes a row; a correction is a new row on the same day.
2. **The value for a day is the latest row for that client, metric and day, by `recorded_at`** (`lib/measurements/day-values.ts`). No source ranking, no tie-break: the coach correcting after the check-in wins.
3. **Writers append only on change.** A value equal to the day's standing value for the same source AND stamp is not written again. The stamp is part of the key deliberately: a check-in submitted on a day whose earlier check-in was deleted still gets its own rows, or it would report nothing.
4. **No cache.** "Now" is the newest row per metric, of any source, through the view `client_current_measurements`; the baseline is the reading as of `clients.start_date` through `client_baseline_measurements` (see "The client's origin"). `getClientById` / `mapClientRow` fill `Client.currentWeight`, `currentBodyFatPercentage`, `startingWeight` and `startingBodyFatPercentage` from those two views, embedded in the same read as the row (`CLIENT_MEASUREMENT_EMBEDS`), so every consumer of the object — `/api/client/me` included — reads derived numbers under the same names. The string-built column lists that select a client (`CLIENT_SELF_COLUMNS`, the portal progress read, `ENERGY_COLUMNS`) carry the embeds, and the intake sync reads `getCurrentMeasurements` beside its own select; a stale name in any of them is a PostgREST 400 that `tsc` cannot see, and the portal's `return null` turns it into an empty profile.
5. **A check-in owns no measurement column.** Its readings are rows with `source = 'check_in'` and `source_id = the check-in id`, written by `submitCheckIn` as a second statement after the INSERT (`measured_at` = the submission time, `recorded_on` = the client's day; the same seam as the custom answers — if it throws, the check-in stands without its readings, the POST 500s, and the retry meets migration 156's period-unique constraint). `getMeasurementsForCheckIns` folds the latest live row per (stamp, metric) — whatever its source — back into the `CheckIn` object (`mapCheckInRow(row, measurements)` keeps the seven fields in their place), so the object and every wire built from it keep their shape.
6. **"Where they stand" reads "now"; "what this check-in reported" reads the stamped rows.** Goal position, the energy pair and the drift note take the client record's readings (rule 4). The review band, the AI prompt and the client's check-in detail take the stamped rows (rule 5). The band's "vs last check-in" compares this check-in's stamped rows with the previous check-in's stamped rows and nothing else — a reading logged between two check-ins belongs to the Journey series and to "now", never to that comparison. A check-in submitted without a weight has no weight row: the band's cell shows its empty state while the goal strip still shows the client's position.
7. **Every reader reads `client_measurements_live`, never the table**, so a filter over the rows lands in one place; every view carries `security_invoker`. Series reads are paged (`lib/paged-fetch.ts`): they feed aggregates and must be complete past PostgREST's row cap.

**Energy follows the newest reading.** `appendMeasurements` calls `recalculateClientEnergy` when a row it wrote is the client's newest weight or body fat (`client_current_measurements` after the insert); a backdated row that is not the newest recomputes nothing.

**Security.** RLS enabled; one policy, `clients_view_own_measurements` — `SELECT` for `authenticated`, scoped by `clients.user_id = auth.uid()` and never by source, so a client sees every reading about them. It exists because the client app reads its own readings through the session client under RLS (`services/client-portal-progress.ts` → `GET /api/client/progress`; the profile embeds under `GET /api/client/me`); coach reads go through `service_role`. `npm run check:rls`.

**Writers**, all through `appendMeasurements`: check-in submit (`check_in`, stamped); the Journey's "Log measurement" for a physique key, the metrics PUT and a `currentWeight` / `currentBodyFatPercentage` carried by `PATCH /api/clients/[id]` (`coach_entry`, dated the coach's today); the details sheet's Baseline fields (`coach_entry` dated ON the start date; an `intake` row dated today before activation); `createClient` (`intake`, the weight and body fat it was given, dated the coach's today); the intake sync (`intake`, dated the questionnaire's completion day on the client's calendar, only for a metric the client has no reading of). A coach's write is audited as `measurement.create` (metric and date only). The seeds write the log; `scripts/seed/teardown.ts` relies on the `ON DELETE CASCADE` from `clients`, because the app role has no `DELETE`.

**Readers:** the check-in object assembly (`services/check-in-service.ts`, every reader that maps a row); `GET /api/clients/[id]/measurement-series` (`services/measurement-series-service.ts` — every metric's day-values, the baseline per metric and the start date, one payload for the Overview chart, the Journey's Physique pane, its measurement log and the blocks); `services/client-portal-progress.ts` (`GET /api/client/progress`, under the client's JWT); `services/comparison-service.ts` (the ten-check-in trend, through the folded objects); `services/client-journey-service.ts`; the activity feed (`coach_entry` rows since the coach's last visit); `services/nutrition-calc-inputs.ts` and `services/client-energy-service.ts` (through the current view).

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

A **block** is a named, contiguous stretch of a client's calendar carrying a coach's intent — a *label on time*, not a computation. The entire entity: `name`, `[starts_on, ends_on]` (DATE), optional `focus` sentence, optional `target_weight` (canonical kg), and `archived_at` (migration 146). Archiving is a **curation control for both audiences**, not a coach-private view preference: only an ELAPSED block can be archived, an archived block leaves the coach's Journey list (reachable behind "View archive", restorable through `PATCH …/blocks/[blockId]`) and is filtered out of the client's payload server-side. It is a nullable timestamp rather than a status — no date derivation consults it. **The table keeps the `client_phases` name; routes, types and UI say "block"** — deliberate divergence recorded on the table comment; do not consistency-rename either half. Not the migration-133 roadmaps/phases feature returning: no `phase_id`/`block_id` on any other table (ever), no status column, no rate, no daily-targets grid.

- **Everything date-derived at read time, in the CLIENT's timezone.** current/past/future, "week X of Y" and the pace readout are pure derivations (`lib/blocks/block-derivations.ts`) from today vs the range — crossing a boundary is a no-op (no scheduler exists). `weeks` on the wire = `weeksSpanned` (ceil), the same single derivation as `weekOfTotal.total`.
- **Ends in, starts out** (day-granular since Session 3.6-B — an owner-directed change of the duration unit, not of the mechanism). The PUT sends `{ startsOn, blocks: [{ id?, name, endsOn?, focus?, targetWeightKg? }] }`; `lib/blocks/block-chain.ts` derives every start (the previous end + 1, or the chain anchor), so date pairs never cross the wire and overlaps and gaps stay unexpressible. The service rejects an end before its derived start and caps a block at 52 weeks of days. **Elapsed blocks (`ends_on <` client-today) keep their DATES pinned from storage** (they omit `endsOn` — elapsed history is not an input; a differing one 422s) **while their name/focus/target stay editable** (Session 3.6-C — the pin protects lived-day attribution, not typos in a finished label), and the **symmetric window floor** rejects any edit that would re-label lived days: a stored current block must still contain today; a stored future block may become current but never wholly past; new id-less rows land anywhere (history backfill). Removal is not expressible through the PUT.
- **Delete = shift, never wipe** (`DELETE /api/clients/[id]/blocks/[blockId]`): a future block's row is removed and what follows shifts back by its full duration; the block the client is currently inside **truncates at yesterday** — lived days stay attributed, the next block starts today — issued as ONE atomic upsert (no partial-failure window); on its own first day it is removed instead (zero lived days; truncation would trip the `CHECK (ends_on >= starts_on)` backstop). Elapsed blocks 422. The response's `changes` come from the same pure `computeDeleteShift` the coach UI previews with, so the confirmed sentence and the executed shift cannot differ. A gap exists only after a remove-variant partial failure (delete-first ordering) and heals on the next save.
- **Nothing computes from `focus`. Nothing computes from `target_weight` except the pace readout** — and pace is NOT on the wire: `derivePace` is a pure, unit-agnostic function the coach UI feeds from the Journey's weight series — the measurement log's day-values, through `use-merged-metrics` — so the readout and the Weight column beside it share one source by construction. Neither field ever reaches the nutrition calculator, and the blocks routes never call `updateGoals` (pinned by test).
- **Route surface:** `GET`+`PUT /api/clients/[id]/blocks`, `DELETE …/blocks/[blockId]` — full coach chain (`coachApiRateLimit` → CSRF → `requireCoachOwnsClient`, foreign client 404), canonical kg on the wire, audit events `block.chain_update` / `block.delete`. RLS deny-all + `GRANT … TO service_role` only (CONVENTIONS §8). Plus the read-only **`GET …/blocks/facts`** (Session 3.2, `services/client-blocks-facts-service.ts`): per-block training programs (governing segments, latest-start-wins) + the nutrition PRESCRIPTION (owner-specified semantics, 2026-08-12, superseding the original events-modal): the plan VERSION covering the block's reference date — today for a current block, its final day for a past one, its first day for a future one — supplies daily calories (custom-macros override honoured) and deficit (`tdee − calories`); hand edits and training surpluses are excluded by construction, era-resolution per migration 144's tiled windows. The changed-mid-block marker stays EVENT-derived (baseline transitions across unmodified lived days — catches pre-versioning history no plan row remembers). **The "what happened" timeline renders `eras` instead**: one entry per plan VERSION that governed part of the block, each carrying the numbers off its OWN row. The version windows tile the timeline by construction (the gist exclusion forbids overlaps, close-and-insert forbids gaps), so this is a plain intersection with the block window — no resolution rule, unlike training. It must not reuse the headline's calories/deficit: those read the reference-date version, so a later plan save would silently rewrite an entry dated in the past. Eras stop at today (a queued version is a plan, not a thing that happened) and an era matching the previous one's numbers is omitted. The events read is **paged** (`lib/paged-fetch.ts`) — an unpaged read silently truncates at PostgREST's ~1000-row cap. Kept off the chain GET so PUT/DELETE keep echoing that GET's exact payload.

### Client energy: the profile OWNS bmr/tdee (Session 4B)

The client's weight and body fat are their newest readings in the measurement log: `recalculateClientEnergy` reads them from `client_current_measurements`, embedded in the same select as the profile facts (`ENERGY_COLUMNS`). Nothing is copied onto `clients`.

**`clients.bmr` and `clients.tdee` are NOT a cache. They are the source of truth for the client's metabolism**, and they have exactly one UPDATE writer: `recalculateClientEnergy()` (`services/client-energy-service.ts`). The rules are load-bearing, not stylistic — each one is a bug that actually shipped:

- **The pair is written atomically.** Every UPDATE carries both keys. Six uncoordinated writers used to exist, three writing only half, which is how a profile came to read BMR 3712 beside TDEE 3515 — a TDEE derived from a BMR that no longer existed.
- **BMR = Katch-McArdle when body fat is known, else Mifflin-St Jeor. TDEE = BMR × multiplier(`clients.work_activity_level`).** Both formulas live once, in the pure `services/client-energy-calc.ts` (importable from the browser and the seed scripts; kept out of the `supabaseAdmin`-importing module so `check:service-key` stays green). TDEE derives from the **rounded** BMR so the stored pair is reproducible and agrees with `calculateTDEE`. `getActivityMultiplier` is imported from `utils/nutrition-helpers.ts`, never reimplemented, and a junk activity value is normalized rather than allowed to yield NaN into a `NUMERIC(6,1)` column.
- **An override flag freezes exactly its own half.** `bmr_manual_override` / `tdee_manual_override`: a custom TDEE plus a moving weight moves BMR and leaves TDEE pinned. A flag set over a NULL value is not a freeze and is recomputed.
- **Activity level is a CLIENT fact.** Nothing under `components/clients/nutrition/**` writes it.
- **A weight change never touches a plan row.** Plans snapshot bmr/tdee at generation; only a regeneration inherits the then-current profile numbers. `createNutritionPlan` touches the `clients` table zero times — it used to write `clients.tdee` from the *plan's* activity level, so the plan and the profile disagreed and the plan won.
- **`createClient`'s INSERT is the one sanctioned exception**, setting the pair once at row birth through the same pure calculator. The invariant is one writer for *updates*; `services/client-energy-ownership.test.ts` scans for violations and documents that carve-out beside the scan.

Who triggers a recompute: `appendMeasurements`, when a row it wrote is the client's newest weight or body fat — the one path every reading writer takes (check-in submit, the Journey's Log measurement, the metrics PUT, the details sheet, `createClient`, the intake sync); `updateClient`, when a profile input changes (height, gender, birth date, activity level); the metrics PUT, for an override instruction; the intake sync, after its profile fields land.

### The client's origin: the start date, and the baseline derived from it

**A client has exactly ONE origin — the day coaching began — and it is `clients.start_date`.** `services/client-start-service.ts` (`recordClientStart`) is its single writer, and it writes the date and nothing else: what the client measured when they began is not stored beside it but derived from the measurement log (below).

- **The date is set at activation, and only then becomes editable.** The activation dialog prefills the coach's today and they may backdate it; an existing stored date is kept rather than overwritten; the client's timezone today is the last resort. **One setter, then one editor:** the details sheet's "Started" field is read-only until the client is activated (it reads *"Set on activation"*) and editable after, routing through `updateClient` → `recordClientStart`. Editable *before* activation was worse than useless — the dialog always sends its own prefilled date, so a start date a coach set in advance was silently replaced the moment they activated. `paused` counts as started: they were activated once, and their origin does not stop being real because they are on hold.
- **The baseline is derived, never stored.** Per metric, the reading as of the start date: the latest live row on or before it, else the earliest after it — `client_baseline_measurements` (migration 158), read only through `getBaseline` (`services/measurements-service.ts`; `lib/measurements/baseline-ownership.test.ts` fails if anything else derives it). It cannot disagree with the series, because it IS a point of the series, and it cannot be edited into a number no reading carried. Every surface that shows it — the Overview band's "Since start", the Journey hero's "since start" figures, the check-in comparison's start leg, `startingWeight` / `startingBodyFatPercentage` on `/api/client/me` and `/api/client/progress` — shows the reading's own date and source. A client with no start date has no baseline.
- **Moving the start date re-derives the baseline and re-dates nothing.** A reading dated before the start date stays in the log, is listed on the Journey's measurement log under "Before start", and is excluded from the journey's chart and from every "since start" figure. A future start date is allowed: the Overview card's number and the Journey hero's Current are "now" — the newest reading, any date — and never wait for it; the chart line and every "since start" figure read `Starts d MMM` until it arrives. The Overview chart draws the baseline at the start date, as the value in force that day, with the reading's own date in its label.
- **The details sheet's Baseline fields append a reading**: a `coach_entry` row dated ON the start date, which the as-of rule then reads; before activation there is no start date, so it is an `intake` row dated today, picked up the moment the date is set. The sheet does not write a current reading — the current weight and body fat are read-only there, and the Journey's "Log measurement" is their writer.
- **A body fat cannot be cleared through the profile.** `updateClientSchema` accepts `currentBodyFatPercentage: null` and `startingBodyFatPercentage: null` on the wire, and `updateClient` refuses both with a readable 400 (`ReadingRemovalUnavailableError`) before any write lands, rather than saving and keeping the value. A weight stays non-nullable: the pair cannot compute without one, and both add-client paths require it.
- **Nothing captures girths at intake or manual add**, so only weight and body fat have a reading before the first check-in or coach entry (`TECHNICAL-DEBT.md` → "Measurement log — follow-ups").

**Three things were considered as the origin and rejected**, each recorded on the service so it is not re-litigated: a plan's `effective_from` (there are many per client, one can be queued in the future, and a queued nutrition version can be hard-deleted by migration 144 — an origin that can vanish is not an origin); `client_goals.goal_start_date` (versioned per goal, and it answers "spread this deficit from when", not "when did they become my client"); and the earliest measurement (that is where the DATA starts, not where the coaching did — the gap between the two is exactly what `start_date` records).

**Who already measures from it:** `resolveCheckInWindow` (`lib/date-helpers.ts`, called by `submitCheckIn` for every check-in) clamps `period_start` forward to it — which bites only on a partial first week — so the stored period, and the nutrition summary and AI prompt that are handed it, never count pre-start days; `weekly-nutrition-service.ts` itself reads nothing from `start_date` — it derives its day denominator from whatever period it is given, which is how a clamped first week reads 3/3 rather than 3/7; `engagement-triggers.ts` holds the no-engagement alert until `start_date + NO_ENGAGEMENT_ACTIVATION_GRACE_DAYS` — and **returns null without one**, so a client with no start date has that alert silently disabled.

**Both add-client paths require a weight**, so a client cannot be set up with no baseline: the intake questionnaire enforces it in `intakeStep1Schema`, and `createClientSchema` refuses a manual add without one (`setupMode !== "intake"` — the same predicate `createClient`'s `isIntakeMode` uses, since the field is optional on the wire and anything but `"intake"` is manual). Body fat stays optional on both; the details sheet's Baseline group is how it gets filled in later. `createClient` appends the weight (and body fat) it was given as an `intake` reading dated the coach's today and computes the energy pair from the same number in its INSERT; it stores `date_of_birth` alongside (the add-client form collects it and the energy calculator consumes it; a client whose birth date is dropped at creation carries an age-correct BMR that the next recalculation silently changes).

**The intake path is the gap those two schemas cannot close**, because the client row exists as `pending_intake` before the questionnaire is answered: the weight sits on `client_intake` until "Sync metrics" appends it to the measurement log as an `intake` reading. So the order is enforced rather than trusted — "Mark as reviewed" is disabled until the client has a weight reading, and `POST …/activate` returns **409** without one. `hasStartWeight` (`lib/client-profile-completeness.ts`) — the client record's current reading, the log's newest weight — is the single definition all three read, so a greyed button and the rule behind it cannot disagree.

### Read switch fallback

Services that read goals prefer `client_goals` but fall back to the legacy `client.*` goal mirror for pre-migration clients:
```
goalWeight = currentGoals?.goalWeight ?? client.goalWeight
```
The switch is written once, in `toClientGoalInput()` (see "Effective goal resolution"), because four callers held byte-identical copies and one of them only had to be edited alone for them to diverge. It covers goal weight and goal body fat **only**; the deadline has no mirror leg by decision.

Measurements have no switch. The client record's readings are derived from the measurement log (see "client_measurements table"), and the check-in comparison's start value is the baseline, else the client's current reading — so a client with no start date still has a direction to be judged in — and never the check-in under review, which may carry no reading at all.

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
- **Both tracks are date-ranged; what still differs is HOW windows are made (migration 144 aligned nutrition with training's date-resolved model — an owner reversal of the earlier "deliberate asymmetry", 2026-08-11):**
  - **Training = many coexisting provenance plans, placed additively.** A distinct `training_plans` row per placement coexists with others; windows are capped at placement (`getNextPlanStartCap`) and gaps between programs are normal. "The active plan" resolves **by date** via `coversDate`.
  - **Nutrition = a contiguous chain of versions, closed derivationally.** N `nutrition_plans` rows tile the client's timeline; the coach never supplies an end date — each save closes the open version at `new_start − 1` and inserts the next (`create_nutrition_plan_atomic`, close-and-insert, mig 144), so overlaps and gaps are unexpressible through the API (a gap exists only after a delete). One open version per client (`idx_nutrition_plans_open_unique`); a gist exclusion constraint (`nutrition_plans_active_window_overlap`) physically refuses overlapping active windows. "The active version" resolves **by date** via the same `coversDate`. One target per day is correct, not a limitation (`nutrition_events UNIQUE(client_id, date)`). Per-day coach edits are **materialized onto the events** (`is_modified`), never minted as versions.

### Training event fields
- `training_session_id` FK (SET NULL on delete, preserves events when sessions removed)
- `session_name`, `session_focus` - snapshotted at creation, survive template renames
- `estimated_calories` - from the session template
- `calorie_surplus_percentage` (NUMERIC, nullable, migration 085) - the per-date training surplus, denormalized onto the event at generation from `training_sessions.calorie_surplus_percentage`. The nutrition cascade reads it directly from the event (see "Training → Nutrition cascade"). NULL on rest days
- `is_modified` - true when a coach moved or duplicated the event on the calendar, or edited its surplus — or when the **client** moved it (`move_training_events_atomic`, migration 150; the same badge, deliberately: no who-moved-it provenance is stored, owner decision 2026-08-26). It drives the calendar card's edited badge and is hashed into the amendment drift token. It is **not a write predicate**: the amendment rewrite deletes and re-lays future scheduled events without consulting it. (An earlier `force = false` / override-after-warning regeneration flow is described in older revisions of this file; no such parameter exists in the code.)
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

### Nutrition plan versions + per-version daily-targets template

`nutrition_plans` holds **date-ranged versions** (migration 144 — an owner reversal of the earlier single-durable-plan model, 2026-08-11): N rows per client whose `[effective_from, effective_until]` windows tile the timeline, `effective_until IS NULL` marking the open (latest-saved) version. Each version is the **template for its own era** — it holds the plan-level prescription — `baseline_calories`, `protein_target_g` / `carb_target_g` / `fat_target_g`, `diet_type`, `protein_target_g_per_kg`, the custom-macros override (`custom_macros_enabled` + `custom_calories`/`custom_protein_g`/`custom_carb_g`/`custom_fat_g`), the calculator inputs (`base_weight_kg`, `bmr`, `tdee`, `work_activity_level`; `training_volume_hours` is also stored but deprecated — accepted for backward compat and read by nothing), and the goal snapshot (`goal_weight_kg`, `goal_deadline`) that drives the weight-drift / goal-drift banners — plus its own `nutrition_plan_daily_targets` **per-weekday grid** (`(nutrition_plan_id, day_of_week)` → `calories`, `protein_g`, `carb_g`, `fat_g`), the source used to generate/regenerate that era's dense per-date `nutrition_events` (replaced DELETE-then-INSERT on each save of that version; **not** the display SOT — events are).

**The write path** is `create_nutrition_plan_atomic` (close-and-insert since 144; the lineage runs 048→110 close-and-insert, 115 flattened it in-place, 139 rebuilt at 24 args, 143 advanced `effective_from` on the conflict path, 144 restored close-and-insert): a save with no open version inserts; one dated after the open version's start **closes it at `new_start − 1`** and inserts; one dated on/before it **absorbs** (updates the open row in place — same-day re-saves collapse, saving earlier than a queued change replaces it, and fully-replaced never-effective queued versions are hard-deleted). A **caller-cooperative belt** refuses `effective_from < p_today`, and the open-row `FOR UPDATE` plus `idx_nutrition_plans_open_unique` handle racing saves. `effective_from` therefore means **"when this version's numbers took (or take) effect"** — birth and effect coincide per version (`created_at` keeps the row's birth). **Resolution is by date everywhere**: `getNutritionPlanForDate` / `getNutritionPlanIdForDate` (via the shared `coversDate`), `getNextFutureNutritionPlan` (earliest queued), `getOpenNutritionPlan` (drawer seeds), `getActiveNutritionPlanId` (covering-today wrapper). The coach GET returns **three roles** — covering ("Active since", `hasCurrentTargets`), earliest-future (`scheduledFor`), open (drawer seeds `open ?? covering` + goal drift). **Delete = close, never erase**: the covering version closes at the client's today (status untouched — the ended, successor-less window is the record) and queued versions are removed; history reads carry **no status filter**, so a closed version keeps explaining the days it governed. `buildDailyTargetsFromPlan` gates its no-event template fallback to **both ends** of the passed version's window, so no era's grid ever impersonates another's. The baseline/deficit calculator is `services/nutrition-service.ts` (pure — the browser previews through the identical module), macro splitting in `utils/nutrition-helpers.ts`, rate⇄calorie conversion in `utils/energy-conversions.ts`; the retired calculator doc's prose walkthrough lives in git history of `docs/NUTRITION_PLAN_CALCULATOR.md`.

### Nutrition event fields (percentage-surplus model, post-LIB-2)
- `baseline_calories` - plan's rest-day target, frozen at event creation
- `calorie_surplus_percentage` (NUMERIC, nullable) - copied from the training event assigned to that date (e.g., 15 for +15%). NULL on rest days
- `training_burn_calories` - the day's training surplus IN CALORIES, computed at generation (`round(baseline × surplus%)` from the event's `calorie_surplus_percentage`, else the legacy flat sum of the day's `estimated_calories`); read by the per-day edit service (`currentDisplayedCalories`) and the period summary's no-event fallback, and zeroed when a coach materializes a day. **Not** deprecated — an earlier revision of this line said "0 on new events", which was false. `external_burn_calories` IS dead: no code writes or reads it (its last mention was a test fixture key, removed 2026-08-26); the column is a migration matter
- `protein_g`, `carb_g`, `fat_g` - baseline macros (protein fixed; extra calories redistribute to carbs/fats per `diet_type` via `calculateDailyMacros()`)
- `diet_type` - snapshotted from plan, enables display-time macro recalculation when `include_activity_burn` is on
- `is_training_day` - derived from training events on that date
- `is_modified` (BOOLEAN, migration 113) - true when a coach **materializes a per-day edit** (range edit). On a modified day `baseline_calories` + macros are frozen to the edited values and `calorie_surplus_percentage` is set to NULL (no surplus stacking); the day **survives regeneration and the training cascade** (delete/upsert skip `is_modified=true` rows). Cleared by reset.
- `note` (TEXT, migration 118) - optional per-day coach note; rides `is_modified=true` so it survives regen, is cleared on reset, and surfaces on the coach calendar tag + the client nutrition day card.
- `coach_note` (TEXT, migration 139) - the plan-save note, stamped on the date the change takes effect. **No longer a private channel since migration 147**: its text is also inserted into `nutrition_plan_notes`, which the client reads. The column itself is still never returned by `/api/client/**`; what changed is the privacy, not the endpoint. Rows written before 147 were genuinely private, and the calendar copy deliberately over-states visibility for them rather than under-stating it for new ones.

### The three notes, and why they are not one thing

Three note surfaces exist with three different lifetimes and three different audiences. Reaching for the wrong one is the recurring mistake here — migration 139 dropped a plan-level note column precisely because it picked wrong.

| Column / table | Audience | Scope | Written by |
|---|---|---|---|
| `nutrition_events.note` (mig 118) | client-visible, **unconditionally** | per-day | the per-day range-edit path only |
| `nutrition_events.coach_note` (mig 139) | **no longer private** (mirrored into the table below, mig 147) | per-day | the plan-save note only |
| `nutrition_plan_notes` (mig 147) | client-visible **while its block is current** | plan-level, append-only | the plan-save note |

The third row's qualifier is the point, not a footnote. **The coach's Journey timeline renders every note forever; the client's Program tab renders only those inside their CURRENT block card.** Two surfaces, two lifetimes, one store. Every piece of coach-facing copy about this note — the builder drawer hint, the calendar popover, migration 139's column comment — is worded against that difference and must stay that way: they name the condition ("it shows on their Program tab with the block it falls in") rather than asserting an outcome ("shown to Sam"), because a coach who believes the stronger claim writes an explanation that reaches nobody.

**That rule is enforced on the wire, not in the renderer.** `GET /api/client/journey` returns `currentBlockNotes: { blockId, notes[] } | null` — there is deliberately **no per-block `notes` field** on `ClientJourneyBlock`, so an elapsed block's notes never cross the contract at all. The endpoint is the RN contract surface; a rule expressed only in the web component would ship those notes to React Native and leave it to re-derive the same drop, or the two client apps would disagree about what a client may read. Widening visibility to finished blocks is therefore a deliberate **contract change**, not a filter removal. The `blockId` is carried so a client asserts rather than infers ownership, and it keeps the empty cases distinct: `null` = no current block, `{ blockId, notes: [] }` = a current block the coach has written nothing about.

### `nutrition_plan_notes` (migration 147)

The coach's "why am I adjusting this plan?" note, append-only and client-scoped:

- `client_id` FK (CASCADE), `coach_id` FK (SET NULL), `nutrition_plan_id` FK (**SET NULL**), `effective_on` DATE, `body` TEXT, `created_at`. **No `updated_at`** — an immutable event table (CONVENTIONS §8, the `client_measurements` precedent); an `updated_at` would imply an edit path the append-only property forbids.
- **No unique constraint on `(client_id, effective_on)`, deliberately.** Two saves sharing an effective date leave **two rows** — that history is the whole point, and it is what `nutrition_plans.coach_notes` could not hold (its always-update bucket nulled the previous note on every regenerate). It is also why the index is `(client_id, effective_on DESC, created_at DESC)`: the ordering needs a tiebreak.
- **Client-scoped with a SET NULL plan FK because both alternatives destroy it.** `deleteFutureNutritionEventsForClient` spares nothing on `nutrition_events` — not `is_modified`, not `coach_note` — and `nutrition_plans` rows are themselves closed, absorbed and hard-deleted by `create_nutrition_plan_atomic`. Same posture as the events-as-SOT rule that event→plan FKs are SET NULL (migration 113).
- RLS enabled with **no policies**, `GRANT ALL … TO service_role` only (CONVENTIONS §8). The `nutrition_plan_id` FK is indexed because it carries real DELETE traffic (queued-version hard deletes on both the plan-delete path and mig 144's absorb branch).
- **Write path:** `recordPlanSaveNote` (`services/nutrition-plan-notes-service.ts`), called by the orchestrator after the RPC and the event regenerate succeed. It writes **both** stores in one function, stamp first and insert last, because the stamp is an idempotent UPDATE and the insert duplicates on replay — that order is what makes a retry safe. Neither failure is swallowed; the orchestrator surfaces them as a `NutritionPlanError` saying the plan and calendar saved but the note did not. The retry does not mint a second plan version because migration 144's branch (c) absorbs a same-effective-date re-save.
- **Read paths:** `GET /api/clients/[id]/blocks/facts` (a fourth parallel read over the journey span, partitioned per block in memory) and `GET /api/client/journey` (the current block's window only).
- `status`: the CHECK allows `scheduled` / `logged` / `missed`, but **the product never advances a row past `scheduled`** — no service, RPC or trigger writes the other two (a live probe of dev found every product row `scheduled`; its 365 `logged` rows are one seeded fixture year). "Logged" for nutrition is the existence of a `nutrition_logs` row for the date (`getNutritionForDate`, `assertCanEdit`). The coach calendar's edit gates key on `status === "scheduled"`, so every real day is editable, and a coach edit on a logged day reaches the client the same way the cascade does — at their next food save, which re-snapshots the target

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
- **Per-day nutrition editing** (Session 4): coaches edit nutrition events directly on the nutrition calendar over a `dates[]` selection (absolute or %-delta) via `PATCH /api/clients/[id]/nutrition/events/range`, which **materializes** the edit (`materializeNutritionEventDays` → baseline+macros set, surplus NULL, `is_modified=true`, optional `note`); `PATCH …/nutrition/events/reset` (`resetNutritionEventDays`, over the same `dates[]` selection) clears `is_modified`+`note` **then** regenerates exactly those dates back to the plan baseline. Both are server-guarded to `date >= clientToday`. The read is `GET …/nutrition/events?startDate&endDate`.

### Training → Nutrition cascade
- The 8 training event-write routes — `place-from-library`, `events/[eventId]/move`, `events/[eventId]/duplicate`, `events/[eventId]` (DELETE), `[planId]/sessions/[sessionId]` (PUT), `[planId]/amendment`, `[planId]` and the client-level `training` DELETE — invoke one consolidated helper, `cascadeNutritionAfterTrainingChange()` (`services/nutrition-event-service.ts`), which fetches **every active plan version overlapping the scope** (migration 144) and hands each the same scope — `regenerateFutureNutritionEvents()` clamps to the version's own `[effective_from, effective_until]` window, so the loop IS the segmentation and a training edit inside an old era rebuilds those days from **that era's** grid. From-scopes additionally sweep gap dates no version covers (the post-delete interregnum). The version-lookup error is surfaced loudly (a failed read must never impersonate "no plan"); per-version regeneration failures are still Sentried-and-swallowed (`TECHNICAL-DEBT.md` → cascade entry 2). Each route threads a **`NutritionRegenScope`** naming the dates its change actually touched. Routes that know their exact dates pass `{kind:"dates"}` (move = `[source, target]`; duplicate / library-session drop = `[targetDate]`; event delete = the deleted day; a session surplus edit = the session's future event dates) and get a **pure upsert with no DELETE** — those days never lose their row. The old delete-then-regenerate left every covered date row-less across four network round trips, and `getPlanTargetForDate` resolves a missing row to null, which `nutrition_logs` snapshots permanently. Open-ended changes (whole-program placement, the plan-clear DELETEs, the amendment floor) pass `{kind:"from"}`: a bounded DELETE + regenerate over `[from, from + 8 weeks]`. Days past that horizon keep their existing, possibly stale rows — acceptable for routine cascades (later cascades sweep them as today advances), **not** for a plan deletion, where nothing may ever revisit them (`TECHNICAL-DEBT.md` → nutrition cascade, stale tail).
- Nutrition events read the day's surplus **directly from `training_events.calorie_surplus_percentage`** (denormalized from the session at event generation, migration 085) — not by traversing the `training_session_id` FK.
- Coach-edited (`is_modified=true`) days are immune on both arms: the from-scope DELETE excludes them and the generator's protected-days filter drops them from the upsert. `coach_note`-annotated days survive the DELETE (`.is("coach_note", null)`) and reach the upsert as a conflict — their targets are rewritten and the note is explicitly re-supplied on the new row. A day the client has already logged is **rewritten by the cascade like any other — by design** (owner decision 2026-08-26, superseding an earlier reading of this as corruption): `upsertNutritionLog` re-snapshots the day's target from the current event on **every** food save, so a session moved onto or off a day — a coach move, an amendment, or the client's own move — changes the target the client sees at their next save, and the coach calendar reads the live event. Freezing a logged day was designed and rejected: with a frozen event, every later save would re-snapshot a training surplus onto a day whose session had left. The row's `status` plays no part in any of this (see the `status` bullet under "Nutrition event fields").
- The upsert **rewrites** `baseline_calories` + macros from the covering version's template on every covered date — and since migration 144 that is the RIGHT era's template by construction: each version regenerates only inside its own window, so a queued change can no longer leak the next prescription's numbers onto days the old one still governs (the pre-window baseline leak is CLOSED — `TECHNICAL-DEBT.md`'s cascade entry 5 records the closure).

### Read priority for nutrition targets

The **per-date day-view path** — `getPlanTargetForDate()` / `getNutritionForDate()` (`services/daily-context-service.ts`):
1. **Logged days**: `nutrition_logs` snapshot (written at log time, authoritative)
2. **Unlogged days with event**: the `nutrition_events` row for that date (via `mapNutritionEventToDisplayTarget`, honoring `include_activity_burn` + `surplus_as_carbs`)
3. **Unlogged days without event**: returns `null` — **the level-3 template fallback is currently unbuilt** (there is no `getPlanTargetForDateFromTemplate`). Dense event generation/backfill is expected to cover the window, so a missing event reads as "no target".

The **plan-based "typical week" / client program-card path** — `buildDailyTargetsFromPlan()` (`utils/build-daily-targets.ts`) — is event-first too, but for no-event days it **does** derive the target from the **covering version's** `nutrition_plan_daily_targets` grid (applying the same surplus-split). The template fallback is gated to BOTH ends of that version's window (migration 144): a no-event day outside `[effective_from, effective_until]` belongs to another era and returns no entry rather than the wrong era's numbers.

**Each day carries its `date`, and the seven are emitted in the client's own week order** — the week ends on their check-in day, so it can begin on any weekday. The date is the payload's only statement of WHEN the week starts, and without it a renderer can only guess from weekday names: two independently guessed Monday-first, and a Saturday-to-Friday client was shown their week beginning three days in with its two earliest days last. `VerticalNutritionView` sorts on the date rather than a weekday list, the same way the training page sorts on the `orderIndex` the server hands it. **Never sort these by weekday name.**

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

### The coach's logged-workout readout

`GET /api/clients/[id]/training/session-logs/[sessionLogId]` → `getSessionLogDetail` →
`components/clients/training/session-log-detail-dialog.tsx` + `session-log-exercise-card.tsx`. The
coach-side twin of the client's log form, and it obeys one inversion: **the PRESCRIPTION drives the
row list, not the log.**

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
- **A tick and a blank are different states.** A logged row with all three values null is
  "did the set, recorded no numbers" and renders as logged-with-dashes; only a *missing* row reads
  as not done. Collapsing the two would erase per-set completion's locked decision 3.
- **`prescribedExercises` is on the wire for a reason.** An exercise the client never touched is
  absent from `exercise_logs` entirely, so the readout would silently omit it. `getSessionLogDetail`
  reads the PERFORMED session's active exercises — the same `loadSessionPrescription` the
  `completion_quality` denominator uses, so the readout and the recorded verdict describe one
  prescription — in `order_index` order, issued in a `Promise.all` with the performed-session-name
  read so it costs no extra round trip. Empty when the log has no `training_session_id`.
- **Warm-ups are shown and never scored**: tagged `W`, values muted, tick muted. Set types render as
  single-letter tags (`W`/`D`/`A`/`F`, working untagged) and drop sets as their flattened sibling
  rows, matching what the client logged against.
- **Columns follow the DATA, not `prescribed_fields`.** A historical readout must never hide
  something actually recorded, and every snapshot written before migration 149 carries no field list.
- Two things were deliberately **removed** when this shipped: a "Prescribed 3x8-12" chip built from
  the compact snapshot columns (which cannot express warm-ups, per-set loads, drop sets or AMRAP —
  the exact lossiness `set_specs` exists to fix), and an "Incomplete" badge off the vestigial
  `exercise_logs.completed`. Do not reintroduce either; the per-set rows state both precisely.

### Alternative-session logging (Session 5.3/5.4)
- **A workout has one date — the event's — because the client moves the event to the day they train (owner decision 2026-08-26).** There is one training writer, `POST /api/client/training/events/[eventId]/log` → `logTrainingEvent`; `completed_at` is always `event.date`. On a rest day the client picks a session from THIS WEEK (`GET /api/client/training/week`), it **moves** to that day (`POST /api/client/training/events/layout`, migration 150) and opens; on a prescribed, unlogged day a pick of a still-scheduled other-day session **swaps** the two days. Both go through one pure kernel, `lib/session-pick.ts`. The picker offers only sessions that can still be done — Today, Upcoming, Missed-but-still-scheduled — so a done session is never logged twice.
- **Retired with that decision:** the event-less log path (`POST …/session-logs`, `logTrainingSessionForDate`), the matcher (`findMatchingEvent`) that guessed which prescription a rest-day log fulfilled, and the "done on another day" receipt it produced (`TrainingEvent.loggedOn`, `withLoggedOn`, `TrainingEventSummary.loggedOn`, `DaySummary.trainedFor`, the read-only lock on the prescribed day). Two-dated logs made every reader carry the attribution rule; the coach's history table was the first not to, and rendered the same workout on different days depending on the query window. Do not reintroduce a cross-day link.
- **Signals:** a planned-day swap = `session_log.training_session_id != event.training_session_id` (the client chose "Do a different session" on a logged or already-done pick). The coach history table renders an "Alt" badge (`is_alternative`); the drill-down dialog shows a session-level "Prescribed X · Performed Y" line. `session_log.training_event_id IS NULL` no longer arises from the product (no event-less writer); rows carrying it are pre-retirement history.
- `exercise_logs.training_exercise_id` is SET NULL on delete (nullable). History preserved via `prescribed_exercise_snapshot` JSONB
- Snapshots are written at completion time and backfilled for existing data
- `set_logs` (migration 090) holds per-set actuals: `(set_number, reps, weight, rpe)`. Replaces the legacy scalar aggregates `actual_sets`/`actual_reps`(csv)/`actual_weight` that lived on `exercise_logs` before 090. ON DELETE CASCADE from `exercise_logs`.
- `set_logs.set_type` (migration 119) — `TEXT NOT NULL DEFAULT 'working' CHECK (set_type IN ('warmup','working','amrap','drop','failure'))`. The per-set type of a logged set. It is **coach-prescribed** (seeded from the prescription's `set_specs` at log time), not client-chosen — the log schema accepts-but-ignores any client value, and the writer seeds each row from the prescription snapshot's per-set specs. Warm-up / AMRAP / drop rows are written today. The analytics RPCs (`get_exercise_progression_window` returns it; `get_exercise_prs` filters on it — migration 120) exclude warm-up sets from volume/compliance/PRs; `services/exercise-analytics-service.ts` counts only non-warmup sets and reads the prescribed working-set count from the snapshot's `set_specs`.
- `exercise_logs.exercise_id` (added in 090) is a nullable FK to the global `exercises` catalog. Populated when the client picked an exercise from the typeahead picker (Add unplanned, Swap). NULL for prescribed-without-swap (catalog identity is reachable via `training_exercise_id → training_exercises.exercise_id`) and for freehand entries.
- `exercise_logs.performed_name` (added in 090) is the canonical display name for the logged exercise. Differs from `prescribed_exercise_snapshot.name` when the client swapped a prescribed exercise or added a freehand unplanned one. Display rule: `performed_name ?? prescribed_exercise_snapshot?.name ?? "Unknown exercise"`. This is the per-**exercise** swap (Session 1.5), independent of the per-**session** swap above.
- Session-level status: `training_events.status` maps from `session_logs.completion_quality` via `mapCompletionQualityToEventStatus` (full→completed / partial / skipped) — unchanged. **What changed is where that quality comes from.** It is **server-derived** whenever the payload carries `exercises`: `deriveCompletionQuality` (`utils/completion-quality.ts`) counts the sets the client sent against the session's own prescription and **ignores any client-supplied value**. `full` means every prescribed WORKING set on EVERY exercise (each exercise judged against its own prescription, so a surplus on one cannot mask a deficit on another); some → `partial`, none → `skipped`; warm-ups are excluded from both halves. The denominator therefore needs a read of its own (`loadSessionPrescription`), because an exercise the client never touched is absent from the payload entirely and must still count against them. A payload with **no** `exercises` — any future RN quick path — still uses the client's explicit `completionQuality`, and that is the only case where it is honoured. *(This reverses the previous rule, "per-exercise data does NOT override the client's tap", which let a client who logged one set of six record the session as complete.)*

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

  **Three rules the flattening kernel owns, because every renderer would otherwise re-derive them:**
  - **A drop's load type belongs to its PARENT spec.** `drops` is `{ load_value, reps }` — there is deliberately no per-drop `load_type`, so every drop of one set shares the set's unit and "80kg, drop to 60%" is unexpressible. `buildPrescribedRows` copies the parent's type onto each drop row, the same way drop children already inherit `setNumber`. `weight` is the pre-`load_value` spelling (canonical kg, from when a drop could only be absolute); read both through `dropLoadValue`, write only `load_value`. Removing the `weight` key is destructive and needs a **prod** probe, not a dev one.
  - **`amrap` and `failure` sets prescribe no rep count.** `buildPrescribedRows` emits `repsMin`/`repsMax`/`repsTarget` as null for them. This is a READ rule, not a write-side clear: switching a set's type in the builder leaves the old range behind and the assistant can author one too, so ~11k stored specs carry a stale range that no clear would have reached. Expressing it here makes the stale value unreadable rather than tidied, and costs a coach nothing when they toggle a type back. The builder's reps input is disabled for both types; the CLIENT still records the reps they achieved.
  - **Rest is a property of the BOUNDARY between rows, not of a row.** `restAfterRow(rows, i)` returns null when nothing follows or when the next row continues the same spec, else the rest of the SET this row belongs to — walking back to the parent for a drop child. `restSeconds` stays a faithful projection of the spec (null on drop children) rather than being relocated onto the last child, because a client asks *"is there a rest interval here?"* while a coach readout asks *"what rest does this set prescribe?"*, and moving it serves the first by destroying the second.

  **When specs exist, `sets`/`reps_min`/`reps_max` are a maintained projection, never independent truth.** `projectExerciseCompact()` (`utils/exercise-set-specs.ts`) is the single input-side write helper — it writes `set_specs`/`video_url` verbatim and re-derives the compact trio via `compactFromSpecs` (counting non-warmup sets, clamped to the `training_exercises.sets` CHECK [1,20]). Clone sites splat the source row's columns instead of re-deriving. Editing goes through one pure kernel, `applySetSpecEdit()` (`utils/set-spec-edits.ts`), shared by the builder hook and the assistant's server executors: ≤30 specs, ≤20 drops/set, never all-warmup, and deleting the last set reverts `setSpecs` to `null` (never `[]`).

### Program authoring surface (`/dashboard/programs`)

All training authoring lives here. `/dashboard/training-library`, `/dashboard/programs/sessions` and `/dashboard/programs/exercises` are `redirect("/dashboard/programs")` stubs kept so old links resolve (the client portal keeps one twin of the same shape: `app/client/progress/page.tsx` → `/client/metrics`) — the Sessions and Exercises libraries live in the builder's tabbed `builder-library-panel.tsx`.

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
> **A logged day's prescription is frozen.** A second assertion in the same module, `assertSessionUnlogged`, throws `SessionLoggedError` when ANY `training_event` linked to a session has left `status = 'scheduled'`. It is called INSIDE `cloneSessionForEvent` and `replaceSessionFull` — after each has proved the session belongs to the client, so a foreign `sessionId` still reads as not found rather than as locked — and both routes translate it to a **409** carrying the service's own message, which names the day. Without it either save path rewrites the `training_exercises` rows the client's `exercise_logs` point at: the clone repoints the event at a session whose exercises are freshly inserted ids, and `bulkReplaceExercises` soft-deletes and replaces them outright. The result was a session rendering each exercise up to three times and a full workout being recorded as `partial` once Phase 1 made `completion_quality` server-derived. **The predicate is `status !== "scheduled"`, deliberately the same one `program-builder-lock-model.ts:63` applies to a plan-builder slot** — the calendar tray never consulted it, and this closes that gap rather than inventing a second rule. Three places spell it: that line, the assertion, and the tray's own gate (`use-placed-session-editor.ts`, which cannot import the service module — it reaches `supabaseAdmin`). The tray opens a locked day read-only (`SessionEditorBody mode="view"`, the same treatment `program-builder.tsx` gives a locked slot) with Save hidden rather than disabled, so a coach sees the lock instead of a save that 409s. The caller-less `POST`/`PUT …/sessions/[sessionId]/exercises` handlers, which reached `bulkReplaceExercises` directly and so bypassed it, were **deleted** in the 2026-08 dead-code sweep (seed item 5) rather than given the lock — `replaceSessionFull` is now the only path that rewrites a placed session's exercises.
>
> **A start day that already holds a completed workout warns first.** `POST …/place-from-library` (plan and inline branches) answers `409 start_day_has_completed_workout` when the chosen start date has a `completed`/`partial` event (`hasCompletedWorkoutOn`, status-scoped — unlike `assertDateFree`) AND the program's first slot is a training day (a rest-first program lands nothing on the start day — `getSavedPlanFirstSlotIsRest` / the inline body's first slot); `ApplyToClientDialog` shows it under the date with **Start anyway** (re-sends `startAnyway: true`) or lets the coach pick another date. Never silent: the alternative was the program's first session landing beside a session the client had already logged that day and the client seeing two workouts.
>
> **The pre-check is on the three single-date paths, not on every writer** — move, duplicate, and the library-session drop. Whole-program placement and the amendment deliberately skip it: each first deletes the future `scheduled` events in the window it is about to fill, so a per-date question is one it has already answered, and pre-checking would make it reject the window it just vacated. What that clear does not remove is a non-scheduled survivor (an early log), and a concurrent write can still land one between the clear and the upsert. The generated-event upsert arbitrates on `(client_id, training_session_id, date)`, which does NOT cover this index, so such a collision arrives as a raw `23505` — `generateProgramEvents` translates it through `rethrowIfAnyDateOccupied` (the bulk sibling, which recovers the date from the Postgres error detail since the caller cannot know which row collided).

> **Load-bearing invariant — every day-slot is a materialized row; empty === rest.** The date-walk relies on every authored week being a full 7 rows. A missing or implicit rest slot collapses the week to fewer than 7 days and slides every later date. This is why the builder has no "empty" cell state and why placement clones rest rows it will never emit an event for.

The placed rows describe themselves — nothing but the session rows drives the walk.

### Atomic placement (additive — migration 114)
`create_training_plan_atomic()` (the 23-arg signature, with `p_window_end`) inserts the new plan + sessions + events in one transaction as a **coexisting provenance row** (`status='active'`, `effective_until=NULL`). Placement is **additive**: it deletes only **future `scheduled` events within the incoming plan's own date window** (`GREATEST(effective_from, today) … p_window_end`) so the freshly generated events have empty slots to land in. There is **no STEP-0 cross-plan wipe and no archival of the previous plan** (the old behavior of migration 087); non-overlapping plans coexist and reads resolve "active" by date. `services/library-placement-service.ts` computes the window via `calculatePlacementEndDate()` and caps it at the start of the next coexisting plan (`getNextPlanStartCap`) so two placements never bleed into each other. Every generated event keeps carrying `calorie_surplus_percentage` (the nutrition-cascade contract).

### Plan amendment (rewrite-future — placed-plan editing overhaul, Job 2)

A coach can amend a plan **already placed on a client's calendar** mid-flight ("client isn't coping 5 weeks in — reduce everything remaining"): the shared Program builder mounts full-screen over the placed plan (`ProgramDraftProvider target="placed-plan"`, `components/clients/training/builder/plan-amendment-overlay.tsx`), with every elapsed day **locked** and the future fully editable — structure included. Entry point: the Plans-subtab hero's "Edit plan" — deliberately the ONLY one. The overlay amends `builder.plan`, the plan the right panel owns, and the hero describes exactly that plan. The placed-session tray used to carry an "Edit whole plan" item too, but the tray opens from an arbitrary calendar event and the entry resolved the plan from `builder.plan?.id`, never the event's own `planId`; with coexisting plans the calendar shows events from more than one, so editing a session of an upcoming program opened the amendment editor for the current one — and that editor rewrites the future of whichever plan it opens. Removed 2026-08-26; a tray entry may only return if it resolves the EVENT's plan. No RPC, no migrations — the writer uses the same app-side snapshot/compensate idiom as placement.

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
5. **Render-ready payloads.** The API emits display-ready, locale-neutral data (ISO dates on the wire, server-side aggregation/summaries) and speaks **canonical kg/cm** — there is no per-record unit on the wire and no conversion at the API boundary. The client renders in the viewer's own unit at the presentation layer, through `utils/unit-conversions.ts` with the preference from `useUnits()`: `formatWeight` for body weight, `formatLoad` for a barbell load (it snaps to a loadable increment), `formatLength` for girths, `formatHeight` for height. See `CONVENTIONS.md §20 Units`. (The old `formatWeight(weightKg, unitPreference)` in `utils/nutrition-helpers.ts` is deleted, along with that module's other conversion helpers.)

### Page / navigation structure

A persistent bottom tab bar (`components/client-portal/nav/client-nav.tsx`, `ClientBottomTabBar`) has four tabs: **Home** (`/client`), **Metrics** (`/client/metrics`), **Program** (`/client/program`), **Content** (`/client/resources`). The top bar (`ClientTopBar`) holds the logo, a notifications dropdown, and an avatar menu → **Settings** (`/client/settings`) + Sign out. Layout in `app/client/layout.tsx` (also owns the `pending_intake` onboarding gate). Check-in is **not** a tab.

- **Home** (`app/client/page.tsx`): day-summary cards (training, nutrition, wellness, habits) and a check-in summary card. Training renders a list when multiple sessions are prescribed.
- **Detail pages** (each fetches only its own data): `/client/training?date=X&eventId=Y`, `/client/nutrition?date=X`, `/client/wellness?date=X`, `/client/habits?date=X`. Back returns to home with the date preserved.
- **Metrics** (`/client/metrics`, `components/client-portal/metrics/metrics-hub.tsx`): progress hub — body metrics, habit progress + streaks, and trends.
- **Program** (`/client/program`): the client's current training plan + nutrition plan cards, with the **week view** above them (`components/client-portal/program/training-week-layout.tsx`): the current training week from `GET /api/client/training/week`; tap a session, then a day, to move it. Two sessions may share a day while rearranging — that is how a swap is made — but Save is disabled until every day holds at most one, the same status-agnostic occupancy rule the server enforces, applied before the round trip. Save is ONE `POST /api/client/training/events/layout` carrying every changed session with the day it was read on, so a 409 (drift, or a day taken since) shows the server's sentence with a Reload. The arithmetic — the week with unsaved moves applied, the conflicts, the write — is the pure `lib/week-layout.ts`; the component only renders and taps. Tap-to-move, no drag: the web app is the harness.
- **Check-in** (`/client/check-in`): reached from the Home check-in card (`components/client-portal/day/check-in-card-summary.tsx`) and from notifications (`actionUrl: "/client/check-in"`), not a bottom tab. The hub shows the submission form behind `getCheckInGate` (see "Check-in System") plus a newest-first history list drilling into `/client/check-in/[id]`. `unscheduled` and `not_due` each render their own refusal screen rather than the form.

### Data model

Reads/writes the existing day-keyed tables — no portal-specific schema:
- **Targets (read):** `training_events` (one row per session per date), `nutrition_events` (one per client per date).
- **Daily-logs spine + children (write):** `daily_logs` → `wellness_logs`, `nutrition_logs`, `training_logs`, `daily_habit_logs`.
- **Training completion:** `training_logs` → `session_logs` → `exercise_logs` → `set_logs` (per-set actuals). `prescribed_session_snapshot` / `prescribed_exercise_snapshot` JSONB preserve history when plans change.

### Database access (which client, and why)

Portal services follow the Shape B default (CONVENTIONS §8): **`supabaseAdmin` with a caller-verified scope.** The `/api/client/**` routes resolve `clientId` through `requireClientAuth(request)` (`lib/require-client-auth.ts`, which keys on `clients.user_id = auth.uid()`) and pass only that authenticated id down; services filter on it with `.eq("client_id", clientId)`.

The one exception is `getClientForCurrentUser` (`services/client-portal-service.ts`), which genuinely needs the session: it resolves the caller's own row from `auth.getUser()` and has no `clientId` to scope by. It uses `createPortalClient` — a bare re-export of `createServerSupabaseClient` — and that alias is also used by `services/client-portal-progress.ts` (a consolidation candidate, see `TECHNICAL-DEBT.md`).

`getClientNutritionTargets` previously read `clients` / `nutrition_plans` / `nutrition_plan_daily_targets` through the session-scoped client too. Those three reads moved to `supabaseAdmin` (2026-07-30): the route layer had already proven the `clientId`, so the RLS gate was duplicating a check rather than adding one — and leaving it in place meant a future "standardise onto `supabaseAdmin`" refactor would have silently removed the *only* control on a function that fans out to three service-role readers. See `TECHNICAL-DEBT.md → Opened by the 2026-07-30 anon-path read trace`.

### API surface

**Reads:** `GET /api/client/day-summary?date=` (home payload `{ training[], nutrition, wellness, habits }`, `no-store`) · `GET /api/client/training/week?date=` (`ClientTrainingWeek`, `types/client-training-week.ts` — every session in the check-in-anchored week containing `date`, each with a `state` of done / today / upcoming / missed derived against the client's today; ≤7 rows, `no-store`. Powers the session picker and the week view, and is exactly the set a layout write may touch) · `GET /api/client/training/events/[eventId]` · `GET /api/client/daily-logs/[date]/{wellness,nutrition}` · `GET /api/client/habits` + `GET /api/client/habits/logs` (habits are **not** under `/daily-logs/[date]`) · `GET /api/client/training-plan` (date-resolved; carries `state`/`startsOn`/`endsOn` — see "Client-side plan tier") + `GET /api/client/nutrition-plan` (Program tab) · `GET /api/client/journey` (Program tab's blocks; carries `currentBlockNotes: { blockId, notes[] } | null` — the coach-note visibility policy is enforced **here on the wire**, not in the renderer, so RN inherits it rather than re-deriving it; see "The three notes" above) · `GET /api/client/training/exercise-history` (bounded full return) · `GET /api/client/check-ins` (**keyset-default**, opaque base64url `{createdAt,id}` cursor via `lib/cursor.ts`; legacy `?offset=` opt-in).

**Writes:** `POST /api/client/training/events/[eventId]/log` (bulk-replace `session_logs` + `exercise_logs` with snapshots; updates `training_events.status`) · `POST /api/client/training/events/layout` (**client week layout** — `{ moves: [{ eventId, fromDate, toDate }] }`, 1–7 entries; a single move, a two-day swap and a whole-week rearrangement are the same request at different sizes, applied in one transaction by `move_training_events_atomic` (migration 150, park-then-place under the one-scheduled-per-day index — no schema change). Policy lives in `services/training-event-layout-service.ts`: only still-`scheduled` sessions move; each stays inside the training week it currently sits in; a past target is allowed only when that day has no logged workout; a target may not hold any non-moving event, whatever its status. `fromDate` is the drift check — a concurrent coach move answers 409 "your week changed", never a half-applied week. Nutrition follows the moved sessions: one cascade over every touched day, after the commit — the same non-transactional seam as a coach move) · `PATCH /api/client/daily-logs/[date]/{wellness,nutrition}` (nutrition is plan-active-guarded; wellness is ungated) · `POST /api/client/habits/log` (per-habit toggle for a date; ungated) · `PATCH /api/client/settings` (`unitPreference`, `timezone` — IANA-validated; `lib/validations/client.ts`. No `weight_unit`: that column is gone and was never accepted here anyway. `reminder_preferences` is a different endpoint. Reachable pre-activation — `getAuthenticatedClientId` gates on `clients.active`, not `onboarding_status` — which is what lets the intake form set a client's units before their coach activates them).

Every write resolves plan context once via `resolvePlanContextForDate(clientId, date)` to stamp the `*_plan_id` links, and enforces the past-day lock server-side.

### Workout logging (per-set completion)

**A tick means "I did this set", and it is the only thing that decides completion.** One mode, one primary button — the complete/partial/skipped selector and the per-exercise Skip toggle are gone, because an unticked row already says "not done" and the ticks answer the question the selector used to ask (`components/client-portal/training/`):

- **The row list mirrors the flattened prescription.** `seedDefaultValues` builds it from `buildPrescribedRows`, reopening a logged session restores the FULL prescription with the logged rows ticked, and a **prescribed row cannot be deleted** — only rows the client appended past it. That is what makes a row's position its `setNumber` end to end. Sizing keeps both ends: a logged set past the prescription (an appended row, or a prescription the coach later shrank) survives the round trip, because the write path full-replaces and a row missing from the form is deleted on the next save.
- **Values are optional detail on top.** Typing a value and blurring the row auto-ticks it (so a client recording numbers never touches a tick), copying a previous set banks the row it fills, and a **ticked set with all fields empty is still sent** — doing the work is the claim. An exercise-level tick banks one exercise; "Mark all complete" banks the session.
- **The payload carries exactly the ticked sets**, each with its 1-based `setNumber` into the flattened prescription. An unticked set is absent; an exercise with no ticks is absent entirely. `exercise_logs.completed` is vestigial — `true` for any exercise that reached the payload.
- **Warm-ups are recorded but never scored.** They render, are tickable, and are written to `set_logs` with `set_type: 'warmup'` so a coach investigating an injury can see them — and they are excluded from `full`, from the client's own outcome line, and from every performance metric.
- **The client is told what will be recorded before it is**, on one line above the button ("9 of 12 working sets logged. Will be recorded as partial."). It and the server's verdict come from one module (`utils/completion-quality.ts`), because that sentence is a promise about the coach's adherence number.
- Save is a single bulk-replace (no per-set auto-save, no draft persistence, no `localStorage`). The web form is the harness; the RN app keeps the in-progress workout in device storage and POSTs once. **Live coach visibility mid-workout is explicitly not a feature.**

### Alternative-session handling

A client trains on a day other than prescribed by **moving the session there first** (owner decision 2026-08-26): the rest-day "Log a session" picker lists this week's still-to-do sessions (`GET /api/client/training/week`) and a pick moves the chosen one onto that day and opens it (`POST /api/client/training/events/layout`); on a prescribed, unlogged day "Do a different session" swaps the two days. Any other rearrangement — "I'll do Thursday's session on Saturday" — is the Program tab's week view (`lib/week-layout.ts`), the same write at whole-week size. The write is `logTrainingEvent` in every case — there is no event-less writer — so every `session_log` is event-keyed and dated to its event. Snapshots: `prescribed_session_snapshot` from the event's session; `prescribed_exercise_snapshot` from the session performed. Adherence counts `training_events.status='completed'`; a moved session completes on the day it is done, and the coach calendar shows it there with the same edited badge a coach move sets.

### Date-edit permissions

One rule in `lib/daily-log-permissions.ts` (pure, client-safe): today always editable; past-never-logged editable (backfill); past-logged locked; future view-only. (The event-level "done on another day" clause that used to sit here was retired 2026-08-26 with the receipt model: a workout has one date, so the day rule alone decides.) `canEditDay(date, loggedStatus, clientTimezone)` drives UI disabled state; the server wrapper `assertCanEdit()` (`services/daily-log-permissions-service.ts`) throws `DayLockedError` → 403. Habits lock per-habit (optional `habitId` narrows the "logged" check), not per-day.

### Timezone model

**Locked model (Sessions 7.81–7.86): "today" is computed in the device timezone of the person whose calendar the date is on — never the server's UTC clock.** A client's day, plan placement, check-in window, streaks → the **client's** zone. A coach's dashboard windows (attention feed, current-week metrics, history summaries) → the **coach's** zone. The cross-person cases (a coach viewing a client's check-in due/overdue; background reminders) → the **client's** zone. One question decides every site: *whose calendar is this date on?*

- **Storage**: `clients.timezone` (migration 089) and `coaches.timezone` (migration 109), both `TEXT NOT NULL DEFAULT 'UTC'`, IANA.
- **Capture is device-synced, no manual picker** (Session 7.81 — intentionally reverses Session 2.6's "no silent overwrites"): the shared `useTimezoneSync` hook (`hooks/use-timezone-sync.ts`) compares the device zone against the stored value on every app load and fires a fire-and-forget PATCH on mismatch (client shell `app/client/layout.tsx` → `PATCH /api/client/settings`; coach shell `CoachTimezoneSync` under `app/(coach)/layout.tsx` → `PATCH /api/coach/settings`). Travel re-syncs on next open.
- **Read side**: server code derives "today" via `getTodayDateStringInTimezone()` in `lib/date-helpers.ts` — the only surface owning `Intl.DateTimeFormat` math. (Sanctioned exception: the two settings routes validate input zones with `Intl.supportedValuesOf("timeZone")` — validation, not date math.)
- **Helper inventory**: `lib/date-helpers.ts` owns the pure helpers — `getTodayDateStringInTimezone(tz, now?)` (string), `getTodayInTimezone(tz, now?)` (local-midnight `Date` for the injectable check-in helpers; NOT `parseISODate`, which parses as UTC midnight), `getDeviceTimeZone()` (browser capture). `services/today-service.ts` owns the DB-fetching ones — `getClientTodayString(clientId)` (client tz → coach tz fallback while the client is on the unsynced `'UTC'` sentinel → UTC) and `getCoachTodayString(coachId)`. **Rule:** when a `Client` record with `timezone` is already in scope, use the pure helpers (zero extra fetches — the overdue/attention-feed loops rely on this); the fetching helpers are for call sites holding a bare id.
- A stored `'UTC'` is the "never device-synced" sentinel; coach-initiated placement on a never-synced client's calendar falls back to the coach's zone (`getClientTodayString`, Session 7.82), then UTC.
- **Where each anchor applies** (Sessions 7.82–7.86): client tz — plan placement RPCs (`p_today`), calendar move/duplicate/delete guards, the client home week, check-in gate/window, streaks/habit defaults, goal-pace `today`, goal-deadline days-remaining (Session 7.86, `services/comparison-service.ts`), the coach calendar's drag/delete *gating* (Session 7.86 — the visual today ring stays coach-device), check-in due/overdue, and the placement-path event window-delete (`clientToday` threaded from the route as the additive RPC's `p_today` floor, `GREATEST(effective_from, today)`; migration 114 replaced the old STEP-0 cross-plan wipe). Coach tz — attention-feed window, coach "current week" metrics/history anchors, the attention-dismissal `dismissed_at` (migration 112 drops the column's UTC `CURRENT_DATE` default so a writer that forgets the date fails loudly), and the goal-deadline write bound (Session 7.86 — the coach is the setter, so the past-date check is route-side via `getCoachTodayString`; the zod schema is format-only). The placement RPCs additionally take `p_effective_from DATE DEFAULT NULL` coalescing to `p_today` (migration 110, carried into the additive 114/115 rewrites).

### Scale / payload contracts

Keyset-by-default is scoped to paginated, time-ordered "load older" history (check-ins). Small bounded sets return in full with no cursor (habits, a 1-week completions window, the exercise list). History rows are ID-first (`exercise_id` + `performed_name` fallback), never the catalog dictionary; the dictionary syncs separately via `GET /api/client/exercises/catalog?since=` (a read-only delta returning rows with `updated_at` after `since`; the client upserts them into its cached catalog — deletes are invisible to the delta, so a periodic full resync, by omitting `since`, catches them; internally paged past the ~1000-row PostgREST cap). Weights and lengths cross the wire as canonical kg/cm and are rendered client-side in the viewer's unit via `utils/unit-conversions.ts` (no formatter calls in `app/api/client/**`). Per-record unit tags and API-boundary conversion are rejected: storage is canonical (migrations 140-141), so the value carries its unit by definition and a per-record tag could only contradict it.

---

## Coach-side Data Flow

### SWR fetching

All coach-side data fetching uses SWR with:
- `revalidateOnFocus: false`
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
| Metrics (**labelled "Journey"**) | `MetricsTabContent` | Four panes via `?journey=` — **Physique** (metric hero + progression chart + measurement log over the measurement log's day-values, `GET …/measurement-series`: every reading with its source and note, the derived baseline, the start date, readings before it under "Before start"), **Wellness** (the same hero, chart and log over the merged check-in weekly averages ⊕ coach-logged `client_metric_entries`), each with the "Log measurement" modal (a physique key appends to the log, a wellness key upserts an entry), **Training** (`ExerciseDataView`, moved here from the Training tab in Session 7.1 — analytics live in Journey, prescription stays on its own tab), and **Blocks** (`client_phases`; see "Journey blocks"). `JourneySubtab` is deliberately WIDER than `MetricTab`: Training and Blocks key none of the metric shapes (`metricsByTab` / `logRowsByTab` / `DEFAULT_FOCUS`) and are mapped onto `"body"` by `toMetricTab()`, a whitelist so the next pane is safe without editing it |
| Training Plan | `TrainingPlanCard` → `TrainingPlanBuilder` (Data / Plans) | Calendar + hero. **Exercise analytics moved to Journey → Training** (Session 7.1) — do not hunt for an Exercise Data pane here; the history table's exercise drill-down now crosses tabs to it. "Apply program" opens the library drawer, which remounts the shared `/dashboard/programs` builder in `client-draft` mode; "Edit plan" (hero — the only amendment entry point; see "Plan amendment") opens the same builder in `placed-plan` mode over the live placed plan (see "Plan amendment"). (The plan-history list below the calendar was removed with the dead `training_plan_history` read chain — the table has had no writer since P7.) |
| Nutrition | `NutritionCalculatorCardEnhanced` + `NutritionHistoryTable` | Plan builder, per-day nutrition calendar, weekly adherence history |
| Wellness | `WellnessTabContent` | Wellness trends and analysis |
| Daily Habits | `HabitsTabContent` + `HabitsHistoryTable` | Habit management, analytics |
| Check-ins | `CheckInsTabContent` | A `Check-in history` rail whose one action, "Customise check-in", opens the per-client form editor (see "The customisable form" under Check-in System) — it sits ABOVE the body's four states, because a coach shapes a form before the first check-in exists. Under it, the client's check-in history, newest first, over `useClientCheckInsInfinite` ("Load older", `CLIENT_CHECKINS_PAGE_SIZE` per page on a **keyset cursor**; `hooks/use-check-in-data.ts` owns the list key and its invalidator). Each row is a `<Link>` to `checkInReviewUrl`; with `?checkIn=<id>` present the tab renders the review surface, `CheckInDetailView` (`components/clients/check-ins/`), in place of the list — one page: the KPI ribbon over Training beside Nutrition, then Wellness, Habits, Client notes, Goal progress, the AI review (Regenerate) and the Reply (Send). See "The coach review surface" under Check-in System |
| Notes | `NotesTabContent` | `client_notes` list — pinned first, newest-first, add + pin/unpin. Same endpoints as the Overview card |

`activeTab` is DERIVED from `?tab=` on every render (CONVENTIONS.md §7 → URL-driven UI state). Tab changes go through `handleTabChange` → `buildClientTabUrl` (`lib/client-tabs.ts`), which `router.replace`s without scroll: it is the URL **builder**, so cross-tab navigation runs through it to get the query assembled correctly (`?subtab=` stripped, `extraParams` applied). The training history table's exercise drill-down takes the handler as a prop, and the nutrition drawer's `GoalSummary` writes a sentence rather than a link. **Every tab owns a pane param named after itself** — `?journey=` (Physique/Training/Wellness/Blocks), `?training=` (Data/Plans), `?nutrition=` (Data/Plans). Single-owner is the whole contract: only its own tab reads it, so it rides through a tab switch and restores that pane on the return trip, and it is read *unconditionally* — a deep link resolves on the first render. The shared `?subtab=` that Training and Nutrition both used to write is retired (Session 7.2) — still read as a guarded fallback so old links resolve, still deleted on every tab change, written by nothing. `extraParams` ADDRESS a pane on arrival and a `null` value deletes a carried key.

**The Check-ins tab's single-owner param is `?checkIn=<id>`** — a record id, like Journey's `?block=`, read unconditionally, so a pasted `/clients/{id}?tab=check-ins&checkIn=<id>` opens the check-in on the first render and an open detail survives a sidebar round trip (see "The coach review surface" under Check-in System). `checkInReviewUrl(clientId, checkInId)` (`lib/client-tabs.ts`) is the ONE writer of that form, for every cross-page deep link: the roster's review rows and their "Review check-in" action, the bell's New Check-Ins rows, and the dashboard's "Recent check-ins" rows. (The legacy `/check-ins/review` queue was the first caller and was deleted 2026-08-30.) **The tab's list rows are real `<Link>`s to it — the one `push` in this contract**: browser Back returns to the list, and the tab does not change because it is the same tab. A cross-tab open (the Overview's "Review" row) goes through the handler as `{ checkIn: id }` and stays a `replace`: a push there would leave the URL on `?tab=overview` after Back while the visible tab stayed on Check-ins. The detail's back row, and the return after a reply is sent, clear the param through the handler (`{ checkIn: null }`).

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

Four params are **one-shot**, consumed and stripped by the surface that receives them (`hooks/use-journey-round-trip.ts` for the first three, `hooks/use-profile-editor-trip.ts` for the last): `?apply=1` / `?edit=1` opens the Training apply tray or the Nutrition plan drawer, and `?returnTo=journey&returnBlock=<id>` names the Journey block to return to on a **successful save** (`?journey=blocks&block=<id>`, which wins over the default-expanded current block). Stripping on arrival is not tidiness — the whole query is carried across every tab change, so a `returnTo` outliving its own flow would bounce a coach to Journey after a **later, unrelated** save, and a lingering open-param would re-open the surface on every hand-return to the tab (Radix unmounts inactive `TabsContent`, so each visit is a fresh mount). The hook also drops the return target on any close without a save. The affordance is offered on **current and future** blocks only; elapsed and archived keep plain text (`blockAcceptsSetup`). The fourth, `?editProfile=1` (`OPEN_PROFILE_EDITOR_PARAM`), opens the Overview's client details sheet on arrival; the check-in goal strip's `Set new goals` sends a coach there with `checkIn` cleared in the same navigation, so Back does not land on the review it left.

### Builder flows

- **Training (authoring)**: `ProgramDraftProvider` (`components/clients/training/program-builder/`) owns the draft tree, revision-counter dirty tracking, set-spec mutations and the save/apply/amend pipelines. It is the **only** training authoring state, used identically in `target="library"`, `target="client-draft"`, and `target="placed-plan"` (the amendment surface — see "Plan amendment" under Coach Library). It deliberately lives beside the builder rather than in `contexts/`, because a route layout mounts it.
- **Training (client tab, read-only)**: `TrainingBuilderProvider` / `useTrainingBuilderContext()` wraps `useTrainingPlan` and supplies the client's current plan + `fetchPlan` to the Plans tab. Read surface only — do not add authoring to it.
- **Nutrition**: `NutritionBuilderProvider` wraps `useNutritionBuilder`. Manages the protein multiplier, diet type, macro breakdown and the custom-macros toggle, and is the one remaining `generatePlan()` caller. **Anything that must happen only on a real save keys on `generatePlan`'s BOOLEAN, never on the drawer closing.** The drawer's auto-close watches `!isGenerating && hasPlan`, which stays true for a client who already had a plan — so it also fires when a *regenerate* failed. And `generatePlan` deliberately returns `false` after a committed plan whose `nutrition_plan_notes` insert threw (Session 6), leaving the coach in the drawer with their note intact. Both are correct; both make "the drawer closed" the wrong success signal. **It does NOT own activity level or the energy pair** — those are client facts read from the profile (see "Client energy" above). The drawer shows TDEE read-only with a drift line when the covering version's snapshot differs from the live profile; the work-activity dropdown that used to live here was removed in Session 4B, because it gave activity two homes that disagreed and made "regenerate a plan" the accidental way to update a client's TDEE.

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
| `GET …/overview-brief` | Needs attention, the activity feed, the identity row's check-in cluster, the wellness flags | **Read-only** — it does not touch the `last_viewed_at` anchor |
| `GET …/goals` | The status band's goal targets and the details sheet's goal seeds | Via `hooks/use-client-goals.ts`, which owns the key builder and the matching area invalidator. The tab resolves the record through `resolveEffectiveGoal` and passes the result down; the card never touches the `clients` mirror. The hook returns the RAW goal — `EffectiveGoal.startDate` coalesces to today, so seeding a form from it would write today into a field the coach never set |
| `GET …/goals/history` | The footer's Goal-history popover | **Lazy** — the SWR key stays `null` until the popover opens, so the Overview does not pay for it on every load. Superseded versions only, bounded |
| `POST …/overview-brief/seen` | "Mark seen" | The ONLY writer of `coach_client_views.last_viewed_at`; returns `{ lastViewedAt }` nested under `data` |
| `GET …/overview-plan-summary` | Current-plan cards | `training`, `upcomingTraining` and `nutrition` are independently nullable |
| `GET …/adherence?days=` | The three-rail adherence card | The Overview passes `ADHERENCE_WINDOW_DAYS`; the route clamps to **[7, 60]**, wider than any caller needs since the 60-day window it was raised for was removed. Rails are index-aligned with `dates` |
| `GET …/measurement-series` | The progression chart | The measurement log's day-values for every metric (`client_measurements_live`, paged past the row cap), the derived baseline per metric and the client's start date — one payload, the same one the Journey's Physique pane, its measurement log and the blocks read (`hooks/use-measurement-series.ts` owns the key and the area invalidator). No date param: the chart's axis runs from the start date to today, the baseline is drawn at the start date with the reading's own date in its label, and a reading dated before the start date is not a point |
| `GET …/daily-logs` | The five wellness cards | Through `useWellnessData(clientId, { daysBack, withHabitLogs: false })` — narrowed to `WELLNESS_WINDOW_DAYS`, and the habit fetch stays off because nothing on the Overview reads habit logs |
| `GET`/`POST …/notes`, `PATCH …/notes/[noteId]` | Coach-notes card + Notes tab | See `client_notes` above |

Load-bearing details:
- **The anchor moves only on "Mark seen".** The GET was made read-only so a page load cannot silently clear the coach's unread feed. A first visit (null anchor) returns an empty feed and renders a first-visit state rather than a caught-up one.
- **The Current-plan rail's `Week X of Y` describes the active *training* block — not a *journey* block.** Via `utils/plan-week.ts`. "Ended" here means today is past the **authored duration** — a different derivation from the slot-count one the client reader and the amendment surface share (see "Client-side plan tier" above for why both exist). A *journey* block (`client_phases`, migration 145 — see "Journey blocks" under Client Goals & Body Metrics) is an unrelated concept sharing the word: a coach-authored label on a stretch of the client's calendar that prescribes nothing, and neither surface reads the other. (The previous "no roadmap or phase concept exists" claim here died with migration 145; the roadmaps/phases *feature* that migration 133 removed remains removed — journey blocks are not its return, see the workstream plan's §1 for the shapes that must never come back.)
- **Training has three states, not two.** `getTrainingPlanForDate` resolves strictly by date (`.lte("effective_from", today)`), and placement deliberately permits a future start date (`place-from-library` rejects only the past), so a program starting tomorrow leaves `training` null. The window-flipped twin, **`getNextFutureTrainingPlan`** (`services/training-service.ts`), is the ONE owner of the "starts later" predicate — client-scoped, `deleted_at IS NULL`, **`status <> 'archived'`**, earliest first. This card and the Training tab both read through it. They previously hand-rolled it separately and the Training tab's copy omitted the archived exclusion, so a retired program resurfaced there as the client's current plan while this card correctly said "No plan". Never write a fourth copy. `upcomingTraining` carries that queued program so the Overview reports "Starts Mon, 27 Jul" rather than "No plan" — the old copy told a coach who had just assigned a program that none existed, and its "Open Training" call to action invited them to place a *second* one alongside it, which the additive placement model accepts. A program whose window has **ended** deliberately keeps the "no plan, place one" invitation: an ended plan cannot be amended, so assigning a new one is the correct gesture. Do not widen `getTrainingPlanForDate` to fix this — write paths stamp `training_plan_id` from it and need "the plan governing today" to keep meaning exactly that.
- **Goal chips come from `lib/goals/goal-state.ts`** (reached / beyond / gap). The under-vs-over wording needs the direction of travel, which only the call site's `start` value knows.
- **Alert rows route through `lib/attention-alert-destinations.ts`**, the same map the dashboard feed uses, so the two surfaces cannot disagree about where an alert leads. Each row also carries a hover-revealed dismiss that posts to the **dashboard's** `POST /api/dashboard/attention-feed/dismiss` — one `attention_dismissals` store serves both surfaces, and `evaluateSingleClientAlerts` already filters on it, so dismissing here clears the alert on the coach dashboard too and lapses when a newer day trips the same trigger.
- **A mono datum inside a sans line uses `InlineMono`** (`overview/overview-primitives.tsx`), never a literal space. At 13px an Instrument Sans space measures **2.5px** against JetBrains Mono's **7.8px** (CDP-measured), so `Starts <date>` written with a plain space leaves the label glued to the value while the value's own internal spaces look 3× wider. `InlineMono` carries `ml-[1ch]`, which resolves against its own font and therefore always matches the datum's rhythm at any size — call sites must not add a space of their own.
- **Three surfaces must be told when their data is still loading.** `CoachNotesCard` (`isLoading`), the identity row's check-in cluster (`isTimingLoading`) and the progression chart (`isLoading` with a null series) all receive empty-shaped data while pending *and* when the client genuinely has none. Without the flag they render a confident "no notes" / "Not scheduled" / "No measurements in this window" and contradict it a moment later. Covered by `overview/loading-states.test.tsx` and `progression-chart.test.tsx` — keep the flag threaded through any new consumer.
- **Five wellness cards**, Soreness included. Stress and soreness are inverted (lower is better) through `getWellnessTone()` in `utils/wellness-color-thresholds.ts` — the single source for that inversion, shared with `components/check-in/mini-bar-sparkline.tsx`. **Sleep has no trigger in `lib/wellness-triggers.ts`, so its card can never flag; do not invent one.** There is deliberately no composite wellness score anywhere — only per-metric tones — so wellness is five cards rather than a fourth rail with a percentage.
- **The training rail's `none` state renders a dash, not a dot.** No session was planned that day; losing that turns every rest day into a miss.
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

- Public routes (skip auth entirely): `/invite/*`, `/api/invitations/*`, `/forgot-password`, `/reset-password`, `/auth/callback`. **`/check-in/*` and `/api/check-in/*` are NOT public** — the magic-link check-in flow went with migration 142; clients check in through the authenticated portal (`/client/check-in`), and `/api/check-in/[id]/*` is a coach route (see "Route namespaces")
- Trainers: restricted to `trainerRoutes` (exported from `middleware.ts`) — `/dashboard`, `/clients`, `/crm`, `/automation`, `/settings`, the five folders of `app/(coach)/` (see "Coach route group"). Any other path is left to Next, which 404s it for either role
- Clients: restricted to `/client/*` routes
- Role mismatch: redirects to appropriate dashboard

### Coach route group (`app/(coach)/`)

**Folder membership is what makes a route a coach route.** Every trainer-facing page lives under `app/(coach)/` — `dashboard/`, `clients/`, `crm/`, `automation/`, `settings/` (route groups do not appear in URLs) — and `app/(coach)/layout.tsx` is the coach application boundary: a server layout that renders the page plus the two concerns that must run on every coach page whichever shell it uses, `CheckInNotificationListener` and `CoachTimezoneSync` (`components/coach/coach-timezone-sync.tsx`, the coach twin of the `useTimezoneSync` call in `app/client/layout.tsx`). Nothing else belongs there.

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
- **Usage**: routes call `recordAuditEvent(...)` **fire-and-forget** (`void`-prefixed) after a successful, already-authorized write. Action names come from `AUDIT_ACTIONS` (`lib/constants.ts`). Live call sites include client invitation/activation, goal create, training placement, plan amendment, measurements and wellness entries, nutrition plan creation, and intake metrics sync. Failures go to Sentry, never to the user.
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
- `hasNutritionPlan` - a nutrition version covers the client's today OR one is queued (covering-or-future, migration 144: a coach who queued a first plan HAS done the nutrition setup, so they read as ready). **Deliberately WIDER than the client's nutrition log guard** (`assertHasActivePlan`, covering-only): "is the client set up?" (a queued first plan counts) and "can the client log today?" (only a covering version counts — no target before the plan starts) are different questions with different answers. Do not unify them.
- `hasHabits` - client has active daily habits

Uses `Promise.all` with `safeQuery()` wrapper for partial failure tolerance. The coach sees the `ClientActivationBanner` component which shows the checklist status.

**The card lists a fourth row that is NOT on the wire: "Client profile"**, and it leads the list because everything below it is priced off it — the nutrition calculator solves against the TDEE the profile produces. It is derived in the browser by `findProfileGaps` (`lib/client-profile-completeness.ts`) from the client record the Overview already holds, so it costs no query and this endpoint keeps answering *"is it there?"* rather than *"what is in it"*. **`clients.tdee != null` is deliberately NOT the check**: `computeEnergyPair` hard-gates on weight/height/gender but silently substitutes `DEFAULT_BMR_AGE_YEARS` and `DEFAULT_WORK_ACTIVITY_LEVEL` for a missing birth date and activity level, so a client missing both still has a BMR and a TDEE built on two guesses. The gap list reads the computation's own `ageSource` / `activityLevelSource`, which also makes it exact rather than blunt: age is not asked for on the Katch-McArdle path (no age term), and activity level is not asked for once `tdee_manual_override` is set (the coach has overridden the only thing it feeds). It is a **prerequisite, not a plan** — it stays out of the "N of 3 plans ready" counter, the footer sentence and the activation dialog's missing-list, because activation sends nothing for it. Its "Set up" forks by gap: a missing **weight** is a logged measurement and goes to Journey → Physique; everything else is a profile fact and opens the Overview's own inline editor. `activation-readiness` is advisory — `POST /api/clients/[id]/activate` does not enforce it. The orphan-log perimeter lives at the per-card **nutrition** writer (`assertHasActivePlan` in `services/daily-context-service.ts`): it rejects a write whose `nutrition_plan_id` stamp would be null, because that stamp feeds adherence reads. The training writer (`POST /api/client/training/events/[eventId]/log`) needs no guard — the event already carries its `training_plan_id` from plan generation — and it is the only training writer since the event-less path was retired (2026-08-26), so `assertHasActivePlan`'s `training` resource has no caller. Wellness and habits writes are deliberately ungated (Session 3.1C) — wellness has no plan or adherence concept, and all wellness analytics are date-windowed.

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
LOGGER writing to `training_events` — so they carry no key either, and the two
steps are unconditional. With every key off a client still gets a two-step
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
the week, the submitted date, `N/M days logged` (days in the period with ANY daily log — the
Nutrition rail's own count is days with food logged, a narrower question, so the two can
legitimately differ) and `N days since last check-in`. There is no prev/next between check-ins
and no window keydown listener. Weight and body fat appear twice on purpose: the band answers
"what changed since last time", the strip answers "where do they stand against the goal".

**The goal strip** (`check-in-goal-strip.tsx`) is one row per goal — weight, body fat — each a
value, a track and a state column resolved `status` > `paceStatus` > `isOnTrack`: `Reached` (with
the distance past target on an overshoot), `On track`, `Behind pace`, `Deadline unrealistic`,
`Needs attention`, the last four carrying the distance to go — or `No reading yet`, muted, when the
client record carries no current reading for that goal: the position is the record's reading
(the measurement log's newest row, see "Goal progress and pace"), never the check-in's, so a check-in submitted
without a weight leaves the row standing with an empty track. `paceStatus` judges whether the RATE
REQUIRED to hit the deadline is safe; `isOnTrack` whether the client is moving towards the goal;
reading them in that order is what keeps "On track" off a client past a weight-loss target. Body
fat carries no pace status and falls through the same column, so the two rows cannot reach
different verdicts about one client. The deadline is the rail's meta (`deadline d MMM · N days`,
or `Overdue by N days`); with no goals the rail stands over a verbatim empty state. **One advisory
footer, and goals outrank nutrition**: every judged goal met (a `No reading yet` row neither earns
the note nor blocks it) → "Goal met - consider setting a new target."
with the `Set new goals` button, which sends the coach to the Overview with `?editProfile=1` and
`checkIn` cleared (the details sheet opens on arrival, and Back does not land on the review it
left); otherwise, weight 3 kg or more from the base weight the nutrition targets were built on →
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

**What the review is given.** `buildCheckInAnalysisPrompt` (`utils/ai-prompt-builder.ts`) assembles
the prompt; `AI_SYSTEM_PROMPT` and `buildAnalysisTaskPrompt` carry the rules. Three of them are
load-bearing.

**Nutrition carries both denominators, each named.** Intake is stated over the days the client
LOGGED, against the targets that applied on those same days (`loggedDayMeanConsumed`,
`loggedDayAdherencePercentage`); the whole-period figure is labelled *coverage*. The prompt states
that unlogged days are unknown rather than zero, and forbids characterising intake from the coverage
figure at all. A client who logs two of seven days and hits target on both is 34% adherent and 100%
on target: only the first number describes anything, and what it describes is a logging problem.

**The session count is derived** through `summariseSessions` on the live event-detail branch, so it
matches the KPI ribbon. Previous check-ins in the trend block carry no count at all — they are bare
`CheckIn` rows, so the only figure available on them is the stored full-only column, and deriving
one per row would be a query per check-in.

**The task asks for a read, not a recap**: the week's story and what drove it, observations that
carry what they connect to, and co-occurrence across metrics and across days. An uncertain
explanation offered as a question is preferred to silence.

**Empty states.** When the AI half is wholly empty the card shows a single placeholder ("No AI
review yet. Regenerate to write one.") rather than one per block. Regenerate reports a non-OK
response, the coach-keyed `aiRateLimit` 429 included.

**The Reply block** (`check-in-reply-block.tsx`) is the last section and the destination of the
page: everything above it is what the coach reads before writing it. Full width, one primary
button, Copy beside it. The draft is the review's `clientMessage`, a prop synced by effect, so a
Regenerate replaces it rather than leaving a stale draft to be sent. **A sent reply does not lock
the block**: the previous message becomes context above a live box, the rail dates it
(`Sent MMM d`) and the button reads `Send follow-up`. A successful Send returns the coach to the
list and refreshes it. The block renders whether or not the AI has run — the coach's message is
not the AI's output.

**The comparison payload carries only what the page renders.**
`GET /api/check-in/[id]/comparison` returns `previous` (a null-check for "is there anything to
compare against"), `timeBetweenCheckIns`, the client's drift-banner fields, `goalProgress` — position,
trend and pace status per goal, nothing projected — and seven `changes`: weight, body fat and the
five wellness metrics, each a signed difference against the previous check-in, present only when
both check-ins carry the metric — the readings being each check-in's own stamped rows in the
measurement log, so a reading logged between the two never enters the comparison. Every delta the
page draws goes through one rule
(`formatDeltaValue`, `components/check-in/delta-format.ts`): rounded to one decimal like the value
beside it, coloured by its direction, neutral only at 0.0. **There is no chart series
at all**: the band shows a value and a delta, and a trend line behind them read as chart junk on a
dark strip. Girths, `workoutsCompleted` and `adherencePercentage` are not on it either, and neither
is the current check-in (the caller fetched it by id). `workoutsCompleted` is why: deriving it cost two
`deriveSessionCompletionsForCheckIn` calls per request, one for each side, purely to render a
delta — the KPI ribbon's fraction and its `N partial · N missed` breakdown answer the same
question from data already in hand.

**Data: `hooks/use-check-in-detail-data.ts`, SWR throughout.** `GET /api/check-in/[id]` and
`…/comparison` read in parallel behind `checkInDetailKey` + `useInvalidateCheckInDetail` (the area
is the detail and everything under it). The window's daily and habit logs come through
`useWellnessData`'s explicit `range` — the same reader the Overview's wellness cards use, so those
two keys have one builder. `…/nutrition/plan-targets?dates=` is a dependent read for the window's
unlogged days only, folded with the logged days' own snapshotted targets into the full-week
nutrition target. The window is the stored `period_start`/`period_end`, else the six days up to
`created_at` (pre-Session-6.4 rows). Three sequential stages, as the raw-fetch version had; SWR now
dedupes re-opens.

**The figures, and what they divide by.** The review's nutrition and habit
numbers are computed SERVER-side over the check-in's own reporting period and
arrive on `GET /api/check-in/[id]` as `periodAdherence`
(`getCheckInPeriodAdherence` → the shared Overview kernel's
`getClientAdherenceForRange`). Both denominators are **the whole period**, from
`periodAdherence.dates.length` — never a day count derived in the renderer,
which resolves differently on a legacy row. The KPI ribbon's **Nutrition** cell
is days on target over that period (it was "Calories", a daily average over the
days a client happened to log, which read HIT for three logged days out of
seven); the Nutrition card's pill is on-target over period days, beside a weekly
HIT/PARTIAL/MISSED verdict that stays locally derived because it asks a
different question. Habits come from `perHabit`, built from the HABIT list, so a
habit the client ignored all week reads 0/7 instead of vanishing — `logHabit`
writes a row only when they act, and the old grid read `/habits/logs`. **Training
is deliberately NOT on that wire**: this surface counts full AND partial
completions through `summariseSessions`, while the Overview kernel counts full
only. ONE derivation serves the whole surface — the KPI ribbon, the training
section and the AI prompt — and `lib/check-in/adherence-ownership.test.ts` scans the
coach tree to keep it so, forbidding both a read of the stored
`check_ins.workouts_completed` column (that column is the RN wire's, and the
client's own surfaces read it) and a hand-rolled count over event statuses.
`components/check-in/training-session-checklist.tsx` is excluded by name: it is
the client's wizard step, not a coach surface. Unifying the two conventions is
deferred debt (CONVENTIONS §8). `periodAdherence` is `null` when a legacy row's period cannot
be resolved (pre-038 and no schedule to anchor a week to), and the cells render
their empty states rather than fall back to a second definition.

**Adherence figures and averages take DIFFERENT denominators, on purpose.** An
adherence figure asks *did you do what you were supposed to*, so an unlogged day
counts against it and the denominator is the whole period — the KPI's Nutrition
cell, the pill's on-target fraction, the kcal total and its bar. An average asks
*what was it typically*, and an unlogged day is **unknown, not zero**: dividing
by days with no data does not make the average smaller, it makes it wrong. So
the wellness means divide by each metric's OWN logged days (per metric — stress
and mood can be logged on different days), and the nutrition card's kcal and
macro averages divide by logged days, each macro against the target that applied
on those same days. Both were calendar-day divisions until 2026-08-30 and both
were badly misleading: two stress entries averaging 6.5 rendered as 1.9 —
"relaxed" — beside an AI summary that correctly called the week high-stress
(`calculateMetricAverages`, which writes the stored snapshot the prompt reads,
had always divided by its per-metric count; the card was the only place that did
not), and three logged days at ~161g of protein rendered as 69g against a 159g
target, a collapse that never happened.

**The stored figure changed meaning** (2026-08-30, D5.2). `check_ins.adherence_percentage`
and `nutrition_days_on_target` — and the AI prompt's "Weekly adherence" — divide
by the WHOLE period's targets, resolved through `buildNutritionSummary`
(logged day's frozen target → that date's nutrition event → the plan's weekday
template). All three writers go through `getNutritionSummaryForPeriod`, so they
move together. Rows written before that date carry the old logged-days-only
meaning and were **not** backfilled: reconstructing each historical week's
targets would invent numbers, because plans get replaced and events get edited.
The visible consequence is one-off — `comparison-service` reports the change
between consecutive check-ins, so the first check-in after the switch shows a
drop against a predecessor measured the old way. It is RN-visible
(`CLIENT-APP-REFERENCE.md` → Adherence Calculations).

**The client-id guard.** The detail is fetched by check-in id but the context by the page's client
id, and `GET /api/check-in/[id]` refuses only a *foreign* coach — a coach's own other-client id in
the URL would pair one client's check-in with another's logs and targets. A check-in whose
`clientId` differs from the page's renders the error state and fetches no context.

**After Send** the rail reports done and the tab does three things before clearing `?checkIn=`: its
own bound list `mutate()` (a filter mutate cannot reach a `useSWRInfinite` reader),
`useInvalidateClientCheckIns` (the Journey reader's page caches) and `useInvalidateCheckInsQueue`
(the bell and the toast listener). Regenerate revalidates the detail in place through its bound
mutate.

### The React Native contract

`/api/client/check-in-status`, `check-in-context` and `notifications` are read by the mobile client.
**Additive OPTIONAL keys are allowed; removals and renames are not.** Their three test files are the
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
