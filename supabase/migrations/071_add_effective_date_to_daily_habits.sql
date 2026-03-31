-- Add effective_date to daily_habits
-- This controls when a habit becomes trackable, decoupling it from created_at.
-- Allows coaches to set up habits before a phase starts, with tracking beginning
-- on the phase start date rather than the creation date.

ALTER TABLE public.daily_habits
  ADD COLUMN IF NOT EXISTS effective_date DATE;

-- Backfill: set effective_date to created_at::date for all existing habits
-- so current behavior is preserved
UPDATE public.daily_habits
  SET effective_date = created_at::date
  WHERE effective_date IS NULL;

-- Now make it NOT NULL with a default of CURRENT_DATE
ALTER TABLE public.daily_habits
  ALTER COLUMN effective_date SET NOT NULL,
  ALTER COLUMN effective_date SET DEFAULT CURRENT_DATE;
