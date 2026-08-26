# Dead-Code Sweep — Execution Plan

Find every piece of refactor residue in the repo and remove it. **No behaviour change anywhere** — if removing something changes what a coach or client sees, it was not dead and does not belong in this workstream.

**Why this exists.** The codebase has been through several architecture reversals in a short window: events-as-SOT (migrations 113-118), migration 121 giving every placed day its own session row, the placed-plan editing overhaul deleting the whole legacy calendar drawer, nutrition plans moving from one durable row to date-ranged versions (144), roadmaps/phases removed entirely (133). Each left something behind.

The cost is not disk space. **Unmarked dead code reads as live and gets reasoned from.** During the per-set-completion review (2026-08-24/25) three separate wrong conclusions were drawn from unreferenced code that still looks current, each costing the owner a turn to unpick. That is the problem this fixes.

> **Scope note.** This is repo-wide, not scoped to any feature. It was found during the per-set-completion workstream (`docs/PER-SET-COMPLETION-EXECUTION-PLAN.md`) but is deliberately NOT a phase of it: that file is deleted once its workstream ships, and a sweep's record of what was kept and why has to outlive the sweep.

---

## Two kinds of dead code. Only one is in scope.

**Deliberately kept** — a recorded decision, with a doc entry saying what it is and why it stays:

- `components/clients/daily-pulse/` — frozen legacy, unmounted, "no deletion scheduled"
- the `upsert_daily_log_atomic()` RPC — "remains in the DB as an unused function… must not be used for new writes"
- `styles/globals.css` — "DEAD. imported by nothing"
- the `training_data` / `activityStatuses` JSONB — "orphaned cache", legacy rows only
- `/dashboard/training-library`, `/dashboard/programs/sessions`, `/dashboard/programs/exercises` — `redirect()` stubs kept so old links resolve

**Leave every one of these alone.** They have never misled anybody, precisely because they are marked — and that is the evidence for this workstream's central rule. The list above is illustrative, not exhaustive: **CONVENTIONS.md and docs/ARCHITECTURE.md are the authority**, and anything with an entry there explaining why it stays is category one.

**Refactor residue** — nothing references it, nothing decided it should stay, no note explains it. **This is the target.**

---

## Known seed

Verified during the per-set-completion Phase 2 review. Confirm each still holds, then extend — this is a starting point, not the scope.

