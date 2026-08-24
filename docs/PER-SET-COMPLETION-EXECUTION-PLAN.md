# Per-Set Completion — Execution Plan

Rebuild of how a client records a workout and how that record reaches the coach. Today the client's log form sends a **compacted array** of filled sets with no identity, so a client who logs one working set out of six has it stored as set 1 and typed from the **warm-up** spec. That silently poisons every exercise metric — a logged Bench set currently reads as `0 sets against prescribed 4` on the Journey compliance chart.

**Split into 3 phases.** Phase 1 = the wire contract and the server write path. Phase 2 = the per-set completion model and the client UI that proves it. Phase 3 = the coach-facing logged-workout detail. Each phase's pasteable prompt is at the bottom of its section. Do not start a phase before the previous phase's STATUS block reports shipped.

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

## PHASE 1 — Set identity on the wire

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

## PHASE 2 — Per-set completion

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

## PHASE 3 — Coach-side logged-workout detail

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

**Known gaps left open, both Phase 2's**

- **Reopen renumbers.** `restoreSetsFromLog` rebuilds only the LOGGED rows, so a session logged as sets 3-5 reopens as a 3-row form and re-saves as 1-3. Pre-existing; Phase 1 neither fixes nor worsens it. Phase 2 item 8's full rebuild closes it.
- **Delete renumbers, independently.** `exercise-tracker-block.tsx:382` lets a client remove any prescribed row, which shifts every later row onto the wrong spec. This needs no reopen and item 8's rebuild alone does **not** close it — the new set-delete restriction in item 8 does. Both causes must be closed for positional `setNumber` to be sound end-to-end.

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
