# Client Journey — Goals, Blocks + Nutrition Builder — Execution Plan

**Status:** Session 0 ✅ SHIPPED + smoked 2026-08-10 (`c010741`, `f821a1e`) · seven sessions remain · **Owner decision date:** 2026-08-10
**Eight sessions.** Three largely independent features share this document. Each session is designed for a fresh Claude Code session with a full context window.

> **Canonical sources.** `CONVENTIONS.md` (stable coding rules) and `docs/ARCHITECTURE.md` (schema + data flow) win over this document on anything they cover. This document owns the *design decisions* for this workstream and the *sequence*. When this workstream lands, `ARCHITECTURE.md` must be updated and this file deleted (the precedent set by the training-builder, wellness-soreness and units-canonicalization plans).

> ⚠️ **DEV-vs-PROD caveat — applies to every live-data claim in this document.** The audits behind this plan queried the **linked DEV project** (`aeaphsslctwcmebldrzx`). **PROD (`etezzztgafcotyahgijk`) was never queried**, and prod has drifted from the migration tree before (see the memory note "Live catalog is SOT, not supabase/migrations"). Row counts, "zero duplicates exist", "no client has X", and `pg_depend = 0` are **DEV facts**. Schema-shape claims (an index exists, a column has no CHECK) are far more likely to hold across both, but any task that acts destructively on prod data — a `DROP COLUMN`, a backfill, a de-duplication — must re-run its probe against prod first.

---

## 1. What we are building, in one page

Three features. They ship largely independently; §5 states exactly what depends on what.

### Feature A — Blocks, and the Journey tab that renders them

A **block** is a named, contiguous stretch of a client's calendar carrying a coach's intent. It is a *label on time*, not a computation.

```
client_phases (id, client_id FK CASCADE, name TEXT, focus TEXT NULL,
               target_weight NUMERIC NULL, starts_on DATE, ends_on DATE,
               created_at, updated_at)
```

Contiguous, one at a time, ordered by `starts_on`. The coach enters a start date plus a list of durations in weeks; the service computes the chain, so **overlaps and gaps are structurally impossible**. No `phase_id` on any other table, no status column — current/past/future derive from today vs the date range.

**`focus` is free text** ("six weeks of a steeper deficit while training volume holds"). Nothing computes from it. It is the only representation of non-weight intents — strength blocks, adherence blocks, habit blocks all get a sentence, not a typed target. Label it **"Focus"** in the UI, prompt **"What's this block for?"** — never "Objective" or "Goal", which invite a number.

**`target_weight` is optional**, canonical kilograms like every other weight (`CONVENTIONS.md §20`), rendered in the viewer's unit. It drives a **pace readout only** — target, current, remaining, weeks left, ahead/behind. **Nothing calculates from it.** The nutrition calculator continues to solve against the long-term `client_goals` goal exactly as it does today. Wiring the calculator to a block target is explicitly deferred until a coach asks for it.

### Feature B — Goals get a home and one source of truth

Goals are the input everything else reads: the calculator solves against them, the block pace readout sits beside them, and Feature C's deficit input assumes they are trustworthy. Today they are neither trustworthy nor reachable — **the only goal editor in the product is mounted inside the nutrition builder drawer**, so setting a client's goal requires opening a nutrition plan.

`client_goals` is the right shape and stays: superseding rows, one active enforced by a partial unique index, typed columns, and `goal_start_date` (migration 104) already wired through `resolveEffectiveGoal` into the calculator. **No new goals table. No generic `target_type` / `target_value` / `target_unit` shape. No stored rate column.**

The work splits by urgency, not by theme. **Session 0 is one commit** — it stops the one thing in this document that is losing data right now. **Session 0b is everything else**, sequenced after the blocks feature ships.

### Feature C — Deficit as a first-class nutrition input

`calculateBaselineCalories` (`services/nutrition-service.ts:58`) is **deadline-driven**: `requiredDailyChange = totalCalorieChange / daysToGoal` (`:141`) is the *average* deficit across the remaining span. It is structurally impossible to get a deficit without a deadline (`:75-82` returns maintenance). A coach running a gentle four-week intro then a harder cut gets the same averaged number both times, overrides both times, and the calculator becomes decoration for them.

The fix is symmetry: **deadline and deficit are both first-class inputs, neither primary.** Enter a deadline, see the implied deficit. Enter a deficit, see the projected date. One equation, both directions. The deficit is **stored** so intent survives a recalculation when TDEE moves.

### Why there is no "block transition"

There is **no scheduler in this repo** — no `vercel.json`, no `app/api/cron`, no job runner. Everything date-driven fires on read. So current/past/future are derived from `today` vs `[starts_on, ends_on]` at every read, and **crossing a block boundary is a no-op**. No promotion, no activation, no archival, no race. This is also the only model that is correct for a client who does not open the app for three weeks.

The previous implementation (removed 2026-07-25, migration 133) failed structurally: "active" was a *status column* rather than a date derivation, `phase_id` was stamped onto 5 tables, and the transition archived the client's nutrition plan — deleting their forward calendar with no banner and no regeneration trigger. **None of those shapes may return.** Tag `roadmap-v2-pre-removal` is a layout reference only; its visual tokens predate Teal-Summit and must be re-authored from `docs/newdesignsystem.md`.

### What blocks deliberately do NOT do

They do not prescribe training. They do not restrict placement. They do not feed the calorie calculation. They do not carry a rate, a type enum, or a daily-targets grid. A block is a **name, a date range, an optional sentence, and an optional weight** — and everything the UI renders is derived from those four things plus data that already exists.

---

## 2. Invariants — do not violate without owner sign-off

1. **No `phase_id` (or `block_id`) column on any other table.** Attribution is a date-range join at read time.
2. **"Current" is derived from dates.** Never a status column, never a partial unique index on an active flag.
3. **Durations in, dates out.** The coach enters a start date plus a list of lengths; the service computes the chain. Overlaps and gaps are structurally impossible, so there is no overlap validation to write.
4. **Nothing computes from `focus`.** It is rendered and nothing else. The moment something parses it, it has become a typed field by accident.
5. **Nothing computes from `target_weight` except the pace readout.** It never reaches `calculateBaselineCalories`, `resolveNutritionCalcInputs`, or any nutrition write path. The calculator solves against `client_goals` only.
6. **Blocks are `DATE`**, not `TIMESTAMPTZ`. (`client_goals.effective_from` is the odd one out in this schema — do not copy it.)
7. **Blocks save independently of the goal.** `updateGoals` supersedes-and-inserts on **every** call with no change detection (`services/client-goals-service.ts:59`, `:98-107`); a block edit that touched it would mint a goal version and an audit event every time.
8. **Deleting a block shifts, never wipes.** Subsequent blocks move back by the deleted duration; the route returns the resulting date changes so the confirm dialog can name them. Elapsed blocks are read-only and are not offered a delete.
9. **Blocks are client-scoped rows**, not owned by any plan — they survive a training or nutrition plan delete.
10. **Elapsed blocks render.** Muted, but rendered — in the list, in the chart shading, and in the client's finished-blocks list. A coach looking at a past month must be able to see why the numbers changed. This is the entire "view past blocks" story.
11. **The nutrition save note is append-only and client-scoped.** No `UPDATE`, no `DELETE`, no plan FK on the delete path. Every note ever written stays readable. This is the property the Journey timeline needs and the one every existing note column lacks.
12. **The stored deficit is intent, not a result.** It records what the coach chose (a % of TDEE or an absolute kcal). The suggestion, the caps and the floor are recomputed from it; it is never overwritten by them.
13. **Caps and the floor gate the SUGGESTION, never the coach's typed number.** `services/nutrition-service.ts:147-166` (0.75/1.0 kg-wk loss, 0.35/0.5 gain by gender) and `:174-179` (1200/1500 kcal floor) stay exactly as they are. A coach may type lower. The app must *say* it capped, not silently do it.
14. **Coach-action rows are not alerts.** They render like the unreviewed-check-in row (thumb + title + meta + outline button), are **not dismissible**, and do **not** go through `evaluateAndSortTriggers`. They clear by the world changing.
15. **One migration number, taken at execution time.** Never pre-assign a number in this document. Slot 139 has already been burned once by a reverted commit (`dc9898c` shipped `139_update_client_goals_atomic.sql`; the live 139 is `139_nutrition_event_coach_note.sql`). As of 2026-08-10 the tree ends at `142_drop_check_in_tokens.sql`.
16. **One goal writer, one goal read path.** Every coach-side goal write goes through `updateGoals`; every coach-side goal read resolves through `resolveEffectiveGoal`. A second editor, or a direct `clients.*` goal read on a coach surface, is a regression. **Session 0 makes the single writer correct; Session 0b makes the read path single and gives the editor a home.** Until 0b lands, the surfaces it names are known exceptions, not oversights.

---

## 3. When a documented rule blocks the work

*(Verbatim from the previous revision. It works. Do not edit it.)*

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

## 4. Known doc collisions and required corrections

### Corrections that must land with the code

| Where | What is wrong | Fix |
|---|---|---|
| `ARCHITECTURE.md:74` | *"Callers: `services/nutrition-plan-orchestrator.ts` (plan creation), …"* — the orchestrator has **not** called `resolveEffectiveGoal` since it moved to `resolveNutritionCalcInputs` (`nutrition-plan-orchestrator.ts:178`). | Rewrite the caller list to the verified four: `app/api/clients/[id]/nutrition/route.ts:147`, `components/clients/metrics/hooks/use-merged-metrics.ts:99`, `services/comparison-service.ts:60`, `services/nutrition-calc-inputs.ts:109`. **Session 0, in Task 0.1's commit** — a one-line doc fix with no code dependency; there is no reason for it to wait behind the blocks feature. |
| `ARCHITECTURE.md:199` | Two stale claims in one sentence: it lists **`goal_source`** in the goal snapshot (dropped by migration 133:278) and describes **`p_recalc_snapshots`** (removed by 139:63-69 — those three columns are now unconditionally overwritten at 139:164-166). | Rewrite the sentence. **Session 1**, alongside the RPC change. |
| `ARCHITECTURE.md:545` | *"**No roadmap or phase concept exists.**"* — true today, false once Feature A ships. | Rewrite in Session 2, keeping the distinction that a *training* block ≠ a *journey* block. |
| `docs/CLIENT-PORTAL-EXECUTION-PLAN.md:1305, :1315, :1321` | Cites commit **`c2bc944`**, which is **not on main** — `git merge-base --is-ancestor c2bc944 HEAD` fails and `git branch --contains` is empty. It is a dangling pre-rebase object. | Repoint all **three** occurrences to `cb2165b` (identical message, author and `--stat`). **Session 3**, when the chart is touched. |

### Rule collisions to expect

| Where | Rule | Class | What to do |
|---|---|---|---|
| `CONVENTIONS.md §2` | *"Don't add … performance optimizations unless explicitly requested"* | n/a | The Session 1 cascade change **is** explicitly requested by the owner (2026-08-10). Not a deviation. |
| `CONVENTIONS.md §2` | *"One fix per change"* | **(a)** | Comply *within* a session: each numbered task is its own commit. Sessions bundle tasks; commits do not. |
| `CONVENTIONS.md §3` | *"Forms use React Hook Form with `zodResolver(schema)` and `defaultValues`"* (`:164`) | **(a)** | The existing `client-goal-editor.tsx` uses six raw `useState` calls and predates the rule. The Session 0b editor complies; do not copy the old one. |
| `CONVENTIONS.md §4` | File size limits | **(a), soft** | Explicitly guidelines. Split only at a natural boundary (block row / block form / pace readout), never by prop-drilling one flow across files. |
| `CONVENTIONS.md §5` | *"No `as any` type casts"* | **(a)** | `services/nutrition-plan-service.ts:85` and `:117` cast the RPC arg object `as never` **twice**, so tsc verifies nothing about the 24 keys. Session 5 changes the arity and **must** remove those casts — see Task 5.1. |
| `CONVENTIONS.md §8` | New table → `ENABLE ROW LEVEL SECURITY`, **no policies**, `GRANT ALL … TO service_role` | **(a)** | Comply exactly (`CONVENTIONS.md:360-366`). `npm run check:rls` reads the live catalog and derives the table set at runtime (`scripts/assert-rls.ts:57`), so no allowlist needs updating. |
| `CONVENTIONS.md §8` | Timestamps: `created_at`, `updated_at` on all tables | **(b), narrow** | `nutrition_plan_notes` is an immutable event table and deliberately skips `updated_at` — the documented exception (`CONVENTIONS.md:384`, precedent `body_metrics`). Add the explaining comment. |
| `docs/newdesignsystem.md` → Typography | Mono = numbers only; `npm run check:labels` fails the build on raw `font-mono-display` | **(a)** | Block **names** are sans even with digits ("Cut 2") — the digits belong to the name. Dates, week counts and weights are mono via `MONO_LABEL_CLASS`. |
| `docs/newdesignsystem.md` | *"never `ConfirmDialog`/AlertDialog — un-migrated OKLCH"* | **(a)** | The delete-block confirm uses the styled `Dialog` per the destructive-confirm recipe (`newdesignsystem.md:417-421`). |

### Premises that were checked and are FALSE — do not plan around them

- **There is no label-less `SectionLabel` variant.** `label: string` is required (`components/programs/shared/section-label.tsx:19`). What exists is a hand-rolled copy of the same silhouette in `calendar-toolbar.tsx:55` + `:93` and `nutrition-calendar-toolbar.tsx:49`.
- **There is no `lib/builder-tokens.ts`.** The module is `components/clients/training/program-builder/builder-tokens.ts` (19 exports), one of exactly two sanctioned token modules (`scripts/check-labels.ts:32-35`).
- **There is no colour-swatch or colour-picker UI anywhere in the repo**, and `builder-tokens.ts:44-45` records an owner decision *against* category→colour mapping. Block colours must be a **static palette indexed by block position**, following the `METRIC_COLORS` discipline (`components/training/exercise-data/exercise-trend-chart.tsx:43-51`: *"the hue carries identity across visits, not simultaneous contrast"*). No picker.
- **There is no first-name helper.** `clients` has one `name` column (`types/database.ts:793`). The only `firstName` in the repo is a local const at `components/coach/client-activation-dialog.tsx:54`; every other `.split(" ")` computes avatar initials. "Visible to \<first name\>" needs a new shared util.
- **`components/ui/progress.tsx` is not usable as-is.** Three consumers, none on the Overview or the portal, and it is themed with shadcn `bg-primary` tokens rather than Teal-Summit hex. The in-repo precedent for a hex-themed bar is a **hand-rolled div** (`components/check-in/weight-goal-card.tsx:163`); `newdesignsystem.md` documents no progress component.
- **`MetricTrendChart` is already a coach-side fork**, not a neutral-tier component (`components/clients/metrics/metric-trend-chart.tsx:26` — *"Generic entry-series fork of exercise-trend-chart.tsx"*). Only the card shell it wraps (`components/training/exercise-data/exercise-chart-card.tsx`) is neutral. "Extend, do not fork" applies to that fork: extend it, do not fork it a second time.
- **`client-goal-editor.tsx` is not "four `useState`".** It is 269 lines holding **two** components — an inline read-only summary (`ClientGoalEditor`, `:61-108`) and the dialog (`GoalEditDialog`, `:118-269`) — with six `useState` calls between them. The spirit of the objection stands (raw state, no react-hook-form); the shape does not.
- **`getGoalsHistory` does not have "zero readers".** It has exactly one production call site — the `?history=true` branch of the goals GET (`app/api/clients/[id]/goals/route.ts:34`). What is true is that **nothing in the product ever requests `?history=true`**, so the branch is unreachable in the running app.

