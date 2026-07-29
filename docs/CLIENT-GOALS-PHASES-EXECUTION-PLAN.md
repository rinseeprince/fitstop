# Client Goals + Phases — Execution Plan

**Status:** Sessions 1 and 2 complete · Session 3 not started · **Owner decision date:** 2026-07-28
**Three sessions, strictly sequential.** Each is designed for a fresh Claude Code session with a full context window. (Session 3 is split across **four** prompts — see the note above §"SESSION 3 PROMPTS" for why.)

> **Canonical sources.** `CONVENTIONS.md` (stable coding rules) and `docs/ARCHITECTURE.md` (schema + data flow) win over this document on anything they cover. This document owns the *design decisions* for this workstream and the *sequence*. When this workstream lands, `ARCHITECTURE.md` must be updated and this file deleted (the precedent set by the training-builder and wellness-soreness plans).

---

## 1. What we are building, in one page

A **phase** (coach-facing word: **block**) is a named stretch of a client's calendar carrying a direction and a speed — "Cut 1, 8 weeks, −0.6 kg/wk". The client's long-term goal is the destination; blocks are the legs of the journey.

### The core mechanism

The platform already writes **one nutrition row per client per date**. Today every one of those rows gets the same numbers. Phases change *what gets written into each row* — nothing about how anything reads them.

```
Sarah's long-term goal ─┐
                        ├──► "what's the target on 3 Oct?"   ← asked once per date
Sarah's blocks ─────────┘              │
                                       │  3 Oct sits in "Diet break" → 0 kg/wk
                                       ▼
                     generateNutritionEvents writes day 1 … day N
                                       │
                                       ▼
                              nutrition_events
```

`generateNutritionEvents` currently closes over **one** set of numbers for the whole walk. It becomes a per-date resolver. That is the entire backend feature.

### Why there is no "phase transition"

There is **no scheduler in this repo** — no `vercel.json`, no `app/api/cron`, no job runner. Everything date-driven fires on read. So the design writes the right answer onto every day in advance, and **crossing a block boundary is a no-op**. No promotion, no activation, no archival, no race. This is also the only model that is correct for a client who does not open the app for three weeks.

The previous implementation (removed 2026-07-25, migration 133) failed structurally: "active" was a *status column* rather than a date derivation, `phase_id` was stamped onto 5 tables, and the transition archived the client's nutrition plan — deleting their forward calendar with no banner and no regeneration trigger. **None of those shapes may return.** Tag `roadmap-v2-pre-removal` is a layout reference only; its visual tokens predate Teal-Summit and must be re-authored from `docs/newdesignsystem.md`.

### Coach workflow

1. **Goal** — start date, target weight, deadline. The app derives the speed (or the reverse).
2. **Blocks** *(optional)* — same panel, second section. Name + length only; dates chain automatically.
3. **Training** — start date pre-filled from the goal; blocks visible on the calendar (they inform placement, they never restrict it).
4. **Nutrition** — effective date pre-filled; Generate returns **one row of numbers per block**, each amendable.
5. **Habits**, then activate.

A coach who never opens the Route section gets exactly today's behaviour.

---

## 2. Invariants — do not violate without owner sign-off

1. **No `phase_id` column on any table.** Attribution is a date-range join at read time.
2. **"Active" is derived from dates.** Never a status column, never a partial unique index on an active flag.
3. **One start date**, entered once on the goal panel, **defaulted** (never re-asked, never locked) into training placement, nutrition effective-from, and the check-in window.
4. **Rate is the only stored truth on a block.** No stored target weight, no type enum — both over-determine the block and create contradictions that something then has to arbitrate.
5. **Rate is required, never null.** A block with rate `0` *is* maintenance, explicitly.
6. **Durations in, dates out.** The coach enters a start date plus a list of lengths; the service computes the chain. Overlaps and gaps are structurally impossible, so there is no overlap validation to write.
7. **Blocks save independently of the goal.** `updateGoals` supersedes-and-inserts on every call; a block edit must never mint a goal version.
8. **Blocks are `DATE`**, not `TIMESTAMPTZ`. (`client_goals.effective_from` is the odd one out in this schema — do not copy it.)
9. **Deleting a block regenerates, never wipes.** Elapsed blocks are read-only.
10. **Generation horizon = `max(today + 8 weeks, last block end)`.** The DELETE and the regenerate must derive from **one** computed range.
11. **Blocks are client-scoped rows**, not owned by the nutrition plan — they survive a plan delete and are read by the charts and the check-in comparison.
12. **Every capped rate surfaces in the per-block preview, per row.** The calculator silently caps (0.75/1.0 kg-wk loss, 0.35/0.5 gain, by gender) and floors calories (1200/1500). Rate-first entry makes this visible; it must not stay silent.
13. **The blocks fingerprint on the nutrition plan is what makes staleness visible.** Without it, editing a block and not regenerating is a silent divergence between what the coach sees and what the client follows.
14. **Coach-action items are not alerts.** They render like the unreviewed-check-in row (thumb + title + button), are not dismissible, and do not go through `evaluateAndSortTriggers`.

---

## 3. When a documented rule blocks the work

`CONVENTIONS.md` and `docs/ARCHITECTURE.md` are strict, but they describe the platform **as it was**. This workstream changes the platform, so some rules will legitimately need updating. Two of them are already known to be wrong once this ships (see §4).

**Never silently ignore a rule, and never silently comply with one that makes the feature wrong.** Follow this procedure:

1. **Quote it.** Name the file, the section, and the line. Paste the rule verbatim.
2. **State the collision.** What are you trying to do, and precisely what does the rule forbid or mandate?
3. **Classify it:**
   - **(a) Genuinely protective** — the rule exists for a reason that still holds. Comply, and find another way.
   - **(b) Stale** — the rule describes a state this workstream is deliberately changing. **Update the doc in the same commit as the code**, with a one-line note on what changed.
   - **(c) Protective but wrong here** — the reason holds generally but not for this case. **Stop and ask the owner before proceeding.** Do not deviate unilaterally.
4. **Record it.** Every (b) and (c) goes in this file's STATUS block for that session, so the next session inherits the decision rather than re-litigating it.

Rule of thumb: a rule about **safety** (RLS, GRANT, auth chain ordering, rate limiting, CSRF, IDOR, migration workflow) is almost always (a) — comply. A rule about **what currently exists** ("no phase concept exists", "with one scope it is a constant") is almost always (b) — update it.

---

## 4. Known doc collisions — expect these

