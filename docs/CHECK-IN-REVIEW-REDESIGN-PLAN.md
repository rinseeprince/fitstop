# Check-in review — one-page re-layout

**Status: DRAFT — not approved, no code written.**

This is the "own definition session" that `docs/CHECK-INS-COACH-EXECUTION-PLAN.md` §2.6
deferred. Its recorded defect list is folded in below rather than re-derived.

## 0. Ruling order and scope

**The repo rules. The prompt and the HTML mockup are a baseline** (owner, 2026-08-31). Where
the mockup asks for something the repo already answers differently, the repo wins and the
conflict is recorded in §7.1.

**This is a UI/UX change only.** No shape change of any kind:

- **No API, service, RPC, type or migration change.** `services/comparison-service.ts`,
  `app/api/check-in/**` and `types/check-in.ts` are **not touched**.
- **No calculation change.** Every number keeps its current source, denominator and rounding.
  The owner is fixing several number bugs in parallel; this plan neither fixes nor designs
  around them.
- **No behaviour change.** Every empty state, loading state, error state and conditional
  branch behaves as it does today.
- **Nothing is removed** except what the owner named explicitly (§1 D2).

The goal is legibility and navigation: kill the three-tab switcher, put one check-in on one
page, in the order the review actually runs.

---

## 1. Decisions taken (owner, 2026-08-31)

| # | Decision |
|---|---|
| **D1** | **No baseline control.** The mockup's last-check-in / 4-weeks-ago / start switcher is dropped. Comparisons stay exactly as today: against the **last check-in**, falling back to `vs start` on a first check-in as the code already does. Reason: "4 weeks ago" is on the wire for no metric, and training/nutrition cannot follow any baseline but the last check-in without one server derivation per historical check-in |
| **D2** | **Goal progress is the strip as drawn** — four columns per row: name, progress track, `start → goal`, state. This drops the projections the brief named (Estimated Time, Projected Goal Date, the Required/Safe-ceiling pace bars) **and** the percent-complete number, the current value, the remaining figure and the average-weekly-change row. Two rows, four columns, nothing else fits |
| **D3** | **No prev/next between check-ins.** Removed deliberately at D1.3 and it stays removed. Back to the list is one click |
| **D4** | **Everything else keeps a home** — Client Notes, PR highlights, the regeneration banner. *(Narrowed by D5.)* |
| **D6** | **No sparklines on the band.** A trend line behind a value and a delta reads as chart junk on the dark strip. All four cells are value + delta + accent dot. `trend-sparkline.tsx` (the last recharts usage on this surface), `prepareChartData`, `ProgressChartData` and the response's whole `chartData` key go with them |
| **D5** | **Comparison & Trends is DELETED, not re-homed.** Weight and body fat are the band's first two cells, the Wellbeing card is the Wellness section's five deltas, and the "Adherence" row mixed a training value with a nutrition series. Going with it: the **five girth measurements** (still charted on Journey → Physique) and the **workouts-completed delta**, which the band's fraction and breakdown already answer. The "N days since last check-in" line moves to the header — every delta on the page reads "vs last check-in", so the gap has to be stated somewhere |

---

## 2. Current surface — file map

```
components/clients/check-ins/check-in-detail-view.tsx   232  header + SegmentedControl + 3 TabsContent
hooks/use-check-in-detail-data.ts                       243  3-stage SWR (detail ∥ comparison → logs → plan targets)

  pane "current"
    components/check-in/kpi-ribbon.tsx                  278  dark 4-cell band
    components/check-in/wellness-section.tsx            133  5 metrics × 7-day bars
    components/check-in/nutrition-section.tsx           210  period kcal total + macro averages
    components/check-in/training-section.tsx            151  session list + PR strip
    components/check-in/habits-section.tsx               73  per-habit dots
    components/check-in/client-notes-section.tsx         98  Reflection / Wins / Challenges / Coach questions
    components/check-in/check-in-review-rail.tsx        208  sticky 380px AI card
      components/check-in/check-in-share-card.tsx       126  Share-with-client sub-block

  pane "comparison"
    components/check-in/check-in-comparison-view.tsx    229  Physique / Performance / Wellbeing
      components/check-in/trend-sparkline.tsx            44  recharts, h-8 w-20

  pane "goals"
    components/check-in/goal-progress-view.tsx          168  banner + 3 cards + summary card
      components/check-in/goal-deadline-card.tsx         49
      components/check-in/weight-goal-card.tsx          240
      components/check-in/body-fat-goal-card.tsx        108
      components/clients/nutrition/nutrition-regeneration-banner.tsx (shared)

  shared primitives (unchanged)
    components/clients/check-ins/review-block.tsx        ReviewBlock / ReviewProse / ReviewList / ReviewListRow
    components/check-in/mini-bar-sparkline.tsx           per-day wellness bars
    components/programs/shared/section-label.tsx         SectionLabel — the rail
```

Two reads feed all of it, both already SWR, both already parallel, **both unchanged**:

- `GET /api/check-in/[id]` → `{ checkIn (+ sessionCompletions, exerciseHighlights, customAnswers), client, periodAdherence }`
- `GET /api/check-in/[id]/comparison` → `{ comparison, goalProgress }`

plus `useWellnessData(range)` for the period's daily logs and a dependent
`…/nutrition/plan-targets?dates=` for the unlogged days.

---

## 3. Target page

One `space-y-5` column. Each section is a `<SectionLabel>` rail over a borderless white card
on `#f4f7f6`.

