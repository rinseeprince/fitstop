# Client Portal Redesign: Execution Plan

Companion to `CLIENT-PORTAL-REDESIGN.md`. This file breaks the redesign into session-sized prompts that a fresh Claude Code session can execute directly.

## Context: why this web phase exists

The execution plan below rebuilds the client portal as a Next.js web app, but the web app is **not the shipped product**. It exists as a testing harness for the client-side logic and API endpoints. The shipped product will be a React Native iOS/Android app, built fresh after this plan completes; the web frontend code is throwaway.

What this means for how to work through these sessions:

- **Functional correctness, API design, and data flow are first-class.** Endpoints, service contracts, validation schemas, and the state machine for each feature all carry forward to the RN app unchanged. Bugs here become bugs in the shipped product.
- **Visual polish is deferred.** Pixel-level CSS, hover states, gradient shades, and other web-specific styling will be rewritten in NativeWind / RN primitives. Do not invest time perfecting them in this phase.
- **Design decisions still carry forward** as a spec, even though the code does not. Information architecture (what is shown where, what is tappable, what is hidden behind a tap) and component composition decisions made here become the reference for the RN rebuild. Capture meaningful design decisions in `DESIGNSYSTEM.md`, not only in component code.
- **Manual smoke testing verifies flows, not visuals.** If a layout is confusing enough to bias UX feedback, fix it. If it is merely ugly, leave it for the RN rebuild.

If the plan changes and the web app becomes a shipped surface, revisit this section.

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
| 1.8 | Exercise history data layer + API (coach-side) | 1 | COMPLETE
| 1.9 | Exercise Data tab UI + PR view (coach-side) | 1 | COMPLETE
| 2.1 | Day summary + program endpoints | 2 Home + nav | COMPLETE
| 2.2 | Bottom tab bar + client layout restructure | 2 | COMPLETE
| 2.3 | Home page shell + swipe navigation | 2 | COMPLETE
| 2.4 | Summary cards + phase banner | 2 | COMPLETE
| 2.5 | Program page + phase completion card relocation | 2 | COMPLETE
| 2.6 | Settings page + settings endpoint | 2 | COMPLETE
| 2.7 | Client check-in hub (submission + history) | 2 | COMPLETE
| 2.8 | Training plan overview card + sessions drill-in | 2 | COMPLETE
| 2.9 | Nutrition plan overview card + drill-in | 2 | COMPLETE
| 3.1 | Nutrition + wellness endpoints | 3 Detail pages | COMPLETE
| 3.1B | Server-side no-plan rejection in per-card writers | 3 | COMPLETE
| 3.2 | Nutrition detail page | 3 | COMPLETE
| 3.3 | Wellness detail page + past-day lock enforcement | 3 | COMPLETE
| 3.4 | Client metrics hub + Performance view + nav swap | 3 | COMPLETE
| 3.5 | Scale test fixtures + performance baseline | 3 Scale hardening |
| 3.6 | Exercise analytics: SQL aggregation + windowing + indexes | 3 Scale hardening | COMPLETE
| 3.7 | Read-path hot spots: streak, check-in counts, check-in context | 3 Scale hardening | COMPLETE
| 3.8 | Per-request auth resolution caching | 3 Scale hardening | COMPLETE
| 3.9 | Render-ready payloads + bounded/keyset contract + exercise catalog delta-sync | 3 Scale hardening | COMPLETE
| 3.10 | Re-key client rate limiting from IP to client identity | 3 Scale hardening | COMPLETE
| 4.1 | Habits detail page | 4 Habits | COMPLETE
| 5.1 | Remove old Daily Pulse + deprecated routes + docs sweep | 5 Cleanup | COMPLETE
| 5.2 | Align session_logs identity with event-keyed architecture | 5 |
| 5.3 | Alternative session logging: write path + matcher + coach surfacing | 5 |
| 5.4 | Alternative session logging: client UI | 5 |
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
| 9.11 | Production query/performance observability | 9 |
| 9.12 | Media/image transform contract (progress photos) | 9 | DEFERRED
| 9.13 | Connection pooling + native resiliency decision note | 9 |

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

**Status**: COMPLETE

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

**Status**: COMPLETE

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

**Status**: COMPLETE

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
- `services/client-program-service.ts` (new file): `getClientProgram(clientId)` returning roadmap + phases. **Kept in a separate file from the existing roadmap service** for file isolation — keeping a single-client read out of the file full of coach cross-client queries so the wrong query can't be grabbed by accident. Per CONVENTIONS §8 (Shape B), this service uses `supabaseAdmin` scoped to the `requireClientAuth`-verified `clientId` — **not** session-scoped RLS. *(An earlier draft of this plan said "session-scoped Supabase (RLS)"; that predates Shape B. The shipped service correctly uses `supabaseAdmin`.)*
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

**Status**: COMPLETE

**Deviations from plan** (worth knowing for downstream sessions):
- **Onboarding gate moved into the layout.** Plan said to "preserve all existing auth gating … as-is" on the assumption the gate was already in `app/client/layout.tsx`. It wasn't — the `pending_intake` redirect and `<ClientWaitingState>` render lived in `app/client/dashboard/page.tsx` only, so the new tab bar would have wrapped non-active clients with chrome on every non-dashboard route. The gate moved into the layout; dashboard's now-dead branches and the `ClientWaitingState` import were removed.
- **Top bar stays visible during the waiting state.** Plan said waiting state renders "full-screen, no nav." Without the top bar a non-active client has no way to sign out between this session and 2.6. The bottom nav is hidden as planned, but the top bar (and its sign-out affordance) stays.
- **Avatar is a `DropdownMenu` trigger, not a `Link` to `/client/settings`.** The settings page doesn't exist yet; pointing the avatar at it would 404. The avatar wraps a `DropdownMenu` with a single "Sign out" item (`logout()` + `router.push("/login")`). Session 2.6 should add "Settings" as a menu item above "Sign out" — see the note in 2.6.
- **`ClientNotificationsDropdown` stays in the top bar.** Plan implied a strictly "minimal top bar (logo + avatar trigger)." Removing the existing notifications dropdown would have silently dropped a working UX surface. Top bar layout is `[logo] … [ClientNotificationsDropdown] [Avatar]`.
- **Detail routes leave the bottom bar with no active tab.** Active predicates are strict `startsWith` of each tab's own href. On `/client/training`, `/client/nutrition` (and future siblings `/client/wellness`, `/client/habits`, `/client/exercise-history` from 3.x/4.x) no tab lights up — the iOS subscreen pattern. The Program tab is not the parent of training/nutrition; do not extend its predicate to cover them in later sessions.
- **Added `app/client/layout.test.tsx`** alongside the planned `client-nav.test.tsx`. Eight assertions cover every branch of the gate ladder (auth-loading, unauthenticated, onboarding-route, client-loading, SWR-error, `pending_intake`, non-active, active). This is the regression surface 2.6 (avatar dropdown gains "Settings") and 5.1 (dashboard removal) are most likely to disturb.
- **Doc typo to fix later**: this plan references `components/client/onboarding/client-waiting-state.tsx`; the actual path is `components/client/walkthrough/client-waiting-state.tsx`. Not blocking; flagging for the next doc sweep.

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
  - Preserve all existing auth gating and role redirects as-is; confirm by diffing.e
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

**Status**: COMPLETE

**Commit message**: `feat(client-portal): add day-centric home with URL-param date navigation`

**Objective**: Build `app/client/page.tsx` as the new landing, with date navigation (
  arrow buttons + horizontal swipe), URL-param-driven date state, loading + error shells.

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

**Status**: COMPLETE

**Commit message**: `feat(client-portal): wire home summary cards and phase banner`

**Deviations from plan** (worth knowing for downstream sessions):
- **`ds-card-summary.tsx` is two exports, not one.** The plan implied a single primitive; implementation split into `DsCardSummary` (presentational frame: title + body) and `DsCardSummaryRow` (clickable/static row primitive). Cleaner separation — the frame is consumer-agnostic; clickability is per-row. Both live in `components/client-portal/ds-card-summary.tsx`.
- **Single-row card copy adjusted to avoid title-duplication.** Original draft put `leadingText="Wellness"`/`"Nutrition"`/`"Habits"` inside the row of a card whose title already said the same word. Spotted via a `getByText` collision in the page test; also poor UX. Single-row cards now use the state itself as `leadingText` (`"Logged"` / `"Not logged yet"` / `"X of N logged"`). Training rows keep two-line layout because they have a meaningful session name as leadingText.
- **Empty-state copy asymmetry between Training and Nutrition is deliberate**, per `services/training-event-service.ts:73-75` and ARCHITECTURE.md:213,230: training events skip rest days (no row written), so `events: []` is dominantly a real rest day → "Rest day / No training scheduled". Nutrition events always exist per date including rest days, so `nutrition: null` is never a rest day → neutral "No nutrition target today". See the architectural justification in the User-confirmed design choices subsection below.
- **Day-summary route's `validateDateParameter` rejected future dates with 400.** Surfaced when smoke-testing forward swipe. Replaced the `validateDateParameter` call in `app/api/client/day-summary/route.ts` with inline YYYY-MM-DD format + Date-validity + round-trip check mirroring `app/client/page.tsx:23-29`. Past/future bounds belong to write-side enforcement via `canEditDay` (Session 3.x), not the read path. Test file rewritten to drop the validator mock and assert future + far-past dates return 200. See the Post-merge follow-up below — the read path stays open, but the navigation surface is what gates future-date writes.

**Post-merge follow-up: future-date navigation block** (commit `a376a65`):
- **Architectural decision.** Home day-view summary cards are the single navigation surface to logging. Future-date cards are non-clickable; this is the SOT for future-date write blocking. Past + today remain clickable (past-logged days still need detail-page lock UX for view-history reasons). To see future training structure, clients use `/client/program` (the read-only program tab; the training plan card from Session 2.8 already covers this, and Session 2.9 will add the nutrition plan card).
- **Implementation.** Each of the four cards computes `const isFuture = date > getTodayDateString();` and passes `href: undefined` + `hint: undefined` to `DsCardSummaryRow` when true. `leadingText` / `trailingText` / `ariaLabel` stay so the row reads as info-only. `DsCardSummaryRow` already renders a plain `<div>` when `href` is omitted (no primitive change needed). Inline string comparison is safe (YYYY-MM-DD is lexicographically ordered) and the helper extraction would be premature abstraction per CONVENTIONS §3.
- **Downstream simplification.** Sessions 3.2 / 3.3 / 4.1 / 5.4 no longer carry future-day view-only UI scope — the navigation block prevents reaching those pages for future dates. Server-side `assertCanEdit({ resourceType: 'training', ... })` stays in Session 5.3 as defense-in-depth for direct API callers (§8 Shape B perimeter), not as primary protection. The product owner's principle: *"For future days, you shouldn't be able to click into the cards. That should be the future date blocking implementation. Period."*

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

**Status**: COMPLETE

**Commit message**: `feat(client-portal): add program page and relocate phase completion card`

