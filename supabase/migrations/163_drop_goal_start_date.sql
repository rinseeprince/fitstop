-- =============================================================================
-- Migration 163: drop client_goals.goal_start_date
-- (docs/MEASUREMENT-LOG-PLAN.md commit 8bb, owner decision 2026-09-03)
--
-- The window a nutrition deficit is spread over starts at the day the plan
-- takes effect (nutrition_plans.effective_from), which the orchestrator and the
-- drawer hand to the calculator. The goal's own start date was the only other
-- lever on that window: ignored when past, compressing the deficit into today
-- when future, and typed twice to agree with the plan's date. Nothing reads it.
-- =============================================================================

ALTER TABLE IF EXISTS public.client_goals DROP COLUMN IF EXISTS goal_start_date;
