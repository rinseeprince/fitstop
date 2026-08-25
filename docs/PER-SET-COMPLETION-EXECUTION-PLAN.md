# Per-Set Completion — Execution Plan

Rebuild of how a client records a workout and how that record reaches the coach. Today the client's log form sends a **compacted array** of filled sets with no identity, so a client who logs one working set out of six has it stored as set 1 and typed from the **warm-up** spec. That silently poisons every exercise metric — a logged Bench set currently reads as `0 sets against prescribed 4` on the Journey compliance chart.

**Split into 4 phases.** Phase 1 = the wire contract and the server write path. Phase 2 = the per-set completion model and the client UI that proves it. Phase 3 = the coach-facing logged-workout detail. Phase 4 = locking a logged day's prescription against coach edits. Each phase's pasteable prompt is at the bottom of its section. Do not start a phase before the previous phase's STATUS block reports shipped.

> Phase 4 was added on 2026-08-25, out of the Phase 2 review rather than the original brief. It closes a write path that lets a coach change the prescription under a day the client already logged — reachable, and data-corrupting since Phase 1 made `completion_quality` server-derived. (That review also turned up repo-wide refactor residue, which is its own workstream: `docs/DEAD-CODE-SWEEP.md`. It is deliberately NOT a phase here — this file gets deleted once the workstream ships, and a sweep's record of what was kept and why has to outlive it.)

> **STATE (2026-08-25): PHASES 1, 2 AND 3 ARE COMPLETE. Phase 4 is the only one outstanding.** Phase 1 carried no UI change; Phase 2 was browser-smoked by the owner and confirmed working; Phase 3 owes a browser smoke. Their STATUS blocks at the bottom of this file carry the deviations, the test results and the mutation tests. A client now ticks the sets they did, the server derives `completion_quality` from the prescription, every logged set carries its true `set_number` and coach-prescribed `set_type`, and the coach's readout shows the whole prescription against what was performed. What remains is the lock that keeps a logged day's prescription from changing underneath it (Phase 4).

**Completion protocol (every phase):** at commit time, append a STATUS block to the end of this file — what shipped, commit hash, deviations from this plan, test results. The next session reads it before starting.

---

## Locked product decisions (owner-approved 2026-08-24)

1. **A tick means "I did this set."** It is the only thing that decides completion. Values are optional detail on top.
2. **Typing auto-ticks.** Entering a value and moving to the next set marks that set complete, so a client recording numbers never touches a tick. This is deliberate insurance against forgetting.
3. **A ticked set with empty fields counts.** Doing the work is the claim; recording numbers is a bonus.
4. **`full` requires every prescribed WORKING set, on every exercise.** Hitting the prescribed load or RPE is irrelevant — only whether the set was done. Some working sets → `partial`. None → `skipped`.
5. **Warm-ups are recorded but never scored.** They render for the client, are tickable, and are written to `set_logs` with `set_type: 'warmup'` so a coach investigating an injury can see them. They are excluded from `full`, from compliance, and from every performance metric. Warm-ups are person-dependent and are not scrutinised.
6. **Ticked rows grey out.** Unticking restores them.
7. **The Skip toggle is DELETED.** An unticked set already says "not done"; a second way to say it is noise. "Deliberately skipped" vs "didn't get to it" is not a distinction a coach acts on.
8. **The quick-log complete/partial/skipped selector is DELETED.** The ticks answer it. `completion_quality` becomes server-derived.
9. **No draft persistence, no per-set server writes, no `localStorage`.** The web client portal is a test harness. The React Native app will keep the in-progress workout in device storage (AsyncStorage/MMKV) and POST once on "Complete workout" — that is the lock / close / restart / no-signal story, and it needs nothing from the server. **Live coach visibility mid-workout is explicitly not a feature.**
10. **No backfill.** There are no real clients; existing logged sets are test data. Where a client filled only a subset of prescribed sets, the true set number was never transmitted and is unrecoverable. Leave them.

---

## Global rules (every phase)

- **`/api/client/**` is the React Native contract.** These phases exist primarily to get that contract right BEFORE an app ships against it. Changing it later costs a coordinated app-store release. Build to the contract, not to the web rendering.
- **`components/client-portal/**` is a harness.** Its React is scaffolding that proves the contract works. `services/`, `lib/`, `utils/`, `app/api/`, and every coach surface under `components/clients/**` are the real, permanent product.
- **`set_specs` is the prescription; the compact columns are a maintained projection.** Never write `sets`/`reps_min`/`reps_max` by hand. Read through `expandSetSpecs`, never the columns (CONVENTIONS §8).
- **Set type is coach-prescribed, never client-chosen.** `set_logs.set_type` is stamped server-side from the prescription snapshot. The log schema accepts-but-ignores any client-supplied type.
- **`utils/set-spec-rows.ts` → `buildPrescribedRows()` is the ONE flattening.** A `drop` spec expands to its top set plus one row per drop. Client renderer, server stamping and coach display all go through it. Two implementations means set types misalign silently.
- **Analytics SQL is not to be touched.** `get_exercise_progression_window` and `get_exercise_prs` (migration 120) already filter `sl.set_type <> 'warmup'`. They start producing correct numbers the moment set types are stamped correctly. If a phase thinks it needs to edit them, it has misunderstood the bug.
- New/changed routes follow the CONVENTIONS §8 chain exactly (rate limit → CSRF on mutations → `getAuthenticatedClientId(request)` → ownership → zod → logic). Pass `request` to the auth helper.
- Migrations: next available number (149 is current max). **The owner runs `npx supabase db push` themselves** — pause and ask, then run `npx supabase gen types typescript --linked > types/database.ts` and commit migration + types together.
- **One commit per phase, to `main`, and only once every gate passes:** `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`, `npm run check:labels`. (`set-tracker.test.tsx` is a known flake in full runs — re-run before blaming your change.)
- Copy is British English, sentence case, no em dashes.

---

## Data contracts

### `setPerformanceSchema` (`lib/validations/training.ts`) — CHANGED

```ts
{
  setNumber: number   // NEW, REQUIRED. 1-based, the prescription's set number.
  reps?:   number
  weight?: number     // canonical kg
  rpe?:    number
}
```

**The client sends exactly the sets it completed, and nothing else.** There is no `completed` flag: presence in the array IS completion. An unticked set is simply absent.

This flows to BOTH write paths through `exercisePerformanceSchema`:
- `logTrainingEventSchema` → `POST /api/client/training/events/[eventId]/log`
- `logSessionForDateSchema` → `POST /api/client/training/session-logs`

**`setNumber` indexes the FLATTENED prescription** (`buildPrescribedRows` output, 1-based), not the spec array — so a drop set's three rows are 3, 4, 5, not three sets all claiming number 3.

### `set_logs` writes — CHANGED

- `set_number` comes from the payload's `setNumber`, never from array position.
- `set_type` comes from `prescribedRows[setNumber - 1]?.setType ?? "working"`.
- **The `setRowHasAnyValue` guard is removed.** A sent set is written even with all three values null — that is a truthful record of "did the set, logged no numbers".

### `completion_quality` — now SERVER-DERIVED

- When the payload carries `exercises`: the server derives it and **ignores** any client-supplied value. Count the sent sets whose flattened prescribed row is non-warmup, against the total non-warmup rows prescribed across the session. All → `full`. Some → `partial`. None → `skipped`.
- When the payload carries **no** `exercises` (quick-log via `training-session-checklist.tsx`, and any future RN quick path): the client's explicit `completionQuality` is used, exactly as today.
- `training_events.status` continues to derive from it via `mapCompletionQualityToEventStatus`. No consumer of that status changes.

### Migration `150_set_logs_set_number_unique.sql`

`UNIQUE (exercise_log_id, set_number)`. The write path cannot produce duplicates, but `set_number` is real identity from Phase 1 onward and the constraint is cheap insurance.

---

## PHASE 1 — Set identity on the wire · COMPLETE

> Shipped 2026-08-24 (`a5fe0e3`). See the Phase 1 STATUS block below.

**Scope:** the schema change, the server write path, the derivation, the migration, and one regression fix. **No UI changes.** The existing client form keeps working; it just starts sending set numbers.

**Why first:** this is the API contract RN will build against, and it fixes the live compliance bug on its own. Nothing downstream is meaningful until set numbers are real.

**Also in scope — a regression from the `prescribed_fields` work (2026-08-24):** `services/training-mappers.ts` `mapExerciseRow` does not carry `prescribed_fields`, so the client's workout tracker always receives `undefined` and renders all five columns regardless of the coach's picker. It slipped through because `TrainingExercise.prescribedFields` was declared **optional**. Fix the mapper AND make the field required on that type so it cannot be dropped silently again.

**Definition of done:** migration pushed + types regenerated + committed together; a logged working set is typed `working` and appears in the Journey compliance chart; all four gates pass; STATUS block appended.

### Pasteable prompt — Phase 1

```
Read CONVENTIONS.md (repo root) and docs/ARCHITECTURE.md in full before doing anything else. Then read docs/PER-SET-COMPLETION-EXECUTION-PLAN.md in full — it is the spec for this session and its "Data contracts" section is binding.

Implement PHASE 1 (set identity on the wire) exactly as specified there:

1. Add a required `setNumber` (1-based integer) to setPerformanceSchema in lib/validations/training.ts. It flows to both write paths via exercisePerformanceSchema. There is NO `completed` field — the client sends exactly the sets it completed, and presence in the array is completion.
2. components/client-portal/training/log-form-types.ts: buildLogPayload must send each set's 1-based index as setNumber and must stop using .filter() as its selection mechanism in a way that loses identity. Behaviour is otherwise unchanged this phase — a set with no values is still not sent.
3. services/training-log-service.ts (~line 586-605): write set_logs.set_number from the payload's setNumber, and stamp set_type from prescribedRows[setNumber - 1] where prescribedRows is buildPrescribedRows(snapshotToSpecs(snapshot)). Remove the setRowHasAnyValue guard so a sent set is always written.
4. Derive completion_quality server-side when the payload carries `exercises` (ignoring any client-supplied value); keep using the client's explicit value when it carries none. Rules are in the Data contracts section. Warm-ups are excluded from the denominator.
5. Migration 150: UNIQUE (exercise_log_id, set_number) on set_logs.
6. Regression fix: services/training-mappers.ts mapExerciseRow must carry prescribed_fields, and TrainingExercise.prescribedFields must become REQUIRED (not optional) in types/training.ts so no mapper can drop it silently again. Fix every call site the compiler surfaces.

Hard constraints: do not touch the analytics SQL (get_exercise_progression_window / get_exercise_prs already filter warm-ups correctly and start working once set types are right); do not change any adherence or check-in calculation; set_type stays coach-prescribed and client-supplied types are still ignored; buildPrescribedRows in utils/set-spec-rows.ts stays the single flattening used by both the renderer and the server. Extend services/set-specs-survival.test.ts if you add any exercise write path. I will run `npx supabase db push` myself when you ask — after that, regenerate types with `npx supabase gen types typescript --linked > types/database.ts` and commit migration + types together.

Show me your implementation plan first and wait for my approval before writing any code. Prove the fix with a test that logs a subset of prescribed sets (including one after a drop set) and asserts each set_log gets the right set_number and set_type — and mutation-test that it fails under the old positional mapping. When done: npx tsc --noEmit, npx eslint ., npx vitest run, npm run check:labels must ALL pass before you commit. One commit to main, then append a STATUS block to docs/PER-SET-COMPLETION-EXECUTION-PLAN.md (commit hash, deviations, test results) in that same commit.
```

---

## PHASE 2 — Per-set completion · COMPLETE

> Shipped 2026-08-24 (`ed4fe29`). See the Phase 2 STATUS block below.

**Scope:** the tick model in the client log form, the UI that expresses it, and the deletion of the two now-redundant controls. Server-side derivation already landed in Phase 1; this phase makes the client send truthful input to it.

**Component work:**

- **Tick per set row** in `components/client-portal/training/prescribed-set-grid.tsx` / `set-row.tsx`. Ticked rows grey out; unticking restores.
- **Auto-tick on value entry** — typing anything and blurring the row banks that set (locked decision 2).
- **Exercise-level tick** banks every set of that exercise in one tap.
- **Session-level "Mark all complete"** banks the whole workout in one tap.
- **Outcome line above the primary button**, stating what will be recorded: *"9 of 12 working sets logged. Will be recorded as partial."* The derivation must be visible before commit, because a coach's adherence number depends on it.
- **One primary button: "Complete workout."**
- **DELETE** `components/client-portal/training/quick-log-controls.tsx` and the `completionQuality` selector from the form. **`buildLogPayload` must then populate `completionQuality` itself**, from the same derivation the outcome line renders, sending `"skipped"` when nothing is ticked. `seedDefaultValues` seeds `""` for a never-logged session and `buildLogPayload` casts it unchecked, so leaving the field unset makes `set-tracker.tsx:328`'s client-side `safeParse` reject **every** save with "Some inputs are invalid" — a toast pointing at a control that no longer exists. The wire is already expressive enough (an all-unticked session has a true thing to say), so this is a client obligation, not a schema change.
- **DELETE** the per-exercise Skip toggle and the `skipped` field in `ExerciseFormValues`. `isSkippedLog` in `log-form-types.ts` goes with it; `exercise_logs.completed` becomes vestigial and is written `true` for any exercise with ticks.
- **`seedDefaultValues` / `restoreSetsFromLog` must rebuild the FULL prescribed row list** with ticks restored from the logged sets — not just the logged rows. This fixes the current behaviour where reopening a session shows one row instead of six.
- **Set-delete is restricted to rows the client appended past the prescription.** `exercise-tracker-block.tsx:382` passes `onRemove={remove}` unconditionally, so any prescribed row can be removed — which shifts every later row down and stamps a working set from the wrong spec (delete the warm-up row and one working set is stored as `warmup`, excluded from volume, PRs and compliance). Three parts:
  - **The affordance.** `prescribed-set-grid.tsx:114` gates on the truthiness of the `onRemove` **prop**, not on a per-row result, so a predicate returning `undefined` still draws a delete button that does nothing. Add `canRemove?: (index: number) => boolean` beside the action — the shape `canCopyPrevious` already uses at `:118-119` — and gate line 114 on it. Keep remove's hide-by-absence rendering rather than copy's disabled state (`set-row.tsx:204` vs `:220`): copy is contextually unavailable and clears as rows fill in, an undeletable prescribed row is structurally so, and a permanently dead trash icon on every prescribed row is worse than none.
  - **The source.** The predicate is `i >= prescribedRows.length`, and that is only meaningful if `prescribedRows` is the PRESCRIPTION. Today `set-tracker.tsx:515` passes `{ ...prescribedView, sets: field.sets.length }` and `exercise-tracker-block.tsx:87-102` feeds that into `expandSetSpecs`, which synthesises N working specs from `sets` whenever there are no authored `set_specs` — so for every compact-columns exercise `prescribedRows.length` tracks the FORM and the predicate can never fire. Drop the `sets:` override and pass `prescribedView` unmodified: the grid takes its row count from `fieldIds.length` (`prescribed-set-grid.tsx:57`) and already renders an appended row with no prescribed hints, so the override is not what keeps the count right. **Also set `sets: 0` on the unplanned `view` at `set-tracker.tsx:495`** — it carries `field.sets.length` too, so dropping the override alone would leave an unplanned exercise's rows *undeletable*, which is backwards. `sets: 0` is this file's own spelling of "nothing prescribed" (`exercise-tracker-block.tsx:88-91`), giving `prescribedRows = []` and every row deletable. No `isUnplanned` clause is then needed anywhere.
  - **Two visible knock-ons, both to confirm at Phase 2.** `formatSummary` (`:105`/`:467`) is the only other reader of `exercise.sets`: a prescribed exercise's summary line stops tracking appended rows and states the prescription, and an unplanned exercise's "3 sets" line disappears entirely (there is no prescription to summarise). Separately, the memo's zero-guard at `:91` is currently dead in form mode — `seededSetRows` floors the row count at 1 — and becomes reachable.
- Together these make the form's row list always mirror the flattened prescription, which is what makes positional `setNumber` sound end-to-end. Under the tick model an unticked row already says "not done", so deleting a prescribed row is the same redundancy as the Skip toggle (locked decision 7).

**Expect the coach's numbers to move.** `workouts_completed` will fall for clients who half-log today, and `partial` will start appearing where it never did. That is the number becoming true, not a regression.

**Definition of done:** a client can tick, type, mark-all, and complete; reopening restores the full prescription with ticks; `completion_quality` reflects reality; all four gates pass; STATUS block appended.

### Pasteable prompt — Phase 2

```
Read CONVENTIONS.md (repo root) and docs/ARCHITECTURE.md in full before doing anything else. Then read docs/PER-SET-COMPLETION-EXECUTION-PLAN.md in full — it is the spec for this session, its "Locked product decisions" are binding, and Phase 1's STATUS block at the bottom tells you what already shipped.

Implement PHASE 2 (per-set completion) exactly as specified there:

1. Add per-set completion state to the client log form. A tick means "I did this set". Typing a value and blurring the row auto-ticks it. A ticked set with empty fields still counts and is still sent.
2. Ticked rows grey out to read as banked; unticking restores them.
3. Add an exercise-level tick that banks all that exercise's sets, and a session-level "Mark all complete" that banks the whole workout.
4. buildLogPayload sends exactly the ticked sets, each with its setNumber (Phase 1's contract). Unticked sets are absent.
5. Replace the save affordance with one primary button, "Complete workout", and an outcome line above it stating what will be recorded (e.g. "9 of 12 working sets logged. Will be recorded as partial."). Warm-ups are excluded from that count.
6. DELETE components/client-portal/training/quick-log-controls.tsx and the completionQuality selector. The wire still carries completionQuality and the server still honours it when a payload has no `exercises` — do not remove it from the schema, only from the web UI.
7. DELETE the per-exercise Skip toggle, the `skipped` field on ExerciseFormValues, and isSkippedLog.
8. seedDefaultValues / restoreSetsFromLog must rebuild the FULL prescribed row list with ticks restored from the logged sets, so reopening a logged session shows every prescribed set rather than only the logged ones. Size the rebuild to max(prescribed row count, highest logged setNumber): a logged set past the prescription is reachable (the client appended rows, or the coach shrank the prescription afterwards) and the write path full-replaces, so a row missing from the rebuilt form is DELETED on the next save.
9. Restrict set-delete to rows the client appended past the prescription. Three parts, all specified in this section's component-work list above: add a `canRemove?: (index: number) => boolean` beside `onRemove` in prescribed-set-grid.tsx and gate the affordance on it (hide-by-absence, not a disabled state); drop the `sets: field.sets.length` override at set-tracker.tsx so `prescribedRows` describes the PRESCRIPTION rather than the form, and set `sets: 0` on the unplanned view so its rows stay deletable; the predicate is then `i >= prescribedRows.length`. Without this, deleting a prescribed row shifts every later row onto the wrong spec and item 8's rebuild does not close it.

Hard constraints: components/client-portal/** is a test harness for the React Native contract — do not put logic there that belongs in services/, lib/ or utils/; completion_quality derivation stays server-side (Phase 1); do not touch the analytics SQL; do not change training_events.status handling; warm-ups are tickable and logged but excluded from `full` and from every metric.

Show me your implementation plan first and wait for my approval before writing any code. Cover with tests: auto-tick on value entry, a ticked-but-empty set being sent, warm-ups excluded from the outcome count, and reopening a partially-logged session showing the full prescription with the right rows ticked. When done: npx tsc --noEmit, npx eslint ., npx vitest run, npm run check:labels must ALL pass before you commit. One commit to main, then append a STATUS block to docs/PER-SET-COMPLETION-EXECUTION-PLAN.md (commit hash, deviations, test results) in that same commit.
```

---

## PHASE 3 — Coach-side logged-workout detail · COMPLETE

> Shipped 2026-08-25. See the Phase 3 STATUS block below.

**Scope:** `components/clients/training/session-log-detail-dialog.tsx`, which is coach-facing and therefore permanent product.

Today it renders four hardcoded columns — Set / Reps / Weight / RPE — and builds its "Prescribed" chip from the compact snapshot columns only (`sets`, `reps_min/max`, `reps_target`, `rpe_target`). So a coach never sees prescribed load, set types, drop sets or AMRAP, even though `prescribed_exercise_snapshot.set_specs` captures all of it.

**Component work:**

- Read `prescribed_exercise_snapshot.set_specs` through `buildPrescribedRows` — the same kernel the client grid uses.
- Render **set-type tags** (`W` / `D` / `A` / `F`), the **prescribed Load** (`100kg`, `60% 1RM`, `60% top set`), and **drop sets as their flattened rows**.
- Align each logged set to the set it was prescribed as, via `set_logs.set_number`, so each row reads as prescribed-vs-actual: *set 3 · prescribed 10-12 @ 60% 1RM · did 8 @ 60kg · RPE 8*.
- **Warm-ups shown but visually unscored**, so a coach can investigate a niggle without them reading as performance.
- A prescribed set with no logged row renders as not done, rather than being omitted.

**Definition of done:** a coach opening a logged session sees the full prescription against what was performed; all four gates pass; STATUS block appended.

### Pasteable prompt — Phase 3

```
Read CONVENTIONS.md (repo root), docs/ARCHITECTURE.md, and docs/newdesignsystem.md in full before doing anything else. Then read docs/PER-SET-COMPLETION-EXECUTION-PLAN.md in full — it is the spec for this session, and the Phase 1 and Phase 2 STATUS blocks at the bottom tell you what already shipped.

Implement PHASE 3 (coach-side logged-workout detail) exactly as specified there. Rebuild components/clients/training/session-log-detail-dialog.tsx so it shows the whole prescription against what was performed:

1. Read prescribed_exercise_snapshot.set_specs through buildPrescribedRows (utils/set-spec-rows.ts) — the same flattening the client grid uses. Do not add a second implementation.
2. Render set-type tags (W / D / A / F, working untagged) and the prescribed Load cell, which may be absolute (in the viewer's unit), "% 1RM" or "% top set". formatPrescribedLoad already exists.
3. Drop sets render as their flattened sibling rows, matching what the client logged against.
4. Align each logged set to its prescribed set via set_logs.set_number, so a row reads prescribed-vs-actual rather than as an orphaned figure. A prescribed set with no logged row renders as not done rather than being omitted.
5. Warm-up rows are shown but visually marked as unscored — a coach investigating an injury needs them, but they must not read as performance.

Hard constraints: this is a coach surface, so docs/newdesignsystem.md applies in full — import tokens from components/clients/training/program-builder/builder-tokens.ts, mono is numbers only, and npm run check:labels enforces it. Loads are canonical kg on the wire and render in the VIEWER's unit via utils/unit-conversions.ts (formatLoad, since this is a read-only readout). Do not change the analytics SQL, any adherence calculation, or anything under components/client-portal/**.

Show me your implementation plan first and wait for my approval before writing any code. When done: npx tsc --noEmit, npx eslint ., npx vitest run, npm run check:labels must ALL pass before you commit. One commit to main, then append a STATUS block to docs/PER-SET-COMPLETION-EXECUTION-PLAN.md (commit hash, deviations, test results) in that same commit.
```

---

## PHASE 4 — Lock a logged day's prescription · OUTSTANDING

**Scope:** one assertion in the service layer, its two call sites, the route translation, and the tray's entry state. **No client-portal change, no schema change, no read-path change.**

**The bug.** A coach can open a day the client has already logged in the placed-session tray and edit it. Both save paths then mutate the session behind that logged event:

- **"Just this day"** → `POST …/sessions/[sessionId]/clone` → `cloneSessionForEvent` (`services/training-session-service.ts:203`) inserts a new `training_sessions` row, inserts **new `training_exercises` rows with new ids**, and repoints `training_events.training_session_id` at the clone.
- **The save itself** → `PUT …/sessions/[sessionId]` → `replaceSessionFull` → `bulkReplaceExercises`, which soft-deletes the exercise rows and inserts replacements. Its status filters (`.eq("status","scheduled").gte("date", fromDate)`) guard only the *event snapshot* writes — the name, focus and surplus. **The exercise rewrite is not guarded at all.**

Either way the client's `exercise_logs.training_exercise_id` values stop matching anything live. `getTrainingEventDetail` then appends a snapshot block per unmatched log (`services/training-log-service.ts:1036`), but `prescribed_exercise_snapshot` carries no `id`, so `normalizeExercise` mints `snapshot-N` and `seedDefaultValues` files the same log a second time as an orphan. Each exercise renders up to three times: the clone's version (blank), a snapshot version (blank), and the orphan holding the real sets.

**Why it now corrupts data rather than just rendering badly.** Before Phase 1 the client's own tap decided `completion_quality`, so the grade survived. Now the blank blocks count in the denominator and the orphan (flagged unplanned) scores neither half, so the client is shown *"0 of 6 working sets logged. Will be recorded as skipped"* after a full workout, and the server records `partial`.

**Why locking is the fix and not a patch.** The state is incoherent, not merely mis-rendered: the client completed prescription A and the coach has replaced it with B. There is no correct answer to "what fraction of B did they complete", so tidying the render would only display an incoherent state more neatly. The real defect is that a logged day's prescription can change at all — and **the product already says it cannot**: `program-builder-lock-model.ts:13,63` locks any slot whose linked event has left `scheduled`. The plan builder honours that rule; the calendar tray never consults it. This closes a gap in an existing invariant.

**The work:**

- **One assertion**, beside `assertDateFree` in `services/training-event-occupancy.ts` — that module is already this codebase's home for "a rule every event-write path must honour". It reads the session's linked events (`getSessionEventLinks` already does exactly this, client-scoped) and throws when any has `status !== "scheduled"`.
- **Called INSIDE `cloneSessionForEvent` and `replaceSessionFull`**, not in the route handlers. Inside the service means a future caller inherits the rule instead of having to remember it.
- **A typed error the routes translate to 409** with plain-language copy, following the `DayLockedError` / `TrainingLogOwnershipError` precedent. A raw service error must never reach a coach (CONVENTIONS §10).
- **The tray's edit entry disabled for those days**, so a coach sees a locked state rather than clicking into an editor that fails on save. Without this the lock reads as a bug.

**Predicate: `status !== "scheduled"`.** Equivalent to "the event has a `session_log_id`", since `linkSessionLogToEvent` writes both together — use status, because that is the wording the lock model already uses and the two surfaces should say the same thing.

**Explicitly out of scope.** Do not add an `id` to `prescribed_exercise_snapshot` — with the lock in place nothing reaches the duplication, and fixing a state that can no longer occur is dead weight. Do not backfill (locked decision 10; any test client already in this state stays broken). Do not widen the predicate to past-but-unlogged days: the plan builder locks those for a different reason (the date walk) and nothing here needs it.

**Definition of done:** a logged day cannot be edited from the calendar through either save path; the tray shows it as locked rather than erroring; CONVENTIONS §2's security/perf review has been run and reported (a route's validation changed); all four gates pass; STATUS block appended.

