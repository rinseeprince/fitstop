# Nutrition Plans Architecture — Proposed Redesign

## Problem Statement

Nutrition plan data currently lives as ~15 flat fields on the `clients` table. Daily targets are computed dynamically from these fields + the active training plan and are never persisted as a unit. The only historical records are:

1. **`daily_logs.target_calories`** — snapshotted at log time (includes real-time training adjustments). No snapshot exists if the client doesn't log that day.
2. **`nutrition_plan_history`** — records each plan generation event with flat macros, but not per-day distributions, custom day overrides, or training day adjustments.

### Real Gaps This Creates

- **Mid-week plan change**: Coach drops calories on Thursday. `upsertWeeklySummary` backfills Mon-Wed (unlogged days) with the **new** plan targets instead of what was actually active on those days.
- **Check-in review inaccuracy**: `NutritionSection` / `KPIRibbon` only sum targets from logged daily logs. Unlogged days are invisible — a client logging 3/7 days perfectly shows 100% instead of their actual adherence against the full week.
- **No plan reuse**: Coaches can't save, name, duplicate, or reuse plans across clients.
- **No clean separation**: Nutrition config mixed with profile fields on `clients` table.
- **Daily targets are ephemeral**: Per-day computed targets (baseline + training day adjustments + external activity burns + custom day distribution) exist only in memory.

---

## Current Architecture (What Exists Today)

### How a Nutrition Plan Is Created
1. Coach opens client -> Nutrition tab -> `NutritionSettingsDrawer`
2. Sets: work activity level, protein target (g/kg), diet type, optional goal deadline
3. Clicks "Generate Plan" -> `POST /api/clients/[id]/nutrition`
4. Backend (`nutrition-service.ts`):
   - Calculates TDEE = BMR x activity multiplier
   - Calculates baseline calories = TDEE - deficit (from goal/deadline, with safety caps)
   - Calculates macros using protein-first approach, remaining cals split by diet type
5. Saves ~15 fields directly to `clients` table + creates `nutrition_plan_history` row
6. Frontend calls `getWeeklyNutritionTargets()` to compute per-day targets dynamically (not stored)

### How Daily Pulse Uses the Plan
1. Client opens Daily Pulse on their dashboard
2. `GET /api/client/daily-logs/nutrition-target?date=YYYY-MM-DD` calls `getTodaysNutritionTarget()`
3. Returns: baseline calories + training session calories + external activity calories for that day
4. Client logs food -> `POST /api/client/daily-logs`
5. Backend recalculates **adjusted** targets based on what training the client actually completed:
   - `adjustedCalories = baselineCalories + completedTrainingCals + completedActivityCals`
   - Macros scaled proportionally (protein fixed, carbs/fat rebalanced)
6. `target_calories` stored in `daily_logs` row — this is the **snapshot**
7. Triggers `upsertWeeklySummary` (fire-and-forget)

### Where It Breaks
- Step 6 only happens if the client logs. No log = no snapshot.
- `getTodaysNutritionTarget()` always reads from the **current** plan on the `clients` table.
- If the coach changed the plan between when a day occurred and when the weekly summary recalculates, unlogged days get the wrong target.

### Advanced Features That Must Be Preserved
- **Custom macros override**: Coach manually sets P/C/F/cal, bypassing calculations
- **Custom day distribution (calorie skewing)**: Coach distributes baseline unevenly across Mon-Sun, stored as `day_calorie_overrides` JSONB
- **Activity burn toggle** (`include_activity_burn`): Whether training calories are additive to baseline
- **Weight change detection**: >=3kg change from `nutrition_plan_base_weight_kg` triggers regeneration banner
- **Training plan integration**: Training session calories are additive per-day from the active training plan

---

## Proposed Schema

### `nutrition_plans` table

Each plan version is **immutable once archived**. Only one plan per client can be `active` at a time. Every change — even just a calorie reduction — creates a new row. The previous plan is archived with `effective_until` set. This gives coaches a full audit trail of every change over time.

