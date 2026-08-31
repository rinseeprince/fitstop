# Check-in review — correctness pass

Three commits fixing figures on the coach's check-in review surface that disagree with each
other or with the data. Opened 2026-08-31 from an owner report against check-in
`440112cd-6161-4cb8-ace3-d95ab51417e9` (client `f87bee53`, period 2026-08-25 → 31).

**Not a redesign.** `docs/CHECK-INS-COACH-EXECUTION-PLAN.md` §2.6 deferred the Comparison &
Trends / Goal Progress *redesign* to its own session and that still stands. These are
correctness fixes to figures already on screen.

**The pattern underneath all three:** the same fact computed in more than one place with no
single owner. Weight change had five spellings, "workouts completed" has two, goal state is
derived twice and the two contradict. This repo's established answer is one pure kernel plus a
scan test that fails when a second spelling appears — `checkInWeekday`, `applySetSpecEdit`,
`recalculateClientEnergy`. Each commit below should end with an owner and a guard, not with
three corrected numbers.

---

## Ledger

| # | Issue | Disposition |
|---|---|---|
| 1 | The AI read logging coverage as intake and reported a client who hit target on both logged days as severely under-eating | **N1 — SHIPPED + SMOKED, CLOSED** |
| 2 | Training reads 3/5 in the ribbon, 2 in the comparison pane, "2 out of 5" in the AI summary | **N2** |
| 3 | Weight goal: 100% Complete + "On track" + "Remaining 5kg" on a goal overshot by 5 kg | **N3** |
| 4 | Body Fat: 100% Complete + "Needs attention" — same situation, opposite verdict | **N3** |
| 5 | Pace note ("will reach the goal by the deadline") contradicts the projected date (18 Nov vs a 31 Oct deadline) | **N3** |
| 6 | "vs previous week" rendered against a check-in 92 days old | **N2** (one string; folded there because it is the same file and the same theme) |
| 7 | −7 kg on the nutrition regeneration banner | **Closed, not a bug.** Provenance verified: `body_metrics` held 79 kg (`source: check_in`, 2026-08-27 15:26); the plan saved at 22:32 that day snapshotted it as `base_weight_kg`. The check-in was later deleted; the snapshot survives by design. A snapshot is the correct baseline for "have they drifted from the weight these targets were built for" — re-deriving it from the live series would make the banner change its mind retroactively. |
| 8 | The AI review sits at the bottom of the Current pane | **Dropped** (owner, 2026-08-31) — card movement only |
| 9 | `kpi-ribbon.tsx:131` comments that the hero "matches … the comparison tab exactly", which is false | folded into **N2** |
| 10 | `body_metrics` holds duplicate, orphaned and future-dated rows | **Recorded in `TECHNICAL-DEBT.md`**, no code. Nothing reads it for a current value. |
| 11 | This surface counts full+partial; the Overview kernel counts full-only | **Stays named deferred debt** (CONVENTIONS §8). N2 fixes the screen and says so; it does not close the schism. |

### Owner decisions (settled — do not re-ask)

- **The weight/body-fat comparison source does not change.** A check-in is a periodic report, so
  it reports against the previous *check-in*; a measurement logged in between belongs to the
  Journey series. This retires `deriveWeekComparison` as a competing spelling — the two surfaces
  answer different questions by design, which is a boundary, not a divergence. (Owner, 2026-08-31,
  reversing two earlier drafts: an as-of lookup at `period_start − 1`, and a same-day-last-week
  rule. Both were rejected as complexity, and the second because it blanks the cell.)
- **The label becomes "vs last check-in"** for weight and body fat — true whatever the interval,
  and one shared string because both metrics go through `buildComparison`. "vs start" survives for
  a first check-in.
- **Partials count in the training numerator**, and the ribbon's `60%` is replaced by the
  breakdown. The percentage still drives the cell's amber accent internally.
- **`check_ins.workouts_completed` is not touched** — it is on the RN wire
  (`app/api/client/check-ins/[id]/route.ts:91`, `lib/mappers.ts:182`) and a silent change of
  meaning would rewrite every historical row, the D5.2 problem again.

---

## N1 — the AI's nutrition read

**The defect.** The client logged 2 of 7 days, at 2442/2442 and 2553/2553 — target hit to the
calorie, both days. The prompt was handed `Weekly consumed: 4995` against `Weekly target: 14545`,
`Weekly adherence: under (34.3%)` — beside `days under: 0`, a contradiction it had to resolve —
and a system prompt instructing it to "frame nutrition through a weekly lens, not a daily one".
It reported very low calorie intake and warned about energy and recovery. The 34.3% is correct
and deliberate (D5.2: adherence divides by the whole period). What was missing was any figure
answering *were they eating enough*, which divides by the days with data.

**The fix: move the judgement out of the model.** Compute the intake characterisation
deterministically and pass it as a stated fact; name the whole-period figure as coverage.

### STATUS — SHIPPED 2026-08-31 in `945c957b`, SMOKED CLEAR the same day. N1 is CLOSED.

**Smoke (owner, 2026-08-31).** Regenerated the AI review on `440112cd`: the summary now reads
the week correctly — sparse logging is reported as a data-quality problem, not as under-eating.
The false intake claim and the energy/recovery warning are gone.


**What shipped.**

- `types/weekly-nutrition.ts` — four nullable fields (`loggedTargetCalories`,
  `loggedDayMeanConsumed`, `loggedDayMeanTarget`, `loggedDayAdherencePercentage`), documented as
  the *average* half of the split whose *adherence* half the type already documented.
- `utils/weekly-nutrition-helpers.ts` — `loggedTargetCalories` accumulates **inside the
  `consumed != null` branch**, deliberately not reusing the running target total: a row can carry
  a target with no consumed value, and only days with both are a like-for-like comparison.