| Where | Rule | Class | What to do |
|---|---|---|---|
| `ARCHITECTURE.md` → "Coach client Overview" | *"**No roadmap or phase concept exists.** The status card's chips describe the active training block…"* | **(b) stale** | Rewrite in Session 2/3. Keep the distinction that a *training* block ≠ a *goal* block. |
| Migration `133:278` | Dropped `nutrition_plans.goal_source` — *"with one scope it is a constant"* | **(b) stale** | Session 2 reintroduces a second scope, so the column comes back. |
| `CONVENTIONS.md` §2 → Scope discipline | *"Don't add … performance optimizations unless explicitly requested"* | n/a | The Session 1 cascade change **is** explicitly requested by the owner (2026-07-28). Not a deviation. |
| `CONVENTIONS.md` §2 | *"One fix per change"* | **(a)** | Comply *within* a session: each numbered task below is its own commit. Sessions bundle tasks; commits do not. |
| `CONVENTIONS.md` §4 | File size limits | **(a), soft** | These are explicitly guidelines. The goal panel will be large; split it only at a natural boundary (destination section / route section / block row), never by prop-drilling one flow across files. |
| `CONVENTIONS.md` §8 | New table → `ENABLE ROW LEVEL SECURITY`, **no policies**, `GRANT ALL … TO service_role` | **(a)** | Comply exactly. `npm run check:rls` reads the live catalog (no hardcoded table count), so it will pass once the grant is in the migration. |
| `docs/newdesignsystem.md` | *"never `ConfirmDialog`/AlertDialog — un-migrated OKLCH"* | **(a)** | `components/ui/apply-date-dialog.tsx` is built on `AlertDialog` today. Session 3 touches it — re-tokenise it while you are there. |
| `docs/newdesignsystem.md` → Typography | Mono = numbers only; `npm run check:labels` fails the build on raw `font-mono-display` | **(a)** | Block **names** are sans (a name's digits belong to the name). Dates, lengths and rates are mono via `MONO_LABEL_CLASS`. |

---

## 5. Session map

| Session | Theme | Migrations | Ships user-visible change? | Status |
|---|---|---|---|---|
| **1** | Pre-existing bug fixes + the rate derivation | **none** | Overview goal source only | ✅ **COMPLETE** — shipped 2026-07-28 (`53abf0a`, `3abbfa5`, `b3ca479`, `62cef4a`), browser smoke passed 2026-07-29 |
| **2** | Blocks: schema, service, generation **+ Session 1's inherited fixes (2.8)** | 137, 138, **139** | No (API only) | ✅ **COMPLETE** — closed 2026-07-29 (`86b7a98`…`e315329`); 2.1–2.7 and 2.8(a–e,g,h) shipped, **(f) carried to Session 3D** |
| **3** | Coach UI + "Waiting on you" + client-portal goal (3.9) | none | Yes — the whole feature | 🔵 **IN PROGRESS** — **3A**: commits 0–2 shipped 2026-07-29/30 (`d05f5cf`, `4f9ce8c`, `e0f46de`, and the panel); **Task 3.2 + the drawer relink still owed**. **3B / 3C / 3D not started** |

Strictly sequential: 2 depends on 1's calculator, 3 depends on 2's API.

---

# SESSION 1 — Foundations ✅ COMPLETE

> **Closed 2026-07-29.** All four tasks shipped 2026-07-28 (`53abf0a`, `3abbfa5`, `b3ca479`,
> `62cef4a`); the browser smoke passed 2026-07-29 and discharged both the §"Session 1 verification"
> smoke and the one Task 1.3 left *Owed*. Gates at close: `tsc` clean, `eslint` 0 errors,
> **233/233 files · 2410/2410 tests**, `check:labels` OK.
> **Read the STATUS blocks in §8 before Session 2 — they correct this section's own text in several
> places.** Everything Session 1 deferred is now owned by **Task 2.8**; nothing is left unassigned.

**Zero migrations. Every task is an independently valuable fix to code that exists today.** Nothing here mentions phases; the point is that Session 2 lands on solid ground rather than amplifying three existing bugs.

### Task 1.1 — Goal service: presence must mean "present and not undefined"

`services/client-goals-service.ts:78-79` merges on `Object.prototype.hasOwnProperty.call(goals, key)`, which is **true for an explicitly-`undefined` key**.

- Via `PUT /api/clients/[id]/goals` this is **safe** — zod omits absent optional keys.
- Via the four callers that build object literals it is **not**: `app/api/clients/[id]/metrics/route.ts:216-221`, `services/client-service.ts:100-103` and `:269-272`, `services/intake-review-service.ts:215-219`. PATCHing only `goalBodyFatPercentage` writes `goal_weight = NULL`.
- The direct `clients` write at `metrics/route.ts:134-140` *is* guarded by `!== undefined`, so **the two stores diverge**: the mirror keeps the old weight, `client_goals` goes NULL.

**Fix:** `has()` becomes `hasOwnProperty(...) && goals[key] !== undefined`. Explicit `null` still clears (null ≠ undefined), so the goals route is unaffected.

**Also:** `notes` is silently NULLed on every goal edit — `merged` has 5 keys and the insert is `{client_id, ...merged, …}`. It is an orphaned column with no reader; fix it in the same commit for correctness.

**Test:** the existing test at `services/client-goals-service.test.ts:166` passes a literal with keys **absent**, which is why this survived. Add a case with `{ goalWeight: undefined, goalBodyFatPercentage: 22 }` — the real caller shape.

### Task 1.2 — Cascade: pass a date set, not a floor

`regenerateFutureNutritionEvents` (`services/nutrition-event-service.ts:200`) accepts only a start date and always rebuilds to the horizon. Every one of the 8 training write routes **already computes its exact affected dates** and then discards that precision.

Three concrete defects, not just waste:

1. **The DELETE is unbounded above** (`.gte("date", fromDate)` with no upper bound); the regenerate is bounded at `+56d`. Today nothing exists past the horizon so it is invisible — Session 2 extends the horizon and the two ranges stop agreeing.
2. **Delete-then-bail:** the DELETE runs at `:211-219`; the `if (!endDate || endDate <= fromDate) return;` guard is at `:249`. Unreachable today, but it is a "deleted the calendar, returned success" path.
3. **No-row window:** between DELETE and INSERT those dates have no row. A client reading mid-cascade gets `null` from `getPlanTargetForDate` — the level-3 template fallback was never built.

**Fix:** the cascade takes a set of dates (or an explicit `[from, to]` range) computed once, and the DELETE and regenerate both derive from it.

| Route | Affected dates |
|---|---|
| `events/[eventId]/move` | `[source, target]` |
| `events/[eventId]/duplicate` | `[targetDate]` |
| `events/[eventId]` PATCH (surplus edit) | `[eventDate]` |
| `events/[eventId]` DELETE | `[eventDate]` |
| `[planId]/sessions/[sessionId]` | that session's event dates |
| `place-from-library` | the placement window (wide) |
| `[planId]/amendment` | the rewrite floor onward (wide) |
| `[planId]` DELETE, client-level `training` DELETE | the plan window (wide) |

The five narrow paths can **skip the DELETE entirely and pure-upsert** (`onConflict: client_id,date` already overwrites, and it skips the same `is_modified` rows the delete does) — which closes the no-row window as a side effect.

Safe because a date's numbers are fully determined by that date: baseline from the weekday grid, `is_training_day` / `calorie_surplus_percentage` from that date's training events.

**Landmine:** `training_events.calorie_surplus_percentage` must keep being populated by every training event-write path. One dropped write silently falls nutrition back to rest-day calories while the TRAIN badge still renders. Do not touch that.

### Task 1.3 — Overview reads the real goal, not the `clients` mirror

The coach Overview (and the client portal) read `clients.goal_weight` / `goal_body_fat_percentage` / `goal_deadline` only. `client_goals` is read by the Metrics page, the check-in comparison and nutrition. The mirror is kept in sync by a **non-blocking, error-swallowed** write (`client-goals-service.ts:125-127`), so the two can silently diverge — and the mirror is three scalar columns with nowhere to put anything new.

**Fix:** the Overview's goal surface reads `client_goals` through `resolveEffectiveGoal`, the same as every other goal consumer. Locate the current call sites rather than assuming — `lib/goals/goal-state.ts` feeds the Overview's goal chips, and `resolveEffectiveGoal` has 4 production call sites (`app/api/clients/[id]/nutrition/route.ts:107`, `components/clients/metrics/hooks/use-merged-metrics.ts:74`, `services/comparison-service.ts:62`, `services/nutrition-plan-orchestrator.ts:160`).

**Scope boundary:** the **client portal** also reads the mirror. Leave it alone — it is a separate read path with no goal endpoint at all (`/api/client/**` has none), and client-facing blocks are deliberately post-launch. Note it in the STATUS block so it is not mistaken for an oversight.

### Task 1.4 — Two-way target ⇄ rate derivation + a rate-first calculator

`calculateBaselineCalories` (`services/nutrition-service.ts:58`) is **deadline-driven**: it takes a goal weight and a deadline and *derives* the rate internally. A block hands it a **rate** directly.

**Build the inverse entry point** — given a rate, compute the daily calorie delta (`rate_kg_per_week × 7700 ÷ 7`) — as a pure function, sharing the existing safety caps and calorie floor rather than duplicating them.

**Build the two-way widget logic** as a pure util: enter a target + deadline → see the rate; enter a rate → see the deadline. Both directions, one stored truth.

**Decision to make in this session:** the current design says the goal stores **target + deadline** and the rate is derived — the same over-determination argument that removed the block type enum. Adding a stored `rate_per_week_kg` to `client_goals` would let target, deadline and rate disagree. **Do not add the column unless you find a reader that genuinely needs a stored rate**; if you do, record why in the STATUS block.

**Already true, do not rebuild:** `calculateBaselineCalories` already handles a future start (`startDate = max(calcStartDate, now)`, `:96-98`) — the comment even says *"When a phase starts in the future, count from phase start, not today."* That is surviving plumbing from the removed feature.

### Session 1 verification

- `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`, `npm run check:labels`
- New unit tests: the goal-merge caller shape (1.1); the narrow-path cascade writing only its own dates and leaving neighbours' `updated_at` untouched (1.2); the rate↔deadline round trip and cap surfacing (1.4)
- **Browser smoke:** move a training event on a client calendar and confirm nutrition still updates on both the moved-from and moved-to days, and that no other day changed.

---

### 📋 SESSION 1 PROMPT — paste this into a fresh session

```
Read these in full before planning anything:
  1. CONVENTIONS.md  (mandatory — it says so at the top; do not skip sections)
  2. docs/ARCHITECTURE.md
  3. docs/CLIENT-GOALS-PHASES-EXECUTION-PLAN.md  — read §1 (design), §2 (invariants),
     §3 (what to do when a doc rule blocks you), §4 (known doc collisions), and all of
     SESSION 1. You are executing SESSION 1 only. Do not start Session 2 or 3 work.

Session 1 is four independent fixes to code that exists today. It has ZERO migrations
and does not mention phases anywhere. Its purpose is to stop Session 2 from inheriting
and amplifying three existing bugs.

  1.1  services/client-goals-service.ts — presence-merge must mean "present AND not
       undefined". Four callers currently null the sibling goal field. Add a test using
       the real caller shape (the existing test passes keys ABSENT, which is why this
       survived).
  1.2  The training→nutrition cascade must take a date SET, not a floor. Fix the
       unbounded-DELETE-vs-bounded-regenerate mismatch, the delete-then-bail path, and
       the no-row window. The five narrow routes should pure-upsert with no DELETE.
  1.3  The coach Overview must read client_goals via resolveEffectiveGoal instead of the
       clients.* mirror. Leave the CLIENT PORTAL's mirror read alone — that is
       deliberate scope, not an oversight.
  1.4  Build the rate-first calculator entry point and the two-way target⇄rate
       derivation as pure functions. Read the note about NOT adding a stored rate column
       unless you find a reader that needs one.

Rules for this session:
- Follow CONVENTIONS.md §2: show me a plan and get approval before writing any code.
- One commit per numbered task. Sessions bundle tasks; commits do not.
- If a rule in CONVENTIONS.md or docs/ARCHITECTURE.md blocks you, follow the procedure
  in §3 of the execution plan: quote the rule with file:line, state the collision,
  classify it (genuinely protective / stale / protective-but-wrong-here), and either
  comply, update the doc in the same commit, or STOP AND ASK ME. Never silently ignore
  a rule, and never silently comply with one that makes the fix wrong. These docs are
  strict but they describe the platform as it was — this workstream changes it, so some
  rules will legitimately need updating.
- Commit-ready means all of CONVENTIONS.md §13: tsc, eslint, vitest, check:labels, no
  `as any`, no leftover TODO/FIXME/DEBUG markers.
- When each task is done, append a STATUS block to
  docs/CLIENT-GOALS-PHASES-EXECUTION-PLAN.md recording what shipped, any deviations,
  and any doc rules you updated — so Session 2 inherits the decisions instead of
  re-deriving them.
- Do not touch training_events.calorie_surplus_percentage population in any write path.
  One dropped write silently falls nutrition back to rest-day calories while the TRAIN
  badge still renders.

Start by reading the three documents, then show me your plan for 1.1.
```

---

# SESSION 2 — Blocks backend ✅ COMPLETE

> **Closed 2026-07-29.** Tasks 2.1–2.7 shipped across `86b7a98`, `d2b8adb`, `ace8c45`, `dc9898c`,
> `82d1ab6`, `73a5812`, `7e3083d`, `202bf94`, `fe2ee23`, plus `03981e9`, `3de0be9`, `5d5fd99` and
> `7483184` from the two post-crash audit passes. Task 2.8 shipped **(a)–(e), (g), (h)**;
> **(f) — the `nutrition_events` level-3 template fallback — is the only carry-forward**, reassigned
> by owner decision to **Session 3D** alongside 3.8's client-portal work, because it is a READ-path
> concern the widened horizon does not close.
> Gates at close: `tsc` clean, `eslint` **0 errors**, **239/239 files · 2527/2527 tests**,
> `check:labels` OK (630 files), `check:rls` **41/41**.
> **Read the STATUS blocks in §8 before Session 3** — they correct this section's own text in
> several places, and the two "Post-crash audit" blocks at the end carry the process lessons
> (a decision lost in a dead session leaves no trace in code; diff a file after a subagent
> mutation-tests it; `git diff` is silent on untracked files).
> **No browser smoke** — the phases route has no UI caller until Task 3.1, which smokes it for free.

**Migrations 137, 138 and 139. Backend and API only — nothing user-visible shipped in this session.**

### Task 2.1 — Migration 137: `client_phases`

```sql
CREATE TABLE IF NOT EXISTS public.client_phases (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  starts_on         DATE NOT NULL,
  ends_on           DATE NOT NULL,
  rate_per_week_kg  NUMERIC NOT NULL,
  daily_targets     JSONB,              -- NULL until the nutrition plan is generated
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ... ON public.client_phases (client_id, starts_on);
ALTER TABLE IF EXISTS public.client_phases ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.client_phases TO service_role;
```

Notes:
- **No `phase_id` anywhere else. No status column. No `duration_weeks`** (derivable from the dates — one truth). **No `position`** (order by `starts_on`; a second ordering source can disagree with the first).
- `daily_targets` holds this block's **7-row weekday grid**. This is the piece the earlier design missed: per-day baselines do **not** come from a scalar — `nutrition_plan_daily_targets` is `UNIQUE(nutrition_plan_id, day_of_week)` (exactly 7 rows per plan) and `generateNutritionEvents` looks up the weekday row (`:109-110`). Coaches can set per-weekday overrides. So a block needs its own grid.
- **The existing `nutrition_plan_daily_targets` table becomes the no-block fallback, unchanged.** A client with no blocks behaves exactly as today — that is the property that makes this low-risk for existing clients.
- RLS + GRANT exactly as `CONVENTIONS.md` §8 prescribes (precedent: `108_create_audit_logs.sql:37`, migrations 122/125/126).

### Task 2.2 — Migration 138: two columns on `nutrition_plans`

- **`goal_source`** — reintroduced. Migration `133:278` dropped it as *"with one scope it is a constant"*; this workstream reintroduces the second scope.
- **`phases_fingerprint TEXT NULL`** — a hash over each block's `(starts_on, ends_on, rate_per_week_kg)` at generation time. **Stale = current fingerprint ≠ stored.** Renaming a block does not change the hash, so no false positives. Copy the drift-token pattern from `services/plan-amendment-service.ts` rather than inventing one.

### Task 2.3 — Phase service + `getPhaseForDate`

Mirror `coversDate` (`services/training-plan-window.ts`) — the platform's existing date-window predicate. The service:

- takes an explicit `clientId` scope and filters on it (`CONVENTIONS.md` §8 service-layer contract)
- computes the date chain from **a start date + a list of durations** (invariant 6) — the caller never sends date pairs
- refuses to modify an **elapsed** block (mirrors the amendment surface's locked-slot rule)
- on delete: shifts subsequent blocks back, returns the resulting date changes so the route can report them

### Task 2.4 — `resolveEffectiveGoal` becomes date-aware

Four production call sites, all must be updated:

| Call site | Change |
|---|---|
| `services/nutrition-plan-orchestrator.ts:160` | called once **per block** instead of once |
| `app/api/clients/[id]/nutrition/route.ts:107` | needs a date for the drift check |
| `services/comparison-service.ts:62` | compares against the **covering block's** rate, anchored on the check-in's `period_end` (owner decision) |
| `components/clients/metrics/hooks/use-merged-metrics.ts:74` | **runs in the browser** — the blocks must be in its payload, which means widening an API response |

That last one is the easy one to miss.

**PLUS two mirror-reading readouts, folded in by owner decision 2026-07-29.** These are not
`resolveEffectiveGoal` call sites at all — they read `client.goalWeight` (the `clients` mirror)
**directly, with no `client_goals` fallback**, so they can render a stale goal beside correct
targets:

| Call site | Change |
|---|---|
| `hooks/use-nutrition-plan.ts:143-148` (`getWeightRemaining`) | resolve the goal instead of reading `client.goalWeight` |
| `hooks/use-nutrition-builder.ts:224-231` (`getProjectedDate`) | same; also drop its local `CALORIES_PER_KG = 7700` in favour of the constant 1.4 moved to `lib/constants.ts` |

**Why here and not their own task.** 2.4 is already opening every goal-resolution site and threading
a date through it; these two are the same edit in the same files' neighbourhood, and splitting them
out means reading the same code twice. Recorded in Task 1.3's STATUS as a NEW DIVERGENCE with no
owner — this gives it one.

**Scope guard — this does NOT include the client portal.** `services/client-portal-progress.ts` and
`services/client-portal-service.ts` keep the mirror through Session 2; that one needs a new
`/api/client/**` read path and is now **Task 3.9**. Do not start it here.

**Both are display-only.** The calorie calculation itself already resolves correctly
(`nutrition-plan-orchestrator.ts:161` → `currentGoals?.goalWeight ?? client.goalWeight`). Do not
let a fix here change any target the client eats to; if a number moves, something else broke.

### Task 2.5 — Per-date generation + horizon

- `generateNutritionEvents` (`services/nutrition-event-service.ts:61`) takes a **resolver** `(date) => { targets, dietType }` instead of closing over one `PlanInput` + one grid. The loop is already per-date (`:92`).
- A date inside a block resolves to that block's `daily_targets`; a date in no block falls back to the plan's `nutrition_plan_daily_targets`.
- `calculateNutritionEndDate` (`:269`) becomes `max(today + 56d, last block end)` — and **the DELETE range must be derived from the same computation** (Session 1 fixed the mismatch; do not reintroduce it).
- `cascadeNutritionAfterTrainingChange` inherits block-awareness **for free** because all 8 routes funnel through the same generator. **This is the highest-value test in the whole workstream:** re-place or amend a program mid-block and confirm every later block keeps its own numbers. Without it, a coach swapping a program in week 6 silently flattens every later block back to one set of numbers.

### Task 2.6 — Plan POST calculates per block

`orchestrateNutritionPlanCreation` runs the calculator **once per block** and writes each block's grid to `client_phases.daily_targets`, then stamps the fingerprint. Returns the per-block table (with **per-row cap warnings** — invariant 12) for the builder to render in Session 3.

**Note:** `gender` defaults to the male cap when unset (`gender === "female"` is false for null). Pre-existing, but rate-first entry makes it visible. Surface it or record it as accepted.

### Task 2.7 — Routes + docs

- `GET`/`PUT`/`DELETE /api/clients/[id]/phases` — full `CONVENTIONS.md` §9/§10 chain: `coachApiRateLimit` → `requireCSRFProtection` → `getAuthenticatedCoachId` → **ownership check** → zod → service. Audit-log the writes (`recordAuditEvent`, fire-and-forget, after the authorized write).
- **Blocks save independently of the goal** (invariant 7) — this route must never call `updateGoals`.
- Update `docs/ARCHITECTURE.md`: the new table, the generation model, and the now-false *"No roadmap or phase concept exists"* line under "Coach client Overview".

### Task 2.8 — Inherited fixes from Session 1

Everything Session 1 deferred, gathered here so none of it is orphaned. Each item names its origin
STATUS block. **Several can ride along with a sibling task rather than being done standalone** — the
"ride with" column says which. Do them in the order listed; (a) needs the migration.

| # | Fix | Origin | Ride with |
|---|---|---|---|
| a | `updateGoals` → RPC (transactional) | 1.1, 1.3 | **migration 139**, do with 2.1/2.2 |
| b | Amendment threads its `to` bound | 1.2 | 2.5 |
| c | Kill the latent timezone transcription | 1.4 | 2.5 |
| d | Floored rate is stale in the response | 1.4 | 2.6 |
| e | Unset `gender` takes the male cap | 1.4, §7 | 2.6 |
| f | `nutrition_events` template fallback (level 3) | §7 | 2.5 → **decided there: NOT closed by the widened horizon. Carried to Session 3D.** |
| g | `training_burn_calories` drift on existing rows | S1 smoke | 2.5 |
| h | `getAuthenticatedCoachId()` missing `request` | S1 smoke | 2.7 |

**(a) `updateGoals` is non-transactional — migration 139.** It supersedes
(`client-goals-service.ts:59-72`) then inserts (`:98-107`) with no transaction, and **all four
callers swallow the error**. A failed insert leaves the client with **zero active goals**, which the
calculator and (since 1.3) the coach Overview both read as *maintenance* — i.e. a silent, plausible
wrong answer rather than a visible failure. 1.1 deferred this only because Session 1 had no
migrations by design; that constraint is gone. **The honest fix is an RPC** doing supersede+insert in
one transaction — not an app-side compensating restore, which would add a second non-atomic write
that can itself fail. Follow `feedback_rpc_optional_params_default_null`: optional args get SQL
`DEFAULT NULL` and the service omits them.

**(b) The amendment still cascades on a bare `{kind:"from"}`.** 1.2 threaded the `to` bound through
the two plan-deletion routes but left the amendment, so days past the horizon keep a stale
training-day surplus forever. `plan-amendment-service.ts:345` **already computes `windowEnd`** — it
is simply not returned. Cheap now, and 2.5 is already inside this code. **Do not read
`training_plans.effective_until` for the end bound** — it stays NULL on placed plans (mig `114:96`,
`training-service.ts:67`), so it silently collapses the range to the default horizon on exactly the
long plans that need it.

**(c) The latent timezone bug — fix it before Session 3 exists.** `services/nutrition-service.ts:96-102`
parses `today` as **local** midnight while the deadline (a bare `DATE` from PostgREST) parses as
**UTC** midnight; `Math.round` absorbs the offset only below ±12h. Measured in 1.4: correct at UTC /
LA / São Paulo / Kolkata, **wrong at Auckland and Kiritimati** (92 vs 91), and wrong by two at
exactly +12 (94 vs 93) where the fraction is 0.5 and rounds up. Latent today because both callers are
server-side under UTC Node. **1.4 already built the correct arithmetic** — `dateStringToDayNumber` /
`addDaysToDateString` in `lib/goals/goal-rate.ts`, pinned across six zones plus two named cases
asserting the wrong 92 and 94. Port `nutrition-service.ts` onto those helpers so the two cannot
diverge again, regardless of which module Session 3's widget ends up calling. Fixing it here means
Session 3 lands on safe ground instead of shipping a browser-side error that is silent and always in
the "too slow" direction.

**(d) A floored plan advertises a deficit it will not run.** `calculateBaselineCalories` returns a
**pre-floor** `weeklyRate` / `requiredDailyDeficit` beside a **post-floor** `baselineCalories` — at
TDEE 1700 the target 1500 is 200/day against a reported −0.3846 kg/wk ≈ 423/day. 1.4 pinned this
rather than fixing it, because it feeds the coach's live plan response and 1.4 was not asked to move
those numbers. 2.6 **is** asked to: it re-runs the calculator per block and returns per-row cap
warnings (invariant 12). Re-derive the reported rate from the target actually returned — the
rate-first path already does exactly this via `appliedRateKgPerWeek`.

**(e) Unset `gender` silently takes the male cap and floor** (`gender === "female"` is false for
null). Pre-existing, but rate-first entry makes it visible. §7 and 2.6 both leave this as
surface-or-accept; **decide it in this task and record which**, so it stops being re-raised.

**(f) The level-3 template fallback is still unbuilt.** Session 1 closed the no-row window that made
it matter most, but a date past the horizon still reads as "no target" — and that null is
snapshotted permanently into `nutrition_logs` (`daily-log-card-service.ts:79-99`) and drops the day
from the weekly denominator (`weekly-nutrition-service.ts:65-81`). 2.5 already reworks the horizon to
`max(today + 56d, last block end)`; decide there whether the widened horizon closes this or whether
the fallback is still owed.

**(g) `training_burn_calories` does not track `is_training_day` on existing rows.** Found during the
Session 1 smoke on fixture Samuel James: `2026-08-09 Sun` is a rest day carrying `burn = 770`, and
`2026-08-01 Sat` is a training day carrying `burn = 0`. The narrow cascade correctly leaves these
alone (they sit outside every date set), so this is residue from the pre-1.2 floor cascade. **Confirm
whether 2.5's regeneration clears it**; if it does not, this needs a one-off backfill, because the
column feeds the day's target. Do not assume a regeneration reaches it — check.

**(h) `getAuthenticatedCoachId()` is called without `request`** in
`app/api/clients/[id]/training/[planId]/events/[eventId]/route.ts:31`, losing request context in
structured logs. Not a security hole — the route's auth, ownership, rate-limit, CSRF and zod chain
are all correct. One-line fix while 2.7 is in route work.

### Session 2 verification

- Full `CONVENTIONS.md` §13 checklist, plus `npm run check:rls` (reads the live catalog; passes once the GRANT is in the migration).
- Migration workflow per `CONVENTIONS.md` §8: `npx supabase db push` → `npx supabase gen types typescript --linked > types/database.ts` → skim the diff → **commit the migration and the types together**. Note: `db push` may be blocked by the environment's command classifier — if so, ask the owner to run it.
- Unit tests: date-chaining produces no overlaps/gaps; a date in no block falls back to the plan grid; the fingerprint changes on a rate edit and **not** on a rename; deleting a middle block shifts the ones after it.
- **The cascade test from 2.5 is the one that matters most.**

---

### 📋 SESSION 2 PROMPT — paste this into a fresh session

```
Read these in full before planning anything:
  1. CONVENTIONS.md  (mandatory — it says so at the top; do not skip sections)
  2. docs/ARCHITECTURE.md
  3. docs/CLIENT-GOALS-PHASES-EXECUTION-PLAN.md — read §1 (design), §2 (invariants),
     §3 (what to do when a doc rule blocks you), §4 (known doc collisions), the SESSION 1
     STATUS blocks (they record decisions you must inherit), and all of SESSION 2.
     You are executing SESSION 2 only. Do not start Session 3 UI work.

Session 2 is the blocks backend: migrations 137 and 138, the phase service, date-aware
goal resolution, per-date nutrition generation, and the API routes. NOTHING
user-visible ships in this session.

It ALSO carries Task 2.8 — the eight fixes Session 1 deferred, including migration 139
(making updateGoals transactional) and the latent timezone bug, which must be fixed
before Session 3 renders anything goal-shaped in a browser. Most of 2.8 rides along
with a sibling task rather than standing alone; the table in 2.8 says which. Do not
treat 2.8 as optional cleanup — 2.8(a) closes a path that currently leaves a client
with zero goals, silently reading as "maintenance".

The single most important thing in it: the training→nutrition cascade must stay
correct. All 8 training write routes funnel through generateNutritionEvents, so they
inherit block-awareness for free — but if the per-date resolver is wrong, a coach
re-placing a program in week 6 silently flattens every later block back to one set of
numbers, with no error. Write that test first.

Read §2 (invariants) carefully before designing the schema. The ones that most often
get violated by accident:
  - No phase_id column on any other table. Ever.
  - "Active" is derived from dates, never a status column.
  - Rate is the only stored truth on a block — no stored target weight, no type enum.
  - Blocks save independently of the goal. This route must never call updateGoals,
    because updateGoals supersedes-and-inserts on every call and would mint a goal
    version on every block edit.

Rules for this session:
- Follow CONVENTIONS.md §2: show me a plan and get approval before writing any code.
- One commit per numbered task, except the migration + regenerated types which go in
  the SAME commit per CONVENTIONS.md §8.
- Follow the CONVENTIONS.md §8 migration workflow exactly. Never paste schema SQL into
  the Supabase Studio SQL editor. If `npx supabase db push` is blocked by the command
  classifier, tell me and I will run it.
- New table needs ENABLE ROW LEVEL SECURITY with NO policies, plus
  GRANT ALL ON TABLE ... TO service_role, both in the migration (CONVENTIONS.md §8).
- If a rule in CONVENTIONS.md or docs/ARCHITECTURE.md blocks you, follow the procedure
  in §3 of the execution plan: quote the rule with file:line, state the collision,
  classify it (genuinely protective / stale / protective-but-wrong-here), and either
  comply, update the doc in the same commit, or STOP AND ASK ME. Never silently ignore
  a rule, and never silently comply with one that makes the feature wrong. Safety rules
  (RLS, GRANT, auth chain, rate limiting, CSRF, IDOR, migration workflow) are almost
  always protective — comply. Rules describing what currently exists (e.g. ARCHITECTURE's
  "No roadmap or phase concept exists") are stale — update them in the same commit.
- Commit-ready means all of CONVENTIONS.md §13 plus `npm run check:rls`.
- Append a STATUS block to docs/CLIENT-GOALS-PHASES-EXECUTION-PLAN.md as each task
  lands, recording deviations and any doc rules you updated, so Session 3 inherits them.

Start by reading the three documents plus the Session 1 STATUS blocks, then show me
your plan for the schema (2.1 and 2.2 together).
```

---

# SESSION 3 — Coach UI

**No migrations. This is where the feature becomes visible.**

Design authority is `docs/newdesignsystem.md`, and where it and shipped Programs/Builder code disagree, **the shipped code wins**. Import the shared tokens and components (`builder-tokens.ts`, `SectionLabel`, `StatBand`, `SegmentedControl`, `LibraryTableShell`, `RowActions`) before writing new class strings.

### Task 3.1 — The "Goal & plan" panel

Opened from the Overview goal card. One right Sheet (`sm:w-[780px]`), two sections:

**Destination** — start date (defaults to today), target weight, deadline ⇄ rate two-way widget, body-fat readout.
**Route** *(optional, empty by default)* — the block list. Each row: name, length in weeks, rate. **Lengths only — never date pairs** (invariant 6). Below it a live readout:

> `15 weeks · 4 Aug – 16 Nov · projects 76.4 kg` ✓ on track for 76 kg

That check is pure arithmetic (rate × weeks) and needs no BMR or calories — which is precisely why blocks belong next to the goal rather than in the nutrition builder. **Show it as information, never a blocker**; a deliberately conservative plan is a legitimate coaching call.

Form pattern: react-hook-form + `zodResolver`, modelled on `nutrition-edit-targets-sheet.tsx`. **Do not copy `client-goal-editor.tsx`'s four-`useState` pattern** — it predates the rule and is the outlier.

**Two independent writes** (invariant 7): goal → the existing goals PUT, and only when a goal field actually changed; blocks → `PUT /api/clients/[id]/phases`.

### Task 3.2 — Delete a block

Destructive confirm per `docs/newdesignsystem.md`: styled `Dialog` (never `AlertDialog`), danger thumb, **one plain-sans sentence** naming the consequence, ghost Cancel + danger-**outline** CTA repeating the verb. There is no filled destructive button in this system.

The sentence carries the actual consequence:
- future block → *"The plan shortens to 13 weeks and ends 2 Nov. Cut 2 moves to 29 Sep."*
- current block → *"Cut 2 starts today. Sarah's targets change from 2,050 to 2,150 today."*
- elapsed block → not offered at all.

### Task 3.3 — Per-block preview in the nutrition builder

Generate returns one row per block instead of one set of numbers. Each row is amendable. **Dates and rates are read-only here** — they are edited where they were created.

**Every capped rate renders inline, per row** (invariant 12).

### Task 3.4 — Chip strip + calendar tint

A horizontal strip above the calendar toolbar (name · dates · rate), plus a per-day tint on **both** the training and nutrition calendars.

- There is **no timeline/Gantt/date-band primitive** in this codebase, and a spanning bar does not work: the month grid has `gap-2` between cells and a 42px rail, and a mid-week boundary has no clean expression in a 7-column grid. Use the **per-day cell wash** (the removed implementation used teal alpha 0.06/0.03/0.02 — the bottom rungs of the ladder in `newdesignsystem.md`).
- The strip is not decoration: the calendar renders **one month**, and a 15-week block set is four months, so the strip is the only place the coach sees the whole plan at once.
- **Render all blocks including elapsed ones, muted — do not filter to current-and-future.** Without this, a coach looking at a past month cannot tell why the calories changed. This is the entire v1 "view past blocks" story.
- Structurally it is the **label-less `SectionLabel` variant** (bare hairline + right-aligned cluster) — the training calendar toolbar is the reference. `min-h-[24.5px]` on the divider row.
- Typography: block **names** are sans (a name's digits belong to the name); dates, week counts and rates are mono via `MONO_LABEL_CLASS`. `npm run check:labels` fails the build on a raw `font-mono-display`.

### Task 3.5 — Start date flows downstream

- **Training** (`components/training-library/apply-to-client-dialog.tsx`): the Start Date field defaults to `getNextMonday()`. Change it to the client's plan start date **when one is set and still in the future**, else next Monday. Add a hint line: *"Sarah's plan starts Mon 4 Aug."* Coach can still override — this is a default, not a lock.
- **Nutrition first creation** (`components/clients/nutrition/builder/drawer-footer.tsx:22-24`): currently generates immediately with `effective_from` resolving server-side to **today**. That is a real bug with a Friday-setup/Monday-start: it writes Saturday and Sunday targets the client is not meant to follow. Use the plan start date.
- **Nutrition regeneration** (`components/ui/apply-date-dialog.tsx`): **keep the modal.** "From which day should this change apply?" is a genuinely different question from "when does this plan begin" — a coach changing macros in week 6 needs *now* vs *next Monday*, and neither is the plan start. **Reword both surfaces so they stop sounding alike**, and re-tokenise this dialog off `AlertDialog` while you are in it.

**Keep both modals.** Mid-plan changes are the dominant case after onboarding; onboarding happens once.

### Task 3.6 — "Waiting on you" rows

Three coach-action rows on the client Overview. **These are not alerts** (invariant 14): they render like the unreviewed-check-in row (thumb + title + meta + outline button), are **not dismissible**, and do **not** go through `evaluateAndSortTriggers`. They clear by being done.

| Row | Fires when | Action |
|---|---|---|
| **Nutrition is out of date** | blocks fingerprint ≠ the plan's stored one | `Regenerate` → Nutrition tab |
| **Plan ends in N days** / **Plan complete** | last block ends ≤14 days out, or has ended with no newer goal | `Set a new goal` → goal panel |
| **No goal set** | client has a training or nutrition plan but no goal | `Set goal` → goal panel |

Reference: `components/clients/overview/waiting-on-you-section.tsx` — the check-in row at `:71-100` is the pattern.

**Do not add these to the dashboard attention feed** (owner decision, 2026-07-28): the feed stays purely client-behaviour, and these live on the client Overview only.

**Deliberately not built:** *"your blocks don't reach the goal"* as a standing alert. The goal panel already says it at authoring time, when the coach can act; repeating it nags about a decision they may have made on purpose.

### Task 3.7 — Activation readiness: add the goal

`GET /api/clients/[id]/activation-readiness` requires `hasTrainingPlan`, `hasNutritionPlan`, `hasHabits` — **but not a goal**, even though the goal is the input the entire calorie calculation runs on. A coach can activate a client whose plan was computed against a null goal (which silently means maintenance).

Add the goal as a **required** item. Add blocks as an **optional**, visibly skippable one that never gates activation.

### Task 3.8 — Client portal: "Your plan starts Monday" *(smallest, do last)*

A pre-start day currently renders blank — `getPlanTargetForDate` returns `null` and there is no template fallback. Replace it with a countdown state. This is about the **start date**, not blocks; client-facing blocks remain post-launch.

### Task 3.9 — Client portal reads the real goal, not the `clients` mirror

Task 1.3 moved the **coach** Overview onto `client_goals` and deliberately left the client-facing
side on the mirror. The two stores genuinely diverge — measured on fixture **Samuel James**
(`ed5cb82c-30ea-488d-96d8-eb34e8ae09fa`), 2026-07-29: `client_goals` = **90 kg / 9 %**
(`superseded_at: null`), `clients` mirror = **77 kg / 33 %**. The coach and the client can be
looking at different goal weights for the same client, today.

**The read sites:** `services/client-portal-progress.ts:139-140,268-269` and
`services/client-portal-service.ts:44` → `components/client-portal/metrics/goals-section.tsx`.
`mapClientRow` is **shared with the coach path** via `toClientSelfView` (`lib/mappers.ts:135`) —
do not "fix" this by changing the mapper, and do not add `goalDeadline` to it (1.3 established
that `clients.goal_deadline` is unreachable and the mirror is the thing being retired).

**This needs a new read path, which is why it was not in Session 1.** `/api/client/**` has no goal
endpoint at all — endpoint → auth chain (`getAuthenticatedClientId`, pass `request`) → hook →
component. Scoped to the **goal**; client-facing *blocks* stay v1.5 per §6.

**Do not defer this again on "it's only the harness" — that reason is wrong** (owner correction,
2026-07-29). The tempting argument is that the client web portal is a test harness and RN is the
real client, so the work is throwaway. That is true of the **component** only. RN consumes the
**same `/api/client/**` endpoints**, so the goal endpoint is a route RN needs regardless and should
be built once, against `client_goals`, rather than twice. Invest in the data/API layer; the
portal's React component is the disposable half.

**Severity is capped only by nobody real being on the portal yet.** The moment a real client is
pointed at it — a pilot, a client-facing demo, or RN slipping — this is live misinformation to a
client about their own goal. If that happens before Session 3 lands, pull this task forward ahead
of everything else in the session.

**Placed in Session 3 rather than 2.7** because 3.8 is already the client-portal task, so both land
in one pass over that surface. If Session 2 has capacity, the endpoint half can be pulled into 2.7
without waiting — it has no dependency on blocks.

### Session 3 verification

- Full `CONVENTIONS.md` §13 checklist, `npm run check:labels` especially.
- **Browser smoke, end to end:** create a goal with a future start → add 3 blocks → place a program → generate nutrition → confirm the calendar carries three different sets of numbers across the right date ranges → edit a block's rate → confirm the "Nutrition is out of date" row appears → regenerate → confirm it clears.
- Verify **rendered pixels**, not class math — equal margins are not equal optics on a divider row.
- Scroll the calendar back before today and confirm elapsed blocks still render, muted.

---

### 📋 SESSION 3 PROMPTS — four fresh sessions, in order

**Why four and not one.** Session 2 shipped as a single prompt covering 7 tasks. It consumed
**four** sessions, and **three of them died on `ECONNRESET`** at 384k / 541k / 480k tokens of
context — the two that stayed under 300k never did. The observed safe rate is **2–3 numbered tasks
per session**. Session 3 has nine, and UI work is heavier per task than backend: the design system,
the shared tokens and the surface being edited all have to be resident at once.

Each block below is **self-contained** — paste one into a fresh session and nothing else. They are
grouped by *shared reading cost*, not by task count: tasks that pay for the same context travel
together. **Run them in order.** 3A is first because every other surface links into the panel it
builds; 3D is last because the doc says so and because it is the only one outside the coach app.

**Context hygiene applies to all four.** If a session passes ~250k tokens, finish the task in hand,
commit, and start the next one fresh rather than pushing on. `/context` shows the number. If you
start seeing `API Error: Unable to connect to API (ECONNRESET)`, the context is too big — do not
retry, and do not type `go`; that re-fires the same oversized request. See the "Post-crash audit"
STATUS blocks at the end of this document.

---

#### 3A — the goal & plan panel (Tasks 3.1 + 3.2)

```
Read these in full before planning anything:
  1. CONVENTIONS.md  (mandatory — it says so at the top; do not skip sections)
  2. docs/ARCHITECTURE.md
  3. docs/newdesignsystem.md  (design source of truth — but where it and shipped
     Programs/Builder code disagree, the SHIPPED CODE wins)
  4. docs/CLIENT-GOALS-PHASES-EXECUTION-PLAN.md — §1 (design), §2 (invariants), §3 (what
     to do when a doc rule blocks you), §4 (known doc collisions), the SESSION 1 and
     SESSION 2 STATUS blocks (they record decisions you must inherit), and all of
     SESSION 3 for context.

You are executing TASKS 3.1 and 3.2 ONLY. Do not start 3.3 or anything after it.

3.1 is the "Goal & plan" panel — one right Sheet, Destination + Route sections, with the
live "15 weeks · 4 Aug – 16 Nov · projects 76.4 kg" readout. 3.2 is its delete-a-block
confirm dialog. They ship together because 3.2's dialog needs 3.1's data shape and would
otherwise re-read everything 3.1 read.

The backend is DONE and you must not rebuild it. It is already live:
  - GET/PUT/DELETE /api/clients/[id]/phases (the PUT takes {startDate, phases:[{name,
    weeks, ratePerWeekKg}]} — LENGTHS ONLY, and the schema is .strict(), so sending date
    pairs is a 400)
  - the DELETE returns the blocks whose dates SHIFTED — that list is what 3.2's confirm
    sentence must name, rather than re-deriving the consequence in the browser
  - lib/goals/phase-chain.ts is browser-safe ON PURPOSE: chainPhases / getPhaseForDate /
    isPhaseElapsed / lastPhaseEnd are the SAME functions the server writes with. Render
    the live readout from them. Do not hand-roll date arithmetic — a local-parse variant
    loses a day west of UTC.

Decisions you inherit (do not re-litigate):
  - Blocks save INDEPENDENTLY of the goal (invariant 7). Two writes: goal → the goals PUT,
    and ONLY when a goal field actually changed; blocks → the phases PUT. Never route a
    block edit through updateGoals — it supersedes-and-inserts, so renaming a block would
    mint a goal version.
  - The "on track / not on track" readout is INFORMATION, never a blocker. A deliberately
    conservative plan is a legitimate coaching call.
  - Form pattern is react-hook-form + zodResolver, modelled on
    nutrition-edit-targets-sheet.tsx. Do NOT copy client-goal-editor.tsx's four-useState
    pattern — it predates the rule and is the outlier.
  - Elapsed blocks are not offered for deletion at all, and the server refuses them with a
    422 naming the block. Surface that message; do not swallow it.

ALSO CLOSE THESE TEST GAPS while you are here — they are unprotected today only because
nothing calls them yet, and your UI is what makes them reachable:
  - the zod bounds in lib/validations/client-phases.ts (MAX_PHASES, MAX_CHAIN_WEEKS,
    MAX_PHASE_WEEKS, and the duplicate-id refinement) — all four can currently be deleted
    with the full suite green
  - deleteClientPhase's re-chain anchor for the FIRST block of a chain
Prove each new test actually bites: break the source, confirm the test fails, restore.

Import the shared tokens and components before writing any new class strings:
builder-tokens.ts, SectionLabel, StatBand, SegmentedControl, RowActions. Author with the
hardcoded hex from newdesignsystem.md, not the OKLCH semantic tokens. Radius rounded-[6px],
4px for inner chips. Block NAMES are sans even when they contain digits ("Cut 2") — the
digits belong to the name; dates, week counts and rates are mono via MONO_LABEL_CLASS, and
`npm run check:labels` fails the build on a raw font-mono-display.

3.2's dialog: styled Dialog, NEVER AlertDialog. Danger thumb, ONE plain-sans sentence
naming the actual consequence, ghost Cancel + danger-OUTLINE CTA repeating the verb. There
is no filled destructive button in this system.

Rules:
- CONVENTIONS.md §2: show me a plan and get approval before writing any code. This applies
  to small UI changes too.
- One commit per numbered task.
- If a rule in CONVENTIONS.md, ARCHITECTURE.md or newdesignsystem.md blocks you, follow §3
  of the execution plan: quote it with file:line, classify it (protective / stale /
  protective-but-wrong-here), then comply, update the doc in the same commit, or STOP AND
  ASK ME. Never silently ignore a rule, and never silently comply with one that makes the
  feature wrong.
- Commit-ready means all of CONVENTIONS.md §13.
- Verify RENDERED PIXELS, not class math.
- Append a STATUS block to docs/CLIENT-GOALS-PHASES-EXECUTION-PLAN.md as each task lands.

Start by reading the four documents plus the Session 1 and 2 STATUS blocks, then show me
your plan for 3.1.
```

---

#### 3B — showing the block set (Tasks 3.3 + 3.4)

```
Read these in full before planning anything:
  1. CONVENTIONS.md  (mandatory)
  2. docs/ARCHITECTURE.md
  3. docs/newdesignsystem.md  (shipped code wins where they disagree)
  4. docs/CLIENT-GOALS-PHASES-EXECUTION-PLAN.md — §1, §2 (invariants), §3, §4, the
     SESSION 1 and SESSION 2 STATUS blocks, and all of SESSION 3. Task 3A (3.1 + 3.2)
     has already shipped — read its STATUS block; it is where blocks are AUTHORED and
     you must not duplicate that surface.

You are executing TASKS 3.3 and 3.4 ONLY. Do not start 3.5 or anything after it.

Both tasks render a block set the coach authored elsewhere: 3.3 is the per-block preview
in the nutrition builder, 3.4 is the chip strip above the calendar plus the per-day tint on
BOTH the training and nutrition calendars. They ship together because they share the same
display vocabulary and the same typography trap.

Load-bearing constraints:
  - In 3.3, DATES AND RATES ARE READ-ONLY. They are edited where they were created (3A's
    panel). The rows are amendable in every other respect, and EVERY CAPPED RATE RENDERS
    INLINE, PER ROW (invariant 12) — a capped rate that is silently applied is the defect
    that rule exists to prevent.
  - In 3.4, there is NO timeline/Gantt/date-band primitive in this codebase and a spanning
    bar does not work: the month grid has gap-2 between cells and a 42px rail, and a
    mid-week boundary has no clean expression in a 7-column grid. Use the PER-DAY CELL
    WASH — the removed implementation used teal alpha 0.06/0.03/0.02, the bottom rungs of
    the ladder in newdesignsystem.md.
  - RENDER ALL BLOCKS INCLUDING ELAPSED ONES, MUTED. Do not filter to current-and-future.
    That muted rendering IS the entire "view past blocks" story for v1 — without it a coach
    looking at a past month cannot tell why the calories changed.
  - The strip is not decoration. The calendar renders ONE month and a 15-week block set is
    four, so the strip is the only place the coach sees the whole plan at once.
  - Structurally the strip is the label-less SectionLabel variant (bare hairline +
    right-aligned cluster); the training calendar toolbar is the reference.
    min-h-[24.5px] on the divider row.
  - Block NAMES are sans even with digits ("Cut 2"); dates, week counts and rates are mono
    via MONO_LABEL_CLASS. `npm run check:labels` fails the build on a raw
    font-mono-display.

ALSO CLOSE THIS TEST GAP: writePhaseDailyTargets (services/client-phases-service.ts) is the
grid writer your preview renders, and it currently has no executing test — the whole
function can be made a no-op with the full suite green. Prove the new test bites: break the
source, confirm it fails, restore.

Import the shared tokens and components before writing any new class strings:
builder-tokens.ts, SectionLabel, StatBand, SegmentedControl, LibraryTableShell, RowActions.
Hardcoded hex, not OKLCH. Radius rounded-[6px], 4px for inner chips.

Rules:
- CONVENTIONS.md §2: plan first, get approval, then code. Applies to small UI changes too.
- One commit per numbered task.
- Doc collision → §3 procedure: quote with file:line, classify, then comply / update the
  doc in the same commit / STOP AND ASK ME.
- Commit-ready means all of CONVENTIONS.md §13, check:labels especially.
- Verify RENDERED PIXELS, not class math. Equal margins are not equal optics on a divider
  row — the hairline is centred in a variable-height row.
- Append a STATUS block as each task lands.

Start by reading the documents plus the Session 1/2 and 3A STATUS blocks, then show me your
plan for 3.3.
```

---

#### 3C — flows and prompts (Tasks 3.5 + 3.6 + 3.7)

```
Read these in full before planning anything:
  1. CONVENTIONS.md  (mandatory)
  2. docs/ARCHITECTURE.md
  3. docs/newdesignsystem.md
  4. docs/CLIENT-GOALS-PHASES-EXECUTION-PLAN.md — §1, §2 (invariants), §3, §4, the
     SESSION 1 and SESSION 2 STATUS blocks, and all of SESSION 3. Tasks 3A and 3B have
     shipped — read their STATUS blocks.

You are executing TASKS 3.5, 3.6 and 3.7 ONLY. Do not start 3.8 or 3.9.

These three are grouped because none of them builds a new UI primitive — they surface state
that already exists. They are individually small; do not let that tempt you into skipping
the plan step.

3.5 — start date flows downstream. THREE call sites, and the third is a trap:
  - training apply-to-client-dialog.tsx: Start Date currently defaults to getNextMonday().
    Use the client's plan start date WHEN SET AND STILL IN THE FUTURE, else next Monday.
    Add the hint line. The coach can still override — this is a default, not a lock.
  - nutrition drawer-footer.tsx: generates immediately with effective_from resolving
    server-side to TODAY. That is a real bug on a Friday-setup/Monday-start — it writes
    Saturday and Sunday targets the client is not meant to follow. Use the plan start date.
  - apply-date-dialog.tsx: KEEP THIS MODAL. "From which day should this change apply?" is a
    genuinely different question from "when does this plan begin" — a coach changing macros
    in week 6 needs now vs next Monday, and neither is the plan start. REWORD BOTH SURFACES
    so they stop sounding alike, and re-tokenise this dialog off AlertDialog while you are
    in it.

3.6 — three "Waiting on you" rows on the client Overview. THESE ARE NOT ALERTS
(invariant 14): they render like the unreviewed-check-in row (thumb + title + meta + outline
button), are NOT dismissible, and do NOT go through evaluateAndSortTriggers. They clear by
being done. Reference: waiting-on-you-section.tsx, the check-in row at :71-100.
  - "Nutrition is out of date" reads the server-computed `nutritionStale` boolean already
    returned by GET /api/clients/[id]/phases. DO NOT re-derive the comparison in the
    browser — the rule has one home (isNutritionStaleForPhases) precisely because its
    custom-macros exemption is the half that gets forgotten.
  - DO NOT add these to the dashboard attention feed (owner decision, 2026-07-28). The feed
    stays purely client-behaviour; these live on the client Overview only.
  - Deliberately NOT built: "your blocks don't reach the goal" as a standing alert. The
    goal panel says it at authoring time, when the coach can act.

3.7 — activation readiness. Add the goal as a REQUIRED item and blocks as an OPTIONAL,
visibly skippable one that never gates activation. This is an API change as well as UI —
give it the full CONVENTIONS §9/§10 treatment, not a render tweak.

ALSO CLOSE THIS TEST GAP: isNutritionStaleForPhases (services/nutrition-plan-service.ts) has
no test at all — both a hardcoded `false` and dropping the custom-macros exemption survive
the full suite today. 3.6 is its first consumer. Prove the new test bites.

Rules:
- CONVENTIONS.md §2: plan first, get approval, then code.
- One commit per numbered task.
- Doc collision → §3 procedure.
- Commit-ready means all of CONVENTIONS.md §13. 3.7 touches an API route, so the §2
  security/load/performance review is TRIGGERED — run it and report it unprompted.
- Verify RENDERED PIXELS, not class math.
- Append a STATUS block as each task lands.

Start by reading the documents plus the prior STATUS blocks, then show me your plan for 3.5.
```

---

#### 3D — client portal (Tasks 3.8 + 3.9 + rider (f))

```
Read these in full before planning anything:
  1. CONVENTIONS.md  (mandatory)
  2. docs/ARCHITECTURE.md
  3. docs/CLIENT-PORTAL-REDESIGN.md AND docs/CLIENT-PORTAL-EXECUTION-PLAN.md — per
     CONVENTIONS §16 these are the SOURCE OF TRUTH for anything under app/client/** or
     components/client-portal/**, and they WIN over ARCHITECTURE.md where they disagree
     about a client-portal read or write path.
  4. docs/CLIENT-GOALS-PHASES-EXECUTION-PLAN.md — §1, §2 (invariants), §3, §4, the
     SESSION 1 and SESSION 2 STATUS blocks, and all of SESSION 3. Tasks 3A, 3B and 3C have
     shipped — read their STATUS blocks.

You are executing TASKS 3.8, 3.9 and rider (f) ONLY. This is the last block of the
workstream.

THIS IS MOSTLY BACKEND, despite living in the client app. Budget it that way.

3.9 is NOT a UI task. /api/client/** has NO goal endpoint at all today — the portal reads
the `clients` goal mirror directly (client-portal-progress.ts:268 →
components/client-portal/metrics/goals-section.tsx). You are adding a new client-scoped read
path with the full CONVENTIONS §9/§10 chain, then moving the portal onto it. This is the
LAST mirror reader in the codebase; the two hooks that used to be listed alongside it came
off in Task 2.4.

Why it matters, with evidence: on 2026-07-29 a live client's mirror held 78 kg / 15 % while
client_goals held 92 kg / 9 %, so the coach's Overview and the client's own portal reported
different goals with nothing on either screen indicating disagreement. The write path that
caused it is fixed (commit 5d5fd99), but the portal will keep reading a second copy of the
truth until this task lands.

3.8 — a pre-start day currently renders blank: getPlanTargetForDate returns null and there
is no template fallback. Replace it with a countdown state. This is about the START DATE,
not blocks — client-facing blocks remain post-launch and are OUT OF SCOPE.

Rider (f) — the level-3 template fallback, deferred here by owner decision in Task 2.5's
STATUS. A date past the horizon (max(today + 56d, last block end)) still reads as "no
target", and that null is snapshotted PERMANENTLY into nutrition_logs
(daily-log-card-service.ts:79-99) and drops the day from the weekly denominator
(weekly-nutrition-service.ts:65-81). It is a READ-path concern, which is why it lands with
3.8 rather than with generation. For it to bite, a client must be looking 9+ weeks ahead AND
logging food that day.

Scale note: per CONVENTIONS §14 the client web app is a throwaway test harness — the real
client is React Native. Invest in the data/API layer, not web render. Lazy-mount,
memoization and virtualization are explicitly OUT OF SCOPE here.

Rules:
- CONVENTIONS.md §2: plan first, get approval, then code.
- One commit per numbered task.
- Doc collision → §3 procedure. Note the CONVENTIONS §16 precedence above: the
  client-portal docs beat ARCHITECTURE.md on portal read/write paths.
- New API route → the CONVENTIONS §2 security/load/performance review is TRIGGERED. Run it
  and report it unprompted.
- Commit-ready means all of CONVENTIONS.md §13.
- Append a STATUS block as each task lands.

When all three are done, run the FULL browser smoke from this plan's "Session 3
verification" section and report what you SAW, not what you expect. Then, per this
document's own header, the workstream is complete: update docs/ARCHITECTURE.md with
anything still owed and DELETE this execution plan — the precedent set by the
training-builder and wellness-soreness plans. Its STATUS blocks survive in git history.

Start by reading the documents plus the prior STATUS blocks, then show me your plan for 3.9
(do it first — it is the largest and the only one with a new API surface).
```

---

## 6. Explicitly out of scope

| Item | Why |
|---|---|
| Client-facing **blocks** ("Block 2 of 3") | v1.5. **Note the reason narrowed 2026-07-29:** it used to be "no `/api/client/**` goal endpoint exists at all", but Task 3.9 now builds that endpoint for the goal. What stays out of scope is exposing *blocks* to the client — the endpoint 3.9 adds is goal-shaped and must not grow a blocks payload. |
| Block report card (prescribed vs actual rate) | Wants the check-in rebuild to settle first so "actual" and "adherence" mean one thing. Post-launch. |
| Block type enum | Removed by owner decision — rate sign gives direction, and the coach's own block name carries the intent better than any enum. Would over-determine the block. |
| Blocks prescribing training (deload/taper) | Would make blocks genuinely cross-domain; the program builder already handles deloads per-week via progression. Post-launch — and it is the one change that would justify reintroducing a type column. |
| Blocks constraining training placement | The old `calculatePlacementEndDate` / `validatePhaseBounds` inverted this: the program is the container, the block is the slice. Blocks inform placement visually, never restrict it. |
| Dashboard attention-feed rows | Owner decision 2026-07-28 — the feed stays purely client-behaviour. |
| Milestones, objectives, block descriptions, phase snapshots, coach reflections, completion cards, a roadmap container, per-block protein/diet type | The removed feature's lowest-value, highest-cost half. `{name, start, end, rate}` plus calendar tinting captures nearly everything those screens rendered. |

## 7. Open items

- ~~**Client portal still reads the `clients.*` goal mirror**~~ — **SCHEDULED as Task 3.9** (owner, 2026-07-29). No longer "revisit with client-facing blocks": the goal read is separable from blocks, and the `/api/client/**` endpoint it needs is one RN will consume too, so it is not harness-only work.
- ~~**`gender` unset defaults to the male safety cap.**~~ → **Task 2.8(e).** Decide and record there.
- **The `nutrition_events` template fallback (level 3) is still unbuilt.** → raised as **Task 2.8(f)**; 2.5 established that the widened horizon does **not** close it, so it is **carried forward to Session 3D** (owner, 2026-07-29). This is the workstream's one open item.

**Nothing in this section is unassigned as of 2026-07-29.** Session 1's deferrals all have an owner in
**Task 2.8**; the client-portal goal mirror is **Task 3.9**. If a new open item is added here, give it
a task number in the same edit — an entry with no owner is how the last workstream lost things.

## 8. STATUS blocks

*Sessions append here at commit time.*

**Lifecycle — read this before you append.** A STATUS block is a **handoff artifact, not a
journal.** Write only what the next session cannot get anywhere else: decisions taken, decisions
rejected, deviations from this plan, and traps that leave no trace in code. Gate counts and
"what shipped" narrative belong in the **commit message**; durable architecture facts belong in
**`docs/ARCHITECTURE.md`**; a correction **edits the line it corrects** rather than adding prose
beneath it. **Once a session is closed and its durable half has landed in ARCHITECTURE.md,
compress its block to the decisions that still bind** — the long form survives in git history,
which is already where this project keeps the training-builder and wellness-soreness plans. The
test for every line is: *if the next session never reads this, what breaks?* If the answer is
"nothing", it is journal — cut it.

---

### Sessions 1 and 2 — decisions that still bind

> **Compressed 2026-07-29.** This was ~1,330 lines across 14 per-task blocks. Both sessions are
> closed, shipped and reconciled into `docs/ARCHITECTURE.md`. The full text — evidence, gate
> counts, golden-matrix derivations, review findings — is in git history at `6236e47` and
> earlier. What follows is what a later session still needs.

| Session | Tasks | Migrations |
|---|---|---|
| 1 | 1.1–1.4 (`53abf0a` `3abbfa5` `b3ca479` `62cef4a`) | none |
| 2 | 2.1–2.7 + 2.8(a)–(e),(g),(h) (`86b7a98`…`e315329`, plus `03981e9` `3de0be9` `5d5fd99` `7483184`) | 137, 138, 139 |

**2.8(f)** — the `nutrition_events` level-3 template fallback — is the **only carry-forward**,
owned by **Session 3D**. Task 2.5 established that the widened horizon does not close it.

#### Goals

- **`updateGoals` owns both stores in one transaction** (migration 139). Callers must not write
  the `clients.*` goal columns themselves and must not swallow its failure. All four did, and it
  cost a live client six weeks of showing two different goals. Regression tests pin all four paths.
- **No `DEFAULT NULL` parameters on the 139 RPC, deliberately** — contradicting
  `feedback_rpc_optional_params_default_null`, because here NULL is a *meaningful value* (it
  clears a field), so omitted and null must stay distinguishable. The presence-merge stays in
  TypeScript.
- **NOT fixed, not claimed to be:** `getCurrentGoals` still runs outside the transaction, so two
  concurrent writers merge against the same snapshot and the later wins. The loser now trips the
  unique index *inside* the transaction and rolls back cleanly instead of leaving zero goals.
- **The `notes` carry-forward was rejected** (owner, 2026-07-28). `client_goals` supersedes, so
  the prior row keeps its notes and the new row never had any — nothing is nulled. Carrying it
  forward would make it an unclearable ratchet. **Do not reinstate.**
- **No stored rate column** (1.4). Target + deadline is the stored truth; a stored rate would let
  all three disagree. Blocks store their rate on `client_phases` — different table, unaffected.
- **`clients.goal_deadline`: the mapped property is unreachable, the column is not.**
  `mapClientRow` never sets `goalDeadline`, so every `?? client.goalDeadline` fallback is dead
  code — but `intake-review-service.ts:114` selects the column raw and `:156-163` uses it as a
  backfill guard, which is why migration 139 keeps writing all three mirror columns. Do not add
  it to the mapper to "fix" a deadline read.
- **The client portal keeps the mirror deliberately** → **Task 3.9** owns moving it.

#### Blocks — schema and service

- **No `UNIQUE (client_id, starts_on)`, and the reason is not cosmetic.** A non-deferrable unique
  index is checked per row, so the delete-and-shift-back rewrite fails the moment one shifted row
  transiently collides with a not-yet-shifted one, in an order Postgres does not define.
  Deferrability belongs to a CONSTRAINT; a plain or partial unique INDEX can never be deferred.
  Invariant 6 already makes overlaps unexpressible.
- **`client_phases.updated_at` has no trigger** — stamp it in app code on every write, or it
  freezes at insert time (the defect migration 096 had to fix for `exercises`). Migration 096 was
  the last trigger added; do not add one.
- **`daily_targets` is five keys per row, not six.** `is_training_day` is deliberately absent: it
  is a per-DATE fact from live training events and a weekday-keyed grid cannot carry it. It is
  passed *into* the resolver, never read from a grid.
- **Bounds live in zod, not CHECK constraints** (migration 131's rule). `MAX_PHASE_WEEKS` 52,
  `MAX_CHAIN_WEEKS` 104, `MAX_PHASES` 12, `MAX_ABS_RATE_KG_PER_WEEK` 5. That rate bound is a
  sanity bound, **not** the gender safety cap — invariant 12 needs the coach's entered rate stored
  verbatim so the cap can surface in the preview. Measured: SQLSTATE `23514` has zero handlers
  repo-wide, so a CHECK violation reaches a coach as raw Postgres text.
- **A grid survives a rename and nothing else.** `carryDailyTargets` keeps `daily_targets` only
  when `startsOn`, `endsOn` **and** `ratePerWeekKg` are all unchanged. That is what makes
  "non-null grid" a trustworthy promise to the per-date resolver.
- **The elapsed guard checks the COMPUTED dates, not the submitted ones** — the client sends
  lengths, so shortening an earlier block silently drags a finished one backwards. Elapsed rows
  are excluded from the write entirely, so no coach edit can touch them.
- **Plan generation is NOT bound by that guard** and recomputes `daily_targets` for every block
  including elapsed ones. So `client_phases.updated_at` is **not** a "was this finished block ever
  touched" signal, and a past-block readout must not assume it shows the numbers the client ate.
- **The pure half lives in `lib/goals/phase-chain.ts`, the DB half in the service**, split on
  "can the browser run it" — not tidiness. `services/phase-fingerprint.ts` is server-only because
  `createHash` has no browser form. `getPhaseForDate` is list-based: callers load blocks once and
  pass the array (no query inside a per-item loop).
- **Live-catalog finding: new tables are NOT privilege-free.** Supabase's stock default privileges
  add `GRANT ALL … TO anon, authenticated` on `CREATE TABLE`. `CONVENTIONS.md:361` ("a freshly
  created table has no Data API privileges… forgetting it fails loudly") is **factually wrong on
  this project**. Not exploitable — RLS is on with zero policies — but RLS is the *sole* perimeter
  for every new table here. Verify with `npm run check:rls`, never from the docs.

#### The fingerprint and staleness

- **`goal_source` was NOT reintroduced** (owner, 2026-07-29), against this plan's own §2.2. A
  block carries a rate and no target weight, so the goal snapshot resolves from `client_goals` in
  every case and the column would be the constant `'client'` that got it dropped by migration 133.
- **The fingerprint is stamped as the LAST write of a generation, never as an RPC argument.**
  Order is grids → plan → events → fingerprint, and the order *is* the design: the stored hash
  means "every write above succeeded", so every failure direction leaves it **stale** — a visible
  "out of date" that clears on the next regenerate — rather than asserting a block set the
  client's events do not follow. An RPC arg under `DEFAULT NULL` would wipe a stored hash into the
  *silent-miss* direction, and the stamp must outlive event generation, which needs the plan id
  the RPC returns. A test asserts the invocation ORDER, not just that each ran.
- **NULL means "no block set drove this generation"** and covers pre-138 rows, block-less clients,
  custom-macros saves and `preserveCalories` identically. `computePhasesFingerprint([])` returns
  **null, never a sentinel hash** — a sentinel would make every existing plan compare unequal and
  fire a spurious "out of date" row on the day Session 3 ships.
- **`stampPhasesFingerprint` swallows its error into `captureApiError` and returns 200**, a
  deliberate CONVENTIONS §2 #12 disclosure. Safe only *because* this write is last.
- **Custom macros ignore blocks**, enforced in three places: the stamp is NULL, the per-date
  resolver short-circuits on `custom_macros_enabled`, and `nutritionStale` is
  `!custom_macros_enabled && current !== stored`. **The staleness rule has one home**
  (`isNutritionStaleForPhases`) — never re-derive it in the browser, because the custom-macros
  exemption is the half that gets forgotten. A read failure returns `false`: a transient DB error
  must not manufacture an alarm.
- **SESSION 3 CONSTRAINT, still open:** all three of those are backend. A coach who sets blocks
  and then turns on custom macros gets flat numbers, a clean Overview and no explanation.
  **3.1's Route section and 3.3's per-block preview must both say blocks are not driving nutrition
  while custom macros is on.**

#### Nutrition generation and the cascade

- **The cascade takes a `NutritionRegenScope`, not a floor.** `{kind:"dates"}` upserts exactly
  those days with **no DELETE** (which is what closes the no-row window); `{kind:"from"}` derives
  the DELETE and the regenerate from **one computed range**. `resolveScopeDates` returns one array
  and both halves read it, so the horizon widening for blocks cannot reintroduce the old
  unbounded-DELETE-vs-bounded-regenerate mismatch.
- **There are 12 cascade invocations, not 8** — `place-from-library` cascades three times and
  `[planId]/sessions/[sessionId]` from both PUT and PATCH. Its **DELETE does not cascade at all**
  (recorded as fact, not changed).
- **Never use `training_plans.effective_until` for a cascade end bound** — it stays NULL on placed
  plans, so it silently collapses the range to the default horizon on exactly the long plans that
  need it. The honest sources are the amendment's own `windowEnd` and the events
  `cancelFutureEventsForPlan` just deleted.
- **KNOWN GAP (owner, 2026-07-29):** if a coach *shortens* a program, days the old window covered
  past the new `windowEnd` keep a stale training-day surplus. Deferred deliberately.
- **Generation is per-date via a resolver.** Order: **custom macros → the plan grid, blocks
  ignored entirely**; else the block covering the date **when its grid exists**; else
  `nutrition_plan_daily_targets`, byte-identical to pre-blocks behaviour.
- **`is_modified` protects the numbers the coach TYPED, not the training calendar.** A coach
  editing Tuesday's calories never said "Tuesday is a training day forever". Protected rows stay
  out of the upsert but get `is_training_day` refreshed by `refreshTrainingDayFlagOnEditedDays` —
  **that column and `updated_at`, nothing else**. Any future code that widens or narrows
  `is_modified` protection must keep this split.
- **Deliberate simplifications in per-block calculation** — every block uses the same TDEE,
  protein is held constant, and a block's grid is flat across the 7 weekdays. Modelling per-block
  weight would invent numbers no later measurement reconciles against.
- **Unset `gender` keeps the male envelope** (owner, 2026-07-29), so no existing gender-less client
  is silently re-rated. `assumedSafetyEnvelopeWarning` fires only when a cap or floor **actually
  applied**; an explicit `"other"` is excluded, because the coach chose it.
- **A floored plan no longer advertises a deficit it will not run** — `calculateBaselineCalories`
  re-derives the reported rate from the floored target.

#### Units — the trap this workstream keeps hitting

- **`client_phases.rate_per_week_kg` is kg. `client_goals.goal_weight` and
  `clients.current_weight` are the client's DISPLAY unit.** `resolveEffectiveGoal` applies
  `weightToKg` when it *reads* the goal column, so writing kg into it is read as kg-of-kg: a 170 lb
  target stored as 77.11 comes back as a 35 kg goal, into the calculator and the mirror the client
  portal still reads.
- **`lib/goals/goal-rate.ts` is kg-internal** and its parameter names are truthful. Convert into
  it; do not pass display units through because the arithmetic happens to be unit-agnostic — the
  same module's `getRateSafety` returns **absolute kg thresholds**.
- **The failure direction differs by which way you cross.** A **kg** rate graded against a
  **display** ceiling reads *looser* than reality (the bug 2.4 caught in `computeGoalPace`: an lbs
  client's 0.5 kg/wk block graded against an lbs ceiling, a 2.2× understatement). A **display**
  rate meeting **kg** thresholds is *over-restrictive*. Same root cause, opposite sign — do not
  conflate them.
- **`0` is checked with `!= null`, never truthiness** — invariant 5 makes a `0` block explicit
  maintenance, and a truthiness check silently reports "no block covers this date" for every
  maintenance block.

#### Method — lessons that cost something to learn

- **A decision made in a session that dies is invisible to its successor.** Rider 2.8(h): the
  owner answered "fix all 58 now" at 16:35; the session died at 16:48; the successor re-derived the
  question and recommended the opposite. A lost decision leaves no trace in code, so no gate and no
  review can surface it. **After any crash, grep the dead transcripts for `AskUserQuestion`
  answers.**
- **Do not trust a subagent's claim to have reverted a mutation — diff the file.** One reported a
  revert and had not; another deleted a `recordAuditEvent` block and it **shipped**. `git diff` is
  **silent on untracked files**, so `cp` a baseline before any review and `diff` against it, and
  **re-run the gates AFTER a review, not only before**.
- **A green mutation run is a result about the test, not about the code.** Dropping `+ 1` from
  `weeksBetween` survived its round-trip test because `round((7n−1)/7) === n`.
- **A refutation on scope grounds is not a finding that the data is fine.** "This surface is
  allowed to read the mirror" and "the mirror holds the wrong number" are different claims. When a
  lens reports a divergence, check the **direction** and the **cause** before accepting it.
- **A structural assertion over a file's own source must exclude the comments that document it** —
  `expect(src).not.toContain("updateGoals")` failed on the docstring explaining the rule.
- **Capture a golden matrix by RUNNING the old code, before touching the body.** Re-deriving
  expectations from the new code proves nothing. When a fix must move numbers, re-derive the
  changed rows from the *definition*, never by pasting the new output.
- **`nutrition_events.updated_at` is `DEFAULT NOW()` with no trigger**, and the upsert omits the
  column — so a default fires on INSERT but not on the UPDATE half. **Any "did `updated_at` move?"
  assertion passes whether the cascade wrote 2 days or 56.** Sentinel a column the generator
  actually writes (`baseline_calories = 1`); `note`/`is_modified` survive any write and prove
  nothing. Confirmed live, not just read.
- **Restore live DB state after a smoke, and re-verify row by row.** A crash 16 minutes after a
  smoke deliberately diverged the goal mirror left a real fixture wrong for ~20 hours. A code
  revert does not fix database state.
- **Context is the binding constraint.** Four sessions died on `ECONNRESET` at 384k/480k/541k; the
  two that stayed under 300k never did. The error lands ~5m50s after the last turn — a retry budget
  expiring, not one bad packet — and typing `go` re-fires the same oversized request. If a session
  starts resetting, check its context size before debugging anything else.

#### Test gaps that are still open, with owners

Correctly refuted as unreachable *today* — no product caller hits them — which is an argument
about today, not about Session 3. Each becomes reachable when its surface is wired.

| Invariant with no executing test | Becomes reachable at |
|---|---|
| `writePhaseDailyTargets` (the grid writer) | **3.3** per-block preview |
| `isNutritionStaleForPhases` (`nutritionStale` has zero consumers) | **3.6** "Waiting on you" row |
| `deleteClientPhase`'s first-block re-chain anchor | **3.2** delete-a-block |
| ~~zod bounds: `MAX_PHASES`, `MAX_CHAIN_WEEKS`, `MAX_PHASE_WEEKS`, duplicate-id~~ | ~~3.1~~ **CLOSED** in `4f9ce8c` |

---

### Session 3A — rider + Task 3.1 part 1 ✅ SHIPPED 2026-07-29 · *(3.1 part 2 shipped since — see below)*

**Read this before continuing 3A.** Two commits landed (`d05f5cf`, `4f9ce8c`); the panel itself
has not been written. The session stopped at the context ceiling deliberately rather than starting
the UI — three sessions in this workstream died above 300k and lost their decisions.

**SCOPE NOTE — this session ran wider than the 3A prompt scoped, by explicit owner decision
(2026-07-29).** The prompt scopes 3.1 and 3.2. Two extra commits were authorised: the
`requireCoachOwnsClient` sweep (below) and, still to come, replacing the nutrition drawer's goal
editor with a link to the new panel. Neither is 3.1 or 3.2. Recorded so a successor reads them as
sanctioned rather than as scope drift, and does not re-litigate them the way 2.8(h) nearly was.

#### `d05f5cf` — every `requireCoachOwnsClient` call passes `request`

`03981e9` swept **`getAuthenticatedCoachId`** — the leaf — and left the wrapper alone.
`requireCoachOwnsClient(clientId, request?)` (`lib/require-coach-auth.ts:31-34`) forwards to
`requireCoachAuth(request)`, so a call omitting it drops the context one level up. **15 of 27 call
sites omitted it**, including both handlers of `/api/clients/[id]/goals`, which 3.1 turns into a
primary write path. Not a security hole. Mechanical; every site already had `request` in scope, and
the diff was filtered for any changed line that was not the substitution.

#### `4f9ce8c` — 3.1 part 1: the shared foundation (no UI)

Split from the panel because it is fully proven on its own. Precedent: 2.2 shipped
`stampPhasesFingerprint` with "not wired yet, deliberately".

- **`weeksBetween` MOVED** from `client-phases-service` into `lib/goals/phase-chain.ts`, exported.
  The panel derives each stored row's `weeks` from its dates to resubmit the chain, and the server
  validates elapsed blocks against the dates `chainPhases` **computes** from those weeks. A browser
  copy would be a second copy of this arithmetic (task 2.3 already undid one), and it fails
  **asymmetrically**: a one-day drift is a loud 422 when an elapsed block is present and a **silent**
  re-dating of the whole chain when one is not — the common case.
- **`chainPhases` is now generic** over its row (`weeks` is the only field it reads), so the server
  chains kg-carrying rows and the browser chains display-unit ones with no fabricated field. This
  made a cast at `client-phases-service.ts:287` provably redundant.
- **New `isConformingChain`.** `weeksBetween` rounds, so a hand-written 10-day block derives as 1
  week and re-chains 3 days shorter (11 days grows to 2), and a gap gets closed — silently changing
  what the client eats on the uncovered dates, and nulling the affected grids via
  `carryDailyTargets`. If the drifted block has **elapsed**, the 422 makes the panel permanently
  unsaveable: the bad value *is* the read-only row's derived weeks, so no UI action can produce an
  acceptable payload. **Callers refuse a non-conforming chain; they never normalize it.**
  `client_phases` held **0 rows** when queried live on 2026-07-29 and the app cannot author this
  shape, so the guard exists purely for hand-written SQL.
- **`components/clients/goal-plan/goal-plan-model.ts`** — every decision the panel makes, pure, and
  the owner of the ONE unit boundary. **Display domain:** the form, `client_goals.goal_weight`,
  `clients.current_weight`, `goalState`, the projection. **kg domain:** `lib/goals/goal-rate.ts` and
  `client_phases.rate_per_week_kg`.
- **`hooks/use-client-phases.ts`** — CONVENTIONS §7. The phases write touches two areas; the goals
  GET carries `phases` as a sibling key, so both invalidators must fire. No reader until 3.6.
- **TEST GAP CLOSED (`lib/validations/client-phases.test.ts`).** `MAX_PHASES`, `MAX_CHAIN_WEEKS`,
  `MAX_PHASE_WEEKS` and the duplicate-id refinement had no executing test — only 3 of the phases
  route's 14 tests touch validation at all. Each bound mutation-proven individually.

**TWO UNIT FACTS THAT MUST NOT ROT.**

1. **Never convert on the way to `client_goals.goal_weight`.** `resolveEffectiveGoal:97-99` applies
   `weightToKg` when it READS that column, so a 170 lb target stored as 77.11 comes back out as a
   **35 kg** goal and reaches the calculator and the mirror the client portal still reads. This was
   a live defect in the first draft of this session's plan.
2. **The unit-boundary failure direction, stated correctly.** A display-unit rate meeting
   `capWeeklyRate`'s **absolute kg** thresholds (`goal-rate.ts:33-35`, `:52-59`) is
   **OVER-restrictive** — an lbs number is ~2.2x the kg it stands for, so 1.5 lb/wk (0.68 kg/wk,
   safe) trips the 1.0 kg/wk cap and is clamped *slower* than asked. That is the **opposite sign**
   to Task 2.4's bug, where a kg rate met a display ceiling and read *looser* than reality. Same
   root cause, opposite direction — do not describe this one as "looks safer than it is". Recorded
   explicitly because pass 2's own lesson was to check the direction and the cause, and a backwards
   direction claim in a STATUS block is what survives six weeks.

**A mutation that did NOT bite, reported rather than papered over.** The `weeksBetween` round-trip
test passed against a mutant that dropped the `+ 1`, because `Math.round((7n-1)/7) === n` — the two
implementations are indistinguishable on conforming input, which is all the round trip exercises.
Only a non-conforming window separates them, and `deleteClientPhase:276` calls `weeksBetween` on
stored rows unconditionally. A 4-day case was added; the mutation now fails 2 tests. **A green
mutation run is a result about the test, not about the code.**

**Gates:** `tsc` clean · `eslint` **0 errors** · `vitest` **241 files, 2576 tests** (239/2527 at the
Session 2 close) · `check:labels` OK, 632 files · no `as any`, no leftover markers.

#### Still owed for 3A — decisions already made, do not re-litigate

Design is settled in full; only the writing remains. The four owner decisions: rate and projection
render in the client's **display unit**; a persisted block is deleted through the **DELETE
endpoint**; the drawer's goal editor becomes a **link** to the panel; 3.2's confirm sentence is
computed with **`chainPhases`** and the toast uses the server's `shifted`.

| Owed | Notes |
|---|---|
| `use-goal-plan-form.ts`, `goal-plan-sheet.tsx`, `block-row.tsx` | RHF + `zodResolver` + `useFieldArray`. Sheet shell after `nutrition-edit-targets-sheet.tsx`; form mechanics after `client-settings-dialog.tsx:108-118` (the sheet is **not** an RHF form, despite the 3A prompt naming it as the form model) |
| Overview wiring | `client-status-card.tsx` gains `onOpenGoalPlan` + a footer action; its `:190-192` comment ("no roadmap or phase concept") is now false — class (b) |
| `docs/ARCHITECTURE.md:580` | *"nothing on this page renders them yet"* goes false with the panel — class (b) |
| Elapsed rows | Fully read-only (name, weeks AND rate): `replaceClientPhases:184-189` excludes elapsed rows from the write, so a rename returns 200 and is silently dropped. Start date locks once any block has elapsed. **No drag-reorder** — that is what keeps elapsed blocks a contiguous prefix |
| Delete while dirty | Disabled with a hint. The sentence is computed from the STORED chain while the rows show the PREVIEW chain, so with unsaved edits the two disagree; re-seeding from the response destroys the edits and ignoring it leaves the sentence wrong. Both silent |
| `customMacrosEnabled` | **Required** prop, so a second mount cannot default it away. Overview: `summary.nutrition.customMacros` (the saved flag). The drawer mount must use `useNutritionPlan`'s saved `customMacrosEnabled`, **not** the live `generationMode` tab, or the two surfaces disagree |
| Nested Sheet risk | The drawer is a 420px right Sheet; the panel is 780px. Verify z-order, scrim, Esc precedence in the browser. **If it misbehaves, stop and ask** — do not silently switch to close-drawer-then-open |
| 3.2 test gap | `deleteClientPhase`'s first-block re-chain anchor (`:272`) |
| Browser smoke | `client_phases` is empty, so the panel is this database's **first ever writer** of it and 2.5/2.6's block-resolution path runs against real data for the first time. Pre-check the table is still empty. This also discharges **Task 2.7's owed smoke** |

**Recorded, not fixed — the self-heal is the PANEL's only.** `buildWrites` self-heals is true of the
PANEL. Between a blocks-succeeded/goal-failed save and the next panel save,
`resolveEffectiveGoal().startDate` hands the stale `goal_start_date` to
`nutrition-plan-orchestrator.ts:188`, `comparison-service.ts:76`, `nutrition/route.ts:118` and
`use-nutrition-plan.ts:162`, and that window may be unbounded.

---

### 3A commit 1 — an untouched block rate resends its stored kg ✅ SHIPPED 2026-07-29

**A latent defect in 3.1 part 1's model, fixed before the panel could call it.** Found in review of
the shipped `goal-plan-model.ts`; it had no live consumer, which is the only reason it had not bitten.

**The defect.** `seedBlockRows` does kg → `weightFromKg` → `roundTo(_, 2)` → string; `toPhasesBody`
does string → `weightToKg` → kg. **That round trip is lossy**, and `buildWrites` emits the WHOLE
chain whenever anything changes, so renaming one block sent a drifted rate for every row:

```
-0.6 kg → "-1.32" lb/wk → -0.5986394557823129 kg
```

Downstream, all three verified at `file:line`:

- `carryDailyTargets` (`client-phases-service.ts:117`) compares `existing.ratePerWeekKg === next.ratePerWeekKg` → false → `daily_targets` set to **NULL on every block**;
- `computePhasesFingerprint` (`phase-fingerprint.ts:48`) hashes the rate → the hash moves → `nutritionStale` goes true → **3.6's "Nutrition is out of date" row would fire on a pure rename**;
- with the grids nulled, task 2.5's per-date resolver has nothing to resolve to at step 2, so every in-block date falls back to the plan grid — the flattening 2.5 exists to prevent.

It contradicted two things this workstream wrote down deliberately: Task 2.3's STATUS (*"A grid
survives a rename and nothing else"*) and `phase-fingerprint.ts`'s own docstring (*"`name` is
deliberately NOT an input… it must not mark the plan stale"*).

**NOT an lbs-only defect — the loss has two independent causes.** `weightToKg`'s 2.205 divisor, AND
`roundTo`'s 2dp truncation, **which runs in the kg branch too**: a stored `-0.625` seeds as `"-0.62"`
and re-emits `-0.62`. Measured across all 1001 2dp values in ±5.00: every non-zero lbs rate drifts
(only `0` survives).

**Precisely how a kg client acquires a >2dp rate — two real paths, neither hypothetical.** A pure-kg
client's own saves stay at 2dp (`weightToKg(x,"kg")` is identity), so the trigger is a **unit
switch** onto a rate that was authored in lbs:
- **client-side** — `PATCH /api/client/settings` takes `unitPreference` (`updateSettingsSchema`,
  `lib/validations/client.ts:107-112`), and `updateClientSettings` **derives** `weight_unit` from it
  at `services/client-service.ts:377` (`metric → "kg"`). *(`weight_unit` is not itself a field on
  that schema — the earlier framing of this path said it was.)*
- **coach-side** — `PATCH /api/clients/[id]` takes `weightUnit` directly
  (`updateClientSchema:65` → `client-service.ts:231`).

The panel reads its unit from `client.weightUnit` (`mapClientRow`, `lib/mappers.ts:74`, default
`"lbs"`). So: an lbs client saves `"-1.32"`, storing `-0.5986…`; either path flips them to kg; the
panel seeds `"-0.6"`; the next rename writes `-0.6`. Plus hand-written rows.

**Why the suite missed it.** `buildWrites`' rename test (`goal-plan-model.test.ts:377`) ran
`unit:"kg"` only, where the conversion is identity — and with `seededValues()`'s clean `-0.5`, the
2dp truncation was a no-op too, so **both** halves of the loss were invisible. The `toPhasesBody`
test at `:318` pinned the drift with `toBeCloseTo(-0.499, 3)`, accepting it rather than tracing it
downstream.

**The fix.** New private `seededDisplayRate(phase, unit)` — one home for the 2dp expression, so the
seed and the lookup cannot drift on what "unchanged" means. New private `rateToKg`: for a row whose
id matches a stored block **and** whose rate field still holds its seeded value, emit
`existing.ratePerWeekKg` **verbatim**; otherwise convert as before. `toPhasesBody` gains `stored:
ClientPhase[]`; `buildWrites` passes `phases` to both its calls.

Two deliberate choices, owner-approved:
1. **`stored` is REQUIRED, not defaulted.** A default would let a future call site silently take the
   lossy path. `toPhasesBody` had exactly one non-test caller, so it cost nothing.
2. **The comparison is on the parsed NUMBER, not the raw string.** `parseNumber` trims, so `" -1.32 "`
   and `"-1.320"` are the same rate but different strings; treating those as edits would reintroduce
   the bug on a no-op keystroke. Any genuine change at 2dp display precision yields a different
   number, so nothing is missed. An empty field parses to `0` and can only match a stored `0` block,
   where both branches return `0`.

**Stable, not drift-accumulating — measured.** Across all 1001 2dp values in ±5.00 lb/wk, save →
reopen always reseeds the identical display string, so the lookup matches forever and the stored kg
is preserved byte-for-byte through any number of non-rate edits.

**The fix does not over-preserve.** `carryDailyTargets` compares dates as well as rate, so changing
block 1's length still shifts block 2's dates and correctly clears block 2's grid. Only a genuine
no-op on all three fields preserves it — exactly the invariant `ARCHITECTURE.md` states.

**`deleteClientPhase` is unaffected and needs no change.** `client-phases-service.ts:277` re-chains
from `ratePerWeekKg: p.ratePerWeekKg` — the stored kg, read straight back from the row and never
round-tripped through a display unit. The delete path cannot drift, so the fix deliberately does not
reach it.

**Tests (4), each mutation-proven.** Reported failing output against unmodified source before the fix:
`-0.4988662131519275` vs `-0.5`, `-0.5986394557823129` vs `-0.6`, and `-0.62` vs `-0.625`.

| Test | Guards |
|---|---|
| `buildWrites` rename-only, `unit:"lbs"`, stored `-0.6` → `toBe(-0.6)` | the conversion half |
| `buildWrites` rename-only, `unit:"kg"`, stored `-0.625` → `toBe(-0.625)` | the `roundTo` half — **the half that would otherwise stay unpinned**, since a unit-specific patch would pass every lbs test |
| `toPhasesBody` with a matched stored row → `toBe(-0.5)` | the seed↔lookup drift |
| `toPhasesBody` with a **changed** rate still re-converts (`≈ -0.998`, `not.toBe(-0.5)`) | a mutant that always returns the stored value |

Assertions are `toBe`, never `toBeCloseTo`: the consumers compare with `===` and hash the number, so
approximate is the wrong kind of assertion here. Mutation A (always re-convert) kills 3; mutation B
(drop the rate comparison) kills the fourth. **File restored from a pre-mutation `cp` baseline and
`diff`ed byte-for-byte afterwards** — a claimed revert is not a revert (Task 2.7's STATUS).

**Doc updated — not a §3 collision.** `ARCHITECTURE.md`'s `client_phases` bullet states the correct
invariant and was never false; the browser path simply did not honour it. What was recorded nowhere
is the **rule for a browser client**, so the `daily_targets` bullet gains it: an untouched rate must
be resent as the stored kg, byte-for-byte, with the failure chain and the reason raising display
precision cannot fix it.

**RECORDED, NOT FIXED — two silent coercions in `parseBlockRows`, both for commit 2's form.** Its
fallbacks are correct for the LIVE PREVIEW they were written for (a half-typed field must not make
the preview jump), but the same function feeds `toPhasesBody`, so each one silently changes what is
**written**:
- **`:112` `Math.round(weeks)`** — `"2.5"` previews *and saves* as 3 weeks. It does **not** 400:
  `Math.round` produces an int before `phaseInputSchema.weeks.int()` ever sees it, so there is no
  error to surface. Worse in kind than a rejection.
- **`:113` `rate ?? 0`** — clearing the rate field silently prescribes **maintenance**. Invariant 5
  makes a `0` block explicit maintenance, so this writes a real coaching decision the coach never
  made.

Both are the form's to fix, by constraining the inputs (integer weeks; a **required** rate rather
than a coerced empty field) so neither value can reach the payload — not by loosening
`parseBlockRows`, whose preview fallbacks stay right.

**Gates:** `tsc` clean · `eslint` **0 errors** (210 pre-existing warnings, unchanged, none in touched
files) · `vitest` **241 files, 2580 tests** (241/2576 at the 3A part-1 close — +4, exactly the four
added; the known-flaky `set-tracker.test.tsx` passed) · `check:labels` OK, 632 files · no `as any`,
no leftover markers, no `console.log`.

**§2 security/load/performance review — arguable trigger, so run rather than claimed N/A.** No new
route, table, column, migration, write path, or auth/ownership/validation change; 2 code files,
~90 lines, none of it in a request path. It changes the *payload* of an existing authorized write and
strictly **reduces** downstream write volume — no spuriously nulled grids, so no spurious plan
regeneration. Nothing else applies.

---

### 3A commit 2 — Task 3.1 part 2: the Goal & plan panel ✅ SHIPPED 2026-07-30

**Task 3.1 is complete.** The Overview's status card opens a 780px right Sheet with a Destination
section (start date, target weight, deadline ⇄ rate, goal body fat) and an optional Route section
(the block list). New: `use-goal-plan-form.ts`, `goal-plan-sheet.tsx`, `block-row.tsx` (+ a sheet
test); edited: `goal-plan-model.ts`, `client-status-card.tsx`, `client-overview-tab.tsx` and both
their tests. **The `/api/clients/[id]/phases` route now has its first UI caller.**

#### Decisions taken

- **The goal write is NOT gated on a target weight** (the review's option B). It was, and that made
  a weight-less client's start date unwritable: blocks saved, `goal_start_date` never did, and the
  self-heal could not fire because it lived inside the same gate — so `resolveEffectiveGoal()
  .startDate` fell back to today permanently. A null goal weight means **maintenance** by design and
  a block carries no target weight (invariant 4), so maintenance-plus-blocks is a configuration the
  panel must be able to save. `updateGoalsSchema.goalWeight` is `.optional()` and the schema needs
  only one field, so the API already allowed it.
- **An empty weight field is not a change, and is closed at BOTH layers.** `goalWeight` is
  `.optional()` but deliberately **not** `.nullable()`, so a stored weight cannot be cleared through
  this route at all. `buildWrites` therefore **omits** the key rather than nulling it, and guards the
  diff with `goalWeight != null &&` — without that guard an empty field reads as changed against a
  stored 76 and mints a goal version on **every block edit**, which is invariant 7 broken by the very
  gate meant to protect it. The form independently refuses to empty a stored weight
  (`makeGoalPlanFormSchema(unit, requireGoalWeight)`), so the coach gets a message instead of a
  silent no-op.
- **Save is enabled on OUTSTANDING WRITES, never on `isDirty`.** A pristine form whose stored
  `goal_start_date` disagrees with `phases[0].startsOn` still has a goal write to make — that *is*
  the self-heal — and `isDirty` would disable exactly that save. `isDirty` is still tracked
  separately, for the delete-while-dirty rule.
- **Delete renders only for UNSAVED rows** (`values.blocks[index]?.id ? undefined : remove(index)`).
  A persisted row's delete needs the confirm dialog, which is Task 3.2 — until then it is not
  offered, so no destructive action ships without its confirm.
- **The rate bound is validated in kg, not display units.** `MAX_ABS_RATE_KG_PER_WEEK` is 5 **kg**/wk
  = 11.02 lb/wk; a flat ±5 display bound would reject a legitimate 8 lb/wk. The message carries the
  display-unit maximum.
- **Fractional weeks are refused at the form, not rounded.** `parseBlockRows`' `Math.round` is right
  for the live preview it was written for, but it runs *before* zod, so `.int()` never fires and
  "2.5" would silently save as 3.

#### Traps that leave no trace in code

- **The reset is keyed on OPEN, and reads the records through a ref.** Keying it on `goal`/`phases`
  is the obvious thing and it is wrong: `data?.phases` is a fresh array identity on every SWR
  revalidation, so any other consumer of the `/goals` key writing would wipe a coach's in-progress
  edits mid-typing. The ref keeps the seed current without making the reset reactive.
- **Both invalidators fire even when the goal write failed**, because a failed goal write still means
  the blocks moved.

#### Owed

Task **3.2** (delete-a-block confirm + `deleteClientPhase`'s first-block anchor test), the **drawer
relink** with its nested-Sheet check, and the **browser smoke** — which has never run: no dev server
has been started against this work, and `client_phases` is still empty, so the panel remains this
database's first-ever writer of it.
