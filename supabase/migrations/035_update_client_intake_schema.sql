-- ============================================================
-- Migration 035: Update client_intake schema
-- ============================================================
-- Adds missing columns and updates CHECK constraints to match
-- the full intake questionnaire spec.
-- ============================================================

-- -------------------------------------------------------
-- Part 1: Add missing columns
-- -------------------------------------------------------

-- Body metrics
ALTER TABLE public.client_intake
  ADD COLUMN body_fat_percentage NUMERIC;

-- Goals (expanded)
ALTER TABLE public.client_intake
  ADD COLUMN target_weight NUMERIC,
  ADD COLUMN goal_deadline DATE,
  ADD COLUMN goal_description TEXT,
  ADD COLUMN motivation TEXT;

-- Nutrition (expanded)
ALTER TABLE public.client_intake
  ADD COLUMN food_allergies TEXT,
  ADD COLUMN diet_description TEXT,
  ADD COLUMN has_tracked_macros_before BOOLEAN,
  ADD COLUMN meals_per_day INTEGER,
  ADD COLUMN biggest_nutrition_challenge TEXT;

-- Training background (expanded)
ALTER TABLE public.client_intake
  ADD COLUMN previous_coaching_experience BOOLEAN,
  ADD COLUMN previous_coaching_details TEXT,
  ADD COLUMN anything_else TEXT;

-- Tracking timestamps
ALTER TABLE public.client_intake
  ADD COLUMN started_at TIMESTAMPTZ;

-- Coach review fields
ALTER TABLE public.client_intake
  ADD COLUMN reviewed_at TIMESTAMPTZ,
  ADD COLUMN reviewed_by UUID REFERENCES public.coaches(id) ON DELETE SET NULL,
  ADD COLUMN coach_review_notes TEXT;

-- -------------------------------------------------------
-- Part 2: Update CHECK constraints with corrected enum values
-- -------------------------------------------------------

-- status: add 'reviewed'
ALTER TABLE public.client_intake
  DROP CONSTRAINT IF EXISTS client_intake_status_check;
ALTER TABLE public.client_intake
  ADD CONSTRAINT client_intake_status_check
  CHECK (status IN ('pending', 'in_progress', 'completed', 'reviewed'));

-- primary_goal: updated values
ALTER TABLE public.client_intake
  DROP CONSTRAINT IF EXISTS client_intake_primary_goal_check;
ALTER TABLE public.client_intake
  ADD CONSTRAINT client_intake_primary_goal_check
  CHECK (primary_goal IN (
    'lose_weight', 'build_muscle', 'recomposition',
    'general_fitness', 'event_prep', 'maintain'
  ));

-- cooking_frequency: updated values
ALTER TABLE public.client_intake
  DROP CONSTRAINT IF EXISTS client_intake_cooking_frequency_check;
ALTER TABLE public.client_intake
  ADD CONSTRAINT client_intake_cooking_frequency_check
  CHECK (cooking_frequency IN (
    'mostly_cook', 'mix_of_both', 'mostly_eat_out', 'meal_prep'
  ));

-- training_experience_level: updated values
ALTER TABLE public.client_intake
  DROP CONSTRAINT IF EXISTS client_intake_training_experience_level_check;
ALTER TABLE public.client_intake
  ADD CONSTRAINT client_intake_training_experience_level_check
  CHECK (training_experience_level IN (
    'complete_beginner', 'some_experience', 'intermediate', 'advanced'
  ));

-- training_time_preference: updated values
ALTER TABLE public.client_intake
  DROP CONSTRAINT IF EXISTS client_intake_training_time_preference_check;
ALTER TABLE public.client_intake
  ADD CONSTRAINT client_intake_training_time_preference_check
  CHECK (training_time_preference IN (
    'morning', 'midday', 'evening', 'flexible'
  ));

-- training_location: updated values
ALTER TABLE public.client_intake
  DROP CONSTRAINT IF EXISTS client_intake_training_location_check;
ALTER TABLE public.client_intake
  ADD CONSTRAINT client_intake_training_location_check
  CHECK (training_location IN (
    'commercial_gym', 'home_gym', 'home_no_equipment', 'outdoor', 'mixed'
  ));

-- -------------------------------------------------------
-- Part 3: Index on reviewed_by for coach queries
-- -------------------------------------------------------

CREATE INDEX idx_client_intake_reviewed_by ON public.client_intake(reviewed_by);
