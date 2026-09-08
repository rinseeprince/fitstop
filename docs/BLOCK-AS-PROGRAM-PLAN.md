# Block-as-program — execution plan

**Status: commits 1–4 SHIPPED — `1ef0cfee`, `6d6d7124`, `58b9ec26`, `16f4e20d` (all 2026-09-04). Migrations 164 and 165 on DEV **and** PROD. Commits 1–3 smoked; commit 4's smoke found five defects, all folded into commits 5–7 below. Next: commit 5.**

Eight commits. 1–4 are done; 5–8 are specified with pasteable prompts in §6. Each is
independently revertable in order and independently gated.

---

## 1. The model, in two sentences

> **1. The plan and the calendar are different things.** Deleting days doesn't delete the
> plan; the plan is what puts them back.
> **2. A delete removes today onwards — but never a day the client has already logged.**

Everything below is one of those two, or copy.

**Why rule 2 is one mechanism, not three.** The past is never in a delete's scope, and a
client cannot log a future day (their open logging window is the current check-in period
plus the days since — commit 8c of the measurement-log plan). So "a day they have already
logged" can only ever mean **today**. One function answers the whole rule: *start at today;
start at tomorrow instead if they have logged today.* Every delete path calls it and no
caller does its own date arithmetic — which is exactly how commit 4 shipped a bug.

**The corollary that keeps catching people out.** Replacing today is always fine; emptying
it is not. A placement replaces today's session in the same breath it deletes it, and a
nutrition save rewrites today's target — neither ever leaves today blank. Only *removals*
need the floor. Emptying today costs the client their target for the rest of the day and
makes their food log snapshot a null target permanently.

---

## 2. What a coach can do, and how it resolves

- **A block is the time-bound program a coach sells** ("12 week summer shred"). It carries a
  name, a window and an optional focus — nothing else. Its DATES are the only thing anything
  computes from.
- **Blocks own their own windows** (mig 164): both dates chosen, **gaps allowed** (nothing is
  planned; the client is between programs), **overlaps refused** in the service and by a gist
  exclusion constraint.
- **The placement window is the block.** A program shorter than its block repeats to fill it —
  cloned per cycle, so cycle three can be progressed past cycle one — and a longer one is cut
  at the block's end. No block covering the start date → the program's own authored length,
  exactly as before blocks bounded anything.
- **The nutrition generation horizon** is the coach's declared bound: the block covering the
  generation anchor, else the furthest live training program's last day, else a fixed 8 weeks.
