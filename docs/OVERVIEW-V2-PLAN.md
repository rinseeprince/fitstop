# Client Overview v2 + Details Sheet

> ## ▶ STATUS — commits 0–7 are SHIPPED. What is left is the browser smoke, then §11.
>
> **Commits 4–7 landed 2026-08-28** (`72821b6`, `c7f3f8b`, `db93c7e`, this one), all four gates
> green at each. **The UI is unverified** — no browser has run this. The smoke checklist was
> handed over in chat, per the owner's rule that they run smokes and Claude never drives a
> browser.
>
> **Next, and only after that smoke passes: §11, commits 8–10** (check-in scheduling). Approved,
> deliberately deferred, and untouched by this work — nothing in commits 4–7 reads
> `expected_check_in_day` or anything in `lib/check-in-schedule.ts`.
>
> **Gates — all four, before every commit:**
> ```
> npx tsc --noEmit
> npx eslint .              # 0 errors; pre-existing warnings are fine
> npx vitest run            # 301 files / 3243 tests as of commit 7
> npm run check:labels
> ```
> `set-tracker.test.tsx` is a known flake in full runs — re-run before blaming your change.
>
> **The design SOT is `docs/newdesignsystem.md`.** Ignore `DESIGN_SYSTEM.md` and any older token
> files — they are stale.
>
> **Do not create new documents.** Update this one.
>
> §1–§7 below describe the whole workstream, including the parts now built. They are kept as the
> record of WHY each decision went the way it did; where the shipped code and this plan disagree,
> **the code is what shipped** and §12 records the three places that happened deliberately.

Redesign of two coach surfaces: the client **Overview** tab
(`components/clients/client-overview-tab.tsx` + `components/clients/overview/**`) and the
**inline edit form** that currently lives inside its two "Client" cards
(`use-client-profile-edit.ts` + `inline-edit-fields.tsx`).

Authored against `docs/newdesignsystem.md` (the only design SOT) and against the code as it
stands on `main` at `fce1e5e`, **plus the uncommitted working tree** (see §0).

Every design question in §1–§9 is answered and signed off. §11 is approved but deferred to after
commit 7.

**Owner decisions (2026-08-27) — all ten closed. One item still needs your call: §0.**

| Q | Decision |
|---|---|
| 1 | Window options are **`30 / 60`**. No 7, no `ALL`. Adherence `MAX_DAYS` goes 28 → **60**. |
| 2 | The Wellness signal carries **no percentage and no bar**. Flag chip + sub-line only. |
| 3 | **Suppress `no_log_gap` while `no_engagement` is live.** Renderer-only; dismissals stay 1:1. |
| 4 | **Drop "Last submitted"** entirely. Not rehomed to the sheet. |
| 5 | Follow the mockup: **only Training gets a day strip**; nutrition/habits/wellness get stat grids. The nutrition and habits dot rails are **dropped**. |
| 6 | Status is **read-only**. **Archive is out of scope** — the danger zone comes out of the sheet. |
| 7 | Goal history → **band footer**, beside "Open metrics". |
| 9 | **No invented alert rows.** The card renders exactly what the existing feed produces; copy comes from the two functions the dashboard already has (§6.2 FLAG F). |
| 10 | **Drop the Units field.** The client sets their own units in the client app. |
| 8 | Chart transport = **(b)**, a new bounded route. Spec in §3.1.1. |

---

## Shipped so far (main, as of 2026-08-28)

| Commit | What |
|---|---|
| `ed8da61` | §0 — the owner's in-flight status-card change, landed alone so the sequence starts clean |
| `1159ec2` | **Commit 1** — pure helpers + the alert copy extracted out of the dashboard |
| `e07993d` | **Commit 2** — adherence window 28 → 60, additive nutrition means |
| `30c435f` | **Commit 3** — the details sheet replaces inline editing |
| `e6b32d0` | *(out of band)* the add-client intake path could never be submitted |
| `92fe1de` | *(out of band)* off-system edge border removed from every Sheet — found by the smoke |
| `17b5254` | *(out of band)* Baseline explainer + "Log a measurement" link dropped from the sheet |
| `72821b6` | **Commit 4** — the new shell: identity row, Progression rail + window state, status band, needs-attention rewrite, two-up rails, plan scope label, notes footer |
| `c7f3f8b` | **Commit 5** — the Signals card: four rows, four panels, window-driven; `AdherenceSummary.habits.perHabit` added server-side |
| `db93c7e` | **Commit 6** — the `measurement-series` route + hook + progression chart; the band splits into chart ∥ cells |
| *(this)* | **Commit 7** — the sweep: six superseded components + four dead tests deleted, docs updated |

Commits 1–3 were browser-smoked on 2026-08-27 and **passed**, with three fixes folded back.
**Commits 4–7 are shipped and NOT smoked.** §11 (commits 8–10) is approved and deferred until
after that smoke — owner decision, 2026-08-28.

### What already exists, so you do not rebuild it

- `lib/attention-alert-copy.ts` — `getShortAlertText`, `getPriorityAlertText`, `alertLines()`,
  `visibleAlerts()`. **Commit 4's Needs-attention card consumes all four.**
- `lib/overview/window.ts` — `OVERVIEW_WINDOWS` (30/60), `DEFAULT_OVERVIEW_WINDOW`,
  `overviewWindowLabel()`. **Commit 4's window control consumes these.**
- `lib/overview/rolling-average.ts` — `rollingAverage()`, `weeklyRate()`. **Commit 6's chart
  consumes these.** Unused until then, deliberately.
- `lib/client-initials.ts` — `clientInitials()`. **Commit 4's identity row must use this**, not a
  seventh local copy.
- `AdherenceSummary.nutrition.calories` / `.protein` — `{actual, target, days} | null`.
  **Commit 5's nutrition detail consumes these.**
- The adherence route accepts `?days=` up to 60.
- `components/clients/details/**` — the sheet. Commit 4 keeps it mounted and unchanged; only its
  entry points move onto the new identity row.

---

## 0. Working-tree state — RESOLVED

The tree was dirty in `client-status-card.tsx` and three companions when this plan was written.
That work landed alone as `ed8da61` so every "independently revertable" claim below holds.
**The tree is clean. Start from a clean tree and keep it that way between commits.**

---

## 1. The open question, answered: current weight / current body fat

**They are denormalised caches. Make them read-only in the sheet, with a "Log a measurement"
action.** This is not a close call — the evidence:

1. `Client.currentWeight` / `currentBodyFatPercentage` are documented in `types/check-in.ts:446`
   as *"Current metrics (automatically updated from latest check-in)"*.
2. **Three writers move them**, and they do not agree about the chart:
   - the check-in metrics sync,
   - `upsertMetricEntry` → `dualWriteBodyMetrics` (`metric-entries-service.ts:113`), which writes
     a `client_metric_entries` row **and** the cache, under an explicit **no-regression rule**
     (a backdated entry must never move `current_weight` backwards),
   - the coach `PATCH /api/clients/[id]` → `updateClient` → `recordBodyMetrics({source:
     "metrics_api"})` + `recalculateClientEnergy` (`client-service.ts:294, 375`), which writes the
     cache and a `body_metrics` row **with no no-regression rule at all**.
3. **The new chart reads neither of those.** Its series is
   `buildMetricPoints(checkIns, client_metric_entries, METRIC_DEFINITIONS)`
   (`utils/metric-points.ts:52`) — check-ins plus coach metric entries. `clients.current_weight`
   and `body_metrics` are not in it.

So today: typing `79` into "Current weight" moves the number the form shows, recomputes BMR/TDEE,
and **adds no point to the chart**. Ship the chart next to an editable current weight and the two
will disagree permanently, in exactly the way you predicted. It also silently defeats the
no-regression rule the metric-entry path was given on purpose.

**What the workflow costs.** Nothing real. `LogMeasurementDialog`
(`components/clients/metrics/log-measurement-dialog.tsx`, already `max={today}`-bounded) writes the
entry, the cache **and** the energy recompute — a strict superset of what the form field does, plus
a chart point. The one behaviour genuinely lost is "correct a wrong current weight without
recording that you took a measurement"; the honest fix for that is editing the offending entry on
the Metrics page, which already exists.

**Baseline stays editable**, as your mockup has it, and for a different reason: `startingWeight` /
`startingBodyFatPercentage` / `startDate` do **not** go through the plain column write — they route
to `recordClientStart` (`client-service.ts:356`), the single writer that also *moves the metric
entries dated on the start date* so the chart's first point keeps describing the start. That is a
real correction workflow with a correct write path, and it already has its own confirm dialog
(`ConfirmStartEditDialog`).

**Sheet copy this implies:** the mockup's line *"Current values come from logged measurements, so
the chart and this form can't disagree"* becomes true only once the field is read-only. Keep it.

---

## 2. Component inventory

### 2.1 New