### Pasteable prompt — Phase 4

```
Read CONVENTIONS.md (repo root) and docs/ARCHITECTURE.md in full before doing anything else. Then read docs/PER-SET-COMPLETION-EXECUTION-PLAN.md in full — it is the spec for this session, and the Phase 1, 2 and 3 STATUS blocks at the bottom tell you what already shipped.

Implement PHASE 4 (lock a logged day's prescription) exactly as specified there.

1. Add one assertion to services/training-event-occupancy.ts, beside assertDateFree: given a sessionId and clientId, throw a typed error when any event linked to that session has status !== "scheduled". getSessionEventLinks (services/training-session-replace-service.ts) already reads those events client-scoped — use it rather than writing a second read.
2. Call it INSIDE cloneSessionForEvent (services/training-session-service.ts) and replaceSessionFull (services/training-session-replace-service.ts), not in the route handlers, so any future caller inherits the rule.
3. Translate the error to 409 with plain-language copy in both routes, following the DayLockedError / TrainingLogOwnershipError precedent. No raw service error reaches a coach.
4. Disable the placed-session tray's edit entry for a day whose event is not `scheduled`, so the coach sees a locked state instead of a save that fails.

Hard constraints: the predicate is `status !== "scheduled"` — the same rule program-builder-lock-model.ts:63 already applies in the plan builder; do NOT invent a second one. Do not add an id to prescribed_exercise_snapshot, do not backfill existing corrupted logs, do not widen the lock to past-but-unlogged days, and change nothing under components/client-portal/**, no analytics SQL, no adherence maths, no schema.

Show me your implementation plan first and wait for my approval before writing any code. Prove it with a test that a clone and a full replace against a logged event both refuse, and that both still succeed against a scheduled one. Run CONVENTIONS §2's security/perf review and report it unprompted — a route's validation changed. When done: npx tsc --noEmit, npx eslint ., npx vitest run, npm run check:labels must ALL pass before you commit. One commit to main, then append a STATUS block to docs/PER-SET-COMPLETION-EXECUTION-PLAN.md in that same commit.
```

