# Nutrition Calendar Overhaul — Implementation Spec

> **Status: ✅ IMPLEMENTED** (Sessions 1-5 of the events-SOT overhaul, migrations 113-118; 2026-06-17 → 2026-06-21). This spec shipped as designed — one durable nutrition plan + per-day `nutrition_events` calendar editing (`is_modified`/`note`), event→plan FKs `SET NULL`, promotion removed. **Authoritative shipped model: `docs/ARCHITECTURE.md → Nutrition & Training Events`** (the events-SOT execution plan was deleted after shipping; its record is in git history). Retained as the design-decision record (the §2 D1-D6 rationale); the prescriptive "Delete X / remove Y / migrate Z" language below is **historical** (that work is done). **§8 is moot:** roadmaps/phases were removed entirely on 2026-07-25 (tag `roadmap-v2-pre-removal`) — there is no phase transition, so the re-window it planned no longer applies. Phase/roadmap mentions below are historical design context.
> **Owner decisions baked in as recommended defaults** (see §2).

---

## 1. Context

The coach nutrition builder feels like a template tool: generate a plan, see a 7-day Mon–Sun grid, future plans sit "planned", old ones fall into "Plan History". The coach wants it to behave like the **training calendar** — events on a real date calendar, coach picks the start date, individual and multi-day ranges are editable (deloads, race weeks, holidays), the window follows roadmap/phase length, and the training→nutrition calorie **cascade keeps working**.

**Critical reframe (verified):** the "7 days" is a *display* illusion. `nutrition_events` is already a date-keyed calendar table (`UNIQUE(client_id,date)`, mig 077), already generated across the full phase length (`calculateNutritionEndDate`), already kept in sync by the cascade (`cascadeNutritionAfterTrainingChange`), and already immutable in the past. The 7-day grid is just `WeeklyNutritionView` projecting events down to weekday rows. So this is a **UX + lifecycle-simplification** effort over an existing data model, not a rebuild.

**The one real blocker:** nutrition currently mutates by minting a *new immutable plan version* and re-projecting events (archive-and-replace). A per-day calendar edit lives on the current plan's row and is wiped by the next version mint. The fix is to **stop versioning** (one mutable plan = the live generator) and **store edits on the events** with an `is_modified` flag the cascade preserves — exactly how the training calendar already protects coach-moved sessions (mig 082).

**Outcome:** coach gets a nutrition calendar with the same interaction model as training; the cascade is preserved; the past stays immutable and bulletproof for the future AI progression engine.

---

## 2. Design decisions (recommended defaults — confirm/flip)

| # | Decision | Default (this spec assumes) | Alternative |
|---|----------|------------------------------|-------------|
| D1 | **Build order** | Foundation → read-only calendar → editing → cleanup (shippable slices, §11) | Read-only first / big-bang |
| D2 | **Phase transition** | Durable plan **auto re-windows** to the next phase + regenerates forward (preserving edits) | Coach re-places nutrition each phase |
| D3 | **Edit input** | Coach sets **absolute** ("2200") *or* **adjust-by-amount** ("−20% / −500"); stored as resolved absolute on each day | Absolute only |
| D4 | **Historical-data FK** | Migrate events→plan FK to **`ON DELETE SET NULL`** + nullable (events fully decoupled from plan lifecycle) | Keep `ON DELETE CASCADE` + strict never-delete rule |
| D5 | **base_weight / goal snapshot** | Cascade/in-place regen **never re-stamps** `base_weight_kg` or goal snapshot; only an explicit "Recalculate plan" coach action does | (none — required to keep banners alive) |

---

## 3. The key simplifier — materialize overrides onto the event

When a coach edits a day, **write the resolved numbers directly onto the event's existing fields** and mark it:

```
baseline_calories          := <resolved override calories>
protein_g / carb_g / fat_g := <resolved override macros>
calorie_surplus_percentage := NULL      -- frozen: training surplus no longer stacks
training_burn_calories     := 0
is_modified                := true
```