- `utils/ai-prompt-builder.ts` — the nutrition block leads with intake on the logged days, names
  the whole-period figure "Logging coverage", states that unlogged days are unknown rather than
  zero, and forbids characterising intake from the coverage figure. `Weekly adherence:` and
  `Weekly consumed:` are gone. Calories are rounded at the display boundary only.
- `utils/ai-system-prompt.ts` — "Frame nutrition through a weekly lens, not a daily one" replaced
  by the two-denominator rule.

**What the model now receives** for `440112cd` (printed from the real figures):

```
**NUTRITION - 2 of 7 days logged:**
- Intake on the days they logged: 2498 cal/day against a 2498 cal/day target (100% of target)
- Of those 2 logged days: 2 on target, 0 over, 0 under
- Logging coverage: 4995 of 14545 cal targeted across the 7-day period (34.3%)
- The 5 unlogged days hold NO data. They are unknown, not zero.
- Describe their intake ONLY from the logged-day figures above, and say how many days those
  rest on. Never infer under-eating, low energy availability or poor recovery from the
  coverage figure - it measures logging, not eating.
```

**Deviations.** One, cosmetic: calories are `Math.round`ed in the prompt (2498, not 2497.5) while
the stored mean keeps its decimal. Whole calories are what a coach reads.

**Verification.** The seven real `nutrition_events` were summed independently and reproduce the
AI's own figures exactly — 14545 target, 4995 consumed, 34.3% — which is what establishes that
the numbers were right and only their interpretation was wrong.

**Gates.** `tsc` exit 0 · `eslint` 0 errors / 154 warnings (baseline) · `vitest` 332 files /
3575 tests · `check:labels` OK. **8 of 8 new assertions verified FAILING** on the pre-fix commit
in a detached worktree, with the 13 pre-existing prompt tests still passing there.

**§2 review.** Triggers do not fire: no migration, no new route, no auth change, no new write
path, 4 source files. The prompt grows ~2 lines against a 2000-token completion budget, and the
number of model calls is unchanged.

**Unverified.** Not smoked in a browser. **No AI summary has been regenerated with the new
prompt** — the fixture test pins the prompt's *content*, not the model's output, and whether the
model now reaches the right conclusion is the smoke item. Historical rows keep their old text;
Regenerate is the manual retry.

---

## N2 — one training number

Ground truth for the period: 5 prescribed, **2 full, 1 partial, 2 missed**.
`summariseSessions` (`lib/check-in/adherence.ts:72`) counts full+partial = 3; the stored
`check_ins.workouts_completed` counts full only = 2. Both are rendered on one screen. The
divergence is already documented at `types/coach-overview.ts:92` and
`check-in-details-service.ts:76`, whose note ends "both are defensible, both on one screen is
not."

- **Ribbon** keeps the full+partial numerator; the `60%` is replaced by a sub-line naming both
  counts — `All complete` (0/0) · `1 partial` · `2 missed` · `1 partial · 2 missed`. Accent still
  derives from the percentage internally, so 3/5 stays amber.
- **AI prompt** (`ai-prompt-builder.ts:115`) moves off `current.workoutsCompleted` onto the
  derived figure. `CheckInWithDetails` already carries `sessionCompletions`; no new fetch.
- **Comparison pane** must derive for the *previous* check-in too — one extra
  `deriveSessionCompletionsForCheckIn` in `getComparisonData` (which already runs 5 reads in
  parallel; constant, not per-row). Pointing only the current side at the derived number would mix
  two definitions inside one subtraction, which is worse than the bug.
- **The AI's historical block** (`ai-prompt-builder.ts:207`) lists up to 10 previous check-ins with
  `Workouts: N`. Deriving for all 10 is a query per row (§2 item 7). **Delete that line** rather
  than mix definitions or add 10 queries.
- **`kpi-ribbon.tsx:107-108`** — `"vs previous week"` becomes `"vs last check-in"`. One string,
  both metrics, since weight and body fat share `buildComparison`.
- **Delete the false comment** at `kpi-ribbon.tsx:131-132`.
- **Guard:** a scan test asserting no surface renders `workoutsCompleted` as a completion count
  except the RN wire mapper.

---

## N3 — goal state

With current 72, goal 77, start 88, `calculateGoalProgress` (`utils/comparison-utils.ts:46-89`)
returns `remaining = +5`, `percentComplete = 145.5%` clamped to 100, and `isOnTrack = false` —
which is **correct**, they are moving away from 77. `computeGoalPace` (`lib/check-in/goal-pace.ts:38`)
then takes `Math.abs(remaining)`, treats "met" as only `< 0.05`, computes a required 0.56 kg/week
against a 0.72 safe ceiling and returns `on_track`; `weight-goal-card.tsx:37-46` lets that
**override** the correct `isOnTrack: false`. Body Fat has no pace override, which is the entire
reason the two cards disagree about the same client.

The root cause is that the module models a goal as a scalar distance with no direction and no
terminal state.

- `calculateGoalProgress` gains a **state** — `approaching | achieved | overshot | reversed` —
  derived once from `sign(goal − start)`.
- An achieved goal reads **"Goal met"**, not "100% Complete".
- `remaining` stays signed and the **six `Math.abs` call sites go** —
  `weight-goal-card:113,132`, `body-fat-goal-card:67,83`, `goal-progress-view:131,145`. They are
  the symptom; leaving them means the next negative is swallowed silently again.
- `computeGoalPace` takes the state and returns no required rate and no projection once the goal
  is met.
- The pace note and the projected completion date derive from one computation, so they cannot
  contradict.
