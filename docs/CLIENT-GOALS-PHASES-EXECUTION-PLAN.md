# Client Journey — Goals, Blocks + Nutrition Builder — Execution Plan

**Status:** Sessions 0 · 1 · 1B ✅ shipped + smoked · Session 2 ✅ shipped 2026-08-11 · Session 3 ✅ COMPLETE — shipped 2026-08-11 + owner-directed follow-ups 3.6 (block editing, end-date granularity) · 3.7 (archive) · nutrition-column resemantic, all 2026-08-12; owner sign-off 2026-08-12 · Session 4 ✅ COMPLETE — shipped + owner-smoked all clear 2026-08-12 (its STATUS blocks carry the 0b.1 map-or-delete answer and the merged-series parity decision) · Session 4B ✅ COMPLETE — shipped 2026-08-12 (17 commits, ZERO migrations; six owner-smoke follow-ups folded in, incl. the discarded custom TDEE, the impossible-pair guard, inline client editing and the design-system pass) · Session 0b ✅ COMPLETE — shipped + owner-smoked all clear 2026-08-13 (8 commits, ZERO migrations; invariant 16 satisfied: one writer, one read path, one editor; two smoke follow-ups folded in — the deadline's native date bounds and the block timeline's nutrition eras) · Session 5 ✅ COMPLETE — descoped to one typing commit, shipped + owner-smoked all clear 2026-08-13 (2 commits, ZERO migrations; the deficit input is PARKED, not rejected) · Session 6 ✅ COMPLETE — shipped 2026-08-13 (7 commits, migration 147 `nutrition_plan_notes`; the plan-save note now has TWO homes, and the client-visibility policy is enforced on the wire) · **Session 7 ADDED 2026-08-21** (owner-directed UX session: Exercise Data moves into Journey, and the block empty states become round trips into the apply/builder flows) — one session remains (7) · **Owner decision date:** 2026-08-10
**Nine sessions.** Three largely independent features share this document, plus a UX session (7) added after they shipped. Each session is designed for a fresh Claude Code session with a full context window.

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
3. **Durations in, dates out.** The coach enters a start date plus a list of lengths; the service computes the chain. Overlaps and gaps are structurally impossible, so there is no overlap validation to write. *(Amended 2026-08-12, owner-approved — Session 3.6-B: a length is now expressed as the block's END DATE, day-granular. Starts stay derived and date pairs still never cross the wire, so the mechanism this invariant protects is unchanged; only the unit moved from weeks to days.)*
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
15. **One migration number, taken at execution time.** Never pre-assign a number in this document. Slot 139 has already been burned once by a reverted commit (`dc9898c` shipped `139_update_client_goals_atomic.sql`; the live 139 is `139_nutrition_event_coach_note.sql`). As of 2026-08-11 the tree ends at `143_advance_nutrition_plan_effective_from.sql` (Session 1 Task 1.3).
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
| `CONVENTIONS.md:404` + `ARCHITECTURE.md:173` (and its echoes at `:39`, `:204-206`, `:234`, `:237`, `:246`, `:723`) | The single-durable-nutrition-plan rule ("no versioning/archival", "deliberate asymmetry — do NOT consistency-refactor") — a recorded decision whose premise died with migration 143. | **Reversed by owner decision 2026-08-11** (§3 class (b), stale premise). Rewritten in **Session 1B Task 1b.5**, recording the reversal; grep beyond the listed lines. `NUTRITION-CALENDAR-IMPLEMENTATION-SPEC.md` gets a superseded banner in the same task. |

### Rule collisions to expect

| Where | Rule | Class | What to do |
|---|---|---|---|
| `CONVENTIONS.md §2` | *"Don't add … performance optimizations unless explicitly requested"* | n/a | The Session 1 cascade change **is** explicitly requested by the owner (2026-08-10). Not a deviation. |
| `CONVENTIONS.md §2` | *"One fix per change"* | **(a)** | Comply *within* a session: each numbered task is its own commit. Sessions bundle tasks; commits do not. |
| `CONVENTIONS.md §3` | *"Forms use React Hook Form with `zodResolver(schema)` and `defaultValues`"* (`:164`) | **(a)** | The existing `client-goal-editor.tsx` uses six raw `useState` calls and predates the rule. The Session 0b editor complies; do not copy the old one. |
| `CONVENTIONS.md §4` | File size limits | **(a), soft** | Explicitly guidelines. Split only at a natural boundary (block row / block form / pace readout), never by prop-drilling one flow across files. |
| `CONVENTIONS.md §5` | *"No `as any` type casts"* | **(a)** | `services/nutrition-plan-service.ts` casts the RPC arg object `as never` **twice**, so tsc verifies nothing about the 24 keys. Session 5 is now the single task that removes them — see Task 5.1. No arity change is involved any more; the signature stays at 24. |
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
| **1** ✅ | Foundations: the cascade, the energy helper, the plan-row date lie — **SHIPPED + smoked 2026-08-11** | **1** (RPC body swap, same arity) | The nutrition hero |
| **1B** ✅ | Nutrition plan versioning: date-ranged versions, close-and-insert RPC, date-resolved reads — **SHIPPED + smoked 2026-08-11** (5 commits + a D1 guard-tightening follow-up; migration 144) | **1** (index swap + exclusion constraint + RPC rewrite, same arity) | Correct queued-change behaviour; the hero's chain-aware lines |
| **2** ✅ | Blocks backend: table, service, routes — **SHIPPED 2026-08-11** (5 commits; migration 145; no browser smoke by design — Session 3's UI smoke is the routes' first live exercise) | **1** (`client_phases`) | No — API only |
| **3** ✅ | Journey tab: rename, Blocks list, chart shading — **SHIPPED 2026-08-11**, plus owner-directed follow-ups 3.6 (editing + end-date granularity), 3.7 (archive, migration 146) and the nutrition-column resemantic, 2026-08-12 | **1** (146, from 3.7) | Yes — the coach block feature |
| **4** ✅ | Client-facing block + the "Waiting on you" row — **SHIPPED + owner-smoked all clear 2026-08-12** (3 commits; no migration) | none | Yes — the client block feature |
| **4B** ✅ | TDEE ownership: profile owns BMR/TDEE, builder consumes — **SHIPPED 2026-08-12** (17 commits; the calculator now CONSUMES the profile's TDEE rather than re-deriving it) | none | Yes — activity + custom TDEE move to the client profile; the drawer loses its dropdown |
| **0b** ✅ | Goals: one read path, one writer, one editor, history — **SHIPPED + owner-smoked 2026-08-13** (8 commits; no migration) | none | Yes — the goal editor |
| **5** ✅ | Type the plan-save RPC payload (`as never` removal) — **DESCOPED 2026-08-13**, then **COMPLETE — shipped + owner-smoked all clear 2026-08-13** (2 commits); the deficit input, its two columns and the arity change are parked, see SESSION 5 | none | No — one typing commit |
| **6** ✅ | The save note + the Journey timeline — **SHIPPED 2026-08-13** (7 commits; migration 147) | **1** (`nutrition_plan_notes`) | Yes |
| **7** | The journey is the place you set things up — Exercise Data moves to Journey; the block empty states become round trips into apply/builder | none | Yes |

### What actually depends on what

Read this before assuming the order above is forced. It mostly is not.

- **2 → 3 → 4.** A real chain: each needs the previous one's API. This is the only hard chain in the document.
- **Session 5 now depends on NOTHING** (descoped 2026-08-13). Every dependency it had — `1.2 → 5`, `1B → 5`, `4B → 5`, `5 → 6` — existed because of the stored deficit, its two columns and the arity change they forced. All three are parked, so the remaining task is a typing change with no data, no migration and no shared surface. It can run whenever, including after Session 6.
- **1B → 3.2, correctness not code.** Task 3.2's nutrition column resolves the version covering the block's window (see the note in its table row); without 1B an elapsed block would read the CURRENT plan's `tdee` against an old era's event baseline and print a wrong deficit.
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

# SESSION 1 — Foundations ✅ COMPLETE (SHIPPED + smoked 2026-08-11)

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

> ⚠️ **SHIPPED as specified (`c96896b`, migration 143) — then SUPERSEDED by SESSION 1B**
> (owner decision 2026-08-11, same day). 143's conflict-path fix made queued changes
> real, which exposed that the single in-place row cannot describe the time before its
> own `effective_from` (the pre-window cascade leak, owner-reported within hours of the
> smoke). SESSION 1B replaces the in-place model with date-ranged versions; under it
> `effective_from` means "when this version started" and the never-update bucket
> question below dissolves (each save is a new row). The section is kept as-authored
> for provenance; the "Rejected alternative: `pending_effective_from`" note still
> stands — 1B is NOT that shape (windows are date-derived; no status lifecycle).

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

# SESSION 1B — Nutrition plan versioning (date-ranged versions) ✅ COMPLETE (SHIPPED + smoked 2026-08-11)

**One migration. Inserted 2026-08-11 by owner decision — runs after Session 1, before
Sessions 2–6 (hard prerequisite for Session 5; corrects a latent bug in Session 3 Task
3.2's nutrition column).**

> **What this session reverses, and why that is legitimate.** `CONVENTIONS.md §8`
> ("Nutrition plans stay one durable active plan per client … no versioning/archival")
> and `ARCHITECTURE.md`'s "deliberate asymmetry — do NOT consistency-refactor" are a
> **recorded owner decision**, and this session overturns it — §3 class (b),
> stale-premise, owner-approved 2026-08-11. The premise died with migration 143: the
> decision assumed a plan row whose window opened at birth and never moved. Once
> `effective_from` could sit in the future, the single row could only describe the
> NEXT prescription, and nothing anywhere described the time before it except the
> generated events. Five symptoms of that one gap: (1) the cascade leak — any training
> edit in the pre-`effective_from` window rebuilt those days from the new template
> (owner-reported 2026-08-11, screenshot in session log; TECHNICAL-DEBT entry 5);
> (2) the client-card template gate shipped in 1.3 returns NOTHING for pre-window days
> because the true value was unknowable; (3) reset-on-a-pre-window-day cannot restore;
> (4) history attribution returns null targets for every unlogged day older than the
> last save; (5) Session 3 Task 3.2's elapsed-block deficit (`plan.tdee − event
> baseline`) would mix eras by construction. Versioning is also a RESTORATION: the
> nutrition RPC was close-and-insert from migration 048 through 110 (078 is the
> closest template); 115 flattened it.
>
> **This does NOT violate invariant 2 or §1's "no status column" rule — it is the
> same side of that argument.** Versions are resolved BY DATE (`coversDate`);
> planned/current/ended are derived at read time; nothing promotes at midnight.
> `status` records coach ACTS only (`active` | `archived` = deleted-by-coach;
> superseded versions stay `active` with closed windows). There is NO `planned`
> status — that shape was built and retired twice (migrations 079→116, and the
> roadmaps feature §1 documents). Events remain the per-date SOT; per-day edits still
> materialize onto events (`is_modified`) and never mint versions; versions are minted
> ONLY by plan saves.

## Design — closed 2026-08-11, do not re-litigate

1. **Model.** N `nutrition_plans` rows per client whose `[effective_from,
   effective_until]` windows tile the client's timeline; `effective_until IS NULL` =
   the open (latest-saved) version. Each version owns its own
   `nutrition_plan_daily_targets` grid (already FK'd per row — free). The coach never
   supplies an end date: **starts in, windows out** — every close is derived, so
   overlaps and gaps are unexpressible through the API (the blocks-invariant-3
   principle). "Placing a plan on top" of a chain replaces the overlapped days from
   its start forward, at both the plan layer (close/absorb below) and the event layer
   (the save's regeneration sweeps its window).
2. **The write path (RPC, one transaction, SAME 24-arg signature — the close date
   derives from `p_effective_from`, so no new args).** Three branches on the client's
   open row: **(a)** none → plain INSERT. **(b)** open row starts BEFORE the new date
   → close it at `new − 1 day`, INSERT the new version. **(c)** open row starts
   ON/AFTER the new date → **absorb**: update that row in place (all prescription
   columns + `effective_from`; the daily-targets DELETE-then-INSERT from 143 stays
   load-bearing here), and re-close the predecessor at `new − 1` if one exists —
   same-day re-saves collapse into one version, inverted windows are impossible, and
   saving earlier than a queued change replaces it.
3. **Delete = close, never erase.** `orchestrateNutritionPlanDeletion` closes the
   covering version at the client's today and archives-AND-closes every version
   reaching past today (a queued version gets `status='archived'` + its window shut —
   an archived row must never carry an open window). Future scheduled events are
   deleted **client-scoped by date** (`deleteFutureNutritionEventsForPlan`'s plan-id
   scoping misses events stamped by a queued version's id). Today and the past stay,
   matching the dialog copy.
4. **One resolver family, training's pattern, reusing `coversDate`**
   (`services/training-plan-window.ts` — table-agnostic, verified): in
   `nutrition-plan-service.ts` add `getNutritionPlanForDate(clientId, date)`,
   `getNutritionPlanIdForDate`, and `getNextFutureNutritionPlan(clientId, today)`
   (earliest-first, mirroring `getNextFutureTrainingPlan`); keep
   `getActiveNutritionPlanId` as a thin covering-today wrapper. Live resolution
   filters `status='active'`; **history reads keep NO status filter** (a deleted
   plan's rows still explain their past — `schedule-data-service.ts:172-183` already
   does this and is already version-correct; leave it).
5. **The coach GET returns three roles** (the two-row shape is insufficient for
   chains — a third queued version made `scheduledFor` skip the next change):
   **covering** version → `effectiveFrom` ("Active since") and `hasCurrentTargets`
   (now derived from covering-row existence — **retire the `todayEvent` probe added
   by `4ed4017`**, route + hook + hero threading); **earliest-future** version →
   `scheduledFor` ("Starts / New targets from"); **open** version → drawer seeds
   (`workActivityLevel`, `proteinTargetGPerKg`, custom macros, targets) and
   `goalChanged` — seeding from anything else lets Generate clobber a queued
   prescription, the exact failure `use-nutrition-builder.ts:43-49`'s seed-key
   exists to prevent. `hasPlan` becomes an explicit response field (no covering AND
   no future = none); `use-nutrition-plan.ts:84`'s `!!calorieTarget` derivation dies.
6. **Guards, bottom to top:** construction (starts-only API) → the open-row partial
   unique index (`(client_id) WHERE status='active' AND effective_until IS NULL` —
   racing saves collide loudly) → a **DB-level exclusion constraint**
   (`EXCLUDE USING gist (client_id WITH =, daterange(effective_from, effective_until,
   '[]') WITH &&) WHERE (status = 'active')`, `CREATE EXTENSION IF NOT EXISTS
   btree_gist`) so the database physically refuses overlapping active windows. The
   constraint is a backstop that must never fire; a violation surfaces as a loud RPC
   error, never silent drift.
7. **`regenerateFutureNutritionEvents` keeps its one-planId contract; CALLERS
   segment.** Its plan select gains `effective_from, effective_until` and clamps its
   window to the version's own range. The cascade fetches every `status='active'`
   version overlapping its scope (the `schedule-data` windowed-array query shape),
   splits the scope's dates per covering version, and loops the regenerate — which
   closes the leak **by construction**. Fix the two `maybeSingle()`-without-limit
   sites while in there (`nutrition-event-service.ts:380-385` — destructure and log
   `error` per the house rule; `nutrition-plan-orchestrator.ts:288-293`), and re-key
   the from-scope delete client-scoped by date (plan-scoped misses prior-version
   rows).
8. **The client-card template gate becomes a WINDOW test** (both ends of the covering
   version), replacing 1.3's one-sided `effectiveFrom` gate: no-event days outside
   the covering window drop exactly as today; days inside it are always served from
   the right era's grid. (Full per-date multi-version week rendering — the
   `findActiveNutritionPlan` shape — stays available later if a real straddling case
   demands it; record, don't build.)
9. **Absorb warning in the apply dialog:** when `scheduledFor` exists and the picked
   date is on/before it, one sentence states the queued change will be replaced
   (the amendment surface's re-lay-warning register). Warn, then do what was asked.

## Ground truth from the 2026-08-11 sweeps — do not re-derive

Three read-only agent sweeps (write path / read consumers / tests+UI+docs) + a live
DEV probe. Full inventories in the session transcript; the load-bearing subset:

- **Live DEV** (`aeaphsslctwcmebldrzx`, 2026-08-11): 209 plan rows — 185 `active`,
  24 `archived`; 5 clients already multi-row (max 8); `effective_until` non-null on
  10 rows; **no CHECK constraints on the table**; FKs: events SET NULL (live truth —
  113's rebuild, not 077's original CASCADE), logs SET NULL, daily-targets CASCADE.
  Indexes: pkey, `idx_nutrition_plans_active_unique (client_id) WHERE
  status='active'`, `(client_id, effective_from DESC)`. Prod never probed — §1's
  DEV/PROD caveat applies; the migration's backfill must be idempotent.
- **Two LOUD breaks** the moment a second `status='active'` row exists —
  `nutrition-event-service.ts:380-385` (cascade lookup, `maybeSingle` no limit,
  error DISCARDED → every training cascade silently no-ops) and
  `nutrition-plan-orchestrator.ts:288-293` (same shape, wrong
  `regeneration_reason`).
- **Seven QUIET-corruption reads** (`.eq("status","active").order("effective_from",
  desc).limit(1).maybeSingle()` — would silently pick the FUTURE row):
  `nutrition-plan-service.ts:177-183` · `app/api/clients/[id]/nutrition/route.ts:78-85`
  · `services/client-portal-service.ts:103-109` · `check-in-context-service.ts:66-72`
  · `comparison-service.ts:45-51` · `overview-plan-summary-service.ts:226-234` ·
  `activation-readiness/route.ts:45-50` (no order — arbitrary row).
- **Per-date resolution sites:** `daily-context-service.ts:87-88`
  (`resolvePlanContextForDate` — stamps `nutrition_logs.nutrition_plan_id`
  PERMANENTLY; already mis-stamps backdated logs today, fixed by per-date) and both
  reset routes (`nutrition/events/[date]/reset/route.ts:55`,
  `nutrition/events/reset/route.ts:56` — a date list can straddle a boundary; group
  by covering version).
- **Already version-correct, zero changes:** `schedule-data-service.ts:161-228`,
  `utils/nutrition-period-summary.ts:28-36` (`findActiveNutritionPlan` — the
  reference implementation), `scripts/cleanup-duplicate-events.ts`. **Three free
  behavioural repairs** land with no code: per-era history attribution (currently
  null for unlogged days older than the last save), check-in snapshots across a
  change, and the drift banner's "since" date (`comparison-service` reads
  `created_at`, which the in-place RPC never re-stamped — it prints the FIRST-EVER
  plan date today; switch it to the covering version's `effective_from`).
- **Green-but-wrong test pins that must be rewritten, not appeased** (the
  workaround-enforcers): `utils/__tests__/build-daily-targets.test.ts:188-222` (the
  four 1.3 gate tests), `services/client-portal-service.test.ts:164-167` (pins
  `effectiveFrom: null`), `daily-context-service.test.ts:39-45` (pins today's-plan
  stamping), `nutrition-plan-orchestrator.test.ts:127-131` (pins stable-id reuse),
  hero tests' `hasCurrentTargets` fixtures. The `nutrition-plan-service.test.ts`
  **24-key pin SURVIVES** (same signature) and stays the PGRST202 belt.
- **Zero-coverage surfaces needing tests:** the cascade helper (none exist),
  `archiveNutritionPlan`, `getActiveNutritionPlanId`, the coach GET (no GET tests),
  both reset routes, `findActiveNutritionPlan` with 2+ windows.

### Task 1b.1 — Migration + the resolver family

ONE migration, next free number at execution time (tree ends at `143` as of
2026-08-11): **(1)** backfill `effective_until` on archived rows where NULL
(migration 116's `COALESCE(effective_until, effective_from)` precedent — required
before the new index predicate is clean); **(2)** drop
`idx_nutrition_plans_active_unique`; create the open-row guard
`(client_id) WHERE status='active' AND effective_until IS NULL`; **(3)**
`CREATE EXTENSION IF NOT EXISTS btree_gist` + the exclusion constraint (design 6);
**(4)** the RPC rewritten close-and-insert with the three branches (design 2) —
**same 24-arg signature**, so `CREATE OR REPLACE` with the FULL header restated
(`SECURITY DEFINER`, `SET search_path = public` — 143's warning: a replace inherits
neither) and no REVOKE/GRANT dance; the `ON CONFLICT` clause dies with the index it
targeted. Migration comment records the reversal + the three branches. Then the
resolver family (design 4) in `nutrition-plan-service.ts`. Pre-flight + post-push
live probes: catalog (prosecdef/config/ACL/single overload) + behavioral
`BEGIN…ROLLBACK`-style probe rows for ALL THREE branches, a 3-version chain, the
absorb-with-earlier-date re-close, and the race (second open row → unique
violation). `db push` is classifier-blocked — the owner runs it. `gen types` diff
expected EMPTY (no column changes). 24-key test unchanged; new unit tests for the
resolvers (mock-level) ride here.

### Task 1b.2 — Write-path correctness: cascade, deletes, resets, stamping

Design 7 + 3 in full: cascade version-segmentation (+ the two error-handling fixes),
from-scope delete re-keyed client-scoped, regenerate window-clamping,
`resolvePlanContextForDate` per-date, both reset routes per-date-grouped,
`deleteFutureNutritionEventsForPlan` client-scoped, `archiveNutritionPlan` →
close-and-archive semantics, deletion orchestrator handles the chain. Tests: FIRST
cascade coverage (boundary segmentation, both loud-break regressions), window
clamps, per-date stamping (backdated log gets its era's id), reset-across-boundary,
delete-chain semantics. TECHNICAL-DEBT entry 5 (baseline leak) is CLOSED by this
task — rewrite it as fixed-by-1b.2; entries 1–4 stay open (stale tail, swallow —
partially addressed by the destructure fix, re-scope its text — foreign-plan
rewrite, logged→scheduled flip).

### Task 1b.3 — Coach surface: the three-role GET + everything that reads it

Design 5 + 9: the GET's three resolutions and field re-mapping; retire the
`todayEvent` probe (route, `use-nutrition-plan.ts` type, hero threading — added
`4ed4017`, removed cleanly); explicit `hasPlan`; `activation-readiness` = covering
OR future version exists (a coach who queued a first plan IS ready);
`check-in-context` covering-existence; `comparison-service` covering version +
`effective_from` as the banner's "since" date; `overview-plan-summary` covering;
the absorb-warning dialog line; UI copy sweep (`drawer-form-body.tsx:95-104`'s
"no versioning" comment + copy, `delete-nutrition-plan-dialog` plural-safe copy,
`nutrition-plan-builder` delete toast). Hero tests rewritten from plan-row states;
the green-but-wrong pins above.

### Task 1b.4 — Client portal + scripts

Portal read → covering-today; the gate → window test (design 8;
`buildDailyTargetsFromPlan`'s required `weekWindow` param gains the window's other
end — tsc enumerates all call sites again); `backfill-nutrition-events.ts` restores
its per-version window branch (the pre-115 shape its own comment mourns, bounded by
`effective_until`); both seed scripts emit a **closed + open version pair** so the
resolution path is exercised (`seed/generate.ts:477`'s index comment updated);
portal test fixtures gain `effective_from`/`effective_until`.

### Task 1b.5 — Documentation reconciliation (owner-mandated, not optional)

**`docs/ARCHITECTURE.md` and `CONVENTIONS.md` WILL need reconciliation to match the
new versioning model — treat the list below as the checklist FLOOR and grep for
stragglers at execution time** (`single durable`, `one durable`, `in place`,
`in-place`, `idx_nutrition_plans_active_unique`, `no versioning`):

- `CONVENTIONS.md:404` — the normative single-durable-plan rule: REWRITTEN to the
  versioned model, recording the reversal (owner 2026-08-11, stale-premise per §3
  class (b)) and what survives (events-SOT, per-day edits materialize, one target
  per day).
- `docs/ARCHITECTURE.md` — `:39` (hierarchy line), `:173` (the "deliberate
  asymmetry" paragraph — now BOTH tracks are date-ranged; state what still differs:
  nutrition chains contiguously via derived closes, training coexists additively),
  `:204-206` (heading + the durable-plan paragraph — rewrite around versions;
  `effective_from` again means "born AND took effect", they now coincide),
  `:234` (cascade fetches all versions overlapping the scope), `:237` (the baseline
  leak paragraph — fixed by construction, point at the closed debt entry), `:246`
  (template fallback = the covering version's grid), `:723` (`hasNutritionPlan`
  meaning).
- `TECHNICAL-DEBT.md` — close entry 5; re-scope entry 2's text (destructure fix
  landed); fix `:85-88`'s "one durable plan bounds the exposure" and `:709`'s
  single-plan rationale.
- `NUTRITION-CALENDAR-IMPLEMENTATION-SPEC.md` — superseded-banner at top: its Mig B
  / in-place upsert design (`:65,:68,:93,:95`) is reversed by this session; the doc
  stays as history.
- THIS DOCUMENT's Task 1.3 + its STATUS block carry supersession banners (added at
  1B insertion time); Session 5 note likewise. STATUS blocks per task as always.

### Session 1B verification

- Full `CONVENTIONS.md §13` per task + `npm run check:rls` (migration) + the §2
  security/load/perf review at 1b.1 and 1b.2 (SECURITY DEFINER surface + write-path
  change both trigger it).
- Live-DB proof, not just unit green: all three RPC branches, a 3-version chain
  resolving correctly per date, the exclusion constraint rejecting a manufactured
  overlap, the race producing a loud unique violation.
- **Browser smoke (owner runs it):** (1) the ORIGINAL leak repro — future-dated
  regenerate, then move a training event inside the gap week → the moved day keeps
  the OLD prescription's numbers; (2) queue two future versions → hero shows the
  EARLIEST as "New targets from", drawer seeds from the LATEST; (3) delete with a
  chain → today survives, tomorrow-forward gone, calendar shows no orphaned targets;
  (4) save with a date on/before a queued change → the dialog warns, the queued
  version is replaced.

---

### 📋 SESSION 1B PROMPT — paste this into a fresh session

```
Read these in full before planning anything:
  1. CONVENTIONS.md  (mandatory — it says so at the top; do not skip sections)
  2. docs/ARCHITECTURE.md
  3. docs/CLIENT-GOALS-PHASES-EXECUTION-PLAN.md — §1, §2 (invariants), §3, §4, §5,
     the SESSION 1 STATUS blocks in §8, and ALL of SESSION 1B including "Ground truth
     from the 2026-08-11 sweeps". You are executing SESSION 1B only.

Session 1B converts nutrition_plans from one in-place-upserted row per client to
DATE-RANGED VERSIONS (the training-plans model): saving closes the open row at
new_start − 1 and inserts the new version; "active" resolves BY DATE via coversDate;
status records coach acts only (active | archived) — there is NO planned status,
planned/current/ended are derived. The design section is CLOSED owner decisions —
do not re-litigate them, including the §8-recorded reversal of CONVENTIONS'
single-durable-plan rule (stale-premise, owner-approved 2026-08-11).

The "Ground truth" block lists every resolution site, the two loud breaks, the seven
quiet-corruption reads, the green-but-wrong test pins, and the zero-coverage
surfaces. Trust it as the floor, not the ceiling — re-grep before claiming done.

Rules for this session:
- CONVENTIONS §2: show me a plan and get approval before writing any code.
- One commit per numbered task (1b.1–1b.5); migration + regenerated types same commit.
- Take the NEXT FREE migration number at execution time. Never pre-assign.
- §8 migration workflow exactly. npx supabase db push is classifier-blocked — tell me
  and I run it with `!`. Verify the RPC against the LIVE catalog before and after
  (prosecdef, search_path, ACL, single overload) — CREATE OR REPLACE inherits
  neither SECURITY DEFINER nor SET search_path; restate the full header.
- The RPC keeps its 24-arg signature. The as-never casts stay (Session 5 removes
  them with its arity change); nutrition-plan-service.test.ts's 24-key pin is the
  only belt against a silent PGRST202 — keep it green, never delete it.
- Do not touch training-side deletion (deleteEvent, cancelFutureEventsForPlan, the
  plan-clear routes) — verified unchanged by design. Do not touch
  training_events.calorie_surplus_percentage population anywhere.
- Task 1b.5's doc reconciliation is owner-mandated: ARCHITECTURE.md and
  CONVENTIONS.md must be reconciled to the versioned model in the same session,
  greping beyond the listed lines for stragglers.
- If a doc rule blocks you, follow §3: quote, classify, comply/update/STOP AND ASK.
- Commit-ready = all of CONVENTIONS §13 + npm run check:rls.
- Append a STATUS block per task; file durable defect records in TECHNICAL-DEBT.md,
  not only in STATUS (this plan doc is deleted when the workstream lands).

Start by reading the documents, then show me your plan for 1b.1 before any code.
```

---

# SESSION 2 — Blocks backend ✅ COMPLETE (SHIPPED 2026-08-11)

> **Shipped 2026-08-11 — 5 commits (`aad286f`…`cbf95d0`), migration 145.** The §8
> STATUS blocks are authoritative for what actually shipped and the decisions made at
> plan review (truncate-on-current-delete, the symmetric window floor, pace as a
> client-side pure derivation, DELETE at `/blocks/[blockId]`, foreign-client 404).
> No browser smoke by design — nothing user-visible; Session 3's UI smoke is these
> routes' first live exercise.

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

# SESSION 3 — The Journey tab ✅ COMPLETE (SHIPPED 2026-08-11 · 3.6/3.7 follow-ups 2026-08-12 · owner sign-off 2026-08-12)

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
| **Nutrition** — calories, what the deficit was | The **events**, not the plan row (events are SOT). Deficit = `plan.tdee − event baseline`, derived rather than stored (Session 5's stored deficit is parked — see SESSION 5) — **where `plan` is the VERSION covering the block's window** (`getNutritionPlanForDate`, Session 1B), never the current row: an elapsed block read against today's `tdee` mixes eras and prints a wrong deficit. Empty: "Not set". |
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

# SESSION 4 — Client-facing block + the coach's one row ✅ COMPLETE (SHIPPED + owner-smoked all clear 2026-08-12)

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

# SESSION 4B — TDEE ownership: profile owns metabolism, builder consumes it ✅ COMPLETE (SHIPPED 2026-08-12)

**Zero migrations (every column exists — if you believe one is needed, STOP AND ASK).
Six tasks. Inserted 2026-08-12 by owner decision after the Session 3.2 browser smoke
exposed the incoherence. Runs BEFORE Session 5 — hard prerequisite: 5's stored
deficit assumes a trustworthy TDEE.**

> **Design — closed 2026-08-12, do not re-litigate.** The client PROFILE is the
> single owner of metabolic identity: `clients.work_activity_level`, `clients.bmr`,
> `clients.tdee` + the existing `bmr_manual_override` / `tdee_manual_override`
> flags. BMR and TDEE are **never written separately** — one shared helper writes
> the pair atomically (BMR = Katch-McArdle when body fat is known, else
> Mifflin-St Jeor; TDEE = BMR × multiplier(client's activity)), recomputing
> automatically whenever weight/body-fat changes, EXCEPT values frozen by an
> override flag. The coach edits **activity level in the client settings dialog**
> (describe the client, never compute), with a **"Custom"** option exposing a plain
> TDEE input that sets the override — always displayed beside what auto would say,
> one click back to auto. **The nutrition builder is a pure consumer:** its
> work-activity dropdown is REMOVED (owner call — "do they click it when
> regenerating? how are they supposed to know that's how you update TDEE?"), the
> drawer shows a read-only "TDEE · from profile" line, and plans keep
> **snapshotting** bmr/tdee at save (owner-confirmed: plan calories are accurate to
> generation time; a weight change updates the PROFILE only, and a regenerate — at
> the coach's discretion — inherits the then-current profile numbers. No plan
> auto-mutation, ever).

### What the investigation found — verified live, do not re-derive

Fixture client `5ca1ec1e-0000-4000-8000-000000000001`, dev DB, 2026-08-12. The
Overview showed the impossible **BMR 3712 / TDEE 3515**; earlier **BMR 1850**,
elsewhere **TDEE 2220**. Every number decoded exactly:

- **3712** = Katch-McArdle(170 kg, 9% BF) — right math, fresh inputs.
- **1850** = a hardcoded seed literal (`scripts/seed-scale-client.ts:248`) — never computed.
- **2220** = 1850 × 1.2 (sedentary) · **3515** = 1850 × 1.9 (extremely active).
- The impossible pair is `POST /api/clients/[id]/calculate-bmr` writing **`{ bmr }`
  only** (`calculate-bmr/route.ts:78-81`; its comment: *"TDEE is calculated when
  nutrition settings are configured"*) — a recalc updates BMR and strands TDEE at a
  number derived from a BMR that no longer exists.

**Structural diagnosis: no owner.** Five uncoordinated writers, three read paths:

| Writer | Today's behaviour |
|---|---|
| `app/api/clients/[id]/calculate-bmr/route.ts:78-81` | writes `bmr` alone, never `tdee` |
| `services/client-check-in-service.ts:183-191` | recomputes BMR from check-in weight, writes `tdee = bmr × 1.2` **hardcoded** — ignores activity |
| `app/api/clients/[id]/metrics/route.ts:139-141, :167-172` | manual bmr/tdee with override flags; "reset to auto" also hardcodes × 1.2 |
| the drawer / plan save (`hooks/use-nutrition-builder.ts`, `nutrition-plan-orchestrator.ts:277-279`) | `tdee = bmr × the PLAN's own work_activity_level` — activity lives in TWO places (`clients.` and `nutrition_plans.work_activity_level`) and they disagree on the fixture (client: sedentary; plan: extremely_active) |
| seeds / intake sync | literals |

Reads: the Overview card reads the `clients` mirror; the drawer live-computes from
the plan's activity; `services/nutrition-calc-inputs.ts:92` prefers the latest
`body_metrics` event's tdee snapshot over the mirror. Also `services/bmr-service.ts:51`:
`calculateBMR()` itself returns `tdee = bmr × 1.2` ("assuming sedentary") and callers
treat that as THE tdee. Downstream, every consumer inherits the garbage — including
the Journey block deficit (version snapshots of a poisoned tdee).

### Task 4b.1 — Pin the unexplained writer, then plan

**Which flow wrote `tdee = 3515` onto the fixture's clients row is NOT conclusively
pinned** (fixture churn made it ambiguous; candidates above). Prove it with live-DB
+ git evidence FIRST — it may reveal a sixth writer the table misses. Debug first,
fix second (CONVENTIONS §2).

### Task 4b.2 — One shared writer: `recalculateClientEnergy()`

New helper beside `services/bmr-service.ts`: computes and writes the PAIR atomically
from (current weight, body fat, height, gender, dob, `clients.work_activity_level`),
respecting both override flags (a frozen value is never recomputed; custom TDEE +
moving weight ⇒ BMR moves, TDEE stays pinned). Multipliers via the existing
`getActivityMultiplier` (`services/nutrition-service.ts:52`). Route every writer
through it: the check-in dual-write, coach metric-entry weight/BF logs, intake sync,
the metrics route's manual edits and reset-to-auto. `calculate-bmr` dies or becomes
"recalculate now + clear overrides". Kill `calculateBMR()`'s hardcoded ×1.2 return
with its callers. **Landmine:** the metrics route is a Session-0 goal-clobber caller
of `updateGoals` — do not disturb that fix while in the file.

### Task 4b.3 — The client settings dialog: activity + custom override

The activity select (the existing sedentary→extremely-active ladder) with a live
TDEE preview, plus the "Custom" option → plain TDEE input → sets
`tdee_manual_override`. Always render the frozen value beside auto ("Custom 3,100 ·
auto would be 2,850"); "Back to auto" clears in one click. BMR override: same
mechanics, visually de-emphasized. The status card gains the activity label and a
"Custom" chip when overridden. Forms per CONVENTIONS §3 (RHF + zodResolver); mono =
numbers only. **Edge:** Mifflin needs age and `clients.date_of_birth` is sometimes
null (silent age-30 default today) — surface an "add a birth date for accuracy"
nudge instead of defaulting silently.

### Task 4b.4 — The builder becomes a pure consumer

Remove the drawer's work-activity dropdown. Add the read-only "TDEE · from profile"
line, and the **drift courtesy line** when the covering plan's snapshot ≠ the
current profile ("TDEE is now 2,850 · this plan was built at 3,515") — visibility,
zero automation. `nutrition_plans.work_activity_level` keeps being written as a
snapshot of the CLIENT's value at save (the 24-arg RPC signature is untouched).

### Task 4b.5 — One read path

Overview, drawer and `resolveNutritionCalcInputs` all read the client pair. Drop the
`latestMetrics?.tdee ?? client.tdee` preference (`nutrition-calc-inputs.ts:92`) —
`body_metrics` snapshots stay as history, but nothing prefers them over the live
profile. Enumerate every reader of `client.bmr`/`client.tdee` before changing
precedence; do not assume the list.

### Task 4b.6 — Docs reconciliation

- **CONVENTIONS.md**: add the durable rules (a short "Client energy (BMR/TDEE)"
  note under §8): BMR and TDEE are never written separately — one helper owns the
  pair; activity level is a CLIENT fact and nothing under
  `components/clients/nutrition/**` writes it; plans snapshot at generation and are
  never auto-mutated by a weight change.
- **docs/ARCHITECTURE.md**: rewrite the check-in "Dual-write pattern" step 2
  ("Recalculates BMR/TDEE from updated client data" — now via the shared helper +
  activity), the "Denormalized cache on clients table" note, and the Builder-flows
  line saying the nutrition provider "calculates adjusted targets from client
  metrics (BMR, activity level)" — activity no longer lives in the drawer.
- **TECHNICAL-DEBT.md**: record the residuals — old plan versions keep their
  garbage-in tdee snapshots (honest history, surfaced by Journey blocks); the
  Mifflin age-30 default wherever the nudge can't reach.
- Follow §3 for anything else that collides; safety rules comply, stale
  descriptions update in the same commit.

### Session 4B verification

Full `CONVENTIONS.md §13`. No migration ⇒ no push/gen-types, but the §2
security/load/perf review fires (route changes). Unit tests: the helper's matrix —
(weight change × each override state) × (body fat present/absent); atomic pair
writes pinned; spy tripwires that each former writer routes through the helper; the
calc-inputs precedence change. **Browser smoke (owner runs it; hand over a checklist
and say plainly the UI is unverified):** log a weight → BMR and TDEE both move on
the Overview; set Extremely Active in the dialog → TDEE ×1.9 live; set Custom 3,100
→ a weight change moves BMR only, the card shows the Custom chip + auto value; Back
to auto → recompute; the drawer shows the same TDEE read-only with NO activity
dropdown anywhere; regenerate a plan → the new version snapshots the current TDEE;
the drift courtesy line appears when snapshot ≠ current.

---

### 📋 SESSION 4B PROMPT — paste this into a fresh session

```
Read these in full before planning anything:
  1. CONVENTIONS.md  (mandatory — do not skip sections)
  2. docs/ARCHITECTURE.md
  3. docs/CLIENT-GOALS-PHASES-EXECUTION-PLAN.md — §1, §2, §3, §4, §5, the SESSION
     3/3.6/3.7 STATUS blocks (the Journey blocks read the tdee snapshots this
     session repairs), and all of SESSION 4B. You are executing SESSION 4B only.
     The design block is owner-approved — do not re-litigate it; the findings
     table is verified evidence, not hypothesis.

Session 4B makes the client profile the single owner of BMR/TDEE and the
nutrition builder a pure consumer. ZERO migrations — every column already
exists (bmr, tdee, work_activity_level, bmr_manual_override,
tdee_manual_override). If you believe a migration is needed, STOP AND ASK.

Start with Task 4b.1: pin which flow wrote tdee=3515 onto the fixture client
(live-DB probe recipe is in the memory notes; dev ref aeaphsslctwcmebldrzx)
BEFORE changing anything — it may reveal a sixth writer.

The invariants most easily violated by accident:
  - BMR and TDEE are NEVER written separately. One helper owns the pair.
  - An override flag freezes exactly its own value; the other half keeps
    auto-recomputing.
  - Activity level is a CLIENT fact. Nothing under components/clients/nutrition/**
    writes it.
  - No plan row is ever touched by a weight change. Plans snapshot at
    generation; regeneration inherits the then-current profile numbers.
  - The metrics route carries Session 0's goal-clobber fix — do not disturb it.

Rules for this session:
- Follow CONVENTIONS.md §2: show me a plan and get approval before writing any code.
- One commit per numbered task. Commit-ready means all of CONVENTIONS.md §13.
- Do NOT drive a browser. Hand me a smoke checklist and say plainly that the UI
  is unverified. I run browser smokes myself.
- If a rule in CONVENTIONS.md or docs/ARCHITECTURE.md blocks you, follow §3:
  quote it with file:line, classify it, and comply / update the doc in the same
  commit / STOP AND ASK ME.
- Append a STATUS block as each task lands.

Start by reading the documents, then show me your plan for 4b.1 and 4b.2.
```

---

# SESSION 0b — Goals: one read path, one writer, one editor ✅ COMPLETE (SHIPPED + owner-smoked all clear 2026-08-13)

> **SHIPPED 2026-08-13** — 8 commits (`af71e09` → `027a9c0`), ZERO migrations, plus the sign-off
> (`afb0dd6`). The session brief below is kept as-authored for provenance; **the STATUS blocks in
> §8 are authoritative** for what actually shipped, the decisions they closed, and what they
> deliberately left open. Read those, not this, before touching the goal layer.
>
> **Two of this brief's instructions were overtaken by later sessions and are recorded as
> corrected in §8, not here:** Task 0b.4's "match `client-settings-dialog.tsx`" names a file
> Session 4B deleted (the editor is INLINE), and Task 0b.1's map-or-delete question was settled by
> Session 4 before this session ran.

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

# SESSION 5 — Type the plan-save RPC payload ✅ COMPLETE

**Zero migrations. ONE task, one commit.** Descoped by owner decision 2026-08-13 —
Tasks 5.2–5.4 are parked, see "What was parked" below. **Depends on nothing** and can
run at any time.

### Task 5.1 — Remove the `as never` casts on `create_nutrition_plan_atomic`

`services/nutrition-plan-service.ts` casts the RPC arg object **`as never`, twice**, so
TypeScript verifies nothing about the payload. A key that does not match the live
signature makes PostgREST unable to resolve the overload; `createNutritionPlan` returns
null; **every plan save fails** with "Failed to create nutrition plan" while `tsc`,
`eslint` and `vitest` all stay green. The file's own comment says exactly that.

**The fix.** Type the args object as
`Database["public"]["Functions"]["create_nutrition_plan_atomic"]["Args"]` so a mismatch
between the payload and the regenerated types becomes a **compile error**.
`CONVENTIONS.md §5` already forbids the escape; this is the one place it survives.

**No migration, and no arity change.** The casts only had to wait because the original
Task 5.1 bundled them with the arity change Task 5.2's two new columns required. With
5.2 parked there is no new parameter, no `DROP FUNCTION`, no migration-106 lockdown to
re-apply, and no key count to move. Session 1B kept the signature at 24 args
deliberately and recorded these casts as Session 5's to remove.

**Belts already in place — keep them green, do not rewrite them.**
`services/nutrition-plan-service.test.ts` pins the exact sorted key list and the key
count. Grep for it at execution; every line reference in this document has drifted at
least once. It stays at 24.

**Verify the generated type before writing against it.** Confirm the `Args` shape
genuinely pins all 24 keys rather than widening to a loose record. If it widens, typing
against it buys nothing — say so and propose a hand-written interface pinned by the
existing key-count test instead. Record which it was in the STATUS block.

### Session 5 verification

`npx tsc --noEmit` · `npx eslint .` · `npx vitest run` · `npm run check:labels` · no
`as any`, no introduced markers. **No migration**, so no `check:rls`, no `db push`, no
`gen types`.

**Mutation-prove the belt:** add a bogus key to the args object and confirm `tsc` now
fails. A cast removal that changes no failure mode is not a fix, and this is the only
evidence that it did anything.

**Browser smoke (owner runs it):** save a nutrition plan and confirm it still saves.
One pass is enough — this is a typing change with no runtime delta.

### What was parked, and what would un-park it

Tasks 5.2–5.4 — the stored deficit, its two columns, the both-directions calculator and
the deficit input in the drawer — were **parked by owner decision 2026-08-13**. Not
rejected. The reasoning, recorded so it is not re-derived:

- **The capability already exists in a rougher form.** A coach who wants a specific
  deficit types the resulting number into custom calories: TDEE 2,400, want −500, type
  1,900. Session 5's delta was typing `−500` or `−20%` instead and having it re-solve
  when TDEE moves — ergonomics and drift protection, not a new capability. No coach has
  asked for it.
- **Most of Task 5.4 arrived anyway, from other sessions.** The builder now shows TDEE
  (`nutrition-settings-form.tsx`, `nutrition-targets-block.tsx`), the warnings component
  renders (`nutrition-warnings.tsx`), and Session 0b.5 fixed the bare-TDEE silence when
  no goal is set.
- **The one argument that got STRONGER — and it is the trigger to un-park.** 4B made
  TDEE recompute on every weight change, so a frozen custom-calorie number now drifts
  away from the coach's intended deficit more often than it used to, silently. That is
  soft today because plans never auto-regenerate, so the coach re-enters the number at
  their next regenerate. **If a coach reports that a plan's deficit "moved on its own",
  or asks to express a deficit as a percentage, un-park 5.2–5.4.** The design in this
  file's git history is still correct; only the arity discipline needs re-reading
  against whatever the RPC's signature is by then.

Invariants 12 and 13 stay in §2 as design constraints for the un-parked version.
Nothing in the shipped product violates them, because nothing stores a deficit.

**Two silent-discard bugs found while scoping 5.4, recorded and not fixed:**
`nutritionPlanSchema` still accepts `goalDeadline` and `trainingVolumeHours`; nothing
reads `body.goalDeadline`, and `trainingVolumeHours` reaches the RPC but is ignored by
the calculator. A caller passing either gets a 200 and silence. Belongs to whoever
next touches that schema.

---

### 📋 SESSION 5 PROMPT

```
Read in full: CONVENTIONS.md, docs/ARCHITECTURE.md, and
docs/CLIENT-GOALS-PHASES-EXECUTION-PLAN.md §1-§5 plus all of SESSION 5. You are
executing SESSION 5 only.

Session 5 is ONE task and ONE commit, descoped by owner decision 2026-08-13. Tasks
5.2-5.4 are PARKED: do not build a deficit input, do not add columns, do not touch the
RPC signature. If you believe a migration is needed, STOP AND ASK.

The task: services/nutrition-plan-service.ts casts the create_nutrition_plan_atomic arg
object `as never`, TWICE. TypeScript checks nothing about the payload. A
payload/signature mismatch makes PostgREST unable to resolve the overload,
createNutritionPlan returns null, and EVERY plan save fails while tsc, eslint and vitest
all pass. The file's own comment says so. Type the args object against types/database.ts
so a mismatch becomes a COMPILE error.

Before writing anything, verify two things and report both:
  - That the generated Args type genuinely pins all 24 keys rather than widening to a
    loose record. If it widens, typing against it buys nothing — say so and propose a
    hand-written interface instead.
  - The current line numbers and the key-count test's location, by grep. Every line
    reference in this document has drifted at least once.

Mutation-prove it: add a bogus key and confirm tsc fails. A cast removal that changes no
failure mode is not a fix.

Rules for this session:
- Follow CONVENTIONS.md §2: show me a plan and get approval before writing any code.
- ONE commit. No migration, so no db push, no gen types, no check:rls.
- Keep the existing key-list test green rather than rewriting it — it is the belt that
  has guarded this since migration 139, and it stays at 24.
- Commit-ready means all of CONVENTIONS.md §13.
- Append a STATUS block to the plan doc when it lands.

Start by reading the documents and the current state of nutrition-plan-service.ts, then
show me your plan.
```

---

# SESSION 6 — The save note and the Journey timeline

**One migration. Depends on Session 3 for the timeline half, and on nothing else** —
the old `5 → 6` coupling was "the note lives beside the deficit in the same drawer", and
Session 5's drawer work is parked (see SESSION 5). Session 6 can run first.

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

**Do not put this in `create_nutrition_plan_atomic`.** The signature stays at 24 args — Session 5's arity change was parked with the stored deficit, so nothing in this workstream moves it. Verify against the live catalog rather than this sentence.

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
docs/CLIENT-GOALS-PHASES-EXECUTION-PLAN.md §1-§5 and all of SESSION 6 (plus the
Session 5 STATUS block if that session has run — it is one typing commit and is not a
prerequisite). You are executing SESSION 6 only.

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

---

### Task 1.1 — Narrow-path cascade: pure upsert, no DELETE ✅ SHIPPED 2026-08-11

A rescoped re-land of `3abbfa5` (reverted by `d58120c` as collateral; `d83f707` re-landed
the bounded-DELETE subset; `0163705` later added the `coach_note` predicate + carry-forward
this re-land preserves). Line numbers below are as of this commit.

**What shipped.** `NutritionRegenScope` (`services/nutrition-event-service.ts:247`) —
`{kind:"dates"}` = pure upsert, NO delete; `{kind:"from"}` = d83f707's bounded DELETE
verbatim (all six predicates, `.is("coach_note", null)` included) over `[from, from+8w]`.
`generateNutritionEvents` (`:67`) takes an explicit date LIST; its two-job read (edit guard
+ note carry-forward) is keyed `.in("date", orderedDates)` (`:190`), never a [min,max]
range. Both reset paths (`nutrition-event-edit-service.ts`) pass `{kind:"dates"}` over
exactly the reset days — the clear-flags-BEFORE-regen ordering still matters, now because
of the generator's protected-days filter rather than the DELETE. The two scripts expand
their ranges via the re-landed `expandDateRange` (`lib/date-helpers.ts:299`).

**Counts, re-derived from the tree (do not trust any doc's count, including `3abbfa5`'s).**
12 cascade invocations = **7 narrow** ({kind:"dates"}: move `[source, target]` · duplicate ·
event-surplus PATCH · event DELETE (service now returns the date) · sessions PUT
(`surplusAffectedDates`) · sessions PATCH (`updateSurplusForFutureEvents` returns dates) ·
place-from-library session drop) + **5 wide** ({kind:"from"}: place-from-library plan +
inline placements (via its local wrapper — a bare grep undercounts it), amendment floor,
`[planId]` DELETE, client-level training DELETE). Narrow invocations live in 5 route
files. `3abbfa5`'s "six routes" reconciles under no counting scheme; its 12-not-8
correction holds. The two session handlers now skip the cascade entirely when zero events
changed (`affectedDates.length === 0`) — previously a full-horizon no-op regen.

**Two deviations from `3abbfa5`, both deliberate (owner, 2026-08-11):**
1. **No `to` on the from arm; `training-event-service.ts` untouched.** The rescope is
   narrow-paths-only, and re-landing `cancelFutureEventsForPlan → lastDate` would pull the
   `calorie_surplus_percentage`-landmine file back into the riskiest task. The stale-tail
   defect that half closed is **left open** and filed in `TECHNICAL-DEBT.md → "Nutrition
   cascade — five defects"` with the full re-land recipe. It is NOT fixed by this session.
2. **The verification bullet's "neighbours' `updated_at` untouched" test was not written**
   — it is unwritable: `updated_at` is `DEFAULT NOW()` with no trigger and the upsert
   payload omits it, so a conflict-UPDATE leaves it frozen whether or not the cascade
   over-writes (3abbfa5's own recorded finding). The honest assertions, which prove
   non-interference directly: the upserted date list is exactly the scope, "no `.delete()`
   issued", and the `from()` call count (`nutrition-event-service.test.ts`, narrow-scope
   describe).

**Why the obvious failure mode does not fire.** "The DELETE was destroying something the
upsert now preserves" — checked, and the answer is no for `note`: both reset paths null it
in their own UPDATE (`nutrition-event-edit-service.ts:170`, `:203`) and the generator's
payload omits the key entirely; structurally a `note` exists only on `is_modified = true`
rows (materialize is its sole writer and sets both together), and those rows are excluded
from the upsert by the protected-days filter. `coach_note` is the opposite case: preserved
deliberately, re-supplied explicitly on every upserted row.

**Recorded, NOT fixed — durable copies in `TECHNICAL-DEBT.md → "Nutrition cascade — five
defects recorded, not fixed, by the S1.1 narrow-scope re-land"** (filed there because this
plan doc is deleted when the workstream lands): (1) the stale tail above; (2) the
doc-mandated pair — `cascadeNutritionAfterTrainingChange:389-390` swallows regeneration
failures, `:380-386` does not destructure the plan-lookup `error`; (3) the plan-scoped
DELETE vs client-scoped upsert asymmetry (a foreign plan's event silently rewritten);
(4) the `logged`→`scheduled` status flip (DELETE spares non-scheduled rows, upsert payload
hardcodes `status: "scheduled"` at `:169` — pre-existing on every path, narrowed by this
change); (5) the baseline leak onto pre-`effective_from` days after a future-dated
regenerate (surfaced reviewing this task; becomes more visible once Task 1.3 lands).

**Inherited observation, re-verified.** `sessions/[sessionId]` DELETE still does not
cascade — and that is correct, not a gap: `deleteSession` soft-deletes the session +
exercises and never touches `training_events`, so no nutrition input changed.

**Docs.** ARCHITECTURE's "Training → Nutrition cascade" section rewritten: the per-anchor
contract (falsified by this change) replaced by the scope contract, and two additional
bullets corrected because they described behaviour the code never had — "logged/missed
immutable across the cascade" (false via defect 4's mechanism) and "baseline is preserved"
(false via defect 5's; the same value usually lands, which is not the same claim).

**Gates.** `tsc --noEmit` clean · `eslint .` 0 errors (209 pre-existing warnings, count
unchanged from Session 0's baseline — none new) · `vitest run` **250 files / 2574 tests,
all passing** (Session 0 baseline 249/2560; +1 file, +14 tests = 12 expandDateRange + 2
narrow-scope; arithmetic closes exactly) · `check:labels` OK (634 files) · no new
`as any` (test-file mock casts are the sanctioned exception; the three in
`seed-scale-client.ts` predate this commit on untouched lines) · no markers. No migration
in this commit, so no `check:rls` / `db push` / `gen types`.

**§2 security/load/perf review (trigger: changed write path, ~28 files).** Security: no
auth chain, ownership check, or validation changed on any touched route — diffs are
confined to the cascade call shape after the existing guards; every write keeps its
tenant scoping (`client_id` / `nutrition_plan_id` predicates unchanged). Performance:
a narrow cascade is now 5 round trips writing |dates| rows (a move: 2) where it was 6
round trips deleting + rewriting up to 57; from-scope worst case unchanged (57 rows);
the `.in("date", …)` reads and the upsert's `onConflict: client_id,date` are covered by
the real UNIQUE constraint on `nutrition_events(client_id, date)`. Consistency: the
narrow paths' no-row window is CLOSED (the fix itself); the remaining known divergences
are exactly the five debt entries above. Nothing was load-tested; claims are from code
reading and the unit suite.

---

### Task 1.2 — One shared energy helper, floor recomputes its pair ✅ SHIPPED 2026-08-11

**What shipped.** `CALORIES_PER_KG = 7700` in `lib/constants.ts` (§3: the constant's one
home). New pure module `utils/energy-conversions.ts` — `weeklyRateToDailyDelta` /
`dailyDeltaToWeeklyRate`, **signed convention positive = surplus/gain** documented in the
module; no rounding (display rounding belongs to the renderer). This is Session 5's
deficit⇄date equation, landed as its prerequisite. The three calculator sites now go
through the constant/helper with **bit-identical arithmetic** (same expression, same
order — pinned by `toBe`-not-`toBeCloseTo` tests against the literal expressions).

**The floor fix.** When the minimum-calorie floor raises `baselineCalories`
(`services/nutrition-service.ts`), it now re-derives `requiredDailyDeficit = tdee −
baseline` and `weeklyRate` through the shared equation, so the trio the targets block
renders is self-consistent. The caps already recomputed their pair; the floor was the odd
one out — a floored plan showed "TDEE 2000 · −900/day · −0.82 kg/week" beside a 1500 kcal
target that only implies −500/day. `requiredDailyDeficit` keeps its legacy
deficit-positive convention at this boundary (the block renders `> 0 ? "−" : "+"` from
it); call sites negate, the helper does not carry two conventions. Nothing stores these
two values — the RPC's 24 args carry neither — so the blast radius is display + response.

**One pre-existing test updated because it pinned the bug.** `nutrition-service.test.ts`'s
"emits deficit_capped" case (TDEE 2400, capped to 1100/day → floored at 1500) asserted
`weeklyRate = −1.0` — the cap's wish, exactly the pre-floor pair the defect returned. It
now asserts both warnings and the floored-truth trio (900/day, −0.818 kg/wk); the
cap-alone behaviour is separately pinned at TDEE 3000 where the floor stays out of frame.

**Deletions, all verified zero-consumer before removal (production AND tests):**
`calculateAdjustedTDEE`, `calculateTargetCalories` (`nutrition-service.ts` — the latter
was the trap: it called `calculateBaselineCalories` without `calcStartDate`/`today`, so
building Session 5's entry point on it would silently lose future-start and
client-timezone handling), and `getProjectedDate`/`projectedDate`
(`use-nutrition-builder.ts` — read the stale `clients.*` mirror, disagreed with
`calcInputs` by construction; the duplicate per-render `CALORIES_PER_KG` local went with
it, as did the hook's now-unused `getActivityMultiplier` and `date-fns/addDays` imports).
*(Session 0b Task 0b.3 also names the `getProjectedDate` deletion — done here; 0b
confirms rather than re-deletes.)* **No stored rate column anywhere**, per the task.

**Gates.** `tsc --noEmit` clean · `eslint .` 0 errors (209 pre-existing warnings,
unchanged) · `vitest run` **251 files / 2580 tests, all passing** (+1 file = 3
energy-conversion tests; +3 floor tests; 2574 + 6 = 2580 ✓) · `check:labels` OK · no new
`as any` · no markers · dead-export grep clean repo-wide. §2 review: not applicable — no
route, migration, auth, or write-path change; a pure-calculation module + display-path
fix.

---

### Task 1.3 — `effective_from` advances on the conflict path ✅ SHIPPED 2026-08-11

> ⚠️ **Record of what was true AT SHIP TIME — superseded by SESSION 1B the same day.**
> Read before relying on any claim below: the reader-enumeration table's "ordering is
> vestigial — the unique index guarantees one row" rows, the accepted
> schedule-data/history behaviour change, the template gate's premise, and the
> `hasCurrentTargets` event probe are all rewritten by 1B (versions make ordering
> load-bearing, repair history attribution, dissolve the gate's cause, and answer
> "is anything running" from plan rows). The conflict-path mechanics this block
> verifies remain accurate for migration 143 itself, which 1B's RPC replaces.

**Migration `143_advance_nutrition_plan_effective_from.sql`** — `CREATE OR REPLACE` at
the **identical 24-arg signature**: the whole CREATE statement verbatim from 139 plus one
`DO UPDATE SET` line, `effective_from = EXCLUDED.effective_from`. `SECURITY DEFINER` and
`SET search_path = public` are restated because `CREATE OR REPLACE` is a total
redefinition — omitting either silently drops it with **no error at push time and no
runtime symptom** (the only granted caller is `service_role`, which has full table
rights either way; the regression would be invisible outside the catalog). No `DROP`, no
REVOKE/GRANT — a same-signature replace preserves ownership + ACL; verified rather than
assumed, both directions:

- **Pre-flight (live DEV catalog):** 24 args · 1 overload · `prosecdef` · `search_path=public`
  · `acl = {postgres=X/postgres,service_role=X/postgres}` · the assignment ABSENT (defect live).
- **Post-push:** all of the above identical, the assignment PRESENT.
- **Behavioral probe (DEV, namespaced throwaway coach/client, cleaned to 0 rows after):**
  call 1 inserted at `2026-08-11`; call 2 hit the conflict path with future `2026-09-01`
  → one plan row, `effective_from = 2026-09-01` (**advanced — silently discarded under
  139**), `baseline_calories` updated, `created_at` kept the first-insert day.
- **`gen types` diff: EMPTY**, as predicted for a same-signature body swap — so this
  commit carries no `types/database.ts` change; §8's "migration + types together" is
  satisfied vacuously and the regen + skim were still performed.
- DEV/PROD caveat: push + probes ran against the linked DEV project
  (`aeaphsslctwcmebldrzx`); prod picks the file up through its normal replay.

**Migration-comment bookkeeping (the record the next reader diffs against 139 AND this
plan doc):** stated in both universes because the two prior documents counted different
ones and both were right — over the 23 INSERT columns (139's framing), never-update
shrinks `{client_id, status, effective_from}` → `{client_id, status}` (+`created_at`,
auto, unlisted); over all 28 table columns (this doc's §Task 1.3 framing, verified
28 − 22 = 6), untouched-on-conflict shrinks `{id, client_id, name, status,
effective_from, created_at}` → minus `effective_from`, with `id`/`name` additionally
absent from the INSERT itself (`id` by column default; `name` written by nothing).

**Every reader of `nutrition_plans.effective_from`, enumerated before the meaning
changed:**

| Reader | Kind | Under the new meaning |
|---|---|---|
| `nutrition-plan-service.ts:181` · `check-in-context-service.ts:70` · `comparison-service.ts:49` · `client-portal-service.ts:107` · `nutrition/route.ts:82` | `.order(desc)` on the single-active read | Vestigial tie-break — `idx_nutrition_plans_active_unique` guarantees one row; unchanged |
| `nutrition/route.ts:181` (`effectiveFrom`) + `:185` (`scheduledFor`) → `nutrition-plan-hero.tsx:31-47` → `use-nutrition-plan.ts:35`, `types/check-in.ts:682` | Value → the hero | **The point of the fix** — both branches already assumed "when the current numbers took effect"; `scheduledFor` becomes reachable for existing plans |
| `schedule-data-service.ts` nutrition query (`.lte("effective_from", periodEnd)`) → `nutrition-period-summary.ts` `findActiveNutritionPlan` (`p.effectiveFrom <= date`); consumers: `history/nutrition` route + `check-in-snapshot-service.ts` | Period-overlap predicate | **The one real semantic change.** After a regenerate, fully-past periods stop matching the plan — reachable only on the THIRD fallback (unlogged **and** event-less days; logs then events shadow it), and `classifyAdherence` returns `not_logged` on a null actual regardless, so **status is unchanged**; only such a legacy-shaped day's displayed target goes from today's-numbers-as-history (a lie) to null. Accepted, recorded |
| `utils/build-daily-targets.ts` (**new reader, this task**) | The template gate | A no-event day dated before `effective_from` returns **no entry** (never the next prescription's numbers); event days are never gated — pre-`effective_from` events deliberately keep the old prescription |
| Write side (`orchestrator:169-173` past-date rejection, `nutrition-plan-service.ts:108` transmission, drawer-footer / apply-date-dialog / validations) | Producers, not readers | Confirmed unchanged |

**The gate ships as one REQUIRED trailing param** (`weekWindow: { weekStart,
effectiveFrom }`), deliberately not optional: optional would let a caller silently skip
the gate with every gate unit test green. tsc enumerated all 10 test call sites + the one
production caller (`client-portal-service.ts:134`) — including the second test file
(`utils/__tests__/build-daily-targets.test.ts`) a name-based search misses.
`client-portal-service.test.ts` gains an `args[8]` assertion because it MOCKS the util:
that assertion is the only thing distinguishing "gate exists" from "gate is wired". Four
new gate tests: pre-`effective_from` template days dropped; event days never gated (old
numbers served verbatim); null `effective_from` gates nothing; boundary day is governed.
The `dailyTargets` array can now be shorter than 7 — `hasDailyTargets` handles it on the
page, and for the RN contract fewer entries reads as "no target for that day".

**Accepted behaviour change, named per the task:** regenerating today makes the hero read
"Active since today". True — the numbers changed today.

**Untouched on purpose:** the `as never` casts at `nutrition-plan-service.ts` (§4 —
Session 5 removes them with the arity change; the 24-key payload test still pins the
contract and the signature did not move) · `deleteFutureNutritionEventsForPlan` ·
`training_events.calorie_surplus_percentage` population everywhere.

**Docs, same commit:** ARCHITECTURE's durable-plan paragraph rewritten — `goal_source`
dropped from the snapshot list (mig 133), the `p_recalc_snapshots` description replaced
(removed by 139; snapshots unconditionally re-stamped), the new `effective_from`
semantics + the gate documented. (The plan doc's `ARCHITECTURE.md:199` pointer had
drifted to `:206`; same sentence.)

**Gates.** `tsc --noEmit` clean · `eslint .` 0 errors (209 pre-existing warnings,
unchanged all session) · `vitest run` **252 files / 2584 tests, all passing** (2580 + 4
gate tests; the known-flaky set-tracker test passed) · `check:labels` OK ·
`check:rls` OK (40/40 tables) · no new `as any` · no markers.

**§2 security/load/perf review (triggers: migration + completed session).** Security: the
RPC keeps `SECURITY DEFINER` + pinned `search_path` + service_role-only EXECUTE
(catalog-verified pre/post; the silent-downgrade failure mode is exactly why it was
verified); no route auth/validation changed; the route already rejects past
`effectiveFrom` dates server-side against client-local today. Performance: zero new round
trips — the gate is in-memory arithmetic on data the caller already fetched; the RPC body
change is one additional SET column on an existing conflict-update. Consistency: the
upsert remains a single transaction (plan + daily-targets grid together, unchanged); the
orchestrator's regenerate still runs outside it with its established loud-failure
wrapper. Not load-tested; verified by catalog probe, behavioral probe, and the unit
suite.

---

**SESSION 1 COMPLETE — 3 commits, 1 migration.** Browser smoke (owner runs it, per
Session 1 verification): (1) move a training event → nutrition updates on exactly the
moved-from and moved-to days, nothing else changes; (2) regenerate a plan with a future
apply date → the hero reads "Starts \<date\>" and today's targets are unchanged.

---

### Session 1 smoke — ✅ RUN BY THE OWNER 2026-08-11, PASSED with three UX findings

Both checklist items passed as specified ("everything else checks out and works"). The
findings, all owner-reviewed and shipped same-day as two follow-up commits:

**`4ed4017` — the hero dates an active plan and names a queued CHANGE.**
1. An active plan whose title slot was taken by the program name showed **no date
   anywhere** — "Active since" existed only as the title fallback for program-less
   clients. Fixed: an "Active since \<date\>" sub-line in the queued line's slot when
   the title is the program name; never rendered when the title already carries the
   date (pinned: exactly one "Active since" in either layout).
2. A queued regenerate on an **existing** client read "Starts \<date\>" — the interim
   was invisible and the hero looked plan-less. The plan row cannot distinguish this
   from a first plan (the conflict upsert overwrote the outgoing prescription), but the
   **events** can: rows before `effective_from` keep the old numbers. `GET /nutrition`
   gains one indexed single-row read in its existing `Promise.all`
   (`getNutritionEventForDate(clientId, clientToday)` → `hasCurrentTargets`), and the
   queued line splits: **"New targets from \<date\>"** when current numbers keep
   running, **"Starts \<date\>"** when nothing does. *Test-scope deviation from the
   follow-up plan, stated: the route test gained only the mock-factory declaration, not
   GET assertions — that file has zero GET coverage and an unmocked GET chain
   (`resolveNutritionCalcInputs`), so standing it up for one `!= null` mapping was
   disproportionate; the behaviour is pinned at the consumer
   (`nutrition-plan-hero.test.tsx`, all four states).*

**"apply-date dialog is one picker, one button" (the commit carrying this addendum —
a self-hash can't be written).** The two-action
layout saved on "Apply From Date", which read as the control that OPENS the picker —
the owner repeatedly applied before setting the date. Now: date input defaulting to
**today**, one primary Apply (labels: "Apply" / first plan "Start plan"), Cancel.
**Load-bearing and non-obvious: today is sent as `null`, not as the date string.** The
picker renders the coach's calendar day; plan dates live on the client's. Across a
midnight offset the literal string schedules the client's tomorrow; `null` routes the
decision to the server, which resolves today in the client's stored device-synced
timezone — the old Apply Now behaviour, preserved through the redesign. A future pick
names the same calendar square everywhere and is sent as typed. Contract pinned in
`apply-date-dialog.test.tsx` (default-today→null, future→literal, re-picked
today→null, past→disabled). Sole consumer verified: the nutrition drawer footer;
`nowLabel`/`fromLabel` collapsed to `applyLabel`.

Session 5 note: the deficit-input drawer work lands on this dialog's surface — inherit
the single-button shape and the null-when-today contract; do not reintroduce a second
action.

---

### Task 1b.1 — Migration 144 + the resolver family ✅ SHIPPED 2026-08-11

**What shipped.** `144_nutrition_plan_versioning.sql`: (A1) archived rows' windows closed
(`COALESCE(effective_until, effective_from)`, 116 precedent — 14 DEV rows; prod scope was 0);
(A2) `idx_nutrition_plans_active_unique` dropped, **`idx_nutrition_plans_open_unique`**
created (`(client_id) WHERE status='active' AND effective_until IS NULL`); (A3) `btree_gist`
+ the **non-deferrable** exclusion constraint `nutrition_plans_active_window_overlap`
(`daterange(effective_from, effective_until, '[]')` overlap, active rows only); (A4) the RPC
rewritten **close-and-insert at the identical 24-arg signature** — full header restated
(`SECURITY DEFINER`, `SET search_path = public`), no DROP/REVOKE (same-signature replace
preserves ACL, catalog-verified both sides). Plus the resolver family in
`nutrition-plan-service.ts` (`getNutritionPlanForDate` / `getNutritionPlanIdForDate` /
`getNextFutureNutritionPlan` — `coversDate` reuse, training-identical ordering, active-only
status filter documented as deliberately simpler than training's `neq archived`) and the
**clientToday threading** (`CreateNutritionPlanParams.clientToday`; the service's internal
`getClientTodayString` recompute is deleted; both orchestrator call sites pass the
`:166`-validated value via `calcInputs.today`, which is handed in, not re-derived).

**The RPC body beyond the three-branch design text — completions forced by the constraint
arithmetic, reviewed and approved with the session plan:**
1. **Universal sweep, both paths.** s1 deletes active rows `effective_from >= new_start AND
   id IS DISTINCT FROM v_open_id` (plain `<>` against NULL matches nothing — the insert-path
   sweep would silently no-op); s2 re-closes the straddler at `new_start − 1` (required on
   the insert path for delete-today-then-recreate-today, where the closed covering version
   still claims today).
2. **Fully-replaced queued versions are hard-DELETEd** (owner ruling): they governed at most
   part of one day, the `nutrition_logs` snapshot is the sub-day history mechanism, same-day
   collapse is the absorb branch's own semantics, and any retained window corrupts
   no-status-filter history attribution. Daily targets CASCADE; events/logs FKs SET NULL.
3. **Past-date belt** — `RAISE` when `v_new_start < v_today`. **Caller-cooperative, not a DB
   invariant** (p_today is caller-supplied): it stops a future caller that skips the route's
   past-date guard from turning s1 into a history shredder. Verified: the RPC has exactly
   one caller; seeds insert directly. The threading makes route-accept ⇒ RPC-accept (single
   source, no midnight race), pinned by the rewritten p_today test.
4. **`FOR UPDATE` on the open-row lookup** — existing-plan races serialize; first-save races
   collide loudly on the open-row index (or last-writer-replace in one interleaving — same
   end state as sequential absorb, never corruption; recorded in the migration header).

**Deliberately NOT in this commit (Q1 review resequencing):** `getActiveNutritionPlanId` is
**unconverted** — the covering-today wrapper conversion moved to 1b.2, because converting it
here would have broken the queued-first-plan client's ability to log nutrition (the
Saturday-logger trace) before 1b.2's D1 guard exists. **1b.1 therefore changes zero existing
read/stamp/guard behavior; the only production delta is the RPC body itself.** Its docstring
now names it a legacy singleton read with a no-new-callers rule.

**Decisions inherited by 1b.2 (approved with the session plan):**
- **D1**: nutrition log guard = covering OR future version exists (same predicate as 1b.3's
  readiness rule); stamp = covering version's id or NULL (zero SELECT-side readers of
  `nutrition_logs.nutrition_plan_id`, verified; the writer's omit-when-null inserts NULL
  fresh and preserves the prior era's stamp on re-log — both wanted).
- **D2**: on delete, the covering version stays **active** with `effective_until =
  clientToday` (design 3 read correctly: a version closed at today no longer "reaches past
  today", so the archive clause scopes to queued versions; this is also the only reading
  under which s2/the constraint guard the re-create). Queued versions: hard-DELETE.
  `archiveNutritionPlan` loses its last caller and is deleted in 1b.2.

**Live-DB proof (all against DEV `aeaphsslctwcmebldrzx`).** Pre-flight: 12/12 facts clean.
**Prod pre-flight (`etezzztgafcotyahgijk`, run by owner — first prod probe of this
workstream): 12/12 clean**, function state identical to DEV, old index genuinely present
(no mig-125-style drift), zero strays; no remediation needed. Post-push: catalog identical
(prosecdef / search_path / ACL / single overload), old index gone, new index + constraint +
btree_gist present, backfill complete, body carries belt + IS DISTINCT FROM + FOR UPDATE,
`ON CONFLICT (client_id)` and `DO UPDATE SET` gone (the one remaining "ON CONFLICT" string
is the explanatory comment). **Behavioral probe: 10/10 scenarios in one rolled-back
transaction** — branch (a); branch (b) close-at-new−1; 3-version chain; per-date resolution
correct at six boundary dates; absorb with intermediate deleted + straddler re-closed;
same-day collapse (same id, grid replaced at 7 rows, prescription overwritten); the belt
raising; second open row → unique_violation; manufactured overlap → exclusion_violation;
delete-today-then-recreate-today with s2 closing the old covering row at today−1. Zero probe
rows persisted (verified). `gen types` diff **EMPTY** as predicted (same-signature body swap)
— regen + skim performed; migration + types together satisfied vacuously (143's precedent).

**Gates.** `tsc --noEmit` clean · `vitest run` **252 files / 2597 tests, all passing**
(inherited baseline 2589 after the two Session-1 smoke follow-ups; +8 resolver query-shape
tests here — mock-level by design, the branch semantics are proven by the live probe) ·
`eslint .` 0 errors (209 pre-existing warnings, unchanged) · `check:labels` OK (635) ·
`check:rls` OK (40/40) · no new `as any` (the two RPC `as never` casts stay per the session
brief; the 24-key pin is green and now cites migration 144) · no markers. The transient
probe SQL files were deleted before commit; the behavioral probe script lives in the session
scratchpad only.

**§2 security/load/perf review (triggers: migration + SECURITY DEFINER surface).**
Security: same-signature replace preserved the service_role-only EXECUTE (catalog-verified
pre and post — the silent-downgrade failure mode is why both sides were probed); header
restates SECURITY DEFINER + pinned search_path; no dynamic SQL; every statement in the body
is scoped `client_id = p_client_id` or by the locked row's id; no route auth changed.
Performance: the open-row lookup is exactly covered by the new partial index; the sweep's
worst case is one client's chain (single-digit rows); the RPC remains one transaction (plan
+ grid); zero new round trips in the service (one was removed — the deleted today recompute).
Consistency: the RPC is atomic; the orchestrator's regenerate still runs outside it behind
its established loud-failure wrapper; the belt converts the one cross-boundary skew
(route-today vs RPC-today) from a possible silent... rather, from a generic 500 into an
impossibility by threading. Not load-tested; verified by catalog probe, behavioral probe,
and the unit suite.

**Exposure window (accepted by sequencing ruling A, closes at 1b.2/1b.3):** a queued save
now mints a real second active row, which the unmigrated readers mishandle exactly as the
Ground-truth block documents — the cascade silently no-ops for that client
(`nutrition-event-service.ts:380-385`), the seven quiet reads pick the future row,
delete-with-chain archives only the covering version (plan-scoped event delete misses queued
versions' events), delete-of-queued-only 404s. Same-day saves (the dominant path) leave one
active row and behave identically to before. **No queued saves or browser smokes until 1b.3.**

**Durable defect records:** none new — the exposure above is transient by design and closed
within this session; nothing else surfaced that outlives it.

---

### Task 1b.2 — Write-path correctness: cascade, deletes, resets, stamping ✅ SHIPPED 2026-08-11

**What shipped.**
- **Cascade version-segmentation** (`cascadeNutritionAfterTrainingChange`): fetches every
  active version overlapping the scope (`getActiveNutritionPlanVersionsOverlapping`, new in
  `nutrition-plan-service.ts`, shared with the bulk reset) and hands each the SAME scope —
  `regenerateFutureNutritionEvents` now clamps to the version's own window, so the loop IS
  the segmentation. The version-lookup error is destructured, logged, and Sentried (loud
  break #1 closed); the orchestrator's `regeneration_reason` lookup gained
  order/limit/error-logging (loud break #2 closed). From-scopes additionally sweep GAP
  dates no version covers (the post-delete interregnum) so stale targets from a deleted
  era cannot survive.
- **The from-scope delete re-keyed CLIENT-scoped** with the window clamp making the wider
  scoping safe (a version can never delete outside its own era); all six survival
  predicates preserved (`scheduled`, `is_modified=false`, `coach_note IS NULL`, both
  bounds, now clamped).
- **Per-date stamping + the D1 guard** (`resolvePlanContextForDate`): the nutrition
  fallback is `getNutritionPlanIdForDate(clientId, date)` — a backdated log stamps its own
  day's era, a queued save no longer mis-stamps today. `PlanContextForDate` gained
  `nutritionSetUp` (covering-or-future, the same predicate as 1b.3's readiness rule);
  `assertHasActivePlan`'s nutrition arm gates on it, so the queued-first-plan client logs
  food pre-start with an honest NULL stamp (the Saturday-logger fix, pinned). Training arm
  byte-identical; its today-anchor (rather than the log's date) is a pre-existing
  observation, recorded here, deliberately untouched (training-side is out of session
  scope).
- **Reset routes per-date-grouped**: the single-date route resolves the version covering
  ITS date; the bulk route groups the date list per covering version (shared
  `versionCoversDate`) and resets group by group — a straddling selection restores each
  era's own numbers. Uncovered dates are skipped (nothing to reset to); all-uncovered
  404s. First-ever tests for the bulk route (4).
- **Deletion chain (design 3 + D2, as ruled)**: `orchestrateNutritionPlanDeletion` closes
  the covering version at `clientToday` with **status untouched** (D2(a) — the ended,
  successor-less window is the record; also the only reading under which 1b.1's s2 and the
  gist constraint guard a same-day re-create), hard-DELETEs queued versions (D2(b)), and
  sweeps future events **client-scoped** from `clientToday + 1` via the new
  `deleteFutureNutritionEventsForClient` (the plan-scoped variant missed queued versions'
  stamped rows). Precondition = a version reaches past today (covering-or-future), so
  queued-only chains delete cleanly and a same-day second delete 404s. Steps ordered
  idempotently (events → queued rows → close); a mid-flight failure leaves a state a retry
  completes — non-transactional like its predecessor, recorded.
- **Deleted on the zero-caller test** (Session 1.2 precedent, owner-approved with the
  plan): `archiveNutritionPlan` (last caller replaced by close-at-today) and
  `deleteFutureNutritionEventsForPlan` (last caller replaced by the client-scoped sweep).
  Nothing mints `status='archived'` any more — it survives on legacy rows only (1b.5
  documents this).
- **`getActiveNutritionPlanId` → thin covering-today wrapper** over
  `getNutritionPlanIdForDate` + `getClientTodayString`. All four former call sites are
  rewired in this same commit; kept despite zero remaining production callers per the
  design-4 mandate (API symmetry with `getActiveTrainingPlanId`), docstring says so.

**TECHNICAL-DEBT.md reconciled**: cascade entry 5 (baseline leak) CLOSED — fixed by
construction (each era rebuilds from its own grid; the "no stored source for the old
numbers" premise died with versioning); entry 3 (delete/upsert scoping asymmetry) CLOSED —
the re-key + clamp made the scopes symmetric, and re-stamping to the covering version is
now correct behaviour; entry 2 re-scoped — the lookup half is fixed, the per-version regen
swallow remains (deliberate, with the 1b.3 hero-divergence cost named). Entries 1 (stale
tail) and 4 (logged→scheduled flip) stay open, text untouched.

**Tests.** 2610 passing (baseline 2597 + 13): cascade segmentation across an era boundary
(each side rebuilt from ITS version's baseline — the leak's regression pin), the gap
sweep's exact date list + predicates, both loud-break regressions, the window clamp (both
ends; out-of-window scope writes nothing), delete-guard pins re-pointed at
`client_id`-scoping, per-date stamping + the D1 Saturday-logger pin + guard semantics,
delete-chain semantics (close-without-status-write pinned via
`not.toHaveBeenCalledWith(status)`, queued hard-delete, queued-only delete, same-day
second delete 404, events-before-close ordering), bulk-reset grouping ×4. The route test's
supabase mock became a thenable chain (the deep statement semantics live in the
orchestrator test, stated in a comment).

**Gates.** `tsc --noEmit` clean · `vitest run` **253 files / 2610 tests, all passing** ·
`eslint .` 0 errors (209 pre-existing warnings, unchanged) · `check:labels` OK (636) ·
`check:rls` OK (40/40) · no new `as any` outside sanctioned test-mock casts · no markers ·
no migration in this commit (144 carries the whole session's schema).

**§2 security/load/perf review (trigger: changed write path, ~10 files).** Security: no
route auth/ownership/validation changed — diffs sit behind the existing guards; every new
statement is tenant-scoped (`client_id` or a resolved version id). Performance: a narrow
cascade for a single-version client is unchanged (one version fetch replaces one plan
fetch); a chain client pays one windowed version query + per-overlapping-version
regeneration (overlapping versions are single-digit; worst-case rows unchanged at 57/
version-slice, the slices partition the range). The bulk reset adds one windowed query and
replaces N per-date lookups with in-memory grouping. Per-date stamping swaps one singleton
read for one windowed read (same count); the D1 future-check runs only when nothing covers
the date. Deletion adds one queued-select (+1 round trip) — constant. Consistency: the
deletion remains non-transactional with idempotent step order (stated in code); the
cascade's per-version swallow is the re-scoped debt entry 2. Not load-tested; verified by
the unit suite against mocked chains.

**Behaviour changes a smoke will see** (still: no queued-save smokes until 1b.3 — the
GET/hero still read the old shape): training edits inside a pre-`effective_from` window
now rebuild those days from the OLD era's numbers (the original leak repro, checklist
item 1); a queued-first-plan client can log food before their start date; resets across a
boundary restore each era's numbers; deleting a chain removes queued versions and their
events.

---

### Task 1b.3 — Coach surface: the three-role GET + everything that reads it ✅ SHIPPED 2026-08-11

**The GET returns three roles** (`app/api/clients/[id]/nutrition/route.ts`): **covering**
(`getNutritionPlanForDate(clientId, clientToday)`) → `effectiveFrom` ("Active since") and
`hasCurrentTargets := covering != null` — **the `todayEvent` probe added by `4ed4017` is
retired** (route Promise.all member + response derivation, the hook's type doc, the route
test factory's declaration; the hero itself consumes the same field names and needed no
code change); **earliest-future** (`getNextFutureNutritionPlan`) → `scheduledFor` (a third
queued version can no longer hide the next change); **open** (`getOpenNutritionPlan`, new
resolver — the `effective_until IS NULL` row) → the drawer seeds and `goalChanged` (drift
now compares the version Generate will actually overwrite). **Seed rule implemented as
approved: seeds resolve `open ?? covering`, and the drawer never seeds fresh defaults
while `hasPlan` is true** — the post-delete same-day state re-mints the closed covering
version's numbers on an untouched Regenerate (pinned). `hasPlan` is an explicit response
field on BOTH branches (covering-or-future, guarded to seed availability);
`use-nutrition-plan.ts`'s `!!calorieTarget` derivation is dead, replaced by the server's
verdict, with the type docs rewritten to the versioned meanings.

**Readers rewired:** `activation-readiness` → covering-or-future via the resolvers (the
queued-first-plan coach IS ready — pinned, and provably the same predicate as 1b.2's log
guard); `check-in-context` → covering-existence gate (queued-only correctly reads "no
targets this week yet"; the lookup degrades loudly, never silently); `comparison-service`
→ covering version with **`effective_from` as the drift banner's "since" date** — field
renamed `nutritionPlanCreatedDate` → `nutritionPlanEffectiveDate` through
`types/check-in.ts` → `goal-progress-view` → the banner, whose copy now reads "since these
targets took effect on {date}" (the old value printed the FIRST-EVER plan row's birth date
forever); `overview-plan-summary` → `coversDate` + clientToday (a queued version no longer
surfaces as "what the client is on now").

**Absorb warning (design 9):** `ApplyDateDialog` gains `queuedChangeDate`; when the picked
date lands on/before it, one amber sentence renders — "This replaces the change queued for
{date}." — and Apply proceeds unchanged (warn, never block; single-button +
null-means-today contract untouched, re-verified by the existing four pins).
`drawer-footer` threads `nutritionData.scheduledFor`. **Copy sweep:** the drawer's
in-place note → "Saving starts a new version from the chosen date. Earlier days keep the
numbers they had."; the delete dialog is chain-safe ("…edited days and any queued changes
included.").

**Recorded, no code (as approved):** with `hasCurrentTargets` from the covering row, a
swallowed regeneration failure shows a hero reporting the plan-layer truth while the
client's day view shows the event-layer hole — debt entry 2's named visible cost (the old
event probe lied in the opposite direction, denying a mostly-materialized prescription).
On the deletion day itself the hero truthfully reads "Active since X" (today is still
governed); an explicit "Ends {date}" line for a successor-less closed covering version is
future polish, not built.

**Tests.** 2618 passing (2610 + 8): **first-ever GET coverage** — five states (single
version; a chain proving "hero dates the EARLIEST, drawer seeds the LATEST"; queued-only
"Starts"; the post-delete `open ?? covering` seed rule; explicit `hasPlan:false` with
calcInputs) — the ground truth's zero-coverage GET surface is closed; the absorb warning
×2 (shown-and-still-applies; hidden after the queued date); readiness queued-first-plan
pin. The readiness test's supabase chain mock is replaced by resolver mocks; the route
test factory drops the retired probe.

**Gates.** `tsc --noEmit` clean · `vitest run` **253 files / 2618 tests, all passing** ·
`eslint .` 0 errors (209 pre-existing warnings, unchanged) · `check:labels` OK (636) ·
`check:rls` OK (40/40) · no new `as any` outside test-mock casts · no markers · no
migration.

**§2 review (trigger: route changes, ~14 files).** Security: no auth chain, ownership, or
validation changed on any touched route — the GET's guards are byte-identical above the
read swap; the readiness route's reads moved from an inline query to scoped service
resolvers. Performance: the GET swaps one plan read + one event probe for three indexed
single-row plan reads inside the same Promise.all (net +1 parallel round trip, no
sequential depth added); readiness adds a today lookup + at most two indexed reads inside
its existing safeQuery batch; comparison/check-in/overview swap one read for one read.
Consistency: read-only surfaces; the one write path this task touches (none) — n/a.
Not load-tested; verified by the unit suites.

**Smoke unblocked:** with 1b.1–1b.3 landed, the queued-save embargo is LIFTED — the four
Session 1B checklist smokes (leak repro, chain hero/drawer, chain delete, absorb warning)
are now meaningful. 1b.4 (portal + scripts) is still pending, so the CLIENT program card
may show stale template behaviour until it lands; coach-side smokes are fully valid.

---

### Task 1b.4 — Client portal + scripts ✅ SHIPPED 2026-08-11

**Portal read → covering-today** (`client-portal-service.ts:102`): the program card's
plan read swaps newest-active for `coversDate(query, today)` + the training-identical
ordering — a queued future version no longer reaches a client still living on the
current one, and the portal resolves the same row every coach surface resolves.

**The template gate is a WINDOW test** (design 8): `buildDailyTargetsFromPlan`'s
required `weekWindow` param gains `effectiveUntil`; a no-event day before
`effectiveFrom` OR after `effectiveUntil` returns no entry (both boundaries inclusive,
null leaves that side open, underivable dates still fail open, event days still never
gated). The required-param discipline enumerated every call site again — exactly the two
test files, no production caller missed. The portal threads both window ends; its
mocked-util `args[8]` pin (the only thing distinguishing "gate exists" from "gate is
wired") now pins a CLOSED window's both ends against real fixture values.

**`backfill-nutrition-events.ts` restores its per-version branch**: selects every active
version with `effective_until`, walks each, and fills exactly its own window — an open
version extends to today+8w, a closed version never writes past its own end (days after
it belong to the next era's grid), inverted/empty windows skip. The "the old
archived-window/per-version branch is gone" mourning comment is replaced by the restored
truth.

**Both seeds emit a closed + open version pair** so date resolution is exercised by
fixture data: `seed-scale-client.ts` splits the tenure at −90d (v1 closed at 2300 kcal
with its own grid + its era's events stamped `PERF_NUTRITION_PLAN_V1_ID`, new fixture id
in `perf-fixtures.ts`; the open version keeps `PERF_NUTRITION_PLAN_ID` so existing
consumers are untouched); `seed/generate.ts` splits each client's tenure at its midpoint
(≥14-day tenures; shorter fall back to a single open version), with per-era daily-target
grids and per-date `nutrition_events`/`nutrition_logs` stamping following the covering
version (`eraPlanId`) — the old `:477` index comment now names
`idx_nutrition_plans_open_unique` and why two active rows are legal.

**Tests.** 2621 passing (2618 + 3): the until-end gate (template days after
`effective_until` dropped; the boundary day governed; an event past the window still
served verbatim — events carry their own era). Portal fixtures gain
`status`/`effective_from`/`effective_until`; the mock chain gains `lte`/`or` for
`coversDate`.

**Gates.** `tsc --noEmit` clean · `vitest run` **253 files / 2621 tests, all passing** ·
`eslint .` 0 errors (209 pre-existing warnings, unchanged) · `check:labels` OK ·
`check:rls` OK (40/40) · no markers · no migration.

**§2 review (trigger: client-portal read path).** Security: no auth changes;
`getClientNutritionTargets` keeps its `requireClientAuth`-verified `clientId` scoping;
the read swap adds two filter clauses to the same tenant-scoped query. Performance: zero
new round trips anywhere (the covering read replaces the newest-active read one-for-one;
the gate is in-memory; the backfill is an operator script). Consistency: read-only +
scripts. Not load-tested; the perf fixture's shape change (two versions) slightly enriches
the benchmark data and `PERF_NUTRITION_PLAN_ID` remains the open version, so existing
perf baselines stay comparable.

**Full-session smoke now unblocked end-to-end** — coach AND client surfaces are
version-aware. The four checklist smokes plus the D1 pre-start logging check are ready
whenever you are (after 1b.5's doc pass, or before it — docs don't gate behaviour).

---

### Task 1b.5 — Documentation reconciliation ✅ SHIPPED 2026-08-11 · SESSION 1B COMPLETE

**Owner-mandated reconciliation, checklist floor + re-grepped stragglers:**
- **`CONVENTIONS.md` §8 status-lifecycle** — the normative single-durable-plan bullet
  REWRITTEN to the versioned model, recording the reversal inline (owner 2026-08-11,
  stale premise) and what survives it (events-SOT, per-day edits materialize onto
  events, one target per day).
- **`docs/ARCHITECTURE.md`** — hierarchy line (`DATE-RANGED VERSIONS`); the "deliberate
  asymmetry" block rewritten as "both tracks are date-ranged" with what still differs
  (training coexists additively with capped windows and normal gaps; nutrition chains
  contiguously via derived closes, gapless except after a delete); the durable-plan
  section replaced by "**Nutrition plan versions + per-version daily-targets
  template**" (model, write-path lineage 048→110→115→139→143→144, the three branches +
  sweep + belt, the resolver family, the GET's three roles, delete semantics, the
  both-ends template gate); the cascade bullet now describes version segmentation +
  the loud lookup; the baseline-leak bullet records closure-by-construction; the
  typical-week path names the covering version's grid + both-ends gate; activation
  flow's `hasNutritionPlan` = covering-or-future.
- **`TECHNICAL-DEBT.md`** — entries 2/3/5 were reconciled in 1b.2's commit (verified);
  entry 6's "nutrition is now one durable plan" rationale re-worded historically
  ("…and then to date-ranged VERSIONS in migration 144 — under both, 'current' is
  never a status flip").
- **`NUTRITION-CALENDAR-IMPLEMENTATION-SPEC.md`** (repo root, not docs/) — SUPERSEDED
  banner at top naming exactly what was reversed (Mig B / in-place upsert / every
  "no versioning" claim) and what still stands; the doc stays as its era's
  design-decision record.
- **`docs/CLIENT-PORTAL-EXECUTION-PLAN.md`** `:1070`/`:2483` — the two "⊘ superseded"
  annotations that stated the durable model as current fact gained
  "superseded again 2026-08-11 (migration 144 versions)" suffixes.
- **Straggler grep beyond the listed lines** (md + code comments): one code straggler
  found and fixed — the deletion orchestrator's docstring still said "durable nutrition
  plan" (now chain-aware wording). All remaining "durable"/"in place"/"upsert" hits
  verified to be either unrelated word uses, historical statements in annotated
  context, or correct current mechanics (the events upsert).
- **This doc's supersession banners** (Task 1.3 §-body + STATUS) verified present from
  1B insertion time.

**Gates.** `tsc --noEmit` clean · `vitest run` 253/2621 all passing · `eslint .` 0
errors (209 pre-existing warnings, unchanged the whole session) · `check:labels` OK ·
`check:rls` OK (40/40) · §2 review: not applicable (docs + one docstring).

---

**SESSION 1B COMPLETE — 5 commits, 1 migration (144), pushed to DEV.** Prod receives
144 through its normal replay (prod pre-flight probe ran clean 12/12 before anything
was pushed — the workstream's first prod probe). The as-never casts remain with the
24-key pin green (Session 5's contract). Training-side deletion and
`training_events.calorie_surplus_percentage` population verified untouched
(session-brief constraint — the only cascade-adjacent diffs are the version
segmentation inside the nutrition helper).

**Browser smoke checklist (owner runs it — UI is unverified by the executor):**
1. **The original leak repro:** regenerate a plan with a future apply date, then move a
   training event inside the gap week → the moved day keeps the OLD prescription's
   numbers (calendar + client day view).
2. **Chain:** queue two future versions → hero shows the EARLIEST as "New targets
   from"; open the drawer → seeds are the LATEST queued version's numbers; the apply
   dialog shows "This replaces the change queued for {date}." when the picked date is
   on/before it — and replacing it works.
3. **Delete with a chain:** today's targets survive, tomorrow-forward gone (queued
   versions included), no orphaned targets on the calendar; hero reads "Active since"
   today and "No active nutrition plan" tomorrow; a same-day re-generate seeds the
   deleted era's numbers, not defaults.
4. **Save on/before a queued change** → the dialog warns, the queued version is
   replaced (hero's "New targets from" updates to the new date).
5. **D1:** activate a client whose FIRST plan is queued for a future date → they can
   log food today (no 422); the log's row carries no plan stamp.

---

### Session 1B smoke — ✅ RUN BY THE OWNER 2026-08-11 · one correction applied (D1 reversed)

Tests 1–4 passed. **Test 5 corrected the D1 decision.** The plan's expectation — a
queued-first-plan client CAN log nutrition before their start date (covering-or-future
guard, null stamp) — was **wrong on the product**: the owner confirmed the client
correctly sees "No nutrition target today" and cannot log, because there is no target
before the plan starts ("why would they log before they've started?"). Two facts settled
it: (a) the client nutrition log is **consumed calories + macros**, not food items, and it
is gated in the UI by a target existing (no event → no target → no log affordance), so the
observable behaviour was already correct and independent of the guard; (b) the guard I
shipped was permissive where the owner wants restrictive — latent, but a real contract gap
for the RN client.

**Change applied (follow-up commit):** the client nutrition write guard
(`assertHasActivePlan`, nutrition arm) reverts to **covering-only** — the stamp being null
(no version covers the log's date) rejects the write with 422. `nutritionSetUp` and the
`getNextFutureNutritionPlan` call are removed from `resolvePlanContextForDate`. **Kept:**
per-date stamping (a backdated log still stamps its own era — the genuine 1b.2 improvement),
and **activation-readiness stays covering-OR-future** (a coach who queued a first plan IS
ready). The correction: the client log guard and activation-readiness are **different
questions with different answers** — "can the client log today?" (covering only) vs "is the
client set up?" (a queued plan counts) — and must NOT share a predicate. The plan's D1 and
1b.3's "same predicate as the client log guard" note (ARCHITECTURE) were both wrong on this
and are corrected. Gates: tsc, vitest 253/2621, eslint 0 errors, check:labels.

---

### Task 2.1 — Migration 145: `client_phases` ✅ SHIPPED 2026-08-11

**What shipped.** `145_create_client_phases.sql` — the table exactly as §Task 2.1 specifies
(id / client_id CASCADE / name / focus / target_weight NUMERIC / starts_on / ends_on DATE /
timestamps), `idx_client_phases_client_start (client_id, starts_on)`, RLS enabled with **no
policies**, `GRANT ALL … TO service_role` (CONVENTIONS:360-366), the column comment, and a
**table comment** recording the phases-vs-block naming divergence (session-prompt mandate —
the doc's SQL block carried only the column comment). `updated_at` is app-managed, no
trigger (migration-134 precedent, stated in the header).

**One deviation from the doc's verbatim SQL, owner-approved at plan review:**
`CONSTRAINT client_phases_window_valid CHECK (ends_on >= starts_on)` — a single-row
backstop in migration 144's never-fire posture. It earns its place because Session 2's
delete design **truncates** the current block (see the Task 2.2 STATUS block): the one
write that could invert a window is a truncate on the block's own first day, which app
code special-cases; the CHECK turns that bug class into a loud 23514 instead of silent
corruption. Deliberately NOT added: any overlap/contiguity constraint — invariant 3 keeps
cross-row structure service-computed ("there is no overlap validation to write"), and
unlike 144 there is no multi-branch RPC with an absorb/close race behind it.

**Verification.** Push run by the owner (`db push` is classifier-blocked): one migration
applied cleanly to linked DEV. `gen types` diff: **exactly one new table, 44 insertions,
nothing else** — and the generated `Insert` type requires precisely the NOT NULL set
(`client_id`, `name`, `starts_on`, `ends_on`), which Task 2.2's upsert-payload typing
relies on. `npm run check:rls`: **41/41 tables** (was 40 — the new table lands deny-all).

**Gates.** `tsc --noEmit` clean · `eslint .` 0 errors (209 pre-existing warnings,
unchanged) · `vitest run` **253 files / 2624 tests, all passing** — note the baseline
moved from 1B's 2621 before this session via the two builder-smoke fix commits
(`ac924a5`, `5074d01`, +3 tests); this commit adds none · `check:labels` OK (636) · no
`as any` · no markers. Migration + regenerated types committed **together** per §8.

---

### Task 2.2 — Chain math + service ✅ SHIPPED 2026-08-11

**What shipped.** `lib/blocks/block-chain.ts` (pure, client-safe, UTC-anchored via
`addDaysToDateString` + `utils/metric-points.ts`'s `daysBetween` — reused, not
duplicated): `computeBlockChain` (durations in, dates out), `inclusiveDays`,
`weeksSpanned` (**ceil — the ONE derivation behind both the GET's `weeks` and
`weekOfTotal.total`**), and `computeDeleteShift`. `types/client-blocks.ts` (domain +
wire types). `services/client-blocks-service.ts`: `listBlocks` / `replaceBlockChain` /
`deleteBlock`, every query `.eq("client_id", clientId)`, `clientToday` threaded in from
the route (the 1b.1 precedent — the service never derives time). Typed errors:
`ElapsedBlockImmutableError` / `BlockWindowError` / `BlockPayloadError` (422-class) and
`UnknownBlockIdError` (404) — a fourth class (`BlockPayloadError`) beyond the plan's
illustrative three, so payload-shape rejections don't masquerade as window problems.

**The PUT contract as coded (plan-review decisions, all owner-locked):** the elapsed
prefix is pinned VERBATIM from storage (ids/order/fields echo-checked; `weeks` ignored
on elapsed rows — a truncated block's day count isn't whole weeks, so no `weeks` could
reproduce it); `startsOn` immovable while past blocks exist; the editable suffix walks
from last-elapsed-end + 1; the **symmetric window floor** — a stored current block must
still contain today (neither shrink-below-elapsed nor anchor-forward can re-label lived
days), a stored future block may become current but never wholly past, new id-less rows
land anywhere (history backfill); omission of a stored non-elapsed id → 422 (DELETE is
the single removal path); removal is unexpressible through PUT.

**DELETE as coded:** future → row removed, suffix re-anchors at the deleted
`starts_on` (invariant 8 literally); current mid-block → **TRUNCATE at yesterday**
(lived days stay attributed — invariant 3 holds, no gap; the next block starts today,
Task 3.4's copy) issued as **ONE atomic upsert statement** (truncate + shifted suffix
are all conflict-updates), so the invariant-3-critical path has no partial-failure
window; current on day one → removed (zero lived days; truncating would invert the
window — the CHECK's scenario). Remove variants are delete-FIRST so a failure residue
is a gap (sanctioned shape), never an overlap. Uniform re-anchor expression:
`max(deleted.starts_on, today)`.

**Upsert discipline (owner-reviewed at plan time):** full rows minus `created_at`
(UPDATE arm keeps the birth date — the mig-144 absorb rule), `updated_at` explicit
(app-managed, no trigger), typed `TablesInsert<"client_phases">[]` so the NOT NULL set
is compile-enforced, `onConflict: "id"` explicit. **§2 item 4 is COMPENSATED, not
ticked:** an upsert cannot carry a tenant filter, and a foreign id would be STOLEN into
this tenant by the DO UPDATE arm — the control is that every id reaching an upsert
array comes from a client-scoped read (`storedById` validation in the PUT;
`computeDeleteShift` over the client's own chain in DELETE), with a SECURITY comment at
both sites so a future caller trips the warning where the bug would be written.

**Tests: 255 files / 2657 (2624 + 33).** Chain contiguity 1–12 blocks; exact dates
incl. US spring-forward + fall-back straddles (UTC string math — holds under any server
TZ); `weeksSpanned` authored vs truncated (29d → 5); delete shift for future / current
mid-block / day-one / last-block / elapsed / unknown; service: elapsed-pin violations
(edit, reorder, omission-from-prefix), startsOn pin, omission 422, unknown payload id,
missing weeks, window floor BOTH ends + both allowed cases (anchor-back with grown
duration; future→current), truncate = one upsert with no delete issued, remove =
delete-first with both `.eq` scopes pinned, day-one remove, payloads carry no
`created_at`, and **only `client_phases` is ever touched** (invariant 7's service
half; the route half lands with Task 2.4's module-spy test).

**Gates.** `tsc --noEmit` clean · `eslint .` 0 errors (209 warnings, unchanged) ·
`vitest run` **255 files / 2657 tests, all passing** (arithmetic closes: +2 files,
+33 tests) · `check:labels` OK (636) · no `as any` · no markers · no migration in this
commit.

---

### Task 2.3 — Derived reads ✅ SHIPPED 2026-08-11

**What shipped.** `lib/blocks/block-derivations.ts` — pure, client-safe, no rounding
anywhere (renderer rounds; the 1.2 precedent): `deriveBlockState`
(current/past/future, ISO-string comparison), `deriveWeekOfTotal` ("week X of Y",
current block only, null otherwise — `total` = `weeksSpanned` (ceil), the SAME single
derivation as the GET's `weeks` field, so a truncated 29-day block reads "week 5 of 5"
on its final day and lists as 5 weeks, one solver), and `derivePace`.

**Pace is a pure, UNIT-AGNOSTIC function — the plan-review Q1 correction, restated so
Session 3 inherits it:** the plan doc's Task 3.2 row assigns the Weight column AND the
pace readout to the client-side merged series ("no new API"), and the merged series
both tie-ranks differently from `body_metrics` (coach entry wins same-day ties) and is
converted+rounded to the viewer's unit at source — so **the GET carries no pace and no
weight reads**, and pace's three weight inputs must share ONE unit system (documented
in the JSDoc; outputs are in that system). Session 3 feeds it from
`use-merged-metrics` so the readout matches the column beside it by construction;
Session 4's `/api/client/journey` picks its source at its own owner-decision time —
named server-side reuse target if it goes that way: `getBodyMetricsHistory`
(`services/body-metrics-service.ts`, `requireFields`/`to`/`limit`, `created_at`
tiebreak baked in).

**Semantics pinned by test:** null — never a fabricated zero — when target, start
weight, or current weight is missing; `expected` interpolates linearly start→target
(`start` on day one, `target` on the last day, exact fraction between); `remaining =
current − target` (positive = above target; the renderer picks wording from direction
of travel, the goal-state.ts lesson); `delta = current − expected` (sign readable only
with direction); `weeksLeft` fractional, floored at 0; the elapsed fraction clamps to
[0,1] so out-of-window callers get endpoint values (an elapsed block reads
`expected = target`), and a single-day window (truncate's day-two edge) reads fully
elapsed rather than dividing by zero.

**Gates.** `tsc --noEmit` clean · `eslint .` 0 errors (209 warnings, unchanged) ·
`vitest run` **256 files / 2669 tests, all passing** (+1 file, +12 tests; arithmetic
closes) · `check:labels` OK (636) · no `as any` · no markers · no migration.

---

### Task 2.4 — Routes, validation, audit ✅ SHIPPED 2026-08-11

**What shipped.** `GET`+`PUT /api/clients/[id]/blocks` and `DELETE
/api/clients/[id]/blocks/[blockId]` (the notes-route sub-route precedent — plan-review
decision), chain per the notes route verbatim: `coachApiRateLimit` →
`requireCSRFProtection` (mutating) → `requireCoachOwnsClient(clientId, request)` → zod
→ service. `clientToday` resolved once per request via `getClientTodayString` and
threaded down (GET parallelises it with the list read — §2 item 11). GET is
`Cache-Control: no-store`. PUT responds with the same decorated payload as GET (one
shape, no drift); DELETE adds `{ mode, changes }` — the realized shift from the same
pure helper the Session-3 dialog will preview with. `decorateBlocks`
(`lib/blocks/block-derivations.ts`) is the single response assembler: row +
`weeks`/`state`/`weekOfTotal`; **no pace field on the wire** (pinned by test).

**Reconciliation, recorded per the session brief:** the Session-2 verification bullet
says a foreign `clientId` "403s"; the house helper `requireCoachOwnsClient` returns
**404** to avoid leaking existence (CONVENTIONS §8 step 4 allows either; ARCHITECTURE's
IDOR section prescribes 404). The routes use the helper; the tests pin 404.

**Validation** (`lib/validations/client-blocks.ts`): `startsOn` format AND
calendar-validity checked (`Date.parse` refine — the value feeds UTC date math before
Postgres, so a regex-passing "2026-13-99" must 400, not crash the walk); `blocks`
1..`BLOCKS_PER_CLIENT_MAX`; per block `id` uuid optional, `name` 1..`BLOCK_NAME_MAX`
trimmed, `weeks` int 1..`BLOCK_WEEKS_MAX` optional-in-schema (elapsed echoes omit it;
the service 422s editable rows without it), `focus` trimmed ≤`BLOCK_FOCUS_MAX` with
empty→null, `targetWeightKg` `WEIGHT_KG_MIN..MAX` nullable — canonical kg on the wire,
no unit tag (§20). Constants in `lib/constants.ts`; **`BLOCK_WEEKS_MAX = 52` is a
deliberate MIRROR of the builder's `MAX_WEEKS`** (`program-builder-types.ts`), commented
with why it is a copy (lib must not import components/; the two bound different things;
drift tolerated but deliberate) — owner-reviewed at plan time.

**Audit:** `AUDIT_ACTIONS.BLOCK_CHAIN_UPDATE` (`block.chain_update`) and
`BLOCK_DELETE` (`block.delete`); `void recordAuditEvent(...)` after each authorized
write, `targetTable: "client_phases"`, metadata = counts/dates/mode only (no weights,
no focus text).

**Tests: 258 files / 2684 (2669 + 15).** Foreign client **404s** before any read on all
three verbs; **the PUT never touches the goal layer** (invariant 7's route half —
`client-goals-service` mocked with spies as a tripwire; the service half shipped in
2.2); zod 400s (fake calendar date, empty chain, empty name, zero weeks) before the
service runs; each service error class maps to 422 with its message (the mock factory
defines the classes so route and test share them for instanceof); unknown `blockId`
404s; elapsed delete 422s; 500s never leak raw errors; audit events pinned with action,
target and mode metadata; DELETE returns mode + realized changes + decorated fresh
chain.

**Gates.** `tsc --noEmit` clean · `eslint .` 0 errors (209 warnings, unchanged) ·
`vitest run` **258 files / 2684 tests, all passing** (+2 files, +15 tests; arithmetic
closes) · `check:labels` OK (640 — the four new files scanned) · no `as any` · no
markers · no migration.

---

### Task 2.5 — Doc update ✅ SHIPPED 2026-08-11 · SESSION 2 COMPLETE

**§4's mandated correction landed:** ARCHITECTURE's Overview bullet no longer claims
*"No roadmap or phase concept exists"* — rewritten (§3 class (b), stale-once-shipped)
keeping the distinction the plan doc requires: the status card's chips describe the
active **training** block; a **journey** block (`client_phases`) is an unrelated
concept sharing the word, and neither surface reads the other. The bullet also states
explicitly that journey blocks are NOT the migration-133 roadmaps feature returning.

**New section** "Journey blocks (`client_phases`, migration 145)" under Client Goals &
Body Metrics: the four-field entity, the naming divergence, date-derived
state/week/pace in the client's timezone, durations-in/dates-out with the pinned
elapsed prefix + symmetric window floor, delete-as-shift (truncate-current in one
atomic upsert; the day-one remove and the CHECK it justifies; the shared
`computeDeleteShift` preview contract; gap-only-after-partial-failure + self-heal),
pace off the wire and fed by the merged series, the route surface, and the RLS
posture.

**Gates.** `tsc --noEmit` clean · `eslint .` 0 errors (209 warnings — verified on this
tree earlier in the session; docs-only diff) · `vitest run` 258 files / 2684 tests, all
passing · `check:labels` OK (640) · `check:rls` OK (41/41) · docs-only commit.

**Session totals: 5 commits, 1 migration (145), 60 new tests (33 + 12 + 15) across 5
new test files — baseline 253 files / 2624 at session start, 258 / 2684 at close;
arithmetic closes exactly.** The blocks backend is complete and browser-unverified by
design — nothing
user-visible ships in Session 2; Session 3's UI smoke is the first end-to-end
exercise of these routes. The §2 security/load/perf review was delivered with the
session summary (triggers: migration + new routes + new write path; item 4
compensated-not-ticked per the Task 2.2 STATUS block; residuals recorded there).

---

### Task 3.1 — Rename Metrics → Journey + third sub-tab ✅ SHIPPED 2026-08-11

**What shipped.** `lib/client-tabs.ts` label `"Metrics"` → `"Journey"` — **label only;
the URL value stays `metrics`** (a value change buys nothing and breaks every existing
link; recorded per the task brief). H1 and sidebar both derive from `CLIENT_TABS`, so
one edit covers both; `VALID_TABS` (`app/clients/[id]/page.tsx`) stores values only and
needed no edit (confirmed, not assumed). The sub-tab relabel `body` → "Physique" was
**already true on main** (`metrics-top-bar.tsx`) — only the third segment was added.

**The typed union, shaped to protect the data layer:** `MetricTab` stays
`"body" | "wellness"` because `metricsByTab` / `logRowsByTab` / `DEFAULT_FOCUS` are
`Record<MetricTab, …>` — letting `"blocks"` into that union corrupts
`use-merged-metrics`' types. The pane switcher gets its own
`JOURNEY_SUBTABS = ["body","wellness","blocks"] as const` + `JourneySubtab` +
`isJourneySubtab` guard (`metrics-view-types.ts`), replacing the two-way ternary whose
silent `body` fallback the task brief flags. `metrics-tab-content.tsx` resolves
`pane: JourneySubtab` through the guard; `pane === "blocks"` renders the new
`BlocksSubtab` shell (`components/clients/metrics/blocks/blocks-subtab.tsx` —
SectionLabel + empty state in this commit; Tasks 3.2–3.4 fill it); the metric panes
narrow `pane` to `MetricTab` and are otherwise untouched. "Log measurement" stays
visible on the Blocks pane — it remains functional there, and hiding it is per-pane
conditional UI nobody asked for.

**The known `handleTabChange` bug is FIXED — after one same-session correction
(amendment commit).** The first cut preserved the whole query including `?subtab=`,
on the false premise that a carried-over subtab is inert until its own tab is back.
It is not: Training and Nutrition **share** the `subtab` key, and their tab-match
guards (`training-plan-builder.tsx:27-36`,
`nutrition/builder/nutrition-plan-builder.tsx:27-33`) defend a render-order race, not
a persisted param — a preserved `?tab=nutrition&subtab=plans` satisfies Nutrition's
guard and opened its Plans calendar instead of Data (owner-caught, mirror-image on
the way back). **Corrected model:** Journey's pane moved to a **single-owner
`?journey=` key** (values unchanged; read unconditionally — nothing else writes it,
so no cross-tab guard is needed and the pane restores with no flash), and
`buildClientTabUrl` (`lib/client-tabs.ts`) preserves the query **except `subtab`**,
which drops on every top-level switch — Training and Nutrition behave bit-for-bit as
before Session 3, and Journey's round trip restores through ANY intermediate tab.
Pinned by `lib/client-tabs.test.ts`, whose first two cases are the regressed
Training↔Nutrition pair specifically.

**Gates.** `tsc --noEmit` clean · `eslint .` 0 errors (209 pre-existing warnings,
unchanged) · `vitest run` **259 files / 2686 tests, all passing** (+1 file, +2 tests —
the `isJourneySubtab` guard pins; arithmetic closes from S2's 258/2684) ·
`check:labels` OK (642 — the two new files scanned) · no `as any` · no markers · no
migration. *(The amendment commit moved the suite to 260 / 2690 — +1 file, +4
`buildClientTabUrl` tests.)*

---

### Task 3.2 — The Blocks list + facts endpoint ✅ SHIPPED 2026-08-11

**What shipped — server.** `GET /api/clients/[id]/blocks/facts` (static segment
beside `[blockId]`; chain per the blocks GET: `coachApiRateLimit` →
`requireCoachOwnsClient` → service, `no-store`) + `services/
client-blocks-facts-service.ts`. Round trips are constant: chain read, then three
parallel reads over the whole journey span, partitioned per block in memory.
`getTrainingPlansOverlapping` joined `services/training-service.ts` — an overlap
question, not the starts-later question `getNextFutureTrainingPlan` owns, carrying
the same `deleted_at IS NULL` + `status <> 'archived'` exclusions for the same
resurfaced-retired-plans reason.

**The events read is PAGED (owner-mandated at plan review; two prior repo bites
cited).** `fetchAllPages` (`lib/paged-fetch.ts` — the factored-out copy of the
library-placement loop) with a narrow 3-column select ordered on `date`, which is
unique per client (`nutrition_events UNIQUE(client_id, date)`) and so satisfies the
deterministic-order contract with no extra tiebreak. **Row counts, as demanded:**
≤1000 rows/page; a 20-block × 12-week journey (1,680 days) is 2 pages; the
structural ceiling (20 × 52 weeks = 7,280 days) is 8 pages; a realistic 12–40-week
journey is 84–280 rows, one page. Complete by construction — a short page terminates
the loop. The wire payload is ≤20 fact rows regardless of span. **Per owner ruling,
the GROUP-BY RPC is NOT recorded as debt** — paging here is a complete solution, and
§8's aggregate-server-side bullet codifies the RN hot path, not a coach pane.

**Era handling (owner-accepted design).** The Nutrition fact's headline is the MODAL
`baseline_calories` over the block's lived days (current blocks clamp to
[startsOn, today]); the deficit resolves the version covering the modal's latest
observed date — that era's tdee against that era's baseline by construction, since
144 regenerates each version only inside its own window (pinned by the "era pin"
test: dominant era 2000@tdee 2800 beside newer 1800@2600 must read −800, never
−600). **`is_modified` days are excluded from both the modal and the change
detection** — a hand-edited day can neither skew the headline nor fake a change;
an all-modified window falls back to all days with the marker suppressed. **A block
spanning a prescription change SAYS so:** `changeCount` + `lastChangedOn` on the
wire (transitions across consecutive unmodified baselines — a re-save with identical
numbers doesn't flag), rendered as "Changed 14 Sep" / "Changed 2×". The versions
read is facts-local (with `tdee`) rather than a widening of
`getActiveNutritionPlanVersionsOverlapping` — that helper is the cascade's
segmentation primitive, and a write-path type shouldn't grow a read-only column;
`versionCoversDate` is reused.

**What shipped — client.** `components/clients/metrics/hooks/use-client-blocks.ts`
(co-located key builders + `useInvalidateClientBlocks` matching the
`/api/clients/{id}/blocks` AREA, covering chain + facts; `putBlockChain` /
`deleteBlockRequest` helpers for 3.3/3.4). `blocks/`: `block-colors.ts` (static
palette indexed by chain position — METRIC_COLORS discipline, no picker),
`block-weight.ts` (pure: start = latest merged point at-or-before startsOn, end =
in-window for past / latest overall for current / null for future),
`block-format.ts` (local-midnight date formatting), `block-card.tsx` (collapsed:
swatch dot · sans name · mono `week X of Y` chip current / sans `Not started` chip
future / none past · mono dates+weeks · right-aligned mono weight change; expanded:
Training / Nutrition / Weight+pace columns + timeline; `rowAction` slot reserved for
3.4's delete), `block-timeline.tsx` (start/placements/end entries; "Nothing yet.");
`blocks-subtab.tsx` rebuilt from the 3.1 shell (SectionLabel + mono meta
`N blocks · M weeks`, skeletons, error line, empty state). Pace feeds `derivePace`
in viewer units (target converted via `formatWeight` like the merged series), so the
readout matches the Weight column beside it by construction; block STATE always
comes from the wire (client-tz) — device today is used only for the pace fraction.

**Recorded, not worked around:** plan amendments are invisible in the v1 timeline
(`audit_logs` has no readers by design); the coach-note quote block + first-name
util are DEFERRED to Session 6 with their only data source (owner-approved); a
training placement made on another tab stales the facts cache until the pane
remounts (SWR revalidates on mount — the blocks area owes no other area an
invalidator since blocks writes touch only `client_phases`). ARCHITECTURE.md's
blocks route-surface bullet gained the facts GET in this commit (§3 class (b)).

**Gates.** `tsc --noEmit` clean · `eslint .` 0 errors (209 warnings, unchanged) ·
`vitest run` **264 files / 2711 tests, all passing** (+4 files, +21 tests: facts
service 9 — era pin, is_modified exclusion, all-modified fallback, lived-day clamp,
paging-union pin, multi-change count; route 3 — foreign-404-before-read, no-store +
today threading, no-raw-error-leak; block-weight 5; timeline 4; arithmetic closes
from 2690) · `check:labels` OK (652) · no `as any` · no markers · no migration.

---

### Task 3.3 — "Add a block" ✅ SHIPPED 2026-08-11

**What shipped.** `blocks/add-block-form.tsx` — an INLINE form per the task brief,
taking the habits manage-drawer's `showAddForm` swap for the SHELL only (its
raw-useState internals predate the react-hook-form rule — the §4 collision table's
class (a); the form complies instead of copying). Form state is react-hook-form +
`zodResolver` (name 1..`BLOCK_NAME_MAX`; weeks int 1..`BLOCK_WEEKS_MAX` via
`valueAsNumber`; focus ≤`BLOCK_FOCUS_MAX`, labelled **"Focus"** with the mandated
**"What's this block for?"** prompt). Target weight collects in the VIEWER's unit
through `useCanonicalInput` and commits canonical kg, with the RHF field holding the
canonical number so the schema's `WEIGHT_KG_MIN/MAX` bounds validate storage — the
`add-client-manual-form.tsx` pattern, unit suffix from `formatWeight(0, preference)
.unit` (no unit literal in JSX, §20). The live line — *"Starts 7 Sep, ends 4 Oct.
Journey becomes 20 weeks."* — is a sentence and therefore 100% sans (the prose
rule), derived from the chain end + `weeks` via the same `DAYS_PER_BLOCK_WEEK`
arithmetic the backend uses. The **empty-chain case adds a start-date field**
(defaults to today) — the PUT requires an anchor and a first block has no stored
one; an existing chain anchors at its stored `startsOn` and the form shows no date.

**The payload discipline is a tested pure helper**, `blocks/block-chain-payload.ts`
(`buildAppendPayload`): stored rows echo verbatim — **elapsed rows OMIT `weeks`**
(pinned from storage; a truncated 29-day block has no reproducing weeks value),
current/future rows echo theirs (reproducing stored dates exactly — only elapsed
blocks can be non-whole-weeks), nulls echo as nulls (the service echo-checks them)
— with the id-less new row appended last. Mounted in `blocks-subtab.tsx` behind the
SectionLabel rail's `+` (the Programs-library action recipe) and the empty state's
primary CTA; the open form renders at the chain's end, where the block will land.
Submit → `putBlockChain` → `useInvalidateClientBlocks` (area) → success toast
quoting the name (`"Cut 2" added`) → swap back; service 422s (window-floor
violations) surface as destructive toasts with the server's message.

**No block-edit affordance — explicit non-goal.** Session 3 has no edit task; add +
delete is the whole v1 write surface.

**Gates.** `tsc --noEmit` clean · `eslint .` 0 errors (209 warnings, unchanged) ·
`vitest run` **265 files / 2715 tests, all passing** (+1 file, +4 payload-builder
tests; arithmetic closes from 2711) · `check:labels` OK (655) · no `as any` · no
markers · no migration.

---

### Task 3.4 — Delete a block ✅ SHIPPED 2026-08-11

**What shipped.** A hover-revealed danger icon on **current and future rows only**
(elapsed rows render no affordance — they are read-only and never reach the
dialog; a one-action kebab is the wrong affordance per the design doc, so it is a
bare rail icon in the card's `rowAction` slot, outside the expand toggle because
buttons cannot nest). `blocks/delete-block-dialog.tsx` follows the
destructive-confirm recipe exactly (`newdesignsystem.md:417-421`, the
delete-event-dialog silhouette): styled `Dialog` — never AlertDialog — danger
thumb, ONE plain-sans consequence sentence, ghost Cancel + danger-**outline** CTA
repeating the verb ("Delete block") with `Loader2` while pending.

**The sentence is a tested pure function** (`blocks/delete-block-sentence.ts`)
whose tests drive the REAL `computeDeleteShift` — the same helper the DELETE route
executes — pinning all the shapes: future block with one shifted successor (*"The
journey shortens to 16 weeks and ends 20 Sep. Peak moves to 24 Aug."*), last-block
delete (no moves clause), two moved blocks both named, ≥3 collapsing to a count
(*"3 later blocks move earlier."*), current mid-block (*"Cut 2 starts today."*),
current with no successor (*"The journey now ends yesterday."*), and the
only-block case. Success toasts name the outcome (`"Cut 2" deleted` /
`"Cut 2" now ends yesterday`); failures surface the server's message as a
destructive toast. Delete → `deleteBlockRequest` → blocks-area invalidation.

**Additive wire change, recorded:** the blocks GET/PUT/DELETE responses now carry
**`clientToday`** beside the decorated chain. The preview must run
`computeDeleteShift` with the SAME today the DELETE executes with — the coach's
device day diverges from the client's around midnight, which is exactly the
preview-vs-execution drift the shared-pure-helper design forbids. The S2 route
tests assert by path (`data.blocks`, `data.mode`), so the field is purely
additive; both tests gained a pin on it. Side benefit: the pace fraction now also
uses the wire's client-tz today — **no block math anywhere runs on the coach's
device day**, and the subtab's `getTodayDateString` usage is gone.

**Gates.** `tsc --noEmit` clean · `eslint .` 0 errors (209 warnings, unchanged) ·
`vitest run` **266 files / 2722 tests, all passing** (+1 file, +7
sentence-builder tests; arithmetic closes from 2715) · `check:labels` OK (658) ·
no `as any` · no markers · no migration.

---

### Task 3.5 — Chart shading + the c2bc944 repoint ✅ SHIPPED 2026-08-11 · SESSION 3 CODE COMPLETE

**The hard blocker first, as mandated:** `metric-trend-chart.tsx`'s X axis is now
**numeric time** (UTC-midnight epoch ms via `toUtcMs`, newly exported from
`utils/metric-points.ts`), replacing the category scale over entry dates. The
domain is the WINDOW, not the entries — `[today−(range−1), end-of-today]` for
30/60/90, `[first entry, end-of-today]` for All — with 5 explicit ticks; day-slab
semantics (+1 day) keep today's dot off the right edge and let the current
block's band reach the end of today. **Accepted visual change, recorded:** points
now space by real elapsed time, not entry index — uneven logging renders as real
gaps. That is the point of a time axis; it is on the smoke checklist.
**Adjacent root-fix, called out per §2:** the old `formatDateShort` parsed bare
ISO (`new Date(iso)` = UTC midnight), rendering the PREVIOUS day on axis ticks
and tooltips for negative-offset viewers — a live pre-existing off-by-one in the
exact path the conversion rebuilds; it now parses local midnight (the
delete-event-dialog precedent).

**Bands:** one `ReferenceArea` day-slab per block, painted behind grid and
series, clamped to the domain by a pure tested module
(`blocks/block-chart-bands.ts`: identity shaped ONCE from the chain — colour by
chain position so a range window never repaints survivors — geometry clamped
in-chart; adjacent blocks tile exactly and the shared edges carry white
`ReferenceLine` dividers, interior-only). **ALL blocks render, elapsed ones
muted** (fill 0.04 vs 0.07 — invariant 10; the muted rendering IS the view-past-
blocks story); every band carries its name label `insideTop` in the block's
colour (sans — names are words). The goal `ReferenceLine` + its
`ifOverflow="extendDomain"` are byte-identical. The **"Show blocks"
checkbox** rides the chart card's existing `legend` slot (no neutral-shell
edit), state beside `range` in `metrics-tab-content`, **default ON** when blocks
exist; the blocks read shares the Blocks pane's SWR cache.

**Palette re-stepped, validator-driven (dataviz six checks, run not eyeballed):**
the 3.2 palette copied METRIC_COLORS' five hues, whose "one metric at a time"
justification does not transfer to ADJACENT bands — the validator failed
`#0a5c55` outright (lightness band + chroma floor: reads gray as a mark) and the
teal↔cyan adjacency at normal-vision ΔE 7.9 (hard floor 15). `BLOCK_COLORS` is
now **four hues cycling** (`#0d9488, #c8923a, #2d8fb5, #c06060`) — re-ordered so
the near-pair is never adjacent INCLUDING the cycle's wrap, validated PASS; the
two surviving WARNs (wrap-pair CVD 7.3 in the legal-with-secondary-encoding
band; honey contrast) are relieved by design — direct name labels on every band
+ white dividers. Amber stays out: it is the goal line's reserved meaning.

**Same commit:** the three stale `c2bc944` citations in
`docs/CLIENT-PORTAL-EXECUTION-PLAN.md` (:1305/:1315/:1321) repointed to
`cb2165b` (verified: `c2bc944` dangling, `cb2165b` on main, identical message),
with a one-line provenance note at the first descriptive citation.

**Gates.** `tsc --noEmit` clean · `eslint .` 0 errors (209 warnings, unchanged) ·
`vitest run` **267 files / 2728 tests, all passing** (+1 file, +6 band-geometry
tests; arithmetic closes from 2722; one unrelated intermittent failure appeared
in a single run and did not reproduce on re-run — the documented flaky-full-run
pattern) · `check:labels` OK (660) · no `as any` · no markers · no migration.

---

## SESSION 3.6 — Edit a block + end-date granularity (owner-directed follow-up, 2026-08-12)

> Owner-approved plan: **[A]** facts reign fix · **[B]** end-dates-in contract
> (weeks → endsOn on the PUT's editable rows; day-granular lengths; the §2
> invariant-3 mechanism — date pairs never cross the wire, starts always
> derived — survives with only the duration unit changing) · **[C]** elapsed
> pin relaxed to dates-only (name/focus/target editable on past blocks —
> owner-approved reversal of the S2 verbatim-pin decision) · **[D]** the edit
> UI (pencil, shared form, push-forward preview; target weight included by
> owner call). "Notes" confirmed = the derived timeline, not a new column;
> zero migrations.

### Task 3.6-A — Training column reign fix ✅ SHIPPED 2026-08-12

**The defect (owner-probed, found while answering "does placing a new plan drop
the old one from a finished block?"):** placed `training_plans` keep
`effective_until = NULL` forever ("active" resolves by latest-start-wins, not by
closed windows), so the facts endpoint's raw window-overlap treated a January
program as overlapping every later block — a client's fourth sequential block
listed all four programs.

**The fix:** `reduceToGoverningSegments` (`client-blocks-facts-service.ts`,
exported + tested) reduces the fetched plans to the segments where each
actually GOVERNED under `getTrainingPlanForDate`'s own rule — latest
`effective_from` wins among covering plans, same-day ties to the newest-created
(the query's `created_at DESC` within-group order, documented reliance). The
winner can only change at a plan's start or the day after a capped window
closes, so only those boundaries are evaluated; adjacent same-plan segments
merge; a capped plan expiring hands govern-ship BACK to the older open plan —
exactly the per-date resolution answer. Blocks then list plans whose governing
segments intersect their window. No wire or route change. Recorded edge: a plan
placed and superseded the same day (zero governed days) now vanishes from both
the column and the timeline — resolution-faithful, and the timeline's
amendment-blindness note already covers the "something happened here" gap until
Session 6's notes land.

**Gates.** `tsc --noEmit` clean · `eslint` clean on touched files ·
`vitest run` **267 files / 2733 tests, all passing** (+5: superseded-plan
leak, capped-successor handback, same-day tie, and 2 direct segment pins;
arithmetic closes from 2728) · `check:labels` OK (660) · no `as any` · no
markers · no migration.

---

### Task 3.6-B — End-dates-in contract (weeks → endsOn) ✅ SHIPPED 2026-08-12

**The unit change, owner-directed:** block lengths are now day-granular, entered
as each block's **end date**. Invariant 3's mechanism is untouched — the caller
still never sends a date pair; `computeBlockChainFromEnds` derives every start
(previous end + 1, or the chain anchor), so overlaps and gaps stay structurally
unexpressible. The invariant's text carries the amendment note. Week-granularity
was never load-bearing: the DB stores arbitrary DATE pairs, `weeksSpanned` was
already a ceil over days, and every derivation (state, week-of-total, pace,
delete-shift) compares dates — the GET's `weeks` field is unchanged as the
display derivation.

**What changed where:** `BlockChainEntryInput.weeks` → `endsOn` (optional in the
schema — elapsed rows omit it; their dates come from storage, never the walk,
which also dissolves the old "weeks is ignored on elapsed rows" wart). The
service 422s an editable row without an end date, an **end before its DERIVED
start** (which zod cannot know — the walk deliberately passes inverted windows
through for the service to name), and a window over `BLOCK_WEEKS_MAX` weeks of
days (the old ceiling, boundary pinned: exactly 52 weeks passes, 52w + 1 day
422s). The add form's weeks field became an **end-date picker** (min = the
derived start — the window floor as UX; max = start + 363; seeded to a 4-week
block so the live line reads immediately); the cross-field end-vs-start check
lives in a schema factory because a zodResolver replaces RHF field-level
validation. The live sentence went day-aware via `formatBlockLength` ("Starts
7 Sep, ends 4 Oct — 4 weeks 3 days. Journey becomes 20 weeks.").
`buildAppendPayload` echoes stored `endsOn` verbatim for current/future rows.
ARCHITECTURE's blocks bullet rewritten ("Ends in, starts out").

**Gates.** `tsc --noEmit` clean · `eslint .` 0 errors (209 warnings, unchanged) ·
`vitest run` **268 files / 2740 tests, all passing** (+1 file, +7: 3
formatBlockLength, inverted-window pass-through, end-before-derived-start 422,
length-cap 422 + exact-52-week boundary pass; the weeks-era pins across chain /
service / route / payload tests re-targeted to end dates with identical
windows; arithmetic closes from 2733) · `check:labels` OK (661) · no `as any` ·
no markers · no migration.

---

### Task 3.6-C — Elapsed pin relaxed to dates-only ✅ SHIPPED 2026-08-12

**Owner-approved reversal of the S2 verbatim pin** (the S2 Task 2.2 STATUS
records the original decision; this supersedes its fields half): an elapsed
block's **name, focus and target weight are now editable** through the PUT —
the pin exists to protect lived-day ATTRIBUTION, and freezing typos in a
finished block's label was conservatism, not the invariant. **What remains
pinned:** ids, order, and DATES — elapsed rows still omit `endsOn` (a differing
one 422s: "Past blocks' dates can't change"), their dates always come from
storage, and the anchor stays immovable while past blocks exist. Changed
elapsed rows are written with payload fields over stored dates in the same
single upsert as the suffix; **unchanged echoes are deliberately not
rewritten** (pinned by test — the add flow's verbatim echo issues no elapsed
writes). Fields on elapsed rows now behave last-write-wins, exactly as
current/future fields always have.

**Gates.** `tsc --noEmit` clean · `eslint .` 0 errors (209 warnings, unchanged)
· `vitest run` **268 files / 2742 tests, all passing** (+2 net: the old
fields-reject pin replaced by edit-in-place with stored dates, plus
elapsed-date-change 422 and no-needless-write pins; arithmetic closes from
2740) · `check:labels` OK (661) · no `as any` · no markers · no migration.

---

### Task 3.6-D — Edit-block UI ✅ SHIPPED 2026-08-12 · SESSION 3.6 CODE COMPLETE

**What shipped.** A hover-revealed **pencil on every row** (elapsed included —
fields are editable there since 3.6-C; the trash stays current/future-only and
rightmost, per the rail order rule). Clicking it swaps the card for the form in
place: `add-block-form.tsx` **generalized into `block-form.tsx`** (one
component, `mode: add | edit` — no fork), seeded from the block, with target
weight included per owner call (`useCanonicalInput` seeded from stored kg — its
untouched-field guard means an unedited box commits the seed exactly). Field
rules by mode: elapsed edit shows the fixed date range as text (no end field —
dates are history); the CURRENT block's end picker floors at the client's
today (the window floor as UX; the schema message names it); the **start date
is editable only on the chain's first block while nothing is lived** —
everywhere else starts are derived, so "moving" a middle block is its
predecessor's end.

**Push-forward, previewed with the executing math:** `computeEditShift`
(tested) re-anchors every later block duration-preserved — the same walk the
service's derived-starts contract executes, so the live sentence ("Ends 4 Oct
— 6 weeks 2 days. Peak moves to 5 Oct. Journey becomes 22 weeks.") and the
result cannot differ. The moved-blocks clause is shared with the delete
confirm (`movedBlocksClause`, extracted — delete outputs byte-identical,
its count verb stays "move earlier" while edits use direction-neutral
"move"). `buildEditPayload` (tested) substitutes the edited row's fields,
re-anchors later ends, carries the anchor move for the unlivedfirst-block
case (ignored elsewhere — belt), and returns `journeyWeeks` for the sentence.
Submit → PUT → blocks-area invalidation → `"Cut 2" updated` toast; service
422s (floor violations the UI can't pre-empt, e.g. a shrink that would push a
later block wholly past) surface as destructive toasts with the server's
sentence.

**Gates.** `tsc --noEmit` clean · `eslint .` 0 errors (209 warnings, unchanged)
· `vitest run` **268 files / 2751 tests, all passing** (+9: computeEditShift
extend/shrink/last-block, buildEditPayload substitution / elapsed fields-only /
unchanged-end / unknown-id, anchor-move + not-first-belt; arithmetic closes
from 2742) · `check:labels` OK (661) · no `as any` · no markers · no
migration. **Session 3.6 totals: 4 commits, zero migrations, +23 tests
(2728 → 2751).** Browser-unverified; the smoke checklist below supersedes
Session 3's for the blocks pane.

---

## SESSION 3.7 — Coach-curated archive (owner-directed, 2026-08-12)

> Owner-decided design after two iterations: NOT derived-by-elapsed (a live
> 16-week program's finished phases must stay on the main list — the coach
> reads the whole program as one journey) — a per-block CHOICE, which
> therefore lives in the DB. `archived_at` is a **view preference, not
> lifecycle**: invariant 2 forbids deriving current/past/future from status
> (the mig-133 disaster), and nothing here does — state stays date-derived,
> no derivation consults the column, nothing fires at boundaries. The
> `client_notes.is_pinned` shape. Invariant 10's "rendered in the list"
> clause is amended (owner-directed): elapsed blocks render in the list until
> the coach archives them; chart shading renders ALL blocks regardless,
> forever. The `BLOCKS_PER_CLIENT_MAX` raise was offered and not taken —
> still 20.

### Task 3.7-1 — `archived_at` column + archive PATCH ✅ SHIPPED 2026-08-12

**Migration 146** (`client_phases.archived_at TIMESTAMPTZ` nullable, column
comment naming it a view preference; no RLS/GRANT work — existing deny-all
table; gen-types diff: exactly the one column across Row/Insert/Update; owner
ran the push; `check:rls` 41/41). **Service `setBlockArchived`** — elapsed
blocks only (archiving current/future hides live context: 422 "Only completed
blocks can be archived"); restore always legal (an archived block was elapsed
when archived, and elapsed is permanent); both writes tenant-scoped. **Route:**
`PATCH /api/clients/[id]/blocks/[blockId]` `{ archived: boolean }` — full
coach chain, audited (`block.archive`, metadata `{archived}`), responds with
the decorated chain + `clientToday` (the siblings' shape). **The chain
contracts never see the field:** the PUT's upsert writes only its own keys
(so chain rewrites can't clobber `archived_at`, the created_at mechanism),
the payload builders don't send it, the GET returns ALL blocks with
`archivedAt` on the wire — filtering is render-only, so echo discipline,
shift math and the add-form anchor keep operating on the full chain.

**Gates.** `tsc --noEmit` clean · `eslint .` 0 errors (209 warnings) ·
`vitest run` **268 files / 2762 tests, all passing** (+11: 5 service — set /
clear / current-422 / future-422 / unknown-404 with tenant-scope pins; 6 PATCH
route — foreign-404-before-read, zod 400, audit + chain-shape, 422 message
passthrough, unknown 404, no-raw-error 500; every block fixture helper across
8 test files gained `archivedAt`, the §-cascade rule) · `check:labels` OK
(661) · `check:rls` OK (41/41) · migration + regenerated types in this
commit.

---

### Task 3.7-2 — Archive view UI ✅ SHIPPED 2026-08-12 · SESSION 3.7 COMPLETE

**What shipped.** The Blocks rail gains a **view switcher** per the
rail-dropdown grammar (sentence-case value + chevron, `align="end"`, teal
check on the selected item): **Journey** (everything unarchived — a live
program's finished phases included) / **Archive (N)**. Elapsed rows on the
Journey view carry a hover **Archive** icon in the trash's slot (current and
future rows keep the trash — the two are mutually exclusive by state, and the
rightmost slot stays the "moves it away" action); Archive-view rows carry
pencil + **Restore**. Toasts `"Cut 1" archived` / `"Cut 1" restored`;
blocks-area invalidation on both. Per-view empty states ("Nothing archived
yet." / "All blocks are archived."); the add affordance and form render on
the Journey view only, and the add form's anchor still comes from the FULL
chain (an archived last block still anchors the next one — the chain is
untouched by archiving). **Colour is keyed to full-chain position before
filtering**, so archiving never repaints survivors, and the **chart bands
ignore archiving entirely** (`shapeBlockBandIdentity` reads the unfiltered
chain) — history stays explained; only the list declutters.

**Gates.** `tsc --noEmit` clean · `eslint .` 0 errors (209 warnings) ·
`vitest run` **268 files / 2762 tests, all passing** (UI-only; the behaviour
seams — PATCH contract, elapsed-only rule, render filter inputs — are pinned
by 3.7-1's tests) · `check:labels` OK (661) · no `as any` · no markers · no
migration. **Session 3.7 totals: 2 commits, 1 migration (146), +11 tests.**
Browser-unverified.

**Amendment (owner-directed, same day):** the rail dropdown was replaced by an
**icon toggle** — `Archive` on the Journey view opens the archive (count in
the tooltip), `Flag` (the pane's established journey mark, its empty state's
icon) leads back; the `+` sits inward of the toggle, journey-view only. All
gates re-run green.

**Amendment 2 (owner-directed, same day):** the rail meta ("N blocks · M
weeks") now describes the JOURNEY only — unarchived blocks — and the archive
view carries no meta at all. The add/edit forms' "Journey becomes N weeks"
sentence computes from the same unarchived figure, so the meta and the
sentence cannot disagree (an archived-block edit renders no sentence anyway —
elapsed edits are fields-only). Gates re-run green.

---

### Nutrition column resemantic — PRESCRIPTION, not events-modal ✅ SHIPPED 2026-08-12

**Caught in the owner's 3.2 browser smoke** (the fixture client): the column
read "2,400 kcal · +180 kcal/day" against a calendar full of 1,967–2,633.
Live-DB probe proved the math did exactly what 3.2 coded — and that the coded
semantics fail in the field: **17 of the block's 20 lived days were
hand-edited (`is_modified`)**, so the "robust" exclusion left a 3-day sliver
(2,400×2 + 2,220×1), the modal picked 2,400, and its era's tdee (2,220) made
a "+180 surplus". Deterministic, traceable to nothing the coach can see.
Two compounding design errors: the hand-edit exclusion turns blind when
edits dominate a window (a legitimate coaching pattern), and dominant-era
history isn't the coach's question anyway.

**Owner-specified semantics (verbatim intent: "current deficit across the
block; hand-edited days ignored; training surplus ignored; daily calories,
then the deficit"):** the fact now reads the plan VERSION covering the
block's reference date — TODAY for a current block, the final day for a past
one, the first day for a future one — taking `baseline_calories` (custom-
macros override honoured) and `deficit = tdee − calories` straight from the
row. Hand edits and surpluses excluded by construction; version windows
can't overlap (mig-144 gist exclusion) so at most one covers any date; no
covering version → "Not set". **The "Changed" marker keeps its event-based
detection** (transitions across unmodified lived days) — it was correct
through the whole incident ("Changed 26 Jul" = a real pre-versioning save)
and catches history no plan row remembers. Recorded caveat: blocks that
ended before migration 144 are covered by the legacy version's window, whose
last-saved numbers stand in for eras the row no longer remembers — the
marker is the honest signal there. Fixture now reads **1,995 kcal ·
−225 kcal/day · Changed 26 Jul**.

**Gates.** `tsc --noEmit` clean · `eslint .` 0 errors (209 warnings) ·
`vitest run` **268 files / 2764 tests, all passing** (nutrition-fact tests
rewritten for prescription semantics: current-block fixture case, past-block
era pin via final-day version, custom-macros override, tdee-null, no-version
null, marker-skips-edits, clamp-at-today, paging pin re-targeted to a
page-2-only transition; +2 net from 2762) · `check:labels` OK (661) · no
migration.

---

### Task 4.2 — `GET /api/client/journey` ✅ SHIPPED 2026-08-12

**Owner decisions locked this session (all 2026-08-12) — Sessions 0b and later
inherit these rather than re-opening them:**

- **Goal exposure: YES to both, scoped to this endpoint only.** The endpoint
  exposes the client's goal DEADLINE and reads `client_goals` via
  `resolveEffectiveGoal` — the first `/api/client/**` surface to do either.
  The `/api/client/me` + `/progress` mirror reads are unchanged;
  `CLIENT_SELF_COLUMNS` still excludes `goal_deadline` and its comment now
  names this endpoint as the scoped exception (so the allowlist is not read
  as a leak-proof guarantee).
- **The 0b.1 map-or-delete question, SETTLED for Session 0b to inherit and
  EXECUTE (this session touches none of those files): DELETE the three dead
  `?? client.goalDeadline` fallbacks** (`nutrition-calc-inputs.ts:114`,
  `comparison-service.ts:67`, `nutrition/route.ts:172` — re-verified on main;
  the plan doc's :65/:152 had drifted) **plus the dead `Client.goalDeadline`
  field (`types/check-in.ts:429`).** Rationale: `clients.goal_deadline` exists
  and IS written (`updateGoals`' dual-write at `client-goals-service.ts:141-150`
  plus the direct mirror writers 0b.2 removes), so MAPPING it would make a
  silently-divergeable mirror deadline reachable in three calculator/pace
  paths for the first time; deleting is zero behaviour change (the fallbacks
  are unreachable today) and matches invariant 16 and the mirror's
  single-writer-then-removal trajectory.
- **Weight source: MERGED-SERIES PARITY** — owner verbatim: *"the start and
  end weight should be the same as what the coach sees. The client app simply
  shows the client what the coach sees."* Block weights come from the SAME
  series the coach card renders — `buildMetricPoints` over check-in weights ⊕
  `client_metric_entries`, where a same-day coach entry outranks the check-in
  — **not** from `body_metrics`, whose timestamp ordering ranks that tie the
  opposite way. A divergence-accepting draft (2.3's conditional
  `getBodyMetricsHistory` reuse target) was explicitly REJECTED at plan
  review; that branch was never conditional-accepted, and it was not taken.
  One latent defect observed while costing it is filed in `TECHNICAL-DEBT.md`
  (`GET …/body-metrics`' unbounded path truncates silently at ~1000 rows; no
  in-repo caller today).
- **Archive semantics (owner delegated the pick): archived blocks are
  EXCLUDED from the client payload.** `archived_at` is curation of the
  PRESENTED journey for both audiences — coach Journey list and client app —
  not a coach-private view preference; chart bands alone render every block,
  forever. The two places the old semantics were written down were rewritten
  in this commit (`types/client-blocks.ts` `archivedAt` docstring,
  `setBlockArchived`'s JSDoc in `services/client-blocks-service.ts`).

**What shipped.** `GET /api/client/journey`
(`app/api/client/journey/route.ts`): `requireClientAuth` (the §9 two-tier
order — IP-keyed `clientApiRateLimit` as first operation, CSRF, auth,
`clientPerClientRateLimit` on the resolved id) → `getClientTodayString`
resolved at the route and threaded down (the service never derives time — the
blocks-routes precedent) → `services/client-journey-service.ts` →
`Cache-Control: no-store`. Wire (`types/client-journey.ts`):
`{ clientToday, blocks[], goal: { weightKg, deadline }, currentWeightKg }` —
blocks decorated by the SAME `decorateBlocks` as the coach GET
(`weeks`/`state`/`weekOfTotal`) plus `startWeightKg`/`endWeightKg` from the
SAME `deriveBlockWeightFacts`. **Deliberately NO `changeKg` on the wire**: the
coach card subtracts AFTER rounding each endpoint to 1dp in viewer units, and
`round(end − start)` can differ from `round(end) − round(start)` by 0.1 — so
the renderer converts + rounds each endpoint, THEN subtracts (documented on
the type; Task 4.1 renders this way). Canonical kg, no unit tags, no server
rounding (§20).

**Parity mechanics.** The check-ins read is paged (`fetchAllPages`,
`(created_at, id)` asc — deterministic with a unique tiebreak) and carries
**NO status filter — parity-critical, pinned by test and by a comment at the
query**: the coach series includes every check-in regardless of status
(`use-check-in-data.ts`'s page key sends only limit/offset), so a status
filter added later "for cleanliness" would silently desync the two surfaces
with nothing failing. The `weight IS NOT NULL` DB filter is
equivalent-by-construction (`buildMetricPoints` skips non-numeric values).
`listMetricEntries` **is now paged internally** (same `fetchAllPages`; its
existing `(entry_date, metric_key)` order is already unique per client via
the table's upsert key, so no new tiebreak) — the coach Metrics page and this
endpoint share ONE complete source, closing the silent ~1000-row truncation
for both surfaces together. `deriveBlockWeightFacts` MOVED
`components/clients/metrics/blocks/block-weight.ts` → `lib/blocks/block-weight.ts`
(+ test; audience-shared pure logic belongs in `lib/` — CONVENTIONS §2's
extract-shared rule), its points param narrowed to
`Pick<MetricPoint, "date" | "value">[]` so the server feeds bare kg pairs;
the two coach importers repointed, call sites untouched.

**Tests: 270 files / 2780 (268/2764 + 2 files, + 16 tests; arithmetic
closes).** Journey service 9 — the same-day tie-rank parity pin (coach entry
89.8 beats the later-submitted 90.2 check-in), the no-status-filter pin (only
`client_id` + `weight IS NOT NULL` reach the query; no `in()`), per-state
weight facts incl. the exactly-on-start boundary, archived exclusion,
short-circuit-with-no-series-reads when nothing is unarchived, goal
resolution + maintenance shape, non-weight entries ignored, unrounded kg
pass-through, and a two-page union whose latest weight lives on page 2. Route
5 — payload + `no-store` + no unit fields anywhere in the JSON, the §9 tier
order via invocation order (IP guard < auth < per-client, per-client keyed on
the resolved id), 401-before-any-service-read, today resolved at the route
and threaded, generic 500 with no raw-error leak. Plus the
`listMetricEntries` paging pin (+1) and the moved block-weight suite's
bare-pairs case (+1).

**Gates.** `tsc --noEmit` clean · `eslint .` 0 errors (209 pre-existing
warnings, unchanged) · `vitest run` **270 files / 2780 tests, all passing** ·
`check:labels` OK (661) · no `as any` · no markers · no migration.

---

### Task 4.1 — `/client/program` shows the current block ✅ SHIPPED 2026-08-12

**What shipped.** `components/client-portal/program/journey-section.tsx`,
mounted by `app/client/program/page.tsx` above the two plan cards from a third
SWR read of `GET /api/client/journey` (same options as the page's existing
reads; the journey participates in the initial-load skeleton gate; a journey
fetch failure drops only the section — the page's per-card error posture; the
"both plans failed" full-error gate is unchanged). Portal idiom throughout
(shadcn tokens + `font-mono-display` numerals — the tree is
check:labels-whitelisted; Teal-Summit does not apply). The **current block
card**: name (sans semibold) · focus sentence · `Week 2 of 3 · ends 22 Aug`
(mono meta) · a **hand-rolled progress bar** (the
`check-in/weight-goal-card.tsx` track + inline-width-fill shape with portal
tokens `bg-muted`/`bg-primary`, NOT `components/ui/progress.tsx`) whose width
is the same clamped elapsed-days fraction `derivePace` uses, anchored on the
wire's `clientToday` — no device-day math (the S3.4 rule) · the two labelled
target lines, `This block: 89.0 kg by 6 Sep, 0.9 kg to go` and
`Your goal: 85.0 kg by 1 Dec, 4.9 kg to go` (spec copy plus the viewer unit
from `formatWeight`/`useUnits` — no unit literals in JSX; "to go" omitted when
either side is missing, the goal line omitted on maintenance, "by …" omitted
without a deadline, the block line omitted without a block target).
**Finished blocks** below under a small heading: name ·
`1 Jun – 28 Jun · 4 weeks` (mono meta) · right-aligned signed change
(`+1.2 kg`) — the coach collapsed-row wording; future blocks deliberately not
rendered. **Every delta renders round-then-subtract** (convert each endpoint
to the viewer's unit, round to 1dp, THEN subtract — pinned by a test where
90.06→89.94 kg must read −0.2, not the −0.1 a raw `round(end − start)`
prints).

**Shared-formatter move (§2 extract-shared, declared in plan review):**
`block-format.ts` (+ its test) moved
`components/clients/metrics/blocks/` → `lib/blocks/` so the portal renders
"6 Sep" byte-identically to the coach side without a cross-audience import;
the four coach importers repointed (`block-card`, `block-timeline`,
`block-form`, `delete-block-sentence`), zero behaviour change.

**One landmine hit and fixed in the same commit:** the page's existing
`page.test.tsx` (not in the plan's file list) failed on first full-suite run —
the new `JourneySection` import chain reaches `units-context` →
`auth-context`, which constructs the browser Supabase client at module load
and throws without env vars (the exact failure the
`performance-view.test.tsx` comment documents). Fix: the page test stubs
`JourneySection` like it already stubs the two cards (the section has its own
suite), which also severs that import chain; four new page-gating pins rode
along (section-above-cards DOM order, section-beside-empty-state when blocks
exist but no plans, journey-error drops only the section, journey in the
skeleton gate).

**Tests: 271 files / 2790 (270/2780 + 1 file, +10: journey-section 6 — full
current-card render incl. 50% bar width and both target lines, maintenance +
no-target omissions, no-current-weight tail drops, finished-row wording + the
round-then-subtract pin, imperial conversion, only-future renders nothing;
page 4 — the gating pins above; arithmetic closes).** One unrelated
intermittent failure appeared in a single full run and did not reproduce on
re-run — the documented flaky-full-run pattern.

**Gates.** `tsc --noEmit` clean · `eslint .` 0 errors (209 pre-existing
warnings, unchanged) · `vitest run` **271 files / 2790 tests, all passing** ·
`check:labels` OK (661) · no `as any` · no markers · no migration.

---

### Task 4.3 — The "Waiting on you" row ✅ SHIPPED 2026-08-12 · SESSION 4 CODE COMPLETE

**What shipped — the five files the plan named, plus the pane-addressing
wiring the plan review added.** One coach-action row on the Overview's
Waiting-on-you card, between the check-in row and the alerts, fired while the
current journey block is inside its **final 7 calendar days**:
*"Build ends Sunday."* + *"Cut is next."* / *"Nothing scheduled after it."*
Check-in-row anatomy with the corrected **`h-8 w-8` thumb** (not the h-9
outlier) and `Flag h-4 w-4` (the pane's journey mark); both strings are full
sentences and therefore 100% sans (the prose rule — the weekday is a word);
**no dismiss affordance, nothing through `evaluateAndSortTriggers`, nothing
on the dashboard feed** (invariant 14 — it clears by the world changing);
`pendingCount` counts it.

- **`deriveBlockEnding`** (`lib/blocks/block-derivations.ts`, pure + tested):
  fires while `daysBetween(today, endsOn) <= 6` for the current block —
  days-remaining, deliberately NOT `weekOfTotal.current === total`, because
  ceil-weeks makes a truncated block's "last week" as short as one day,
  useless for a row whose job is getting the next block scheduled. The next
  block is the following chain entry (never archived — only elapsed blocks
  can be), named even across a post-delete gap.
- **`types/coach-brief.ts`**: `waitingOnYou.blockEnding:
  { blockName, endsOn, nextBlockName | null } | null`.
- **`client-overview-brief-service.ts`**: one more `Promise.all` entry —
  `listBlocks` ∥ `getClientTodayString` (client tz: block dates live on the
  client's calendar, the same anchor as every blocks route) →
  `deriveBlockEnding`, wrapped log-and-null like `getUnreviewedCheckIn` so a
  blocks failure degrades the row, never the Overview. Route unchanged.
- **`Open Journey` lands on the Blocks pane** (plan-review correction): the
  Overview has no router — navigation runs through the page's
  `handleTabChange`, which must also flip its mount-seeded `activeTab` state
  (a bare `router.replace` would change the URL without switching the
  rendered tab). Wired backward-compatibly: `buildClientTabUrl` gains an
  optional `extraParams` (set after the tab; only single-owner params belong
  there — `subtab` through it would reintroduce the cross-tab guard bug),
  the `onTabChange` chain (`page.tsx` → `ClientOverviewTab` →
  `WaitingOnYouSection`) widens to `(tab, extraParams?)`, and the button
  sends `onTabChange("metrics", { journey: "blocks" })` — which
  `metrics-tab-content` reads unconditionally, so the Blocks pane renders on
  landing. Every existing caller passes one arg and is untouched.

**Tests: 271 files / 2804 (271/2790 + 14; arithmetic closes).**
`deriveBlockEnding` 6 — the ±1-day boundary (`endsOn − 7` quiet,
`endsOn − 6` fires, ends-today fires), clears on the next block's first day,
last-block → null next, no-current/empty null, next named across a gap, a
short block firing on day one. `buildClientTabUrl` 2 — extraParams override a
carried `journey`; omitted extraParams byte-identical to the three-arg call.
Section 3 — both copy variants + `Open Journey` →
`("metrics", { journey: "blocks" })`, no dismiss on the row, the count
includes it (existing renders gained the required `blockEnding={null}`).
Brief service 3 — row surfaced with the client-today anchor pinned, null
mid-block, blocks-read failure degrades to null with the brief intact.

**Gates.** `tsc --noEmit` clean · `eslint .` 0 errors (209 pre-existing
warnings, unchanged) · `vitest run` **271 files / 2804 tests, all passing** ·
`check:labels` OK (661) · no `as any` · no markers · no migration.

**Session 4 totals: 3 commits, zero migrations, +40 tests (2764 → 2804), +3
test files (268 → 271: journey service, journey route, journey section; the
block-weight and block-format suites moved, net zero).** The client surfaces
are browser-unverified by design — the owner's smoke checklist is in the
session summary. §2 security/load/perf review delivered with the session
summary (trigger: one new API route; zero new write paths).

---

### Sessions 3 + 4 — owner sign-off ✅ 2026-08-12

The owner ran the Session 4 smoke checklist (seven items, handed over with the
session summary: mid-block section/bar/target lines · no-blocks empty ·
imperial · finished-block change parity unit-matched · archived block absent
from the client list · the coach row's both copy variants, mid-block absence
and no-dismiss · Open Journey → Blocks pane) and reported **all clear**.
Sessions 3 (including the 3.6 and 3.7 follow-ups) and 4 are **COMPLETE** by
owner decision. This closes the browser-verification residuals recorded in
the 3.6-D, 3.7-2, Task 4.1 and Task 4.3 STATUS blocks — those lines stand as
history of what was true at commit time, superseded here.

---

### Task 4b.1 — The unexplained writer, pinned ✅ 2026-08-12 (investigation only, no code)

> **DEV-only.** Every row-level claim below was probed against the linked DEV
> project `aeaphsslctwcmebldrzx`. PROD (`etezzztgafcotyahgijk`) was NOT queried.

**Verdict: `tdee = 3515` on the fixture's `clients` row was written by the
nutrition plan save. There is no sixth writer** — the candidate set in the
session's findings table is closed.

The impossible pair (BMR 3712 beside TDEE 3515) is a **two-step by two known
writers**, not one bad write:

**Step 1 — 10:48:19. The plan save wrote the pair from the PLAN's activity
level.** `services/nutrition-plan-service.ts` reaches the profile through *two*
sites in a single call: `:137-143` (a direct `.update({ tdee })` on `clients`)
and `:148-154` (`recordBodyMetrics`, whose cache write at
`services/body-metrics-service.ts:83-84` sets `clients.bmr` **and**
`clients.tdee`). The second site is not named in the findings table and is the
reason a plan save writes the profile pair twice.

**Step 2 — 10:49:53. A BMR-only write stranded it.** `clients.bmr` became 3712 =
Katch-McArdle(170 kg, 9 % BF) with no accompanying tdee write, leaving tdee at
3515. **Attribution at its true strength: `calculate-bmr`, or a direct DB
write.** The repo contains exactly one code path that writes `{ bmr }` alone
(`app/api/clients/[id]/calculate-bmr/route.ts:78-81`), and the 10:49:53 mutation
carries that path's exact signature — no audit event, no `body_metrics` event,
no override-flag change. But this fixture has been churned by hand throughout
the investigation, and a manual SQL edit has the same signature, so the code
path is not proven beyond the class. The fix is unaffected either way.

**Evidence (probe → fact):**

| Fact | Probe |
|---|---|
| `clients`: bmr **3712**, tdee **3515**, `work_activity_level` **sedentary**, both override flags **false**, `date_of_birth` **NULL**, `updated_at` **10:49:53** | 1 |
| 11 `body_metrics` events with `source='nutrition_plan'` are the **only** events for this client that have ever carried a tdee | 4 |
| The other 13 events (12 `check_in`, 1 `coach_entry`) carry NULL bmr and NULL tdee | 4 |
| Those 11 tdee values span exactly {2220, 3515} = 1850 × {1.2, 1.9} | 4 |
| Open plan version `2bf38907-…`: `work_activity_level` **extremely_active**, bmr 1850, tdee 3515, `updated_at` **10:48:19.002** | 3 |
| Its predecessor version: `work_activity_level` **sedentary**, tdee 2220 | 3 |
| Newest `nutrition_plan` event **10:48:20.94** (tdee 3515); audit `nutrition_plan.create` **10:48:19.51** | 2, 5 |
| No audit event, no `metrics_api` event and no flag change anywhere near 10:49:53 | 4, 5 |

**Corroborations.** The 2220 ↔ 3515 toggling across those 11 events is the owner
flipping the drawer's work-activity dropdown and re-saving during the Session
3.2 smoke — **each save rewrote the client's PROFILE**, which demonstrates the
"activity lives in two places and they disagree" defect live rather than by
inference (`clients.work_activity_level` stayed `sedentary` throughout). Two
events 38 ms apart (10:38:34.425 / .463) with identical values and `source_id`
are a double-submit absorbing into the same open version.

**Seed exoneration.** `scripts/seed-scale-client.ts:248-249` seeds bmr 1850 /
tdee **2700**. Neither number survives on the row, so every value now present is
post-seed mutation — which is why the fixture reseed is deliberately sequenced
*after* this block is committed rather than before it.

**Consequence for 4b.2 (recorded here so the next task inherits it):** the
`recordBodyMetrics` cache write at `body-metrics-service.ts:83-84` is a
back-door writer of the profile pair. Removing `bmr`/`tdee` from that cache
update is what makes "one helper owns the pair" enforceable rather than
aspirational — without it, any caller can still write the pair by passing them
to `recordBodyMetrics`.

---

### `dateOfBirth` mapping fix ✅ SHIPPED 2026-08-12 (own commit, ahead of 4b.2)

`updateClientSchema` accepted `dateOfBirth` (`lib/validations/client.ts:64`) and
`updateClient` never mapped it — a coach PATCHing a birth date got a 200 and no
change. The only writer of the column was the intake sync
(`intake-review-service.ts:138-139`).

**Behaviour change, named deliberately:** a request that silently did nothing now
writes, and age feeds Mifflin-St Jeor, so BMR moves for any client whose birth
date a coach sets. Its own revertible commit rather than a line inside 4b.2,
because 4b.2's recompute trigger names `dateOfBirth` and would otherwise ship a
dead branch. Also the prerequisite for 4b.3's "add a birth date" nudge having
somewhere to save.

**Gates.** `tsc` clean · `eslint` 0 errors (209 warnings) · `vitest run`
**271 files / 2806 tests** (+2; closes from Task 4.3's 2804) · `check:labels` OK.

---

### Task 4b.2 — One owner for `clients.bmr`/`tdee` ✅ SHIPPED 2026-08-12

**Two modules, not one — a blocking constraint found at plan time.**
`scripts/check-service-key-leak.ts:9-11` walks value imports upward from
`services/supabase-admin.ts` and fails on any reachable `"use client"` module,
and 4b.3 needs the calculator in the browser. So `services/client-energy-calc.ts`
is PURE (both formulas, `calculateAge`, a `toActivityLevel` normalizer) and
`services/client-energy-service.ts` owns `recalculateClientEnergy` and imports
`supabaseAdmin`. The service re-exports the calc module's **types only** — a
value re-export recreates the leak edge.

**The helper reads its own row rather than taking one.** Importing
`getClientById` would be a two-node cycle (`client-service` imports this module),
and because `client-service` exports `export const` arrows it fails at runtime as
a **TDZ throw**, not an `undefined`. There is no `import/no-cycle` rule to catch
it. A self-read is also required at the metrics route, which calls the helper
*after* its own write commits.

**Invariants as shipped.** Every UPDATE carries both keys; a flag key appears
only when an override instruction asked for it, so a plain recompute cannot
clobber a concurrent flag. `updated_at` is left to the BEFORE UPDATE trigger. An
override freezes exactly its own half. **A flag set over a NULL value is not a
freeze** and is recomputed, so a stray boolean cannot permanently block
`validateClientForNutrition`. Insufficient data writes nothing and nulls nothing;
an explicit override still lands, carrying the other half. **TDEE derives from
the ROUNDED BMR** — the columns are `NUMERIC(6,1)`, not integers, so an unrounded
value would be silently re-rounded by Postgres and stop matching; it also makes
the pair agree exactly with `calculateTDEE`, which the old raw-BMR multiply never
did.

**Rewired:** `updateClient` (one site covering both the coach PATCH and the
check-in sync), `createClient` (pure calculator **in the INSERT** — atomic, no
failure window), the check-in service (its ×1.2 and its own `clients` write
deleted; it now issues no `clients` write at all), the metrics PUT (both ×1.2
hardcodes and the inline Mifflin gone, empty-update guarded), `calculate-bmr`
(returns both values, killing the literal `"TDEE: undefined cal/day"` toast;
deliberately does **not** clear overrides), the intake sync, and current-dated
metric entries. **Back doors closed:** `nutrition-plan-service` no longer writes
`clients.tdee` (`createNutritionPlan` touches `clients` zero times) and
`recordBodyMetrics` no longer caches `bmr`/`tdee`. `services/bmr-service.ts`
DELETED — grep-verified at execution.

**Found while typing what had been `any`:** the check-in insert wrote a
`submitted_at` column that does not exist on `check_ins` (PostgREST would have
rejected it), and the route's bmr/tdee range checks duplicated the zod schema's.

**`services/client-energy-ownership.test.ts` — the guard, and the carve-out.**
A source scan for a seventh writer. **The invariant is one writer for UPDATES;
`createClient`'s INSERT sets the pair once at row birth through the same pure
calculator and is deliberately outside the scan** — that sentence sits beside the
guard so nobody widens the scan to inserts (breaking the build) or narrows the
invariant (re-opening the hole). Its own self-check caught that the first version
missed a payload built in a variable, which is how the owner writes, so it now
resolves an identifier argument back to its declaration or mutation.

**Gates.** `tsc` clean · `eslint` **0 errors, 207 warnings** (down from 209 — two
`any` annotations replaced with generated types) · `vitest run` **276 files /
2877 tests** (+5 files, +71) · `check:labels` OK 663 · `check:service-key` PASS
(validates the module split) · `check:rls` 41/41 · no migration. The three
pre-existing `intake-review-service.ts` TODOs about `client_intake` type
regeneration are **reported, not deleted** — 4b.6 adds the §13 item 6 standing
rule.

---

### Read-order inversion ✅ SHIPPED 2026-08-12 (Commit 3b, split from 4b.2)

Split on owner direction: "the pair has one owner" and "plans read the profile"
are two behaviour changes, and bundled, a surprising regenerate would have two
candidate causes.

`nutrition-calc-inputs.ts:91-92` resolved BMR as `latestMetrics?.bmr ??
client.bmr`. Every calorie in a generated plan rests on that value, so a
regenerate built the plan from a stale snapshot — 1850 instead of 3712 on the
fixture — contradicting the owner's rule that a regenerate is exactly when a plan
picks up current numbers.

**Original rationale checked before inverting, as required:** the comment cited
"pre-migration clients" whose denormalized cache might not be populated. Giving
the pair an owner removed that reason; no other rationale was recorded.

**Weight keeps the event-first order** — a backdated coach entry is withheld from
the `clients` cache, so the newest event can be the truer measurement. The two
halves now run in opposite directions and the comment says so at length. The
`?? latestMetrics` tail is **retained as a NULL-profile rescue**, pinned by test.

**Interim window, named:** between 4b.2 and this commit the profile was correct
while the calculator still preferred the snapshot — unchanged from prior
behaviour, but a smoke in that gap would read it as a regression.

**Gates.** `vitest run` **276 files / 2879 tests** (+2). One full run showed the
documented flaky set-tracker failure; it passed in isolation and on re-run.

---

### Seeds + fixture repair ✅ 2026-08-12

**Seeds (own commit).** Both seeds invented energy that matched no formula. The
scale fixture hardcoded 1850/2700 — and that 1850 is what 4b.1 traced the
impossible pair to. It carried **no height, gender or activity level at all**, so
nothing could compute it; it now seeds those and derives
Katch-McArdle(83.9 kg, 22 %) × 1.55 = **1784 / 2765**, with the nutrition plan
snapshotting the same pair. `scripts/seed/generate.ts` loses a third inline
Katch-McArdle copy and a **random 1.35–1.75 TDEE multiplier unrelated to the
`work_activity_level` the same row stored**. Determinism note: the RNG
consumption order changed, so a given `--seed` now yields different (still
deterministic) data.

**The reseed was NOT run as instructed, because neither flag does what was
intended.** Without `--full-reset` the `clients` row is upserted
`ignoreDuplicates: true`, so the incoherent pair survives and the reseed fixes
nothing. With `--full-reset` the client row is deleted — and `client_phases`
carries `ON DELETE CASCADE` (`confdeltype = 'c'`, verified), so it would have
**destroyed the 3 Journey blocks built during the Session 3/4 smokes**, which the
seed never recreates.

**Repaired non-destructively through the app's own writer instead**, which also
exercised 4b.2 end-to-end against live data:
`3712 / 3515 → 3712 / 4454` = `round(3712 × 1.2)` — coherent with the row's
stored `sedentary` for the first time, via Katch-McArdle, `activityLevelSource:
"client"`, `missingDateOfBirth: true` (the 4b.3 nudge signal). Blocks, plans and
history all intact.

**Residual, stated rather than implied:** 200 of 208 other active dev clients
still carry arithmetically incoherent pairs, because they were seeded by the old
random-multiplier generator. The seed fix only helps future seeds. They are
scale-benchmark rows, not smoke fixtures; a bulk repair through the helper is
available if wanted.

---

### Tasks 4b.3 + 4b.4 — Activity moves to the profile, the drawer consumes ✅ SHIPPED 2026-08-12

**Owner-caught at smoke:** after 4b.2 the coach could see a coherent pair but the
work-activity dropdown was still in the nutrition drawer and TDEE was not
editable — because those are 4b.3/4b.4 and only 4b.1/4b.2 had been run. Both
shipped in one commit.

**4b.3 — the profile owns activity and the override.**
`clients.work_activity_level` had **no read or write path in the app at all**: it
was absent from the `Client` type, the mapper and `updateClientSchema`. All three
added, and `updateClient` writes it (and recomputes, since activity joined the
energy-input trigger set). The client settings dialog gains the activity select,
a date-of-birth field, and a TDEE row with "Set a custom value" / "Back to auto".
**The live preview runs `computeEnergyPair` in the BROWSER** — the same pure
function the server writes with, so "auto would be 2,144" cannot disagree with
what a save stores. `check:service-key` still passes, which is precisely why
4b.2 split the calculator out of the `supabaseAdmin`-importing module. The
birth-date nudge fires only when age changes the answer (Katch-McArdle has no age
term). The status card's third column becomes the activity label. (A "Custom" chip on
TDEE was specified and built, then **removed on owner request 2026-08-12** — the
override is visible where it is set, and the card is a summary.)

**The intake answer now lands.** `createClient` inserts
`work_activity_level: null` explicitly rather than letting the column DEFAULT
(`'sedentary'`) apply. The default made "never set" indistinguishable from "the
coach chose sedentary", which silently disabled the intake sync's
`work_activity_level == null` guard — a client answering "very active" landed as
sedentary forever. NULL still reads as sedentary in the calculator, so nothing
downstream changes; only the ability to tell unset from chosen.

**`calculate-bmr` DELETED** — route and `hooks/use-client-metrics.ts` with it.
The hook was dead beyond those two functions, which also retires the
`saveOption: "update-only"` mismatch by deleting unreachable code rather than
fixing a bug nothing could reach. The pre-existing TECHNICAL-DEBT entry naming
that hook is marked resolved rather than left stale.

**4b.4 — the drawer is a pure consumer.** The dropdown is gone; in its place a
read-only **TDEE number and nothing else**. Two additions were built here and
**removed on owner request 2026-08-12**, both wrong rather than merely noisy:
an activity label ("From the client profile — Extremely active") which is a lie
whenever the coach has set a custom TDEE, since the number then derives from
their override and not the ladder; and a drift line ("This plan was built at N")
which rendered on clients with no plan at all. The route/hook plumbing added to
feed the drift line was reverted with it, and `lib/activity-labels.ts` deleted —
it existed only for that label. **Standing lesson: this form has the profile's
number and nothing else; a line that needs plan state or override state does not
belong in it.** The orchestrator's **four** reads of
`body.workActivityLevel` are gone — activity resolves once into `calcInputs` from
the CLIENT, so preview and save share one source.
`nutritionPlanSchema.workActivityLevel` is accepted-but-ignored rather than
removed, so an in-flight request from an older build still validates.
`ACTIVITY_LABELS` extracted to `lib/activity-labels.ts` (the wording had only
ever existed inside the deleted dropdown).

### Task 4b.5 — One read path ✅ VERIFIED 2026-08-12 (no code change needed)

The behavioural half shipped as Commit 3b. This is the enumeration the task
demanded rather than assumed: every reader of the profile pair is
`nutrition-calc-inputs.ts:121-122` (profile-first, NULL rescue),
`client-service.ts:321-322` (the helper's returned pair), 
`client-check-in-service.ts:191-192`, `client-settings-dialog.tsx:205`,
`drawer-footer.tsx:72`, `client-status-card.tsx:278/283` and
`lib/validations/nutrition.ts:129`. All read `client.*`. `latestMetrics` survives
only as the NULL rescue. Overview, drawer and `resolveNutritionCalcInputs` agree
by construction.

### Task 4b.6 — Docs reconciliation ✅ SHIPPED 2026-08-12 · SESSION 4B COMPLETE

- **CONVENTIONS §8** gains "Client energy (BMR/TDEE)": the pair is never written
  separately, formulas live once and must not reach `supabaseAdmin`, an override
  freezes its own half, activity is a client fact nothing under
  `components/clients/nutrition/**` writes, plans are never mutated by a weight
  change, and `work_activity_level` is never seeded from the column DEFAULT.
- **CONVENTIONS §9** corrected: it claimed "exactly two routes deviate". The real
  story is that `lib/rate-limit.ts` does not namespace its Redis key by tier, so
  every generic tier shares one counter per IP — which makes the 21 mis-tiered
  `/api/clients/**` routes a symptom, and retiering them unpredictable. **Fix the
  key first.**
- **CONVENTIONS §13 item 6** gains the standing rule: the marker grep covers
  markers *introduced* by the change; pre-existing ones are reported in STATUS and
  left alone.
- **ARCHITECTURE** builder-flows line rewritten — the nutrition provider no longer
  owns activity or the energy pair.
- **TECHNICAL-DEBT** records the residuals (old versions keep garbage-in
  snapshots, the age-30 default where the nudge can't reach, 200/208 seeded dev
  clients still incoherent) and the P1 rate-limit key defect.

**Session 4B totals: 8 commits, ZERO migrations, +79 tests (2806 → 2875).**
Browser-unverified; the smoke checklist is in the session summary.


---

### 4B follow-ups from the owner's smoke ✅ 2026-08-12

**The calculator ignored a custom TDEE — the biggest miss of the session.**
`generateNutritionPlan` opened with `calculateTDEE(input.bmr,
input.workActivityLevel)`, recomputing TDEE unconditionally, and
`NutritionCalculationInput` had no `tdee` field at all — so the profile's value
(which since 4b.2 already reflects any override) could not reach it even though
`calcInputs` was carrying it. A coach who set 4,000 got **3,395** back — literally
`1787 x 1.9`, the activity ladder's answer for a number they had explicitly
overridden — and every macro was solved against it. Now `input.tdee ??
calculateTDEE(...)`: the profile owns TDEE and the calculator consumes it, with
the ladder as the fallback for a client whose pair was never written.

**Maintenance was the same bug, not a second one.** Goal 82 kg against a current
82 kg is a zero change, so the baseline is the TDEE itself — it was simply the
*wrong* TDEE. Pinned by test. Normalized `-0` out of `requiredDailyDeficit` while
there: a zero change produced negative zero, which survives arithmetic and
renders as "-0" through `toLocaleString`.

**"Not set" removed from the activity select (owner call).** It could only ever
mean sedentary — the column default, the calculator's NULL fallback and the
seeded display are all sedentary — so it was an option worded to look like it
meant something else, and picking it just restored the previous value. The select
now defaults to Sedentary and always sends a concrete level; the status card
shows the effective level rather than "Not set". The explicit NULL at
`createClient` stays, because that is what still lets an intake answer land for a
client whose settings dialog was never opened.


### The calculator takes TDEE, full stop ✅ 2026-08-12 (owner-directed simplification)

Owner's question after the override fix: *"should the nutrition calculator
calculate off the TDEE rather than the formula? Surely that's simpler than
BMR x activity for auto and read TDEE for custom?"* — correct, and it exposed a
SECOND live instance of the same bug.

`input.tdee ?? calculateTDEE(...)` was two ways to obtain one number. Removed:
`tdee` is now a **required** field on `NutritionCalculationInput`, used verbatim,
and **`workActivityLevel` is gone from the calculator entirely** (zero references
in `nutrition-service.ts`). Activity feeds exactly one thing — `computeEnergyPair`,
which produces the profile pair — and the calculator reads the result.

**The second instance:** `nutrition-plan-orchestrator.ts`'s CUSTOM-MACROS branch
also did `calculateTDEE(bmr, activity)`, so a custom-macros plan discarded a
coach's custom TDEE exactly like the calculated branch had. Fixed by the same
change.

`validateClientForNutrition` now actually checks `tdee` — it accepted the param
and ignored it, which was survivable while the calculator re-derived TDEE and is
not now. A row with a BMR but no TDEE can only predate 4B (the old bmr-only
writer); it reads as "energy not computed yet" and any weight edit repairs it.

`calculateTDEE` was left with zero production callers and is **deleted**, with the
two imports it left dead.


### An impossible BMR/TDEE pair is now refused ✅ 2026-08-12 (owner-caught)

A coach could store TDEE 1,500 against BMR 1,787. Nothing anywhere compared the
two: `updateClientMetricsSchema` checked only absolute bounds (1000-8000), the
route turned the value into a `set` instruction, and the writer froze it
verbatim while BMR kept auto-recomputing from weight and body fat. Two numbers,
never compared — the same class of defect as the 3712/3515 pair that opened this
session, arrived at from the other direction.

`recalculateClientEnergy` now REFUSES an explicit override that would make TDEE
lower than BMR (and the mirror case, a custom BMR above the TDEE), returning
`status: "rejected_invalid_override"` with a coach-facing sentence and writing
nothing. The metrics route surfaces it as a 400; the settings dialog shows it
inline as the coach types and blocks the save. **Rejected rather than clamped:**
a coach who typed 1,500 meant 1,500, and silently storing something else is how
these numbers stopped being explicable in the first place.

---

### Task 0b.1 — The Overview reads the resolver, not the mirror ✅ SHIPPED 2026-08-13

**Inherited, not re-opened.** `notes` stays uncarried (Session 0). The
map-or-delete question was settled by Session 4 Task 4.2 (owner, 2026-08-12):
**delete** the three dead `?? client.goalDeadline` fallbacks and the dead
`Client.goalDeadline` field. This task executed that decision; it did not re-take it.

**What shipped.** `hooks/use-client-goals.ts` (key builder + area invalidator +
`useClientGoals`, CONVENTIONS §7) feeds ONE new SWR read of
`GET /api/clients/[id]/goals` in `client-overview-tab.tsx`, which resolves it
through `resolveEffectiveGoal` and passes the result to `ClientStatusCard` as a
`goal` prop. The card's three mirror reads are gone; start/current stay on the
`clients` cache, because those are measurements `recordBodyMetrics` keeps fresh
and only the two TARGETS moved. The hook returns the RAW `ClientGoal`, not a
resolved one — `resolveEffectiveGoal` coalesces `goalStartDate` to today, which
is right for "what drives this client now" and wrong for 0b.4's form, which would
then write today into a field the coach never set.

**`today` is the CLIENT's day**, `getTodayDateStringInTimezone(client.timezone)` —
the same anchor and the same reasoning as `comparison-service.ts`, which feeds
this identical resolver. The card consumes only the two targets, so it is
currently unobservable; seeding the device day because it "doesn't matter yet"
would hand the next consumer the wrong anchor. Rejected at plan review.

**The mirror fallback SURVIVES for weight and body fat** (`?? client.goalWeight`),
so this is a source change, not a behaviour change: a pre-`client_goals` client
still renders, and the card does not flash "Not recorded" while the fetch is in
flight. Only the deadline leg was deleted.

#### `toClientGoalInput` — one composer, four callers

Four call sites held **byte-identical** goal-input literals. Three were being
edited anyway to delete the deadline leg, so the literal moved into
`lib/goals/resolve-effective-goal.ts` and those three plus the new Overview one
call it. `today` deliberately stays at each call site — the anchor differs per
surface. Approved at plan review as §3's "extract what you are about to
duplicate", flagged as beyond the literal task.

**Boundary for 0b.3, so it inherits it rather than discovering it:**
`use-merged-metrics.ts` is deliberately NOT converted. It does not build the same
literal — it hardcodes `deadline: null, startDate: null`, and repointing it is a
behaviour fix (the Metrics page starts seeing the deadline), not a substitution.
**That is now 0b.3's whole remaining scope: the second half of its brief,
`use-nutrition-builder.ts`'s `getProjectedDate` mirror read, was already deleted
by Session 1 Task 1.2 (`67bfbbe`) — grep-confirmed at execution, zero matches.**
The plan's "whichever session ran first did it; confirm rather than duplicate"
is hereby confirmed. Do not go looking for that function.

#### The fixture sweep — the cast is why tsc could not help

`Client` fixtures are cast (`as unknown as Client`) or untyped, so deleting a
field is **invisible to the compiler**. Every `goalDeadline`/`goal_deadline`
fixture in the repo was enumerated and classified rather than extrapolated from
the first one found:

- **Client shape (3).** `nutrition-calc-inputs.test.ts`'s `CLIENT` was the only
  fixture in the repo whose assertion **exercised the dead fallback** (`:52`,
  with `getCurrentGoals` mocked to null) — it now sources the deadline from
  `client_goals`, where it always came from live. `nutrition-plan-orchestrator`'s
  and `notifications/route`'s were inert (`null` / `undefined`) but named a field
  that no longer exists; both keys deleted.
- **Goals shape (5 files), unaffected**: every hit is a `ClientGoal` or a
  `getCurrentGoals` mock. Notably `comparison-service.test.ts`'s `mockClient`
  carries no deadline at all, and neither does `nutrition/route.test.ts`'s — so
  the fallback was provably inert in both files, and its deletion is a no-op there.
- **Other shapes (6 files), unaffected**: `ClientRow` (snake_case — the COLUMN
  stays), `ClientIntake`, `NutritionPlanParams`, `NutritionCalculationInput`,
  plan snapshots. `createMockClient` is properly typed and never set the field.

**Why the sweep was safe to be wrong about:** the change REMOVES a fallback, so
anything depending on it fails red at the gate rather than passing wrongly. The
one genuine silent risk is a test that keeps passing under a now-dishonest title
— `nutrition-calc-inputs.test.ts`'s *"lets a live client goal win over the
denormalized client fields"* was exactly that, since the deadline half no longer
has two sides. Split into a weight precedence test and a "deadline and start date
come from client_goals" test.

**One mock contract broken and fixed** (CONVENTIONS §3):
`comparison-service.test.ts` mocked the resolver module returning a hand-listed
export set, so the new export arrived as a runtime *"No `toClientGoalInput` export
is defined on the mock"* with nothing for tsc to catch. It now spreads `...actual`
and overrides only the spy, so the next export cannot break it the same way.

#### Threading, and what is still unconsumed

`ClientStatusCard` gains `onClientUpdated?`, wired by the tab to a callback that
invalidates the goals area AND revalidates the client record (a goal write
dual-writes the mirror, so both reads must refresh). It is declared but not
destructured until Task 0b.4 mounts the editor — inside the same session, so no
editor-less slot ships.

#### Tests — mutation-proven, both directions

**275 files / 2892 (2883 + 9; arithmetic closes).** Card 3 — a goal the mirror has
no copy of renders; a **diverged** mirror (99 kg / 30 %) cannot win over the
resolved 82 / 18; maintenance reads "Not recorded" whatever the mirror holds.
Composer 4 — live goal wins; mirror backstops a no-row client; a deadline
smuggled in on the client object is refused; and the documented consequence that a
NULL `goal_weight` still falls through to the mirror. Calc-inputs 2 — the deleted
fallback pinned, plus the title split.

Mutation 1 (card reads `client.goalWeight` again) killed **8** tests including all
3 new ones. Mutation 2 (re-add the deadline mirror leg to the composer) killed
both deletion pins. Files were backed up with `cp` to the scratchpad and restored
from there — **never `git stash` or `git checkout --`**, both of which destroy
uncommitted work and this repo's stash stack holds two abandoned WIPs. Restoration
verified byte-identical by `shasum` + `diff`, not by eye.

#### Gates

`tsc --noEmit` clean · `eslint .` **0 errors, 209 warnings** (unchanged from the
measured baseline; none in changed files) · `vitest run` **275 files / 2892 tests,
all passing** (clean-tree baseline measured first: 275 / 2883) · `check:labels` OK
662 · no `as any` in any changed code file · no markers introduced · **no
migration**, so no `check:rls`, no `db push`, no `gen types`.

**Docs corrected in the same commit (§3 class b):** `ARCHITECTURE.md`'s
resolver-caller list (four → five, with the composer and the never-map-the-deadline
rule recorded), the "Read switch fallback" section, and the Overview's SWR table
(four → five reads).

**UI is browser-unverified — the owner runs the smoke.** The card's goal cells,
chips and layout should be unchanged; what changed is where the two numbers come
from. Smoke: open a client's Overview and confirm goal weight / goal body fat and
their chips still render · set a goal in the nutrition drawer's editor, return to
Overview, confirm it shows the new value (the tab unmounts, so the read
revalidates on return) · a client with no goal reads "Not recorded" with no chip.

---

### Task 0b.2 — One writer for the mirror, and failures that surface ✅ SHIPPED 2026-08-13

**Owner decision 2026-08-13: option (A)** — the four direct `clients.*` goal writes AND the four
caller-level swallows, in one commit. Shipping the deletions alone was rejected because it
*inverts* the failure mode: today a failed goal write leaves the mirror holding the NEW value and
the `?? client.goalWeight` reads pick it up; deletions-only would leave it holding the OLD value,
so a lost edit becomes a confident stale render behind a 200. Recoverable → silently wrong.

**What shipped.** Goal columns removed from `createClient`'s INSERT and `updateClient`'s
`updateData`; from the metrics PUT's `updates`; and from the intake sync's `updates` (into a
separate `goalUpdates` object that never reaches the `clients` write). All four
`try { await updateGoals(...) } catch { console.error }` wrappers deleted.

**`5d5fd99` was NOT re-landed — its premise is dead.** It is an ancestor of HEAD but was undone by
`d58120c`, and its reasoning was *"the RPC already writes `clients.*` inside the transaction"* —
migration 139's `update_client_goals_atomic`, which exists in neither `supabase/migrations/` nor
`types/database.ts` (grep-verified). Only its **swallow-removal half** survives, being independent
of the RPC. The owner decision it recorded carries over unchanged: a failed goal write on
`createClient` leaves the client with **no goal in either store** — consistent and re-editable —
and the coach sees a real error.

**Two things the plan did not name, found at execution:**

1. **`syncedFields` spans both objects now.** It is built from `Object.keys(updates)` and is
   `syncMetricsToClient`'s RETURN value — the "Synced: goal weight, goal deadline…" list the coach
   reads. Splitting the goals out without widening it would have silently stopped reporting three
   fields the sync still writes. Pinned by its own test and mutation-proven.
2. **`createClient` gained the response overlay too.** `5d5fd99` added it to `updateClient` only.
   With the goal columns out of the INSERT, `mapClientRow` returns a client with no goal, so the
   201 reported no goal on a client that has one. No in-repo consumer reads it (`add-client-dialog`
   types `client` as `unknown` and uses only `inviteSent`), but a knowingly-false response field is
   the shape this session keeps removing. Both paths now echo what they wrote.

#### What this does NOT buy

`updateGoals` is still three autocommitted round trips with no transaction, and its **inner**
mirror UPDATE is still logged-and-swallowed (`client-goals-service.ts:153-155`): a `client_goals`
row can commit while the mirror write fails and the request still returns 200. This makes
divergence **single-sourced and loud at the caller boundary**, not impossible. The atomicity RPC is
the real fix (§7) and needs a migration, which Session 0b does not have.

#### Reachability, so the risk is not overstated

`createClient` (via `add-client-manual-form.tsx`) and the intake sync are **live**.
`updateClient`'s goal branch and the metrics PUT's are **API-only** — both schemas still accept the
fields, but no browser caller sends them since Session 4B deleted `hooks/use-client-metrics.ts`.
API-only is not dead: RN is the real client.

#### Tests

**275 files / 2903 (2892 + 11; arithmetic closes).** Per site, both directions: the `clients`
payload carries no goal column, and a rejecting `updateGoals` propagates (`createClient` rejects,
`updateClient` rejects, the intake sync rejects, the metrics PUT 500s). Plus the two overlay pins
and the `syncedFields` pin.

- **Mutation A** (restore all four swallows) killed the four propagation pins.
- **Mutation B** (restore the four direct writes) killed the four payload pins.
- **Mutation C** (`syncedFields` back to `updates` only) killed the reporting pin.
- Backed up with `cp` to the scratchpad, restored from there, verified byte-identical by `shasum`.
  Never `git stash` / `git checkout --`.

**One existing test moved rather than being deleted.** `client-service.test.ts`'s *"stores the
payload verbatim — it is already canonical kg/cm"* asserted `insertCall.goal_weight`. Its intent is
no-unit-conversion, so the assertion moved to the `updateGoals` payload — the writer the value now
actually reaches. **Neither existing "does not fail if dual-write throws" test pinned the goal
swallow** (both mock `recordBodyMetrics`, whose swallow is deliberately KEPT — a failed metrics
event must not fail client creation). That matches `5d5fd99`'s note that the goal swallow shipped
untested for six weeks.

#### §2 security / load / performance review

Triggered by "a change to how much/how often an existing write path writes". No new route, no
migration, no auth or ownership change — every touched path keeps its existing chain. **Round
trips go DOWN, not up:** a goal-only metrics PUT now leaves `updates` empty and skips the `clients`
UPDATE entirely (`Object.keys(updates).length > 0` guard), and a goal-only intake sync skips it via
`> 1`; the goal write was already happening in both cases. Worst-case row count is unchanged (one
client row, one `client_goals` row). No new index needed. **Consistency (§2 items 12-13):** this
change IS that item — the log-and-return-success paths are gone at the caller boundary, and what
remains inconsistent is stated above rather than implied. Not measured under load; nothing here
changes concurrency behaviour.

#### Gates

`tsc --noEmit` clean · `eslint .` **0 errors, 209 warnings** (unchanged) · `vitest run` **275 files
/ 2903 tests, all passing** · `check:labels` OK 662 · no `as any` in changed non-test code · **no
migration**. Three pre-existing `client_intake`-typing TODOs in `intake-review-service.ts`
(`:23`, `:60`, `:80`) are **reported, not deleted** — outside every hunk of this commit (§13 item 6),
the same call Session 4B made.

**UI unverified — owner smoke:** add a client with a goal weight and confirm the Overview shows it
(both stores agree) · run "Sync metrics to profile" on an intake carrying a goal/deadline and
confirm the goal lands and the confirmation still names the goal fields it synced.

---

### Task 0b.3 — The last divergent resolver shape ✅ SHIPPED 2026-08-13

One file. `use-merged-metrics.ts` now reads through `useClientGoals` and composes the resolver
input with `toClientGoalInput` instead of an inline SWR key, a private narrowed `GoalsResponse`
type, and a hand-built literal hardcoding `deadline: null, startDate: null` *after* fetching the
full goal.

**Behaviour change: none, and that is measured rather than asserted.** `effectiveGoal` was read at
exactly four places in the file and all four are `goalWeightKg` or `goalBodyFatPercentage` —
**`deadline` and `startDate` were never read**. So the hardcoded nulls were dishonest but inert,
and supplying the real values moves no surface. Two deltas that are real but not visible: the SWR
key is now the shared one (same string, so the Overview and Metrics tab share one cache entry
rather than two identical ones), and the shared options raise `errorRetryCount` 1 → 3 with a
1000ms interval (§7 conformance).

**`today` was deliberately NOT moved to the client's zone here.** The same variable anchors
`deriveHeroStats` and `deriveWeekComparison` in the loop below, so changing it is a different
change with a different blast radius. The resolver's only use of it is the `startDate` fallback,
which nothing reads.

**No new test, and that is the honest answer rather than a gap.** Nothing observable changed, so a
test could only assert an unread field. The composition this file now uses is already pinned by the
four `toClientGoalInput` cases in `lib/goals/resolve-effective-goal.test.ts` (0b.1), including the
mirror fallback and the never-read-a-mirror-deadline rule. The full suite passing unchanged **is**
the evidence for "inert".

**The other half of this task was already done.** `use-nutrition-builder.ts`'s `getProjectedDate`
— which computed a projected goal date off the `clients` mirror — was deleted by Session 1 Task 1.2
(`67bfbbe`). Grep-confirmed at execution: zero matches repo-wide, and no `client.goal*` read remains
in that hook. The plan's "whichever session ran first did it; confirm rather than duplicate" is
confirmed. **Do not go looking for that function.**

**Invariant 16 is now satisfied on the read side:** every coach-side goal read resolves through
`resolveEffectiveGoal`, and all five callers compose their input the same way (the one browser
caller that did not is this one).

#### Gates

`tsc --noEmit` clean · `eslint .` **0 errors, 209 warnings** (unchanged) · `vitest run` **275 files
/ 2903 tests, all passing** (unchanged from 0b.2 — no tests added or removed) · `check:labels` OK
662 · no `as any` · no markers · no migration.

**UI unverified — owner smoke:** open a client's Journey → Metrics and confirm the weight and body-fat
cards still show their goal and "to go" figures unchanged.

---

### Task 0b.4 — A goal editor with its own home ✅ SHIPPED 2026-08-13

**The plan doc's precedent for this task does not exist** (§3 class **b**, stale).
`components/clients/overview/client-settings-dialog.tsx` — the "established Overview overlay
precedent" 0b.4 was told to match — was DELETED by Session 4B, which replaced modal editing with
inline editing. Owner decision 2026-08-13: **inline (i)**. A pencil-opens-a-dialog beside a
pencil-edits-in-place on the same card would be incoherent. The grammar matched instead is
`use-client-profile-edit.ts` + `inline-edit-fields.tsx`.

**Owner decision, same date: both dates are REQUIRED fields, not optional extras.** The deadline is
what turns a goal weight into a daily deficit at all (with none the calculator returns
maintenance), and the start date decides whether that deficit is spread from today or a future
date. `goalStartDate`'s only writer in the entire app was `client-goal-editor.tsx:175`, which 0b.5
deletes — omitting it here would have left the calculator reading a field nothing could write, the
exact `work_activity_level` state 4B spent a session unpicking.

**Where they went: a FOURTH band on the status card**, in the same 3-column shape as the three
above it (`Goal start` · `Deadline` · empty). The third column is deliberately blank — a derived
"time left" readout would be a new invented stat. The two existing goal cells (weight, body fat)
become inputs in edit mode using the same hand-rolled cell the TDEE column already uses.
`InlineDarkInput` gained an optional `type` prop (default `"number"`), mirroring the one
`InlineTextInput` already carries.

#### Three things found at execution that the plan did not have

1. **`updateGoals` supersedes on EVERY call, so the save needs change detection** (invariant 7).
   Calling it unconditionally would mint a new `client_goals` version *and an audit event* every
   time a coach edited a phone number. Each goal field is compared against the value it was SEEDED
   from and only changed keys are sent; if none changed the PUT is not issued at all. This is the
   most load-bearing line in the task and it is mutation-proven.
2. **`EffectiveGoal.startDate` cannot render.** It coalesces to today, so displaying it would label
   every client with no start date as starting today. The card takes the STORED value as its own
   `goalStartDate` prop, documented at the prop. `MetricCell` gained an `emptyLabel` so a date the
   coach never set reads **"Not set"** rather than "Not recorded" (right for a measurement, wrong
   for a target).
3. **0b.1's `onClientUpdated` prop is DELETED, not consumed.** It was added as the editor's
   revalidation slot — but under inline editing the card never writes anything; the rail's Save
   does, through the hook's `onSaved`. Leaving a zero-consumer prop behind would be the exact shape
   this session keeps removing. The tab wires `handleSaved` (goals-area invalidate + client
   revalidate) into the hook instead.

#### The two riders

**Cross-field refinement shipped in BOTH schemas.** `updateGoalsSchema` is the load-bearing copy —
it binds every writer including React Native; the form schema mirrors it so the coach is told
inline rather than by a 400. **Its hole is real and is pinned by a test rather than described:** a
zod refine only sees the payload, so a partial PUT carrying just `goalStartDate` against a stored
earlier `goalDeadline` passes and lands an invalid pair. **The right reason it is unbuilt: the
complete check belongs inside `updateGoals` after its merge — the one place both final values are
known — and this session has no other reason to touch that merge.** NOT "the browser form always
sends both", which says nothing about RN, whose contract this schema is.

**The fourth sequential write is named** (§2 item 13). `useClientProfileEdit` now issues profile
PATCH → metrics PUT → check-in-config PATCH → **goals PUT**, none of them transactional. A failure
after the first can leave client details committed and the goal not, and since 0b.2 that failure is
loud rather than swallowed — so the toast reads **"Partly saved · The client details were saved,
but the rest was not: …"** instead of a bare "Save failed" that tells the coach to redo an edit
already stored. This widens an existing three-write window rather than creating one.

**A goal weight can be changed but never removed** — `updateGoalsSchema` has it `.optional()` and
NOT `.nullable()`, so no payload clears it. Emptying the box is refused with a plain sentence
rather than silently doing nothing.

#### Tests

**275 files / 2912 (2903 + 9; arithmetic closes).** Editor 6, against the REAL hook driving the
REAL cards: nothing-changed issues no goals PUT · only the changed field is sent · an emptied
deadline sends explicit null · a start date after the deadline blocks the submit so **nothing at
all** is written, not even the profile PATCH · an imperial coach's untouched goal weight is not
rewritten · an edited one converts back to kg. Schema 3, including the partial-update hole.

- **Mutation 1** (unconditional goals PUT) killed the invariant-7 pin and the imperial no-op.
- **Mutation 2** (`canonical` instead of `commit`) killed four pins.
- **Mutation 3** (drop the form refine) killed the refusal pin.
- Backed up with `cp`, restored, `shasum`-verified. Never `git stash` / `git checkout --`.

#### Gates

`tsc --noEmit` clean · `eslint .` **0 errors, 209 warnings** (unchanged) · `vitest run` **275 files
/ 2912 tests** · `check:labels` OK 662 · no `as any` · no markers · no migration. **One
intermittent failure appeared in a single full run and did not reproduce on two re-runs** — the
documented flaky-full-run pattern; it is recorded rather than silently re-run away.

**UI unverified.** Smoke ships with 0b.5.

---

### Task 0b.5 — The drawer editor retired, and the silence fixed ✅ SHIPPED 2026-08-13

**Shipped immediately after 0b.4, as a hard requirement rather than a preference.**
`client-goal-editor.tsx:175` was the app's ONLY writer of `goalStartDate`, and after this deletion
the Overview editor is the sole writer of both the deadline and the start date. Between the two
tasks there would be no way to set either date at all — which is why they are one session and were
committed back to back with nothing in between.

**What shipped.** `ClientGoalEditor` in the nutrition drawer is replaced by a read-only
`GoalSummary` — `82.0 kg by 1 Dec`, **formatted** (the old summary printed the raw ISO string) —
reading through the same `useClientGoals` hook the Overview uses, so both surfaces render one goal
from one SWR cache entry rather than two fetches that can disagree.
`components/clients/client-goal-editor.tsx` is **DELETED**, grep-verified at execution rather than
trusted from the plan's file list; the one stale reference left behind was a comment in
`lib/validations/client-goals.ts` naming it as the converter, rewritten to name the new one.

**No link to the Overview, deliberately — and the plan asked for one.** The client page seeds its
active tab from `?tab=` as React state at MOUNT, so an in-app `<Link>` would change the URL without
switching tabs (the bug `page.tsx` documents), and a plain `<a>` would full-reload — **discarding
whatever unsaved plan the coach has open in that very drawer**. Threading a tab callback down four
components to avoid that is the prop-drilling §4 warns about. A sentence naming the destination
costs one click and risks nothing.

**`refetchNutrition` was dropped with the editor**, not re-wired: it existed because editing the
goal here invalidated the drawer's own calorie preview. Nothing in the drawer writes the goal any
more.

#### The silence

`nutrition-targets-block.tsx` suppresses the deficit span at `requiredDailyDeficit !== 0` and the
rate span at `weeklyWeightChangeKg !== 0`. With no goal the calculator returns exactly 0 for both,
so a coach saw a bare `TDEE 2,600` with nothing explaining it — and the only thing on the whole
surface that said a goal was missing was the editor this task removes. The numbers were always
correct; they were silent about why.

**Two sentences, not one, because the two causes need different actions.** A client with no target
gets *"No goal weight and deadline are set, so these targets hold at maintenance. Set them on the
client's Overview to work to a deficit."* A client already ON their goal gets *"The goal weight
matches the client's current weight…"* — telling that coach to go set a goal would be wrong. The
block takes a `hasGoalTarget` prop (goal weight AND deadline, the pair the calculator needs) to
tell them apart. Full sentences, so 100% sans including the numerals (prose rule).

#### Tests

**275 files / 2915 (2912 + 3; arithmetic closes).** The missing-goal sentence, the already-on-goal
sentence, and silence when the plan is genuinely working to a deficit. Mutation-proven: gating the
block off kills both maintenance pins and leaves the deficit case passing.

`check:labels` scanned **661** files, down one — the deleted editor.

#### Gates

`tsc --noEmit` clean · `eslint .` **0 errors, 209 warnings** (unchanged) · `vitest run` **275 files
/ 2915 tests, all passing** · `check:labels` OK 661 · no `as any` · no markers · no migration.

#### Owner smoke — 0b.4 + 0b.5 together (UI unverified)

1. Overview → pencil on the CLIENT rail → goal weight, goal body fat, **Goal start** and
   **Deadline** are all editable in place; Save; the card shows the new values.
2. Edit ONLY the phone number and save → the goal must NOT gain a new version (check
   `client_goals` row count is unchanged — this is the invariant-7 pin).
3. Set a start date AFTER the deadline → the save is refused inline and **nothing** is written.
4. Switch the coach to imperial, reopen the editor, save with no edit → stored kilograms
   **byte-identical**.
5. Open the nutrition drawer → the Goal line shows the same value, read-only, with the deadline
   formatted (not an ISO string).
6. Open the drawer for a client with **no** goal → it says targets hold at maintenance and where to
   set one, instead of a bare TDEE.

---

### Task 0b.6 — Goal history, via a sibling route ✅ SHIPPED 2026-08-13 · SESSION 0b COMPLETE

**Owner decision 2026-08-13: yes, read-only — and a SIBLING route, with the `?history=true` branch
deleted.** The doc's landmine had got worse than it knew: the branch switched `data` between
`ClientGoal | null` and `{ current, history }`, and there are now **three** typed readers, not two
— `hooks/use-client-goals.ts` (shipped in 0b.1), the Metrics page, and the drawer editor 0b.5
deleted. A blind flip would have broken the Overview too.

**What shipped.** `GET /api/clients/[id]/goals/history` — `coachApiRateLimit` →
`requireCoachOwnsClient` → service → `no-store`. Additive; it breaks no reader, and the flat
`data: ClientGoal[]` shape cannot switch. The `?history=true` branch is **deleted** rather than left
unused: a live shape-switching branch invites exactly the blind flip this design avoids.

**`getGoalsHistory` was MODIFIED, not orphaned.** Deleting the branch removed its only production
caller, and it could not have served the new route as it stood — it had neither defect fix. It now
takes `{ limit }` and filters `superseded_at IS NOT NULL`, and the route calls it. No zero-caller
export is left behind, which is the rule this session applied to `updateClientBMR`,
`getProjectedDate` and `client-settings-dialog`.

**Both defects are closed by construction rather than patched:**

- **The current goal came back twice** — once as the live goal, once as `history[0]` — because
  there was no `superseded_at` filter. History is now superseded-only; the live goal is rendered
  above the list from its own read.
- **No limit at all**, so a heavily-edited client returned every version ever written. Bounded by
  `GOAL_HISTORY_LIMIT` in `lib/constants.ts` (§3 — no magic numbers), overridable per call.

**UI: a lazily-fetched popover.** A muted "Goal history" text-button joins "Open Metrics" in the
status-card footer (only the primary action keeps the teal), opening the design system's 320px
Popover. `useClientGoalHistory(clientId, enabled)` passes a `null` SWR key until the popover opens,
so the Overview does not pay for a fifth read on every load. Its key sits under the same prefix as
the current-goal read, so `useInvalidateClientGoals` already covers both. Rows are standalone data
(mono numerals); "This goal has not been changed yet." is word-only and stays sans.
`supersededAt` is **guarded, not asserted** — the route returns superseded rows only, but a
non-null assertion is a promise the type system cannot keep if that filter is ever loosened.

#### Tests

**276 files / 2922 (2915 + 7, +1 file; arithmetic closes).** New route 5 — flat shape and not the
old `{ current, history }` · `no-store` · a foreign client 404s **before** any read · rate limit
before authorization · a generic 500 that does not leak the raw error. Service 2 — the
superseded filter and the bound (default and override). The goals route's `?history=true` test is
**rewritten rather than deleted**: it now pins that the query param is ignored and the flat shape
survives, so a future re-add fails.

Mutation-proven: dropping the `superseded_at` filter kills the duplicate pin; dropping the limit
kills the bound pin.

#### §2 security / load / performance review

Trigger: a new API route. **Auth chain complete and in order** — `coachApiRateLimit` first,
`requireCoachOwnsClient` before any read (pinned by test, including that the service is never
called on a rejection). No CSRF needed: GET only, no mutation. No new write path, no migration,
no RLS change (`check:rls` 41/41 — the table and its policies are untouched). **Bounded by
construction**: one indexed read on `(client_id, effective_from DESC)` — the existing
`idx_client_goals_client_effective` — capped at 20 rows, so the payload cannot grow with a client's
edit history. Constant round trips (one). Not measured under load; nothing here changes concurrency.

#### Gates

`tsc --noEmit` clean · `eslint .` **0 errors, 209 warnings** (unchanged) · `vitest run` **276 files
/ 2922 tests, all passing** · `check:labels` OK 664 · `check:rls` 41/41 · no `as any` · no markers ·
**no migration**.

**UI unverified — owner smoke:** open Goal history on a client whose goal has been edited and
confirm the current goal appears **once** (on the card, not in the list) · a client with an
unedited goal reads "This goal has not been changed yet." · the list is not fetched until the
popover opens.

---

## SESSION 0b — COMPLETE 2026-08-13

Six tasks, six commits, **zero migrations**, `af71e09` → `0b.6`. Test count 2883 → 2922 (+39).

**Invariant 16 is satisfied.** One writer: `updateGoals`, with the four direct `clients.*` goal
writes and their four swallows gone. One read path: every coach surface resolves through
`resolveEffectiveGoal`, and all five callers compose their input through one shared
`toClientGoalInput`. One editor: the Overview status card, inline.

**What this session deliberately did NOT close, so the next one inherits it rather than rediscovers
it:**

- **`updateGoals` is still not atomic.** Three autocommitted round trips; the inner mirror UPDATE
  is still logged-and-swallowed. Divergence is single-sourced and loud at the caller boundary, not
  impossible. The RPC is the fix and needs a migration (§7).
- **The `goalStartDate <= goalDeadline` refine cannot see a partial update.** The complete check
  belongs inside `updateGoals` after its merge. Real for React Native, whose contract that schema
  is.
- **The `clients.*` goal mirror survives**, now with one writer. Full removal is its own workstream,
  costed in §7 — and `CLIENT_SELF_COLUMNS` is still the riskiest line in it.
- **`primary_goal` and `notes` are still dead weight** on `client_goals` (§7, and the Session 0
  STATUS block's banked ordering note for whoever drops them).

---

### Session 0b — owner sign-off ✅ 2026-08-13

The owner ran the 0b smoke checklists (the goal editor's four cases, the drawer's
read-only line and maintenance state, and the goal-history popover) and reported **all clear**.
**Session 0b is COMPLETE by owner decision.** This closes the browser-verification residuals
recorded in the 0b.1–0b.6 STATUS blocks above; those lines stand as history of what was true at
commit time, superseded here.

**Two defects the smoke caught, fixed and folded in before sign-off:**

1. **`a41acb3` — the goal deadline offered days the app refuses.** A regression introduced by 0b.4:
   the deleted drawer editor carried `min={getTodayDateString()}` and the inline rewrite dropped
   it. Both bounds (route: not in the past against the coach's day; schema: not before the goal's
   own start) now compose into ONE native `min`, so the impossible days are greyed out rather than
   picked and rejected. The goal START stays deliberately unbounded. **A rule for the whole
   platform came out of it** — `docs/newdesignsystem.md` → "Date inputs express their bounds
   natively", with the four shipped references.
2. **`027a9c0` — "What happened" never recorded the nutrition prescription.** The first proposal
   was wrong and is worth recording so it is not retried: sourcing the timeline from the block
   headline's `calories`/`deficitPerDay` would have pinned the REFERENCE-date version's numbers to
   a historical date, so every later plan save silently rewrites the past and every era but the
   last disappears. The fix reads the version rows, which already ARE the era log —
   `[effective_from, effective_until]` tiles the timeline by construction, so it is an
   intersection with the block window, needs no resolution rule (unlike training), and costs zero
   new queries. **A closed window is immutable (the RPC refuses `effective_from < p_today`), which
   is exactly where the accuracy comes from.** Eras stop at today and a no-op re-save emits nothing.

**Session totals: 8 commits, ZERO migrations, tests 2883 → 2935 (+52).** Final gates on the
shipped tree: `tsc --noEmit` clean · `eslint .` 0 errors (209 pre-existing warnings, unchanged
across every commit) · `vitest run` 276 files / 2935 tests · `check:labels` OK 664 ·
`check:rls` 41/41.

---

## SESSION 5 — Task 5.1 SHIPPED 2026-08-13

One task, one code commit, **zero migrations**. The descope itself committed separately and
first (`c1615bc`), so this commit carries only the fix and this block.

**Verification 1 — the generated `Args` PINS all 24 keys; no hand-written interface was
needed.** `types/database.ts` → `Functions.create_nutrition_plan_atomic.Args` lists 24 named
keys with no index signature and no widening: 22 required plus `p_effective_from?` and
`p_today?`, which are exactly migration 144's two `DEFAULT NULL` parameters (`144:147-171`).
Proven by probe rather than by reading — an excess key errors `TS2353`, a missing key errors
`TS2740` naming *"…and 17 more"* (21 + 1 supplied = 22 required, + 2 optional = 24).

**Verification 2 — line numbers at execution.** The casts were at `:99` (the RPC **name**),
`:130` (the arg object), and a **third** the plan never counted: `as unknown as { data … }` on
the same line, which existed only because `.rpc(name as never, …)` returns something useless.
All three are gone. The key-list belt is `services/nutrition-plan-service.test.ts:161-187`
(`toHaveLength(24)` at `:184`). The doc's old `:85`/`:117` were stale by 14 and 13 lines.

**What the plan did not anticipate: annotating with the bare `Args` DOES NOT COMPILE.**
`supabase gen types` derives an argument's type from its SQL type alone and **never emits
`| null`**, so the generated `Args` types `p_bmr: number` where the function accepts NULL.
The current payload produces **9 `TS2322` errors** under a bare `Args` annotation — one for
each key that carries null (`p_goal_weight_kg`, `p_goal_deadline`, `p_bmr`, `p_tdee`, the four
`p_custom_*`, and `p_effective_from`). `p_daily_targets` → `Json` assigns cleanly.

**The shape shipped**, in `services/nutrition-plan-service.ts`:

```ts
type CreateNutritionPlanRpcPayload =
  Required<Omit<CreatePlanRpcArgs, NullableRpcArgKeys>> &
  { [K in NullableRpcArgKeys]: CreatePlanRpcArgs[K] | null };
…
} satisfies CreateNutritionPlanRpcPayload as CreatePlanRpcArgs);
```

- `satisfies` runs **first and completely**, so the trailing assertion can only launder
  nullability — it cannot hide a key mismatch. It is `as <a generated type>`, not `as any`.
- `Required<>` is load-bearing, not tidiness: `p_effective_from` and `p_today` are SQL-defaulted
  and therefore **optional** in the generated `Args`, so without it a dropped `p_today` — the
  parameter the RPC's own past-date belt reads — still compiles.
- **`NullableRpcArgKeys` is hand-maintained and nothing checks it.** `CreatePlanRpcArgs[K]`
  fails if a key leaves the signature, but a migration that makes a tenth parameter nullable, or
  one of these nine NOT NULL, is invisible to `satisfies` — the union only widens. Said in one
  sentence in the comment beside the list, per owner direction.

**Mutation-proven, two ways, each in isolation** (an excess-property error masks a
missing-property one, so they cannot be tested together):

| Mutation | Result |
|---|---|
| add `p_mutation_probe_bogus_key: 1` | `TS2353 … does not exist in type 'CreateNutritionPlanRpcPayload'` |
| drop `p_today` | `TS1360 … Property 'p_today' is missing … but required in Required<Omit<…>>` |

The file was copied to the scratchpad before mutating and `diff`-ed byte-identical after
reverting (never `git stash`, never `git checkout --`).

**The key-list test stays at 24, assertions byte-identical** — the diff on that file is
comments only (16 insertions / 7 deletions, zero non-comment lines). Its comment was rewritten
because it asserted the payload "is cast `as never`, so TypeScript checks nothing", which this
commit makes false. It now states what each belt compares against: `satisfies` checks the
payload against `types/database.ts`; the hand-transcribed 24-key list does **not** trust that
mirror, so it still fires when the SIGNATURE is what moved and an arity change would otherwise
ride in unnoticed on a regenerated types file.

**The training twin is recorded in `TECHNICAL-DEBT.md`, not only here** (owner direction — this
plan doc is deleted when the workstream lands, so a defect recorded only in a STATUS block is
recorded in a file scheduled for deletion). `services/training-service.ts:354`/`:377` carry the
identical `as never` pair on `create_training_plan_atomic` and are **strictly less protected**:
`training-service.test.ts` asserts three keys via `expect.objectContaining`, so there is no
key-list belt either. The entry carries the full recipe including the `| null` trap (15 of its
22 keys pass `?? null`) and the four SQL-defaulted keys `Required<>` must pin, so the next
executor inherits the verification rather than re-deriving it. Findable via
`git log -S CreateNutritionPlanRpcPayload` — a literal hash was not used because a commit cannot
contain its own. The stale clause in that file's "Type Safety Gaps" table (which still claimed
every `create_*_atomic` cast remained) was corrected in the same commit.

**Gates:** `tsc --noEmit` clean · `eslint .` 0 errors (209 warnings, unchanged) · `vitest run`
276 files / 2935 tests · `check:labels` OK 664 · no `as any` in the service (the 16 in the test
file are pre-existing `vi.mocked` stubs, untouched) · no introduced markers. No migration, so no
`db push`, no `gen types`, no `check:rls`. **§2 security/perf review: not applicable** — no
route, no auth, no write path, no query, no migration. All three casts were compile-time only,
so the emitted JavaScript is unchanged and this commit has **zero runtime delta**.

`services/nutrition-plan-service.ts` is now 372 lines, over §4's 300-line service guideline and
under its 400 split threshold. Not split: the added lines are three type aliases belonging to
the function directly beneath them, and the file is cohesive (one table's data access).

---

### Session 5 — owner sign-off ✅ 2026-08-13

The owner regenerated a test client's nutrition plan and reported **works** — it saved, no
"Failed to create nutrition plan". **Session 5 is COMPLETE by owner decision.** That closes the
one residual the STATUS block above recorded: every gate in this session was static or mocked
(`nutrition-plan-service.test.ts:3-8` mocks `supabaseAdmin.rpc` outright, so no test in the suite
has ever called the real function), which left "PostgREST resolves the overload" provable only by
a real save. It is now observed rather than argued.

**Zero follow-ups.** Unlike 0b and 4B, the smoke found nothing to fold in — expected, since all
three casts were compile-time only and the emitted JavaScript is byte-identical to the tree
before the commit.

**Session totals: 2 commits (`c1615bc` descope, `a22c2fe` fix), ZERO migrations, tests unchanged
at 276 files / 2935** (the only test-file edit was comments). Final gates on the shipped tree:
`tsc --noEmit` clean · `eslint .` 0 errors (209 pre-existing warnings, unchanged) ·
`vitest run` 276 files / 2935 tests · `check:labels` OK 664. No migration, so no `check:rls`.

**What outlives this document** (it is deleted when the workstream lands, so nothing load-bearing
may live only here): the `create_training_plan_atomic` twin and its full recipe are in
`TECHNICAL-DEBT.md`, and the parked-deficit design plus its un-park trigger are in the "What was
parked" section above, which travels into git history with this file.

---

## SESSION 6 — SHIPPED 2026-08-13 (5 commits, migration 147)

`5a567a7` migration+types · `8eee533` write path · `32a29e5` coach read ·
`967865a` client read+docs · `c157698` the pre-deletion sweep.

### Three corrections to this document, found at execution

1. **`deleteFutureNutritionEventsForPlan` does not exist.** Session 1b.2 replaced it with
   `deleteFutureNutritionEventsForClient` (`nutrition-event-service.ts:465-483`), which is
   *more* aggressive — its own comment reads "No `is_modified` / `coach_note` sparing".
   The schema conclusion (client-scoped, SET NULL plan FK) is more justified, not less.
2. **Task 6.2's "the per-day range-edit writer of `coach_note` is untouched" is FALSE — there
   is no such writer.** The range-edit path writes `note`, the client-visible column.
   `stampCoachNote` was the **only** writer of `coach_note` anywhere, migrations and scripts
   included. Moot under the owner's write-both decision, but it is why "just repoint it" was
   never a two-line change, and it is what turned the 6.2 gate into a different question.
3. `stampCoachNote`'s call sites were at `:323`/`:420`, not `:261`/`:347`.

### Owner decisions closed at the 6.2 gate

- **Write BOTH** — a fourth shape, not one of the three offered. The calendar marker survives.
- **Relabel toward visible** — over-stating visibility on pre-147 rows is the safe error.
- **Client notes are block-attached only**, and the consequence was accepted explicitly: a
  note leaves the client's view when its block ends.
- **Notes nest under the nutrition entry**, no new bullets.
- **`currentBlockNotes` carries `blockId`**, so RN asserts rather than infers and `null` stays
  distinguishable from "current block, no notes".

### What outlives this document

Everything load-bearing is now in `ARCHITECTURE.md`, `TECHNICAL-DEBT.md`, `CONVENTIONS.md §8`
or on `types/client-journey.ts`. Task 6.4 swept this file and migrated 11 findings, dropped 1
as stale (the second inline BMR implementation — closed by Session 4B), corrected 1 (the
8-week horizon is **2** occurrences, not eight), and split the DEV-vs-PROD item so its rule
landed in CONVENTIONS §8 while its measurements die here. All twelve were grepped back out of
the surviving docs afterwards: the sweep proves they moved, the grep proves they are findable.

**Session 6 left this document safe to delete** — everything durable had been swept out.
**SESSION 7 (added 2026-08-21) reopened it.** Delete only after 7 signs off, and re-run 6.4's
grep gate first: 7 is a UX session and should add nothing durable, but that is a claim to
verify rather than assume.

### Gates

`tsc` clean · `eslint` 0 errors (209 pre-existing warnings, unchanged) · `vitest`
**278 files / 2972 tests** (from 276/2935: +2 files, +37) · `check:labels` OK 664 ·
`check:rls` OK **42/42** public tables · no `as any`, no introduced markers.

**Browser smoke is OWED — the owner runs it.** Checklist in the session report.

---

# SESSION 7 — The journey is the place you set things up

**Zero migrations. Four tasks.** Added 2026-08-21 by owner direction, after Sessions 0-6
shipped. **Depends on Session 3 (the Blocks pane) and Session 6 only for context** — it
touches no note code.

## The problem, in the owner's words

> "The UX of setting up a journey/phases is good. However it feels a bit off from a UX
> perspective when you have to leave the journey page to set up training and nutrition."

A coach builds a client's journey on one screen, then has to go somewhere else to make it
real, and find their way back. The Journey tab knows a block has no program — it renders
"No program placed" — and then makes the coach do the navigation themselves.

## What this is NOT

Not a merge of the Training and Nutrition tabs into Journey. Those tabs keep their calendars,
heroes and builders. This session moves ONE analytics pane, and makes two empty states into
doorways that lead back where they came from.

---

### Task 7.1 — Exercise Data moves to the Journey tab

**Journey's pane switcher gains "Training", between Physique and Wellness.** It renders
`ExerciseDataView` (`components/clients/training/exercise-data/exercise-data-view.tsx`),
moved from the Training tab. Training is then **Data | Plans**, the same two-pane shape
Nutrition already has (`nutrition-plan-builder.tsx`) — which is the point: analytics live in
Journey, prescription lives in its own tab.

Verified against `main` at authoring:

- `JOURNEY_SUBTABS = ["body", "wellness", "blocks"]` (`metrics-view-types.ts:17`), labelled
  Physique / Wellness / Blocks (`metrics-top-bar.tsx:22-24`). New order: **Physique, Training,
  Wellness, Blocks.**
- Training's three panes are `"data" | "plans" | "exercise-data"`
  (`training-plan-builder.tsx:33`), with `ExerciseDataView` mounted at `:52`.

**The landmine — `JourneySubtab` is deliberately NOT `MetricTab`.** `metrics-view-types.ts:13-17`
records why: `MetricTab` keys the metric data shapes (`metricsByTab`, `logRowsByTab`,
`DEFAULT_FOCUS` are all `Record<MetricTab, ...>`), and `"blocks"` is kept out of it so a
non-metric pane can never index them. `metrics-tab-content.tsx:49` handles that with
`const tab: MetricTab = pane === "blocks" ? "body" : pane` — it *idles* on "body" while the
Blocks pane renders. **"training" is the same kind of non-metric pane and must join that
guard.** Miss it and the pane either type-errors or silently indexes the physique metrics.

---

### Task 7.2 — Give Training and Nutrition their own pane params

**This is the enabler for 7.3 and 7.4, and it ships ALONE so a regression is attributable.**

`?subtab=` is written by BOTH the Training and Nutrition tabs. `buildClientTabUrl`
(`lib/client-tabs.ts`) therefore **deletes it** on every tab change, and its doc comment says
routing `subtab` through `extraParams` "would reintroduce the cross-tab guard bug this
function exists to prevent". Both tabs additionally guard it at read time
(`training-plan-builder.tsx:31`, `nutrition-plan-builder.tsx:32`) against a render-order race.

A deep link into Training's **Plans** pane is addressed by exactly the param that gets
dropped. **Owner decision 2026-08-21: give each tab a single-owner param** — `?training=` and
`?nutrition=`, the way Journey already has `?journey=`. `buildClientTabUrl` carries
single-owner params through by design, so the deep link lands on the right pane with no
flash, and the whole shared-param class of bug goes away.

- Both guards read their own param and can drop the `tab === "..."` race check, because a
  single-owner param cannot be stale from another tab. **Keep the checks anyway unless a test
  proves them unnecessary** — they are cheap and they encode a race that really happened.
- **Old `?subtab=` links must still resolve.** Read the legacy param as a fallback when the
  new one is absent. Do not silently break a bookmarked link.
- `buildClientTabUrl` keeps deleting `subtab`; nothing should write it after this task.

---

### Task 7.3 — "No program placed" becomes the way in, and the way back

**Clickable on current and future blocks only** (owner decision 2026-08-21). Elapsed and
archived blocks keep plain text: placement writes from a chosen start date, not the block's
window, so a click on a finished block leads somewhere confusing — and it matches the posture
elapsed blocks already have everywhere else (read-only, no delete offered, dates pinned).

The round trip:

1. Click → `handleTabChange("training", { training: "plans", apply: "1", returnTo: "journey", returnBlock: <id> })`.
2. Training's Plans pane mounts with the apply tray **already open**.
3. The coach completes the normal apply flow, unchanged.
4. On success → back to `?tab=metrics&journey=blocks&block=<id>`, with that block **expanded**.

Things that will bite, all verified:

- **Cross-tab navigation MUST go through `handleTabChange`** (`app/clients/[id]/page.tsx:36`).
  `activeTab` is React state seeded from `?tab=` **at mount only** (`:34`), so a `<Link>` or a
  bare `router.replace` changes the URL without switching the tab. The page already documents
  this at `:44-45`, and the nutrition drawer's `GoalSummary` chose a sentence over a link
  rather than fight it.
- **`onTabChange` is not currently passed to `MetricsTabContent`.** The page already passes it
  to two siblings, so this is an established seam, then `BlocksSubtab` → `BlockCard`. Three
  levels of prop is the §4 boundary — if it wants a fourth, use a context instead.
- **The apply tray is local state** (`training-plan-builder.tsx:22`), not URL-driven. Arriving
  with it open means seeding that state from the param once, on mount.
- **The completion hook exists:** `onSuccess?.(clientId)` at
  `components/training-library/apply-to-client-dialog.tsx:173`.
- **`BlockCard.defaultOpen`** is currently `block.state === "current"`; the return trip needs
  `?block=<id>` to win over it.
- **`returnTo` MUST be cleared, and this is the landmine.** If the coach abandons the flow —
  closes the tray without applying — a lingering `returnTo` will bounce them to Journey after
  some *later*, unrelated apply. Either clear it when the tray closes without success, or
  honour it only for a tray opened by the deep link in that same mount. Do not leave it
  riding in the URL.

---

### Task 7.4 — The same round trip for nutrition

Identical shape, different surfaces. The Nutrition fact's empty state is **"Not set"**
(`block-card.tsx`, `NutritionColumn`), gated to current/future blocks the same way.

- Target: `handleTabChange("nutrition", { nutrition: "plans", edit: "1", returnTo: "journey", returnBlock: <id> })`.
- The nutrition builder drawer is **local state** (`nutrition-plan-builder.tsx:23`, opened via
  `onOpenSettings`) — same param-seeds-state treatment as the tray.
- Completion is the existing `generatePlan` success path in `hooks/use-nutrition-builder.ts`,
  which already returns `true` and refreshes caches. Hook the return trip to that boolean, not
  to the drawer closing: **a coach can close the drawer without saving**, and bouncing them
  back to Journey as if they had is worse than not bouncing at all.
- Session 6 note: a plan save can now throw *after* the plan commits (a failed note insert).
  `generatePlan` returns `false` on that path, so the coach stays put with their note intact —
  which is the correct behaviour here and needs no special casing, but do not "fix" it into a
  bounce.

---

### Task 7.5 — Documentation

`ARCHITECTURE.md`'s client-page tab table lists Journey's panes and Training's subtabs; both
change. Record the single-owner pane params beside the existing `buildClientTabUrl` note, and
say plainly that Exercise Data moved so nobody hunts for it under Training.

---

### Session 7 verification

Full `§13`. **No migration**, so no `db push`, no `gen types`, no `check:rls`. §2's
security/perf review is **not applicable** on the face of it — no route, no auth, no write
path, no query — but say so explicitly rather than skipping it silently.

Tests worth having, in priority order:

1. **The abandoned-flow case**: open the apply tray via the deep link, close it without
   applying, then apply normally later — the coach must NOT be bounced to Journey.
2. Elapsed and archived blocks render plain text, not a button.
3. `buildClientTabUrl` carries the new single-owner params and still drops `subtab`.
4. A legacy `?subtab=plans` link still opens the Plans pane.
5. The Journey "training" pane does not leak into the metric-keyed shapes (the
   `MetricTab` guard).

**Browser smoke (owner runs it):** the two round trips end to end, plus one abandoned trip.
UI is unverified until then — this is a session whose entire value is how it *feels*, so the
smoke matters more here than in any session before it.

---

### 📋 SESSION 7 PROMPT — paste this into a fresh session

```
Read in full: CONVENTIONS.md, docs/ARCHITECTURE.md, and
docs/CLIENT-GOALS-PHASES-EXECUTION-PLAN.md §1-§5 and all of SESSION 7. You are
executing SESSION 7 only. Zero migrations — if you think you need one, STOP AND ASK.

This is a UX session: no schema, no new API routes, no write paths. Four tasks, one
commit each, in order — 7.2 is the enabler for 7.3/7.4 and ships ALONE so a regression
is attributable.

Two owner decisions are CLOSED, do not re-litigate:
  - The clickable empty state is on CURRENT and FUTURE blocks only. Elapsed and
    archived keep plain text.
  - Training and Nutrition get single-owner pane params (?training=, ?nutrition=),
    the way Journey has ?journey=. NOT ?subtab= through extraParams.

Verify these against main before you write anything — every line reference in this
document has drifted at least once, and Session 6 found three claims that were flatly
false:
  - JOURNEY_SUBTABS and the Journey pane labels
  - Training's three subtab values and where ExerciseDataView mounts
  - buildClientTabUrl's extraParams contract and that it deletes subtab
  - that app/clients/[id]/page.tsx seeds activeTab from ?tab= at MOUNT ONLY

The landmine that will cost you a session if you miss it: JourneySubtab is
deliberately NOT MetricTab. MetricTab keys metricsByTab / logRowsByTab /
DEFAULT_FOCUS, and "blocks" is kept out of it on purpose. A new "training" pane is
the same kind of non-metric pane and must join the same guard in
metrics-tab-content.tsx.

The landmine that will ship a bug: a lingering returnTo param. If a coach opens the
apply tray from Journey and then abandons it, a later unrelated apply must NOT bounce
them back to Journey.

Rules: §2 plan-first, one commit per task, commit-ready = §13, do not drive a browser,
append a STATUS block per task.
```
