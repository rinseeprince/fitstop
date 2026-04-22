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
| 0.1 | Project reconnaissance and doc alignment | 0 Prep |
| 0.2 | Consolidate duplicate types + date helper cleanup | 0 |
| 0.3 | Verify existing weight_unit wiring | 0 |
| 1.1 | Design training-log contracts | 1 Training |
| 1.2 | Training log service layer + unit tests | 1 |
| 1.3 | Training log API endpoints | 1 |
| 1.4 | Set tracker UI, read-only skeleton | 1 |
| 1.5 | Set tracker UI, inputs + save flow | 1 |
| 1.6 | Coach drill-down dialog | 1 |
| 1.7 | Attention feed rewire | 1 |
| 2.1 | Day summary + program endpoints | 2 Home + nav |
| 2.2 | Bottom tab bar + client layout restructure | 2 |
| 2.3 | Home page shell + swipe navigation | 2 |
| 2.4 | Summary cards + phase banner | 2 |
| 2.5 | Program page + phase completion card relocation | 2 |
| 2.6 | Settings page + settings endpoint | 2 |
| 3.1 | Nutrition + wellness endpoints | 3 Detail pages |
| 3.2 | Nutrition detail page | 3 |
| 3.3 | Wellness detail page + past-day lock enforcement | 3 |
| 4.1 | Habits detail page | 4 Habits |
| 5.1 | Remove old Daily Pulse + deprecated routes + docs sweep | 5 Cleanup |
| 6.1 | Walkthrough copy/step update | 6 Check-in + onboarding |
| 6.2 | Check-in context: session-keyed to event-keyed | 6 |
| 6.3 | Check-in AI summary enrichment (optional) | 6 |
| 7.1 | Coach roadmap end-and-replace UI | 7 Coach-side fixes |
| 7.2 | Coach phase edit unlock for active phases | 7 |

---

## Session 0.1: Project reconnaissance and doc alignment

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

## Session 0.2: Consolidate duplicate types and standardize date handling

**Commit message**: `refactor: consolidate duplicate daily-log types and standardize on getDateString`

**Objective**: Eliminate the duplicate type definitions flagged in TECHNICAL-DEBT.md (`TodaysActivity`, `UnplannedActivity`, `HabitLogWithDetails`) and replace every `.split('T')[0]` with `getDateString()`.

**Read first**:
- `TECHNICAL-DEBT.md`.
- `types/` directory listing.
- `lib/date-helpers.ts`.
- Grep `TodaysActivity|UnplannedActivity|HabitLogWithDetails` across the whole repo.
- Grep `\.split\('T'\)\[0\]` across the whole repo.

**Plan (report before implementing)**:
- Canonical location for each consolidated type.
- Every file that will be edited.

**Implement**:
- Move each duplicated type to its canonical location; delete duplicates.
- Replace `.split('T')[0]` with `getDateString(date)` in every hit.
- Fix `saveUnplannedActivities` to use the selected date (TECHNICAL-DEBT.md flags it hardcoding `new Date()`).

**Do NOT**: Change type shapes or rename fields.

**Tests to write**: None new, but existing tests must pass. Update imports if any test referenced a duplicate.

**Verify**: `npx tsc --noEmit`, `npx eslint .`, `npx vitest run` all pass. Commit.

---

## Session 0.3: Verify existing weight_unit wiring

**Commit message**: `chore(clients): wire existing weight_unit preference through to tracker inputs`

**Objective**: The `clients.weight_unit` column already exists (migration 009, `'lbs' | 'kg'`, default `'lbs'`). Verify types plus services expose it correctly and surface it wherever weight inputs need a default. No migration.

If Session 0.1 flagged a missing timezone column, this session also adds that migration.

**Read first**:
- `supabase/migrations/009_add_client_goal_fields.sql` (weight_unit definition).
- `supabase/migrations/011_add_nutrition_fields.sql` (unit_preference definition).
- `types/database.ts` (confirm `Client` row type exposes `weight_unit` + `unit_preference`).
- `types/check-in.ts` or wherever the `Client` TS type lives (confirm camelCase mapping).
- Grep `weight_unit|weightUnit` in `services/` and `components/` for places where weight is rendered or defaulted.
- Session 0.1 timezone findings.