---

## STATUS blocks

*(Each phase appends its own here at commit time.)*

---

### PHASE 1 — SHIPPED (2026-08-24)

**Commit:** `feat(training): set identity on the wire — per-set completion Phase 1` — the single commit this block ships in. (No hash is written here: a hash cannot name the commit that contains it, and stamping one by amending only orphans the commit it named. `git log --oneline --grep "set identity on the wire"` resolves it.)

**Shipped**

1. `setPerformanceSchema.setNumber` — required, 1-based, bounded by `MAX_PRESCRIBED_ROWS`. Reaches both write paths through `exercisePerformanceSchema`; neither route file changed.
2. `buildLogPayload` mints `setNumber` in the `.map()`, before the `.filter()`. Behaviour otherwise unchanged.
3. `set_logs.set_number` comes from the payload; `set_type` from `prescribedRows[setNumber - 1]`. The `setRowHasAnyValue` guard is gone — a sent set is always written.
4. `completion_quality` is server-derived whenever the payload carries `exercises`.
5. Regression fix: `mapExerciseRow` carries `prescribed_fields`; `TrainingExercise.prescribedFields` is required.

**Deviations from the plan as written**

- **Migration 150 was NOT written.** `UNIQUE (exercise_log_id, set_number)` already exists — created by `090_normalize_set_logs.sql:30` and verified against the live dev catalogue as `set_logs_exercise_log_id_set_number_key`. A plain `ADD CONSTRAINT` would have failed with `42710`. **Prod is unverified** (`supabase db query` has no `--project-ref`, and checking would mean re-linking); if prod ever proves to lack it, that is a new migration. Nothing was pushed and `types/database.ts` is untouched. Owner decision, 2026-08-24.
- **The completion-quality denominator required a new read.** Locked decision 4 is "every prescribed working set, on EVERY exercise", and an exercise the client never touched is absent from the payload entirely — so the denominator cannot come from the payload. `loadSessionPrescription` reads the performed session's active exercises. It is `Promise.all`-ed with the existing by-id snapshot read (extracted as `loadExerciseSnapshots`), so it costs no extra round trip, and it fires only in detailed mode. Owner-approved.
- **The derivation is per-exercise, not one session-wide ratio.** `deriveCompletionQuality` (`utils/completion-quality.ts`) judges each exercise against its own prescription and requires all, so no exercise's surplus can mask another's deficit. Behaviourally identical to a summed ratio under the current guards — **no test can distinguish the two forms** — but it makes decision 4 structural rather than a consequence of an unstated injectivity property. `null` is returned when nothing is scorable, and the caller then keeps the client's own claim.
- **`prescribed_fields` was added to the log's `ExerciseSnapshot`** (owner-approved scope addition). The client tracker's snapshot fallback read `prescribed_fields` from a snapshot that never captured it, so a soft-deleted session widened the grid back to all five columns — the same bug class as the `mapExerciseRow` regression.

