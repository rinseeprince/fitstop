# Client Overview Redesign — Execution Plan

Redesign of the coach-facing client Overview tab (`components/clients/client-overview-tab.tsx`, mounted by `app/clients/[id]/page.tsx`). The page reads top to bottom as: what needs my attention, what happened, what I said last time, who this client is, what they are on, how consistent they are, how they feel.

**Split into 2 sessions.** Session 1 = backend + data layer (migrations, endpoints, shared helpers, tests). Session 2 = the UI rebuild consuming Session 1's contracts. Each session's pasteable prompt is at the bottom of its section. Do not start Session 2 before Session 1's STATUS block below reports shipped.

**Completion protocol (both sessions):** at commit time, append a STATUS block to the end of this file — what shipped, commit hash(es), deviations from this plan, test results. The next session reads it before starting.

---

## Locked product decisions (owner-approved 2026-07-26)

1. **Roadmaps/phases are sunset — never reference them.** The Client Status card's header chips render the active **training block** instead: plan name · `Week X of Y` · Active/Ended. No plan → a single "No plan" chip.
2. **Daily Wellness renders FIVE cards** — Mood, Energy, Sleep Quality, Stress, **Soreness**. Soreness and stress are inverted (lower is better) via `utils/wellness-color-thresholds.ts`.
3. **Add a `phone` column to `clients`** (migration) + expose it in the update schema and the new client-settings dialog.
4. **No duration on the "session completed" feed item.** Nothing records actual duration; do not show the prescribed estimate. Item = session name + exercise count only.
5. **PR definition:** heaviest non-warmup set weight **ever** for that exercise. A new log emits a PR item only when its top non-warmup weight beats the pre-anchor all-time best. First-ever logs for an exercise emit nothing.
6. **Progression stat:** mean % change in best e1RM per exercise — current week vs the block's first logged week, averaged over exercises present in both, warm-ups excluded (existing Epley helper + `get_exercise_progression_window` RPC path). Render "—" when insufficient data.

## Global rules (both sessions)

- **UI change only where possible**: existing alert thresholds, messages, and calculations are untouched. The one sanctioned calculation change is the goal-chip state logic (the current `Math.abs` logic is wrong by design). Do NOT edit trigger message templates — the dashboard feed regex-parses them (`components/dashboard/needs-attention-feed.tsx:110-179`).
- **Typography:** mono = numbers only, enforced by `npm run check:labels`. Wherever this plan or the design brief says "mono" for a word-only string (TRAINING, ADHERENCE, day initials, micro-labels), author it with the sans tokens (`LABEL_CLASS`, `SECTION_LABEL_CLASS`, `STAT_LABEL_DARK_CLASS`). Number-bearing strings ("in 5 days", "2d ago", "Week 16 of 17", dates, stat values) use the mono tokens. Always import from `components/clients/training/program-builder/builder-tokens.ts` — never raw `font-mono-display`.
- **Frozen legacy:** do not edit anything under `components/clients/daily-pulse/`. Session 2 unmounts `DailyWellnessStrip` from the Overview; the files stay.
- New routes follow the CONVENTIONS §8 chain exactly (rate limit → CSRF on mutations → `getAuthenticatedCoachId(request)` → ownership → zod → logic). Pass `request` to the auth helper.
- New tables: `ENABLE ROW LEVEL SECURITY` with **no policies** + `GRANT ALL ... TO service_role` only, in the migration (CONVENTIONS §8 precedent: migration 108).
- Migrations: next available numbers (check `supabase/migrations/` — 133 is current max at time of writing). **The owner runs `npx supabase db push` themselves** (tool-permission constraint) — pause and ask, then run `npx supabase gen types typescript --linked > types/database.ts` and commit migration + types together.
- Commit directly to `main`. Commit-ready = `npx tsc --noEmit` + `npx eslint .` + `npx vitest run` + `npm run check:labels` all pass. (`set-tracker.test.tsx` is a known flake in full runs — re-run before blaming your change.)

---

## Target page layout (top to bottom)

1. **Top row** `lg:grid-cols-[3fr_2fr]` — "Waiting on you" (left, wider) + "Since your last visit" (right).
2. **Coach notes** — full-width card.
3. **Client & Schedule + Client Status** — keep the existing `[5fr_8fr]` grid (dark status card wider).
4. **CURRENT PLAN** — `SectionLabel` rule-line header (mono meta `Week X of Y`) + Training and Nutrition cards side by side.
5. **ADHERENCE** — `SectionLabel` header (legend + mono `Last 14 days`) + one card, three rows sharing an aligned 14-day dot rail.
6. **DAILY WELLNESS** — `SectionLabel` header (mono `Last 7 days` + warning count chip) + five compact metric cards.

