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
| **3** | Coach UI + "Waiting on you" + client-portal goal (3.9) | none | Yes — the whole feature | ⬜ Not started |

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

*Sessions append here at commit time. Do not delete this section — it is how each session inherits the previous one's decisions.*

---

### Task 1.1 — Goal-merge presence fix ✅ SHIPPED 2026-07-28

**What shipped.** `services/client-goals-service.ts` `updateGoals`: `has()` is now
`hasOwnProperty(goals, key) && goals[key] !== undefined`. Three new tests in
`services/client-goals-service.test.ts`, each verified to FAIL against the unfixed service
and pass with it (the 10 pre-existing tests pass in both directions).

**Two corrections to this document's own Task 1.1 text — Session 2 should trust these, not §1.1:**

1. **`:124` is wrong about the divergence, and the truth is worse.** It says *"the mirror keeps
   the old weight, `client_goals` goes NULL."* Both stores lost it, in the same request:
   `metrics/route.ts:184-188` writes the guarded mirror update, then `updateGoals` at `:218`
   overwrites `clients.goal_weight` unconditionally from `merged`
   (`client-goals-service.ts:115-123`). There was no surviving copy to reconcile from. Same
   sequence via `client-service.ts:229-234` → `:269`. A test now pins the mirror payload.
2. **`:123` says "four callers"; only THREE can clobber.** `services/client-service.ts:100-103`
   sits inside `createClient` immediately after the INSERT at `:67-71`, so `getCurrentGoals`
   (`:56`) returns null and both merge branches yield `null` — vacuous, not a live site. The
   three live sites are `metrics/route.ts:218-221`, `client-service.ts:269-272` (`updateClient`),
   and `intake-review-service.ts:215-219`. `app/api/clients/[id]/goals/route.ts:94` is safe:
   verified empirically that zod 3.25.76 strips absent optional keys from `.safeParse` output,
   and an explicit `undefined` cannot arrive over JSON.

**Reachability.** Not theoretical — `hooks/use-client-metrics.ts:65-75` builds a single-field
body per PUT, so editing goal body fat alone reproduced it every time.

**DEVIATION — the `notes` carry-forward at `:128` was NOT implemented** (owner decision,
2026-07-28). The premise (*"`notes` is silently NULLed on every goal edit"*) does not hold:
`client_goals` is a superseding table, so the prior row keeps its `notes` and the new row simply
never had any — nothing is nulled and there is no data loss to fix. Carrying it forward would
have been actively wrong: `notes` is per-row provenance, sibling to `set_by`, which *is*
re-stamped per row (`:103`); no caller can set or clear it (absent from both the `goals` param
type and `updateGoalsSchema`), so it would be an unclearable ratchet propagating migration
060's backfill string onto every future version; and it is observable at the API boundary via
`GET /api/clients/[id]/goals?history=true`. **Do not reinstate this in Session 2.**

**Doc updated in the same commit (class (b) stale):**
`docs/OVERVIEW-REDESIGN-EXECUTION-PLAN.md:325` — its *"Any caller that edits one goal must send
both… Worth a separate fix"* landmine note. Both clauses are now false.

**Deliberately NOT changed, carried to Session 2 — `updateGoals` is non-transactional.**
It supersedes at `:59-72` then inserts at `:98-107` with no transaction; a failed insert leaves
the client with **zero active goals**, and all four callers swallow the error. Task 1.3 moves the
coach Overview onto that store and a null goal weight reads as *maintenance* to the calculator,
so the blast radius grows this session. Deferred because the honest fix is an RPC — a migration,
and Session 1 has none by design — and an app-side compensating restore would add a *second*
non-atomic write that can itself fail.

**Known imprecision left alone:** `lib/validations/client-goals.ts:6-19` still calls this a
"presence-based merge". Its substantive claims stay true (explicit null clears; an omitted
weight carries forward — the fix makes the latter *more* true), so the file was not touched.

**Gates:** `tsc` · `eslint` · `vitest` · `check:labels` · no `as any` · no leftover markers.
Session baseline for comparison: 229/230 files, 2319/2320 tests, the one failure being the
known-flaky `components/client-portal/training/set-tracker.test.tsx`.

---

### Task 1.2 — Cascade takes a date SET, not a floor ✅ SHIPPED 2026-07-28

**What shipped.** `regenerateFutureNutritionEvents` and `cascadeNutritionAfterTrainingChange`
take a `NutritionRegenScope` (`{kind:"dates"}` | `{kind:"from", from, to?}`) instead of a start
date. `generateNutritionEvents` takes a date LIST instead of `(startDate, endDate)`. New pure
helper `expandDateRange` in `lib/date-helpers.ts` (UTC-anchored via `addDaysToDateString`; no
such helper existed and three sites hand-rolled the loop).

All three defects closed: the DELETE is bounded by the **same** range the regenerate uses; the
empty-scope bail happens **before** any write (was: delete, then bail); and the narrow paths
issue no DELETE at all, so their dates never lose their row.

**The doc's route table was wrong in three ways — Session 2 should use this list:**
- There are **12 cascade invocations, not 8**. `place-from-library` cascades three times through
  a local wrapper, and `[planId]/sessions/[sessionId]` cascades from both PUT and PATCH.
- `place-from-library`'s **session-drop branch is narrow** (one `targetDate`), though the table
  files all of `place-from-library` under "the placement window (wide)".
- `[planId]/sessions/[sessionId]` DELETE **does not cascade at all**. Recorded as fact; not
  changed here.

**Three services now report their affected dates** (they previously returned a count, or void):
`deleteEvent` → `{date}`; `updateSurplusForFutureEvents` → `string[]`; `replaceSessionFull` →
`surplusAffectedDates`. Plus `cancelFutureEventsForPlan` → `{lastDate}` via `.delete().select("date")`,
same round trip.

**ADDITION beyond the doc's Task 1.2 text, approved by the owner 2026-07-28:** the `to?` half of
`{kind:"from"}`, threaded by the two plan-deletion routes. This is the second half of the doc's
own sentence at `:142` (*"or an explicit `[from, to]` range"*). Without it those days keep a
stale training-day surplus forever, because nothing revisits them.
**`training_plans.effective_until` is NOT the source for that end** — it stays NULL on placed
plans (migration `114:96`; `services/training-service.ts:67`), so reading it would silently
collapse the range to the default horizon on exactly the long plans that need it. The honest
source is the events `cancelFutureEventsForPlan` just deleted.

**ACCEPTED COST:** this widens the regenerate on a long deleted plan (~140 days for a 20-week
program). It is the one place this session makes a write *bigger* rather than smaller — one
bounded upsert on a rare, explicitly destructive coach action.

**DEFERRED — the amendment stays on plain `{kind:"from"}`.** `plan-amendment-service.ts:345`
**already computes `windowEnd`**, so Session 2 can pick this up cheaply; it is not returned
today and threading it through the amendment writer is materially heavier than the two deletion
routes. Its rewrite also re-lays events across the window, so survivors past the horizon are not
stale the way a deleted plan's are.

**A smoke assertion that would have proved nothing, corrected:** `nutrition_events.updated_at` is
`DEFAULT NOW()` (`supabase/migrations/077:21`) with **no trigger on the table**, and the upsert
payload omits the column. A default fires on INSERT, not on the UPDATE half of an upsert — so
under the new no-DELETE narrow path, an over-wide cascade rewrites its neighbours with
`updated_at` frozen and any "did updated_at move?" check passes anyway. The real assertion is
the upserted date list (`upsert.mock.calls[0][0].map(r => r.date)`), plus "no `.delete()` issued"
and "`from("nutrition_events")` called exactly twice". For a live check, sentinel a column the
generator actually writes (set `baseline_calories = 1` on two neighbours) — `note`/`is_modified`
survive any write and prove nothing.