Why this matters: **every existing consumer reads the day's number through `getTotalCalories(event)` / `event.baselineCalories`** (the client per-day read, the log-time snapshot, the weekly denominator, the check-in AI snapshot's inline calc in `buildNutritionSummary`, the history views). Because the override is materialized onto `baseline_calories` with a null surplus, all of them surface the coach's number **with no consumer changes** — this collapses several "needs-change" items (including check-in landmine #4) into "no change". `is_modified` exists purely so the **cascade/regenerate** knows to leave that day alone. We do **not** need separate `override_*` columns or to store the original generator value (reset = clear the flag and regenerate that day from the plan).

> Trade-off this default accepts (D3): an edited day is **frozen** — training surplus stops stacking on it. That's correct for deloads/race weeks (the coach wants the absolute number). If you ever want "reduce baseline but keep surplus stacking", that requires a separate `override_baseline` column instead of materializing; out of scope for v1.

---

## 4. Data model changes (migrations)

All new migrations follow existing discipline: pure ASCII (old CLI splitter), `DROP` superseded RPC overloads by explicit signature, `SET search_path = public`, `REVOKE` from public/anon/authenticated + `GRANT EXECUTE ... TO service_role` (per migs 106/110).

### Mig A — `nutrition_events`: editability + decoupling (additive, breaks nothing)
```sql
ALTER TABLE nutrition_events ADD COLUMN is_modified BOOLEAN NOT NULL DEFAULT false;
-- D4: events are the SOT; a plan delete must never cascade-wipe events
ALTER TABLE nutrition_events ALTER COLUMN nutrition_plan_id DROP NOT NULL;
ALTER TABLE nutrition_events DROP CONSTRAINT <events_plan_fk_name>;   -- look up actual name
ALTER TABLE nutrition_events ADD CONSTRAINT nutrition_events_plan_fk
  FOREIGN KEY (nutrition_plan_id) REFERENCES nutrition_plans(id) ON DELETE SET NULL;
```
Mirror of training `is_modified` (mig 082). `nutrition_logs.nutrition_plan_id` is already `ON DELETE SET NULL` (mig 059) — this brings events to parity.

### Mig B — `create_nutrition_plan_atomic` → in-place upsert
Rewrite the live RPC (currently archive-active + insert-active, with a future/`planned` branch):
- **Delete** the future/`planned` branch entirely.
- **Body becomes:** upsert the single active plan per client (the `idx_nutrition_plans_active_unique` partial unique index is the conflict target), then **replace its `nutrition_plan_daily_targets`** — must be `DELETE`-then-`INSERT` or `ON CONFLICT (nutrition_plan_id, day_of_week) DO UPDATE` (a plain insert loop collides with the unique key on the 2nd call).
- **D5:** add a boolean param (e.g. `p_recalc_snapshots`). When false (cascade/in-place edit) **preserve** existing `base_weight_kg`, `goal_weight_kg`, `goal_deadline`; when true (explicit "Recalculate plan") re-stamp them.
- `nutrition_plan_daily_targets` FK is also `ON DELETE CASCADE` (mig 044) — fine under update-in-place; just don't hard-delete the plan.

### Mig C — drop the "planned" model (after data migration)
- Data step first: promote-or-delete any existing `status='planned'` nutrition_plans rows.
- `DROP INDEX idx_one_planned_nutrition_plan_per_client;` (mig 079).
- Retire the planned-status RPC of record (mig 080).