```sql
CREATE TABLE nutrition_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  coach_id UUID NOT NULL REFERENCES coaches(id),

  -- Identity & lifecycle
  name TEXT,                                -- optional label ("Cut Phase 2", "Maintenance")
  status TEXT NOT NULL DEFAULT 'active',    -- 'active' | 'archived'
  effective_from DATE NOT NULL,             -- first day this plan applies
  effective_until DATE,                     -- NULL while active; set when archived

  -- Calculation inputs (frozen at creation)
  work_activity_level TEXT NOT NULL,
  training_volume_hours TEXT NOT NULL,
  protein_target_g_per_kg NUMERIC NOT NULL DEFAULT 2.0,
  diet_type TEXT NOT NULL DEFAULT 'balanced',
  goal_weight_kg NUMERIC,
  goal_deadline DATE,
  include_activity_burn BOOLEAN NOT NULL DEFAULT true,

  -- Calculated baseline (rest day, before training additions)
  baseline_calories INTEGER NOT NULL,
  protein_target_g NUMERIC NOT NULL,
  carb_target_g NUMERIC NOT NULL,
  fat_target_g NUMERIC NOT NULL,

  -- Snapshot of client metrics at plan creation
  base_weight_kg NUMERIC NOT NULL,
  bmr NUMERIC,
  tdee NUMERIC,

  -- Custom macro overrides
  custom_macros_enabled BOOLEAN NOT NULL DEFAULT false,
  custom_calories INTEGER,
  custom_protein_g NUMERIC,
  custom_carb_g NUMERIC,
  custom_fat_g NUMERIC,

  -- Custom day distribution (calorie skewing)
  custom_day_distribution BOOLEAN NOT NULL DEFAULT false,
  day_calorie_overrides JSONB,

  -- Metadata
  regeneration_reason TEXT,     -- 'initial' | 'regenerated' | 'weight_change' | 'custom_macros'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Only one active plan per client
CREATE UNIQUE INDEX idx_nutrition_plans_active_unique
  ON nutrition_plans(client_id) WHERE status = 'active';

CREATE INDEX idx_nutrition_plans_client_date
  ON nutrition_plans(client_id, effective_from DESC);
```

### `nutrition_plan_daily_targets` table

Stores the **fully computed** per-day targets at plan creation time. This is the key missing piece — a historical snapshot of what the plan prescribed for each day, including training day adjustments, custom day distribution, and activity burns.

```sql
CREATE TABLE nutrition_plan_daily_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nutrition_plan_id UUID NOT NULL REFERENCES nutrition_plans(id) ON DELETE CASCADE,
  day_of_week TEXT NOT NULL,            -- 'monday' .. 'sunday'

  -- Computed targets for this day (final, after all adjustments)
  calories INTEGER NOT NULL,
  baseline_calories INTEGER NOT NULL,   -- before training additions
  protein_g NUMERIC NOT NULL,
  carb_g NUMERIC NOT NULL,
  fat_g NUMERIC NOT NULL,

  -- Training context (frozen at plan creation)
  is_training_day BOOLEAN NOT NULL DEFAULT false,
  training_session_calories INTEGER DEFAULT 0,
  external_activity_calories INTEGER DEFAULT 0,

  UNIQUE(nutrition_plan_id, day_of_week)
);
```

---

## How This Solves Each Problem

### 1. Mid-week plan change — correct historical targets

When a coach changes the plan (even just reducing calories):
1. Current plan archived: `status = 'archived'`, `effective_until = yesterday`
2. New plan created: `status = 'active'`, `effective_from = today`
3. Both plans retain their `nutrition_plan_daily_targets` rows

To find the correct target for any historical date:
```sql
SELECT np.*, npdt.*
FROM nutrition_plans np
JOIN nutrition_plan_daily_targets npdt ON npdt.nutrition_plan_id = np.id
WHERE np.client_id = $1
  AND np.effective_from <= $date
  AND (np.effective_until IS NULL OR np.effective_until >= $date)
  AND npdt.day_of_week = $day_of_week
ORDER BY np.effective_from DESC
LIMIT 1;
```

Monday's target comes from the plan that was active on Monday — even if the plan changed on Wednesday.

### 2. Check-in review — full week accountability

The check-in review components can build a proper full-week target:

```
For each day in the check-in period:
  IF daily_log exists -> consumed = daily_log.caloriesConsumed
                         target = daily_log.target_calories (real-time adjusted snapshot)
  ELSE               -> consumed = 0 (accountability: missed day)
                         target = nutrition_plan_daily_targets for the plan active on that date
```