- **Everything is pre-programmable.** Block 1 with its own program and targets, block 2 with
  its own; or no blocks at all and two programs back to back with two nutrition versions
  behind them. Placement permits a future start date; nutrition versions can be queued
  (mig 144's close-and-insert).
- **The nutrition calculator is untouched by this workstream.** Targets price against the
  client's current weight and the goal in force, with the deficit spread from the plan's
  effective date to the deadline (commit 8bb of the measurement-log plan).

---

## 3. Decisions taken, with the reasoning that will otherwise be re-litigated

**Dates, never a pointer** (owner, 2026-09-04, re-asked and re-confirmed 2026-09-08). A
`block_id` on `training_plans` / `nutrition_plans` would sit ON TOP of dates the generator
needs anyway, so two statements of one fact could disagree. It would genuinely have made two
things easier — the block card's program column, and knowing which plans a block delete
should remove — but **blocks are re-datable, so any rule that keeps a pointer honest is a
rule that derives it from the dates**, making the pointer a stale-able cache of a one-query
answer. Migration 133 already tore that shape out of this product once.
*Revisit when:* something needs attaching to a block that is NOT date-shaped (a note, an
outcome, a rating, a price) — there would be no dates to derive it from.

**The block CAPS, it does not floor** (owner, 2026-09-04). Precedence, not a maximum. Past
the coach's declared bound there are deliberately no events; a block that could not bound
anything would be decoration. Consequence accepted: a client with no block whose program ends
in three weeks gets three weeks of targets where the old fixed window gave eight.

**Both tracks ask the SAME question of a block** (owner, 2026-09-08, correcting commit 1).
"Which block am I inside?" — never "how far is anything drawn?". The original asymmetry let
nutrition fill a block the coach had not priced yet, so the card said "Not set" while the
calendar had targets in it. Commit 5 deletes `getFurthestBlockEnd`.

**An extension CONTINUES the pass, never restarts it** (owner, 2026-09-04). Needs
`training_plans.authored_slot_count` (mig 165) because the placed rows are the authored
program repeated and nothing else records the period — `saved_plan_id` is NULL for exactly
the plans a coach edited. Resumes at `placedSlots % authoredSlotCount`.

**`training_plans.effective_until` is NEVER WRITTEN.** The placement RPC omits it by design
and says so in its own body; a live DEV probe found 382 live plans and zero end dates. A
program's end is `effective_from + its active day-row count − 1`, via the shared
`calculatePlacementEndDate`. Any code that reasons about a program having ended must use
that, not the column. This has now caused two separate defects.

**A block edit writes nothing on its own.** Moving a block's dates never rewrites the
calendar; the coach is offered the choice and picks. Dismissing leaves every event where it
is.

**Rejected:** a read-time template fallback for a missing nutrition day; a coach-facing
nutrition end-date picker; ending the nutrition VERSION at the program's end (a day with no
version means the client's food log is refused outright). All three considered 2026-09-04.

---

## 4. Shipped

| # | What | Commit |
|---|---|---|
| 1 | The nutrition horizon: block → program → 8 weeks, resolved per generation, stored nowhere. Plan-clear stale tail closed (`cancelFutureEventsForPlan` returns its max deleted date; both clear routes pass it as the scope's `to`). | `1ef0cfee` |
| 2 | The placement window is the block: longer programs truncate, shorter ones repeat with cloned cycles. Clone loop batched (a 1-week program in a 52-week block is 364 slots). | `6d6d7124` |
| 3 | A block owns its own window: chosen dates, gaps allowed, overlaps refused (mig 164 gist constraint), delete stops shifting the chain. Net −600 lines. | `58b9ec26` |
| 4 | Moving a block's dates can bring the calendar with it — fill or clear, never automatic. `authored_slot_count` (mig 165). | `16f4e20d` |

---

## 5. Defects found in commit 4's smoke (2026-09-07/08) — all addressed in 5–7

1. **Dialog copy is meaningless.** "Training and nutrition still stop where they did."
2. **Recalculate starts today**, so a client who has already eaten to today's number has it
   move under them.
3. **A logged nutrition day loses its calendar stamp.** `clearScheduledEvents` filters
   `status = 'scheduled'`, which protects a logged TRAINING event (they advance to
   `completed`) but **nothing on the nutrition side — a nutrition event never leaves
   `scheduled` in this product** (live: 28,069 scheduled, and the only 365 `logged` are one
   seeded fixture year). Verified in data: 2026-09-04 held a nutrition log with target 1,950
   and no event.
4. **Inconsistent floors.** The nutrition plan delete already floors at tomorrow *deliberately*
   (its own comment: "a today the client already part-logged would otherwise be deleted and
   the per-card nutrition writer would 422 mid-day"). Commit 4's block clear floored at today.
   Two deletes that feel identical, two different days.
5. **The block save fires before the coach has chosen**, so "Block test updated" toasts while
   the modal is still asking.
6. **A future block claims a program it does not have** (screenshot 2026-09-08). The block
   card's `governingPlanAt` skips a plan only when `effectiveUntil < date` — and that column is
   always NULL, so a January program governs every later block forever.
7. **Nutrition over-runs into the next block** — commit 1's `getFurthestBlockEnd`.

---

## 6. The commits

Each prompt is complete on its own. Paste it into a fresh session. **The session must plan
for review before writing anything.** Gates after every commit: `npx tsc --noEmit`,
`npx eslint .`, `npx vitest run`, `npm run check:labels`, `npx knip`,
`npm run check:service-key`, plus `npm run check:rls` for any commit with a migration.
Mutation-test every new assertion from a copy in the scratchpad — **take the backup AFTER the
change you want to keep**, and `git diff --stat` afterwards to prove the tree is clean.

### Commit 5 — `fix(blocks): one deletion floor, one save, and honest copy`

**STATUS: NOT STARTED.** Addresses defects 1, 2, 3, 4, 5 and 7.

```text
Read CONVENTIONS.md, docs/ARCHITECTURE.md and docs/BLOCK-AS-PROGRAM-PLAN.md §1-§6
before planning. Plan for my review before writing anything.

Build commit 5 of docs/BLOCK-AS-PROGRAM-PLAN.md §6. Five things, one commit:

1. ONE DELETION FLOOR. Add one function answering "from which day may this client's
   events be deleted?" — the client's today, or tomorrow if they have already logged
   today (a nutrition_logs row, or a training event that has left 'scheduled'). Four
   paths call it INSTEAD of computing their own floor: the block clear
   (services/block-event-sync-service.ts), the block delete's clearEvents option, the
   nutrition plan delete (services/nutrition-plan-orchestrator.ts, which currently
   hardcodes today+1) and the training plan clear (cancelFutureEventsForPlan's callers,
   which currently pass today). Do NOT add a separate "exclude logged nutrition days"
   filter as well — with one shared floor it defends against a state that cannot occur,
   and a second mechanism is the complexity this commit exists to remove. Say that in a
   comment where someone would otherwise add it.

2. NUTRITION ASKS THE SAME QUESTION AS TRAINING. resolveNutritionHorizon must use
   getBlockEndCoveringDate (the block covering the generation anchor), not
   getFurthestBlockEnd. DELETE getFurthestBlockEnd and its tests. Filling a block the
   coach has not priced yet is worse than a short calendar.

3. RECALCULATE IS NEVER TODAY. regenerateNutritionForBlock's effective date becomes the
   LATER of the block's start and tomorrow — so a future block recalculates as of its own
   start, and a block already under way as of tomorrow, and today's number can never move
   under a client who has eaten to it. `keep` changes no numbers and stays on today.

4. THE SAVE SEAM. "Save block" opens the events dialog when the dates moved; ALL THREE
   choices complete the save — same targets, recalculate, and a third "Just the dates" —
   and the X cancels the whole thing. One toast at the end naming what happened. The block
   save and the calendar work are still sequential, not atomic: if the block saves and the
   calendar work then fails, say exactly that.

5. COPY. Rewrite both dialogs. "Training and nutrition still stop where they did" is
   meaningless — say what is actually true and name the real dates:
     extend →  "Carry the plan on?" / "'X' now runs to 29 Oct, but the workouts and
               targets stop on 1 Oct."
     shorten → "Clear the days that left?" / "'X' now ends 1 Oct, but there are still
               workouts and targets scheduled after it."
   Both extend buttons continue the TRAINING either way — they differ only in the
   nutrition, and the old copy hid that. Also rename the two calendar deletes so one
   plainly removes days and the other plainly removes the plan.

Where ARCHITECTURE or CONVENTIONS state a rule that contradicts this commit, do not
silently follow it and do not silently override it: list each contradiction with the doc
line and what this plan says instead. No migration, no wire change beyond the dialog's
third option. Commit directly to main. Then set this commit's STATUS to SHIPPED with the
hash and date, and hand me a browser smokelist.
```

- Tests, each with a mutation: the floor returns today when nothing is logged and tomorrow
  when today is logged, on either track; each of the four paths uses it rather than its own
  date; the horizon takes the covering block and not the furthest; a recalculate on a future
  block takes the block's start; on a running block, tomorrow; `keep` stays on today; all
  three dialog choices save the block; the X saves nothing.
- Docs: ARCHITECTURE's blocks section (the one floor, the same question both tracks ask);
  the generation-horizon subsection loses the furthest-block wording.

### Commit 6 — `fix(journey): a block shows only what is actually on its days`

**STATUS: NOT STARTED.** Addresses defect 6.

```text
Read CONVENTIONS.md, docs/ARCHITECTURE.md and docs/BLOCK-AS-PROGRAM-PLAN.md §1-§6
before planning. Plan for my review before writing anything.

Build commit 6 of docs/BLOCK-AS-PROGRAM-PLAN.md §6.

An unstarted block currently claims a training program and a nutrition prescription it
does not have: services/client-blocks-facts-service.ts asks which plan's WINDOW covers
the block, and a placed plan's window has no end (training_plans.effective_until is NULL
on every one of them, by design — see §3), so a January program governs every later block
for ever. The same is true of the nutrition headline, whose version is open-ended.

The rule: A BLOCK SHOWS WHAT IS SET ONLY IF IT ACTUALLY HAS DAYS ON THE CALENDAR. No
events in the block → both columns read exactly as a block nobody has touched. That is
the question a coach is asking when they look at the card — what will this client
actually get — and it leaves the owner's 2026-08-12 decision about WHICH NUMBER to show
alone (still the plan version's, so hand edits and training surpluses stay excluded).

The facts service ALREADY reads the block's nutrition events across the whole span
(fetchEventCalories), partitioned per block in memory, so the nutrition gate costs
nothing. Training needs one more read of its events over the same span — a fifth parallel
read in the same Promise.all, partitioned the same way, so round trips stay constant in
the number of blocks and never per-block.

Do NOT fix this by deriving each plan's real end for the governing reduction. It is more
code for the same answer, and the events are the truth for a date (events-as-SOT).

Grep at execution time for every reader of the block facts payload; do not trust a list.
No migration. Commit directly to main, set this commit's STATUS to SHIPPED with the hash
and date, and hand me a browser smokelist.
```

- Tests, each with a mutation: a block with no events shows neither column; a block with
  training events but no nutrition shows only training; the number still comes from the plan
  version, not the events; round trips do not grow with the number of blocks.

### Commit 7 — `feat(blocks): delete block and its days deletes the plans too`

**STATUS: NOT STARTED.** Depends on commit 5's floor.

```text
Read CONVENTIONS.md, docs/ARCHITECTURE.md and docs/BLOCK-AS-PROGRAM-PLAN.md §1-§6
before planning. Plan for my review before writing anything.

Build commit 7 of docs/BLOCK-AS-PROGRAM-PLAN.md §6.

"Delete block and its days" currently clears the event rows but leaves the training
program and the nutrition version in place — so the button says delete and the
prescription says otherwise, and the next cascade restores the days. That is the same
confusion as "I deleted the nutrition events and placing a training plan brought the
calories back".

Make it exactly THREE THINGS THE COACH CAN ALREADY DO, fired together: delete the
nutrition plan, delete the training plan, delete the block. Reuse those two existing
paths — do NOT invent a block-scoped deletion or a rule for which plans "belong to" a
block; that ownership question is the thing the dates model deliberately does not answer
(§3), and inventing it here is how a pointer architecture arrives by the back door.

Owner decision 2026-09-08, accepted with its cost: this clears everything from the floor
FORWARD, not just the block's own window. A next block that already has its own program
loses it and survives as an empty label. The dialog must say so plainly — "Removes this
block, and the training and nutrition from today onwards" — rather than implying the
block's window is the limit.

Both deletes use commit 5's shared floor, so a day the client has logged survives.

No migration. Commit directly to main, set this commit's STATUS to SHIPPED with the hash
and date, and hand me a browser smokelist.
```

### Commit 8 — `chore(blocks): the block's target weight goes`

**STATUS: NOT STARTED.** Owner decision 2026-09-08.

**Pulled out of `docs/MEASUREMENT-LOG-PLAN.md` commit 8d's third sub-commit** — it is
independent of the goals work (it only deletes a field), so it lands here instead. **8d must
not do it twice**; its entry needs updating when this ships.

```text
Read CONVENTIONS.md, docs/ARCHITECTURE.md and docs/BLOCK-AS-PROGRAM-PLAN.md §1-§6
before planning. Plan for my review before writing anything.

Build commit 8 of docs/BLOCK-AS-PROGRAM-PLAN.md §6. Remove a block's optional target
weight entirely: client_phases.target_weight (its own migration, DEV then PROD after
probing BOTH databases), the block form's field, the payload builders' echo, the pace
readout and derivePace, and the journey wire's targetWeightKg.

Why: a block is a label on time plus a window. A stored block target was a SECOND target
concept beside the client's goal, fed to no calculator — a pace toward a number no plan
was ever built for. The goal owns targets; a block that wants one reads the goal version
covering it (measurement-log commit 8d).

Grep at execution time for every reader of target_weight / targetWeightKg; do not trust a
list. Update docs/MEASUREMENT-LOG-PLAN.md commit 8d so its third sub-commit is recorded
as done here rather than pending. Commit directly to main, set this commit's STATUS to
SHIPPED with the hash and date, and hand me a browser smokelist.
```

---

## 7. Parked, deliberately

- **Placement leaves orphaned slot rows.** When a placement clears another program's window
  it deletes the events but not the `training_sessions` rows behind them, so they stay
  `is_active` for ever. Correctness is fine — placement caps a program at the next one's
  start, so the end date still resolves right — but a plan's END is derived from its active
  row count, and one read that carries those rows is already documented as having silently
  truncated once at PostgREST's cap. **The fix is one statement:** the path that deletes those
  events already knows their session ids, so deactivate them in the same breath. Commit 5's
  clear already does this for its own deletes; placement does not.
- **A client who logs AFTER a delete, on a day whose prescription is gone, still writes a
  blank target.** Pre-existing, bounded to that one day, deliberately left alone by
  measurement-log commit 8cc (no read-time fallback).
- **A gap between blocks keeps an open nutrition version but has no events**, so a client who
  logs food during a break stores a blank target. Same shape as above; gaps are now a
  designed state, so it is easier to reach.
- **8d dependency, so it is not discovered by accident.** `regenerateNutritionForBlock` goes
  through `orchestrateNutritionPlanCreation`, which resolves its calculator inputs against the
  client's TODAY rather than the plan's effective date. Measurement-log commit 8d must thread
  the effective date into that resolver, not merely change how goals are stored — otherwise a
  recalculate for a future block silently prices against the live goal instead of the queued
  one, and nothing would surface it.

---

## 8. Owed smokes

- Commit 4 (`16f4e20d`): partially smoked — it is what found §5's defects. Re-smoke after
  commit 5.
- Measurement-log commit 8cc (`1ef0cfee`): its own nutrition smoke is still owed — on a client
  with a block longer than eight weeks, the coach's nutrition calendar should show targets in
  the block's final week.
