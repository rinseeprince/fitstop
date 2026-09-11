# Check-in findings — 2026-09-11

What the check-in's nutrition figures were found to do when a client logs a
day no plan covers, what the kernel commit changed, and what is left for the
simplification. Written as a working list for that simplification; the
current shape of the system is in `docs/ARCHITECTURE.md` → "Check-in System"
and "Check-in review", and this file will be deleted when the list is done.

## The model as it stands

A check-in is a view over one source of truth — the daily logs and the plan —
frozen at submit. Deriving it is right: a client never types a number the
system already knows, and one source is what makes a freeze possible. Nothing
below questions that.

Since the kernel commit every nutrition figure comes from ONE computation,
`utils/nutrition-period-summary.ts`:

- `buildNutritionSummary(dates, logs, targets)` — one row per date: what was
  eaten, the day's computed target, the day's standing (`hit` / `partial` /
  `missed` / `not_logged` / `no_target`).
- `summarizeNutritionPeriod(rows)` — every figure a surface renders, each over
  a named day set: LOGGED (coverage, over the period), TARGETED (adherence —
  a skipped targeted day is a miss), JUDGED (logged and targeted — the only
  days intake can be compared with a target). A logged day with no target is
  counted as logged and is in no ratio.

`services/nutrition-period-service.ts` runs it live (`getNutritionPeriod`)
and, for a submitted check-in, over the rows it froze
(`getCheckInNutritionSummary`). The submit (`submitCheckIn`) freezes the rows
in its INSERT from the same run its stored columns come from.

## What was found

The smoke: delete the plan from today, log today, then open the check-in. The
day was counted against the client three different ways, because the same
period summary was computed in five places with five slightly different rules:

| Where | What it did with a logged day that had no target |
|---|---|
| `client-adherence-service` (Overview rail, review ribbon) | dot "no log"; ratio over all period days → 6/7 |
| `nutrition-section.tsx` (review card, in the browser) | calories dropped the day from both sides; macros kept its intake and counted its target as zero → 173 g against 146 g when the target was 170 g every day |
| `daily-logs-aggregation.ts` + `daily-logs-training-summary.tsx` (client wizard, in the browser) | days on target over all period days → 0/7 in red with one day logged |
| `weekly-nutrition-helpers.ts` (stored `adherence_percentage`) | intake over all logged days against targets over targeted days → 115 %, clamped to 100 |
| `nutrition-period-summary.ts` (frozen snapshot, AI prompt) | labelled the day "not logged" |

Before the client's food log was ungated (R2, 2026-09-11) this state could
not exist inside a check-in window, so none of the five was designed for it.

### Fixed by the kernel commit

- One computation on the server; the two browser aggregations deleted (the
  review card and the wizard render the wire's figures and count nothing — a
  source scan in `nutrition-section.test.tsx` pins it).
- The denominator everywhere is the days a target was prescribed. Zero
  targeted days reads "No targets set", never 0/7.
- A logged day with no target: standing `no_target`, a dash on the rail (the
  training rail's "no session planned" mark), named on the review card ("1
  logged day had no target and is not counted"), judged neither way in the
  prompt.
- Calories and macros on the review card over the same day set.
- The stored `adherence_percentage` compares intake and targets over the same
  days.
- The AI prompt (both entry points: client submit and coach Regenerate) runs
  the kernel over the FROZEN rows when the check-in has them.
- The client card's hard-coded "of 7" went: `nutritionTargetedDays` is on the
  client wire, counted from the frozen rows.
- The snapshot is written in the submit's INSERT (no second read of the period,
  no read-back of the stored window); `check-in-snapshot-service.ts`,
  `weekly-nutrition-service.ts`, `weekly-nutrition-helpers.ts`,
  `weekly-nutrition-mappers.ts`, `types/weekly-nutrition.ts` and the
  `nutrition/plan-targets` route are gone.

## Remaining — the simplification

### 1. Too many figures

For nutrition alone the review page carries: days logged, days on target, a
calorie adherence percentage, a period HIT / PARTIAL / MISSED pill, a calorie
total against a target total, an average per day, an average target, three
macro bars, a rail; the wizard adds an average intake, an average target and
a weekly net; the stored row adds `nutrition_days_on_target` and
`adherence_percentage`. The pill and the percentage are second derivations of
the same days as "days on target" (the pill is the calorie gap over the
targeted days against 50 / 143 kcal per day; the percentage is intake over
target on the same days — the 115 % clamp lived there).

Recommendation: three figures. Days logged out of period days (coverage),
days on target out of targeted days (adherence), average intake against
average target on the judged days (how close), with the macro bars on that
same day set. Drop the pill and the stored percentage. With the kernel, this
is deleting fields from `NutritionPeriodSummary` and the cells that read them
— the day sets do not change.

### 2. Three versions of one check-in

A submitted check-in is represented three ways:

| Representation | Written | Read by |
|---|---|---|
| Stored columns: `workouts_completed`, `adherence_percentage`, `nutrition_days_on_target`, the five wellness averages | submit | the client's check-in card and detail, the coach's recent list, the AI prompt's previous-check-in trend |
| `period_snapshot` (frozen rows) | submit, same run | the AI prompt (the kernel over the rows), `nutritionTargetedDays` |
| Live recomputation | on every read | the coach's REVIEW PAGE: the ribbon and the nutrition card (`getCheckInPeriodAdherence` → `getClientAdherenceForRange` over the current logs and the current plan), the wellness section, the training section |

The review page — the main surface — reads none of the frozen data. "A
submitted check-in closes its period" protects the client's logs, so the live
figures stay stable against the client; it does not protect against the coach:
delete or replace a plan after submit and the review's targets, verdicts and
dots move, while the client's card keeps the frozen count. The two can disagree
about the same week.

Recommendation: a submitted check-in's review runs the kernel over its frozen
rows — `getCheckInNutritionSummary` already does this for the prompt, and
`getCheckInPeriodAdherence` can take the same branch, building the rail from
the frozen rows' standings. Only the open period (the wizard) computes live.
The stored nutrition columns then duplicate what the rows give and can be
derived at read time for the RN wire (the wire keeps its shape; the columns
can go in a later migration — PROD holds no clients).

### 3. The prompt's inputs

`buildCheckInAnalysisPrompt` takes twelve positional parameters, assembled
separately in `services/client-check-in-service.ts` (client submit) and
`app/api/check-in/[id]/ai-summary/route.ts` (coach Regenerate), and
`regenerateAISummary` passes no snapshot while `generateCheckInSummary` does.
One builder that takes a check-in and returns the prompt's inputs would
remove the second assembly and the drift between the two paths.

### 4. Training has its own two conventions

Already recorded in `CONVENTIONS.md` ("Adherence is not unified"): the review
page's training figure counts full and partial completions
(`summariseSessions`), the adherence kernel counts full only, and the stored
`workouts_completed` counts full only. The nutrition kernel is the shape to
follow: one function over the events, every surface renders it.
