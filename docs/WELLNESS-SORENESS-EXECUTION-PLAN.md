# Wellness Muscle-Soreness Execution Plan

Adds a fifth wellness metric — **muscle soreness** — platform-wide: DB → client API (RN contract) → client portal → coach surfaces → AI → attention feed.

**Status: PLANNED — neither session executed yet.**

This plan was produced from a 7-agent platform-wide sweep (2026-07-25) with every load-bearing fact re-verified against the code. Line anchors below were correct on that date — **verify anchors by grep at execution time; never trust a stale line number** (P7 lesson). `soreness` is greenfield: the only pre-existing hit in the repo is a free-text fixture string in `set-tracker.test.tsx`.

**Build rules:** every session MUST follow `CONVENTIONS.md` (read in full first — §2 planning, §8 database/migration workflow, §9-10 route chain, §13 commit-ready checklist) and `docs/ARCHITECTURE.md` (data model, events-SOT, check-in system). UI work additionally follows `docs/newdesignsystem.md` (Teal-Summit tokens; mono = numbers only, gated by `npm run check:labels`).

---

## Approved decisions (owner-approved 2026-07-25 — do NOT re-litigate)

| # | Decision |
|---|----------|
| A | **Scale:** `soreness` 1–10 integer, **higher = more sore** (lower-is-better, like stress). Column/field name `soreness`, UI label "Muscle soreness", unit rendered `/10`. |
| B | **Check-in snapshot:** YES — nullable `check_ins.soreness` (CHECK 1–10) + submit-time derivation. Required for: client metrics hub, coach Metrics tab, comparison view, AI trend (all read check-in snapshots, not `wellness_logs`). |
| C | **No fabricated default:** `calculateMetricAverages` invents mood 3 / others 5 when a period has no wellness rows. Soreness does NOT replicate that — never-logged → `undefined`/`null` snapshot. `MetricAverages.soreness` is `soreness?: number` (optional). Deliberate deviation from the sibling pattern. |
| D | **Attention trigger:** include `high_soreness` (clone of `evaluateHighStress`: value ≥ 8 for 3 consecutive days). Severable — its own commit. |
| E | **Frozen legacy skipped:** NO changes to `components/clients/daily-pulse/**` (Overview-tab strip + day-detail card) or `lib/daily-wellness-alerts.ts`. Overview strip shows 4 metrics while the Wellness tab shows 5 — intentional, documented. |
| F | **Also out of scope:** `training_plans.avg_*` snapshot (written by nobody; extending forces a `create_training_plan_atomic` arity change — the wrong-arity-REVOKE landmine). `upsert_daily_log_atomic` untouched (zero app callers, service-role-locked; migration comment records it doesn't carry soreness). `/api/check-ins/recent` (cherry-picks mood+energy by design). No soreness field on the check-in FORM (its wellness step is read-only by design; submit derives server-side — do not mirror the vestigial mood..stress pass-through at `app/api/client/check-ins/route.ts:206-209`). |

## Verified current-state facts (from the sweep — the plan is written from these)

- Existing metrics: `mood` 1–5, `energy`/`sleep`/`stress` 1–10 (sleep is a **quality** rating, not hours). All nullable everywhere.
- `wellness_logs` (migration 056:36-50): bare nullable INTEGER metric columns, **no CHECK constraints** (scales enforced by zod only). `UNIQUE(daily_log_id)`, index `(client_id, date DESC)`, updated_at trigger. RLS policies exist (table-level) — a new column needs **no** RLS/GRANT work.
- `check_ins` snapshot columns `mood/energy/sleep/stress` (migration 001:8-11) **do** have CHECKs (1–5 / 1–10). ⚠️ `check_ins` has known Studio drift: `uses_daily_logs`, `daily_logs_start_date`, `daily_logs_end_date` exist in prod but in NO migration file — verify the live catalog before writing the new migration.
- `daily_logs_full` view (056:245-258) enumerates columns **explicitly** — a new `wellness_logs` column is NOT auto-exposed. `CREATE OR REPLACE VIEW` can only append at the **very end** of the select list (after `tl.training_data`). Migration 123 pinned `security_invoker = on`; a bare re-create from 056's source **silently reverts the view to owner-rights and launders past RLS on health-PII tables** (123:16-23 documents this). The re-create MUST restate `WITH (security_invoker = on)`.
- One write path: `PATCH /api/client/daily-logs/[date]/wellness` → `wellnessCardSchema` (**`.strict()`** — unknown keys 400; server must ship before any client sends the key) → `upsertWellnessLog`, which writes ALL metric columns as `data.X ?? null` (an omitted key **clobbers to null** on an existing row; the web page masks this by seeding inputs from the GET — keep this contract, do not "fix" it here).
- Check-in submit **ignores** form values and derives snapshots via `calculateMetricAverages` over `getDailyLogs()` (the `daily_logs_full` view). `services/check-in-service.ts:37-46` documents the contract.
- `DailyLogFullRow` (`services/daily-logs-service.ts:8-34`) is **hand-typed** (view not in generated types) — miss it and every reader gets `undefined` with zero compile errors.
- Two client-facing check-in serializers must BOTH change or soreness silently disappears: `CLIENT_FACING_CHECKIN_KEYS` allowlist (`lib/mappers.ts:~160`, exclude-by-default) and the hand-built literal in `app/api/client/check-ins/[id]/route.ts:54-57`.
- Trends read snapshots: client metrics hub via `services/client-portal-progress.ts:207-242`; coach Metrics tab via `use-metrics-data.ts` METRIC_DEFINITIONS keyed off `CheckIn`.
- `components/metrics/metric-chart-card.tsx` is **shared** coach+client; its trend-direction inversion list is currently stress-only (line ~63) — without soreness added, an improving (falling) soreness trend renders red.
- Wellness attention triggers live in `lib/wellness-triggers.ts`; **both** production consumers import them via the barrel `lib/attention-triggers.ts:23`, not directly. Threshold constants live in `lib/constants.ts:30-47` (NOT hardcoded in the trigger lib).
- Sentry scrubber redacts `mood/energy/sleep/stress` (+variants) — `lib/sentry-scrubber.ts:16-19,47-52`. Soreness is health PII and must be added the moment it flows.
- RN contract: `/api/client/**` responses may gain the field **additively and nullable only**; existing keys/shapes must not change (`CLIENT-APP-REFERENCE.md` is the contract's human-readable face).
- Latest migration at sweep time: `130_drop_browser_insert_policies.sql` → expected next number **131** (re-verify).
- `npx supabase db push` is classifier-blocked in-session — **the owner runs it** (via `!` prefix); `gen types` and `git commit` are fine.

---

# SESSION 1 — DB, shared plumbing, client portal (Phases 1–3)

Lands the entire write path + RN-contract read path end-to-end. Compile-safe standalone: everything added is optional/nullable, so untouched coach code still builds. **Do not** start Session 2 work (coach UI, AI, trigger) even if it looks adjacent.

### Pasteable prompt (Session 1)

```text
Read CONVENTIONS.md, docs/ARCHITECTURE.md, and docs/newdesignsystem.md in full first — they are the build rules for everything below. Then read docs/WELLNESS-SORENESS-EXECUTION-PLAN.md in full and execute SESSION 1 only (Phases 1–3: DB migration, shared plumbing, client portal UI).

Rules of engagement:
- The plan's decisions A–F are owner-approved — do not re-litigate them.
- Line anchors in the plan may have drifted — verify each by grep/read before editing.
- Show me your session plan and wait for my approval before writing any code (CONVENTIONS §2).
- npx supabase db push is blocked for you — write the migration, then hand me the exact command to run myself; wait for my confirmation before regenerating types.
- Commit sequencing: commit ① = migration + regenerated types/database.ts only; commit ② = plumbing + client UI + tests + contract-doc lines. Each commit must pass the full CONVENTIONS §13 gate (tsc, eslint, vitest, check:labels, no `as any`, no leftover markers) before you call it done.
- Work directly on main (no branches).
- When Session 1 is complete, append a STATUS block to the bottom of docs/WELLNESS-SORENESS-EXECUTION-PLAN.md recording what shipped, commit hashes, deviations, and anything Session 2 must know.
```

## Phase 1 — Migration `131_add_wellness_soreness.sql` + types (commit ①)

**Pre-flight (read-only):**
1. `ls supabase/migrations | tail` + `npx supabase migration list --linked` — confirm tree tip and tracking agree; confirm 131 is free.
2. Verify live shapes (`npx supabase db dump --linked`, grep for `wellness_logs`, `check_ins`, `daily_logs_full`): confirm the drifted `check_ins` columns, confirm no prod-only CHECKs on `wellness_logs`, and capture the **live** `daily_logs_full` definition to re-create from (not 056's source blindly).

**Migration contents:**
1. `ALTER TABLE wellness_logs ADD COLUMN IF NOT EXISTS soreness INTEGER;` — nullable, NO CHECK (parity with its four siblings).
2. `ALTER TABLE check_ins ADD COLUMN IF NOT EXISTS soreness INTEGER CHECK (soreness BETWEEN 1 AND 10);` — parity with that table's existing CHECKs.
3. Re-issue `daily_logs_full`: `CREATE OR REPLACE VIEW public.daily_logs_full WITH (security_invoker = on) AS SELECT … <existing columns in exact existing order> …, wl.soreness;` — `wl.soreness` appended as the **final** column. Belt-and-braces: also `ALTER VIEW public.daily_logs_full SET (security_invoker = on);` after. Comment the landmine in the migration header.
4. Header comment: `upsert_daily_log_atomic` deliberately NOT extended (no app callers, service_role-only since 106; two overloads — touching it risks the wrong-arity-REVOKE landmine).

**Then:** owner runs `npx supabase db push` → `npx supabase gen types typescript --linked > types/database.ts` → skim the diff (expect exactly: `wellness_logs.soreness`, `check_ins.soreness`, `daily_logs_full.soreness`; anything else is a red flag) → commit ① (migration + types together, CONVENTIONS §8 five-step).

## Phase 2 — Shared plumbing (the silent-failure layer)

| File | Anchor | Change |
|------|--------|--------|
| `services/daily-logs-service.ts` | 8-34, 113-137 | `DailyLogFullRow.soreness: number \| null` (hand-typed!) + `mapRowToDailyLog` null→undefined mapping. **The #1 silent-drop risk.** |
| `types/daily-log.ts` | 14-17, 62-65 | `DailyLog.soreness?: number // 1-10 (higher = more sore)` + same on `DailyLogInput`. |
| `lib/validations/daily-log-cards.ts` | 29-37 | `wellnessCardSchema` gains `soreness: optionalInt(z.number().int().min(1).max(10))`. Schema is `.strict()` — this edit is what makes the key legal. |
| `services/daily-log-card-service.ts` | 29-34, 134-161 | `WellnessLogInput.soreness?` + upsert row `soreness: data.soreness ?? null` (keep the existing clobber-on-omit semantics). |
| `app/api/client/daily-logs/[date]/wellness/route.ts` | 36-49 | GET response gains `soreness: log?.soreness ?? null`. PATCH flows via schema+service. |
| `services/client-day-service.ts` | 90-97 | `wellness.hasLog` OR-chain gains soreness — a soreness-only day must count as logged. |
| `utils/daily-logs-aggregation.ts` | 6-126, 128-170 | `MetricAverages` gains **optional** `soreness?: number`; `calculateMetricAverages` computes it only when ≥1 valid value — NO fabricated fallback (decision C). `aggregateDailyLogs` gains `avgSoreness` (0-when-none, 1-dp — parity with siblings there). |
| `services/check-in-service.ts` | 71-111 | Insert `soreness: averages.soreness ?? null` into the check_ins snapshot row. Requires commit ① applied first. |
| `lib/mappers.ts` | 13-16, 158-173 | `mapCheckInRow` + **`CLIENT_FACING_CHECKIN_KEYS` allowlist** gain `soreness`. |
| `app/api/client/check-ins/[id]/route.ts` | 54-57 | Hand-built response literal gains `soreness: checkIn.soreness`. |
| `types/check-in.ts` | 31-37, 270-273 | `SubjectiveMetrics.soreness?: number // 1-10` + `CheckIn.soreness?`. (Leave `ProgressChartData`/`MetricChange` maps for Session 2 — they compile-couple to coach files.) |
| `lib/sentry-scrubber.ts` | 16-19, 47-52 | Add `soreness` (+ `muscle_soreness` variant) to redaction keys. **Pulled forward from Phase 5 — PII must be scrubbed the moment the field flows.** |

Free riders (no edit, verify only): `GET /api/client/check-in-context` (passes raw `DailyLog[]`), coach `GET /api/clients/[id]/daily-logs`, day-summary shape (`wellness: { hasLog }` unchanged).

## Phase 3 — Client portal UI

| File | Anchor | Change |
|------|--------|--------|
| `app/client/wellness/page.tsx` | 20-27, 43-48, 102-112, 119-132, 205-225, 256 | Fifth metric everywhere the four are hardcoded: `WellnessForDate`/`WellnessInputs` types, `BOUNDS` (`{1,10}`), `EMPTY_INPUTS`, seed effect, `hasAnyValue` key list, PATCH body, skeleton rows 4→5. Control = one more `WellnessScale` instance (Radix slider 1–10, display default `value ?? 5`), label **"Muscle soreness"** — same pattern as 'Energy level'/'Sleep quality'. `WellnessScale` itself needs no changes. |
| `components/check-in/daily-logs-summary.tsx` | 14-31, 39-71, 74-87, 160-188 | Fifth average tile (`x.x/10`). The averaging is an **inline reduce** here (does NOT call `calculateMetricAverages`) — extend both. `getMetricColor` gets an explicit **inverted** branch (mirror stress: ≤3 success, ≤6 warning, else destructive). `loggedDates` any-of check gains soreness. 5 tiles in the `grid-cols-2` = one odd row — acceptable, don't redesign. Note: TECHNICAL-DEBT.md already flags this file's hardcoded thresholds — extend the pattern, don't refactor in passing. |
| `components/client-portal/check-in/check-in-card.tsx` | 27-31 | `Soreness: n/10` pill (render only when non-null, like siblings). |
| `app/client/check-in/[id]/page.tsx` | 220-243 | "Muscle Soreness" row, `n/10`. |
| `services/client-portal-progress.ts` | 207-217, 238-242 | Push `soreness` per check-in + `buildMetricSeries(..., 'soreness', 'Soreness', '/10')`. |
| `components/metrics/metric-chart-card.tsx` | 46-49, 62-72 | `METRIC_COLORS.soreness` (pick a distinct hue in that file's existing Tailwind-hex convention, e.g. `#a855f7` — mood amber / energy red / sleep indigo / stress orange are taken) + add soreness to the **trend-inversion** branch (falling soreness = improving). Shared with coach — additive-safe. |

Numeric strings (`n/10`) obey mono-token rules where the surface is token-governed; the client-portal components already carry the correct existing patterns — copy the sibling metric's exact classes.

## Session 1 tests

Will break (exact-match asserts) — fix + extend:
- `app/api/client/daily-logs/[date]/wellness/route.test.ts:56-71` (GET body `toEqual`) — add `soreness: null`; add PATCH pass-through + `soreness: 11` → 400 coverage.
- `services/daily-log-card-service.test.ts:108-129` (upsert payload `toEqual`).
- `services/client-portal-progress.test.ts:158-163` (pinned id list) — extend to `[...,"soreness"]` + `/10` unit.

Extend for coverage:
- `services/check-in-service.test.ts:342-370` — soreness in wellness fixtures + assert derived snapshot; add the decision-C case (no soreness logged → inserted `soreness` is null/undefined, NOT 5).
- `services/client-day-service.test.ts:243-279` — soreness-only day → `hasLog: true`.
- `services/daily-logs-service.test.ts:216-299` — view-row mapper maps soreness.
- `app/client/wellness/page.test.tsx` — fifth control + PATCH body assert.
- `__tests__/helpers/mock-data-builders.ts:110-131, 342-357` — add soreness default **3** (neutral: cannot trip the future ≥8 trigger in unrelated tests).
- `__tests__/api/client/day-summary.test.ts` — shape-stable, verify no change needed.

Known flake: `set-tracker.test.tsx` fails intermittently in full runs — re-run before blaming the change.

## Session 1 docs (ship with commit ②)

- `docs/ARCHITECTURE.md`: data-hierarchy line (`wellness_logs -- mood, energy, sleep, stress` → + soreness, ~line 51/214) + the check-in derivation sentence (~line 834).
- `CLIENT-APP-REFERENCE.md` (repo root — RN contract face): wellness endpoint field list (~167), DailyLog/CheckIn scale blocks (~255-258, 393-396). Also fix its pre-existing bug: line ~167 says the wellness route is POST; it is GET + PATCH.

---

# SESSION 2 — Coach UI, AI, attention trigger, seed + docs (Phases 4–7)

**Prerequisite:** Session 1's STATUS block exists below and its commits are on main. Read it first; verify `soreness` exists in `types/database.ts` and flows through `DailyLog` before starting.

### Pasteable prompt (Session 2)

```text
Read CONVENTIONS.md, docs/ARCHITECTURE.md, and docs/newdesignsystem.md in full first — they are the build rules for everything below. Then read docs/WELLNESS-SORENESS-EXECUTION-PLAN.md in full — including Session 1's STATUS block at the bottom — and execute SESSION 2 only (Phases 4–7: coach UI + coach API, AI prompts, high_soreness attention trigger, seed/docs/remaining tests).

Rules of engagement:
- The plan's decisions A–F are owner-approved — do not re-litigate them. Session 1 already shipped the DB column, plumbing, and client portal — verify, don't redo.
- Line anchors in the plan may have drifted — verify each by grep/read before editing.
- Show me your session plan and wait for my approval before writing any code (CONVENTIONS §2).
- No migrations are expected this session; if you believe one is needed, stop and ask.
- Commit sequencing: commit ③ = coach UI + coach API + AI + their tests; commit ④ = high_soreness trigger + its tests (severable); commit ⑤ = seed + docs + any remaining test extensions. Each commit must pass the full CONVENTIONS §13 gate (tsc, eslint, vitest, check:labels, no `as any`, no leftover markers).
- Do NOT touch components/clients/daily-pulse/** or lib/daily-wellness-alerts.ts (frozen legacy — decision E), training_plans avg_* / create_training_plan_atomic / upsert_daily_log_atomic (decision F).
- Coach UI follows docs/newdesignsystem.md: teal-tinted greys, rounded-[6px], mono tokens for number-bearing strings (npm run check:labels gates this).
- Work directly on main (no branches).
- When Session 2 is complete, append its STATUS block to the bottom of docs/WELLNESS-SORENESS-EXECUTION-PLAN.md and run the browser smoke checklist in the plan, reporting results.
```

## Phase 4 — Coach UI + coach API (commit ③, with Phase 5)

| File | Anchor | Change |
|------|--------|--------|
| `utils/wellness-color-thresholds.ts` | 3, 5-29 | `WellnessMetric` union gains `"soreness"` (the chokepoint — 4+ importers); legacy `getBarColor` gets an inverted soreness case. |
| `app/api/clients/[id]/history/wellness/route.ts` | 9-15, 107, 121-124 | Metric list lives in THREE places: `WELLNESS_COLUMNS` select, gap-fill nulls, and the `.or(...not.is.null)` logged-day filter. Missing the `.or()` makes soreness-only days invisible. |
| `app/api/clients/[id]/history/wellness/summary/route.ts` | 67, 69, 84-98 | Same three places + `avg_soreness` response key. |
| `types/history.ts` | 18-21 | `WellnessHistoryRow.soreness: number \| null` — MUST land in the same edit as the two routes (required-key compile coupling). |
| `components/clients/wellness/wellness-history-table.tsx` | 19-26, 28-38, 43-65, 74-79, 115-118, 148 | Summary type + METRICS entry `{key:"avg_soreness", label:"Avg Soreness", metric:"soreness", max:10}`; dark summary strip `grid-cols-[1fr×4]` → 5; table column; `getWellnessColor` **inverted** branch (mirror stress: ≤4 teal `#0d9488` / ≤6 white / else amber `#d97706`); warning tick at soreness ≥ 7. |
| `components/check-in/wellness-section.tsx` | 28-33, 67-69, 83, 93 | METRICS entry (`maxValue:10, scale:"/ 10"`); `hasWellnessData` enumeration; `grid-cols-4` → `grid-cols-5`. Keep its days-in-window average convention (differs from the Wellness tab's days-logged — existing inconsistency, replicate per-surface, don't "fix"). |
| `components/check-in/mini-bar-sparkline.tsx` | 17-35 | Inverted colors for soreness (mirror stress: ≤3 teal else amber; null = faint teal). |
| `components/check-in/check-in-comparison-view.tsx` | 118-122, 184-187 | Fifth `MetricTrendRow` (`/10`, pass `inverse` like stress); `hasWellbeing` gate gains `changes.soreness`. |
| `services/comparison-service.ts` | 172-187 | `changes.soreness` via `calculateMetricChange`. |
| `types/check-in.ts` | 576-584, 743-746 | `ProgressChartData.soreness: ChartDataPoint[]` + `changes.soreness?: MetricChange` — land together with `lib/check-in-utils.ts` (required-key coupling). |
| `lib/check-in-utils.ts` | 81-158 | `prepareChartData` builds the soreness series (`X/10` labels). |
| `components/clients/metrics/hooks/use-metrics-data.ts` | 50-53, 117 | METRIC_DEFINITIONS wellness entry `{id:"soreness", key:"soreness", getUnit:()=>"/10", domain:[1,10]}`. Sidebar/tab-content are data-driven — render-verify only. |

`components/check-in/check-in-detail-modal.tsx` needs no code change but hosts the 5-column WellnessSection — smoke-check it.

## Phase 5 — AI prompts (commit ③)

| File | Anchor | Change |
|------|--------|--------|
| `utils/ai-prompt-builder.ts` | 30-36 | Add `Soreness: X/10 (higher = more sore)` line (truthiness-guard pattern like siblings). Leave the previous-check-in trend block mood-only (line ~165) — deliberate. |
| `utils/ai-daily-context-builder.ts` | 32-38 | Add `Soreness N` to the per-day detail line. |
| `utils/ai-daily-context-patterns.ts` | 97-114 | **Deferred** — no soreness pattern this workstream (state in STATUS block). |

(Sentry scrubber already shipped in Session 1.)

## Phase 6 — `high_soreness` attention trigger (commit ④, severable)

| File | Anchor | Change |
|------|--------|--------|
| `lib/constants.ts` | 46-47 | `HIGH_SORENESS_THRESHOLD = 8`, `HIGH_SORENESS_CONSECUTIVE_DAYS = 3` (mirror the stress pair; constants live HERE, not in the trigger lib). |
| `lib/wellness-triggers.ts` | 92-135 | `evaluateHighSoreness` — clone `evaluateHighStress` semantics (value ≥ threshold for N consecutive days), type string `high_soreness`. |
| `lib/attention-triggers.ts` | 23 | Re-export from the **barrel** — both production consumers import from here, not from wellness-triggers directly. |
| `lib/attention-feed-helpers.ts` | 28-36, 92-95, 207-224 | `DailyLogRow` hand-cast type + mapping + add the evaluator to the trigger roster. |
| `types/attention-feed.ts` | 6-16 | `AlertType` union gains `"high_soreness"` (name lands in the dismissals table — pick once, keep forever). |
| `components/dashboard/needs-attention-feed.tsx` | 12-23, 109-138, 140-174 | THREE touches: `alertTabMap` (`high_soreness` → `?tab=wellness` — the map has NO fallback; missing it produces `?tab=undefined` links), `getShortAlertText` ("High soreness (N days)"), `getPriorityAlertText` ("Soreness at 8+ for N days"). |

Dismiss route takes a free string — no change. Do NOT add the trigger to `lib/daily-wellness-alerts.ts` (frozen strip, decision E).

Tests: extend `__tests__/lib/attention-triggers.test.ts` (evaluator behavior: fires at ≥8×3 consecutive, not at 7, not at 2 days, ignores null days per existing semantics) and `services/attention-feed-service.test.ts` (dismissal keyed `high_soreness`).

## Phase 7 — Seed, docs, remaining tests (commit ⑤)

- `scripts/seed-scale-client.ts:607-620` — wellness rows gain `soreness: rng.int(2,6)`; `:826-848` — check-in snapshots gain soreness in the same range.
- `scripts/perf-baseline.ts:184` — append `soreness` to the explicit check_ins select list (keeps the perf simulation representative). Low priority.
- Coach route tests: `app/api/clients/[id]/history/wellness/route.test.ts` + `summary/route.test.ts` (fixtures + `avg_soreness` assert); `lib/check-in-utils.test.ts` (`X/10` label).
- Docs: `docs/ARCHITECTURE.md` — wellness-strip section notes the intentional 4-metric legacy divergence (~547-549) + trigger list line (~593); `TECHNICAL-DEBT.md:244` — update the daily-logs-summary hardcoded-thresholds item to cover 5 metrics. Historical plan docs (CLIENT-PORTAL-*.md) are NOT updated — they are records of past work.

## Browser smoke checklist (end of Session 2)

1. Client `/client/wellness?date=today`: five controls render; log soreness only → save → home day card shows "Logged".
2. Client check-in form: wellness summary shows five tiles; submit → `check_ins.soreness` populated (or null when never logged — decision C).
3. Client `/client/metrics` → Wellness: soreness trend card renders, falling trend reads as improvement.
4. Coach Wellness tab: 5-column summary strip + table column, inverted colors (high soreness amber).
5. Coach check-in review modal: 5-column WellnessSection + sparkline; comparison view shows the soreness trend row.
6. Coach Metrics tab: soreness chart.
7. Attention feed: seed 3 consecutive days ≥8 → `high_soreness` card appears, links to `?tab=wellness`, dismisses cleanly.
8. Coach Overview tab daily-pulse strip still shows 4 metrics (intentional).

---

## Status log

> Each session appends its STATUS block here at completion (what shipped, commit hashes, gate results, deviations from plan, notes for the next session). Recorded deviations win over the plan prose above.

## STATUS — Session 1 (2026-07-25)

**Shipped: Phases 1–3 complete.** Commit ① `8923595` (migration 131 + regenerated types + one compile-closure line, see deviation 1). Commit ② (this commit): plumbing + client portal UI + tests + contract docs + this doc.

**Migration 131** applied and verified against the live catalog (fresh `db dump`): `wellness_logs.soreness` (bare nullable), `check_ins.soreness` + `check_ins_soreness_check` (1–10), `daily_logs_full` re-issued from the LIVE definition with `wl.soreness` as the final column and `security_invoker='on'` intact (WITH clause + belt ALTER). gen-types diff was exactly four surfaces — see fact-correction 1.

**Gates:** both commits passed the full §13 checklist (tsc clean; eslint 0 errors / 218 pre-existing warnings; full vitest suite green — 2243 tests at ①, re-run at ②; check:labels green; no new `as any` / markers in changed app files — test files carry the pre-existing eslint-sanctioned `as any` fixture pattern).

### Fact corrections to the plan prose above (verified in-session)

1. **`daily_logs_full` IS in generated types** (`types/database.ts` → `Views.daily_logs_full.Row`) — the "not in generated types" claim was stale. The gen-types diff is FOUR surfaces (check_ins + wellness_logs Row/Insert/Update, plus the view Row). The stale comment at `services/daily-logs-service.ts:8` was rewritten; `DailyLogFullRow` stays hand-typed for the narrowing casts.
2. **Migration 123 is `ALTER VIEW`, not a re-create** — 056 was the only prior DDL source of the view column list; the live definition matched it exactly.
3. Several line anchors had drifted (wellness page PATCH-body build is ~120-125, not 205-225; daily-logs-summary `getMetricColor`/`loggedDates` anchors were transposed; metric-chart-card "inversion list" is a string equality, now `stress || soreness`).
4. The `set-tracker.test.tsx` soreness fixture string exists at :516 (plan's greenfield claim held — free text only).

### Deviations from the plan prose (recorded, win over prose)

1. **`createMockCheckInRow` gained `soreness: options.soreness ?? 3` in commit ①, not ②** — the regenerated `check_ins` Row makes it a required key, so the literal fails tsc without it ("migration+types only" vs the §13 gate: the gate won).
2. **`createMockCheckInFormData` (mock-data-builders ~354-357) NOT extended** — zero importers, untyped, and it models form data, which never carries soreness (decision F). Note: the check-in builders have NO importers at all today; the "default 3 so unrelated tests can't trip the trigger" rationale is moot until Session 2's trigger tests use them.
3. **`calculateMetricAverages`: soreness joined the `validLogs` filter** (plan didn't specify). Without it, a soreness-only period hits the fabricated-defaults early-return and DROPS the real soreness. Consequence (acceptable, pre-existing semantics): a soreness-only period still inserts fabricated sibling snapshots ({mood:3, energy:5, sleep:5, stress:5, soreness:X}) — identical sibling behavior to an energy-only period today; the filter change only rescues the real soreness value.
4. **`toBoundedInt` (wellness page) hardened `=== null` → `== null`** — a response missing the key flowed `undefined` through `Math.round` → NaN → JSON `null`, which would clobber a stored value on save. Latent for all four siblings; surfaced by the new soreness test.
5. **CLIENT-APP-REFERENCE.md :167-168 verb fix widened to BOTH lines** (owner-approved one-word extension): wellness AND nutrition lines said POST; both routes are GET + PATCH (verified via exported handlers). Also dropped "notes" from the :167 wellness field list — `wellnessCardSchema` is `.strict()` and has never accepted a notes key.
6. **CLIENT-APP-REFERENCE.md :48 (Core Features) and :568-571 (Color Schemes)** gained soreness lines — two enumeration sites the plan's docs list missed (found by case-INSENSITIVE grep; the original sweep was case-sensitive).

### Session 2 must know

- **`lib/attention-feed-helpers.ts` silently drops soreness**: the hand-typed `DailyLogRow` (~28-36) and the inline mapper in `groupClientData` (~92-95) lack the field, so the attention-feed read path sees `undefined` even though the view now returns it. The Phase 6 table already lists this file — treat those two edits as the `high_soreness` trigger's PREREQUISITE (same silent-drop class as `DailyLogFullRow` was). Its line-27 comment is accurate (no stale-types claim there).
- **CLIENT-APP-REFERENCE.md :694-698 (Automated Alerts)**: NOT edited this session — append `- Soreness ≥ 8 for 3+ consecutive days` when the trigger ships (commit ④).
- **`check-in-comparison-view.test.tsx`**: the only full `ProgressChartData` literal is the `emptyChartData()` factory (~18-26); both test usages spread it. Adding the required `soreness` key breaks at the TSC gate (vitest alone stays green — esbuild doesn't typecheck).
- **`components/check-in/wellness-section.tsx`** METRICS config (~28-33) confirmed coach-only (sole importer: check-in-detail-modal) — Phase 4 as planned.
- **`client-portal-progress` select-string coverage**: the test fake now captures `.select()` arguments and asserts the check_ins query contains `soreness` + a data-flow case. Wire-format against a real DB is still unproven until the browser smoke (checklist item 3).
- Client-portal UI conventions found: label "Muscle soreness" (wellness control), tile/pill label "Soreness", detail row "Muscle Soreness"; chart color `#a855f7` purple (nearest neighbor is `#8b5cf6` violet = weight/chest/DEFAULT_COLOR — an unregistered id silently renders violet); client-portal surfaces use plain classes, NOT the MONO tokens — copy siblings per file.
- Observed stale doc content NOT fixed (out of scope): CLIENT-APP-REFERENCE :467 "Single save" contradicts the per-domain writes; :723 component tree lists the deleted `components/daily-pulse/` files.