**Known gaps left open, both Phase 2's — BOTH CLOSED by Phase 2 (2026-08-24)**

- **Reopen renumbers. CLOSED.** `restoreSetsFromLog` rebuilt only the LOGGED rows, so a session logged as sets 3-5 reopened as a 3-row form and re-saved as 1-3. Pre-existing; Phase 1 neither fixed nor worsened it. Phase 2's item 8 rebuilds the full prescribed row list with the logged rows ticked, and sizes it to hold a logged set PAST the prescription too.
- **Delete renumbers, independently. CLOSED.** `exercise-tracker-block.tsx:382` let a client remove any prescribed row, which shifted every later row onto the wrong spec. This needed no reopen and item 8's rebuild alone did **not** close it — the set-delete restriction did (`canRemove`, plus dropping the `sets:` override so `prescribedRows` describes the prescription rather than the form). Both causes are now closed, so positional `setNumber` is sound end-to-end.

**Not extended:** `services/set-specs-survival.test.ts` — Phase 1 adds no exercise write path.

**Test results** — all four gates green.

- `npx tsc --noEmit` — clean
- `npx eslint .` — 0 errors (204 pre-existing warnings, unchanged from baseline)
- `npx vitest run` — 287 files, 3111 tests, all passing (baseline was 286 / 3088)
- `npm run check:labels` — OK