Quality bar: every empty/unset state names what is missing and offers the fixing action; every summarising card links to its tab (tab ids from `lib/client-tabs.ts`: `training`, `nutrition`, `wellness`, `daily-habits`, `check-ins`, `metrics`, `notes` — navigation via the existing `onTabChange`/`router.replace` pattern, label for `daily-habits` is HABITS).

---

## Data contracts (Session 1 builds, Session 2 consumes)

Types live in `types/coach-brief.ts` (reworked) + a new `types/coach-overview.ts`. These shapes are the interface between sessions — do not drift from them without recording a deviation in the STATUS block.

### `GET /api/clients/[id]/overview-brief` (extended; the GET **no longer upserts** `last_viewed_at`)

```ts
OverviewBrief = {
  lastViewedAt: string | null
  waitingOnYou: {
    unreviewedCheckIn: { id: string; submittedAt: string } | null   // submittedAt = check_ins.created_at (NEW field)
    attentionAlerts: AttentionAlert[]                               // unchanged shape from types/attention-feed.ts
  }
  activity: ActivityItem[]        // newest first, cap 20
  sinceLastVisit: SinceLastVisit  // DEPRECATED counts, kept so the old UI works between sessions; Session 2 deletes
  checkInTiming: {
    frequency: string                    // clients.check_in_frequency
    expectedCheckInDay: string | null
    lastSubmittedAt: string | null       // latest check_ins.created_at
    nextDueDate: string | null           // YYYY-MM-DD, from calculateNextExpectedCheckIn
    daysUntilDue: number | null          // getDaysUntilOrPastDue: negative = days until due, positive = days overdue
    isOverdue: boolean
  } | null                               // null when frequency === 'none'
}

ActivityItem =
  | { type: 'check_in';          at: string }
  | { type: 'measurement';       at: string; metricKey: string; value: number; previousValue: number | null; unit: string }
  | { type: 'pr';                at: string; exerciseName: string; weight: number; previousBest: number }
  | { type: 'session_completed'; at: string; sessionName: string; exerciseCount: number }
```

- **Anchor semantics:** read `coach_client_views.last_viewed_at` first, build everything against it, do NOT write it. The anchor now moves only via the new seen route. Transitional note: between sessions the old UI's counts stop self-clearing on view — expected, do not "fix".
- **Feed sources** (all `> lastViewedAt`, merged newest-first): `check_ins.created_at`; `client_metric_entries` (previous value = the prior same-`metric_key` row by `entry_date`; unit resolved at read time from client prefs — mig 132 stores none per-row); `session_logs.created_at` with `completion_quality != 'skipped'` (exerciseCount = count of its `exercise_logs`); PR detection per decision 5 — for each exercise appearing in the new sessions' non-warmup `set_logs`, compare its new max weight against the pre-anchor all-time best (reuse the `get_exercise_prs` RPC per exercise and filter its rows to `completed_at` before the anchor, or an equivalent scoped aggregate). Skip PR computation entirely when new sessions > 20. Match the existing exercise-history display path for weight units.
- `checkInTiming` reuses `services/check-in-tracking-service.ts` (`calculateNextExpectedCheckIn`, `getDaysUntilOrPastDue`) with the latest check-in's `created_at`/`period_end` — client-local today per that service's own convention. Do not re-implement the period math.

### `POST /api/clients/[id]/overview-brief/seen` (new)

Full mutation chain (CSRF included). Body: none. Calls `upsertLastViewed` (`services/coach-client-views-service.ts`). Returns `{ lastViewedAt }`.

### `GET /api/clients/[id]/overview-plan-summary` (new)

```ts
OverviewPlanSummary = {
  training: null | {
    planId: string; planName: string
    splitType: string | null; frequencyPerWeek: number | null; programDurationWeeks: number | null
    currentWeek: number | null            // via utils/plan-week.ts, null when plan window ended
    thisWeek: { completed: number; planned: number; missed: number }   // EXACT math of /history/training/summary — reuse, don't reimplement
    nextSession: { name: string; date: string; isToday: boolean } | null
    progressionPct: number | null         // decision 6; null = "—"
  }
  nutrition: null | {
    dietType: string | null; customMacros: boolean; proteinGPerKg: number | null
    restDayCalories: number; trainDayCalories: number | null; surplusPct: number | null
    restDaysThisWeek: number
    today: { targetCalories: number; loggedCalories: number | null } | null
    macros: { proteinG: number; carbG: number; fatG: number }
  }
}
```

- Training plan resolved **by date** via the coach-side resolver (`services/training-service.ts` + `training-mappers.ts`) — NOT `getClientTrainingPlan` (that read is deliberately metadata-poor).
- `nextSession`: `training_events` where `date >= clientToday AND status = 'scheduled' AND session_log_id IS NULL`, order `date ASC, created_at ASC`, limit 1 (mirrors the `findMatchingEvent` predicate).
- `surplusPct` = the modal `calorie_surplus_percentage` among this week's training events; `trainDayCalories = round(restDayCalories * (1 + surplusPct/100))`; both null when no training days this week.
- `today` via the existing `getNutritionForDate` (`services/daily-context-service.ts` — log-snapshot-first priority, client-local today). `loggedCalories` null when unlogged.
- `macros` = the plan's effective targets (`custom_macros_enabled ? custom_* : *_target_g`).
- New service `services/overview-plan-summary-service.ts`; keep under the service size guideline by delegating to existing services.

