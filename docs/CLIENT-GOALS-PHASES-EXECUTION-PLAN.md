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

| Session | Theme | Migrations | Ships user-visible change? | Status |
|---|---|---|---|---|
| **1** | Pre-existing bug fixes + the rate derivation | **none** | Overview goal source only | ✅ **COMPLETE** — shipped 2026-07-28 (`53abf0a`, `3abbfa5`, `b3ca479`, `62cef4a`), browser smoke passed 2026-07-29 |
| **2** | Blocks: schema, service, generation **+ Session 1's inherited fixes (2.8)** | 137, 138, **139** | No (API only) | 🟡 **In progress** — 2.1–2.5 and 2.8(a,b,c,g) shipped, 2.8(f) decided; 2.6, 2.7 and 2.8(d,e,h) remain |
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
| f | `nutrition_events` template fallback (level 3) | §7 | 2.5 |
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

Session 3 is mostly the coach UI — this is where the feature becomes visible. The
backend landed in Session 2; do not rebuild it. TWO EXCEPTIONS, both client-facing and
both at the end: 3.8 (portal start-date countdown) and 3.9, which is NOT a UI task —
it adds a new /api/client/** goal endpoint with the full CONVENTIONS §9/§10 auth chain.
Budget for it as backend work, not a render tweak.

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
- ~~**The `nutrition_events` template fallback (level 3) is still unbuilt.**~~ → **Task 2.8(f).**

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
**Read from the code, NOT verified against the live rows.**

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