Result: `8,000 consumed / 16,500 target` — coach sees the real picture.

### 3. Coach plan history & audit trail

Every change creates a new row, so the coach can see the full timeline:

```
Feb 3:  "Bulk Phase" — 2800 cal baseline (active Feb 3 - Feb 14)
Feb 15: "Mini Cut"   — 2500 cal baseline (active Feb 15 - Feb 28)
Mar 1:  "Cut Phase"  — 2200 cal baseline (active Mar 1 - present)
```

Each with its own frozen daily targets, custom distributions, and training context.

### 4. Daily Pulse — no change needed

Daily Pulse still works the same way:
1. `getTodaysNutritionTarget()` reads from the **active** nutrition plan (now from `nutrition_plans` table instead of `clients` fields)
2. Client logs -> backend calculates adjusted targets based on actual training completed
3. `target_calories` still snapshotted to `daily_logs` (preserves real-time adjustments)

The `daily_logs.target_calories` snapshot remains valuable because it captures what actually happened (e.g., client did an alternative session), while `nutrition_plan_daily_targets` captures what was planned.

### 5. Weekly summary — accurate backfill

`upsertWeeklySummary` changes from:
```js
// OLD: unlogged days use current plan (wrong after plan change)
const planTargets = await Promise.all(
    unloggedDays.map(d => getTodaysNutritionTarget(clientId, d))
);
```

To:
```js
// NEW: unlogged days use the plan that was active on that specific date
const planTargets = await Promise.all(
    unloggedDays.map(d => getPlanTargetForDate(clientId, d))
);
```

---

## Impact on New Check-In Review Components

The redesigned coach review modal (stashed components) will need the following changes to support full-week accountability:

### `KPIRibbon`
- Currently: sums calories/targets from `dailyLogs` only (unlogged days invisible)
- Change: accept a `fullWeekTarget: number` prop for the calories card
- Display: `totalConsumed / fullWeekTarget` instead of `totalConsumed / loggedDaysTarget`
- Adherence badge compares against full week

### `NutritionSection`
- Currently: progress bar and totals from logged days only, averages divided by `daysDiff`
- Change: accept `fullWeekTarget` (total cal + macro targets for all 7 days)
- Progress bar: `totalConsumed / fullWeekTarget`
- Macro bars: actual vs full-week macro targets
- Average display: `totalConsumed / daysDiff` stays the same (already full-week denominator)

### `WellnessSection`
- No change needed — wellness data only comes from daily logs, no plan dependency

### `TrainingSection`
- No change needed — reads from daily logs + check-in exercise highlights

### `HabitsSection`
- No change needed — reads from habit logs

### `ClientNotesSection`
- No change needed — reads from check-in fields

### `check-in-detail-modal.tsx`
- New data fetch: get full-week nutrition targets for the check-in period
  - For each day: use `daily_log.target_calories` if logged, else `getPlanTargetForDate()` from `nutrition_plan_daily_targets`
- Pass computed `fullWeekTarget` to `KPIRibbon` and `NutritionSection`

---

## Migration Strategy

### Phase 1: Create tables, dual-write
- Create `nutrition_plans` and `nutrition_plan_daily_targets` tables
- On plan create/update via `/api/clients/[id]/nutrition`:
  - Continue writing to `clients` fields (backward compat)
  - Also insert into `nutrition_plans` + compute and insert `nutrition_plan_daily_targets`
- Migrate existing `nutrition_plan_history` rows -> `nutrition_plans` with `status = 'archived'`
- Create the current active plan from `clients` fields as `status = 'active'`
- Backfill `nutrition_plan_daily_targets` for the active plan using `getWeeklyNutritionTargets()`

### Phase 2: Read from new tables
- `getClientNutritionTargets()` -> read from `nutrition_plans` + `nutrition_plan_daily_targets`
- `getTodaysNutritionTarget()` -> query active plan -> return daily target for day of week
- New function: `getPlanTargetForDate(clientId, date)` -> find plan active on that date -> return target
- `upsertWeeklySummary` -> use `getPlanTargetForDate()` for unlogged days
- Check-in review components -> receive `fullWeekTarget` computed from daily logs + plan targets
- Daily Pulse -> `getTodaysNutritionTarget()` reads from new tables (same behavior, different source)

