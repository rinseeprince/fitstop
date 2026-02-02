# Nutrition Plan Calculator - Feature Documentation

## Table of Contents
1. [Overview](#overview)
2. [Key Features](#key-features)
3. [How It Works](#how-it-works)
4. [Using the Feature](#using-the-feature)
5. [Calculations Explained](#calculations-explained)
6. [Settings Reference](#settings-reference)
7. [Warnings & Safety](#warnings--safety)
8. [Technical Implementation](#technical-implementation)
9. [API Reference](#api-reference)

---

## Overview

The Nutrition Plan Calculator is an intelligent, evidence-based tool for generating personalized nutrition plans for clients. It automatically calculates calorie targets and macronutrient distributions based on individual metabolic needs, activity levels, training volume, and fitness goals.

### What It Does
- **Calculates BMR** using AI-powered analysis (with scientific formula fallback)
- **Determines TDEE** based on work activity and training volume
- **Sets calorie targets** aligned with weight goals and timelines
- **Distributes macros** using a protein-first approach
- **Monitors weight changes** and triggers regeneration alerts
- **Tracks history** of all plan changes with audit trail
- **Enforces safety** through validation rules and warnings

### Who Should Use It
- **Coaches** creating nutrition plans for clients
- **Trainers** managing client macros
- **Nutritionists** providing evidence-based guidance

---

## Key Features

### 1. Intelligent BMR Calculation
The system uses **two methods** to calculate Basal Metabolic Rate:

**Primary Method (AI-Powered)**:
- Uses OpenAI GPT-4o-mini for analysis
- Considers: weight, height, age, gender, body fat %
- Applies Katch-McArdle formula when body fat % available
- Provides detailed explanation of calculations

**Fallback Method (Mifflin-St Jeor)**:
- Industry-standard formula
- Gender-specific calculations
- Activates if AI service unavailable
- Proven accuracy across populations

### 2. Activity & Training Adjustments
The calculator considers **two activity factors**:

**Work Activity Level** (Multiplier on BMR):
- Sedentary: 1.2x (desk job)
- Lightly Active: 1.375x (some movement)
- Moderately Active: 1.55x (on feet most of day)
- Very Active: 1.725x (physical job)
- Extremely Active: 1.9x (athlete/heavy labor)

**Training Volume** (Additional Calories):
- 0-1 hours/week: +0 cal
- 2-3 hours/week: +250 cal
- 4-5 hours/week: +400 cal
- 6-7 hours/week: +550 cal
- 8+ hours/week: +700 cal

### 3. Goal-Based Calorie Targeting
Automatically adjusts calories based on:
- **Current vs Goal Weight**: Calculates needed change
- **Timeline (Optional)**: Uses deadline to pace weight change
- **Safety Caps**: Gender-specific weekly change limits
  - Males: Max 1.0kg/week deficit, 0.5kg/week surplus
  - Females: Max 0.75kg/week deficit, 0.35kg/week surplus
- **Minimum Floors**: 1500 cal (males), 1200 cal (females)

### 4. Smart Macro Distribution
Uses a **protein-first approach**:

**Step 1**: Set protein based on target (1.0-3.0 g/kg bodyweight)

**Step 2**: Split remaining calories between carbs/fat based on diet type:
- **Balanced**: 50% carbs / 50% fat (default)
- **High Carb**: 65% carbs / 35% fat (endurance athletes)
- **Low Carb**: 25% carbs / 75% fat (fat-adapted)
- **Keto**: 10% carbs / 90% fat (ketogenic)
- **Custom**: Manual override enabled

**Step 3**: Apply safety minimums:
- Females: Minimum 25% calories from fat
- Males: Minimum 20% calories from fat

### 5. Weight Change Monitoring
Automatically detects significant weight changes:
- **Threshold**: 3kg (≈6.6 lbs) from baseline
- **Alert**: Amber banner in client profile and check-in reviews
- **Action**: "Regenerate Nutrition Plan" button
- **Tracking**: Before → After weight comparison shown

### 6. Complete History Tracking
Every plan generation creates a history entry recording:
- Date and time of creation
- Settings used (activity, training, protein, diet, deadline)
- Metrics at creation (weight, BMR, TDEE)
- Calculated targets (calories, macros)
- Reason for generation (initial, regenerated, weight change, custom)
- Coach who created it

### 7. Dual Unit System
Supports both **Metric** and **Imperial** units:
- **Metric**: kg, cm, g/kg
- **Imperial**: lbs, inches, g/lb
- **Client-Level**: Each client has own preference
- **Conversion**: Automatic, all displays update
- **Storage**: Always in metric internally

---

## How It Works

### The Calculation Flow

```
1. Client Profile Setup
   ↓
   - Weight, height, age, gender entered
   - BMR calculated (AI or formula)
   - TDEE baseline set (BMR × 1.2)

2. Nutrition Settings Input
   ↓
   - Work activity level selected
   - Training volume specified
   - Protein target chosen
   - Diet type selected
   - Goal deadline set (optional)

3. Plan Generation
   ↓
   - Adjusted TDEE = (BMR × Activity) + Training
   - Calorie Target = Adjusted TDEE + Goal Adjustment
   - Protein = Weight × Protein Target
   - Carbs/Fat = Remaining calories split by diet type
   - Safety checks applied
   - Warnings collected

4. Plan Locked & Saved
   ↓
   - Targets saved to client record
   - Baseline weight locked
   - History entry created
   - Plan displayed with warnings

5. Ongoing Monitoring
   ↓
   - Check-ins update current weight
   - Comparison with baseline weight
   - Regeneration alert if 3kg+ change
   - Coach regenerates when needed
```

### When to Regenerate

**Automatic Alerts Trigger When**:
- Client weight changes by 3kg+ from baseline
- Banner appears in client profile
- Banner appears in check-in review Goal Progress tab

**Manual Regeneration When**:
- Client's goals change
- Activity level significantly changes
- Training volume increases/decreases
- Switching diet types
- Progress has stalled
- Coach wants to adjust approach

---

## Using the Feature

### Initial Setup

#### Step 1: Calculate BMR (One-Time Setup)
1. Navigate to Client Profile
2. Ensure client has:
   - Current weight ✓
   - Height ✓
   - Gender ✓
   - Date of birth (optional, for age)
3. Click **"Calculate BMR"** button in Profile tab
4. Wait 2-3 seconds for AI calculation
5. BMR and TDEE displayed in metrics

#### Step 2: Generate First Nutrition Plan
1. Navigate to **Nutrition** tab in client profile
2. Review current metrics displayed at top
3. Configure settings (see [Settings Reference](#settings-reference)):
   - **Work Activity Level**: Select based on daily work
   - **Training Volume**: Estimate weekly training hours
   - **Protein Target**: Default 2.0 g/kg recommended
   - **Diet Type**: Choose based on client preference
   - **Goal Deadline** (optional): Set target date for goal weight
4. Click **"Generate Nutrition Plan"**
5. Review calculated plan:
   - Calorie target
   - Protein, carbs, fat (in grams)
   - Visual breakdown with progress bars
6. Check warnings (if any) in amber alert box
7. Plan is now active and locked to client

### Regenerating a Plan

#### When Weight Change Alert Appears
1. Amber banner shows at top of Nutrition tab
2. Banner displays:
   - "Client weight has changed significantly"
   - Weight change amount (e.g., "-6.6 lbs")
   - Date plan was created
   - Before → After weight
3. Click **"Regenerate Nutrition Plan"**
4. System recalculates using current weight as new baseline
5. New targets displayed and saved

#### Manual Regeneration
1. Navigate to Nutrition tab
2. Settings form is collapsed by default when plan exists
3. Click **"Update Settings"** to expand form
4. Adjust any settings as needed
5. Click **"Regenerate Plan"**
6. Review new targets and warnings

### Viewing Plan History
1. Click **"View History"** button (clock icon) in Nutrition tab
2. Modal opens showing all historical plans
3. Each entry shows:
   - Date created
   - Reason badge (Initial, Regenerated, Weight Change, Custom)
   - Settings used at that time
   - Calculated targets
   - Trend indicators (↑ ↓ →) comparing to previous
4. Useful for tracking progress and accountability

### Using Custom Macros
For advanced use cases where calculated macros don't fit:

1. Expand settings form
2. Click **"Advanced: Edit macros manually"** toggle
3. Enter custom values:
   - Protein (g)
   - Carbs (g)
   - Fat (g)
4. Total calories calculated automatically
5. Click **"Save Custom Macros"**
6. "Custom macros active" badge appears
7. To return to auto-calculation, toggle off and regenerate

### Changing Unit Preference
1. Use toggle at top of Nutrition tab: **Metric ↔ Imperial**
2. All displays update immediately:
   - Weight: kg → lbs or lbs → kg
   - Protein target: g/kg → g/lb or g/lb → g/kg
   - All labels and tooltips
3. Preference saved to client record
4. Does NOT affect stored data (always metric internally)

---

## Calculations Explained

### 1. BMR (Basal Metabolic Rate)

**Mifflin-St Jeor Formula** (Fallback Method):
```
Men:    BMR = (10 × weight_kg) + (6.25 × height_cm) - (5 × age) + 5
Women:  BMR = (10 × weight_kg) + (6.25 × height_cm) - (5 × age) - 161
Other:  BMR = (10 × weight_kg) + (6.25 × height_cm) - (5 × age) - 78
```

**AI Method** (Primary):
- Uses structured prompt with client data
- Requests JSON response with BMR, TDEE, method, explanation
- May use Katch-McArdle if body fat % available:
  ```
  BMR = 370 + (21.6 × lean_body_mass_kg)
  where: lean_body_mass = weight × (1 - body_fat_percentage)
  ```

### 2. Adjusted TDEE (Total Daily Energy Expenditure)

```
Adjusted TDEE = (BMR × Activity Multiplier) + Training Calories
```

**Example**:
- BMR: 1,800 cal
- Activity Level: Moderately Active (1.55x)
- Training Volume: 4-5 hours/week (+400 cal)

```
Adjusted TDEE = (1,800 × 1.55) + 400
              = 2,790 + 400
              = 3,190 calories/day
```

### 3. Calorie Target (Goal-Based Adjustment)

**Without Deadline** (Maintenance):
```
Calorie Target = Adjusted TDEE
```

**With Deadline** (Weight Goal):
```
1. Weight change needed = goal_weight - current_weight
2. Weeks to goal = days_until_deadline / 7
3. Weekly rate = weight_change / weeks_to_goal
4. Apply safety caps:
   - Max deficit: 1.0kg/week (males), 0.75kg/week (females)
   - Max surplus: 0.5kg/week (males), 0.35kg/week (females)
5. Daily calorie adjustment = (weekly_rate × 7700) / 7
6. Calorie Target = Adjusted TDEE + daily_adjustment
7. Apply minimum floor: 1500 cal (males), 1200 cal (females)
```

**Example (Fat Loss)**:
- Current weight: 85kg
- Goal weight: 80kg (need to lose 5kg)
- Deadline: 10 weeks
- Gender: Male
- Adjusted TDEE: 3,190 cal

```
1. Weight change: 80 - 85 = -5kg
2. Weeks to goal: 10 weeks
3. Weekly rate: -5 / 10 = -0.5 kg/week (within male cap of 1.0)
4. Daily adjustment: (-0.5 × 7700) / 7 = -550 cal/day
5. Calorie Target: 3,190 - 550 = 2,640 cal/day
```

### 4. Protein Target

```
Protein (g) = current_weight_kg × protein_target_g_per_kg
Protein Calories = protein_g × 4 cal/g
```

**Example**:
- Weight: 85kg
- Target: 2.0 g/kg

```
Protein = 85 × 2.0 = 170g
Protein Calories = 170 × 4 = 680 cal
```

### 5. Carbs & Fat Distribution

```
Remaining Calories = Calorie Target - Protein Calories
```

**Split by Diet Type**:

| Diet Type | Carb % | Fat % |
|-----------|--------|-------|
| Balanced | 50% | 50% |
| High Carb | 65% | 35% |
| Low Carb | 25% | 75% |
| Keto | 10% | 90% |

**Example (Balanced)**:
- Calorie Target: 2,640 cal
- Protein Calories: 680 cal
- Remaining: 2,640 - 680 = 1,960 cal

```
Carbs: 1,960 × 50% / 4 cal/g = 245g
Fat:   1,960 × 50% / 9 cal/g = 109g
```

**Final Macros**:
- Protein: 170g (680 cal, 26%)
- Carbs: 245g (980 cal, 37%)
- Fat: 109g (980 cal, 37%)

**Note**: Percentages may adjust due to minimum fat requirements or rounding.

---

## Settings Reference

### Work Activity Level

| Level | Description | Multiplier | Example Jobs |
|-------|-------------|------------|--------------|
| **Sedentary** | Desk job, minimal movement throughout day | 1.2x | Office worker, programmer, writer |
| **Lightly Active** | Some walking, light movement during work | 1.375x | Teacher, cashier, light retail |
| **Moderately Active** | On feet most of the day, moderate movement | 1.55x | Nurse, server, retail manager |
| **Very Active** | Physical job, lots of movement and lifting | 1.725x | Construction, warehouse, landscaping |
| **Extremely Active** | Athlete or heavy labor, constant exertion | 1.9x | Professional athlete, farmer, mover |

**How to Choose**:
- Focus on **average workday** activity, not including formal training
- Consider: time sitting vs. standing, movement frequency, physical demands
- When in doubt, start conservative (Sedentary/Lightly Active)

### Training Volume

| Volume | Description | Additional Calories | Example |
|--------|-------------|---------------------|---------|
| **0-1 hours/week** | Minimal or no formal training | +0 cal | Beginner, recovery week |
| **2-3 hours/week** | Light training schedule | +250 cal | 2-3 gym sessions |
| **4-5 hours/week** | Moderate training commitment | +400 cal | 4-5 gym sessions |
| **6-7 hours/week** | Serious training volume | +550 cal | 6-7 sessions, athletes |
| **8+ hours/week** | High-volume training | +700 cal | Competitive athletes, 2-a-days |

**How to Choose**:
- Count **formal training sessions** only (gym, sports, structured cardio)
- Don't double-count activity from Work Activity Level
- Use average weekly volume, not peak weeks

### Protein Target

| Target | g/kg | g/lb | Recommendation |
|--------|------|------|----------------|
| **Minimum** | 1.6 | 0.73 | Basic maintenance, non-athletes |
| **Moderate** | 1.8 | 0.82 | General fitness, light training |
| **High** | 2.0 | 0.91 | Muscle building, serious training ⭐ Default |
| **Very High** | 2.2 | 1.0 | Aggressive muscle gain, cutting |
| **Custom** | 1.0-3.0 | 0.45-1.36 | Advanced use cases |

**How to Choose**:
- **Default (2.0 g/kg)** works for most clients
- **Higher** during fat loss to preserve muscle
- **Lower** for sedentary clients not focused on physique
- **Warning**: Below 1.6 g/kg triggers safety warning

### Diet Type

| Type | Carb % | Fat % | Best For |
|------|--------|-------|----------|
| **Balanced** | 50% | 50% | Most people, sustainable approach ⭐ Default |
| **High Carb** | 65% | 35% | Endurance athletes, high training volume |
| **Low Carb** | 25% | 75% | Fat-adapted athletes, metabolic preference |
| **Keto** | 10% | 90% | Ketogenic diet adherents, specific goals |
| **Custom** | Manual | Manual | Advanced coaching, special needs |

**How to Choose**:
- **Default (Balanced)** is optimal for most
- Match to client's **current dietary preference** when possible
- Consider **training demands** (endurance = more carbs)
- Account for **metabolic preference** (some do better on lower carbs)

### Goal Deadline

**Purpose**: Sets timeline for reaching goal weight, affects calorie adjustment

**Options**:
- **None**: Maintenance calories (Adjusted TDEE)
- **Future Date**: Progressive deficit/surplus based on timeline
- **Past Date**: Warning shown, uses maintenance

**How to Set**:
- **Realistic timelines**: 0.5-1% bodyweight/week loss
- **Example**: 10kg loss at 0.5kg/week = 20 weeks minimum
- **Leave blank** for recomp or maintenance phases

---

## Warnings & Safety

The system provides **real-time warnings** to ensure safe, effective plans. All warnings appear in an amber alert box below the nutrition targets.

### Warning Types

#### 1. Protein Warnings

**"Protein target is below recommended minimum of 1.6g/kg"**
- **Trigger**: Protein < 1.6 g/kg
- **Impact**: Risk of muscle loss, poor recovery
- **Action**: Increase protein target to at least 1.6 g/kg

**"Protein above 2.5g/kg provides no additional benefit"**
- **Trigger**: Protein > 2.5 g/kg
- **Impact**: Wasted calories, may displace carbs/fats
- **Action**: Consider lowering to 2.0-2.2 g/kg range

#### 2. Calorie Deficit Warnings

**"Weekly deficit capped at Xkg for safety"**
- **Trigger**: Goal timeline requires >1.0kg/week (males) or >0.75kg/week (females)
- **Impact**: System reduced deficit to safe maximum
- **Action**: Extend deadline or accept slower rate

**Example**:
```
Goal: Lose 10kg in 8 weeks = 1.25kg/week
Warning: "Weekly deficit capped at 1.0kg for safety"
Result: Plan adjusted to 1.0kg/week, will take 10 weeks instead
```

#### 3. Calorie Surplus Warnings

**"Weekly surplus capped at Xkg for optimal muscle gain"**
- **Trigger**: Goal timeline requires >0.5kg/week (males) or >0.35kg/week (females)
- **Impact**: System reduced surplus to prevent excess fat gain
- **Action**: Extend deadline for more sustainable gain

#### 4. Minimum Calorie Warnings

**"Calorie target raised to minimum safe level (1200/1500)"**
- **Trigger**: Calculated target < 1200 cal (females) or < 1500 cal (males)
- **Impact**: System set floor to prevent metabolic damage
- **Action**: Extend timeline or reduce goal weight

#### 5. Macro Distribution Warnings

**"Fat increased to meet minimum for hormonal health"**
- **Trigger**: Fat < 25% of calories (females) or < 20% (males)
- **Impact**: System adjusted carb/fat split
- **Action**: None needed, automatic safety adjustment

**"Protein adjusted down to fit within calorie target"**
- **Trigger**: Protein calories > total calorie target
- **Impact**: Protein reduced to fit budget
- **Action**: Increase calorie target or lower protein

#### 6. Deadline Warnings

**"Goal deadline has passed, using maintenance calories"**
- **Trigger**: Deadline date is in the past
- **Impact**: No deficit/surplus applied
- **Action**: Update goal deadline to future date

### Safety Philosophy

The calculator prioritizes **long-term sustainability** over aggressive short-term results:

1. **Evidence-Based Limits**: All caps based on research and best practices
2. **Gender-Specific**: Recognizes physiological differences
3. **Automatic Adjustments**: Enforces safety without blocking plan generation
4. **Transparent Communication**: Explains why adjustments were made
5. **Coach Override Available**: Custom macros for edge cases

---

## Technical Implementation

### Architecture

```
┌─────────────────────────────────────────────┐
│         Client Profile Page                 │
│  /app/clients/[id]/page.tsx                 │
└──────────────┬──────────────────────────────┘
               │
               ├─ Profile Tab
               │  └─ BMR Calculation Button
               │     └─ /api/clients/[id]/calculate-bmr
               │
               └─ Nutrition Tab
                  └─ NutritionCalculatorCardEnhanced
                     │
                     ├─ UnitToggle
                     │  └─ PATCH /api/clients/[id]/nutrition
                     │
                     ├─ NutritionRegenerationBanner (if needed)
                     │  └─ Shows when weight changes 3kg+
                     │
                     ├─ NutritionTargetsDisplay
                     │  └─ Shows current plan (calories + macros)
                     │
                     ├─ NutritionWarnings
                     │  └─ Displays validation warnings
                     │
                     ├─ NutritionSettingsForm
                     │  └─ Activity, training, protein, diet, deadline
                     │
                     ├─ Generate/Regenerate Button
                     │  └─ POST /api/clients/[id]/nutrition
                     │
                     └─ View History Button
                        └─ NutritionPlanHistoryModal
                           └─ GET /api/clients/[id]/nutrition/history
```

### Database Schema

#### Client Table (Nutrition Fields)
```sql
-- Unit & Preferences
unit_preference           VARCHAR(10)    -- 'metric' | 'imperial'

-- Activity Settings
work_activity_level       VARCHAR(30)    -- ENUM: sedentary | lightly_active | ...
training_volume_hours     VARCHAR(10)    -- ENUM: '0-1' | '2-3' | ...
protein_target_g_per_kg   NUMERIC(3,1)   -- Range: 1.0 - 3.0
diet_type                 VARCHAR(20)    -- ENUM: balanced | high_carb | ...
goal_deadline             DATE           -- Optional target date

-- Plan Metadata
nutrition_plan_created_date  TIMESTAMPTZ -- When plan was generated
nutrition_plan_base_weight_kg NUMERIC(5,2) -- Weight at plan creation (for comparison)

-- Calculated Targets (Locked)
calorie_target            INTEGER        -- Daily calories
protein_target_g          NUMERIC(5,1)   -- Protein in grams
carb_target_g             NUMERIC(5,1)   -- Carbs in grams
fat_target_g              NUMERIC(5,1)   -- Fat in grams

-- Custom Overrides
custom_macros_enabled     BOOLEAN        -- True if using custom values
custom_protein_g          NUMERIC(5,1)   -- Manual protein override
custom_carb_g             NUMERIC(5,1)   -- Manual carb override
custom_fat_g              NUMERIC(5,1)   -- Manual fat override

-- Related Metrics (from profile)
current_weight            NUMERIC(5,2)   -- Updated by check-ins
bmr                       NUMERIC(6,2)   -- Basal metabolic rate
tdee                      NUMERIC(6,2)   -- Total daily energy expenditure
```

#### Nutrition Plan History Table
```sql
CREATE TABLE nutrition_plan_history (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id              UUID NOT NULL REFERENCES clients(id),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Snapshot of metrics
  base_weight_kg         NUMERIC(5,2) NOT NULL,
  goal_weight_kg         NUMERIC(5,2),
  bmr                    NUMERIC(6,2),
  tdee                   NUMERIC(6,2),

  -- Settings used
  work_activity_level    TEXT NOT NULL,
  training_volume_hours  TEXT NOT NULL,
  protein_target_g_per_kg NUMERIC(3,1) NOT NULL,
  diet_type              TEXT NOT NULL,
  goal_deadline          DATE,

  -- Calculated targets
  calorie_target         INTEGER NOT NULL,
  protein_target_g       NUMERIC(5,1) NOT NULL,
  carb_target_g          NUMERIC(5,1) NOT NULL,
  fat_target_g           NUMERIC(5,1) NOT NULL,

  -- Metadata
  created_by_coach_id    UUID REFERENCES coaches(id),
  regeneration_reason    TEXT -- 'initial' | 'regenerated' | 'weight_change' | 'custom_macros'
);

CREATE INDEX idx_nutrition_history_client ON nutrition_plan_history(client_id, created_at DESC);
```

### File Structure

```
/app
  /api
    /clients/[id]
      /calculate-bmr
        route.ts              # BMR calculation endpoint
      /nutrition
        route.ts              # Generate/update nutrition plan
        /history
          route.ts            # Get plan history

/components
  /clients
    nutrition-calculator-card-enhanced.tsx  # Main component
    nutrition-calculator-card.tsx           # Basic version
    nutrition-settings-form.tsx             # Settings inputs
    nutrition-targets-display.tsx           # Macro display
    nutrition-warnings.tsx                  # Warning alerts
    nutrition-plan-history-modal.tsx        # History viewer
    nutrition-regeneration-banner.tsx       # Weight change alert
    unit-toggle.tsx                         # Metric/Imperial toggle

/services
  nutrition-service.ts      # Core calculation logic
  bmr-service.ts           # BMR/TDEE calculation

/utils
  nutrition-helpers.ts      # Unit conversions, formatters

/lib
  /validations
    nutrition.ts            # Zod schemas

/types
  check-in.ts              # Nutrition-related types
```

### Key Functions

**`generateNutritionPlan(input)`** - `/services/nutrition-service.ts`
- Orchestrates all calculations
- Returns: `{ calorieTarget, proteinTargetG, carbTargetG, fatTargetG, adjustedTdee, weeklyWeightChangeKg, warnings }`

**`calculateBMRWithAI(data)`** - `/services/bmr-service.ts`
- Attempts AI calculation via OpenAI
- Falls back to Mifflin-St Jeor formula
- Returns: `{ bmr, tdee, method, explanation }`

**`shouldShowRegenerationBanner(currentKg, baseKg)`** - `/utils/nutrition-helpers.ts`
- Returns: `true` if weight changed ≥3kg

**`formatWeight(weightKg, unitPreference)`** - `/utils/nutrition-helpers.ts`
- Converts and formats for display
- Returns: `"180.5 lbs"` or `"82.0 kg"`

---

## API Reference

### Calculate BMR

**Endpoint**: `POST /api/clients/[id]/calculate-bmr`

**Purpose**: Calculate Basal Metabolic Rate and Total Daily Energy Expenditure

**Requirements**:
- Client must have: `currentWeight`, `height`, `gender`
- Optional: `dateOfBirth` (for age), `currentBodyFatPercentage`

**Request**: No body required

**Response**:
```typescript
{
  success: boolean
  bmr: number          // Basal Metabolic Rate (cal/day)
  tdee: number         // TDEE at sedentary baseline (BMR × 1.2)
  error?: string
}
```

**Example**:
```bash
curl -X POST https://yourapp.com/api/clients/123/calculate-bmr
```

---

### Generate Nutrition Plan

**Endpoint**: `POST /api/clients/[id]/nutrition`

**Purpose**: Generate or regenerate complete nutrition plan

**Request Body**:
```typescript
{
  workActivityLevel: "sedentary" | "lightly_active" | "moderately_active" | "very_active" | "extremely_active"
  trainingVolumeHours: "0-1" | "2-3" | "4-5" | "6-7" | "8+"
  proteinTargetGPerKg: number  // 1.0 - 3.0
  dietType: "balanced" | "high_carb" | "low_carb" | "keto" | "custom"
  goalDeadline?: string  // ISO date (YYYY-MM-DD) or omit for maintenance

  // Optional: Custom macro override
  customMacrosEnabled?: boolean
  customProteinG?: number
  customCarbG?: number
  customFatG?: number
}
```

**Response**:
```typescript
{
  success: boolean
  plan: {
    calorieTarget: number         // Daily calories
    proteinTargetG: number        // Protein in grams
    carbTargetG: number           // Carbs in grams
    fatTargetG: number            // Fat in grams
    adjustedTdee: number          // TDEE after activity/training
    weeklyWeightChangeKg: number  // Expected weekly rate (negative = loss)
    warnings: string[]            // Array of warning messages
  }
  error?: string
}
```

**Example Request**:
```bash
curl -X POST https://yourapp.com/api/clients/123/nutrition \
  -H "Content-Type: application/json" \
  -d '{
    "workActivityLevel": "moderately_active",
    "trainingVolumeHours": "4-5",
    "proteinTargetGPerKg": 2.0,
    "dietType": "balanced",
    "goalDeadline": "2025-12-31"
  }'
```

**Example Response**:
```json
{
  "success": true,
  "plan": {
    "calorieTarget": 2640,
    "proteinTargetG": 170,
    "carbTargetG": 245,
    "fatTargetG": 109,
    "adjustedTdee": 3190,
    "weeklyWeightChangeKg": -0.5,
    "warnings": []
  }
}
```

---

### Update Unit Preference

**Endpoint**: `PATCH /api/clients/[id]/nutrition`

**Purpose**: Change client's unit display preference (metric ↔ imperial)

**Request Body**:
```typescript
{
  unitPreference: "metric" | "imperial"
}
```

**Response**:
```typescript
{
  success: boolean
  error?: string
}
```

**Example**:
```bash
curl -X PATCH https://yourapp.com/api/clients/123/nutrition \
  -H "Content-Type: application/json" \
  -d '{ "unitPreference": "metric" }'
```

---

### Get Plan History

**Endpoint**: `GET /api/clients/[id]/nutrition/history`

**Purpose**: Retrieve all historical nutrition plans for client

**Request**: No body required

**Response**:
```typescript
{
  success: boolean
  history: Array<{
    id: string
    clientId: string
    createdAt: string  // ISO timestamp

    // Metrics at creation
    baseWeightKg: number
    goalWeightKg?: number
    bmr?: number
    tdee?: number

    // Settings used
    workActivityLevel: string
    trainingVolumeHours: string
    proteinTargetGPerKg: number
    dietType: string
    goalDeadline?: string

    // Calculated targets
    calorieTarget: number
    proteinTargetG: number
    carbTargetG: number
    fatTargetG: number

    // Metadata
    createdByCoachId?: string
    regenerationReason?: string  // 'initial' | 'regenerated' | 'weight_change' | 'custom_macros'
  }>
  error?: string
}
```

**Example**:
```bash
curl https://yourapp.com/api/clients/123/nutrition/history
```

---

## Frequently Asked Questions

### Why does the plan show warnings?

Warnings are **educational, not errors**. They explain why the system made safety adjustments to your plan. Common scenarios:

- **Deadline too aggressive**: System capped weekly rate to safe maximum
- **Calories too low**: Raised to minimum safe level (1200F/1500M)
- **Protein suboptimal**: Below 1.6g/kg or above 2.5g/kg

**Action**: Review warnings, adjust settings if desired, or accept the safe plan.

### When should I recalculate BMR?

Recalculate BMR when:
- Client loses/gains significant weight (10+ lbs / 5+ kg)
- Body composition changes dramatically
- Initial BMR was estimated without proper data
- Client reports energy levels don't match plan

**Note**: BMR changes slowly. Don't recalculate more than monthly.

### What if my client doesn't track macros?

The calculator is flexible:
- **Calorie-only tracking**: Just give calorie target
- **Protein + calories**: Give protein + calorie targets
- **Full macros**: Give all three macros

**Recommendation**: Start with calories + protein minimum. Add carb/fat tracking if client is advanced.

### Can I adjust macros without regenerating?

No. Macro targets are **locked** when plan is generated to maintain consistency.

**To adjust**:
1. Use "Update Settings" to change inputs
2. Regenerate plan with new settings
3. Or use "Custom Macros" for manual override

**Why**: Ensures all calculations are internally consistent and tracked in history.

### How do I handle a weight loss plateau?

When progress stalls:
1. **First**: Verify client is truly at plateau (2+ weeks no change)
2. **Check adherence**: Is client hitting targets consistently?
3. **Recalculate BMR**: Weight loss lowers BMR over time
4. **Regenerate plan**: Uses new, lower BMR for updated targets
5. **Consider refeed**: Temporary increase for metabolic boost

**Note**: Small weight fluctuations are normal. Don't regenerate too frequently.

### What if client has special dietary restrictions?

The system accommodates many needs:
- **Vegetarian/Vegan**: Use higher protein target (2.2g/kg) for plant proteins
- **Gluten-free**: Doesn't affect macro calculations
- **Low FODMAP**: Use "Low Carb" or "Keto" diet type
- **Specific allergies**: Focus on calorie + protein, let client choose food sources

**For complex medical needs**: Consider manual "Custom Macros" mode.

---

## Best Practices

### For Coaches

1. **Verify Data First**
   - Always ensure BMR is calculated before generating plan
   - Check that weight, height, gender are accurate
   - Confirm goal weight is realistic

2. **Start Conservative**
   - Use "Sedentary" or "Lightly Active" unless truly active
   - Default protein (2.0 g/kg) works for most
   - Balanced diet type is safest starting point

3. **Set Realistic Deadlines**
   - 0.5-1% bodyweight per week is sustainable
   - Aggressive deadlines trigger warnings and safety caps
   - When in doubt, add extra time

4. **Review Warnings**
   - Don't ignore amber alerts
   - Understand why adjustments were made
   - Educate clients on safety reasons

5. **Monitor and Adjust**
   - Check-in data updates client weight automatically
   - Regeneration banner alerts when 3kg+ change occurs
   - Regenerate every 4-8 weeks minimum

6. **Use History Tracking**
   - Review history to see progress trends
   - Identify what's working vs. what's not
   - Accountability for both coach and client

### For Clients

1. **Track Consistently**
   - Daily weight tracking (average weekly)
   - Log food intake accurately
   - Submit check-ins on schedule

2. **Follow the Plan**
   - Hit calorie target within ±100 cal/day
   - Prioritize protein target minimum
   - Don't stress minor carb/fat variations

3. **Be Patient**
   - Weight fluctuates daily (water, sodium, digestion)
   - Judge progress by 2-week trends, not single weigh-ins
   - Trust the process for at least 4 weeks

4. **Communicate Changes**
   - Tell coach if activity level changes significantly
   - Report if targets feel too high/low
   - Mention any energy or performance issues

---

## Troubleshooting

### Issue: BMR calculation fails

**Symptoms**: Error message when clicking "Calculate BMR"

**Possible Causes**:
- Missing required data (weight, height, gender)
- OpenAI API error
- Network timeout

**Solutions**:
1. Verify all required fields filled in Profile tab
2. Try again (falls back to formula on AI failure)
3. Check server logs for specific error

---

### Issue: Plan generation shows many warnings

**Symptoms**: Multiple amber warning messages after generating plan

**Possible Causes**:
- Aggressive goal deadline
- Extreme settings (very high protein, very low calories)
- Inconsistent data (goal weight vs. deadline mismatch)

**Solutions**:
1. Review each warning individually
2. Adjust settings to address root causes
3. Accept warnings if plan is intentionally aggressive
4. Use Custom Macros if auto-calculation doesn't fit

---

### Issue: Weight change banner doesn't appear

**Symptoms**: Client weight changed but no amber regeneration banner

**Possible Causes**:
- Weight change < 3kg threshold
- Nutrition plan never generated (no baseline weight)
- Check-in didn't update client weight

**Solutions**:
1. Verify weight change: New weight - Baseline weight ≥ 3kg
2. Generate initial plan to set baseline weight
3. Check that latest check-in saved successfully

---

### Issue: Unit toggle doesn't save

**Symptoms**: Unit preference reverts after page refresh

**Possible Causes**:
- Network error during save
- Permissions issue
- JavaScript error

**Solutions**:
1. Check browser console for errors
2. Verify network tab shows successful PATCH request
3. Try refreshing page and toggling again

---

### Issue: Custom macros don't total correctly

**Symptoms**: Custom macro calories don't match displayed total

**Possible Causes**:
- Entered values are per meal instead of per day
- Forgot to account for 4/4/9 calorie conversions
- Typo in input values

**Solutions**:
1. Verify: Protein × 4 + Carbs × 4 + Fat × 9 = Total Calories
2. Re-enter values carefully
3. Use calculator if needed
4. Check that all three macros are filled in

---

## Support & Feedback

For technical issues, feature requests, or questions:
- **GitHub Issues**: Report bugs and request features
- **Documentation**: Check this README first
- **Code Comments**: Review inline documentation in source files

---

## Changelog

### Version 1.0 (Current)
- ✅ AI-powered BMR calculation with formula fallback
- ✅ Adjusted TDEE based on activity + training
- ✅ Goal-based calorie targeting with safety caps
- ✅ Protein-first macro distribution
- ✅ Multiple diet types (Balanced, High Carb, Low Carb, Keto)
- ✅ Custom macro override capability
- ✅ Weight change monitoring with 3kg threshold
- ✅ Complete plan history tracking
- ✅ Dual unit system (Metric/Imperial)
- ✅ Real-time validation warnings
- ✅ Gender-specific safety minimums
- ✅ Regeneration alerts in check-in reviews

---

## License

This feature is part of the FitStop coaching platform.

---

**Built with**:
- Next.js 16
- TypeScript
- OpenAI GPT-4o-mini
- Supabase PostgreSQL
- Tailwind CSS
- Evidence-based nutrition science