| File | What |
|---|---|
| `lib/overview/rolling-average.ts` | pure: k-day rolling mean over a date-sparse series + window-scoped rate/week. Unit-tested. |
| `lib/attention-alert-copy.ts` | pure: `getShortAlertText` + `getPriorityAlertText` **extracted verbatim** from `needs-attention-feed.tsx:96-166`, plus the `no_engagement`-suppresses-`no_log_gap` rule and a tab→icon map. The dashboard refactors to import them (behaviour identical) — the same extraction `lib/attention-alert-destinations.ts` already got. Unit-tested. |
| `lib/overview/window.ts` | pure: the window option list (`30 / 60`) and its label (`Last 30 days`). |
| `components/clients/overview/identity-row.tsx` | avatar, name, status, email, started, next check-in + due chip, pencil. |
| `components/clients/overview/status-band.tsx` | the dark band: chart pane ∥ 4 structural cells ∥ footer. |
| `components/clients/overview/progression-chart.tsx` | the one new component (§3). |
| `components/clients/overview/signals-card.tsx` | the 4 rows + expansion shell. |
| `components/clients/overview/signal-details.tsx` | the four expanded panels (training rail / nutrition / habits / wellness). May need splitting into 2 files for size. |
| `components/clients/overview/needs-attention-section.tsx` | rewrite of `waiting-on-you-section.tsx`. |
| `components/clients/details/client-details-sheet.tsx` | the 780px sheet shell + hero + footer. |
| `components/clients/details/details-groups.tsx` | the six railed groups. |
| `lib/client-initials.ts` | one `getInitials`. There are ≥5 disagreeing copies today (`client-schedule-card.tsx`, `client-sidebar.tsx`, …); the identity row must not become the 6th. |

### 2.2 Modified

| File | Change |
|---|---|
| `client-overview-tab.tsx` | new section order; owns window state + sheet-open state; drops `useClientProfileEdit` and the `clientSectionRef` scroll hack. |
| `use-client-profile-edit.ts` | becomes the **sheet's** form. Gains `name`, `email`, `checkInFrequency`. Loses nothing else (§6.1). |
| `since-last-visit-section.tsx` | card header → shared rail; "Mark seen" moves to the rail's `actions`. Body unchanged. |
| `current-plan-section.tsx`, `plan-training-card.tsx`, `plan-nutrition-card.tsx` | one shared rail; equal height; explicit scope labels (§6.3 FLAG I). |
| `coach-notes-card.tsx` | "Open notes" moves from the header into a card footer. Everything else unchanged. |
| `overview-primitives.tsx` | `OverviewCard` gains a footer variant; `CardHeader` keeps only the plan cards as callers. |
| `wellness-sparkline.tsx` | reused verbatim by the Wellness signal detail. |
| `client-activation-banner.tsx` | `onOpenProfile` opens the sheet (drop `scrollIntoView`). |
| `hooks/use-client-adherence.ts` | takes the selected window. |
| `hooks/use-wellness-data.ts` call site | window-driven `daysBack`; `withHabitLogs: true` (§6.2 FLAG T). |
| `services/client-adherence-service.ts` + `app/api/clients/[id]/adherence/route.ts` | window ceiling + additive nutrition averages (§6.2 FLAG A, T). |
| `types/coach-overview.ts` | additive fields only. |

### 2.3 Deleted

