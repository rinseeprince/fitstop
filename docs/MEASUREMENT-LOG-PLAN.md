# Measurement log — one store for every body measurement

**Status: commit 1 SHIPPED 2026-09-02 (`55ed1242`); commits 2–4 await the owner's decisions in §3.** Four commits, each with a pasteable prompt (§6), each independently revertable in order, each gated. Commit 1 stands on its own: it fixed the goal strip on main.

**Scope:** the seven physique measurements — weight, body fat, waist, hips, chest, arms, thighs — and where they are stored, written and read. **Not in scope:** wellness (mood, energy, sleep, stress, soreness stay on the daily-logs model), the check-in form the client sees, the review page's layout, goals themselves, the RN wire shapes (they must not change).

**How this plan is used.** Each commit's prompt tells a fresh session to read `CONVENTIONS.md`, `docs/ARCHITECTURE.md` and this file, and to **flag any rule in those two docs that contradicts the target shape in §2 rather than silently follow or silently override it**. Both docs describe the current three-store shape in places; a contradiction is expected, and the owner reviews each one. When a commit ships, the session replaces that commit's STATUS line in §6.

---

## 1. Why the shape changes

One concept — how much does this client weigh, how big is their waist — lives in three stores plus two caches, with copying rules between them. Every reader picks a store, and readers disagree.

| Store | What it holds | Written by | Read by |
|---|---|---|---|
| `check_ins.weight / body_fat_percentage / waist / hips / chest / arms / thighs` | the report's copy of what the client typed | check-in submit | review page (band, AI prompt, comparison), client app (check-in list, detail, progress series), coach Journey (merged) |
| `body_metrics` (mig 061) | immutable events, **weight and body fat only**, sources check_in / metrics_api / intake_sync / nutrition_plan / coach_entry | check-in submit (dual-write), coach entries (dual-write), intake, coach metrics route, nutrition plan generation (a TDEE provenance event) | comparison-service (starting-value fallback), nutrition-calc-inputs (rescue when the profile pair is null) |
| `client_metric_entries` (mig 132) | coach-logged values, all twelve metric keys, **replace-per-day** (unique client+metric+date), canonical units since mig 141 | coach entry route, the start pair on details-sheet save | coach Journey (merged with check-in columns client-side, `utils/metric-points.ts`, tie-break "coach entry wins the day"), Overview progression chart (`services/measurement-series-service.ts`, the same merge server-side), activity feed |
| `clients.current_weight / current_body_fat_percentage` | cache of the latest reading | check-in submit, coach entries (only when dated on/after the latest event), intake, coach metrics route | Overview status band, goal chips, goal strip (after commit 1), energy calculator, nutrition builder, drift note, intake, profile completeness, blocks |
| `clients.starting_weight / starting_body_fat_percentage` | cache of the start pair | details sheet, activation | comparison-service, client portal, Overview band |

Where it bit, all verified on DEV on 2026-09-02:

- **The goal strip said "No goals" for a client with a goal.** The check-in had no weight typed (every field is optional since the customisable form, mig 157). The comparison service only built a goal row from the check-in's own weight column, so the wire had no row, and the strip read "no row" as "no goal". The client's weight (75 kg) was on the cache the whole time; the Overview, reading the cache, said "5 kg to go" at the same moment.
- **A client who weighs in daily in the app and skips the box on Sunday's form** has a complete history in `body_metrics` and nothing on the review page.
- **A coach's correction does not reach the client.** A mistyped 90 cm waist on a check-in, corrected to 80 on the Journey page: the Journey shows 80 by tie-break, the client's own progress screen reads the check-in column and still shows 90.
- **Phantom history.** Every details-sheet save re-seeds the start pair through the entries upsert, which dual-writes a `body_metrics` event with no "unchanged" check. Two goal edits with the start weight untouched appended four identical immutable events in one minute.
- **Girths have no home outside a check-in.** Nothing captures them at intake; a client cannot log one between check-ins.

The ledger has carried the fix since March: TECHNICAL-DEBT → "Client Metrics Log Extraction". Migration 132 built the coach-entry half.

## 2. The target shape

**One table, `client_measurements`.** One row per recorded value: who, when, which measurement, the number, and where it came from.

```sql
CREATE TABLE public.client_measurements (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  metric_key   text NOT NULL CHECK (metric_key IN ('weight','bodyFat','waist','hips','chest','arms','thighs')),
  value        numeric NOT NULL CHECK (value > 0),           -- canonical kg / cm / % (CONVENTIONS §20)
  recorded_on  date NOT NULL,                                 -- the day the reading belongs to (client-local)
  recorded_at  timestamptz NOT NULL DEFAULT now(),            -- when it was written; the day's value is the latest of these
  source       text NOT NULL CHECK (source IN ('check_in','coach_entry','client_log','intake')),
  source_id    uuid,                                          -- the check-in id for source = check_in; null otherwise
  note         text,
  created_by   uuid,                                          -- auth user for coach entries
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX client_measurements_series_idx
  ON public.client_measurements (client_id, metric_key, recorded_on DESC, recorded_at DESC);
CREATE INDEX client_measurements_source_idx
  ON public.client_measurements (source_id) WHERE source_id IS NOT NULL;
```