| § | Rail | Card contents | Fed by |
|---|---|---|---|
| — | *(no rail)* | Back row `← Check-ins`, week range, submitted date, days-logged chip | detail |
| **1** | *(no rail — the band is its own object)* | Dark 4-cell band: Weight · Body Fat · Nutrition · Training. Value, delta and an accent dot per cell — **no sparklines** (D6) | detail + comparison |
| **2** | `TRAINING` ∥ `NUTRITION` | Two cards side by side. Training: per-session list + PR strip. Nutrition: kcal total vs target, verdict pill, macro bars | detail + logs + plan targets |
| **3** | `WELLNESS` | Five metrics in one row: value, `vs last check-in` delta, per-day sparkline | logs + comparison |
| **4** | `HABITS` | Compact rows: name · hits · per-day dots | detail (`periodAdherence.habits.perHabit`) |
| **5** | `CLIENT NOTES` | Reflection · Wins · Challenges · Coach questions | detail |
| **6** | `GOAL PROGRESS` (meta: deadline) | Regeneration banner when it fires, then the strip: 2 rows × 4 columns | comparison |
| **7** | `REVIEW` (action: Regenerate) | Summary · What to watch · Coach actions | detail |
| **8** | `REPLY` | Full-width textarea + Send (the page's single primary button) + Copy | detail |

---

## 4. Component inventory

### 4.1 New — 3 files

| Component | Path | Why |
|---|---|---|
| `CheckInReviewHeader` | `components/clients/check-ins/check-in-review-header.tsx` | The header block extracted so the page shell stays under CONVENTIONS §4's 250-line limit. Pure move — same markup, same strings |
| `CheckInGoalStrip` | `components/clients/check-ins/check-in-goal-strip.tsx` | D2's strip. Replaces four files with one card of rows |
| `CheckInReplyBlock` | `components/clients/check-ins/check-in-reply-block.tsx` | The reply promoted out of the AI card into its own section. Carries `check-in-share-card.tsx`'s send/copy logic verbatim |

New files go in `components/clients/check-ins/` per CONVENTIONS §6. `components/check-in/` is
the **mixed** tree — client wizard steps live there with their own importers — and is
deliberately not relocated, the precedent `review-block.tsx` already set (plan §2.7).

### 4.2 Modified — 10 files

| File | Change | Risk |
|---|---|---|
| `check-in-detail-view.tsx` | `Tabs` + `SegmentedControl` + 3 `TabsContent` → one railed column. Keeps the foreign-client guard, the spinner and all three notices | layout |
| `wellness-section.tsx` | Five metrics laid out as one row instead of a grid of tiles; each gains a `vs last check-in` delta from `changes.*`. Takes `changes` as one new prop. Value and sparkline unchanged — see §7.2 C2 | render + 1 prop |
| `training-section.tsx` | Borderless shell, framer removed, icon+label header → rail. Rows, states, detail lines, PR strip unchanged | style only |
| `nutrition-section.tsx` | Same shell treatment; two-column body kept | style only |
| `habits-section.tsx` | Same shell treatment; rows go compact (name · count · dots on one line) | style only |
| `client-notes-section.tsx` | Same shell treatment. Content untouched | style only |
| `check-in-review-rail.tsx` | Stops being a sticky 380px rail; becomes a full-width section under a rail with Regenerate in the rail's `actions` slot. Loses the Share sub-block to `CheckInReplyBlock`. Every AI string and the `ReviewBlock` vocabulary unchanged | layout |
| `check-in-detail-view.test.tsx` | Mocks are per-child; the child list changes | test |

### 4.3 Deleted — 6 files

| File | Where it goes |
|---|---|
| `goal-progress-view.tsx` | → `CheckInGoalStrip`. The regeneration banner is re-mounted above it; the Progress Summary card goes — it restates the two rows and derives its verdict from the weight goal alone, a contradiction recorded in `TECHNICAL-DEBT.md` |
| `weight-goal-card.tsx` | → one strip row (D2) |
| `body-fat-goal-card.tsx` | → one strip row (D2) |
| `goal-deadline-card.tsx` | → the `GOAL PROGRESS` rail's meta |
| `check-in-share-card.tsx` | → `CheckInReplyBlock` |
| `check-in-comparison-view.tsx` (+ `.test.tsx`) | **D5.** Weight/body-fat rows → the band's cells 1–2, which already carried their values and deltas. Wellbeing card → §3's five deltas. Girths, the workouts-completed delta and the "Adherence" row are dropped |
| `trend-sparkline.tsx` | **D6.** Its last importer went with the sparklines |
| `goal-cards.test.tsx` | Rewritten against the strip |

**Fields that stop being rendered but keep being computed.** D2 leaves
`goalProgress.weight.requiredRate`, `.safeCeiling`, `.projectedCompletionDate`, `.weeksToGoal`,
`.avgWeeklyChange` and `goalProgress.bodyFat.avgChange` with no reader. **They stay on the
wire** — removing them is a service change, which §0 forbids. `computeGoalPace` keeps its
caller because `paceStatus` still drives the strip's state badge, and `percentComplete` keeps
its reader because it fills the track.

**Orphan chain — grep at execution time, never from this list** (CONVENTIONS §2, and the
training-builder P7 rule). `TrendDirection` in `types/check-in.ts` has six other importers and
**must survive**. Run `npx knip` after every commit.

---

## 5. Mapping — every element on the three tabs

Legend: **=** unchanged, re-homed · **→** re-laid-out, same data · **✂** dropped (with the
decision that dropped it)

### 5.1 Pane "Current Check-In"

| Element | Source | New home |
|---|---|---|
| Back row `← Check-ins` | `check-in-detail-view.tsx:114-126` | = header, unchanged |
| Week range, mono | `formatDateRange`, `:43-55` | = header title |
| `"Submitted Aug 31"` | `formatSubmittedDate`, `:57-60` | = header meta |
| `"{n}/{d} days logged"` chip, **teal** | `:140` | = header. Denominator stays the local span, as today |
| `SegmentedControl` (3 panes) | `:137` | ✂ — the whole point |
| Band: Weight — value, unit, delta, `"vs last check-in"` / `"vs start"`, dot | `kpi-ribbon.tsx:186-197` | = §1 cell 1, unchanged |
| Band: Body Fat — value or `"Not tracked"` | `kpi-ribbon.tsx:198-206` | = §1 cell 2, unchanged |
| Band: Nutrition — `onTarget/periodDays`, `"{pct}%"`, `"days on target"` / `"No nutrition logs"` | `kpi-ribbon.tsx:207-215` | = §1 cell 4, unchanged |
| Band: Training — `completed/prescribed` (full **+ partial**), `"N partial · N missed"` / `"All complete"` / `"No sessions prescribed"` | `kpi-ribbon.tsx:216-225` | = §1 cell 3, unchanged |
| Wellness `"Wellness"` + Heart icon | `wellness-section.tsx:83-86` | → §3 rail `WELLNESS`; icon ✂ (`SectionLabel` has no icon slot) |
| Wellness: 5 per-metric averages over each metric's own logged days | `wellness-section.tsx:89-114` | → §3 row values, **same maths** |
| Wellness: `"/ 5"` `"/ 10"` captions | `wellness-section.tsx:28-34` | → §3, beside the value |
| Wellness: `MiniBarSparkline` — 7 day-bars, tone-coloured, day letters, hover titles | `mini-bar-sparkline.tsx` | → §3 sparkline slot, unchanged |
| Nutrition `"Nutrition"` + Utensils | `nutrition-section.tsx:144-147` | → §2 rail `NUTRITION` |
| Nutrition: period kcal total + `"of {n} kcal target"` (28px mono) | `nutrition-section.tsx:151-159` | → §2, **stays the headline** |
| Nutrition: `HIT`/`PARTIAL`/`MISSED` + `"{n}/{d} on target"` pill | `nutrition-section.tsx:160-173` | → §2 |
| Nutrition: progress bar | `nutrition-section.tsx:174-180` | → §2 |
| Nutrition: `"Avg {n} kcal / logged day"` | `nutrition-section.tsx:181-183` | → §2, stays the sub-line |
| Nutrition: `"Avg macros / logged day"` + 3 macro rows | `nutrition-section.tsx:186-210` | → §2, unchanged maths |
| Training `"Training"` + Dumbbell | `training-section.tsx:71-78` | → §2 rail `TRAINING` |
| Training: `"{n} of {m} completed"` header meta | `training-section.tsx:75-84` | → §2 rail meta |
| Training: per-session rows — day, name, detail line, notes, status pill | `training-section.tsx:86-123` | → §2 list, unchanged |
| Training: `"Logged in full"` / `"Marked complete"` / `"Stopped early"` / `"Skipped"` / `"Not logged"` | `training-section.tsx:44-52` | = verbatim |
| Training: `"Completed"` / `"Partial"` / `"Missed"` pills | `training-section.tsx:36-40` | = verbatim — repo wording, not the mockup's "Complete" |
| Training: session `notes`, italic quotes | `training-section.tsx:107-111` | = kept on the row |
| Training: **PR highlight strip** (Trophy, exercise, load × reps) | `training-section.tsx:124-147` | = §2 card footer (D4) |
| Habits `"Habits"` + RotateCw | `habits-section.tsx:35-38` | → §5 rail `HABITS` |
| Habits: name, `completedDays/eligibleDays`, rail dots, `"Not yet added"` dashes | `habits-section.tsx:41-66` | → §5 compact rows, unchanged |
| Client Notes `"Client Notes"` + MessageSquare | `client-notes-section.tsx:57-60` | → §6 rail `CLIENT NOTES` |
| Client Notes: `"Reflection"` / `"Wins"` / `"Challenges"` | `client-notes-section.tsx:64-80` | = §6, unchanged |
| Client Notes: `"Coach questions"` — prompt (muted) + answer (ink), live-joined through the question FK | `client-notes-section.tsx:82-97` | = §6, unchanged (D4) |
| AI card: `"AI review"` + Sparkles + Regenerate | `check-in-review-rail.tsx:107-123` | → §8 rail label + `actions` slot |
| AI card: `"No AI review yet. Regenerate to write one."` | `check-in-review-rail.tsx:127` | = §8 empty state |
| AI card: `"Summary"` | `check-in-review-rail.tsx:132-136` | = §8 |
| AI card: `"What to watch"` + win/risk/trend/flag icons | `check-in-review-rail.tsx:138-165` | = §8 |
| AI card: theme chips (`NeutralChip`) | `check-in-review-rail.tsx:166-174` | = §8 |
| AI card: `"Coach actions"` + priority dot + sr-only `"High/Medium/Low priority"` | `check-in-review-rail.tsx:172-198` | = §8 — repo wording, not the mockup's "Suggested actions" |
| AI card: sticky `lg:top-[52px]` | `check-in-detail-view.tsx:180` | ✂ full width |
| Share: `"Share with client"` label | `check-in-share-card.tsx:76` | → §9 rail `REPLY` (§8 C1) |
| Share: Edit pencil ⇄ Check toggle | `check-in-share-card.tsx:77-99` | ✂ the textarea is always live (brief §8) |
| Share: `Textarea` / `"No draft message yet."` | `check-in-share-card.tsx:100-102` | → §9, always the textarea |
| Share: `Send` + `Copy` | `check-in-share-card.tsx:104-124` | → §9. Send is the page's single primary button |
| Share toasts ×5, Regenerate toasts ×2 | `:42-73`, `check-in-review-rail.tsx:85-91` | = verbatim |
| `"This check-in belongs to another client."` | `check-in-detail-view.tsx:145` | = page-level |
| `"Failed to load check-in data"` | `check-in-detail-view.tsx:222` | = page-level |
| Loading spinner | `check-in-detail-view.tsx:62-66` | = page-level for the detail; §7.3 B8 for the comparison-fed sections |

### 5.2 Pane "Comparison & Trends"

| Element | Source | New home |
|---|---|---|
| `"Progress comparison"` / `"Baseline established"` heading | `check-in-comparison-view.tsx:155-157` | ✂ the rail replaces it |
| `"Comparing with the check-in from {n} days ago"` | `:158-162` | → the **header** meta line, as `"{n} days since last check-in"` (D5) |
| `"This is the first check-in. 1 data point, trends build next week."` | `:162` | ✂ **D5.** The band already falls back to `vs start` on a first check-in |
| `"Physique"` heading | `:167` | ✂ its two remaining metrics are the band's |
| Weight trend row (value + delta + sparkline) | `:169-176` | → §1 cell 1 — **sparkline only**; value and delta are already there |
| Body Fat trend row | `:177-184` | → §1 cell 2, same |
| Waist / Hips / Chest / Arms / Thighs delta rows (`formatLength`, waist inverse) | `:185-189` | ✂ **D5** — charted on Journey → Physique |
| `"Performance"` heading | `:195` | ✂ folded into §4's rail |
| `"Workouts completed"` delta row | `:197` | ✂ **D5** — the band's fraction + `N partial · N missed` answer it |
| `"Adherence"` trend row | `:198-204` | ✂ **D5** — the known mixed-metric defect goes with the row (§7.2 C1) |
| Delta colour rule (teal good / amber bad / muted none) | `:23-28` | = carried into §1 and §3 |
| `TrendSparkline`; `<2` points → dashed ghost + `aria-label="Trend builds next week"` | `trend-sparkline.tsx:17-23` | = **reused as-is** in §1's band cells. Not rewritten — reuse beats a rewrite under §0 |
| `"Wellbeing"` card — 5 trend rows (Mood /5, Energy /10, Sleep /10, Stress /10 inv, Soreness /10 inv) | `:207-220` | → §3, as the five deltas |
| `"Failed to load comparison data"` | `check-in-detail-view.tsx:207` | ✂ **D5** — with the pane gone, the comparison read has one dedicated section (§6, Goal progress) and it keeps `"Failed to load goal progress data"`. The band's deltas and §3's deltas degrade in place |

### 5.3 Pane "Goal Progress"

| Element | Source | New home |
|---|---|---|
| `"Goal Progress"` heading | `goal-progress-view.tsx:95-101` | → §7 rail `GOAL PROGRESS` |
| `"Tracking {name}'s progress towards their goals"` | `:99-101` | ✂ a rail meta is not a sentence |
| Empty: `"No goals have been set for {name} yet."` + Target icon + `"Set goals in the client profile to track progress here."` | `:71-87` | = §7 empty state, verbatim (B5) |
| `NutritionRegenerationBanner` | `:102-112` | = §7, above the strip, **unchanged** (D4) — see §7.2 C3 |
| `GoalDeadlineCard`: `"Goal Deadline"`, `"Target Date: {date}"`, `"{n} days remaining"` / `"Overdue by {n} days"` | `goal-deadline-card.tsx` | → §7 **rail meta** |
| `"Weight Goal"` / `"Body Fat Goal"` titles | `weight-goal-card.tsx:96-101` | → strip row names `Weight` / `Body fat` |
| Badge `"Goal met"` / `"On track"` / `"Behind pace"` / `"Deadline unrealistic"` / `"Needs attention"`, precedence `status` > `paceStatus` > `isOnTrack` | `weight-goal-card.tsx:51-64` | → strip **state** column, **precedence preserved exactly** |
| Progress bar + `"Start: {x}"` / `"Goal: {y}"` | `weight-goal-card.tsx:113-126` | → strip **track** + `start → goal` column |
| `"Goal met - consider setting a new target."` | `weight-goal-card.tsx:225-233` | → strip state column, met case |
| `percentComplete` + `"Complete"` | `weight-goal-card.tsx:103-110` | ✂ **D2** — the value still fills the track |
| `"Current Weight"` / `"Current Body Fat"` | `weight-goal-card.tsx:129-137` | ✂ **D2** — the band's cells 1–2 carry it |
| `"Remaining"` / `"Goal met"` | `weight-goal-card.tsx:138-153` | ✂ **D2** |
| `"Average Weekly Change"` / `"Average Change Per Check-In"` | `weight-goal-card.tsx:158-175` | ✂ **D2** |
| `"Estimated Time"` | `weight-goal-card.tsx:176-187` | ✂ **D2** |
| Pace check: `"Pace check"`, `"Required"`, `"Safe ceiling"`, the two bars, `paceNote` | `weight-goal-card.tsx:191-223` | ✂ **D2** |
| `"Projected Goal Date"` + relative | `weight-goal-card.tsx:236-251` | ✂ **D2** |
| Progress Summary card + `progressNote` | `goal-progress-view.tsx:122-165` | ✂ restates the rows; its verdict derives from the weight goal alone (`TECHNICAL-DEBT.md`) |
| `"Failed to load goal progress data"` | `check-in-detail-view.tsx:219` | → §7 error state |
| `"Set new goals"` button (mockup) | — | ✂ the goal editor is the client details sheet, not mounted here (§7.1 #11) |

---

## 6. What the strip renders in each goal state (D2)

D2 leaves four columns to say everything, so the **state** column carries the whole verdict.
Every string below already exists.

| State | Track | `start → goal` | State column |
|---|---|---|---|
| Under target, pace safe | partial fill | `88 → 77 kg` | `On track` |
| Under target, pace unsafe | partial fill | `88 → 77 kg` | `Behind pace` / `Deadline unrealistic` |
| Under target, moving away | partial fill | `88 → 77 kg` | `Needs attention` |
| At target (`achieved`) | full | `88 → 77 kg` | `Goal met` |
| Past target (`overshot`) | full | `88 → 77 kg` | `Goal met` — **the mockup's `"Reached · 5 kg past target"` is new copy** (§8 C4) |
| No deadline | as above | as above | as above; the rail meta is absent |
| Deadline passed | as above | as above | rail meta reads `"Overdue by {n} days"` |
| One goal only | one row | | |
| No goals | — | — | the verbatim empty state (B5) |

`percentComplete` is clamped 0–100 and already reads 100 once a goal is met, so the track is
correct for under-target, at-target and past-target with no new logic.

---

## 7. Flags

### 7.1 Mockup vs repo — resolved, repo wins

| # | Mockup / prompt | Repo | Resolution |
|---|---|---|---|
| 1 | 3-option baseline control | `vs last check-in`, else `vs start` | **D1** — dropped |
| 2 | prev/next + `"12 of 12"` | removed at D1.3 | **D3** — stays out |
| 3 | sparkline in all four band cells | series exist for weight and body fat only | those two get one; Training and Nutrition do not (§7.2 C1) |
| 4 | `2 of 5 complete` (full only) | `3/5` = full + partial, `1 partial · 2 missed` beneath | repo. One `summariseSessions` feeds the band, the §4 delta and the AI prompt; partial is already named, not folded silently |
| 5 | `Nutrition logged — 2 of 7 days` | days **on target** over the whole period | repo — the cell was deliberately moved off a logged-days figure |
| 6 | nutrition headline = per-logged-day average | headline = period total vs whole-period target; the average is the sub-line | repo — adherence and averages take different denominators on purpose |
| 7 | hand-rolled `.rail-range` switcher | `<SegmentedControl>` only; `check:labels` clause 3 fails the build | moot under D1 |
| 8 | amber `2/7 days logged` chip | teal, unconditional | repo — amber asserts a judgement the product does not make |
| 9 | `--danger:#c06060` for status | two-colour teal/amber, no red | repo (the prompt agrees) |
| 10 | `Open training` / `Open nutrition` links | do not exist | repo — new cross-tab nav, and it would land on *today*, not the check-in's week |
| 11 | `Set new goals` button | editor is the client details sheet | repo |
| 12 | Client Notes dropped | renders today | **D4** — keeps §6 |
| 13 | no home for girths / PRs / workouts delta / banner | all render today | **D4** — §4, §2 footer, §4, §7 |
| 14 | `Complete` · `Suggested actions` · `Reply to Sam` · `Send and mark reviewed` | `Completed` · `Coach actions` · `Share with client` · `Send` | repo, unless you write new copy (§8) |
| 15 | section icons | rails have no icon slot | rails — the repo's own grammar |

### 7.2 Consequences of putting three tabs on one page

**C1 — The `"Adherence"` row's defect is gone with the row.** It rendered a **training**
completion pct above a sparkline of the stored **nutrition** `adherence_percentage` (§2.6,
verified). D5 deletes it. **`chartData.adherence` is still the reason the Nutrition band cell
gets no sparkline** — it is the nutrition series, and wiring it into that cell would be quietly
deciding which metric it is, which is the same mistake in a new place. Training has no series
at all.

**C2 — The Wellness row's value and its delta come from two sources.** The value is the
per-metric average over `dailyLogs` (today's Wellness card); the delta is `changes.mood.change`
etc., computed from the **stored snapshot** columns (today's Comparison tab). `ARCHITECTURE.md`
records that these now agree by construction — `calculateMetricAverages` writes the snapshot
with the same per-metric denominator — so they match unless a wellness log lands **after**
submission. When that happens the delta will not exactly reconcile with the value beside it.
True today; putting them on one line is what makes it visible. No fix here (§0).

**C3 — The regeneration banner is carried unchanged, and it is half-broken.** Legacy OKLCH
tokens (`bg-warning/10`, `rounded-lg`) against a Teal-Summit page, and its Regenerate button
`router.push`es `/clients/{id}#nutrition` — a hash that stopped addressing anything when tabs
became `?tab=` — then raises a toast titled `"Navigate to Client Profile"`. D4 keeps it, §0
forbids fixing it. **Its −7 kg reading is correct** (it compares against the plan's
`base_weight` snapshot) — do not "fix" that.

**C4 — Weight and body fat now appear twice on one page:** value + delta in the band, and
`start → goal` in the goal strip. Different statements — this period vs the whole journey — but
adjacent for the first time. Intentional; flagged so it is not later read as duplication.

**C5 — Progress photos still render nowhere coach-side.** `photo_front` / `_side` / `_back` are
collected, stored, mapped (`lib/mappers.ts:31`) and returned by `GET /api/check-in/[id]`; the
only renderer in the repo is the **client's** own page. Not created by this work, not in scope
— recorded so the next session does not re-discover it.

### 7.3 Conditional branches the mockup does not show

| # | Branch | Today | On one page |
|---|---|---|---|
| B1 | No sessions prescribed | Band: `"No sessions prescribed"`; Training card returns `null` unless a PR exists | A rail standing over nothing is worse than an empty state → **needs a string** (§8 C5) |
| B2 | No nutrition logged | Band: `"No nutrition logs"`; card returns `null` | same → §8 C6 |
| B3 | No wellness ratings | card returns `null` | same → §8 C7 |
| B4 | No habits eligible in the period | card returns `null` | same → §8 C8 |
| B5 | No goals set | verbatim empty state | = reused |
| B6 | One goal only | one card | one strip row |
| B7 | First check-in / no previous | Band falls back to `vs start`; §4 shows `"Baseline established"` + the 1-data-point line; sparklines show the dashed ghost | = preserved exactly (D1 keeps the fallback) |
| B8 | **Comparison read fails, detail succeeds** | the two panes show their errors; the Current pane renders fine | §1's deltas + sparklines, §3's deltas, §4 and §7 are comparison-fed. **The page renders on the detail read; those four show their own spinner/error rather than blocking it.** The faithful translation of today's per-pane behaviour |
| B9 | `periodAdherence === null` (legacy row) | Nutrition and Habits cells show empty states; **no client-side fallback definition** | = preserved exactly — documented invariant |
| B10 | AI review not generated | `"No AI review yet. Regenerate to write one."`; Share stays visible | Reply being its own section makes that asymmetry structural |
| B11 | AI generation failed | the zod fallback always yields *a* summary, so it is indistinguishable from a bland one; Regenerate surfaces 429/non-OK by toast | no new state |
| B12 | **Reply already sent** | **nothing** — the detail shows the draft and a live Send whatever `responseSentAt` / `coachResponse` say | The mockup's `draft · not sent` meta implies a sent state exists. **It does not.** Leave it out (repo wins) or write the branch — §8 C3 |
| B13 | Foreign check-in | verbatim notice, no context fetched | = page-level |
| B14 | Body fat not tracked | `"Not tracked"`, muted, no delta | = unchanged |
| B15 | Custom questions asked but unanswered | block absent | = unchanged |
| B16 | Habit added mid-period | dash + `"Not yet added"` | = preserved — a habit added Wednesday has not missed Monday |
| B17 | Partial first week (`period_start` clamped to `start_date`) | the chip divides by the local span; everything else by `dates.length` | = preserved exactly, mismatch included |
| B18 | No girths submitted | `MetricRow` returns `null` per row → an empty card | §4 needs a gate so the rail does not stand over nothing |

### 7.4 Things that exist for a reason a screenshot would not show

1. **`summariseSessions` is the ONE training count.** `lib/check-in/adherence-ownership.test.ts`
   scans `components/check-in`, `components/clients`, `utils/ai-prompt-builder.ts`,
   `services/comparison-service.ts` and `services/check-in-details-service.ts`, and **fails the
   build** on `*.workoutsCompleted` (except `changes.`) or on
   `.filter(… status === "completed" …).length`. Every new file in §4.1 must obey it.
2. **The Nutrition cell is days-on-target over the whole period.** It used to be a kcal average
   over logged days and read "HIT" for 3 of 7. Never restore an average there.
3. **Averages and adherence take different denominators on purpose** — wellness means divide by
   each metric's own logged days; nutrition averages by logged days; the on-target fraction and
   the kcal total by the whole period.
4. **`"vs last check-in"`, not `"vs previous week"`** — the cell once read "vs previous week"
   above a delta measured against a check-in 92 days old.
5. **Habits come from the HABIT list, never `/habits/logs`** — `logHabit` writes only when the
   client acts, so a logs-derived grid drops the habit ignored all week.
6. **`ReviewProse` sets `whitespace-pre-wrap`** — every string there is free text someone typed.
7. **Share stays when the AI half is empty** — the reply is the coach's, not the AI's.
8. **The reply draft is a prop synced by effect, not `useState` seeded once** — Regenerate must
   replace it, and a `key`-remount would drop `isSending` mid-send. **Preserve this exactly**
   when extracting `CheckInReplyBlock`.
9. **D1.3 also killed a window keydown listener** that fired while the coach was typing in the
   reply box. It stays dead.
10. **The client-id guard** — the detail is fetched by check-in id, the context by the page's
    client id, and the API refuses only a *foreign coach*.
11. **`periodAdherence.dates.length` is the denominator, never a local day count.**
12. **The five sibling cards keep borders + framer only because D7.3 owed them the borderless
    treatment as a follow-up.** Removing them here *completes* a decision rather than making one.

---

## 8. Copy gaps — the only new strings needed

| # | Slot | Needed because | Nearest existing |
|---|---|---|---|
| C1 | §9 rail label | `"Share with client"` was a block label inside a card; a rail wants a section name | `Share with client` · mockup `Reply to {name}` |
| C2 | §9 send button, if not `Send` | the mockup's `"Send and mark reviewed"` is **accurate** — the POST sets `status='reviewed'`, `coach_reviewed_at`, `response_sent_at` | `Send` |
| C3 | §9 already-sent state (B12) | the branch does not exist today | the list row shows `"Your reply: {…}"` |
| C4 | strip state for an **overshot** goal | today it reads `Goal met`; the mockup wants the overshoot named | `Goal met` · mockup `Reached · 5 kg past target` |
| C5 | §2 Training empty state (B1) | a rail cannot stand over nothing | band's `No sessions prescribed` |
| C6 | §2 Nutrition empty state (B2) | ditto | band's `No nutrition logs` |
| C7 | §3 Wellness empty state (B3) | ditto | none |
| C8 | §5 Habits empty state (B4) | ditto | none |
| C10 | §5 rail meta (habits aggregate) | optional; derivable from `perHabit` with no wire change | `pluralize()` exists |
| C11 | Section rail labels ×8 | uppercase via `SECTION_LABEL_CLASS` | existing card titles: Wellness, Nutrition, Training, Habits, Client Notes, AI review, Goal Progress |
| C12 | Header: days since the previous check-in | new line beside the days-logged chip | shipped as `"{n} days since last check-in"` — replace if you want other wording |

---

## 9. Commit sequence

Every commit is independently revertable. After each: `npx tsc --noEmit`, `npx eslint .`,
`npx vitest run`, `npm run check:labels`, `npx knip`. **CONVENTIONS §2's security/load review is
not applicable** — no migration, no route, no auth, no write path, no data-flow change — and
that is stated in each commit rather than skipped silently.

| # | Commit | Contains | Revert restores |
|---|---|---|---|
| **R1** | **Page shell** | Tabs die; `CheckInReviewHeader` extracted; every section gets its `SectionLabel` rail and loses the in-card header the rail replaces; the `[1fr_380px]` grid goes; per-section loading/error per B8. Children otherwise mounted **unchanged**, `CheckInComparisonView` and `GoalProgressView` whole. Design-SOT reference re-pointed. See §10 | the three panes |
| **R2** | **Comparison pane deleted (D5)** | `check-in-comparison-view.tsx` + its test deleted. What survives moves in the same commit: the sparkline to the band's cells 1–2 (`kpi-ribbon.tsx`), the five wellness deltas to `wellness-section.tsx`, the check-in gap to the header. Girths, the workouts delta and the Adherence row go. One commit — deleting first would drop the survivors for a commit | the Comparison pane whole |
| **R3** | **Reply block** | `CheckInReplyBlock` extracted from `check-in-share-card.tsx`; the Review card stops rendering Share; Reply becomes §9 with Send as the page's single primary. Effect-synced draft preserved verbatim (§7.4 #8) | Share inside the Review card |
| **R4** | **Card shells** | Training ∥ Nutrition side by side; all five section cards go borderless + un-animated (completing D7.3); Habits rows go compact. **Style and layout only — not one prop changes** | bordered, stacked cards |
| **R5** | **Goal strip** | `CheckInGoalStrip` replaces `goal-progress-view.tsx` + the three cards (D2); deadline → rail meta; the met-state footer note; regeneration banner re-mounted above, unchanged; `goal-cards.test.tsx` rewritten | the Goal Progress pane |
| **R5b** | **Set new goals** | The footer's button: `onTabChange` threaded into the review, a one-shot param, Overview opening `ClientDetailsSheet` on arrival. Separate because it is the one change that leaves this surface and touches the client page's URL contract | a note with no action |
| **R6** | **Sweep** | `npx knip`, dead-import removal, docs: `ARCHITECTURE.md` → "The coach review surface" rewritten to the new shape (**current shape only — no "it used to be"**), `CHECK-INS-COACH-EXECUTION-PLAN.md` §2.6 closed, `TECHNICAL-DEBT.md` D7.3 sibling-cards row resolved, and C1/C2/C3 recorded as open defects | — |

**Two boundary changes from the first draft, and why.** (a) The separate "Review section"
commit is **absorbed into R1** — once R1 gives every section a rail, converting the AI card's
own header into that rail *is* R1's work, and a standalone commit would have been empty.
(b) The wellness/carve-out commit **moves to R2** from last-but-two, because it is what clears
the duplication R1 necessarily introduces (§10.8).

**Ordering constraints, so they are not re-derived:** R2 immediately after R1. R3 before R4
(R4 restyles a shell R3 has already split). R5 after R1. **R1 alone is a pure re-layout with
zero data change — the cheapest thing to look at before anything else is built.**

**Browser smoke is owed on R1, R4, R5 and R6** and is yours to run; I do not drive the browser.
Each ships with a checklist naming the states to force from §7.3.

---

## 10. Commit R1 — detailed spec

> `refactor(check-ins): R1 — the review is one page, not three tabs`

### 10.1 What R1 delivers

One scrolling page in the §3 order, every section named by a `SectionLabel` rail. No tab
switcher. Nothing is restyled, no card is rebuilt, no prop's meaning changes, and **not one
number moves**.

### 10.2 The rule that decides every edit

> **R1 removes exactly the label each rail replaces, and nothing else.**

So: the six in-card header rows go (their icons with them, because `SectionLabel` has no icon
slot), and the two `h3` headings on the carried-over panes go. Every `<p>`, every card title
(`h4`), every empty state and every string below those headers **stays**, including
`"Tracking {name}'s progress towards their goals"` and `"Comparing with the check-in from {n}
days ago"` — the second one especially, because a sentence in a rail's `meta` slot would be set
in mono, which `docs/newdesignsystem.md` → "Prose vs data" forbids.

### 10.3 The second rule: a section owns its own rail

Five children `return null` when they have nothing to show (B1–B4, B18). If the parent rendered
the rail, a client with no habits would get a bare `HABITS` rail over empty space, and hiding it
would mean copying each child's "do I have anything" predicate into the parent — two definitions,
one of which drifts.

**So each child renders its own `<SectionLabel>` above its own card**, inside a wrapping `div`:

```tsx
return (
  <div>
    <SectionLabel label="Training" meta={…} />
    <motion.div className="bg-white border … p-5">{/* unchanged */}</motion.div>
  </div>
);
```

`return null` then hides rail and card together, and **R1 needs none of the new empty-state
copy** (C5–C8) — those are only needed if a rail is ever to stand over an empty section, which
under this rule it never does.

### 10.4 Files

**New — 1**

`components/clients/check-ins/check-in-review-header.tsx`. A pure move: the back row, the meta
line, and the three helpers `MONTHS` / `formatDateRange` / `formatSubmittedDate` lifted verbatim
out of `check-in-detail-view.tsx`. Same markup, same `MONO` tokens, same strings, same
`aria-label="Back to check-ins"`.

```ts
type CheckInReviewHeaderProps = {
  onBack: () => void;
  /** null while loading, on a foreign check-in, or before the window resolves —
   *  the exact condition that gates the meta line today. */
  meta: {
    start: Date; end: Date; submittedAt: string;
    daysLogged: number; daysInPeriod: number;
  } | null;
};
```

**Modified — 9** (one of them also renamed, §10.12; its test file is renamed with it)

| File | Edit |
|---|---|
| `check-in-detail-view.tsx` | Drop `Tabs` / `TabsContent` / `SegmentedControl` / `PANES` / the `tab` state. Drop the `[1fr_380px]` grid and the `lg:sticky lg:top-[52px]` wrapper. Render the header + nine sections in order. Add the comparison gate helper |
| `wellness-section.tsx` | Header row (Heart + `"Wellness"`) → `<SectionLabel label="Wellness" />` above the card |
| `nutrition-section.tsx` | Header row (Utensils + `"Nutrition"`) → `<SectionLabel label="Nutrition" />` |
| `training-section.tsx` | Header row (Dumbbell + `"Training"` + the right-hand `"{n} of {m} completed"`) → `<SectionLabel label="Training" meta={…} />`. The meta keeps its `adherence.prescribed > 0` condition and is number-bearing, so `MONO_META_CLASS` is correct |
| `habits-section.tsx` | Header row (RotateCw + `"Habits"`) → `<SectionLabel label="Habits" />` |
| `client-notes-section.tsx` | Header row (MessageSquare + `"Client Notes"`) → `<SectionLabel label="Client Notes" />` |
| `check-in-review-rail.tsx` → **`check-in-review-section.tsx`** | Header row (Sparkles + `"AI review"` + Regenerate) → `<SectionLabel label="AI review" actions={<RegenerateButton/>} />`. The button element and its handler move **verbatim** — same `aria-label`, same `disabled`, same spin class, same two toasts. **Renamed to `CheckInReviewSection` in this commit — see §10.12** |
| `check-in-comparison-view.tsx` | Delete the `h3` only. Keep the `<p>` (both branches), all three cards, all `h4`s. The section's rail is rendered by the parent because this component never returns null |
| `goal-progress-view.tsx` | Delete the `h3` in **both** branches (has-goals and no-goals). Keep both `<p>`s, the Target icon, the banner, all three cards, the summary card. Rail from the parent, same reason |

### 10.5 The page

```tsx
const ready = Boolean(data && contextStartDate && contextEndDate);
const loading = isLoading || dailyContextLoading || (data && !contextStartDate);

// The comparison read feeds two sections; each gates on it independently so a
// failed comparison no longer blackens the whole page (B8).
const fromComparison = (
  render: (d: GetCheckInComparisonResponse) => ReactNode,
  failure: string
) => (isLoadingComparison ? <Spinner /> : comparisonData ? render(comparisonData) : <Notice>{failure}</Notice>);

return (
  <div className="space-y-5">
    <CheckInReviewHeader onBack={onBack} meta={…} />

    {isForeign ? <Notice>This check-in belongs to another client.</Notice>
     : loading ? <Spinner />
     : ready ? (
      <>
        <KPIRibbon … />                                   {/* §1 — no rail */}
        <TrainingSection … />                             {/* §2 — own rail */}
        <NutritionSection … />                            {/* §2 — own rail */}
        <WellnessSection … />                             {/* §3 — own rail */}
        <section>                                         {/* §4 */}
          <SectionLabel label="Measurements & trends" />
          {fromComparison(d => <CheckInComparisonView … />, "Failed to load comparison data")}
        </section>
        <HabitsSection … />                               {/* §5 — own rail */}
        <ClientNotesSection … />                          {/* §6 — own rail */}
        <section>                                         {/* §7 */}
          <SectionLabel label="Goal progress" />
          {fromComparison(d => <GoalProgressView … />, "Failed to load goal progress data")}
        </section>
        <CheckInReviewRail … />                           {/* §8 — own rail */}
      </>
    ) : <Notice>Failed to load check-in data</Notice>}
  </div>
);
```

Every prop passed to every child is **byte-identical to today's**. §9 (Reply) does not exist
yet — Share still lives inside the Review card until R3.

**Spacing.** `space-y-5` (20px) above each rail, `SectionLabel`'s own `mb-3` (12px) below —
the documented section rhythm. `space-y-*` is margin-based, so the SOT's "never mount a divider
inside a flex `gap-*` parent" warning does not apply.

### 10.6 Doc changes that belong in this commit

`docs/newdesignsystem.md` → "Segmented control" currently reads:

> *make the `Tabs` controlled and let `<SegmentedControl>` drive it
> (`components/clients/check-ins/check-in-detail-view.tsx` is the reference)*

R1 deletes that reference, and it is the **only** controlled-`Tabs` + `SegmentedControl` pairing
in the repo — every other one of the 14 call sites drives conditional rendering directly. So the
sentence must become the accurate rule ("never restyle a `TabsList` into the track; drive your
own panes from `<SegmentedControl>`") with a surviving reference, e.g.
`components/clients/metrics/metrics-top-bar.tsx`. **Leaving it is not an option** — it would
point at a file that no longer contains the pattern.

`docs/ARCHITECTURE.md` → "The coach review surface" describes "three panes behind one
`SegmentedControl` driving a controlled `Tabs`". It is rewritten in **R6**, once the shape has
settled, not incrementally — and to the current shape only, with no "it used to be".

### 10.7 What R1 deliberately does not do

Borderless cards · framer removal · Training ∥ Nutrition side by side · compact habit rows ·
the wellness row · band sparklines · the comparison carve-out · the goal strip · the Reply
section · any new copy · any file under `services/`, `app/api/`, `types/`.

### 10.8 The known cost of R1, stated up front

**Weight, body fat and the five wellness metrics will each render twice.** The band shows
weight and body fat; §4 mounts `CheckInComparisonView` whole, so its Physique card shows them
again with a sparkline, and its Wellbeing card repeats §3's five metrics with deltas. Across
two tabs this was invisible; on one page it is not.

**R2 removes it** by carving those rows out and folding them into the band and the wellness row.
The alternative — carving in R1 — would mean losing the deltas and sparklines for one commit,
i.e. a temporary regression, which §0 forbids. So the duplication is the deliberate choice:
**no information is lost at any point in the sequence.**

Expect it when you look at R1.

### 10.9 Tests

| Test | R1 |
|---|---|
| `"spins while the detail loads, with no rail"` | keeps — `queryByTestId("rail")` still absent |
| `"refuses a check-in that belongs to another client"` | keeps |
| `"shows the failure state when the detail cannot load"` | keeps |
| `"renders the Current pane with the meta line and the rail"` | renamed; now also asserts `comparison` and `goals` render **without a click** |
| `"the back row returns to the list"` | keeps |
| `"the segmented control switches to the carried-over panes"` | **deleted** — there is no switcher |
| `"a sent reply reports done; a regenerate refreshes"` | keeps |
| **new** — `"a failed comparison leaves the rest of the page standing"` | `comparisonData: null, isLoadingComparison: false` → both failure notices present, `ribbon` still present (B8) |
| **new** — `"a section with nothing to show takes its rail with it"` | one child unmocked with empty data → neither its rail nor its card renders (§10.3) |

The suite mocks `use-check-in-detail-data` wholesale, so both new cases are fixture flips.

`check-in-review-rail.test.tsx` → **`check-in-review-section.test.tsx`** (`git mv`), symbol
updated, and its header assertions re-pointed at the rail. `check-in-detail-view.test.tsx`'s
`vi.mock` path (:11) and mocked symbol (:12) move with it.

### 10.10 Gates

`npx tsc --noEmit` · `npx eslint .` · `npx vitest run` · `npm run check:labels` (clause 3 —
the hand-rolled-track scan; R1 *removes* a `SegmentedControl` so it cannot trip, and every
rail comes from the shared component) · `npx knip` (`Tabs`/`TabsContent` may become unused
imports; `SegmentedControl` keeps 13 other call sites).

**CONVENTIONS §2 security/load review: not applicable** — no migration, route, auth, write
path or data-flow change. Stated in the commit body rather than skipped silently.

**File sizes.** `check-in-detail-view.tsx` is 232 today; the header extraction takes ~45 lines
out and the nine sections add ~55, landing ~210 — inside §4's 250 limit. No child moves more
than ±6 lines.

### 10.11 Smoke checklist (yours — I don't drive the browser)

1. A normal check-in: all nine sections in order, one scroll, no tab bar.
2. Nothing renders twice **except** weight / body fat / the five wellness metrics (§10.8).
3. Back row returns to the list; the URL loses `?checkIn=`.
4. Send still returns to the list and refreshes it; Regenerate still refreshes in place from
   its new home on the Review rail.
5. A client with **no habits** — no `HABITS` rail, no gap.
6. A client with **no goals** — the `GOAL PROGRESS` rail stands over the verbatim empty state.
7. **First check-in** — band reads `vs start`, §4 reads `"Baseline established"`.
8. A **legacy row** with no resolvable period — Nutrition and Habits cells show empty states.
9. Kill the network for `…/comparison` only — §4 and §7 show their failure notices, the band
   and every detail-fed section still render (B8).
10. Paste another client's `?checkIn=` id — the foreign notice, nothing else.

### 10.12 `CheckInReviewRail` → `CheckInReviewSection` — decided, renamed in R1

**"Rail" has four meanings in this repo. R1 deletes the referent of exactly one of them.**

| Meaning | Where | After R1 |
|---|---|---|
| **Divider rail** — `SectionLabel` | the design SOT's dominant sense: "divider rail", "Schedule rail", "action rail", "Rail dropdown" | stays |
| **Dot rail** — a data field | `AdherenceSummary.{training,nutrition,habits}.rail`, `HabitBreakdown.rail` = `DotState[]`; read by `adherence-card.tsx` and `habits-section.tsx:48` | stays |
| **Week rail** — components | `CalendarWeekRail`, `NutritionCalendarWeekRail` | stays |
| **Sidebar rail** | `CheckInReviewRail` — the 380px sticky column | **referent deleted** |

Three of the four are legitimate and permanent, so the word cannot be un-loaded. What can be
fixed is the one name left pointing at nothing.

The collision lands inside R1's own diff: after R1, `habits-section.tsx` renders a
`<SectionLabel>` (divider rail) directly above `habit.rail.map(...)` (dot rail), in a folder
whose `CheckInReviewRail` (sidebar rail) no longer exists.

**The deciding argument is sibling consistency.** Its five peers in the same folder are
`wellness-section`, `nutrition-section`, `training-section`, `habits-section`,
`client-notes-section`. After R1 it does the identical job — a rail over a card — and is the
only one not named `*Section`, precisely because it used to be a different kind of thing.
Renaming makes the set of six uniform; it does not swap one collision for another.

**Blast radius: 4 files, entirely mechanical.** `check-in-review-rail.tsx` →
`check-in-review-section.tsx` (+ `CheckInReviewRailProps` → `CheckInReviewSectionProps`);
`check-in-review-rail.test.tsx` → `check-in-review-section.test.tsx`;
`check-in-detail-view.tsx` (one import, one usage); `check-in-detail-view.test.tsx` (the
`vi.mock` path at :11 and the symbol at :12). Nothing else imports it — verified by grep, not
assumed. Use `git mv` so the rename stays visible in history.

**This is not the `client_phases` case.** That divergence is *documented and deliberate* — the
table keeps a name its routes and UI do not share, and ARCHITECTURE says "do not
consistency-rename either half". Here there is no second half to preserve: the thing the name
described is being deleted in the same commit.

---

## 11. Not in scope

- Any change to a number's definition, denominator, source or rounding.
- `services/**`, `app/api/**`, `types/**`, `supabase/migrations/**` — untouched.
- The three defects in §7.2 (C1 Adherence row, C2 wellness source split, C3 regeneration
  banner) — recorded, not fixed.
- The AI prompt, `services/ai-service.ts`, the review JSON contract.
- The check-in wizard, the form editor, anything under `app/client/**`, and the client's own
  check-in detail page.
- `components/check-in/step-*.tsx`, `daily-logs-summary.tsx`,
  `daily-logs-training-summary.tsx`, `exercise-highlights-section.tsx`,
  `training-session-checklist.tsx` — client-facing files that merely share the **mixed**
  `components/check-in/` folder. New coach components go in `components/clients/check-ins/`
  and are imported from it.

---

## 12. Commit R3 — detailed spec

> `refactor(check-ins): R3 — the reply is the page's destination, not a sub-block`

### 12.1 What R3 delivers

The coach's reply stops being the fourth block inside the AI review card and becomes the
page's last section: its own rail, full width, one primary button. Every string, every toast
and the send logic move unchanged.

### 12.2 Files

**New — 1.** `components/clients/check-ins/check-in-reply-block.tsx`

```ts
type CheckInReplyBlockProps = {
  checkInId: string;
  clientName: string;          // the "Message sent to {name}" toast
  draft: string;               // review.clientMessage
  onSent?: () => void;
};
```

**Modified — 3**

| File | Change |
|---|---|
| `check-in-review-section.tsx` | Stops rendering `CheckInShareCard`. **Loses two props**: `clientName` (its only use was the share card's toast) and `onSent` (the reply owns it now). Keeps `onRefresh` for Regenerate. Its `hasAiReview` placeholder branch simplifies — it no longer has to keep a sub-block visible underneath |
| `check-in-detail-view.tsx` | Hoists `toCheckInReview(data.checkIn)` to a variable (both sections read it), mounts `<CheckInReplyBlock>` as the last section, moves `onDone` from the review section to it |
| `check-in-detail-view.test.tsx` | The `send` button moves out of the mocked review section into a mocked reply block |

**Deleted — 1.** `components/check-in/check-in-share-card.tsx` — one importer, verified.

### 12.3 What changes, and what must not

**Changes — all layout:**
- `ReviewBlock` wrapper → a `SectionLabel` rail over its own borderless card.
- The **Edit pencil ⇄ Check toggle goes**; the textarea is always live (brief §8). `ReviewProse`'s
  read-only rendering of the draft goes with it.
- Full width instead of the 380px column.
- Send is the page's primary.

**Preserved verbatim — each one is a bug someone already fixed:**
1. **The draft is a prop synced by `useEffect`, not `useState` seeded once.** A Regenerate must
   replace it, and a `key`-remount would drop `isSending` mid-send. Copy the effect and its
   reasoning across unchanged.
2. All five toasts: `"Message sent to {clientName}"`, `"Failed to send message"`,
   `"Write a message before sending"`, `"Message copied"`, `"Could not copy to clipboard"`.
3. `disabled={isSending || !message.trim()}` on Send, and the empty-message guard before the
   fetch.
4. `"No draft message yet."` — still needed as the textarea's `placeholder` now that there is
   no read-only branch to hold it.
5. The `POST /api/check-in/[id]/review` call and `onSent` semantics: the review is **done**, so
   the tab refreshes its list and the queues and returns to the list.

### 12.4 Three copy gaps — I need strings

| # | Slot | Repo today | Mockup | My recommendation |
|---|---|---|---|---|
| C1 | Rail label | `Share with client` | `Reply to Sam` | **`Reply`** — shipped |
| C2 | Primary button | `Send` | `Send and mark reviewed` | **`Send`**, and **`Send follow-up`** once a reply exists — shipped |
| C3 | Rail meta | *(nothing)* | `draft · not sent` | **`Sent {MMM d}`**, present only once sent — shipped. Plus **`Already sent`** labelling the previous message |

### 12.5 The one real decision: is there a "sent" state?

**Today there is none.** The detail renders the draft and a live Send button whatever
`responseSentAt` / `coachResponse` say. A coach re-opening a reviewed check-in sees no sign
they already replied — the list row shows `"Your reply: …"`, the detail does not.

One page makes this worse, because the reply is now the bottom of a long scroll and reads as
the thing to do.

| | What it costs |
|---|---|
| **(a) Leave it** | Nothing. Purest re-layout, and B12 stays exactly as today |
| **(b) Show it** — **chosen** | `responseSentAt` and `coachResponse` are already on the wire — no fetch, no service change |

**Shipped shape.** The rail dates the reply (`Sent Aug 31`), the previous message renders above
the box under an `Already sent` label, and the button becomes `Send follow-up`. **The block never
locks** — box and button stay live, because a coach may legitimately write again (owner,
2026-08-31). The sent state reports; it does not gate.

### 12.6 Also found, not fixed here

`NutritionRegenerationBanner` renders a **full-width `bg-primary` button** ("Regenerate
Nutrition Plan") inside Goal progress whenever the client's weight has drifted ≥3 kg. So the
brief's "single primary button on the page" is conditionally untrue, and that button is on
legacy OKLCH tokens against a Teal-Summit page, and its click `router.push`es to a dead
`#nutrition` hash (§7.2 C3). D4 keeps the banner; R5 owns the Goal-progress section and is the
place to deal with it.

### 12.7 Tests

| Test | Where |
|---|---|
| Sends the edited message and reports done | new `check-in-reply-block.test.tsx` |
| Refuses an empty message with the guard toast, and does not fetch | same |
| **A regenerate replaces the draft in place** (the effect, not a remount) | same — carried from `check-in-review-section.test.tsx`, which owns it today |
| Copy writes the current textarea value | same |
| The review section renders without a reply block | `check-in-review-section.test.tsx` — its share assertions move out |
| The page mounts the reply block and wires `onDone` to it | `check-in-detail-view.test.tsx` |

`check-in-review-section.test.tsx` currently asserts `"Share with client"` and the Send button
at `:112-113`, and the draft-resync behaviour at `:158-171`. Both move rather than being
rewritten — the behaviour is unchanged, only its address.

### 12.8 Gates

`npx tsc --noEmit` · `npx eslint .` · `npx vitest run` · `npm run check:labels` · `npx knip`
(`check-in-share-card.tsx` disappears with its only importer; nothing else should move).

**CONVENTIONS §2 security/load review: not applicable** — no migration, route, auth, write path
or data-flow change. The POST it calls is untouched.

### 12.9 Smoke (yours)

1. The reply sits last, full width, one primary button.
2. Type, Send → toast names the client, the tab returns to the list, the row shows the reply.
3. Send with an empty box → the guard toast, no request.
4. Regenerate with an edited draft in the box → the box takes the new draft (not the old one,
   not your edit).
5. Copy → clipboard has what is in the box, not the original draft.
6. A check-in with no AI review → the Review section shows its placeholder and the Reply
   section still renders.

---

## 13. Commit R4 — detailed spec

> `style(check-ins): R4 — borderless cards, and Training beside Nutrition`

### 13.1 What R4 delivers

The last purely visual commit. Five section cards lose their borders and their framer
animation; Training and Nutrition sit side by side; Habits becomes a scannable grid. **Not one
prop, number or string changes.**

### 13.2 Borderless + un-animated — the five siblings

Each of `wellness` / `nutrition` / `training` / `habits` / `client-notes` currently wraps its
body in:

```tsx
<motion.div
  initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
  transition={{ duration: 0.2, delay: 0.05 | 0.08 | 0.1 | 0.12 | 0.14 }}
  className="bg-white border border-[rgba(13,148,136,0.08)] rounded-[6px] p-5"
>
```

becomes

```tsx
<div className="rounded-[6px] bg-white p-5">
```

**The border.** `docs/newdesignsystem.md` → Spacing: *"Let spacing do separation work, not
borders. White cards on `#f4f7f6` provide enough contrast."* This is the follow-up D7.3 already
owed — the AI review card took the treatment when it shipped and the five siblings were left
bordered *only* so the column would not look half-done. Reply now matches it too, so the five
are the odd ones out.

**The animation.** Those stagger delays were tuned for a two-column pane where the cards
appeared together above the fold. On one long page they are nine sections fading in at
different times as you scroll past them, and neither the band, the review nor the reply
animates. `framer-motion` drops out of all five imports; it stays in the repo for everything
else.

The band keeps its CSS `animate-card-in` — one element, above the fold, already there.

### 13.3 Training beside Nutrition

`check-in-detail-view.tsx` wraps the two in one row:

```tsx
<div className="flex flex-col gap-5 lg:flex-row">
  <TrainingSection … />
  <NutritionSection … />
</div>
```

and each of those two components takes `min-w-0 flex-1 flex flex-col` on its root, with its
card `flex-1` so the shorter of the two stretches to match.

**Why flex and not `grid-cols-2`.** Either section can `return null` on an empty week (B1/B2).
A grid leaves a hole where the missing one was; a flex row lets the surviving section take the
full width on its own, with **no predicate on this page** — the §10.3 rule holds. A `null`
child emits no DOM node at all, so nothing needs to know which one rendered.

`min-w-0` is load-bearing: without it the nutrition card's mono numerals set the flex basis and
push the row wider than the page.

**Both components are used by this page only** (verified — the detail view and its test are the
sole importers), so carrying two layout classes on their roots is not a leak into other
surfaces.

**The Nutrition card's body stacks**: the macros sit under the calories they break down,
at every width. It was a `grid-cols-2` (kcal summary ∥ macro bars), which at half the row gave
two ~230px columns — too narrow for a macro bar to read a fill against. No numbers move.

### 13.4 Habits becomes a grid

Today: `flex gap-6 flex-wrap`, each habit an inline `name · count · dots` run. Five habits of
differing name lengths wrap into ragged rows with nothing aligned down the card.

R4: a responsive grid (3 columns wide / 2 medium / 1 narrow) with `rgba(13,148,136,0.06)`
hairlines between cells, each cell `name … count · dots` with the name truncating. Counts and
dot rails then line up in columns, which is the whole point of a habit readout.

**Every rule inside a cell survives untouched**: `completedDays/eligibleDays` over the habit's
own eligible days, the `null`-day dash with its `"Not yet added"` title, the teal/faint dot
tones, and the `eligibleDays > 0` filter that hides a habit which was never eligible.

### 13.5 What R4 does NOT touch

Any prop, denominator, string, empty state or conditional. `KPIRibbon`, `GoalProgressView`,
`CheckInReviewSection`, `CheckInReplyBlock` and `CheckInReviewHeader` are not opened — they are
already borderless or already correct.

### 13.6 Tests

Mostly unchanged: the suites assert text and behaviour, not shells. Two things to confirm
rather than assume:

- `habits-section.test.tsx` — the `"Not yet added"` dash count and the `2/4` mid-week case must
  still pass against the grid markup. If a selector was coupled to the flex layout it gets
  re-pointed, not relaxed.
- `check-in-detail-view.test.tsx` — the children are mocked, so the flex wrapper is invisible to
  it. **No new test earns its place here**: asserting a Tailwind class is asserting the
  implementation, and the layout is what the browser smoke is for.

Anything that *does* break is a signal a test was reaching for markup, and the fix is a better
selector.

### 13.7 Gates

`npx tsc --noEmit` · `npx eslint .` · `npx vitest run` · `npm run check:labels` · `npx knip`
(`framer-motion` keeps other importers; nothing should newly orphan).

**CONVENTIONS §2: not applicable** — render-only, no data flow touched.

### 13.8 Smoke (yours — this one is mostly visual)

1. No card has a border; the page reads as cards floating on `#f4f7f6`.
2. Nothing fades in as you scroll.
3. Training and Nutrition side by side on a wide window, stacked on a narrow one, **equal
   height** when side by side.
4. A client with **no nutrition logged** → Training alone, full width, no gap beside it.
5. A client with **no sessions prescribed** → Nutrition alone, full width.
6. The nutrition macro bars are still long enough to read at half width.
7. Habits: counts and dot rails line up in columns; a long habit name truncates rather than
   wrapping the row.
8. A habit added mid-period still shows leading dashes, not empty dots.

---

## 14. Commit R5 — detailed spec

> `feat(check-ins): R5 — goal progress is a strip, not a pane`

### 14.1 What R5 delivers

D2's strip. Four files and ~570 lines of goal cards become one component of ~120: two rows,
four columns each — **name · track · `start → goal` · state**. The last visual commit, and the
biggest single reduction in the workstream.

### 14.2 Files

**New — 2.** `components/clients/check-ins/check-in-goal-strip.tsx` + its test.

```ts
type CheckInGoalStripProps = {
  goalProgress: GoalProgress;
  clientName: string;                        // the no-goals empty state
  clientData: CheckInComparison["client"];   // the drift banner
};
```
Same three props `GoalProgressView` takes today, so the page's call site is a rename.

**Deleted — 4.** `goal-progress-view.tsx`, `weight-goal-card.tsx` (240 lines),
`body-fat-goal-card.tsx`, `goal-deadline-card.tsx`, plus `goal-cards.test.tsx` rewritten
against the strip.

**Modified — 2.** `check-in-detail-view.tsx` (one import, one element) and its test's mock.

### 14.3 The row

```
GOAL PROGRESS ·············································· deadline 31 Oct · 61 days

  Weight     ▰▰▰▰▰▰▰▰▰▰   88 → 77 kg    Reached · 5 kg past target
  Body fat   ▰▰▰▰▰▰▰▰▰▰   26 → 15 %     Reached · 3% past target
  ─────────────────────────────────────────────────────────────────────
  ⚠  {footer note — see Q19}                            [ Set new goals ]
```

| Column | Content | Notes |
|---|---|---|
| name | `Weight` / `Body fat` | sans 13px semibold |
| track | `percentComplete` fill, teal | already clamped 0–100 and reads 100 once met, so under/at/past target render with no new logic |
| ends | `{start} → {goal}` mono muted | `formatWeight` for weight (converts freely, never snaps); `%` is unitless |
| state | `{verdict} · {distance}` | teal when reached, amber when it needs attention |

A hairline (`rgba(13,148,136,0.06)`) between the two rows and above the footer — inner
hairlines inside one card, which is the sanctioned use; the CARD keeps no border.

### 14.4 The state column

Two facts joined by `·`: **where they stand**, then **how far**.

The verdict half keeps the precedence `status` > `paceStatus` > `isOnTrack`. **That order is
load-bearing and is not mine to change** — it is recorded in `ARCHITECTURE.md` → "Goal progress
and pace" and was the fix for a card reading "On track" at a client 5 kg past a weight-loss
target while Body Fat, which has no pace check, read "Needs attention" about the same client.

| Condition | State column | Tone |
|---|---|---|
| `status === "overshot"` | `Reached · {abs(remaining)} past target` | teal |
| `status === "achieved"` | `Reached` | teal |
| `paceStatus === "on_track"` | `On track · {abs(remaining)} to go` | teal |
| `paceStatus === "behind_pace"` | `Behind pace · {abs(remaining)} to go` | amber |
| `paceStatus === "unrealistic"` | `Deadline unrealistic · {abs(remaining)} to go` | amber |
| else `isOnTrack` | `On track · {abs(remaining)} to go` | teal |
| else | `Needs attention · {abs(remaining)} to go` | amber |

**Both rows take the same resolver**, so the two cannot reach different verdicts about one
client — the second half of that same fix. Body fat never has a `paceStatus` and falls through
to the `isOnTrack` legs.

**The overshoot distance needs no new data.** `remaining` is signed, and ARCHITECTURE records
that its magnitude "is the distance *back* to the target once it has been passed" — which is
exactly "5 kg past target". Reading it requires checking `status` first, which this table does.

### 14.5 The footer

An amber-thumbed note on the left, `Set new goals` on the right, above a hairline. It renders
**only when both goals are met** — otherwise the card is two rows and stops.

Two open items, §14.11 Q19 and Q20.

### 14.6 What goes, and what that costs

Per D2, beyond the projections the brief already named:

| Dropped | Was |
|---|---|
| `percentComplete` as a number | `100%` + `Complete`, 2xl mono |
| Current value | `Current Weight 72.0 kg` — the band's cell 1 carries it |
| `Remaining` as its own labelled cell | folded into the state column (Q19) |
| `Average Weekly Change` / `Average Change Per Check-In` | `-0.9 kg/week` |
| Estimated Time · Projected Goal Date · pace bars | the brief's no-projections rule |
| Progress Summary card | restated both rows and derived its verdict from weight alone (a recorded contradiction, `TECHNICAL-DEBT.md`) |

**The regeneration banner stays**, above the strip, as it is now.

### 14.7 Cascade

`computeGoalPace` **keeps its caller** — `paceStatus` still drives three of the six branches.
`requiredRate` and `safeCeiling` lose their only readers; they stay on the wire, because
removing them is a service change and §0 forbids one here. Same for `projectedCompletionDate`,
`weeksToGoal`, `avgWeeklyChange`, `avgChange`.

**`components/ui/progress` is not orphaned** — `content-upload-dialog.tsx` still imports it.
The strip's track is a plain div, matching the wellness/nutrition bars already on this page
rather than reaching for a primitive for two rows.

**Worth a follow-up, not R5's job:** with the pane gone, the 10-row `getClientCheckIns` read in
`comparison-service` exists solely to compute `avgWeeklyWeightChange` / `avgBodyFatChange`,
which now feed only `weeksToGoal` — itself unread. That is a service change; flag it for a
sweep after R6.

### 14.8 Branches

| # | Case | Strip |
|---|---|---|
| B5 | No goals at all | today's verbatim empty state: `"No goals have been set for {name} yet."` + Target icon + `"Set goals in the client profile to track progress here."` |
| B6 | One goal only | one row |
| — | No deadline | no rail meta; states resolve on `isOnTrack` |
| — | Deadline passed | rail meta `Overdue by N days` |
| — | No starting value | `status` is `approaching` by definition; the ends column reads `— → 77 kg` |

### 14.9 Tests

`goal-cards.test.tsx` becomes `check-in-goal-strip.test.tsx`. Its eight existing cases carry
across as behaviour, not markup — the overshot client, the "no remaining distance once met",
the "body fat reaches the same verdict as weight", the distance-as-magnitude-while-approaching.
Two of them (the pace check's wording, the projected date's absence) become assertions that
those things do **not** render.

New: the six-branch precedence table exercised end to end, and the deadline in the rail meta.
**Mutation test:** flip the resolver to check `isOnTrack` before `status` — the overshot case
must fail. That is the exact bug the precedence exists to prevent.

### 14.10 Gates

`npx tsc --noEmit` · `npx eslint .` · `npx vitest run` · `npm run check:labels` · `npx knip`
(four deletions; `Progress`, `computeGoalPace` and `date-fns` all keep other importers).

**CONVENTIONS §2: not applicable** — render-only.

### 14.11 The footer — decided

**The note reads `"Goal met - consider setting a new target."`** — the repo's own string
(`weight-goal-card.tsx`). The mockup's sentence is not used: the brief's copy rule named
"recommendations about resetting targets" among the placeholders not to port, and its
"weight is still falling" half is a trend claim whose figure D2 drops. The repo string says the
same thing off `status` alone.

**`Set new goals` opens the goal editor on the Overview tab.** `ClientDetailsSheet` is mounted
only inside `client-overview-tab.tsx` behind local state, so this is a round trip, built on the
`?apply=1` / `?edit=1` precedent in `use-journey-round-trip.ts`:

1. `CheckInDetailView` takes `onTabChange` — it holds only `onBack` / `onDone` today, so
   `CheckInsTabContent` threads the client page's handler down (ARCHITECTURE: **every**
   cross-tab navigation goes through that handler, or the URL changes and the visible tab does
   not).
2. The button calls it with `{ overview-edit param, checkIn: null }` — clearing `?checkIn=` so
   Back does not land on a review the coach has left.
3. `client-overview-tab.tsx` consumes the param **from an effect, not a `useState`
   initializer**, and strips it. That is the documented shape: `activeTab` flips before the
   `router.replace` lands, so a newly-mounted tab reads the previous tab's query for one render.
   A lingering param would also re-open the sheet on every later visit, because Radix unmounts
   inactive `TabsContent` and each visit is a fresh mount.

**This is the one place R5 leaves the review surface**, and it touches the client page's URL
contract. It is therefore its own commit — **R5b** — after the strip lands, so a revert of
either does not take the other. If R5b is not built, the strip renders its note without the
button and nothing is broken.

### 14.12 Smoke (yours)

1. A client with both goals → two rows, aligned columns, deadline on the rail.
2. A client **past** a weight goal → `Goal met` on BOTH rows, no distance, no pace wording.
3. A client mid-journey → a distance in the state column and a part-filled track.
4. A client with **no goals** → the verbatim empty state.
5. A client with **one** goal → one row, no empty second.
6. A **past** deadline → `Overdue by N days` on the rail.
7. The drift banner still appears above the strip when weight has moved ≥3 kg.