---

## 5. Session map

Listed in execution order.

| Session | Theme | Migrations | Ships user-visible change? |
|---|---|---|---|
| **0** ✅ | Goals: stop the live data loss — **SHIPPED + smoked 2026-08-10** | none | No — one correctness commit |
| **1** | Foundations: the cascade, the energy helper, the plan-row date lie | **1** (RPC body swap, same arity) | The nutrition hero |
| **2** | Blocks backend: table, service, routes | **1** (`client_phases`) | No — API only |
| **3** | Journey tab: rename, Blocks list, chart shading | none | Yes — the coach block feature |
| **4** | Client-facing block + the "Waiting on you" row | none | Yes — the client block feature |
| **0b** | Goals: one read path, one writer, one editor, history | none | Yes — the goal editor |
| **5** | Nutrition builder: deficit as a first-class input | **1** (`nutrition_plans` + RPC arity) | Yes |
| **6** | The save note + the Journey timeline | **1** (`nutrition_plan_notes`) | Yes |

### What actually depends on what

Read this before assuming the order above is forced. It mostly is not.

- **2 → 3 → 4.** A real chain: each needs the previous one's API. This is the only hard chain in the document.
- **5 → 6.** The note lives beside the deficit in the same drawer.
- **1.2 → 5.** Session 1's shared energy helper is the deficit input's prerequisite, and Session 5 assumes the two dead calculator exports are already gone.
- **0b.1's DECISION → 4.2 — a decision dependency, NOT a code dependency.** Task 4.2 needs one authoritative answer to: *is `clients.goal_deadline` mapped, or are the three dead `?? client.goalDeadline` fallbacks deleted?* It does **not** need 0b.1's Overview code to have shipped. The question can be settled in isolation, in a sentence, without touching a file. **If 0b has not run, Session 4 settles it and records the answer in its STATUS block; 0b then inherits that decision rather than re-litigating it.** An executor who reads this as "Session 4 is blocked on a UI change" has misread it — Session 4 is blocked on nothing.
- **0 → 0b, softly.** 0b inherits Session 0's `notes` decision from its STATUS block, and consolidating readers onto a write path that still nulls sibling fields would be premature. Not a hard block.

**Sessions 2–4 are otherwise fully independent of Sessions 0, 0b and 1.** Blocks touch the goal layer in exactly one place: the **pace readout** (Task 2.3, rendered by 3.2 and 4.1), and even that is driven by the block's own `target_weight` column rather than by `client_goals`. **Drop the pace readout and the dependency disappears entirely** — so the blocks feature can ship first if the owner chooses.

**Nothing gates everything.** Session 0 is one commit that stops active data loss; it earns the front slot on urgency, not on dependency.

---

# SESSION 0 — Stop the live data loss ✅ COMPLETE

> **SHIPPED + browser-smoked 2026-08-10** — `c010741` (fix) and `f821a1e` (smoke record).
> The session brief below is kept as-authored for provenance; **the STATUS block in §8 is
> authoritative** for what actually shipped, the decisions it closed, and the two items it
> hands to Session 0b. Read that, not this, before touching the goal layer.

**Zero migrations. ONE task, one commit.**

This session exists for a single reason: `services/client-goals-service.ts:79` is losing goal data **right now**, on a path a coach hits during ordinary intake review. Everything else in the goal layer — the read path, the editor's home, the mirror consolidation, the history decision — is deferred to **Session 0b**, which runs after the blocks feature ships. That deferral is deliberate; this task is not deferred because it is the only thing in this document corrupting data today.

### What the audit found — briefing for Session 0 AND Session 0b

> A read-only audit with adversarial verification produced these. **Session 0b re-reads this block** rather than duplicating it. **Every live-data claim was run against DEV** (`aeaphsslctwcmebldrzx`); prod was never queried and has drifted before. Schema-shape claims are robust; row counts and "no client has X" are DEV facts.

**`primary_goal` is dead weight, and it is the generic-target shape arriving by accident.** Free `TEXT`, no CHECK, no enum, no default (`060:17`). **Zero branches anywhere** — three sites touch it and all three are a row→domain map (`client-goals-service.ts:14`), a carry-forward that reads it only to write it back unchanged (`:95`), and a test. It is absent from `ClientGoalInput` (`lib/goals/resolve-effective-goal.ts:31-37`), the contract every goal consumer funnels through. No production code originates a value: the goals PUT schema accepts it (`lib/validations/client-goals.ts:32`) but no UI sends it, and migration 060's backfill omits the column. Every non-null value came from a seed script. **Do not build on it, and do not drop it here** — `client-goals-service.ts:93-95` puts the key in the INSERT unconditionally, so a bare `DROP` PGRST204s every goal write. Costed in §7.

> Note the near-miss: `client_intake.primary_goal` is a *different column* and IS a live discriminator — three real branches at `intake-step-2.tsx:42-43` and `lib/validations/intake-steps.ts:157-166` / `:247-256`. Do not conflate them; do not "unify" them.

**`goal_body_fat_percentage` is a second solvable target that already contradicts the first, on screen, today.** Four independent solvers each compute their own reached / to-go / percent-complete verdict — `client-status-card.tsx:173-178` (via `goal-state.ts`), `comparison-service.ts:266-293`, `use-merged-metrics.ts:134-141`, `goals-section.tsx:38-40` — and nothing reconciles them. **Zero prescriptive consumers:** `nutrition-service.ts` has no body-fat term at all, `nutrition-calc-inputs.ts` reads it and drops it (`:112-113` vs `:120-132`), `detectGoalDrift` ignores it, `computeGoalPace` is weight-only, and BMR picks its formula from **current** body fat, never the goal (`bmr-service.ts:141`, branch at `:37-49`). There is no lean-mass or fat-mass model anywhere in the repo, so goal body fat cannot be converted into a goal weight — the two targets are structurally irreconcilable. **Keep the field wherever it appears. Do not make it solvable, and do not let it into any calculation.** The live contradiction is recorded in §7 and is not this workstream's to fix.

**`getCurrentGoals`' missing `ORDER BY` is covered, but it is masking two defects that are real.** `idx_client_goals_active_unique` is verified alive against the live catalog, exactly as authored (`060:26-28`), never dropped or altered by any later migration, with zero duplicate active rows in DEV data — so `maybeSingle()` can never see two rows and the missing ordering cannot bite today. What the index does **not** cover is in §7. If the index were ever dropped, the failure is not a wrong answer but a permanent wedge: two active rows make `getCurrentGoals` throw `PGRST116` forever, which 500s the goals GET, **blanks the entire nutrition tab** (`nutrition/route.ts:87` sits in an unguarded `Promise.all`), and kills `updateGoals` itself — its first statement is that same call, so the set-based supersede that *would* heal the duplicate is unreachable. No in-app recovery; a human runs SQL.

**The `clients.*` mirror is genuinely wrong, and none of it is here.** Making `updateGoals` its sole writer is **Session 0b, Task 0b.2** (4 files, ~14 lines). Full removal is ~21 production files, 12 test files, 3 scripts, 4 docs and a migration — its own workstream, costed in §7.

---

### Task 0.1 — Goal service: presence must mean "present and not undefined" ✅ SHIPPED

*(This fix already shipped once. `d58120c` reverted it as collateral of removing an unrelated feature; `git show 53abf0a` is the exact one-line diff plus three tests. Read it first — do not re-derive.)*

`services/client-goals-service.ts:78-79` merges on `Object.prototype.hasOwnProperty.call(goals, key)`, which is **true for an explicitly-`undefined` key**, so that key takes the `goals.X ?? null` branch and writes NULL.

- Via `PUT /api/clients/[id]/goals` this is **safe** — zod omits absent optional keys, and the only UI writer sends a fixed four-key literal of explicit values or explicit nulls (`client-goal-editor.tsx:171-176`).
- Via callers that build object literals it is **not**. **Three** live clobber sites, in order of how often they fire:
  - **`services/intake-review-service.ts:206-215` — the worst, and the one to lead with.** Its surrounding syncs are "only if currently null" guards (`:153-161`), so the case where only `goalBodyFatPercentage` lands in `updates` is exactly the case where the client **already has** a goal weight. It is also a three-key literal, so it can null `goal_deadline` too.
  - `services/client-service.ts:279-288` (`updateClient`).
  - `app/api/clients/[id]/metrics/route.ts:209-218`.
  - `services/client-service.ts:104-113` (`createClient`) builds the same shape but is **vacuous** — `getCurrentGoals` returns null for a brand-new client, so both merge branches evaluate to null. **If your plan says four clobber sites, it is wrong.**
- **The guarded mirror writes are actively defeated.** All three harmful callers correctly guard their direct `clients.*` write with `!== undefined` (`metrics/route.ts:126-132` → `:177`; `client-service.ts:236-237` → `:241`; `intake-review-service.ts:153-161` → `:179`) — and then `updateGoals`' own unguarded dual-write at `:115-123` overwrites those same columns with the NULLed `merged` values later in the same request. There is no surviving copy to reconcile from. Fixing the callers' literals would be a band-aid; the root is line 79.

**Fix:** `has()` becomes `hasOwnProperty(...) && goals[key] !== undefined`. Explicit `null` still clears (null ≠ undefined), so the goals PUT is unaffected.

**Also add the ordering belt** while you are in `getCurrentGoals` (`:27-32`): `.order("effective_from", { ascending: false }).limit(1)`. EXPLAIN against the live catalog confirms it uses the existing `idx_client_goals_client_effective` (`060:30-31`) at no cost. **Know its hole and record it:** `effective_from` is not unique and two racing writers stamp the same `new Date().toISOString()` millisecond (`:53`), so on a tie the pick is arbitrary. This converts a permanent wedge into a wrong-but-recoverable answer. It is insurance, not a fix — the fix is atomicity (§7).

**`notes` — decision required, do not just "fix" it.** `notes` is not merged, not in the insert, **and not in the `goals` parameter type** (`:44-50`), so no caller can set or clear it. Because `client_goals` supersedes rather than updates, **nothing is destroyed** — the superseded row keeps its notes forever and `getGoalsHistory` still returns it. Only the *current* row reads NULL after any `updateGoals` call. Its only writers repo-wide are the migration-060 backfill and the seed scripts. `53abf0a`'s message records the owner's reasoning for **not** carrying it forward: *"Carrying it forward would contradict per-row `set_by` and create an unclearable ratchet."* **Follow §3 and ask** — state the collision with the recorded decision and get a yes. Record the answer in the STATUS block; Session 0b inherits it.

**Doc fix, same commit:** correct `ARCHITECTURE.md:74`. Its `resolveEffectiveGoal` caller list is stale — the orchestrator no longer calls it directly, going through `services/nutrition-calc-inputs.ts:109` instead. **Re-derive the list yourself**; this document's predecessor had it wrong too. It rides here rather than in Session 0b because it is one line of prose with no code dependency, and there is no reason for it to wait behind the blocks feature.

**Tests:** the existing test at `services/client-goals-service.test.ts:166` passes keys **absent**, exercising the `else` branch that already works; the string `undefined` appears **zero times** in the 295-line file. Add the real caller shape (`{ goalWeight: undefined, goalBodyFatPercentage: 22 }`) and a **mirror-payload pin** — `:130` currently asserts only `toHaveBeenCalled()`, never what with. `53abf0a` added three such tests; re-apply them. **Do not lift them from `dc9898c`**, which rewrote the file around an `update_client_goals_atomic` RPC mock; that RPC and its migration no longer exist.

### Session 0 verification

- `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`, `npm run check:labels`. **No migration**, so no `check:rls`, no `db push`, no `gen types`.
- New tests: the goal-merge caller shape **and** the mirror payload; the ordering belt returning the newest row.
- **Browser smoke (owner runs it) — ✅ PASSED 2026-08-10; full evidence and the exact recipe are in the Task 0.1 STATUS block.** The setup is NOT one intake pass, and "body fat" is ambiguous here: the client needs a goal weight **already set** and **no goal body fat**, while the intake carries a value in **step 2's "Goal body fat %?"** field (not step 1's *current* body fat). Then "Sync metrics to profile" and confirm the goal weight survives. Verify via the `client_goals` row count increasing by one — otherwise `updateGoals` never ran and the test proved nothing.

---

### 📋 SESSION 0 PROMPT — paste this into a fresh session

```
Read these in full before planning anything:
  1. CONVENTIONS.md  (mandatory — it says so at the top; do not skip sections)
  2. docs/ARCHITECTURE.md
  3. docs/CLIENT-GOALS-PHASES-EXECUTION-PLAN.md — §1, §2 (invariants), §3, §4, §5, and
     all of SESSION 0 including "What the audit found". You are executing SESSION 0
     only. SESSION 0b exists and runs AFTER Session 4 — do not pull any of its work
     forward, including the goal editor and the Overview read path.

Session 0 is ONE task and ONE commit: services/client-goals-service.ts:79. It is the
only thing in the whole plan document that is losing data right now, on a path a coach
hits during ordinary intake review.

This fix already shipped once and was reverted as collateral. Before writing anything:
  git show 53abf0a   # the exact one-line diff plus its three tests
  git show d58120c   # the revert, which lists it as "worth re-landing on its own"
Do NOT lift tests from dc9898c — it rewrote the file around an RPC that no longer exists.

What the task is:
  - `has()` becomes hasOwnProperty(...) && goals[key] !== undefined.
  - Add the ordering belt to getCurrentGoals: .order("effective_from", {ascending:
    false}).limit(1). Record its hole — effective_from is not unique, so a tie is
    arbitrary. It is insurance against a dropped index, not a fix for the write race.
  - Correct ARCHITECTURE.md:74 in the same commit (its resolveEffectiveGoal caller
    list is stale — the orchestrator no longer calls it). Re-derive the list yourself.
  - Re-apply 53abf0a's three tests, including the mirror-payload pin.

THREE live clobber sites, not four. createClient is vacuous — getCurrentGoals returns
null for a brand-new client, so both merge branches evaluate to null. Lead with
intake-review-service.ts:206-215; it is the one that fires in the common case.

One decision I must make, not you:
  - The `notes` carry-forward is a CLOSED owner decision (53abf0a). Follow §3: quote
    it, state the collision, and STOP AND ASK ME. Record my answer in the STATUS block
    — Session 0b inherits it.

Rules for this session:
- Follow CONVENTIONS.md §2: show me a plan and get approval before writing any code.
- ONE commit. If you find yourself touching a component, you have left the task.
- Do NOT build a goal editor, do NOT change what the Overview reads, and do NOT touch
  the clients.* mirror writes. All three are Session 0b.
- Commit-ready means all of CONVENTIONS.md §13.
- Append a STATUS block to the plan doc when it lands.

Start by reading the documents and the two commits, then show me your plan.
```