**Deviations from plan** (worth knowing for downstream sessions):
- **Plan refinements vs initial draft**: dropped the `<Suspense>` wrapper on `/client/program` (no suspending hook in use; SWR's `isLoading` already drives the skeleton). Future phases stay static rather than tap-to-expand (spec wording at REDESIGN doc line 67/268 grants "collapsible" to past only; planned milestones are all `completed: false` so revealing them adds nothing). Phase list uses `<div className="flex flex-col gap-2">` to match sibling `client-portal/day/` pattern rather than a semantic `<ul>`. No client-side `phases.sort()` since `services/client-program-service.ts:29` already orders by `order_index`.
- **Surface coach-visible data shipped as a same-session extension.** Original Session 2.5 scope was relocation + read-only roadmap view. Extended mid-session per user directive ("everything the coachside can see, the client should see") to surface phase numeric goals, per-phase coach reflection, roadmap numeric goals + `targetEndDate`, weight unit, and a roadmap stats grid (start / current / goal). `ClientProgram` widened in `types/client-program.ts`; `services/client-program-service.ts` grew a third query against the `clients` table for `weight_unit`/`starting_weight`/`current_weight`. New light-themed `RoadmapSummaryStrip` component built; `PhaseListItem` extended with `weightUnit` prop + goal chip (Target icon, `weightFromKg`) + coach reflection italicized at top of expanded body. Three additional consumer fixtures updated (`client-program-service.test.ts`, `__tests__/api/client/program.test.ts`, `client-day-service.test.ts`).
- **Roadmap stats grid (start / current / goal) renders raw `clients.*_weight` without conversion.** Matches coach `RoadmapSummaryStrip` behaviour (see `components/clients/roadmap/roadmap-tab-content.tsx:102-104`). Smoke-test discovery: flipping `clients.weight_unit` via SQL leaves the stored numbers untouched, so the displayed values are wrong after a flip. This is a pre-existing data-storage gotcha on both coach and client sides (`clients.starting_weight` etc. are stored in whatever unit was current at write time; there is no canonical kg storage for these fields). Proper fix lives in Phase 8 ("viewer-relative units", sessions 8.1-8.3). In production, real users do not change their unit preference, so this is invisible until 8.x lands. Only `phases.phase_goal_weight` is canonically kg-stored and runs `weightFromKg` on display.
- **ESLint cleanup landed in the same branch.** `npx eslint --fix` swept 25 redundant `as <Type>` assertions in `services/training-*.ts` files; manual fixes for a stale `let` in `services/check-in-context-service.ts` (`prefer-const`) and a floating-promise `setTimeout(() => searchCatalog(...))` in `components/clients/training/sessions/add-exercise-dialog.tsx` (`no-misused-promises`). Net: 29 errors to 2. The remaining 2 are pre-existing `await-thenable` in `services/schedule-data-service.ts` (lines 109, 186) which touch Supabase type-casting hacks; deferred to whoever owns that service.
- **Doc additions in the same session.** Added a "Context: why this web phase exists" section at the top of this execution plan to codify the testing-harness intent (visual polish deferred to the RN rebuild; functional correctness, API design, IA decisions are first-class). Scheduled Sessions 2.8 (Training plan overview card + sessions drill-in) and 2.9 (Nutrition plan overview card + drill-in) to surface the active phase's training plan and nutrition plan on `/client/program`. Both deferred; full session prompts already written below.

**Known tech debt (out of scope, recorded for follow-up)**:
- `PhaseCompletionCard.handleDismiss` (lines 87-89 of the relocated file) silently swallows fetch errors. Retry-on-next-load is the baseline; a toast on confirmed failure would be more honest. Surface in a future hardening pass.
- Relocated card retains its `daily-pulse/`-era hex palette (`#0d9488` / `#0c1a1e` / `#93b0b4`); matches the celebratory accent but diverges from neighboring `client-portal/day/` Tailwind tokens. Theme migration deferred.
- ARCHITECTURE.md line 181 still references the pre-relocation path `components/daily-pulse/phase-completion-card.tsx`. One-line doc fix pending.

**Objective**: Build `/client/program` read-only roadmap view. Relocate `PhaseCompletionCard` from Daily Pulse to new home.

**Read first**:
- `components/daily-pulse/phase-completion-card.tsx`.
- `components/clients/roadmap/roadmap-tab-content.tsx` (coach reference).
- `docs/CLIENT-PORTAL-REDESIGN.md` (Program view).
- `GET /api/client/phase-completion` (existing).

**Pre-existing finding from Session 2.3 verification**: `/client/program` currently 404s on tab click and on Next.js RSC prefetch (the bottom tab bar's `<Link href="/client/program">` from Session 2.2 prefetches in the background). Creating `app/client/program/page.tsx` in this session resolves both — no separate fix needed.

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

**Status**: COMPLETE (commit `7f08054`)

**Mid-session deviations from spec**:
- **Reminder switch dropped from scope.** The `reminder_preferences` UI was cut after grepping the consumers: `services/reminder-service.ts:sendAutomatedReminders` reads the fields, but no cron invokes it and the email send is a `TODO` stub at `reminder-service.ts:61-63`. Toggling would have written to a column nothing reads. Re-introduce alongside the cron + email work, not before.
- **Migration 092 added (out-of-scope discovery).** While building the form, hit a silent submit failure traced to `clients.reminder_preferences` JSONB containing snake_case keys (`auto_send`, `send_before_hours`) from migration 008's seed default, while every TS consumer (`ReminderPreferences` type, cron's `autoSend` guard, the new form's zodResolver) expected camelCase. Migration 092 rewrites all rows in place via `jsonb_build_object` + `COALESCE` and changes the column default. Same shape mismatch was making `services/reminder-service.ts:129` silently skip every client (latent — cron isn't live).
- **In-page sign-out button removed.** Avatar dropdown's "Sign out" item already covers it; an in-page duplicate added clutter for no gain.
- **Single Imperial/Metric toggle (not two).** Per `docs/CLIENT-PORTAL-REDESIGN.md` §8 lines 338-342: server derives `weight_unit` from `unit_preference` (`metric → kg`, `imperial → lbs`) and writes both columns in the same UPDATE. Client never sends `weightUnit`.
- **Timezone Combobox split out.** `app/client/settings/page.tsx` was approaching the §4 250-line component limit, so the IANA Combobox lives at `components/client-portal/settings/timezone-combobox.tsx`. `'UTC'` is treated as the unset sentinel — when stored is `'UTC'` and `Intl.DateTimeFormat().resolvedOptions().timeZone` differs, an inline "Use detected: …" button appears. No silent overwrites.

**Commit message**: `feat(client-portal): add client settings page with unit and timezone preferences`

**Objective**: Build `/client/settings` with editable weight unit, unit preference, reminder preferences, timezone (if added in 0.3), plus read-only profile info and a sign-out button. Add `PATCH /api/client/settings` mutation.

**Note from Session 2.2**: The avatar in `components/client-portal/nav/client-nav.tsx` is already a `DropdownMenu` trigger with a "Sign out" item. This session should add "Settings" as a menu item above "Sign out" (a `<Link href="/client/settings">` wrapped in a `DropdownMenuItem`) — no chrome rewrite needed. The settings page itself can keep an in-page sign-out button for users who land on `/client/settings` directly.

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

**Status**: COMPLETE (commit `61fef83`)

**Mid-session deviations from spec**:
- **Detail back-button rewritten mid-verification.** First pass used `window.history.length > 1` to decide between `router.back()` and `router.push("/client/check-in")`. Manual deep-link test (new tab → paste URL → click Back) revealed Chrome counts the new-tab page as a history entry, so `length` was 2 and back() dumped the user on the Google new-tab screen. Rewrote to check `document.referrer.startsWith(window.location.origin)` instead — empty or cross-origin referrer means a direct/email/share entry, fall back to `router.push`. Same-origin entries use `router.back()` as before.
- **Components placed under `components/client-portal/check-in/`, not `components/client/`.** Pre-implementation default was to match the existing `components/client/progress/*` siblings on the progress page, but CONVENTIONS §6 marks `components/client/` as pre-activation. Check-in hub is post-activation, so `CheckInCard` and `PastCheckInsSection` live under `components/client-portal/check-in/`. The legacy `components/client/progress/*` files are technically misplaced per the same rule but are out of scope for this session.
- **`PastCheckInsSection` extracted alongside `CheckInCard`.** Original plan inlined the past-list rendering in the hub page; that would have pushed `app/client/check-in/page.tsx` past CONVENTIONS §4's 300-line split threshold. Lifting the section out keeps the hub at ~270 lines (cohesive: header + submission-switch + section render) and gives the section a single testable responsibility. Section file exports `PAST_CHECK_INS_SWR_KEY` so the hub can `mutate(KEY)` after a successful submit — no callback prop, no `onDataChange` useEffect (CONVENTIONS §3).
- **SWR replaces fetch+useState for past-list data.** First plan mirrored `/client/progress`'s legacy fetch pattern; reviewer flagged this against CONVENTIONS §7 (use SWR for all new data fetching). Sections now match `app/client/program/page.tsx` and `app/client/settings/page.tsx`: `useSWR(KEY, swrFetcher, { revalidateOnFocus: false, errorRetryCount: 3, errorRetryInterval: 1000 })`. `/client/progress` itself stays on its legacy pattern — migrating it is out of scope.
- **`hooks/use-client-check-in.ts` extended to surface `nextDueDate`.** The check-in context API was already returning `nextDueDate` in its `not_due` / `completed` error responses (`app/api/client/check-in-context/route.ts:73,85`); the hook was discarding it. Added a `nextDueDate: string | null` return field so the hub can render "Next check-in opens on Wednesday, May 22". No change to the gating logic — only response-field surfacing.
- **`/client/progress` not retired.** Page has goals, body/wellness metric charts, habits, and a stats grid in addition to check-in history, so it is NOT a candidate for the Session 5.1 retirement list. Only the inline `CheckInCard` was lifted out; the surrounding page keeps its current pattern.
- **Bundled `await-thenable` fix in `services/schedule-data-service.ts`.** During the Session 2.7 CI-gate verification, `npx eslint .` reported 2 errors at `services/schedule-data-service.ts:109,186` blocking §13's commit-ready checklist. `git stash` confirmed they were pre-existing on `main` (introduced in commit `7de1987` as part of the pre-CE-1 checkpoint). Root cause: the Supabase query chain was cast `as unknown as { data, error }`, which strips the `PromiseLike` nature so `Promise.all` sees a non-thenable type. Fix (2 lines): wrap the asserted result type in `Promise<…>`. Runtime is unchanged — Supabase query builders are real thenables; only the type-level cast was lying. Bundled into the feature commit per user direction rather than a separate commit.

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

## Session 2.8: Training plan overview card + sessions drill-in

**Status**: COMPLETE

**Post-Session-2.9 amendment**: The cycle-chips row originally rendered on the card (e.g. "Push · Pull · Rest · Legs · Rest") was removed during Session 2.9 so the training card collapses to a single row (plan name + session count + chevron) and matches the new nutrition card's height. The chips never moved anywhere else — clients see the full cycle on the drill-in page (`/client/program/training`), which is unchanged. Card test dropped the two chip-related assertions; the session-count assertion stays.

**Mid-session deviations from spec**:
- **Phase coupling dropped after manual verification failed.** Initial service implementation followed the task spec's resolution ("find the active phase, then `training_plans` where `phase_id = phaseId`"). Manual test on a real test client (Samuel James, active PPL+Rest plan placed from library) hit the empty state — root cause: `training_plans.phase_id` is **nullable** per `docs/ARCHITECTURE.md:29,33,59`. Plans placed via the current UI (`/api/clients/[id]/training/place-from-library`) accept `phaseId` as optional and Samuel James's plan had `phase_id = NULL`. The placement service (`library-placement-service.ts::calculatePlacementEndDate`) already caps the cycle at the client's containing-phase end date regardless of the column link, so the link is essentially redundant metadata for the calendar-as-SOT model. Fix: drop the `phase-service` import and the `phase_id` filter; resolve by `client_id + status='active' + deleted_at IS NULL + effective_until IS NULL` ordered by `created_at DESC, LIMIT 1` (mirrors `getActiveTrainingPlan`'s resolution). Service tests simplified to drop the `phase-service` mock; the obsolete "returns null when no active phase exists" case was deleted.
- **Legacy `getClientTrainingPlan` retired and 3 consumers retargeted (bundled scope per user direction, Option 3).** The original spec named the new service's exported function `getClientTrainingPlan`, which would have collided with `services/client-portal-training.ts::getClientTrainingPlan` (a session-scoped legacy reader that pre-dated CONVENTIONS §8 Shape B). Per user direction, the legacy was deleted instead of coexisting. Consumers retargeted to `getActiveTrainingPlan` from `services/training-service.ts`: `app/api/client/training/route.ts`, `app/api/client/daily-logs/route.ts`, `services/client-portal-service.ts` (the nutrition-target cascade). The legacy file's three completion helpers (`getWeeklyCompletions`, `markSessionComplete`, `removeSessionCompletion`) are preserved alongside `createPortalClient` — only `getClientTrainingPlan` was removed. A stale `vi.mock('./client-portal-training')` block in `services/daily-logs-service.test.ts` was verified-dead (no `vi.mocked(getClientTrainingPlan).mockResolvedValue(...)` call sites) and removed.
- **`effective_until` filter shift (Decision 4 in plan).** The replacement `getActiveTrainingPlan` adds `effective_until IS NULL` to the active-plan query — tighter than the legacy filter, which only checked `status='active' AND deleted_at IS NULL`. The two are equivalent in any consistent DB state (`status='active' AND effective_until IS NOT NULL` is an invariant violation that the writers in `promoteTrainingPlanIfReady` and `createTrainingPlanAtomic` never produce). Accepted as a defensive tightening. A one-line SQL smoke (`SELECT COUNT(*) FROM training_plans WHERE status='active' AND effective_until IS NOT NULL AND deleted_at IS NULL`) was added to the verification checklist.
- **Defense-in-depth user-ownership re-check removed.** The legacy `getClientTrainingPlan` did an inline `user_id`-based ownership check (`supabase.auth.getUser()` + `clients.eq("user_id", user.id)`) before fetching the plan. The replacement does not — `requireClientAuth` already produces `auth.clientId` from the verified JWT join per §8 Shape B, so the in-service re-check was redundant.

**Commit message**: `feat(client-portal): add training plan overview card on program page with sessions drill-in`

**Objective**: Surface the client's active training plan structure on `/client/program` as a read-only card below the phase list. The card shows the cycle sequence as horizontal chips (e.g. "Push · Pull · Rest · Legs · Rest"). Tapping the card navigates to a new sub-page `/client/program/training` that lists each session in cycle order, each row expandable to reveal the prescribed exercises (sets / reps / RPE / tempo / rest).

**Read first**:
- `services/client-program-service.ts` (existing client-facing program reader; mirror its file-isolation pattern).
- `services/training-service.ts` and `services/training-session-service.ts` (existing coach-side training-plan reads; identify the helpers worth reusing vs the ones too coach-coupled to call from a client route).
- `types/training.ts` (`TrainingSession`, `TrainingExercise` shapes).
- `types/roadmap.ts` (`Phase` shape; how `training_plans.phase_id` links).
- `components/clients/roadmap/phase-card.tsx` and the existing coach-side training plan view (visual reference, do not import).
- `components/client-portal/program/phase-list-item.tsx` (style baseline for the new card; light Tailwind tokens, `font-mono-display` for numbers).
- ARCHITECTURE.md, sections "Coach Library" (cycle_length, rest_pattern, order_index) and "Roadmap/Phase Architecture" (how training_plans link via phase_id).
- `docs/CLIENT-PORTAL-REDESIGN.md` (any sections on program-page composition).