| File | Where its content goes |
|---|---|
| `client-schedule-card.tsx` | identity row + sheet |
| `client-status-card.tsx` | status band + sheet |
| `adherence-card.tsx` | signals card |
| `wellness-cards.tsx` | wellness signal detail (the 5 metric cards become the expansion's grid) |
| `waiting-on-you-section.tsx` | `needs-attention-section.tsx` |
| `inline-edit-fields.tsx` | **partially**: `EditRailActions`, `InlineDarkInput`, `InlineDarkSelect` die (no dark editable surface survives); `ACTIVITY_OPTIONS` moves to the sheet; `InlineTextInput`/`InlineSelect` are replaced by bare `<Input>`/`<Select>` (the ui/ primitives are already Teal-Summit — a wrapper that re-adds `FOCUS_RING` and a height is a call-site correction the design system forbids). |

**Kept, rehomed:** `confirm-start-edit-dialog.tsx` (sheet footer save path — §6.1 FLAG S),
`goal-history-popover.tsx` (needs a decision — §9 Q7), `overview-format.ts`, `wellness-sparkline.tsx`.

### 2.4 Tests touched

`adherence-card.test.tsx` (→ signals), `wellness-cards.test.tsx` (→ signal detail),
`client-status-card.test.tsx` (→ status band), `loading-states.test.tsx` (→ identity row + notes),
`client-profile-edit.test.tsx` (→ sheet), `waiting-on-you-section.test.tsx` (→ needs attention),
`plan-training-card.test.tsx` and `since-last-visit-section.test.tsx` (light).
Plus new: `rolling-average.test.ts`, `alert-presentation.test.ts`, `progression-chart.test.tsx`,
`client-details-sheet.test.tsx`.

---

## 3. The progression chart

### 3.1 Data source — same data as Physique, question is only how it reaches the browser

**Yes: the same two tables, the same merge, the same tie-break as the Physique view.** I was never
proposing different data. `check_ins` + `client_metric_entries`, merged by `buildMetricPoints`
(`utils/metric-points.ts:52`). The only open question is the *transport*.

The Physique view gets it through `useMergedMetrics` → **`useAllClientCheckIns`**
(`use-check-in-data.ts:60-84`), which eagerly pages the client's **entire** check-in history:
sequential SWRInfinite requests of 20 (`CLIENT_CHECKINS_PAGE_SIZE`), each hitting
`getClientCheckIns` → `select("*")` on a **37-column** table carrying four JSON blobs
(`ai_insights`, `ai_recommendations`, `period_snapshot`) plus the AI summary, the AI response
draft, the coach response and five free-text fields — with `count: "exact"` on every page. To read
**two numbers per row**.

On the Physique page that is the page's whole job, and it is fine. On the Overview it is N
sequential fat requests on top of the ~45 Postgres round trips already measured for one page load.

**Your `30 / 60` decision sharpens this.** With no `ALL`, the chart's widest window is 60 days —
roughly 8 check-ins for a weekly client. Option (a) pulls three years of AI-annotated check-in rows
to draw eight dots.

| Option | Cost | Verdict |
|---|---|---|
| **(a) Call `useMergedMetrics` on the Overview** | zero backend, ships inside commit 6. N sequential requests, full history, full rows, every Overview load. | rejected |
| **(b) `GET /api/clients/[id]/measurement-series?days=N`** | two bounded selects, merged through the **same** `buildMetricPoints` tie-break. One request, ~60 lines + a test. | **✅ CHOSEN (Q8)** |
| **(c) Make `/check-ins` project its columns**, then do (a) | fixes the payload for Physique too, but touches a route with other consumers and still pays N sequential requests | good later, wrong lever now — not in scope |

(b) is not new business logic — it is the existing merge, moved server-side and bounded by the
window. Sharing `buildMetricPoints` is what keeps the Overview chart and the Physique chart from
ever disagreeing about which value wins on a date both sources touched.

Nothing existing can carry it: `overview-brief` has measurements only as *activity since the last
visit* (capped 20), `overview-plan-summary` is plan metadata, `adherence` is dot rails.
`services/client-portal-progress.ts` does build a weight series server-side, but reads **only**
`check_ins` — it would silently omit every coach-logged entry, so it is not a shortcut.

### 3.1.1 Route spec (Q8 = b)

`GET /api/clients/[id]/measurement-series?days=30|60`

**Chain** (CONVENTIONS §8, GET so no CSRF): `coachApiRateLimit` → `requireCoachOwnsClient(clientId,
request)` — pass `request`, per the auth-helper signature rule → param validation → logic.
Mirror the adherence route's param handling exactly: non-integer `days` → **400**, otherwise clamp
to `[30, 60]`. Response `{ success: true, data: … }`, `Cache-Control: no-store`.

**Window anchor: `getClientTodayString(clientId)`** — the same client-local anchor
`getClientAdherence` uses. The chart and the Signals card must not disagree about where the window
starts by a day.

**Two selects**, both bounded to the window:

```
check_ins            id, created_at, weight, body_fat_percentage
                     where client_id = :id and created_at >= :windowStart

client_metric_entries id, entry_date, metric_key, value, note
                     where client_id = :id
                       and metric_key in ('weight','bodyFat')
                       and entry_date >= :windowStart
```

**Merge:** map the check-in rows with the existing `mapCheckInRow` (`lib/mappers.ts:9`) — or a
four-field projection onto the same camelCase shape, since `buildMetricPoints` reads
`ci[def.key]` / `ci.createdAt` / `ci.id` — then call
`buildMetricPoints(checkIns, entries, [weight, bodyFat])` with those two `METRIC_DEFINITIONS`
entries (`use-metrics-data.ts:30-31`; ids `weight` / `bodyFat`, keys `weight` /
`bodyFatPercentage`). Project the result to `{ date, value }[]` per metric for the wire.

**Why share `buildMetricPoints` rather than re-merge:** it owns the deterministic total order
`date | source rank | timestamp | id`, under which a coach entry dated D sorts **after** that
day's check-ins and therefore wins ties for "latest". Re-implementing that is how the Overview
chart and the Physique chart start disagreeing about which value is current.

**Values stay canonical kg** (CONVENTIONS §20). The chart converts at the render boundary with
`formatWeight`, rounded to one decimal, exactly as `use-merged-metrics.ts:43` does — otherwise an
imperial coach sees fifteen decimal places where a metric one sees a clean number.

**Duplicate dates are kept, not collapsed.** A check-in and a coach entry on the same day are two
real points; the Physique chart renders both, and the rolling mean is unbothered.

**Contract:** `types/coach-overview.ts` gains
`MeasurementSeries = { weight: { date: string; value: number }[]; bodyFat: … }`.
New hook `hooks/use-measurement-series.ts`, SWR, `revalidateOnFocus: false`, keyed on the window.

### 3.2 Consequences of `30 / 60`

**Good:** dropping `7` removes the near-empty chart. A weekly client has ~4 points at 30 days and
~8 at 60 — enough for a rolling mean and a rate. The rate gate (n ≥ 2, span ≥ 7 days) now passes
for any client logging at all.

**Also good:** dropping `ALL` removes the only unbounded read. `getClientAdherence` runs five
unpaged selects; at "all time" the `daily_habit_logs` read (habits × days) would eventually hit
PostgREST's ~1000-row cap and truncate *silently*. At 60 days it cannot — a client would need ~17
active habits to approach it. Worth remembering if a `90` or `ALL` is ever added back.

**The cost:** no whole-journey view on the Overview. That is one click away — "Open metrics →"
lands on Physique, which keeps `30 / 60 / 90 / All`.

**The control is now two options.** Still the shipped rail treatment
(`metric-progression-section.tsx:61`), just two buttons instead of four.

### 3.3 What it renders

All display, on `#0f2027`:

- solid teal line = k-day rolling mean; faint white dots = raw readings behind it;
- dashed goal reference line + label, from `effectiveGoal.goalWeightKg` / `goalBodyFatPercentage`,
  converted with `formatWeight` exactly as `useMergedMetrics` does;
- large mono current value + unit; rate beneath it in unit/week;
- on-dark Weight ⁄ Body fat toggle;
- no projections.

**Library: recharts**, not hand-rolled SVG. It is already a dependency and
`metric-trend-chart.tsx` is the shipped precedent for this exact chart — including one bug the
hand-rolled mockup reproduces: a goal line outside the data's range **vanishes** unless you pass
`ifOverflow="extendDomain"` (`metric-trend-chart.tsx:253`). Also take its numeric-time X axis: a
category axis spaces points by entry *count* and lies about uneven logging.

**Two things here are genuinely new math** (the brief says "nothing new beyond a rolling average" —
this is the exception, stated):

1. the rolling mean itself;
2. the **window-scoped** rate. `deriveHeroStats.avgRate` (`metric-derived-stats.ts:47`) is
   full-series (`(latest − first) / (spanDays/7)`) and gated (`category === "body" && n ≥ 2 &&
   spanDays ≥ 7`). The mockup's rate is over the windowed rolling average. Recommendation: new
   pure helper, **same gate** — under 2 points or under 7 days of span, render `—`, not a wild
   extrapolated number.

**Rolling window k:** the mockup uses `min(7, max(2, round(win/4)))`. For a client who logs weekly,
a 7-*day* mean over a 7-day window is one point. State the rule as *k days of calendar span*, not
k samples, and show the raw dots so a sparse series is visibly sparse.

---

## 4. The details sheet

780px right `Sheet`, following `session-editor-sheet.tsx` (dark hero + `#f4f7f6` body + white
footer) — which is the shipped match for your mockup, rather than the white-bodied recipe.

Groups, and what each writes:

| Group | Fields | Write path |
|---|---|---|
| Contact | name, email, phone, **status (read-only)** | `PATCH /api/clients/[id]` (`name`/`email`/`phone` all in `updateClientSchema`). Status is display-only — Q6. |
| Profile | sex, DOB, height, started, activity | `PATCH` (+ `recordClientStart` for `startDate`). **No units field** — Q10. |
| Check-ins | frequency, check-in day, next check-in (read-only) | `PATCH /api/clients/[id]/check-in-config`. **frequency needs all five options — FLAG II** |
| Baseline | start weight, start body fat (editable); current weight, current body fat (read-only + "Log a measurement") | `PATCH` → `recordClientStart`; confirm dialog first (FLAG S) |
| Goals & energy | goal weight, goal body fat, goal start, deadline, activity, BMR (read-only), TDEE (editable + reset) | `PUT /api/clients/[id]/goals` (**never** the client PATCH — FLAG Q) + `PUT /api/clients/[id]/metrics` for TDEE |
| ~~Danger zone~~ | — | **Out of scope (Q6).** Archive isn't built; `DELETE /api/clients/[id]` stays UI-orphaned. The sheet ends at Goals & energy. |

**The single "Save changes" button hides four sequential, non-transactional writes** (profile
PATCH → TDEE PUT → check-in-config PATCH → goals PUT). The existing hook already reports this
correctly ("Partly saved — the client details were saved, but the rest was not: …"). That must
survive the redesign verbatim; a sheet footer that reports a flat "Save failed" after the profile
already committed tells the coach to redo an edit that is already stored.

**Baseline group — the explanatory paragraph is removed** (owner, 2026-08-27). The two
sentences about start values and logged measurements, and the "Log a measurement" link beside
them, are gone: the grey read-only pills already say the current pair is not editable, and the
Journey tab is one click away in the sidebar. The sheet's `onLogMeasurement` prop goes with them.

**Goals dialog: rejected as instructed.** Goals live in the sheet. The mockup's "Edit goals"
button and the whole `dlg` block are ignored; its cascade warning moves onto the Goals & energy
rail as the mockup's other half already does.

---

## 5. Mapping — every current element to its new home

### Overview page

| Current | New home | Note |
|---|---|---|
| `ClientActivationBanner` (setup_in_progress) | **unchanged, still first** | mockup has no slot for it; it must not be lost. `onOpenProfile` → open sheet. |
| Waiting on you → count chip | Needs attention rail meta | |
| → empty "You're caught up on {name}" | same, in the card | |
| → unreviewed check-in row + **Review** button | alert row, action "Review" → check-ins | button becomes the mockup's right-hand text action |
| → blockEnding row + **Open Journey** `{journey:"blocks"}` | alert row, action "Journey" | the `extraParams` round-trip must survive — it is a client-page URL contract |
| → alert rows (severity dot, message, dest label, chevron) | alert rows (icon thumb, title, sub, action) | copy from the **existing** dashboard functions; icon from `alertDestination().tab`, tint from `severity` — FLAG F |
| → hover-× dismiss | **kept**, same position | FLAG E changes what one × dismisses |
| Since last visit → Mark seen (+spinner, disabled) | that column's rail `actions` | |
| → first-visit vs caught-up empty states | unchanged | |
| → 4 activity row types | unchanged | |
| Coach notes → skeleton | unchanged | |
| → pinned + latest-unpinned rows, RowActions pin/delete | unchanged | |
| → draft input + Save (Enter, maxLength 5000) | unchanged | |
| → "Open Notes" | card **footer** | |
| → `DeleteNoteDialog` | unchanged | |
| "Client" rail + `EditRailActions` (pencil/save/cancel) | pencil moves to the **identity row**; save/cancel become the sheet footer | |
| Schedule card → avatar, name, Active dot, email | identity row | |
| → CheckInStrip: skeleton | identity row skeleton | |
| → "Not scheduled" + **"Set a schedule"** | identity row, same copy + action opens sheet | must not be dropped |
| → next due date + due chip + amber-when-overdue thumb | identity row | |
| → "Last submitted {phrase}" | **DROPPED** (Q4). Deliberate deletion, not an oversight — nothing else renders it. |
| → Frequency (read-only) | sheet, now **editable** — FLAG II |
| → Check-in day (editable) | sheet |
| → Gender / DOB (+ birth-date nudge) / Height (metric+imperial, parse hint) / Phone | sheet, Profile | the nudge and the parse hint move with them |
| → Started (editable only when active/paused; "Set on activation") | sheet, Profile | the guard must survive |
| Status card → title "Client status" | gone (the band is unlabelled, the rail says Progression) | |
| → start weight / start BF | sheet, Baseline | |
| → current weight / current BF (+ lifetime delta subs) | delta → band footer "Since start" chip; values → sheet read-only | |
| → goal weight / goal BF (+ goal chips) | band cells 1–2, chips as `s-sub` | `goalState` logic unchanged |
| → BMR / TDEE (+ Custom↔auto toggle, below-BMR error) | band cell 3 (display) + sheet (edit) | |
| → Activity | sheet | |
| → goal start / deadline | deadline → band cell 4; goal start → sheet | |
| → `GoalHistoryPopover` | band footer, beside "Open metrics" (Q7) |
| → "Open Metrics" | band footer "Open metrics →" | |
| Current plan rail + "Week X of Y" | unchanged | plan structure — window must not touch it |
| Plan cards: 3 training states / 2 nutrition states, chips, StatStrips, macro dots | unchanged + scope labels | FLAG I |
| Adherence rail: legend + "Last 14 days" | Signals rail: legend + window label | |
| → loading skeleton, **"Adherence could not be loaded."** error | Signals card must keep both | error state is easy to lose in a rewrite |
| → 3 rows (name, subline, %, dot rail, "Open X") | Signals rows 1–3 | training rail → the training expansion's day strip. **Nutrition and habits rails are dropped** (Q5 — the mockup replaces them with stat grids). Their `rail` arrays keep arriving on the wire, unread. |
| Daily wellness rail + "Last 7 days" + flagged-count chip | Signals row 4 + its expansion; flagged chip on the row | |
| → 5 metric cards (value, flag chip, sparkline, min·avg·max, "Not logged this week") | wellness expansion grid, verbatim | |
| → each card links to the wellness tab | expansion keeps one "Open wellness" | |

### Edit form

Every field in `use-client-profile-edit.ts` has a home in the sheet. Nothing is dropped. The
**hook's guards** are the part at risk, and each is listed as a flag in §6.1.

---

## 6. Flags

### 6.1 Orphaned logic — behaviour the current UI exposes that the redesign must not lose

- **FLAG S — the start-edit confirm.** Editing a *recorded* start weight/BF raises
  `ConfirmStartEditDialog` before writing (it overwrites a fact nothing can recover and re-bases
  every progress figure). The sheet's Save must call `requestSave`, not `save`. Filling a *blank*
  start is deliberately not confirmed — keep that split.
- **FLAG Q — goal writes are change-detected, and that is load-bearing.** `updateGoals`
  supersedes-and-inserts on **every** call with no change detection of its own. The hook compares
  each goal field against its seed so editing a phone number does not mint a `client_goals` version
  + audit event. Also: goals go via `PUT …/goals`, **never** the client PATCH — a partial goal
  PATCH silently clears the other goal target (recorded landmine, re-fixed `c010741`).
- **FLAG R — unit round-trips.** `useCanonicalInput` / `useHeightInput` commit
  `isPristine ? seed : canonical`, compared on the **seeded string**, so tabbing through a field is
  an exact no-op. Replacing them with `<Input>` + `Number()` drifts every stored weight/height on
  every save for imperial coaches (CONVENTIONS §20).
- **Clearing guards.** A weight (start, current, goal) cannot be *removed* — the schemas are
  non-nullable — so the hook refuses with a named toast rather than silently keeping the old value.
  Body fat **is** clearable, on purpose: it switches BMR between Mifflin-St Jeor and Katch-McArdle,
  so withdrawing it must be expressible.
- **TDEE below BMR** blocks the save with the BMR named. Keep.
- **Birth-date nudge** shows *only* when the calculator reports `ageSource === "assumed_default"` —
  i.e. not when body fat is present (Katch-McArdle has no age term).
- **Height parse error** hint ("Enter a height above 0").
- **`startDate` editable only when `onboardingStatus` is active|paused.** Before activation there
  is nothing to correct, and an editable field there was *worse than useless*: the activation dialog
  prefills today and always sends it, so a pre-set start date was silently replaced on activation.
- **Check-in-config echo.** That schema requires frequency + reminder preferences on every write;
  the hook echoes the untouched ones back verbatim. Dropping that nulls a client's reminders.
- **Partly-saved error copy** (four non-transactional writes) — see §4.
- **`clientSectionRef` + `scrollIntoView`** exists only because the activation banner's
  Client-profile row opened an editor that was off-screen. With a sheet it is dead — delete it,
  don't port it.
- **`handleSaved` double-invalidation.** A save touches goals *and* the client record (goal writes
  dual-write the `clients` mirror), so it must invalidate **both** `useInvalidateClientGoals` and
  `mutateBrief` + `mutateClient`. Easy to lose when the hook moves into a sheet.

### 6.2 Unbacked UI — things the mockups show that the codebase cannot currently produce

- **FLAG A — RESOLVED (Q1: `30 / 60`, no `ALL`).** The adherence route clamps `days` to
  **[7, 28]**, so both options would silently return **28 days** under a rail saying "Last 60
  days". Fix: raise `MAX_DAYS` 28 → **60** in commit 2 (`MIN_DAYS` stays 7 — other callers may
  use it). Dropping `ALL` removes the unbounded case; see §3.2 for why that matters.
