-- Migration 197: a coach can close the nutrition out-of-date notice.
--
-- Owner, 2026-09-23: the notice closes with an ×, stays closed everywhere, and
-- comes back only if the goal changes again. Closing it is the coach keeping
-- one version's calories for one goal, as the calculator prices it -- the
-- weight target and the deadline. The out-of-date rule
-- (lib/nutrition/nutrition-out-of-date.ts) reads a version as fitting a day
-- whose goal prices like the goal it was built for OR like one it was kept
-- for, so a new target or a moved deadline brings the notice back.
--
-- A table of its own, not columns on the version: one version can be out of
-- date against two goals (today's, and a planned one inside its days), and
-- closing the second must not reopen the first.
--
-- Written by the coach route through the service role alone; nothing else
-- reads or writes it.

CREATE TABLE IF NOT EXISTS public.nutrition_plan_kept_goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nutrition_plan_id UUID NOT NULL,
  goal_weight_kg NUMERIC(5, 2),
  goal_deadline DATE,
  kept_by UUID,
  kept_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT nutrition_plan_kept_goals_nutrition_plan_id_fkey
    FOREIGN KEY (nutrition_plan_id) REFERENCES public.nutrition_plans(id) ON DELETE CASCADE,
  CONSTRAINT nutrition_plan_kept_goals_kept_by_fkey
    FOREIGN KEY (kept_by) REFERENCES public.coaches(id) ON DELETE SET NULL,
  -- One closure per version per goal pricing; a goal with no weight target or
  -- no deadline prices as NULLs, which must collide too.
  CONSTRAINT nutrition_plan_kept_goals_once
    UNIQUE NULLS NOT DISTINCT (nutrition_plan_id, goal_weight_kg, goal_deadline)
);

ALTER TABLE public.nutrition_plan_kept_goals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.nutrition_plan_kept_goals
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON TABLE public.nutrition_plan_kept_goals TO service_role;

COMMENT ON TABLE public.nutrition_plan_kept_goals IS
  'A closed nutrition out-of-date notice: the coach kept this version''s calories for a goal priced at goal_weight_kg by goal_deadline (NULLs for a goal with no weight target or no deadline). The out-of-date rule reads a day whose goal prices like this as fitting the version, so the notice returns only when the goal changes again (migration 197).';