### Phase 3: Clean up
- Remove nutrition columns from `clients` table (or keep as denormalized cache)
- Deprecate `nutrition_plan_history` (data lives in `nutrition_plans` with `status = 'archived'`)
- Coach UI reads plan history from `nutrition_plans` instead of `nutrition_plan_history`

---

## Key Files to Modify

| File | Change |
|------|--------|
| `supabase/migrations/XXX_create_nutrition_plans.sql` | New migration |
| `types/database.ts` | Regenerate from Supabase |
| **Services** | |
| `services/nutrition-service.ts` | Plan creation -> write to new tables + compute daily targets |
| `services/client-portal-service.ts` | `getClientNutritionTargets()` -> read from new tables |
| `services/daily-logs-service.ts` | `getTodaysNutritionTarget()` -> query by date from new tables |
| `services/weekly-nutrition-service.ts` | `upsertWeeklySummary()` -> `getPlanTargetForDate()` for unlogged days |
| `services/client-check-in-service.ts` | AI context -> pass accurate plan history |
| **API Routes** | |
| `app/api/clients/[id]/nutrition/route.ts` | Dual-write to new tables in Phase 1 |
| `app/api/clients/[id]/nutrition/history/route.ts` | Read from `nutrition_plans` in Phase 3 |
| **Hooks** | |
| `hooks/use-nutrition-builder.ts` | Plan generation -> persist daily targets |
| `hooks/use-nutrition-plan.ts` | Read from new tables |
| **Utils** | |
| `utils/nutrition-helpers.ts` | `getWeeklyNutritionTargets()` results persisted to daily targets |
| **Check-in Review Components** | |
| `components/check-in/nutrition-section.tsx` | Accept `fullWeekTarget` prop |
| `components/check-in/kpi-ribbon.tsx` | Accept `fullWeekTarget` prop |
| `components/check-in/check-in-detail-modal.tsx` | Fetch full-week target and pass to components |

---

## Design Decisions

| Decision | Rationale |
|----------|-----------|
| Every change creates a new row | Full audit trail — coach sees "Feb 3: 2800 cal -> Feb 15: 2500 cal". Even small tweaks are preserved. |
| Immutable once archived | Historical accuracy — always answer "what was the plan on date X?" |
| `effective_from` / `effective_until` date range | Date-based lookups without scanning all plans |
| Unique active constraint | Prevents accidentally having two active plans |
| Store computed daily targets (not just baseline) | Avoids recalculating from training plan state that may have since changed |
| Keep `daily_logs.target_calories` | Captures real-time adjustments (actual training completed, alternative sessions) — different from the planned target |
| `nutrition_plan_daily_targets` stores 7 rows per plan | Simple, queryable, covers custom day distribution and training day adjustments |
| Phase approach to migration | No big-bang rewrite; backward compat maintained throughout |

---

## Table Relationships

```
nutrition_plans (NEW)
  |-- nutrition_plan_daily_targets (NEW) — 7 rows per plan, frozen at creation
  |-- clients.id (FK) — one active plan per client
  +-- coaches.id (FK) — who created it

daily_logs (EXISTING, unchanged)
  +-- target_calories — real-time adjusted snapshot (actual training completed)
      Different from plan target: e.g., client did alternative session

nutrition_weekly_summaries (EXISTING, logic updated)
  +-- unlogged day targets -> sourced from nutrition_plan_daily_targets
      instead of current plan via getTodaysNutritionTarget()

nutrition_plan_history (EXISTING -> deprecated in Phase 3)
  +-- data migrated into nutrition_plans with status='archived'
```

---

## Future Possibilities

- **Plan templates**: Coach saves a named plan, applies to multiple clients
- **Plan comparison**: Side-by-side view of plan evolution over time
- **AI plan suggestions**: AI recommends adjustments based on check-in trends + plan history
- **Client plan timeline**: Client sees how their plan evolved and why
- **Seasonal periodization**: Pre-schedule future plan changes (bulk -> cut -> maintenance)
- **Plan duplication**: Coach duplicates a successful plan to another client