1. **`app/api/clients/[id]/training/[planId]/sessions/[sessionId]/exercises/[exerciseId]/route.ts`** — **both** PATCH and DELETE handlers, no caller in `app/`, `components/` or `hooks/`. Orphaned when the legacy drawer was deleted in the placed-plan overhaul. Highest-risk item in the seed: the DELETE is an unguarded soft-delete, exactly the shape someone wires back up assuming it is safe because it exists. It also predates two conventions (`apiRateLimit` rather than `coachApiRateLimit`, and `getAuthenticatedCoachId()` without `request`), so it would fail review the day anyone did.
2. **The placed-session tray's scope dialog** — `placed-session-editor.tsx:236-280` ("All occurrences") and its trigger at `use-placed-session-editor.ts:106` (`>1 FUTURE SCHEDULED occurrence`). Since migration 121 every placed day owns its own session row, so that count is always 1 and the dialog can never open. This is the specific shape that produced two of the three wrong conclusions. If the dialog goes, check whether `getSessionEventLinks`' list-shaped return still earns its plurality (it moved to `services/training-event-occupancy.ts` in Phase 4, and the logged-day lock is now a second reader of it). **Correction (HALF ONE, C1, 2026-08-25): the premise is false — `duplicateEvent` copies `training_session_id`, so one session CAN own two future scheduled events after a per-event duplicate; the count exceeds 1 then and the dialog opens (`placed-session-editor.test.tsx` covers exactly that). The dialog is LIVE and was kept; the comments that asserted impossibility were corrected instead (STATUS block below).**

   > ⚠️ **Deleting this dialog does NOT license narrowing that read to `status = 'scheduled'`.** `assertSessionUnlogged` needs the non-scheduled rows and finds nothing without them. The function's docblock states that as the load-bearing reason, and `training-event-occupancy.test.ts` fails on a `status` filter appearing in the query, so the attempt cannot land quietly.

   **Three more shapes share this item's root cause — one placed day, one session row — and want judging together with it** (added by per-set-completion Phase 4's browser smoke, 2026-08-25):

   - **`replaceSessionFull`'s `identityChanged` branch** (`services/training-session-replace-service.ts`) reads as "propagate a rename to FUTURE SCHEDULED events", but its predicate matches exactly one event: the day being edited. Owner-confirmed correct behaviour — a tray rename is single-day and the plan builder owns renaming forward — so **the behaviour stays; it is the future/plural framing that misleads.** `updateSurplusForFutureEvents` (`training-session-service.ts`) has the same shape and is additionally called by the PATCH route, so judge them together rather than separately.
   - **`ReplaceSessionResult.futureEventsUpdated`** — computed as `Math.max(renamedCount, surplusAffectedDates.length)` to reconcile two counts that are now both 0 or 1, returned by the PUT, and read by **no caller**. Test-only reader (`route.test.ts`); false-positive class 4 applies.
   - **The tray's `onEditPlan` prop chain** (`training-builder-right-panel.tsx:139` -> `training-calendar-view.tsx:489` -> `placed-session-editor.tsx:199`). Source wires it, but the owner reports "Edit whole plan" is not on the calendar tray, and that the hero's "Edit plan" is the correct and only plan-level entry point. **Confirm in the browser before deciding** — this one is a behaviour question, not a reference count, and `docs/ARCHITECTURE.md` ("Plan amendment" -> Entry points) still names the tray as an entry point, so whichever way it goes that line needs correcting.

   > These are why this item matters beyond one dialog. Phase 4 wrote a browser-smoke checklist off two of them and got both wrong — a filter's shape read as evidence that the rows it filters can exist.
3. **`set-tracker.tsx:508`'s `?? view` fallback** — `prescribedViews[i]` is defined for every prescribed index, and the unplanned branch takes `view` directly at `:514`, so the fallback is unreachable.
4. **`SetSpec.reps_target`** (the per-set JSONB field) — added by the Phase 3 smoke fallout, 2026-08-25. Zero rows carry it in dev, and the builder's only writer was retired when the reps input went disabled for `amrap`/`failure` (the sole branch that ever rendered it). `buildPrescribedRows` now nulls it for those types, so nothing reads it for them either. **Not removed at the time** because that is this sweep's job, not a bug fix's, and because a live writer remains: the assistant's tool schema still exposes `repsTarget` (`services/assistant/draft-exercise-tools.ts:253`, written at `:294`). Retiring the field means retiring that tool input in the same change.

   > ⚠️ **`training_exercises.reps_target` is a DIFFERENT, LIVE thing that shares the name.** It is the exercise-level compact column — 3 rows in dev, written by eight services including `library-placement-service`, `plan-amendment-service` and `training-session-service`, and read by `expandSetSpecs` to synthesize specs for exercises with no `set_specs`. A sweep that greps `reps_target` and deletes both **breaks plan placement.** Scope any removal to the JSONB field.

5. **`app/api/clients/[id]/training/[planId]/sessions/[sessionId]/exercises/route.ts`** — **both** the POST (`addExercise`) and the PUT (`bulkReplaceExercises`) handlers, no caller in `app/`, `components/` or `hooks/`. Same folder and same provenance as seed item 1: orphaned when the legacy drawer was deleted in the placed-plan overhaul. Added by per-set-completion Phase 4, 2026-08-25. Like item 1 it predates a convention (`apiRateLimit` rather than `coachApiRateLimit`).

   > **Phase 4's logged-day lock deliberately does not cover these, and that gap is not an oversight.** `assertSessionUnlogged` guards `cloneSessionForEvent` and `replaceSessionFull`; the PUT here reaches `bulkReplaceExercises` directly, so it can still rewrite the exercise rows under a day the client has logged. It was left uncovered because it has no caller — removing it is the fix, and adding a guard to a handler nobody calls would make it look load-bearing. **If this sweep decides to KEEP either handler, it must gain the lock in the same change.**

