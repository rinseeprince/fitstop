# Client Portal Redesign: Execution Plan

Companion to `CLIENT-PORTAL-REDESIGN.md`. This file breaks the redesign into session-sized prompts that a fresh Claude Code session can execute directly.

## How to use

1. Sessions are ordered. Do not start Session N+1 until Session N is merged.
2. Each prompt is self-contained: context, files to read, what to implement, what not to do, what to test, how to verify.
3. Each session ends with a commit message. Commit with that exact message when the session is complete.
4. Every code-producing session includes a "Tests to write" section. These are not optional; they are scope.

## Global testing standards

These apply to every code-producing session:

- `npx tsc --noEmit` must pass before committing.
- `npx eslint .` must pass before committing.
- `npx vitest run` must pass before committing.
- No `as any` in changed files.
- No TODO/FIXME/DEBUG markers left behind.
- **New service functions with meaningful logic** (branching, joins, derivations, transactions): unit tests for happy path plus error paths. Do NOT test pure pass-throughs or simple getters — they're verified by the routes/components that call them.
- **New API routes**: integration tests covering the status codes the route actually returns. Include 200/201 happy path plus any error paths the route defines (400/401/403/404 as applicable). Skip status codes the route doesn't produce.
- **New UI components with state or save flows**: component tests for critical paths (save submits correct payload, error state renders, locked state disables inputs). Micro-interactions rely on manual QA.
- **Read-only UI components**: basic render assertion only; no snapshot bloat.

The point of this bar is to catch real bugs, not to pad coverage. If a test asserts something that cannot meaningfully break, don't write it.