**Implement**:
- New service: `services/client-training-plan-service.ts` exporting `getClientTrainingPlan(clientId: string): Promise<ClientTrainingPlan | null>`. Resolution: find the active phase (via `getClientProgram(clientId)` or a direct query), then the training plan linked to that phase (`training_plans.phase_id = phaseId`). If no active phase or no plan, return `null`. Read sessions ordered by `order_index`, including each session's exercises (also ordered).
- New type `types/client-training-plan.ts` defining `ClientTrainingPlan` (planId, planName, cycleLength, restPattern, sessions[]; each session: id, name, focus, orderIndex, isRest, estimatedDurationMinutes, exercises[]; each exercise: id, name, orderIndex, sets, repsMin/repsMax/repsTarget, rpeTarget, tempo, restSeconds, isWarmup, supersetGroup).
- New API route `app/api/client/training-plan/route.ts` (GET): full auth chain per CONVENTIONS §8 (rate limit + auth + service call wrapped in try/catch). Response shape `{ success, data: ClientTrainingPlan | null }` with `Cache-Control: no-store`.
- New page `app/client/program/training/page.tsx`: SWR fetch from `/api/client/training-plan`; same skeleton/error/empty patterns as `/client/program`. Renders the plan name as `<h1>`, then a list of `<TrainingSessionRow>` components ordered by `orderIndex`. Each row expands inline on click.
- New component `components/client-portal/program/training-plan-card.tsx`: renders on `/client/program` below the phase list. Header line: plan name + session count. Body: horizontal chip row of the cycle sequence (rest slots render with a different chip style). Wrap the whole card in a `<Link href="/client/program/training">`.
- New component `components/client-portal/program/training-session-row.tsx`: row with name + focus + duration + chevron. Local `useState` for expanded. Expanded body lists exercises with sets/reps/RPE; reuse the marker/typography conventions from `phase-list-item.tsx`.
- Update `app/client/program/page.tsx` to fetch (independent SWR call) and render `<TrainingPlanCard />` below the existing `<PhaseListItem />` list.
- Verify all consumers of `getClientProgram` if the resolution helper is moved or refactored (per CONVENTIONS §10 "API changes cascade"). The expected consumers as of Session 2.5 extension are: `app/client/program/page.tsx`, `services/client-day-service.ts:24`, `app/api/client/program/route.ts`.

**Do NOT**: Build any editing or activation UI (clients are read-only). Do not surface calendar events (that's the home page's job). Do not duplicate the coach-side `phase-card.tsx` styling; use light Tailwind tokens per CONVENTIONS §3 + ARCHITECTURE.md line 357. Do not change the calendar source of truth.

**Tests to write**:
- `services/client-training-plan-service.test.ts`: returns the plan with sessions and exercises when an active plan exists for an active phase; returns `null` when no active phase; returns `null` when an active phase has no linked plan.
- `app/api/client/training-plan/route.test.ts`: 200 with data, 200 with null, 401 unauthenticated.
- `components/client-portal/program/training-plan-card.test.tsx`: renders the cycle sequence chips in order; rest chips render with the "Rest" label even when the underlying session has a placeholder name.
- `components/client-portal/program/training-session-row.test.tsx`: collapsed renders name + chevron; expanded reveals exercises with sets/reps; click toggles `aria-expanded`.
- `app/client/program/training/page.test.tsx`: renders skeleton while loading; renders empty state when API returns null; renders sessions list when data is present.

**Verify**: `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`. Manual: as a client with an active PPL+Rest plan, visit `/client/program`, confirm the card shows the cycle, tap into `/client/program/training`, expand each row to confirm exercises render with prescribed numbers. Confirm a client with no active plan sees the empty state on the drill-in page and no card on the program page. Commit.

---

## Session 2.9: Nutrition plan overview card + drill-in

**Status**: COMPLETE