---

## Method

Mechanical first, judgement second:

- API routes with no `fetch` caller in `app/`, `components/`, `hooks/`.
- Exported functions, components, types and hooks with no importer.
- Unreachable branches, and predicates a documented invariant makes always-true or always-false (the `?? view` shape).
- Cross-check every candidate against CONVENTIONS.md and docs/ARCHITECTURE.md before proposing it — a doc entry means it is category one.

### Four false-positive classes. Handle each by hand.

1. **`/api/client/**` is the React Native contract.** No web caller does NOT mean dead — RN calls it, or is being built to. Exclude the namespace from the mechanical pass and reason about it separately, naming anything genuinely unused rather than deleting it. A generic dead-code tool reports this entire surface as dead; that would be the single worst outcome of this workstream.
2. **`/api/check-in/**` is public and token-based**, reached from an emailed link rather than from app code.
3. **`waitlist_signups` and anything around it is written by a different repo** (`atletafit-marketing`) — see ARCHITECTURE → External Consumers. It looks dead to any grep of this repo and is not. Its `types/database.ts` entry is a mechanical `gen types` mirror, not evidence of a reader.
4. **Test-only exports.** A function whose only importer is its own test file is dead product code, but deleting it breaks a green test. Delete both, or say why the test still earns its place — do not leave an export alive purely to keep a test compiling, and do not delete a test to make a removal possible without saying so.

---

## Rules for the removal

- **Delete, never comment out.** Commented-out code is the same failure this workstream exists to fix, with worse ergonomics. Git history is the archive.
- **If a doc references what you delete, update the doc in the same commit.** CONVENTIONS.md and docs/ARCHITECTURE.md are the surviving record.
- **Anything KEPT despite being unreferenced gets a one-line marker at the code**, saying what it is and why. This is the actual fix for the reasoning problem: the five category-one items above prove marked dead code is safe, and the three seed items prove unmarked dead code is not. A marker at the code beats a doc entry, because the next reader is looking at the code.
- **Report before deleting.** The list is the deliverable of the first half; the deletions are the second. A candidate you are unsure about is reported, not removed.
- **The permanent record is the markers and the docs, not this file.** This file is deleted once the sweep ships, like every other completed execution plan. Anything that must survive it goes into a code comment, CONVENTIONS.md, or docs/ARCHITECTURE.md.

**Completion protocol:** at commit time, append a STATUS block to the end of this file — what was swept, what was removed, what was kept and why, and the test results.

---

## Pasteable prompt

```
Read CONVENTIONS.md (repo root) and docs/ARCHITECTURE.md in full before doing anything else — they are the authority on which unreferenced code is DELIBERATELY kept, and you cross-check every candidate against them. Then read docs/DEAD-CODE-SWEEP.md in full; it is the spec for this session.

This is a repo-wide sweep, not scoped to any feature. Two halves, and I want the first one before you touch anything.

HALF ONE — the sweep. Find every unreferenced API route, exported function, component, type and hook, plus branches a documented invariant makes unreachable. Start from the three verified seed items and extend well past them. Cross-check every candidate against the docs: anything with an entry explaining why it stays is DELIBERATELY kept and is not a candidate. Watch the four false-positive classes named in the plan — /api/client/** is the React Native contract and has no web caller by design, /api/check-in/** is reached from emailed links, waitlist_signups is written by a separate repo, and a function whose only importer is its own test is a judgement call. Report the full list — found, proposed action, and your reasoning per item — and WAIT for my approval.

HALF TWO — the removal, only for what I approve. Delete rather than comment out. Update any doc that references what you remove, in the same commit. Anything I tell you to KEEP gets a one-line marker at the code saying what it is and why it is still there — that marker is the whole point, so do not skip it.

Hard constraints: no behaviour change anywhere — if a removal changes what a coach or client sees, it was not dead and comes straight back out. Do not touch anything on the "deliberately kept" list. Do not delete a test to make a removal possible without telling me. Do not use `as any` or a type escape to make something compile after a removal — that means the removal was wrong.

When done: npx tsc --noEmit, npx eslint ., npx vitest run, npm run check:labels must ALL pass before you commit. One commit to main, then append a STATUS block to docs/DEAD-CODE-SWEEP.md (what was swept, what was removed, what was kept and why, test results) in that same commit.
```

