# Client Goals + Phases — Execution Plan

**Status:** Not started · **Owner decision date:** 2026-07-28
**Three sessions, strictly sequential.** Each is designed for a fresh Claude Code session with a full context window.

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

| Session | Theme | Migrations | Ships user-visible change? |
|---|---|---|---|
| **1** | Pre-existing bug fixes + the rate derivation | **none** | Overview goal source only |
| **2** | Blocks: schema, service, generation | 137, 138 | No (API only) |
| **3** | Coach UI + "Waiting on you" | none | Yes — the whole feature |

Strictly sequential: 2 depends on 1's calculator, 3 depends on 2's API.

---

# SESSION 1 — Foundations

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

# SESSION 2 — Blocks backend

**Migrations 137 and 138. Backend and API only — nothing user-visible ships in this session.**

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

### Session 3 verification

- Full `CONVENTIONS.md` §13 checklist, `npm run check:labels` especially.
- **Browser smoke, end to end:** create a goal with a future start → add 3 blocks → place a program → generate nutrition → confirm the calendar carries three different sets of numbers across the right date ranges → edit a block's rate → confirm the "Nutrition is out of date" row appears → regenerate → confirm it clears.
- Verify **rendered pixels**, not class math — equal margins are not equal optics on a divider row.
- Scroll the calendar back before today and confirm elapsed blocks still render, muted.

---

### 📋 SESSION 3 PROMPT — paste this into a fresh session

```
Read these in full before planning anything:
  1. CONVENTIONS.md  (mandatory — it says so at the top; do not skip sections)
  2. docs/ARCHITECTURE.md
  3. docs/newdesignsystem.md  (design source of truth — but where it and shipped
     Programs/Builder code disagree, the SHIPPED CODE wins)
  4. docs/CLIENT-GOALS-PHASES-EXECUTION-PLAN.md — read §1 (design), §2 (invariants),
     §3 (what to do when a doc rule blocks you), §4 (known doc collisions), the
     SESSION 1 and SESSION 2 STATUS blocks (they record decisions you must inherit),
     and all of SESSION 3. You are executing SESSION 3 only.

Session 3 is the coach UI — this is where the feature becomes visible. The backend
landed in Session 2; do not rebuild it.

Import the shared tokens and components before writing any new class strings:
builder-tokens.ts, SectionLabel, StatBand, SegmentedControl, LibraryTableShell,
RowActions. Author with the hardcoded hex from newdesignsystem.md, not the OKLCH
semantic tokens. Radius is rounded-[6px] everywhere, 4px for inner chips.

Two things that are easy to get wrong and are called out in the plan:
  - Block NAMES are sans even when they contain digits ("Cut 2") — the digits belong
    to the name. Dates, week counts and rates are mono via MONO_LABEL_CLASS.
    `npm run check:labels` fails the build on a raw font-mono-display.
  - Render ALL blocks including elapsed ones, muted. Do not filter to
    current-and-future. That muted rendering IS the entire "view past blocks" story
    for v1, and without it a coach cannot tell why a past month's calories changed.

Rules for this session:
- Follow CONVENTIONS.md §2: show me a plan and get approval before writing any code.
  This applies even to small UI changes.
- One commit per numbered task.
- If a rule in CONVENTIONS.md, docs/ARCHITECTURE.md or docs/newdesignsystem.md blocks
  you, follow the procedure in §3 of the execution plan: quote the rule with file:line,
  state the collision, classify it (genuinely protective / stale /
  protective-but-wrong-here), and either comply, update the doc in the same commit, or
  STOP AND ASK ME. Never silently ignore a rule, and never silently comply with one
  that makes the feature wrong. These docs are strict but they describe the platform as
  it was — this workstream changes it, so some rules will legitimately need updating.
- Commit-ready means all of CONVENTIONS.md §13.
- Verify RENDERED PIXELS, not class math. Equal margins are not equal optics on a
  divider row (the hairline is centred in a variable-height row).
- Append a STATUS block to docs/CLIENT-GOALS-PHASES-EXECUTION-PLAN.md as each task lands.

When all tasks are done, run the full browser smoke in the plan's "Session 3
verification" section and report what you saw — not what you expect.

Start by reading the four documents plus the Session 1 and 2 STATUS blocks, then show
me your plan for 3.1.
```

---

## 6. Explicitly out of scope

| Item | Why |
|---|---|
| Client-facing blocks ("Block 2 of 3") | No `/api/client/**` goal endpoint exists at all — a new read path. v1.5. |
| Block report card (prescribed vs actual rate) | Wants the check-in rebuild to settle first so "actual" and "adherence" mean one thing. Post-launch. |
| Block type enum | Removed by owner decision — rate sign gives direction, and the coach's own block name carries the intent better than any enum. Would over-determine the block. |
| Blocks prescribing training (deload/taper) | Would make blocks genuinely cross-domain; the program builder already handles deloads per-week via progression. Post-launch — and it is the one change that would justify reintroducing a type column. |
| Blocks constraining training placement | The old `calculatePlacementEndDate` / `validatePhaseBounds` inverted this: the program is the container, the block is the slice. Blocks inform placement visually, never restrict it. |
| Dashboard attention-feed rows | Owner decision 2026-07-28 — the feed stays purely client-behaviour. |
| Milestones, objectives, block descriptions, phase snapshots, coach reflections, completion cards, a roadmap container, per-block protein/diet type | The removed feature's lowest-value, highest-cost half. `{name, start, end, rate}` plus calendar tinting captures nearly everything those screens rendered. |

## 7. Open items

- **Client portal still reads the `clients.*` goal mirror** after Session 1 (deliberate — Task 1.3 scope boundary). Revisit with client-facing blocks.
- **`gender` unset defaults to the male safety cap.** Pre-existing; rate-first entry makes it visible. Session 2 decides: surface it or accept it.
- **The `nutrition_events` template fallback (level 3) is still unbuilt.** Session 1 closes the no-row window that made it matter most, but a date past the horizon still reads as "no target".

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

**Discovered while tracing — `clients.goal_deadline` is not reachable at all.** `mapClientRow`
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