**Mid-session deviations from spec**:
- **2-day rest/training summary replaced with a 7-day reuse of `VerticalNutritionView`.** The spec proposed `restDayTargets` + `trainingDayTargets` on the card and on the drill-in, with the training-day target computed from the highest `calorie_surplus_percentage` across the active training plan's sessions. Investigation found that model lies about real data: `training_sessions.calorie_surplus_percentage` is per-row (Monday's leg session and Friday's upper session legitimately carry different values), `nutrition_plan_daily_targets` allows per-day calorie overrides, and `custom_macros_enabled` overrides the diet-type split. A single "max surplus" number would have been wrong for many real clients. The existing `/client/nutrition` page already renders the correct 7-day breakdown via `VerticalNutritionView` (and that page is being replaced as a logging surface in Session 3.2 anyway), so the drill-in at `/client/program/nutrition` reuses the same component. After 3.2, the 7-day target view lives only here; no duplication.
- **Card collapsed to title-only.** Per user direction during planning ("just label it Nutrition plan and follow the same UX flow as training"). The card is `Nutrition plan` + chevron with no subtitle. The training card was edited in the same session to drop its cycle chips so both cards render at identical height as a visual set (recorded as a post-2.9 amendment on the Session 2.8 entry above).
- **No new service file or response type.** Spec called for `services/client-nutrition-plan-service.ts` and a new `ClientNutritionPlan` type. The API route reuses `services/client-portal-service.ts:getClientNutritionTargets` directly and returns the existing exported `NutritionTargets` shape. Reasoning: the existing service already composes plan + daily targets + training plan + training events + client flags via `buildDailyTargetsFromPlan`. Duplicating that orchestration (~50 lines) into a parallel service would have given us two places to maintain a single piece of logic.
- **Two known trade-offs accepted, logged as TECHNICAL-DEBT.** (1) `getClientNutritionTargets:77` calls `promoteNutritionPlanIfReady`, which means our GET inherits a potential write (lazy plan promotion). For our use case this is actually desirable — without it, a client whose planned plan flipped active today would see the old plan on the card until they hit some other nutrition endpoint. (2) The reused service uses the legacy session-scoped `createPortalClient` rather than `supabaseAdmin` per CONVENTIONS §8. Functionally identical for our access pattern (both `.eq("client_id", clientId)` with a `requireClientAuth`-verified id). Both are tracked under TECHNICAL-DEBT.md → Auth Architecture Hygiene H2 as a single "pure-composer refactor" item; the right structural fix factors `composeNutritionTargets(plan, ...)` out of the legacy service so callers can pick `promote+fetch+compose` vs `fetch+compose` (admin-scoped). Out of scope for 2.9.
- **`nutrition_plans.name` not surfaced.** Grepping confirmed the create/update path in `services/nutrition-plan-service.ts` and `lib/validations/nutrition.ts` never writes `name`, so every existing row has `name = NULL`. The card title and the drill-in `<h1>` use the literal `"Nutrition plan"` rather than `plan.name ?? "Nutrition plan"`. If the create path eventually starts writing `name`, this will need a follow-up to expose `planName` on the response and use it in the UI (mirroring the training card's `plan.planName` pattern).

**Commit message**: `feat(client-portal): add nutrition plan overview card on program page with day-type drill-in`

**Objective**: Surface the client's active nutrition plan on `/client/program` as a read-only card below the training plan card. The card shows at a glance: rest-day macro target and training-day macro target (calculated via the existing percentage-surplus model). Tapping the card navigates to `/client/program/nutrition` showing per-day-type detail (calories, protein, carbs, fat, diet type, surplus percentage source).

**Read first**:
- `services/nutrition-plan-service.ts` and `services/nutrition-event-service.ts` (current plan + event reads).
- `services/training-event-service.ts` (how training events drive surplus on a given date).
- `utils/nutrition-helpers.ts` (`calculateDailyMacros`, `weightFromKg`, `DailyNutritionTargets`).
- `types/nutrition.ts` (or the nearest equivalent for plan + event shapes).
- ARCHITECTURE.md, section "Nutrition & Training Events", especially the percentage-surplus model and the "Display total: baseline * (1 + surplus/100)" rule.
- `app/client/nutrition/page.tsx` (existing per-day nutrition view). Do NOT duplicate its day-detail logic; this card is plan-level, not day-level.
- `components/client-portal/program/training-plan-card.tsx` (built in Session 2.8; style baseline).
- `docs/CLIENT-PORTAL-REDESIGN.md` (any sections on nutrition surfacing for clients).

**Plan (report before implementing)**:
- How to compute a representative "training day" target without picking a specific date. Options: (a) use the active phase's nutrition plan baseline plus the highest `calorie_surplus_percentage` across its linked training sessions, (b) use the plan's `default_surplus_percentage`, (c) compute an average across the cycle. Pick one and document the choice in the prompt response before coding. Recommendation: use the highest non-null `calorie_surplus_percentage` from any training session linked to the active phase's training plan, since that represents the upper-bound target the client will see during the cycle. If no training plan or no surplus values exist, omit the training-day block from the card.
- Whether to expose `include_activity_burn` to the client. The toggle exists per-client; the display value depends on it. For v1, read the client's existing toggle value and reflect it; do not surface a UI control.

**Implement**:
- New service: `services/client-nutrition-plan-service.ts` exporting `getClientNutritionPlan(clientId: string): Promise<ClientNutritionPlan | null>`. Resolution: find the active phase, then the nutrition plan linked to that phase, then compute `restDayTargets` from the plan's baseline and `trainingDayTargets` from the chosen surplus value via `calculateDailyMacros`. Honor the client's `include_activity_burn` flag for the display total.
- New type `types/client-nutrition-plan.ts` defining `ClientNutritionPlan` (planId, planName, dietType, restDayTargets: { calories, proteinG, carbsG, fatG }, trainingDayTargets: same shape or null, surplusPercentage: number | null, includeActivityBurn: boolean).
- New API route `app/api/client/nutrition-plan/route.ts` (GET): same auth chain as Session 2.8. Response `{ success, data: ClientNutritionPlan | null }` with `Cache-Control: no-store`.
- New page `app/client/program/nutrition/page.tsx`: SWR fetch; renders plan name, diet type, and two side-by-side blocks for Rest day vs Training day with calorie + macro values (use `font-mono-display` for numbers).
- New component `components/client-portal/program/nutrition-plan-card.tsx`: card on `/client/program` showing plan name + compact two-line macro preview (Rest: 2400 kcal · 180p / 240c / 80f, Training: 2700 kcal · 180p / 300c / 90f). Wrap in `<Link href="/client/program/nutrition">`.
- Update `app/client/program/page.tsx` to fetch (independent SWR call) and render `<NutritionPlanCard />` below the training plan card.

**Do NOT**: Surface per-day events on the plan page (that is `/client/nutrition` for the day). Do not allow editing. Do not duplicate the macro math; call `calculateDailyMacros` from `utils/nutrition-helpers.ts`. Do not introduce a new percentage-surplus model; read the existing field.

**Tests to write**:
- `services/client-nutrition-plan-service.test.ts`: returns plan with both rest-day and training-day targets when an active plan plus training plan with surplus exist; returns plan with `trainingDayTargets: null` when no training surplus is set; returns `null` when no active phase or no nutrition plan.
- `app/api/client/nutrition-plan/route.test.ts`: 200 with data, 200 with null, 401 unauthenticated.
- `components/client-portal/program/nutrition-plan-card.test.tsx`: renders both day-type blocks when both targets present; renders only rest-day block when training-day is null.
- `app/client/program/nutrition/page.test.tsx`: skeleton, empty state, populated state with macros visible.

**Verify**: `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`. Manual: as a client on a percentage-surplus plan, confirm the card shows realistic rest plus training macros, tap into `/client/program/nutrition`, confirm the detail page renders the same numbers and diet type. Toggle the client's `include_activity_burn` flag (via coach view or DB) and confirm the displayed training-day total changes accordingly without regenerating events. Commit.

---

## Session 3.1: Shared day-log helpers + nutrition/wellness endpoints

**Status**: COMPLETE (commit `22a4328`)

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
   - `assertCanEdit({ clientId, date, resourceType }): Promise<void>` where `resourceType: 'nutrition' | 'wellness' | 'habit' | 'training'` — server-side wrapper. Loads the client's timezone and current log state for the resource, calls `canEditDay`, throws a typed error (e.g. `DayLockedError`) on violation. Route handlers catch and return 403. The `'training'` variant is reserved for Session 5.3's writer — defense-in-depth for direct API callers, since the Session 2.4 post-merge follow-up makes the home day-view card-blocking the primary protection.

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

## Session 3.1B: Server-side no-plan rejection in per-card writers

**Status**: COMPLETE (commit `565acef`)

**Commit message**: `feat(client-portal): reject per-card writes when no active plan`

**Objective**: Stop the per-card writers from creating orphan logs (`phase_id`/`nutrition_plan_id`/`training_plan_id` = null → null adherence in the attention feed, excluded from phase reviews). One root-cause fix at the API perimeter that covers every reachable surface — web harness, RN client, direct API callers — without depending on any UI gate to hold.

**Background / supersedes the original 3.1B (2026-05-27)**: The first draft of 3.1B was a three-prong plan: client home-card UX, coach activation-dialog UX, and an activate-endpoint gate. It's been scoped down because (a) the web app is a test harness, not the real client ([[project_webapp_is_harness_rn_is_real_client]]) — investing in home-card UX before the RN build sets the production navigation surface is premature; (b) the activate-endpoint gate is belt-and-braces on top of a UI fix coaches already comply with via `activation-readiness`; (c) the actual invariant we care about — "no log row exists with null plan ids" — lives at the per-card writers, so gating there once makes the UI prongs optional polish. Today the two writers (nutrition, wellness) call `resolvePlanContextForDate` and pass the nullable ids straight into the upsert with no rejection — so a no-plan client who reaches the endpoint (web direct nav or direct API) creates the exact orphan row the original 3.1B was meant to prevent.

**Prerequisites**: Session 3.1 (`resolvePlanContextForDate` + per-card writers).

**Read first**:
- `services/daily-context-service.ts` (`resolvePlanContextForDate` — `phaseId` / `nutritionPlanId` / `trainingPlanId` are all nullable).
- `app/api/client/daily-logs/[date]/nutrition/route.ts`, `…/wellness/route.ts` (current call sites; no plan-presence check between resolver and upsert).
- `lib/daily-log-permissions.ts` (`assertCanEdit`, `DayLockedError` — the sibling perimeter pattern this mirrors; keep the two concerns separate).

**Plan (report before implementing)**:
- Per-writer rejection condition — recommend one rule per writer, matching the field that would otherwise be orphaned:
  - nutrition writer: reject if `ctx.nutritionPlanId == null`.
  - wellness writer: reject if `ctx.phaseId == null` (wellness logs link via phase, not a plan id).
  - training writer (when Session 5.3 builds it): reject if `ctx.trainingPlanId == null` once 5.3 introduces the active-plan fallback for training.
- Helper shape. Recommend `assertHasActivePlan(ctx, resource)` + `NoActivePlanError` colocated with `resolvePlanContextForDate` in `services/daily-context-service.ts` — keeps the invariant adjacent to the data it asserts on. Routes catch `NoActivePlanError` → **422** `{ success: false, error: "No active plan for <resource>" }`.
- Do not also gate the activate endpoint or the activation dialog. The readiness route stays advisory; coaches stay free to activate without plans, and the server-side perimeter here is what actually prevents orphans.

**Implement**:
1. In `services/daily-context-service.ts`: add `NoActivePlanError` (subclass of `Error`) and `assertHasActivePlan(ctx: PlanContextForDate, resource: "nutrition" | "wellness" | "training"): void` that throws when the resource's id field is null.
2. In `app/api/client/daily-logs/[date]/nutrition/route.ts` and `…/wellness/route.ts`: call `assertHasActivePlan(ctx, "<resource>")` immediately after `resolvePlanContextForDate`, before the upsert. Add a catch arm for `NoActivePlanError` returning 422.
3. **Cross-reference in Session 5.3**: add a one-line note in 5.3's "Read first" / "Implement" telling the training writer to call `assertHasActivePlan(ctx, "training")` once it has `resolvePlanContextForDate` populating `trainingPlanId` from the active plan.
4. **Remove the "⚠️ Scheduled change (Session 3.1B)" note from `docs/ARCHITECTURE.md` "Activation Flow"** (the bullet currently at the section's intro) — the activate-endpoint gate is no longer planned. Leave `hasActivePhase` in the "Recommended" group; `activation-readiness` stays advisory.

**Do NOT**: Build any home-card UX changes (`app/client/page.tsx`, card-summary components). Modify `POST /api/clients/[id]/activate`, `activation-readiness`, or `client-activation-dialog`. Add a `hasActivePlan` field to `DaySummary` (the read path is unaffected). Touch `assertCanEdit` — date rules and plan rules stay separate concerns. Reject reads — `/api/client/day-summary` and the swipe timeline stay open.

**Tests to write**:
- `services/daily-context-service.test.ts`: unit-test `assertHasActivePlan` — throws for each resource when its id is null, no-ops when present.
- `app/api/client/daily-logs/[date]/nutrition/route.test.ts`: add a case where `resolvePlanContextForDate` returns `{ phaseId, nutritionPlanId: null, trainingPlanId }` → response is 422 with the expected error shape and `upsertNutritionLog` is not called.
- `app/api/client/daily-logs/[date]/wellness/route.test.ts`: same, with `phaseId: null` → 422, `upsertWellnessLog` not called.

**Verify**: `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`. Manual: as a client with no active phase, POST `/api/client/daily-logs/2026-05-27/nutrition` with any valid body → 422 `No active plan for nutrition`. Commit.

---

## Session 3.2: Nutrition detail page

**Status**: COMPLETE (commit `9863963`)

**Commit message**: `feat(client-portal): add nutrition detail page with macro entry`

**Objective**: Build `/client/nutrition`: numeric inputs for kcal + P/C/F, save, target progress bars.

**Read first**:
- Output of Session 3.1.
- `docs/CLIENT-PORTAL-REDESIGN.md` (Nutrition scope).
- `docs/newdesignsystem.md`.

**Implement**:
- `app/client/nutrition/page.tsx` with `date` query param.
- Four numeric inputs (kcal, protein, carbs, fat).
- Vs-target progress display.D
- Save to `PATCH /api/client/daily-logs/[date]/nutrition`.
- Loading, error, and locked (past-logged) states. **No future-day view-only state** — the Session 2.4 post-merge follow-up makes the home day-view cards non-clickable for future dates, so this page is unreachable for future dates via the UI navigation surface.
- **Import `canEditDay` from `lib/daily-log-permissions.ts`** (Session 3.1) to derive `isLocked` for the UI. Do not compute the rule locally with date math — single source of truth.

**Do NOT**: Add meal or food logging. Reimplement the date-edit rule; always import from the shared helper. Add future-day view-only UI (the navigation block from Session 2.4 covers it; server-side `assertCanEdit` covers direct API callers).

**Tests to write**:
- `app/client/nutrition/page.test.tsx`:
  - Renders with existing log values prefilled.
  - Save submits correct payload.
  - Locked state disables inputs and shows notice.
  - Error toast on save rejection.

**Verify**: Happy path + lock path. `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`. Commit.

---

## Session 3.3: Wellness detail page + past-day lock enforcement

**Status**: COMPLETE (commit `0096421`; detail-page cache-staleness fix in `aa9ce3b`)

**Commit message**: `feat(client-portal): add wellness detail page with past-day lock`

**Objective**: Build `/client/wellness` with mood/energy/sleep/stress inputs. Solidify the past-day lock UX pattern used across detail pages (logged days display-only). The `canEditDay` helper from Session 3.1 returns false for past-logged; `locked-day-notice.tsx`'s `reason` prop discriminates the copy (`past-logged` / `today-no-plan`).

**Background**: The day-summary route already accepts past + today + future dates without bounds (no past-cap, no future-rejection — write-side bounds belong to `canEditDay`, not the read path). Session 2.4 final fix enforced this read-side openness; the Session 2.4 post-merge follow-up made the home day-view cards non-clickable for future dates, so future-date detail pages are unreachable via the UI navigation surface. Session 3.3 is where the past-day write-side and UI-side enforcement land, with `canEditDay` as the single source of truth used by every detail page.

**Read first**:
- Output of Sessions 3.1 + 3.2.
- Existing Daily Pulse wellness input components (lift reusable primitives).
- `docs/CLIENT-PORTAL-REDESIGN.md` (Date edit rules).

**Implement**:
- `app/client/wellness/page.tsx` with mood/energy/sleep/stress inputs (reuse primitives).
- Save to `PATCH /api/client/daily-logs/[date]/wellness`.
- Import `canEditDay` from `lib/daily-log-permissions.ts` (Session 3.1) for `isLocked` state. Do not duplicate date math in the page.
- `components/client-portal/day/locked-day-notice.tsx`: **single component** with a `reason: 'past-logged' | 'today-no-plan'` prop that switches copy. Do NOT create separate variant components. Reuse in nutrition page.

**Tests to write**:
- Wellness page: renders with values, save correct payload, locked state.
- `locked-day-notice.test.tsx`: correct copy renders for each `reason` value.

**Verify**: Happy + lock for both pages. `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`. Commit.

---

## Session 3.4: Client metrics hub + Performance view + nav swap

**Status**: COMPLETE (commits `0343aef`, `c3f3013`, `5d17874`, `c2bc944`)

**Commit message**: `feat(client-portal): add client exercise-analytics API + performance view` (lead commit; see list below)

**What shipped vs. the original plan**: The original 3.4 spec was a standalone `/client/exercise-history` page with a single weight chart + PR callout cards. What actually shipped is broader and supersedes that page: a **client metrics hub** at `/client/metrics` (Embla swipe between 4 tabs) whose **Performance** tab carries the client-facing exercise analytics the standalone page would have held. The original API deliverable landed unchanged; the page wrapper became a hub tab. There is **no** standalone `/client/exercise-history` route — do not build one.

**Shipped (4 commits)**:
- `0343aef` — **Client exercise-analytics API** `GET /api/client/training/exercise-history` (`clientApiRateLimit` + `getAuthenticatedClientId`, scoped to the authed client, `Cache-Control: no-store`, `metric=list|progression|prs`) reusing the Session 1.8 service functions directly — no new service layer. Plus the **Performance view** that consumes it.
- `c3f3013` — **`/client/metrics` hub**: Embla-swipe shell with 4 tabs (Performance among them). **Nav swap** (Check-in → Metrics in the bottom tab bar) and a home **"Weekly check-in"** card so check-in stays one tap away after losing its tab slot.
- `5d17874` — **unit-resolution fix**: `getClientProgressData` was selecting a non-existent `clients.measurement_unit`, silently nulling units/goals so all kg clients saw "lbs". Now reads `weight_unit` + derives the measurement unit from `unit_preference`. (Session 3.9 builds its render-ready-series work on top of this fix.)
- `c2bc944` — **chart-viz relocation** to a neutral tier (`components/training/exercise-data/`, `components/metrics/`, `components/client-portal/metrics/`) so coach and client surfaces share one chart implementation instead of forking it.

**Carried-forward design decisions** (still the RN reference):
- Client analytics are **motivational-framed and reduced** vs. coach-side: weight progression + PRs + consistency only — **no** e1RM / volume / RPE / compliance toggle (coach-level analytics).
- The hub is the destination; per-exercise history is reached **inside** the Performance tab, not via a separate top-level route or bottom-tab entry.

**Do NOT** (still binding): Build a standalone `/client/exercise-history` page or add it to the bottom tab bar. Re-expose coach-only metrics (e1RM/volume/RPE/compliance) to clients. Fork a second client chart component — the neutral-tier viz from `c2bc944` is shared.

**Tests**: API route (`metric=list|progression|prs` scoped to authed client, 401), Performance view render + empty states, and the unit-resolution regression all shipped green with the commits above.

**Verify**: shipped green at each commit (`tsc`, `eslint`, `vitest`). Manual: client opens `/client/metrics`, swipes to Performance, sees own trends + PRs in the correct unit.

---

## Phase 3 Scale hardening (3.5–3.10): why these exist

The web app is a logic/API test harness; the React-Native app is the real client. So these sessions harden the layer native actually depends on — the services, the queries, the indexes, and the API payloads — and explicitly do NOT invest in web render performance (lazy-mounting, memoization, chart animations, list virtualization, Recharts pinning, polling visibility-gates), which dies with the harness. Transport-level mobile contract (response-shape consistency, `Cache-Control`, bearer-token auth, API versioning) is owned by Phase 9 "Mobile prep" (9.5–9.8); these sessions are the data-shape and data-volume complement. Per product-owner direction, where a CONVENTIONS rule blocks a needed performance change, the change wins and the deviation is flagged in the session (e.g. §2's "no caching unless requested"). Scope is the **client app only**; coach-platform scale is a separate audit.

---

## Session 3.5: Scale test fixtures + performance baseline

**Commit message**: `test(client-portal): add year-scale client seed + query performance baseline`

**Objective**: Measure before optimizing. Add a repeatable seed that loads a representative year+ of one client's data and capture a baseline of the hot client read paths (rows fetched, payload bytes, wall-clock) so Sessions 3.6–3.10 can prove improvement and guard regressions. The measurement target is the API/service/DB layer, not web render.

**Read first**:
- `services/exercise-analytics-service.ts`, `services/client-portal-progress.ts`, `services/daily-logs-service.ts`, `services/daily-habits-service.ts` (the hot read paths to baseline).
- `supabase/migrations/` (shapes for session_logs, exercise_logs, set_logs, check_ins, daily_logs, daily_habit_logs).
- `scripts/` (existing script conventions); `vitest.config.ts`.

**Plan (report before implementing)**:
- Where the seed lives (`scripts/seed-scale-client.ts` or a guarded SQL file) and its params (clientId, months of history, sessions/week).
- Year-scale target volumes (e.g. ~200 sessions, ~1,200 exercise_logs, ~5,000 set_logs, ~52 check-ins, ~365 daily logs, N habits × 365 logs).
- How baselines are captured and where committed (`docs/perf-baseline.md`): rows-fetched + duration + serialized bytes per hot function.
- Whether budgets become assertions now or after 3.6 sets the new ceiling (recommend: record now, assert from 3.6).

**Implement**:
1. Idempotent seed (clean + reseed) for a target test client at year-scale volumes; guarded to a non-prod project.
2. Measurement harness (script or `*.perf.test.ts`) recording, per hot path (`getClientExerciseList`, `getExerciseProgressionSeries`, `getExercisePRs`, `getClientProgressData`, `calculateStreaks`, `getHabitLogs`): rows fetched, duration, payload bytes.
3. Commit `docs/perf-baseline.md` as the "before" snapshot.

**Do NOT**: Optimize anything yet (3.6+). Run the seed against production. Add any web-render perf work.

**Tests to write**:
- The harness is the deliverable; assert it runs and emits numbers. No business-logic tests here.

**Verify**: Seed the linked test project, run the harness, confirm `docs/perf-baseline.md` captures before-numbers. `npx tsc --noEmit`, `npx eslint .`. Commit.

---

## Session 3.6: Exercise analytics — SQL aggregation + windowing + indexes

**Status**: COMPLETE

**Commit message**: `perf(training): push exercise analytics aggregation into SQL with windowed reads`

**Objective**: Remove the dominant scale risk. `exercise-analytics-service` pulls a client's entire history (session_logs + exercise_logs + set_logs) into Node then aggregates/sorts/`.slice(-12)`s in memory. Rewrite the three functions to push GROUP BY / windowed LIMIT / MAX-aggregates into Postgres so reads are bounded by the result, not by career history. Shared with coach Sessions 1.8/1.9 and future 7.7 — return types must stay identical.

**Read first**:
- `services/exercise-analytics-service.ts` (`fetchExerciseLogsForClient` unbounded read; `.slice(-limit)` at the tail).
- `utils/exercise-analytics-helpers.ts` (Epley + identity resolution — reuse).
- `types/training.ts` (`ExerciseListItem`, `ExerciseProgressionPoint`, `ExercisePR` — the frozen contract).
- `supabase/migrations/` (confirm index coverage); CONVENTIONS §8 (migration workflow).
- `docs/perf-baseline.md` (Session 3.5 before-numbers).

**Plan (report before implementing)**:
- Confirm current index coverage (`supabase migration list` + grep) and the gaps. Likely add `exercise_logs(session_log_id)` (if absent), `exercise_logs(exercise_id) WHERE exercise_id IS NOT NULL`, and a **session-grain keyset index** `session_logs(client_id, completed_at DESC, id DESC)` (extends the existing `session_logs(client_id, completed_at DESC)` with an `id` tiebreak so cursor reads are stable when two sessions share a `completed_at`); verify `set_logs(exercise_log_id)` exists.
- SQL design per function: **list** → aggregate over the client's logs (`GROUP BY` resolved identity, `COUNT(*)`, `MAX(completed_at)`, most-recent `performed_name`); **progression** → resolve target exercise → most-recent N sessions (`ORDER BY completed_at DESC LIMIT N`) → fetch set_logs only for those → aggregate per session; **PRs** → `MAX(weight) … GROUP BY reps` over the target's set_logs.
- Exercise/session **history pagination is keyset, not offset**: page on the cursor `(completed_at, id)` against the keyset index above, never `.range()`/`OFFSET`. Offset cost grows with how deep the client scrolls into a multi-year history; keyset stays flat. The most-recent-N window above is the first keyset page; "load older" pages from the last `(completed_at, id)` seen. (Mirrors the check-in keyset conversion in Session 3.7 and the bounded-AND-keyset contract in Session 3.9.)
- Postgres functions via `supabase.rpc(...)` (recommended for the multi-join aggregates) vs tightened PostgREST queries; RPC return types flow into `types/database.ts` via `gen types`.
- Preserve the dual identity union (`exercise_id` / `training_exercise → exercise_id` / `LOWER(performed_name)` fallback) in SQL.

**Implement**:
1. Migration: index gaps + RPC function(s) for list/progression/prs. Follow §8 (next migration number → `db push` → `gen types` → commit migration + types together).
2. Rewrite the three service functions to call the RPCs/windowed queries and map to the existing return types (Epley/identity helpers applied to the bounded result).
3. Confirm both routes (`/api/clients/[id]/training/exercise-history`, `/api/client/training/exercise-history`) are unchanged at the contract level.

**Do NOT**: Change the three return-type shapes (both audiences depend on them). Hand-edit `types/database.ts`. Leave any in-memory full-history fetch in place. Touch web-render code.

**Tests to write**:
- `services/exercise-analytics-service.test.ts` (extend): the Session 1.8 behavioral assertions (ordering, Epley on best-e1RM set, top-set, PR-by-reps, dual identity, `isRecent`, sessionCount window) now passing against the SQL-backed implementation; mock the RPC/Supabase per the test-layer boundary.
- Perf-budget (3.5 harness on the seeded client): progression fetches ≤ N sessions' set_logs regardless of history; list/PRs don't pull full history. Update `docs/perf-baseline.md` with after-numbers.

**Verify**: Run the 3.5 harness on the year-scale client; confirm rows-fetched + payload drop to result-bounded. `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`. Commit.

---

## Session 3.7: Read-path hot spots — streak, check-in counts, check-in context

**Status**: COMPLETE

**Commit message**: `perf(client-portal): aggregate streak + check-in counts, trim check-in context reads`

**Objective**: Remove the remaining unbounded / N+1 / multi-call client read paths from the audit: `daily-logs-service.calculateStreaks` scans a full year + nested `.some()` loop (O(D²)); `check-in-service.enrichWithDailyLogCounts` fires one COUNT per check-in (N+1); `GET /api/client/check-in-context` fans out to ~5 sequential/parallel DB calls on the check-in form open. Replace the first two with bounded SQL and consolidate/streamline the third. Also convert `check-in-service.getClientCheckIns` from **offset (`.range()`) to keyset** pagination so the mobile history list pages on a stable cursor.

> **Judgment note on the check-in keyset conversion**: check-ins are low-cardinality (roughly weekly), so a client's list is dozens of rows, not thousands — offset is not actually hot here. This conversion is mainly **mobile-contract consistency** (every client history list pages the same keyset way, matching Sessions 3.6 and 3.9), not a performance fix. Worth doing for a uniform native contract, but don't frame it as a P0 hot-path win.

**Read first**:
- `services/daily-logs-service.ts` (`calculateStreaks`), `services/check-in-service.ts` (`enrichWithDailyLogCounts`, `getClientCheckIns` — the `.range(offset, …)` at ~line 148).
- `app/api/client/check-in-context/route.ts` (the ~5-call fan-out) + the context services it calls.
- `app/api/client/daily-logs/streak/route.ts`, `app/api/client/check-ins/route.ts` (consumers; the check-ins route is the keyset cursor's caller).
- `docs/perf-baseline.md`.

**Plan (report before implementing)**:
- Streak: SQL gaps-and-islands for current + longest in one bounded query (preferred); maintained `clients.current_streak`/`longest_streak` columns noted as the escalation only if still hot.
- Check-in counts: one grouped query for the page's check-ins instead of N COUNTs.
- check-in-context: which of the ~5 calls can be merged, parallelized further, or short-TTL cached (training/nutrition context rarely changes intra-week). Decide consolidate-vs-cache; do not regress gating correctness.
- Check-in keyset: add index `check_ins(client_id, created_at DESC, id DESC)`; page on the cursor `(created_at, id)` and convert `getClientCheckIns`'s `.range(offset, …)` to a keyset predicate (`WHERE (created_at, id) < (cursorCreatedAt, cursorId)` for "older", `LIMIT n`). Decide the cursor wire format (opaque base64 of the tuple vs. two params) and keep it consistent with the 3.6 progression cursor. *(Per the judgment note above: consistency-driven, not a hot fix.)*
- Confirm `daily_logs(client_id, date)` index exists.

**Implement**:
1. Rewrite `calculateStreaks` to one bounded SQL computation (no full-year in-memory loop).
2. Rewrite `enrichWithDailyLogCounts` to a single grouped query for the batch.
3. Trim `check-in-context` fan-out (merge/parallelize, optional short-TTL cache for the slowly-changing context pieces).
4. Convert `getClientCheckIns` from `.range()` offset to keyset on `(created_at, id)` with the new index; update the `/api/client/check-ins` route to accept/emit the cursor instead of an offset/page param.
5. Keep all response shapes identical apart from the check-ins pagination param swapping offset→cursor (consumers updated per §10 API-cascade).

**Do NOT**: Change response shapes (other than the documented check-ins offset→cursor pagination swap). Pre-build a write-path streak trigger (note as escalation only). Weaken check-in gating correctness for fewer calls. Touch web-render.

**Tests to write**:
- `services/daily-logs-service.test.ts` (extend): streak — no logs, single day, broken streak, current vs longest, year boundary.
- `services/check-in-service.test.ts` (extend): counts correct across varying periods; one query issued, not N (assert mock call count); `getClientCheckIns` keyset — first page returns newest N, a follow-up cursor returns the next-older page with no overlap/gap, and same-`created_at` rows are split deterministically by the `id` tiebreak.
- `app/api/client/check-in-context/route.test.ts` (extend): gating statuses unchanged after consolidation; fewer DB round-trips.
- `app/api/client/check-ins/route.test.ts` (extend): route pages by cursor and returns the next cursor.
- Perf-budget: streak no longer year-scans in Node; check-in list issues O(1) count queries; context call-count reduced. Update baseline.

**Verify**: 3.5 harness; `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`. Commit.

> Bundles three cohesive read-path fixes in one commit; if check-in-context consolidation grows large, split it into its own commit within the session.

---

## Session 3.8: Per-request auth resolution caching

**Status**: COMPLETE

**Commit message**: `perf(auth): cache user→client resolution to drop redundant per-request lookups`

**Objective**: Every client API request runs `getAuthenticatedClientId`, which validates the JWT via `supabase.auth.getUser()` (kept) **and** does a `clients` lookup to map `user_id → client_id`. Across a multi-request page that's N redundant lookups. Cache the mapping so the per-request DB hit goes away — without weakening auth.

**Read first**:
- `lib/auth-helpers.ts` (`getAuthenticatedClientId`), `lib/require-client-auth.ts`.
- `lib/rate-limit.ts` (existing Upstash Redis — reuse the infra).
- CONVENTIONS §9 (getUser mandatory; never getSession).

**Plan (report before implementing)**:
- Cache layer: short-TTL Upstash keyed by `user_id`. Note: each App-Router route is a separate request, so per-request memo doesn't help across the page's parallel calls — a short-TTL shared cache is the lever.
- Invalidation: TTL-only (the mapping effectively never changes); document it.
- `getUser()` stays on every request — only the `clients` row lookup is cached.

**Implement**:
1. Cached `user_id → client_id` resolver (Upstash get/set + TTL) used by `getAuthenticatedClientId`.
2. Leave the `getUser()` call unchanged.

**Do NOT**: Replace `getUser()` with `getSession()` (§9 — security). Cache the JWT/auth result itself. Touch web-render.

**Tests to write**:
- `lib/auth-helpers.test.ts` (extend): second call returns cached client id without a second DB lookup (assert via mock); cache miss falls back to DB; null user → null (unchanged).

**Verify**: `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`. Commit.

> **CONVENTIONS override (authorized):** §2 "don't add caching strategies unless explicitly requested" — explicitly requested for scale. §9's `getUser()` requirement is **honored**, not overridden.

---

## Session 3.9: Render-ready payloads + bounded/keyset contract + exercise catalog delta-sync

**Status**: COMPLETE

**Commit message**: `refactor(api): render-ready client payloads + bounded/keyset contract + exercise catalog delta-sync`

**Objective**: Native should be a thin renderer. Today some shaping happens in web React (e.g. `useClientProgressMetrics` builds chart series in the browser). Move that aggregation server-side so the API returns small, render-ready, bounded payloads both the web harness and native consume identically. Audit every client list/history endpoint is bounded AND keyset, add an exercise-catalog delta-sync endpoint so native caches the dictionary locally and history rows carry IDs not embedded dictionaries, and codify the conventions so future sessions stay scale-safe.

**Read first**:
- `hooks/use-client-progress-metrics.ts` (the transform to move server-side).
- `services/client-portal-progress.ts`, `app/api/client/progress/route.ts`.
- `services/exercise-analytics-service.ts` + the exercise-history routes (the ID-first-history change lands on their row shape) and the `exercises` catalog table (`id, name, muscle_group, category, equipment, aliases, coach_id, updated_at`).
- The Phase-3 scale audit's bounded-or-not table for `/api/client/**`.
- `docs/CLIENT-PORTAL-REDESIGN.md` (where conventions live).
- Phase 9 sessions 9.5–9.8 (avoid overlap: shape consistency / no-store / bearer auth / versioning).

**Plan (report before implementing)**:
- Which transforms move server-side now (progress metric series is the clear one) vs stay client-side. Decide `/api/client/progress` returns chart-ready `{ bodyMetrics, wellnessMetrics }` so native doesn't reimplement the hook.
- Per-endpoint bounded sweep: confirm each client list/history endpoint has limit/window/**cursor (keyset)**; bound any that still return everything and re-key any offset pager to keyset (most already do — closing sweep, building on 3.6/3.7).
- **Exercise catalog delta-sync**: design `GET /api/client/exercises/catalog?since=<ISO|updated_at cursor>` returning the lean dictionary rows `{ id, name, muscle_group, equipment, updated_at }` changed since `since` (omit `since` → full dictionary for first sync). Native caches this locally and refreshes by delta. Pairs with **ID-first history**: exercise/session history rows return `exercise_id` (native joins to its cached catalog) and keep `performed_name` only as a fallback for legacy/freehand rows — history rows never embed the catalog dictionary.
- **Sparse fieldsets**: history/list endpoints select only the columns the row needs (never `select('*')`, never an embedded dictionary join inside a row list). RPC rowtypes stay narrow — the catalog dictionary is fetched once via the catalog endpoint, not re-sent per history row.
- The conventions to document: **bounded AND keyset by default** (was "bounded-by-default"); server-side aggregation / render-ready payloads; index-with-the-query; ID-first rows + client-side dictionary (catalog delta-sync); sparse fieldsets / narrow RPC rowtypes.

**Implement**:
1. Move progress metric-shaping into the service; `/api/client/progress` returns render-ready series. Update the web consumer (`useClientProgressMetrics` becomes a thin reader or is removed) and its tests — per §10 API-cascade.
2. Bound/keyset any remaining unbounded or offset-paged client list/history endpoint from the audit.
3. Add the `GET /api/client/exercises/catalog?since=` delta-sync endpoint (lean dictionary, `clientApiRateLimit` + `getAuthenticatedClientId`, `Cache-Control: no-store`) and switch exercise/session history rows to ID-first (`exercise_id` + `performed_name` fallback, no embedded dictionary).
4. Document the scale conventions (bounded **AND keyset** by default; render-ready payloads; index-with-the-query; ID-first rows + catalog delta-sync; sparse fieldsets / narrow RPC rowtypes) in `docs/CLIENT-PORTAL-REDESIGN.md`.

**Do NOT**: Re-do transport/versioning/bearer auth (owned by 9.5–9.8). Break web consumers without updating them (§10). `select('*')` or embed the exercise dictionary inside a history-row list. Add web-render perf work. **Specify RN client-side data patterns here** — TanStack Query + MMKV persistence, FlashList + `React.memo` + `react-freeze`, etc. live in the **mobile repo**, not this plan; this session only fixes the *server* contract those patterns consume.

**Tests to write**:
- `services/client-portal-progress.test.ts` (extend): returns render-ready series with correct unit + values (builds on the shipped unit-resolution fix).
- API test for any newly-bounded/keyset endpoint asserts the limit/window/cursor applies.
- `app/api/client/exercises/catalog/route.test.ts` (new): full sync (no `since`) returns the dictionary; delta (`since=`) returns only rows with `updated_at > since`; 401 unauthenticated; rows carry only the lean fields.
- Exercise-history row test: rows expose `exercise_id` with `performed_name` fallback and do not embed the dictionary.
- Update web consumer tests affected by the shape change.

**Verify**: `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`. Manual: web metrics hub still renders from the new payload; catalog endpoint returns a delta for a recent `since`. Commit.

---

## Session 3.10: Re-key client rate limiting from IP to client identity

**Status**: COMPLETE

**Commit message**: `fix(security): key client rate limits to client identity (carrier-NAT safe)`

**Objective**: `clientApiRateLimit` is IP-keyed (30 req/10s). On cellular, thousands of legitimate users sit behind the same carrier-grade NAT IP, so IP-based limiting will falsely throttle real mobile users sharing an egress IP. Re-key client portal rate limiting to the authenticated client identity so the limit is per-user, not per-IP. This is a correctness-at-scale fix, not just perf — it directly affects real mobile traffic.

**Read first**:
- `lib/rate-limit.ts` (`clientApiRateLimit`, keying strategy, Upstash/in-memory fallback).
- `lib/require-client-auth.ts`, `lib/auth-helpers.ts` (the chain runs rate-limit FIRST, before auth — so the client id is not known yet at limit time).
- CONVENTIONS §9 (rate limiting mandatory + first check) and §8 Shape B auth-chain ordering.

**Plan (report before implementing)**:
- The ordering problem: §9 mandates rate-limit as the first check, but the client id is only known after `getAuthenticatedClientId`. Decide: (a) two-tier — a generous IP-keyed burst guard first (DoS protection), then a tight per-client limit applied immediately after auth resolves; or (b) key on a stable client-derivable token available pre-DB-lookup. Recommend (a).
- Where the per-client check slots into `require-client-auth` without breaking the documented chain.
- Limits: ~30/10s per client; set the IP burst guard high enough that shared carrier IPs never trip it under normal use.

**Implement**:
1. Per-client rate-limit helper (Upstash, keyed by client id), applied in `require-client-auth` immediately after `getAuthenticatedClientId` resolves.
2. Retune the existing IP-keyed `clientApiRateLimit` to a generous abuse-only burst guard.
3. Document the two-tier model in `docs/CLIENT-PORTAL-REDESIGN.md`.

**Do NOT**: Remove rate limiting (§9). Replace `getUser()` with `getSession()` (§9). Apply the per-client limit before auth resolves (id isn't known yet). Touch web-render.

**Tests to write**:
- `lib/rate-limit.test.ts` / `lib/require-client-auth.test.ts` (extend): same client over the limit → 429; two different clients sharing one IP do NOT throttle each other (the carrier-NAT case); unauthenticated flood still hits the IP guard.

**Verify**: `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`. Commit.

> Cross-references Phase 9's 9.7 (bearer-token native auth): when native auth lands, confirm the client-id keying still derives correctly from the bearer path.

---

## Session 4.1: Habits detail page

**Status**: COMPLETE (commit `fbee171`)

**Commit message**: `feat(client-portal): add habits detail page with per-habit toggle`

**Objective**: Build `/client/habits` using existing habit-log endpoints.

**Read first**:
- `components/daily-pulse/` (reusable habit toggle primitives).
- `app/api/client/habits/` (existing endpoints).
- `CONVENTIONS.md` component communication.

**Implement**:
- `app/client/habits/page.tsx` renders per-habit toggles for selected date.
- Writes via existing habit-log endpoint.
- Import `canEditDay` from `lib/daily-log-permissions.ts` (Session 3.1) for the `isLocked` UI state (past-logged → locked).
- Server-side past-day lock on the habit endpoint if not already present. If missing, add by calling `assertCanEdit({ resourceType: 'habit', ... })` from Session 3.1 — do NOT reimplement the rule. If present, audit it against `assertCanEdit` and replace any inline date-rule logic with the shared helper.
- **No future-day UI handling.** The Session 2.4 post-merge follow-up makes the home day-view cards non-clickable for future dates, so this page is unreachable for future dates via the UI navigation surface. The `assertCanEdit` server-side rejection still covers direct API callers (defense-in-depth).

**Do NOT**: Add new habit-log endpoints. Modify habit CRUD. Duplicate date-rule logic. Add future-day view-only UI.

**Tests to write**:
- Habits page: one toggle per habit; toggle fires correct POST; locked state renders notice.
- Server-side lock if added: 403 on past-logged day (and on future-date direct API call, as defense-in-depth).

**Verify**: Toggle across days; past-day lock honored. `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`. Commit.

---

## Session 5.1: Remove old Daily Pulse + deprecated routes + docs sweep

**Status**: COMPLETE (commit `bd6dd45`; agent-doc follow-up `593cb0f`)

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

**Note on legacy JSONB readers**: Sessions 5.2/5.3/5.4 (alternative session logging) plug into the event-keyed swap detection (`utils/training-event-helpers.ts:82-145`) — not the legacy `training_data.isAlternativeSession` JSONB path. Two consumers still read that JSONB after this session: `services/schedule-data-service.ts:108-118` and `utils/ai-daily-context-patterns.ts:39`. They degrade gracefully (return `false`/empty) because nothing writes the JSONB post-Daily-Pulse-retirement. They're not blockers for 5.2/5.3 but are candidates for a future cleanup once verified unused at runtime. (The former third reader, `services/training-history-service.ts` — the no-active-phase fallback — was **deleted 2026-05-22**: roadmaps are now opt-in, so the coach training-history route serves no-phase clients from the same `training_events` + `session_logs.completed_at` path as phase clients, instead of the legacy `daily_logs` + `week_start_date` derivation that rendered logs on the wrong date.)

**Tests to write**: None. Remove tests for deleted code.

**Verify**: `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`. Manual smoke across client portal: login lands on `/client`, every tab works, no 404s. Read ARCHITECTURE.md end to end to confirm the rewrite is complete and no stale references remain. Commit.

---

## Session 5.2: Align session_logs identity with event-keyed architecture

**Commit message**: `feat(training): align session_logs identity with event-keyed architecture`

**Objective**: Migrate `session_logs` from session-week identity to event-keyed identity. Foundation for alternative-session logging (Sessions 5.3 and 5.4) and a side-effect fix for the cycle-plan data-loss bug where two events with the same `training_session_id` in one week silently overwrite each other on the existing `(client_id, training_session_id, week_start_date)` unique constraint.

**Why this comes after 5.1**: Pre-5.1, three writers target the existing constraint: `services/training-log-service.ts`, `app/api/client/session-completions/route.ts`, `services/client-portal-training.ts:markSessionComplete`. 5.1 deletes the latter two. Doing the migration before 5.1 means updating soon-to-be-deleted files. After 5.1, only `services/training-log-service.ts` writes session_logs — one file to update.

**Read first**:
- `docs/ARCHITECTURE.md` Training Completion Hierarchy section.
- `CONVENTIONS.md` §8 Database (migration workflow).
- `services/training-log-service.ts` (current upsert at line 366; orphan-event retry branch at line 327; composite-key fallback at line 581).
- `services/training-event-service.ts:410-425` (`linkSessionLogToEvent`).
- `services/training-log-service.test.ts` (lines 848 and 1290 specifically — explicit dependencies on the existing key).
- `supabase/migrations/027_add_session_completion_tracking.sql` (source of the current unique constraint).
- `supabase/migrations/055_rename_and_protect_training_history.sql` (where the indexed constraint was renamed).

**Plan (report before implementing)**:
- Migration shape:
  - `ALTER TABLE session_logs ADD COLUMN training_event_id UUID NULL REFERENCES training_events(id) ON DELETE SET NULL;`
  - Backfill from event side: `UPDATE session_logs sl SET training_event_id = te.id FROM training_events te WHERE te.session_log_id = sl.id;`
  - `DROP INDEX session_logs_client_session_week_key;`
  - `CREATE UNIQUE INDEX session_logs_training_event_id_key ON session_logs(training_event_id) WHERE training_event_id IS NOT NULL;`
- Service rewrite: replace upsert on `(client_id, training_session_id, week_start_date)` with: "if `event.session_log_id IS NOT NULL`, UPDATE the linked log row by id; else INSERT new row with `training_event_id = event.id`." Generalises the existing orphan-event retry branch (line 327) into the primary write path.
- `linkSessionLogToEvent` extension: write both directions of the link in one call (event.session_log_id + session_log.training_event_id + event.status). Atomic enough for pre-launch; future hardening can wrap in a Postgres function if needed.
- Composite-key fallback at `getTrainingEventDetail` (line 581-606): replaced by direct lookup via `event.session_log_id` (which is always set after a successful log write). Remove the composite-key branch entirely.

**Implement**:
- New migration `supabase/migrations/0XX_session_logs_event_keyed.sql` with the four steps above. Number sequentially after the current tip.
- `services/training-log-service.ts`: refactor `logTrainingEvent` step 5 (line 315 onward) to use event-keyed upsert. Refactor step 6 read fallback (line 581) to drop composite-key path.
- `services/training-event-service.ts:linkSessionLogToEvent`: extend signature to also update the log row's `training_event_id`. Both writes in one function; sequenced UPDATE statements (event row then log row) — caller treats as atomic.
- Regenerate `types/database.ts` per CONVENTIONS §8 migration workflow.
- Update `lib/database-helpers.ts` if `SessionLogInsert`/`SessionLogUpdate` need explicit type adjustment (likely auto-flows from regeneration).
- `types/training.ts`: add `trainingEventId: string | null` to `SessionLog` type (line 433-446).
- Update `docs/ARCHITECTURE.md` "Training Completion Hierarchy" section (lines 262-275): document the new `training_event_id` column on `session_logs`, the new partial unique index, the event-keyed write semantics, and note that the old `(client_id, training_session_id, week_start_date)` unique constraint has been dropped. Per the doc's own convention ("Update it when shipping migrations"), this lands in the same commit as the migration.

**Do NOT**:
- Touch `session_logs.training_session_id` semantics — it still records the performed session (currently always matches the event's prescribed session; after 5.3, may diverge for swaps).
- Drop the `training_logs` table or `upsert_daily_log_atomic()` RPC — separate schema cleanup, both write-dead post-6.4.
- Change anything in the read paths beyond the composite-key fallback removal.
- Touch `prescribed_session_snapshot` writing logic — 5.3 will extend that for the rest-day-with-no-event case.

**Tests to write**:
- `services/training-log-service.test.ts`:
  - Update existing test [16] (line 848 area) — assertion on `onConflict` key changes from `client_id,training_session_id,week_start_date` to UPDATE-by-id behavior.
  - Rewrite test [17] (line 1290) "composite-key fallback" — becomes "log fetched directly via `event.session_log_id`" since the composite-key branch is removed.
  - Other tests with `week_start_date` in fixtures (lines 1242, 1341, 1412, 1465, 1521, 1636): no changes needed; the column still exists, just isn't part of the unique key.
- Migration smoke test (manual): apply migration to local DB, verify `session_logs_training_event_id_key` exists, old index dropped, backfill populated existing rows.

**Verify**: `npx supabase db push` clean. `npx supabase gen types typescript --linked > types/database.ts`. Diff the generated types file — should show `training_event_id` added to session_logs. `npx tsc --noEmit` clean. `npx eslint .` clean. `npx vitest run` all green. Commit migration + regenerated types + service changes in the same commit per CONVENTIONS §8.

---

## Session 5.3: Alternative session logging — write path + matcher + coach surfacing

**Commit message**: `feat(training): alternative session logging with matcher and prescribed-vs-performed coach view`

**Objective**: Enable a client to log a different session than what was prescribed for a given day (planned-day swap) or log training on a rest day. Server-side: extend the log payload, implement a matcher that links the log to a prescribed event when possible, write the rest-day-trained endpoint. Coach-side: render the alt-session badge in the training history table (column already computes `is_alternative`) and add a session-level "Prescribed X · Performed Y" header to the drill-down dialog.

**Why this comes after 5.2**: 5.2's event-keyed identity is what makes the matcher implementation clean — the log carries `training_event_id` directly. Pre-5.2, this work would require maintaining two identity paths.

**Read first**:
- Output of Session 5.2.
- `services/training-log-service.ts` (the writer post-5.2 refactor).
- `utils/training-event-helpers.ts:82-145` (existing swap detection — comparing event.training_session_id vs session_log.training_session_id).
- `lib/validations/training.ts:logTrainingEventSchema` (current schema).
- `app/api/clients/[id]/training/session-logs/[sessionLogId]/route.ts` (coach drill-down API).
- `components/clients/training/training-history-table.tsx` (rows render around line 175-200; `is_alternative` column already returned by the API but unused).
- `components/clients/training/session-log-detail-dialog.tsx:236-300` (header area where session-level swap renders).
- `docs/ARCHITECTURE.md` Training Completion Hierarchy + Training → Nutrition cascade sections.

**Plan (report before implementing)**:
- **Schema additions**:
  - `lib/validations/training.ts`: add `performedSessionId: z.string().uuid().optional()` to `logTrainingEventSchema`. When present, the log is for an alternative session.
- **Matcher rule** (pure function in `services/training-log-service.ts`):
  - Input: `{ clientId, weekStart, performedSessionId, completedAt }`.
  - Returns: `eventId | null`.
  - Match priority:
    1. Unlinked event with same `training_session_id` as `performedSessionId`, earliest date in week. Catches "missed Tuesday's Pull, did it Wednesday" cleanly.
    2. Unlinked event on the same date as `completedAt`, regardless of session_id. Catches planned-day swap (Monday Push event matched by date).
    3. Any unlinked event of same `training_session_id` in week (no date proximity). Catches "did Pull early before its prescribed day."
    4. NULL — no candidate. Log stays unmatched; surfaces as truly-extra rest-day training.
  - "Unlinked" means `session_log_id IS NULL` AND `status IN ('scheduled','missed','skipped')`. Excludes already-completed/partial events.
- **Snapshot semantics for swap (Option A, decided in design)**:
  - `session_log.prescribed_session_snapshot`: derived from the **event's** `training_session_id` if an event is matched. Captures what the calendar prescribed.
  - When no event matched (truly-extra rest-day): snapshot derived from `payload.performedSessionId`. Captures what the client chose to do.
  - `exercise_logs[].prescribed_exercise_snapshot`: always derived from the chosen session's exercises (the `trainingExerciseId`s in the payload). Captures the prescription for what was performed.
- **Two write paths sharing internals**:
  - Existing: `POST /api/client/training/events/[eventId]/log` (event-keyed; client tapped an event card).
  - New: `POST /api/client/training/session-logs` (event-less; client picked from rest-day picker). Body includes `date`, `performedSessionId`, plus the existing log payload fields. Internally runs the matcher; if a match is found, the log gets linked + event status flipped; if not, log stays unmatched.
  - Both routes call shared service internals for snapshot writing, exercise_logs/set_logs writing, and `linkSessionLogToEvent`.
  - **Both routes call `assertCanEdit({ resourceType: 'training', clientId, date })` from Session 3.1 before the matcher / write.** This is **defense-in-depth**, not primary protection. The Session 2.4 post-merge follow-up makes the home day-view card-blocking the primary surface for future-date rejection (UI navigation prevents reaching the log flow); `assertCanEdit` is the §8 Shape B perimeter for direct API callers that bypass the UI.
- **Session-fetch endpoint for detailed-mode**:
  - New: `GET /api/client/training/sessions/[sessionId]` returning the session + active exercises (`is_active = true` filter on exercises). Powers the detailed-mode refetch in 5.4's UI when the client swaps or picks a rest-day session.
- **Coach-side surfacing**:
  - `components/clients/training/training-history-table.tsx`: render an "Alternative" badge in the Session column when `row.is_alternative === true`. Small visual marker, no new column.
  - `app/api/clients/[id]/training/session-logs/[sessionLogId]/route.ts`: include `performedSessionName: string | null` in the response (join `training_sessions` on `session_log.training_session_id` and return the live name).
  - `components/clients/training/session-log-detail-dialog.tsx`: when `performedSessionName` is present and differs from `prescribedSessionSnapshot.name`, render a "Prescribed {prescribed} · Performed {performed}" line in the header below the date.

**Implement**:
- `lib/validations/training.ts`: add `performedSessionId` (optional UUID).
- `services/training-log-service.ts`:
  - Extract a private `writeSessionLog(params)` from the current `logTrainingEvent`. Params include `eventId | null`, `performedSessionId`, `payload`. Centralises snapshot derivation, log upsert, exercise/set log writes.
  - Wire `logTrainingEvent` (event-keyed) to call `writeSessionLog` with `eventId = event.id` and `performedSessionId = payload.performedSessionId ?? event.training_session_id`.
  - New `logTrainingSessionForDate(clientId, date, payload)` (event-less): runs matcher, calls `writeSessionLog` with `eventId = matchedEventId | null` and `performedSessionId = payload.performedSessionId`.
  - New `findMatchingEvent(clientId, weekStart, performedSessionId, completedAt)` pure function per the matcher rule above.
- New API route `app/api/client/training/session-logs/route.ts` (POST): `clientApiRateLimit` + CSRF + `getAuthenticatedClientId` + schema validation + `logTrainingSessionForDate`. **Orphan-log guard (from Session 3.1B)**: call `resolvePlanContextForDate(clientId, date)` and `assertHasActivePlan(ctx, "training")` before the matcher / write; catch `NoActivePlanError` → 422. Same pattern the nutrition/wellness writers use. Requires `resolvePlanContextForDate` to populate `trainingPlanId` from the active training plan (today only the date's event populates it — extend the resolver here).
- New API route `app/api/client/training/sessions/[sessionId]/route.ts` (GET): `clientApiRateLimit` + auth + ownership check (session belongs to the client's **active** plan — return 404 if it belongs to an archived/draft plan to keep the picker scoped to currently-prescribed work) + returns session + active exercises.
- Extend `app/api/clients/[id]/training/session-logs/[sessionLogId]/route.ts`: response now includes `performedSessionName`.
- `services/training-event-service.ts:linkSessionLogToEvent`: no change beyond Session 5.2's extension.
- `components/clients/training/training-history-table.tsx`: render alt-session badge.
- `components/clients/training/session-log-detail-dialog.tsx`: render session-level "Prescribed X · Performed Y" header conditionally.
- Update `docs/ARCHITECTURE.md`: add a subsection (under "Training Completion Hierarchy" or after "Nutrition & Training Events") documenting the matcher rule, the alt-session signal (`session_log.training_session_id != event.training_session_id` for swap; `session_log.training_event_id IS NULL` for truly-extra rest-day-trained), and the snapshot semantics (session snapshot from event for matched logs, from chosen session for unmatched extras; exercise snapshots always from chosen session). Lands in the same commit as the service changes.

**Do NOT**:
- Build any client portal UI (Session 5.4 owns that).
- Cascade nutrition on log writes — matches the existing Session 1.2 deferral. Day's nutrition target stays based on the prescribed event's surplus%. Actual nutrition logging captures reality independently.
- Touch the existing exercise-level swap from Session 1.5 (`performed_name`, `exercise_id` on exercise_logs). Session-level swap is a separate signal at the log row level; coexists cleanly.
- Change adherence math anywhere — Session 6.2 covers that with a note (see 6.2's revised text).
- Build a freehand session creator. Picker offers active-plan sessions only.

**Tests to write**:
- `services/training-log-service.test.ts`:
  - Matcher unit tests: 4 scenarios (preferred match by session_id; same-date fallback; any-in-week fallback; no match returns null).
  - `logTrainingEvent` with `performedSessionId` differing from event.training_session_id: writes log with performed id, snapshot from event's session id, event.status flips to completed.
  - `logTrainingSessionForDate` happy path with match: writes log linked to matched event, event status flips.
  - `logTrainingSessionForDate` no match: writes log with `training_event_id = NULL`, no event update.
  - Snapshot for rest-day-no-match: `prescribed_session_snapshot` derived from `performedSessionId`'s session.
- `app/api/client/training/session-logs/route.test.ts`: 201 valid, 400 malformed, 401 unauthenticated, CSRF rejection.
- `app/api/client/training/sessions/[sessionId]/route.test.ts`: 200 happy, 404 not found, 404 belongs to another client (collapsed for IDOR per CONVENTIONS), 401 unauthenticated.
- `app/api/clients/[id]/training/session-logs/[sessionLogId]/route.test.ts`: extend existing tests to assert `performedSessionName` in response.
- `components/clients/training/training-history-table.test.tsx`: badge renders when `is_alternative: true`.
- `components/clients/training/session-log-detail-dialog.test.tsx`: session-level swap header renders when `performedSessionName` differs from snapshot name.

**Verify**: `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`. Manual coach test: log an alt-session as a client (via curl until 5.4 lands the UI), verify coach training history shows the badge and the drill-down dialog shows "Prescribed X · Performed Y." Commit.

---

## Session 5.4: Alternative session logging — client UI

**Commit message**: `feat(client-portal): client UI for alternative session and rest-day logging`

**Objective**: Wire the client portal UI for both alternative-session flows: (1) planned-day swap (client taps a planned event, chooses to do a different session); (2) rest-day training (client taps a rest-day card, picks a session from the active plan). Reuses the existing Session 1.5 tracker for detailed-mode logging.

**Read first**:
- Output of Session 5.3 (new endpoints, payload shape).
- `app/client/page.tsx` (home).
- `components/client-portal/day/training-card-summary.tsx` (rest-day card is currently non-clickable).
- `app/client/training/page.tsx` (detail page; currently requires `eventId`).
- `components/client-portal/training/set-tracker.tsx` (the tracker from Session 1.5).
- `components/daily-pulse/session-picker.tsx` for reference (legacy — DO NOT import; reimplement mobile-first).

**Plan (report before implementing)**:
- **Rest-day card click target**: when `events: []` for the day, the card row becomes clickable. Routes to `/client/training?date=YYYY-MM-DD` (no `eventId`). Update `TrainingCardSummary` to render the rest-day row as a link. **The card-level `isFuture` check from the Session 2.4 post-merge follow-up still applies** — the rest-day row is clickable for today/past only, never for future dates (the existing `isFuture = date > getTodayDateString()` gating already covers this card; just don't unconditionally render the rest-day row as a link).
- **Detail page two-mode handling** (`app/client/training/page.tsx`):
  - With `eventId` query param: existing flow (Session 1.4/1.5). Plus a new "Do a different session" button near the top of the tracker.
  - Without `eventId` but with `date`: picker is the entry point. After picking, render the same tracker bound to the picked session.
- **Picker component** (`components/client-portal/training/session-picker.tsx`):
  - Mobile-first, full-screen overlay or sheet pattern. Lists active-plan sessions with session name and focus.
  - Submit calls `onSelect(sessionId)`. The detail page then fetches `GET /api/client/training/sessions/[sessionId]` and binds the tracker.
- **Day-view option B trained-for line**:
  - When a `session_log.completed_at = D1` is linked to a `training_event` on date `D2` and `D1 ≠ D2`, the day-view for `D1` should show a small line: "Trained for {weekday of D2} {session.name}." Restores the "where I actually trained" signal without confusing the calendar.
  - Add a slim sub-line to the training summary card on the home day-view, rendered conditionally.
  - Data: day-summary endpoint can expose `loggedForOtherDate` per-event (or via a new field) — simplest is to extend the `TrainingEventSummary` shape returned by day-summary to include `loggedFor: { date: string, sessionName: string } | null`, populated when the day's events have logs whose `completed_at` differs from the day. Decide at impl time whether to extend day-summary or compute client-side.
- **Save payload**:
  - With `eventId`: existing endpoint `POST /api/client/training/events/[eventId]/log`. New optional field `performedSessionId` in body when swap was used.
  - Without `eventId`: new endpoint `POST /api/client/training/session-logs` with `date`, `performedSessionId`, plus the standard log fields.

**Implement**:
- `components/client-portal/day/training-card-summary.tsx`: rest-day row becomes a link to `/client/training?date={date}`. Keep the existing "Rest day" / "No training scheduled" copy.
- New `components/client-portal/training/session-picker.tsx`: mobile-first picker, fetches active-plan sessions (existing client-side data from day-summary or new endpoint — pick the cheaper path at impl time).
- `app/client/training/page.tsx`: handle missing `eventId`. When missing, render the picker. When present and tracker is shown, surface the "Do a different session" button that opens the picker.
- `components/client-portal/training/set-tracker.tsx`:
  - Accept optional `performedSessionId` prop (overrides the event's session for exercise list + payload field).
  - On performed-session change (swap), refetch via `GET /api/client/training/sessions/[sessionId]` to populate detailed-mode exercise list. The unchanged save flow handles the rest.
  - **No future-day disabled-state handling.** The Session 2.4 post-merge follow-up makes the home day-view cards non-clickable for future dates, so the tracker is unreachable for future dates via the UI navigation surface. Past-logged lock UX stays (driven by `canEditDay`); server-side `assertCanEdit` from Session 5.3 covers direct API callers as defense-in-depth.
- Day-view option B: add the "Trained for {day} {session}" line to the home training card. Conditional on the trained-for-elsewhere signal being present.
- All new mobile interactions follow the existing client-portal styling (border-radius 6px, brand teal hover lift).

**Do NOT**:
- Reimplement the tracker — reuse 1.5's component.
- Touch coach-side code — Session 5.3 covered that.
- Build a freehand session creator — picker offers active-plan sessions only.
- Build a "session library" picker for non-plan sessions — out of scope.
- Block the user from picking a session that's already prescribed on another day — the matcher handles it.
- Cascade nutrition on swap from the client side — server doesn't cascade per Session 5.3 plan; UI just reflects what the server does.

**Tests to write**:
- `components/client-portal/training/session-picker.test.tsx`: renders active-plan sessions; tap fires onSelect; cancel closes.
- `components/client-portal/day/training-card-summary.test.tsx`: rest-day row is a link with correct href when events: [].
- `app/client/training/page.test.tsx`: renders picker when eventId is missing; renders tracker when eventId present; clicking "Do a different session" opens picker; selecting a session refetches exercises and renders tracker.
- `components/client-portal/training/set-tracker.test.tsx` (extend): save payload includes `performedSessionId` when swap was used; detailed-mode exercises come from the picked session, not the event's session.
- Day-view "Trained for" line: home page test that the line renders when log.completed_at differs from event.date.

**Verify**: `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`. Manual end-to-end:
1. Plan with Push Monday, Pull Tuesday, rest Wed-Sun. Log Push Monday as prescribed → verify Monday card shows complete, no swap signal.
2. On Tuesday, swap Pull for Legs (suppose Legs is in the plan elsewhere) → verify save succeeds, coach training history shows "Alternative" badge on Tuesday, drill-down dialog shows "Prescribed Pull · Performed Legs."
3. On Wednesday (rest day), tap rest-day card → picker opens → pick Pull → log → verify (a) Tuesday's Pull event flips to completed (the matcher caught up the missed Pull), (b) Wednesday card shows "Trained for Tuesday Pull Day" line.
4. On Saturday (rest day), tap rest-day card → pick Push (already done Monday) → log → verify log stays unmatched (no available event), Saturday's day-view does NOT show a "Trained for" line (no matched event), adherence count unchanged (already 100%).
5. DevTools Console: no console errors. Network: no 404s on built routes.

Commit.

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
- Add a brief mention of alternative-session logging from Sessions 5.3/5.4: a one-sentence callout that clients can tap a rest-day card to log a workout or use "Do a different session" on a planned day. Sits alongside the "tap card to log" step.
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
- **Update `docs/ARCHITECTURE.md` "Check-in System"**: document that training-completion counting now reads `training_events.status='completed'` for the period; remove the portion of the "⚠️ Scheduled change (Phase 6)" note that 6.2 covers. Leave the 6.4 portion until 6.4 lands.

**Interaction with Sessions 5.2/5.3/5.4 (alternative session logging)**: counting `training_events.status='completed'` is the right rule even with alt-session in place. Events flipped to `completed` by the 5.3 matcher (planned-day swap, or rest-day-trained that matched an unlinked event) count toward adherence. Truly-extra rest-day-trained logs that found no match (`session_log.training_event_id IS NULL`) are intentionally NOT counted — they're surplus training and don't affect "did the client do what was prescribed." If the AI prompt should mention extras, that's a separate enrichment in Session 6.3.

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
- **Alt-session swap signal (optional polish on top of polish)**: when a `session_log` exists where `training_session_id` differs from the linked `event.training_session_id` (a swap, post-Session-5.3), include the performed session name alongside the prescribed name in the per-event header line so the AI can comment on the choice (e.g., "Monday: Prescribed Push Day · Performed Pull Day — 4 exercises logged"). Reads cleanly from data already fetched for the per-exercise block; no extra query.
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

**Interaction with Sessions 5.2/5.3/5.4 (alternative session logging)**: the training session checklist loads `training_events` for the period — it does NOT surface truly-extra rest-day-trained logs that didn't match a prescribed event (`session_log.training_event_id IS NULL` cases). Those are visible only from the home day-view per Session 5.4, by design — the check-in form's purpose is "did the prescribed sessions get done." Events flipped to `completed` via 5.3's matcher (planned-day swap, or rest-day-trained that caught up an unlinked event) render as locked + completed in this form. The session-level swap detail (Prescribed X · Performed Y) appears in the coach drill-down dialog, not in the check-in form rows themselves; this form shows the prescribed `event.session_name` only and `status`. No special handling is required in this session — alt-session is transparent to the form because completion data still flows through `training_events.status`.

**Prerequisites**: Session 3.1 (`lib/daily-log-permissions.ts` with `canEditDay`), Session 1.3 (training event log POST endpoint), Session 6.2 (context service reads from `training_events.status`), Sessions 5.2/5.3/5.4 (alt-session — already in scope; matcher and write paths exist by the time 6.4 lands).

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
7. **Update `docs/ARCHITECTURE.md` "Check-in System"**: rewrite it to the daily-logs-as-SOT model (form is a daily-logs viewer; edits route through the per-card endpoints; `check_in_session_completions` dropped). Remove the remaining "⚠️ Scheduled change (Phase 6)" note.

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

Sessions 9.1–9.4 are prod blockers. Sessions 9.5–9.8 are mobile blockers. Session 9.9 is hygiene. Sessions 9.10–9.11 are docs/observability. Sessions 9.12–9.13 are decision/contract notes (9.12 is **DEFERRED** until progress photos are built; 9.13 is doc-only).

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

---

## Session 9.11: Production query/performance observability

**Commit message**: `feat(observability): add slow-query + API latency instrumentation for client read paths`

**Objective**: The Phase 3 scale hardening (3.5–3.10) is verified in dev against seeded data; this session adds the production-side safety net so scale regressions surface from telemetry, not customer complaints. Instrument the hot client read paths and heaviest API routes with latency / slow-query capture via the existing Sentry setup, with alert thresholds tied to the Session 3.5 budgets.

**Read first**:
- `lib/error-handler.ts` (`captureApiError`, Sentry wrapper); `sentry.server.config.ts` (trace sample rate).
- Session 9.3 (Sentry capture on background tasks) — reuse its patterns, don't duplicate.
- `docs/perf-baseline.md` (Session 3.5 budgets — the thresholds to alert against).
- The hot read paths hardened in 3.6/3.7 + the heaviest routes (`/api/client/progress`, `/api/client/training/exercise-history`, `/api/client/day-summary`, `/api/client/check-in-context`).

**Plan (report before implementing)**:
- What to instrument: Sentry transaction spans on the heaviest client GETs; a slow-threshold event (exceeds the 3.5 budget) carrying the route/query + hashed client context (no PII per §17).
- Sampling: align with the existing trace rate for the fast path, but capture slow-path events at 100% (sample fast, always capture slow).
- Where the helper lives (extend `lib/error-handler.ts` or a new `lib/perf-trace.ts`).

**Implement**:
1. A small perf-trace helper that times a route/service call and emits a Sentry event when it exceeds the 3.5 budget.
2. Apply it to the heaviest client GET routes + the analytics service entry points.
3. Document thresholds + where alerts land in `docs/perf-baseline.md`.

**Do NOT**: Log PII (§17 — hash client identifiers). Add a new APM vendor (reuse Sentry). Re-instrument what 9.3 already covers. Touch web-render.

**Tests to write**:
- `lib/perf-trace.test.ts` (or extend the error-handler test): emits a Sentry event when the timed call exceeds the threshold; stays silent under it; never includes raw PII.

**Verify**: `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`. Manual: trigger a slow path against the seeded year-scale client; confirm a Sentry event fires. Commit.

---

## Session 9.12: Media/image transform contract (progress photos)

> **DEFERRED** until progress photos are actually built (product owner: "leave photos for now"). This is a contract stub so the delivery decision isn't relitigated when photos land — **do not implement now**. It also requires Supabase **Pro** (image transformations are a Pro-tier feature); confirm the project is on Pro before un-deferring.

**Commit message**: `docs(client-portal): record media/image transform contract for progress photos (deferred)`

**Objective**: Lock the image-delivery contract for progress photos before any are built, so the native app never downloads full-resolution originals into a list. Progress photos live in a **private** Supabase Storage bucket; the app renders thumbnails in feeds and the full image only on tap.

**Read first**:
- `services/storage-service.ts` (the storage home — where signed-URL helpers belong).
- Supabase Storage docs: `createSignedUrl(path, ttl, { transform })` and the image-transformation Pro requirement.
- `docs/CLIENT-PORTAL-REDESIGN.md` (where the media contract is recorded).

**Plan (report before implementing)** *(when un-deferred)*:
- Bucket: a **private** bucket for progress photos; no public URLs — every read goes through a short-TTL signed URL scoped to the owning client.
- Two render sizes via `createSignedUrl(path, ttl, { transform })`: **thumbnail** (~240px, q~60) in feeds/lists; **full** (~1080px) on tap. Never sign or serve the original in a list.
- Where the signed-URL helpers live (`services/storage-service.ts`) and the TTL choice.
- Confirm the project is on Supabase Pro before relying on transforms; document the fallback if not.

**Implement** *(when un-deferred — not now)*:
1. Private progress-photos bucket + RLS/ownership scoping.
2. `services/storage-service.ts` helpers returning thumbnail and full signed URLs via the `transform` option.
3. Feed/list surfaces request thumbnails; detail/tap requests full.
4. Document the contract (sizes, TTL, private-bucket rule, Pro requirement) in `docs/CLIENT-PORTAL-REDESIGN.md`.

**Do NOT**: Implement now (deferred). Put photos in a public bucket. Load originals in any list/feed. Rely on the transform feature before confirming Supabase Pro.

**Tests to write** *(when un-deferred)*: `services/storage-service.test.ts` — thumbnail vs full produce distinct transform params; signed URLs scope to the owning client; TTL applied.

**Verify** *(when un-deferred)*: `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`. Manual: a feed renders thumbnails, tap loads full, no original is fetched in the list.

---

## Session 9.13: Connection pooling + native resiliency decision note

**Commit message**: `docs(client-portal): record connection-pooling + native-resiliency decision`

**Objective**: Record the decision (no code change today) on database connection pooling and where native client resiliency lives, so a future backend or RN build doesn't rediscover it. Today the app reaches Postgres exclusively through **supabase-js (PostgREST over HTTP)**, which rides Supabase's managed connection pool — there is no raw-connection path to exhaust, so no pooler work is needed now.

**Read first**:
- `services/supabase-admin.ts` and `lib/supabase-server.ts` (confirm all DB access goes through supabase-js / PostgREST — no direct `pg`/Drizzle).
- Supabase docs on Supavisor (transaction pooler: port 6543, `pgbouncer=true`, `prepared_statements=false`).
- `docs/ARCHITECTURE.md` (where the decision is recorded).

**Plan (report before implementing)**:
- State the current posture: supabase-js / PostgREST → managed pool → no raw-connection exhaustion today; **no Supavisor change required**.
- Define the trigger that flips this: **if/when a direct-`pg`/Drizzle path is added** (a dedicated backend service, a migration runner, a queue worker), route it through the **Supavisor transaction pooler** (port 6543, `pgbouncer=true`, `prepared_statements=false`) — transaction-mode pooling can't keep session state, so the client must disable prepared statements.
- Note that **RN client resiliency** (exponential backoff + jitter, retry-not-on-4xx, `refetchOnReconnect`, offline cache) is a **mobile-repo** concern — record the pointer so it isn't forgotten, but it is not a server change and does not belong in this plan.

**Implement**:
1. Write the decision note (current posture; the Supavisor trigger + exact settings; the mobile-repo resiliency pointer) into `docs/ARCHITECTURE.md`. No code.

**Do NOT**: Add Supavisor config or a direct-`pg`/Drizzle path now (no current need). Implement RN retry/backoff/offline logic here (mobile repo). Change the supabase-js client setup.

**Tests to write**: None (doc/decision session).

**Verify**: `npx tsc --noEmit` clean (doc-only). Commit.