**Not changed, deliberately:** the horizon stays `from + 56d` (invariant 10's
`max(today+8w, last block end)` is Session 2's); the vestigial `trainingPlan` param on
`generateNutritionEvents`; and `calorie_surplus_percentage` population on every training
event-write path.

**Behaviour change to expect:** rows past the horizon are no longer deleted. Previously they were
deleted and never regenerated, so the day read as "no target" — and that null is snapshotted
permanently into `nutrition_logs` (`services/daily-log-card-service.ts:79-99`) and drops the day
from the weekly denominator (`services/weekly-nutrition-service.ts:65-81`). Stale beats absent.

**Docs updated (class (b) stale):** `docs/ARCHITECTURE.md` "Training → Nutrition cascade"
(per-route anchor threading → scopes, the 12 call sites, the `effective_until` trap), the
`is_modified`/status protection bullet, and the event-lifecycle "Cascaded" line.

**Gates:** all six green. 231/231 files, 2338/2338 tests (baseline 2320 → +3 from 1.1 → +15 here).

---

### Task 1.3 — Overview reads `client_goals`, not the mirror ✅ SHIPPED 2026-07-28

**What shipped.** New `hooks/use-client-goals.ts` (key builder + `useClientGoals` +
`useInvalidateClientGoals`, co-located per CONVENTIONS §7). `client-overview-tab.tsx` reads it,
resolves through `resolveEffectiveGoal` with `today: getTodayDateStringInTimezone(client.timezone)`
(the goal's dates are on the *client's* calendar — same anchor as `comparison-service.ts:70`),
converts kg→display with `weightFromKg`, and passes the targets down.
`ClientStatusCard` takes them as props and no longer reads `client.goalWeight` /
`client.goalBodyFatPercentage` — it stays presentational, with no fetch of its own.

**`client-goal-editor.tsx` moved onto the hook too.** It was building the same `/goals` key
inline and calling its own `mutate` on save — which reaches only itself, so the Overview's chips
would have gone stale after every goal edit. §7's never-build-a-key-inline rule applies to
"new and touched code", and this file is touched. It now calls `useInvalidateClientGoals`.

**Loading state threaded** (`isGoalLoading`). Without it the card cannot tell "no goal set" from
"not loaded yet" and renders a confident em-dash it then contradicts — the trap
`ARCHITECTURE.md` already records for `CoachNotesCard` and the check-in timing strip.

**Tests:** the six goal-chip cases moved from `client.goalWeight` to the new props (a test that
kept setting the mirror would have silently asserted nothing), plus two new cases — the card
**ignores the mirror** (client carries `goalWeight: 99`, nothing renders) and claims nothing
while loading.

**Discovered while tracing — `clients.goal_deadline` is not reachable at all.** *(CORRECTED
2026-07-29 in Task 2.8a: the mapped PROPERTY is unreachable, but the COLUMN is not — it is selected
raw at `services/intake-review-service.ts:114` and used as a backfill guard at `:156-163`. Migration
139 therefore keeps writing all three mirror columns. The paragraph below is right about the
property and wrong about the column.)* `mapClientRow`
(`lib/mappers.ts:72-73`) maps only `goalWeight` and `goalBodyFatPercentage`; the `goalDeadline`
mapping at `:213` is `mapClientIntakeRow`, a different table. So `client.goalDeadline` is
**always `undefined`**, and every `?? client.goalDeadline ?? null` fallback in the four
`resolveEffectiveGoal` call sites is dead code. Session 2 must not "fix" this by adding it to
the mapper — the mirror is the thing being retired.

**Scope boundary — the CLIENT PORTAL keeps the mirror, deliberately** (exec plan §1.3, §6, §7).
`services/client-portal-progress.ts:139-140,268-269` and `services/client-portal-service.ts:44`
→ `components/client-portal/metrics/goals-section.tsx`. `/api/client/**` has no goal endpoint at
all and client-facing blocks are post-launch. `mapClientRow` was **not** touched — the portal
shares it via `toClientSelfView` (`lib/mappers.ts:135`).

**NEW DIVERGENCE, recorded so Session 2 does not rediscover it.** The coach Overview now reads
`client_goals` while **`hooks/use-nutrition-plan.ts:143-148` and
`hooks/use-nutrition-builder.ts:224-231` still compute goal estimates from `client.goalWeight`**,
with no `client_goals` fallback at all. Two coach surfaces, two sources. Out of 1.3's scope
(the Overview's goal surface), but it is now a real inconsistency rather than a uniform one.
`components/clients/metrics/hooks/use-merged-metrics.ts:61-65` also still builds a `/goals` key
inline — that file was not touched, so §7's known gap stands; the new hook gives it a home.

**Raised in blast radius by this task, still deferred (from 1.1's STATUS):** `updateGoals` is
non-transactional, so a failed insert leaves zero active goals — which now reads as
*maintenance* on the Overview as well as to the calculator. Unchanged reasoning: the honest fix
is an RPC, and Session 1 has no migrations.

**Docs updated:** `docs/ARCHITECTURE.md` "Effective goal resolution" (Overview added to the
caller list, the coach-vs-portal split, the unreachable `goal_deadline`) and the Overview's
goal-chips bullet.

**Gates:** all six green. 231/231 files, 2340/2340 tests.

**Owed:** the browser smoke (Overview chips render from `client_goals`; a save in the goal
editor refreshes the Overview without a reload).

---

### Task 1.4 — Rate-first calculator + two-way target ⇄ rate ✅ SHIPPED 2026-07-28

**What shipped.** New pure `lib/goals/goal-rate.ts`: `getRateSafety`, `capWeeklyRate`,
`applyCalorieFloor`, `dailyCalorieDeltaFromRate` / `rateFromDailyCalorieDelta` /
`dailyCalorieMagnitudeFromRate`, `daysToDeadline`, `deriveRateFromTarget`,
`deriveDeadlineFromRate`, and the rate-first entry point `calculateBaselineCaloriesFromRate`.
`CALORIES_PER_KG = 7700` moved to `lib/constants.ts`. `calculateBaselineCalories` now **calls**
the extracted cap and floor rather than carrying its own copies, so the two directions cannot
drift on what counts as safe.

**DECISION — no stored rate column** (the doc's explicit question at `:177`). Verified:
`rate_per_week` appears in no migration and nowhere in `types/database.ts`; `nutrition_plans`
does not even persist the computed `weeklyWeightChangeKg`. No reader needs one, and storing a
rate beside target + deadline lets all three disagree — the same over-determination argument
that removed the block type enum. Blocks store their rate on `client_phases` in Session 2
(invariant 4); that is a different table and not affected by this.

**The golden matrix was captured from the OLD code, before the body was touched.**
`services/nutrition-service.caps-floor.test.ts` was generated by *running* the unmodified
`calculateBaselineCalories` across 24 input combinations and pasting the actual return values —
not by re-deriving expectations from the new code, which would have proved nothing. It ran green
against untouched code first (26 tests), then again after the substitution. That ordering is the
whole evidence: `services/nutrition-service.test.ts` is 75 lines covering ONLY start-date
clamping, so the entire cap branch could have been deleted without failing anything.
Matrix covers both genders + `"other"` + an unset cast, loss and gain, under/at/over each of the
four cap boundaries, unfloored/floored/both, and both maintenance early-returns. Warning strings
are asserted verbatim — they are coach-visible (`nutrition-warnings.tsx` renders them raw), so a
reworded warning is a product change, not a refactor.

**Two boundary facts the matrix surfaced:**
- A rate sitting **exactly on** a cap is NOT capped (`< -max` is strict) — but at TDEE 2500 the
  resulting target trips the floor instead, so the boundary behaves unlike either neighbour.
- **The floor leaves the rate stale.** `calculateBaselineCalories` returns a pre-floor
  `weeklyRate` and `requiredDailyDeficit` beside a post-floor `baselineCalories`, so a floored
  result advertises a deficit it will not run (TDEE 1700 → target 1500 = 200/day, against a
  reported −0.3846 kg/wk ≈ 423/day). **Pinned, not fixed** — it feeds the coach's live plan
  response, and changing it moves numbers this workstream was not asked to move. The rate-first
  function reports `appliedRateKgPerWeek` (re-derived from the target actually returned) instead.

**DEVIATION from the doc's "reuse the calculator's date convention" (`:179-180`).**
`goal-rate.ts` preserves the *semantics* — future start counts from the start, inclusive day
count — but expresses them in **day numbers** (`dateStringToDayNumber`) and emits via
`addDaysToDateString`, rather than copying `nutrition-service.ts:96-102`. Measured, transcribing
those lines verbatim for `today=2026-01-05`, `deadline=2026-04-05`:

| TZ | offset | transcribed | true |
|---|---|---|---|
| UTC / Los_Angeles / São_Paulo / Kolkata | 0, −8, −3, +5:30 | 91 | 91 ✓ |
| Pacific/Auckland (NZDT) | +13 | **92** | 91 ✗ |
| Pacific/Kiritimati | +14 | **92** | 91 ✗ |
| Pacific/Auckland (NZST, July) | **+12 exactly** | **94** | 93 ✗ |

`today` is parsed as LOCAL midnight while the deadline (a bare `DATE` from PostgREST) parses as
UTC midnight; `Math.round` absorbs the offset only below ±12h, and at exactly +12 the fraction is
0.5 and rounds up. Both current callers are server-side where Node runs UTC, so this is
**latent, not live** — but Session 3 renders the two-way widget in the coach's browser, which
would make it live for every coach at ≥+12, silently and in the direction of "too slow".
**`services/nutrition-service.ts:96-102` itself is unchanged** (the doc marks it "already true,
do not rebuild"); the deviation is only that the new module does not copy it.
`goal-rate.test.ts` pins both: day counts and emitted date strings identical across six zones,
plus two named cases asserting the transcription's 92 and 94 against the correct 91 and 93.

**`today` is a required parameter, no `new Date()` fallback.** The one at
`nutrition-service.ts:93-95` would, in a browser, substitute the *coach's device date* for the
*client's calendar date* (ARCHITECTURE → Timezone model). Precedent: `resolve-effective-goal.ts`.

**Deliberately NOT unified:** the two competing "safe rate" definitions —
`nutrition-service`'s absolute-kg-by-gender clamp vs `lib/check-in/goal-pace.ts:13`'s advisory
1%-of-bodyweight 3-state classifier. They share no page and no component; unifying them is a
product decision for Session 2/3, not a refactor.

**Unset `gender` takes the male cap and floor.** Preserved exactly, now with a named test rather
than an implicit ternary. Exec plan §7 leaves surface-or-accept to Session 2.

**Docs:** `docs/ARCHITECTURE.md` gains a "Goal rate arithmetic" section under Client Goals.

**Gates:** all six green. 233/233 files, 2410/2410 tests.

---

### Session 1 verification — browser smoke ✅ PASSED 2026-07-29

Discharges the §"Session 1 verification" browser smoke **and** the smoke left **Owed** by Task 1.3.
Run against `next dev` + the live dev DB, coach role, fixture **Samuel James**
(`ed5cb82c-30ea-488d-96d8-eb34e8ae09fa`) — the only client with both future scheduled training
events and nutrition events. *(Chloe Martin also qualifies; Samuel James was picked arbitrarily.)*

**1.2 — cascade stays narrow. PASSED.** `Push Day` dragged `2026-08-06` → `2026-08-07` in the
real coach calendar ("Session moved" toast, real write), then dragged back.

| date | role | `is_training_day` | `training_burn_calories` | `baseline_calories` |
|---|---|---|---|---|
| 08-05 | sentinel (before) | false | 0 | **1 → 1** |
| 08-06 | moved **from** | true → **false** | 385 → **0** | 2567 |
| 08-07 | moved **to** | false → **true** | 0 → **385** | 2567 |
| 08-10 | sentinel (after) | true | 385 | **1 → 1** |
| 08-20 | sentinel (after) | true | 385 | **1 → 1** |

Both endpoints re-derived; **neither sentinel moved**, across both the move and the move-back
(four cascaded dates). `08-10`/`08-20` are the discriminating pair — they sit *after* the moved
dates, so the pre-1.2 floor cascade (`from 08-06` through the 56-day horizon) would have
regenerated both back to 2567.

**The `updated_at` trap is confirmed LIVE, not just by reading the migration.** `08-06` and
`08-07` were definitely rewritten — their values flipped — and `updated_at` still reads
`2026-07-27T20:42:07.820959+00:00`, byte-identical to every untouched row in the window. **An
`updated_at` assertion would have passed whether the cascade wrote 2 days or 56.** Use the
sentinel: set `baseline_calories = 1` on days the generator would overwrite. Do not substitute
`note`/`is_modified` — they survive any write (1.2's STATUS already says so; this is the live
confirmation).

**1.3 — Overview reads the real goal. PASSED.** Samuel James carries a genuine divergence:
`client_goals` = 90 kg / 9 % (`superseded_at: null`), `clients` mirror = **77 kg / 33 %**. The
Overview renders **90.0kg / 9.0%** with "Goal reached". The mirror's values appear nowhere.
`GET /api/clients/[id]/goals` returns the same row. This is the strongest available form of the
test — the two stores disagree, so a mirror read could not have coincidentally looked right.

**Left alone, pre-existing, NOT caused by Session 1** — `training_burn_calories` does not track
`is_training_day`: `2026-08-09 Sun` is a rest day carrying `burn = 770`, and `2026-08-01 Sat` is
a training day carrying `burn = 0`. The narrow cascade correctly did not touch either (both are
outside every date set exercised), so this is residue from the pre-1.2 floor cascade that only a
regeneration reaching those dates will clear. Session 2 should expect to see it and not read it
as a new defect.

**Unconfirmed, recorded rather than claimed.** On the session's first cold page load the status
card showed `Not recorded` for both goal chips while the rest of the card was also unpopulated
("No plan" where the real plan later rendered). Twelve samples at 250 ms over a warm cache never
reproduced it, so it is plausibly a cold-start flash rather than the `isGoalLoading` gap 1.3
closed — but it was **not** reproduced and is **not** proven absent. Worth one deliberate
cold-load check in Session 3 when the two-way widget lands on that surface.

**Harness facts for whoever smokes the calendar next.** The drag is gated on **edit mode**
(`calendar-event-card.tsx` → `useDraggable({ disabled: !editMode || !isFutureScheduled })`);
until the divider's pencil is clicked, zero draggables mount and every synthetic drag silently
no-ops with no overlay and no aria-live. Verify with
`document.querySelectorAll('[aria-describedby^="DndDescribedBy"]').length` (22 here, = the
future-scheduled count). And never `await` inside the drag `Runtime.evaluate` — a move loop with
`await setTimeout` hangs the full 45 s CDP timeout and the drop never lands; dispatch each
`pointermove` burst synchronously and let the tool-call round-trip be the delay that lets React
render the overlay and measure droppables. Droppable ids are date strings, so aria-live reads
`…moved over droppable area 2026-08-07.` — that is the reliable pre-drop target check, and it
lags one call behind the moves.

**No migrations. No code changed. DB restored** to the pre-smoke baseline (session moved back,
sentinels reset to 2567) and re-verified row-by-row across `2026-07-29 … 2026-08-21`.

---

### Task 2.1 — Migration 137: `client_phases` ✅ SHIPPED 2026-07-29

**What shipped.** `supabase/migrations/137_create_client_phases.sql` + regenerated
`types/database.ts`. Applied via `npx supabase db push` (owner-run) and verified against a fresh
`supabase db dump --linked`, not against the push exiting 0.

Columns: `id`, `client_id` (FK CASCADE), `name`, `starts_on`/`ends_on` (DATE), `rate_per_week_kg`
(NUMERIC NOT NULL), `daily_targets` (JSONB NULL), `created_at`/`updated_at`. One index
`idx_client_phases_client_starts (client_id, starts_on)`. RLS enabled with **no policies**,
`GRANT ALL … TO service_role`.

**DEVIATIONS from this document's Task 2.1 sketch, all evidence-driven:**

1. **No `IF NOT EXISTS` on the CREATE.** `CONVENTIONS.md:363`'s snippet uses it, but its actual
   prescriptions are ENABLE RLS / no policies / GRANT service_role — `IF NOT EXISTS` is incidental
   to the illustration. The two most recent new-table migrations (`132:18`, `134:11`) both use the
   bare form. Matched them. Class **(b)**: the doc snippet is illustrative, not prescriptive.
2. **Header comment block, no `COMMENT ON TABLE`.** Migration 122 was the wrong precedent — it
   creates nothing and annotates five *pre-existing* tables. 132 and 134 document with a leading
   `--` block and emit zero `COMMENT ON TABLE`.
3. **`is_training_day` is NOT in `daily_targets`.** A weekday-keyed field cannot represent a
   per-DATE fact. The only reader in the repo (`utils/build-daily-targets.ts:129-131`) is dead on
   both production paths (both callers pass `trainingEvents`), the only writer hardcodes `false`
   on all 7 rows (`nutrition-plan-service.ts:58,:82`), and the event's real flag is derived from
   live training events (`nutrition-event-service.ts:116-117`). **Grid shape is five keys:**
   `[{day_of_week, calories, protein_g, carb_g, fat_g}] × 7`. This is deliberately the *read
   subset* `generateNutritionEvents` consumes, NOT the RPC's `p_daily_targets` write shape (which
   still requires `is_training_day` for a NOT NULL column).
4. **Only ONE value CHECK, plus a cardinality CHECK.** Dropped the proposed `name` and rate CHECKs:
   migration `131:5-10` states the house rule — coach input is validated in zod "at the route
   layer", and a CHECK is added only for server-derived values or table parity. Reinforced by a
   measurement: **`23514` has ZERO hits repo-wide** (vs `23505`, handled in four production files),
   so a CHECK violation reaches a coach as raw Postgres text through a generic
   `throw new Error(...: ${error.message})`. `ends_on >= starts_on` and the grid cardinality are
   server-derived and can only fire on a service bug — 132's posture.
5. **The cardinality CHECK guards `jsonb_typeof` first.** A bare `jsonb_array_length` on a
   non-array raises `22023 cannot get array length of a non-array` rather than failing the
   constraint, so a malformed grid would surface as a different SQLSTATE from every other bad-grid
   case. It buys **cardinality only** — not seven distinct weekdays, not the right keys, not the
   right value types. The service and its tests own the rest.
6. **No `UNIQUE (client_id, starts_on)`, and the reason is NOT `CONVENTIONS §10`.** The original
   reasoning (a raw `23505` reaching a coach) does not discriminate, since CHECKs raise `23514` by
   the same mechanism and nothing translates it. The real reason: a non-deferrable unique index is
   checked **per row**, not at statement end, so Task 2.3's delete-and-shift-back — which rewrites
   several `starts_on` values whose FINAL state is unique — fails the moment one shifted row
   transiently collides with a not-yet-shifted one, in an order Postgres does not define.
   Deferrability is a property of a CONSTRAINT; a plain or partial unique INDEX can never be
   deferred. There is no safe variant. Invariant 6 already says overlaps are structurally
   impossible, so nothing is lost.

**Landmine for Task 2.3 — `updated_at` has no trigger.** 132/134 both carry
`-- updated_at is managed in app code (no trigger — matches migrations >= 100)`, and their services
stamp it explicitly (`client-notes-service.ts:91-96,:104-110`; `metric-entries-service.ts:39-52`).
The phase service **must** stamp `updated_at` on every UPDATE or it stays frozen at insert time —
the exact defect migration 096 had to fix for `exercises`. The last migration to add an
`update_updated_at_column()` trigger was **096**; do not add one now.

**Live-catalog finding — new tables are NOT privilege-free.** The dump shows
`GRANT ALL ON TABLE public.client_phases TO anon` and `TO authenticated` alongside the
`service_role` grant this migration wrote. Those two come from Supabase's stock **default
privileges**, applied automatically on `CREATE TABLE`; `client_metric_entries` and `client_notes`
carry the identical three, so 137 is consistent with precedent. **This makes `CONVENTIONS.md:361`
factually wrong** — *"a freshly created table has no Data API privileges and PostgREST cannot see it
until one is granted"* and *"Forgetting it fails loudly and immediately"* do not hold on this
project. Not exploitable (RLS is enabled with zero policies; `npm run check:rls` reports 41/41), but
the *"no privilege at all beats a filtered one"* belt the convention describes does not exist for any
new table here — RLS is the sole perimeter. Raised to the owner; the doc correction and an optional
`REVOKE … FROM anon, authenticated` are **not** taken in this commit.

**Gates:** `tsc` clean · `eslint` 0 errors (210 pre-existing `no-explicit-any` warnings, none in
touched files) · `vitest` **233/233 files, 2410/2410 tests** (identical to the Session 1 close
baseline) · `check:labels` OK · `check:rls` **41 public tables, 41 with RLS** · no `as any`, no
leftover markers. Types diff was a single additive hunk: the `client_phases` Row/Insert/Update block
plus `client_phases_client_id_fkey`, nothing else.

---

### Task 2.2 — Migration 138: `nutrition_plans.phases_fingerprint` ✅ SHIPPED 2026-07-29

**What shipped.** `supabase/migrations/138_nutrition_plan_phases_fingerprint.sql` (an `ALTER TABLE
… ADD COLUMN` and a `COMMENT ON COLUMN`, nothing else) + regenerated types +
`services/phase-fingerprint.ts` + `stampPhasesFingerprint` in `services/nutrition-plan-service.ts`.
The generated-types diff was **three lines** — Row/Insert/Update — with **no `Functions` diff at
all**, which is the direct evidence that the RPC signature was not touched.

**DECISION — `goal_source` is NOT reintroduced** (owner, 2026-07-29). §2.2 of this document said to
bring it back because "this workstream reintroduces the second scope". It does not. `069:12` fixes
the column's meaning as *"Which goal drove the calorie calculation: 'phase' or 'client'"*, and in
the removed feature a phase carried **its own goal** (`068_add_phase_goal_columns.sql` added goal
columns to `phases`). Invariant 4 (`:55`) gives a block a **rate** and explicitly no target weight,
so the plan's goal snapshot (`goal_weight_kg` + `goal_deadline` — the exact two fields
`app/api/clients/[id]/nutrition/route.ts:119` compares) still resolves from `client_goals` in every
case. The column would be a constant `'client'` again: the reason `133:20-23` dropped it. It would
also resurrect the word "phase" in a vocabulary migration 133 spent a whole file removing, while the
product word is "block". `phases_fingerprint` carries the only signal that was actually wanted.

**DECISION — the stamp is the LAST write of a generation, not an RPC argument** (owner, 2026-07-29).
This reverses an earlier position in this session and the reversal is the important part.

The first design put `phases_fingerprint` in the RPC's `DO UPDATE` bucket. Two defects, found in
review:
1. **Unconditional bucket + `DEFAULT NULL` wipes it.** A caller that omits the arg sends NULL,
   `EXCLUDED.phases_fingerprint` is NULL, and the assignment fires — erasing a stored hash. Under
   "NULL = no blocks" that reads **fresh**, so a client with three blocks and flattened numbers
   shows no warning. The *silent-miss* direction, strictly worse than the false alarm the NULL
   semantics were chosen to avoid.
2. **Even stamped correctly inside the RPC, it can lie.** `regenerateEventsOrThrow` runs **after**
   `createNutritionPlan` (`nutrition-plan-orchestrator.ts:263` custom, `:389` calculated). If event
   regeneration fails, the fingerprint asserts the current block set while the events — the only
   thing the client actually eats — are the old ones, and the Overview affirmatively reports the
   plan as current. **Reordering inside the RPC cannot fix this**: event generation needs the plan
   id the RPC returns.

Moving the stamp after `regenerateEventsOrThrow` makes the stored value mean *"every write in this
generation succeeded"*, which is only expressible if it is last. Failure matrix — every direction
lands on stale, and stale self-heals:

| Fails at | grids | plan | events | fingerprint | 3.6 reads |
|---|---|---|---|---|---|
| grids | old | old | old | old | fresh ✓ |
| RPC | new | old | old | old | **stale** ✓ |
| events | new | new | old | old | **stale** ✓ |
| stamp | new | new | new | old | **stale** — false alarm, clears on regenerate ✓ |
| none | new | new | new | new | fresh ✓ |

**What that deleted from this commit:** the DROP/CREATE at a new arity, the byte-for-byte type list,
the REVOKE/GRANT replay (`115:152`'s landmine is never touched), a `pg_proc` overload assertion, a
strict 27-key argument test, and the whole CASE-bucket question — an upsert whose insert list and
`DO UPDATE` bucket omit the column **cannot** write it, so preserve-on-omit is free. It also moved
the custom-macros rule from PL/pgSQL into TypeScript, where it is unit-testable.

**The counter-argument that was retired, recorded so it is not re-raised.** The separate UPDATE was
first rejected as "a second non-atomic write" against the RPC's "one transaction". Both halves are
false: plan creation was **already** multi-write (`:263`, `:389`), so the RPC was never the last
write of the operation the coach performed; and ordering beats atomicity whenever the failure
direction is safe, which is the same argument that put the grid write before the RPC.

**NULL semantics (owner-confirmed).** NULL means *no block set drove this generation* and covers
three cases identically: pre-138 rows, block-less clients, and custom-macros saves.
`computePhasesFingerprint([])` returns `null`, **not** a sentinel hash — a sentinel would make every
existing plan compare unequal and fire a spurious "Nutrition is out of date" row on the day Session
3 ships. Pinned by a named test.

**Custom macros ignore blocks — decided here, not inherited (owner, 2026-07-29).** `handleCustomMacros`
passes `customMacrosEnabled: true` with `recalcSnapshots: true` (`orchestrator:241,:253`) and
`nutrition-plan-service.ts:49-59` builds all 7 rows flat from `customCalories` with the calculator
never running. Stamping a real fingerprint there would assert that blocks drove numbers they did
not. Three enforcement points:
- **2.2 (here):** a custom-macros save stamps `NULL`.
- **2.5:** the resolver widens the plan select (`nutrition-event-service.ts:271-275`, currently
  `"baseline_calories, protein_target_g, diet_type"`) to include `custom_macros_enabled` and
  short-circuits blocks when true — otherwise a custom plan's in-block dates would resolve to a
  block's stale stored grid, contradicting `drawer-footer.tsx:28` (*"custom macros ARE the targets"*).
- **2.7:** `nutritionStale = !plan.custom_macros_enabled && current !== stored`, in one server-side
  place, so a coach who deliberately chose custom macros does not get a permanent nag.

**SESSION 3 CONSTRAINT — all three of those are backend.** A coach who sets three blocks and then
turns on custom macros gets flat numbers, a clean Overview and no explanation: the same failure,
displaced to the screen. **3.1's Route section and 3.3's per-block preview must both say blocks are
not driving nutrition while custom macros is on.**

**Deliberate CONVENTIONS §2 #12 disclosure.** `stampPhasesFingerprint` **swallows its error into
`captureApiError` and lets the request return 200**. §2 #12 asks for exactly this to be flagged
rather than hidden. It is the safer failure and it is only safe *because* this write is last:
throwing would 500 a coach whose plan, targets and events all committed, inviting a retry of a
successful operation, while swallowing leaves the previous fingerprint in place — a visible false
"out of date" that clears on the next regenerate. Pinned by a test asserting it resolves and reports.

**A third writer of `nutrition_plans` now exists** (previously the RPC + `archiveNutritionPlan`):
`stampPhasesFingerprint`, scoped `.eq("id", planId)`, writing `phases_fingerprint` + `updated_at`.

**Doc corrected in this commit (class (b) stale):** `docs/ARCHITECTURE.md:213` still listed
`goal_source` as a live column on `nutrition_plans`; `133:278` dropped it and `types/database.ts`
has no such field.

**Not wired yet, deliberately.** `stampPhasesFingerprint` has no caller until **Task 2.6**, which is
where the orchestrator gains its per-block calculation and the stamp goes in after
`regenerateEventsOrThrow`. Wiring it earlier would stamp a fingerprint for grids nothing had
computed.

**Gates:** `tsc` clean · `vitest` green (8 in `nutrition-plan-service.test.ts`, 9 in
`phase-fingerprint.test.ts`) · full suite run at the session gate.

---

### Task 2.3 — Phase service + `getPhaseForDate` ✅ SHIPPED 2026-07-29

**What shipped.** `lib/goals/phase-chain.ts` (pure), `lib/validations/client-phases.ts` (zod),
`services/client-phases-service.ts` (DB), plus tests for all three. No migration.

**The pure half is in `lib/goals/`, not the service — deliberately.** `chainPhases`,
`getPhaseForDate`, `isPhaseElapsed` and `lastPhaseEnd` are synchronous and browser-safe (they import
only `addDaysToDateString`), so Session 3's goal panel renders its live
"15 weeks · 4 Aug – 16 Nov" readout from the **same functions the server writes with**. The coach's
preview and the stored chain cannot disagree about where a block lands. This is the opposite call to
`services/phase-fingerprint.ts`, which is server-only because `createHash` has no browser form — the
two modules split on whether the browser can run them, not on tidiness.

**`getPhaseForDate` is list-based, not a query.** The per-date resolver (2.5) calls it once per
generated date; a DB round trip there would be a query inside a per-item loop, which CONVENTIONS §2
forbids. Callers load the blocks once and pass the array. The predicate mirrors `coversDate`
(`services/training-plan-window.ts`) but has no `IS NULL` half — a block always has an end.

**Two invariants the tests pin, because both rot silently:**

1. **A grid survives a rename and nothing else.** `carryDailyTargets` keeps `daily_targets` only
   when `startsOn`, `endsOn` **and** `ratePerWeekKg` are all unchanged; any numeric edit clears it.
   That is what makes "non-null grid" a trustworthy promise to the per-date resolver that the grid
   matches its window. Three tests (rename keeps, rate change clears, date shift clears).
2. **Elapsed protection checks the COMPUTED dates, not the submitted ones.** Because the client
   sends lengths rather than date pairs, shortening an earlier block silently drags a finished one
   backwards. Validating what `chainPhases` produces is what catches it; validating the payload
   would not.

**Elapsed rows are excluded from the write entirely**, not rewritten with identical values — so
their `updated_at` never moves and no write can touch them at all. Removing or re-dating one is a
422 naming the block.

**Write shape: two batched round trips**, one `DELETE … .in("id", removedIds)` and one
`upsert(rows, { onConflict: "id" })`. Every row carries an explicit id (`randomUUID()` for new
blocks) because a mixed insert/update upsert needs **identical keys across the array** — PostgREST
builds one INSERT with a single column list, so rows with and without `id` cannot be batched
together. Nothing loops a query per block.

**`updated_at` is stamped explicitly on every write** (`132`/`134` posture; migration 137 has no
trigger). Without it the column would freeze at insert time — the defect migration 096 had to fix
for `exercises`.

**Deletion re-chains rather than wiping** (invariant 9): blocks before the deleted one keep their
dates, blocks after it close the gap, and the service returns the resulting moves so Session 3.2's
confirm dialog can name the consequence before the coach commits.

**Caught in review of my own code:** `weeksBetween` hand-rolled `Date.UTC` arithmetic. Replaced with
the existing `dateStringToDayNumber` — the UTC-anchored helper task 1.4 pinned across six timezones.
A local-parse variant would have lost a day west of UTC.

**Bounds live in zod, not in CHECK constraints** (migration 131's rule): `MAX_PHASE_WEEKS = 52`,
`MAX_CHAIN_WEEKS = 104`, `MAX_PHASES = 12`, `MAX_ABS_RATE_KG_PER_WEEK = 5`. The rate bound is a
sanity bound and **not** the gender safety cap — invariant 12 requires storing the rate the coach
entered and surfacing the cap in the preview, so clamping here would make that impossible.
`MAX_CHAIN_WEEKS` is what bounds the 2.5 horizon's worst case (see 2.5's STATUS).

**Gates:** `tsc` clean · 33 new tests green across the three files.

---

### Task 2.8(a) — `updateGoals` becomes transactional ✅ SHIPPED 2026-07-29

**What shipped.** `supabase/migrations/139_update_client_goals_atomic.sql` + regenerated types +
`services/client-goals-service.ts` rewritten onto the RPC + the `updateGoals` test block rewritten.

**Verified against the live catalog, not the push exit code:** exactly ONE overload,
`REVOKE ALL … FROM PUBLIC`, `GRANT ALL … TO service_role`, and **no anon/authenticated grant**. The
generated `Args` shows all seven parameters **required** (no `?`), confirming no `DEFAULT NULL`
reached the signature. The `NOTICE … does not exist, skipping` during the push is the expected
first-apply no-op from the `DROP FUNCTION IF EXISTS` preamble that makes the file re-runnable.

**The hole this closes.** Supersede (`:60-64`) then insert (`:105-114`) were unsynchronised, so a
failed insert left **zero non-superseded rows** — which `getCurrentGoals` returns as null and both
the calculator and (since 1.3) the coach Overview read as *maintenance*.

**Corrected justification (owner, 2026-07-29): the reason is DATA INTEGRITY, not silence.** Session
1's STATUS said "all four callers swallow the error", and a summary in this session said "nobody
sees an error" — **both overstate it.** The goals PUT catches and returns 500
(`goals/route.ts:109-115`), and `client-goal-editor.tsx:131-146` toasts "Failed to update goals". It
is the four dual-write callers that swallow (`metrics/route.ts:215-225`, `client-service.ts:97-107`
and `:266-276`, `intake-review-service.ts:212-223`) — and each has already written the `clients`
mirror by then, so those paths diverge the two stores with no signal at all.

**The mirror UPDATE moved inside the transaction** (owner-approved behaviour change). It is not a
new write — it is the one at `:122-134`, whose error was previously only `console.error`'d while the
request returned 200. That swallow is how `client_goals` and the mirror came to hold 90 kg / 9 % and
77 kg / 33 % for fixture Samuel James. It now fails loudly rather than diverging silently.

**All three mirror columns are still written, including `goal_deadline`.** See the doc correction
below — the column has a live reader.

**No `DEFAULT NULL` parameters, and that is a deliberate exception to
`feedback_rpc_optional_params_default_null`.** That convention assumes omitted means "not supplied".
Here NULL is a **meaningful value** — it clears a goal field — so omitted and null must stay
distinguishable. The presence-merge therefore stays in TypeScript (where task 1.1's tests live) and
the RPC receives an already-merged complete row.

**Pattern B (throw), pinned by a test.** Two RPC-error conventions coexist:
`nutrition-plan-service.ts:135-138` logs and returns null; `training-service.ts:302-304` throws. Only
the throwing one preserves this path's behaviour — swallowing would turn the PUT's 500 into a 200
with a broken goal. A test now asserts the throw, and a second asserts the no-id case. Neither
existed before.

**A narrow cast, deliberately narrower than the two plan RPCs.** `supabase gen types` renders RPC
parameters as non-null (Postgres exposes no per-parameter nullability), so the generated `Args`
rejects the nulls a goal-clearing edit must send. The call casts **only** the argument object,
through a local type that mirrors the SQL: the function NAME is still checked against the generated
`Functions` map and the key set is still checked against the local type. Contrast
`nutrition-plan-service.ts:106,:133`, whose `as never` erases the name AND the whole argument object
— which is why nothing there would catch a signature change (finding Q6).

**NOT FIXED, and not claimed to be: the read-modify-write race.** `getCurrentGoals` still runs
outside the transaction, so two concurrent writers merge against the same snapshot and the later one
wins. What changed is the failure mode: the loser now trips `idx_client_goals_active_unique` INSIDE
the transaction and rolls back cleanly, instead of leaving the client with zero goals.

**Test coverage moved, not dropped.** Every merge assertion previously read the INSERT body; the
merged row now travels as the RPC's argument object, so the assertions read that instead, behind one
`rpcArgs()` helper. Task 1.1's mirror-payload test is preserved in substance: the mirror is written
inside the transaction from `p_goal_weight` / `p_goal_body_fat_percentage` / `p_goal_deadline`, so
asserting those args asserts the mirror payload. 13 tests → 15.

**Docs corrected in this commit (class (b) stale — BOTH were written by this workstream):**
`docs/ARCHITECTURE.md:88` and Task 1.3's STATUS block above both state flatly that
`clients.goal_deadline` is unreachable. The **mapped property** is (`mapClientRow` never sets it, so
the three `?? client.goalDeadline` fallbacks really are dead code) — but the **column** is read raw
by `intake-review-service.ts:114` and drives a backfill guard at `:156-163`. Dropping its write
would cause spurious re-backfills from intake.

**OWED — live verification of the RPC.** The unit tests mock `supabaseAdmin`, so they prove the
call shape, not that the function's three statements roll back together. Deferred to the
end-of-session smoke rather than run mid-session against real fixture data.

**Gates:** `tsc` clean · `vitest` 15/15 in `client-goals-service.test.ts` · full suite at the
session gate.

---

### Task 2.4 — `resolveEffectiveGoal` becomes date-aware ✅ SHIPPED 2026-07-29

**What shipped.** The resolver takes optional `phases` + `date` and returns `phaseRateKgPerWeek`
+ `phaseName`; all **six** call sites listed in §2.4 pass them. Plus `computeGoalPace` gained a
prescribed-rate input. No migration.

**Recovered from an interrupted session.** `lib/goals/resolve-effective-goal.ts` was already
modified-but-uncommitted when this session started — a prior session wrote the resolver body at
14:51 and died (ECONNRESET) before touching its test or any call site, leaving the tree red
(2 failures: `toEqual` assertions missing the two new fields). The body was reviewed against
invariant 4 and **kept**; everything else here is new. If a future session finds a lone modified
file with a green `tsc` and a red test, this is what that looks like.

**The resolver's shape, and why it is safe for existing clients.** A block contributes **only** a
rate. `goalWeightKg` / `goalBodyFatPercentage` / `deadline` / `startDate` still resolve from
`client_goals` in every case (invariant 4), so omitting `phases` returns an object identical to
the pre-blocks one — pinned by a test that diffs the two. `date` defaults to `today`; it exists
solely to pick the covering block.

**OWNER DECISION (2026-07-29) — all six call sites, not the three I proposed.** I recommended
deferring three of them and was overruled; recorded here so Session 3 does not re-open it:

| Site | What it does now | My objection, overruled |
|---|---|---|
| `nutrition-plan-orchestrator.ts` | resolves anchored on `body.effectiveFrom ?? clientToday` | — |
| `nutrition/route.ts` | passes `phases` + `date: today` | behaviourally a no-op: `detectGoalDrift` compares destination fields only, which blocks never move |
| `comparison-service.ts` | anchors on `periodEnd`, feeds the pace check | — |
| `use-merged-metrics.ts` | receives blocks via the widened payload | **the blocks it receives have no reader** — it uses `goalWeightKg`/`goalBodyFatPercentage` only. Live but inert until Session 3 |
| `use-nutrition-plan.ts` | `getWeightRemaining` resolves instead of reading the mirror | — |
| `use-nutrition-builder.ts` | `getProjectedDate` same; local `CALORIES_PER_KG` deleted | — |

**NOT DONE, and deliberately: the orchestrator does not yet loop per block.** §2.4's "called once
per block" is verbatim **2.6**'s sentence ("runs the calculator once per block and writes each
block's grid"). Writing the loop here would mean either writing 2.6's grid-write half or leaving a
computed-and-unused array that fails `no-unused-vars`. What landed is the call site becoming
date-aware — which is 2.4's actual title. **2.6 owns the loop and inherits the `phases` fetch
already in the orchestrator's `Promise.all`.**

**A UNIT BUG, caught by a test rather than by reading.** The first cut passed
`effectiveGoal.phaseRateKgPerWeek` straight into `computeGoalPace`. That path runs in **display
units** — `remainingKg` and `currentWeightKg` are misnamed and actually carry the client's display
unit (there is an existing test at `comparison-service.test.ts:207` guarding exactly this), while
a block stores **kg**. An lbs client's 0.5 kg/wk block would have been graded against an lbs
ceiling: a 2.2x understatement, always in the "looks safer than it is" direction. The call site now
converts via `weightFromKg`, and the input is named **`prescribedRatePerWeek`** (no `Kg`) with a
doc comment saying it must match the other two. The regression test asserts the **number** (1.1),
not the status — the status stays `on_track` either way, so a status-only assertion would not have
caught it.

**Pace semantics (owner decision).** When a block covers the check-in's period, its rate
**replaces** the deadline-derived `remainingKg / weeksRemaining` as the requirement; the 1%-safe
ceiling still grades it. A passed deadline still wins (`weeksRemaining <= 0` → unrealistic): a
block says how fast a leg runs, it does not un-blow a deadline. This is the product decision task
1.4's STATUS parked as "two competing safe-rate definitions" — the classifier is unchanged, only
its numerator.

**`0` is checked with `!= null`, never truthiness** — in the resolver, in the pace input, and in
both test suites. Invariant 5 makes a `0` block explicit maintenance; a truthiness check silently
reports "no block covers this date" for every maintenance block and falls back to deadline math.
Named tests on both sides.

**The check-in anchor is `period_end`, not today.** A check-in reviewed late is graded against the
block that was running while the client lived it. `periodEnd` is optional on the legacy token flow,
so client-local today is the fallback.

**One `/goals` read serves all three browser sites.** The GET now returns `phases` as a **sibling
key** (`{success, data, phases}`), not folded into `data`, so existing `data`-shaped consumers are
untouched. `useClientGoals` exposes it, with a module-level `EMPTY_PHASES` constant so "no blocks"
keeps a stable reference and does not retrigger every downstream `useMemo`.
`useNutritionBuilder` composes `useNutritionPlan` and reads its exposed `effectiveGoalWeightKg`
rather than fetching again.

**§7 gap discharged.** `use-merged-metrics.ts` built its `/goals` key inline (task 1.3's STATUS
recorded this and noted the new hook "gives it a home"). It is touched now, so it moved onto
`useClientGoals`. Side effect: its SWR `errorRetryCount` goes 1 → 3, matching the §7 standard.

**Mock contract broken and repaired (CONVENTIONS §2).** Importing `client-phases-service` into
four already-mocked modules failed 17 tests across 4 files. Each got a
`getClientPhases: vi.fn().mockResolvedValue([])` mock in its own file's style. **Default `[]` is
deliberate** — every pre-existing assertion then describes a client with no blocks, i.e. today's
behaviour, so the suite proves the no-blocks path is unchanged rather than being rewritten around
the new one.

**Security / load / performance review (§2) — run, four sites verified at `file:line`:**
- **Authorization precedes every new read.** `goals/route.ts:26` `requireCoachOwnsClient`;
  `nutrition/route.ts:41-54` authed coach + `client.coachId !== coachId` → 403;
  `check-in/[id]/comparison/route.ts:19` `requireCoachOwnsCheckIn`;
  `nutrition-plan-orchestrator.ts:125` 403 throw. No read moved ahead of its check.
- **Tenant-scoped:** `getClientPhases` filters `.eq("client_id", clientId)`
  (`client-phases-service.ts:94`). It uses `supabaseAdmin` (RLS bypassed by design, Shape B) — the
  route layer is the perimeter and it holds at all four.
- **No new writes**, so §2 #3/#4/#12/#13 do not apply: nothing new can leave data half-updated.
- **Round trips: +1 per request at four sites, all inside an existing `Promise.all` fan-out**
  (the goals GET gained one). Latency is `max`, not `sum` (§2 #11). No query inside a loop.
- **Index-covered:** `.eq(client_id).order(starts_on)` is served by
  `idx_client_phases_client_starts` from migration 137.
- **Worst-case rows: 12** (`MAX_PHASES`, zod-enforced in 2.3), each with a ≤7-row grid. The
  payload is bounded by construction.
- `npm run check:rls` — **41 public tables, 41 with RLS.**
- **Not measured, only read.** No load was run. Concurrency and pool behaviour on the widened
  goals GET are untested.

**FINDING, not fixed here — a second instance of 2.8(h).**
`app/api/clients/[id]/nutrition/route.ts:41` calls `getAuthenticatedCoachId()` **without
`request`**, same as the `:163` and `:216` handlers in that file (`:293` passes it correctly).
2.8(h) names only `training/[planId]/events/[eventId]/route.ts:31`. Not a security hole — the
chain is otherwise correct — but **2.7 should fix this file too, not just the one 2.8(h) names.**

**Gates:** `tsc` clean · `eslint` **0 errors** (210 pre-existing warnings, unchanged from the 2.1
baseline, none in touched files) · `vitest` **236/236 files, 2464/2464 tests** (2448 → 2464; the
known-flaky `set-tracker.test.tsx` failed once in a full run and passed 33/33 in isolation) ·
`check:labels` OK · `check:rls` 41/41 · no `as any` · no leftover markers.

**Owed:** no browser smoke was run for 2.4. The two display-only hook changes
(`getWeightRemaining`, `getProjectedDate`) must not move any number the client eats to; that is
argued from the code and covered by unit tests, **not observed in a browser.**

---

### Task 2.5 — Per-date generation + horizon ✅ SHIPPED 2026-07-29

**What shipped.** `generateNutritionEvents` takes a **`NutritionTargetResolver`** —
`(date, dayName, isTrainingDay) => targets` — instead of closing over one `PlanInput` + one grid.
The horizon becomes `max(anchor + 56d, last block end)`. Plus riders **(b)**, **(c)**, **(g)** and a
recorded decision on **(f)**. No migration.

**Why this is the whole backend feature.** The generator wrote the same numbers onto every date it
touched. It now asks per date, so a cascade spanning three blocks writes three different sets of
numbers instead of flattening them to one — silently and with no error, which is what made this the
highest-value test in the workstream.

**Resolution order, and the one that is easy to get wrong.**
1. **Custom macros → the plan grid, blocks ignored entirely.** Inherited from 2.2's STATUS, and it
   is load-bearing: the coach typed those numbers and the calculator never ran, so no block drove
   them. Without the short-circuit, a custom plan's in-block dates would resolve to a block's grid
   and overwrite what the coach typed on exactly the dates a block happens to cover. This is why
   the plan select at `nutrition-event-service.ts` widened to include `custom_macros_enabled`.
2. The block covering the date, **when its `daily_targets` grid exists**. It is NULL until 2.6, so
   today every date still falls through to (3) — the block path is live but unreachable until 2.6
   writes a grid. Tests seed one so the path is covered now rather than on trust.
3. `nutrition_plan_daily_targets` — byte-identical to pre-blocks behaviour. Pinned by a test that
   diffs "no `phases` argument" against "`phases: []`".

**`is_training_day` is passed INTO the resolver, never read from a grid.** It is a per-DATE fact
derived from live training events; a weekday-keyed grid cannot carry it. This is the same reason
migration 137 omits it from `client_phases.daily_targets` (2.1 deviation #3), now enforced by the
resolver's signature rather than by memory.

**The horizon and the DELETE cannot drift apart.** `resolveScopeDates` takes the phases and returns
ONE array; the DELETE bounds itself with `dates[0]`/`dates[len-1]` and the regenerate walks the same
array. So widening the horizon for blocks **structurally cannot** reintroduce task 1.2's
unbounded-DELETE-vs-bounded-regenerate mismatch — it is not a rule anyone has to remember.
`calculateNutritionEndDate` also moved off `new Date(d).setDate()` onto `addDaysToDateString`, for
1.4's reason. Worst case is bounded by `MAX_CHAIN_WEEKS` (104), zod-enforced in 2.3.

**Rider (b) — the amendment now bounds its cascade.** `amendPlacedPlanFuture` computes `windowEnd`
and threw it away; it is now on `AmendPlacedPlanResult` and the route passes
`{kind:"from", from: floor, to: windowEnd}`. Before this, a training day in week 15 of a 20-week
program kept its surplus **forever** after the coach turned it into a rest day, because the cascade
stopped at the default 8-week horizon and nothing ever revisited it.
**KNOWN GAP, owner decision 2026-07-29:** if the coach *shortens* a program, days the old window
covered past the new `windowEnd` are not revisited and keep a stale surplus. Closing it needs the
pre-amendment window end plumbed out of the writer and widens every amendment's upsert. Deferred
deliberately — recorded in `ARCHITECTURE.md` too, so it is not rediscovered as a bug.

**Rider (c) — the latent timezone bug is dead.** `nutrition-service.ts` now calls `daysToDeadline`
from `lib/goals/goal-rate.ts` (the implementation 1.4 pinned across six zones) instead of
transcribing local-vs-UTC `Date` math. **A boundary case the port surfaced:** the function has
always accepted *either* a bare `YYYY-MM-DD` (what every production caller passes —
`goal_deadline` and `goal_start_date` are DATE columns) *or* a full ISO timestamp (what its tests
pass, and what `new Date(...)` silently tolerated). Day-number arithmetic needs the calendar date,
so a local `toCalendarDate` slices it. **The pinned helper's contract was NOT loosened** — the
normalization sits at the legacy signature's boundary, where the leniency actually lives.
**Evidence the port moved no numbers:** 1.4's 24-case golden matrix
(`nutrition-service.caps-floor.test.ts`, captured by running the OLD code) passes unchanged.

**Rider (g) — ANSWERED, no backfill needed.** `generateNutritionEvents` recomputes **both**
`is_training_day` and `training_burn_calories` from live training events for **every** date it
writes. So any regeneration reaching those dates clears the drift the Session 1 smoke found on
fixture Samuel James; a narrow `{kind:"dates"}` cascade will not, because those dates are not in its
set — which is exactly why the smoke saw them survive. A plan-level regenerate fixes them.
~~**Read from the code, NOT verified against the live rows.**~~

> **CORRECTED 2026-07-29, same day, during the smoke.** Two changes to the paragraph above.
>
> 1. **Now measured, not just read.** Live query over `2026-07-28 … 2026-08-12` on Samuel James:
>    `2026-08-01` (training day, `burn = 0`) and `2026-08-09` (rest day, `burn = 770`) are both
>    `is_modified: false`, so the answer above **holds for them** — a regeneration reaching those
>    dates does clear them, and no backfill is needed.
> 2. **"Any regeneration reaching those dates clears the drift" is too broad as a general claim.**
>    It is false for `is_modified` days, which the cascade drops from the upsert entirely — no
>    regeneration ever reaches them. That is a separate defect, found in the same smoke and fixed
>    immediately after; see the STATUS block below.

**Rider (f) — DECIDED: still owed, and it is Session 3's** (owner, 2026-07-29). The widened horizon
does **not** close it: a date past `max(today + 56d, last block end)` still has no row, still reads
`null` through `getPlanTargetForDate`, and that null is still snapshotted permanently into
`nutrition_logs` and drops the day from the weekly denominator. It is a READ-path concern and 3.8 is
already the client-portal task, so both land in one pass. **Task 2.5 is generation; this is
rendering.** For it to bite, a client must be looking 9+ weeks ahead *and* logging food that day.

**Callers updated, not worked around.** `scripts/backfill-nutrition-events.ts` and
`scripts/seed-scale-client.ts` build a plan-only resolver (no phases) — the backfill repairs
historical rows that predate blocks, and the scale fixture has none.

**Mock contract (CONVENTIONS §2):** `nutrition-event-service.test.ts` gained a
`client-phases-service` mock, re-armed inside `beforeEach` because `vi.clearAllMocks()` wipes a
module-level `mockResolvedValue`. That bites silently — the mock returns `undefined` and the horizon
math throws — so it is worth knowing before the next service picks up a phases read.

**Tests added (10):** the three-block cascade writing three different numbers *plus* a fourth date
past the last block falling back to the plan grid; no-blocks ≡ empty-blocks; a covering block with a
NULL grid falling back rather than producing zeros; custom macros ignoring blocks; horizon extends to
a block end past 8 weeks **with the DELETE's `.gte`/`.lte` asserted on the same bounds**; a block
ending *before* the horizon not shortening it; and the amendment route asserting
`to: windowEnd` against a date ~16 weeks out, so a regression to the bare `{kind:"from"}` fails
rather than silently shrinking the range.

**Security / load / performance review (§2):**
- **No new API routes, no new writes, no auth change.** The only route touched is the amendment PUT,
  and only the `to` field of an existing cascade argument.
- **One new read per regeneration** (`getClientPhases`), loaded **once** before the date loop and
  passed to both the horizon and the resolver — never a query inside the per-date loop (§2 #7).
  Tenant-scoped `.eq("client_id", …)`, index-covered by `idx_client_phases_client_starts`.
- **Write volume can grow, and this is the one thing to watch.** The horizon now reaches the last
  block end, so a 104-week chain (the zod ceiling) makes a `{kind:"from"}` regeneration upsert ~728
  rows instead of ~56. Bounded and batched into one statement, but it is a real increase on the
  widest case. **Not load-tested.** Narrow `{kind:"dates"}` cascades — the common ones (move,
  duplicate, surplus edit) — are unchanged.
- **Consistency:** the cascade's existing swallow (`captureApiError`, §2 #12) is untouched and still
  means a failed regeneration leaves stale-but-present rows rather than absent ones.

**Docs updated in this commit (class (b) stale — my own code made them false):**
`ARCHITECTURE.md` "Training → Nutrition cascade" — the range is now
`[from, max(from + 56d, last block end, to)]`, the amendment *does* pass a `to`, the shrink gap is
recorded, and a new bullet describes per-date generation and the resolution order.

**Gates:** `tsc` clean · `eslint` **0 errors** (210 pre-existing warnings) · `vitest`
**236/236 files, 2474/2474 tests** (2464 → 2474) · `check:labels` OK · `check:rls` 41/41 · no new
`as any` · no leftover markers.

**Owed:** no browser smoke. The block-resolution path cannot be exercised end-to-end until 2.6
writes a `daily_targets` grid, so the meaningful smoke belongs after 2.6.

---

### Bugfix — a coach-edited day kept a stale TRAIN badge ✅ SHIPPED 2026-07-29

**Not a numbered task.** A pre-existing defect found by the owner during the Session 2 smoke,
root-caused and fixed in its own commit. Recorded here because it corrects a claim in 2.5's STATUS
and because the semantic it establishes is one Session 3 must not undo.

**What the owner saw.** `2026-07-31` carried a training session and had been manually edited to
4,000 kcal. Moving the session to `2026-07-30` updated the 30th correctly and correctly preserved
the 4,000 on the 31st — **but the 31st kept its TRAIN badge** while the training calendar showed it
as REST.

**Measured, not inferred.** A live query over `2026-07-28 … 2026-08-12` comparing
`nutrition_events.is_training_day` against actual `training_events` found **exactly one mismatch in
the window — `2026-07-31`, the one `is_modified: true` row.** Every other day agreed with reality,
which independently confirms task 2.5's generator rewrite did not break the cascade.

**Root cause — three things compounding:**
1. `materializeNutritionEventDays` (`nutrition-event-edit-service.ts`) writes `baseline_calories`,
   macros, `calorie_surplus_percentage: null`, `training_burn_calories: 0`, `is_modified: true` —
   and **never touches `is_training_day`**. The day keeps whatever flag it had at edit time.
2. `generateNutritionEvents` filters `is_modified` rows out of the upsert **entirely**, so no later
   cascade rewrites the flag.
3. The badge renders straight off that stored column
   (`nutrition-calendar-day-cell.tsx` → `event?.isTrainingDay`).

⇒ Once a coach edited a day, its badge was **frozen forever** at its edit-time value. The only
escape was "reset day", which clears `is_modified` first and then regenerates.

**THE SEMANTIC, and it is the durable part: `is_modified` protects the numbers the coach TYPED, not
the training calendar.** `is_training_day` is a fact about whether the client trains that day. A
coach editing Tuesday's calories never said "and Tuesday is a training day forever". Any future
code that widens or narrows `is_modified` protection must keep this split.

**The fix.** Protected rows are still excluded from the upsert, and additionally get
`is_training_day` refreshed by `refreshTrainingDayFlagOnEditedDays` — **that one column and
`updated_at`, nothing else**. Their calories, macros, surplus and burn stay exactly as the coach left
them; the edit deliberately sets surplus NULL and burn 0 so training stops stacking on an edited day,
and undoing that would change the number the client eats to. Works in both directions: the badge
clears when training moves off an edited day and appears when it moves onto one.

**Shape:** two batched UPDATEs (one per flag value), not one per row — round trips stay constant at
**≤2** however many days the cascade covers, and they only fire when the window actually contains an
edited day. Both are client-scoped and re-assert `is_modified = true`, so a stale date set cannot
reach an unprotected row. `updated_at` is stamped explicitly (no trigger on the table, and this is a
real UPDATE rather than the upsert half that leaves it frozen).

**Tests (4):** flag cleared when training moves off; set when it moves onto; **the payload asserted
to contain exactly `is_training_day` + `updated_at`** (so a future edit cannot quietly start
clobbering the coach's calories through this path); no UPDATE issued at all when no day is edited;
and mixed days split into one UPDATE per flag rather than one per row.

**Gates:** `tsc` clean · `eslint` 0 errors · `vitest` **236/236 files, 2478/2478** · `check:labels`
OK.

**Note for the smoke:** the fix corrects a day the next time a cascade covers it. The `2026-07-31`
row stays stale until a training write touches that date again — redoing the move is the end-to-end
proof.

---

### Task 2.6 — Plan POST calculates per block ✅ SHIPPED 2026-07-29

**What shipped.** New pure `lib/goals/phase-targets.ts` (`computePhaseTargets`), new
`writePhaseDailyTargets` in `services/client-phases-service.ts`, the orchestrator wired to both,
`stampPhasesFingerprint` finally given its callers, plus riders **(d)** and **(e)**. No migration.

**This is the task that makes 2.5's block path reachable.** Until now `client_phases.daily_targets`
was NULL for every block, so the per-date resolver always fell through to the plan grid. It now has
grids to resolve to.

**The pure half is in `lib/goals/`, not the service** — the same call 2.3 made for `phase-chain`.
Session 3.3's per-block preview renders from `computePhaseTargets` directly, so the numbers a coach
sees while authoring and the numbers the server writes come from one function and cannot disagree.

**Rate-first, not deadline-driven.** A block stores a rate and explicitly no target weight
(invariant 4), so each block goes through `calculateBaselineCaloriesFromRate` — task 1.4's entry
point, which shares `capWeeklyRate`/`applyCalorieFloor` with the deadline path so the two cannot
drift on what counts as safe. The plan-level calculation is unchanged and still drives the plan's
own snapshot columns.

**WRITE ORDER — grids → plan → events → fingerprint, and the order is the design.** 2.2's STATUS
established the last-write rule; 2.6 is where it becomes real. Grids go first so a failure there
leaves the previous generation intact with a fingerprint that still matches it. The stamp goes last
so the stored hash means *"every write in this generation succeeded"*. **A test asserts the
invocation ORDER, not just that each ran** — the ordering is the whole guarantee, and a refactor
that reshuffles these four calls would otherwise pass silently. A second test asserts that a failed
event rewrite leaves the fingerprint **unstamped**.

**Three paths stamp NULL, for two different reasons:**
- **No blocks** — `computePhasesFingerprint([])` returns null, never a sentinel, so no existing
  plan starts comparing unequal on the day Session 3 ships.
- **Custom macros** — decided in 2.2. The coach typed the numbers and the calculator never ran.
  Stamped **unconditionally**, not only when blocks exist: a client whose plan *was* block-driven
  and who then switches to custom macros must have the old hash cleared, or the plan goes on
  claiming those blocks are current.
- **`preserveCalories`** — decided here. It reuses an existing baseline rather than calculating, so
  no block drove those numbers either.

**`phases` is ABSENT from the response, not `[]`, when no block drove the generation** — Session 3
must be able to tell "this client has no blocks" from "blocks ran and produced nothing".

**Rider (d) — the floored rate is fixed EVERYWHERE** (owner decision 2026-07-29, overruling the
narrower per-block-only option). `calculateBaselineCalories` re-derives `requiredDailyDeficit` and
`weeklyRate` from the target it actually returns whenever the floor bites. At TDEE 1700 it used to
report −0.3846 kg/wk (≈423 cal/day) beside a floored target running only 200 cal/day.

**The golden matrix was re-derived, not re-pasted.** 1.4's file is evidence *produced by the old
code*, so blindly pasting the new code's output would have destroyed exactly what makes it evidence.
Each of the **8 floored rows** was recomputed from the DEFINITION — `deficit = tdee − baseline`,
`rate = (baseline − tdee) × 7 ÷ 7700` — and only then checked against the implementation. **Only
floored rows moved; every unfloored row is byte-identical**, which is the safety property: the only
numbers that changed are the ones that were lying. A new test now asserts the universal invariant
over the whole matrix (`requiredDailyDeficit ≈ tdee − baselineCalories` for **every** row), which is
a stronger guard than any individual literal and would have caught this class from the start.

**Rider (e) — DECIDED: keep the male default, but disclose it** (owner, 2026-07-29). An unset gender
still takes the higher ceiling and lower floor, so **no existing gender-less client is silently
re-rated**. New `assumedSafetyEnvelopeWarning` fires only when a cap or floor **actually applied** —
an unset gender that never trips a limit changed nothing, and warning then would be noise on every
plan. **An explicit `"other"` is excluded**: the coach chose it, so nothing was assumed. Both
branches are pinned by tests.

**A test caught a wrong assumption of mine, not a wrong implementation.** I expected a −2 kg/wk
request at TDEE 2500 to report an applied rate of −1 (the cap). It reports −0.909, because the
capped −1 kg/wk wants 1400 which then trips the 1500 floor — the cap/floor interaction 1.4's matrix
already flagged. Split into two tests: cap-only at TDEE 3000, and cap-AND-floor at 2500.

**Deliberate simplifications, recorded so they are not mistaken for oversights:**
- **Every block uses the same TDEE.** A client's weight genuinely moves across a 15-week chain,
  which would move TDEE with it — but nothing in this workstream models per-block weight, and
  projecting one here would invent numbers no later measurement reconciles against.
- **Protein is held constant across blocks**, for the same reason (it is body-weight derived).
- **A block's own grid is flat across the 7 weekdays.** Per-weekday variation is a coach override
  applied on top via the plan grid's `dayCalorieOverrides`; blocks do not carry their own skew.

**Mock contract (CONVENTIONS §2), twice.** Two already-mocked modules gained exports
(`stampPhasesFingerprint`, `writePhaseDailyTargets`) and three test files needed them added —
`nutrition-plan-orchestrator.test.ts` and the nutrition route test failed with a bare 500 until they
were. Also removed a duplicate `client-phases-service` mock the 2.4 commit had left in the
orchestrator test (harmless — vitest hoists and the later wins — but actively misleading to read).

**Security / load / performance review (§2):**
- **No new routes, no auth change, no new user input.** Everything runs inside the already-authorized
  `POST /api/clients/[id]/nutrition` (ownership checked at `nutrition-plan-orchestrator.ts:125`).
- **One new write per plan generation**, batched: a single `upsert` over at most **12** rows
  (`MAX_PHASES`), each with a 7-entry JSONB grid. Constant round trips — no per-block statement.
- **One extra read** inside `writePhaseDailyTargets` (`getClientPhases`) so the upsert can carry each
  row's full column set. PostgREST builds one INSERT with a single column list, so a partial upsert
  would null the columns it omits — the read is what makes the batched write safe rather than
  destructive.
- **Consistency (§2 #13):** grids, plan, events and fingerprint are four separate writes and are
  **not** in one transaction. Stated plainly: a failure between any two leaves the earlier ones
  applied. Every such state is *stale*, which the fingerprint surfaces and the next regenerate
  clears — the failure matrix in 2.2's STATUS enumerates all five cases. That is the deliberate
  trade, not an oversight.
- **Not measured.** No load run.

**Doc updated:** `ARCHITECTURE.md` gains a per-block plan-creation bullet (write order, the last-write
rule, and the three NULL-stamp cases). The full ARCHITECTURE pass — the new table and the now-false
*"No roadmap or phase concept exists"* line — remains **2.7's**.

**Gates:** `tsc` clean · `eslint` **0 errors** (210 pre-existing warnings) · `vitest`
**237/237 files, 2495/2495 tests** (2478 → 2495) · `check:labels` OK · `check:rls` 41/41 · no
`as any` · no leftover markers.

**Owed:** no browser smoke. **The block path is now end-to-end reachable for the first time**, so the
deferred smoke from 2.4 and 2.5 can finally run — but it needs a client with real blocks, and
nothing writes `client_phases` through the UI until Session 3.1. Until then it takes a seeded block
row.

---

### Task 2.7 — Routes + docs ✅ SHIPPED 2026-07-29

**What shipped.** `app/api/clients/[id]/phases/route.ts` (+ its test), `isNutritionStaleForPhases`
in `services/nutrition-plan-service.ts`, two audit actions in `lib/constants.ts`, rider **(h)**, and
the `docs/ARCHITECTURE.md` reconciliation. No migration.

**Handover note — this task was finished by a second session.** The first one died on
`ECONNRESET` at ~480k tokens of context, as two earlier sessions in this workstream had (541k and
384k; the two sessions that stayed under 300k never hit it). Each error arrived 5m48–5m54s after the
last successful turn — a fixed retry budget expiring, not one bad packet — and typing `go` only
re-fired the same oversized request. **Nothing was wrong with the code at that point**: the session
was stuck on a single failing test and had misread it (see below). If a session in this workstream
starts resetting, check its context size before debugging anything else, and split the remaining
tasks into fresh sessions rather than retrying.

**The route.** `GET`/`PUT`/`DELETE /api/clients/[id]/phases`, chain
`coachApiRateLimit` → `requireCSRFProtection` (writes only) → `requireCoachOwnsClient(clientId, request)`
→ zod → service, with `recordAuditEvent` fired **after** the authorized write and never on a failed
one. `PhaseWriteError` carries its own status so the elapsed-block refusal surfaces as a 422 naming
the block rather than a generic 500. **The route never calls `updateGoals`** (invariant 7), asserted
structurally.

**`GET` returns `nutritionStale`, computed server-side.** The staleness rule gets exactly one home
(`isNutritionStaleForPhases`) rather than being re-derived in the browser, where the custom-macros
exemption is the half that would inevitably be forgotten. Three ways to be not-stale — no active
plan, custom macros, matching fingerprints — and a read failure returns `false`, because a transient
DB error must not manufacture an "out of date" alarm the coach cannot explain.

**The failing test was a self-matching assertion, not a defect.** `expect(src).not.toContain("updateGoals")`
reads `route.ts` as source text — and `route.ts`'s own docstring contains the word while explaining
the rule. The route was correct the whole time. Comments are now stripped before the assertion,
deliberately rather than deleting the prose: the tempting "fix" is to remove the explanation, which
keeps the test green and loses the reason. **A structural assertion over a file's own source must
exclude the comments that document it.**

**DEVIATION — rider (h) is two lines, not one, and the other 56 shipped separately as
`03981e9`.** The plan names `training/[planId]/events/[eventId]/route.ts:31`; that file has the
identical defect in **both** its PATCH and DELETE handlers, and fixing one and not the other would
be arbitrary. Repo-wide the count was **58 `getAuthenticatedCoachId()` calls without `request`
against 34 with it** — a convention that never landed, not an oversight in one file.

**CORRECTION, and it is the reason this paragraph is worth reading.** This STATUS block originally
recorded "not expanded here (out of 2.7's scope)" as an execution decision. It was not one to make:
the owner had **already answered it at 16:35 on 2026-07-29 — "Fix all 58 now", its own commit** —
in the session that then died on `ECONNRESET` 13 minutes later, before starting the sweep. The
takeover session did not inherit that answer, re-surfaced the same 58-vs-34 count as a fresh
finding, and recommended the opposite. **A decision made in a session that dies is invisible to its
successor unless something outside the session records it.** Found by auditing the dead sessions'
transcripts for `AskUserQuestion` answers, which is now the thing to do after any crash — a lost
*decision* leaves no trace in the code, so no gate and no review will ever surface it.

The sweep shipped as `03981e9`: 55 mechanical sites plus `verifyCoachOwnership`
(`check-in/[id]/review/route.ts`), a local helper with no `request` in scope, threaded through to
its two callers. 59 lines, every one the same substitution, verified by filtering the diff for any
line that was *not* the intended change. All 92 call sites now pass `request`.

**Docs reconciled (class (b) — stale, my own workstream made them false):**
- **New `### client_phases table (migration 137)` section.** The table was undocumented in
  ARCHITECTURE: 2.1 shipped the migration and 2.5/2.6 documented the *generation model*, but nothing
  described the table, its invariants, or its routes. Carries the reasoning that rots fastest: why
  there is no `UNIQUE (client_id, starts_on)`, why the pure half sits in `lib/goals/`, why bounds
  live in zod, why `updated_at` is stamped in app code, and why `daily_targets` omits
  `is_training_day`.
- **New `phases_fingerprint` paragraph** under "Nutrition plan (durable)", including 2.2's
  decision that `goal_source` stays dropped, and the stamp-last ordering with its failure matrix.
- **"No roadmap or phase concept exists" corrected.** Migration 137 made the *phase* half false; the
  *roadmap* half is still true and now says so. The bullet also disambiguates the collision the
  word "block" now creates — the Overview's training chips describe a **program**.

**Security / load / performance review (§2 — triggered by a new API route):**
1. **Rate limit + CSRF** — `coachApiRateLimit` first on all three handlers, before params are even
   awaited; `requireCSRFProtection` on `PUT`/`DELETE` and correctly absent on `GET` (`:51`, `:83-87`, `:137-141`).
2. **Auth + ownership** — `requireCoachOwnsClient(clientId, request)` on all three, with `request`
   passed; a foreign `clientId` returns the helper's response and no service is reached (pinned).
3. **zod before every write** — `.strict()`, so a client attempting to send date pairs is a 400 and
   an overlap cannot be expressed at the boundary at all.
4. **Tenant scoping** — every service call takes `clientId` explicitly and filters on it; a forged
   `phaseId` matches zero rows.
5. **`check:rls`** — 41/41 tables, run against the live catalog.
6. **`supabaseAdmin` bypasses RLS** — authorized by the ownership check above it, which is the only
   perimeter that exists on this route.
7-8. **Round trips are constant.** `GET` = 2 reads (blocks + plan) and hashes in memory. `PUT`/`DELETE`
   inherit 2.3's two batched statements; nothing loops a query per block.
9. **Index-covered** — `idx_client_phases_client_starts`; the upsert's `onConflict: "id"` targets the PK.
10. **Worst case** — `MAX_PHASES = 12`, so a `PUT` writes at most 12 rows and a `DELETE` re-chains at
   most 11. Bounded by zod, not by hope.
11. **Sequential awaits** — `GET`'s two reads are sequential and the second consumes the first's
   output, so they cannot be parallelised.
12. **One swallow, deliberate:** `recordAuditEvent` is fire-and-forget (`void`), so a failed audit
   write returns 200 with the block change committed and unlogged. Consistent with every other
   audited route; the alternative is failing a legitimate coach edit because a log write failed.
13. **`PUT` is not transactional** — 2.3's DELETE-then-upsert. If the upsert fails after the delete,
   removed blocks are gone and the rest are unchanged. Pre-existing from 2.3, unchanged here.

**Review findings, and one that mattered.** An adversarial review raised 24 findings across five
lenses; 21 were refuted and **3 confirmed, all fixed in this commit**:
1. *(docs)* "no write can touch [elapsed blocks] and their `updated_at` never moves" was true of the
   coach-edit path but **false of plan generation**, which recomputes and upserts every block's grid
   including elapsed ones. Transcribed from 2.3's STATUS, which was written before 2.6 shipped and
   falsified by it. Now qualified, with the consequence stated: `client_phases.updated_at` is **not**
   a "was this finished block ever touched" signal, and **Session 3's muted past-block view must not
   assume it is showing the numbers the client actually ate.**
2. *(tests)* `DELETE` never asserted its arguments, so the client-today plumbing was unpinned.
3. *(tests)* The `PUT` twin **passed for the wrong reason** — the mocked client-today and
   `validPut.startDate` were the same string, so confusing them satisfied the assertion. The two are
   now deliberately different and a comment says why.

**A review agent left a mutation behind, and the new test caught it.** While proving finding 3, a
verifier edited `route.ts:115` to pass `validation.data.startDate` instead of `clientToday`,
reported that it had reverted the edit, and had not. It survived the gates that had already run.
Both fixes were then mutation-tested — each mutation now fails the suite, and the file was diffed
byte-for-byte against a backup afterwards. **Do not trust a subagent's claim to have reverted a
mutation; diff the file.**

**Gates:** `tsc` clean · `eslint` **0 errors** (210 pre-existing warnings, none in touched files) ·
`vitest` **238 files, 2515 tests** (2474 at the 2.5 close) · `check:labels` OK, 629 files ·
`check:rls` **41 public tables, 41 with RLS** · no `as any`, no leftover markers, no `console.log`
in any of the five touched files.

**Owed:** no browser smoke — the route has no UI caller until Session 3.1, so exercising it needs a
hand-rolled request rather than a click. Session 3 is its first real consumer and smokes it for free.

**Session 2 is closed.** 2.1–2.7 shipped; 2.8 (a)–(e), (g) and (h) shipped; **(f) is the only
carry-forward** — decided in 2.5's STATUS to be Session 3's, alongside 3.8's client-portal work.

---

### Post-crash audit — 4 dead sessions ✅ COMPLETE 2026-07-29

**Why.** Four sessions in this workstream died on `ECONNRESET` (28 Jul 23:56 · 29 Jul 06:36 ·
11:53 · 16:48), each losing its whole context. This audit asked what that cost. It found **six
things, in three classes**, and the classes matter more than the count: *none* of the six would
have been caught by the commit-ready gates, and *none* lived in the commit history.

**Class 1 — live database state (invisible to git).**
- The 28 Jul 23:56 crash happened **16 minutes after a smoke deliberately diverged the goal
  mirror** to prove Task 1.3, and it never restored it. `clients.goal_weight` sat at **77 / 33 %
  against `client_goals`' 90 / 9 for ~20 hours**, on a fixture that belongs to the owner's real
  coach row. Not cosmetic: the client portal still reads the mirror
  (`client-portal-progress.ts:268` → `goals-section.tsx:63`), so the coach's Overview and the
  client's own screen reported different goals with nothing indicating disagreement. Restored by
  re-reading `client_goals` rather than writing the remembered numbers, so the repair could not
  itself install a stale value. **A code revert would not have fixed this** — which is the whole
  lesson of the class.

**Class 2 — a decision that existed only in a dead session's context.**
- Rider 2.8(h): the owner answered "**Fix all 58 now**, its own commit" at 16:35; the session died
  at 16:48 before starting. The successor re-derived the same question and recommended the
  opposite. Found by grepping the dead transcripts for `AskUserQuestion` answers — **a lost
  decision leaves no trace in code, so no gate and no review can ever surface it.** Shipped as
  `03981e9`; see Task 2.7's STATUS.

**Class 3 — a review subagent's edits, left behind.** Two of these, and the second one shipped.
- While mutation-testing a finding, a verifier rewrote `route.ts:115` to pass the coach's requested
  `startDate` where the client's today belonged, **reported that it had reverted, and had not.** The
  new assertion from the same review caught it before commit.
- A verifier also **deleted the `recordAuditEvent` block from the DELETE handler**, and that one
  **shipped in `fe2ee23`**: deleting a block re-chains every later block and re-windows the client's
  future targets, and it went unlogged, while `AUDIT_ACTIONS.PHASE_DELETE` sat with zero call sites
  and two docs asserted the audit existed. Restored here, with a test that fails if the block is
  removed again.
- **Why the first sweep missed it:** the diff audit ran `git diff`, and `route.ts` was **untracked**
  — `git diff` is silent on untracked files. The spot-read that followed covered `:45-95`,
  `:105-122` and `:160-172`; the deleted block sat at `:173-181`. **For untracked files, `cp` a
  baseline before any review and `diff` against it. Re-run the gates AFTER a review, never only
  before** — the mutation was type-correct, lint-clean, and passed all 2514 tests, because the
  missing assertion was precisely the gap being reported.

**Class 4 — doc claims the workstream's own commits falsified**, missed by Task 2.7's own
reconciliation pass:
- `ARCHITECTURE.md:76` still listed `use-nutrition-plan.ts` / `use-nutrition-builder.ts` as mirror
  readers "with no `client_goals` fallback" — backwards since **2.4** moved both.
- `ARCHITECTURE.md:85` still called the pre-floor `weeklyRate` asymmetry "pinned, not fixed" —
  **2.6 rider (d) fixed it.** Both corrected, each carrying its own dated correction note.

**What the audit did NOT find, stated positively so it is not re-litigated.** Fifteen candidate
defects were raised across four lenses and **ten were refuted** on evidence, including every
proposed break in the training→nutrition cascade — the workstream's highest-value invariant. The
per-date resolver's precedence, the block-grid-beats-plan-grid rule, the `{kind:"from"}` DELETE
window and the `is_modified` protection all held under adversarial reading. **The commit history
itself is sound**; all six findings were in database state, transcripts, the working tree, or prose.

**Gates after every repair:** `tsc` clean · `eslint` 0 errors · `vitest` **238 files, 2517 tests** ·
`check:labels` OK · `check:rls` 41/41.

---

### Post-crash audit, PASS 2 — five fresh lenses ✅ COMPLETE 2026-07-29

**Result: the shipped code is clean. 9 candidates raised, 0 survived verification.** The lenses were
chosen to be orthogonal to pass 1: **schema-drift** (live catalog vs migrations 137/138/139 vs
`types/database.ts`), **rpc-semantics** (migration 139's transactionality, races, mirror writes),
**security** (RLS/GRANTs from the live catalog, DEFINER EXECUTE, IDOR, and whether `03981e9`'s
40-file sweep moved any authorization outcome), **test-integrity** (mutation-testing the
load-bearing invariants), and **runtime-shape** (JSONB grid, NUMERIC coercion, DST/year edges).
schema-drift and security returned **nothing at all**, and that was checked rather than assumed —
both agents dumped the live schema, regenerated types and diffed, at 46 and 55 tool calls.

**One refuted finding was refuted too fast, and chasing it found the real defect.** A lens reported
"the coach Overview and the client portal disagree for client Sam Kay"; the verifier refuted it as
out of scope, correctly noting that *the portal reading the mirror* is a recorded decision (Task
3.9). True — and it stopped there, checking neither the **direction** nor the **cause**.

Both mattered. `client_goals` held one row (92 / 9, `set_by=intake`, 21 May) while the mirror held
78 / 15 with `clients.updated_at` a month LATER — so **the mirror was the newer value**, and
`client_goals` was the stale one. The cause: `updateClient` wrote the mirror, then called
`updateGoals` inside a `try/catch` that logged and continued; the goal write failed, the request
returned 200. **Task 1.3 then made it visible in the worst direction** — it moved the coach Overview
onto `client_goals`, so a coach who set 78 kg had their own screen tell them 92.

Fixed in `5d5fd99` (the deferred half of 2.8(a)): `updateGoals` now owns both stores on all four
paths, callers no longer write the mirror themselves, and failures propagate. Data resynced through
the RPC, which incidentally proved the migration-139 path end to end.

**The lesson worth keeping:** *a refutation on scope grounds is not a finding that the data is
fine.* "This surface is allowed to read the mirror" and "the mirror currently holds the wrong
number" are different claims, and only the first was tested. When a lens reports a divergence,
check the direction and the cause before accepting that it is by design.

**Also worth keeping: the tests proved nothing here.** All 2517 passed unchanged after the swallow
was removed — the old behaviour had never been pinned, which is exactly why it shipped and survived
six weeks. Ten regression tests now cover all four paths, each mutation-proven, plus a new test file
for the Metrics route, which had none.

**Unprotected-but-unreachable, for Session 3 to close as it wires each surface.** test-integrity's
findings were all correctly refuted as unreachable *today* — no product caller hits them — which is
an argument about today, not about Session 3:

| Invariant with no executing test | Becomes reachable at |
|---|---|
| `writePhaseDailyTargets` (the grid writer) | 3.3 per-block preview |
| `isNutritionStaleForPhases` (`nutritionStale` has zero consumers) | 3.6 "Waiting on you" row |
| zod bounds: `MAX_PHASES`, `MAX_CHAIN_WEEKS`, `MAX_PHASE_WEEKS`, duplicate-id | 3.1 goal & plan panel |
| `deleteClientPhase`'s first-block re-chain anchor | 3.2 delete-a-block |

**Gates:** `tsc` clean · `eslint` 0 errors · `vitest` **239 files, 2527 tests** · `check:labels` OK ·
`check:rls` 41/41.

---

### Session 3A — rider + Task 3.1 part 1 ✅ SHIPPED 2026-07-29 · **3.1 part 2 and 3.2 NOT STARTED**

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