**Mutation test.** Reverting `training-log-service.ts` to the old positional mapping (`set_number: setIdx + 1`, `prescribedRows[setIdx]`) fails the new subset test with `expected [ 1, 2, 3 ] to deeply equal [ 2, 5, 6 ]`. Restored from a scratchpad copy and `diff`-verified byte-identical, with the suite re-run green afterwards.

---

### PHASE 2 — SHIPPED (2026-08-24)

**Commit:** `feat(training): per-set completion — the tick is the claim` — the single commit this block ships in. (No hash, for the reason Phase 1 records: a commit cannot name itself, and amending one in only orphans the commit it named. `git log --oneline --grep "the tick is the claim"` resolves it.)

**Shipped**

1. **Per-set completion state.** `SetRowValues.completed` — the only thing that decides what is sent. A tick column leads the grid in form mode (`setGridTemplate(fields, withTick)`, decided once by the grid so the header and rows cannot drift). Typing a value and blurring the row auto-ticks it (`withAutoTick` composes onto RHF's own `onBlur` rather than replacing it, so validation and touched-state bookkeeping still run). It only ever ticks — clearing a field never unticks, because a banked set with empty fields is a legitimate record.
2. **Ticked rows grey out** (muted background, muted values, `data-completed` for the tests) and are never disabled: a client who banks a set and then remembers the weight has to be able to type it.
3. **Exercise-level tick** (checked / indeterminate / unchecked, so it reports as well as acts) and a session-level **Mark all complete**.
4. **`buildLogPayload` sends exactly the ticked sets**, each carrying its row's own `setNumber` read off the ORIGINAL array. No `skipped` branch.
5. **One primary button, "Complete workout"**, with the outcome line above it (`components/client-portal/training/complete-workout-footer.tsx`, which also rehomes the session-notes field unchanged).
6. **`quick-log-controls.tsx` deleted**, `completionQuality` off `LogFormValues`, `LogWorkoutButton` deleted.
7. **Skip toggle, `ExerciseFormValues.skipped` and `isSkippedLog` deleted.**
8. **`seedDefaultValues` / `restoreSetsFromLog` rebuild the FULL prescribed row list** with ticks restored from the logged sets.
9. **Set-delete restricted to appended rows** (`canRemove`, the `sets:` override dropped, `sets: 0` on the unplanned view) — all three parts of the plan body's spec.

**Decisions taken inside the spec**

- **`summariseCompletion` is the one traversal.** The outcome line needs counts, the wire needs a verdict, and the sentence above the client's button is a promise about the coach's adherence number. `deriveCompletionQuality` is now a wrapper over it, so the server call site is untouched and the two cannot drift. Its doc names the property that keeps the two halves consistent: the counts are a session-wide **display sum** while the verdict is **per-exercise**, and they can only agree because the dedupe and existence check cap `completed` at `prescribed` per exercise. Lift that cap and the line reads "12 of 12 working sets logged. Will be recorded as partial."
- **`resolveLogOutcome` is the single fallback.** When nothing scorable is prescribed (no exercises, or only warm-ups) `summariseCompletion` returns null and the server defers to the client's value, so it is decided in one place: ticked anything → `full`, ticked nothing → `skipped`.
- **`prescribedRowsForView` is the one view→rows flatten**, replacing the copy in `exercise-tracker-block.tsx` and the inline one in `seededSetRows`. The renderer, the seed and the outcome line were about to be three answers to one question.
- **The kernel stays in `utils/`.** `components/client-portal/**` holds the tick STATE and the copy; every derivation is in `utils/completion-quality.ts` + `utils/set-spec-rows.ts`.

**Deviations from the plan as written**

- **`restoreSetsFromLog` is sized `max(prescribed count, highest logged setNumber)`, not the prescription alone.** A logged set past the prescription is reachable two ways after this phase — the client appended rows (and with the `sets:` override dropped those rows now genuinely sit past `prescribedRows.length`), or the coach shrank the prescription afterwards. Sizing to the prescription would not merely hide it: `writeSessionLog` full-replaces (every `exercise_log` deleted, `set_logs` cascaded, re-inserted from the payload), so a row missing from the rebuilt form is **deleted from the database on the next save**. Reopen, save, gone. Capped at `MAX_PRESCRIBED_ROWS` — the wire's own bound on `setNumber`, so it can never truncate anything the form could send back, but a corrupt stored `set_number` cannot ask the browser for a billion-row array. Owner-directed, 2026-08-24.
- **The detail list opens by default.** With the quality selector gone, a collapsed list plus one primary button meant a client who did the whole workout tapped Complete and recorded `skipped`. Still foldable. Owner-approved.
- **Copying a previous set banks the row it fills.** Copy enters values without ever firing a blur, so the auto-tick alone would leave the commonest gesture in the form producing rows full of numbers and unticked. Owner-approved.
- **No em dash in the outcome line** — "9 of 12 working sets logged. Will be recorded as partial." The plan's own example broke its "no em dashes" rule; that bullet and the pasteable prompt's copy are corrected in this commit.
- **`exercise_logs.completed` is now `ex.skipped !== true && ex.sets.length > 0`** (`services/training-log-service.ts`). It required a set with NUMBERS in it, which recorded "I did all four sets, logged no weights" as incomplete. The `skipped` leg survives for the wire's other callers. `setHasData` had exactly one reader and went with it.
- **The pasteable prompt was widened**, not just the plan body. It carried the original 8 items and mentioned none of the set-delete work, so a re-run of this phase from the prompt alone would have rebuilt the hole. Item 8 now states the sizing rule and a new item 9 carries all three parts of the delete restriction.

**Docs**

- `docs/ARCHITECTURE.md` → "Workout logging (progressive disclosure)" is rewritten as "Workout logging (per-set completion)": the two-mode model, the quick-log selector and "Skip exercise" are gone.
- `docs/ARCHITECTURE.md:372` → **a Phase 1 follow-up, not a Phase 2 change.** "`training_events.status` maps directly from `payload.completionQuality` … Per-exercise data does NOT override the client's tap" became false when Phase 1 made the quality server-derived, and should have moved then. Rewritten to state where the quality comes from, what `full` means, why the denominator needs its own read, and that a payload with no `exercises` is the only case where the client's value is honoured. This matters more than it looks: completed execution plans are deleted after shipping, so once Phase 3 lands, ARCHITECTURE and CONVENTIONS are the only surviving record of this model.

**Wire and server untouched.** `setPerformanceSchema` keeps `skipped` and `setType` (accepted-but-ignored) for React Native; `completionQuality` stays required and is still honoured for an exercise-less payload; no migration; no analytics SQL; no adherence or `training_events.status` change.

**Not addressed, deliberately.** `exercisePerformanceSchema` caps `sets` at 50 while `MAX_PRESCRIBED_ROWS` is 630, so a client ticking more than 50 sets on one exercise would fail client-side validation with "Some inputs are invalid". Pre-existing, unreachable through any real prescription (it needs 50+ flattened rows on a single exercise), and out of this phase's scope.

**Test results** — all four gates green.

- `npx tsc --noEmit` — clean
- `npx eslint .` — 0 errors (204 pre-existing warnings; the baseline was 204 after Phase 1 removed two)
- `npx vitest run` — 287 files, 3130 tests, all passing (baseline was 287 / 3111)
- `npm run check:labels` — OK, 678 files scanned

**New coverage.** `log-form-types.test.ts` (23): a ticked-but-empty set is sent, a filled-but-unticked set is not, set numbers survive a sparse tick set, the derived quality, warm-ups excluded while still being sent, and the four reopen cases. `utils/completion-quality.test.ts` (+5): the counts, warm-ups out of both halves, an untouched exercise in the denominator, and the per-exercise cap. `set-tracker.test.tsx`: auto-tick on type-and-blur, mark-all, the exercise tick, untick, the warm-up outcome count, one primary button with the outcome above it, and the delete restriction. The ~25 tests that clicked the deleted quick-log buttons were rewritten.

**Mutation-tested.** Three separately, each restored from a scratchpad copy and `diff`-verified byte-identical afterwards, with the suite re-run green: sizing `restoreSetsFromLog` to the prescription alone fails "keeps a logged set past the prescription" (`expected length 4, got 3`); dropping the `onBlurRow()` call from `withAutoTick` fails `[auto-tick]` and 9 others; `canRemove={() => true}` fails `[delete-set]` on the prescribed rows' delete buttons reappearing.

**Browser-smoked by the owner, 2026-08-24 — confirmed working.** The gates above prove the contract through jsdom only; this is the pixel-level confirmation they cannot give. Phase 2 is CLOSED.


---

### PHASE 3 — SHIPPED (2026-08-25)

**Commit:** `feat(training): coach-side logged-workout detail — per-set completion Phase 3` — the
single commit this block ships in. (No hash, for the reason Phases 1 and 2 record: a commit cannot
name itself, and amending one in only orphans the commit it named.
`git log --oneline --grep "coach-side logged-workout detail"` resolves it.)

**Shipped**

1. **The prescription drives the row list, not the log.** `buildLoggedSetRows`
   (`utils/logged-set-rows.ts`) pairs the flattened prescription with the sets logged against it.
   A prescribed set with no logged row renders NOT DONE; a logged set past the prescription is kept,
   sized `max(prescribed, highest logged)` and capped at `MAX_PRESCRIBED_ROWS` — the same rule and
   the same reason as Phase 2's `restoreSetsFromLog`.
2. **One flattening, reached the same way on both sides.** The dialog reads
   `buildPrescribedRows(snapshotToSpecs(snapshot))` — byte-identical to the service's three call
   sites.
3. **Set-type tags** (`W`/`D`/`A`/`F`, working untagged) and the **prescribed Load** cell via the
   existing `formatPrescribedLoad`: absolute in the VIEWER's unit (`formatLoad`, snapped — this is a
   read-only readout), `% 1RM` and `% top set` unconverted.