### `GET /api/clients/[id]/adherence?days=14` (new; clamp days 7–28)

```ts
DotState = 'complete' | 'partial' | 'missed' | 'no_log' | 'none'   // 'none' = no session planned (training only) → faint dash

AdherenceSummary = {
  dates: string[]                       // oldest→newest, shared by all rails; window ends client-local today (getClientTodayString)
  training:  { rail: DotState[]; completed: number; planned: number; pct: number | null }
  nutrition: { rail: DotState[]; onTarget: number; loggedDays: number; pct: number | null }
  habits:    { rail: DotState[]; avgPct: number | null; daysBelow50: number }
}
```

Classification (reuses shipped semantics; do NOT invent new math):
- **Training** — from `training_events.status` per date: `completed`→complete, `partial`→partial, `missed`/`skipped`→missed, `scheduled` (date ≤ today)→no_log, no event→none. `pct = completed/planned` (full completions only, matching the Training-tab hero; partial shows on the dot but not in the numerator — deliberate, record nothing).
- **Nutrition** — persisted `nutrition_logs.nutrition_adherence`: hit→complete, partial→partial, missed→missed, absent→no_log. `pct = onTarget/days`.
- **Habits** — per-day `completed/eligible` from `daily_habit_logs` + active `daily_habits` (extend the weekly-service math per-day): 100%→complete, >0%→partial, 0% **with** a `daily_logs` spine row that day→missed, no engagement→no_log. `daysBelow50` uses the existing `HABIT_DROPOFF_THRESHOLD_PERCENT` constant.

New service `services/client-adherence-service.ts` with unit tests over fixture rows.

### Notes: `GET`+`POST /api/clients/[id]/notes`, `PATCH /api/clients/[id]/notes/[noteId]` (new)

```ts
ClientNote = { id: string; body: string; isPinned: boolean; createdAt: string }
```

