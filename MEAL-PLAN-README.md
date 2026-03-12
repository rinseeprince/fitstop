# Meal Plan Feature -- Full Plan

## The Problem

Every competitor in the coaching space makes coaches manually enter portion sizes for meal plans. This is tedious, error-prone, and breaks every time macros change. We're building auto-portioning: coaches pick foods, the platform calculates portions to hit targets. When the nutrition plan is regenerated or macros change, portions recalculate automatically.

---

## 1. Data Model

### New Table: `foods` (shared food database)

```
foods
  id                  UUID PK
  name                TEXT NOT NULL
  brand               TEXT                          -- nullable, for branded items
  category            TEXT NOT NULL                  -- CHECK: protein, carbohydrate, fat, dairy, fruit,
                                                    --   vegetable, legume, grain, nut_seed, beverage,
                                                    --   condiment, supplement, mixed, other
  calories_per_100g   NUMERIC(6,1) NOT NULL >= 0
  protein_per_100g    NUMERIC(6,2) NOT NULL >= 0
  carbs_per_100g      NUMERIC(6,2) NOT NULL >= 0
  fat_per_100g        NUMERIC(6,2) NOT NULL >= 0
  fiber_per_100g      NUMERIC(6,2) >= 0             -- nullable
  default_serving_g   NUMERIC(6,1) NOT NULL          -- typical serving in grams (e.g. 100g chicken)
  serving_unit        TEXT NOT NULL DEFAULT 'g'      -- display unit: g, ml, piece, scoop, slice, cup, tbsp
  serving_unit_grams  NUMERIC(6,1) NOT NULL          -- how many grams = 1 serving_unit
  min_portion_g       NUMERIC(6,1) DEFAULT 10        -- solver lower bound
  max_portion_g       NUMERIC(7,1) DEFAULT 1000      -- solver upper bound
  is_global           BOOLEAN DEFAULT TRUE           -- global (seeded) vs coach-created
  created_by_coach_id UUID REFERENCES coaches(id)    -- nullable, set for coach-added foods
  is_active           BOOLEAN DEFAULT TRUE           -- soft delete
  created_at          TIMESTAMPTZ DEFAULT NOW()
  updated_at          TIMESTAMPTZ DEFAULT NOW()
```

**Indexes:**
- `idx_foods_name_search` -- GIN index on `to_tsvector('english', name || ' ' || COALESCE(brand, ''))` for full-text search
- `idx_foods_category` -- btree on `(category, is_active)`
- `idx_foods_coach` -- btree on `(created_by_coach_id)` WHERE `created_by_coach_id IS NOT NULL`

**RLS:**
- SELECT: all authenticated users can read where `is_global = true OR created_by_coach_id IN (SELECT id FROM coaches WHERE user_id = auth.uid())`
- INSERT: coaches can insert where `created_by_coach_id IN (SELECT id FROM coaches WHERE user_id = auth.uid())`
- UPDATE: coaches can update own foods where `created_by_coach_id IN (SELECT id FROM coaches WHERE user_id = auth.uid())`
- No DELETE policy (soft delete via is_active)

**Client portal RLS:** clients can SELECT where `is_global = true` OR the food appears in their active meal plan (via join chain)

### New Table: `meal_plans`

Mirrors the `training_plans` table pattern from migration 015.

```
meal_plans
  id          UUID PK
  client_id   UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE
  coach_id    UUID NOT NULL REFERENCES coaches(id)
  name        TEXT NOT NULL DEFAULT 'Meal Plan'
  status      TEXT NOT NULL DEFAULT 'active'       -- CHECK: active, archived, draft
  notes       TEXT
  created_at  TIMESTAMPTZ DEFAULT NOW()
  updated_at  TIMESTAMPTZ DEFAULT NOW()
  deleted_at  TIMESTAMPTZ                          -- soft delete
```

**Indexes:** `idx_meal_plans_client` on `(client_id, created_at DESC)`, `idx_meal_plans_status` on `(client_id, status)` WHERE `deleted_at IS NULL`

**RLS:** exact same pattern as training_plans -- coach CRUD via `client_id IN (SELECT id FROM clients WHERE coach_id = auth.uid())`, client SELECT via `client_id IN (SELECT id FROM clients WHERE user_id = auth.uid())`

**Trigger:** on INSERT, auto-generate 42 `meal_slots` rows (7 days x 6 slot types) using a plpgsql function. This follows the "scaffold then populate" pattern -- coach sees all slots immediately.

### New Table: `meal_slots`

Analogous to `training_sessions` (day-level container).

