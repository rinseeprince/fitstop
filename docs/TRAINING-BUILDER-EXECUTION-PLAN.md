# Training Program Builder — Execution Plan

> **Intent:** Ship a standalone full-page multi-week **Program builder** for authoring reusable client-agnostic training templates, deepen the prescription to a **per-set model** (per-set specs, set types, supersets, coach note + video), and **repurpose the client-attached builder** to a library + apply-to-calendar surface that remounts the same builder as a client-draft editor — so editing a client's version **never mutates the source template**. The event-sourcing / immutability / provenance architecture is preserved throughout; every change is additive and non-destructive.

---

## 1. How to use this document

- **The six phases are ordered. Do not start Phase N+1 until Phase N is committed.** Each builds on the last; several later phases depend on Phase 1's set model and Phase 2's shared component.
- **Run one phase per fresh Claude Code session.** Each phase has a **"Prompt to paste"** block that is self-contained: paste it into a new session, it tells the session to read the shared context (§4) + its own block, confirm scope, implement, run the gates, and commit.
- **Report the plan before implementing.** Every phase prompt instructs the session to investigate + confirm scope/out-of-scope with you before writing code. Honor `CONVENTIONS.md §2` ("Always show a plan before writing code").
- **"Tests to write" is scope, not optional.** A phase is not done until its tests exist and pass alongside the type-check and lint gates.
- **This is a living contract with your existing docs.** Where this plan and `docs/ARCHITECTURE.md` disagree, this plan wins for training-builder work *once a phase lands*; until then ARCHITECTURE describes the pre-overhaul state. `CONVENTIONS.md` always wins on coding/auth rules. Update `docs/ARCHITECTURE.md` when a phase ships schema (its migration workflow requires it).

---

## 2. Global standards (every phase must meet these)

**Commit-ready gate (all green, every phase):**
```
npx tsc --noEmit        # no type errors
npx eslint .            # no lint errors (floating promises, console.log, no-explicit-any)
npx vitest run          # all tests pass
```
Plus: no `as any` (use `types/database.ts` types or a local interface), no leftover `TODO/FIXME/HACK/DEBUG`, no `console.log` debug artifacts.

**File-size limits (guidelines — split at the higher number when a natural boundary exists):** components 250/300, services 300/400, API routes 250/300, utils 150/200, hooks 300/350. The builder is built as a **composed tree of small components**, not a monolith (the current `draft-editor.tsx` is 732 lines — do not extend that pattern).

**Test layers:** service logic → `services/*.test.ts`; API endpoints (success + error/authz cases) → route `*.test.ts`; component render/interaction → `components/**/*.test.tsx`. Pure helpers get direct unit tests (highest ROI). Coverage target 70%.

**Migration workflow (mandatory, per `CONVENTIONS.md §8`):**
1. New file `supabase/migrations/NNN_<desc>.sql` with the next number (latest on disk = **118**; this plan uses **119, 120, 121**). Never edit/reuse/skip numbers.
2. `npx supabase db push` — **note: prod push is classifier-blocked in auto-approval mode; ask the user to run it via `! npx supabase db push` or add a permission rule. `git commit` + `gen types` are fine for you to run.**
3. `npx supabase gen types typescript --linked > types/database.ts`.
4. Skim the `types/database.ts` diff — it must correspond exactly to your migration.
5. Commit the migration + regenerated types in the **same commit**.