4. **Drop sets render as flattened sibling rows**, matching what the client logged against.
5. **Warm-ups shown but unscored** — `W` tag, muted values, muted tick.
6. **A tick and a blank stay different states.** A logged row with all three values null renders
   logged-with-dashes; only a missing row reads as not done.

**Deviations from the plan as written** (all four owner-approved before code)

- **An exercise the client never touched is now surfaced, which widened scope past the component.**
  Such an exercise is absent from `exercise_logs` entirely, so a readout built from the logs alone
  could not show it was ever asked for — and the phase's definition of done is "the FULL prescription
  against what was performed". `getSessionLogDetail` now also returns `prescribedExercises`: the
  PERFORMED session's active exercises in `order_index` order, via the existing private
  `loadSessionPrescription` — the same reader the `completion_quality` denominator uses, so the
  readout and the recorded verdict describe one prescription. Issued in a `Promise.all` with the
  performed-session-name read, so round trips stay at 4. **The route file is untouched**; scope comes
  from the log row's own `client_id`, which the route already proves against the URL.
- **The compact-column "Prescribed 3x8-12" chip was DELETED, not replaced.** It read `sets` /
  `reps_min` / `reps_max` — a projection `compactFromSpecs` derives by counting non-warmup specs and
  spanning their rep ranges, so a prescription of `warm-up 10 @ 40kg · 5 @ 100kg · 5 @ 100kg · AMRAP
  12+` rendered as `3x5 to 12`: no warm-up, no load, no AMRAP, and a rep range no set was given. The
  per-set rows below it now state all of it. Owner chose deletion over a replacement count line, so
  the card carries no header meta at all and an untouched exercise is signalled purely by its rows.