```
meal_slots
  id              UUID PK
  plan_id         UUID NOT NULL REFERENCES meal_plans(id) ON DELETE CASCADE
  day_of_week     TEXT NOT NULL              -- CHECK: monday..sunday
  slot_type       TEXT NOT NULL              -- CHECK: breakfast, morning_snack, lunch,
                                             --   afternoon_snack, dinner, evening_snack
  order_index     INTEGER NOT NULL DEFAULT 0
  name            TEXT                       -- optional custom label override
  notes           TEXT
  calorie_budget  INTEGER                    -- solver output, cached for display
  protein_budget_g INTEGER
  carbs_budget_g  INTEGER
  fat_budget_g    INTEGER
  created_at      TIMESTAMPTZ DEFAULT NOW()
  updated_at      TIMESTAMPTZ DEFAULT NOW()

  UNIQUE (plan_id, day_of_week, slot_type)
```

**Indexes:** `idx_meal_slots_plan` on `(plan_id, day_of_week, order_index)`

**RLS:** chained through meal_plans, same pattern as training_sessions -> training_plans

### New Table: `meal_slot_foods`

Analogous to `training_exercises` (individual items within a slot).

```
meal_slot_foods
  id              UUID PK
  slot_id         UUID NOT NULL REFERENCES meal_slots(id) ON DELETE CASCADE
  food_id         UUID NOT NULL REFERENCES foods(id)
  order_index     INTEGER NOT NULL DEFAULT 0
  portion_g       NUMERIC(7,1)               -- solver-calculated portion in grams
  portion_locked  BOOLEAN DEFAULT FALSE      -- when true, solver skips this food
  locked_portion_g NUMERIC(7,1)              -- coach-set manual portion (used when locked)
  notes           TEXT
  created_at      TIMESTAMPTZ DEFAULT NOW()
  updated_at      TIMESTAMPTZ DEFAULT NOW()
```

**Indexes:** `idx_meal_slot_foods_slot` on `(slot_id, order_index)`

**RLS:** chained through meal_slots -> meal_plans, same pattern as training_exercises

### New Table: `meal_templates`

Reusable meal configurations for coaches.

```
meal_templates
  id          UUID PK
  coach_id    UUID NOT NULL REFERENCES coaches(id)
  name        TEXT NOT NULL
  slot_type   TEXT                        -- nullable, for filtering by meal type
  foods       JSONB NOT NULL              -- [{food_id, order_index, default_portion_g}]
  is_active   BOOLEAN DEFAULT TRUE        -- soft delete
  created_at  TIMESTAMPTZ DEFAULT NOW()
  updated_at  TIMESTAMPTZ DEFAULT NOW()
```

**RLS:** coach CRUD on own templates via `coach_id IN (SELECT id FROM coaches WHERE user_id = auth.uid())`

### Migration Files

- `042_add_food_database.sql` -- foods table, indexes, RLS, updated_at trigger
- `043_add_meal_plan_tables.sql` -- meal_plans, meal_slots, meal_slot_foods, meal_templates, all indexes, RLS, triggers, auto-scaffold function
- `044_seed_common_foods.sql` -- ~80 common foods (chicken breast, salmon, eggs, Greek yogurt, whey protein, oats, rice, sweet potato, quinoa, banana, apple, broccoli, spinach, avocado, olive oil, almonds, peanut butter, etc.)

---

## 2. Auto-Portioning Solver

### Location

`utils/meal-portion-solver.ts` -- pure functions, no side effects, no I/O. Runs client-side in the builder hook for instant feedback. Also runs server-side in `client-portal-service.ts` for pre-calculated client view.

### Meal Budget Distribution

Before solving individual meals, the daily macro budget must be split across the 6 meal slots. Function: `distributeDailyBudget()`.

**Default distribution** (stored in `lib/constants.ts` as `DEFAULT_MEAL_DISTRIBUTION`):

| Slot | Calorie % | Protein % |
|------|-----------|-----------|
| Breakfast | 25% | 25% |
| Morning Snack | 5% | 5% |
| Lunch | 30% | 30% |
| Afternoon Snack | 5% | 5% |
| Dinner | 30% | 30% |
| Evening Snack | 5% | 5% |

Carbs and fat are derived from remaining calories after protein allocation using `getDietTypeSplit()` from `utils/nutrition-helpers.ts`. Empty slots (no foods) have their budget redistributed proportionally to slots that have foods.

**Input:** `DailyNutritionTargets` (from existing `useNutritionPlan` hook) + which slots have foods.
**Output:** `Map<MealSlotType, MealMacroTarget>` where `MealMacroTarget = { calories, proteinG, carbsG, fatG }`.

