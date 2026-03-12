# Nutrition Planner - Feature README

  The Nutrition Planner is the coach-side nutrition plan generator and management system. Coaches configure client metrics (activity level, protein target, diet type, goal weight/deadline), generate a calorie/macro plan, and optionally customise per-day calorie distribution. The plan integrates with the client's training plan to add per-day training burn calories. Clients see their daily targets (with or without training burn) on the client portal via Daily Pulse.

  ---

  ## Tech Stack

  - **Framework**: Next.js 14 (App Router)
  - **Database**: Supabase (PostgreSQL with RLS)
  - **Auth**: Supabase Auth
  - **Cache / Rate Limiting**: Upstash Redis
  - **Data Fetching (coach-side)**: SWR
  - **Data Fetching (client-side)**: fetch with `{ cache: 'no-store' }` in server components
  - **Styling**: Tailwind CSS
  - **Icons**: Lucide React
  - **Forms**: React Hook Form + Zod
  - **Testing**: Vitest

  ---

  ## Architecture

  ### Core Principles

  1. **Baseline + additive model** - The plan generates a single `baselineCalories` value (TDEE minus deficit). Training session calories and external activity calories are added per-day on top, giving each day a unique total. This preserves accuracy when clients skip training — their target correctly drops to baseline for that day.

  2. **Protein-first macro split** - Protein grams are locked first (weight × g/kg target). Remaining calories are split between carbs and fat according to the diet type ratio. The diet type ratio is always held constant — no training/rest day adjustments to percentages.

  3. **Diet type ratios** - The carb/fat split of remaining calories (after protein) is determined solely by diet type:
     - Balanced: 50% carbs / 50% fat
     - High carb: 65% carbs / 35% fat
     - Low carb: 25% carbs / 75% fat
     - Keto: 10% carbs / 90% fat

  4. **Two computation paths** - Coach-side (`use-nutrition-plan.ts`) and client-side (`client-portal-service.ts`) both compute weekly targets from the same stored fields using the same utility functions. Neither stores pre-computed daily targets in the database — they are always derived at render time.

  5. **Calorie skewing overrides baseline only** - Custom day distribution replaces the baseline calories per day. Training/activity burn remains additive and dynamic on top. The weekly baseline budget must balance (sum of all 7 day baselines = original weekly baseline ± 10 cal).

  6. **Activity burn toggle** - Coaches can include or exclude training calories from the daily target. When excluded, all days flatten to baseline calories and macros are recalculated on the flat baseline. This lets coaches control whether clients "eat back" exercise calories.

  7. **Plan history snapshots** - Every generation (calculated or custom macros) is logged to `nutrition_plan_history` with a full snapshot of inputs and outputs. This provides an audit trail and enables future plan comparison.

  8. **Regeneration banner** - If a client's current weight diverges 3kg+ from the weight at plan creation, a banner prompts the coach to regenerate. Generating a new plan resets calorie skewing overrides.

  ---

  ## Component Structure

  ### Builder components (coach-side)
  ```
  components/clients/nutrition/builder/
  ├── nutrition-plan-builder.tsx              (38 lines)  - Entry point wrapper for the builder.
  ├── nutrition-settings-drawer.tsx          (171 lines)  - Right-side Sheet containing all generator
  │                                                        controls. Renders UnitToggle, RegenerationBanner,
  │                                                        SettingsForm, CustomMacrosSection,
  │                                                        TrainingCaloriesDisplay, CalorieSkewingSection.
  │                                                        Generate button at bottom.
  ├── nutrition-settings-form.tsx            (203 lines)  - Form inputs for activity level, protein
  │                                                        target (g/kg slider), diet type selector,
  │                                                        goal deadline picker. Tracks settingsChanged.
  ├── nutrition-custom-macros-section.tsx    (131 lines)  - Toggle + inputs for custom protein/carbs/fat/
  │                                                        calories. Validates macro closure (P×4 + C×4 +
  │                                                        F×9 = stated cal ± 50). Shows validation error.
  ├── nutrition-training-calories-display.tsx (129 lines) - Shows training plan calorie breakdown:
  │                                                        daily average, weekly total, per-day breakdown
  │                                                        (MO: +X, TU: +Y). Activity burn toggle Switch.
  │                                                        Status badge: "Not added to targets" or "Auto".
  ├── calorie-skewing-section.tsx           (141 lines)  - Master section for custom day distribution.
  │                                                        Toggle to enable, proportional/custom macro mode
  │                                                        selector, maps days to CalorieSkewingDayRow,
  │                                                        WeeklyBudgetIndicator, Reset & Save buttons.
  │                                                        Only renders if hasPlan.
  ├── calorie-skewing-day-row.tsx           (115 lines)  - Individual day row: day label, training badge,
  │                                                        editable calorie input, macro inputs (if custom
  │                                                        mode), percentage-of-weekly-budget bar. Shows
  │                                                        total = baseline + training burn.
  ├── weekly-budget-indicator.tsx             (55 lines)  - Progress bar showing total vs weekly target.
  │                                                        Green when valid (within ±10 cal), red otherwise.
  │                                                        Shows exact difference and percentage.
  └── nutrition-builder-right-panel.tsx      (170 lines)  - Collects/displays plan summary info: locked
                                                           targets, training breakdown, weekly overview.
  ```

  ### Display components (coach + client)
  ```
  components/clients/nutrition/display/
  ├── nutrition-plan-header.tsx             (142 lines)  - Summary header: daily average calories,
  │                                                       weekly total, protein target, diet type badge.
  ├── weekly-nutrition-view.tsx              (58 lines)  - Grid/flex layout rendering 7 NutritionDayCards.
  ├── nutrition-day-card.tsx               (186 lines)  - Single day card: total calories, training/rest
  │                                                       badge, activity burn indicator, macro summary.
  │                                                       Clickable to expand accordion.
  ├── nutrition-day-accordion.tsx          (178 lines)  - Expandable detail: full macro breakdown with
  │                                                       grams + percentages, training sessions list,
  │                                                       external activities list with calories.
  └── nutrition-targets-display.tsx        (146 lines)  - Table view of macro targets (cal, P, C, F).
  ```

  ### Supporting components
  ```
  components/clients/nutrition/
  ├── nutrition-regeneration-banner.tsx    - Shows when weight changed 3kg+ from plan baseline.
  │                                         Prompts coach to regenerate.
  ├── nutrition-plan-history-modal.tsx     - Modal showing historical plan generations.
  └── nutrition-warnings.tsx              - Display validation/calculation warnings.
  ```

  ---

  ## Hooks

  ```
  hooks/
  ├── use-nutrition-plan.ts          (202 lines) - Core computed values hook.
  │                                                Takes { client, onUpdate }.
  │                                                Fetches training plan on mount.
  │                                                Computes weeklyTargets (7-day DailyNutritionTargets[])
  │                                                by calling getWeeklyNutritionTargets(), then applying
  │                                                applyDayOverrides() if custom distribution enabled,
  │                                                then flattening to baseline if burn excluded.
  │                                                Returns: weeklyTargets, weeklyTotal, trainingDaysCount,
  │                                                restDaysCount, dailyTrainingCalories, weightRemaining,
  │                                                showRegenerationBanner, formatWeight(), etc.
  │
  └── use-nutrition-builder.ts       (349 lines) - Extends useNutritionPlan with builder state.
                                                   Manages: NutritionSettings (activity level, protein,
                                                   diet type, deadline), CustomMacros (P/C/F/cal with
                                                   closure validation), includeActivityBurn toggle,
                                                   calorie skewing (customDayDistribution, dayCalorie
                                                   Overrides, skewMacroMode, budgetValidation).
                                                   Handlers: generatePlan(), handleToggleActivityBurn(),
                                                   handleToggleCustomDistribution(),
                                                   handleDayOverrideChange(), handleSaveCustomDistribution(),
                                                   handleResetToDefault().
  ```

  ---

  ## API Routes

  ### `app/api/clients/[id]/nutrition/route.ts` (385 lines)

  #### POST — Generate/Regenerate Plan
  ```
  POST /api/clients/{id}/nutrition
  Body: GenerateNutritionPlanRequest
  ```
  - Rate limited, CSRF protected, coach ownership verified
  - Validates client has: currentWeight, BMR, gender, weightUnit
  - **Custom macros path**: if `customMacrosEnabled`, validates macro closure (±50 cal), stores directly, resets calorie skewing, logs to history with reason "custom_macros"
  - **Calculated path**: calls `generateNutritionPlan()` → TDEE → baseline → macros, stores in clients table + nutrition_plan_history, returns plan with warnings

  #### PATCH — Update Settings
  ```
  PATCH /api/clients/{id}/nutrition
  Body: { unitPreference?, includeActivityBurn?, customDayDistribution?, dayCalorieOverrides? }
  ```
  - Updates client record directly, no plan regeneration required

  ---

  ## Services

  ### `services/nutrition-service.ts` (325 lines)

  The core calculation engine:

  - **`calculateTDEE(bmr, workActivityLevel)`** — BMR × activity multiplier (1.2 to 1.9)
  - **`calculateBaselineCalories(tdee, currentWeightKg, goalWeightKg, goalDeadline, gender)`** — Computes daily deficit/surplus from goal weight + deadline. Gender-specific caps: female max -0.75kg/week deficit, male max -1.0kg/week. Minimum calories: female 1200, male 1500. Returns baselineCalories + warnings.
  - **`calculateMacros(calorieTarget, currentWeightKg, proteinTargetGPerKg, dietType, gender)`** — Protein-first: proteinG = weight × g/kg. Remaining split by diet type. Gender-specific minimum fat floor (female 25%, male 20%). Returns P/C/F grams + warnings.
  - **`generateNutritionPlan(input)`** — Orchestrates the above three functions. Returns complete plan with baselineCalories, tdee, macros, weeklyWeightChangeKg, warnings.

  ### `services/client-portal-service.ts` — `getClientNutritionTargets()`

  Client-side single source of truth. Fetches client nutrition fields from DB, computes weekly targets using the same utility chain as coach-side (getWeeklyNutritionTargets → applyDayOverrides → burn flattening). Returns `dailyTargets[]` consumed by Daily Pulse nutrition display.

  ---

  ## Utility Functions

  ### `utils/nutrition-helpers.ts` (525 lines)

  **Types:**
  - `DailyNutritionTargets` — Per-day target object: day, isTrainingDay, calories (total), baselineCalories, proteinG/carbsG/fatG, percentages, trainingSessionCalories, trainingSessions[], externalActivityCalories, externalActivities[]
  - `WeeklyBudgetValidation` — isValid, totalCalories, weeklyTarget, difference, percentOfTarget

  **Core calculation:**
  - `getDietTypeSplit(dietType)` — Returns `{carb, fat}` ratio for the diet type
  - `calculateDailyMacros(dayCalories, proteinG, isTrainingDay, dietType)` — Locks protein, splits remaining by diet type ratio. Always uses base split (no training/rest adjustment)
  - `getWeeklyNutritionTargets(baselineCalories, proteinTargetG, trainingPlan, dietType)` — Builds 7-day `DailyNutritionTargets[]`. Per day: baseline + training sessions + external activities = total calories, then calculateDailyMacros on total

  **Training integration:**
  - `getTrainingDays(plan)` — Set of day names with training sessions (excludes external_activity type)
  - `getExternalActivitiesForDay(plan, day)` — Filters plan sessions by day + external_activity type
  - `calculateExternalActivityCalories(activities)` — Sums activity calories
  - `getExternalActivitiesSummary(activities)` — Returns `[{name, calories}]`

  **Calorie skewing:**
  - `validateWeeklyBudget(dayOverrides, weeklyBaselineTarget)` — Validates sum of day baselines within ±10 cal of weekly target
  - `initializeDayOverridesFromTargets(targets)` — Creates `DayCalorieOverrides` from current weekly targets (baseline portion only)
  - `applyDayOverrides(targets, overrides, dietType)` — Replaces baseline per day, recalculates total (custom baseline + training + activities), recalculates macros for total day calories

  **Unit conversions:**
  - `lbsToKg`, `kgToLbs`, `inchesToCm`, `cmToInches`, `weightToKg`, `weightFromKg`, `formatWeight`

  **Activity/protein labels:**
  - `getActivityMultiplier(level)`, `getActivityLevelLabel(level)`, `getProteinTargetLabel(gPerKg, unit)`, `getTrainingVolumeLabel(volume)`

  **Regeneration:**
  - `shouldShowRegenerationBanner(currentWeightKg, baseWeightKg)` — Returns true if |diff| >= 3kg
  - `getWeightChange(currentKg, baseKg, unitPref)` — Returns `{value, unit, isLoss}`

  ### `utils/training-calorie-helpers.ts` (109 lines)

  - `calculateWeeklyTrainingCalories(plan)` — Sums all training + external_activity estimated calories
  - `calculateDailyTrainingCalories(plan)` — Weekly ÷ 7 (rounded)
  - `getTrainingCaloriesByDay(plan)` — `Record<day, calories>` including all activity types
  - `getTrainingSessionCaloriesByDay(plan)` — `Record<day, calories>` for training sessions only
  - `getTrainingSessionsSummary(plan, day)` — `[{name, calories}]` for a specific day

  ---

  ## Validation Schemas

  ### `lib/validations/nutrition.ts` (120 lines)

  **Enums:**
  - `activityLevelSchema` — sedentary | lightly_active | moderately_active | very_active | extremely_active
  - `trainingVolumeSchema` — "0-1" | "2-3" | "4-5" | "6-7" | "8+"
  - `dietTypeSchema` — balanced | high_carb | low_carb | keto | custom
  - `unitPreferenceSchema` — metric | imperial

  **Request schemas:**
  - `nutritionPlanSchema` (POST) — workActivityLevel, proteinTargetGPerKg (1.0-3.0), dietType, goalDeadline, optional custom macros. Refine: validates macro closure if customMacrosEnabled
  - `nutritionSettingsPatchSchema` (PATCH) — unitPreference, includeActivityBurn, customDayDistribution, dayCalorieOverrides. At least one field required
  - `dayCalorieOverrideSchema` — `{calories, protein_g, carbs_g, fat_g}`
  - `dayCalorieOverridesSchema` — All 7 days

  **Validation function:**
  - `validateClientForNutrition(client)` — Checks currentWeight, BMR, gender, weightUnit present

  ---

  ## Types

  ### `types/check-in.ts` — Nutrition-related types

  ```typescript
  UnitPreference = "metric" | "imperial"
  ActivityLevel = "sedentary" | "lightly_active" | "moderately_active" | "very_active" | "extremely_active"
  TrainingVolume = "0-1" | "2-3" | "4-5" | "6-7" | "8+"
  DietType = "balanced" | "high_carb" | "low_carb" | "keto" | "custom"

  DayCalorieOverride = { calories: number, protein_g: number, carbs_g: number, fat_g: number }
  DayCalorieOverrides = Record<DayOfWeek, DayCalorieOverride>

  // Client nutrition fields:
  Client {
    unitPreference?, workActivityLevel?, trainingVolumeHours?, proteinTargetGPerKg?,
    dietType?, goalDeadline?, nutritionPlanCreatedDate?, nutritionPlanBaseWeightKg?,
    baselineCalories?, calorieTarget?, proteinTargetG?, carbTargetG?, fatTargetG?,
    includeActivityBurn, customMacrosEnabled?, customProteinG?, customCarbG?, customFatG?,
    customCalories?, customDayDistribution?, dayCalorieOverrides?
  }

  GenerateNutritionPlanRequest { workActivityLevel, proteinTargetGPerKg, dietType, ... }
  GenerateNutritionPlanResponse { success, plan: { calorieTarget, macros, warnings } }
  NutritionPlanHistory { id, clientId, createdAt, all inputs + outputs snapshot }
  ```

  ---

  ## Database Schema

  ### `clients` table — Nutrition columns

  | Column | Type | Source Migration | Purpose |
  |--------|------|-----------------|---------|
  | `unit_preference` | text | 011 | metric / imperial |
  | `work_activity_level` | text | 011 | TDEE multiplier category |
  | `training_volume_hours` | text | 011 | Training volume category |
  | `protein_target_g_per_kg` | numeric | 011 | 1.0-3.0 g/kg |
  | `diet_type` | text | 011 | balanced / high_carb / low_carb / keto / custom |
  | `goal_deadline` | date | 011 | Target date for goal weight |
  | `nutrition_plan_created_date` | timestamptz | 011 | When plan was generated |
  | `nutrition_plan_base_weight_kg` | numeric | 011 | Weight snapshot at plan creation |
  | `calorie_target` | integer | 011 | Locked daily calorie target |
  | `protein_target_g` | integer | 011 | Locked protein grams |
  | `carb_target_g` | integer | 011 | Locked carb grams |
  | `fat_target_g` | integer | 011 | Locked fat grams |
  | `custom_macros_enabled` | boolean | 011 | Manual macro override mode |
  | `custom_protein_g` | integer | 011 | Manual protein override |
  | `custom_carb_g` | integer | 011 | Manual carbs override |
  | `custom_fat_g` | integer | 011 | Manual fat override |
  | `custom_calories` | integer | 013 | Manual calories override |
  | `baseline_calories` | integer | 019 | Rest day calories (TDEE - deficit) |
  | `include_activity_burn` | boolean | 011 | Include training burn in targets |
  | `custom_day_distribution` | boolean | 041 | Enable per-day baseline overrides |
  | `day_calorie_overrides` | jsonb | 041 | Per-day calorie/macro objects |

  ### `nutrition_plan_history` table (Migration 011)

  Snapshots every plan generation: base_weight_kg, goal_weight_kg, bmr, tdee, all settings, all calculated targets, created_by_coach_id, regeneration_reason (initial / regenerated / custom_macros).

  ### `training_sessions` — Calorie columns (Migration 018)

  | Column | Type | Purpose |
  |--------|------|---------|
  | `estimated_calories` | integer | Per-session calorie burn estimate |
  | `calories_calculated_at` | timestamptz | When calories were estimated |

  ---

  ## Constants

  ### `lib/constants.ts`

  ```typescript
  CUSTOM_MACRO_CALORIE_TOLERANCE = 50      // Max cal diff for custom macro closure validation
  WEEKLY_BUDGET_ROUNDING_TOLERANCE = 10    // Max cal diff for calorie skewing budget validation
  NUTRITION_ADHERENCE_HIT_THRESHOLD = 50   // Within 50 cal of target = "hit"
  NUTRITION_ADHERENCE_PARTIAL_THRESHOLD = 200  // Within 200 cal = "partial"
  ```

  ---

  ## Mappers

  ### `lib/mappers.ts` — `mapClientRow(row: ClientRow): Client`

  Maps all nutrition DB columns to Client type fields: unitPreference, workActivityLevel, trainingVolumeHours, proteinTargetGPerKg, dietType, goalDeadline, nutritionPlanCreatedDate, nutritionPlanBaseWeightKg, baselineCalories, calorieTarget, proteinTargetG, carbTargetG, fatTargetG, customMacrosEnabled, customProteinG/CarbG/FatG, customCalories, includeActivityBurn (defaults to `true`), customDayDistribution, dayCalorieOverrides.

  ---

  ## Data Flows

  ### Flow 1: Generate Nutrition Plan

  ```
  Coach fills NutritionSettingsForm (activity level, protein, diet type, deadline)
    → clicks "Generate Plan" in NutritionSettingsDrawer
    → useNutritionBuilder.generatePlan()
    → validates client data (weight, BMR, gender)
    → POST /api/clients/{id}/nutrition
    → [Server] generateNutritionPlan():
        calculateTDEE(BMR × activity multiplier)
        calculateBaselineCalories(TDEE - deficit from goal/deadline, gender caps)
        calculateMacros(protein-first, diet type split, gender fat floor)
    → saves to clients table + nutrition_plan_history
    → returns { baselineCalories, tdee, macros, warnings }
    → client-side: toast, close drawer, SWR revalidate
    → weeklyTargets recompute from new baselineCalories
  ```

  ### Flow 2: Weekly Target Computation (runs on every render)

  ```
  useNutritionPlan computes weeklyTargets:
    1. getWeeklyNutritionTargets(baselineCalories, proteinG, trainingPlan, dietType)
       → For each of 7 days:
         totalCal = baseline + trainingSessionCal + externalActivityCal
         macros = calculateDailyMacros(totalCal, proteinG, isTrainingDay, dietType)
    2. If customDayDistribution enabled:
       applyDayOverrides(weeklyTargets, overrides, dietType)
       → Replaces baseline per day, recalculates total + macros
    3. If !includeActivityBurn:
       → Flatten all days to baselineCalories, recalculate macros on flat baseline
  ```

  ### Flow 3: Calorie Skewing

  ```
  Coach toggles "Custom day distribution" ON
    → initializeDayOverridesFromTargets(weeklyTargets)
    → creates per-day { calories, protein_g, carbs_g, fat_g } from baseline portion
    → coach edits per-day calories:
        Proportional mode: macros auto-recalculate for new calories
        Custom mode: coach manually sets P/C/F
    → WeeklyBudgetIndicator validates sum ± 10 cal of weekly baseline
    → coach clicks "Save distribution"
    → PATCH { customDayDistribution: true, dayCalorieOverrides: {...} }
    → weeklyTargets recompute with overrides applied
  Note: Regenerating a new plan resets calorie skewing
  ```

  ### Flow 4: Activity Burn Toggle

  ```
  Coach toggles "Include activity burn" OFF
    → PATCH { includeActivityBurn: false }
    → weeklyTargets map: each day flattened to baselineCalories
    → macros recalculated on baseline (no training/rest adjustment)
    → all days show identical calories + identical macro split
  Coach toggles ON
    → PATCH { includeActivityBurn: true }
    → weeklyTargets recompute with training/activity calories added per day
    → each training day gets higher total = higher absolute macros (same %)
  ```

  ### Flow 5: Client Portal Display

  ```
  Client loads Daily Pulse → nutrition section needs today's targets
    → getClientNutritionTargets(clientId) [server-side]
    → fetches client nutrition fields from DB
    → same computation chain as coach-side:
        getWeeklyNutritionTargets → applyDayOverrides → burn flattening
    → returns dailyTargets[] for all 7 days
    → Daily Pulse reads today's day target for calorie/macro display
  ```

  ---

  ## Key Design Decisions

  1. **No stored daily targets** — Daily targets are always derived at render time from baselineCalories + training plan + overrides + burn toggle. This means changing the training plan or toggling burn instantly updates all targets without migration or regeneration.

  2. **Baseline is the anchor** — Everything revolves around `baselineCalories` (TDEE - deficit). Calorie skewing redistributes baseline across days. Training burn is additive. This separation means skewing and burn are independent, composable features.

  3. **Dual computation paths** — Both coach (`use-nutrition-plan.ts`) and client (`client-portal-service.ts`) compute targets identically from the same DB fields. This avoids stale pre-computed targets but means both paths must stay in sync (both call the same utility functions).

  4. **Custom macros bypass calculations** — When `customMacrosEnabled`, the coach's exact P/C/F values are used as-is. No TDEE, no diet type split, no goal weight math. This is the escape hatch for coaches who want full manual control.

  5. **Plan history is append-only** — `nutrition_plan_history` never updates, only inserts. Each generation creates a new row with a full snapshot. This provides an immutable audit trail.
