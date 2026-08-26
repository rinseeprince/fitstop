# Dead-Code Sweep — HALF ONE findings (2026-08-25)

**Temporary.** This is the sweep's report-before-removal deliverable (`docs/DEAD-CODE-SWEEP.md` → "Report before deleting"). It is deleted with the sweep; the permanent record is the code markers, CONVENTIONS.md, docs/ARCHITECTURE.md and the STATUS block.

**Nothing in the repo has been changed.** Every verdict below is a proposal awaiting approval, except where §20 records a decision the owner has already made.

---

## How the list was produced

1. **Mechanical:** `npx knip` (5 unused files, 166 unused exports, 209 unused types); three scripts written for this sweep — route → `fetch`/`useSWR` caller scan (139 routes), page → link scan, and an export → reference scan over `app/ components/ hooks/ lib/ services/ utils/ types/ contexts/` that separates *no importer* / *test-only importer* / *script-only importer* and counts in-file uses.
2. **Judgement:** nine agents, one per candidate group, each required to read `docs/DEAD-CODE-SWEEP.md`, grep CONVENTIONS.md / docs/ARCHITECTURE.md / TECHNICAL-DEBT.md / CLIENT-APP-REFERENCE.md for every candidate, and search for dynamic references (last path segment, bare symbol, `export { x } from`, `export *`, `vi.mock` factories, scripts/, supabase/, *.md) before calling anything unreferenced. 263 items judged.
3. **Adversarial verification:** every DELETE verdict (60) went to a skeptic agent whose job was to refute it. **7 were refuted** — including one (`components/ui/chart.tsx`) whose deletion would have broken the coach dashboard through a relative-path import the judge's grep missed. Refutations are recorded on the items.
4. **Completeness critic:** a final agent asked what the name-level method structurally misses; its findings are §14–§19, each re-verified by hand before inclusion.
5. **My own reads** of every seed item, every orphan route, and the highest-stakes services.

**Literal scans lie.** `/promote` (`${baseUrl}/promote`) and `goals/history` (`${clientGoalsKeyPrefix(id)}/history`) both looked orphaned and are live. Every item below survived the dynamic-reference search, not just a literal grep.

**Verdict vocabulary.** DELETE · DELETE_WITH_TEST (dead product code whose only importer is its test; both go, test block named) · DROP_EXPORT (symbol used in its own file, imported nowhere — remove the keyword, tsc proves it) · MARK (keep, add the one-line code marker) · KEEP (documented) · KEEP (judgement) · LIVE · OWNER DECISION.

---

## §0. Corrections to the spec itself — read first

| # | Seed | Finding |
|---|---|---|
| C1 | **Seed 2 — the scope dialog is NOT dead** | `duplicateEvent` (`services/training-event-calendar-service.ts:113-131`) inserts the copy with **the same `training_session_id`** (`:118`), `status: "scheduled"`, on a `targetDate >= today`. "Duplicate" is live in the calendar card menu (`calendar-event-card.tsx:125-133` → `training-calendar-view.tsx:199-226` → `events/[eventId]/duplicate/route.ts:54`). After one duplicate the session has two future scheduled events, `futureScheduledCount` (`use-placed-session-editor.ts:108-113`) is 2, the tray header renders "· on 2 upcoming days", and Save opens the dialog (`placed-session-editor.tsx:131-134`). `placed-session-editor.test.tsx:221-256` tests exactly this fixture. The DB permits it: `uq_training_events_session_date (client_id, training_session_id, date)` (mig 076) is per-date. Migration 121 constrains nothing about session→event cardinality; the 1:1 shape is a property of the placement date-walk, not an invariant. TECHNICAL-DEBT.md:356-368 already records this reachability. **Removing the dialog changes what a coach sees after a duplicate → hard-constraint fail.** What IS wrong is the prose: `training-event-occupancy.ts:151-154` ("the count is always 1 and the dialog cannot open"), seed item 2, and PER-SET-COMPLETION plan :627-631 all state a falsehood — the misleading-comment shape this sweep exists to remove. |
| C2 | **Seed 3 — already closed** | `prescribedViews[i] ?? view` was removed in `ed4fe29` ("per-set completion — the tick is the claim"); the hunk `@@ -505,14 +522,19 @@` replaces it with `prescribedViews[i]` and the `field.isUnplanned \|\| !prescribedView` guard. Record as closed in the STATUS block. The surviving `\|\| !prescribedView` at `set-tracker.tsx:535` is a harmless belt (routes a row whose `detail` revalidated away to an empty prescription instead of crashing), not a candidate. |
| C3 | **Seed 4 — has a behaviour boundary** | `SetSpec.reps_target` is not read-dead once amrap/failure are nulled: `expandSetSpecs` (`utils/exercise-set-specs.ts:152`) and `snapshotToSpecs` (`:182`) synthesize it from the **live** `training_exercises.reps_target` column for compact-only exercises, and `set-row.tsx:145` (client placeholder) + `session-log-exercise-card.tsx:117` (coach readout) render it. Full retirement changes what a client/coach sees for a compact-only exercise whose column is set (3 rows in dev; prod unprobed). See D1/D2. |
| C4 | Seeds 1 & 5 confirmed | Both routes dead; cascade fully mapped (R10/R11). |

---

## §1. API routes and handlers