**Rules of the shape** (each one exists to delete a rule that exists today):

1. **Append-only.** The app role holds `INSERT` and `SELECT` only; no `UPDATE`, no `DELETE`. A correction is a new row on the same day. History is never rewritten and never silently duplicated (rule 3).
2. **The value for a day is the latest row for that client, metric and day, by `recorded_at`.** One rule, no source ranking, no tie-break table. The coach correcting after the check-in wins; that is the case that matters.
3. **Writers append only on change.** A writer that would append a row equal in value to the day's current value for the same source does not write. This is what ends the phantom duplicates.
4. **Two caches remain, and only two:** `clients.current_weight` and `clients.current_body_fat_percentage`, because the Overview, the goal strip and the energy calculator want "now" without a query. They are set from the newest row **by `recorded_on`** (a backdated row never regresses the cache — the rule the entries service already has, now the only rule), by one function in one service. *D8 (§3) proposes deleting this rule: both caches go, and "now" is read from the log through a view. If D8 is taken, rule 6's "reads the cache" reads "reads the newest row".*
5. **A check-in owns no measurement columns.** Its readings are rows with `source = 'check_in'` and `source_id = the check-in id`. The `CheckIn` domain object still carries `weight`, `bodyFatPercentage` and the five girths — the read layer assembles them from those rows — so every consumer of the object, including the RN wire, is unchanged.
6. **"Where they stand" reads the cache; "what this check-in reported" reads the stamped rows.** Goal position, energy and drift use rule 4. The review band, the AI prompt and the client's check-in detail use rule 5. **The band's "vs last check-in" compares this check-in's stamped rows with the previous check-in's stamped rows, and nothing else**: a measurement logged between two check-ins (source `client_log` or `coach_entry`) never enters that comparison — it belongs to the Journey series and the cache (owner decision 2026-08-31, kept). A check-in whose form carried no weight has no weight row, and the band's cell shows its empty state for that check-in while the strip still shows the client's position from the latest reading.
7. **Every wire shape stays byte-identical:** `GET /api/client/check-ins`, `GET /api/client/check-ins/[id]`, `GET /api/client/progress`, `GET /api/check-in/[id]`, `GET /api/check-in/[id]/comparison`, the measurement-series route. Proven with recorded responses before and after (§5).

**What is deleted at the end (commit 4):** the seven measurement columns on `check_ins`; the `body_metrics` table and every dual-write into it; the physique rows of `client_metric_entries` and its upsert-replace path for physique keys; `utils/metric-points.ts` and its tie-break; the client-side merge in `use-merged-metrics`; the sequential whole-history check-in pager the Journey used only to read two numbers per row.

**What appears for free, not built here:** girths at intake and client-logged girths need only a writer; the table already accepts them. Follow-up, not in scope.

## 3. Decisions for the owner — answer before commit 2

| # | Decision | Recommendation | Why |
|---|---|---|---|
| D1 | Grain and mutability of the log | Append-only; the day's value is the latest row by `recorded_at` (§2 rules 1–2) | One rule replaces two: the immutable history log and the replace-per-day entries table. Corrections keep their history. |
| D2 | Wellness keys | Out of scope. `client_metric_entries` keeps its wellness rows; the Journey's Wellness pane keeps its current merge | Wellness has its own source of truth (daily logs, Phase 6). Mixing it in doubles this workstream. Record as a follow-up in TECHNICAL-DEBT. |
| D3 | `client_metric_entries` after the backfill | Physique rows are deleted in commit 4 once equality is proven; the table stays for wellness (D2) | Two copies of a waist is the bug this plan exists to end. |
| D4 | The start pair | **Cache-only.** `clients.starting_weight / starting_body_fat_percentage` are the start pair, edited in the details sheet; the Journey chart derives its first point from them and `clients.start_date`. No start-pair rows in the log, no dual-write, and moving the start date moves nothing but the date | ARCHITECTURE currently says "the start weight IS the measurement on the start date" and rejects a separate start store. The reason given was that four readers depended on the columns — they still do, and under an append-only log a moved start date would otherwise need a re-date operation the log forbids. This reverses a recorded decision; the owner must confirm. The alternative is `source = 'intake'` rows plus an allowed re-date, which reintroduces an UPDATE path. |
| D5 | The TDEE provenance event nutrition-plan generation writes to `body_metrics` | Drop it. The plan version row already stores `bmr` / `tdee` | The event has no reader. |
| D6 | The client app's read path for the new table | `client-portal-progress` reads `check_ins` through `createPortalClient()`, i.e. under RLS with the client's JWT. Either add a `clients_view_own_measurements` policy (the shape `body_metrics` has in mig 064) **or** move that read behind service role in a route that has already verified the client. Recommendation: the policy, proven by the harness (§5), since that keeps the portal's data path as it is | Memory: anon+RLS is load-bearing on the portal path; a table with RLS enabled and no policy is invisible to it. `npm run check:rls` after either choice. |
| D7 | The audit event name `BODY_METRICS_CREATE` | Rename to `MEASUREMENT_CREATE`; no other audit change | Name follows the table. |
| D8 | The two "current" caches (raised by the owner 2026-09-02 after a hand-deleted check-in left `clients.current_weight` at a value no reading carried) | **Drop both.** Nothing reads a card; every "where are they now" reader takes the newest row of any source from the log, through one view `client_current_measurements` (one row per client: newest weight and newest body fat by `recorded_on DESC, recorded_at DESC`, `WITH (security_invoker = on)`). `getClientById` / `mapClientRow` read the two numbers through it, so `Client.currentWeight` / `currentBodyFatPercentage` keep their names and every consumer of the object is unchanged. Rule 4 is deleted; `appendMeasurements` writes no cache and instead calls `recalculateClientEnergy` when the appended row is the client's newest (the same predicate the cache guard uses today). Commit 4 drops the two columns. **Depends on D6 = the policy**: the client app reads under its own JWT, and the view only shows a client their rows if that policy exists. Alternative: keep rule 4, with the setter as `refreshMeasurementCache(clientId)` — a recompute from the log, runnable on its own — so a manual delete is healed by re-running it | A cache is a copying rule, and every copying rule here has produced a reader that disagrees with another (§1); the hand-delete showed the Overview contradicting itself on one card (chart 76.0, chip "4.0 kg to go", footer −14.0). With the view there is nothing to go stale and no cleanup procedure. Two readers already prefer the newest reading over the cache today — `nutrition-calc-inputs.ts:124` (`latestMetrics?.weight ?? client.currentWeight`) and the client app's `goals-section.tsx:30` (`client.currentWeight \|\| latestWeight`) — so D8 makes every reader behave as those two do. |

