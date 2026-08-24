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
- **Outcome line above the primary button**, stating what will be recorded: *"9 of 12 working sets logged — will be recorded as partial."* The derivation must be visible before commit, because a coach's adherence number depends on it.
- **One primary button: "Complete workout."**
- **DELETE** `components/client-portal/training/quick-log-controls.tsx` and the `completionQuality` selector from the form.
- **DELETE** the per-exercise Skip toggle and the `skipped` field in `ExerciseFormValues`. `isSkippedLog` in `log-form-types.ts` goes with it; `exercise_logs.completed` becomes vestigial and is written `true` for any exercise with ticks.
- **`seedDefaultValues` / `restoreSetsFromLog` must rebuild the FULL prescribed row list** with ticks restored from the logged sets — not just the logged rows. This fixes the current behaviour where reopening a session shows one row instead of six.

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
5. Replace the save affordance with one primary button, "Complete workout", and an outcome line above it stating what will be recorded (e.g. "9 of 12 working sets logged — will be recorded as partial"). Warm-ups are excluded from that count.
6. DELETE components/client-portal/training/quick-log-controls.tsx and the completionQuality selector. The wire still carries completionQuality and the server still honours it when a payload has no `exercises` — do not remove it from the schema, only from the web UI.
7. DELETE the per-exercise Skip toggle, the `skipped` field on ExerciseFormValues, and isSkippedLog.
8. seedDefaultValues / restoreSetsFromLog must rebuild the FULL prescribed row list with ticks restored from the logged sets, so reopening a logged session shows every prescribed set rather than only the logged ones.

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