**Test layer boundaries** (keep each layer's tests testing its own responsibility):
- **Service tests**: mock Supabase clients. Assert write shapes, transaction boundaries, derivation logic. Do not hit real DB or real HTTP.
- **API route tests**: hit the route handler without mocking services; use a test Supabase instance or a per-test transaction. Assert status codes, response shape, IDOR rejection. Do not assert internal service behavior — that belongs to service tests.
- **UI component tests**: mock the network layer (`useSWR` / `fetch`). Assert render state transitions and payload shapes on save. Do not hit real endpoints.

## Session overview

| # | Title | Phase |
|---|-------|-------|
| 0.1 | Project reconnaissance and doc alignment | 0 Prep | COMPLETE
| 0.2 | getDateString sweep + HabitLogWithDetails dedupe | 0 | COMPLETE
| 0.3 | Verify existing weight_unit wiring | 0 | COMPLETE
| 1.1 | Design training-log contracts | 1 Training | COMPLETE
| 1.2 | Training log service layer + unit tests | 1 | COMPLETE
| 1.3 | Training log API endpoints | 1 | COMPLETE
| 1.4 | Set tracker UI, read-only skeleton | 1 | COMPLETE
| 1.5 | Set tracker UI, inputs + save flow | 1 | COMPLETE
| 1.6 | Coach drill-down dialog | 1 | COMPLETE
| 1.7 | Attention feed rewire | 1 | COMPLETE
| 1.8 | Exercise history data layer + API (coach-side) | 1 |
| 1.9 | Exercise Data tab UI + PR view (coach-side) | 1 |
| 2.1 | Day summary + program endpoints | 2 Home + nav |
| 2.2 | Bottom tab bar + client layout restructure | 2 |
| 2.3 | Home page shell + swipe navigation | 2 |
| 2.4 | Summary cards + phase banner | 2 |
| 2.5 | Program page + phase completion card relocation | 2 |
| 2.6 | Settings page + settings endpoint | 2 |
| 2.7 | Client check-in hub (submission + history) | 2 |
| 3.1 | Nutrition + wellness endpoints | 3 Detail pages |
| 3.2 | Nutrition detail page | 3 |
| 3.3 | Wellness detail page + past-day lock enforcement | 3 |
| 3.4 | Client exercise history page | 3 |
| 4.1 | Habits detail page | 4 Habits |
| 5.1 | Remove old Daily Pulse + deprecated routes + docs sweep | 5 Cleanup |
| 6.1 | Walkthrough copy/step update | 6 Check-in + onboarding |
| 6.2 | Check-in context: session-keyed to event-keyed | 6 |
| 6.3 | Check-in AI summary enrichment (optional) | 6 |
| 6.4 | Daily logs as SOT for check-in + drop check_in_session_completions | 6 |
| 7.1 | Coach roadmap end-and-replace UI | 7 Coach-side fixes |
| 7.2 | Coach phase edit unlock for active phases | 7 |
| 7.3 | Coach archived-roadmap browsing | 7 |
| 7.4 | Coach per-client Check-ins tab | 7 |
| 7.5 | Coach metrics page phase filter | 7 |
| 7.6 | Coach client overview tab as pre-session brief | 7 |
| 7.7 | Coach exercise progression charts on Metrics tab | 7 |
| 8.1 | Coach unit preference column + viewer-resolver foundation | 8 Viewer-relative units |
| 8.2 | Render-path sweep for viewer-relative weight display | 8 |
| 8.3 | Coach + client unit preference settings + form write paths | 8 |
| 9.1 | Document required environment variables in .env.example | 9 Pre-launch hardening |
| 9.2 | Auth callback rate limit + magic-link onboarding fix | 9 |
| 9.3 | Sentry capture on fire-and-forget background tasks | 9 |
| 9.4 | Resolve real ESLint bugs (await-thenable, misused-promise) | 9 |
| 9.5 | Coach API response shape consistency sweep | 9 Mobile prep |
| 9.6 | Cache-Control: no-store sweep on coach GET routes | 9 |
| 9.7 | Bearer token auth path for native clients | 9 |
| 9.8 | API versioning policy + Client-Version header gate | 9 |
| 9.9 | TECHNICAL-DEBT.md sweep (mark resolved items) | 9 |
| 9.10 | Root-level doc rewrite (README) + CLIENT-APP-REFERENCE.md audit | 9 |

---

## Session 0.1: Project reconnaissance and doc alignment

**Status**: COMPLETE

**Commit message**: `docs: align check-in AI provider reference and record timezone approach`

**Objective**: Read the mandatory project docs, resolve the GPT-4o vs Claude check-in AI provider discrepancy, and document how client timezone is handled.

**Read first (in order)**:
- `CONVENTIONS.md` (entire file, mandatory).
- `docs/ARCHITECTURE.md` (entire file).
- `docs/CLIENT-PORTAL-REDESIGN.md` (the reference doc).
- `TECHNICAL-DEBT.md`.
- `CLIENT-ONBOARDING-README.md`.
- `services/ai-service.ts` (confirm actual check-in AI provider).
- `services/client-check-in-service.ts` (how AI is invoked).
- `lib/date-helpers.ts` (existing timezone utilities).
- Grep for `timezone`, `expected_check_in_day` in `services/` and `lib/`.

**Implement**:
1. Determine the actual AI provider used for check-in summaries. Update whichever of `CONVENTIONS.md` or `docs/ARCHITECTURE.md` is wrong (single-line edit).
2. Determine how "today" is computed for a client today. Update the "Timezone handling" section at the bottom of `docs/CLIENT-PORTAL-REDESIGN.md` with findings. If a `timezone` column on `clients` is needed, record the decision; the migration itself is added in Session 0.3 if required.
3. Report a list of any unexpected findings from the doc reads that affect the execution plan.

**Do NOT**: Write any code outside of doc edits. Do not modify services or API routes.

**Tests to write**: None (doc-only session).

**Verify**: `npx tsc --noEmit` clean. Commit.

---

## Session 0.2: Standardize on getDateString + consolidate the one cross-5.1 type duplicate

**Status**: COMPLETE (commit `49fda7d`)

**Commit message**: `refactor: standardize on getDateString and dedupe HabitLogWithDetails`

**Objective**: Replace every `.split('T')[0]` in non-test, non-Daily-Pulse code with `getDateString()`, and consolidate `HabitLogWithDetails` (defined in both `types/daily-habit.ts` and `services/daily-habits-mappers.ts` — both survive the Daily Pulse deletion in Session 5.1).

**Scope narrowed from the original TECHNICAL-DEBT entry**. The original entry flagged `TodaysActivity`, `UnplannedActivity`, and `HabitLogWithDetails` as duplicated across 4-5 files each, plus a `saveUnplannedActivities` date bug. Verification (2026-04-23) shows:
- `TodaysActivity` / `UnplannedActivity` already have canonical definitions in `types/daily-pulse.ts`; every non-canonical reference lives inside `components/daily-pulse/` or `hooks/use-daily-pulse*.ts`, all of which are deleted in Session 5.1. Consolidation would be thrown away with the files.
- `HabitLogWithDetails` has canonical form in `types/daily-habit.ts:53` **and** a redefined copy in `services/daily-habits-mappers.ts:11`. Both outlive 5.1. This is the only duplicate worth fixing.
- The `saveUnplannedActivities` date bug lives in `components/daily-pulse/utils/daily-pulse-handlers.ts`, which is deleted in 5.1. Pre-launch with no users, the bug can't hurt anyone; skipping the fix.

**Read first**:
- `TECHNICAL-DEBT.md` (Daily Pulse section — now partly stale; this session's scope is the authoritative narrowing).
- `types/daily-habit.ts`, `services/daily-habits-mappers.ts`, `services/daily-habits-service.ts` (the re-export chain).
- `lib/date-helpers.ts` (confirm `getDateString` and `getTodayDateString` signatures).
- Grep `\.split\('T'\)\[0\]` and `\.split\("T"\)\[0\]` across the whole repo (expect ~40 hits; confirm scope).

**Plan (report before implementing)**:
- Which `.split('T')[0]` hits live in files slated for deletion in Session 5.1 (skip those — they die with Daily Pulse). The rest fall into two shapes: `new Date().toISOString().split("T")[0]` (today) and `someDate.toISOString().split("T")[0]` (specific date). Replace with `getTodayDateString()` and `getDateString(someDate)` respectively.
- For `HabitLogWithDetails`: pick `types/daily-habit.ts` as canonical. Have `services/daily-habits-mappers.ts` import from there and remove its local definition. `services/daily-habits-service.ts` continues to re-export — repoint its re-export source.

**Implement**:
- Replace every non-DP `.split('T')[0]` with `getDateString(date)` (or `getTodayDateString()` for the `new Date()` case). Skip hits in files listed in REDESIGN's "Retired" list.
- Delete the `HabitLogWithDetails` definition in `services/daily-habits-mappers.ts` and import from `types/daily-habit.ts` instead. Update the re-export in `daily-habits-service.ts` so the canonical source is the types file, not the mapper.

**Do NOT**:
- Consolidate `TodaysActivity` / `UnplannedActivity` — their only non-canonical definitions are in files deleted in 5.1.
- Fix `saveUnplannedActivities` — file dies in 5.1, pre-launch, no user impact.
- Touch `.split('T')[0]` inside `components/daily-pulse/**` or `hooks/use-daily-pulse*.ts` — deleted in 5.1.
- Change type shapes or rename fields.

**Tests to write**: None new. Existing tests must still pass; update imports in any test that referenced the deleted mapper-local type.

**Verify**: `npx tsc --noEmit`, `npx eslint .`, `npx vitest run` all pass. Commit.

---

## Session 0.3: Verify existing weight_unit wiring + add client timezone migration

**Status**: COMPLETE (commit `5f3443a`)

**Commit message**: `chore(clients): wire weight_unit preference and add client timezone column`

**Objective**: The `clients.weight_unit` column already exists (migration 009, `'lbs' | 'kg'`, default `'lbs'`). Verify types plus services expose it correctly and surface it wherever weight inputs need a default. Add the client timezone column that Session 0.1 confirmed is missing.

Session 0.1 confirmed no `timezone` column exists on `clients` and all date helpers run in server-local time. The REDESIGN's past-day lock requires client-local "today." This session lands the column.

**Migration numbering**: `089_add_client_timezone.sql` (current tip is 088 per `supabase/migrations/` — `088_remove_external_activities.sql` was added in the external-activities removal sprint). Session 7.6's `coach_client_views` migration will be 090. If any other schema work lands between, bump accordingly.

**Read first**:
- `supabase/migrations/009_add_client_goal_fields.sql` (weight_unit definition).
- `supabase/migrations/011_add_nutrition_fields.sql` (unit_preference definition).
- `types/database.ts` (confirm `Client` row type exposes `weight_unit` + `unit_preference`).
- `types/check-in.ts` or wherever the `Client` TS type lives (confirm camelCase mapping).
- Grep `weight_unit|weightUnit` in `services/` and `components/` for places where weight is rendered or defaulted.
- `docs/CLIENT-PORTAL-REDESIGN.md` "Timezone handling" section (the authoritative spec for the column shape, written by Session 0.1).

**Plan (report before implementing)**:
- Any missing type exports or service accessors for `weight_unit`.
- Any component that hardcodes `'lbs'` or `'kg'` instead of reading the client's preference.
- **Resolve the `unit_preference` vs `weight_unit` overlap**: `clients.unit_preference` (`'metric' | 'imperial'`) and `clients.weight_unit` (`'lbs' | 'kg'`) cover adjacent concerns and can contradict each other. Decide whether `unit_preference` is the source of truth and `weight_unit` derives from it (imperial → lbs, metric → kg), OR they're genuinely independent fields. Document the decision in the REDESIGN doc. Session 2.6 implements the settings UI based on this decision.

**Implement**:
- Add accessors or type extensions if missing.
- Replace any hardcoded weight-unit fallbacks with reads of `client.weightUnit` (or `unit_preference` per the decision above).
- Create `supabase/migrations/089_add_client_timezone.sql`:
  - `ALTER TABLE clients ADD COLUMN timezone TEXT NOT NULL DEFAULT 'UTC' CHECK (timezone ~ '^[A-Za-z_+\-/]+$');`
  - `COMMENT ON COLUMN clients.timezone IS 'IANA time zone (e.g. America/Los_Angeles). Default UTC for pre-backfill rows; Settings UI in Session 2.6 lets clients pick theirs.';`
  - Column shape matches the REDESIGN spec (NOT NULL, default 'UTC', IANA format). The pre-launch state has no existing rows to backfill; the default covers the no-data case.
- Regenerate `types/database.ts` so `Client.timezone` is typed.
- Update the camelCase `Client` TS type (in `types/check-in.ts` or wherever it lives) to include `timezone: string`.
- Update `lib/mappers.ts` if it maps `clients` rows to add the `timezone` field.

**Do NOT**: Build settings UI (Session 2.6). Do not change the tracker yet (Session 1.5). Do not touch `lib/date-helpers.ts` yet; Session 3.1 is where the permission helpers introduce `Intl.DateTimeFormat(timezone, ...)` usage.

**Tests to write**: None for this session unless adding a timezone migration; in that case, a simple type-level check is enough.

**Verify**: `npx tsc --noEmit` clean. If migration added, runs cleanly in local dev. Commit.

---

## Session 1.1: Design training-log contracts

**Status**: COMPLETE (commit `59e2f31`)

**Commit message**: `feat(training): add zod schemas and service signatures for event-keyed log writes`

**Objective**: Design contracts for event-keyed training log writes without implementing business logic. Introduce zod schemas and service function signatures so subsequent sessions have a stable target.

**Read first**:
- `docs/CLIENT-PORTAL-REDESIGN.md` (API surface section).
- `services/training-session-service.ts` (`cloneSessionForEvent`, `bulkReplaceExercises`).
- `services/training-event-service.ts` (`linkSessionLogToEvent`, `mapCompletionQualityToEventStatus`).
- `lib/validations/training.ts`.
- `types/training.ts`.
- `supabase/migrations/027_add_session_completion_tracking.sql` (exercise_logs schema).

**Plan (report before implementing)**:
- Exact shape of the log request body. Key requirement: **detailed per-set logging is opt-in**. The schema must accept:
  - Quick log: `{ completionQuality, notes? }` with no `exercises` array.
  - Detailed log: `{ completionQuality, notes?, exercises: ExercisePerformance[] }`.
  - Both shapes produce a valid log.
- Response shape.
- Service function signatures: `logTrainingEvent(params)` returning new session_log id; `getTrainingEventDetail(eventId, clientId)` returning event plus session plus exercises plus existing logs.

**Implement**:
- New zod schema in `lib/validations/training.ts`: `logTrainingEventSchema`. `exercises` field is `.optional()` with `.default(undefined)`. When present, each exercise has the per-set actuals.
- Stub function signatures (throw "not implemented") in new `services/training-log-service.ts`.
- TS types for request and response in `types/training.ts`. Type the response to reflect that `exerciseLogs` may be empty.

**Do NOT**: Implement DB writes or reads. No API routes yet.

**Tests to write**:
- `lib/validations/training.test.ts`: extend (or create) tests for `logTrainingEventSchema`:
  - Quick log (no exercises array) passes validation.
  - Detailed log (with exercises) passes validation.
  - Missing `completionQuality` fails.
  - Invalid `completionQuality` enum fails.
  - Malformed exercise entry (missing required sub-fields) fails when exercises array is present.

**Verify**: `npx tsc --noEmit`, `npx vitest run`. Commit.

---

## Session 1.2: Training log service layer + unit tests

**Status**: COMPLETE (commit `a7e1ea1`)

**Commit message**: `feat(training): implement event-keyed log write with prescription snapshots`

**Note**: Final commit title diverges from the originally-planned `feat(training): implement event-keyed log write with snapshots and cascade`. The cascade was deliberately deferred (see commit body and TECHNICAL-DEBT.md context) because `cascadeNutritionAfterTrainingChange` is a no-op on log writes per `docs/ARCHITECTURE.md:250` — it ties to event changes, not log writes. Future actual-burn → nutrition adjustment session will wire it in with the right `fromDate` semantics.

**Post-Session 1.5 follow-up (commits `2614085` and `c66b18a`)**: Two contract changes from this session's original spec landed during the Session 1.5 work:
- **`completionQuality` is now payload-authoritative in BOTH modes.** The original spec described detailed-mode status as derived from per-exercise completeness; that derivation (`deriveDetailedQuality`) was removed because clients have legitimate reasons to mark "complete" with partial set data.
- **Per-set actuals moved to a normalized `set_logs` child table** (migration 090). The scalar columns `actual_sets`, `actual_reps`, `actual_weight` were dropped from `exercise_logs`. The writer now does an `exercise_logs` insert returning ids, then batch-inserts `set_logs` keyed on `(exercise_log_id, set_number)`. The reader's new `attachSetLogs` helper joins them back. New columns on `exercise_logs`: `exercise_id` (global catalog FK, populated when the client used the typeahead picker) and `performed_name` (the canonical display name; differs from `prescribed_exercise_snapshot.name` when the exercise was swapped or freehand).

**Objective**: Implement `logTrainingEvent()` and `getTrainingEventDetail()` from Session 1.1. Writes must be transactional, include prescribed snapshots, and trigger the nutrition cascade.

**Read first**:
- `services/training-log-service.ts` (the stubs).
- `services/nutrition-event-service.ts` (`cascadeNutritionAfterTrainingChange`).
- `services/training-session-service.ts:cloneSessionForEvent` (snapshot writes reference).
- `supabase/migrations/027_add_session_completion_tracking.sql`.
- `docs/ARCHITECTURE.md` "Training Completion Hierarchy".
- `CONVENTIONS.md` database access section.
- **Grep for existing `training_events.status` writers** across `services/` and `app/api/`. The derivation logic defined in this session (status from completion quality OR exercise completeness) must be the single source of truth. If any other writer derives status differently, either refactor it to call this one, or document why the contexts are genuinely different.

**Plan (report before implementing)**:
- Transaction strategy (single RPC vs chained writes).
- How `training_events.status` is derived. **(Updated post-1.5: payload `completionQuality` is authoritative in both modes — the original derivation rule was removed in commit `2614085`.)** Status maps directly from `payload.completionQuality` via `mapCompletionQualityToEventStatus`.
- How snapshots are composed at log time.
- How the service handles the "no exercises array" case: skip the `exercise_logs` bulk-replace entirely.

**Implement**:
- Full `logTrainingEvent()`:
  - Upsert `session_logs` keyed on `(client_id, training_session_id, week_start_date)`, writing `prescribed_session_snapshot`. Always happens (both modes).
  - If `exercises` array provided: bulk-replace `exercise_logs` with `prescribed_exercise_snapshot` per row (`completed`, `weight_unit`, `notes`, plus `exercise_id` and `performed_name` from migration 090). **Then batch-insert `set_logs` children for non-skipped exercises** (`set_number`, `reps`, `weight`, `rpe`). If `exercises` not provided: skip both inserts entirely.
  - Update `training_events.status` + `session_log_id` per the derivation rule above.
  - Trigger `cascadeNutritionAfterTrainingChange` in both modes.
- Full `getTrainingEventDetail()`: event + resolved session + exercises + existing session_log + exercise_logs, with snapshot fallback when live rows are null. Returns empty `exerciseLogs` array when the client used quick log only.

**Do NOT**: Build API routes yet. Do not touch UI or `training-session-service.ts`.

**Tests to write**:
- `services/training-log-service.test.ts`:
  - **Quick log (no exercises)**: writes session_log + snapshot, skips exercise_logs and set_logs, sets event status from `completionQuality`, fires cascade.
  - **Detailed log (with exercises)**: writes session_log + snapshot + exercise_logs with snapshots + set_logs children, status maps from payload `completionQuality` (post-1.5: payload is authoritative — see commit `2614085`), fires cascade.
  - **Detailed payload-authoritative**: payload `completionQuality='full'` with mixed/skipped exercises still produces status `completed` (no override from data).
  - **Transaction integrity**: exercise_logs insert failure rolls back session_log (or documented behavior).
  - `getTrainingEventDetail()` live path returns live rows.
  - `getTrainingEventDetail()` returns empty `exerciseLogs` for quick-logged sessions.
  - Snapshot fallback returns snapshot data when live rows null.
  - Not found returns null or throws as designed.

**Verify**: `npx tsc --noEmit`, `npx vitest run`. Commit.

---

## Session 1.3: Training log API endpoints (client POST/GET, coach GET)

**Status**: COMPLETE (commit `f882783`)

**Commit message**: `feat(api): add event-keyed training log endpoints with CSRF and rate limit`

**Objective**: Wire the service layer from Session 1.2 to three API routes.

**Read first**:
- `CONVENTIONS.md` API design section (middleware ordering).
- `app/api/clients/[id]/training/[planId]/sessions/[sessionId]/clone/route.ts` (coach reference).
- `app/api/client/training/completions/route.ts` (client reference).
- `lib/rate-limit.ts`, `lib/csrf-protection.ts`, `lib/auth-helpers.ts`.

**Implement**:
- `app/api/client/training/events/[eventId]/log/route.ts` (POST): `clientApiRateLimit` + CSRF + `getAuthenticatedClientId` + event-ownership check + schema validation + `logTrainingEvent()`.
- `app/api/client/training/events/[eventId]/route.ts` (GET): same middleware; calls `getTrainingEventDetail()`.
- `app/api/clients/[id]/training/session-logs/[sessionLogId]/route.ts` (GET, coach): `coachApiRateLimit` + full IDOR chain.
- All return `{ success, data }`; client GETs set `Cache-Control: no-store`.

**Do NOT**: Touch UI. Do not modify existing completion endpoints yet.

**Tests to write**:
- Log POST route: 201 valid; 400 malformed; 401 unauthenticated; 404 event belongs to another client (collapsed with "missing" for security; see ARCHITECTURE.md §IDOR); CSRF rejection.
- Event GET: 200 happy; 401; 404 when event missing.
- Coach drill-down GET: 200; 403 when coach does not own client; 404 when session_log missing.

**Verify**: `npx tsc --noEmit`, `npx vitest run`. Manual curl smoke test. Commit.

---

## Session 1.4: Set tracker UI, read-only skeleton

**Status**: COMPLETE (commit `dcea553`)

**Commit message**: `feat(client-portal): add training detail page with read-only set tracker`

**Objective**: Build training detail page at `/client/training` with static, read-only rendering of prescribed exercises plus placeholder set rows. No interactivity.

**Read first**:
- `docs/CLIENT-PORTAL-REDESIGN.md` (Detail pages + Tracker UI).
- `CONVENTIONS.md` component size limits.
- `docs/newdesignsystem.md`.
- `components/clients/training/sessions/training-exercise-row.tsx`.
- `lib/swr-fetcher.ts`.
- Existing `app/client/training/page.tsx` (replaced entirely).

**Plan (report before implementing)**:
- Component breakdown respecting 250-line limit.
- SWR config.

**Implement**:
- Replace `app/client/training/page.tsx`:
  - Reads `date` + `eventId` query params.
  - Fetches `GET /api/client/training/events/[eventId]` via SWR.
  - Loading / error / empty states.
  - Renders each prescribed exercise with N empty set rows.
- New components under `components/client-portal/training/`:
  - `set-tracker.tsx`, `exercise-tracker-block.tsx`, `set-row.tsx`.

**Do NOT**: Wire inputs. No save button. No unplanned add. No copy-previous-set.

**Tests to write**:
- `set-tracker.test.tsx`: loading, error, happy-path render.
- `exercise-tracker-block.test.tsx`: renders N set rows.

**Verify**: `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`. Manual navigate. Commit.

---

## Session 1.5: Tracker UI, quick log + expandable detailed log

**Status**: COMPLETE (initial commit `2614085`; UX/UI follow-up in `c66b18a`)

**Post-merge follow-up (commit `c66b18a`)**: Beyond the original 1.5 spec below, the follow-up commit landed: (1) typeahead exercise picker on "Add unplanned" wired to `GET /api/training/exercises` with min-2-char debounced search; (2) **Swap action** on prescribed exercise blocks reusing the same picker — preserves `training_exercise_id` while writing the new `performed_name` + `exercise_id`; (3) Save button renamed **"Log workout"** and lifted out of the quick-log card to sit compact + right-aligned above it; (4) per-set fidelity via the new `set_logs` table (migration 090) — replaces the lossy `actual_sets/reps/weight` scalars and now also persists RPE per set. The original spec line "completionQuality derives from the detailed state if the client set status there" did NOT ship — buttons are always required and the payload is authoritative.

**Commit message**: `feat(client-portal): enable quick and detailed workout logging with bulk save`

**Objective**: Make the tracker interactive in two modes via progressive disclosure. Quick log is the default and prominent: three status buttons (Mark complete / Mark partial / Mark skipped) + optional notes + save. Detailed log is opt-in behind an expansion toggle: per-set inputs, copy-previous-set, add unplanned exercise, skip-per-exercise. Both modes use the same save button and the same API endpoint.

**Read first**:
- Output of Session 1.4.
- `lib/validations/training.ts:logTrainingEventSchema`.
- `CONVENTIONS.md` form-state guidance.
- `docs/CLIENT-PORTAL-REDESIGN.md` "Workout logging" section.

**Plan (report before implementing)**:
- State strategy (React Hook Form vs `useState`). Must handle both modes in one form state.
- How the detailed disclosure expand/collapse interacts with dirty state (collapsing does not clear detailed data; save still includes it).
- Save payload construction:
  - Quick only: `{ completionQuality, notes? }`.
  - Detailed used: `{ completionQuality, notes?, exercises: [...] }` where `completionQuality` derives from the detailed state if the client set status there.

**Implement**:
- **Quick log controls (top, always visible)**:
  - Three buttons: Mark complete / Mark partial / Mark skipped. Mutually exclusive selection.
  - Optional notes textarea.
  - Save button.
- **"Log detailed performance" disclosure**:
  - Collapsed by default.
  - When expanded, reveals the exercise blocks built in Session 1.4 as editable rows: reps, weight (unit label from `client.weightUnit`), optional RPE. Per-exercise notes.
  - "Copy previous set" button.
  - "Add exercise" (unplanned).
  - "Skip exercise" toggle per prescribed exercise.
- Save to `POST /api/client/training/events/[eventId]/log` with the appropriate payload shape per mode.
- Toast on success and error. Disable button + show `Loader2` during flight.

**Do NOT**: Offline support. Optimistic UI. Per-set auto-save. Force clients into detailed mode.

**Tests to write**:
- `set-tracker.test.tsx` (extend):
  - **Quick log path**: tapping "Mark complete" + save submits `{ completionQuality: 'full' }` with no `exercises` field. Same for partial and skipped.
  - **Detailed path**: expanding and filling set inputs + save submits `{ completionQuality, exercises: [...] }` matching `logTrainingEventSchema`.
  - Error toast on save rejection.
  - Save button disabled during flight.
  - "Skip exercise" included correctly in detailed payload.
  - "Copy previous set" populates from last filled row (detailed mode).
  - Weight input unit label reflects client preference.
  - Collapsing the detailed disclosure after entering data does NOT clear the data (state persists for save).
  - Notes field content included in both quick and detailed payloads.

**Verify**: End-to-end manual in both modes (confirm DB rows: quick mode writes only session_log + snapshot; detailed mode writes session_log + exercise_logs + snapshots). Cascade fires in both modes. `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`. Commit.

---

## Session 1.6: Coach drill-down dialog + history-table wiring

**Status**: COMPLETE (commit `0805f83`)

**Commit message**: `feat(coach): add session log detail dialog with prescribed-vs-actual view`

**Objective**: Replace chart-only `HistoryChartDialog` with detail dialog showing prescribed vs actual per exercise plus client notes plus status. Snapshot fallback for orphaned rows. Surface swapped exercises ("Prescribed X · Performed Y") and per-set RPE — both newly available after migration 090.

**Read first**:
- `components/clients/training/training-history-table.tsx`.
- `components/clients/training/history-chart-dialog.tsx`.
- `supabase/migrations/090_normalize_set_logs.sql` (per-set actuals + `exercise_id` + `performed_name` schema).
- `services/training-log-service.ts` (`attachSetLogs` populates `ExerciseLog.sets[]`; reader path).
- `CONVENTIONS.md` dialog structure.

**Plan (report before implementing)**:
- Dialog layout with three render states: quick-logged only (no exercise_logs), detailed (exercise_logs present), orphaned (snapshot fallback).
- Per-set rendering reads from `ExerciseLog.sets[]` directly (sorted by `setNumber`) — reps, weight, optional RPE. No csv parsing; no broadcasting a single weight to every row.
- Display-name resolution rule: `performed_name ?? prescribed_exercise_snapshot?.name ?? "Unknown exercise"`. When `performed_name` differs from the snapshot name, surface BOTH ("Prescribed Bench Press · Performed Dumbbell Bench") so the coach sees the swap.
- Snapshot-fallback rendering for orphaned rows.

**Implement**:
- `components/clients/training/session-log-detail-dialog.tsx` (follows CONVENTIONS dialog pattern).
- Fetches `GET /api/clients/[id]/training/session-logs/[sessionLogId]` via SWR.
- Three display states:
  - **Quick-logged only** (`exercise_logs` empty): show session name, completion quality, notes. Display a clear label like "Client logged this session as complete without per-set detail." Show the prescribed exercises as reference only (from snapshot), no actuals column.
  - **Detailed**: per exercise, render the prescribed prescription alongside the per-set actuals from `ExerciseLog.sets[]` (reps × weight, optional RPE). When the row was swapped (`performed_name` differs from snapshot name), prefix the row with both names. Include client notes and status.
  - **Orphaned**: use `prescribed_session_snapshot` + `prescribed_exercise_snapshot` when live refs are null. Per-set actuals still come from the attached `sets[]`.
- Update `training-history-table.tsx` row click to open new dialog. Keep `HistoryChartDialog` (removed in 5.1).

**Do NOT**: Delete `history-chart-dialog.tsx`. Do not restructure history table beyond row-click. Do not treat missing exercise_logs as an error state; it's valid. Do not parse `actual_reps` csv — those columns are gone post-090.

**Tests to write**:
- `session-log-detail-dialog.test.tsx`:
  - **Quick-logged display**: renders "no detail logged" label + prescribed reference only + notes + status.
  - **Detailed display**: prescribed + per-set actuals (reps, weight, RPE) when `ExerciseLog.sets[]` is non-empty.
  - **Swapped exercise**: when `performed_name !== prescribed_exercise_snapshot.name`, both names render ("Prescribed X · Performed Y").
  - **Per-set RPE**: when sets carry RPE, the column renders the value; when null, renders empty / placeholder.
  - Snapshot fallback when live session null.
  - Snapshot fallback when live exercise null.
  - Loading + error states.

**Verify**: Manual coach test. `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`. Commit.

**Addendum (design-space protection for Session 1.9)**: When rendering exercise names in the detailed display state, wrap each name in a clickable element (e.g. `<button>` styled as a text link). Do NOT wire navigation yet - the click handler should be a no-op placeholder or `console.debug` that logs the exercise identity (`exerciseId` or `performedName`). Session 1.9 will wire these to navigate to the Exercise Data subtab with the clicked exercise pre-selected. This keeps the scope of 1.6 unchanged while ensuring the UI element exists for 1.9 to connect. If implementing this adds more than ~10 lines to the dialog component, it belongs in 1.9 instead.

---

## Session 1.7: Attention feed rewire (training triggers) + alert dismissal

**Status**: COMPLETE

**Commit message**: `refactor(attention-feed): read training completion from training_events`

**Objective**: Switch "training missed" and "activity-calorie mismatch" triggers to read `training_events.status` directly.

**Implemented**:
- Rewired `evaluateTrainingMisses` and `evaluateActivityCalMismatch` to read from `TrainingEventRow[]` instead of `DailyLog.trainingData`.
- Status classification for missed: `scheduled || missed || skipped` (partial does NOT count). Today's events excluded.
- Added `evaluatePartialTrainingPattern` — cycle-agnostic, event-count-based (3+ partials in last 9 resolved events).
- Added `TrainingEventRow` type and `trainingEvents` field on `ClientData` in `attention-feed-helpers.ts`.
- Expanded training_events query to include `date`, `status`, `estimated_calories`.
- Added `partial_training_pattern` to `AlertType` union and UI switch cases.
- Added alert dismissal: migration `091_add_attention_dismissals.sql`, `filterDismissedAlerts` in helpers, POST `/api/dashboard/attention-feed/dismiss` route with IDOR check, X dismiss button in `needs-attention-feed.tsx`.
- Dismissals auto-resurface when `MAX(affectedDays) > dismissed_at`.

**Do NOT**: Remove the `training_logs.trained` column. Do not refactor `attention-feed-service.ts` beyond necessary.

**Tests**: 821 total passing — trigger rewire, dismissal filtering, dismiss API route, service regression.

**Verify**: `npx tsc --noEmit && npx eslint . && npx vitest run`. Manual signal test. Commit.

---

## Session 1.8: Exercise history data layer + API (coach-side)

**Commit message**: `feat(training): add exercise history analytics service and coach API endpoint`

**Objective**: Build the service layer and API route that power exercise trend charts. The service must union two exercise identity paths to find all logs for a given exercise: `exercise_logs.exercise_id` (populated for swap/unplanned picks) and `exercise_logs.training_exercise_id -> training_exercises.exercise_id` (for prescribed exercises that were not swapped). Returns time-series metrics and personal records. Session 7.7 (Metrics tab exercise charts) shares this data layer.

**Read first**:
- `supabase/migrations/090_normalize_set_logs.sql` (schema: `set_logs`, `exercise_logs.exercise_id`, `exercise_logs.performed_name`).
- `services/training-log-service.ts` (`attachSetLogs`, `mapExerciseLogRow`, `mapSetLogRow` - understand the existing read patterns).
- `types/training.ts` (`ExerciseLog`, `SetLog`, `TrainingEventDetail`).
- `docs/ARCHITECTURE.md` "Training Completion Hierarchy" and "Exercise Catalog" sections.
- `components/clients/training/training-history-table.tsx` (existing summary strip pattern and data fetching - the Exercise Data tab must match this design language).
- `components/clients/history-table/history-chart-dialog.tsx` (existing Recharts usage - understand the data shape charts consume).

**Plan (report before implementing)**:
- Exact SQL/query shape for the union of both exercise identity paths. The join: `exercise_logs LEFT JOIN training_exercises ON exercise_logs.training_exercise_id = training_exercises.id`. An exercise_log matches the target exercise when `exercise_logs.exercise_id = targetExerciseId OR training_exercises.exercise_id = targetExerciseId`. For name-based fallback (legacy rows where both FKs are null): `LOWER(exercise_logs.performed_name) = LOWER(targetName)`.
- How to scope by client: join through `session_logs.client_id`.
- Service function signatures and return shapes.
- Whether to add functions to the existing `services/training-log-service.ts` or create `services/exercise-analytics-service.ts`. Decision rule: if `training-log-service.ts` is approaching 300 lines (CONVENTIONS file size limit for services), create a new file.

**Implement**:
1. **Service** (new `services/exercise-analytics-service.ts` or extend `training-log-service.ts`):
   - `getClientExerciseList(clientId: string): Promise<ExerciseListItem[]>` - returns all exercises the client has logged, ordered by frequency. Groups by `COALESCE(exercise_logs.exercise_id::text, training_exercises.exercise_id::text, LOWER(exercise_logs.performed_name))`. Returns `{ exerciseId: string | null, name: string, logCount: number, lastLoggedDate: string }`. The `name` is `MAX(performed_name)` within each group (most recent wins for display).
   - `getExerciseProgressionSeries(clientId: string, params: { exerciseId?: string, exerciseName?: string, sessionCount?: number }): Promise<ExerciseProgressionPoint[]>` - returns an ordered array of `{ date: string, sessionLogId: string, topSetWeight: number | null, topSetReps: number | null, estimatedOneRepMax: number | null, totalVolume: number | null, topSetRpe: number | null, prescribedSets: number | null, actualSets: number, prescribedRepsMin: number | null, prescribedRepsMax: number | null }`. Each point is one session where the client logged this exercise. Joins `exercise_logs -> set_logs` and aggregates: `topSetWeight = MAX(set_logs.weight)`, `topSetReps = reps from the set with max weight` (tiebreak: highest reps), `totalVolume = SUM(set_logs.reps * set_logs.weight)`, `topSetRpe = RPE from the top-weight set`. Estimated 1RM via Epley formula: `weight * (1 + reps / 30)` applied to the best set (highest estimated 1RM across all sets in that session, not just the heaviest). Prescribed data comes from `prescribed_exercise_snapshot` JSONB on the matching exercise_log. Ordered by `session_logs.completed_at ASC`. When `sessionCount` is provided, returns only the most recent N sessions.
   - `getExercisePRs(clientId: string, params: { exerciseId?: string, exerciseName?: string }): Promise<ExercisePR[]>` - returns the best weight per distinct rep count across all set_logs for the exercise: `{ reps: number, weight: number, date: string, isRecent: boolean }`. A PR is "recent" if set within the last 28 days. Only includes rep counts the client has actually logged (no padding for 1/3/5/8/10 if they never hit those). Ordered by reps ascending.
2. **Types**: add to `types/training.ts`:
   - `ExerciseListItem`, `ExerciseProgressionPoint`, `ExercisePR`.
3. **API route**: `GET /api/clients/[id]/training/exercise-history` (coach-side). `coachApiRateLimit` + `getAuthenticatedCoachId` + IDOR ownership check. Query params: `exerciseId` (UUID, optional), `exerciseName` (string, optional, fallback when no exerciseId), `sessionCount` (number, optional, default 12), `metric` (enum: `list | progression | prs`). Returns `{ success: true, data: ExerciseListItem[] | ExerciseProgressionPoint[] | ExercisePR[] }` depending on `metric`. `Cache-Control: no-store`.

**Do NOT**: Build UI (Session 1.9). Create client-facing API routes yet (Session 3.4 adds those). Modify existing service functions in `training-log-service.ts`. Duplicate the Epley formula if it already exists in `utils/` - search first and reuse.

**Tests to write**:
- `services/exercise-analytics-service.test.ts`:
  - `getClientExerciseList`: returns exercises ordered by log count; groups by `exercise_id` when present, falls back to `LOWER(performed_name)` when null; empty history returns empty array.
  - `getExerciseProgressionSeries`: returns chronological points with correct `topSetWeight` (MAX across sets), correct `estimatedOneRepMax` (Epley on best-e1RM set, not just heaviest), correct `totalVolume` (SUM of reps*weight). Respects `sessionCount` limit. Handles sessions with only partial set data (some sets have null weight).
  - `getExercisePRs`: returns best weight per rep count; `isRecent` is true for PRs within 28 days, false otherwise; no entries for rep counts the client never logged; empty data returns empty array.
  - Both identity paths work: finds logs via `exercise_logs.exercise_id` and via `training_exercises.exercise_id`.
- API route test: 200 with `metric=list`; 200 with `metric=progression`; 200 with `metric=prs`; 403 IDOR; 400 when neither `exerciseId` nor `exerciseName` provided for progression/prs metrics.

**Verify**: `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`. Commit.

---

## Session 1.9: Exercise Data tab UI + PR view (coach-side)

**Commit message**: `feat(coach): add Exercise Data subtab with trend charts and PR view`

**Objective**: Add "Exercise Data" as the third subtab in the Training tab's segmented control (after Data and Plans). The page has an exercise search/select dropdown, a metric toggle, session-count picker, and chart display. Coaches can view weight trends, estimated 1RM, volume, RPE, compliance, and personal records for any exercise the client has logged. Wire the Session 1.6 drill-down dialog exercise names to navigate here with the clicked exercise pre-selected.

**Read first**:
- `components/clients/training/builder/training-plan-builder.tsx` (the subtab segmented control at lines 166-180, `subtab` URL param logic at lines 44-49 - this is where "Exercise Data" is added as a third option).
- `components/clients/training/training-history-table.tsx` (the dark summary strip pattern at lines 177-270 and table card pattern - Exercise Data must match this design language exactly).
- `components/clients/history-table/history-chart-dialog.tsx` (existing Recharts patterns: `ResponsiveContainer`, `LineChart`/`BarChart`, axis styling, tooltip format).
- `components/clients/metrics/metric-chart-card.tsx` (the `AreaChart` with gradient fill pattern - another reference for chart styling).
- `components/ui/chart.tsx` (base chart utilities - `ChartContainer`, `ChartTooltip`).
- Output of Session 1.8 (API shape and types).
- `components/clients/training/session-log-detail-dialog.tsx` (the drill-down dialog from Session 1.6 - wire clickable exercise names here).
- `lib/client-tabs.ts` (tab registration - no changes needed; Exercise Data is a subtab within Training, not a top-level tab).
- `CONVENTIONS.md` component size limits (250 lines per component).

**Plan (report before implementing)**:
- Component breakdown respecting the 250-line limit. Likely split:
  - `exercise-data-view.tsx` - main container with exercise picker + metric toggle + chart area.
  - `exercise-search-select.tsx` - search/select dropdown for exercise selection (SWR fetch of exercise list from `metric=list` endpoint).
  - `exercise-trend-chart.tsx` - the chart renderer (switches between Line and Bar based on metric).
  - `exercise-pr-view.tsx` - the PR card grid (rendered when "PRs" metric is selected).
- How the subtab URL param extends: `subtab=data|plans|exercise-data`. When navigating from the drill-down dialog, the URL includes `subtab=exercise-data&exerciseId=<uuid>` (or `&exerciseName=<name>` as fallback).
- SWR key structure for the exercise history fetch.

**Implement**:
1. **Extend the segmented control** in `training-plan-builder.tsx`:
   - Add `"exercise-data"` as a third option in the subtab type and segmented control buttons. Label: "Exercise Data".
   - When `subtab === "exercise-data"`, render the new `ExerciseDataView` component.
   - Read `exerciseId` and `exerciseName` from search params to support deep-linking from the drill-down dialog.

2. **`components/clients/training/exercise-data/exercise-data-view.tsx`** (new directory):
   - **Exercise picker**: dropdown/combobox at top. Fetches exercise list via `GET /api/clients/[id]/training/exercise-history?metric=list` (SWR). Shows exercise name + log count. Searchable. Pre-selects when `exerciseId` or `exerciseName` URL param is present.
   - **Metric segmented control**: Weight / e1RM / Volume / RPE / Compliance / PRs. Horizontal, same styling as the Data/Plans/Exercise Data control. Default selection: Weight.
   - **Session-count picker**: 8 / 12 / 24 / All. Rendered as small pill buttons below the metric toggle. Default: 12 for Weight/e1RM/RPE, 8 for Volume/Compliance. Not shown for PRs (PRs are all-time by definition).
   - **Date subtitle**: below the chart, shows the actual time span covered (e.g. "Oct 14 - Jan 6") derived from the first and last data points.
   - Fetches progression data via `GET /api/clients/[id]/training/exercise-history?metric=progression&exerciseId=...&sessionCount=...` (SWR, keyed on exercise + session count).
   - Fetches PR data via `GET /api/clients/[id]/training/exercise-history?metric=prs&exerciseId=...` (SWR, separate key, only when PRs metric is selected).

3. **`components/clients/training/exercise-data/exercise-trend-chart.tsx`**:
   - Renders one chart at a time based on the selected metric. Uses Recharts (matching existing patterns):
     - **Weight**: `LineChart` with dots. Y-axis: weight (with unit label). X-axis: session date (short format). Tooltip shows date + weight + reps.
     - **e1RM**: `LineChart`, same layout. Tooltip shows date + e1RM value + the set it was derived from.
     - **Volume**: `BarChart` (not line - sparse bars look intentional, sparse dots on a line look broken). Y-axis: total volume. Tooltip shows date + volume.
     - **RPE**: `LineChart`. Y-axis: RPE (1-10 scale, inverted isn't needed but cap at 10). Conditionally rendered only when RPE data exists in the dataset. When no RPE data, show a centered message: "No RPE data recorded for this exercise."
     - **Compliance**: Grouped bar chart or stat card. Per session: prescribed sets/reps vs actual sets/reps. Summary stat at top: "Hit prescribed reps in 9/12 sessions." When prescribed data is unavailable (unplanned exercises), show "No prescribed data available" message.
   - Empty state when fewer than 2 data points: "Not enough data yet. Log at least 2 sessions to see trends."

4. **`components/clients/training/exercise-data/exercise-pr-view.tsx`**:
   - Card grid of PRs for the selected exercise. Each card: rep count label (e.g. "5 rep max"), weight with unit, date set, "New" badge if `isRecent` is true.
   - Cards ordered by rep count ascending (1RM first if it exists, then 3RM, 5RM, etc.).
   - Empty state: "No personal records yet. Log sets with weight to start tracking PRs."

5. **Wire drill-down dialog**: Update `session-log-detail-dialog.tsx` from Session 1.6. Replace the no-op click handlers on exercise names (from the 1.6 addendum) with actual navigation: `router.replace(\`/clients/${clientId}?tab=training&subtab=exercise-data&exerciseId=${exerciseId}\`)` (or `&exerciseName=...` when exerciseId is null). The dialog should close on navigation.

**Do NOT**: Show all charts stacked vertically - one chart at a time via the segmented control. Add a day-based date picker (exercise data is sparse; session-count picker is the right model). Build client-facing UI (Session 3.4). Introduce a new charting library - use Recharts. Create a separate top-level tab in `lib/client-tabs.ts` - Exercise Data is a subtab within Training.

**Tests to write**:
- `exercise-data-view.test.tsx`:
  - Exercise picker renders list from fixture; selecting an exercise triggers data fetch.
  - Metric toggle switches between Weight/e1RM/Volume/RPE/Compliance/PRs.
  - Session-count picker defaults to 12 for Weight; changes refetch data.
  - Date subtitle renders the correct span from data points.
  - Deep-link via `exerciseId` URL param pre-selects the exercise.
  - Empty exercise list shows appropriate empty state.
- `exercise-trend-chart.test.tsx`:
  - Line chart renders for Weight metric with correct data points.
  - Bar chart renders for Volume metric.
  - RPE chart hidden when no RPE data exists.
  - Empty state renders when fewer than 2 data points.
- `exercise-pr-view.test.tsx`:
  - PR cards render for fixture data with correct rep/weight/date.
  - "New" badge renders when `isRecent` is true.
  - Cards ordered by rep count ascending.
  - Empty state renders when no PRs exist.
- `session-log-detail-dialog.test.tsx` (extend from Session 1.6):
  - Exercise name click navigates to Exercise Data subtab with correct exerciseId param.

**Verify**: Manual: open a client with logged exercise data; switch to Exercise Data subtab; select an exercise; toggle between metrics; verify charts render. Click an exercise name in the drill-down dialog; confirm navigation to Exercise Data with exercise pre-selected. Verify session-count picker rescopes data. Check the PR view. `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`. Commit.

---

## Session 2.1: Day summary + program endpoints

**Commit message**: `feat(api): add client day-summary and program endpoints`

**Objective**: Lightweight endpoints for new home + program view. No UI yet.

**Read first**:
- `docs/CLIENT-PORTAL-REDESIGN.md` (Fetch pattern).
- `services/training-event-service.ts`.
- Grep for roadmap/phase services.
- `CONVENTIONS.md` API middleware ordering.

**Plan (report before implementing)**:
- Exact summary shape per card type. The training card summary must distinguish three states per event: unlogged, quick-logged (no exercise_logs, just `completion_quality`), detailed-logged (exercise_logs present). Include both `completionQuality` and `loggedExerciseCount` + `prescribedExerciseCount` so the UI can render the right label.
- Efficient logged/not-logged computation (single query per domain).
- Program endpoint shape.

**Implement**:
- `services/client-day-service.ts`: `getDaySummary(clientId, date)`. **Composes existing domain services; does not query tables directly**. Calls into `services/training-event-service.ts` (events for date), `services/nutrition-event-service.ts` (nutrition event + log existence), `services/daily-log-service.ts` or equivalent (wellness log existence), habit service (habit count + logged count). Aggregates their outputs into the summary shape. If a domain service is missing a read the summary needs, extend that domain service, don't add a raw table query here.
  - Per training event: `eventId`, `sessionName`, `sessionFocus`, `completionQuality` (null if not logged), `loggedExerciseCount`, `prescribedExerciseCount`.
  - Per nutrition: log exists yes/no.
  - Per wellness: log exists yes/no.
  - Per habits: total habit count + count with log for date.
- `services/client-program-service.ts` (new file): `getClientProgram(clientId)` returning roadmap + phases. **Kept separate from the existing roadmap service** because that file uses `supabaseAdmin` for coach cross-client queries; this client-side read must use session-scoped Supabase (RLS). Separate file prevents accidentally grabbing the admin helper.
- `app/api/client/day-summary/route.ts` (GET, `clientApiRateLimit`, `Cache-Control: no-store`).
- `app/api/client/program/route.ts` (GET).

**Do NOT**: Build UI. Do not modify existing endpoints.

**Tests to write**:
- Service tests:
  - Empty day returns null summaries.
  - Prescribed + unlogged training event: `completionQuality: null`, exercise counts zero/prescribed.
  - Quick-logged event: `completionQuality` set, `loggedExerciseCount: 0`.
  - Detailed-logged event: `completionQuality` set, `loggedExerciseCount > 0`.
  - Multiple training sessions returns array.
- Program service: no roadmap; active roadmap with correct current phase; completed phases in list.
- API route tests: 200 shape; 401; 400 on missing date (day-summary).

**Verify**: Manual curl. `npx tsc --noEmit`, `npx vitest run`. Commit.

---

## Session 2.2: Bottom tab bar + client layout restructure

**Commit message**: `feat(client-portal): add bottom tab bar with Home/Check-in/Program/Content nav`

**Objective**: Restructure `app/client/layout.tsx` to render a persistent bottom tab bar with Home, Check-in, Program, Content destinations, plus a top-right avatar button that will open Settings (built in Session 2.6). This lays the chrome that every other client page renders inside.

**Read first**:
- `app/client/layout.tsx` (current header-only layout). Pay attention to existing auth gating (role checks, redirects, session validation) and any onboarding-state gating that renders `client-waiting-state.tsx` for pre-activation clients. Everything must be preserved.
- `components/client/onboarding/client-waiting-state.tsx` (existing waiting-for-coach state).
- `docs/CLIENT-PORTAL-REDESIGN.md` (Navigation structure section).
- `app/client/resources/page.tsx` (existing Content destination).
- `app/client/check-in/page.tsx` (existing Check-in destination).
- `CONVENTIONS.md` component communication.
- `docs/newdesignsystem.md`.

**Plan (report before implementing)**:
- Confirm the current auth + onboarding gating path in `app/client/layout.tsx`. The rewrite preserves this path exactly; only chrome changes.
- Decide: if the client's onboarding state shows the waiting state, does the bottom tab bar also render? (Probably no — waiting state is full-screen, no nav.) Document the chosen behavior.
- Active-tab detection (Next.js `usePathname`).
- Avatar button behavior (links to `/client/settings` as a placeholder until 2.6 implements it).
- Mobile-web sizing, safe-area padding for iOS notch/home indicator.

**Implement**:
- `components/client-portal/nav/client-nav.tsx`: single file containing the bottom tab bar (4 tabs: Home → `/client`, Check-in → `/client/check-in`, Program → `/client/program`, Content → `/client/resources`) plus the top-right avatar button linking to `/client/settings`. Lucide icons; active-state highlight; fixed positioning; safe-area padding. Only split into separate files if it exceeds the 250-line component limit.
- Rewrite `app/client/layout.tsx`:
  - Preserve all existing auth gating and role redirects as-is; confirm by diffing.
  - Preserve the onboarding-state path that renders `client-waiting-state.tsx`; this renders full-screen without the new nav chrome.
  - When the client is activated: render minimal top bar (logo + avatar trigger), children, bottom tab bar.
  - Body padding (or layout wrapper) so page content doesn't hide behind the tab bar.

**Do NOT**: Build the settings page itself (Session 2.6). Do not change any existing destination page; they just get wrapped by the new layout. Do not add notification badges on the Check-in tab (possible follow-up).

**Tests to write**:
- `client-nav.test.tsx`:
  - Renders 4 tabs with correct href attributes.
  - Active state toggles based on pathname.
  - Avatar button links to `/client/settings` (renders fallback initials when no avatar set).

**Verify**: Manually navigate every client page; tab bar renders, content does not hide behind bar. `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`. Commit.

---

## Session 2.3: Home page shell + swipe navigation

**Commit message**: `feat(client-portal): add day-centric home with URL-param date navigation`

**Objective**: Build `app/client/page.tsx` as the new landing, with date navigation (arrow buttons + horizontal swipe), URL-param-driven date state, loading + error shells.

**Read first**:
- Output of Session 2.2 (bottom tab bar in place).
- `docs/CLIENT-PORTAL-REDESIGN.md` (Target shape).
- `CONVENTIONS.md` component communication.
- `lib/date-helpers.ts`.
- `docs/newdesignsystem.md`.
- `package.json` (existing swipe lib; ask before adding new deps).

**Plan (report before implementing)**:
- Swipe lib decision.
- URL state handling.
- Keyboard support (left/right, "Today" shortcut).

**Implement**:
- `app/client/page.tsx`: renders day header + 4 placeholder card slots.
- `components/client-portal/day/day-header.tsx`: prev/next, "Today" button, date display.
- Fetches `GET /api/client/day-summary` via SWR with loading skeleton. Call `useSWR` directly; do not create a `useClientDay` wrapper hook unless it grows real logic (retries, transforms, dependent fetches).
- SWR config on this fetch: include `dedupingInterval: 2000` (per CONVENTIONS §7). Day-swipe can fire multiple date changes per second; `clientApiRateLimit` is 30 req / 10s, so a user holding down the arrow key or rapid-swiping without deduping can brush the limit and get 429s. Deduping collapses identical same-date fetches inside the window. Also set `revalidateOnFocus: false` and `errorRetryCount: 3` per CONVENTIONS §7.
- Swipe/arrow updates `?date=` (no remount; SWR key swap).
- **Update post-login redirect**: today the client probably lands on `/client/dashboard` after login. Grep for redirect destinations (likely in `middleware.ts`, `lib/auth-helpers.ts`, or the login action) and change them to `/client`. The old dashboard route still exists until Session 5.1 removes it, but nothing should send the client there anymore.
- **Grep email templates** under `emails/` for any `/client/dashboard` deep links and update them to `/client`.

**Do NOT**: Build summary cards yet (2.4). Do not add phase banner yet (2.4).

**Tests to write**:
- `day-header.test.tsx`: prev/next update date prop; "Today" snaps; keyboard arrows work.
- Home page render tests: loading, error, URL-param-driven fetch key.

**Verify**: Navigate forward/back; URL updates; refetch happens. `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`. Commit.

**Initial-login fetch burst audit (carry into 2.4/2.5 if not addressed here)**:
The legacy Daily Pulse dashboard fires ~24 parallel GETs on fresh login (notifications, me, habits, nutrition, training, progress, check-in-context, resources, daily-logs/{week,today,streak,nutrition-target}, habits/logs/today, weekly-nutrition, phase-completion, plus Next-dev hot-reload duplicates). With `clientApiRateLimit` at 30/10sec IP-keyed, slow-returning routes (`/api/client/training`, `/api/client/training/completions`) intermittently 429 on hard refresh. The redesign's `GET /api/client/day-summary` (Session 2.1) is intended to absorb most of these. As part of this session's Verify step, open the network tab on fresh login and count the client-portal requests fired in the first 5 seconds of `/client`. Target: ≤ 6 requests to `/api/client/*` (day-summary, me, program, check-in-context if due, phase-completion, notifications). If the count is higher, file the excess against the specific card/session that still needs converting rather than papering over with rate-limit tuning.

---

## Session 2.4: Summary cards + phase banner

**Commit message**: `feat(client-portal): wire home summary cards and phase banner`

**Objective**: Replace home placeholder slots with real summary cards (training, nutrition, wellness, habits). Add phase banner at top.

**Read first**:
- Output of Session 2.3.
- `docs/CLIENT-PORTAL-REDESIGN.md` (summary card definitions).
- Coach-side card styling for reference.
- `docs/newdesignsystem.md`.

**Plan (report before implementing)**:
- Card hierarchy; shared primitive if warranted.
- Click targets → detail pages.

**Design note — day-summary vs. detail fetch trade-off (do NOT "optimize"):**
Clicking a card navigates to a detail page which fires its own fetch (e.g. `GET /api/client/training/events/[eventId]`). That means data the day-summary already returned (session name, log status) is re-fetched. This is deliberate: keeps the home payload under 5KB, keeps detail pages independently cacheable, and lets each page own its own freshness rules. Do NOT widen `day-summary` to include full detail-page data as a "performance improvement." If the brief loading flash between home and detail is noticeable in practice, add SWR prefetch on card tap-down / hover to the detail endpoint rather than denormalizing into day-summary. Cards link via `next/link` with `prefetch` default; detail data can be warmed via `useSWRConfig().mutate(key, fetcher())` from a tap-down handler if needed — but wait for real feedback before adding that.

**Implement**:
- `components/client-portal/day/training-card-summary.tsx` (handles 0/1/N events). Renders three display states per event:
  - Unlogged: "Pull Day A • Not logged yet" + "Tap to log" affordance.
  - Quick-logged: "Pull Day A • Logged as complete" (or partial/skipped) + "Tap to view" affordance.
  - Detailed-logged: "Pull Day A • 5/6 exercises logged" + "Tap to view" affordance.
- `components/client-portal/day/nutrition-card-summary.tsx`.
- `components/client-portal/day/wellness-card-summary.tsx`.
- `components/client-portal/day/habits-card-summary.tsx`.
- `components/client-portal/day/phase-banner.tsx` (hides when no active phase; handles transition).
- Wire home page to render them from day-summary data.

**Do NOT**: Build nutrition/wellness/habits detail pages (Phase 3/4). Training detail exists from 1.4. Widen the day-summary payload to pre-populate detail pages (see Design note above).

**Tests to write**:
- `training-card-summary.test.tsx`: all three per-event states (unlogged, quick-logged, detailed-logged) render expected copy. Multiple events render as list.
- Each `*-card-summary.test.tsx` for nutrition/wellness/habits: empty, logged states.
- `phase-banner.test.tsx`: hidden when no roadmap; active; transitioning states.

**Verify**: Manual state coverage. `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`. Commit.

---

## Session 2.5: Program page + phase completion card relocation

**Commit message**: `feat(client-portal): add program page and relocate phase completion card`

**Objective**: Build `/client/program` read-only roadmap view. Relocate `PhaseCompletionCard` from Daily Pulse to new home.

**Read first**:
- `components/daily-pulse/phase-completion-card.tsx`.
- `components/clients/roadmap/roadmap-tab-content.tsx` (coach reference).
- `docs/CLIENT-PORTAL-REDESIGN.md` (Program view).
- `GET /api/client/phase-completion` (existing).

**Implement**:
- `app/client/program/page.tsx`: fetches `GET /api/client/program`; renders roadmap + phase list (current highlighted; past collapsed; future with start dates). Read-only.
- Move `phase-completion-card.tsx` to `components/client-portal/day/phase-completion-card.tsx`. Update imports.
- **Preserve the existing SWR fetch pattern** inside the card (fetches from `GET /api/client/phase-completion` and POSTs dismissal). Do not rewrite the fetch; only relocate the file and update imports.
- Wire at top of `app/client/page.tsx` when `completion_seen = false`.
- Phase banner links to `/client/program`.

**Do NOT**: Build phase-editing UI. Do not change the phase-completion endpoint. Do not rewrite the card's internal fetch logic.

**Known convention violation (intentional)**: The relocated card fetches its own data, which violates CONVENTIONS' "props down, callbacks up" rule for child components. We're keeping this because Session 2.5 is relocation-only, not a refactor, and the fetch pattern already works. This is documented in the "Deliberate reversals" section of `docs/CLIENT-PORTAL-REDESIGN.md`. Do NOT imitate this pattern for any new components built in later sessions.

**Tests to write**:
- Program page: active phase highlighted; no-roadmap empty state.
- Relocated phase completion card: renders with coach reflection + stats; dismiss fires correct POST.

**Verify**: Manual complete-a-phase flow. `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`. Commit.

---

## Session 2.6: Settings page + settings endpoint

**Commit message**: `feat(client-portal): add client settings page with unit and reminder preferences`

**Objective**: Build `/client/settings` with editable weight unit, unit preference, reminder preferences, timezone (if added in 0.3), plus read-only profile info and a sign-out button. Add `PATCH /api/client/settings` mutation.

**Read first**:
- `types/check-in.ts` (find `Client` type, `ReminderPreferences`).
- `app/api/client/me/route.ts` (existing GET).
- `services/client-service.ts` (client reads/writes).
- `CONVENTIONS.md` API design section.
- `docs/CLIENT-PORTAL-REDESIGN.md` (Settings page section).

**Plan (report before implementing)**:
- Exact editable field list, informed by:
  - The `unit_preference` vs `weight_unit` decision from Session 0.3. If they're linked (unit_preference drives weight_unit), expose a single toggle in the UI. If independent, expose both.
  - **Grep for `reminder_preferences` reads** across `services/`, `lib/`, `app/api/`. Only expose toggles for fields that actually drive downstream behavior. If no code reads a field, don't build a UI that pretends to toggle it.
- Form state strategy (React Hook Form with Zod).

**Implement**:
- `lib/validations/client.ts` (or extend existing): `updateSettingsSchema` covering only the fields you actually ship (informed by the grep above).
- `app/api/client/settings/route.ts` (PATCH): `clientApiRateLimit` + CSRF + `getAuthenticatedClientId` + schema validation + service call.
- `services/client-service.ts`: `updateClientSettings(clientId, updates)` (add as an exported function; do not create a new service file for this).
- `app/client/settings/page.tsx` as a **single file** first:
  - Read profile info (name, email) read-only.
  - Unit toggle(s) per the 0.3 decision.
  - Only the reminder preference toggles that have downstream consumers.
  - Timezone selector (only if column added in 0.3).
  - Sign-out button (uses existing auth sign-out flow).
  - Save button at bottom (single commit).
- **Only split into `components/client-portal/settings/*` sub-files if `page.tsx` exceeds the 250-line component limit**. No speculative component breakdown.

**Do NOT**: Create a `components/client-portal/settings/` directory up front. Avatar upload. Password change (separate auth flow). Notification-channel management beyond `reminder_preferences`. Ship UI toggles for fields with no downstream readers.

**Tests to write**:
- `app/api/client/settings/route.test.ts`: 200 on valid PATCH; 400 on invalid enum; 401 unauthenticated; CSRF rejection.
- `services/client-service.test.ts` (extend): `updateClientSettings` writes expected columns; rejects unknown fields.
- `app/client/settings/page.test.tsx`: renders with current values; save submits correct payload; error toast on save rejection.

**Verify**: Manual toggle + save; reload confirms persistence. `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`. Commit.

---

## Session 2.7: Client check-in hub (submission + history)

**Commit message**: `feat(client-portal): turn check-in page into a hub with submission and past history`

**Objective**: Rework `/client/check-in` so it acts as the hub the bottom nav's Check-in tab routes to: shows the submission form when a check-in is in window, and a list of past check-ins with drill-down detail either way. Reuse the existing submission flow and the existing check-in detail page; do not rebuild either.

**Read first**:
- `app/client/check-in/page.tsx` (current submission flow).
- `app/client/progress/page.tsx` (current check-in history + any non-check-in content).
- `app/client/progress/check-in/[id]/page.tsx` (existing check-in detail page — reuse target).
- `app/api/client/check-ins/` (existing endpoints).
- `services/check-in-context-service.ts` + `calculateCheckInPeriod()` (window gating).
- `docs/CLIENT-PORTAL-REDESIGN.md` (Check-in hub section).

**Plan (report before implementing)**:
- Whether to re-use `/client/check-in/page.tsx` in place or restructure.
- Whether `/client/progress` contains non-check-in content. If it's only check-in history, flag it for retirement in Session 5.1 cleanup. If it contains other progress metrics (weight trends, etc.), leave `/client/progress` as a linked-to page and link from the hub or Settings.
- Detail drill-down: reuse `app/client/progress/check-in/[id]/page.tsx` if it renders what we need. Adjust the route path if needed (e.g. move under `/client/check-in/[id]` for URL consistency).

**Implement**:
- `app/client/check-in/page.tsx`:
  - When a check-in window is open: render submission form at top (existing flow unchanged).
  - When closed: replace form with a "Next check-in opens on [date]" notice, no form.
  - Below either state: a "Past check-ins" list, chronological, newest first. Each row: date, status badge, short AI-summary preview.
- Past check-in rows link to the existing detail page (path adjustment if needed for URL consistency).
- If `/client/progress` is retired in cleanup, update any incoming links.

**Do NOT**: Rebuild the submission form. Rebuild the check-in detail page. Change the window-gating logic. Add AI-regen or edit flows.

**Tests to write**:
- `app/client/check-in/page.test.tsx`:
  - Window open: submission form + past list both render.
  - Window closed: "next opens on" notice + past list render; no form.
  - Empty history: past list shows an empty-state placeholder.
  - Past row click navigates to the detail route.

**Verify**: Manually open/close window via test client; confirm both states render. Reach detail page from a past row. `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`. Commit.

---

## Session 3.1: Shared day-log helpers + nutrition/wellness endpoints

**Commit message**: `feat(api): add day-log permission helpers, plan-context resolver, nutrition and wellness endpoints`

**Objective**: Build the per-card nutrition and wellness endpoints, plus two shared helpers that every subsequent per-card write will reuse (habits in Session 4.1, any future card). The helpers centralize the date-edit rule and plan-context resolution so they cannot drift across endpoints.

**Read first**:
- Grep existing `daily_logs` writers in `services/`.
- `supabase/migrations/` for nutrition_logs + wellness_logs schemas.
- `docs/ARCHITECTURE.md` "Daily Logs" section.
- `docs/CLIENT-PORTAL-REDESIGN.md` (Date edit rules, single-source-of-truth subsection).
- `services/nutrition-event-service.ts`.
- `lib/date-helpers.ts` (timezone utilities).

**Plan (report before implementing)**:
- Exact signatures for the two shared helpers (see Implement).
- How `assertCanEdit` throws (custom error class vs Next.js response helper) and how route handlers translate the throw into a 403.
- Whether `resolvePlanContextForDate` belongs in a new file or inside an existing plan-adjacent service.
- Whether to extend an existing day-log service or create `services/daily-log-card-service.ts` for the per-card writes.

**Implement**:

1. **`lib/daily-log-permissions.ts`** (new):
   - `canEditDay(date, loggedStatus, clientTimezone): boolean` — pure function, client-safe (no Supabase imports). Returns true for today + past-unlogged; false for past-logged + future. Imported by UI detail pages to drive disabled state.
   - `assertCanEdit({ clientId, date, resourceType }): Promise<void>` — server-side wrapper. Loads the client's timezone and current log state for the resource, calls `canEditDay`, throws a typed error (e.g. `DayLockedError`) on violation. Route handlers catch and return 403.

2. **`resolvePlanContextForDate(clientId, date): { phaseId, nutritionPlanId, trainingPlanId }`** — shared helper used by every per-card write to populate `daily_logs.phase_id` and child `*_plan_id` links. Lives in an existing plan-adjacent service (decided in planning step). Every write calls it once; no endpoint reimplements the lookup.

3. **Nutrition endpoints**:
   - `GET /api/client/daily-logs/[date]/nutrition/route.ts` (log + event target per ARCHITECTURE three-level priority).
   - `PATCH /api/client/daily-logs/[date]/nutrition/route.ts`: calls `assertCanEdit`, then `resolvePlanContextForDate`, then writes kcal + macros to `nutrition_logs`. No inline date-rule code.

4. **Wellness endpoints**:
   - `GET` + `PATCH` equivalents for `/wellness`. Same pattern: `assertCanEdit` + `resolvePlanContextForDate` + write to `wellness_logs`.

5. Standard middleware on all four routes (rate limit, CSRF, auth, ownership, validation).

6. **In-session cleanup of `services/daily-logs-service.ts`** while the file is being edited anyway:
   - Extract `mapRowToDailyLog(row: DailyLogRow): DailyLog` into a module-local helper. Replace the three duplicated row-to-model mapping blocks with calls to the helper. If a new column is added later, one place to update instead of three. Flagged in TECHNICAL-DEBT as "Daily Pulse Feature → P2 #5."
   - Replace every `as never` cast in functions touched by this session with proper local types: one for the `daily_logs_full` view row shape (snake_case), one for the `upsert_daily_log_atomic` RPC param/return signature. Cast through the local types instead of through `never`. Do NOT introduce any new `as never` casts in code added by this session. Flagged in TECHNICAL-DEBT as "Type Safety Gaps from Schema Split #1."
   - After commit, mark both TECHNICAL-DEBT entries Resolved.

**Do NOT**: Build UI (Sessions 3.2, 3.3). Remove the monolithic `/api/client/daily-logs` POST yet. Duplicate date-rule logic or plan-context resolution inside any route handler. Introduce new `as never` casts in service-layer code this session touches.

**Tests to write**:
- `lib/daily-log-permissions.test.ts`: `canEditDay` covers:
  - Today, past-unlogged, past-logged, future — base cases.
  - Client-local midnight boundary (a server UTC time that's "tomorrow" in PST should still treat PST's "today" as editable).
  - **DST transition day** (e.g. `America/Los_Angeles` on 2026-03-08 when clocks spring forward; 2026-11-01 when they fall back). `Intl.DateTimeFormat` handles this correctly but a fixture makes sure our wrapper doesn't mangle it. Assert `canEditDay` returns the same answer before and after the DST jump for the same IANA zone.
  - **Client timezone changed mid-day**: client was `America/New_York`, switched to `Asia/Tokyo`; the in-flight request uses the current timezone value at read time. Not a bug to prevent — just a regression test that the helper reads fresh `client.timezone` on every call, not a cached value.
  - **Invalid / unknown timezone string** (e.g. someone manually set `"Mars/Olympus"`): the helper falls back to UTC rather than throwing. Pre-launch we can't fully prevent this; guard against the crash mode.
  - `assertCanEdit` throws on violation and resolves cleanly on allowed cases (mock the log-state read + client timezone read).
- Plan-context resolver test: returns correct IDs for phase-active, no-phase, and no-plan fixtures.
- All four API routes: 200/201 happy path; 400 malformed; 401 unauthenticated; 403 for past-logged and future dates (PATCH). Assert the 403 is produced via `assertCanEdit`, not via duplicated inline logic.
- Nutrition GET: three-level priority returns expected value per case.
- `services/daily-logs-service.test.ts` (extend): direct unit test for `mapRowToDailyLog` — verifies snake_case to camelCase mapping, null handling, and nested JSONB fields. One test per meaningful column group is enough.

**Verify**: Manual curl for each date-rule case. `npx tsc --noEmit`, `npx vitest run`. Confirm no `as never` casts remain in functions touched by this session (`grep -n "as never" services/daily-logs-service.ts` should only show untouched functions, if any). Commit.

---

## Session 3.2: Nutrition detail page

**Commit message**: `feat(client-portal): add nutrition detail page with macro entry`

**Objective**: Build `/client/nutrition`: numeric inputs for kcal + P/C/F, save, target progress bars.

**Read first**:
- Output of Session 3.1.
- `docs/CLIENT-PORTAL-REDESIGN.md` (Nutrition scope).
- `docs/newdesignsystem.md`.

**Implement**:
- `app/client/nutrition/page.tsx` with `date` query param.
- Four numeric inputs (kcal, protein, carbs, fat).
- Vs-target progress display.
- Save to `PATCH /api/client/daily-logs/[date]/nutrition`.
- Loading, error, locked (past-logged), and view-only (future) states.
- **Import `canEditDay` from `lib/daily-log-permissions.ts`** (Session 3.1) to derive `isLocked` for the UI. Do not compute the rule locally with date math — single source of truth.

**Do NOT**: Add meal or food logging. Reimplement the date-edit rule; always import from the shared helper.

**Tests to write**:
- `app/client/nutrition/page.test.tsx`:
  - Renders with existing log values prefilled.
  - Save submits correct payload.
  - Locked state disables inputs and shows notice.
  - Future-day state disables inputs with different copy.
  - Error toast on save rejection.

**Verify**: Happy path + lock path + future-day path. `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`. Commit.

---

## Session 3.3: Wellness detail page + past-day lock enforcement

**Commit message**: `feat(client-portal): add wellness detail page with past-day lock UX`

**Objective**: Build `/client/wellness` with mood/energy/sleep/stress inputs. Solidify the date-rule UX pattern used across detail pages.

**Read first**:
- Output of Sessions 3.1 + 3.2.
- Existing Daily Pulse wellness input components (lift reusable primitives).
- `docs/CLIENT-PORTAL-REDESIGN.md` (Date edit rules).

**Implement**:
- `app/client/wellness/page.tsx` with mood/energy/sleep/stress inputs (reuse primitives).
- Save to `PATCH /api/client/daily-logs/[date]/wellness`.
- Import `canEditDay` from `lib/daily-log-permissions.ts` (Session 3.1) for `isLocked` state. Do not duplicate date math in the page.
- `components/client-portal/day/locked-day-notice.tsx`: **single component** with a `reason: 'past-logged' | 'future' | 'today-no-plan'` prop that switches copy. Do NOT create separate variant components. Reuse in nutrition page.

**Tests to write**:
- Wellness page: renders with values, save correct payload, locked/future states.
- `locked-day-notice.test.tsx`: correct copy renders for each `reason` value.

**Verify**: Happy + lock + future for both pages. `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`. Commit.

---

## Session 3.4: Client exercise history page

**Commit message**: `feat(client-portal): add exercise history page with weight trends and PR callouts`

**Objective**: Build `/client/exercise-history` so clients can view their own lift trends and personal records. Simpler than the coach-side Exercise Data tab (Session 1.9) - motivational framing, fewer metrics, prominent PR callouts. Uses the same underlying data service from Session 1.8 via a new client-facing API route.

**Prerequisites**: Session 1.8 (exercise analytics service), Session 2.2 (bottom tab bar + client layout - the page must render inside the client layout chrome), Session 3.1 (shared day-log helpers - not strictly required, but the session ordering ensures the client portal detail page infrastructure is in place).

**Read first**:
- `services/exercise-analytics-service.ts` (or wherever Session 1.8 landed the service - `getClientExerciseList`, `getExerciseProgressionSeries`, `getExercisePRs`).
- `types/training.ts` (`ExerciseListItem`, `ExerciseProgressionPoint`, `ExercisePR`).
- `components/client-portal/training/` (existing client-portal training components for design patterns).
- `app/client/training/page.tsx` (client training detail page - reference for page structure).
- `docs/newdesignsystem.md` (client-side visual patterns).
- `components/clients/training/exercise-data/` (coach-side Exercise Data tab from Session 1.9 - reuse the chart component if it can be extracted to a shared location, otherwise build a client-specific one matching the same Recharts patterns).
- `CONVENTIONS.md` component audience conventions (this goes in `components/client-portal/`, not `components/clients/`).

**Plan (report before implementing)**:
- API route shape. The client-facing route must use `clientApiRateLimit` + `getAuthenticatedClientId` and scope queries to the authed client. No IDOR chain needed (client reads own data).
- Component breakdown. Likely:
  - `app/client/exercise-history/page.tsx` - page shell with exercise picker.
  - `components/client-portal/exercise-history/exercise-history-view.tsx` - main view container.
  - `components/client-portal/exercise-history/pr-callout-card.tsx` - individual PR card.
- Whether the chart component from Session 1.9 can be shared (placed in `components/ui/` or a shared `components/charts/` directory) or needs a client-specific version. If the coach-side chart is audience-neutral (no coach-specific data or styling), share it. If it contains coach-specific affordances, build a simpler client version.
- Navigation entry point: how does the client reach this page? Options: (a) link from the training detail page after logging a workout ("View your Bench Press history"), (b) link from the home summary card, (c) dedicated entry in the Program page. Decide based on what feels most natural.

**Implement**:
1. **Client API route**: `GET /api/client/training/exercise-history` (new). `clientApiRateLimit` + `getAuthenticatedClientId`. Query params: `metric` (enum: `list | progression | prs`), `exerciseId` (optional), `exerciseName` (optional), `sessionCount` (optional, default 12). Calls the same service functions from Session 1.8, scoped to the authed client's ID. Returns `{ success: true, data: ... }`. `Cache-Control: no-store`.

2. **`app/client/exercise-history/page.tsx`**:
   - Exercise picker at top (search/select, same UX as coach-side but simpler styling matching client portal design language).
   - Reads optional `exerciseId` or `exerciseName` query param for deep-linking from the training detail page.

3. **`components/client-portal/exercise-history/exercise-history-view.tsx`**:
   - **Weight progression chart**: `LineChart` (Recharts). Session-count picker: 12 / 24 / All (fewer options than coach-side; clients don't need 8-session granularity). Default: 12. Date subtitle below chart showing the time span. Motivational framing: chart title "Your Progress" rather than "Top Set Weight."
   - **PR callout cards**: prominent section below the chart. Each card: exercise name context ("Bench Press"), rep count ("5 rep max"), weight with unit, date ("Dec 12"), "New PR" badge if `isRecent`. Cards are visually prominent - not a data table, not buried. If no PRs exist: "Keep logging to track your personal records."
   - **Consistency stat**: a single line below the PR cards: "You've logged [exercise name] [N] times in the last 12 weeks." Derived from the exercise list's `logCount` filtered to the last 12 weeks (or approximate from progression data point count). This is more motivating than a volume chart for most clients.
   - No metric toggle (unlike coach-side). Clients see weight progression + PRs + consistency. No e1RM, volume, RPE, or compliance views - those are coach-level analytics.

4. **`components/client-portal/exercise-history/pr-callout-card.tsx`**:
   - Single PR card component. Props: `reps`, `weight`, `weightUnit`, `date`, `isRecent`.
   - Styled prominently: large weight number, rep count label, date, optional "New PR" badge with accent color.

5. **Navigation link from training detail page**: After a client logs a workout (Session 1.5's set tracker), if any of the logged exercises have history (more than 1 prior session), show a subtle link at the bottom of the logged exercise block: "View [exercise name] history". Links to `/client/exercise-history?exerciseId=<id>` (or `exerciseName` fallback). This is a convenience link, not a primary navigation path. If implementing this touch to the training detail page exceeds 15 lines of changes, defer it to a follow-up and just ship the page with URL-based navigation.

**Do NOT**: Build the full coach-side metric toggle (Weight/e1RM/Volume/RPE/Compliance/PRs) - clients get a simplified view. Show RPE or compliance data to clients. Add this page to the bottom tab bar (it's a drill-down, not a top-level destination). Overwhelm with charts - one chart plus PR cards plus one stat is enough. Create a separate service layer - reuse Session 1.8's service functions directly.

**Tests to write**:
- API route test: 200 with `metric=list` returns exercise list scoped to authed client; 200 with `metric=progression`; 200 with `metric=prs`; 401 unauthenticated.
- `exercise-history-view.test.tsx`:
  - Weight chart renders with fixture data points.
  - Session-count picker defaults to 12; changing it refetches data.
  - Date subtitle renders correct time span.
  - PR cards render from fixture data with correct weight/reps/date.
  - "New PR" badge renders when `isRecent` is true.
  - Consistency stat renders with correct count.
  - Empty states: no exercise selected shows picker prompt; exercise with no data shows encouragement message; no PRs shows "keep logging" message.
- `pr-callout-card.test.tsx`: renders weight, reps, date; "New PR" badge present when `isRecent` true, absent when false.

**Verify**: Manual: as a client, navigate to exercise history; select an exercise; verify chart renders with correct data; verify PR cards are prominent and accurate; verify consistency stat. Test with an exercise that has no history (empty state). Test deep-link from training detail page. `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`. Commit.

---

## Session 4.1: Habits detail page

**Commit message**: `feat(client-portal): add habits detail page with per-habit toggle`

**Objective**: Build `/client/habits` using existing habit-log endpoints.

**Read first**:
- `components/daily-pulse/` (reusable habit toggle primitives).
- `app/api/client/habits/` (existing endpoints).
- `CONVENTIONS.md` component communication.

**Implement**:
- `app/client/habits/page.tsx` renders per-habit toggles for selected date.
- Writes via existing habit-log endpoint.
- Import `canEditDay` from `lib/daily-log-permissions.ts` (Session 3.1) for the `isLocked` UI state.
- Past-day lock + future-day rejection on server-side habit endpoint if not already present. If missing, add by calling `assertCanEdit` from Session 3.1 — do NOT reimplement the rule. If present, audit it against `assertCanEdit` and replace any inline date-rule logic with the shared helper.

**Do NOT**: Add new habit-log endpoints. Modify habit CRUD. Duplicate date-rule logic.

**Tests to write**:
- Habits page: one toggle per habit; toggle fires correct POST; locked and future states render notice.
- Server-side lock if added: 403 on locked/future day.

**Verify**: Toggle across days; rules honored. `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`. Commit.

---

## Session 5.1: Remove old Daily Pulse + deprecated routes + docs sweep

**Commit message**: `chore: remove legacy Daily Pulse, deprecated routes, and refresh architecture doc`

**Objective**: Delete old portal surfaces replaced by the new design and update the architecture doc to reflect the new reality. Bundled because both are cleanup against the same surface.

**Prior work (2026-04-24)**: The external-activities removal sprint (commits `37f6eaf..fadff55`) already deleted Feature A (training-plan external activities) and Feature B (daily external activities + `daily_external_activities` table) plus the `saveUnplannedActivities` network call from Daily Pulse. Daily Pulse UI still functions; this session retires it entirely. The `UnplannedActivity` / `TodaysActivity` type duplication noted in the preamble below is also already collapsed — `IntensityLevel` was relocated to `types/daily-pulse.ts` and the duplicate mock helper in `__tests__/helpers/mock-data-builders.ts` was removed. Session 5.1's scope is therefore slightly narrower than originally drafted but otherwise unchanged.

**Read first**:
- Import graph from `app/client/dashboard/page.tsx`.
- `components/daily-pulse/*`.
- `app/api/client/training/route.ts` (old flat list).
- `app/api/client/training/completions/route.ts` (old session-keyed).
- `services/client-portal-training.ts`.
- `components/clients/training/history-chart-dialog.tsx`.
- `docs/ARCHITECTURE.md` end to end.
- `docs/CLIENT-PORTAL-REDESIGN.md`.
- Grep call sites across the repo.
- **Grep email templates under `emails/` for `/client/dashboard` references.** Any email deep-linking there will 404 after deletion; update to `/client`.
- **Grep `middleware.ts`, `lib/auth-helpers.ts`, and login action code** for residual `/client/dashboard` redirects that Session 2.3 may have missed.

**Plan (report before implementing)**:
- Exhaustive delete list.
- Shared primitives to retain.
- List of deep-link updates needed before deletion.

**Implement**:
1. Update any remaining deep links found in the greps above.
2. Delete `app/client/dashboard/`, `components/daily-pulse/` (except relocated `PhaseCompletionCard`).
3. Delete `app/api/client/training/route.ts`, `app/api/client/training/completions/route.ts`.
4. Remove unused exports from `services/client-portal-training.ts`.
5. Delete `components/clients/training/history-chart-dialog.tsx`.
6. Clean imports. Remove unused types.
7. Delete `DAILY-PULSE-README.md` at the repo root (the CONVENTIONS §16 reference to it was removed in the pre-Phase-1 doc sweep; the file itself lingers).
8. Root-level doc audit moved to Session 9.10. `CHECK_IN_SETUP.md`, `CLIENT-ONBOARDING-README.md`, and `MISSED_CHECKIN_TRACKING_PLAN.md` were already deleted in 9.10 prep work; `CLIENT-APP-REFERENCE.md` and `README.md` are 9.10's scope.
9. Rewrite `docs/ARCHITECTURE.md`'s "Client Portal Architecture" section from the ground up. Until this session, that section has a banner warning readers off - this session replaces the Daily Pulse content with the event-driven day-centric architecture described in `CLIENT-PORTAL-REDESIGN.md`. Remove the "STOP - read this before using the section below" banner once the rewrite is complete. Sweep the rest of the doc for stale Daily Pulse references and update the Data Hierarchy diagram if anything changed.

**Do NOT**: Drop `upsert_daily_log_atomic()` from DB (separate schema work). Change `CONVENTIONS.md` beyond what the pre-Phase-1 doc sweep already did.

**Tests to write**: None. Remove tests for deleted code.

**Verify**: `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`. Manual smoke across client portal: login lands on `/client`, every tab works, no 404s. Read ARCHITECTURE.md end to end to confirm the rewrite is complete and no stale references remain. Commit.

---

## Session 6.1: Walkthrough copy/step update

**Commit message**: `feat(onboarding): update guided walkthrough for day-centric portal`

**Objective**: Rework `components/client/walkthrough/guided-walkthrough.tsx` for new clients.

**Read first**:
- `docs/ARCHITECTURE.md` (Client Onboarding Flow section — moved here from the deleted `CLIENT-ONBOARDING-README.md`).
- Current walkthrough.
- `docs/CLIENT-PORTAL-REDESIGN.md`.

**Implement**:
- Walkthrough steps: bottom tab bar tour, home summary, tap card to log, swipe days, program banner, settings via avatar.
- Split if over size limit (currently 266 lines).
- Client-friendly copy per CONVENTIONS.

**Do NOT**: Change walkthrough trigger logic or `walkthrough_completed_at`.

**Tests to write**:
- `guided-walkthrough.test.tsx`: each step renders expected copy; next/prev works; completion fires side effect.

**Verify**: Run as new client. `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`. Commit.

---

## Session 6.2: Check-in context, session-keyed to event-keyed

**Commit message**: `refactor(check-in): read training completion from training_events`

**Objective**: Switch check-in context from `session_logs` session-keyed counts to `training_events.status='completed'`.

**Read first**:
- `services/check-in-context-service.ts`.
- `app/api/client/check-in-context/route.ts`.
- Existing fixtures.

**Plan (report before implementing)**:
- Query changes.
- Downstream consumers.

**Implement**:
- Update `check-in-context-service.ts` to count `training_events.status='completed'` for the period.
- **Add per-event detail to the AI context**: fetch training events for the check-in period, left-join `session_logs` (via `training_events.session_log_id`). For each event, include: `sessionName`, `status` (completed/partial/skipped/not logged), and `session_log.notes` when status is skipped. Events with no session_log are "not logged" (the client never interacted with the event — treat as incomplete). Events with a session_log where `completion_quality = 'skipped'` are explicitly skipped and may have notes explaining why. The AI must be able to distinguish these so it can say e.g. "Skipped Shoulder Day (shoulder was sore). Arm Day and Back Day were not logged."
- Preserve form's response shape.

**Do NOT**: Change submission flow or AI invocation.

**Tests to write**:
- `check-in-context-service.test.ts`:
  - Completion count correct vs known fixture.
  - Zero completed returns 0.
  - Partial statuses not counted.
  - Shape preserved.
  - Per-event detail: completed event shows status + session name.
  - Per-event detail: explicitly skipped event includes notes from session_log.
  - Per-event detail: unlogged event (no session_log) shows "not logged" status.

**Verify**: Manual check-in submission. `npx vitest run`. Commit.

---

## Session 6.3: Check-in AI summary enrichment with exercise_logs (optional polish)

**Commit message**: `feat(check-in): enrich AI summary with exercise-level completion data`

**Optional**: This session is nice-to-have polish, not MOAT-load-bearing. The MOAT work is Session 6.2 (event-keyed completion counts + per-event detail). If launch timing is tight, defer 6.3 and ship without it. Auto-populated check-in already works with the event-keyed switch alone.

**Objective**: Feed `exercise_logs` into the AI prompt for richer progression insights. The per-event detail from Session 6.2 already tells the AI which sessions were completed, skipped (with notes), or not logged. This session adds the exercise-level granularity within completed/partial sessions.

**Read first**:
- `services/ai-service.ts` (check-in summary generation).
- `services/client-check-in-service.ts`.
- Current prompt template.
- Output of Session 6.2 (per-event detail shape).

**Plan (report before implementing)**:
- Which exercise-log aggregates to include.
- Prompt additions (context length budget).

**Implement**:
- Extend data fetch for `exercise_logs` within period.
- Extend prompt with compact per-exercise summary block. For completed/partial sessions, include exercise names and a **summary line per exercise** (e.g., "Bench Press — 3 sets, top 105×8 @ RPE 9"). Aggregate from `ExerciseLog.sets[]` rather than enumerating every set; per-set detail is available if a specific summary metric needs it but is too verbose for the prompt by default. For skipped sessions, the skip notes from Session 6.2's per-event detail are sufficient — no exercise-level data exists.
- Respect 25s timeout per CONVENTIONS section 11.

**Do NOT**: Swap AI providers. Do not change `ai_insights` JSONB shape.

**Tests to write**:
- `ai-service.test.ts` (or wherever summary lives):
  - Prompt includes expected per-exercise text given a fixture.
  - Timeout boundary aborts at 25s+.
  - Empty exercise_logs composes prompt gracefully.
  - Skipped session with notes: prompt includes skip reason, no exercise block.

**Verify**: Manual check-in with logged exercises; summary references them. `npx tsc --noEmit`, `npx vitest run`. Commit.

---

## Session 6.4: Daily logs as source of truth for check-in; retire check_in_session_completions

**Commit message**: `refactor(check-in): daily logs as source of truth; drop check_in_session_completions`

**Objective**: Convert the check-in form from a parallel-entry system to a daily-logs viewer with fill-in-the-gaps editing. For sections that overlap with daily logs (wellness, training completions, nutrition adherence), the form displays what was logged, locks fields for logged days, and only permits edits for days that weren't logged. Submitted edits route to the canonical per-card write endpoints, not to check-in-specific tables. Drop `check_in_session_completions` in the same session since it becomes write-dead and the app is pre-launch.

**Why this session exists**: The current check-in captures training-completion / wellness / nutrition data twice — once via the daily flow, again via the form. Coaches can see conflicting values. The redesign's broader rule is "daily logs are the spine; single source of truth per domain." This session enforces that rule for the check-in.

**What is out of scope** (stays as-is): body metrics (weight, body fat, measurements — live in the separate `body_metrics` event log), photos (storage), qualitative reflection (went well / challenges / goals — genuinely unique to the check-in). These have no daily-log equivalent.

**Prerequisites**: Session 3.1 (`lib/daily-log-permissions.ts` with `canEditDay`), Session 1.3 (training event log POST endpoint), Session 6.2 (context service reads from `training_events.status`).

**Read first**:
- `services/check-in-context-service.ts` (post-Session-6.2 state).
- `services/check-in-details-service.ts` (`getCheckInSessionCompletions`, `insertSessionCompletions` — both need to change).
- `app/api/check-in/submit/[token]/route.ts` (check-in submit writer).
- `app/api/check-in/[id]/route.ts` + `app/api/client/check-ins/[id]/route.ts` (detail-view readers — consume `getCheckInSessionCompletions`).
- `components/check-in/training-session-checklist.tsx` (the form step that collects completions).
- `components/check-in/step-subjective.tsx` and other wellness/nutrition step components.
- `types/check-in.ts` (find `CheckInSessionCompletion`, `sessionCompletions` on the `CheckIn` shape).
- `lib/daily-log-permissions.ts` (from Session 3.1 — import `canEditDay`).
- `lib/database-helpers.ts:22` (`CheckInSessionCompletionRow` type alias).
- `supabase/migrations/017_enhanced_check_in_tracking.sql` (table definition + RLS policies).
- `supabase/migrations/026_add_client_portal_rls_policies.sql` (additional policies on the table).
- `supabase/migrations/052_drop_public_insert_policies.sql` (policy drop).

**Plan (report before implementing)**:
1. Per check-in section, identify which surface is the canonical source post-redesign:
   - Wellness → `wellness_logs`.
   - Training completions → `training_events.status` (+ `session_logs`/`exercise_logs` for detail).
   - Nutrition adherence → `nutrition_logs`.
2. For each section, map out:
   - The form UI change (view vs edit per day using `canEditDay`).
   - The submit-path change (where edits for unlogged days write to).
3. Confirm that `check_in_session_completions` has **zero** remaining consumers after the form + detail-view changes. Grep one more time before the migration lands. If any consumer is missed, the migration's `DROP TABLE` fails loudly.
4. Detail view of historical check-ins (`/client/check-ins/[id]`, coach review page): after the migration, the "sessions completed" section derives from `training_events.status` for the check-in period, not from a check-in-specific table. Document how historical data (pre-migration check-in rows that referenced the now-dropped table via `check_in_id` FK) is rendered. Since pre-launch, any existing dev rows are disposable.

**Implement**:

1. **Form UI rewrite** (per overlapping section):
   - Training session checklist (`components/check-in/training-session-checklist.tsx`): load `training_events` for the check-in period; render each event with its status. For days where `canEditDay(date, loggedStatus, clientTimezone)` returns `false`, lock the row (display `training_events.status`, no controls). For days where it returns `true`, render the same inputs as the per-event log form (quick: mark complete/partial/skipped; optional notes). Unify the visual treatment with the detail-page tracker.
   - Wellness step: same pattern against `wellness_logs`.
   - Nutrition adherence step: same pattern against `nutrition_logs`.
2. **Submit path**:
   - Edits for unlogged days route through the canonical per-card endpoints built in Phase 1 and Phase 3: `POST /api/client/training/events/[eventId]/log`, `PATCH /api/client/daily-logs/[date]/wellness`, `PATCH /api/client/daily-logs/[date]/nutrition`. Do NOT invent a new check-in-scoped writer.
   - The check-in-submit writer (`app/api/check-in/submit/[token]/route.ts`) drops its calls to `insertSessionCompletions` (and any parallel-write equivalents for wellness/nutrition if they exist).
3. **Detail view**:
   - `services/check-in-details-service.ts:getCheckInSessionCompletions` is deleted. Detail-view consumers (`app/api/check-in/[id]/route.ts`, `app/api/client/check-ins/[id]/route.ts`) switch to a new read (or extend the existing context service) that returns training completion data derived from `training_events.status` + `session_logs` for the check-in period's date range.
   - The API response shape visible to the UI is preserved: both detail endpoints continue to return a `sessionCompletions` field with the same element shape, just derived. The form component's existing TypeScript type stays valid.
4. **Type cleanup**:
   - Remove the `CheckInSessionCompletionRow` type alias from `lib/database-helpers.ts` once the table is dropped.
   - Keep `CheckInSessionCompletion` in `types/check-in.ts` as the API/UI shape (it describes response data; it's no longer tied 1:1 to a DB row). Add a one-line comment noting the derivation source.
5. **Migration** (new, next sequential number after Session 7.6's `coach_client_views`):
   - `<next>_drop_check_in_session_completions.sql`:
     - `DROP TABLE IF EXISTS check_in_session_completions CASCADE;` (CASCADE removes the FK references from migrations 026/052 policy drops that target this table).
     - Verify with `\d check_in_session_completions` locally that it's gone.
   - No data preservation — pre-launch, no users, any dev-seeded rows are disposable.
6. **RLS policy file cleanup**:
   - Note in the commit message that migration 017's table creation + migrations 026/052's policy rules for this table are logically superseded. Do NOT edit prior migrations in-place (migrations are append-only per CONVENTIONS §8); the DROP TABLE handles it at runtime.

**Do NOT**:
- Add a new check-in-scoped write table. The existing per-card endpoints are the only write path.
- Rewrite the check-in form's non-overlapping sections (body metrics, photos, reflections). Those are genuinely check-in-unique.
- Preserve `check_in_session_completions` rows or backfill them anywhere. The table is pre-launch disposable.
- Touch `session_logs` or `training_events` schema. The new derivation reads existing columns.
- Skip the pre-migration grep. A missed consumer means the DROP fails and the migration gets rolled back.

**Tests to write**:
- **Service tests** (`services/check-in-context-service.test.ts` or similar):
  - Derivation function returns correct completion counts for a period with mixed logged / unlogged days.
  - Edge case: period fully unlogged returns zero completions.
  - Edge case: period fully logged returns real statuses.
- **Route tests** (for the two detail-view endpoints):
  - Response shape preserved (UI-visible `sessionCompletions` field still present, still an array of the documented type).
  - IDOR still rejected (403 when check-in belongs to another client / coach).
  - Historical-check-in read: render derived completion data, no 500.
- **Form component tests** (`training-session-checklist.test.tsx`):
  - Logged-day rows render locked with the logged status; no inputs.
  - Unlogged-day rows render editable inputs.
  - `canEditDay` is the only rule used to decide lock state (verify by injecting a stubbed return).
  - Submit of an edited unlogged day calls the per-event log endpoint (not a check-in-specific write).
- **Migration verify**: `npx tsc --noEmit` + `npx vitest run` pass after DROP; manual `SELECT 1 FROM check_in_session_completions` errors in psql.

**Verify**: `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`. Manual flow:
1. As a client, log a few days mid-week via the portal.
2. Open the check-in form; confirm the logged days show locked with correct values.
3. Fill an unlogged day via the form; submit.
4. Verify the unlogged-day edit shows up in the portal's day view (proving it wrote to the canonical table, not a parallel one).
5. As coach, open the submitted check-in; confirm the "sessions completed" section renders the derived data correctly.
6. Confirm the DB no longer has a `check_in_session_completions` table.

Commit.

---

## Session 7.1: Coach roadmap end-and-replace UI

**Commit message**: `feat(coach): add roadmap end-and-replace workflow`

**Objective**: Backend CRUD for roadmap archive + create-new already exists. Expose a coach-side workflow: "End roadmap" confirmation, archive via existing endpoint, then open `create-roadmap-dialog.tsx`.

**Read first**:
- `app/api/clients/[id]/roadmap/route.ts` (existing POST/PATCH/DELETE).
- `components/clients/roadmap/roadmap-tab-content.tsx` (where the button goes).
- `components/clients/roadmap/create-roadmap-dialog.tsx` (reuse).
- `CONVENTIONS.md` dialog structure.

**Plan (report before implementing)**:
- Whether archive is a status change (`archived`) or a DELETE. DELETE is blocked once phases have started, so a status-change archive is likely the right path. Confirm by reading the endpoint guards.
- Whether a backend change is required to support status-change archive, or whether the existing PATCH with `status: 'archived'` works.
- Confirmation copy (plain coach-facing language).

**Implement**:
- If backend change needed: update PATCH validation/guard in `app/api/clients/[id]/roadmap/route.ts` to accept `status: 'archived'` from an active roadmap.
- Coach UI: "End roadmap" button in `roadmap-tab-content.tsx` header (or three-dot menu).
- Confirmation: use the existing `AlertDialog` primitive inline in `roadmap-tab-content.tsx`. Do NOT create a new `end-roadmap-dialog.tsx` component file for a single-purpose confirmation; the `AlertDialog` shadcn primitive is designed for this.
- On confirm, archive via existing endpoint and then open `create-roadmap-dialog.tsx`.

**Do NOT**: Create a dedicated dialog component file for the confirmation. Build historical roadmap browsing (archived roadmaps are out of scope). Change phase transition flow.

**Tests to write**:
- If backend change made: update route tests (200 on archive; 403 ownership; 400 invalid status).
- Coverage of the inline confirmation flow: `roadmap-tab-content.test.tsx` (if it exists) extended with a test that confirming "End roadmap" fires the archive API and opens the create dialog. Skip if `AlertDialog`'s own behavior is already trusted and the only new logic is the click handler.

**Verify**: Manual: archive a roadmap, create a new one, confirm client-side sees the transition. `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`. Commit.

---

## Session 7.2: Coach phase edit unlock for active phases

**Commit message**: `feat(coach): allow phase edits on active phases with warning`

**Objective**: Today phase goal fields lock once `phase.status !== 'planned'`. Loosen to allow edits on `planned` and `active` phases. Completed and skipped stay read-only.

**Read first**:
- `components/clients/roadmap/edit-phase-dialog.tsx` (line 50: `goalsDisabled` check).
- `app/api/clients/[id]/roadmap/phases/[phaseId]/route.ts` (server-side `updatePhase` guard).
- `services/phase-service.ts` or wherever `updatePhase()` lives.
- `docs/ARCHITECTURE.md` "Phase goal overrides" section.

**Plan (report before implementing)**:
- Exact guard changes (status whitelist expands to `['planned', 'active']`).
- Warning copy in the dialog for active phases: goal changes may affect nutrition plan calculations; nutrition plans are not auto-recalculated.
- Tests to update.

**Implement**:
- Client: replace `goalsDisabled = phase.status !== "planned"` with `goalsDisabled = !['planned', 'active'].includes(phase.status)`.
- Client: render a subtle warning banner in the dialog when `phase.status === 'active'` and a goal field is changed.
- Server: same status whitelist change in the `updatePhase()` guard.

**Do NOT**: Auto-recalculate nutrition plans. Allow edits on completed or skipped phases. Build nutrition recalc UI (out of scope).

**Tests to write**:
- Dialog: goals editable for `planned` and `active`; disabled for `completed` and `skipped`.
- Active-phase warning banner renders when goal field changed.
- API: 200 on goal edit for active phase; 403 for completed/skipped.

**Verify**: Manual: edit an active phase's goal weight; confirm save succeeds and warning rendered. `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`. Commit.

---

## Session 7.3: Coach archived-roadmap browsing

**Commit message**: `feat(coach): add archived roadmap browsing to client roadmap tab`

**Objective**: Today coaches can archive a roadmap but cannot view archived ones afterward. Add a read-only browser on the roadmap tab that lists the client's archived roadmaps and lets the coach open any one to inspect its phases, goals, reflections, and summaries. No edit flows.

**Read first**:
- `components/clients/roadmap/roadmap-tab-content.tsx` (current active-roadmap rendering).
- `app/api/clients/[id]/roadmap/route.ts` (existing reads; confirm whether it already accepts `status` filter).
- `services/roadmap-service.ts` or equivalent (grep for where roadmap reads live).
- `docs/CLIENT-PORTAL-REDESIGN.md` (Archived-roadmap browsing section).
- `docs/ARCHITECTURE.md` (Roadmap/Phase Architecture section — phase_goals_snapshot, phase_summary, coach_reflection fields).

**Plan (report before implementing)**:
- Whether the existing read endpoint supports `?status=archived` filter. If not, either extend it or add a new list route (`GET /api/clients/[id]/roadmap/archived`).
- UI shape: collapsible "Past roadmaps" section at the bottom of the roadmap tab, versus a separate page. Collapsible section is simpler and matches the tab's existing single-scroll layout.
- Whether the archived-roadmap view reuses the active-roadmap phase-list component in read-only mode, or if it needs a new render component.

**Implement**:
- Backend: support `status=archived` on the roadmap read (or add a dedicated list route).
- `components/clients/roadmap/roadmap-tab-content.tsx`: add a "Past roadmaps" collapsible below the active roadmap's phases. Fetches archived roadmaps via SWR.
- Clicking an archived roadmap expands its phase list in the same view (or opens in a side panel / inline). Phase list is rendered via the existing phase-list component with an `isReadOnly` prop (or equivalent) so all edit affordances disappear.
- Empty state when no archived roadmaps exist.

**Do NOT**: Build unarchive ("reactivate old roadmap"). Build archived-roadmap editing. Show archived roadmaps on any non-coach surface.

**Tests to write**:
- Backend: route test for `status=archived` filter returns only archived roadmaps for the client.
- UI: archived-roadmap list renders; phase-list renders read-only with no edit buttons; empty state renders.

**Verify**: Archive a roadmap via Session 7.1 flow; then browse it from the Past roadmaps section; inspect phases, reflections, summaries. `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`. Commit.

---

## Session 7.4: Coach per-client Check-ins tab

**Commit message**: `feat(coach): add per-client Check-ins tab to client detail page`

**Objective**: Give coaches a per-client view of check-in history. Today the global queue (`/check-ins/review/page.tsx`) only shows unreviewed submissions; there is no way for a coach to browse one client's full check-in timeline. Add a **Check-ins** tab to the client detail page, positioned between **Daily Habits** and **Notes**.

**Read first**:
- `app/clients/[id]/page.tsx` (current tab structure + URL sync).
- `components/clients/client-overview-tab.tsx` and existing tab components for the file pattern.
- `app/check-ins/review/page.tsx` + its detail modal (reuse render patterns).
- `app/api/clients/[id]/check-ins/` (existing endpoint; confirm shape).
- `docs/CLIENT-PORTAL-REDESIGN.md` (Per-client Check-ins tab section).

**Plan (report before implementing)**:
- Exact tab insertion point (between Habits and Notes) and URL-param key (`?tab=check-ins`).
- Whether detail opens in a modal (matches the review page pattern) or in a read-only right-hand pane or expansion.
- Whether the AI summary + coach response are editable from this tab. Decision: NO — editing happens in the global review queue. This tab is browse-only to keep scope tight.

**Implement**:
- `components/clients/check-ins/check-ins-tab-content.tsx` (new): fetches via `/api/clients/[id]/check-ins` (SWR per CONVENTIONS coach-side pattern). Renders a list of all check-ins with status badges, dates, AI-summary preview, coach-response snippet.
- Detail view: open existing review-page detail modal (extracted to a shared component if necessary) or a new read-only detail pane.
- Update `app/clients/[id]/page.tsx` to register the new tab at the documented position.

**Do NOT**: Add editing from this tab (global review queue owns that). Duplicate the review queue's unreviewed-filter logic. Build check-in generation or resubmission.

**Tests to write**:
- `check-ins-tab-content.test.tsx`: renders list from fixture; loading / error / empty states render; detail click opens detail.
- API route test: confirm `/api/clients/[id]/check-ins` returns the expected shape and respects coach-ownership IDOR.

**Verify**: As coach, open a client with multiple check-ins; confirm tab shows all; open a detail; confirm the tab URL param persists across refresh. `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`. Commit.

---

## Session 7.5: Coach metrics page phase filter

**Commit message**: `feat(coach): add phase scope filter to client metrics page`

**Objective**: `MetricsTabContent` today filters by date range (7d/30d/90d/all) and metric category. Add phase scoping so coaches can see body-metric and wellness trends within one phase (e.g. the cut vs the bulk), on top of all-time.

**Read first**:
- `components/clients/metrics/metrics-tab-content.tsx`.
- `components/clients/metrics/hooks/use-metrics-data.ts` (or equivalent).
- `services/roadmap-service.ts` and phase-service equivalents (to fetch phases for this client).
- `docs/CLIENT-PORTAL-REDESIGN.md` (Metrics page phase filter section).
- `docs/ARCHITECTURE.md` (Roadmap/Phase Architecture — phase date fields).

**Plan (report before implementing)**:
- Filter UI: chip row or dropdown. "All time" (current default) plus "Active phase" plus one entry per past phase. Hidden when client has no roadmap.
- Where phase scope is applied: in the data hook, by constraining the query's date range to `[phase.started_at, phase.ended_at || now]`. Preserves existing date-range logic downstream.
- Interaction with the existing date-range filter (7d/30d/90d/all). Decision: the date-range filter and phase filter are mutually exclusive — selecting a phase hides (or disables) the date-range chips, because they'd compound awkwardly. Document this in the session.

**Implement**:
- Data hook accepts optional `phaseId`. When set, overrides the date range with the phase's date window.
- Filter chip/dropdown component. Phases listed in chronological order with active phase marked. Fetches phases from existing roadmap service.
- All charts (body metrics, wellness, any adherence charts on the tab) honor the phase scope.
- Empty-state handling: if a phase has no metrics in its window, show a friendly "no metrics recorded during this phase" per chart, not a broken UI.

**Do NOT**: Build phase comparison ("overlay phase 1 vs phase 2"). Fix or improve any metric calculations unrelated to scoping. Change the existing date-range chips when a roadmap doesn't exist.

**Tests to write**:
- Data hook test: when `phaseId` is passed, the fetched data is scoped to the phase's window.
- `metrics-tab-content.test.tsx`: filter renders with phases from a fixture; selecting a phase updates the chart's data prop; "no roadmap" case hides the filter.

**Verify**: As coach, open a client with multiple completed phases; switch between "All time," "Active phase," and past phases; confirm charts rescope. `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`. Commit.

---

## Session 7.6: Coach client overview tab as pre-session brief

**Commit message**: `feat(coach): restructure client overview tab into a pre-session brief`

**Objective**: Turn the client detail page's Overview tab from a metrics dashboard into a "brief me on this client right now" surface. When a coach opens a client, the first thing they see should answer: what's changed since I last looked, and what's waiting on me? Existing metrics and wellness strip drop below this framing rather than leading.

**Read first**:
- `components/clients/client-overview-tab.tsx` (current overview implementation).
- `app/clients/[id]/page.tsx` (tab structure).
- `components/dashboard/needs-attention-feed.tsx` and `services/attention-feed-service.ts` (existing attention-feed data; need to scope to one client here).
- `app/api/clients/[id]/check-ins/` (to count unreviewed check-ins for this client).
- `services/training-event-service.ts`, `services/nutrition-event-service.ts`, `daily_logs_full` view (for "since last visit" deltas).
- `docs/CLIENT-PORTAL-REDESIGN.md` — confirm the brief's sections match the redesign intent if documented there.

**Plan (report before implementing)**:
- How "last viewed" is tracked per coach-client pair. Recommended: new tiny table `coach_client_views` with `(coach_id, client_id, last_viewed_at)`, upserted when the coach opens the tab. Alternative: use session storage (loses across devices) — not recommended.
- What "since last visit" surfaces count as: new logs (any child of `daily_logs`), new check-ins, new `exercise_logs` rows, new `body_metrics` rows, new `training_events.status` changes. Keep the list tight; don't include every timestamp update.
- What "waiting on you" scopes per-client: unreviewed check-in (if one exists) + attention-feed items filtered to this client.
- Zero-state copy for each section.
- Whether to defer the `coach_client_views` upsert to the session load or the first meaningful paint. Load is simpler.

**Implement**:
1. **Migration**: `<next>_add_coach_client_views.sql`. Table with `coach_id` FK, `client_id` FK, `last_viewed_at` TIMESTAMPTZ, unique on `(coach_id, client_id)`. No `created_at` needed.
2. **Service**: `services/coach-view-service.ts` with `getLastViewedAt(coachId, clientId)` and `upsertLastViewed(coachId, clientId)`. Returns null when no prior view (treat "since last visit" as "ever" in that case).
3. **Brief data aggregator**: extend `services/client-overview-service.ts` (or equivalent — grep for where overview tab data comes from) with `getOverviewBrief(coachId, clientId)` returning `{ lastViewedAt, waitingOnYou: { unreviewedCheckIn, attentionFeedItems }, sinceLastVisit: { newLogs, newCheckIns, newExerciseLogs, newBodyMetrics, eventStatusChanges }, currentContext: { phase, weekInPhase, currentWeekGoal, phaseGoalProgress } }`. Compose from existing domain services; don't re-query tables directly.
4. **Route**: extend the existing overview endpoint or add `GET /api/clients/[id]/overview-brief`. On GET, also upsert `last_viewed_at`.
5. **UI**: restructure `client-overview-tab.tsx`:
   - Top: "Waiting on you" — unreviewed check-in link + attention-feed item list. Zero-state: "You're caught up on [client name]."
   - Middle: "Since your last visit" — compact list of new events with timestamps. Zero-state: "Nothing new since [timestamp]."
   - Below: "Current context" — phase name, week-in-phase, phase-goal progress indicator (simple: trajectory vs target, or just the snapshotted goal with current value).
   - Bottom: existing quick metrics + 28-day wellness strip (preserved, just demoted in visual hierarchy).

**Do NOT**: Rebuild the wellness strip. Add predictive insights or trend interpretation (defer). Surface attention-feed items for OTHER clients — this view is scoped to one client.

**Tests to write**:
- Service test: `getOverviewBrief` returns correct aggregates for fixtures (first visit, repeat visit with new events, repeat visit with nothing new, no roadmap).
- Route test: 200 happy; 403 IDOR; confirms `last_viewed_at` is updated after a GET.
- UI tests: waiting-on-you section shows check-in + attention items when present, zero-state when empty; since-last-visit respects first-visit case; current context hides phase section when no roadmap.

**Verify**: As coach, open a client with pending check-in + recent logs; confirm the brief renders correctly. Refresh; confirm "since your last visit" narrows since the upsert ran. Open a client with nothing pending; confirm zero-states render cleanly. `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`. Commit.

---

## Session 7.7: Coach exercise progression charts on Metrics tab

**Commit message**: `feat(coach): add exercise progression charts to client metrics tab`

**Objective**: Expose the `exercise_logs` data (written starting in Session 1.5) as longitudinal charts on the Metrics tab. Top-set weight × date per exercise is the primary lens; optional volume chart as a secondary view. Honors the phase filter from Session 7.5 automatically.

**Shared data layer (Session 1.8)**: The analytics service functions (`getClientExerciseList`, `getExerciseProgressionSeries`, `getExercisePRs`) and the API route (`GET /api/clients/[id]/training/exercise-history`) were built in Session 1.8. This session reuses them - do NOT rebuild analytics queries. The `phaseId` filter param was designed to support this use case. If Session 1.8's service functions need a `phaseId` parameter that was not included, extend them here rather than duplicating. The chart components from Session 1.9 (`exercise-trend-chart.tsx`) may also be reusable if they were built audience-neutral.

**Read first**:
- `services/exercise-analytics-service.ts` (Session 1.8 - the shared data layer; confirm it supports `phaseId` filtering).
- `components/clients/training/exercise-data/` (Session 1.9 - chart components to potentially reuse).
- `components/clients/metrics/metrics-tab-content.tsx` (after Session 7.5's phase filter is in place).
- `components/clients/metrics/hooks/use-metrics-data.ts` (reference for the data hook pattern).
- `supabase/migrations/090_normalize_set_logs.sql` (per-set actuals via `set_logs`; `exercise_logs.exercise_id` global catalog FK; `exercise_logs.performed_name` canonical display name).
- `services/training-log-service.ts` — note `attachSetLogs` populates `ExerciseLog.sets[]` on reads; analytics queries can join `set_logs` directly for aggregation.
- `docs/ARCHITECTURE.md` "Training Completion Hierarchy" section.

**Plan (report before implementing)**:
- How exercises are identified across time. Preferred: group by `exercise_logs.exercise_id` (catalog FK; populated for prescribed exercises via `training_exercises.exercise_id` resolver, and for picker-selected unplanned/swapped via the post-1.5 follow-up). Fallback for legacy rows where the FK is null: group by `LOWER(exercise_logs.performed_name)`. `performed_name` is the canonical display name (matches the snapshot for non-swapped, differs for swaps). Document the exact grouping rule.
- Which exercises to chart. Recommendation: the client's N most-logged exercises (N=5-8) plus a dropdown/search to add any other logged exercise. Don't chart every exercise by default — visual noise.
- Chart primary metric: top-set weight per session, computed as `MAX(set_logs.weight)` across the exercise's set_logs in that session. Secondary: total volume per session, `SUM(set_logs.reps * set_logs.weight)` joined to `exercise_logs` for the session/exercise scope. Optional tertiary: average intensity per session, `AVG(set_logs.rpe)` ignoring nulls. Expose a toggle.
- Phase filter behavior: when a phase is selected in the Metrics tab (Session 7.5), all exercise progression charts scope to that phase's date range automatically. When "All time" is selected, full history.
- Empty states: no `exercise_logs` for any exercise in range; fewer than 2 data points for an exercise (chart would be a single dot — show "not enough data yet").

**Implement**:
1. **Service**: reuse Session 1.8's `getClientExerciseList` and `getExerciseProgressionSeries` from `services/exercise-analytics-service.ts`. If these functions do not yet accept a `phaseId` parameter, extend them here (add optional `phaseId` that constrains `session_logs.completed_at` to the phase's date range via a join to `phases`). Do NOT create duplicate query functions.
2. **Read route**: reuse Session 1.8's `GET /api/clients/[id]/training/exercise-history` endpoint. If it does not yet accept a `phaseId` query param, extend it here. Do NOT create a separate `/api/clients/[id]/training/progression` route.
3. **UI section** on Metrics tab: new "Exercise progression" section. Renders the N most-logged exercises (N=5-8) as small multiples (one chart each) by default. Toggle between "Top set", "Volume", and (optional) "Intensity (RPE)" views. Empty states per chart when data is thin. Phase filter from Session 7.5 is read from the same context/state as body metrics + wellness charts.
4. **Chart components**: reuse the `exercise-trend-chart.tsx` from Session 1.9 if it was built audience-neutral. If it contains Exercise Data tab-specific affordances, extract the pure chart renderer into a shared component under `components/clients/training/exercise-data/` and import from both surfaces. Do NOT introduce a new charting library.

**Do NOT**: Rebuild analytics query functions that already exist in Session 1.8's service. Add prescribed-vs-actual comparison here (that belongs to the session-log-detail dialog from Session 1.6). Add predicted-next-session weight or stall detection (deferred attention-feed territory). Introduce a new charting library. Chart every exercise by default - cap at N most-logged. Use the dropped `actual_*` scalar columns - they're gone post-090. Create a new API route if Session 1.8's route already supports the needed params.

**Tests to write**:
- Service tests (only if extending Session 1.8's functions): `phaseId` param constrains results to the phase date range; null `phaseId` returns all-time data.
- Route test (only if extending Session 1.8's route): `phaseId` param accepted and passed through; existing tests still pass.
- UI test: charts render for fixture data; toggle between top-set and volume works; empty state renders when no data; phase-filter change rescopes charts.

**Verify**: As coach, open a client with logged exercise data across multiple phases; switch phase filter; confirm charts rescope. Switch top-set/volume toggle. Check empty-state rendering. `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`. Commit.

---

## Session 8.1: Coach unit preference column + viewer-resolver foundation

**Commit message**: `feat(units): add coaches.unit_preference and viewer-relative unit helpers`

**Objective**: Lay the schema + helper foundation for viewer-relative unit display. Adds `coaches.unit_preference`, the `getViewerUnitPreference(request)` resolver, and the consolidated `formatWeight(value, valueUnit, viewerPreference)` + `formatLength(value, valueUnit, viewerPreference)` helpers. **No existing render paths change yet** — that is Session 8.2.

**Read first**:
- `docs/CLIENT-PORTAL-REDESIGN.md` (Viewer-relative unit display section — the architecture spec).
- `supabase/migrations/011_add_nutrition_fields.sql` (`clients.unit_preference` definition; mirror its shape on `coaches`).
- `utils/nutrition-helpers.ts` (existing partial `formatWeight`, `kgToLbs`, `lbsToKg` — to be consolidated, not deleted).
- `lib/auth-helpers.ts` (`getAuthenticatedCoachId`, `getAuthenticatedClientId`).
- `services/coach-service.ts` (or grep for where coach reads live).
- `services/client-service.ts` (`unit_preference` read pattern for clients).
- `lib/mappers.ts` (existing `mapClientRow.unitPreference` mapping; locate or add the equivalent for `Coach`).
- `types/coach.ts` (or wherever the `Coach` TS type lives).

**Plan (report before implementing)**:
- Migration shape for `coaches.unit_preference`. Default `'imperial'` for parity with `clients.unit_preference`. Same enum.
- Where `getViewerUnitPreference` lives. Recommend new file `lib/viewer-preferences.ts` rather than co-locating in `lib/auth-helpers.ts` (auth-helpers is already large; the concern is distinct).
- Where `formatWeight` ultimately lives. Today partial logic is in `utils/nutrition-helpers.ts`. Recommend new `utils/unit-conversions.ts` so it is not nutrition-coupled. The nutrition-helpers version becomes a thin re-export until Session 8.2 sweeps callers.
- Confirm the helper signatures return `{ value, unit }` objects (not pre-formatted strings). Callers handle their own number formatting (decimal places, locale).
- `formatLength` companion: same shape (`(value, valueUnit, viewerPreference) → { value, unit }`). Same conversion utilities.
- Whether `Coach` has an existing TS type that needs `unitPreference` added. If not, decide where it lands.

**Implement**:
1. **Migration** (next sequential number, e.g. `091_add_coach_unit_preference.sql` — bump if other migrations have landed):
   ```sql
   ALTER TABLE coaches ADD COLUMN unit_preference TEXT NOT NULL DEFAULT 'imperial' CHECK (unit_preference IN ('metric', 'imperial'));
   COMMENT ON COLUMN coaches.unit_preference IS 'Coach display preference: metric (kg, cm) or imperial (lbs, in). Used by getViewerUnitPreference() to render weights and measurements in the coach''s unit when viewing client data.';
   ```
2. Apply via `npx supabase db push`; regenerate `types/database.ts`; commit migration + types in the same commit per CONVENTIONS §8.
3. Update the `Coach` TS type to include `unitPreference: 'metric' | 'imperial'`.
4. Update the coach mapper (or `lib/mappers.ts`) to map `row.unit_preference` → `unitPreference`.
5. New `lib/viewer-preferences.ts`:
   - `getViewerUnitPreference(request: NextRequest): Promise<'metric' | 'imperial'>` — resolves the authed principal via existing helpers, returns their preference, defaults to `'imperial'` for unauthed.
6. New `utils/unit-conversions.ts`:
   - `formatWeight(value: number, valueUnit: 'lbs' | 'kg', viewerPreference: 'metric' | 'imperial'): { value: number; unit: 'lbs' | 'kg' }`.
   - `formatLength(value: number, valueUnit: 'in' | 'cm', viewerPreference: 'metric' | 'imperial'): { value: number; unit: 'in' | 'cm' }`.
   - Move `kgToLbs`, `lbsToKg`, `inToCm`, `cmToIn` here as the canonical home.
7. `utils/nutrition-helpers.ts`: thin re-export shim pointing at `utils/unit-conversions.ts`. Existing exports continue to work; Session 8.2 sweeps callers.

**Do NOT**: Change any render path (Session 8.2). Add UI toggles (Session 8.3). Convert existing `weight_unit` columns to canonical kg storage. Touch nutrition-flow display rendering — it keeps working through the re-export.

**Tests to write**:
- `utils/unit-conversions.test.ts`:
  - `formatWeight`: identity (lbs + imperial → same lbs), conversion (lbs + metric → kg with correct rounding), reverse cases (kg + imperial → lbs), boundary inputs (0, fractional, integer).
  - `formatLength`: same shape across in/cm.
- `lib/viewer-preferences.test.ts`:
  - Coach-authed request returns `coach.unit_preference`.
  - Client-authed request returns `client.unit_preference`.
  - Unauthed returns `'imperial'`.

**Verify**: `npx tsc --noEmit`, `npx vitest run`. Confirm migration applied via `npx supabase migration list --linked`. Commit.

---

## Session 8.2: Render-path sweep for viewer-relative weight display

**Commit message**: `refactor(units): route weight rendering through formatWeight with viewer preference`

**Objective**: Sweep every place that today renders a weight value via `${value} ${weight_unit || "lbs"}` (or equivalent) and route it through `formatWeight()` from Session 8.1, using the viewer's preference. Convert at the API boundary where possible — keeps components dumb.

**Read first**:
- Output of Session 8.1.
- Grep `weight_unit\|weightUnit` across `app/`, `components/`, `utils/`, `services/` (excluding any legacy files already deleted). Build the punch list.
- `docs/CLIENT-PORTAL-REDESIGN.md` (Render rule + Viewer resolver subsections).

**Plan (report before implementing)**:
- Punch list of every render path. Group into:
  - **Convert at API**: routes that return weight values in response payloads. The route resolves viewer preference, calls `formatWeight()`, returns the converted value + unit. Component just renders.
  - **Convert in component**: places where the component fetches its own data via SWR. Use a `useViewerPreference()` hook against `/api/me/unit-preference`; component calls `formatWeight()` directly.
- Decide which approach for which surface. Rule: if the API endpoint is coach-or-client scoped (different viewers possible), convert at API. If a component takes weight from props after a parent fetch, the parent (or its API source) converts.
- Identify any history/audit views that should *intentionally* render the recorded unit verbatim (e.g. "client logged 180 lbs" timeline entries). Annotate with an inline comment explaining why they bypass `formatWeight()`.

**Implement**:
1. Add `GET /api/me/unit-preference` route: returns `{ preference: 'metric' | 'imperial' }` for the authed principal. Standard auth + rate limit, `Cache-Control: no-store`.
2. Add `hooks/use-viewer-preference.ts`: SWR-backed hook with deduping, returns `{ preference, isLoading }`.
3. Sweep render paths (estimate ~15 callsites):
   - Coach-side: `components/clients/metrics/body-metrics-history-table.tsx`, `components/clients/metrics/hooks/use-metrics-data.ts`, coach review pages, dashboard cards, `app/api/clients/[id]/training/suggestions/route.ts`.
   - Client-side: `app/client/check-in/page.tsx`, `app/client/progress/check-in/[id]/page.tsx`, `app/client/progress/page.tsx`, client portal home + detail surfaces from Phase 3.
   - Cross-cut: `utils/ai-prompt-builder.ts` (renders weights into AI prompts surfaced to coaches; convert to coach unit before prompting).
4. For API-boundary conversions: each touched route resolves viewer preference once, applies `formatWeight()` to every weight in the response.
5. For component-boundary conversions: replace `${value} ${unit || "lbs"}` with `formatWeight(value, unit, viewerPref)` then render `{value} {unit}`.
6. Update API response types where the converted shape changes (e.g. `weight: number, weightUnit: string` → `weight: { value: number, unit: string }`). Adjust consuming components accordingly.

**Do NOT**: Touch settings UIs (Session 8.3). Change forms / write paths (Session 8.3). Migrate stored values to canonical kg. Skip the audit-view annotation — those need an inline comment explaining the bypass.

**Tests to write**:
- API route tests for each touched endpoint: response includes the value converted to the viewer's preference. Test with both coach-imperial-against-metric-client and coach-metric-against-imperial-client fixtures.
- Component tests for each touched surface: renders correctly when given raw weight + viewer preference. One assertion per preference.
- Hook test (`use-viewer-preference.test.tsx`): returns coach preference for coach-authed, client preference for client-authed, default for unauthed.

**Verify**: Manual cross-check: log in as coach (imperial) and view a metric client's weight history; confirm rendered as lbs. Switch coach to metric; confirm same data renders as kg. Repeat in reverse with a client viewing their own data. `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`. Commit.

---

## Session 8.3: Coach + client unit preference settings + form write paths

**Commit message**: `feat(settings): add coach and client unit preference toggles with form-aware write paths`

**Objective**: Ship the user-facing controls for unit preference on both coach and client settings, and update forms that capture weights to write in the viewer's unit (preserves the per-record audit trail).

**Read first**:
- Output of Sessions 8.1 + 8.2.
- `app/client/settings/page.tsx` (from Session 2.6 — existing client settings).
- `app/coach/settings/page.tsx` (or grep for current coach settings entrypoint; if none exists, decide where to land).
- `lib/validations/client.ts` (`updateSettingsSchema` from Session 2.6).
- `services/client-service.ts:updateClientSettings` (from Session 2.6).
- All weight-input forms: `components/clients/add-client-manual-form.tsx`, `app/client/check-in/page.tsx`, intake flows (`components/client/onboarding/intake-step-*.tsx`), `components/clients/metrics/...`.

**Plan (report before implementing)**:
- Whether to extend Session 2.6's existing client toggle to also drive `weight_unit` in sync (recommended: yes — they are effectively the same control from the user's perspective). Audit Session 2.6's write path.
- Where coach settings live. If `app/coach/settings/page.tsx` does not exist, decide: add a minimal one with just the unit toggle, or fold the toggle into an existing coach profile page.
- Form write-path sweep: for each form that captures a weight (intake step 1, manual add client, check-in submission, metrics edit dialog), update the write path to:
  - Show input label in the viewer's preferred unit.
  - On submit, send `{ value, weight_unit: viewerPreference === 'imperial' ? 'lbs' : 'kg' }`.
  - Store as-entered (no conversion on the API).
- Document the coach-edits-client-record case: form pre-fills via `formatWeight()` in coach unit; on save, record's `weight_unit` updates to coach's unit.

**Implement**:
1. **Coach settings**:
   - If `app/coach/settings/page.tsx` does not exist, add a minimal one with the unit toggle (and any existing coach preferences if surfaced elsewhere). Otherwise extend the existing page.
   - `PATCH /api/coach/settings`: mirror of `/api/client/settings`. Standard middleware (rate limit, CSRF, auth, validation). Writes `coaches.unit_preference`.
   - `services/coach-service.ts:updateCoachSettings(coachId, updates)`.
2. **Client settings cleanup**:
   - Update Session 2.6's toggle to write both `unit_preference` AND `weight_unit` in sync (imperial → 'lbs', metric → 'kg'). The toggle is logically one control even though it touches two columns.
3. **Form write paths**:
   - Intake step 1 (weight + height): inputs labeled in viewer's preference.
   - Add-client manual form: same.
   - Check-in submission form: weight input labeled in client's preference; submit sends value + `weight_unit`.
   - Metrics edit dialog (coach-side): labeled in coach's preference; submit sends value + the coach's `weight_unit` equivalent.
4. **Coach-on-client edits**: form pre-fills via `formatWeight()` (coach sees their unit); on save the record's `weight_unit` updates to the coach's preference. Add a small inline UI hint when the coach's unit differs from the client's: "Saving will record this entry in your unit (kg/lbs)."

**Do NOT**: Build a per-record unit override for cross-edits (e.g. tickbox to force one client's records into a specific unit). YAGNI. Convert historical records to canonical units. Migrate per-record `weight_unit` columns.

**Tests to write**:
- Coach settings page test: renders existing preference; toggle save submits correct payload; error toast on save rejection.
- Coach settings API: 200 happy; 400 invalid enum; 401 unauthenticated; CSRF rejection.
- Client settings (extending Session 2.6's tests): toggling Imperial / Metric writes both `unit_preference` AND `weight_unit` consistently.
- Form write-path tests per touched form: serializes weight + viewer's `weight_unit` correctly on submit; pre-fill respects viewer preference for cross-unit-original records.

**Verify**: Manual end-to-end:
1. As a coach in metric, edit a client's weight via the coach view; confirm new record stores `weight_unit='kg'`.
2. As that client in imperial, view the same record; confirm it renders converted to lbs.
3. Same in reverse (coach imperial editing a metric client's record).
4. Toggle coach unit preference; confirm dashboard rosters re-render in the new unit.
`npx tsc --noEmit`, `npx eslint .`, `npx vitest run`. Commit.

---

# Phase 9: Pre-launch hardening (MUST DO before production / mobile)

These sessions are not part of the client portal redesign itself but are blockers identified during the pre-Phase-1 audit. None block resuming the redesign work, but **all must complete before pushing to production**, and a subset (9.5–9.8) must complete before the iOS/Android build begins.

Sessions 9.1–9.4 are prod blockers. Sessions 9.5–9.8 are mobile blockers. Session 9.9 is hygiene.

---

## Session 9.1: Document required environment variables in .env.example

**Commit message**: `docs(env): add .env.example with all required environment variables`

**Objective**: CONVENTIONS §15 mandates `.env.example` documenting every required environment variable. The file does not exist; only `.env.local` does. New environments (CI, mobile-team dev machines, post-launch hires) cannot boot without reverse-engineering env-var usage from code.

**Read first**:
- `CONVENTIONS.md` §15 and §19.
- `.env.local` (do NOT commit; just reference for the variable list).
- Grep `process.env\.` across the repo to enumerate every env var actually consumed in code.
- `next.config.mjs` for any build-time env vars.
- `sentry.client.config.ts` and `sentry.server.config.ts` for Sentry vars.

**Plan (report before implementing)**:
- The full list of env vars consumed by the codebase, grouped by service (Supabase, OpenAI, Resend, Sentry, Upstash Redis, app URL, optional Svix).
- For each, a one-line description of what it is and whether it's required or optional in dev.
- Whether to keep secret values out (yes — `.env.example` is committed, so it must contain placeholders only).
- Whether the file lives at repo root (yes, conventional location).

**Implement**:
- Create `.env.example` at repo root.
- Group variables by service with section comments.
- Use placeholder values (`your-supabase-url-here`, `sk-...`, etc.) — never real secrets.
- Add a top-of-file comment pointing readers at `CONVENTIONS.md` §15 and noting that `.env.local` is the active file (gitignored).

**Do NOT**: Commit any real secret values. Add tooling to validate the env file (out of scope; can be a separate session if desired). Touch `.gitignore` (it already excludes `.env*` except `.env.example` if listed correctly — verify but do not change unless misconfigured).

**Tests to write**: None. Doc-only change.

**Verify**: `npx tsc --noEmit`, `npx eslint .`, `npx vitest run` (no behavioral change so all pass). Manual: confirm every `process.env.X` reference in code has a corresponding entry in `.env.example`. Commit.

---

## Session 9.2: Auth callback rate limit + magic-link onboarding fix

**Commit message**: `fix(auth): rate-limit OAuth callback and gate magic-link onboarding correctly`

**Objective**: Two unrelated auth bugs flagged in `TECHNICAL-DEBT.md` (Auth P0 #4 and P2 #13). Bundling because both touch auth flows and are small.

**Read first**:
- `app/auth/callback/route.ts` (OAuth callback handler).
- `lib/rate-limit.ts` (`authRateLimit` definition).
- The magic-link entrypoint (grep for `user_metadata?.password_set` or `needsOnboarding`).
- `TECHNICAL-DEBT.md` Auth P0 #4 and P2 #13 entries.

**Plan (report before implementing)**:
- Where the auth callback runs and which rate-limit tier applies (`authRateLimit` matches the surrounding auth routes' tier).
- Where `password_set` should actually be written and read. The current check `!user.user_metadata?.password_set` is always true because nothing writes that key. Decide: write it on password creation, or replace the check with a different signal (e.g. an `onboarding_status` column on `clients`, or `walkthrough_completed_at`).
- Whether the fix is a metadata write or a check-side change. Prefer the simpler one.

**Implement**:
- Add `authRateLimit(request)` as the first check in `app/auth/callback/route.ts`. Match the pattern from `app/api/auth/login/route.ts` or similar.
- Fix the magic-link onboarding gate per the planning decision. If writing metadata: add `await supabase.auth.updateUser({ data: { password_set: true } })` at password-creation time. If replacing the check: switch to `clients.onboarding_status === 'active'` or equivalent.

**Do NOT**: Refactor `app/auth/callback/route.ts` beyond adding the rate limit. Restructure the onboarding flow. Add new metadata fields beyond what's needed.

**Tests to write**:
- Auth callback route test: 200 happy path; 429 when rate limit exceeded.
- Magic-link onboarding test: previously-onboarded user does not see onboarding; new user does. (If the test infra makes this hard, manual verification with two test accounts.)

**Verify**: `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`. Manual: trigger the OAuth callback rapidly; verify rate limit. Sign in via magic link with a previously-onboarded test client; verify no onboarding redirect. Mark TECHNICAL-DEBT.md entries Auth P0 #4 and P2 #13 as Resolved. Commit.

---

## Session 9.3: Sentry capture on fire-and-forget background tasks

**Commit message**: `fix(observability): wire captureApiError into fire-and-forget background tasks`

**Objective**: TECHNICAL-DEBT.md Production Readiness P1 #1 — `markReminderAsResponded()`, `triggerAISummaryGeneration()`, and similar fire-and-forget tasks log only to `console.error()`. Production failures are invisible. Wire `captureApiError()` into every background-task error path.

**Read first**:
- `lib/error-handler.ts` (`captureApiError` signature and usage).
- `services/reminder-service.ts:markReminderAsResponded`.
- `services/client-check-in-service.ts:triggerAISummaryGeneration` (or wherever it lives).
- Grep for `.catch(console.error)` and `void <somePromise>()` patterns across `app/api/`, `services/`, `lib/`.
- `TECHNICAL-DEBT.md` Production Readiness P1 #1.

**Plan (report before implementing)**:
- The exhaustive list of fire-and-forget background tasks. Each is either a `.catch(console.error)` chain or a `void` fire-and-forget after a `Promise.resolve()`.
- For each, decide the `captureApiError` context (route name, operation, key identifiers).

**Implement**:
- For each background task, replace bare `.catch(console.error)` with `.catch((err) => captureApiError(err, { operation: '...', ... }))`.
- Where errors are logged via `console.error` inside async IIFEs, add a sibling `captureApiError` call.
- Keep the `console.error` call too — it's still useful for local development and stdout observability.

**Do NOT**: Restructure the background task invocation. Add retry logic (out of scope; tracked separately as P1 #2). Change AI summary or reminder logic.

**Tests to write**:
- Service test extending the existing reminder-service / check-in-service tests: when the background task throws, `captureApiError` is called with the expected context. Mock the error-handler module.

**Verify**: `npx tsc --noEmit`, `npx vitest run`. Mark TECHNICAL-DEBT.md Production Readiness P1 #1 as Resolved. Commit.

---

## Session 9.4: Resolve real ESLint bugs (await-thenable, misused-promise)

**Commit message**: `fix(lint): resolve await-thenable and misused-promise errors`

**Objective**: Three of the 29 baseline ESLint errors are bug-flavoured (the other 26 are stylistic): two `@typescript-eslint/await-thenable` in `services/schedule-data-service.ts:109,186` and one `@typescript-eslint/no-misused-promises`. Investigate each, confirm whether it's a real bug, fix it.

**Read first**:
- Output of `npx eslint . | grep -E "error.*await-thenable|error.*no-misused-promises"` to locate the misused-promise.
- The flagged sites in `services/schedule-data-service.ts`.
- Any unit tests for the affected functions.

**Plan (report before implementing)**:
- For each error, determine: is it a real bug (data not awaited correctly, function misused), or a false positive (e.g. `Promise.all` over a sync iterable that is fine)?
- If real bug: the fix.
- If false positive: confirm and add an `eslint-disable-next-line` comment with a one-line justification. (Prefer fixing over suppressing whenever possible.)

**Implement**:
- Apply the fix per case. Likely `await Promise.all([...])` becomes `Promise.all([...])` (no await) for sync iterables, or vice versa for misuse cases.
- For misused-promises (typically passing async functions where sync are expected), wrap in an IIFE or use `void promise()`.

**Do NOT**: Touch the 26 stylistic errors (`no-unnecessary-type-assertion`, `prefer-const`) in this session. Refactor the surrounding logic. Bump the ESLint baseline to zero (out of scope; do that as the final pre-prod sweep).

**Tests to write**: Where a real bug is fixed, add a regression test if the function has unit-test coverage. Otherwise, none.

**Verify**: `npx eslint . 2>&1 | grep error` shows 26 errors (down from 29). `npx tsc --noEmit`, `npx vitest run`. Commit.

---

## Session 9.5: Coach API response shape consistency sweep

**Commit message**: `refactor(api): standardize coach API responses on { success, data, error? }`

**Objective**: CONVENTIONS §10 mandates `{ success: bool, data: {}, error?: string }` for every API response. Coach-side routes are inconsistent: many return raw fields like `{ clients, total }` (verified at `app/api/clients/route.ts:23`) or just `{ error: "..." }` on failure. Mobile apps cannot share a single response parser across coach and client surfaces. Mobile-launch blocker.

**Read first**:
- `CONVENTIONS.md` §10.
- `app/api/clients/route.ts` (canonical example of the drift).
- Grep across `app/api/` for `NextResponse.json({` to enumerate every response shape.
- Existing client-portal routes for the canonical pattern.

**Plan (report before implementing)**:
- Punch list of routes that return the wrong shape, grouped by:
  - **Group A**: Coach-side routes returning raw fields (`{ clients, total }`, `{ phases, ... }`, etc.). Wrap in `{ success: true, data: { clients, total } }`.
  - **Group B**: Routes returning `{ error: "..." }` on failure without `success: false`. Add `success: false`.
- Check every consumer of these endpoints for the response-shape change. SWR fetchers, `swrFetcher`, useEffect/useState patterns, route tests.
- Decide migration approach: switch all routes at once and update consumers in the same commit (recommended; one commit, atomic), or ship a compatibility layer first.

**Implement**:
- For every flagged route, wrap the response in `{ success: true, data: ... }` (success path) or `{ success: false, error: ... }` (failure path).
- Update consumers: SWR fetchers expecting raw fields now read `.data`. Update tests accordingly.
- Update `lib/swr-fetcher.ts` if the shape change requires it (likely no; it's already shape-agnostic).

**Do NOT**: Change route paths. Add new fields. Rename existing fields. Touch error message text. Modify response status codes.

**Tests to write**:
- Update existing route tests to assert the new shape. Each affected route should have a 200 happy-path test.
- Component tests that exercise the response-consuming code path stay valid (the data object should be unchanged, just nested under `data`).

**Verify**: `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`. Manual: load the coach dashboard, client list, roadmap tab — confirm every page still renders. Commit.

---

## Session 9.6: Cache-Control: no-store sweep on coach GET routes

**Commit message**: `fix(api): apply Cache-Control no-store to coach-side GET routes`

**Objective**: CONVENTIONS §7 says "Client-facing GET API routes should return `Cache-Control: no-store` headers." Coach-side GETs are inconsistent — verified `/api/clients` GET and `/api/client/me` lack the header while `/api/dashboard/attention-feed` and `/api/client/weekly-nutrition` have it. Mobile clients (and proxy CDNs) cache more aggressively than browsers; missing headers means stale rosters, stale profiles.

**Read first**:
- `CONVENTIONS.md` §7.
- Existing routes that DO set `Cache-Control: no-store` for the canonical pattern.
- Grep `NextResponse.json` across `app/api/` to find GET routes; cross-reference against ones that already set the header.

**Plan (report before implementing)**:
- The list of GET routes missing `Cache-Control: no-store`. Estimate ~15 routes (mostly coach-side).
- Whether to apply uniformly to every GET, or only to ones returning user-specific data. Recommend uniformly — caching of public data is rare in this codebase, and uniform is easier to maintain.
- Whether to extract a helper (`jsonNoStore(data, options)`) or just add the header inline. Inline is fine for ~15 callsites.

**Implement**:
- For each flagged GET route, add `headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' }` to the `NextResponse.json` options.
- Match the existing pattern from `app/api/dashboard/attention-feed/route.ts` or wherever it's already done.

**Do NOT**: Apply to mutating routes (POST/PUT/etc. — different concern). Touch any response body. Add `s-maxage` or other CDN-specific directives without a use case.

**Tests to write**:
- Spot-check route tests assert the `Cache-Control` header is present in successful responses. One per route is overkill; add to a few representative routes.

**Verify**: `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`. Manual: open Network tab, hit a coach-side GET, confirm header. Commit.

---

## Session 9.7: Bearer token auth path for native clients

**Commit message**: `feat(auth): support Authorization bearer header alongside cookie session`

**Objective**: Native iOS/Android apps work better with bearer tokens than with cookies. Today `lib/auth-helpers.ts` reads JWT only from Supabase session cookies. Add a parallel `Authorization: Bearer <jwt>` path so mobile can authenticate without reverse-engineering cookie behaviour.

**Decision required before this session**: Is mobile using bearer tokens, or accepting a cookie-jar approach? This session assumes bearer. If you choose cookie-jar, this session can be skipped.

**Read first**:
- `lib/auth-helpers.ts:getAuthenticatedClientId`, `getAuthenticatedCoachId`.
- `lib/require-client-auth.ts` (auth chain helper).
- `lib/csrf-protection.ts` (CSRF policy — bearer-token auth typically bypasses CSRF since there's no ambient credential).
- Supabase auth docs for `supabase.auth.setSession()` / verifying a JWT manually.

**Plan (report before implementing)**:
- The order: try bearer first, fall back to cookie. Or try cookie first, fall back to bearer. Recommend bearer-first because it's the explicit signal.
- CSRF behavior: when bearer-authed, skip CSRF (no ambient credential to forge). Document the exception.
- How to verify the JWT. Supabase exposes `supabase.auth.getUser(jwt)` which validates server-side. Use that, not local-decode.
- Rate limit: keep IP-based for bearer routes (and add user-based as a follow-up).

**Implement**:
- Extend `getAuthenticatedClientId(request)` and `getAuthenticatedCoachId(request)` to check the `Authorization` header first. If `Bearer <token>` is present, call `supabase.auth.getUser(token)` to verify and extract user id; map to client/coach id as today.
- In `lib/require-client-auth.ts` and any coach equivalent, skip `requireCSRFProtection` when the request was authenticated via bearer. Document the exception inline.

**Do NOT**: Change cookie auth behaviour. Add bearer issuance endpoints (Supabase already issues the JWT during sign-in; the mobile app captures it). Touch route logic. Add bearer support to non-API routes (middleware-protected pages stay cookie-only; mobile uses APIs only).

**Tests to write**:
- Auth helper tests: bearer-authed request returns the right id; invalid bearer returns null; missing both bearer and cookie returns null; cookie-authed request still works.
- One route test (any client API route) with bearer auth instead of cookie — confirm 200 + CSRF bypassed.

**Verify**: `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`. Manual via curl: hit a client route with `Authorization: Bearer <jwt>` and confirm 200; same with bad token returns 401. Commit.

---

## Session 9.8: API versioning policy + Client-Version header gate

**Commit message**: `feat(api): add Client-Version header gate and deprecation framework`

**Objective**: Web has atomic deploys (frontend + backend ship together). Mobile doesn't — old app versions on phones will break when the API changes. Add a `Client-Version` request header check so the server can reject incompatible clients with a clear error, and a `Deprecation` response header so the server can warn old clients of upcoming changes.

**Decision required before this session**: The minimum supported `Client-Version`. If unsure, defer this session until the first iOS/Android version ships and you have a baseline to anchor against. Section can land empty (the helper exists but rejects nothing) and tighten later.

**Read first**:
- `CONVENTIONS.md` §10 (currently says no version prefix; this session adds version handling without changing the URL structure).
- `middleware.ts` for global request handling.
- `lib/require-client-auth.ts` for the existing chain.

**Plan (report before implementing)**:
- The header name (`Client-Version` is conventional; `X-Client-Version` is the legacy convention but `X-` prefixes are deprecated per RFC 6648). Use `Client-Version`.
- The minimum-version table: a small constants file (`lib/api-version.ts`) holding `MIN_CLIENT_VERSION` and a `Deprecation` window.
- Where the gate lives: middleware (global) or per-route helper (granular). Recommend per-route helper that auth chains opt into; web requests omit the header and skip the check.
- The error response shape when blocked: 426 Upgrade Required with `{ success: false, error: "Client version too old. Please update.", minSupportedVersion: "..." }`.

**Implement**:
- New `lib/api-version.ts` exporting `MIN_CLIENT_VERSION`, `getClientVersion(request)`, `assertClientVersion(request)`.
- Extend `lib/require-client-auth.ts` (and coach equivalent) to call `assertClientVersion()` when the header is present. If header is absent, no check (web).
- Optional: add `Deprecation` response header (RFC 9745) when client version is below a "deprecated but still allowed" threshold, with a `Sunset` date.

**Do NOT**: Add URL versioning (`/api/v1/...`) — out of scope; CONVENTIONS forbids. Add version logic to every individual route — the helper handles it. Block web requests (they don't send the header).

**Tests to write**:
- `lib/api-version.test.ts`: rejects below-min version with 426; accepts at-min and above; missing header passes through.
- One route test exercising the helper.

**Verify**: `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`. Manual via curl: hit a client route with `Client-Version: 0.0.1`; expect 426. Commit.

---

## Session 9.9: TECHNICAL-DEBT.md sweep (mark resolved items)

**Commit message**: `docs: sweep TECHNICAL-DEBT.md to reflect resolved items`

**Objective**: TECHNICAL-DEBT.md still lists items that have been resolved by recent sprints. A stale tech-debt doc is worse than none — it leads to wasted re-investigation and obscures the items that actually matter. Sweep, mark Resolved with date + commit hash, retain the entry as history.

**Read first**:
- `TECHNICAL-DEBT.md` (entire file).
- Recent commits referenced in the doc (`requireClientAuth`, coach library refactor, external activities removal, date helper sweep).

**Plan (report before implementing)**:
- Items confirmed resolved by audit (commit refs in parentheses):
  - External activities removal (mig 088, commits `37f6eaf..fadff55`).
  - Date helper sweep + HabitLogWithDetails dedupe (commit `49fda7d`).
  - DAY_MAP duplicate (verified absent).
  - Middleware role fallback (now denies, not defaults).
  - All "Pre-existing Test Failures" entries (full suite passes).
  - `requireClientAuth` helper + 29-route migration (commits `627b684..113a4bf`).
  - Coach library service split (commits `f127e4e..f8c8371`).
  - Duplicate Supabase server factories (commit `04ddf1d`).
  - `clients.timezone` migration (mig 089).
- Items partially addressed (note "partial — outstanding scope: ...").
- Items still open and accurate (leave as-is).
- Items added by Phase 9 sessions (cross-reference resolutions back).

**Implement**:
- For each resolved item, mark with `**RESOLVED** YYYY-MM-DD (commit `hash`) — <one-line how>` at the top of the entry. Do NOT delete entries; the history is useful.
- For partially resolved, add a `**PARTIAL** — outstanding: <one-line>` annotation.
- Re-sort the document so RESOLVED items move to the bottom of their section (or a new "Resolved" section per phase).

**Do NOT**: Delete entries. Restructure the doc's section hierarchy. Add new tech-debt items in this session — they belong in their own commits.

**Tests to write**: None.

**Verify**: Skim the doc top-to-bottom; confirm every open item is genuinely open. Commit.

---

## Session 9.10: Root-level doc rewrite (README) + audit of remaining stale docs

**Commit message**: `docs: rewrite README and audit remaining stale root-level docs`

**Objective**: The pre-Phase-9 audit identified the project root has accumulated stale or redundant documentation. Three files were addressed during Phase 9 prep work: `CHECK_IN_SETUP.md` (deleted as wildly stale), `CLIENT-ONBOARDING-README.md` (content moved to ARCHITECTURE.md, then deleted), and `MISSED_CHECKIN_TRACKING_PLAN.md` (deleted — feature has been fully implemented; doc was historical). This session handles what remains: rewriting `README.md` from scratch and auditing `CLIENT-APP-REFERENCE.md`. `DAILY-PULSE-README.md` stays out of scope — it dies with Daily Pulse in Session 5.1.

**Read first**:
- `README.md` (entire file — the current version is largely stale).
- `CLIENT-APP-REFERENCE.md` (entire file — assess relevance).
- `CONVENTIONS.md` §6 (file structure — used as the canonical reference for what to point at, not duplicate).
- `docs/ARCHITECTURE.md` end-to-end (this is what README points at for technical depth).
- `docs/CLIENT-PORTAL-REDESIGN.md` (referenced from README too).

**Plan (report before implementing)**:
- For `README.md`, the trim plan: keep only what serves a fresh GitHub visitor / new contributor (one-paragraph "what is this", tech stack table, setup steps, available scripts, pointers to authoritative docs). Drop:
  - The full feature list (becomes stale — actual product surfaces tell the truth).
  - Project structure tree (CONVENTIONS.md §6 owns it).
  - The "Client Invitation System" deep-dive (belongs in code or feature doc, not README).
  - The "Database" tables list (ARCHITECTURE.md owns it).
  - The "External Activity Tracking" feature reference (removed in mig 088).
  - The wrong "Components max 200 lines" claim (CONVENTIONS says 250).
  - The `cp .env.example .env.local` instruction (only valid AFTER Session 9.1).
- For `CLIENT-APP-REFERENCE.md`, decide: still useful, partly useful, or obsolete? Likely partly useful. Either trim and keep, or move unique content into ARCHITECTURE.md and delete (the same pattern as CLIENT-ONBOARDING-README handled here).

**Implement**:

1. **README rewrite**. Replace the existing `README.md` with a focused version covering:
   - Project description (1 paragraph)
   - Tech stack table
   - Setup: clone, `npm install`, env-var setup (referencing `.env.example` from Session 9.1), `npm run dev`
   - Available scripts (`npm run dev`, `npm run build`, `npm start`, `npm run lint`, `npm run test`)
   - Pointers to authoritative docs:
     - `CONVENTIONS.md` for coding rules
     - `docs/ARCHITECTURE.md` for the data model + system design
     - `docs/CLIENT-PORTAL-REDESIGN.md` and `docs/CLIENT-PORTAL-EXECUTION-PLAN.md` for the in-flight redesign
     - `DESIGNSYSTEM.md` for visual conventions
     - `TECHNICAL-DEBT.md` for known gaps
   - License line

2. **`CLIENT-APP-REFERENCE.md` audit**. Per planning decision:
   - If trim-and-keep: remove stale references, repoint anything that overlaps with ARCHITECTURE.md.
   - If move-and-delete: extract unique reference content into ARCHITECTURE.md (likely a "Client App Reference" section), then delete.

3. **Update `.claude/agents/implementation-planner.md`** if any of its references were broken by this session. (Pre-Phase-9 prep work already updated it for `CHECK_IN_SETUP.md` and `CLIENT-ONBOARDING-README.md`.)

**Do NOT**: Touch `DAILY-PULSE-README.md` (Session 5.1 owns its deletion). Restructure `docs/ARCHITECTURE.md` beyond adding sections for relocated content. Add new feature documentation here — the goal is consolidation, not net-new docs. Delete `TECHNICAL-DEBT.md` (Session 9.9 sweeps it; this session does not touch it).

**Tests to write**: None. Doc-only.

**Verify**:
- Open `README.md` cold; confirm a new contributor could clone and run within 5 minutes.
- `grep -rln "CHECK_IN_SETUP\|CLIENT-ONBOARDING-README\|MISSED_CHECKIN_TRACKING_PLAN\|CLIENT-APP-REFERENCE"` (the last only if deleted) — no stale references remain in code, configs, or other docs.
- `npx tsc --noEmit`, `npx vitest run` (no behavioural change so all pass).
- Commit.