**D8 reader map** (grep 2026-09-02: 43 non-test files touch the two columns; no SQL function or RPC reads them). Every reader keeps its field and its logic; only where the number is looked up from changes. What must be edited by hand: four **string-built column lists** that name the columns — `services/client-energy-service.ts:96`, `services/client-portal-service.ts:53` (`/api/client/me`, the RN contract; its `if (error \|\| !data) return null` swallows a stale name into an empty profile), `services/client-portal-progress.ts:140` (`/api/client/progress`, rule 7) and `services/intake-review-service.ts:110` — a stale column name there is a PostgREST 400 that `tsc` cannot see.

- **Energy** (`services/client-energy-service.ts:157-160`): `recalculateClientEnergy` feeds `weightKg` / `bodyFatPercentage` into the pure calculator from its own select of `clients`; that select reads the view instead. Formula, pair-atomic UPDATE, override rules, and who triggers a recompute — unchanged; the trigger moves from "cache updated" to "newest row appended", the same event.
- **Nutrition builder** (`services/nutrition-calc-inputs.ts:124-152`): already `latestMetrics?.weight ?? client.currentWeight`; the first leg becomes the log's newest row (commit 3), the second goes with the column. `nutrition-service.ts` (pure, takes `currentWeightKg`) and the orchestrator's `baseWeightKg` snapshot — unchanged.
- **Drift notes**, two of them: `lib/goals/detect-goal-drift.ts` compares GOALS (its `currentWeight` is the goal weight) — untouched; the 3 kg weight-drift banner is the pure `shouldShowRegenerationBanner(currentWeightKg, baseWeightKg)` — untouched; both callers (`comparison-service`, the nutrition hero) pass `client.currentWeight` off the object.
- **Intake sync** (`services/intake-review-service.ts:125-144, 200-206`): "fill only when the client has no reading" — the guard reads the view instead of the column; the write becomes an `intake` row plus the start pair per D4. `client-intake-service.ts:17` and `app/api/client/intake/route.ts:11` read `client_intake`'s OWN `current_weight` column — untouched.
- **Client app** (`services/client-portal-service.ts:53` → `/api/client/me`; `services/client-portal-progress.ts:140,263` → `/api/client/progress`; `components/client-portal/metrics/goals-section.tsx:30`): the wire keeps `currentWeight` / `currentBodyFatPercentage` (additive-only contract), sourced from the view under the client's JWT — hence the D6 dependency.
- **Also on the list, all read the field off the `Client` object and change nothing:** `lib/client-profile-completeness.ts:44-111` (`hasStartWeight` — the activation gate — and `findProfileGaps`), `components/clients/overview/status-band.tsx`, `check-in-goal-strip.tsx` via `comparison-service.ts`, `details-groups.tsx`, `lib/blocks/block-derivations.ts` (pure, fed by the Journey series). **Writers** that set the columns today (`client-service.ts` create/update, the metrics route, `metric-entries-service.ts`, `body-metrics-service.ts:87-89`, the seeds, `lib/validations/client.ts`'s PATCH fields) are commit 2's writer switch; the PATCH field names on the wire stay.

**Owner's answers** (fill in before commit 2): D1 — · D2 — · D3 — · D4 — · D5 — · D6 — · D7 — · D8 —

## 4. Blast radius — every dependant, by subsystem

Verified by grep on 2026-09-02. **Training has no dependency on body measurements** (every "weight" in `services/training*` is a lifted load); neither do the attention feed, tracking, or the check-in period snapshot.

| Subsystem | Today | After | Commit |
|---|---|---|---|
| Check-in submit — `app/api/client/check-ins/route.ts`, `services/client-check-in-service.ts`, `utils/check-in-canonical-metrics.ts` | writes the check-in columns, the cache and a `body_metrics` event | appends stamped rows, sets the cache; columns and event dual-written until commit 4 | 2, 4 |
| Check-in object assembly — `services/check-in-service.ts` (`getCheckInById`, `getClientCheckIns`, `getPreviousCheckIn`, `getFirstCheckIn`), `lib/mappers.ts` | `select("*")` on `check_ins` | one extra query per call: rows with `source_id IN (…)`, folded into the object; the object is unchanged | 3 |
| Review page — `components/check-in/kpi-ribbon.tsx`, `utils/ai-prompt-builder.ts`, `services/comparison-service.ts` | reads the check-in object; the comparison also reads `body_metrics` for a starting-value fallback and ten check-in rows for the trend | object readers untouched; goal position from the cache (commit 1); the fallback and the trend read the log (commit 3) | 1, 3 |
| Goal strip — `components/clients/check-ins/check-in-goal-strip.tsx`, `types/check-in.ts` (`GoalProgress`) | a row only when the check-in has the reading | a row per set goal; `position` null when the client has no reading at all | 1 |
| Client app — `app/api/client/check-ins/*`, `app/api/client/progress/route.ts`, `services/client-portal-progress.ts`, `app/client/check-in/[id]/page.tsx`, `components/client-portal/check-in/check-in-card.tsx`, `components/client-portal/metrics/metrics-hub.tsx` | the wire is assembled from `check_ins` columns | wire identical; the progress series is built from the log (D6) | 3 |
| Coach Journey — `components/clients/metrics/hooks/use-merged-metrics.ts`, `use-metrics-data.ts`, `utils/metric-points.ts`, `utils/metric-derived-stats.ts`, `hooks/use-metric-entries.ts`, `hooks/use-check-in-data.ts` (`useAllClientCheckIns`) | pages the whole check-in history sequentially, merges with entries client-side, tie-break | one series request per client from the log (extend the measurement-series route to all seven metrics with notes and sources); the merge and the pager go | 3, 4 |
| Overview progression chart — `services/measurement-series-service.ts`, `app/api/clients/[id]/measurement-series/route.ts` | server-side copy of the merge | reads the log; becomes the Journey's series too | 3 |
| Overview status band, goal chips — `components/clients/overview/status-band.tsx`, `lib/goals/goal-state.ts` | the caches | unchanged | — |
| Coach entries — `app/api/clients/[id]/metric-entries/route.ts`, `services/metric-entries-service.ts`, `types/metric-entries.ts` | upsert-replace + dual-write + conditional cache | physique keys append to the log (rules 2–4); wellness keys unchanged (D2) | 2, 4 |
| Coach metrics route — `app/api/clients/[id]/metrics/route.ts`, `services/client-service.ts` (`metrics_api`) | cache + `body_metrics` event | appends `client_log` / `coach_entry` rows + cache | 2 |
| Intake — `services/intake-review-service.ts`, `services/client-intake-service.ts`, `app/api/client/intake/route.ts` | cache + start caches + `body_metrics` event (`intake_sync`) | appends an `intake` row for weight and body fat, sets both caches | 2 |
| Start pair — `services/client-start-service.ts`, `components/clients/overview/use-client-profile-edit.ts`, `services/client-service.ts` | entries rows on the start date + caches + dual-write | D4 | 2, 4 |
| Nutrition builder / cascade — `services/nutrition-calc-inputs.ts`, `services/nutrition-plan-service.ts`, `services/nutrition-plan-orchestrator.ts`, `services/nutrition-service.ts`, `utils/nutrition-helpers.ts`, `lib/goals/detect-goal-drift.ts` | plans against the cache, `body_metrics` as a rescue when the pair is null; snapshots the base weight on the plan; the drift note compares cache to base; writes a TDEE event | behaviour unchanged; the rescue reads the log; D5 | 2, 3 |
| Energy — `services/client-energy-service.ts`, `services/client-energy-calc.ts` | reads the cache columns; stamps bmr/tdee onto events | reads unchanged; stamping goes with `body_metrics` | 4 |
| Activity feed — `services/client-activity-feed-service.ts` | lists entries rows | lists log rows with `source = 'coach_entry'` | 3 |
| Journey blocks — `services/client-journey-service.ts`, `lib/blocks/*`, `components/clients/metrics/blocks/blocks-subtab.tsx` | weight points from the merge | from the log series | 3 |
| Seeds and scripts — `scripts/seed/generate.ts`, `scripts/seed-scale-client.ts`, `scripts/perf-baseline.ts`, `scripts/seed/teardown.ts` | write check-in weights, `body_metrics`, entries | write the log | 2, 4 |
| Security — mig 064 policies on `body_metrics`, `lib/constants.ts` audit names, `npm run check:rls` | two tables' policies | one table: RLS enabled, `service_role` grant, D6 policy; D7 | 2, 4 |
| Docs — ARCHITECTURE "body_metrics table", "client_metric_entries table", "The client's origin", the review-surface payload paragraph, Journey tab row; CONVENTIONS §8 examples; TECHNICAL-DEBT ledger | describe three stores | describe one | 4 |
| Both databases — DEV `aeaphsslctwcmebldrzx`, PROD `etezzztgafcotyahgijk` | at 157 | 158 (commit 2), 159 (commit 4); PROD only after `migration list --linked` and row counts | 2, 4 |

## 5. Verification that nothing is missed

- **Equality scan (commits 2 and 3).** A script under `scripts/` (so `@/` resolves) that, for every client on DEV, derives the day-value series per metric from the old stores exactly as `utils/metric-points.ts` does today, derives it from the log by §2 rule 2, and prints every difference. Commit 2 must make it print nothing after the backfill; commit 3 runs it again after each reader switch. Do not commit it as a permanent gate; delete it in commit 4 (delete-then-document).
- **Wire proofs (commit 3).** Record the JSON of the six routes in §2 rule 7 for the fixture client and for Sam Kalepa before the switch, using the request-level harness (mint a session with `generateLink` → `verifyOtp` → cookie, drive `next dev`); diff after. A vitest that mocks `supabaseAdmin` proves nothing here.
- **The invariant scan (commit 1, kept).** A test that scans `services/` and `lib/goals/` and fails if goal progress is ever built from a `CheckIn`'s measurement field again: the kernel takes a client and a goal; nothing else may call `calculateGoalProgress` / `deriveGoalStatus` / `computeGoalPace` directly.
- **Gates after every commit:** `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`, `npm run check:labels`, `npx knip` (exits clean since `e9e54916`), `npm run check:service-key`, and `npm run check:rls` for commits 2 and 4. Mutation-test every new assertion from a copy in the scratchpad; never `git stash` or `git checkout --`.
- **Migrations:** `supabase db push --dry-run` immediately before every push; the push may be classifier-blocked, hand it over via `!`. Drops as `IF EXISTS`. Regenerate types after each push and diff them against the repo.

## 6. The four commits

Each prompt is complete on its own. Paste it into a fresh session. The session must plan for review before writing anything.

### Commit 1 — `fix(goals): goal position reads the client's current reading — one kernel, one source`

**STATUS: SHIPPED `55ed1242`, 2026-09-02.** Owner decision on the footer: a `No reading yet` row neither earns nor blocks "Goal met"; with nothing judged there is no note. A fourth doc edit landed with the owner's OK — ARCHITECTURE's strip paragraph names the `No reading yet` state. The DEV premise had moved by execution time: the record read 74.0 (three check-ins at 74 submitted 15:12–15:15 BST and deleted since), and no weightless check-in survived, so the browser smoke starts with a fresh weightless submission. Browser smoke OWED.

Fixes the page on main today. Storage untouched. Also carries the reply-block button fix agreed in the R6 smoke.

- `lib/goals/goal-progress.ts` (new, pure): `deriveGoalProgress` takes `{ effectiveGoal, client: { currentWeight, currentBodyFatPercentage, startingWeight, startingBodyFatPercentage }, trend: { avgWeeklyWeightChange, avgBodyFatChange }, daysRemaining, weeksRemaining }` and returns `GoalProgress`. It composes `calculateGoalProgress`, `deriveGoalStatus` and `computeGoalPace`; the assembly currently inline in `services/comparison-service.ts` (the two goal blocks) moves here. A check-in is not among its inputs.
- `types/check-in.ts` → `GoalProgress`: a `weight` / `bodyFat` entry exists whenever that goal is set; each holds `goal`, the start value, and `position: { current, remaining, percentComplete, status, isOnTrack, paceStatus? } | null` — null only when the client record has no reading for that metric.
- `services/comparison-service.ts`: calls the kernel with the client record's readings; the starting-value fallback chain loses its "current check-in" last resort in favour of the client's current reading; `changes` (the band's deltas) are untouched.
- `components/clients/check-ins/check-in-goal-strip.tsx`: rows from goals; `position === null` renders the goal, the track empty and `No reading yet` in the state column (neutral tone); the empty state renders only when no goal is set; the footer's "all met" reads only rows with a position.
- `components/clients/check-ins/check-in-reply-block.tsx`: the footer row gets `justify-end`, Copy before Send so the primary sits at the far right (divider grammar: actions right).
- Tests: `lib/goals/goal-progress.test.ts` (goal + client reading → full row; goal + no reading → `position: null`; no goal → no entry); `services/comparison-service.test.ts` — the existing expectation that `calculateGoalProgress` receives the check-in's weight (178) becomes the client's current weight (180), plus a case where the check-in carries no weight and the row still exists; strip tests for `No reading yet` and for the empty state only without goals; the §5 invariant scan. Mutation: point the kernel's `current` at the check-in's weight and confirm the "check-in without weight" test fails.
- Docs: ARCHITECTURE → "Goal progress and pace" states rule 6 of §2 (position from the client's current reading; a check-in is a report, never a position source); ARCHITECTURE → "client_metric_entries table" loses the sentence claiming display-unit storage (canonical since mig 141); TECHNICAL-DEBT → "The two goal targets contradict each other" gets the next step (the Overview chips adopting the kernel).

```text
Read CONVENTIONS.md, docs/ARCHITECTURE.md and docs/MEASUREMENT-LOG-PLAN.md before
planning. Plan for my review before writing anything.

This workstream changes the shape of body-measurement storage (plan §2). Commit 1 does
not touch storage, but its rule — goal position comes from the client record's current
reading, never from a check-in row — is new. Where ARCHITECTURE or CONVENTIONS state
something that contradicts §2 or this commit, do not silently follow it and do not
silently override it: list each contradiction with the doc line and what the plan says
instead, and I will review before you write.

Job: Commit 1 of docs/MEASUREMENT-LOG-PLAN.md §6 — `fix(goals): goal position reads the
client's current reading — one kernel, one source`. Build exactly what that section
lists: the pure kernel in lib/goals/goal-progress.ts that takes a client and a goal and
never a check-in; the GoalProgress wire with a row per set goal and `position: null`
when the client has no reading; comparison-service calling the kernel with the client
record's readings; the strip rendering `No reading yet` and showing its empty state only
with no goals; the reply block's footer actions on the right, Copy before Send; the
tests, the invariant scan and the mutation test named there; the three doc edits.

Verify the premise before you plan: on DEV, client f87bee53-0974-46d3-b1fb-34c14af6a8b5
has a live weight goal of 70 kg, a current weight of 75.0 on the client record, and its
newest check-in carries weight null. The review page shows "No goals" for it today.

Rules: current shape only in ARCHITECTURE (no "used to"); every fixture number distinct;
back files up with cp to the scratchpad before mutating, never git stash or git checkout
--; gates after the commit: npx tsc --noEmit, npx eslint ., npx vitest run, npm run
check:labels, npx knip (exits clean at HEAD), npm run check:service-key. Commit directly
to main. Then replace this commit's STATUS line in docs/MEASUREMENT-LOG-PLAN.md §6 with
SHIPPED, the hash and the date, and hand me a browser smokelist for the strip: a client
with a goal and a weightless newest check-in, a client with no goals, a client with one
goal, a client with no reading at all, and the reply block's buttons.
```

### Commit 2 — `feat(measurements): one log for every body measurement — table, backfill, writers`

**STATUS: NOT STARTED. Blocked on D1–D8.**

- Migration `158_client_measurements.sql`: the table in §2; RLS enabled; `GRANT SELECT, INSERT ON public.client_measurements TO service_role` and nothing else (rule 1); the D6 policy; the backfill, in the same migration, from: `check_ins` (seven columns → rows, `source = 'check_in'`, `source_id = check_ins.id`, `recorded_on = created_at::date` in the client's timezone — the Journey's existing convention, `recorded_at = created_at`); `body_metrics` (weight and body fat rows for sources `metrics_api` → `client_log`, `intake_sync` → `intake`, `coach_entry` → `coach_entry`; **skip** `check_in` events, already covered by the stamped rows, and `nutrition_plan` events per D5; `recorded_on = recorded_at::date`); `client_metric_entries` physique keys (`source = 'coach_entry'`, `recorded_on = entry_date`, `recorded_at = updated_at`, `note`, `created_by`). Per D4 no start-pair rows are created; per rule 3 the backfill de-duplicates identical consecutive values per client, metric, day and source. `gen types` after the push; diff.
- `services/measurements-service.ts` (new): `appendMeasurements({ clientId, source, sourceId?, recordedOn, values: Partial<Record<MetricKey, number>>, note?, createdBy? })` implementing rules 2–4 in one place (skip-on-unchanged, cache update by `recorded_on`), `getMeasurementSeries(clientId, { metricKeys, from?, to? })` returning day-values by rule 2 with source and note, `getMeasurementsForCheckIns(checkInIds)` for the assembly in commit 3. Canonical units in, canonical units out (CONVENTIONS §20).
- **Per D8.** If dropped: migration 158 also creates the view `client_current_measurements` (`security_invoker`, one row per client), `getClientById` / `mapClientRow` read the two "current" numbers through it while the old columns are still written until commit 4 (the equality scan compares them), `appendMeasurements` writes no cache and calls `recalculateClientEnergy` when the appended row is the client's newest, and the four string-built column lists in the D8 reader map are edited in this commit. If kept: the cache setter is `refreshMeasurementCache(clientId)`, a recompute from the log's newest row per metric, exported so it can be run on its own after a manual delete.
- Writers switch, each still writing the old store until commit 4: check-in submit (`services/client-check-in-service.ts` → append stamped rows; keep the columns and the cache write); coach entries (`services/metric-entries-service.ts`: physique keys append, wellness keys unchanged); the coach metrics route and `client-service`'s `metrics_api` path; intake; the start pair per D4 (the details sheet writes the two caches only; the entries-row seeding and its dual-write are removed here, because they are the phantom-duplicate path); nutrition plan generation per D5. Seeds: `scripts/seed/generate.ts`, `scripts/seed-scale-client.ts`, `scripts/perf-baseline.ts` write the log; `scripts/seed/teardown.ts` must rely on the `ON DELETE CASCADE` from `clients` rather than deleting log rows directly — the app role has no DELETE (rule 1), and that is deliberate.
- The §5 equality scan, run on DEV until it prints nothing.
- Tests for the service (rules 2, 3, 4 each with a mutation), for every switched writer, and `npm run check:rls`.

```text
Read CONVENTIONS.md, docs/ARCHITECTURE.md and docs/MEASUREMENT-LOG-PLAN.md before
planning. Plan for my review before writing anything.

This workstream changes the shape of body-measurement storage: one append-only table,
client_measurements, replaces the check-in's measurement columns, the body_metrics event
log and the physique rows of client_metric_entries (plan §2). ARCHITECTURE describes the
current three-store shape in "body_metrics table", "client_metric_entries table" and "The
client's origin", and CONVENTIONS §8 cites those tables as examples. Where either doc
states a rule that contradicts §2 or this commit, do not silently follow it and do not
silently override it: list each contradiction with the doc line and what the plan says
instead, and I will review before you write. Read my answers to D1–D8 in §3; if any is
still blank, stop and ask.

Job: Commit 2 of docs/MEASUREMENT-LOG-PLAN.md §6 — `feat(measurements): one log for every
body measurement — table, backfill, writers`. Build exactly what that section lists:
migration 158 with the table, RLS, the INSERT/SELECT-only grant, the D6 policy and the
backfill from all three stores with the de-duplication in §2 rule 3; the measurements
service that owns rules 2–4; every writer in the blast-radius table (§4) switched to
append to the log while still writing its old store; the seeds; the equality scan under
scripts/, run on DEV until it prints nothing; the tests and mutations; check:rls.

Migration rules: drops as IF EXISTS; `supabase db push --dry-run` immediately before the
push; the push may be classifier-blocked — hand it to me via `!` if so; DEV only (linked
ref aeaphsslctwcmebldrzx); regenerate types after the push and diff them; never mark a
migration applied by hand. Rules: every fixture number distinct; cp backups to the
scratchpad before mutating, never git stash or git checkout --; gates: npx tsc --noEmit,
npx eslint ., npx vitest run, npm run check:labels, npx knip, npm run check:service-key,
npm run check:rls. Commit directly to main. Then replace this commit's STATUS line in
docs/MEASUREMENT-LOG-PLAN.md §6 with SHIPPED, the hash, the date and the equality scan's
result, and tell me plainly what is still dual-written and where.
```

### Commit 3 — `refactor(measurements): every reader reads the log`

**STATUS: NOT STARTED.**

- Wire proofs recorded first (§5), for the fixture client `5ca1ec1e-0000-4000-8000-000000000001` and `f87bee53-0974-46d3-b1fb-34c14af6a8b5`.
- Check-in object assembly: `services/check-in-service.ts`'s four readers fold `getMeasurementsForCheckIns` into the object; `lib/mappers.ts` stops mapping the columns. The object is unchanged; the RN wire is unchanged.
- Journey: the measurement-series route and service serve all seven metrics with day-values, sources and notes from the log; `use-merged-metrics` consumes it; the merge, the tie-break and `useAllClientCheckIns`' role in the Journey go (the hook may stay if the check-in history list still uses it — grep at execution time). Blocks and the Overview chart read the same series.
- `services/client-portal-progress.ts` builds its series from the log (D6 path); `services/comparison-service.ts`' starting-value fallback and ten-row trend read the log; `services/nutrition-calc-inputs.ts`' rescue reads the log; the activity feed lists `coach_entry` rows.
- Equality scan re-run after each switch; wire proofs diffed after the last; a §2-rule-7 note in the commit body per route.

```text
Read CONVENTIONS.md, docs/ARCHITECTURE.md and docs/MEASUREMENT-LOG-PLAN.md before
planning. Plan for my review before writing anything.

This workstream changes the shape of body-measurement storage (plan §2); commits 1 and 2
have shipped (see their STATUS lines in §6). Where ARCHITECTURE or CONVENTIONS state a
rule that contradicts §2 or this commit, do not silently follow it and do not silently
override it: list each contradiction with the doc line and what the plan says instead,
and I will review before you write.

Job: Commit 3 of docs/MEASUREMENT-LOG-PLAN.md §6 — `refactor(measurements): every reader
reads the log`. Build exactly what that section lists, in this order: record the wire
proofs for the six routes in §2 rule 7 with the request-level harness (a real session
via generateLink → verifyOtp, a running next dev, scripts inside the project tree);
switch the check-in object assembly; switch the Journey, the Overview chart, the client
progress series, the comparison fallback and trend, the nutrition rescue and the
activity feed; re-run the equality scan after each switch; diff the wire proofs at the
end. Every wire must be byte-identical; a difference is a defect to fix, never a
fixture to update. Grep at execution time for every reader in the §4 table; do not
trust the table.

Rules: the RN app is the real client — its three routes are the contract; every fixture
number distinct; cp backups before mutating, never git stash or git checkout --; gates:
npx tsc --noEmit, npx eslint ., npx vitest run, npm run check:labels, npx knip, npm run
check:service-key. Commit directly to main. Then replace this commit's STATUS line in
§6 with SHIPPED, the hash and the date, and hand me a browser smokelist covering the
Journey Physique pane, the Overview chart, the client app's progress screen and a
check-in detail with girths.
```

### Commit 4 — `chore(measurements): the old stores go — columns, table, dual-writes, merge; docs`

**STATUS: NOT STARTED.**

- Migration `159_drop_measurement_copies.sql`: drop the seven columns on `check_ins`; drop `body_metrics` (mig 064's two policies go with it); delete `client_metric_entries` rows whose `metric_key` is a physique key (D3) and narrow its CHECK to the wellness keys; per D8 (drop), also `clients.current_weight` and `current_body_fat_percentage` — grep every string-built column list at execution time before the push (the D8 reader map names four; a stale name is a PostgREST 400 that `tsc` cannot see, and the portal's is swallowed into an empty profile). `gen types`; diff.
- Code: every dual-write from commit 2 removed; `services/body-metrics-service.ts` deleted; `utils/metric-points.ts` and its test deleted; the merge code in `use-merged-metrics` deleted; the entries service's physique path deleted; the energy service's event stamping deleted; the audit constant renamed (D7); the equality scan deleted (§5). `npx knip` names the rest — delete what it lists, un-export what only its own file reads.
- Docs, current shape only: ARCHITECTURE → replace "body_metrics table" and "client_metric_entries table" with one "client_measurements table" section stating §2's seven rules; rewrite "The client's origin" per D4; the review-surface payload paragraph and the Journey tab row; CONVENTIONS §8's examples; TECHNICAL-DEBT → close "Client Metrics Log Extraction", add the D2 follow-up (wellness coach entries) and the girth-capture follow-up. Then delete this plan document (delete-then-document) — **confirm with the owner first**.
- PROD: `supabase migration list --linked` and row counts before pushing 158 and 159 together; regenerate prod types and diff against the repo.

```text
Read CONVENTIONS.md, docs/ARCHITECTURE.md and docs/MEASUREMENT-LOG-PLAN.md before
planning. Plan for my review before writing anything.

This workstream changes the shape of body-measurement storage (plan §2); commits 1–3
have shipped (see §6). This commit deletes the old stores and rewrites the docs to the
new shape, so ARCHITECTURE and CONVENTIONS will contradict §2 in several places by
construction. Do not silently follow or silently override any of them: list each
contradiction with the doc line and what §2 says instead, and I will review before you
write. Everything you delete must be grepped at execution time, never taken from this
plan's list.

Job: Commit 4 of docs/MEASUREMENT-LOG-PLAN.md §6 — `chore(measurements): the old stores
go — columns, table, dual-writes, merge; docs`. Build exactly what that section lists:
migration 159; every dual-write, the body-metrics service, the merge layer, the entries
service's physique path, the event stamping and the equality scan removed; npx knip
clean afterwards; ARCHITECTURE, CONVENTIONS and TECHNICAL-DEBT rewritten to the current
shape with no "used to" and no shipped/reverted narrative; the plan document deleted
only after you ask me and I confirm.

Migration rules as in commit 2, DEV first. Before any PROD push: `supabase migration
list --linked` against the prod ref and the row counts of check_ins, body_metrics and
client_metric_entries; show me both and wait. Gates: npx tsc --noEmit, npx eslint .,
npx vitest run, npm run check:labels, npx knip, npm run check:service-key, npm run
check:rls. Commit directly to main. Then update my memory record for this workstream
(the file the R6 memory points at) to SHIPPED with all four hashes, and hand me the
final browser smokelist: the review page for a weightless check-in, the Journey with a
coach correction on a check-in day, the client app after that correction, and the
Overview status card.
```

## 7. Smoke setup on DEV — data the owner asked for (not commits)

Run before smoking R6 items 9 and 10 on client `ed5cb82c-30ea-488d-96d8-eb34e8ae09fa` (Samuel James, weekly, due 30 Aug, so a check-in submitted this week covers 24–30 August; its only nutrition entry is Wednesday 26).

```sql
-- 9. No nutrition logged: save the row first, then delete it.
SELECT * FROM nutrition_logs WHERE id = 'c8444f02-8741-4871-bcde-6de83e0eeca5';   -- keep this output
DELETE FROM nutrition_logs WHERE id = 'c8444f02-8741-4871-bcde-6de83e0eeca5';

-- 10. A habit added mid-period: leading dashes for Mon–Wed, dots from Thu 27 Aug.
INSERT INTO daily_habits (coach_id, client_id, name, is_boolean, sort_order, effective_date)
VALUES ('659330a8-eea6-4090-807c-69836dd2938d', 'ed5cb82c-30ea-488d-96d8-eb34e8ae09fa',
        'Stretch 10 min', true, 2, '2026-08-27');
```

Both run with `npx supabase db query "<sql>" --linked` (DEV is the linked ref). Neither table is touched by this plan.