| ID | Route | Verdict | Evidence / cascade |
|---|---|---|---|
| R1 | `GET /api/client/exercises/catalog` | **KEEP (documented)** | RN delta-sync contract: CONVENTIONS:397, ARCHITECTURE:639, CLIENT-PORTAL-REDESIGN:420, mig 096. Doc gap only: absent from CLIENT-APP-REFERENCE. |
| R2 | `GET /api/client/nutrition` | **KEEP (documented)** | CLIENT-APP-REFERENCE:185 names it the primary endpoint (`nutrition-plan` is the alias). |
| R3 | `GET /api/client/weekly-nutrition` | **DELETE (decided — §20 #1; commit 3)** | Class (a) namespace, but absent from CLIENT-APP-REFERENCE and from ARCHITECTURE:601's Reads list; its only consumer (`components/daily-pulse/weekly-nutrition-progress.tsx`) was deleted in `bd6dd45`. Cascade if deleted: `getCoachingWeekSummaryLive` (`weekly-nutrition-service.ts:216`, then test-only → delete + `weekly-nutrition-service.test.ts:41-65`), `requireClientAuthWithCheckInDay` + `ClientAuthWithCheckInDayResult` (`lib/require-client-auth.ts:74,:32`, then test-only → delete + `require-client-auth.test.ts:186-225`), `getAuthenticatedClientWithCheckInDay` (`lib/auth-helpers.ts:172`). Either way the stale docblock at `weekly-nutrition-service.ts:220-221` ("its only live consumer is the client portal's weekly-nutrition card") must be corrected. |
| R4 | `GET /api/clients/[id]/body-metrics` | **DELETE** | Never wired: no commit ever contained `}/body-metrics`. TECHNICAL-DEBT:141-146 records its unbounded read as debt ("no in-repo UI consumes that route today") — a note, not a keep. `getBodyMetricsHistory` stays (`comparison-service.ts:57`, `body-metrics-service.ts:154`). Rewrite TD:141-146. |
| R5 | `GET /api/clients/[id]/history/habits` | **DELETE** + `services/habits-history-service.ts` (whole file: sole caller, no test) + `HabitMeta`/`HabitsHistoryRow` (`types/history.ts:26-44`) | Caller removed in `371db3a`; habits tab reads `/habits` (`use-client-habits.ts:82`) and `habits-weekly-service`. `parsePaginationParams` stays (6 other routes). |
| R6 | `POST /api/clients/[id]/intake/review` | **DELETE** | Superseded: "Mark reviewed" posts `{action:"review"}` to the parent `/intake` (`intake-review-actions.tsx:72-76`), dispatched at `intake/route.ts:127-130`. Pre-convention (`apiRateLimit`, `getAuthenticatedCoachId()` without `request`). `reviewIntake`/`reviewIntakeSchema` stay via the parent. |
| R7 | `POST /api/clients/[id]/intake/sync-metrics` | **DELETE route; KEEP `AUDIT_ACTIONS.INTAKE_SYNC_METRICS`; MOVE the `recordAuditEvent` call into the parent's `sync-metrics` branch** | Same dispatch (`intake/route.ts:132-135`; UI at `intake-review-actions.tsx:41-44` reads `syncedFields`, which only the parent returns). Skeptic finding: the dead sub-route (`:37-45`) is the ONLY implementer of the audit CONVENTIONS:378 mandates ("intake metrics sync"); the live path records nothing. Moving the call is audit-only (fire-and-forget), not coach-visible. ARCHITECTURE:782's claim that intake sync is audited is currently false. |
| R8 | `PATCH /api/clients/[id]/nutrition/events/[date]/reset` | **DELETE** + `resetNutritionEvent` (`nutrition-event-edit-service.ts:163`, then test-only) + describe `nutrition-event-edit-service.test.ts:288-300` | TD:186-194 lists it under "uninstrumented caller-less routes" with "(web UI uses the bulk /events/reset)" — records absence of a caller, does not say why it stays. Bulk `resetNutritionEventDays` (`:192`) is a standalone superset (does not delegate). Docs to fix: TD:194, ARCHITECTURE:329, NUTRITION-CALENDAR-IMPLEMENTATION-SPEC:111. |
| R9 | `GET /api/clients/[id]/training/[planId]/events` | **DELETE** (`route.ts` only; the `[eventId]/*` subtree is live) | Plan-scoped calendar read superseded by client-scoped `/training/events` (`use-calendar-events.ts:20`) in `e340529`; handler validates `planId` then calls `getEventsForDateRange(clientId, …)` identically. Pre-convention (no `request`). |
| R10 | **Seed 1** `PATCH+DELETE …/sessions/[sessionId]/exercises/[exerciseId]` | **DELETE** | Unguarded soft-delete (`training-exercise-service.ts:111-118`), pre-convention. Cascade: service `updateExercise` (test-only → `set-specs-survival.test.ts:107-111` goes; that file's own header rule is "every site that can write set_specs is exercised", so a deleted site leaves the matrix), `deleteExercise` (no other ref), `updateExerciseSchema` (+ `training.test.ts:598-632`), `UpdateExerciseRequest` (`types/training.ts:165`). TD:857 row trims. |
| R11 | **Seed 5** `POST+PUT …/sessions/[sessionId]/exercises` | **DELETE** | No caller (live save is PUT `…/sessions/[sessionId]` → `replaceSessionFull`, lock-guarded). Cascade: service `addExercise` (+ `set-specs-survival.test.ts:98-102`), `AddExerciseRequest` (`types/training.ts:184`), route-local `bulkExerciseSchema`. With R10, `services/training-exercise-service.ts` is empty → delete file + re-export line `training-service.ts:11`. **STAY:** `bulkReplaceExercises` (`replaceSessionFull`), `bulkExerciseInputSchema` (clone route), `exerciseSchema` (base of the bulk schema). |
| R12 | `GET /api/clients/[id]/training/period-stats` | **DELETE** | Caller removed in `472137f`. The live numbers come from `check-in-context` (`getCheckInTrainingPeriodStats`), which counts `training_events.status='completed'` by date, whereas this counts `session_logs.completion_quality='full'` by `completed_at` — divergent maths, the wrong-conclusion trap. `countEventsInRange` stays (2 callers). TD:858 example citation to repoint. |
| R13 | `GET /api/clients/[id]/weekly-nutrition` (coach) | **DELETE** + `getWeeklySummaries`, `getLatestWeeklySummary` + route-local `backfillWeeklySummariesForClient` | Never had a UI caller (every historical `/weekly-nutrition` hit is a component *file name*). Fix the stale mock/import at `client-check-in-service.test.ts:34,65,117,178,210,247` (the service under test calls `getNutritionSummaryForPeriod`). `upsertWeeklySummary` stays only through S3 — if S3 goes, it goes. Flag: `nutrition_weekly_summaries` then has no in-repo reader (table follow-up, out of scope). |
| R14 | `PATCH + DELETE …/training/[planId]/sessions/[sessionId]` (found by shape) | **DELETE handlers** (GET/PUT stay) | Verified: every `/sessions/${…}` fetch is GET (SWR key `:70`), POST clone (`:157`), PUT (`:179`); `route.test.ts:51` imports only `GET, PUT`; no `method: "PATCH"\|"DELETE"` fetch anywhere targets a coach session URL. Both lack `request`. DELETE soft-deletes session+exercises without touching events (seed-1 shape, not lock-covered). PATCH was the last writer of `day_of_week` (CONVENTIONS:459 "nothing writes it") and the second caller of `updateSurplusForFutureEvents` (stays via `replaceSessionFull`). Cascade: `updateSession` (`training-session-service.ts:14-47`), `deleteSession` (`:90-103`), `sessionSchema`/`updateSessionSchema`/`dayOfWeekSchema` (`training.ts:8,36-54`; tests `training.test.ts:38-58, 163-207`), `UpdateSessionRequest`, `TrainingSessionUpdate` (`lib/database-helpers.ts:39`); trim barrel `training-service.ts:10` and mock keys `route.test.ts:20-25`. TD:857 row trims. |
| R15 | `PATCH …/training/[planId]/events/[eventId]` + `updateEventSurplus` (`training-event-calendar-service.ts:140-181`) | **DELETE** (DELETE handler stays — live at `training-calendar-view.tsx:266,299`) | Verified: the only `events/${…}` fetches are duplicate POST, move POST, and DELETE. TD:193 records it caller-less ("web UI routes surplus edits through the sessions endpoint"). Its docblock ties it to the tray's "Just this day", which now clones + PUTs. Docs: ARCHITECTURE:332, NUTRITION-CALENDAR spec:178. |
| R16 | `GET /api/clients/[id]/reminders` (plural) + `getClientReminders` (`reminder-service.ts:165-202`) + `GetClientRemindersResponse` (`types/check-in.ts:675`), `CheckInReminder` (`:596`), `CheckInReminderRow` (`lib/database-helpers.ts:11`) | **DELETE** (cascade of H4) | Sole reader was the dead `useClientReminders`. Pre-convention. Singular `/reminder` is live (`use-roster-actions.ts:72`). Skeptic correction: `CheckInReminder` is NOT used by `sendCheckInReminder`; it goes too. |
| R17 | `app/sentry-example-page/` | **DELETE** | Sentry wizard scaffold (`1532735`), unlinked, un-gated; its button hits a non-existent `/api/sentry-example-api`. Real Sentry wiring (next.config, instrumentation*, sentry.*.config, global-error) is untouched. |
| R18 | `app/client/progress/page.tsx` (redirect → `/client/metrics`) | **KEEP + marker + add to the documented stub list + fix CLIENT-APP-REFERENCE:78,705 (decided — §20 #2; commit 7)** | Self-marked at the code ("Keep the route as a redirect so existing links still resolve") and the same shape as the three `/dashboard` stubs, but absent from ARCHITECTURE:486's stub list; no in-repo link to it survives. Two agents split. |
| — | `/automation`, `/crm` (nav-reachable Beta placeholders), `GET/PATCH/POST /api/clients/[id]/intake`, `GET /api/client/progress`, `POST /api/client/walkthrough-seen` (H28) | LIVE / documented | Placeholder pages are a product question, not dead code. |

---

## §2. Seed 2 cluster (migration 121 — one placed day, one session row)

| ID | Item | Verdict / action |
|---|---|---|
| M1 | Scope dialog (`placed-session-editor.tsx:271-327`), trigger (`:131-134`), `SaveScope`, `futureScheduledCount`, the `"day"` path (`use-placed-session-editor.ts:154-172`), clone route, `cloneSessionForEvent` | **LIVE** (C1). Action: one-line marker at `use-placed-session-editor.ts:106` — the count exceeds 1 only after a per-event duplicate (`duplicateEvent` copies `training_session_id`); correct seed item 2 and PER-SET plan :627-631. |
| M2 | `getSessionEventLinks` list-shaped return (`training-event-occupancy.ts:156-175`) | **LIVE.** Plurality earned three ways: `assertSessionUnlogged`'s `find` over the date-ascending list (names the EARLIEST logged day; test `:181-197`), the tray's `loggedEvent`/`futureScheduledCount`, and genuine multi-event sessions after a duplicate. The ⚠️ holds (`:212-226` fails on any `status` filter). Action: rewrite the false docblock `:151-154`. |
| M3 | `replaceSessionFull` `identityChanged` branch (`training-session-replace-service.ts:79-120`) | **KEEP, comment-only** (owner-confirmed behaviour). The predicate matches the edited day under placement and >1 only after a duplicate; the prose presents the rare case as normal. Reframe docblock `:33-42`, `:48`, error text `:117`, `:142-144`; route `:67-70`; hook `:22-26`; editor `:41-45`; rename the `it` string at `replace-service.test.ts:222` (assertions unchanged). |
| M4 | `updateSurplusForFutureEvents` (`training-session-service.ts:49-87`) | **KEEP, comment-only** — same fix (docblock `:53`, `:62-65`). Dates-shaped return is load-bearing (`{kind:"dates"}` cascade, ARCHITECTURE:332). Loses its PATCH caller with R14 → trim barrel + mock key. |
| M5 | `ReplaceSessionResult.futureEventsUpdated` (`:24`, `renamedCount` `:102/:119`, `.select("id")` `:114`, comment+`Math.max` `:142-144`, PUT response key `route.ts:157`) | **DELETE_WITH_TEST** — read by no caller (the hook reads only `res.ok`/`error`, `use-placed-session-editor.ts:186-195`); not RN. Trim assertion lines `route.test.ts:104,187` and `replace-service.test.ts:206,255,286`; no test file deleted. (`identityChanged`/`surplusChanged` response keys are likewise unread but stay as internal branch gates — optional trim.) |
| M6 | Tray `onEditPlan` → "Edit whole plan" (`training-builder-right-panel.tsx:139` → `training-calendar-view.tsx:34,78,489` → `placed-session-editor.tsx:52,79,199-204`) | **DECIDED — §20 #3: browser-checked, present; REMOVE in its OWN commit (not this sweep).** Source renders it as the 2nd item of the tray's ⋮ "Session actions" menu whenever an active, not-fully-past plan exists; no test covers it. A correctness smell supports deletion: `openAmend` opens `builder.plan.id` (the ACTIVE plan) while the tray's `state.planId` is the EVENT's plan, so on a coexisting plan's event it would amend the wrong plan. If deleted: the prop at the three files + `Layers` import + right-panel comment `:31-33`. Either way ARCHITECTURE:545, :668 and CONVENTIONS:250 name the tray as an entry point and must change. |
| M7 | Inventory of other "future occurrences" plural predicates (hook `:108-113`, `:124-127`; editor `:174-176`; occupancy `:213-215`; route comments `:19-20`, `:67-70`, `:140-142`; clone route `:12-14`) | **LIVE** — all reachable with >1 rows via duplicate. Only comments that assert impossibility change (M2) or present the rare case as normal (M3/M4). |

---

## §3. Seed 4 — `SetSpec.reps_target`

| ID | Item | Verdict |
|---|---|---|
| D1 | Assistant `set_exercise_sets` input `repsTarget` (`services/assistant/draft-exercise-tools.ts:253`, written `:294`) | **DELETE** — the last authoring writer (the builder's went in `160b423`); the builder cannot display or edit a per-set target; the system prompt never mentions it; `additionalProperties:false` means a model still emitting it is schema-rejected, not silently written. |
| D2 | `SetSpec.reps_target` (`utils/exercise-set-specs.ts:26`) + `PrescribedRow.repsTarget` (`set-spec-rows.ts:41,89,107`) + `setSpecSchema.reps_target` (`training.ts:80`) + fallbacks at `progression-preview-model.ts:107`, `draft-tool-helpers.ts:163` + CLIENT-APP-REFERENCE:346 | **DECIDED — §20 #4: option A (commit 7).** (A) *behaviour-preserving, recommended:* D1 + a marker at `:26` ("no longer authored per set; populated only by `expandSetSpecs` from the live `training_exercises.reps_target` column — retire with that column"). (B) full retirement now: line plan = `:26,:139,:152,:182`; `set-spec-rows.ts:41,89,107`; `set-row.tsx:145` and `session-log-exercise-card.tsx:117` → `formatRepsRange` only; `log-form-types.ts:90`; `progression-preview-model.ts:107`; `draft-tool-helpers.ts:163`; `training.ts:80`; docs CLIENT-APP-REFERENCE:346, ARCHITECTURE:475/:479; tests (fixture edits, no deletions): `set-spec-rows.test.ts`, `progression-rules.test.ts:188`, `progression-preview-model.test.ts:117-130`, `program-builder-ops.test.ts:291/304`, `program-builder-serialize.test.ts:23/36/49`, `exercise-tracker-block.test.tsx:86`, `logged-set-rows.test.ts:15`, `session-log-detail-dialog.test.tsx:37`, `draft-tools.test.ts:61`. **Never touch** the exercise-level `repsTarget` sites (`types/training.ts:26/170/189/218/309`, `program-builder-types.ts:37`, `lib/validations/assistant.ts:31/:118` — a name-collision trap: those mirror `ExerciseDraft.repsTarget`, the live column). Stale-key safety under either option: readers cast structurally; `setSpecSchema` is non-strict so zod strips, never rejects. No `DROP COLUMN` → CONVENTIONS:482 prod re-probe not triggered. |
| D3 | `SET_TYPE_OPTIONS`, `MAX_DROPS` | LIVE (TD:413-417 is a trap note, both used). |
| D4 | `use-set-spec-mutations.ts:17` value re-exports `MAX_SET_SPECS`, `applySetSpecEdit` | **DROP_EXPORT** — imported only by three tests; repoint them to `@/utils/set-spec-edits` / `@/utils/exercise-set-specs`; keep `export type { SetSpecEdit }` (6 product importers). Reword TD:413. |

---

## §4. Branches a documented invariant makes unreachable

| ID | Item | Verdict |
|---|---|---|
| B1 | `message.includes("outside the current phase") \|\| message.includes("already scheduled")` — `events/[eventId]/duplicate/route.ts:71`, `move/route.ts:81` | **DELETE the whole `if`** — no thrower for either string (mig-133 phase residue; `DateOccupiedError` formats as "…already has a session" and is caught by `instanceof` one line earlier). `"past date"`/`"Only scheduled"` branches are live. |
| B2 | `vi.mock('@/lib/require-phase-selection')` — `app/api/clients/[id]/training/route.test.ts:42-44` | **DELETE** — the module does not exist. |
| B3 | `phases: []` fixture key — `training-builder-right-panel.test.tsx:40` | **DELETE**. |
| B4 | `getTrainingSessionsSummary` (`utils/training-calorie-helpers.ts`, whole file) + `buildDailyTargetsFromPlan`'s `trainingPlan` param and else-branch (`utils/build-daily-targets.ts:3,93,125-128`) + the `getActiveTrainingPlan` fetch in `client-portal-service.ts:9,139-140,149` | **DELETE_WITH_TEST** — the sole caller always passes `trainingEvents` (an array, truthy), so the `session.dayOfWeek === day` branch never runs; the util's own docblock (`:59-65`) calls the param dead weight. Skeptic's cascade: rewrite ~20 nine-arg calls in `utils/__tests__/build-daily-targets.test.ts:81-249`; shift `args[5]/[7]/[8]` and drop the stale `getActiveTrainingPlan` mock in `client-portal-service.test.ts:15-17,165-176`; delete `utils/build-daily-targets.test.ts:59-110`. Side effect: one fewer DB round trip per client nutrition read (behaviour-neutral). |
| B5 | `estimateTargetForUnloggedDay`'s `session.dayOfWeek` match (`utils/nutrition-period-summary.ts:38-44,65-80,86,140-141`) + `fetchTrainingDataForPeriod` (`schedule-data-service.ts:80-145` — its `sessionLogs`/`trainingLogs` are computed and discarded; `.filter(is_active)` filters a column not selected) + `TrainingPlanWithSessions`, `SessionLogRow`, `TrainingLogRow` | **DELETE** — returns `baseCalories` on every real row; both callers (`check-in-snapshot-service.ts:10,49,61`, `history/nutrition/route.ts:5,121,124`) use only `.plans`. Tests: `nutrition-period-summary.test.ts` already passes `undefined` — no change. Removes one of two `training_logs.trained` readers → update TD:771. |
| B6 | `getTrainingDays` (`utils/nutrition-helpers.ts:50-78`) | **DELETE** + inert mock key `nutrition-plan-service.test.ts:13`. |
| B7 | `updateSession`'s `day_of_week` write, `sessionSchema.dayOfWeek`, `dayOfWeekSchema` | **DELETE** — folds into R14 (only writer, CONVENTIONS:459). |
| B8 | `createSavedPlanSchema.sessions[].dayOfWeek` (`training.ts:256`), `ManualSessionDraft.dayOfWeek` (`types/training.ts:207`) | **DELETE** — `coach_saved_sessions` has no such column; `createSavedPlanManual` never reads it; zod strips it. |
| B9 | `prescribed_session_snapshot.day_of_week` (`training-log-service.ts:88,416,427`; write-only, always null) | **KEEP (decided — §20 #5)** this sweep: it changes stored / RN-facing snapshot JSON (key absent vs `null`), a shape change rather than dead code. |
| B10 | `TrainingSession.dayOfWeek` type field + 3 mapper sites | **DEFER** — only after B4–B8, and only if B9/B11 also go; larger blast radius for no reasoning gain. |
| B11 | `CheckInTrainingContext.sessions[].dayOfWeek` (`check-in-context-service.ts:40`; `types/check-in.ts:140`) — always undefined | **KEEP (decided — §20 #5)** — it is on the `GET /api/client/check-in-context` RN payload (CLIENT-APP-REFERENCE:229), so dropping it is a contract change. |
| B12 | `SubmitCheckInRequest` (`types/check-in.ts:522`, the mig-142 magic-link `token` shape) | **DELETE**; narrow `client-check-in-service.ts:158` to `CheckInFormData`, drop import `:22`; reword the stale comment at `types/check-in.ts:501`. |
| B13 | `ProgressData.client.weightUnit?/measurementUnit?` (`client-portal-progress.ts:64-65`) | **DELETE** — never assigned since mig 141; `client-portal-progress.test.ts:60-61,80-81,154-155` asserts absence and stays green. |
| B14 | `'planned'` enum members (`training.ts:6,49`; `types/training.ts:14`; mig 081 CHECK) and `getSavedPlanAssignments`' `.in("status",["active","planned"])` | **KEEP (schema change)** — no writer of `'planned'` exists, but retiring needs a migration + `coach-saved-plan-duplicate.test.ts:233`. Only fix the wrong docblock at `coach-saved-plan-service.ts:619-621`. |
| B15 | Cycles (mig 128), `training_plan_history` (129), `check_in_tokens` (142), `weight_unit`/`height_unit`/`measurement_unit` columns (140-141) | **CLEAN** — zero code residue beyond B12/B13 and the doc/comment items in §12. |
| B16 | `"/messages"`, `"/email"` in `middleware.ts:157-166` `trainerRoutes` | **DROPPED FROM THE SWEEP (owner, 2026-08-25)** — removing them changes a signed-in client's redirect-to-`/client` into a 404 on those prefixes; a behaviour change, not residue. Not a decision. |

---

## §5. Unreferenced components, hooks and functions (product code)

| ID | Item | Verdict |
|---|---|---|
| H1 | `components/clients/check-in/check-in-schedule-card.tsx` (whole file; `CheckInScheduleCard`, `CheckInScheduleSection`) | **DELETE** — superseded by `overview/client-schedule-card.tsx` + `use-client-profile-edit.ts:366` (which keeps `/check-in-config` live). TD:557 row goes. |
| H2 | `useCheckInData` (`hooks/use-check-in-data.ts:31-65`) + `CheckInStatus` import `:6` | **DELETE**. Cascade one level (H2b — **DELETE_WITH_TEST, decided §20 #6, no marker**): it was the only sender of `includeDailyLogCounts=true`, so the route branch `check-ins/route.ts:45-52`, `enrichWithDailyLogCounts` (`check-in-service.ts:256-281`) and tests `check-in-service.test.ts:463-567` become caller-less — DELETE_WITH_TEST, or leave. |
| H3 | `useCheckIn` (`:129-145`, + `CheckIn` import `:5`), `useUnreviewedCount` (`:165-183`) | **DELETE**. (`/api/check-in/[id]` is class (b) and untouched; `useUnreviewedCheckIns` `:261` is LIVE — do not confuse.) |
| H4 | `useClientReminders` (`:241-258`, + `GetClientRemindersResponse` import `:12`) | **DELETE** → R16 cascade. |
| H5 | `getClientReminderResponseRate` (`reminder-service.ts:199-223`; carries an `r: any`) | **DELETE**. |
| H6 | `sendAutomatedReminders` (`reminder-service.ts:100`) | **MARK** — TD:914 "Reminder email cron is unwired… wire + verify before enabling" is a recorded decision. Code marker pointing at it. |
| H7 | `getClientAdherenceStats` (`check-in-adherence-service.ts:226`) + `ClientAdherenceStats` (`types/check-in.ts:637`) | **DELETE**. |
| H8 | `getMissedCheckInPeriods` + `MissedCheckInPeriod` (`check-in-tracking-service.ts:87-160`) | **DELETE** + the now-unused `supabaseAdmin` (`:10`), `@/lib/date-helpers` import line (`:12` — `calculateCheckInPeriod`, `getTodayInTimezone`) and `DayOfWeek` (`:30`); rewrite the header docblock `:5-7`; remove TD:553's "7 days grace window" row. |
| H9 | `services/storage-service.ts`: `uploadProgressPhoto`, `getPhotoSignedUrl`, `getMultipleSignedUrls`, `deletePhoto`, `deleteMultiplePhotos`, `getPhotoPublicUrl`, `listClientPhotos` | **DELETE** — the photo feature is live only through `uploadProgressPhotoFromBase64` (`app/api/client/check-ins/route.ts:183-197`); the render path uses raw paths (`app/client/check-in/[id]/page.tsx:399`). TD:621/627/628 and migs 125/126 document the bucket/policies, not these helpers. |
| H10 | `lib/image-utils.ts`: `fileToBase64`, `base64ToFile`, `getImageDimensions`, `formatFileSize` | **DELETE** — `use-photo-upload.ts:2` imports only `validateImageFile`, `compressImage`. |
| H11 | `lib/date-helpers.ts`: `getTomorrowDateString` (`:92`), `getDayOfWeek` (`:340`), `getNextDayOfWeek` (`:347`), `isToday` (`:362`), `isPast` (`:374`), `startOfDay` (`:396`), `endOfDay` (`:405`) | **DELETE** — internal use is dead-on-dead only; every other `isToday`/`isPast` hit is a component prop. Also closes the local-`Date` UTC-today footgun TD:919 warns about. |
| H12 | `deleteFutureEventsForPlan` (`training-event-service.ts:189`) | **DELETE**; TD:915's "every live caller passes an anchored date" is stale — correct it. |
| H13 | `getInvitationForClient` (`invitation-service.ts:20`), `getClientIdForUser` (`:394`) | **DELETE**; close stale TD:487/:846 rows (they describe a browser-client import that no longer exists). |
| H14 | `getIntakeByToken` (`client-intake-service.ts:98`) | **DELETE**; reword header `:7`. No token-based intake route exists. |
| H15 | `utils/nutrition-helpers.ts`: `getSuggestedTrainingVolume` (`:164`), `getTrainingCalories` (`:226`), `getActivityLevelLabel` (`:240`), `getTrainingVolumeLabel` (`:254`) | **DELETE** (+ unused `TrainingVolume`/`TrainingPlan` type imports; `ActivityLevel` stays for `getActivityMultiplier`). |
| H16 | `wrapUserContent` (`utils/ai-prompt-sanitizer.ts:73`) | **DELETE**. |
| H17 | `createServerClient` re-export (`services/supabase-client.ts:68-70`) | **DELETE** — every real consumer imports from `@supabase/ssr`; `lib/supabase-server.ts` is canonical (CONVENTIONS:346). |
| H18 | `lib/constants.ts`: `RATE_LIMIT_RETRY_DELAY_MS` (`:15`), `DEBOUNCE_DELAY_MS` (`:16`), `MAX_DATE_LOOKBACK_DAYS` (`:87`), `AuditActionKey` (`:141`) | **DELETE**. Alternative for `DEBOUNCE_DELAY_MS`: wire the two inline 300 ms debounces (`programs-table.tsx:58`, `exercise-search-input.tsx:35`) to it per CONVENTIONS:131 — say if preferred. |
| H19 | `exerciseCompactSummary` (`exercise-summary.ts:8-22`) | **DELETE**; fix the header comment `:3-10`. Last caller removed in `88efc6c`. |
| H20 | `LoadType` (`load-value-input.tsx:31`) | **DELETE** — zero refs, even in-file. |
| H21 | `ClientMetricData` + `export type { ClientMetricSeries }` (`use-client-progress-metrics.ts:9-10`) | **DELETE** — "keeps existing importers compiling" but there are none. |
| H22 | `components/ui/use-mobile.tsx` + `use-mobile.test.ts` | **DELETE** — vendored hook, zero importers, no `sidebar.tsx` consumer exists. |
| H23 | `getEventForSessionAndDate` (`training-event-service.ts:253`) | **DELETE** with S1/S5 (its only importers). |
| H24 | `generateTrainingEvents` + `SessionInput` (`training-event-service.ts:31-120`, weekday generator) | **MARK** — filters on `dayOfWeek`, so inert on product data; callers are the documented seed script (ARCHITECTURE:260) and S1; tests stay. |
| H25 | `getActiveNutritionPlanId` (`nutrition-plan-service.ts:211`) | **KEEP (already marked at code `:203-210`)**; optionally note "no production caller" at ARCHITECTURE:278. |
| H26 | `calculateStreaks` (`daily-logs-service.ts:178`) | **MARK (decided — §20 #7; commit 7)**: only caller is the perf harness (`scripts/perf-baseline.ts:37,119-122`); it is the sole TS reader of the mig-095 `get_client_streaks` RPC. |
| H27 | `calculateStreakFromLogs` (`daily-logs-service.ts:77`) | **KEEP (documented at code `:63-66`)** — "reference implementation… unit-test oracle the RPC must match"; mig 095:21-25 records the same. Skeptic refuted the judge's DELETE. |
| H28 | `GuidedWalkthrough` + `walkthrough-step(s).tsx` + `POST /api/client/walkthrough-seen` | **KEEP (documented, ARCHITECTURE:830 "not currently mounted… re-mount is a separate concern")** + code marker; add the route to CLIENT-APP-REFERENCE. `ClientWaitingState` in the same folder is LIVE. |

---

## §6. Test-only exports (false-positive class 4)

**DELETE_WITH_TEST** — dead product code; the named test blocks go with it:

| ID | Symbol | Test block(s) |
|---|---|---|
| T1 | `permanentlyDeleteClient` (`client-service.ts:471`; hard DELETE — CONVENTIONS:400 forbids; live path is `deleteClient`) | `client-service.test.ts:792-819` + import `:47` |
| T2 | `updateCheckInStatus` (`check-in-service.ts:401`) | `check-in-service.test.ts:579-593`; trim TD:857 |
| T3 | `getDayOfWeekLowercase` (`daily-logs-service.ts:109`, + `DayOfWeek` import `:3`) | `daily-logs-service.test.ts:192-197` and the duplicate `:354-363`, import `:6` |
| T4 | `lib/check-in-utils.ts`: `formatCheckInDate`, `formatCheckInTime`, `calculateProgressComparison` (+ `ProgressComparison` type import and `types/check-in.ts:557`), `calculateAverage`, `getTrendDirection`, **`getStatusColor`** (`:155`, importer-less; badge `:6` is a comment) | `check-in-utils.test.ts:28-50, 81-150, 266-285, 306-369` + imports. `formatRelativeTime`, `prepareChartData`, `getStatusLabel` stay. |
| T5 | `parseNumericParam`, `sanitizeString` (`lib/api-utils.ts:50,70`) | `api-utils.test.ts:114-143, 178-end` |
| T6 | `getEventCaloriesByDay` (`utils/training-event-helpers.ts:224`) | `training-event-helpers.test.ts:353-400` |
| T7 | `thisMonthDates` (`utils/nutrition-calendar-selection.ts:54`) | `nutrition-calendar-selection.test.ts:70-94` |
| T8 | `hasAnyLoggedSet` (`utils/logged-set-rows.ts:104`) | `logged-set-rows.test.ts:152-160` |
| T9 | `isSlotLocked` (`program-builder-lock-model.ts:112-117`; every consumer reads `lockedSlotUids.has` directly) | `program-builder-lock-model.test.ts:133-136` + import `:6` |
| T10 | Cascades already listed: `resetNutritionEvent` (R8), `getCoachingWeekSummaryLive` + `requireClientAuthWithCheckInDay` (R3 if approved), `updateExercise`/`addExercise` (R10/R11), `getHabitStats` (X4) | as listed |

**KEEP exported — live code whose test is its spec (class 4 "test earns its place"):** `computeAdherence` (→ DROP_EXPORT only: called at `lib/check-in/adherence.ts:73`; delete its one describe `adherence.test.ts:14-21`; NOT superseded by `client-adherence-service` — CONVENTIONS:449 keeps the two adherence conventions), `mapRowToDailyLog`, `getTrainingPlanIdForDate`, `generateNutritionEvents` (scanner false positive — live in-file + scripts), `isDateEligible`, `progressSetSpecs`, `isContinuationOfDropSet`, `lockBoundaryWeekIndex`, `PlacedPlanLockSource`, `slotAcceptsDrag`, `METRIC_TABS`, `JOURNEY_SUBTABS`, `BLOCK_COLORS`, `ExerciseSearchSelection`, `completeTargets`, `ALERT_DESTINATIONS`, `ClientData`/`DismissalRow`, `deriveBlockState`/`deriveWeekOfTotal`, `ProfileEnergyFields`/`ResolveEffectiveGoalInput`/`GOAL_REACHED_TOLERANCE`, `planStatusSchema`/`exercisePerformanceSchema` (`sessionSchema` goes with R14), `sessionCompletionSchema`/`exerciseHighlightSchema`/`nutritionAdherenceSchema`, `programDraftSnapshotSchema`, `fallbackReview`, the activity-feed / adherence-service / energy-calc / amendment / assistant internals (`ACTIVITY_FEED_CAP`… `systemPrompt`, `buildWorkspaceFromRows`, `computeAmendmentToken`, `AmendmentEmptyFutureError`), `CM_PER_IN`, `SetRowValues`, `WalkthroughStepConfig`, `MetricEntryFeedRow`/`CheckInMetricPayload`/`LoggedSetInput`/`ProgressionExercise`/`RepsRange`.

---

## §7. DROP_EXPORT — symbol used in its own file, imported nowhere (tsc proves each)

Functions/constants: `validateCSRFToken` (`csrf-protection.ts:8`), `isPrivateHostname` (`url-safety.ts:5`), `readCoachPreference` (`viewer-preferences.ts:32`), `unitPreferenceKey` (`units-context.tsx:23`), `PROFILE_ITEM` (`activation-readiness-items.ts:49`), `toneFor` (`metric-derived-stats.ts:16`), `calculateMacros` (`nutrition-service.ts:198`), `weekOneLiner` (`draft-tool-helpers.ts:212`), **`calculateWeeklyAdherence`** (`weekly-nutrition-helpers.ts:128` — skeptic caught an in-file caller at `:100`; DELETE would have broken every weekly summary's adherence) + delete the re-export line `weekly-nutrition-service.ts:10` (nothing imports through it), `getCheckInCount`/`calculateCheckInAdherence`/`calculateCurrentStreak`/`calculateLongestStreak` (`check-in-adherence-service.ts` — module-private helpers of the live `updateClientAdherenceStats`; note the same-named `calculateCurrentStreak` in `daily-habits-logic` is a different, live function), `blockAcceptsSetup` (`block-card.tsx:63`; ARCHITECTURE:676 names the function, not the export), `formatForRule` (`progression-preview-model.ts:121`), `LOAD_VALUE_MIN/MAX` (`load-value-input.tsx:46-47`), `opLabelText` (`use-assistant-chat.ts:59`), `METRIC_OPTIONS` (`exercise-search-select.tsx:35`), D4's two value re-exports.

Schemas (composed locally): intake-steps enum + step schemas (after L1), `activityLevelSchema`/`trainingVolumeSchema`/`dietTypeSchema` (`nutrition.ts:4,12,14`), `setTypeSchema`/`prescribedFieldsSchema`/`completionQualitySchema`/`setPerformanceSchema` (`training.ts:66,118,361,363`), `exerciseDraftSnapshotSchema`/`sessionDraftSnapshotSchema`/`weekDraftSnapshotSchema`/`assistantTranscriptEntrySchema` (`assistant.ts:23,49,67,217`), `checkInReviewSchema` (`check-in-review.ts:19`).

Types (member/props types with local uses): `NutritionSettings`, `SavedPlanAssignments`, `UpcomingTrainingPlan`, `NavItem`, `IntensityLevel` (member of the documented legacy `DailyLog.trainingData` shape — export only), `ClientJourneyGoal`, `ManualExerciseDraft`, `CardProps` (repo-authored), `RowAction`; the client-portal props (`LockedDayReason`, `LockedDayNoticeProps`, `NutrientRowProps`, `MoodPickerProps`, `WellnessScaleProps`); metrics/blocks (`NewBlockEntry`, `BlockEdit`, `BlockBand`, `BlockBandLayout`, `BlockFormMode`, `BlockTimelineEntry`, `UseMergedMetricsResult`, `MetricCategory`, `MetricHeroProps`, `MetricSwitcherProps`, `MetricsTopBarProps`, `ProgressionRange`); `ProfileFormValues`, `StatusThumbSpec`, `LoadCommit`, `PlacedSessionPayload`, `PlacedSessionSource`, `DraftOpOutcome`, `ProgramOverwriteBody`, `StandaloneSessionPayload`, `ProgramBuilderProps`, `ProgramDraftContextValue`, `ProgressionPreviewRow`, `UseClientApply`, `PlacedPlanSeedInfo`; `types/check-in.ts` composite members (`TrainingMetrics`, `TrainingEventLogStatus`, `NutritionAdherence`, `AINutritionInsight`, `AINotesIntelligence`, `AITrainingInsight`, `AIWellnessInsight`, `AICoachAction`, `ChartDataPoint`); ~35 services/utils result/input types (`AuditActorRole`, `AuditEventInput`, `AuthUserIdentity`, `BodyMetricsQueryOpts`, `CheckInTrainingPeriodStats`, `PR_NEW_SESSION_GUARD`, `NewExerciseBest`, `GoverningPlanSegment`, `EnergyOverrideInstruction`, `RecalculateClientEnergyOptions`, `EnergyHalfDisposition`, `ClientEnergyStatus`, `ClientEnergyResult`, `ProgressDataPoint`, `START_METRIC_KEYS`, `ClientStartInput`, `StandaloneSessionInput`, `PlanDayTarget`, `PlanContextForDate`, `PlanGatedResource`, `NutritionLogInput`, `WellnessLogInput`, `DayEditState`, `PlaceablePlan`, `UpsertMetricEntryInput`, `NutritionPlanResult`, `CreateNutritionPlanParams`, `NutritionPlanVersionWindow`, `NextFutureNutritionPlan`, `ExerciseE1RMSeries`, `PlacedSlotEventLink`, `AmendPlacedPlanResult`, `TrainingLogRow`, `CompletionSummary`, `LoggedSetActuals`, `HeroStats`, `WindowChange`, `WeekComparison`, `DerivedLogRow`, `MetricPointSource`, `ProgressionResult`, `SpecEditableExercise`, `SetSpecEditResult`, `UnlinkedSessionLog`, `WeightDisplay`, `LengthDisplay`, `HeightDisplay`).

**KEEP exported (signature types of live exported functions — a caller must be able to name them):** `AlertDestination`, `CachedClientWithCheckInDay`, `ClientAuthResult`, `CoachAuthResult`, `BlockWindow`, `BlockDates`, `BlockEndingFacts`, `BlockPaceInputs`, `BlockWeightPoint`, `AdherenceResult`, `GoalPace`, `GoalStateInput`, `GoalState`, `GetPlanApiResponse`, `PaneOwnerTab`, `CanonicalInputKind`/`CanonicalInput`/`HeightInput` (CONVENTIONS:742 hooks), `SetupItem`/`PlanItem`, `clientGoalsKeyPrefix` (CONVENTIONS:271 key-builder rule), `ExerciseCatalogDeltaRow` (while S9 exists), `scrubHealthData` (scanner false positive — root-level Sentry configs import it).

**Class question (decision 10):** the props/member-type DROP_EXPORTs are mechanical and behaviour-free; say if you would rather leave props types exported as a file convention.

---

## §8. Dead types (zero references anywhere)

| ID | Item | Verdict |
|---|---|---|
| L1 | `lib/validations/client-intake.ts:4-28` — the re-export barrel of `intake-steps.ts` ("so existing consumers don't break"): 19 names, of which only `intakeStepSchemas` and `intakeFullSchema` are imported through it | **DELETE the barrel**; repoint `components/client/onboarding/intake-form.tsx:12` and `services/client-intake-service.ts:4` at `@/lib/validations/intake-steps`; the route schemas (`reviewIntakeSchema`, `activateClientSchema`, `intakeActionSchema`) stay in `client-intake.ts`. Then in `intake-steps.ts`: enum/step schemas → DROP_EXPORT (§7); `IntakeStep1-5Input`, `IntakeFullInput` (`:278-283`) → DELETE. ARCHITECTURE:193's `intakeStep1Schema` mention still resolves. |
| L2 | `lib/database-helpers.ts`: `ClientSessionCompletionRow` (`:28`, @deprecated shim) + 15 unused aliases (`ExerciseInsert`, `ExerciseLogUpdate`, `SetLogUpdate`, `CheckInUpdate`, `ClientInsert`, `TrainingPlanInsert`, `TrainingSessionInsert`, `TrainingExerciseInsert`, `BodyMetricsRow`, `ClientGoalInsert`, `ClientGoalUpdate`, `BodyMetricsInsert`, `CoachSavedPlanUpdate`, `CoachSavedSessionUpdate`, `CoachSavedExerciseUpdate`) | **DELETE**; live aliases stay. The header ("row types for easy reference") is a convenience catalogue, not a keep decision. |
| L3 | `types/auth.ts`: `SendInvitationRequest`, `AcceptInvitationRequest`, `InvitationDetailsRequest`, `SignupRequest`, `SignupResponse` | **DELETE** (routes validate with zod; not on the RN contract). |
| L4 | `acceptInvitationSchema` + `AcceptInvitationInput` (`invitation.ts:7,15`), `SendInvitationInput` (`:14`) | **DELETE** — the accept route never parses a password. |
| L5 | 14 `z.infer` Input aliases: `ClientSubmitCheckInInput`, `SessionCompletionInput`, `ExerciseHighlightInput`, `NutritionAdherenceInput` (`check-in.ts:183-186`), `ReplaceBlockChainPayload`, `UpdateGoalsInput`, `CreateClientNoteInput`, `UpdateClientNoteInput`, `NutritionCardInput`, `WellnessCardInput`, `CreateMetricEntryInput`, `SetPerformanceInput`, `ExercisePerformanceInput`, `AssistantChatRequest` | **DELETE** — schemas unaffected. |
| L6 | `types/check-in.ts`: `GenerateAISummaryRequest` (`:532`), `ReviewCheckInRequest` (`:542`), `SendReminderRequest` (`:657`), `UpdateCheckInConfigRequest` (`:667`), `GenerateNutritionPlanResponse` (`:721`), `UpdateClientMetricsRequest` (`:833`); then `ClientCheckInConfig` (`:630`), `MetricSaveOption` (`:831`) | **DELETE** — pre-refactor request/response shapes, not on the RN contract. |
| L7 | `types/content.ts`: `ContentItemWithAssignment`, `ContentFilters`, `ContentSearchResult`, `ContentUploadFormData`, `FolderFormData`, `AssignmentFormData`, `ContentCardProps`, `FolderCardProps`; `DailyHabitLogInput` (`daily-habit.ts:43`); `DailyLogInput` (`daily-log.ts:59` — embeds the orphaned `training_data` shape; ARCHITECTURE:919 protects the column and legacy rows, not this type); `BodyMetricsEventInput` (`body-metrics.ts:20`) | **DELETE**. |
| L8 | `__tests__/helpers/mock-data-builders.ts`: 9 unused builders (`createMockClient`, `createMockClientDatabaseRow`, `createMockCheckInRow`, `createMockTrainingPlanRow`, `createMockTrainingSessionRow`, `createMockTrainingExerciseRow`, `createMockCheckInFormData`, `createMockSessionCompletion`, `createMockExerciseHighlight`) + 6 option interfaces + the `weightUnit?` keys on `MockClientOptions`/`MockBodyMetricsRowOptions` (+ unused type imports); `__tests__/helpers/test-utils.ts`: `createPartial` (`:25`) and the `@testing-library` re-exports (`:5-7`, zero importers — every test imports the library directly) | **DELETE**. **`generateUUID`/`generateISODate` STAY** — skeptic caught the judge: the four live builders use them ~25 times. TD:607/:901 file-size rows update. |

---

## §9. Scripts and repo hygiene

| ID | Item | Verdict |
|---|---|---|
| S1 | `scripts/backfill-training-events.ts` | **DELETE** — filters on `day_of_week` (`:50`), inert post-121; not in package.json or any doc. |
| S2 | `scripts/backfill-nutrition-events.ts` | **DELETE** — one-off events-SOT backfill (migs 113-118), already run; imports stay live elsewhere. |
| S3 | `scripts/recompute-weekly-summaries.ts` | **DELETE** — "run AFTER" S2. With R13, `upsertWeeklySummary` then has no caller → delete it too. |
| S4 | `scripts/cleanup-duplicate-events.ts` | **DELETE** — self-described one-time cleanup; `.claude/settings.local.json:107-109` allowlist entries are evidence it ran (optional tidy). |
| S5 | `scripts/relink-session-logs.ts` | **DELETE** — pre-event-keyed relink; `session_logs` are event-keyed at write time. |
| S6 | `scripts/push-back-checkin-10-days.sql` | **DELETE** — dev hack hardcoding the owner's email; nothing references it. |
| S7 | `scripts/seed-exercise-data-smoke-test.sql` | **DELETE** — Session 1.9 fixture, pre-141 weight semantics; superseded by `seed-scale-client.ts` / `perf-correctness.ts`. |
| S8 | `scripts/cleanup-stuck-past-duplicates.ts` | **KEEP — honour its keep marker (decided — §20 #8)**: header is an explicit dated keep marker ("kept because its filter is the general shape…"), which is category one by the sweep's own rule, but it is also the keep-just-in-case argument the owner's standing rule says to drop. |
| S9 | `scripts/perf-catalog-delta.ts` (+ `ExerciseCatalogDeltaRow` export) | **MARK** — repeatable proof of the 1000-row paging on the RN delta endpoint; referenced by no doc. |
| S10 | `coverage/` — 22 tracked files from an accidental `git add -A` in `7a0c46c`; no `.gitignore` entry | **`git rm -r coverage/` + add `/coverage/` to `.gitignore`** — stale HTML copies of old source pollute every repo grep. |
| S11 | `tw-animate-css` | **LIVE** — knip is wrong; imported at `app/globals.css:2`. |
| — | `check:rls`, `check:labels` (+ whitelist + test), `check:service-key`, `seed-scale.ts` + `scripts/seed/*`, `seed-scale-client.ts` (documented weekday authoring, ARCHITECTURE:260), `perf-baseline.ts` + wrapper + fixtures, `perf-correctness.ts`, `env-bootstrap.ts`, `seed-exercise-catalog.ts` + `data/exercises.csv` | LIVE |

**Docs (report only, per the delete-after-shipping convention):** `docs/PER-SET-COMPLETION-EXECUTION-PLAN.md` — all four phases CLOSED and browser-smoked (`6972a08`, `fd2f439`); deletable, but `docs/DEAD-CODE-SWEEP.md` cites it. `docs/OVERVIEW-REDESIGN-EXECUTION-PLAN.md` — shipped 2026-07-26; overdue. `NUTRITION-CALENDAR-IMPLEMENTATION-SPEC.md` — header records the owner's decision to retain it as the design record; flagged only because it contradicts the convention.

---

## §10. Class decision — `components/ui/*` shadcn sub-exports (~45)

`AlertDialogPortal/Overlay`, `AlertTitle`, `badgeVariants`, `CardDescription/Action/Footer`, `CarouselPrevious/Next`, `CommandDialog/Shortcut/Separator`, `DialogClose/Overlay/Portal`, `DropdownMenuPortal/Group/RadioGroup/RadioItem/Shortcut/Sub/SubTrigger/SubContent`, `useFormField`, `ScrollBar`, `SelectScrollDownButton/UpButton/Separator`, `SheetTrigger/Footer`, `TableFooter/Caption`, `TabsList/TabsTrigger`, `ToastAction`, `TooltipProvider`; plus `hooks/use-toast.ts` `reducer`/`toast`.

**Recommend: leave intact + ONE marker line** in CONVENTIONS §6 under `/ui` ("vendored shadcn generator output; unused sub-exports are not refactor residue and are not swept"). These never had a caller, nobody reasons from them, and trimming ~45 exports across 17 files diverges from upstream for zero behaviour change. Exceptions handled individually: H22 (`use-mobile.tsx`, whole file), `CardProps` (repo-authored → DROP_EXPORT), and **`components/ui/chart.tsx`** — the judge proposed deleting the file; the skeptic found `components/metric-card.tsx:8` imports `Sparkline` from it by *relative* path and the coach dashboard renders it (`app/dashboard/page.tsx:58-79`). The file is LIVE. Optional (decision 10): a within-file delete of the seven unreferenced `Chart*` exports keeping `Sparkline`, since the file was repo-edited (`:7` imports `MONO`) and does read as current.

---

## §11. Deliberately kept — confirmed, no action

`components/clients/daily-pulse/*` (4 files; CONVENTIONS:243, ARCHITECTURE:643) · `styles/globals.css` (CONVENTIONS:215) · the three `/dashboard` redirect stubs (ARCHITECTURE:486) · `is_warmup`/`superset_group` · `training_logs.trained` (TD:763-771) · `training_data`/`activityStatuses` · `include_activity_burn` · the two wire tags `logTrainingEventSchema.weightUnit` (read at `training-log-service.ts:717`) and check-in `weightUnit`/`measurementUnit` (CONVENTIONS:765-772) · `clientGoalsKeyPrefix` · the status guards at `training-plan-window.ts:10-15` / `client-training-plan-service.ts:125-128` (ARCHITECTURE:266) · `getOverdueSeverity` facade (`check-in-tracking-service.ts:19-28`, marked at code) · `useWellnessData` (shared with the Overview) · `getSessionWithExercises` (RN session read) · `SET_TYPE_OPTIONS`, `MAX_DROPS` · `emails/*` (both rendered by live send paths) · `CLIENT-APP-REFERENCE.md` · `walkthroughCompletedAt` mapper field (H28) · `sendAutomatedReminders` (H6) · `calculateStreakFromLogs` (H27) · `getActiveNutritionPlanId` (H25).

---

## §12. Doc and comment lines that are wrong today — corrected in the same change regardless

- `services/training-event-occupancy.ts:151-154`, `docs/DEAD-CODE-SWEEP.md` seed 2, `docs/PER-SET-COMPLETION-EXECUTION-PLAN.md:627-631` — the dialog IS reachable (C1).
- ARCHITECTURE:545, :668; CONVENTIONS:250 — tray entry point (whichever way M6 goes).
- **ARCHITECTURE:283 claims `training_burn_calories` is "deprecated; 0 on new events"** — agent-verified it is computed at `nutrition-event-service.ts:132-138` and read for every day total (`nutrition-event-helpers.ts:21,35`, `nutrition-period-summary.ts:134`, edit service `:45`). I will re-verify before editing. (`external_burn_calories` IS dead: the only mention is a fixture key at `build-daily-targets.test.ts:263` — delete the key; the column is a migration matter.)
- ARCHITECTURE:782 / CONVENTIONS:378 — intake metrics sync is not audited on the live path today (R7 fixes it).
- ARCHITECTURE:276 lists `training_volume_hours` as a calculator input (X21 — it is deprecated and unread).
- TECHNICAL-DEBT rows: :141-146 (R4), :186-194 (R8), :487/:846 (H13), :553/:557 (H8/H1), :607/:901 (L8), :618/:826 (roadmap RPC/route rows → annotate as history the way :617 does), :771 (B5), :857 (R10/R11/R14/T2), :858 (R12), :878-882 (X12), :915 (H12), :413 (D4).
- Stale "phase"/"planned"/`client.weightUnit` wording on live code: `app/api/clients/[id]/nutrition/route.ts:117`, `nutrition-plan-hero.tsx:26`, `metric-entries-service.ts:57-60,110`, `habits-weekly-service.ts:121`, `use-nutrition-calendar-events.ts:30`, `nutrition-service.test.ts:27,55` (test names), `nutrition-plan-orchestrator.ts:226-228`, `training-service.ts:349-350`, `use-calendar-events.ts:63`, `training/events/route.ts:10`, `training.ts:501`, `coach-saved-plan-service.ts:619-621`, `training/route.test.ts:95-190` (fixture `status:'planned'` + test names — rename), `types/check-in.ts:42-48` (marker's last sentence is stale — the fields stayed as wire tags), `client-energy-calc.ts:144` (X10), `client-intake-service.ts:7` (H14), `weekly-nutrition-service.ts:220` (R3).
- CLIENT-APP-REFERENCE: add `/api/client/exercises/catalog` and `/api/client/walkthrough-seen`; `/client/progress` → `/client/metrics` (:78, :705, :723); `:350` documents `drops?: unknown[]` (real shape is `{load_value?, weight?, reps}[]`).
- `docs/CLIENT-PORTAL-EXECUTION-PLAN.md:593` bullet lists `ChartContainer` as a base utility (stale either way).

---

## §13. (superseded by §20)

---

## §14. HTTP methods with no caller on routes that ARE live (path-level scan blind spot)

| ID | Handler | Verdict | Evidence / cascade |
|---|---|---|---|
| X1 | `PATCH /api/check-in/[id]/review` (`route.ts:108-135`) | **DELETE** (POST stays) | Only caller is POST (`check-in-share-card.tsx:35-36`). Coach-auth handler (`getAuthenticatedCoachId()` `:19`, no token) — NOT the public-token class (b); pre-convention (`apiRateLimit` `:112`, no `request`). `updateCheckInResponse` stays for POST. No route test. |
| X2 | `GET` + `PATCH /api/content/items/[id]` (`route.ts:9`, `:67`) | **DELETE** (DELETE handler stays) | Only fetch is DELETE (`app/dashboard/content/page.tsx:167-168`); no SWR key reads it; uploads POST to `/api/content/items`. Cascade: `updateContentItem` (`content-item-service.ts:48`) + `UpdateContentItemInput` (`:9,:50`) + `updateContentItemSchema` (`lib/validations/content.ts:40`) — no tests. `getContentById` STAYS (download route). ARCHITECTURE:759's anon+RLS note about the content library is a note, not a keep. |
| X3 | `PATCH /api/training/saved-sessions/[savedSessionId]` (`route.ts:14-45`) | **DELETE** (DELETE stays) | Editor saves via POST `…/overwrite` (`use-standalone-session-editor.ts:141-144`); the bare path only gets DELETE (`library-session-list.tsx:114`). Cascade: `updateSavedSession` (`coach-saved-session-service.ts:8`) + `updateSavedSessionSchema` (`training.ts:343`) — no tests; reword the comment at `coach-standalone-session-service.ts:259`. |
| X4 | `?habitId=` single-habit branch of `GET /api/clients/[id]/habits/stats` (`route.ts:44, :77-86`) | **DELETE_WITH_TEST** (batch `?habitIds=` path stays) | Only caller sends the batch form (`use-client-habits.ts:53`). Cascade: `getHabitStats` (`daily-habits-stats.ts:25`; `getAllHabitStats` does not call it) + re-export `daily-habits-service.ts:325` + describe `daily-habits-service.test.ts:248-273` + import `:24`. |

---

## §15. Props threaded through several layers and never read (the `onEditPlan` shape)

Four same-named `onUpdate` props exist in this area; **two are dead, two are live** — the commit must name all four and touch only the dead ones (refresh-after-write fails silently if this is wrong, CONVENTIONS §7):

| Chain | Status |
|---|---|
| `app/clients/[id]/page.tsx:100` training → `training-plan-card.tsx:9,22,28` → `training-plan-builder.tsx:21,34,64` → `training-builder-context.tsx:18,24,26` → `use-training-plan.ts:10` | **DEAD (X5)** — `use-training-plan.ts:19` destructures only `{ clientId }`; the callback never fires. |
| `app/clients/[id]/page.tsx:109` nutrition → `NutritionCalculatorCardEnhanced` → `use-nutrition-builder.ts:22,30` | **LIVE — untouched** — fires at `:123`, `:154`, `:267`. |
| `app/clients/[id]/page.tsx:123` habits → `habits-tab-content.tsx:22` | **DEAD (X6, owner-cleared)** — declared, never referenced (the only in-file token is `onUpdateHabit`). |
| `training-builder-right-panel.tsx:132` `onUpdate={builder.fetchPlan}` → `training-calendar-view.tsx:29,75,482,510` | **LIVE — untouched** — invoked at `:510`; same folder as the dead chain. |

| ID | Item | Verdict |
|---|---|---|
| X5 | The training `onUpdate` chain (five sites above) | **DELETE the prop at all five sites** (owner-approved, scoped surgically; commit message lists all four chains). `mutateClient` stays (`page.tsx:82,91,109`). |
| X6 | `HabitsTabContent.onUpdate` (`:22`) + pass-through at page `:123` | **DELETE** (owner-cleared). |
| X7 | `DailyLogsTrainingSummary.trainingContext` (`daily-logs-training-summary.tsx:16,21` — destructured, never used) + pass-through `step-training.tsx:76` + the now-unused `CheckInTrainingContext` import (`:6`) | **DELETE**. `step-training.tsx` itself still reads `trainingContext` (`:51,:84,:87`) — stop there. |

---

## §16. Private dead code, dead re-exports, stale mocks, unused imports

| ID | Item | Verdict |
|---|---|---|
| X8 | `function fallbackEndDate(today)` (`training-event-service.ts:141-145`, module-private, zero callers) + its empty section header `:139` | **DELETE**. |
| X9 | `services/daily-habits-service.ts:12` `export { calculateCompletionRate, calculateCurrentStreak, mapArrayIndexToSortOrder } from "./daily-habits-logic"` — every consumer imports from `daily-habits-logic` directly | **DELETE** the line. |
| X10 | `services/nutrition-plan-orchestrator.test.ts:29` mocks `calculateTDEE`, which `nutrition-service.ts` no longer exports; stale comment `client-energy-calc.ts:144` | **DELETE** mock line; fix comment. |
| X11 | Unused imports: `ActivityLevel` at `use-client-profile-edit.ts:12` and `use-nutrition-builder.ts:9`; `useRouter` + `const router` at `floating-intake-panel.tsx:4,29` | **DELETE**. |
| X17 | `mapClientIntakeRow` → `reviewedAt`/`reviewedBy` (`lib/mappers.ts:250-251`, allow-list `:162`; `types/client-intake.ts:101-102,118-119`) — zero readers | **DELETE** mapped fields + type members (columns untouched). |

---

## §17. Build / CSS / asset residue

| ID | Item | Verdict |
|---|---|---|
| X12 | `tailwind.config.ts` (whole file) + `knip.json:24,48` entries | **DELETE (owner-cleared).** Tailwind v4 CSS-first: `postcss.config.mjs` loads only `@tailwindcss/postcss`; `app/globals.css:1` is `@import "tailwindcss"` with no `@config`; `components.json:7` is `"config": ""`; `shimmer` has zero usages. **STATUS-block note (owner):** the `shimmer` animation has been INERT since the v4 upgrade — nothing can regress, and this rules the file out as the cause if a broken shimmer is ever found. Fix TD:878-882 (advises adding tokens to the JS config). |
| X13 | `tailwindcss-animate` dependency (v3 plugin; only reference is knip's ignore list; the live package is `tw-animate-css` at `globals.css:2`) | **UNINSTALL — its own commit** (package.json + lockfile), owner decision 2026-08-25. Remove the knip ignore entry with it. |
| X14 | Unused `app/globals.css` tokens: `--chart-1..5` (`:38-42`, `:106-110`) + `--color-chart-1..5` (`:158-162`); `--sidebar*` ×8 (`:49-56`, `:113-120`) + `--color-sidebar*` (`:177-184`); `--error` (`:66`, `:125`) + `--color-error` (`:165`); `--color-surface-muted` (`:170`), `--color-surface-subtle` (`:171`); `.animate-pulse-ring` + `@keyframes pulse-ring` (`:216-230`); `.animate-drawer-fade-up` + `@keyframes drawerFadeUp` (`:271-288`) | **DELETE** — 0 `var()` refs, 0 utility uses (the `sidebar` hits are component names; the `*-error` hits are `data-error`/`on-error`/test ids), not named in `docs/newdesignsystem.md`. shadcn scaffold residue. Per the "verify rendered pixels" rule, HALF TWO diffs the emitted CSS bundle before/after to prove zero rendered change. |
| X15 | `public/placeholder-logo.png`, `placeholder-logo.svg`, `placeholder-user.jpg`, `placeholder.jpg`, `placeholder.svg` | **DELETE** — v0 scaffold; zero references in code, CSS or config. |
| X16 | `next.config.mjs:47` CSP `connect-src … https://api.openai.com` | **DROPPED FROM THE SWEEP (owner, 2026-08-25)** — a security-header change belongs in a deliberate hardening change with reachability reasoning recorded (CONVENTIONS §2). |

---

## §18. Schema fields and mapper outputs nothing reads — mark, don't retire

| ID | Item | Verdict |
|---|---|---|
| X18 | `mapClientRow` → `walkthroughCompletedAt` | **KEEP** — read side of the documented, unmounted walkthrough (H28). |
| X19 | `mapClientRow` → `lastReminderSentAt`, `totalCheckInsExpected`, `totalCheckInsCompleted`, `checkInAdherenceRate` | **STAY** — still read by the live `updateClientAdherenceStats` after H5/H7/H8. No action. |
| X20 | `nutritionPlanSchema.goalDeadline` (`lib/validations/nutrition.ts:47`) — the orchestrator reads `calcInputs.goalDeadline`, never the body; the web builder deliberately stopped sending it (`use-nutrition-builder.ts:229`) | **MARK** "accepted-but-IGNORED" exactly like the adjacent `workActivityLevel` marker (`:38-42`). An API contract field, so a marker rather than a removal. |
| X21 | `nutritionPlanSchema.trainingVolumeHours` (`:43`), `NutritionCalculationInput.bmr/.trainingVolumeHours/.trainingPlan` (`nutrition-service.ts:26,37,38`), `CreateNutritionPlanParams.trainingPlan` (`nutrition-plan-service.ts:78`), the three `trainingPlan: null, // vestigial` lines (`orchestrator:317,390,420`) | **KEEP this sweep** — `trainingVolumeHours` already carries a "Deprecated: kept for backward compat" marker and feeds the 24-arg RPC's `p_training_volume_hours`; retiring it is a write-path / RPC-signature change, not residue removal. Recorded so it is not mistaken for live calculator input (ARCHITECTURE:276 corrected in §12). |

---

## §19. Report-only — outside a code sweep

- **DB:** `clean_expired_tokens()` still exists in the live catalog (`types/database.ts:2812`) and `DELETE`s from `check_in_tokens`, which mig 142 dropped without a `DROP FUNCTION` — a broken function; `calculate_age` has no caller. Future-migration candidates. The four mig-008 adherence/reminder functions run from triggers — **not dead**.
- **Bug, not dead code:** `components/client/notifications-dropdown.tsx:193` links to `/client/notifications`, which has never existed. Removing it changes what a client sees; fix in its own change.
- **Critic negatives (recorded so the same reasoning that produced the Phase 4 smoke errors is not repeated):** mig 136's index is PARTIAL (`WHERE status='scheduled'`) — completed/skipped/missed rows still share dates, so no branch is dead on that basis; `clients.timezone` is `NOT NULL DEFAULT 'UTC'`, so every `client?.timezone ?? "UTC"` guards a missing row, not a null column; no orphan SWR key or invalidator; no env var read nowhere; no feature flags.
- **Dropped critic claims:** its "correction" about `exercisePerformanceSchema.weightUnit` (already KEEP in §11); X21's retirement; the DB items.

---

## §20. Decisions and commit plan

### Already decided by the owner (2026-08-25)

| Item | Decision |
|---|---|
| X12 | Cleared — delete; STATUS block records that `shimmer` has been inert since the v4 upgrade. |
| X6 | Cleared — delete. |
| X5 | Approved, scoped surgically: only the training chain; commit message lists all four `onUpdate` chains (§15) and confirms the nutrition and calendar ones are untouched. |
| X13 | Uninstall `tailwindcss-animate`, in its own commit. |
| B16, X16 | Dropped from the sweep — behaviour/security changes, not residue. |
| Commit shape | **Not one commit.** Split by risk class, each independently revertable. |

### Decided by the owner (2026-08-25, session 2) — nothing in §20 is open

Every former "still open" item was decided before commit 3 started. Do not re-ask any of these.

| # | Item | Decision |
|---|---|---|
| 1 | R3 client `weekly-nutrition` | **DELETE** (commit 3). Documented nowhere; the RN-contract protection is for documented endpoints, and its consumer is gone. Full cascade as listed on R3. |
| 2 | R18 `/client/progress` stub | **KEEP** + code marker + add to the ARCHITECTURE:486 stub list + fix CLIENT-APP-REFERENCE:78,705 (commit 7). |
| 3 | M6 "Edit whole plan" | **Browser-checked 2026-08-25 — it IS present. REMOVE it, in its OWN commit, not in this sweep.** Scope: `training-builder-right-panel.tsx:139` and the prop chain below it (`training-calendar-view.tsx:34,78,489`, `placed-session-editor.tsx:52,79,199-204`), the `Layers` import, the right-panel comment `:31-33`, and ARCHITECTURE:545/:668 + CONVENTIONS:250. **KEEP `:121` (`TrainingPlanHero`), `openAmend`, `amendOpen` and `PlanAmendmentOverlay`** — the hero sits in the panel that owns `builder.plan`, so it is correct by construction. Removing only the tray path also resolves the wrong-plan bug: `openAmend` resolves the plan from `builder.plan?.id` (`:51`) and never consults the tray's own `state.planId`, so with coexisting plans, editing a session from an upcoming program opened the amendment editor for the current one. |
| 4 | D2 `reps_target` | **Option A: preserve + marker** (commit 7). C3 shows a live read path for compact-only exercises; retirement changes what is rendered. |
| 5 | B9 / B11 `day_of_week` on the snapshot JSON / RN check-in-context payload | **KEEP both.** Stored-shape and RN-contract changes, explicitly out of scope. |
| 6 | H2b `includeDailyLogCounts` branch + `enrichWithDailyLogCounts` + tests | **DELETE_WITH_TEST, no marker** (commit 3). The route branch (`check-ins/route.ts:45-52`), `enrichWithDailyLogCounts` (`check-in-service.ts:256-281`) and `check-in-service.test.ts:463-567` all go. Days-logged already shows in the training and nutrition sections. No marker: markers are for code we KEEP unreferenced. |
| 7 | H26 `calculateStreaks` | **MARK** (commit 7). A perf-harness consumer is a consumer. |
| 8 | S8 `cleanup-stuck-past-duplicates.ts` | **HONOUR THE KEEP MARKER — do not delete.** The premise of this sweep is that marked dead code is safe and unmarked is not. Deleting something because you disagree with its marker undermines the thing being built. If the marker is wrong, that is a separate conversation. |
| 9 | §7 props/member-type DROP_EXPORTs | **APPLY — already executed in commit 2.** |
| 10 | §10 `chart.tsx` within-file trim | **LEAVE.** It is the one file the skeptic caught as nearly fatal; touching it again for zero behaviour change is asking for it. |
| 11 | Anything to KEEP instead | gets the one-line marker (commit 7). |

### Proposed commit sequence (each gated on `tsc`, `eslint`, `vitest`, `check:labels` green)

| # | Risk class | Contents |
|---|---|---|
| 1 | Inert assets, build config, CSS tokens | X12, X14 (with the emitted-CSS diff recorded), X15, S10 `coverage/`, S6/S7 SQL files |
| 2 | Unreferenced exports, private functions, stale mocks, type members | §7 DROP_EXPORTs, §8 types, H5/H7–H21/H23, T1–T9, B1–B3, B6, B8, B12, B13, X8–X11, X17, D1, D4, M5, L1–L8 |
| 3 | Orphan routes and their service cascades | R4–R13, R16, R17, H1–H4 hooks, + S1–S5 scripts (their only importers) |
| 4 | HTTP handlers on live routes | X1–X4, R14, R15 |
| 5 | Prop chains | X5, X7 (X6 folded in; commit message names all four `onUpdate` chains) |
| 6 | Unreachable-branch refactors with test rewrites | B4, B5 |
| 7 | Markers + comment reframing + doc corrections | M1–M4 markers/comments, H6/H24/H28/S9/X20 markers, the §12 doc lines, CLIENT-APP-REFERENCE additions, STATUS block appended to `docs/DEAD-CODE-SWEEP.md` (C2 closed, X12 shimmer note, test results) |
| 8 | Dependency | X13 `npm uninstall tailwindcss-animate` + knip ignore entry |

Former owner-decision items land in the class named on each decision above. This file is deleted in commit 7.

---

## HALF TWO — execution record

### Commit 1 — inert assets, build config, CSS tokens (landed 2026-08-25)

**Shipped:** X12 `tailwind.config.ts` deleted + its two `knip.json` entries; X14 (48 token/comment lines and the `pulse-ring` / `drawerFadeUp` keyframes + classes out of `app/globals.css`, 83 lines); X15 five `public/placeholder-*` files; S10 `coverage/` (22 tracked files) removed and `/coverage/` added to `.gitignore`; S6 `scripts/push-back-checkin-10-days.sql`; S7 `scripts/seed-exercise-data-smoke-test.sql`; TECHNICAL-DEBT.md:878-882 rewritten (tokens belong in `app/globals.css` `@theme inline`, not a JS config). This findings doc is committed here as the handoff artefact.

**X12 note for the STATUS block:** Tailwind here is v4 CSS-first (`postcss.config.mjs` loads only `@tailwindcss/postcss`; `app/globals.css:1` is `@import "tailwindcss"` with no `@config`; `components.json` has `"config": ""`), so `tailwind.config.ts` was never read and its `shimmer` animation has been **inert since the v4 upgrade**. Nothing can regress from its removal, and this rules the file out as the cause if anyone later finds a broken shimmer.

**X14 emitted-bundle diff (the proof, per the rendered-output rule):** `next build` before and after, `.next/static/chunks/*.css` split at rule boundaries and diffed. Every removed declaration appears in the diff (each `--chart-*`, `--sidebar*`, `--error` ×4 across light/dark × two chunks; `--color-chart-1`, `--color-sidebar`, `--color-error`, `--color-surface-muted/subtle`; both keyframes and both classes). Zero `var(--…)` references to any removed token remain in the after-bundle. One added line is a formatting artefact (`--color-border:var(--border)}` — it became the last declaration in its block).

**Unexpected but explained — the bundle shrank by more than the tokens.** The after-bundle also lost 20 palette variables (`--color-yellow/green/blue/gray-*`) and ~35 utilities (`.bg-gradient-to-r`, `.from-primary`, `.to-accent`, `.text-yellow-800`, `.bg-yellow-100`, `.text-gray-600/700/800`, `.hover\:bg-gray-50/100`, `.border-gray-200`, `.hover\:border-gray-300`, `.hover\:text-gray-900`, `.hover\:shadow`, `.dark\:bg-*-900\/20`, `.dark\:text-*-400`, `.bg-blue/green-100`, `.text-blue/green-800`, `.bg-gray-100`). Cause: Tailwind v4's automatic source detection had been scanning the stale, non-gitignored `coverage/` HTML (which embeds old source with class strings), so it emitted utilities for classes no live element carries. Verified: each of those class names has **0 hits** in `app/ components/ hooks/ lib/ contexts/ emails/ utils/ services/ types/ styles/` and **is present** in the deleted `coverage/*.html`. (The one apparent hit, `from-primary/5` in `hero-section.tsx`, is a different utility and is still emitted.) So removing `coverage/` also stopped shipping dead CSS — behaviour-neutral by construction, since nothing renders those classes.

**Gates:** `tsc` exit 0 · `eslint` 0 errors / 204 warnings (identical to baseline) · `vitest` 290 files, 3207 tests passed · `check:labels` OK (682 files).

**Deviations:** none. **Dropped:** none.

### Commit 2 — unreferenced exports, private functions, stale mocks, type members (landed 2026-08-25)

**Shipped** (152 files, +199 / −2093):
- §7 DROP_EXPORT — every listed function/constant/schema/props-member type (136 mechanical ops incl. the four `check-in-adherence-service` helpers, `calculateWeeklyAdherence` + the `weekly-nutrition-service.ts:10` re-export line, `computeAdherence` + its single describe, the intake-steps schemas, the ~35 services/utils result types, the component Props/member types). Kept exported as judged: the signature types (`PaneOwnerTab`, `CoachAuthResult`, …), `clientGoalsKeyPrefix`, and `hooks/use-toast` `reducer`/`toast` under the vendored-shadcn policy.
- §8 / L1–L8 — the `client-intake.ts` re-export barrel deleted and its two real importers (`intake-form.tsx`, `client-intake-service.ts`) repointed at `intake-steps`; the six `IntakeStep*Input` aliases; 16 `database-helpers` aliases; five `types/auth.ts` request shapes; `acceptInvitationSchema` + both invitation Input aliases; the 14 `z.infer` Input aliases; the six `types/check-in.ts` request/response shapes plus `ClientCheckInConfig`, `MetricSaveOption`; the eight `types/content.ts` interfaces; `DailyHabitLogInput`, `DailyLogInput`, `BodyMetricsEventInput`; nine `mock-data-builders` builders + six option interfaces (file 633 → 182 lines); `test-utils.ts` `createPartial` and the `@testing-library` re-exports (`generateUUID`/`generateISODate` kept, as the skeptic required).
- H5, H7, H8 (+ its now-unused `supabaseAdmin`/date-helper/`DayOfWeek` imports and a truthful header), H9 (seven storage helpers), H10, H11 (seven date helpers), H12, H13, H14 (+ header reworded), H15 (+ orphaned `TrainingVolume`/`TrainingPlan` imports), H16, H17, H18, H19 (+ header), H20, H21, **H22** (`components/ui/use-mobile.tsx` + its test — approved DELETE in §5 but omitted from every commit list in §20; included here as the natural home).
- T1–T9 with the named test blocks (`permanentlyDeleteClient`, `updateCheckInStatus`, `getDayOfWeekLowercase` ×2, the six `check-in-utils` helpers incl. `getStatusColor`, `parseNumericParam`/`sanitizeString`, `getEventCaloriesByDay`, `thisMonthDates`, `hasAnyLoggedSet`, `isSlotLocked`) and T4's `ProgressComparison` type cascade.
- B1 (both unreachable `if`s), B2, B3, B6 (+ inert mock key), B8, B12 (+ `types/check-in.ts:501` comment reworded to state the mig-142 fact rather than claim a live token flow), B13.
- X8, X10 (+ `client-energy-calc.ts:144` comment), X11, X17 (mapper fields + `ClientIntake` members).
- D1 (assistant `repsTarget` tool input), D4 (`use-set-spec-mutations.ts` value re-exports gone; `MAX_SET_SPECS` import dropped; three tests repointed at `utils/`), M5 (`futureEventsUpdated` + `renamedCount` + `.select("id")` + the PUT response key; six assertion lines trimmed, no test file deleted).
- TECHNICAL-DEBT.md rows tied to these removals: :417 (D4), :487 → Resolved and :846 annotated (H13), :553 (H8 grace window), :607 → Resolved-by-deletion and :901 recount (L8), :857 (`updateCheckInStatus` dropped from the §8 list), :915 (`deleteFutureEventsForPlan`).

**Deviations:**
- **H23 (`getEventForSessionAndDate`) moved to commit 3.** Its only importers are `scripts/backfill-training-events.ts` / `scripts/relink-session-logs.ts` (S1/S5, commit 3); `tsconfig` includes `scripts/`, so deleting it first fails `tsc`.
- **X9 correction.** The critic's "no file imports any of the three via `daily-habits-service`" missed `services/daily-habits-service.test.ts`, which imported `calculateCompletionRate`/`calculateCurrentStreak`/`mapArrayIndexToSortOrder` through that barrel (`tsc` caught it: 3 errors, 14 red tests). The barrel line stays deleted; the test now imports from the source module `./daily-habits-logic` — nothing deleted to make the removal possible.
- Blank-line hygiene: my block-deletion helper initially ate the blank on both sides of a removed block; a git-diff-driven pass re-inserted 40 separators and a scan found one more (`check-in-utils.ts`). Two files (`csrf-protection.ts`, `types/daily-log.ts`) show no trailing newline — pre-existing at HEAD, left alone.

**Dropped:** none.

**Gates:** `tsc` exit 0 · `eslint` 0 errors / 200 warnings (four fewer than baseline — the X11 unused imports) · `vitest` 289 files, 3148 tests passed (one test file and 59 cases removed WITH their dead code, all named above; none deleted to make a removal possible) · `check:labels` OK (680 files).

### Commit 8 — dependency (landed 2026-08-25, out of order by design: it moves package.json + the lockfile)

**Shipped:** X13 — `npm uninstall tailwindcss-animate` (the Tailwind v3 plugin; the live animation package is `tw-animate-css`, imported at `app/globals.css:2`) and its `knip.json` `ignoreDependencies` entry removed. `package-lock.json` updated by npm.

**Gates:** `tsc` exit 0 · `eslint` 0 errors / 200 warnings · `vitest` 289 files, 3148 tests passed · `check:labels` OK.

**Deviations / dropped:** none.

### Commit 3 — orphan routes, service cascades, one-off scripts (landed 2026-08-26)

**Shipped** (62 files, +69 / −3798):
- **Routes deleted:** R3 `GET /api/client/weekly-nutrition`; R4 `GET …/body-metrics`; R5 `GET …/history/habits` + `services/habits-history-service.ts` (whole) + `HabitMeta`/`HabitsHistoryRow`; R6 `POST …/intake/review`; R7 `POST …/intake/sync-metrics` — **route only**: `AUDIT_ACTIONS.INTAKE_SYNC_METRICS` is kept and is reference-less until the separate audit-move commit, whose payload was `void recordAuditEvent({ actorId: coachId, actorRole: "trainer", action: AUDIT_ACTIONS.INTAKE_SYNC_METRICS, targetTable: "clients", targetId: clientId, clientId, request })` after `syncMetricsToClient(clientId)`; R8 `PATCH …/nutrition/events/[date]/reset` + `resetNutritionEvent` + its describe (the `[date]` dir is gone); R9 `GET …/training/[planId]/events` (the `[eventId]/*` subtree untouched); R10 + R11 both exercise routes + `services/training-exercise-service.ts` (whole) + `updateExerciseSchema` (+ describe) + `UpdateExerciseRequest`/`AddExerciseRequest` + the barrel line + the two `set-specs-survival` input cases; R12 `GET …/period-stats`; R13 coach `GET …/weekly-nutrition` + `getWeeklySummaries`/`getLatestWeeklySummary`/`upsertWeeklySummary` (S3 was its last caller); R16 `GET …/reminders` + `getClientReminders` + `GetClientRemindersResponse`/`CheckInReminder`/`CheckInReminderRow`; R17 `app/sentry-example-page/`.
- H1 (`check-in-schedule-card.tsx`); H2 `useCheckInData` + **H2b** (the `includeDailyLogCounts` route flag, `enrichWithDailyLogCounts`, `CheckInWithDailyLogCounts`, the four cases in `check-in-service.test.ts` — no marker, per §20 #6); H3 `useCheckIn`, `useUnreviewedCount`; H4 `useClientReminders`; **H23** `getEventForSessionAndDate`; S1–S5 (S8 kept, per §20 #8).
- **R3 cascade** as listed: `getCoachingWeekSummaryLive` (+ `services/weekly-nutrition-service.test.ts`, whose ONLY describe tested it — the one test file removed), `requireClientAuthWithCheckInDay` + `ClientAuthWithCheckInDayResult` (+ describe), `getAuthenticatedClientWithCheckInDay` (+ describe).
- **Cascade extensions beyond the report** — each became importer-less or test-only solely because of a removal above, so the doc's own DELETE / DELETE_WITH_TEST rule applies: `getCachedClientWithCheckInDay` + `CachedClientWithCheckInDay` (`lib/auth-cache.ts`, + describe) and the stale `getAuthenticatedClientWithCheckInDay: vi.fn()` mock key in seven client route tests (the X10 shape); `mapRowToSummary` + `NWSRow` (`utils/weekly-nutrition-mappers.ts`); `getWeekStart` + `getWeekDays` (`lib/date-helpers.ts`, untested; `getWeekEnd` stays — `weekly-nutrition-helpers` uses it); `TrainingExerciseUpdate` (`lib/database-helpers.ts`); `resolveExercise` (singular — `resolveExercises` does not call it) + its describe + its stale mock key in `set-specs-survival.test.ts`. Owner may veto any of these; each is a plain re-add.
- **Docs in the same commit:** TECHNICAL-DEBT :141-147 (R4 — closed by deletion; the function's shape is unchanged), :186-194 (R8 bullet; "Four routes" → "The routes below"), :557 (H1 row), :709 (H2b → Resolved), :857/:858 (R10/R11 trimmed; R12's example repointed to `history/nutrition/summary/route.ts:22`); ARCHITECTURE :329 (R8 → the bulk `…/events/reset`), :532 (R11 — the handlers were deleted rather than given the lock), :764 (`:195` gate reference); NUTRITION-CALENDAR-IMPLEMENTATION-SPEC :111; CLIENT-PORTAL-REDESIGN :290. This doc's §20 "Still open" table is rewritten as decided (all 11) and every body row that said `OWNER DECISION` / `OWNER BROWSER CHECK` now points at its decision.
- Flag carried forward (R13): `nutrition_weekly_summaries` now has **no in-repo reader or writer** — a table follow-up, out of scope.

**Deviations:**
- **`client-check-in-service.test.ts` repointed, not just trimmed.** The stale `getWeeklySummaries` mock was hiding an accident: the module mock omitted `getNutritionSummaryForPeriod` (the symbol the service actually calls), so the real import was `undefined`, the `Promise.all` threw, and three `triggerAISummaryGeneration` tests were asserting the **catch** path (`undefined` logs, the fallback `Map`) — one said so in its own comment. The mock now covers all four period reads truthfully and the three assertions describe the happy path (`[]`, `[]`, the mocked `Map`). Nothing deleted; 10/10 pass.
- A stale `.next/` (a prior `next build`) reported phantom `TS2307` for every deleted route via `.next/types/validator.ts`; `rm -rf .next` (no dev server running) → `tsc` exit 0. The P7 rule again.
- **Recorded, not touched:** ARCHITECTURE:782 / CONVENTIONS:378 still claim intake metrics sync is audited — false today, already false before this commit (the deleted R7 route was the only implementer, and it had no caller), and owed to the audit-move commit that makes it true; `docs/DEAD-CODE-SWEEP.md` seeds 1/5 and PER-SET plan :645-652 are the sweep's own inputs / closed history and are left for the STATUS block; `.claude/settings.local.json` is untracked, so its S4/S5 allowlist entries stay; CLIENT-PORTAL-EXECUTION-PLAN.md session-history lines (:1409-1428, :2515-2527) stay as history.

**Dropped:** none — every candidate re-verified dead at execution time (fresh searches per route segment, per symbol, per re-export/mock, with the HTTP method checked on every fetch).

**Gates:** `tsc` exit 0 (after the `.next` purge) · `eslint` 0 errors / 164 warnings (36 fewer than baseline — all in deleted files) · `vitest` 288 files, 3117 tests passed (one test file and 31 cases removed WITH their dead code, all named above; none deleted to make a removal possible) · `check:labels` OK (666 files).

### Commit 4 — HTTP handlers on live routes (landed 2026-08-26)

**Re-verified at execution time with the METHOD of every caller checked** (a missed caller here is a 405, not a compile error): X1 — the only `…/review` fetch is `check-in-share-card.tsx:36`, `method: "POST"`. X2 — the only single-item fetch is `app/dashboard/content/page.tsx:168`, `method: "DELETE"`; uploads POST the collection. X3 — the only bare-path fetch is `library-session-list.tsx:115`, `method: "DELETE"`; the editor saves via POST `…/overwrite` (`use-standalone-session-editor.ts:141`). X4 — the only `/habits/stats` caller sends `habitIds=` (`use-client-habits.ts:53`). R14 — the three coach `/sessions/${…}` fetches are the SWR GET key (`use-placed-session-editor.ts:70`), the clone POST (`:157`) and the PUT (`:181`); `route.test.ts` imports `{ GET, PUT }` only. R15 — the `events/${…}` fetches are duplicate POST, move POST and DELETE ×2. No `method: "PATCH"` anywhere targets any of the six paths, and no `*.md` (CLIENT-APP-REFERENCE included) documents them.

**Shipped** (25 files, +27 / −852):
- X1 `PATCH /api/check-in/[id]/review` (POST, `verifyCoachOwnership` and `updateCheckInResponse` stay).
- X2 `GET` + `PATCH /api/content/items/[id]` + `updateContentItem` + `UpdateContentItemInput` + `updateContentItemSchema` (+ the route's then-unused `getCoachFolders` import). `getContentById` stays (download route).
- X3 `PATCH /api/training/saved-sessions/[savedSessionId]` + `updateSavedSession` + `updateSavedSessionSchema`; the `coach-standalone-session-service.ts` comment no longer names the deleted function; TECHNICAL-DEBT :281 reworded around the surviving DELETE.
- X4 the `?habitId=` single-habit branch + `getHabitStats` + its `daily-habits-service` re-export + its two cases (`HabitStats` and `getAllHabitStats` stay). A request without `habitIds` still 400s — the message now names only the surviving parameter.
- R14 `PATCH` + `DELETE …/training/[planId]/sessions/[sessionId]` + `updateSession`/`deleteSession` + `updateSessionSchema`/`sessionSchema`/`dayOfWeekSchema` (+ their two describes, 8 cases) + `UpdateSessionRequest` + `TrainingSessionUpdate`; the `training-service` barrel trimmed to `getSessionWithExercises` and the three stale mock keys dropped from `route.test.ts` (M4 — `updateSurplusForFutureEvents` keeps its direct importer `training-session-replace-service.ts` and its own tests). **B7 folds in:** `updateSession` was the last writer of `training_sessions.day_of_week`; CONVENTIONS:459 already states that placement writes it `null`, so no rule text changed. The `replaceSessionSchema` comment no longer cites "legacy sessionSchema".
- R15 `PATCH …/training/[planId]/events/[eventId]` + its route-local `patchEventSchema` + `updateEventSurplus` (the DELETE handler stays — live at `training-calendar-view.tsx:266,299`).
- Docs in the same commit: TECHNICAL-DEBT :192 (R15 bullet), :281 (X3), :857 (R14 mentions); ARCHITECTURE :332 cascade list now reads `events/[eventId]` (DELETE) and `[planId]/sessions/[sessionId]` (PUT); NUTRITION-CALENDAR-IMPLEMENTATION-SPEC :178.

**Deviations:** none in scope. `lib/database-helpers.ts` needed a blank-line collapse after the `TrainingSessionUpdate` deletion (whitespace only, applied after the gate run).

**Dropped:** none.

**Gates:** `tsc` exit 0 · `eslint` 0 errors / 163 warnings · `vitest` 288 files, 3107 tests passed (10 cases removed WITH their dead code: `dayOfWeekSchema` ×2, `sessionSchema` ×6, `getHabitStats` ×2; no test file deleted) · `check:labels` OK (666 files).

### Commit 5 — prop chains (landed 2026-08-26)

**The four same-named `onUpdate` chains in this area, and what happened to each (CONVENTIONS §7 — a wrong cut here fails silently as a stale screen):**
1. `app/clients/[id]/page.tsx` training tab → `TrainingPlanCard` → `TrainingPlanBuilder` → `TrainingBuilderProvider` → `useTrainingPlan` — **DEAD, removed (X5).** `useTrainingPlan` destructures only `{ clientId }`, so the callback never fired. Removed at all five sites: the page prop, `training-plan-card.tsx` (prop type, destructure, pass-through), `training-plan-builder.tsx` (same three), `contexts/training-builder-context.tsx` (prop type, destructure, the `useTrainingPlan` arg), `hooks/use-training-plan.ts` (the `onUpdate?` member of `UseTrainingPlanProps`).
2. `page.tsx` nutrition tab → `NutritionCalculatorCardEnhanced` → `use-nutrition-builder` — **LIVE, untouched** (fires at `:123`, `:154`, `:267`).
3. `page.tsx` habits tab → `HabitsTabContent` — **DEAD, removed (X6).** Declared on the props type, never referenced (the only in-file token is `onUpdateHabit`). The mount is now `<HabitsTabContent client={client} />`.
4. `training-builder-right-panel.tsx:132` `onUpdate={builder.fetchPlan}` → `training-calendar-view.tsx` (invoked at `:510`) — **LIVE, untouched.**

`mutateClient` keeps its three live callers on the page (`:82`, `:91`, the nutrition tab).

**X7:** `DailyLogsTrainingSummary.trainingContext` (destructured, never read) removed with its `CheckInTrainingContext` import; `step-training.tsx` no longer passes it but still reads `trainingContext` itself (`:51`, `:84`, `:87`) — stopped there, as specified.

**Deviations / dropped:** none. **Gates:** `tsc` exit 0 · `eslint` 0 errors / 162 warnings · `vitest` 288 files, 3107 tests passed · `check:labels` OK (666 files).

### Commit 6 — B4/B5 unreachable-branch refactors (landed 2026-08-26)

**Shipped** (11 files, +113 / −310):
- **B4.** `buildDailyTargetsFromPlan` lost its `trainingPlan` input and was converted from nine positionals to ONE options object, `BuildDailyTargetsInput` (named keys: `plan`, `dailyTargetRows`, `includeActivityBurn`, `dietType`, `surplusAsCarbs`, `trainingEvents`, `nutritionEvents`, `weekWindow`) — the brief's "make the class of error stop existing" option. `trainingSessionsFor(day)` now returns `[]` when no events are passed; `isTrainingDay`'s else-branch is untouched. `utils/training-calorie-helpers.ts` (`getTrainingSessionsSummary`) deleted. The sole caller (`services/client-portal-service.ts`) no longer fetches `getActiveTrainingPlan` (one fewer round trip per client nutrition read; `getActiveTrainingPlan` stays live for activation-readiness) and passes named keys; its test drops the stale `./training-service` mock and asserts `input.surplusAsCarbs` / `input.nutritionEvents` / `input.weekWindow` instead of `args[5]/[7]/[8]`. **Every one of the 16 calls in `utils/__tests__/build-daily-targets.test.ts` was rewritten to named keys and appears individually in the diff** (12 single-line, 3 brace-continued, 1 multi-line hand-edited). `utils/build-daily-targets.test.ts` collapsed from four tests to two: the two `build(conflictingPlan) toEqual build(null)` tautologies and the "KEEPS the plan branch reachable" test asserted exactly the behaviour being removed (its docblock claimed the client-portal caller "passes no events" — false at HEAD; it always passed an array); the event-driven Monday test stays and a no-events → `[]` test was added.
- **B5.** `estimateTargetForUnloggedDay` + `findActiveTrainingPlan` + the `trainingPlans` param of `buildNutritionSummary` removed (the no-event fallback is now the plan's weekday template, which is what the branch resolved to); `fetchTrainingDataForPeriod` + `TrainingPlanWithSessions` / `SessionLogRow` / `TrainingLogRow` removed from `schedule-data-service.ts` (its `sessionLogs`/`trainingLogs` were computed and discarded; header rewritten); both callers (`check-in-snapshot-service.ts`, `history/nutrition/route.ts`) drop the fetch and the argument — `nutritionEvents` is now the 4th positional, and the two test calls dropped their literal `undefined`. tsc enforces this one: `NutritionEvent[]` is not assignable to the removed `TrainingPlanWithSessions[]`. `PeriodSnapshot` / `NutritionDay` shapes unchanged; `fetchNutritionDataForPeriod` untouched.
- Docs: TECHNICAL-DEBT :768 (`training_logs.trained` readers — `fetchTrainingDataForPeriod` was one; the row's `:65` reference was already stale, corrected to the `:72` read plus the two row mappers) and :660 (the three-reader provenance note now says the first was dropped).

**Adversarial pass (four skeptic subagents over the working-tree diff — call-site mapping, the production caller, behaviour preservation, missed importers): NOT refuted.** The call-site skeptic listed all 18 `buildDailyTargetsFromPlan` calls with old→new mapping (the two calls carrying a non-default boolean — `surplusAsCarbs: true` at L112, `includeActivityBurn: false` at L160 — landed on the right key) and both `buildNutritionSummary` test calls; the importer skeptic found zero references to any removed symbol outside this doc.

**Deviations / owed:**
- **B5's "returns `baseCalories` on every real row" is proven structurally (every product writer sets `day_of_week: null`) and empirically on DEV only.** The behaviour skeptic probed Dev (`supabase db query --linked`): 8 of 23,402 `training_sessions` rows carry a non-null `day_of_week` (4 on one real client's pre-121 plan, 4 on the perf seed) and **all 8 have `estimated_calories: null`**, so the removed branch resolved to `baseCalories` for every Dev row — no value changes. **PROD is unprobed** (reaching it needs a re-link, which mutates `supabase/.temp`; not done from a sweep session). Owner-owed before trusting "no behaviour change" literally: `select count(*) from training_sessions where day_of_week is not null and estimated_calories > 0;` against prod. A non-zero count means an unlogged, EVENT-LESS (pre-backfill) day for that client would previously have shown baseline+burn in the check-in snapshot / nutrition history and now shows baseline. Dense event backfill (S2, already run) makes event-less days the exception.
- Error-path-only delta, by construction: the two removed fetches could throw and abort a snapshot / history read / program-card read; those throws can no longer occur. No returned value changes.
- Pre-existing, not touched: `app/api/clients/[id]/nutrition/route.test.ts:13` mocks `getActiveTrainingPlan` on a module the route under test does not import from (X10 shape; predates this commit).

**Dropped:** none. **Gates:** `tsc` exit 0 · `eslint` 0 errors / 162 warnings · `vitest` 288 files, 3105 tests passed (two tautological cases removed WITH the parameter they asserted, one added; no test file deleted) · `check:labels` OK (666 files).

### Owed commit — R7 audit move (landed 2026-08-26, outside the sweep: a fix, not residue)

`POST /api/clients/[id]/intake` (`action: "sync-metrics"`) now records the `intake.sync_metrics` audit event after `syncMetricsToClient` — the exact payload the deleted caller-less sub-route carried (actor = the authed coach, `actorRole: "trainer"`, `targetTable: "clients"`, `targetId`/`clientId` = the owned client, `request` for the hashed IP), `void`-prefixed after the already-authorized write, mirroring `activate/route.ts`. This is the ONLY implementer of the audit CONVENTIONS §8 mandates for intake metrics sync; ARCHITECTURE:782 / CONVENTIONS:378 are true again. §2 security review: no auth, ownership or validation change — the handler's chain (`coachApiRateLimit` → CSRF → `getAuthenticatedCoachId` → `client.coachId === coachId` → zod) is untouched and the audit write is fire-and-forget via `service_role` after it. No test covers the intake route (none existed before either). **Gates:** `tsc` 0 · `eslint` 0/162 · `vitest` 288 files, 3105 passed · `check:labels` OK.

### Owed commit — M6 removal (landed 2026-08-26, outside the sweep: the one behaviour change, deliberately its own commit)

Removed the placed-session tray's "Edit whole plan" item and its prop chain: `training-builder-right-panel.tsx` (the `onEditPlan` prop on `<TrainingCalendarView>` and its comment; the panel's header comment now records why the hero is the only entry point), `training-calendar-view.tsx` (prop type, destructure, pass-through), `placed-session-editor.tsx` (prop type, destructure, the menu item, the `Layers` import). **Kept:** the hero's `onEditPlan={openAmend}`, `openAmend`, `amendOpen`, `isFullyPast` (still gates the hero) and `PlanAmendmentOverlay` — the hero sits in the panel that owns `builder.plan`, so it is correct by construction. **The real reason (the commit message carries it):** the tray opens from an arbitrary calendar event, but `openAmend` resolves the plan from `builder.plan?.id` and hands it to the overlay, never consulting the tray's own `state.planId`; with coexisting plans the calendar shows events from more than one, so editing a session from an upcoming program opened the amendment editor for the current one — and that editor rewrites the future of whichever plan it opens. Removing the path leaves the hero as the only caller, so the removal IS the fix. Docs: ARCHITECTURE :545 (entry point + why), :668 (tab table), CONVENTIONS :250. No test covered the tray item (`training-plan-hero.test.tsx` covers the hero's seam and still passes). **Gates:** `tsc` 0 · `eslint` 0/162 · `vitest` 288 files, 3105 passed · `check:labels` OK.

### Session handoff (2026-08-26, end of session 2)

Landed: commits 1, 2, 8 (session 1) and **3 (`2f77714`), 4** (session 2). **Remaining, in order: 5 (prop chains X5/X6/X7 — the commit message must list all four `onUpdate` chains, §15), 6 (B4/B5 unreachable-branch refactors with test rewrites), 7 (markers + comment reframing + the §12 doc corrections + CLIENT-APP-REFERENCE additions + STATUS block appended to `docs/DEAD-CODE-SWEEP.md`; deletes this file; must be LAST).** Every §20 owner decision is recorded as decided — nothing is open; commit 7 executes the decided KEEP+marker items (R18, D2, H26, and any KEEP that wants a marker). Excluded from the sweep by owner decision: B16, X16, R7's audit move (own fix commit — the `recordAuditEvent` payload to restore is quoted in the commit-3 record, and ARCHITECTURE:782 / CONVENTIONS:378 become true through that commit, not through commit 7), M6's removal (own commit — browser-checked 2026-08-25, it IS present; scope in §20 #3). Also carried to commit 7's STATUS block: the R13 flag (`nutrition_weekly_summaries` now has no in-repo reader or writer — a table follow-up), and the commit-3 cascade extensions list, in case the owner wants any of them back.