### Seed / backfill
- `scripts/seed-scale-client.ts` — insert **dense** `nutrition_events` (today's seed omits them).
- `scripts/backfill-nutrition-events.ts` — drop the archived-window/per-version branch (one plan → one dense window).
- One-time: recompute cached `nutrition_weekly_summaries` (sparse-era rows used an incomplete denominator; dense generation completes it and will move some adherence numbers — expected, not a regression).

---

## 5. Service-layer changes

`services/nutrition-event-service.ts`
- **`regenerateFutureNutritionEvents`** — the delete must **always preserve** `is_modified` rows: add `.eq('is_modified', false)`. (Nutrition always preserves coach edits across the cascade — no `force` param needed, unlike training; explicit reset clears the flag first.) Remove the now-dead planned-plan end-cap block.
- **`generateNutritionEvents`** — before upserting, query existing `is_modified=true` dates in `[start,end]` and **omit them** from the insert array (so the `onConflict(client_id,date)` upsert can't overwrite a preserved override).
- **`cascadeNutritionAfterTrainingChange`** — drop `'planned'` from the `.in('status', [...])`; iterate the single active plan.
- **`calculateNutritionEndDate`** — add a **no-active-phase rule** (D2): when the linked phase is `skipped`/absent, fall back to the configured window length rather than silently windowing off a dead phase.

`services/nutrition-plan-service.ts` / `services/nutrition-plan-orchestrator.ts`
- `createNutritionPlan` RPC semantics flip to **upsert-in-place**; remove the "capture old plan id before archive" dance and the `deleteFuture + regenerate-new` pair (collapse to a single in-place regenerate).
- **Delete `promoteNutritionPlanIfReady`** and strip its **6 callers**: `app/api/clients/[id]/nutrition/route.ts`, `nutrition/skew/route.ts`, `activation-readiness/route.ts`, `services/check-in-context-service.ts`, `services/client-portal-service.ts`, `services/comparison-service.ts`.
- `getActiveNutritionPlanId` stays (now returns the single durable plan) — keep `idx_nutrition_plans_active_unique` as the singleton enforcer.

`utils/nutrition-period-summary.ts` — collapse `findActiveNutritionPlan` multi-version date-windowing to the single active plan. (Override visibility is already handled by §3 materialization; this only affects pre-backfill historical gaps, mitigated by dense generation + backfill.)

Dead code to remove: `markNutritionEventLogged` / `markMissedNutritionEvents` (zero callers); the dead `nutrition_plan_history` table (mig 011, no readers/writers); `cleanup-duplicate-events.ts` version-windowing branch.

---

## 6. New / changed API endpoints

| Endpoint | Purpose | Notes |
|----------|---------|-------|
| `GET /api/clients/[id]/nutrition/events?startDate&endDate` | Coach calendar ranged read | Thin wrap of existing `getNutritionEventsForDateRange` |
| `PATCH /api/clients/[id]/nutrition/events/range` | Multi-day edit: apply absolute or delta to a date range | **Today-forward gate** server-side via `canEditDay`; materializes per §3; `is_modified=true` |
| `PATCH /api/clients/[id]/nutrition/events/[date]/reset` | Reset day(s) back to auto | Sets `is_modified=false`, regenerates those dates from the plan |
| `app/api/clients/[id]/nutrition/route.ts` | Remove the planned-preview block; keep plan-create (now in-place) | |
| `app/api/clients/[id]/nutrition/skew/route.ts` | **Repoint to the range-edit path** or delete | Must NOT touch `base_weight_kg` (D5) |

Follow the standard route order (rate-limit → CSRF → auth → IDOR → zod → service). Edit routes are coach-side (`getAuthenticatedCoachId` + ownership). The range PATCH must enforce `date >= clientToday` server-side (new guard — no existing one to inherit) and thread one client-local date.

---

## 7. Coach UI

- **`NutritionCalendarView`** — port `components/clients/training/calendar/training-calendar-view.tsx` shell: month-grid math (`mondayOnOrBefore`/`sundayOnOrAfter`/`buildWeeks`), month nav, phase tint, **two-clock gating** (today-ring = coach device; edit/drag enablement = client-local `clientToday`). One event per day (calories, TRAIN badge, macros). Reuses a `use-nutrition-calendar-events` hook (copy of `use-calendar-events.ts`, repoint URL).
- **Edit mode + multi-select** (the parity payoff, nutrition-specific): an "Edit" toggle highlights eligible (today-forward) days; coach selects 1/2/several/this-week/this-month (NOT "all" → that's "regenerate plan"); a **range-edit modal** sets calories/macros as absolute or adjust-by-amount (D3). Macros auto-rebalance (protein fixed) via existing `calculateDailyMacros`, with manual override.
- **Reset-to-plan** affordance on edited day(s); **visual badge** marking `is_modified` days (training already dims modified events — mirror it).
- **Retire** `WeeklyNutritionView` as the primary surface (can remain as a "typical week" summary); **remove the Plan History tab** (`nutrition-plan-history.tsx`) and its wiring in `nutrition-plan-builder.tsx`.

---

## 8. Phase-transition rework (landmine — D2) — MOOT: phases removed 2026-07-25

Today `transition_phase_atomic` (mig 111) does `UPDATE nutrition_plans SET status='archived'` for the completing phase, and `phase-transition-service.ts` strips its future events. Under **one durable plan spanning phases**, that archives the client's *only* plan and **blanks the forward calendar**.

Change (default D2 = auto re-window):
- On transition, instead of archiving, **re-point the durable plan to the activated phase** (`UPDATE phase_id`) and **regenerate forward** to the new phase's window (preserving `is_modified` days).
- Retire the `planHandling.nutritionPlan: keep|archive` toggle and its coach-UI control; update `transition_phase_atomic` nutrition branch + `phase-transition-service.ts` accordingly.
- `archive_roadmap_atomic` (mig 099) never touches nutrition — add the no-active-phase windowing rule from §5 so the plan doesn't window off a skipped phase.

`requirePhaseSelection` + `resolveEffectiveGoal` are **unchanged** (the create gate + phase-is-king resolver are safe); the create gate just fires once now, not per edit.

---

## 9. Banner preservation (landmine — D5)

The weight-change regeneration banner (`|currentWeight − base_weight_kg| ≥ 3kg`, `nutrition-helpers.ts`) and the goal-changed banner (`detectGoalDrift` vs the plan's frozen `goal_weight_kg`/`goal_deadline`) only work because they compare live state to a **frozen snapshot on the plan**. The in-place regenerate path must **not** re-stamp `base_weight_kg` or the goal snapshot (D5 / Mig B param). `nutritionPlanCreatedDate` IS live banner copy ("since {date}") — keep the `comparison-service` read, don't drop it as vestigial.

---

## 10. Client / RN

- **Per-day client lane is transparent** — `getNutritionForDate` (logged → event → null), `upsertNutritionLog` (freezes target at log time). §3 materialization means overrides surface with no client change. Dense generation only reduces "no target" days. RN response **shapes** (`DaySummary.nutrition`, `NutritionForDate`, `WeeklyNutritionSummary`) are preserved.
- **Program/nutrition view** (`vertical-nutrition-view.tsx` + `getClientNutritionTargets`) is the one client surface on the 7-weekday template + planned-promotion — repoint to the single plan + dense date window, drop the `promote` call. **The only semantic change:** `NutritionTargets.dailyTargets` shifts from a weekday array to a date window → **coordinate an RN contract note** (object shape unchanged; meaning changes). ⚠️ Verify whether RN consumes `dailyTargets` as a 7-weekday array before shipping.
- **Check-in:** stored adherence (`nutrition_days_on_target`, `adherence_percentage` via `getNutritionSummaryForPeriod`) is frozen-logs-only → invariant. The **AI day-by-day snapshot** (`check-in-snapshot-service` → `buildNutritionSummary` → `ai-prompt-builder`) becomes correct automatically once overrides are materialized (§3); the only residual is pre-backfill historical gaps, mitigated by dense generation + backfill.

---

## 11. Rollout sequence (each slice ships without breaking consumers)

1. **Mig A** — add `is_modified` + FK→SET NULL (additive).
2. **Cascade preserve** — `regenerateFutureNutritionEvents` delete-guard + `generateNutritionEvents` skip; ship **before** any edit UI exists.
3. **Range-edit + reset endpoints** (§6) with the today-forward server guard.
4. **Repoint/remove skew** (§6) → range overrides; preserve `base_weight_kg`.
5. **Mig B** — `create_nutrition_plan_atomic` in-place upsert + D5 param; flip `createNutritionPlan`/orchestrator to in-place.
6. **Remove `promoteNutritionPlanIfReady` + all 6 callers + tests.**
7. **Mig C** — migrate planned rows, drop planned index/branch; remove cascade `'planned'` filter + dead end-cap.
8. **Phase-transition rework** (§8) — must land **with** the one-plan cutover (gates the blank-calendar break).
9. **Retire Plan History** tab + `/nutrition/history` version-ledger reads; collapse `findActiveNutritionPlan`.
10. **Coach calendar UI** (§7, read-only first) → **editing UI** (multi-select + reset + badges) → **client program view** rework (§10).
11. **Seed dense events; recompute cached weekly summaries** (FK already handled in Mig A).

> Build-order note for the merge (D1): steps 1–2 are the safety foundation; the **read-only calendar (step 10a) can ship anytime after step 1** for an early visible win; editing (10b) requires steps 1–3; the model-simplification cleanup (5–9) is what removes the version-mint complexity and unblocks clean editing.

---

## 12. ⚠️ Cross-coupling with the training overhaul (read before merging)

These surfaces are **shared** between this spec and the training-builder work — coordinate them in the merged plan:

1. **The cascade is one-directional via one column.** Training writes `training_events.calorie_surplus_percentage`; nutrition reads it in `generateNutritionEvents`. If the training overhaul changes how/where that surplus is written, or renames it, **nutrition calorie targets silently fall back to rest-day baseline**. Keep the surplus column populated on every event create/move/duplicate/placement.
2. **The cascade triggers are consolidated** — the 8 training event-write routes (`place-from-library`, `events/[eventId]` PATCH/DELETE, `events/[eventId]/move`, `events/[eventId]/duplicate`, `[planId]/sessions/[sessionId]`, `[planId]/amendment`, `[planId]`, and the client-level `training` DELETE) all call `cascadeNutritionAfterTrainingChange`. The consolidation this item asked for has shipped; `duplicate-week` and `regenerate-events` no longer exist as routes. What remains load-bearing is the anchor-date discipline: each route computes and threads its OWN anchor (`min(source,target)` on moves, `targetDate` on duplicate, the rewrite floor on an amendment, client-local today on deletes).
3. **`is_modified` is a shared pattern.** Nutrition clones training's `is_modified` + preserve-on-regen. If you refine training's version during the overhaul (e.g. the `force`/confirmation flow), mirror the final shape into nutrition.
4. **The calendar UI shell** (`training-calendar-view.tsx`, `use-calendar-events.ts`, `use-calendar-dnd.ts`, two-clock gating) is the source `NutritionCalendarView` copies. If the training overhaul changes the shell, port the **final** version.
5. **Timezone discipline** — both share the client-local-today rules (migs 110/111, `today-service.ts`). Every new placement/edit/delete path threads one explicit client-local date to both delete and regenerate.

---

## 13. Verification

Per slice, before merging forward:
- **Cascade preserves edits:** unit test — create dense events, set `is_modified` on a future range, move a training session that triggers cascade, assert the modified days are untouched and surplus travels on training days. (Mirror the training cascade tests.)
- **Override transparency:** assert `getNutritionForDate`, the log-time snapshot (`upsertNutritionLog`), the weekly denominator (`getNutritionSummaryForPeriod`), and `buildNutritionSummary` all return the overridden number for an edited day with no consumer-specific code.
- **Past immutability:** attempt an edit on a past/today date → 403 (`canEditDay`); assert no delete path touches `date < clientToday`.
- **Banners alive:** in-place regen (cascade) does NOT change `base_weight_kg`/goal snapshot; explicit "Recalculate plan" DOES.
- **Phase transition:** complete a phase → assert the nutrition calendar re-windows to the next phase and is not blank; `is_modified` days survive.
- **No planned regressions:** grep clean for `promoteNutritionPlanIfReady`, planned-status reads, `nutrition-plan-history`; run the full nutrition + check-in + phase-transition test suites (expect to rewrite ~7 test files that encode dropped behavior: `nutrition-plan-service.test.ts` promotion suite, `comparison-service.test.ts`, `client-portal-service.test.ts`, `phase-transition-service.test.ts` keep|archive, `move/route.test.ts` planned cascade, `activation-readiness/route.test.ts` real-promote, `nutrition/route.test.ts` planned/effectiveFrom gating).
- **Manual / app:** run the app (`/run` skill), open a client's nutrition tab, verify the calendar renders dense events over the phase, drag-select a deload week, confirm it persists across a training-day move and a calorie change, and that the client `/client/nutrition` day view shows the edited number.
- **RN contract:** confirm `/api/client/**` nutrition response shapes are unchanged (diff the JSON); resolve the `dailyTargets` weekday→date note.

---

## 14. Out of scope (v1)

Recurring/auto-scheduled deloads ("every 4th week"); "reduce baseline but keep surplus stacking" (separate `override_baseline` column); a reusable coach nutrition *library* tier (none exists today — nutrition_plans is per-client); reviving `nutrition_events.status` for client logged/missed display (log-existence-derived is fine); counting coached-but-unlogged days in check-in "X/7" (deliberately logged-only today — product call, not forced).