- **FLAG BB — RESOLVED (Q2: no wellness percentage).** Training %, nutrition % and habits % are
  real (`AdherenceSummary`); there is no composite wellness score anywhere in this codebase, only
  per-metric tones (`utils/wellness-color-thresholds.ts`), and inventing one would be new business
  logic. The Wellness row therefore renders **no % and no bar** — it carries the existing
  flagged-count chip and a sub-line, and expands to the five metric cards.
  **Layout consequence:** row 4 breaks the 4-row grid the other three share (name · % · bar · sub).
  It keeps the same name/sub columns and leaves the % and bar slots empty rather than reflowing,
  so the four rows still read as one set.
- **FLAG T — the Signals expansions:**
  - *training session-by-session* — the **dot rail** is backed (it is the existing rail). Session
    **names** per day are not; nothing the Overview fetches has them.
  - *nutrition avg calories / avg protein vs target* — **not** in `AdherenceSummary`, but free:
    `nutrition_logs` **snapshots the per-day target** (`target_calories`, `target_protein_g`,
    `target_carbs_g`, `target_fat_g`), so both the actuals and the targets come from the query
    `client-adherence-service` **already runs** for that exact window — four more columns, no plan
    resolution, and the target is the one that applied *on that day* rather than today's.
    Average over days where actual and target are both non-null (a day with no plan has a null
    target); the row count for that average is not the same as `loggedDays`, so the panel should
    say which it is.
  - *per-habit sparklines* — **not** in `AdherenceSummary`, but backed by
    `/api/clients/[id]/habits/logs?startDate&endDate` (`HabitLogWithDetails` carries `habitName`).
    The Overview **deliberately disabled** that fetch (`withHabitLogs: false`); turning it on costs
    one request. Caveat: a habit with **zero** logs in the window returns no rows and silently
    vanishes from the grid — the habits list is needed for completeness.
  - *wellness min/avg/max* — backed; just needs the window widened from 7 days.
- **FLAG U — RESOLVED (Q8 = b).** Same data as Physique, fetched through a new bounded route.
  Spec in §3.1.1.
- **FLAG J — DROPPED (Q9).** No derived "No active program" row. The Plan card's own empty state
  already says it, and `OverviewPlanSummary` carries no ended-plan name to put in the sub-line.
- **FLAG K — DROPPED (Q9).** No "Message" action; there is no messaging surface. Every alert's
  right-hand action is its existing destination label.
- **FLAG L — RESOLVED (Q10): the Units field is dropped.** Units are client-controlled
  (`updateSettingsSchema`, `PATCH /api/client/settings`, set from `/client/settings` and intake);
  `updateClientSchema` has no `unitPreference` and the coach's own display units come from
  `/api/me/unit-preference`. Nothing about units appears in the sheet.
- **FLAG M — RESOLVED (Q6): status is read-only.** *What "paused" is:* `onboardingStatus` is a
  five-value enum (`pending_intake | intake_completed | setup_in_progress | active | paused`).
  `paused` is allowed by the type and the column but **nothing in the app writes it** — one read
  site (`client-schedule-card.tsx:253`, which counts paused as "has started" so the start date
  stays editable) and zero writers. It is a designed-but-never-built state. That is why the
  mockup's three-option select was a problem: it offers a state no code can produce, while
  "Inactive" maps to a different field entirely (`active: boolean`).
  The sheet therefore renders status as **display-only text**, derived from `onboardingStatus` +
  `active`, with no writer.
- **Sidebar dots** (`sb-dot` in the mockup) — not backed and out of scope; the sidebar is shared
  by every client tab.

### 6.3 Rules the redesign may break

- **FLAG D — window reach.** Confirmed structural (window must **not** touch): goal targets,
  BMR/TDEE, deadline, plan name/week/frequency, `nextSession`, nutrition rest/train/today, next
  check-in. Two subtler ones:
  - **"Since your last visit" is anchored to `last_viewed_at`, not to a window.** It sits under a
    page that now has a global window control; it must be visibly outside it (its own rail, which
    the mockup does).
  - **The band's footer chip is lifetime** (`current − starting`), inside a band the "Progression"
    rail's window control appears to govern. The `Since start:` prefix is what resolves that —
    it is **mandatory**, not decorative.
- **FLAG I — the plan card's scope labels.** The contradiction you saw is real and has **three**
  axes, not one:

  | | Plan card "This week 2 of 2" | Signals "Training 67%" |
  |---|---|---|
  | window | coach-local calendar week, anchored on the **client's check-in day** | client-local trailing N days |
  | completed from | `session_logs.completion_quality === 'full'` | `training_events.status === 'completed'` |
  | planned | events **up to today only** | all events in window, `date ≤ today` |

  (`training-week-summary-service.ts:22` vs `client-adherence-service.ts:128`.) Labelling only the
  window still leaves two sources disagreeing on the same client. Recommendation: plan cell label
  "This week", sub "*logged sessions, Mon–Sun*"; signals row keeps its explicit "4 of 6 sessions
  completed" and the rail carries the window. **Do not** try to reconcile the numbers — both are
  shipped semantics.