**Plan (report before implementing)**:
- Any missing type exports or service accessors.
- Any component that hardcodes `'lbs'` or `'kg'` instead of reading the client's preference.
- Whether to add a timezone migration (only if Session 0.1 said yes).
- **Resolve the `unit_preference` vs `weight_unit` overlap**: `clients.unit_preference` (`'metric' | 'imperial'`) and `clients.weight_unit` (`'lbs' | 'kg'`) cover adjacent concerns and can contradict each other. Decide whether `unit_preference` is the source of truth and `weight_unit` derives from it (imperial → lbs, metric → kg), OR they're genuinely independent fields. Document the decision in the REDESIGN doc. Session 2.6 implements the settings UI based on this decision.

**Implement**:
- Add accessors or type extensions if missing.
- Replace any hardcoded weight-unit fallbacks with reads of `client.weightUnit` (or `unit_preference` per the decision above).
- If timezone migration is needed: new migration `<next>_add_client_timezone.sql` with a `timezone TEXT` column (nullable, default null means use server default), update types.

**Do NOT**: Build settings UI (Session 2.6). Do not change the tracker yet (Session 1.5).

**Tests to write**: None for this session unless adding a timezone migration; in that case, a simple type-level check is enough.

**Verify**: `npx tsc --noEmit` clean. If migration added, runs cleanly in local dev. Commit.

---

## Session 1.1: Design training-log contracts

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

**Commit message**: `feat(training): implement event-keyed log write with snapshots and cascade`

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
- How `training_events.status` is derived in BOTH modes:
  - Quick log (no exercises array): status follows `completionQuality` directly.
  - Detailed log (with exercises): status derives from exercise logging completeness (all logged → `completed`; some logged → `partial`; none + explicit skip → `skipped`). If `completionQuality` is also supplied in detailed mode, the service picks one as authoritative; document the rule.
- How snapshots are composed at log time.
- How the service handles the "no exercises array" case: skip the `exercise_logs` bulk-replace entirely.

**Implement**:
- Full `logTrainingEvent()`:
  - Upsert `session_logs` keyed on `(client_id, training_session_id, week_start_date)`, writing `prescribed_session_snapshot`. Always happens (both modes).
  - If `exercises` array provided: bulk-replace `exercise_logs` with `prescribed_exercise_snapshot` per row (`actual_sets`, `actual_reps`, `actual_weight`, `weight_unit`, `notes`). If not provided: skip this step entirely.
  - Update `training_events.status` + `session_log_id` per the derivation rule above.
  - Trigger `cascadeNutritionAfterTrainingChange` in both modes.
- Full `getTrainingEventDetail()`: event + resolved session + exercises + existing session_log + exercise_logs, with snapshot fallback when live rows are null. Returns empty `exerciseLogs` array when the client used quick log only.

**Do NOT**: Build API routes yet. Do not touch UI or `training-session-service.ts`.

**Tests to write**:
- `services/training-log-service.test.ts`:
  - **Quick log (no exercises)**: writes session_log + snapshot, skips exercise_logs, sets event status from `completionQuality`, fires cascade.
  - **Detailed log (with exercises)**: writes session_log + snapshot + exercise_logs with snapshots, derives status from exercise completeness, fires cascade.
  - **Detailed partial**: status = `partial` when some exercises unlogged.
  - **Transaction integrity**: exercise_logs insert failure rolls back session_log (or documented behavior).
  - `getTrainingEventDetail()` live path returns live rows.
  - `getTrainingEventDetail()` returns empty `exerciseLogs` for quick-logged sessions.
  - Snapshot fallback returns snapshot data when live rows null.
  - Not found returns null or throws as designed.

**Verify**: `npx tsc --noEmit`, `npx vitest run`. Commit.

---

## Session 1.3: Training log API endpoints (client POST/GET, coach GET)

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
- Log POST route: 201 valid; 400 malformed; 401 unauthenticated; 403 event belongs to another client; CSRF rejection.
- Event GET: 200 happy; 401; 404 when event missing.
- Coach drill-down GET: 200; 403 when coach does not own client; 404 when session_log missing.