- **Migration `13X_create_client_notes.sql`:** `client_notes(id uuid pk default gen_random_uuid(), client_id uuid FK clients ON DELETE CASCADE, coach_id uuid FK coaches ON DELETE SET NULL, body text NOT NULL, is_pinned boolean NOT NULL DEFAULT false, created_at/updated_at timestamptz DEFAULT now())`; index `(client_id, created_at DESC)`; partial unique index `(client_id) WHERE is_pinned` (one pinned note max); RLS enabled, no policies, `GRANT ALL TO service_role`. **Seed:** insert one unpinned row per client from non-empty `clients.notes` (with that client's `coach_id`), leave the legacy column in place.
- GET returns pinned first then newest-first. POST body `{ body }` (zod, 1–5000 chars). PATCH body `{ isPinned }` — pinning a note unpins any other in the same statement/sequence (respect the partial unique index).
- New `services/client-notes-service.ts`.

### Migration `13X_add_client_phone.sql` + profile write path

- `ALTER TABLE clients ADD COLUMN phone TEXT` (nullable, no default needed).
- Add `phone` and `startDate` to `updateClientSchema` (`lib/validations/client.ts`) and to `updateClient` (`services/client-service.ts` — `start_date` write), map `phone` in `lib/mappers.ts`. `PATCH /api/clients/[id]` already exists and is currently UI-orphaned; Session 2 gives it a caller.

### Shared helpers (Session 1, all pure + unit-tested)

- **`lib/attention-alert-destinations.ts`** — extract the `AlertType → tab` map out of `components/dashboard/needs-attention-feed.tsx:12-24`, covering all 11 alert types, exporting `{ tab, label }` (labels: TRAINING / WELLNESS / NUTRITION / HABITS). Refactor the dashboard component to import it (behavior identical). No alert type maps to check-ins — the check-in row owns that destination.
- **`utils/plan-week.ts`** — `planWeek(effectiveFrom, todayStr, durationWeeks)` → `floor(daysBetween(effective_from, today)/7)+1` clamped to `[1, durationWeeks]`, null when before start or after the window (the canonical date-walk math, see `services/plan-amendment-service.ts:102-105`).
- **`lib/goals/goal-state.ts`** — `goalState({ start, current, goal })` → `{ state: 'reached' } | { state: 'beyond', amount } | { state: 'gap', amount } | null`. Direction = `sign(goal − start)`; `reached` when `|current − goal| ≤ 0.05`; `beyond` when current has passed goal in the goal direction (amount = overshoot); else `gap`. When `start` is null direction is unknowable → only `reached`/`gap`. Test both loss and gain directions, weight and body-fat shapes.

---

## SESSION 1 — Backend + data layer

**Scope:** the two migrations, the five endpoint groups, the three shared helpers, type files, schema/mapper updates, refactor of the dashboard alert map, unit tests. **No UI changes** beyond the mechanical dashboard-map import refactor. Old Overview UI must keep rendering (the deprecated `sinceLastVisit` counts field stays in the payload).

Existing tests to update: `services/client-overview-brief-service.test.ts` (anchor no longer advances on GET; new feed items; `submittedAt`).

**Definition of done:** migrations pushed (owner runs `db push`) + types regenerated + committed together; all four gates pass; STATUS block appended.

### Pasteable prompt — Session 1

```
Read CONVENTIONS.md (repo root), docs/ARCHITECTURE.md, and docs/newdesignsystem.md in full before doing anything else. Then read docs/OVERVIEW-REDESIGN-EXECUTION-PLAN.md in full — it is the spec for this session and its "Data contracts" section is binding.

Implement SESSION 1 (backend + data layer) of the Client Overview redesign exactly as specified in docs/OVERVIEW-REDESIGN-EXECUTION-PLAN.md:

1. Migration: client_notes table (schema, seed from clients.notes, RLS deny-all + service_role grant, partial unique pin index) — next available migration number.
2. Migration: clients.phone column; add phone + startDate to updateClientSchema, updateClient, and lib/mappers.ts.
3. Rework GET /api/clients/[id]/overview-brief per the OverviewBrief contract: remove the last_viewed_at upsert side effect, add the item-level activity feed (check-ins, measurements with previous-value delta, PRs per the locked heaviest-non-warmup-ever definition, sessions completed with exercise count — NO duration), add checkInTiming via the existing check-in-tracking-service, add submittedAt to unreviewedCheckIn, KEEP the deprecated sinceLastVisit counts field so the current UI still works.
4. New POST /api/clients/[id]/overview-brief/seen calling upsertLastViewed.
5. New GET /api/clients/[id]/overview-plan-summary per the OverviewPlanSummary contract (date-resolved coach-side plan metadata, this-week math reused from /history/training/summary, next-session query, progression per locked decision 6, nutrition block via getNutritionForDate/applySurplusSplit helpers).
6. New GET /api/clients/[id]/adherence?days=14 per the AdherenceSummary contract and its classification table.
7. New notes routes (GET/POST /api/clients/[id]/notes, PATCH .../notes/[noteId]) + services/client-notes-service.ts.
8. Shared pure helpers: lib/attention-alert-destinations.ts (extracted from needs-attention-feed.tsx, which must be refactored to import it with identical behavior), utils/plan-week.ts, lib/goals/goal-state.ts — all unit-tested.

Hard constraints: do not change any alert threshold, trigger message template, or existing adherence/nutrition calculation; every new route follows the CONVENTIONS §8 auth chain with request passed to the auth helpers; new tables get RLS enabled with NO policies and a service_role-only GRANT, in the migration. I will run `npx supabase db push` myself when you ask — after that, regenerate types with `npx supabase gen types typescript --linked > types/database.ts` and commit migration + types together. Commit to main.

Show me your implementation plan first and wait for my approval before writing any code. When done: npx tsc --noEmit, npx eslint ., npx vitest run, npm run check:labels must all pass; then append a STATUS block to docs/OVERVIEW-REDESIGN-EXECUTION-PLAN.md (commits, deviations, test results) in the final commit.
```

---

## SESSION 2 — UI rebuild

**Scope:** rebuild the Overview tab to the target layout, consuming Session 1's endpoints. Read Session 1's STATUS block first. All styling per docs/newdesignsystem.md tokens/components — import, don't re-type class strings.

### Component work

| Piece | File | Notes |
|---|---|---|
| Tab root rewire | `components/clients/client-overview-tab.tsx` | New section order 1–6; unmount `DailyWellnessStrip` (do not edit daily-pulse files); drop the unused `_checkIns`/`_onSelectCheckIn` props |
| Waiting on you | rebuild `overview/waiting-on-you-section.tsx` | Count chip (`COUNT_CHIP_CLASS`); check-in row: `THUMB_CLASS` tile + bold title + "Submitted N days ago" from `submittedAt` + outline Review button → check-ins tab; alert rows become full-width buttons: severity dot (high→critical tone, medium→warning `#d97706`), message, right uppercase destination label (sans `LABEL_CLASS`) + ChevronRight, hover wash, sorted high before medium, navigate via `onTabChange(destination.tab)` |
| Since your last visit | rebuild `overview/since-last-visit-section.tsx` | Feed rows: `THUMB_CLASS` tile per type, bold one-line summary, quiet sub-line detail, right mono relative timestamp; "Mark seen" quiet text button → POST seen + SWR mutate; designed empty state: centred "You're all caught up" + "Nothing new since {date}"; delete the deprecated counts rendering (and the `sinceLastVisit` field + old tests can now be removed from the payload in the same commit) |
| Coach notes card | new `overview/coach-notes-card.tsx` | Pinned note (pin icon, primary tint tile) then most recent unpinned (note icon, neutral `#f0f5f4` tile), mono meta line ("Pinned · 12 Jul"); single-line input placeholder "Add a note about this client" + primary Save → POST + toast + mutate; "Open Notes" teal text link → notes tab |
| Notes tab | replace the inline read-only block in `app/clients/[id]/page.tsx` | Minimal list UI: pinned first, newest-first, pin/unpin action, same add input — same endpoints as the card |
| Client & Schedule | rebuild `overview/client-schedule-card.tsx` | Header: avatar tile, name, email + mail icon, "Active" + teal dot, edit icon → new Client settings dialog; hairline; check-in timing strip from `checkInTiming` (bordered inset panel, calendar icon tile, bold "Next check-in due {date}", quiet "Last submitted N days ago · weekly, any day", mono distance chip; overdue → whole strip + tile + chip flip to warning pair `#d97706` / `rgba(245,158,11,0.07)`, chip "N days overdue"); field grid 2-col with `LABEL_CLASS` micro-labels: Frequency, Check-in day, Gender, Started (mono date), Height, Phone; unset → faint "Not set" + teal "Add" link opening the dialog |
| Client settings dialog | new `overview/client-settings-dialog.tsx` | Standard Teal-Summit Dialog; profile fields (gender, height+unit, started date, phone) → existing `PATCH /api/clients/[id]`; check-in day → existing `PATCH .../check-in-config`; toast + mutate `useClient` |
| Client Status | rebuild `overview/client-status-card.tsx` | Dark `#0f2027`; header: title + translucent chip row (training block: plan name · `Week X of Y` mono · Active — from the plan-summary payload; "No plan" chip otherwise); 3×3 grid with `rgba(255,255,255,0.07)` hairlines, `STAT_LABEL_DARK_CLASS` labels, `STAT_VALUE_DARK_CLASS` values + small units; row 1 weight (start/current+delta/goal+chip), row 2 body fat, row 3 BMR, TDEE, right-aligned translucent Calculate BMR button (existing POST, unchanged); goal chips via `lib/goals/goal-state.ts` — reached→positive "Goal reached", beyond→positive "{amount} under goal" (loss) / "over goal" (gain), gap→warning "{amount} to go"; footer above `rgba(255,255,255,0.06)` hairline: "Open Metrics" teal link |
| Current plan section | new `overview/current-plan-section.tsx` | `SectionLabel label="Current plan"` + mono meta `Week X of Y`; Training card (tile, plan name, "Open Training" link; chip row split/`Nx/week`/`N weeks` per the training-summary-hero recipe; hairline stat strip: This week `x of y` + "N missed" sub, Next session name + "today · not logged"/date sub, Progression `±N%`); Nutrition card (tile, "Nutrition targets", "Open Nutrition" link; chips dietType/Custom macros|Calculated/`N g/kg`; stat strip: Rest day cal + "N rest days this week", Train day cal + "+N% surplus", Today's target + "N logged so far"|"nothing logged yet"; hairline; three macro chips with dots `#2d8fb5`/`#c8923a`/`#c06060`); missing plan → invitation card: one line + primary button → that tab |
| Adherence card | new `overview/adherence-card.tsx` | `SectionLabel label="Adherence"` with legend (Complete/Partial/Missed/No log dots + sans labels) + mono `Last 14 days`; one card, three rows (Training/Nutrition/Habits) split by hairlines, every row on the same grid template so the 14 dot columns align vertically: bold name + plain-language sub-line, large mono %, 14-dot rail (training `none` → faint dash) with sans day-initial beneath each, "Open {tab}" teal link |
| Wellness cards | new `overview/wellness-cards.tsx` + `overview/wellness-sparkline.tsx` | `SectionLabel label="Daily wellness"` + mono `Last 7 days` + warning-toned count chip when any metric flagged; five compact cards (Mood /5, Energy, Sleep Quality, Stress, Soreness /10): name + warning chip ("Low · N days" for mood/energy drops, "High · N days" for stress/soreness — derived from the brief's `attentionAlerts` types mood_drop/energy_drop/high_stress/high_soreness + their affectedDays; sleep never flags — no trigger exists, add none); large mono value + small scale suffix; 7-point sparkline (plain inline SVG polyline + one circle per point, latest filled — no chart lib); mono footer "min 3 · avg 4.6 · max 7"; flagged card gets the warning border; whole card clickable → wellness tab. Keep cards compact — value-forward, no wasted height |

Data: brief + plan-summary + adherence via new SWR hooks (`swrFetcher`, `revalidateOnFocus: false`); wellness values from the existing daily-logs fetch narrowed to 7 days.

**Definition of done:** all four gates pass, plus a real browser smoke of `/clients/[id]?tab=overview` (CDP against `next dev`) verifying: section order, alert-row navigation, Mark seen clears the feed, note add + pin, settings dialog saves, goal chips in all three states (fixture-editable), adherence rails align, five wellness cards + flags render, and console is clean. STATUS block appended. After shipping, update `docs/ARCHITECTURE.md` (client_notes table, phone column, new overview endpoints, the Overview row of the tab table).

### Pasteable prompt — Session 2

```
Read CONVENTIONS.md (repo root), docs/ARCHITECTURE.md, and docs/newdesignsystem.md in full before doing anything else. Then read docs/OVERVIEW-REDESIGN-EXECUTION-PLAN.md in full — it is the spec for this session. Session 1 (backend) is already shipped; read its STATUS block at the bottom of that doc and verify its endpoints exist before you start.

Implement SESSION 2 (UI rebuild) of the Client Overview redesign exactly as specified in the plan's SESSION 2 section: rebuild the coach client Overview tab (components/clients/client-overview-tab.tsx and components/clients/overview/*) to the six-section layout, consuming the Session 1 data contracts (OverviewBrief with activity feed + checkInTiming, OverviewPlanSummary, AdherenceSummary, notes routes).

Non-negotiables:
- All styling from docs/newdesignsystem.md via imported tokens/components (builder-tokens, SectionLabel, THUMB_CLASS, chip/stat recipes). Mono = numbers only; word labels use the sans label tokens even where the layout brief says "mono". npm run check:labels must pass.
- No roadmap/phase references anywhere — the status-card chips show the active training block (plan name · Week X of Y · Active).
- Five wellness cards including Soreness (stress + soreness inverted via utils/wellness-color-thresholds.ts); sleep has no alert trigger, so its card never flags.
- Do not edit anything under components/clients/daily-pulse/ — just stop mounting DailyWellnessStrip on the Overview.
- Wire "Mark seen" to POST /api/clients/[id]/overview-brief/seen; delete the deprecated sinceLastVisit counts field end-to-end in this session.
- Goal chips must use lib/goals/goal-state.ts (reached / beyond / to-go states).
- Every empty or unset state names what is missing and offers the fixing action; every summarising card links to its tab.

Show me your implementation plan first and wait for my approval before writing any code. When done: npx tsc --noEmit, npx eslint ., npx vitest run, npm run check:labels must all pass, AND smoke the real rendered page in a browser (next dev + CDP) — verify section order, alert-row tab navigation, Mark seen clearing the feed, note add/pin, the settings dialog saving, goal-chip states, aligned adherence rails, and the five wellness cards, with a clean console. Then update docs/ARCHITECTURE.md for the new table/column/endpoints and append a STATUS block to docs/OVERVIEW-REDESIGN-EXECUTION-PLAN.md in the final commit. Commit to main.
```

---

<!-- STATUS blocks append below this line -->

## STATUS — SESSION 1 (backend + data layer): SHIPPED 2026-07-26

**Session 2 is unblocked.** Every contract below is live on `main` and gate-verified. The old Overview UI still renders (the deprecated `sinceLastVisit` counts field is intact).

### Commits (main, in order)

| Commit | Scope |
|---|---|
| `8843b00` | Migrations 134 (`client_notes`) + 135 (`clients.phone`), regenerated `types/database.ts`, `phone`/`startDate` write path |
| `f8b7445` | `lib/attention-alert-destinations.ts`, `utils/plan-week.ts`, `lib/goals/goal-state.ts`, `metricEntryUnit()`, dashboard-feed map refactor |
| `cf92f46` | `overview-brief` rework (read-only anchor, activity feed, `checkInTiming`, `submittedAt`) + `POST …/overview-brief/seen` |
| `03bfee9` | `overview-plan-summary` + `adherence?days=` + the extracted `training-week-summary-service` |
| `966cf55` | Notes routes + `client-notes-service` |
| _this commit_ | This STATUS block |

`npx supabase db push` applied 134 and 135 to the live DB (owner-run); types were regenerated in the same commit and the diff was exactly `client_notes` + `clients.phone`.

### Gates

`npx tsc --noEmit` clean · `npx eslint .` 0 errors (213 pre-existing warnings) · `npx vitest run` **219 files / 2211 tests pass** · `npm run check:labels` OK (610 files). 74 new/updated tests across 8 files; the `set-tracker.test.tsx` flake did not appear.

### Deviations from the plan

1. **`training-week-summary-service.ts` is new (not in the plan's file list).** The this-week math was *inline in the `/history/training/summary` route*, so "reuse, don't reimplement" required extracting it. Both callers now share it verbatim; the route's response shape is unchanged (its inline-500 on a query error became a `throw` its own catch renders identically).
2. **`requireCoachAuth`/`requireCoachOwnsClient` gained an optional `request` param.** The mandated "pass `request` to the auth helpers" was impossible otherwise — the shared ownership helper never forwarded it. Optional, so all ~23 existing call sites are unaffected; every route touched here passes it.
3. **`metricEntryUnit()` added to `lib/metrics/metric-entry-definitions.ts`.** The contract's "unit resolved at read time from client prefs" had no server-side implementation — the only unit map lived in a client-component hook. Mirrors it exactly (weight → `clients.weight_unit`; girths pinned to `in` as the coach surface does; `%`, `/5`, `/10`).
4. **`unreviewedCheckIn` keeps `createdAt` + `status` alongside the new `submittedAt`**, marked `@deprecated`, so the pre-redesign UI keeps rendering. Session 2 removes them with `sinceLastVisit`.
5. **PR "pre-anchor best" is computed by excluding the new sessions' attribution DATES, not by comparing row dates against the anchor timestamp** as the contract's parenthetical suggested. The contract's own "or an equivalent scoped aggregate" escape hatch covers this. See the landmine below — the literal reading is broken.
6. **Measurement predecessors use one bounded query per new row** instead of a single history fetch (which would truncate at PostgREST's row cap for long-tenured clients and return an arbitrary "previous" value).
7. `restDayCalories` honors the custom-macros override (`custom_calories` when enabled), matching how the contract already treats `macros`.

### Interpretation defaults (spec was silent; change freely in Session 2 if the UI wants otherwise)

First visit (null anchor) → empty `activity`; multi-event adherence days collapse all-completed→complete / any-progress→partial / any-missed→missed / else no_log; `pct` fields are 0–100 rounded integers; modal-surplus ties break to the larger value; `restDaysThisWeek` = 7 − distinct event dates.

### Landmines for Session 2 (and anyone touching this code)

- **`session_logs.completed_at` is the prescribed day, written as a bare date → midnight; `last_viewed_at` is a clock time.** Comparing them directly made a session logged after a same-morning "Mark seen" its own previous best, silently suppressing **every** PR in the everyday "mark seen in the morning, client trains that evening" rhythm. Any future "since the anchor" logic over `completed_at` must exclude by date, not by timestamp. Caught in review, fixed in `cf92f46`, regression-tested.
- **Residual known edge (accepted):** a *pre-existing* session attributed to the same calendar date as a new session is excluded from `previousBest` too, so that number can be understated on such a date. The RPC keeps the earliest date per rep bucket, so a weight first hit on an older date still survives.
- **The notes pin flow is two non-transactional writes.** The existence/ownership check MUST stay ahead of the unpin sweep — with the original order, a 404 on a stale or foreign `noteId` had already cleared the client's pin. Caught in review, fixed in `966cf55`, regression-tested.
- **`clients.notes` is seeded-from, not migrated-away.** The legacy column still exists and the pre-redesign Notes tab still reads it. Session 2 replaces that inline block with the new endpoints; nothing writes the old column from the notes surface.
- Two files still carry stale *descriptions* of the removed GET side effect (a test name in `app/api/clients/[id]/overview-brief/route.test.ts` and a comment in `hooks/use-overview-brief.ts`). No assertion or logic depends on them; Session 2 rewrites both areas anyway.

### Not done here (by design)

No UI work beyond the mechanical dashboard-map import. `docs/ARCHITECTURE.md` is **not** yet updated for `client_notes` / `clients.phone` / the four new endpoints — the plan assigns that to Session 2's close-out.

---

## STATUS — SESSION 2 (UI rebuild): SHIPPED 2026-07-26

**The redesign is complete.** All six sections are live on `main`, every Session 1 contract has a consumer, and the deprecated `sinceLastVisit` counts field is gone end-to-end. `docs/ARCHITECTURE.md` is reconciled — this execution plan is now superseded by it plus `CONVENTIONS.md`.

### What shipped

| Piece | Files |
|---|---|
| Tab root, six-section order, `DailyWellnessStrip` unmounted | `components/clients/client-overview-tab.tsx` |
| Shared recipes + pure formatters | `overview/overview-primitives.tsx`, `overview/overview-format.ts` |
| ① Waiting on you · Since your last visit | `overview/waiting-on-you-section.tsx`, `overview/since-last-visit-section.tsx` |
| ② Coach notes | `overview/coach-notes-card.tsx` |
| ③ Client & Schedule · Client Status · settings dialog | `overview/client-schedule-card.tsx`, `overview/client-status-card.tsx`, `overview/client-settings-dialog.tsx` |
| ④ Current plan | `overview/current-plan-section.tsx`, `overview/plan-training-card.tsx`, `overview/plan-nutrition-card.tsx` |
| ⑤ Adherence | `overview/adherence-card.tsx` |
| ⑥ Daily wellness | `overview/wellness-cards.tsx`, `overview/wellness-sparkline.tsx` |
| Notes tab (replaces the inline read-only block) | `components/clients/notes/notes-tab-content.tsx` |
| SWR hooks | `use-overview-plan-summary.ts`, `use-client-adherence.ts`, `use-client-notes.ts`; `use-overview-brief.ts` gained `mutate` + `markSeen()` |

### Gates

`npx tsc --noEmit` clean · `npx eslint .` **0 errors** (212 pre-existing warnings, none in new files) · `npx vitest run` **224 files / 2251 tests pass** · `npm run check:labels` OK (625 files). The `set-tracker.test.tsx` flake did not appear.

### Browser smoke — PASSED

`next dev` + CDP against the fixture scale client. Verified: section order 1→6; alert rows navigate to their mapped tab (soreness → `?tab=wellness`, habit dropoff → `?tab=daily-habits`); note add (toast + row) and pin (tile/meta/icon flip + toast) persisting to the Notes tab; the settings dialog saving phone + start date into the field grid without a reload; **all three goal-chip states** (`5.0 kg to go` warning → `5.0 kg under goal` positive → `Goal reached`); "Mark seen" clearing a populated feed and advancing the anchor; five wellness cards with Soreness flagged `High · 3 days` and Sleep unflagged. **Console clean — zero errors across the whole run.**

Rail alignment was measured on rendered pixels, not class arithmetic: all three rails report identical `grid-template-columns` and identical per-column `left` values, and the training rail's faint dashes share the dots' centre-Y exactly (223px, 0px delta).

### Deviations from the plan

1. **`overview-format.ts` is new (not in the plan's file list).** The plan put the formatting helpers in `overview-primitives.tsx`; splitting the pure functions out mirrors `metrics-format.ts` and keeps both files inside the size guideline.
2. **The plan's "chip row / stat strip" cards became three files** (`current-plan-section` + one card each) rather than one `current-plan-section.tsx`, for the same reason.
3. **`utils/wellness-color-thresholds.ts` was reworked, not merely consumed.** It exported only `getBarColor`, which had **zero call sites** and returned off-system colours (`#10b981`/`#f59e0b`/`#ef4444`), while `mini-bar-sparkline.tsx` carried a private duplicate of the inversion rule. Added `getWellnessTone()` + `WELLNESS_TONE_COLOR`, pointed the sparkline at them (rendered output unchanged), deleted the dead `getBarColor`. Owner-approved.
4. **`useWellnessData` gained `{ daysBack, withHabitLogs }`** (defaults unchanged) so the Overview's 7-day read reuses the strip's fetch instead of duplicating it, without editing anything under `daily-pulse/`.
5. **The page-level `CheckInDetailModal` chain was removed** from `app/clients/[id]/page.tsx`. Dropping the unused `checkIns`/`onSelectCheckIn` props orphaned `handleSelectCheckIn`, `selectedCheckInId`, `handleNavigate`, `selectedIndex` and `useCheckInData`; `no-unused-vars` forced the cleanup. The modal was **already unreachable** — `onSelectCheckIn` was unused inside the tab, and `CheckInsTabContent` mounts its own.
6. **The settings dialog uses React Hook Form + `zodResolver`** per CONVENTIONS §3, against a local coercing schema (the API's `updateClientSchema` takes a `number` for height; an `<input>` yields a string). Recent Teal-Summit dialogs use `useState` + hand-rolled validation instead — the convention was followed over the local precedent.
7. **`brief-sections.test.tsx` was split** into `waiting-on-you-section.test.tsx` + `since-last-visit-section.test.tsx`. 44 new/updated component tests across 5 files, plus `utils/wellness-color-thresholds.test.ts`.

### Landmines found during the smoke (NOT introduced here, NOT fixed here)

- **A partial goal PATCH silently clears the other goal field.** `PATCH /api/clients/[id]` with only `goalWeight` dual-writes `client_goals` through `updateGoals({ goalWeight, goalBodyFatPercentage: undefined })`, which supersedes the active goal with a row whose body-fat target is NULL — and the `clients` cache follows. Reproduced three times during the goal-chip smoke and repaired by re-PATCHing both fields. **Any caller that edits one goal must send both**, or the coach loses the other silently. Worth a separate fix; it is a pre-existing write-path defect, not a UI one.
- **`SectionLabel` renders `meta` before `actions`.** A brief that asks for "legend then meta" has to put both inside `actions`; there is no way to reorder the built-in slot.
- The Overview's five wellness cards and the frozen strip now disagree by design (5 metrics vs 4). The strip is unmounted, so this is no longer a visible divergence.

### Fixture state after the smoke (fixture scale client only)

The goal weight and body-fat goal were restored to their exact originals (170 kg / 15%, verified by re-read). Deliberately **left in place**, as benign realistic fixture data that now exercises the new surfaces: one pinned coach note, `phone = 0412 345 678`, `start_date = 2026-03-01`. The view anchor ends where it started — at "now" — because "Mark seen" is what writes it.