---

## STATUS blocks

### STATUS — sweep complete (HALF ONE reported 2026-08-25; HALF TWO landed 2026-08-25/26)

**Eight risk-class commits on `main` (owner decision: never one commit — each independently revertable), plus two owed fix commits outside the sweep.** The per-commit execution records lived in `docs/dead-code-sweep-findings.md`, the report-before-removal deliverable, which this block summarises and which was deleted as the sweep's last act (commit 7). Its full text is in git history at that path.

| # | Commit | Class | What went |
|---|---|---|---|
| 1 | `61dd466` | inert build config, CSS tokens, assets | `tailwind.config.ts` (X12) + its knip entries; 48 unused `app/globals.css` token lines and the `pulse-ring` / `drawerFadeUp` keyframes+classes (X14); five `public/placeholder-*` scaffold files (X15); the 22 tracked `coverage/` files + a `.gitignore` entry (S10); two dev SQL hacks (S6, S7) |
| 2 | `6fbb2ea` | unreferenced exports, private functions, stale mocks, type members | 152 files, −2093: every §7 DROP_EXPORT (136 ops), the intake re-export barrel (L1) and ~60 dead types (L2–L8), H5/H7–H22 helpers, T1–T9 test-only helpers with their describes, B1–B3/B6/B8/B12/B13 unreachable branches, X8/X10/X11/X17, D1, D4, M5 |
| 8 | `82a3ac7` | dependency | `npm uninstall tailwindcss-animate` (the v3 plugin; `tw-animate-css` is the live one) + its knip ignore |
| 3 | `2f77714` | orphan routes, service cascades, one-off scripts | 62 files, −3798: routes R3–R13, R16, R17 (13 route files) with their service cascades (`training-exercise-service.ts`, `habits-history-service.ts` whole; `getCoachingWeekSummaryLive`, `requireClientAuthWithCheckInDay`, `getAuthenticatedClientWithCheckInDay`, the weekly-summary trio, `resetNutritionEvent`, `getClientReminders`, …); hooks H1–H4 (+H2b); H23 with its only importers, scripts S1–S5 |
| 4 | `e509196` | caller-less HTTP handlers on live routes | 25 files, −852: X1 `PATCH …/check-in/[id]/review`; X2 `GET`+`PATCH …/content/items/[id]`; X3 `PATCH …/saved-sessions/[id]`; X4 the `?habitId=` branch; R14 `PATCH`+`DELETE …/sessions/[sessionId]` (B7 folds in — `updateSession` was `day_of_week`'s last writer); R15 `PATCH …/events/[eventId]`. Every caller's HTTP method was checked literally before each handler came out |
| 5 | `c5a9887` | prop chains | X5 (the training `onUpdate` chain, five sites), X6 (`HabitsTabContent.onUpdate`), X7 (`DailyLogsTrainingSummary.trainingContext`). The nutrition and calendar `onUpdate` chains are live and untouched |
| 6 | `66e8d4e` | unreachable-branch refactors | B4: `buildDailyTargetsFromPlan` lost its unreachable `trainingPlan` input and became an options object (`BuildDailyTargetsInput`) so nine same-shaped positionals can never be mis-slotted again; `training-calorie-helpers.ts` gone; the client-portal read does one fewer round trip. B5: `estimateTargetForUnloggedDay` (matched `day_of_week`, null on every post-121 row), `fetchTrainingDataForPeriod` and its three types gone; both callers drop the fetch |
| 7 | this commit | markers, comment reframing, doc corrections, STATUS | M1–M4 comments now state the truth about post-121 event cardinality; KEEP markers on R18, D2, H6, H24, H26, H28, S9, X20 and the vendored `/ui` policy in CONVENTIONS §6; the §12 doc lines; CLIENT-APP-REFERENCE gains `/api/client/exercises/catalog` and `/api/client/walkthrough-seen`, the real `drops` shape and the `/client/metrics` location; this block; the findings doc deleted |

**Owed fixes landed alongside, each its own commit (not residue):** `e450af7` — R7's audit move: `POST …/intake` (`action: "sync-metrics"`) now records `intake.sync_metrics`; the only previous implementer was a caller-less sub-route, so ARCHITECTURE:782 / CONVENTIONS:378 were false until this. `eb62295` — M6: the tray's "Edit whole plan" removed; it resolved the plan from `builder.plan?.id`, never the event's, so with coexisting plans it amended the wrong program. The hero is now the only amendment entry point, by construction.

**Seed verdicts.** Seed 1 (exercise `[exerciseId]` PATCH/DELETE) and seed 5 (exercises POST/PUT) — confirmed dead, removed in commit 3 with `training-exercise-service.ts`. **Seed 2 — the scope dialog is NOT dead** (C1): `duplicateEvent` copies `training_session_id`, so a session can own two future scheduled events after a per-event duplicate, the count exceeds 1, and the dialog opens (`placed-session-editor.test.tsx` covers it). Kept; the three comments that asserted impossibility (`training-event-occupancy.ts`, seed item 2 above, PER-SET plan) were corrected in commit 7. **Seed 3 — already closed** (C2): `prescribedViews[i] ?? view` went in `ed4fe29`; the surviving `|| !prescribedView` is a harmless belt, not a candidate. **Seed 4 — `SetSpec.reps_target` kept with a marker** (D2, option A): `expandSetSpecs` / `snapshotToSpecs` synthesize it from the live exercise-level column for compact-only exercises and two renderers read it; the assistant's per-set writer (D1) was removed in commit 2. Retire it with the column.

**Findings that outlive the sweep.**
- **X12 / shimmer:** Tailwind here is v4 CSS-first (`postcss.config.mjs` loads only `@tailwindcss/postcss`; `app/globals.css` has no `@config`; `components.json` has `"config": ""`), so `tailwind.config.ts` was never read and its `shimmer` animation had been **inert since the v4 upgrade**. Its deletion can regress nothing, and it is ruled out as the cause if a broken shimmer is ever found.
- **`coverage/` was feeding Tailwind:** commit 1's emitted-CSS diff showed the bundle shrinking by ~35 utilities and 20 palette variables beyond the removed tokens. Cause: Tailwind v4's automatic source detection had been scanning the stale, non-gitignored `coverage/` HTML (which embeds old source with class strings) and emitting utilities no live element carries. Verified: each dropped class has 0 hits in source and is present in the deleted HTML. Removing `coverage/` stopped shipping dead CSS — behaviour-neutral by construction.
- **X9 correction (commit 2):** the critic's "no file imports the three habit helpers via the `daily-habits-service` barrel" missed `daily-habits-service.test.ts`; `tsc` caught it (3 errors, 14 red tests). The barrel line stayed deleted and the test was repointed at `./daily-habits-logic` — the pattern for the whole sweep: repoint a test at the source module, never delete it to make a removal possible.
- **Commit 3's `client-check-in-service.test.ts` accident:** its module mock omitted `getNutritionSummaryForPeriod` (the symbol the service calls), so the real import was `undefined`, the `Promise.all` threw, and three tests were asserting the CATCH path — one said so in its own comment. The mock is now truthful and the assertions describe the happy path.
- **Adversarial verification coverage:** every HALF ONE DELETE went to a skeptic (7 of 60 refuted — including `components/ui/chart.tsx`, whose deletion would have broken the coach dashboard through a relative-path import). **For commits 3 and 4 the subagent pass could not run** (session limit); their execution-time re-verification was solo grep — route segment, symbol, re-export, `vi.mock` key, and the HTTP method of every fetch — recorded per item in the findings doc's history. Commit 6's refactor got four skeptics over the diff (call-site mapping, the production caller, behaviour preservation, missed importers): not refuted.
- **B5 is proven on Dev, not Prod.** Every product writer sets `day_of_week: null`; the Dev probe found 8 legacy weekday rows, all with `estimated_calories: null`, so the removed burn estimate resolved to `baseCalories` everywhere there. **Owed on prod:** `select count(*) from training_sessions where day_of_week is not null and estimated_calories > 0;` — a non-zero count means an unlogged, EVENT-LESS (pre-backfill) day for that client would previously have shown baseline+burn in the check-in snapshot / nutrition history.
- **Cascade extensions beyond the report (commit 3), each a plain re-add if the owner wants it back:** `getCachedClientWithCheckInDay` (+ type, `lib/auth-cache.ts`), `mapRowToSummary` + `NWSRow`, `getWeekStart` + `getWeekDays`, `TrainingExerciseUpdate`, `resolveExercise` (singular; `resolveExercises` does not call it), plus the stale `getAuthenticatedClientWithCheckInDay: vi.fn()` mock key in seven client route tests.
- **Report-only, no action:** `nutrition_weekly_summaries` now has no in-repo reader or writer (R13's cascade) — a table, not code. `clean_expired_tokens()` still exists in the live catalog and `DELETE`s from a table migration 142 dropped; `calculate_age` has no caller — future-migration candidates. `components/client/notifications-dropdown.tsx` links to `/client/notifications`, which has never existed — a bug, not dead code; fix in its own change. A pre-existing stale mock key (`getActiveTrainingPlan` in `nutrition/route.test.ts`) was noticed in commit 6 and left.

**Excluded from the sweep by owner decision:** B16 (`/messages`, `/email` in the middleware `trainerRoutes` — removing them turns a signed-in client's redirect into a 404), X16 (the `api.openai.com` CSP host — a security-header change belongs in a deliberate hardening change), B9/B11 (`day_of_week` on the snapshot JSON / RN check-in-context payload — stored-shape and contract changes), B14 (`'planned'` enum member — a schema change), S8 (`cleanup-stuck-past-duplicates.ts` — it carries a dated keep marker, and the sweep's premise is that marked code is safe), the `chart.tsx` within-file trim (the file the skeptic caught as nearly fatal).

**Test ledger:** 290 files / 3207 tests before commit 1 → 288 / 3105 after commit 7. Two test files removed WITH their dead code (`components/ui/use-mobile.test.ts`, `services/weekly-nutrition-service.test.ts`); every other removed case is named in its commit's record; no test was deleted to make a removal possible. ESLint warnings 204 → 162 (all in deleted code, plus four unused imports); errors 0 throughout. `check:labels` OK at every commit.

**Two rules the sweep confirmed for the next one:** a filter's shape is not evidence that the rows it filters can exist (seed 2), and a surviving list/dialog/route is not evidence that a state is reachable — check the invariant in CONVENTIONS/ARCHITECTURE and flag the leftover instead of defending against it. And purge a stale `.next/` before judging `tsc`: an old build reports a phantom `TS2307` for every deleted route.