---

# SESSION 1 — Foundations

**One migration.** Task 1.1 is a partial re-land of work that already shipped and was reverted as collateral; read `git show 3abbfa5` before writing anything. Tasks 1.2 and 1.3 are new.

> **The revert you are undoing.** `d58120c` ("revert(goals): remove the client goals + blocks implementation") reverted `3abbfa5` (Task 1.1's full fix) as collateral of removing a feature it did not belong to, and `d58120c`'s own message lists it as *"worth re-landing on its own if wanted"*. `d83f707` (2026-08-05) re-landed a subset.

### Task 1.1 — Cascade: close the no-row window on the narrow paths

`d83f707` fixed two of the three defects and left the third:

- ✅ **Unbounded DELETE** — `.lte("date", endDate)` added.
- ✅ **Delete-then-bail** — the guard was hoisted above the DELETE (`:232`). *(It is now dead code: `calculateNutritionEndDate` unconditionally returns `fromDate + 56`, so the condition can never be true. That is fine — the defect is closed by construction.)*
- ❌ **The no-row window.** The DELETE at `services/nutrition-event-service.ts:255-263` and the upsert at `:207-209` are in different functions with **exactly four network round trips** between them and no transaction: `:268-272` (plan row), `:277-280` (daily targets), `:72` → `services/training-event-service.ts:217-223` (training events), `:180-185` (protected-days read). Every date in the window has **no row** for that whole gap, and `getPlanTargetForDate` returns `null` on a missing event (`services/daily-context-service.ts:44-45`) — the level-3 template fallback was never built.

**Rescoped fix — narrow paths only.** The five narrow routes should **pure-upsert with no DELETE**, which closes the window for them as a side effect. `onConflict: "client_id,date"` already overwrites and the application-level `protectedDates` filter (`:189-201`) already skips the same `is_modified` rows the DELETE does.

Three of the four narrow call sites already have their exact dates and throw them away: `moveEvent` returns `{sourceDate, targetDate}` (`services/training-event-calendar-service.ts:41-46`) and `move/route.ts:63-64` collapses it to `min()`; `updateEventSurplus` returns `{date}` (`:151-155`) and `events/[eventId]/route.ts:69` passes it as a floor; `duplicate/route.ts:59` has `targetDate`. Only `deleteEvent` (returns void, `:186-190`) and the two session handlers need service-layer changes.

**Four things the rewrite must preserve or it silently destroys data:**

1. The DELETE also carries `.is("coach_note", null)` — added **after** `d83f707` by `0163705`. `coach_note` has an **independent** survival predicate that `note` does not. Preserve it plus the carry-forward re-supply at `:192-201`, or every coach note in the window is erased on the next training edit.
2. `services/nutrition-event-edit-service.ts:174` and `:204` call `regenerateFutureNutritionEvents` **directly**, bypassing the cascade helper, and depend on a hard ordering — they clear `is_modified` *before* regenerating **because the DELETE only removes `is_modified = false` rows**. Replacing the DELETE with a pure upsert changes what that ordering means. Re-verify both reset paths.
3. The upsert is scoped to `client_id` while the DELETE is scoped to `nutrition_plan_id`. An event owned by a *different* plan inside the window survives the delete and is silently rewritten (including its `nutrition_plan_id`) by the upsert. Only the `is_modified` half of this is documented (`:165-169`).
4. `scripts/backfill-nutrition-events.ts:68` and `scripts/seed-scale-client.ts:425` call `generateNutritionEvents` directly with the `(startDate, endDate)` pair. Any signature change breaks both.

**Landmine, unchanged:** `training_events.calorie_surplus_percentage` must keep being populated by every training event-write path. One dropped write silently falls nutrition back to rest-day calories while the TRAIN badge still renders. Do not touch that.

**Also record, do not fix here:** `cascadeNutritionAfterTrainingChange:349-351` swallows every regeneration failure into `captureApiError`, and `:340-345` does not destructure `error`, so a failed plan lookup is indistinguishable from "no active plan". Both violate `CONVENTIONS.md §12` and the repo's destructure-and-log rule. Log them in the STATUS block.

### Task 1.2 — One shared energy helper

**Prerequisite for Session 5.** Today `7700` exists as an inline magic number at three sites in the calculator (`services/nutrition-service.ts:138`, `:154`, `:161`) and as a function-body local `CALORIES_PER_KG` in the browser (`hooks/use-nutrition-builder.ts:278`), re-created every render, with no caps and no floor.

- Extract one shared pure helper module owning the constant and both directions: **rate → daily calorie delta** and **daily calorie delta → rate**. Per `CONVENTIONS.md §3`, the constant belongs in `lib/constants.ts`.
- **Delete `getProjectedDate`** (`hooks/use-nutrition-builder.ts:280-301`). It is returned as `projectedDate` at `:343` and has **zero consumers repo-wide**; it is the only reason the duplicate constant exists. It also reads the stale mirror (`client.goalWeight`/`currentWeight`/`tdee`) instead of the server-resolved `calcInputs` the rest of the hook uses, so if anyone ever wired it up it would disagree with the preview. *(Session 0b Task 0b.3 also names this deletion — whichever session runs first does it, and the other confirms.)*
- **Two dead exports sit in the file you are editing** and one is a trap: `calculateAdjustedTDEE` (`:193-201`) and `calculateTargetCalories` (`:206-225`) have zero callers in production *and* in tests. `calculateTargetCalories` calls `calculateBaselineCalories` **without** `calcStartDate`/`today`, so routing the new entry point through it silently loses future-start and client-timezone handling. Delete both, or leave both and say why — do not build on them.
- **Real bug in this surface, fix it here:** when the calorie floor fires (`:174-179`) it raises `baselineCalories` but does **not** recompute `requiredDailyDeficit` or `weeklyRate`, which return unchanged from `:171`/`:145`. The builder renders both (`nutrition-targets-block.tsx:146-167`), so a floored plan shows e.g. "TDEE 2000 · −900/day · −0.82 kg/week" beside a 1500 kcal target that only implies −500/day. The two safety *caps* at `:152-166` correctly recompute; the floor is the odd one out.

**Do not add a stored rate column to `client_goals`.** Goal stores target + deadline; the rate is derived. A stored rate would let three facts disagree. (Session 5 stores a *deficit* on `nutrition_plans` — a different thing: the coach's chosen intent for the plan, not a property of the goal.)

**Already true, do not rebuild:** `calculateBaselineCalories` already handles a future start — `startDate = max(localMidnight(calcStartDate), now)` at `:115-117`, comment at `:85`. Earlier revisions of this document cited `:96-98` and quoted a "phase" comment; both are stale, the wording was scrubbed to "goal".

### Task 1.3 — The plan row must stop lying about when its numbers took effect

**Verified against the live catalog, not just the migration file.** The live RPC is migration 139's 24-arg `create_nutrition_plan_atomic` (`139:73-193`). Its `ON CONFLICT (client_id) WHERE status = 'active'` `DO UPDATE SET` has **22 assignments** (`139:146-168`) and **`effective_from` is not among them** (never-update set: `{id, client_id, name, status, effective_from, created_at}`).

Consequence, for any client with an existing active plan:

- A future `p_effective_from` is transmitted (`services/nutrition-plan-service.ts:108`), accepted by the route (only *past* dates are rejected — `nutrition-plan-orchestrator.ts:169-173`), and then **silently discarded** on the conflict path.
- Meanwhile **every target column overwrites immediately** (`139:147-166`), and the 7-row weekday grid is unconditionally DELETEd and re-INSERTed (`139:174-189`). The plan-level template is future-dated in intent and present-tense in storage.
- `scheduledFor` is computed as `plan.effective_from > clientToday` (`app/api/clients/[id]/nutrition/route.ts:185`), so it can **never** be non-null for an existing plan. The hero's queued branch (`components/clients/nutrition/nutrition-plan-hero.tsx:65-69`) is unreachable except on a first insert, and `:47` renders "Active since \<original creation date\>" forever.
- `buildDailyTargetsFromPlan`'s no-event-day branch (`utils/build-daily-targets.ts:124-140`) therefore serves **future numbers today**.

**The events are already correct** — `regenerateFutureNutritionEvents` deletes and regenerates only from `effectiveFrom`, so days before it keep their old rows. Events are the SOT; only the plan row's metadata and the two plan-derived readers are wrong.

**Fix (recommended):** `effective_from` stops meaning "when this plan was born" and starts meaning **"when the current numbers took effect"** — which is what both hero branches already assume.

1. Migration: `CREATE OR REPLACE` at the **identical 24-arg signature** (a body swap — no new overload, no arity trap) adding `effective_from = EXCLUDED.effective_from` to the `DO UPDATE SET`. The plan's true birth date is already preserved in `created_at`, which the RPC never touches (`139:116`).
2. Gate the plan-template fallback: `buildDailyTargetsFromPlan` returns no plan-derived target for a date **before** `plan.effective_from`.
3. **Enumerate every reader of `nutrition_plans.effective_from` before you change its meaning** — the two known ones are `route.ts:181` and `:185`, but `services/client-portal-service.ts:102-109` selects `*`. Do not assume the list.

Accepted behaviour change, name it in the STATUS block: regenerating today makes the hero read "Active since today". That is true — the numbers changed today.

**Rejected alternative:** a `pending_effective_from` column. It re-introduces exactly the queued-status shape invariant 2 exists to forbid, and needs a scheduler this repo does not have.

### Session 1 verification

- `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`, `npm run check:labels`, plus `npm run check:rls` (a migration ran).
- Migration workflow per `CONVENTIONS.md §8`: `npx supabase db push` → `npx supabase gen types typescript --linked > types/database.ts` → skim the diff → **commit migration and types together**. `db push` is blocked by this environment's command classifier — ask the owner to run it with `!`.
- New tests: a narrow-path cascade writing only its own dates and leaving neighbours' `updated_at` untouched, plus `coach_note` survival (1.1); the rate↔deficit round trip and the floor recomputation (1.2); the RPC key list still `toHaveLength(24)` and the conflict path advancing `effective_from` (1.3).
- **Browser smoke (owner runs it):** move a training event and confirm nutrition updates on both the moved-from and moved-to days and nothing else changed; then regenerate a plan with a future apply date and confirm the hero reads "Starts \<date\>" and today's targets are unchanged.

---

### 📋 SESSION 1 PROMPT — paste this into a fresh session

```
Read these in full before planning anything:
  1. CONVENTIONS.md  (mandatory — it says so at the top; do not skip sections)
  2. docs/ARCHITECTURE.md
  3. docs/CLIENT-GOALS-PHASES-EXECUTION-PLAN.md — read §1 (design), §2 (invariants),
     §3 (what to do when a doc rule blocks you), §4 (doc collisions AND the list of
     premises that were checked and are FALSE), §5 (what actually depends on what),
     and all of SESSION 1. You are executing SESSION 1 only.

Session 1 is three fixes to code that exists today, plus ONE migration. Task 1.1
already shipped in full and was reverted as collateral of an unrelated removal, then
partially re-landed. Before writing anything:
  git show 3abbfa5   # the full fix (only a subset was re-landed by d83f707)
  git show d83f707   # what was actually re-landed
  git show d58120c   # the revert, which lists it as "worth re-landing on its own"
Do not re-derive what those commits already worked out.

  1.1  Narrow-path cascade: pure-upsert with no DELETE, closing the no-row window.
       Preserve the `.is("coach_note", null)` predicate and the carry-forward, and
       re-verify the two reset paths that depend on delete-ordering.
  1.2  One shared energy helper (both directions), delete the dead getProjectedDate
       and the two dead calculator exports, and fix the floor not recomputing the
       rate. Do NOT add a stored rate column to client_goals.
  1.3  ONE migration: CREATE OR REPLACE create_nutrition_plan_atomic at the IDENTICAL
       24-arg signature so effective_from advances on the conflict path. Enumerate
       every reader of that column before changing what it means.

Rules for this session:
- Follow CONVENTIONS.md §2: show me a plan and get approval before writing any code.
- One commit per numbered task, except the migration + regenerated types, which go in
  the SAME commit per CONVENTIONS.md §8.
- Take the NEXT FREE migration number at execution time. Never pre-assign one: slot 139
  was already burned once by a reverted commit.
- Follow the §8 migration workflow exactly. Never paste schema SQL into Studio.
  `npx supabase db push` is blocked by the command classifier here — tell me and I
  will run it.
- If a rule in CONVENTIONS.md or docs/ARCHITECTURE.md blocks you, follow the procedure
  in §3: quote it with file:line, state the collision, classify it, and either comply,
  update the doc in the same commit, or STOP AND ASK ME.
- Commit-ready means all of CONVENTIONS.md §13, plus npm run check:rls.
- Do not touch training_events.calorie_surplus_percentage population in any write path.
- Also fix ARCHITECTURE.md:199 in Task 1.3's commit (goal_source was dropped by
  migration 133; p_recalc_snapshots was removed by 139).
- Append a STATUS block to the plan doc as each task lands.

Start by reading the three documents and the three commits, then show me your plan for 1.1.
```

---

# SESSION 2 — Blocks backend

**One migration. Backend and API only — nothing user-visible ships.**

### Task 2.1 — Migration: `client_phases`

```sql
CREATE TABLE IF NOT EXISTS public.client_phases (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  focus         TEXT,
  target_weight NUMERIC,          -- kilograms, always (CONVENTIONS §20)
  starts_on     DATE NOT NULL,
  ends_on       DATE NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_client_phases_client_start
  ON public.client_phases (client_id, starts_on);

ALTER TABLE IF EXISTS public.client_phases ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.client_phases TO service_role;
COMMENT ON COLUMN public.client_phases.target_weight IS 'Kilograms, always';
```

- **The table name is `client_phases`; the coach-facing noun everywhere else is "block."** Routes, types and UI say block. Put that divergence in a table comment so nobody "consistency-renames" one half.
- **No `duration_weeks`** (derivable from the dates — one truth). **No `position`** (order by `starts_on`; a second ordering source can disagree with the first). **No status.** **No `daily_targets`.** **No rate.**
- The name is confirmed free: zero occurrences of the substring "phase" in `types/database.ts`; migration 133 dropped `phase_id` from all five tables (`133:273-277`) and dropped `public.phases`/`public.roadmaps` (`:289-290`). The only surviving `client_phases` string in `supabase/` is a policy *name* on the dead `phases` table (`064:71`).
- RLS + GRANT exactly per `CONVENTIONS.md:360-366`. Precedent: `108_create_audit_logs.sql:37`, migrations 122/125/126, `134_create_client_notes.sql`.

### Task 2.2 — Block service

Takes an explicit `clientId` scope and filters on it (`CONVENTIONS.md §8` service-layer contract).

- **Computes the chain from a start date + a list of durations** (invariant 3). The caller never sends date pairs. `ends_on = starts_on + weeks*7 - 1`; the next block's `starts_on = previous ends_on + 1`.
- Use `addDaysToDateString` (`lib/date-helpers.ts:293-297`, UTC-anchored). **Do not** copy `calculateNutritionEndDate`'s `new Date(x + "T00:00:00")` pattern (`services/nutrition-event-service.ts:311-316`) — it is server-local and can duplicate or skip a date across a DST boundary.
- **Refuses to modify an elapsed block** (`ends_on < clientToday`), mirroring the amendment surface's locked-slot rule.
- **On delete: shifts subsequent blocks back** by the deleted duration and returns the resulting date changes so the route can report them.
- "Today" is the **client's** calendar day — `getClientTodayString` (`services/today-service.ts`), per the locked timezone model (`ARCHITECTURE.md:473-480`). Never `CURRENT_DATE`.

### Task 2.3 — Derived reads

Three pure derivations, all from dates. Unit-test each.

| Derivation | Rule |
|---|---|
| `state` | `current` if `starts_on <= today <= ends_on`; `past` if `ends_on < today`; `future` otherwise. Never stored. |
| `weekOfTotal` | `floor(daysBetween(starts_on, today)/7) + 1` of `ceil(days/7)`. Only for the current block. |
| `pace` | Only when `target_weight` is set: `{ targetKg, currentKg, remainingKg, weeksLeft, expectedKg, delta }` where `expectedKg` interpolates linearly from the block's start weight to `target_weight`. Sign of `delta` gives ahead/behind. Returns `null` — never a fabricated zero — when there is no weight at or before `starts_on`. |

> **The pace readout is the only place Feature A touches the goal layer**, and even here the target is the block's own `target_weight`, not `client_goals`. See §5: dropping it removes the dependency on Sessions 0, 0b and 1 entirely.

### Task 2.4 — Routes

`GET` / `PUT` / `DELETE /api/clients/[id]/blocks` — full `CONVENTIONS.md §9/§10` chain: `coachApiRateLimit` → `requireCSRFProtection` → `getAuthenticatedCoachId(request)` → **ownership check** → zod → service. Audit-log the writes (`recordAuditEvent`, `void`-prefixed, after the authorized write, action names in `AUDIT_ACTIONS`).

- **This route must never call `updateGoals`** (invariant 7).
- `target_weight` crosses the wire as **canonical kg** (`CONVENTIONS.md §20`, `ARCHITECTURE.md:422`). No unit tag, no conversion at the API boundary.
- `PUT` takes `{ startsOn, blocks: [{ id?, name, weeks, focus?, targetWeightKg? }] }` — the whole chain, so the service can recompute it in one place. Reject a shrink that would move an elapsed block (422).

### Task 2.5 — Doc update

Rewrite `ARCHITECTURE.md:545` (*"No roadmap or phase concept exists"*) and add a `client_phases` section under "Client Goals & Body Metrics". Keep the distinction that a *training* block (the plan chip, `utils/plan-week.ts`) is not a *journey* block.

### Session 2 verification

Full `CONVENTIONS.md §13` + `npm run check:rls` + the §8 migration workflow. Unit tests: chaining produces no overlaps and no gaps across 1–12 blocks; deleting a middle block shifts the ones after it; an elapsed block refuses edit and delete; `state`/`weekOfTotal`/`pace` at boundary dates (first day, last day, day after) in a non-UTC timezone. Route tests: a foreign `clientId` 403s; a `PUT` never touches `client_goals`.

---

### 📋 SESSION 2 PROMPT — paste this into a fresh session

```
Read these in full before planning anything:
  1. CONVENTIONS.md  (mandatory — do not skip sections)
  2. docs/ARCHITECTURE.md
  3. docs/CLIENT-GOALS-PHASES-EXECUTION-PLAN.md — read §1, §2 (invariants), §3, §4,
     §5 (what actually depends on what), any STATUS blocks that exist, and all of
     SESSION 2. You are executing SESSION 2 only. No UI work.

Session 2 is the blocks backend: one migration (client_phases), the service, the three
derived reads, and the routes. NOTHING user-visible ships.

This session does NOT depend on Sessions 0, 0b or 1. Blocks touch the goal layer in
exactly one place — the pace readout in Task 2.3 — and even that reads the block's own
target_weight column, not client_goals.

A block is a NAME, a DATE RANGE, an optional SENTENCE (focus) and an optional WEIGHT.
That is the entire entity. The invariants most often violated by accident:
  - No phase_id / block_id column on any other table. Ever.
  - "Current" is derived from dates, never a status column.
  - Nothing computes from `focus`. Nothing computes from `target_weight` except the
    pace readout. Neither ever reaches the nutrition calculator.
  - Durations in, dates out — the caller never sends date pairs, so overlaps and gaps
    are structurally impossible and there is no overlap validation to write.
  - Blocks save independently of the goal. This route must NEVER call updateGoals,
    which supersedes-and-inserts on every call with no change detection.

The table is client_phases; the coach-facing noun everywhere else is "block". That is
deliberate — comment it in the migration so nobody consistency-renames one half.

Rules for this session:
- Follow CONVENTIONS.md §2: show me a plan and get approval before writing any code.
- One commit per numbered task, except the migration + regenerated types (same commit).
- Take the NEXT FREE migration number at execution time. Never pre-assign one: slot 139
  was already burned once by a reverted commit.
- New table needs ENABLE ROW LEVEL SECURITY with NO policies plus
  GRANT ALL ON TABLE ... TO service_role, both in the migration (CONVENTIONS.md:360-366).
- Use lib/date-helpers.ts addDaysToDateString (UTC-anchored). Do NOT copy
  calculateNutritionEndDate's server-local `new Date(x + "T00:00:00")` pattern.
- "Today" is the CLIENT's calendar day via getClientTodayString, never CURRENT_DATE.
- target_weight is canonical kilograms and crosses the wire as kg (CONVENTIONS §20).
- If a doc rule blocks you, follow §3: quote it, state the collision, classify it, and
  either comply, update the doc in the same commit, or STOP AND ASK ME. Safety rules
  (RLS, GRANT, auth chain, rate limiting, CSRF, IDOR, migrations) are almost always
  protective — comply. Rules describing what currently exists (ARCHITECTURE.md:545
  "No roadmap or phase concept exists") are stale — update them in the same commit.
- Commit-ready means all of CONVENTIONS.md §13 plus npm run check:rls.
- Append a STATUS block as each task lands.

Start by reading the documents, then show me your schema plan (2.1) before anything else.
```

---

# SESSION 3 — The Journey tab

**No migrations. This is where Feature A becomes visible.**

Design authority is `docs/newdesignsystem.md`, and where it and shipped Programs/Builder code disagree, **the shipped code wins**. Import `builder-tokens.ts` (`components/clients/training/program-builder/builder-tokens.ts` — **not** `lib/`), `SectionLabel`, `StatBand`, `SegmentedControl`, `DividerPager`, `RowActions` before writing new class strings.

### Task 3.1 — Rename Metrics → Journey, add the third sub-tab

**Change the LABEL only; keep the URL value `metrics`.** A value change buys nothing and breaks every existing link. Record the decision.

Files: `lib/client-tabs.ts:3` (the label, which also drives the page H1 via `client-detail-layout.tsx:26-29`). Then:

- `app/clients/[id]/page.tsx:23` holds a **second, hand-duplicated** `VALID_TABS` set. It needs no edit if the value is unchanged — confirm that, don't assume it.
- `components/clients/metrics/metrics-tab-content.tsx:32` resolves the sub-tab with a hardcoded two-way ternary (`rawSubtab === "wellness" ? "wellness" : "body"`), so a third value silently falls back to `body` **with no type error**. Replace it with a typed union.
- Sub-tabs become **Physique | Wellness | Blocks** (`body` → relabelled Physique; the URL value stays `body`).
- **Known bug, fix or record:** `handleTabChange` (`app/clients/[id]/page.tsx:37-40`) rewrites the URL as `?tab=X` and silently drops `?subtab=`, so a Blocks selection is lost on any top-level tab round-trip.

### Task 3.2 — The Blocks list

A list of cards, **not a metric picker**. Do not copy `metric-switcher.tsx` (`:31-33` self-describes as *"the page's ONLY metric picker"*) — a Journey block list has no focused-item concept.

**Collapsed row:** colour swatch · block name (sans, even with digits) · chip (`week 3 of 6` current / `not started` future) · date range and week count in mono · weight change right-aligned. Current block open by default, past collapsed, future muted.

**Expanded:** a three-column fact row, then the timeline.

| Column | Source |
|---|---|
| **Training** — program name, when placed | `training_plans` rows overlapping `[starts_on, ends_on]`. `getNextFutureTrainingPlan` (`services/training-service.ts`) is the ONE owner of the "starts later" predicate — do not write a fourth copy. Empty: "No program placed". |
| **Nutrition** — calories, what the deficit was | The **events**, not the plan row (events are SOT). Deficit = `plan.tdee − event baseline` until Session 5 stores it. Empty: "Not set". |
| **Weight** — start → end, plus the pace readout when the block has a target | The merged coach series (`components/clients/metrics/hooks/use-merged-metrics.ts` + `utils/metric-points.ts`) — no new API. |

**Vertical timeline, "What happened":** block start · mid-block changes · block end. v1 sources: block boundaries (derived), training placements in range (`training_plans.effective_from`), and nutrition save notes once Session 6 ships. Entries may carry a coach note rendered as a **quote block** labelled "visible to \<client first name\>" — which needs a new shared first-name util (none exists; see §4). Empty timeline reads **"Nothing yet."**

**Do not read `audit_logs`** for amendment history: it has zero readers by design, is best-effort, and swallows failures (`services/audit-log-service.ts:53-70`). Plan amendments are therefore invisible in the v1 timeline — record that, don't work around it.

**Colour:** a static palette indexed by block position, following `METRIC_COLORS`' discipline (`components/training/exercise-data/exercise-trend-chart.tsx:43-51`). **No picker** — see §4.

### Task 3.3 — "Add a block"

An **inline form**, not a dialog. Precedent: `components/clients/habits/habits-manage-drawer.tsx:117-134` (the `showAddForm` swap) + `components/clients/habits/add-habit-inline-form.tsx` (shell `:53`, conditional sub-row `:82-106`, footer `:108-126`).

Fields: weeks, optional focus, optional target weight. A live line reads **"Starts 7 Sep, ends 4 Oct. Journey becomes 20 weeks."**

Form pattern: react-hook-form + `zodResolver` per `CONVENTIONS.md §3`. Target weight collects in the **viewer's** unit and converts on submit via `hooks/use-unit-inputs.ts` `useCanonicalInput` — never hand-rolled. That hook owns the untouched-field guard (`CONVENTIONS.md §20`), and **any hook returning callbacks must memoize them** or the settings dialog render loop comes back (`c37431e`).

### Task 3.4 — Delete a block

Destructive confirm per `newdesignsystem.md:417-421`: styled `Dialog` (never `AlertDialog`), danger thumb, **one plain-sans sentence** naming the consequence, ghost Cancel + danger-**outline** CTA repeating the verb. There is no filled destructive button in this system.

The sentence carries the actual consequence, from the service's returned date changes:
- future block → *"The journey shortens to 13 weeks and ends 2 Nov. Cut 2 moves to 29 Sep."*
- current block → *"Cut 2 starts today."*
- elapsed block → not offered at all.

### Task 3.5 — Chart shading

Faint background bands behind the series, one per block, labelled at the top of each band in the block's colour, white divider at each boundary. Elapsed blocks render too, muted (invariant 10). A **"Show blocks"** checkbox toggles it.

**Extend `components/clients/metrics/metric-trend-chart.tsx`. Do not fork it a second time** — it is already the coach-side fork of `exercise-trend-chart.tsx`, and only the card shell it wraps is neutral-tier. If the client ever needs bands, the tier move comes first, as its own piece of work.

**Hard blocker you must solve first:** the X axis is a **category scale** (`:145-152` — `dataKey="date"` with no `type`/`scale`/`domain`) whose categories are only dates that have a logged entry (`utils/metric-points.ts:49`). On a category axis a `ReferenceArea`'s `x1`/`x2` must be existing categories, so **a block with no entries cannot render at all**, and band widths would scale with entry *count* rather than elapsed time. Convert the axis to `type="number"` with epoch-ms values and an explicit domain before adding bands. `ReferenceArea` is not imported anywhere in the repo today; the only existing overlay is the goal `ReferenceLine` at `:165-181`, which uses `ifOverflow="extendDomain"` — the band work must not break it.

Recharts is `^3.4.1` (`package.json:65`). Axis label fonts use the `var(--font-mono-display)` CSS-variable form, which `check:labels` deliberately permits via a negative lookbehind (`scripts/check-labels.ts:69-71`) because recharts style objects cannot take a class.

### Session 3 verification

Full `CONVENTIONS.md §13`, `npm run check:labels` especially. **Verify rendered pixels, not class math** — equal margins are not equal optics on a divider row (the hairline is centred in a variable-height row; `min-h-[24.5px]` on every divider). Repoint the three stale `c2bc944` citations to `cb2165b`.

**Browser smoke (owner runs it; hand over a checklist and say plainly that UI is unverified):** add three blocks → confirm the chain has no gaps → confirm the current block opens by default and past ones are collapsed → toggle "Show blocks" → scroll back past today and confirm elapsed bands still render, muted → delete a middle block and confirm the confirm sentence names the real new dates.

---

### 📋 SESSION 3 PROMPT — paste this into a fresh session

```
Read these in full before planning anything:
  1. CONVENTIONS.md  (mandatory — do not skip sections)
  2. docs/ARCHITECTURE.md
  3. docs/newdesignsystem.md  (design source of truth — but where it and shipped
     Programs/Builder code disagree, the SHIPPED CODE wins)
  4. docs/CLIENT-GOALS-PHASES-EXECUTION-PLAN.md — read §1, §2 (invariants), §3, §4
     (especially "Premises that were checked and are FALSE"), §5, the SESSION 2 STATUS
     blocks, and all of SESSION 3. You are executing SESSION 3 only.

Session 3 is the coach UI. The backend landed in Session 2; do not rebuild it.

Import the shared tokens and components before writing any new class strings. The
token module is components/clients/training/program-builder/builder-tokens.ts —
there is NO lib/builder-tokens.ts. Author with the hardcoded hex from
newdesignsystem.md, not the OKLCH semantic tokens. Radius rounded-[6px], 4px inner chips.

Four things that are easy to get wrong, all verified against main:
  - Block NAMES are sans even when they contain digits ("Cut 2") — the digits belong
    to the name. Dates, week counts and weights are mono via MONO_LABEL_CLASS.
    npm run check:labels fails the build on a raw font-mono-display.
  - There is NO label-less SectionLabel variant (label: string is required at
    section-label.tsx:19). The hand-rolled silhouette is calendar-toolbar.tsx:55+:93.
  - The trend chart's X axis is a CATEGORY scale over entry dates only. Background
    bands are IMPOSSIBLE until you convert it to a numeric time axis. Solve that
    first; do not try to fake it.
  - Render ALL blocks including elapsed ones, muted. Do not filter to
    current-and-future — that muted rendering IS the "view past blocks" story.

Rules for this session:
- Follow CONVENTIONS.md §2: show me a plan and get approval before writing any code.
  This applies even to small UI changes.
- One commit per numbered task.
- Do NOT drive a browser. When the UI work is done, hand me a smoke checklist and say
  plainly that the UI is unverified. I run browser smokes myself.
- Verify RENDERED PIXELS, not class math, for anything you can measure without a
  browser (token values, min-h-[24.5px] on divider rows).
- If a rule in CONVENTIONS.md, ARCHITECTURE.md or newdesignsystem.md blocks you,
  follow §3: quote it with file:line, classify it, and comply / update the doc in the
  same commit / STOP AND ASK ME.
- Commit-ready means all of CONVENTIONS.md §13.
- While you are in the chart files: docs/CLIENT-PORTAL-EXECUTION-PLAN.md cites commit
  c2bc944 at :1305, :1315 and :1321. That commit is NOT on main (dangling pre-rebase
  object). Repoint all three to cb2165b.
- Append a STATUS block as each task lands.

Start by reading the four documents plus the Session 2 STATUS blocks, then show me
your plan for 3.1 and 3.2 together.
```

---

# SESSION 4 — Client-facing block + the coach's one row

**No migrations. Smallest session of Feature A; do it last.**

### Task 4.1 — `/client/program` shows the current block

Today the page renders at most two link cards (`app/client/program/page.tsx:111-118`), `NutritionPlanCard` takes **no props** (`components/client-portal/program/nutrition-plan-card.tsx:4`) and throws away the whole payload the page fetches, and `PlanStateNote` returns null while a plan is active (`plan-state-note.tsx:19`) — so a client mid-program sees a plan name, a session count, and nothing else.

Add, above those cards: current block name · focus text · **"Week 3 of 6 · ends 6 Sep"** · a progress bar · and **both targets, labelled**:

> **This block:** 89.0 by 6 Sep, 0.9 to go
> **Your goal:** 85.0 by 1 Dec, 4.9 to go

Finished blocks list below with their weight change. Read-only, same coach notes, same wording as the coach side.

**Progress bar:** hand-rolled div (`components/check-in/weight-goal-card.tsx:163` is the precedent). **Not** `components/ui/progress.tsx` — shadcn-tokened, three consumers, none on this surface, and `newdesignsystem.md` documents no progress component.

### Task 4.2 — `GET /api/client/journey`

New client-facing read. `clientApiRateLimit` (IP burst, first operation) → `requireClientAuth(request)` → `clientPerClientRateLimit` keyed on the resolved client id → service filtered on that id. `Cache-Control: no-store`. Canonical kg on the wire; the client renders in its own unit via `useUnits()`.

**Prerequisite — a DECISION, not a shipped change.** The *"Your goal: 85.0 by 1 Dec"* line needs one authoritative deadline source, which means answering: **is `clients.goal_deadline` mapped in `lib/mappers.ts`, or are the three dead `?? client.goalDeadline` fallbacks deleted?** (`Client.goalDeadline` is declared at `types/check-in.ts:429` but `mapClientRow` never maps the column, so the fallbacks at `services/nutrition-calc-inputs.ts:114`, `services/comparison-service.ts:65` and `app/api/clients/[id]/nutrition/route.ts:152` are unreachable code.)

Session 0b Task 0b.1 owns that question — but **this session is not blocked on 0b's code.** The decision is a sentence, settleable in isolation. **If 0b has not run, settle it here and record the answer in this session's STATUS block; 0b will inherit it rather than re-open it.**

**Owner decision required before building — do not proceed on an assumption.** Separately from the above: today a client cannot see their own deadline at all. `goal_deadline` is deliberately absent from `CLIENT_SELF_COLUMNS` (`services/client-portal-service.ts:45-54`), and no `/api/client/**` route reads `client_goals`. Two changes are implied and both are new policy:

1. Exposing a client's deadline to that client.
2. This endpoint reading `client_goals` through `resolveEffectiveGoal` rather than the `clients.*` mirror — the first client-facing surface to do so.

Recommendation: do both, scoped to this endpoint only. The mirror reads on `/api/client/me` and `/api/client/progress` stay as they are; unifying them is separate work. **Ask, then build.**

**This is the one genuinely goal-dependent line in Feature A.** Dropping it (and the pace readout in 2.3) makes the whole blocks feature independent of the goal layer — see §5.

### Task 4.3 — The "Waiting on you" row

One row, fired when the **current block's last week starts**: *"Build ends Sunday. Cut is next."* When nothing follows: *"Build ends Sunday. Nothing scheduled after it."* Not dismissible; does **not** go through `evaluateAndSortTriggers`; clears when the next block starts (invariant 14).

**There is no coach-action-row abstraction to plug into.** `components/clients/overview/waiting-on-you-section.tsx` has no row-type union, registry or `rows[]` array — the check-in row is bespoke JSX at `:71-100` and alerts are a separate map at `:102-138`. Adding one row touches **five** places: `types/coach-brief.ts:52-55`, `services/client-overview-brief-service.ts:88-110`, the component's props (`:19-30`), the `pendingCount` expression (`:49`), and `components/clients/client-overview-tab.tsx:144-150`.

Copy the check-in row's layout, **but not its thumb size**: it is `h-9 w-9` (`:73`) while every other Overview thumb is `h-8 w-8` (`overview-primitives.tsx:61`). Do not inherit the outlier.

**Do not add this to the dashboard attention feed** (standing owner decision): the feed stays purely client-behaviour, and coach-action rows live on the client Overview only. Note also the dismissal landmine you are avoiding by not being an alert — `filterDismissedAlerts` (`lib/attention-feed-helpers.ts:300`) permanently suppresses any item with an empty `affectedDays` after one dismiss.

### Session 4 verification

Full `§13`. Route tests: a foreign client id 404s; the endpoint returns kg with no unit tag; both rate-limit tiers fire in the documented order (`CONVENTIONS.md §9`). **Browser smoke (owner):** view `/client/program` as a client mid-block, then as a client with no blocks, then in imperial.

---

### 📋 SESSION 4 PROMPT

```
Read in full: CONVENTIONS.md, docs/ARCHITECTURE.md, docs/newdesignsystem.md, and
docs/CLIENT-GOALS-PHASES-EXECUTION-PLAN.md §1-§5 plus the Session 2-3 STATUS blocks
and all of SESSION 4. You are executing SESSION 4 only.

Three tasks: the client's current-block section on /client/program, the new
GET /api/client/journey endpoint, and ONE "Waiting on you" row on the coach Overview.

4.2 has a prerequisite that is a DECISION, not a shipped change. It needs one
authoritative answer to: is clients.goal_deadline mapped in lib/mappers.ts, or are the
three dead `?? client.goalDeadline` fallbacks deleted? Session 0b owns that question,
but you are NOT blocked on 0b's code — settle it here if 0b has not run, and record my
answer in your STATUS block so 0b inherits it.

STOP AND ASK ME before building 4.2 for a separate reason: it requires exposing a
client's goal DEADLINE to that client (deliberately absent from CLIENT_SELF_COLUMNS
today) and making this the first /api/client/** surface to read client_goals rather
than the clients.* mirror. Both are new policy. The plan recommends yes, scoped to this
endpoint only — but I decide.

Things verified against main that will save you time:
  - There is no coach-action-row abstraction. Adding one row touches five files;
    they are listed in the plan.
  - The check-in row's thumb is h-9 w-9 — an outlier. Every other Overview thumb is
    h-8 w-8. Do not copy the outlier.
  - components/ui/progress.tsx is shadcn-tokened with three consumers, none here.
    Hand-roll the bar; the precedent is check-in/weight-goal-card.tsx:163.
  - The row is NOT an alert: not dismissible, and it must not go through
    evaluateAndSortTriggers or the dashboard attention feed.

Rules: CONVENTIONS.md §2 (plan first, wait for approval), one commit per task, the
§9 two-tier client rate-limit order, canonical kg on the wire, commit-ready = §13.
Do not drive a browser — hand me a smoke checklist and say the UI is unverified.
Append a STATUS block as each task lands.
```

---

# SESSION 0b — Goals: one read path, one writer, one editor

**Zero migrations. Six tasks. Runs after Session 4.**

This is the rest of the goal layer. Session 0 stopped the data loss in one commit; everything else was deferred to here because none of it blocks a block, and seven tasks of goal work before a single block exists is too much runway. **It should not be dropped** — invariant 16 is not satisfied until it lands.

**Re-read Session 0's "What the audit found"** — it is the briefing for this session too, and it constrains three of these tasks: `primary_goal` stays out of the editor, `goal_body_fat_percentage` stays in but never becomes solvable, and the mirror gets one writer rather than removal.

**Read the Session 0 STATUS block first.** It records what happened to `notes`. If Session 4 ran before this one, **read its STATUS block too** — it may already have settled the `clients.goal_deadline` map-or-delete question that Task 0b.1 owns. If so, inherit that answer; do not re-open it.

**Internal ordering matters in one place:** do 0b.1 (the Overview reads the resolver) before 0b.2 (mirror Tier A), and 0b.4 (build the editor) before 0b.5 (retire the old one). Both are read-before-write.

### Task 0b.1 — The Overview reads the resolver, not the mirror

The Overview status card reads `client.goalWeight` and `client.goalBodyFatPercentage` — the denormalized `clients` mirror via `mapClientRow` (`lib/mappers.ts:79-80`) — at `components/clients/overview/client-status-card.tsx:167`, `:176`, `:255`, with chips from `lib/goals/goal-state.ts`. It never touches `client_goals` and never calls `resolveEffectiveGoal`.

**It does not read `goal_deadline`, and it cannot.** `mapClientRow` never maps the column, so `Client.goalDeadline` (`types/check-in.ts:429`) is **always `undefined`**. That makes the `?? client.goalDeadline ?? null` fallback **unreachable code at three sites**, not two — `services/nutrition-calc-inputs.ts:114`, `services/comparison-service.ts:65`, and `app/api/clients/[id]/nutrition/route.ts:152`. When `client_goals` is missing, the deadline silently becomes null, which means maintenance calories with no pace check.

**Decide: map the column, or delete all three dead fallbacks. Show both costs, then state which and why** — unless Session 4 already answered it, in which case inherit.

**Fix:** add one SWR read of `GET /api/clients/[id]/goals` in `components/clients/client-overview-tab.tsx` and pass the resolved goal down to `ClientStatusCard`. That endpoint already exists and already serves two other surfaces (`client-goal-editor.tsx:65`, `use-merged-metrics.ts:79-83`); widening `GET /api/clients/[id]` instead would change a response shape six service call sites consume. **The same fetch is what Task 0b.4's editor revalidates**, so it pays for itself twice.

**Thread the callback.** `ClientStatusCard`'s props type (`client-status-card.tsx:19-26`) has **no** revalidation slot — `onClientUpdated` currently reaches `ClientActivationBanner` (`client-overview-tab.tsx:128-132`) and `ClientScheduleCard` (`:177`) but not the status card. Task 0b.4 needs it there.

*(`ARCHITECTURE.md:74`'s stale caller list was already corrected in Session 0. Verify rather than redo.)*

### Task 0b.2 — One writer for the mirror (Tier A)

Delete the four **direct** `clients.*` goal writes, leaving `updateGoals`' dual-write (`client-goals-service.ts:115-123`) as the single writer:

- `services/client-service.ts:59-60` (the `createClient` INSERT) and `:236-237` (`updateClient`)
- `app/api/clients/[id]/metrics/route.ts:126-132`
- `services/intake-review-service.ts:154`, `:157`, `:160` — leave the guard **reads** at `:153-161` alone; they still work

4 files, ~14 lines. No migration, no UI change, no new fetch, zero read-side behaviour change. What it buys is a single auditable write path.

**What it does not buy — say so in the STATUS block rather than claiming more.** The dual-write inside `updateGoals` is logged-and-swallowed (`:125-127`): a `client_goals` row can commit while the mirror UPDATE fails, and the request still returns 200. Tier A makes divergence **single-sourced**, not impossible.

**Full mirror removal is not in this session** — see §7 for the costed scope. Tier B ("reads through the resolver, columns left as dead data") is *not* separately shippable: the moment writes stop, the mirror goes stale, so the three surfaces still reading it must convert in the same shipment. Tier B collapses into full removal.

### Task 0b.3 — Kill the two divergent resolver shapes

Every coach surface resolves the goal through `resolveEffectiveGoal`. Task 0b.1 did the Overview. Two divergent shapes remain:

- **`components/clients/metrics/hooks/use-merged-metrics.ts:99-112`** hardcodes `deadline: null, startDate: null` into the resolver input *after* fetching the full goal from `/api/clients/[id]/goals`. Two surfaces render "the same" goal from two different shapes, and this one is deliberately blind to the deadline.
- **`hooks/use-nutrition-builder.ts:283`/`:290`** compute a projected goal date from `client.goalWeight` straight off the `clients` mirror, bypassing both `client_goals` and the resolver — on the same screen as the goal editor, which reads `client_goals`. This lives inside the dead `getProjectedDate` (`:280-301`, returned at `:343`, zero consumers), which **Session 1 Task 1.2 also deletes**. Whichever session ran first did it; confirm rather than duplicate.

**Re-derive the caller list yourself** before changing anything — this document's predecessor and `ARCHITECTURE.md:74` both had it wrong, and the correct four are `app/api/clients/[id]/nutrition/route.ts:147`, `use-merged-metrics.ts:99`, `services/comparison-service.ts:60`, `services/nutrition-calc-inputs.ts:109`.

### Task 0b.4 — A goal editor with its own home

**Where: the Overview status card.** It already renders start / current / goal for both weight and body fat, and it already has a footer row (`client-status-card.tsx:294-302`) holding a single right-aligned "Open Metrics" text-button. "Edit goal" sits beside it. Justify the choice in your plan or propose a better one — but the hard requirement is that it must be reachable **without opening the nutrition builder**.

**Match the established Overview overlay precedent**, which is `components/clients/overview/client-settings-dialog.tsx` (mounted by `ClientScheduleCard` at `:297-302`): a parent-controlled `Dialog` at `sm:max-w-md`, structured `DialogHeader` → `<form onSubmit={form.handleSubmit(...)}>` → `space-y-4` body → `DialogFooter` with ghost Cancel + teal filled submit (`bg-[#0d9488] hover:bg-[#0b7f75]`, `Loader2` while pending). `sm:max-w-md` is the repo's standard for this tier (`delete-note-dialog.tsx:52`, `log-measurement-dialog.tsx:174`); the existing goal editor's `sm:max-w-[425px]` matches nothing else — do not carry it over. The status-card footer hairline is hardcoded `rgba(255,255,255,0.06)` at `:294` rather than the `DIVIDER` token (`0.07`) the other three bands use; match what is there rather than "fixing" it in this task.

**Fields:** target weight, optional target body fat, deadline, optional start date. `client_goals.goal_start_date` already exists (migration 104) and already feeds the calculator through `resolveEffectiveGoal` → `nutrition-calc-inputs.ts:115`, and the PUT schema already accepts `goalStartDate` (`lib/validations/client-goals.ts:31`). **Do not render `primaryGoal`.**

**Form pattern: react-hook-form + `zodResolver`** per `CONVENTIONS.md:164`. The existing editor uses raw `useState` and predates the rule; do not copy it.

**Units:** weight collects in the **viewer's** unit and converts on submit via `hooks/use-unit-inputs.ts` `useCanonicalInput(viewer, seed, kind)` — never hand-rolled, which is exactly what the current editor does. Use its `commit` member (`:161`): `isPristine ? seed : canonical`, string-equality against the seeded baseline, never an epsilon. That is what makes a focus-through an exact no-op (`CONVENTIONS.md §20`). Both of its returned callbacks are already memoized — `setValue` via `useCallback([])` (`:141-144`), `reset` via `useCallback([viewer, kind])` (`:146-155`, deliberately re-identifying on a unit flip). **Any new hook you write that returns callbacks must do the same**, or the settings-dialog render loop comes back (`c37431e`; its regression tests are `hooks/use-unit-inputs.test.ts:241`/`:255`/`:276` and `client-settings-dialog.test.tsx:65`).

**Three schema facts that shape the form:**
- `goalWeight` is `.optional()` but **not** `.nullable()` (`lib/validations/client-goals.ts:28`) — it can be omitted, never cleared. The other four fields accept explicit `null` to clear.
- There is **no cross-field refinement** anywhere — nothing checks that `goalStartDate <= goalDeadline`. Decide whether to add one; if yes it belongs in the zod schema, not the component.
- The past-deadline bound is **route-side**, against the coach's local today (`app/api/clients/[id]/goals/route.ts:80-92`), deliberately not in the schema because a server-clock bound would reject an east-of-UTC coach's own today. **Do not move it into the schema.**

**This task and 0b.5 are in the same session deliberately.** Two live goal editors must never coexist across a shipped session boundary — build the new one, then retire the old one, and do not stop in between.

### Task 0b.5 — Retire the editor in the nutrition drawer

Replace `ClientGoalEditor` at `components/clients/nutrition/builder/drawer-form-body.tsx:51-54` with a read-only line — `Goal: 85.0 kg by 1 Dec` — plus a link to the real editor (Task 0b.4), so there is exactly **one** writer. Note the current summary prints the deadline as a raw ISO string (`client-goal-editor.tsx:71-76`); format it. Delete `components/clients/client-goal-editor.tsx` once nothing mounts it.

**Confirm the drawer still works with no goal set, and fix the silence while you are there.** Today it works correctly — `validateClientForNutrition` (`lib/validations/nutrition.ts:113-142`) checks only `currentWeight`, `bmr` and `gender` and never checks for a goal, so `resolveNutritionCalcInputs` returns `status: "ready"` with `goalWeightKg: undefined`, and the calculator hits its maintenance early-return (`services/nutrition-service.ts:74-82`). The coach gets correct maintenance numbers. **But it is silent about it:** `nutrition-targets-block.tsx` suppresses both the deficit span (`:147`, gated on `requiredDailyDeficit !== 0`) and the rate span (`:157`, gated on `weeklyWeightChangeKg !== 0`) because both are exactly 0, so the coach sees "TDEE 2,400" with no explanation. The only thing on the entire surface that says a goal is missing is the editor's "No goal set yet" — which this task removes. Replace it with an explicit maintenance state.

### Task 0b.6 — Goal history: decide

`client_goals` already versions, and `getGoalsHistory` (`services/client-goals-service.ts:132-147`) already exists. It has exactly **one** production call site — the `?history=true` branch of the goals GET (`app/api/clients/[id]/goals/route.ts:34`) — and **nothing in the product ever requests it**, so the branch is unreachable in the running app. The only place `history=true` appears at all is that route's test.

Decide whether the Task 0b.4 editor surfaces it (*"goal changed 14 Jul: 88 → 85 by 1 Dec"*).

**If yes** it is a **read-only list, no new storage**, and three things must be handled:
- The GET's `data` shape **switches** between `ClientGoal | null` and `{ current, history }` (`route.ts:33-44`). Both existing typed readers (`client-goal-editor.tsx:37`, `use-merged-metrics.ts:79`) assume the former and would break silently on a blind flip.
- `getGoalsHistory` has **no `superseded_at` filter**, so the current row comes back twice — once as `data.current`, once as `data.history[0]`.
- No limit, no pagination. On a heavily-edited client it returns every version ever written.

**If no**, say why and leave the function alone.

Recommendation: **yes, read-only.** Session 0 made goal versions trustworthy for the first time, and the Journey timeline (Session 3.2) wants the same data.

### Session 0b verification

- `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`, `npm run check:labels`. No migration.
- New tests: the Overview rendering a goal that exists in `client_goals` but not in the `clients` mirror (0b.1); the mirror updating through `updateGoals` only, with the direct writers gone (0b.2); the Metrics page seeing a deadline it previously hardcoded to null (0b.3); the editor's pristine-field guard not rewriting an untouched weight on save (0b.4); the nutrition drawer rendering an explicit maintenance state with no goal (0b.5).
- **Browser smoke (owner):** set a goal from the Overview with no nutrition plan open → confirm the status card updates → confirm the nutrition drawer's read-only line shows the same value → open the drawer for a client with no goal at all and confirm it says so rather than showing a bare TDEE → switch the coach to imperial, reopen the editor and save with no edit, and confirm the stored kilograms are byte-identical.

---

### 📋 SESSION 0b PROMPT

```
Read in full: CONVENTIONS.md, docs/ARCHITECTURE.md, docs/newdesignsystem.md, and
docs/CLIENT-GOALS-PHASES-EXECUTION-PLAN.md §1-§5, SESSION 0's "What the audit found"
block (it is the briefing for this session too), the SESSION 0 STATUS block, the
SESSION 4 STATUS blocks if that session has run, and all of SESSION 0b. You are
executing SESSION 0b only.

Session 0b is six tidying tasks, ZERO migrations. It runs after Session 4 by design —
Session 0 already shipped the one thing that was losing data, and none of this blocks
a block.

Decisions you INHERIT rather than re-open:
  - What happened to `notes` (Session 0 STATUS block).
  - Whether clients.goal_deadline is mapped or the three dead `?? client.goalDeadline`
    fallbacks are deleted — Task 0b.1 owns this question, but Session 4 may already
    have answered it. Check its STATUS block first.

  0b.1  Overview reads client_goals via resolveEffectiveGoal, through ONE new SWR read
        of /api/clients/[id]/goals in client-overview-tab.tsx. Thread onClientUpdated
        down to ClientStatusCard — its props type has no slot for it today.
  0b.2  Delete the FOUR direct clients.* goal writes so updateGoals is the sole writer.
        4 files, ~14 lines. Do NOT claim this makes divergence impossible — the
        dual-write inside updateGoals is logged-and-swallowed. It makes it
        single-sourced. Full mirror removal is NOT this session; see §7.
  0b.3  Kill the two divergent resolver shapes (use-merged-metrics hardcoding
        deadline:null, and use-nutrition-builder reading the mirror directly).
        RE-DERIVE the resolveEffectiveGoal caller list yourself.
  0b.4  Build the goal editor on the Overview status card. react-hook-form +
        zodResolver; useCanonicalInput with its `commit` member for the weight field.
  0b.5  Retire the nutrition-drawer editor and delete client-goal-editor.tsx. Then fix
        the silence: with no goal set the drawer shows a bare TDEE because both the
        deficit and rate spans are suppressed at zero.
  0b.6  Decide whether the editor surfaces goal history. getGoalsHistory already exists
        and is unreachable in the running app. If yes, read-only list, no new storage —
        and note the GET's data shape SWITCHES under ?history=true, which would silently
        break both existing typed readers.

ORDERING WITHIN THE SESSION: 0b.1 before 0b.2 (read before write). 0b.4 before 0b.5,
and do not stop between them — two live goal editors must never coexist across a
shipped session boundary. That is the whole reason they are in the same session.

Constraints from Session 0's audit that bind this session:
  - Do NOT render primaryGoal in the editor. It is dead: zero branches anywhere, not
    in the resolver's input contract, no production writer.
  - Keep goal_body_fat_percentage as a field, but do NOT make it solvable and do NOT
    let it into any calculation. Its live self-contradiction is logged in §7 and is
    not yours to fix.

Rules: CONVENTIONS.md §2 (plan first, wait for approval), one commit per task,
commit-ready = §13. Do not drive a browser — hand me a smoke checklist and say the UI
is unverified. If a doc rule blocks you, follow §3. Append a STATUS block per task.

Start by reading the documents and the STATUS blocks, then show me your plan for 0b.1.
```

---

# SESSION 5 — Deficit as a first-class nutrition input

**One migration, and it changes the RPC arity. This is the highest-risk session in the document.**

Depends on Session 1 Task 1.2 (the shared energy helper). Independent of Sessions 2–4, 0 and 0b.

### Task 5.1 — The arity change, and the landmine that hides it

`services/nutrition-plan-service.ts:85` and `:117` cast the RPC arg object **`as never`, twice**, so TypeScript verifies nothing about the 24 keys. A payload key that does not match the live signature makes PostgREST unable to resolve the overload; `createNutritionPlan` returns null; **every plan save fails** with "Failed to create nutrition plan" while `tsc`, `eslint` and `vitest` all stay green. The file's own comment at `:110-116` says so.

**Remove the casts as part of this task.** Type the args object as `Database["public"]["Functions"]["create_nutrition_plan_atomic"]["Args"]` so a mismatch between the payload and the regenerated types becomes a **compile error** instead of a silent production outage. That is the belt that makes the rest of this session safe, and `CONVENTIONS.md §5` already forbids the escape.

**Migration discipline for the new arity** (the history is clean and must stay clean — every arity change so far explicitly DROPped the prior signature by type list before creating the new one; see 048→110→115→133→139):

1. `DROP FUNCTION … (<the exact 24 types>)` first. A bare `CREATE OR REPLACE` with a new parameter **mints a second overload**; PostgREST then 300s/`PGRST203`s or silently binds the wrong one.
2. Re-apply the migration-106 lockdown at the **new** arity (`139:200-201`). A `REVOKE`/`GRANT` written at the wrong arity is a **silent no-op** that leaves `PUBLIC EXECUTE` on a `SECURITY DEFINER` function taking a caller-supplied `client_id`.
3. Update `services/nutrition-plan-service.test.ts:140-152` — it asserts the exact sorted key list and `toHaveLength(24)`. It is your loudest belt; keep it pinned to the new number.

### Task 5.2 — Two columns on `nutrition_plans`

`deficit_value NUMERIC NULL` + `deficit_type TEXT NULL CHECK (deficit_type IN ('tdee_percent','absolute_kcal'))`. Nothing stores a deficit, rate or percent anywhere today — verified column by column against the live 28-column table. Both go in the always-update bucket of the `DO UPDATE SET`.

Storing the *intent* rather than the result is the whole point (invariant 12): when TDEE moves, a 20%-of-TDEE deficit re-solves to a new kcal number; a stored kcal number stays put. Both must survive a recalculation.

**Do not confuse this with `calorie_surplus_percentage`**, which is a per-date **training** surplus denormalized onto `training_events` (migration 085) and read by the cascade. Different axis, different table, different meaning.

### Task 5.3 — Both directions in the calculator

Extend `calculateBaselineCalories` (or add a sibling entry point) so the same equation runs either way, sharing the caps and floor rather than duplicating them:

- **deadline → deficit** (today's path, unchanged in behaviour).
- **deficit → projected date**: `daysToGoal = totalCalorieChange / dailyDeficit`, then the projected date.

`calculateBaselineCalories` has **two** in-file call sites, not one: `:320` (`generateNutritionPlan`, live) and `:213` (`calculateTargetCalories`, dead and a trap — it drops `calcStartDate`/`today`). Plus eight call sites in `services/nutrition-service.test.ts`. Session 1 Task 1.2 should already have deleted the dead pair; confirm.

### Task 5.4 — The builder surface

- Deficit becomes an input alongside goal-and-deadline. **Neither is primary.** Enter a deadline, see the implied deficit; enter a deficit, see the projected date.
- **Show BMR and TDEE next to the suggested target.** TDEE is rendered once today (`components/clients/nutrition/builder/nutrition-targets-block.tsx:146`) and BMR is **never** shown as a number — the only BMR reference in the builder tree is an absence warning (`drawer-footer.tsx:72-84`).
- **The AUTO save path posts no calorie number at all** (`hooks/use-nutrition-builder.ts:201-210`) — the server re-resolves everything and re-runs the calculator (`nutrition-plan-orchestrator.ts:178`). So the deficit **cannot** be a browser-only preview knob: it must travel in the POST body, be accepted by `nutritionPlanSchema` (`lib/validations/nutrition.ts:37-67`), and be threaded into `generateNutritionPlan`, or the save silently recomputes the deadline-driven number and discards the coach's choice.
- **Surface the caps and the floor.** `autoPlan.warnings` is computed in the browser (`use-nutrition-builder.ts:87`) and **nothing reads it**; the `warnings` state (`:176`) is set only from the POST response (`:236`) and rendered outside the drawer by `NutritionBuilderRightPanel` (`:31-33`). A coach setting an impossible deadline sees a silently-capped number in the live preview. With a deficit input this becomes indefensible — render them inline, at the input.
- **The caps and floor gate the suggestion only** (invariant 13). A coach may type lower; `handleCustomMacros` (`nutrition-plan-orchestrator.ts:198-275`) already bypasses both entirely. Do not turn either into a hard block.

**While you are here, two silent-discard bugs to fix or record:** `nutritionPlanSchema` still accepts `goalDeadline` (`:45`) and `trainingVolumeHours` (`:39`); nothing reads `body.goalDeadline`, and `trainingVolumeHours` reaches the RPC but is ignored by the calculator. A caller passing either gets a 200 and silence.

### Session 5 verification

Full `§13` + `check:rls` + the §8 migration workflow. **The test that matters most:** a save round-trip proving the payload key list matches the live signature. Then: a 20%-of-TDEE deficit re-solving to a different kcal after a TDEE change; a coach-typed sub-floor number surviving the save with a visible warning; deadline→deficit and deficit→date agreeing on the same pair.

---

### 📋 SESSION 5 PROMPT

```
Read in full: CONVENTIONS.md, docs/ARCHITECTURE.md, docs/newdesignsystem.md, and
docs/CLIENT-GOALS-PHASES-EXECUTION-PLAN.md §1-§5 plus the Session 1 STATUS blocks
and all of SESSION 5. You are executing SESSION 5 only.

This session depends only on Session 1's shared energy helper (Task 1.2). It is
INDEPENDENT of the blocks feature (Sessions 2-4) and of Sessions 0 and 0b. Do not
couple them and do not read client_phases anywhere in it.

THE LANDMINE, READ THIS FIRST: services/nutrition-plan-service.ts:85 and :117 cast the
create_nutrition_plan_atomic arg object `as never`, TWICE. TypeScript checks nothing
about the 24 keys. A payload/signature mismatch makes PostgREST unable to resolve the
overload, createNutritionPlan returns null, and EVERY plan save fails while tsc, eslint
and vitest all pass. Your first commit removes those casts and types the object against
types/database.ts so a mismatch is a COMPILE error. Everything else in this session
depends on that belt existing.

Migration discipline for the arity change:
  - DROP FUNCTION with the exact 24-type list BEFORE creating the new signature. A bare
    CREATE OR REPLACE with a new parameter mints a SECOND overload.
  - Re-apply the migration-106 EXECUTE lockdown at the NEW arity. A REVOKE/GRANT written
    at the wrong arity is a SILENT no-op on a SECURITY DEFINER function that takes a
    caller-supplied client_id.
  - services/nutrition-plan-service.test.ts:140-152 pins the exact sorted key list and
    toHaveLength(24). Keep it pinned to the new number — it is your loudest belt.

The design: deficit and deadline are BOTH first-class, neither primary. Deficit stores
INTENT (a % of TDEE or absolute kcal) so it survives a TDEE change. Caps and the floor
gate what the app SUGGESTS — a coach may type lower. Today those warnings are computed
in the browser and read by nothing; surface them at the input.

The AUTO save path posts no calorie number at all — the server re-resolves and re-runs
the calculator. A deficit that lives only in the browser will be silently discarded.

Rules: CONVENTIONS.md §2 (plan first, wait for approval), one commit per task except
migration + regenerated types (same commit), next free migration number taken at
execution time, `npx supabase db push` is classifier-blocked here so tell me and I run
it, commit-ready = §13 + check:rls. Do not drive a browser — hand me a checklist.
If a doc rule blocks you, follow §3. Append a STATUS block as each task lands.

Start with the `as never` removal and show me that plan before anything else.
```

---

# SESSION 6 — The save note and the Journey timeline

**One migration. Depends on Session 5 (same drawer) and, for the timeline half, on Session 3.**

### Task 6.1 — Migration: `nutrition_plan_notes`

```sql
CREATE TABLE IF NOT EXISTS public.nutrition_plan_notes (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  coach_id          UUID REFERENCES public.coaches(id) ON DELETE SET NULL,
  nutrition_plan_id UUID REFERENCES public.nutrition_plans(id) ON DELETE SET NULL,
  effective_on      DATE NOT NULL,
  body              TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
  -- no updated_at: immutable event table (CONVENTIONS §8), like body_metrics
);

CREATE INDEX IF NOT EXISTS idx_nutrition_plan_notes_client_date
  ON public.nutrition_plan_notes (client_id, effective_on DESC);

ALTER TABLE IF EXISTS public.nutrition_plan_notes ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.nutrition_plan_notes TO service_role;
```

Three properties earn the table, and each one is a lesson from a column that failed:

- **Client-scoped, plan FK is SET NULL.** `deleteFutureNutritionEventsForPlan` (`services/nutrition-event-service.ts:360-377`) removes all future scheduled rows for a plan with no note filter, deliberately. Anything stored on `nutrition_events` is destroyed by a plan delete. This mirrors the events-as-SOT rule that event→plan FKs are SET NULL (`ARCHITECTURE.md:163`).
- **Append-only.** `stampCoachNote` (`nutrition-plan-orchestrator.ts:88-92`) is an unconditional `UPDATE` on one date — two regenerates sharing an effective date silently destroy the first note. The timeline needs a history, not the last write.
- **Date-anchored**, so a block selects its own entries by range and the timeline orders without a join.

**Answer migration 139's header directly in your plan** (`139:5-10` is a pre-written rejection of plan-level note columns: *zero read sites, invisible AND self-destructing*). This table is the opposite on all three counts — it is read by the Journey timeline and the client, it never self-destructs, and it is client-visible. Say so in the migration header.

**Do not put this in `create_nutrition_plan_atomic`.** Keep the arity at whatever Session 5 left it.

### Task 6.2 — Write path

A separate `INSERT` in the orchestrator after the RPC succeeds, on both branches (where `stampCoachNote` is called today, `:261` and `:347`), with `effective_on = body.effectiveFrom ?? clientToday`.

**Do not swallow a failure.** `CONVENTIONS.md §2` item 12 is explicit: a `.catch()` that logs and returns success after an earlier write committed is a silent divergence. The note is coach-authored content — if the insert fails after the plan committed, surface it (a warning in the response the drawer renders), or make it retryable. Do not copy `stampCoachNote`'s silence.

**Decision gate — get a yes before writing code.** The recommendation is to **repoint the existing textarea** (`components/clients/nutrition/builder/drawer-form-body.tsx:90-93`, `:121-174`, placeholder *"Why are you adjusting this plan?"*, 500-char cap) from `stampCoachNote` to this table, and relabel it as shared with the client. Consequence: **the coach loses the per-day calendar marker on regenerate** (`nutrition-calendar-day-cell.tsx:201-207`, "Your note"). The per-day range-edit writer of `coach_note` is untouched. The alternative — two textareas with different visibility in one drawer — is worse and is how a coach ends up sending a private note to a client. Ask, then build.

### Task 6.3 — Read paths

- **Coach:** the Journey timeline (Session 3.2) unions block boundaries + training placements + these notes, ordered by date, filtered to the block's range. Rendered as a quote block labelled "visible to \<first name\>".
- **Client:** the same notes on `/client/program` (Session 4.1), same wording. If Session 4 has not shipped, the coach half stands alone.
- Add the table to `ARCHITECTURE.md` under "Nutrition & Training Events", and correct the note inventory there: `note` (118) is client-visible and written only by the per-day range-edit path; `coach_note` (139) is coach-private and per-day; `nutrition_plan_notes` is client-visible, plan-level and append-only. Three different things with three different lifetimes.

### Session 6 verification

Full `§13` + `check:rls` + the §8 migration workflow. Tests: two saves on the same effective date produce **two** rows; a plan delete leaves every note intact; the client payload carries the note and the coach payload carries the same text. **Browser smoke (owner):** save with a note, regenerate with a second note on the same date, and confirm the timeline shows both, oldest first.

---

### 📋 SESSION 6 PROMPT

```
Read in full: CONVENTIONS.md, docs/ARCHITECTURE.md, and
docs/CLIENT-GOALS-PHASES-EXECUTION-PLAN.md §1-§5 plus the Session 5 STATUS blocks and
all of SESSION 6. You are executing SESSION 6 only.

One new table (nutrition_plan_notes), one write path, two read paths.

Read supabase/migrations/139_nutrition_event_coach_note.sql:5-14 FIRST. Its header is a
pre-written rejection of plan-level note columns — it dropped nutrition_plans.coach_notes
for being write-only, invisible and self-destructing. Your migration header must answer
it directly and explain why this table is the opposite on all three counts.

Three facts, verified against main, that determine the schema:
  - nutrition_plans.coach_notes DOES NOT EXIST (dropped at 139:206). nutrition_plan_history
    DOES NOT EXIST (dropped at migration 045). There is no plan-version history anywhere.
  - stampCoachNote (nutrition-plan-orchestrator.ts:88-92) is an unconditional UPDATE on one
    date. Two regenerates on the same effective date silently destroy the first note.
  - deleteFutureNutritionEventsForPlan (nutrition-event-service.ts:360-377) is unguarded, so
    anything stored on nutrition_events dies with the plan. That is why this table is
    client-scoped with a SET NULL plan FK.

STOP AND ASK ME before 6.2. The recommendation is to repoint the existing "Why are you
adjusting this plan?" textarea from stampCoachNote to the new table and relabel it as
client-visible — which means the coach LOSES the per-day calendar "Your note" marker on
regenerate. I decide that, not you.

Do NOT add a parameter to create_nutrition_plan_atomic. The note is a separate INSERT after
the RPC succeeds, and its failure must NOT be swallowed (CONVENTIONS §2 item 12).

Rules: §2 plan-first, one commit per task except migration + types, next free migration
number at execution time, db push is classifier-blocked so tell me and I run it,
commit-ready = §13 + check:rls. Do not drive a browser. Append a STATUS block per task.
```

---

## 6. Explicitly out of scope

| Item | Why |
|---|---|
| A new goals table, or a generic `target_type` / `target_value` / `target_unit` shape | `client_goals` is already the right shape: superseding rows, one active enforced by index, typed columns, `goal_start_date` already wired into the calculator. The generic shape is what `primary_goal` was drifting toward, and nothing reads it. |
| Wiring the calculator to a block's `target_weight` | Deferred until a coach asks. It would make blocks cross-domain and re-open every over-determination question the rate/type-enum removal closed. |
| A rate on a block (`rate_per_week_kg`) or a stored rate on `client_goals` | Removed by owner decision. Target plus duration already implies a rate for the pace readout; storing it lets three facts disagree. |
| A per-block daily-targets grid (`daily_targets` JSONB) | Removed with per-block calculation. Blocks do not prescribe. |
| `phases_fingerprint` / `goal_source` on `nutrition_plans` | Removed with per-block calculation — with nothing computing from a block there is no staleness to detect. `goal_source` stays dropped (migration 133:278). |
| A per-block resolver in `generateNutritionEvents`, per-block calculation in the orchestrator, a longer generation horizon, date-awareness in `resolveEffectiveGoal` | All removed with per-block calculation. The 8-week horizon stays as it is. |
| A block type enum | The rate's sign gave direction and the coach's own name carries intent better than any enum. `focus` now carries it in full. |
| Blocks prescribing or constraining training | The program is the container, the block is the slice. Blocks inform placement visually, never restrict it. |
| Per-block colour **picker** | No colour-picker UI exists anywhere in the repo, and `builder-tokens.ts:44-45` records an owner decision against category→colour mapping. A static index-based palette only. |
| Making `goal_body_fat_percentage` solvable, or reconciling it with `goal_weight` | There is no lean-mass model in the repo, so the two targets cannot be reconciled arithmetically. Reconciling the *readouts* is a check-in-review decision — see §7. |
| Plan amendments in the Journey timeline | The only record is an `audit_logs` event, and that table has zero readers, is fire-and-forget, and swallows failures. Reading it would be the first time anything did. |
| Dashboard attention-feed rows | Standing owner decision — the feed stays purely client-behaviour. |
| Block report card (prescribed vs actual) | Wants the check-in rebuild to settle first so "actual" and "adherence" mean one thing. |
| Milestones, objectives, block descriptions, phase snapshots, coach reflections, completion cards, a roadmap container | The removed feature's lowest-value, highest-cost half. |

---

## 7. Open items

### The two goal targets contradict each other on two LIVE surfaces today

**Not hypothetical, not caused by this workstream, and not fixed by it.** `goal_weight` and `goal_body_fat_percentage` are solved independently by four surfaces and reconciled by none:

- **Coach Overview status card** renders teal **"Goal reached"** on the goal-weight cell beside amber **"4.0% to go"** on the goal-body-fat cell. Two chips from the same helper (`lib/goals/goal-state.ts` via `client-status-card.tsx:172` and `:173-178`), computed side by side, never compared.
- **Check-in review page** prints **"Body Fat: 4.0% to go"** (`goal-progress-view.tsx:142-147`) directly above the teal **"On track to meet the goal by the deadline"** (`:38-46`) — because `progressNote` is derived from `goalProgress.weight` alone. This is the sharpest contradiction in the codebase.

Compounding it: `isOnTrack` defaults to **true** when `avgChange` is falsy (`utils/comparison-utils.ts:70-72`), so a client with fewer than two body-fat check-ins reads "On track" no matter how far off they are.

Fixing this means choosing which target is the headline, or making the summary sentence read both. That is a check-in-review decision, not a goals-plumbing one.

### `updateGoals` is not atomic

Three autocommitted PostgREST round trips with no transaction, no RPC, no advisory lock and no version check: SELECT (`client-goals-service.ts:56`), a **set-based** UPDATE (`:60-64`) with no `.select()` — so a 0-row supersede is indistinguishable from a 1-row supersede — and INSERT (`:98-107`).

Two live failure modes **the unique index cannot catch**:

- **Silent lost update.** If T2's supersede lands after T1's insert, it supersedes *T1's brand-new row*, then inserts values merged from its own stale read. Every field T1 changed that T2's payload omits is reverted. **Both callers get HTTP 200.** No error anywhere.
- **Zero active rows.** Supersede succeeds, insert fails → the client has no active goal, and every surface renders "No goal set yet".

`dc9898c` already shipped `update_client_goals_atomic` (a single RPC doing supersede + insert + mirror in one transaction) and was reverted; that migration file is gone and its slot 139 was reused by `139_nutrition_event_coach_note.sql`. **That RPC is the real fix, and it is not in this plan.** Session 0's ordering belt is insurance against a different failure (a dropped index), not against these two.

### The `clients.*` goal mirror survives this plan

Session 0b Task 0b.2 makes `updateGoals` its sole writer (4 files, ~14 lines). **Full removal is a separate workstream**, costed here so it is not re-derived:

- ~21 production files edited, 12 test files, 3 scripts, 4 docs, 1 migration + `gen types` ≈ **42 files**.
- **3 surfaces need a brand-new goal fetch**: the coach Overview (`GET /api/clients/[id]`), the client portal Goals card (`GET /api/client/progress`), and `/api/client/me` (the RN contract).
- Tier B ("delete the fallback reads, leave the columns as dead data") is **not separately shippable** — the moment writes stop the mirror goes stale, so the three surfaces above must convert in the same shipment. Tier B collapses into full removal.
- The `DROP` itself is trivially safe: `pg_depend = 0` on all three columns, no view/function/constraint depends on them **(DEV — re-probe prod before acting)**.
- **The riskiest single change is not the migration.** It is `CLIENT_SELF_COLUMNS` (`services/client-portal-service.ts:45-54`): a `+`-concatenated string, so TypeScript widens it to `string` and `tsc` cannot see a stale column name. Drop a column without editing that string and PostgREST 400s the whole query, `if (error || !data) return null` (`:73`) swallows it, and `/api/client/me` silently returns nothing.

### `client_goals.primary_goal` is dead weight

Zero branches, zero production writers, free `TEXT` with no CHECK. Removal is ~3 lines (`client-goals-service.ts:93-95`) plus a migration plus `gen types`; a bare `DROP` without the code change PGRST204s **every** goal write, because the column is an unconditional key in the INSERT. Not in Session 0 or 0b (neither has a migration). Do not confuse it with `client_intake.primary_goal`, which is a live discriminator with three real branches.

### Smaller items surfaced and deliberately not fixed

- **`Client.goalDeadline` is dead** — `mapClientRow` never maps the column, so three `?? client.goalDeadline` fallbacks (`nutrition-calc-inputs.ts:114`, `comparison-service.ts:65`, `nutrition/route.ts:152`) are unreachable. Session 0b Task 0b.1 decides — map it or delete them — unless Session 4 settled it first.
- **A second, inline BMR implementation** lives at `app/api/clients/[id]/metrics/route.ts:148-164` (Mifflin-only, ignores body fat), so the reset button and `/calculate-bmr` can disagree for the same client whenever current body fat is set.
- **`goalWeight` is `.optional()` but not `.nullable()`** (`lib/validations/client-goals.ts:28`) — it can be omitted, never cleared. And no refinement anywhere checks `goalStartDate <= goalDeadline`.
- **`cascadeNutritionAfterTrainingChange` swallows every regeneration failure** (`:349-351`) and does not destructure the plan-lookup `error` (`:340-345`). Recorded in Session 1, deliberately not fixed there.
- **The `is_modified` protection is a read-then-filter across a two-round-trip gap** (`nutrition-event-service.ts:180-185` read, `:207` write). A coach edit landing in that gap is clobbered. Only a transaction or RPC closes it.
- **The 8-week horizon exists in eight hardcoded `8 * 7` occurrences across five files** with no shared constant, and both service copies use server-local `Date` arithmetic despite `addDaysToDateString` being UTC-safe.
- **`nutrition_plans.name` is a live text column that is never written** (`app/api/clients/[id]/nutrition/route.ts:92-96`) — a second dead column on that table alongside `regeneration_reason`.
- **The `nutrition_events` template fallback (level 3) is still unbuilt.** A date past the horizon reads as "no target".
- **`check:labels` scans `app/` and `components/` only** and whitelists all of `components/client-portal/` and `app/client/`, so nothing built on the client surface proves typography compliance.

### Verification debt carried by this document

**Every live-data claim in this plan was measured against DEV** (`aeaphsslctwcmebldrzx`), never PROD (`etezzztgafcotyahgijk`), and prod has drifted from the migration tree before. That covers: "zero duplicate active goal rows exist", "0 of 212 clients have a mirror goal with no `client_goals` row", "`pg_depend = 0` on the three mirror columns", index existence, and every row count. Schema-shape claims are likely to hold across both; **anything destructive must re-probe prod first.**

---

## 8. STATUS blocks

*Sessions append here at commit time. Do not delete this section — it is how each session inherits the previous one's decisions.*

---

### Task 0.1 — Goal-merge presence fix ✅ SHIPPED 2026-08-10

A re-land of `53abf0a`, which `d58120c` reverted as collateral of removing an unrelated
feature and listed as *"worth re-landing on its own"*. Line numbers below are as of this
commit.

**What shipped.** `services/client-goals-service.ts:104` — `has()` is now
`hasOwnProperty(goals, key) && goals[key] !== undefined`. Plus the ordering belt on
`getCurrentGoals` (`:43`), four tests, and the `ARCHITECTURE.md:74` caller-list correction.

**THREE live clobber sites, not four.** `services/intake-review-service.ts:208` (the one that
fires in the common case — its sibling syncs are `== null` guards at `:153-161`, so "only body
fat lands in `updates`" is exactly the case where the client already has a goal weight) ·
`services/client-service.ts:281` (`updateClient`) · `app/api/clients/[id]/metrics/route.ts:211`.
`services/client-service.ts:106` (`createClient`) builds the same literal shape but is
**vacuous** — it runs straight after the client INSERT, so `getCurrentGoals` returns null and
both merge branches already yielded null.

> **`53abf0a`'s own code comment said "four … NULLed the sibling goal"** even though its commit
> message and STATUS block both said three. That comment is the artifact that ships inside the
> file, and this document gets deleted when the workstream lands (§16), so it would have become
> the only surviving record. The re-landed comment names `createClient` explicitly as
> same-shape-but-vacuous and tells the reader not to "correct" the count upward.

**Reachability.** `hooks/use-client-metrics.ts` sends one field per PUT, so editing goal body
fat alone reproduced it. The guarded mirror writes are actively defeated: all three harmful
callers correctly guard their own `clients.*` write, and then `updateGoals`' unguarded
dual-write (`:141-149`) overwrites those columns from the NULLed `merged` later in the same
request.

**The goals PUT is safe** — verified empirically, not assumed: zod 3.25.76
`safeParse({"goalBodyFatPercentage":22})` yields an object where
`hasOwnProperty(data,"goalWeight")` is `false`. Absent optional keys are stripped, and JSON
cannot carry `undefined`.

---

#### The ordering belt, and what it is not

`getCurrentGoals` now carries `.order("effective_from", { ascending: false }).limit(1)`.

Verified against the **live catalog** (DEV `aeaphsslctwcmebldrzx`), not the migration tree: both
`idx_client_goals_active_unique` and `idx_client_goals_client_effective` are alive and
byte-identical to `060:26-31`. `EXPLAIN (ANALYZE, BUFFERS)` on the new query shape gives
`Index Scan using idx_client_goals_client_effective`, `Filter: (superseded_at IS NULL)`,
**no Sort node**, cost `0.19..2.41`, 4 shared buffer hits.

**No tie-break, deliberately.** A `created_at`/`id` tie-break buys determinism, not correctness
(`id` is a random UUID), and would cost the index-only ordering.

**Its hole:** `effective_from` is stamped from one app-side timestamp (`:66`), so two racing
writers tie and the pick is arbitrary. **This is insurance against a dropped index, not a fix
for the write race** (§7). What it prevents: if the partial unique index were ever lost, two
active rows make `maybeSingle()` throw `PGRST116` forever — which 500s the goals GET, blanks
the whole nutrition tab (`nutrition/route.ts:87` sits in an unguarded `Promise.all`), and
bricks `updateGoals` itself, whose first statement is that same call, so the supersede that
would heal the duplicate is unreachable. No in-app recovery; a human runs SQL.

---

#### `notes` — CLOSED for Session 0's scope only; TWO questions remain OPEN

**CLOSED:** `notes` is **not carried forward** in the merge. Both legs of `53abf0a`'s reasoning
stand as recorded — per-row `set_by` provenance, and the unclearable-ratchet argument.

**OPEN, owned by Task 0b.6, and NOT settled by anything in Session 0:**
**(a)** does `notes` get a writer? **(b)** do `notes` and `primary_goal` get dropped?

**Why deferred — state the right reason, because the wrong one is easy to inherit.**
Deferred **solely because Session 0 has no migration by design.** *Not* because the data is
worth preserving. That argument was raised during planning and then **withdrawn on evidence**:
a live probe found 67 of 219 `client_goals` rows non-null, **every one seed-script filler**
(`scripts/seed/generate.ts:269`), zero human-written. **0b.6 must not re-derive a
data-preservation caution that has already been retired.**

**Owner's words, verbatim (2026-08-10), so this records an answer and not an inference:**
- On `notes`: *"ok don't worry we'll leave it."*
- On dropping the column: *"would it not make sense to drop the column and remove all code
  around it? If nothing writes or reads from it?"*
- On timing: *"yes do it now. We are not to leave anything just because there's not clients. No
  clients just means we don't have to worry about preserving data if we need to make
  architectural changes."*

**Reading (labelled as a reading, not as the owner's ruling):** *"we'll leave it"* followed a
long answer covering both carry-forward and dropping, so its range is ambiguous. It is recorded
as assent to leaving the merge alone in Session 0. **The drop question is recorded as raised and
open**, not as re-confirmed.

**Banked for 0b.6 so it is not re-derived:**
1. **Ordering, if the drop happens.** `primary_goal` must come out of the INSERT
   (`client-goals-service.ts:119-121`) **before** the `DROP` lands, or every goal write
   `PGRST204`s — it is an unconditional key in the `merged` literal, which the INSERT spreads
   via `...merged`. `notes` is in neither, so it is unordered. Separately, `types/client-goals.ts:35` (`ClientGoalRow`) is **hand-written** and
   must be edited alongside: once `database.ts` regenerates without the column, the row handed
   to `mapClientGoalRow` no longer satisfies that type and `tsc` fails. That is a belt, not a
   hazard — and note the failure is *not* in `select("*")`, which is simply indifferent to a
   dropped column.
2. **A prod probe is mandatory before any `DROP`.** §1's caveat names `DROP COLUMN` explicitly.
   The 67/219 count is **DEV**; prod (`etezzztgafcotyahgijk`) has never been queried by anyone
   on this workstream.

---

#### Carried to Session 0b — `updateGoals` non-atomicity, and why 0b.2 makes it worse

**`updateGoals` is not atomic** (§7): supersede (`:73-77`) then insert (`:124-133`) with no
transaction. A failed insert leaves the client with **zero active goals**. Deliberately not
fixed here — the honest fix is an RPC, and Session 0 has no migration by design.

**Correction to `53abf0a`'s STATUS block, which this session inherited and re-checked:** it says
*"all four callers swallow the error."* That is wrong, and `dc9898c` already corrected it. There
are **five** call sites — `metrics/route.ts:211`, `goals/route.ts:94`,
`intake-review-service.ts:208`, `client-service.ts:106` and `:281`. The **four object-literal
dual-write callers swallow** (log-and-continue); the **goals PUT surfaces it**, catching at
`goals/route.ts:109-115` and returning **500**.

**Two distinct swallows — do not conflate them.** The inner one at `client-goals-service.ts:152`
is the *mirror UPDATE* failing: logged, and `updateGoals` still returns success, so the caller
never learns. The caller-level one is *`updateGoals` throwing* and being caught. Different
boundaries, different data outcomes.

**Trace for Task 0b.2, which deletes the four direct `clients.*` writes.** Note first that
**`5d5fd99` — the fix that removed the caller-level swallow — was also reverted by `d58120c`**
and is on the same "worth re-landing" list, so **the swallow is live in `main` today.**

`updateGoals` throws after the supersede commits but the insert fails → `client_goals` has zero
active rows either way.

| | Mirror holds | Coach sees | Net |
|---|---|---|---|
| **Before 0b.2** | the **new** value (caller wrote it directly; it committed) | 200 | intent **survives** — reads fall through `?? client.goalWeight` (`comparison-service.ts:62`, `nutrition-calc-inputs.ts:111`, `nutrition/route.ts:149`) |
| **After 0b.2** | the **old** value — `updateGoals` threw before reaching its dual-write | 200 | the edit is **silently and completely lost**; every surface confidently renders the old goal |

**So 0b.2 strictly widens the blast radius of the non-atomicity defect by removing an accidental
backup.** It is shippable alone — the happy path is unaffected and it does buy a single
auditable write path — but it **should not ship alone**. Re-land `5d5fd99`'s swallow removal (or
the atomicity RPC) **before or with** 0b.2, or the trade is a recoverable silent divergence for
an unrecoverable silent loss.

**Scope limit on that accidental backup:** it covers **goal weight and body fat only**.
`mapClientRow` maps those two (`lib/mappers.ts:79-80`) but **not** `goal_deadline` — the dead
fallback §7 documents. **A lost deadline is already unrecoverable today**, before 0b.2 touches
anything.

---

#### Gates

`tsc --noEmit` clean · `eslint .` **0 errors** (209 pre-existing warnings, none in the changed
files) · `vitest run` **249 files / 2560 tests, all passing** · `check:labels` OK (634 files) ·
no `as any` · no leftover markers. **No migration**, so no `check:rls`, no `db push`, no
`gen types`.

**Tests are mutation-proven.** The four were written and run **before** the fix existed: all
four failed (the mirror pin showing `clients.goal_weight` arriving as `null` instead of `170`),
then all 14 passed with the fix. No `git stash` was used at any point — this repo's stash stack
holds two abandoned WIPs (`stash@{0}` = "phase2-wip KILLED 2026-07-01", whose migration is
already on the prod DB), so a `pop` would restore someone else's work.

**Honest limit on the fourth test:** against a mocked query builder it pins the query *chain*,
not real ordering. Proving the newest row wins needs a DB integration test this repo lacks.

**Baseline caveat.** The intended clean-tree baseline run raced the first test edit, so it is
derived rather than independently measured: that run showed **249 files / 2556 pre-existing
tests passing**, with the single failure being the newly-added ordering-belt test. The
known-flaky `components/client-portal/training/set-tracker.test.tsx` passed in that run. The
post-fix run confirms the arithmetic exactly: 2556 + 4 new = **2560, all passing**.

**No "no real clients" claim is made anywhere in this commit.** An earlier draft asserted that
no data was at risk; it was removed. Nothing was queried to establish it, PROD has never been
queried, and `5d5fd99` records a live client ("Sam Kay") holding mirror 78/15 against
`client_goals` 92/9 for six weeks from 2026-06-16 — a divergence caused by a *different* defect,
but more than enough to retire the framing.

**Browser smoke — RUN BY THE OWNER 2026-08-10, PASSED.** Client "TEST BF GOAL". The two
`client_goals` versions are the artifact:

| version | `set_by` | goal weight | goal body fat | state |
|---|---|---|---|---|
| v1 22:16:17 | coach uuid (the goal editor) | 72 | **null** | superseded |
| v2 22:17:30 | **`intake`** | **72 — carried forward** | 12 | **ACTIVE** |

`set_by: "intake"` proves the write came from `intake-review-service.ts:208`, the worst-case
clobber site, with `goalWeight` arriving as `undefined`. Under the old code v2's `goal_weight`
would have been `NULL`. The `clients` mirror agrees (72.0 / 12.00), so both stores are correct.

**The repro is NOT reachable in one intake pass — record this, it cost two false starts.** Sync
#1 on a fresh client sets goal weight *and* goal body fat together (both defined, no clobber),
and sync #2 then does nothing because both `== null` guards are closed. The bug needs the client
to **already have a goal weight while still having no goal body fat**. The reliable setup:

1. Client's intake fills **step 2's "Goal body fat %? (optional)"** — a *different* field from
   step 1's *current* body fat. Only the step-2 field arms the guard
   (`client.goal_body_fat_percentage == null && intake.goalBodyFatPercentage != null`).
2. **Before syncing**, the coach sets a goal weight in the nutrition-drawer goal editor and
   leaves its body-fat box empty (which sends explicit `null`).
3. Then run "Sync metrics to profile".

**Verify the path actually ran, not just the screen.** `updateGoals` supersedes-and-inserts on
every call, so the `client_goals` row count **must increase by one**. A first attempt on client
"test bf" looked like a pass and was not: its intake carried a *current* body fat but no *goal*
body fat, so no goal field entered `updates`, the `if (updates.goal_weight !== undefined || …)`
guard was false, `updateGoals` was never called, and the row count stayed at 1.