- **The "Incomplete" badge was DELETED.** It rendered off `exercise_logs.completed`, which Phase 2
  redefined to `ex.skipped !== true && ex.sets.length > 0` — and since the web client no longer sends
  `skipped` and omits a zero-tick exercise entirely, no web-logged session can produce a `false`. It
  survived only for an RN payload sending `skipped: true`, which now renders as a full prescription
  with every row not done.
- **`buildSetDisplayNumbers` was extracted to `utils/set-spec-rows.ts` and the CLIENT grid now
  imports it** (`prescribed-set-grid.tsx`: a 14-line loop deleted, one call added). This touches
  `components/client-portal/**`, which the phase prompt forbids — **the owner waived the constraint
  explicitly** rather than accept a second copy, on the grounds that a second display-number
  derivation is the same hazard as a second flattening on the feature whose point is that set
  identity is real. The extracted function returns the PARENT's number for a drop continuation,
  exactly as the loop did, so the client change is behaviour-identical rather than merely intended to
  be — mutation-tested below.

**Decisions taken inside the spec**

- **`snapshotToSpecs` moved from `services/training-log-service.ts` (private) into
  `utils/exercise-set-specs.ts`, beside the `expandSetSpecs` it wraps.** A coach component cannot
  import the service (it pulls `supabaseAdmin`), and a second copy would let the readout describe a
  different prescription from the one `set_logs.set_type` was stamped against. It went beside
  `expandSetSpecs` rather than into a new module because it asks no new question — a snapshot is a
  prescription written down at log time. The service's three call sites are unchanged.