**Verify**: `npx tsc --noEmit`, `npx vitest run`. Manual curl smoke test. Commit.

---

## Session 1.4: Set tracker UI, read-only skeleton

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

**Commit message**: `feat(coach): add session log detail dialog with prescribed-vs-actual view`

**Objective**: Replace chart-only `HistoryChartDialog` with detail dialog showing prescribed vs actual per exercise plus client notes plus status. Snapshot fallback for orphaned rows.

**Read first**:
- `components/clients/training/training-history-table.tsx`.
- `components/clients/training/history-chart-dialog.tsx`.
- `CONVENTIONS.md` dialog structure.

**Plan (report before implementing)**:
- Dialog layout with three render states: quick-logged only (no exercise_logs), detailed (exercise_logs present), orphaned (snapshot fallback).
- Snapshot-fallback rendering.

**Implement**:
- `components/clients/training/session-log-detail-dialog.tsx` (follows CONVENTIONS dialog pattern).
- Fetches `GET /api/clients/[id]/training/session-logs/[sessionLogId]` via SWR.
- Three display states:
  - **Quick-logged only** (`exercise_logs` empty): show session name, completion quality, notes. Display a clear label like "Client logged this session as complete without per-set detail." Show the prescribed exercises as reference only (from snapshot), no actuals column.
  - **Detailed**: show prescribed vs actual per exercise, set-by-set, plus client notes and status.
  - **Orphaned**: use `prescribed_session_snapshot` + `prescribed_exercise_snapshot` when live refs are null.
- Update `training-history-table.tsx` row click to open new dialog. Keep `HistoryChartDialog` (removed in 5.1).

**Do NOT**: Delete `history-chart-dialog.tsx`. Do not restructure history table beyond row-click. Do not treat missing exercise_logs as an error state; it's valid.

**Tests to write**:
- `session-log-detail-dialog.test.tsx`:
  - **Quick-logged display**: renders "no detail logged" label + prescribed reference only + notes + status.
  - **Detailed display**: prescribed + actual when exercise_logs present.
  - Snapshot fallback when live session null.
  - Snapshot fallback when live exercise null.
  - Loading + error states.

**Verify**: Manual coach test. `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`. Commit.

---

## Session 1.7: Attention feed rewire (training triggers)

**Commit message**: `refactor(attention-feed): read training completion from training_events`

**Objective**: Switch "training missed" and "activity-calorie mismatch" triggers to read `training_events.status` directly.

**Read first**:
- `lib/tracking-triggers.ts`, `lib/activity-triggers.ts`.
- `services/attention-feed-service.ts`.
- Existing signal logic.

**Plan (report before implementing)**:
- Which trigger functions change.
- Whether a new batch query is needed.
- Test fixtures to update.

**Implement**:
- Replace `training_logs.trained` reads with `training_events.status='completed'`.
- If new batch query added, follow existing admin-client pattern with justifying comment.
- Update tests.

**Do NOT**: Remove the `training_logs.trained` column. Do not refactor `attention-feed-service.ts` beyond necessary.

**Tests to write**:
- `lib/tracking-triggers.test.ts` + `lib/activity-triggers.test.ts`:
  - Both signals fire when no events completed.
  - Neither fires when events completed.
- `services/attention-feed-service.test.ts`: regression for aggregated feed.

**Verify**: `npx vitest run`. Manual signal test. Commit.

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
- Swipe/arrow updates `?date=` (no remount; SWR key swap).
- **Update post-login redirect**: today the client probably lands on `/client/dashboard` after login. Grep for redirect destinations (likely in `middleware.ts`, `lib/auth-helpers.ts`, or the login action) and change them to `/client`. The old dashboard route still exists until Session 5.1 removes it, but nothing should send the client there anymore.
- **Grep email templates** under `emails/` for any `/client/dashboard` deep links and update them to `/client`.

**Do NOT**: Build summary cards yet (2.4). Do not add phase banner yet (2.4).