- **FLAG B — nutrition % denominator.** `nutritionPct = onTarget / dates.length` (the whole
  window), not `/ loggedDays`. A client who logs 30 of 90 days perfectly reads **33%** beside a
  training % that means something else. Already true at 14 days; the window control makes it
  loud. Not changing it (existing logic rules) — but the sub-line ("18 on target · 74 days
  logged") must stay, and the bar must not read as "how well they ate".
- **FLAG H — "weeks remaining" on the deadline cell.** The current status card **deliberately**
  leaves that third column empty: *"a derived 'time left' readout would be a new invented stat,
  not a field this editor owes."* Your mockup adds it. It is fine to add — but there is a shipped
  formula (`comparison-service.ts:102-108`: whole days to the deadline anchored on the **client's**
  local midnight, ÷ 7). Use that anchor. A device-day version will disagree with the check-in chip
  by a day for any client in another zone.
- **FLAG G — the mono range picker.** The design SOT's own tie-break says *"interactive control
  options — select items, segmented values — are controls, not data strings, and stay sans"*, and
  the shipped precedent for this exact control is `metric-progression-section.tsx:61` (a
  30/60/90/All picker in `SectionLabel`'s `actions`, using `LABEL_CLASS` + a teal wash for active).
  Recommendation: copy it verbatim, labels `7 / 14 / 30 / 90 / All`. `check:labels` won't catch a
  mono version, but the doc will.
- **FLAG LL — the on-dark Weight/Body-fat toggle.** The system's hard rule sends every in-card
  two-way toggle to `<SegmentedControl>`, but that component is light-themed. The shipped on-dark
  answer is the **lens row** (`exercise-search-select.tsx`): sentence-case `text-[11px]`,
  `rounded-[4px] px-2 py-1`, active `bg-[rgba(13,148,136,0.15)] text-[#0d9488]`. Your mockup's
  `cp-toggle` is already that. It does not trip `check:labels` clause 3 (that matches the `0.05`
  tint + `p-[2px]` track, which the lens row doesn't use).
- **FLAG II — the Frequency select.** Making it editable is backed
  (`updateCheckInConfigSchema.checkInFrequency`), but the mockup offers **three** options while the
  enum has **five** (`weekly | biweekly | monthly | custom | none`). A client on `custom` (which
  needs `checkInFrequencyDays`) or `none` would be silently rewritten to weekly on save. Needs all
  five, or a guard. Also the current label for `biweekly` is "Bi-weekly", not "Fortnightly".
- **FLAG JJ — "Sex" with two options.** The stored enum is `male | female | other` and the current
  label is "Gender". A two-option select makes an existing value unrepresentable — and silently
  rewrites it on save.
- **FLAG O — editable email.** Backed by the API, and it does **not** break login (a linked client
  resolves by `user_id`, `auth-helpers.ts:130`). But `client_invitations.email` is a snapshot taken
  at send time, and the accept flow verifies `invitedUser.email === invitation.email`
  (`invitation-service.ts:170, 338`). Change the email after an invite is sent and the pending
  invite stays bound to the old address. Recommendation: keep editable, and show a hint when
  `onboardingStatus` is pre-active.
- **FLAG N — DEFERRED (Q6): archive is out of scope.** `DELETE /api/clients/[id]` exists, is a
  soft delete (`active = false`) and busts the auth cache — and still has **zero UI callers**. The
  sheet's danger zone is not built. When it is, it needs: the destructive-confirm recipe (ghost
  Cancel + danger-**outline** CTA — there is no filled destructive button in this system), and a
  decision about where the coach lands, because the client detail page keeps happily rendering an
  archived client. Undo already exists (`POST …/reactivate` + the roster's `?view=inactive`).

- **FLAG E — APPROVED (Q3): suppress, don't merge.** `no_log_gap` and `no_engagement` are **different
  triggers**: `no_log_gap` counts consecutive missing `daily_logs` rows (≥3, nutrition/wellness
  spine only) and routes to **wellness**; `no_engagement` fires only when the client has prescribed
  work, is past an activation grace, and has shown **nothing on any of three surfaces** for 3 days
  — routing to **training**. They can both be live. Merging them into one row means the × must
  dismiss **two** alert types (dismissals are keyed by type in `attention_dismissals`) or the
  survivor reappears on the next revalidate.
  **Approved:** `no_log_gap` is hidden while `no_engagement` is live. `no_engagement` is strictly
  stronger, the dismissal stays 1:1, and it is a renderer-only rule in `lib/attention-alert-copy.ts`
  — the feed and the dashboard are untouched. Worth pinning in a test: the suppressed alert must
  reappear the moment `no_engagement` clears.
- **FLAG F — RESOLVED (Q9): the copy already exists, it just isn't shared.** Alerts carry one
  `message`, and those templates are **regex-parsed by the dashboard feed** — they must not be
  edited. But the dashboard has already solved the two-line problem: `getShortAlertText` and
  `getPriorityAlertText` (`needs-attention-feed.tsx:96-166`) derive a short label and a longer
  sentence from an alert **without touching the templates**. They are local functions inside that
  component, exactly as `alertTabMap` was before the last redesign extracted it.
  **Plan:** extract both into `lib/attention-alert-copy.ts`, refactor the dashboard to import them
  (behaviour identical), and use short = **title**, priority = **sub**. Zero new copy.
  Two gaps to handle, both trivial: `no_log_gap` falls through *both* `default` branches, so title
  and sub would be the same string — render the title alone when they match; and `no_engagement`
  has a short label ("No recent activity") but no priority text, so its sub falls back to the
  message ("No activity logged in the last 3 days"), which reads correctly.
  **Icons:** the mockup's thumb maps to the **destination**, not the alert type — four entries
  keyed on `alertDestination(type).tab` (training/wellness/nutrition/habits), tinted by the
  existing `severity`. No new per-type table.
- **FLAG MM (new, from Q1+Q5) — the training day strip was drawn for 14 days.** The mockup's
  `daylist` is 14 flex cells with a repeating `M T W T F S S` label row. At **30** that is 30
  slivers under four repeats of the labels; at **60**, 60 slivers under eight. The existing dot
  rail has the same problem — it was built for `ADHERENCE_WINDOW_DAYS = 14`.
  **Recommendation:** render it as **rows of 7** (a weeks × weekdays grid) once the window exceeds
  ~21 days. That keeps the one thing the labels buy — day-of-week alignment, so "always misses
  Fridays" is visible — and scales to 60 without slivers. One weekday label row serves every week.
- **FLAG NN (new, from Q1) — `WellnessSparkline` draws a circle per point.** At 60 points in its
  120px viewBox that is ~2px spacing with 4–5px dots: a solid bar, not a sparkline.
  **Recommendation:** suppress the interior dots above ~20 points and keep the last-point marker,
  which is the only one carrying tone. Line geometry is unchanged.
- **FLAG OO (new, from Q1) — two windows inside one wellness panel.** The min/avg/max follows the
  selected 30/60 window, but the flag chip ("High · 3 days") is `alert.affectedDays.length`,
  computed by the trigger over **its own** fixed window. Both are correct; they just aren't the
  same window. Keep both — the chip is an alert, not a window stat — but its copy must not read as
  a statistic about the panel. `WELLNESS_WINDOW_DAYS = 7` dies with the fixed strip.
- **FLAG Z — `SectionLabel` renders `meta` before `actions`** and offers no way to reorder. The
  Signals rail (legend, then meta) must put **both** inside `actions`, as the current adherence
  card already does.

### 6.4 Conditional branches and states the mockups do not show

| State | Identity row | Status band | Needs attention | Signals | Plan / Nutrition | Sheet |
|---|---|---|---|---|---|---|
| **loading** | skeleton for the check-in strip (never "Not scheduled" before the brief lands — pinned by `loading-states.test.tsx`) | cells render from the client record (already loaded); chart pane shows a skeleton | skeleton pair | skeleton | skeletons (existing) | n/a |
| **adherence fetch fails** | — | — | — | **"Adherence could not be loaded."** (existing; must survive) | — | — |
| **no plan assigned** | — | — | derived "No active program" row (FLAG J) | training row `—` / "No sessions planned in this window" | `EmptyInvite` "No training plan on the calendar" + Open Training | — |
| **plan starts in future** | — | — | no alert | training row still `—` | third card state: name + chips + "Starts {date}" (this exists — do not regress it) | — |
| **plan window ended** | — | — | "No active program" | — | the place-a-program invitation is **correct** here (documented decision) | — |
| **first day of a plan** | — | — | — | training `0 of 1` or `—` | "This week 0 of 0" until an event's date ≤ today | — |
| **no measurements logged** | — | current value `—`, rate `—`, **no line**, goal line still drawn; footer chip hidden | — | — | — | current weight/BF read "Not recorded" + "Log a measurement" |
| **1 measurement only** | — | value shown, rate `—` (gate: n ≥ 2 and span ≥ 7 days) | — | — | — | — |
| **no goal / maintenance** | — | goal cells "Not set"; **no goal line**; no goal chips | — | — | — | goal fields empty; deadline `min` still today |
| **no deadline** | — | deadline cell "Not set", weeks-left blank | — | — | — | — |
| **client paused** | status dot + "Paused" | unchanged | unchanged | unchanged | unchanged | Started stays editable (`paused` counts as started) |
| **client archived (`active:false`)** | status "Inactive"; **no** Active dot | unchanged | unchanged | unchanged | unchanged | danger zone offers **Reactivate**, not Archive |
| **`setup_in_progress`** | activation banner above everything | unchanged | unchanged | unchanged | unchanged | Started **not** editable ("Set on activation") |
| **no check-in schedule (`none`)** | "Not scheduled" + **"Set a schedule"** | — | — | — | — | frequency = "No schedule"; next check-in "—" |
| **imperial coach** | height as `5'11"` (composite — `formatHeight` returns a union) | weights via `formatWeight`, chart series converted at source like `useMergedMetrics` does | — | — | protein g/lb | height splits into **two** inputs (ft + in) |
| **overdue check-in** | amber thumb + "N days overdue" chip | — | — | — | — | — |
| **no habits active** | — | — | — | habits row `—` / "No habits active in this window" | — | — |
| **no nutrition plan** | — | — | — | nutrition row from logs only | `EmptyInvite` "No nutrition plan yet" | — |
| **first visit (null anchor)** | — | — | "First time viewing this client" (right column) | — | — | — |

### 6.5 Things that exist for reasons a screenshot won't show

1. **The `blockEnding` row is not an alert.** No dismiss, never on the dashboard feed; it clears
   when the next block starts. It also navigates with `{ journey: "blocks" }` — a client-page URL
   contract, not a decoration.
2. **The dismiss × is shared with the coach dashboard.** One `attention_dismissals` row drives
   both; dismissing here clears it there, and it lapses when a newer day re-trips the trigger.
3. **"Mark seen" is whole-list on purpose** (owner decision: the feed is a digest), and the GET is
   read-only — a page load must **never** advance `last_viewed_at`.
4. **Sleep has no alert branch.** No trigger evaluates it (`wellness-triggers.ts`); its card can
   never flag. The comment says *"Do not invent one."*
5. **The training rail's `none` state renders a dash, not a dot** — no session was planned that day.
   Losing that turns rest days into misses.
6. **Nutrition `pct` counts full hits only**; partial shows on the dot but not in the numerator —
   deliberate, matching the Training tab hero.
7. **`goalStartDate` must come from the raw goal, never from `EffectiveGoal`**, whose `startDate`
   coalesces to today. Seeding a form from the resolved value writes today's date into a field the
   coach never set.
8. **`Client.goalDeadline` does not exist.** `mapClientRow` never mapped it; the deadline resolves
   from `client_goals` only. Do not "helpfully" add a mirror.
9. **`InlineMono` owns its own `1ch` leading gap** and the call site must not also emit a space —
   a sans space beside a mono datum reads as glued-then-airy.
10. **The status card's dark inputs are `h-8` control-scale on purpose** — "it reads as a FIELD,
    not as a stat rendered in a box".
11. **The delta's zero branch is not a warning.** A client who hasn't moved shows neutral, not
    amber; the missing zero branch was an oversight once.
12. **Goal-chip direction assumes a loss goal** (down = good). That is logic, left alone.
13. **The "Calculate BMR" button was removed on purpose** — the pair recomputes on every input
    change, so a manual recalculate button was an admission that it didn't.
14. **Goal history is fetched lazily** (popover-gated) so the Overview doesn't pay for a request
    nobody opened.
15. **The Overview page already costs ~45 Postgres round trips** and `computeProgressionPct` is
    genuinely uncapped (one analytics RPC per distinct exercise). Every fetch this redesign adds
    lands on top of that.

---

## 7. Server changes required (all additive)

| Change | Why | Risk |
|---|---|---|
| `adherence` route: raise `MAX_DAYS` 28 → **60** | FLAG A (Q1) | low; `ALL` is not offered, so the unbounded case never arises |
| `AdherenceSummary.nutrition` += `avgCalories, avgProtein, avgTargetCalories, avgTargetProtein, daysWithTarget` | FLAG T | none — same query, four more columns already on `nutrition_logs` |
| `GET /api/clients/[id]/measurement-series?days=` (new) | FLAG U (Q8 = b) | new route, §3.1.1; must reuse `buildMetricPoints`' tie-break and the client-local anchor |
| ~~`OverviewPlanSummary.endedTraining`~~ | — | **not needed** (Q9 dropped the derived row) |
| `lib/attention-alert-copy.ts` extraction + dashboard refactor | FLAG F | behaviour-identical; pinned by tests before and after |

No migration. No table change. Every existing consumer keeps working.

---

## 8. Commit sequence (each independently revertable)

| # | Commit | Contains | Revert impact |
|---|---|---|---|
| **0** | `chore: land the in-flight status-card change` | the current dirty tree, as-is | baseline hygiene (§0) |
| **1** | `feat(overview): pure helpers` | `rolling-average.ts`, `window.ts`, `client-initials.ts`, and `lib/attention-alert-copy.ts` **extracted from the dashboard** (which refactors to import it — behaviour identical, pinned by tests). Nothing new mounted. | zero UI change |
| **2** | `feat(api): widen the adherence window + nutrition averages` | `MAX_DAYS` 28 → 60, the five additive nutrition fields, service tests | old UI unaffected (`DEFAULT_DAYS` unchanged) |
| **3** | `feat(client): details sheet replaces the inline editor` | the 780px sheet, **five** groups (no danger zone — Q6), `use-client-profile-edit` rehomed. The two existing cards go display-only; the rail pencil opens the sheet; the activation banner rewires. | revert → inline editing returns; page layout untouched |
| **4** | `feat(overview): new shell` | identity row, Progression rail + window state, status band (**4 cells, no chart pane**), needs-attention rewrite, two-up rails, plan scope labels, notes footer. Adherence + wellness cards stay mounted, unwindowed. | revert → old section order |
| **5** | `feat(overview): signals` | one Signals card replacing `adherence-card` + `wellness-cards`; four rows (Wellness with no %/bar — Q2); four expansions per the mockup — training day strip (FLAG MM), nutrition/habits/wellness stat grids; window-driven. | revert → the two old cards return |
| **6** | `feat(api,overview): progression chart` | `measurement-series` route + hook (§3.1.1) + `progression-chart.tsx` + the band re-split into chart ∥ cells + the on-dark metric toggle. | revert → band goes back to 4 cells full-width |
| **7** | `chore(overview): sweep` | delete the dead files, update `docs/ARCHITECTURE.md`, remove dead tests. | — |
| **8** | `refactor(check-ins): one week helper` | §11 — the shared "what week is this client in?" helper; move all six readers onto it. **No behaviour change**, pinned by tests before and after. | revert → readers go back to reading the column |
| **9** | `feat(db): store the check-in due date` | §11 — migration adding `next_check_in_due`, backfilled from the current derivation; nothing reads it yet. | revert → column unused |
| **10** | `feat(check-ins): the date picker, and delete the derivation` | §11 — the picker, the 7-day lapse rule, readers swap to the stored date, `calculateNextExpectedCheckIn` and `expected_check_in_day` deleted. | revert → back to the derived schedule |

Gates on every commit: `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`, `npm run check:labels`.
(`set-tracker.test.tsx` is a known flake in full runs — re-run before blaming the change.)
Browser smoke is yours; I'll hand over a per-commit checklist at 3, 4, 5 and 6 and say plainly that
the UI is unverified until you run it.

---

## 9. Questions — all answered

Every design question is closed. Decisions are recorded at the top and folded into the flags:
Q1 window `30/60` · Q2 no wellness % · Q3 suppress `no_log_gap` under `no_engagement` ·
Q4 drop "Last submitted" · Q5 training day strip only, no nutrition/habits rails ·
Q6 status read-only, archive out of scope · Q7 goal history in the band footer ·
Q8 the bounded `measurement-series` route · Q9 no invented alert rows, reuse the dashboard's
existing copy functions · Q10 no units field.

**Three consequences I decided rather than asked**, because each has one obvious answer and they
only bite at build time — say so if you disagree:

1. **FLAG MM** — the training day strip becomes rows of 7 above ~21 days, instead of 60 slivers.
2. **FLAG NN** — the wellness sparkline drops interior dots above ~20 points.
3. **FLAG F** — alert title = the dashboard's short text, sub = its priority text; when they would
   be identical (`no_log_gap`) the row shows the title alone.

**Still needed before commit 0: the §0 call.** Your working tree is dirty in
`client-status-card.tsx`, `client-overview-tab.tsx` and two test files — the change that removes
the status card's training-block chips. Land it as its own commit first (my recommendation), or
tell me to revert it. Either is fine; leaving it uncommitted is not, because every
"independently revertable" claim below assumes a clean base.

---

## 10. What I am *not* proposing to change

Every calculation, threshold, query and derivation named in §6.5 and §6.3 stays exactly as it is:
adherence classification and percentages, alert triggers and their message templates, goal-state
chips, plan resolution by date, the energy pair, the this-week training summary, `updateGoals`'
supersede semantics, and the units canonicalisation guards. The redesign moves them on screen and
labels their scope. The only new derivations are the rolling average and its window-scoped rate
(§3), both flagged, both pure, both tested.

**Two carve-outs**, both owner-approved after this section was written:

- **Check-in scheduling is being replaced** (§11). It was listed here as untouched until the
  commit-3 smoke showed it reporting a client 4 days overdue and submitted-today at once. Commits
  8–10 only; nothing in commits 4–7 depends on it.
- **`components/ui/sheet.tsx`** lost its per-side edge border (`92fe1de`) — a shared primitive, so
  the change reaches all nine sheets, not just this workstream's.

---

## 11. Check-in scheduling — one stored date, one derivation

Approved 2026-08-27, after the commit-3 smoke surfaced it. **Commits 8–10**, to run after the
Overview is finished so the rebuild is not standing on shifting week boundaries.

### 11.1 What went wrong, and what it revealed

Setting a client's check-in day to Sunday on a Thursday produced **"Sun, 23 Aug · 4 days
overdue"** — last Sunday — beside **"Last submitted today"**. Two contradictory facts about the
same client, on the same card.

`calculateCheckInPeriod(today, day)` returns the 7 days ending on the **most recent past-or-today
occurrence** of the check-in day. That is correct for its original job — stamping the period a
submitted check-in reports on, because a client checking in on Thursday is reporting the week that
ended on Sunday. `calculateNextExpectedCheckIn` reuses it to answer a **different** question —
"when is the next one due?" — and hands back that same past date whenever the client has not
submitted for it.

For a client genuinely late, that is right, and it is load-bearing: a past due date **is** how
overdue is defined (`getDaysUntilOrPastDue` > 0), which drives the roster's Overdue view, the
sidebar badge and the reminder emails. A blanket "due dates must be in the future" would take all
three dark.

It is wrong only in one case: **immediately after the schedule changes.** The client was never on
Sundays last week, so the deadline being measured against never existed. The codebase already
holds this principle and only half-applies it — there is a guard reading *"new client with no
prior check-ins: don't expect a check-in for a period that ended before the client was created"*.
Same reasoning, anchored on client creation; nothing anchors on when the schedule changed.

### 11.2 The real root cause: one field, three systems

`expected_check_in_day` answers three unrelated questions (the full consumer list is §11.4):

1. **When is this client's check-in due?** — a schedule (System A).
2. **Which seven days does a submitted check-in report on?** — a period, stamped onto the row
   and driving the client app's check-in gate (System B).
3. **Where does this client's week start and end?** — a reporting boundary for training,
   nutrition targets, habits, wellness, the attention feed and the client portal (System C,
   twelve callers).

They were merged because with weekly check-ins all three coincide. Changing the day moves System A
while silently re-cutting every window in System C.

**System C is downstream of System A, not a peer.** The training week ends on the check-in day so that
the numbers in a check-in match the numbers on the Training tab. It exists to serve the check-in.
So it should not be stored — it should be **computed**, by one function, from the schedule.

System B keeps its own job and its own maths (§11.7); only its *source* moves.

> A first draft of this plan kept the weekday as a stored mirror written alongside the date.
> Rejected by the owner, correctly: two stored copies of one fact with a sync step is the exact
> shape that drifts, which is the bug being fixed. The distinction that matters is **a copy versus
> a calculation** — a copy has to be kept in step; a calculation cannot be out of step.

### 11.3 The model

**One stored fact:** `clients.next_check_in_due` (date, nullable — null replaces the
`frequency = 'none'` special case).

| Question | Answered by |
|---|---|
| When is the next check-in due? | the stored date, read directly |
| Is this client overdue? | `next_check_in_due < today` |
| Has this one lapsed? | `today > next_check_in_due + 7` → roll forward by whole frequency steps |
| What week is this client in? | `clientWeek()` — the 7 days ending on the most recent occurrence of `weekday(next_check_in_due)` |

**Writers, and there are only two:** the coach's date picker sets it outright; a submitted
check-in advances it by the frequency. Nothing else.

**The rule, stated for the first time:** a due check-in stays satisfiable for **7 days**, then it
lapses and the next becomes live. Today that window exists only as a side effect — the period
snaps forward and the missed week is silently never filled — and `idx_check_ins_period` is a plain
index, not unique, so nothing stops two check-ins for one week either.

**The fortnightly wrinkle.** "The 7 days ending on the due date" leaves a whole week unassigned on
a 14-day schedule. So `clientWeek()` takes the **weekday** of the due date and finds its most
recent occurrence — a steady weekly rhythm at any frequency, exactly as today. Still a calculation
from the one stored fact, not a second stored fact.

**No schedule at all** still needs a week boundary. Two services already fall back to Monday; the
helper adopts that, in one place instead of two.

### 11.4 Blast radius — the full sweep

`expected_check_in_day` keys **three separate systems**. Every consumer below was traced, not
sampled.

#### System A — the schedule (`lib/check-in-schedule.ts`, 5 exported functions)

| Consumer | What it drives |
|---|---|
| `services/check-in-tracking-service.ts` | re-exports all five; owns `getOverdueClients` + `getClientsDueSoon` |
| `services/client-overview-brief-service.ts` | `checkInTiming` on the Overview (next due, days until, isOverdue) |
| `services/reminder-service.ts` | reminder emails **and** the automatic reminder sweep (1–3 days late → "overdue", 4+ → "follow_up") |
| `services/comparison-service.ts` | the check-in comparison view's pace figures |
| `services/check-in-adherence-service.ts` | `getFrequencyInDays` → `clients.check_in_adherence_rate` |
| `app/api/clients/overdue` · `due-soon` | the roster's Overdue view, its counts, the sidebar badge |
| `components/clients/roster/roster-row.tsx` | **browser** — renders "Nd late" per row |
| **`app/api/client/notifications/route.ts`** | **the CLIENT app's own notifications** |

#### System B — the period (`lib/date-helpers.ts`)

| Consumer | What it drives |
|---|---|
| `getCheckInStatus` → `/api/client/check-in-status` + `/api/client/check-in-context` | **the client app's check-in gate** (`not_due` / `available` / `overdue` / `completed`), rendered by `components/client-portal/day/check-in-card-summary.tsx` |
| `resolveCheckInWindow` → `services/check-in-service.ts` | stamps `check_ins.period_start` / `period_end` at submit |
| `calculateCheckInPeriod` → `check-in-details-service`, `client-check-in-service`, `/api/check-in/[id]/ai-summary`, `/api/client/check-ins` | the window every check-in reader and the AI prompt summarise |

#### System C — the week anchor (`getTrainingWeekStart` / `getTrainingWeekEnd`, **12 callers**)

This is the widest and the least obvious. It reaches **training, nutrition, habits, wellness, the
attention feed and the client portal**:

| Caller | Layer |
|---|---|
| `services/training-week-summary-service.ts` | the Overview's "This week" + `/history/training/summary` |
| `services/client-training-week-service.ts` | client-facing training week |
| `services/training-event-layout-service.ts` | calendar event layout |
| `services/training-log-service.ts` | week-scoped log reads |
| `services/check-in-context-service.ts` | the check-in form's own week |
| `services/client-portal-service.ts` | **the client app's home** |
| `utils/build-daily-targets.ts` | **per-day nutrition targets** |
| `lib/tracking-triggers.ts` | attention-feed trigger windows |
| `app/api/clients/[id]/habits/weekly` | habits grid |
| `app/api/clients/[id]/history/nutrition/summary` | nutrition weekly summary |
| `app/api/clients/[id]/history/wellness/summary` | wellness weekly summary |
| `components/clients/habits/habits-tab-content.tsx` | **browser** — reads `client.expectedCheckInDay` client-side |

**Two constraints fall out of this table** and both shape the design:

1. **The anchor must be derivable in the browser.** `habits-tab-content.tsx` computes its week
   client-side off the `Client` object. So whatever replaces the column has to ride on `Client` and
   be resolvable by a pure function — the same reason `lib/check-in-schedule.ts` was put in `lib/`
   ("so the browser can run it too").
2. **`/api/client/**` is the RN contract.** Three client-facing routes consume Systems A and B.
   Their response shapes must not change, or the mobile client breaks — the internals swap, the
   wire does not.

#### Denormalised columns that hang off this (migration 008)

`check_in_frequency`, `check_in_frequency_days`, `expected_check_in_day`, `last_reminder_sent_at`,
`reminder_preferences`, `total_check_ins_expected`, `total_check_ins_completed`,
`check_in_adherence_rate`, `current_streak`, `longest_streak`, plus the `check_in_reminders` table
and three indexes on `clients`. Only `expected_check_in_day` is in scope; the rest are named so
nobody assumes the migration is bigger than it is.

#### Tests

**15 test files** touch this surface and will need review:
`__tests__/lib/date-helpers.test.ts`, `check-in-tracking-service`, `check-in-service`,
`check-in-details-service`, `client-service`, `client-overview-brief-service`,
`attention-feed-service`, `client-training-week-service`, `training-event-layout-service`,
`training-log-service`, `/api/client/check-in-context`, `/api/client/check-in-status`,
`/api/client/notifications`, `/api/clients/[id]/history/wellness/summary`,
`components/clients/overview/loading-states`.

---

### 11.5 A live bug found during this sweep — fix it in commit 8

`getTrainingWeekStart(date, checkInDay)` computes the week start as *the day after the check-in
day*: `(DAY_NUM[checkInDay] + 1) % 7`. With **no** check-in day it falls back to `1` — Monday.

The twelve callers disagree about how to spell "no check-in day":

- `training-week-summary-service.ts` passes `?? "monday"` → `(1 + 1) % 7` = **Tuesday**, so the
  week runs **Tue–Mon**.
- Everyone else passes `?? null` → **Monday**, so the week runs **Mon–Sun**.

So a client with no check-in day is measured over **two different weeks depending on which surface
is asking**: the Overview's "This week: 2 of 4" and `/history/training/summary` use Tue–Mon, while
their nutrition summary, wellness summary, habits grid and calendar layout use Mon–Sun.

This is live today and unrelated to the redesign. It is exactly the failure mode the whole section
is about — a default spelled twelve times instead of once.

**Consequence for the plan:** commit 8 is therefore *not* a pure no-op. It is a no-op for any
client with a check-in day, and a deliberate correction for one without. That correction belongs
in the commit body, not in a footnote.

**Decided (owner, 2026-08-28): Mon–Sun.** On the merits, not on how many rows it touches — a
client with no check-in day gives no reason to believe their week ends on a Monday. `?? "monday"`
was never a considered choice; it is a default that the "week ends on the check-in day" rule then
turns into a Tue–Mon week nobody asked for. Mon–Sun is what a coach means by "this week" when
nothing else is specified.

---

### 11.6 Commits

| # | Commit | Contains |
|---|---|---|
| **8** | `refactor(check-ins): one owner for the week anchor` | New `checkInWeekday(client)` — the single place the anchor weekday is derived, with **one** no-schedule fallback (§11.5). All twelve `getTrainingWeekStart/End` callers route through it; the six `.select("expected_check_in_day")` reads become one. `getTrainingWeekStart/End` themselves are untouched — they are correct weekday maths; only the *sourcing* was duplicated. Behaviour-identical for any client with a check-in day; §11.5's correction for those without. |
| **9** | `feat(db): store the check-in due date` | Migration adding `clients.next_check_in_due` (date, nullable), backfilled by running today's derivation once per client so nobody's date moves. Nothing reads it yet. Verified against the live derivation before commit 10. |
| **10** | `feat(check-ins): the date picker, and delete the derivation` | The picker (`<Input type="date">` + `min={today}`); the 7-day lapse rule; System A swaps to the stored date; `checkInWeekday` changes its **one** function body to derive from the due date, and all twelve week callers follow with no edit; **`calculateNextExpectedCheckIn` and `expected_check_in_day` both deleted.** |

**Why the three-way split matters:** after commit 8 nothing in the repo reads
`expected_check_in_day` except the schedule functions, and after commit 10's swap nothing reads it
at all — which is what makes dropping the column safe rather than hopeful. Commit 8 is also
independently valuable: it fixes §11.5 whether or not the rest ever ships.

---

### 11.7 Flags

- **Overdue detection is load-bearing across four surfaces** — the roster's Overdue view and its
  counts, the sidebar badge, the reminder emails and the automatic reminder sweep. Commit 9's
  backfill must be verified against the current derivation before commit 10 points anything at the
  new column: not to protect existing rows, but because the backfill is the moment a stored value
  replaces a computed one, and a wrong stored value is wrong for every client from then on.
- **`/api/client/**` response shapes must not change.** `check-in-status`, `check-in-context` and
  `notifications` are the RN contract; the mobile client reads `status`, `nextDueDate` and the
  notification payloads. Internals swap, wire does not. Their three test files are the guard.
- **The anchor must stay browser-resolvable.** `habits-tab-content.tsx` derives its week client-side
  from the `Client` object, so `checkInWeekday` lives in `lib/` with no server imports, and
  `next_check_in_due` must be mapped onto `Client` in `lib/mappers.ts`.
- **The column must be DROPPED, not kept.** A surviving `expected_check_in_day` gets read again in
  six months and the two-jobs problem returns.
- **`calculateCheckInPeriod` stays.** It keeps its original job — stamping `period_start` /
  `period_end` on a submitted check-in, and driving the client's check-in gate. Only
  `calculateNextExpectedCheckIn` goes.
- **`getCheckInStatus` needs a decision in commit 10.** It answers the client-side gate
  (`not_due` / `available` / `overdue` / `completed`) and carries its own new-client guard, which is
  a *third* copy of the "don't expect a check-in from before you existed" rule. It should read the
  stored due date too — but that is a client-app behaviour change and wants its own smoke.
- **`min={today}` on the picker is an affordance, not a control.** The route keeps its own
  validation; the bound exists so a coach never reaches it by accident
  (`docs/newdesignsystem.md` → date inputs).
- **Not events.** Modelling check-ins as calendar events like training and nutrition is deferred,
  not rejected: those are *bounded placements* (a plan has a duration and generates a known number
  of events), whereas a check-in schedule is *unbounded recurrence*, so events would need a rolling
  materialiser for no gain over a stored date. Events earn their keep the day a single occurrence
  needs to be skipped or moved independently.

---

## 12. Where the build departed from this plan — commits 4–7

Five deliberate deviations. Each is here because the plan said one thing, the code says another,
and the next person to read both needs to know which is right and why.

### 12.1 FLAG I's scope label — the plan's copy was false

**Plan:** the training plan-card's "This week" cell gets the sub-line *"logged sessions, Mon–Sun"*.
**Shipped:** the cell is LABELLED `Logged this week`; the sub-line is unchanged.

`getTrainingWeekStart` anchors the week on the client's own check-in day
(`training-week-summary-service.ts:32-36` reads `expected_check_in_day`, and the week starts the
day AFTER it), so a Wednesday client's week runs Thu–Wed. **§11.5 of this very plan documents the
same thing** from the other side — a client with *no* check-in day is measured Tue–Mon on one
surface and Mon–Sun on eleven others. No fixed weekday pair is true for every client, and
`OverviewPlanSummary.training.thisWeek` carries no window on the wire to print instead.

So the label names the axis that IS true and IS the one that diverges from Signals: this cell
counts full `session_logs` completions, Signals counts `training_events.status`. Putting it in the
label rather than the sub also keeps the mono rule intact — `StatCellData.sub` takes one font, and
"logged sessions · 1 missed" is half words, half numeral.

### 12.2 The habits panel does not come from `/habits/logs` — that source is incomplete

**Plan (FLAG T):** per-habit sparklines come from `GET /api/clients/[id]/habits/logs`, turning on
the `withHabitLogs` fetch the Overview had deliberately disabled; "the habits list is needed for
completeness".
**Shipped:** `AdherenceSummary.habits.perHabit`, on the read that already runs. `withHabitLogs`
stays `false`.

`logHabit` (`services/daily-habits-service.ts:266`) upserts a row **only when the client acts**, so
a habit ignored for the whole window has no rows at all — and a grid built from logs drops exactly
the habit a coach needs to see, silently. The completeness caveat the plan noted is not a footnote;
it is the panel's main job.

`getClientAdherence` already selects this client's active `daily_habits` **and** their
`daily_habit_logs` for this window. `perHabit` is those same rows cut per habit instead of per day:
one more column (`name`), no new query, no new round trip — the same "more columns, same query"
move the nutrition means made in commit 2. The extra request the plan budgeted is not spent at all,
and each habit is scored over its OWN eligible days (before its `effective_date` the rail is
`null`, not `false` — a habit added on Wednesday has not missed Monday).

### 12.3 `buildMetricPoints` was widened rather than fed a fake row

`buildMetricPoints(checkIns: CheckIn[], …)` requires `clientId`, `status` and `updatedAt` that a
four-column projection does not have. Its first parameter is now the structural subset it actually
reads (`MetricSeriesCheckIn = Partial<CheckIn> & Pick<CheckIn, "id" | "createdAt">`). `CheckIn[]`
stays assignable, so the Metrics page is untouched. The alternative was inventing a `status` and an
`updatedAt` the route never fetched, purely to satisfy a type.

### 12.4 Two chart bugs the tests caught, fixed in the component

- **The goal line vanished on an empty window.** recharts renders nothing at all for an empty
  dataset — reference line included — so §6.4's *"no measurements logged → no line, goal line still
  drawn"* silently did not hold. An empty window now draws the target as plain markup: a goal is a
  fact about the CLIENT, not about what these 30 days contain.
- **The readout asserted "No measurements in this window" while still loading.** Before the first
  response `series` is null and the point list is empty, which is indistinguishable from a client
  who has logged nothing. It now shows a skeleton and suppresses the rate line — the same class of
  bug `loading-states.test.tsx` exists to catch on the other two surfaces.

### 12.5 Smaller calls, recorded so they are not re-litigated

- **The alert tab→icon map lives in `needs-attention-section.tsx`, not `lib/attention-alert-copy.ts`**
  (§2.1 put it in the lib). Commit 1 shipped that module without it and there is exactly one
  consumer; four Lucide icons in a pure `lib/` module for one caller is worse than four in the file
  that draws them.
- **`paused` renders as "Active" on the identity row**, against §6.4's row. Status comes from
  `getRosterStatus` / `rosterStatusLabel` — the same derivation the details sheet's hero uses — and
  those map `onboardingStatus: "paused"` to `active`. The tree has **zero writers** of `paused`
  (FLAG M; verified again at commit 4), so this is unreachable. A local override would have been a
  second status vocabulary, which is the mistake `lib/client-initials.ts` exists to undo. Making it
  render "Paused" is a one-line change in `lib/roster-views.ts` that also moves the roster — a
  separate decision, not a silent one.
- **`WindowControl` is its own file**, not inlined in the tab, and **`useClientAdherence`'s `days`
  became REQUIRED** in commit 7: its `ADHERENCE_WINDOW_DAYS` default stopped being reachable once
  the Overview passed its own window, leaving a second silent spelling of a number the route
  already owns (`DEFAULT_DAYS`).
- **The window control appears in commit 4 and reaches nothing until commit 5.** That is the plan's
  own sequencing, not an oversight; the intermediate state exists only in git history.