**RPC conventions (for the analytics-RPC change in Phase 1 and any RPC touch):** `SECURITY DEFINER`/`INVOKER` as the original chose; DROP the old overload by **explicit argument signature** before recreating (a changed `RETURNS TABLE` shape forbids `CREATE OR REPLACE`); `SET search_path = public`; `REVOKE ... FROM PUBLIC, anon, authenticated` + `GRANT ... TO service_role`; **pure ASCII inside `$$` bodies** (the pinned supabase CLI's statement-splitter chokes on non-ASCII). New optional args → SQL `DEFAULT NULL` + omit (pass `undefined`) in the caller; never explicit-null.

**Architecture invariants (do not break):**
- **Route auth chain, in order:** rate-limit → CSRF (mutations) → `getAuthenticated{Coach,Client}Id` → IDOR ownership check → zod `safeParse` → business logic in try/catch. Pass `request` to the auth helpers.
- **Services use `supabaseAdmin` + an explicit caller-verified scope** (`coachId`/`clientId`) and filter on it.
- **Events-as-SOT:** date-specific truth lives on `training_events`; plans/templates are blueprints/provenance. Never rewrite historical events. Placement is additive (deletes only its own future window; no cross-plan wipe).
- **Surplus cascade:** every training event-write must keep `training_events.calorie_surplus_percentage` populated (`session.surplus ?? plan.default`), or nutrition silently falls back to rest-day calories.
- **SWR + `swrFetcher`** for all fetching; **no new dependencies** without asking.
- **Immutability:** templates are edited in place by the coach on the library surface; a **client's edits never mutate the template** — they materialize onto the client's calendar events.

---

## 3. Shared context — the data model as it exists today

### 3.1 Two parallel hierarchies

```
LIBRARY (templates)                     APPLIED (per client, calendar SOT)
coach_saved_plans                       training_plans
  └ coach_saved_sessions                  └ training_sessions
      └ coach_saved_exercises                 └ training_exercises
                                              └ training_events  (one row per session per date)
```
Applying a template **clones** library rows into the client hierarchy and **materializes** `training_events`. `training_plans.saved_plan_id` (FK, `ON DELETE SET NULL`) is provenance back to the source template. Event→plan FKs are `SET NULL` + nullable (mig 113), so deleting a plan never destroys logged history.

### 3.2 Prescription = one row per exercise (identical shape in both tiers)

`coach_saved_exercises` and `training_exercises` both carry: `sets INT`, `reps_min`, `reps_max`, `reps_target TEXT` (free text, e.g. `"AMRAP"`), `rpe_target NUMERIC`, `percentage_1rm NUMERIC`, `tempo TEXT`, `rest_seconds INT`, `superset_group TEXT`, `is_warmup BOOL`, `notes TEXT`, `order_index INT`, `exercise_id` (FK to `exercises` catalog, nullable).

**So supersets and warm-up already exist — as exercise-level flags, not per-set.** The net-new axis is a **list of sets per exercise**. `notes` already exists and will serve as the per-exercise coach note (just needs surfacing). There is **no video field** on the exercise or the `exercises` catalog.

### 3.3 Logged-set shape + prescription→prefill

`set_logs` (mig 090): `(id, exercise_log_id FK CASCADE, set_number, reps 1..100, weight 0..2000, rpe 1..10, timestamps)`. **No `set_type`, no per-set note.** Chain: `session_logs → exercise_logs → set_logs`; event-keyed via `session_logs.training_event_id` (mig 097). Client prefill `seedDefaultValues` (`components/client-portal/training/log-form-types.ts`) expands the prescription's `sets` count into N empty rows; rep-range/RPE become **placeholders**, not values. On re-entry, `restoreSetsFromLog` rebuilds rows from `log.sets` sorted by `set_number`. The prescribed snapshot is captured at log time into `exercise_logs.prescribed_exercise_snapshot` JSONB.

Client set-logging UI lives in `components/client-portal/training/`: `set-tracker.tsx` (699) → `exercise-tracker-block.tsx` (464, per-exercise card + set field-array) → `set-row.tsx` (151, the weight/reps/RPE inputs). Notes today are per-exercise (`exercise_logs.notes`, client-authored) and per-session (`session_logs.notes`) — none per-set.

### 3.4 Cycle + surplus (do not conflate them)

`coach_saved_plans` holds `cycle_length INT`, `rest_pattern INT[]` (0-indexed rest positions), `program_duration_weeks`, `default_surplus_percentage`. Days are a **flat list ordered by `order_index`**; **no week grouping exists**. `generateCycleAwareEvents()` (`services/library-placement-service.ts`) walks the placement date range, rotates non-rest sessions by `order_index`, skips `rest_pattern` positions — a **repeating microcycle**. This cannot express distinct authored weeks (week 2 heavier than week 1), which multi-week progression needs.

`calorie_surplus_percentage` (session → event) is the **nutrition-cascade input**, NOT a training-load progression. Duplicate-week progression (Phase 4) is orthogonal to surplus and must not merge into it.

### 3.5 Placement (where the real work happens)

`create_training_plan_atomic` RPC (mig 114, 23-arg, additive) only does a window-bounded event DELETE + one `training_plans` INSERT. **All session/exercise cloning and event materialization happen in the service** `placePlaceablePlanOnCalendar` (`library-placement-service.ts:51`), which already accepts an in-memory `PlaceablePlan` and `savedPlanId: string | null`. `placePlanOnCalendar` (DB-fetch by id) is a thin wrapper on top. `calculatePlacementEndDate` + `getNextPlanStartCap` bound the window so coexisting placements never bleed. **Consequence: apply-from-edited-structure needs no migration and no RPC change.**

### 3.6 The client-builder flow + the overwrite bug (the thing being fixed)

Coach client page `app/clients/[id]/page.tsx` → Training tab → `TrainingPlanBuilder` (`components/clients/training/builder/training-plan-builder.tsx`) → the slide-out drawer `training-plan-builder-overlay.tsx` with three modes: **AI Generation** (`ai-prompt-panel.tsx`), **Manual Creation** (`manual-workout-builder.tsx`, builds flat day skeletons then hands to the editor), **Saved Plans** (`SavedPlansList`, the library). Clicking a saved plan opens `DraftEditor` (`draft-editor.tsx`, 732 lines).

**The bug:** for a `status='saved'` plan, `DraftEditor` seeds an in-memory working copy; edits stay local. The only commit path is **"Save and Update Plan"** → `POST /api/training/saved-plans/[id]/overwrite` → `overwriteSavedPlan()` (`services/coach-saved-plan-service.ts:461-574`), which deletes+reinserts the shared template's sessions **in place** for every future client. And **"Apply to Client" is disabled while `hasUnsavedEdits`** (`draft-editor.tsx:469-478`), funneling the coach into overwriting the template before they can apply their per-client edits. **Fix (Phase 1 D3a + Phase 5): apply materializes events from the edited working-copy structure, `training_plans.saved_plan_id = source template` for provenance, template untouched.**

### 3.7 Apply, heroes, saved workouts, AI (as-is)

- **Apply-to-calendar UI** `components/training-library/apply-to-client-dialog.tsx` → `POST /api/clients/[id]/training/place-from-library` (`type: "plan" | "session"`) → `placePlanOnCalendar` / `placeSessionOnCalendar` → nutrition cascade + audit.
- **Heroes:** Plans-tab hero (**inaccurate**) = `training-builder-right-panel.tsx` `summaryStats` ("This Week" = whole-plan session count; counts off `dayOfWeek`, which placement never sets). Data-tab hero (**accurate**) = `training-history-table.tsx` fed by `/api/clients/[id]/history/training/summary` (`completed/totalPlanned/plannedUpToToday/missed`).
- **Saved-workout entity already exists:** standalone `coach_saved_sessions` with `saved_plan_id IS NULL` (`services/coach-saved-session-service.ts`: `createStandaloneSession`/`getStandaloneSessions`; `/api/training/saved-sessions`; `hooks/use-standalone-sessions.ts`). Surfaced in the calendar library panel, **not** in the builder. There is **no** `saved_workouts`/`session_templates` table to create.
- **AI endpoint:** `services/training-ai-service.ts` → `generateTrainingPlanAI` (gpt-4o-mini, `response_format: json_object`, timeout 45s) returns **structured JSON** validated by `aiGeneratedPlanSchema` — including `sets/repsMin/repsMax/repsTarget/rpeTarget/percentage1rm/supersetGroup/isWarmup`. Exercises are by **name** → `resolveExercises()` (`exercise-catalog-service.ts`) which matches by name/alias/abbreviation and **creates a coach-specific row on no-match**. So the Phase-6 risk is silent junk-catalog creation, not free-text parsing.
- **Analytics/progression (must become set-type-aware):** `services/exercise-analytics-service.ts` `getExerciseProgressionSeries` (volume = `SUM(reps*weight)` over **all** sets; top set; best Epley e1RM from `utils/exercise-analytics-helpers.ts`); RPCs `get_exercise_progression_window` + `get_exercise_prs` (mig 094, `SECURITY INVOKER`); KPIs `components/training/exercise-data/exercise-insight.ts` (volume, compliance = `actualSets >= prescribedSets`). None are set-type-aware today.

### 3.8 Nav / surface (confirmed decisions)

Add **"Programs"** to `lib/navigation.ts` (flat top-level list; place after "Clients"). New route **`/dashboard/programs`** hosts the shared builder in `library` mode plus the browse/apply library, **absorbing** the existing (unlinked) `/dashboard/training-library` page; **redirect `/dashboard/training-library` → `/dashboard/programs`**. The shared builder lives in `components/clients/training/program-builder/` (both the Programs page and the client editor are coach-facing).

---

## 4. Key design decisions (locked)

- **D1 — Per-set storage = JSONB `set_specs`** on `coach_saved_exercises` + `training_exercises` (NOT child tables). Prescriptions are copied by column-splat in ~5 clone/write paths (`library-placement-service.ts` two clones, `coach-saved-plan-service.ts` overwrite, `coach-library-helpers.ts insertSavedExercises`, `coach-saved-session-service.ts addSavedExercise`); a JSONB column rides along free — a child table forces a second insert loop into each, and missing one **silently drops per-set data on apply** (the exact bug class we're removing). `set_logs` stays normalized (it's aggregated by the analytics RPCs). **Expand-on-read**: `set_specs` present → authoritative; else synthesize N `working` sets from the compact columns. **Compact columns become a maintained projection** — recompute `sets` (count of working sets) + `reps_min/reps_max` (range) on every `set_specs` write, or the ~6 legacy readers show stale prescriptions. **The prescribed snapshot must capture `set_specs`** (`training-log-service.ts` `ExerciseSnapshot`) or warm-up-aware compliance is wrong for history. Set shape: `{ set_number, set_type: 'warmup'|'working'|'amrap'|'drop'|'failure', reps_min?, reps_max?, reps_target?, load_type?: 'absolute'|'pct_1rm'|'pct_top', load_value?, rpe_target?, tempo?, rest_seconds?, drops?: [{ weight, reps }] }`. `set_logs.set_type` = **TEXT + CHECK** (not ENUM).
- **D2 — Explicit weeks (single model, no `week_mode`).** `week_index INTEGER NOT NULL DEFAULT 0` on `coach_saved_sessions` + `training_sessions`, plus `is_rest BOOLEAN NOT NULL DEFAULT false` on `training_sessions`; order by `(week_index, order_index)`. Each week is exactly **7 positional day-slots (Day 1–7, never Mon–Sun)**; the **whole authored program is the repeat unit** (repeat count chosen at assign time; empty = place once). There is **no `week_mode`** and no repeat-vs-sequential branch. `week_index` does **not** go on `training_events` (session FK resolves it). Rewrite `generateCycleAwareEvents`, `deriveCycleInfoFromSessions`/`recomputePlanCycleInfo` (`coach-library-helpers.ts`), and the `overwriteSavedPlan` cycle derivation to be week-scoped; legacy `week_index=0` single-week plans place identically.
- **D3a — Apply-without-overwrite (pulled into Phase 1, zero migration).** Export an inline-placement entry from `library-placement-service.ts` that builds a `PlaceablePlan` from the working copy and places it with `saved_plan_id = sourceTemplateId` (provenance = "descended from"); add an apply route; **un-gate** `draft-editor.tsx`'s Apply so it sends the working copy and no longer routes through `/overwrite`. Forward-compatible with D1/D2 (`PlaceablePlan` gains `set_specs`/`week_index` later and the inline path inherits them).
- **D4 — Shared builder = composed tree with a `target` abstraction from day one.** `WeekList → WeekBlock → DaySlot → ExerciseCard → SetRow`; props `{ mode: 'library' | 'client-draft', load, mutateWorking, onCommit, onApply }`. If Phase 2 hardcodes `SavedPlan` + library actions, Phase 5's remount is a rewrite.
- **Analytics set-type-awareness = DROP-then-CREATE** the mig-094 RPCs (return-shape change); re-apply `search_path` + `REVOKE`/`GRANT`; keep `SECURITY INVOKER`.
- **Migrations:** **119** (Phase 1: `set_specs` + `video_url` + `set_logs.set_type`), **120** (Phase 1 ckpt 1c: analytics RPCs), **121** (Phase 2: `week_index` + `is_rest`). Phase 2.5 and Phases 3–6: none.

---

## 5. The six phases

Each phase's **Prompt to paste** is the copy-into-a-fresh-session instruction. The Objective/Read/Implement/Do-NOT/Tests/Verify/Commit blocks below it are the detail the prompt refers to.

---

### Phase 1 — Prescription set model + set-type analytics + apply-without-overwrite ✅ COMPLETE

> **STATUS: SHIPPED 2026-07-01 (commit `28d9dbd`, migrations 119-120).** Gates green + security-reviewed clean + smoke-tested. Deviations from the original plan text below (these win):
> - **Set-model work landed backend-only.** `set_type` is coach-prescribed (via `set_specs`), not client-selected, so all client set-type/video UI + the `set_specs`/`video_url` **write-side splat** were deferred to Phase 2 (see Phase 2 §Implement item 5). Phase 1 shipped the columns, the snapshot capture, the read-side `countWorkingSets`, and the set-type-aware analytics (dormant in prod — proven by synthetic tests until authoring exists).
> - **D3a stamps `saved_plan_id = NULL` for edited copies** (not `= source template`): an edited copy isn't a copy of any single template (IDOR-safe + honest). Implemented as a `type:"inline"` variant on `place-from-library` (no new route). Known consequence: `getClientTrainingPlan` renders an edited-inline plan as a flat list (no rest rows) until Phase 2's cycle rewrite retires that last `saved_plan_id` reader.
> - **IDOR fixes shipped:** `assertPhaseBelongsToClient` on both the `plan` and `inline` branches; foreign `exercise_id` nulled in the inline path.

> **Prompt to paste:**
> "You are implementing **Phase 1** of `docs/TRAINING-BUILDER-EXECUTION-PLAN.md`. First read `docs/ARCHITECTURE.md`, `CONVENTIONS.md`, and this doc's §2 (Global standards), §3 (Shared context), and §4 (Key decisions). Then read the Phase 1 'Read first' files. Confirm the scope and out-of-scope back to me before writing any code. Implement **only** Phase 1: the additive per-set `set_specs` JSONB model + `video_url` + `set_logs.set_type`, the expand-on-read helper, threading set-type through the log write/read + client log UI, the set-type-aware analytics RPC change (checkpoint 1c), and the apply-without-overwrite inline placement path (D3a). This is backend-heavy — run the security-auditor over the migration + RPC + new route. Do not build the new Program builder UI, touch the week model, or backfill data. Run the §2 gates and commit with the Phase 1 commit message. Migrations start at 119; ask me to run `supabase db push`."

**Objective.** Make the prescription per-set-capable and the log/analytics set-type-aware, additively and non-destructively, and kill the template-overwrite footgun immediately via inline placement.

**Read first.** `services/library-placement-service.ts` (esp. `placePlaceablePlanOnCalendar`, `generateCycleAwareEvents`), `services/training-log-service.ts` (`writeSessionLog`, `SetLogInsert`, `ExerciseSnapshot`), `services/exercise-analytics-service.ts`, `utils/exercise-analytics-helpers.ts`, `supabase/migrations/090_normalize_set_logs.sql` + `094_exercise_analytics_perf.sql`, `lib/validations/training.ts` (`setPerformanceSchema` ~247), `types/training.ts` (`SetLog`, `TrainingExercise`, snapshot types), `components/client-portal/training/log-form-types.ts` + `set-row.tsx` + `exercise-tracker-block.tsx`, `components/clients/training/builder/draft-editor.tsx` (Apply gating + `handleOverwrite`).

**Implement.**
1. **Migration 119** — `ALTER TABLE coach_saved_exercises ADD COLUMN set_specs JSONB, ADD COLUMN video_url TEXT;` same on `training_exercises`; `ALTER TABLE set_logs ADD COLUMN set_type TEXT NOT NULL DEFAULT 'working' CHECK (set_type IN ('warmup','working','amrap','drop','failure'));`. All nullable/defaulted → additive. Gen types + commit together.
2. **Expand-on-read + projector** — `utils/exercise-set-specs.ts`: `expandSetSpecs(exercise)` (return `set_specs` if present, else synthesize `sets` × working sets from compact columns) and `compactFromSpecs(setSpecs)` (recompute `sets`/`reps_min`/`reps_max`). Keep ≤150 lines.
3. **Writers keep compact in sync** — anywhere `set_specs` is written on an exercise, also write the projected compact columns (state this invariant in a comment).
4. **Thread set-type through the log path** — `lib/validations/training.ts` (`setPerformanceSchema` gains `setType`), `services/training-log-service.ts` (`SetLogInsert` writes `set_type`; `ExerciseSnapshot` captures `set_specs`/working-set count), `types/training.ts` (`SetLog.setType`; snapshot shape), client `log-form-types.ts` (`buildLogPayload`/`restoreSetsFromLog` round-trip `setType`; `seedDefaultValues` reads the expanded set list so warm-up/AMRAP/drop/failure rows prefill), `set-row.tsx` (render/select set type; open reps for amrap/failure; drop sub-entries), `exercise-tracker-block.tsx` (render `video_url` safely + surface coach `notes`).
5. **Checkpoint 1c — Migration 120 (analytics)** — DROP old `get_exercise_progression_window` (and `get_exercise_prs` if PR-by-type wanted) by explicit signature, recreate returning `set_type`, re-apply `SET search_path=public` + `REVOKE`/`GRANT`, keep `SECURITY INVOKER`. Update `exercise-analytics-service.ts` (exclude `warmup` from volume; AMRAP/failure use logged reps; sum drop weights×reps) and `exercise-insight.ts` (volume KPI + `complianceKpis` count **working** sets only). Snapshot-fed compliance reads working-set count.
6. **D3a — apply-without-overwrite (no migration)** — export an inline-placement entry in `library-placement-service.ts` (build a `PlaceablePlan` from a passed structure; place with `saved_plan_id = sourceTemplateId`); add `POST /api/training/saved-plans/[savedPlanId]/apply-inline` (or extend the place-from-library route) using the standard auth chain; in `draft-editor.tsx` make "Apply to Client" send the working copy and **remove `disabled={hasUnsavedEdits}`**; stop routing client edits through `/overwrite`. Preserve the surplus cascade, window-bounding, and upsert idempotency in the inline path.

**Do NOT.** Build the Programs page/builder UI (Phase 2). Add `week_index`/`week_mode` (Phase 2). Backfill existing exercises into `set_specs` (expand-on-read handles legacy). Change `resolveExercises`' default (Phase 6). Merge progression logic (Phase 4).

**Tests to write.** `utils/exercise-set-specs.test.ts` (expand legacy → N working sets; projector round-trip). `services/training-log-service.test.ts` (set_type insert→read→restore; snapshot captures `set_specs`). `services/exercise-analytics-service.test.ts` (warm-up excluded from volume; AMRAP/failure use logged reps; drop summed; working-set compliance). `services/library-placement-service.test.ts` (inline path sets `saved_plan_id=source`, template `coach_saved_sessions` **never** deleted/mutated, events materialized, surplus preserved, window-bounded delete unchanged). Component: `set-row`/`exercise-tracker-block` render set-type control + `video_url`.

**Verify.** Gates green + security-auditor over mig 119/120 + the new route. Manual: log a session with a warm-up + a working set; confirm volume/compliance exclude the warm-up; open a saved library plan in the client drawer, edit it, hit Apply — confirm the client's calendar reflects the edit and the library template is unchanged.

**Commit message.** `feat(training): per-set prescription model + set-type analytics + apply-without-overwrite (builder S1, migs 119-120)`

---

### Phase 2 — Week model + placement foundation (backend only)

> **This is the data/placement layer only — no UI (the builder UI is Phase 2.5 below).** ONE model, no `week_mode`: a program is an ordered set of weeks; each week is exactly **7 positional day-slots (Day 1–7, never Mon–Sun)**. The **whole program is the repeat unit**; the coach picks a **repeat count** at assign time (empty = 1 = place once). Placement is offset-based — Day 1 lands on the assign date, everything consecutive; `day_of_week` stays null. Rest is self-describing via `is_rest` rows on `training_sessions`; the event generator emits an event for non-rest slots only. Empty and rest cells both produce no event (authoring-only distinction). `rest_pattern` is derived from `is_rest` positions, so legacy single-week plans place identically.

> **Prompt to paste:**
> "You are implementing **Phase 2 (backend/data foundation — NO UI)** of `docs/TRAINING-BUILDER-EXECUTION-PLAN.md`. Read `docs/ARCHITECTURE.md`, `CONVENTIONS.md`, and this doc's §2, §3, §4, then the Phase 2 'Read first' files. Confirm scope/out-of-scope before coding. Implement **only** Phase 2: migration 121 (`week_index` + `is_rest`), the week-aware placement + cycle-derivation rewrite, the self-describing `getClientTrainingPlan` + legacy fallback, the `is_rest` counter audit, and the `set_specs`/`video_url` write-side splat + client threading + survival test. Build **no UI** (that is Phase 2.5). Do not build progression, saved-workout insert (Phase 3), AI (Phase 6), or touch the client-attached drawer (Phase 5). Run the §2 gates; commit with the Phase 2 message. Ask me to run `supabase db push` for mig 121."

**Objective.** Make placement, the client read, and every clone/apply path fully week-and-set-aware — proven by tests — so the Phase 2.5 builder authors into a working foundation. The new capabilities stay dormant (like Phase 1's set model) until Phase 2.5 uses them.

**Read first.** `services/library-placement-service.ts` (`generateCycleAwareEvents`, `placePlaceablePlanOnCalendar`, `calculatePlacementEndDate`, `getNextPlanStartCap`), `services/coach-library-helpers.ts` (`deriveCycleInfoFromSessions`, `recomputePlanCycleInfo`), `services/coach-saved-plan-service.ts` (`overwriteSavedPlan` cycle derivation), `services/client-training-plan-service.ts` (`getClientTrainingPlan`), `services/training-service.ts` (`fetchSessionsWithExercises`), `utils/exercise-set-specs.ts` (from Phase 1), `lib/validations/training.ts`.

**Implement.**
1. **Migration 121** — `week_index INTEGER NOT NULL DEFAULT 0` on `coach_saved_sessions` + `training_sessions`; `is_rest BOOLEAN NOT NULL DEFAULT false` on `training_sessions`. Additive. Gen types + commit.
2. **Week-aware placement** — in `placePlaceablePlanOnCalendar` stop filtering rest sessions: `cycleSlots` = all sessions sorted by `(week_index, order_index)` = the whole program; clone **all** slots (rest rows get `is_rest=true`, name "Rest", no exercises, `calorie_surplus_percentage` null), clone exercises only for non-rest slots; `sessionsCreated = clonedSlots.filter(!isRest).length`. Rewrite `generateCycleAwareEvents` to take the ordered `cycleSlots`, walk dates with `cyclePosition mod cycleSlots.length`, and emit an event **only when `!isRest`**; preserve per-event `calorie_surplus_percentage` (`session.surplus ?? plan.default`), the window bounds, and the upsert idempotency. In `calculatePlacementEndDate`, `cycleLength = cycleSlots.length` (whole program) and the repeat count is the length knob (empty → 1); keep the phase-end cap. Rewrite `deriveCycleInfoFromSessions` / `recomputePlanCycleInfo` / `overwriteSavedPlan`'s cycle derivation to sort across all weeks (legacy `week_index=0` stays identical).
3. **Self-describing client read** — `getClientTrainingPlan`: widen the selects to include `week_index`, `is_rest`, `set_specs`, `video_url`; order by `(week_index, order_index)`. If any returned session has `is_rest` → return the sessions inline (rest rows → `isRest:true`), no template join; else if `saved_plan_id` is set and the template has `cycle_length`/`rest_pattern` → keep today's splice (legacy fallback); else the flat list. Thread `weekIndex` onto `ClientTrainingSessionEntry`.
4. **`is_rest` counter audit** — add `.eq("is_rest", false)` at `fetchSessionsWithExercises` (the applied-side workout-list reader) and carry `is_rest` through the clone/insert sites. Everything else is id-scoped or reads from `training_events` (rest emits none).
5. **`set_specs`/`video_url` write-side (deferred from Phase 1)** — add `expandSetSpecs` and a clamped `compactFromSpecs` (`sets = clamp(count(non-warmup specs), 1, 20)` to satisfy the `training_exercises.sets` CHECK) to `utils/exercise-set-specs.ts`; extend the input zod schemas (`savedExerciseInputSchema` etc. + the inline plan body) to accept `set_specs`/`video_url` and forbid all-warmup at authoring. Add `set_specs` + `video_url` to **every** exercise clone/insert site (enumerate every insert into `training_exercises` / `coach_saved_exercises` into a flat list) — splat verbatim on clone sites, project the compact columns on input sites. Thread the prescription's `set_specs`/`video_url` to the client via the events API + `normalizeExercise`/`PrescribedExerciseView`, seed the log form via `expandSetSpecs`, and write `set_logs.set_type` (`SetLog.setType`/`mapSetLogRow`/`setPerformanceSchema.setType`) seeded from the snapshot. **Write the survival test first**: author a `set_specs`-bearing exercise (`[warmup, working(pct_1rm), working, drop]`) and assert it survives every site — save-to-library, overwrite, pristine apply, inline apply, AI-gen, from-calendar, duplicate-week, place-session, add/update-exercise.

**Do NOT.** Build any UI (Phase 2.5). Add `week_mode` or a second migration. Build progression, saved-workout insertion (Phase 3), or AI (Phase 6). Touch the client-attached drawer/editor (Phase 5) beyond leaving it working. Put `week_index` on `training_events`.

**Tests to write.** `services/library-placement-service.test.ts` — single-week × repeat N, multi-week × repeat 1 and × repeat 2, per-slot rest, **rest slot never emits an event**, surplus propagation, idempotent re-place, legacy single-week places identically (explicit repeat count). `services/coach-library*.test.ts` — week-scoped cycle recompute. `services/client-training-plan-service.test.ts` — self-describing vs legacy fallback vs flat. `services/set-specs-survival.test.ts` — the site matrix (write first). Utils — `compactFromSpecs`/`expandSetSpecs` round-trip; all-warmup rejected.

**Verify.** Gates + survival/placement/read tests green. Apply an existing library plan through the current path and confirm placement is unchanged; multi-week + repeat behaviour is proven by the unit tests (no authoring UI exists yet).

**Commit message.** `feat(training): week-model placement + set_specs write-side + client threading (builder S2, mig 121)`

---

### Phase 2.5 — Full-page Program builder (UI)

> **Depends on Phase 2 (above).** A coach authors a reusable, client-agnostic, date-agnostic multi-week program on a full-page grid, and saves it to the library. **Assigning a program to a client happens separately, in the client's training planner — not here** (the coach sets that client's start date in that context). Built as the reusable component Phase 5 remounts as the client editor. No schema change.

> **Prompt to paste:**
> "You are implementing **Phase 2.5 (the Program builder UI)** of `docs/TRAINING-BUILDER-EXECUTION-PLAN.md`. Phase 2 (backend) is already in place. Read `docs/ARCHITECTURE.md`, `CONVENTIONS.md`, this doc's §2/§3/§4, `docs/newdesignsystem.md`, and the Phase 2 + 2.5 sections. Confirm scope before coding. Implement **only** the UI: the **Programs** nav + `/dashboard/programs` route + `[savedPlanId]` builder + redirect from `/dashboard/training-library`; the full-page **grid** builder (weeks = rows, Day 1–7 positional columns, sticky headers, collapse/expand, week cards with duplicate/delete/reorder, day cells with session/rest/empty states, drag move/swap); the **session-editor modal** with full per-set authoring (set types, loads, RPE, tempo, drops, warm-ups, video, superset) + a single-**exercise** catalog picker. The builder only **saves to the library** — there is NO assign-to-client here (assignment happens later in the client's training planner, Phase 5). Build as a tree of ≤250-line components with a `target: 'library'|'client-draft'` abstraction, read-only first. Do not build progression, saved-**session** insertion (Phase 3), AI (Phase 6), or touch the client drawer (Phase 5); one session per day-cell. Run the §2 gates; commit with the Phase 2.5 message."

**Objective.** A first-class full-page authoring surface for multi-week programs on the set model — the reusable builder Phase 5 remounts.

**Layout.** Full page (not a drawer). **Weeks = rows, days = columns**: the left column is the week card, then Day 1…Day 7 (positional headers, never weekdays). Sticky day headers on vertical scroll + sticky week-card column on horizontal scroll; weeks collapse/expand. **Week card:** week number + a summary line (sessions vs rest) + duplicate / delete (min 1). **Reordering is drag-and-drop only — no reorder buttons:** drag a week card to reorder weeks, drag a day cell to move/swap sessions. **Day cell — three states:** *session* (name + muscle summary + exercise count; click → editor; quick clear), *rest* (marker + clear), *empty* (Add session / Mark as rest). **Session editor (modal, one cell):** editable name + an ordered exercise list; each exercise has full per-set authoring — set type (warmup/working/amrap/drop/failure), reps, load (absolute / %1RM / %top), RPE, tempo, rest, drop sub-sets — plus exercise-level warm-up, superset, note, and video URL (compact ↔ expand-to-per-set; per-set edits re-project the compact columns via `compactFromSpecs`); plus a single-**exercise** catalog picker. Program actions: inline-editable name, auto-derived meta (weeks, sessions/week), Preview, and **Save program** (persists the whole tree to the library). **No assign-to-client on this surface** — a saved library program is assigned to a client later, from the client's training planner (Phase 5), where the coach picks that client's start date. New program opens with one empty week (7 empty slots); minimum one week; all-empty / all-rest weeks are valid. **Edit mode:** creating a program opens the builder in edit mode, and it stays in edit mode until the coach hits **Save program**, at which point it leaves edit mode.

**Read first.** `docs/newdesignsystem.md`, `lib/navigation.ts`, `components/sidebar-nav.tsx`, `app/dashboard/training-library/page.tsx`, `components/clients/training/builder/draft-editor.tsx` (dnd-kit + serialize patterns to reuse), `utils/exercise-set-specs.ts` (Phase 2), the Phase-2 client read + placement.

**Implement.**
1. **Nav + routes** — `{ name: "Programs", href: "/dashboard/programs", icon: <Dumbbell> }` in `lib/navigation.ts` after "Clients"; `app/dashboard/programs/page.tsx` (browse grid via `useSavedPlans`, folding in the old `PlanCard`; card click opens the builder — no apply-to-client on this page); `app/dashboard/programs/[savedPlanId]/page.tsx` (the builder); redirect `/dashboard/training-library` → `/dashboard/programs`.
2. **Grid builder tree** — `components/clients/training/program-builder/`: `program-builder-types.ts` (`ProgramDraft` / `WeekDraft { weekIndex, days: DaySlotDraft[7] }` / `DaySlotDraft { orderIndex, isRest, session }` (singular — comment the two-a-days seam) / `SessionDraft` / `ExerciseDraft` with `setSpecs`+`videoUrl` / `BuilderTarget`), `program-builder.tsx` (orchestrator + top bar), `use-program-builder-state.ts` (working tree + mutators, reindex `week_index`/`order_index` on every change), `use-set-spec-mutations.ts` (re-project compact via `compactFromSpecs`), `program-grid.tsx` (sticky headers + week column), `week-row.tsx`, `week-card.tsx`, `day-cell.tsx` (states + drag move/swap), `session-editor-modal.tsx`, `exercise-card.tsx` (compact ↔ per-set), `set-row-editor.tsx`, `program-builder-serialize.ts`. `target: 'library'|'client-draft'` from day one; reuse the dnd-kit grip-only + portaled-overlay pattern from `draft-editor.tsx`. **Read-only first:** assert `draftToOverwriteBody(savedPlanToDraft(plan))` matches today's serialization before enabling mutators.
3. **Save flow** — `Save program` (`onCommit`) persists the whole tree to the library (overwrite). No assign/apply in this phase — the `target`'s `onApply` seam stays unused until Phase 5.

**Do NOT.** Build progression / intensity-volume. Build saved-**session** library insertion (Phase 3 — the single-**exercise** picker is in scope). Build the AI multi-week grid (Phase 6). Touch the per-client drawer (Phase 5 — leave it working). Build any assign-to-client / apply-to-calendar flow — assignment stays in the client's training planner (Phase 5). Support two-a-days (one session per cell; comment the `DaySlotDraft.session → sessions[]` seam).

**Tests to write.** Component: `week-row` (add/duplicate/delete/reorder + min-1 + renumber), `day-cell` (session/rest/empty states + move/swap), `exercise-card` (compact↔expand + add warm-up + re-project). Serializer parity (read-only-first assertion). Save: `onCommit` writes the whole tree to the library.

**Verify.** Gates green. Manual: build a 3-week program in `/dashboard/programs` (7 positional days, a rest day, a warm-up, a superset, a video, per-set specs); **Save to library**; then from a test client's Training tab apply it via the existing apply flow with start = a Wednesday → 3 distinct weeks from Wednesday with correct rest days and surplus on every training day; the client program view + log form show per-set rows + video; a legacy 1-week plan still places identically; `/dashboard/training-library` redirects.

**Commit message.** `feat(training): full-page multi-week Program builder UI (builder S2.5)`

---

### Phase 3 — Saved workouts in the builder

> **Prompt to paste:**
> "You are implementing **Phase 3** of `docs/TRAINING-BUILDER-EXECUTION-PLAN.md`. Read `docs/ARCHITECTURE.md`, `CONVENTIONS.md`, this doc's §2/§3/§4, then the Phase 3 'Read first' files. Confirm scope before coding. Implement **only** Phase 3: surface the **existing** standalone `coach_saved_sessions` (saved_plan_id NULL) entity inside the Program builder — browse/search the saved-workout library, insert a saved workout into a day slot, and save a day slot as a reusable workout. No new table. Run the §2 gates; commit with the Phase 3 message."

**Objective.** Make reusable workouts insertable/creatable from inside the builder, consistent with the immutable/versioned template approach and the new set model.

**Read first.** `services/coach-saved-session-service.ts` (`createStandaloneSession`, `getStandaloneSessions`, `addSavedExercise`), `hooks/use-standalone-sessions.ts`, `app/api/training/saved-sessions/**`, `components/clients/training/calendar/library-panel.tsx` (existing "Sessions" tab), `services/coach-saved-plan-service.ts` (`promoteDraftToSaved` dedup pattern), the Phase-2 `program-builder/` tree.

**Implement.** A saved-workout picker/panel in the builder (reusing `use-standalone-sessions.ts`) with search; "insert into day" clones the standalone session's exercises (with `set_specs`) into the target `day-slot`; "save this day as a workout" creates a standalone `coach_saved_session` (+ its exercises/`set_specs`) with name-conflict dedup mirroring `promoteDraftToSaved`. Surface the Programs-page "Sessions" tab (currently a placeholder) as a real browse list.

**Do NOT.** Create any `saved_workouts`/`session_templates` table. Add progression. Touch the client editor.

**Tests to write.** `services/coach-saved-session-service.test.ts` — save-day-as-workout carries `set_specs` + dedup on name conflict; insert-into-day clones exercises + `set_specs`. Route test for the saved-sessions surface if a new endpoint is added.

**Verify.** Gates green. Manual: save a builder day as a workout, insert it into another day, confirm per-set specs survive the round-trip.

**Commit message.** `feat(training): saved-workout insert + save-day-as-workout in Program builder (builder S3)`

---

### Phase 4 — Progression (duplicate-week + rules)

> **Prompt to paste:**
> "You are implementing **Phase 4** of `docs/TRAINING-BUILDER-EXECUTION-PLAN.md`. Read `docs/ARCHITECTURE.md`, `CONVENTIONS.md`, this doc's §2/§3/§4, then the Phase 4 'Read first' files. Confirm scope before coding. Implement **only** Phase 4 (v1 progression): a pure rule engine that duplicates a week and applies a rule to the clone, operating on the Phase-1 `set_specs` set model, working-sets-only, with preview-before-commit and never mutating prior weeks. Keep it a pure util. Reconcile with — do not merge into — the surplus % concept. Run the §2 gates; commit with the Phase 4 message."

**Objective.** "Duplicate week + progression" that clones a week and applies a rule to the clone, on the set model.

**Read first.** `utils/exercise-set-specs.ts`, the Phase-2 `program-builder/` tree (duplicate-week hook), `services/exercise-analytics-service.ts` (for compound detection ideas), `docs/newdesignsystem.md`.

**Implement.** `utils/progression-rules.ts` (pure, ≤200 lines): rule types **linear load** (+X kg or +X%), **rep progression** (+N reps), **set progression** (+N sets); scope **all / compounds only / per-exercise**; applies to **working** sets only (warm-up untouched), may key off AMRAP results; returns a new week's `set_specs` without mutating the source week. Wire a **preview** step into the Phase-2 duplicate-week UI (show the resulting week before commit). Progression writes new prescriptions for the new week; never touches prior weeks or history.

**Do NOT.** Add auto-regulation/velocity/RPE-autoregulation (future phase). Mutate prior weeks or any logged history. Fold surplus % into the load rule.

**Tests to write.** `utils/progression-rules.test.ts` — each rule's math, scope filters, working-only (warm-up unchanged), and a **prior-weeks-byte-identical** assertion after applying to a duplicated week.

**Verify.** Gates green. Manual: duplicate a week with "+2.5 kg, compounds only," preview, commit; confirm only the new week's compound working sets changed and the source week is untouched.

**Commit message.** `feat(training): duplicate-week progression rules on the set model (builder S4)`

---

### Phase 5 — Repurpose the client builder

> **Prompt to paste:**
> "You are implementing **Phase 5** of `docs/TRAINING-BUILDER-EXECUTION-PLAN.md`. Read `docs/ARCHITECTURE.md`, `CONVENTIONS.md`, this doc's §2/§3/§4, then the Phase 5 'Read first' files. Confirm scope before coding. Implement **only** Phase 5: remove from-scratch AI/Manual authoring from the client-attached drawer, keep the template library + apply, **remount the Phase-2 shared builder in `client-draft` mode** as the client editor, derive a draft from a template, apply via the Phase-1 inline path (template untouched), and swap the inaccurate Plans-tab hero for the accurate Data-tab hero. Do NOT re-introduce `/overwrite` from the client editor. Run the §2 gates; commit with the Phase 5 message."

**Objective.** Turn the client drawer into: template library + client-draft editor (shared component) + apply — with the template immutable on apply, and an accurate Plans hero.

**Read first.** `components/clients/training/builder/training-plan-builder-overlay.tsx` (three-mode rail), `training-plan-builder.tsx`, `draft-editor.tsx` (to retire), `training-builder-right-panel.tsx` (Plans hero to replace), `training-history-table.tsx` (accurate Data hero + `/api/clients/[id]/history/training/summary`), the Phase-2 `program-builder/` tree + its `target` props, `library-placement-service.ts` inline path (Phase 1), `components/training-library/apply-to-client-dialog.tsx`.

**Implement.** Remove the **AI Generation** and **Manual Creation** modes from `training-plan-builder-overlay.tsx` (authoring now lives only in `/dashboard/programs`). Keep **Saved Plans** (library) + apply. Mount `<ProgramBuilder mode="client-draft" .../>` as the client editor: opening a template **derives a client draft** (in-memory working copy), edits stay on the draft, **apply** calls the Phase-1 inline placement (materializes the edited version onto the client's calendar; `saved_plan_id = source template`; template never mutated). Replace the Plans-tab hero component with the Data hero (reuse `training-history-table.tsx`'s summary source). Guard reapply-from-library so it can't silently overwrite an edited placement.

**Do NOT.** Call `/overwrite` from the client editor. Leave any from-scratch entry point in the drawer. Rebuild the multi-week UX (reuse Phase 2's component via `target`). Change the standalone `/dashboard/programs` authoring surface.

**Tests to write.** Component: client editor remounts the shared builder in `client-draft` mode; Apply is enabled with unsaved edits and materializes without mutating the template; Plans tab renders the accurate summary numbers. Reuse Phase-1 backend tests for inline placement.

**Verify.** Gates green. Manual: from a client's Training tab, open a library template, edit it, apply — confirm the client calendar reflects edits, the library template is unchanged, and the Plans-tab hero matches the Data-tab numbers. Confirm AI/Manual entry points are gone from the drawer.

**Commit message.** `feat(training): repurpose client builder to library+apply with shared editor; accurate Plans hero (builder S5)`

---

### Phase 6 — AI builder audit + catalog constraint

> **Prompt to paste:**
> "You are implementing **Phase 6** of `docs/TRAINING-BUILDER-EXECUTION-PLAN.md`. Read `docs/ARCHITECTURE.md`, `CONVENTIONS.md`, this doc's §2/§3/§4, then the Phase 6 'Read first' files. Confirm scope before coding. Implement **only** Phase 6: constrain AI generation so every generated exercise resolves to a real `exercises` catalog record (reject/repair unresolved names instead of silently creating coach-specific rows), and populate the Phase-1 `set_specs` set model with sensible default working sets. Do NOT change the shared `resolveExercises` default used by manual/overwrite/standalone paths. Run the §2 gates; commit with the Phase 6 message."

**Objective.** Every AI-generated exercise maps to a known DB record so client logging/tracking stay consistent; AI plans track on the new set model.

**Read first.** `services/training-ai-service.ts` (`generateTrainingPlanAI`, prompt), `lib/validations/training.ts` (`aiGeneratedPlanSchema`), `services/exercise-catalog-service.ts` (`resolveExercises`, ~124), `types/training.ts` (`AIGeneratedExercise`), the AI generate route + `services/training-plan-orchestrator.ts`, `utils/exercise-set-specs.ts`.

**Implement.** Add a **non-creating** resolver variant — e.g. `resolveExercises(names, coachId, { createMissing: false })` (do **not** change the default; it's used by manual/overwrite/standalone). Constrain generation to the catalog: pass the coach+global catalogue (names, optionally IDs) as context to the prompt (or add a tool the model selects from); after generation, resolve names with `createMissing:false` and **reject or repair** unresolved exercises (best-effort alias/abbreviation repair, else surface for coach correction — never silently create). Populate `set_specs` for each generated exercise with default `working` sets derived from the AI's `sets`/`reps`/`rpe`/`percentage1rm`.

**Do NOT.** Flip the shared resolver's default to non-creating. Persist a plan containing an unresolved exercise. Alter the JSON output contract beyond what validation needs.

**Tests to write.** `services/exercise-catalog-service.test.ts` — `createMissing:false` returns unresolved names and creates **no** `exercises` row. `services/training-ai-service.test.ts` (or orchestrator test) — persist path rejects/repairs unresolved names and fills default working `set_specs`.

**Verify.** Gates green. Manual (or mocked): generate a plan whose response includes a nonsense exercise name; confirm it is rejected/repaired rather than creating a junk catalog row, and that resolved exercises carry default `set_specs`.

**Commit message.** `feat(training): constrain AI generation to the exercise catalog + populate set model (builder S6)`

---

## Appendix — top landmines (repeated per phase where relevant)

1. **Analytics RPC is DROP-then-CREATE** (return-shape change forbids `CREATE OR REPLACE`) — re-apply `SET search_path=public` + `REVOKE FROM PUBLIC,anon,authenticated` + `GRANT TO service_role`, keep `SECURITY INVOKER`. Forget the drop → migration fails; forget the grants → PostgREST IDOR surface reopens.
2. **Compact columns must stay a maintained projection** of `set_specs` or ~6 legacy readers (both placement clones, overwrite insert, snapshot capture, the two client view-builders, the analytics snapshot) show stale prescriptions.
3. **The prescribed snapshot must capture `set_specs`** (`training-log-service.ts`) or warm-up-aware compliance is wrong for every historical log.
4. **`week_index` without `week_mode` + rewritten cycle helpers** collapses a 3-week program into a 21-day cycle. Rewrite `generateCycleAwareEvents` (shared by DB + inline placement) once, week-aware.
5. **Every training event-write keeps `calorie_surplus_percentage`** (`session.surplus ?? plan.default`) or nutrition silently falls to rest-day calories.
6. **The shared builder needs its `target` abstraction from day one** (Phase 2) or Phase 5 is a rewrite; and do not port `training-builder-right-panel.tsx`'s `dayOfWeek`-based counts (placement never sets `dayOfWeek`).
7. **Inline `saved_plan_id = source template`** gives provenance but means "reapply from library" re-fetches the template — don't let reapply silently overwrite an edited placement. Update the placement test's inline `saved_plan_id` expectation.
8. **`.next` zombie cache** after multi-file moves: `rm -rf .next` before debugging phantom 404s.