**Tests to write**:
- `day-header.test.tsx`: prev/next update date prop; "Today" snaps; keyboard arrows work.
- Home page render tests: loading, error, URL-param-driven fetch key.

**Verify**: Navigate forward/back; URL updates; refetch happens. `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`. Commit.

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

**Do NOT**: Build nutrition/wellness/habits detail pages (Phase 3/4). Training detail exists from 1.4.

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

**Do NOT**: Build UI (Sessions 3.2, 3.3). Remove the monolithic `/api/client/daily-logs` POST yet. Duplicate date-rule logic or plan-context resolution inside any route handler.

**Tests to write**:
- `lib/daily-log-permissions.test.ts`: `canEditDay` covers today, past-unlogged, past-logged, future, and client-local midnight boundary cases. `assertCanEdit` throws on violation and resolves cleanly on allowed cases (mock the log-state read).
- Plan-context resolver test: returns correct IDs for phase-active, no-phase, and no-plan fixtures.
- All four API routes: 200/201 happy path; 400 malformed; 401 unauthenticated; 403 for past-logged and future dates (PATCH). Assert the 403 is produced via `assertCanEdit`, not via duplicated inline logic.
- Nutrition GET: three-level priority returns expected value per case.

**Verify**: Manual curl for each date-rule case. `npx tsc --noEmit`, `npx vitest run`. Commit.

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
7. Update `docs/ARCHITECTURE.md`: the "Client Portal Architecture" section was already added in an earlier pass; this session confirms it's accurate, removes any stale Daily Pulse references elsewhere in the doc, and updates the Data Hierarchy diagram if anything changed.

**Do NOT**: Drop `upsert_daily_log_atomic()` from DB (separate schema work). Change `CONVENTIONS.md` beyond Session 0.1.

**Tests to write**: None. Remove tests for deleted code.

**Verify**: `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`. Manual smoke across client portal: login lands on `/client`, every tab works, no 404s. Read ARCHITECTURE.md end to end for stale references. Commit.

---

## Session 6.1: Walkthrough copy/step update

**Commit message**: `feat(onboarding): update guided walkthrough for day-centric portal`

**Objective**: Rework `components/client/walkthrough/guided-walkthrough.tsx` for new clients.

**Read first**:
- `CLIENT-ONBOARDING-README.md`.
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
- Preserve form's response shape.

**Do NOT**: Change submission flow or AI invocation.

**Tests to write**:
- `check-in-context-service.test.ts`:
  - Completion count correct vs known fixture.
  - Zero completed returns 0.
  - Partial statuses not counted.
  - Shape preserved.

**Verify**: Manual check-in submission. `npx vitest run`. Commit.

---

## Session 6.3: Check-in AI summary enrichment with exercise_logs (optional polish)

**Commit message**: `feat(check-in): enrich AI summary with exercise-level completion data`

**Optional**: This session is nice-to-have polish, not MOAT-load-bearing. The MOAT work is Session 6.2 (event-keyed completion counts). If launch timing is tight, defer 6.3 and ship without it. Auto-populated check-in already works with the event-keyed switch alone.

**Objective**: Feed `exercise_logs` into the AI prompt for richer progression insights.

**Read first**:
- `services/ai-service.ts` (check-in summary generation).
- `services/client-check-in-service.ts`.
- Current prompt template.

**Plan (report before implementing)**:
- Which exercise-log aggregates to include.
- Prompt additions (context length budget).

**Implement**:
- Extend data fetch for `exercise_logs` within period.
- Extend prompt with compact per-exercise summary block.
- Respect 25s timeout per CONVENTIONS section 11.

**Do NOT**: Swap AI providers. Do not change `ai_insights` JSONB shape.

**Tests to write**:
- `ai-service.test.ts` (or wherever summary lives):
  - Prompt includes expected per-exercise text given a fixture.
  - Timeout boundary aborts at 25s+.
  - Empty exercise_logs composes prompt gracefully.

**Verify**: Manual check-in with logged exercises; summary references them. `npx tsc --noEmit`, `npx vitest run`. Commit.

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