### Portion Solving Algorithm

**Function:** `solveMealPortions(foods, target) -> PortionSolution`

Protein-first sequential allocation (matches the existing nutrition system's protein-first philosophy from `calculateDailyMacros()` in `nutrition-helpers.ts`):

**Step 1 -- Subtract locked portions.**
For any food with `portionLocked = true`, calculate its macro contribution at `lockedPortionG` and subtract from the target budget. Remove from the solvable set.

**Step 2 -- Classify remaining foods by dominant macro.**
Each food is tagged as `protein`, `carb`, `fat`, or `mixed` based on which macro contributes the highest calorie percentage:
- Protein-dominant: `(proteinPer100g * 4) / caloriesPer100g > 0.4`
- Carb-dominant: `(carbsPer100g * 4) / caloriesPer100g > 0.5`
- Fat-dominant: `(fatPer100g * 9) / caloriesPer100g > 0.5`
- Otherwise: mixed

**Step 3 -- Protein pass.**
Target: remaining protein budget (grams).
Distribute across protein-dominant foods proportionally to their `proteinPer100g` density:
```
portionG = (foodProteinDensity / sumProteinDensities) * targetProteinG * (100 / food.proteinPer100g)
```
Clamp each portion to `[minPortionG, maxPortionG]`. Subtract all macro contributions (cal/p/c/f) from remaining budget.

**Step 4 -- Carb pass.**
Same approach for carb-dominant foods against the remaining carb budget.

**Step 5 -- Fat pass.**
Same approach for fat-dominant foods against the remaining fat budget.

**Step 6 -- Mixed food adjustment.**
For any remaining mixed foods, allocate portions based on remaining calorie budget:
```
portionG = (remainingCalories / numMixedFoods) * (100 / food.caloriesPer100g)
```
Clamp to bounds.

**Step 7 -- Calorie reconciliation.**
After all passes, calculate total calories. If off by more than `MEAL_SOLVER_CALORIE_TOLERANCE` (20 cal), scale all non-locked portions proportionally within their min/max bounds. Single iteration is sufficient.

**Step 8 -- Round.**
Round all portions to nearest `MEAL_PORTION_ROUNDING_G` (5g) for practical serving sizes. Ensure rounding doesn't push below minimum.

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| Single food meal | Trivial: `portionG = (targetCalories / caloriesPer100g) * 100` |
| All portions locked | No solving, just report totals vs target |
| Impossible combination | Return closest feasible solution + `warnings[]` explaining the gap (e.g. "Cannot hit protein target -- all foods are fat-dominant") |
| Zero remaining budget | Return minimum portions + warning "Daily budget consumed by other meals" |
| No foods in slot | Skip slot, return empty solution |
| Food with 0 calories | Skip food (supplement/water), add warning |

### Return Type

```typescript
type PortionSolution = {
  portions: Array<{ foodId: string; portionG: number; isLocked: boolean }>;
  totals: MealMacroTarget;
  targets: MealMacroTarget;
  accuracy: {
    caloriePercent: number;   // e.g. 98.5 means 98.5% of target
    proteinPercent: number;
    carbPercent: number;
    fatPercent: number;
  };
  warnings: string[];
  isFeasible: boolean;        // false when accuracy on any macro < 90%
};
```

### When the Solver Runs

1. **Coach builder (client-side):** Runs in `useMealPlanBuilder` hook via `useMemo` whenever `weeklyTargets` or meal plan foods change. Instant feedback as coach adds/removes foods.
2. **Nutrition plan regeneration:** When `useNutritionBuilder.generatePlan()` succeeds, it calls `mutate('/api/clients/${id}/meal-plan')` which triggers SWR refetch, which triggers the solver via the `weeklyTargets` dependency.
3. **Client portal (server-side):** `getClientMealPlan()` runs the solver once per request to return pre-calculated portions.

---

## 3. TypeScript Types

### New File: `types/meal-plan.ts`

```typescript
// Enums
export type FoodCategory =
  | 'protein' | 'carbohydrate' | 'fat' | 'dairy' | 'fruit'
  | 'vegetable' | 'legume' | 'grain' | 'nut_seed' | 'beverage'
  | 'condiment' | 'supplement' | 'mixed' | 'other';

export type MealSlotType =
  | 'breakfast' | 'morning_snack' | 'lunch'
  | 'afternoon_snack' | 'dinner' | 'evening_snack';

export type MealPlanStatus = 'active' | 'archived' | 'draft';

// Domain types
export type Food = {
  id: string;
  name: string;
  brand?: string;
  category: FoodCategory;
  caloriesPer100g: number;
  proteinPer100g: number;
  carbsPer100g: number;
  fatPer100g: number;
  fiberPer100g?: number;
  defaultServingG: number;
  servingUnit: string;
  servingUnitGrams: number;
  minPortionG: number;
  maxPortionG: number;
  isGlobal: boolean;
  createdByCoachId?: string;
  isActive: boolean;
};

export type MealSlotFood = {
  id: string;
  slotId: string;
  foodId: string;
  food: Food;               // joined from foods table
  orderIndex: number;
  portionG: number | null;  // solver output
  portionLocked: boolean;
  lockedPortionG: number | null;
  notes?: string;
};

export type MealSlot = {
  id: string;
  planId: string;
  dayOfWeek: string;
  slotType: MealSlotType;
  orderIndex: number;
  name?: string;
  notes?: string;
  calorieBudget?: number;
  proteinBudgetG?: number;
  carbsBudgetG?: number;
  fatBudgetG?: number;
  foods: MealSlotFood[];
};

export type MealPlan = {
  id: string;
  clientId: string;
  coachId: string;
  name: string;
  status: MealPlanStatus;
  notes?: string;
  slots: MealSlot[];
  createdAt: string;
  updatedAt: string;
};

export type MealTemplate = {
  id: string;
  coachId: string;
  name: string;
  slotType?: MealSlotType;
  foods: Array<{ foodId: string; orderIndex: number; defaultPortionG: number }>;
  isActive: boolean;
};

// Solver types
export type MealMacroTarget = {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
};

export type PortionSolution = {
  portions: Array<{ foodId: string; portionG: number; isLocked: boolean }>;
  totals: MealMacroTarget;
  targets: MealMacroTarget;
  accuracy: {
    caloriePercent: number;
    proteinPercent: number;
    carbPercent: number;
    fatPercent: number;
  };
  warnings: string[];
  isFeasible: boolean;
};

// API request types
export type CreateMealPlanRequest = {
  name?: string;
  notes?: string;
};

export type AddMealSlotFoodRequest = {
  foodId: string;
  portionLocked?: boolean;
  lockedPortionG?: number;
};

export type UpdateMealSlotFoodRequest = {
  portionLocked?: boolean;
  lockedPortionG?: number;
  notes?: string;
  orderIndex?: number;
};

export type SaveTemplateRequest = {
  name: string;
  slotType?: MealSlotType;
  slotId: string;
};

export type ApplyTemplateRequest = {
  templateId: string;
  dayOfWeek: string;
  slotType: MealSlotType;
};
```

---

## 4. Validation Schemas

### New File: `lib/validations/meal-plan.ts`

Following the pattern in `lib/validations/nutrition.ts`:

```typescript
// Enums
export const foodCategorySchema = z.enum([...]);
export const mealSlotTypeSchema = z.enum([...]);
export const mealPlanStatusSchema = z.enum(['active', 'archived', 'draft']);

// Food CRUD
export const createFoodSchema = z.object({
  name: z.string().min(1).max(200),
  brand: z.string().max(200).optional(),
  category: foodCategorySchema,
  caloriesPer100g: z.number().nonnegative(),
  proteinPer100g: z.number().nonnegative(),
  carbsPer100g: z.number().nonnegative(),
  fatPer100g: z.number().nonnegative(),
  fiberPer100g: z.number().nonnegative().optional(),
  defaultServingG: z.number().positive(),
  servingUnit: z.string().min(1).max(20),
  servingUnitGrams: z.number().positive(),
  minPortionG: z.number().positive().default(10),
  maxPortionG: z.number().positive().default(1000),
}).refine(
  // Macro calories should roughly match stated calories (within 15%)
  (d) => {
    const macroCal = d.proteinPer100g * 4 + d.carbsPer100g * 4 + d.fatPer100g * 9;
    return Math.abs(macroCal - d.caloriesPer100g) <= d.caloriesPer100g * 0.15;
  },
  { message: 'Macro calories do not match stated calories' }
);

// Meal plan CRUD
export const createMealPlanSchema = z.object({
  name: z.string().max(100).optional(),
  notes: z.string().max(500).optional(),
});

// Food-in-slot operations
export const addFoodToSlotSchema = z.object({
  foodId: z.string().uuid(),
  portionLocked: z.boolean().optional(),
  lockedPortionG: z.number().positive().optional(),
});

export const updateSlotFoodSchema = z.object({
  portionLocked: z.boolean().optional(),
  lockedPortionG: z.number().positive().optional(),
  notes: z.string().max(500).optional(),
  orderIndex: z.number().int().nonnegative().optional(),
}).refine(d => Object.keys(d).length > 0, { message: 'At least one field required' });

// Food search
export const foodSearchSchema = z.object({
  query: z.string().min(1).max(100),
  category: foodCategorySchema.optional(),
  limit: z.number().int().min(1).max(50).default(20),
});

// Templates
export const saveTemplateSchema = z.object({
  name: z.string().min(1).max(100),
  slotType: mealSlotTypeSchema.optional(),
  slotId: z.string().uuid(),
});

export const applyTemplateSchema = z.object({
  templateId: z.string().uuid(),
  dayOfWeek: z.enum(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']),
  slotType: mealSlotTypeSchema,
});
```

---

## 5. API Routes

All routes follow existing conventions: rate limiting as first operation, Zod validation, `{ success, data, error }` response format, `supabaseAdmin` for server operations.

### Food Database

| Route | Method | Purpose | Rate Limit |
|-------|--------|---------|------------|
| `app/api/foods/route.ts` | GET | Search foods by name/category (full-text) | coachApiRateLimit |
| `app/api/foods/route.ts` | POST | Create a new coach food | coachApiRateLimit |
| `app/api/foods/[id]/route.ts` | PATCH | Update a coach-created food | coachApiRateLimit |

**GET /api/foods** query params: `?query=chicken&category=protein&limit=20`
- Uses `to_tsvector` search on `name || brand`
- Returns foods sorted by relevance, limited to `DEFAULT_FOOD_SEARCH_LIMIT`
- Includes both global and coach's own foods

### Meal Plan (Coach-side)

| Route | Method | Purpose | Rate Limit |
|-------|--------|---------|------------|
| `app/api/clients/[id]/meal-plan/route.ts` | GET | Get active meal plan with nested slots/foods | coachApiRateLimit |
| `app/api/clients/[id]/meal-plan/route.ts` | POST | Create new meal plan (auto-scaffolds 42 slots) | coachApiRateLimit |
| `app/api/clients/[id]/meal-plan/route.ts` | DELETE | Soft-delete meal plan (sets deleted_at) | coachApiRateLimit |
| `app/api/clients/[id]/meal-plan/slots/[slotId]/foods/route.ts` | POST | Add food to a meal slot | coachApiRateLimit |
| `app/api/clients/[id]/meal-plan/slots/[slotId]/foods/[foodId]/route.ts` | PATCH | Update food (lock portion, reorder, notes) | coachApiRateLimit |
| `app/api/clients/[id]/meal-plan/slots/[slotId]/foods/[foodId]/route.ts` | DELETE | Remove food from slot | coachApiRateLimit |

### Templates (Coach-side)

| Route | Method | Purpose | Rate Limit |
|-------|--------|---------|------------|
| `app/api/clients/[id]/meal-plan/templates/route.ts` | GET | List coach's meal templates | coachApiRateLimit |
| `app/api/clients/[id]/meal-plan/templates/route.ts` | POST | Save a slot as a reusable template | coachApiRateLimit |
| `app/api/clients/[id]/meal-plan/templates/[templateId]/apply/route.ts` | POST | Apply template to a day/slot | coachApiRateLimit |

### Client Portal

| Route | Method | Purpose | Rate Limit |
|-------|--------|---------|------------|
| `app/api/client/meal-plan/route.ts` | GET | Get own meal plan with pre-solved portions | clientApiRateLimit |

---

## 6. Hooks

### `hooks/use-food-search.ts` (~80 lines)

Debounced food search for the builder UI.

```typescript
export function useFoodSearch(query: string, category?: FoodCategory) {
  // Debounce query by 300ms
  // SWR fetch: GET /api/foods?query=...&category=...
  // SWR config: revalidateOnFocus: false, dedupingInterval: 2000
  // Returns: { foods: Food[], isLoading, error }
}
```

### `hooks/use-meal-plan-builder.ts` (~250 lines)

The primary coach-side hook. Owns all meal plan state.

```typescript
export function useMealPlanBuilder({
  client,
  weeklyTargets,    // from useNutritionPlan
  dietType,
  onUpdate,
}) {
  // SWR: fetch active meal plan (GET /api/clients/{id}/meal-plan)
  // Computed: solvedPortions (Map<slotId, PortionSolution>) via useMemo
  //   - Runs distributeDailyBudget() then solveMealPortions() per slot
  //   - Recalculates when weeklyTargets or mealPlan.slots change
  // Computed: dailySummaries (Map<DayOfWeek, MealMacroTarget>) -- sum of all slot solutions per day
  //
  // Actions (all optimistic update + API call + revalidate):
  //   createPlan()        -- POST, initializes SWR
  //   addFood(slotId, foodId)
  //   removeFood(slotId, foodItemId)
  //   togglePortionLock(slotId, foodItemId)
  //   setLockedPortion(slotId, foodItemId, grams)
  //   reorderFoods(slotId, foodItemIds[])
  //   archivePlan()
  //
  // Returns: { mealPlan, solvedPortions, dailySummaries, isLoading,
  //            createPlan, addFood, removeFood, togglePortionLock,
  //            setLockedPortion, reorderFoods, archivePlan }
}
```

### `hooks/use-meal-templates.ts` (~80 lines)

```typescript
export function useMealTemplates(clientId: string) {
  // SWR: fetch templates (GET /api/clients/{id}/meal-plan/templates)
  // Actions:
  //   saveAsTemplate(slotId, name, slotType?)
  //   applyTemplate(templateId, dayOfWeek, slotType)
  //   deleteTemplate(id) -- soft delete via is_active
  // Returns: { templates, saveAsTemplate, applyTemplate, deleteTemplate }
}
```

---

## 7. Services

### `services/food-service.ts` (~120 lines)

Server-side food database operations.

```typescript
export async function searchFoods(
  query: string, category?: FoodCategory, limit?: number, coachId?: string
): Promise<Food[]>
// Full-text search via to_tsvector, returns global + coach's own foods

export async function createFood(
  coachId: string, data: CreateFoodInput
): Promise<Food>

export async function updateFood(
  foodId: string, coachId: string, data: Partial<CreateFoodInput>
): Promise<Food>
// Verifies coach owns the food before updating
```

### `services/meal-plan-service.ts` (~200 lines)

Server-side meal plan CRUD.

```typescript
export async function getActiveMealPlan(clientId: string): Promise<MealPlan | null>
// Nested Supabase select: meal_plans -> meal_slots -> meal_slot_foods -> foods
// Filters: status = 'active', deleted_at IS NULL
// Uses mappers for row -> type conversion

export async function createMealPlan(
  clientId: string, coachId: string, data: CreateMealPlanRequest
): Promise<MealPlan>
// Archives any existing active plan first (soft delete)
// Inserts meal_plan row; DB trigger auto-scaffolds 42 slots
// Returns the new plan with empty slots

export async function addFoodToSlot(
  slotId: string, foodId: string, data?: Partial<AddMealSlotFoodRequest>
): Promise<MealSlotFood>

export async function removeFoodFromSlot(foodItemId: string): Promise<void>

export async function updateSlotFood(
  foodItemId: string, updates: UpdateMealSlotFoodRequest
): Promise<MealSlotFood>

export async function softDeleteMealPlan(planId: string): Promise<void>
// Sets deleted_at, does NOT hard delete
```

### Additions to `services/client-portal-service.ts`

```typescript
export async function getClientMealPlan(clientId: string): Promise<MealPlanWithPortions | null>
// 1. Fetches active meal plan (nested select like coach-side)
// 2. Fetches nutrition targets via existing getClientNutritionTargets()
// 3. Runs distributeDailyBudget() + solveMealPortions() per slot (server-side)
// 4. Returns plan with pre-calculated portions
```

---

## 8. Components

### Coach-side: `components/clients/meal-plan/`

Component hierarchy (parent -> children):

```
meal-plan-builder.tsx (40 lines)
  Entry point wrapper, context provider
  Lives as sub-tab under Nutrition section
  Passes weeklyTargets from useNutritionPlan to useMealPlanBuilder
  |
  +-- meal-plan-header.tsx (80 lines)
  |     Plan name, status badge, "Create Plan" / "Archive" actions
  |     Empty state when no plan exists
  |
  +-- meal-plan-week-view.tsx (60 lines)
  |     7-day horizontal scroll or tab navigation
  |     Matches weekly-nutrition-view.tsx grid pattern
  |     |
  |     +-- meal-plan-day-column.tsx (120 lines)
  |     |     Single day column with 6 meal slot cards stacked
  |     |     Shows day name + training day badge
  |     |     |
  |     |     +-- meal-slot-card.tsx (150 lines)
  |     |     |     Slot label (Breakfast, Lunch, etc.)
  |     |     |     Food list, "Add Food" button
  |     |     |     Slot macro totals vs budget progress bars
  |     |     |     "Save as Template" action
  |     |     |     |
  |     |     |     +-- meal-slot-food-row.tsx (100 lines)
  |     |     |     |     Food name, calculated portion (serving units + grams)
  |     |     |     |     Lock/unlock toggle icon (Lock/Unlock from Lucide)
  |     |     |     |     Locked portion input (when locked)
  |     |     |     |     Remove button, drag handle for reorder
  |     |     |     |
  |     |     |     +-- food-search-popover.tsx (120 lines)
  |     |     |           Popover trigger on "Add Food" button
  |     |     |           Search input with debounce
  |     |     |           Category filter chips
  |     |     |           Results list with food name, macros per 100g, category badge
  |     |     |           Click to add food to slot
  |     |     |
  |     |     +-- day-macro-summary.tsx (80 lines)
  |     |           Horizontal bar showing day totals vs DailyNutritionTargets
  |     |           Color-coded: green (within 5%), yellow (5-15%), red (>15%)
  |     |           Shows cal/protein/carbs/fat in 4 mini progress bars
  |
  +-- meal-template-drawer.tsx (150 lines)
        Right-side Sheet (matches nutrition-settings-drawer pattern)
        Browse saved templates by meal type
        Preview template contents
        Apply to specific day/slot
        Delete template
```

### Client-side: `components/client-portal/meal-plan/`

```
client-meal-plan-view.tsx (100 lines)
  Day tabs/selector (today highlighted)
  |
  +-- client-meal-day-view.tsx (80 lines)
  |     Vertical stack of meal slots for selected day
  |     Day summary header with total macros
  |     |
  |     +-- client-meal-slot-card.tsx (100 lines)
  |     |     Meal label + time suggestion
  |     |     Expandable food list (accordion pattern from nutrition-day-accordion)
  |     |     Slot macro summary
  |     |     |
  |     |     +-- client-food-item.tsx (60 lines)
  |     |           Food name
  |     |           Portion in serving units (e.g. "150g" or "2 scoops")
  |     |           Macro breakdown (cal/p/c/f) in muted text
```

---

## 9. Changes to Existing Files

| File | Change |
|------|--------|
| `types/database.ts` | Regenerate from Supabase to include foods, meal_plans, meal_slots, meal_slot_foods, meal_templates Row/Insert/Update types |
| `lib/mappers.ts` | Add `mapFoodRow()`, `mapMealPlanRow()`, `mapMealSlotRow()`, `mapMealSlotFoodRow()` mapper functions (following `mapClientRow()` pattern) |
| `lib/constants.ts` | Add `MEAL_PORTION_ROUNDING_G = 5`, `MEAL_SOLVER_CALORIE_TOLERANCE = 20`, `DEFAULT_FOOD_SEARCH_LIMIT = 20`, `DEFAULT_MEAL_DISTRIBUTION` object, `MEAL_SLOT_TYPES` array, `FOOD_CATEGORIES` array |
| `hooks/use-nutrition-builder.ts` | After `generatePlan()` success (in the existing `onUpdate` callback area), add `mutate('/api/clients/${client.id}/meal-plan')` to trigger meal plan SWR refetch, which cascades to portion re-solve |
| Nutrition tab component | Add "Meal Plan" sub-tab that renders `<MealPlanBuilder>`, passing `weeklyTargets` from `useNutritionPlan` |
| `services/client-portal-service.ts` | Add `getClientMealPlan()` function |
| `app/client/nutrition/page.tsx` (or equivalent) | Add meal plan section that fetches and renders `<ClientMealPlanView>` |

---

## 10. Client Portal Integration

### Data Flow

```
Client opens nutrition page
  -> fetch GET /api/client/meal-plan
  -> API handler authenticates, gets clientId
  -> Calls getClientMealPlan(clientId) which:
     1. Fetches active meal plan (nested select: plan -> slots -> foods)
     2. Fetches nutrition targets via getClientNutritionTargets() [existing]
     3. For each day with foods:
        a. Calls distributeDailyBudget(dailyTarget, slotsWithFoods)
        b. For each slot with foods:
           Calls solveMealPortions(slotFoods, slotBudget)
     4. Returns MealPlan with solved portions embedded
  -> Client renders <ClientMealPlanView>
```

### Portion Display

Portions are displayed in the food's `servingUnit` for readability:
- `portionG / servingUnitGrams` = number of serving units
- Display: "150g chicken breast" or "1.5 cups rice" or "2 scoops whey"
- Always show grams in parentheses for precision: "1.5 cups (195g)"

### Auto-Recalculation

When the coach regenerates the nutrition plan:
1. Coach clicks "Generate Plan" in nutrition settings
2. `useNutritionBuilder.generatePlan()` -> POST /api/clients/[id]/nutrition
3. On success, existing `onUpdate` callback fires
4. New code: `mutate('/api/clients/${client.id}/meal-plan')` added to this callback
5. SWR refetches meal plan data
6. `useMealPlanBuilder` hook's `useMemo` detects `weeklyTargets` changed
7. Solver reruns with new targets, UI updates with new portions
8. No API call needed for re-solving -- it's pure client-side computation

Client portal sees updated portions on next page load (server-side solve always uses latest targets).

---

## 11. Phased Implementation Order

### Phase 1 -- Foundation

Data model, solver algorithm, food database, core API. No UI yet.

| # | File | Type | Lines Est. |
|---|------|------|------------|
| 1 | `supabase/migrations/042_add_food_database.sql` | Migration | 60 |
| 2 | `supabase/migrations/043_add_meal_plan_tables.sql` | Migration | 150 |
| 3 | `supabase/migrations/044_seed_common_foods.sql` | Migration | 200 |
| 4 | `types/meal-plan.ts` | Types | 120 |
| 5 | `lib/validations/meal-plan.ts` | Validation | 100 |
| 6 | `lib/constants.ts` | Constants | +15 |
| 7 | `lib/mappers.ts` | Mappers | +60 |
| 8 | `utils/meal-portion-solver.ts` | Solver | 150 |
| 9 | `services/food-service.ts` | Service | 120 |
| 10 | `services/meal-plan-service.ts` | Service | 200 |
| 11 | `app/api/foods/route.ts` | API | 120 |
| 12 | `app/api/foods/[id]/route.ts` | API | 80 |
| 13 | `app/api/clients/[id]/meal-plan/route.ts` | API | 180 |
| 14 | `app/api/clients/[id]/meal-plan/slots/[slotId]/foods/route.ts` | API | 80 |
| 15 | `app/api/clients/[id]/meal-plan/slots/[slotId]/foods/[foodId]/route.ts` | API | 100 |
| 16 | `types/database.ts` | Types | regenerate |

**Verification:** `npx tsc --noEmit && npx vitest run`

### Phase 2 -- Coach Builder UI

Hooks, components, template system. Coach can build and manage meal plans.

| # | File | Type | Lines Est. |
|---|------|------|------------|
| 1 | `hooks/use-food-search.ts` | Hook | 80 |
| 2 | `hooks/use-meal-plan-builder.ts` | Hook | 250 |
| 3 | `hooks/use-meal-templates.ts` | Hook | 80 |
| 4 | `components/clients/meal-plan/meal-plan-builder.tsx` | Component | 40 |
| 5 | `components/clients/meal-plan/meal-plan-header.tsx` | Component | 80 |
| 6 | `components/clients/meal-plan/meal-plan-week-view.tsx` | Component | 60 |
| 7 | `components/clients/meal-plan/meal-plan-day-column.tsx` | Component | 120 |
| 8 | `components/clients/meal-plan/meal-slot-card.tsx` | Component | 150 |
| 9 | `components/clients/meal-plan/meal-slot-food-row.tsx` | Component | 100 |
| 10 | `components/clients/meal-plan/food-search-popover.tsx` | Component | 120 |
| 11 | `components/clients/meal-plan/day-macro-summary.tsx` | Component | 80 |
| 12 | `components/clients/meal-plan/meal-template-drawer.tsx` | Component | 150 |
| 13 | `app/api/clients/[id]/meal-plan/templates/route.ts` | API | 120 |
| 14 | `app/api/clients/[id]/meal-plan/templates/[templateId]/apply/route.ts` | API | 100 |
| 15 | `hooks/use-nutrition-builder.ts` | Modify | +5 |
| 16 | Nutrition tab component | Modify | +20 |

**Verification:** `npx tsc --noEmit && npx vitest run` + manual test: add foods, verify portions auto-calculate, regenerate nutrition plan, verify portions update

### Phase 3 -- Client Portal

Client-facing meal plan view with pre-solved portions.

| # | File | Type | Lines Est. |
|---|------|------|------------|
| 1 | `app/api/client/meal-plan/route.ts` | API | 80 |
| 2 | `services/client-portal-service.ts` | Modify | +40 |
| 3 | `components/client-portal/meal-plan/client-meal-plan-view.tsx` | Component | 100 |
| 4 | `components/client-portal/meal-plan/client-meal-day-view.tsx` | Component | 80 |
| 5 | `components/client-portal/meal-plan/client-meal-slot-card.tsx` | Component | 100 |
| 6 | `components/client-portal/meal-plan/client-food-item.tsx` | Component | 60 |
| 7 | `app/client/nutrition/page.tsx` | Modify | +15 |

**Verification:** `npx tsc --noEmit && npx vitest run` + manual test: create meal plan as coach, view as client, regenerate nutrition plan as coach, verify client sees updated portions