- **Column visibility follows the DATA, not `prescribed_fields`.** A historical readout must never
  hide something actually recorded, and every snapshot written before migration 149 carries no field
  list, so a fields-gated renderer would fall back to "all five" for exactly the rows it was meant to
  narrow.
- **The log's own snapshot beats the live prescription** when both exist: it is what was prescribed
  AT LOG TIME, which is what a coach reading history wants. The live row is the fallback for an
  exercise with no log.
- **Exercise order mirrors `seedDefaultValues`** — prescription first in authored order, then
  anything logged outside it (unplanned adds, free-form entries, prescriptions the coach has since
  soft-deleted) — so the coach reads the session in the order the client worked through it.

**Known gaps left open**

- **`utils/exercise-set-specs.ts` is now 206 lines**, past CONVENTIONS §4's 200-line split threshold
  for utils. Not split here: there is no natural boundary between a function and its adapter. Whoever
  adds the next thing to that file should split deliberately rather than drift further.
- **Prescribed rest and tempo are still not rendered.** Neither is in this phase's five items, and
  rest is not logged, so there is nothing to show it against.
- **A session log with no `training_session_id`** (legacy, or the session was hard-deleted) gets no
  prescription read and falls back to the logs alone — the pre-Phase-3 behaviour, which is the best
  available: nothing records what was prescribed.

**Security, load & performance review** (CONVENTIONS §2 — triggered by a changed read path and ~7
files touching data flow)

- **No new route, no new write path, no migration.** The only endpoint touched is the existing
  `GET /api/clients/[id]/training/session-logs/[sessionLogId]`, and its handler file is unchanged.
- **Auth chain intact** (`route.ts:12-45`): `coachApiRateLimit` → `getAuthenticatedCoachId(request)`
  (request passed) → `client.coachId !== coachId` ⇒ 403 → `result.sessionLog.clientId !== clientId`
  ⇒ 404. CSRF is not applicable to a GET.
- **The new read cannot widen exposure.** `loadSessionPrescription` is scoped by an `!inner` join on
  `training_sessions.training_plans.client_id`, and the client id it is given is the **log row's
  own**, never user input. For a foreign `sessionLogId` the service now performs one extra read
  before the route 404s and discards the response — no data crosses the boundary. That is the same
  property the pre-existing `performedSessionName` read already had.
- **`npm run check:rls`** — 42 public tables, 42 with RLS, all schema-security invariants hold. No
  policy or grant changed.
- **Round trips are unchanged at 4.** The prescription read is `Promise.all`-ed with the
  performed-session-name read; both depend only on `training_session_id`. Constant per request, not
  per row.
- **The new `ORDER BY` is index-covered, exactly.** `idx_training_exercises_active ON
  training_exercises(session_id, order_index) WHERE is_active = true`
  (`055_rename_and_protect_training_history.sql:221`) matches the query's predicate and sort key, so
  the ordering is an index scan rather than a sort.
- **Worst-case rows returned**: one session's active exercises — bounded by what a coach authors,
  realistically well under 30. Not client-scalable data.
- **No consistency risk**: no write, no swallowed `.catch()`, no multi-write sequence.
- **Measured vs read**: this is a code review, not a measurement. No load was run against the added
  read. The scale seed and `PERF_COACH_ID` fixture (`docs/perf-baseline.md`) are available if you
  want it exercised under concurrency.

**Test results** — all four gates green.

- `npx tsc --noEmit` — clean
- `npx eslint .` — 0 errors (204 pre-existing warnings, unchanged from the Phase 2 baseline)
- `npx vitest run` — 288 files, 3158 tests, all passing (baseline was 287 / 3130)
- `npm run check:labels` — OK, 679 files scanned
- `npm run check:rls` — 42/42 tables with RLS, invariants hold

**One flaky full run, chased rather than assumed.** An early full run reported `1 failed | 3157
passed` and the failing test's name was not captured. Because this phase edits
`prescribed-set-grid.tsx`, which `set-tracker.test.tsx` exercises, that was not taken as the
documented full-run flake on faith: `set-tracker.test.tsx` was then run five times in isolation (34
passing each) and the full suite three more times (3158 passing each). Consistent with the known
flake this file's global rules already record; no evidence of a real defect, and none of the three
mutation tests depended on it.

**New coverage.** `utils/logged-set-rows.test.ts` (11): the prescription driving the rows, pairing by
the wire's index rather than the coach's set number, a logged set past the prescription, the
ticked-but-empty vs not-done distinction, out-of-range and corrupt set numbers, the
`MAX_PRESCRIBED_ROWS` cap, and a log with no prescription at all.
`utils/set-spec-rows.test.ts` (+4): `buildSetDisplayNumbers`.
`services/training-log-service.test.ts` (+5): **the first coverage `getSessionLogDetail` has ever
had** — the merge and its authored order, the no-session path issuing neither read, a log whose
exercise is no longer in the prescription, the tenant scoping and ordering of the prescription read,
and the not-found null. `session-log-detail-dialog.test.tsx` (20, rewritten): the three load forms,
set-type tags, drop-set flattening, untouched exercises, exercise ordering, warm-up muting, and the
identity/drill-down cases carried over.

**Mutation-tested.** Three, each restored from a scratchpad copy and `diff`-verified byte-identical
afterwards, with the full suite re-run green:

1. Sizing `buildLoggedSetRows` to the prescription alone → 4 failures, incl. "keeps a logged set PAST
   the prescription".
2. Pairing logs by array position instead of `set_number` → 8 failures, incl. the drop-set alignment
   in both the util and the dialog.
3. Offsetting the extracted `buildSetDisplayNumbers` by 100 → **12 client-portal failures**, which is
   the point: it proves the client grid genuinely consumes the shared function rather than a surviving
   local copy.

**Browser smoke OWED.** The gates above prove the contract through jsdom only. The owner runs browser
smokes; this one has not been run.
