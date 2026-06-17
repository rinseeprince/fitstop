-- Migration 113: events-as-SOT foundation (additive, behavior-neutral)
--
-- WHY: events are the source of truth for date-specific targets. A future
--      plan/template hard-delete (Sessions 2-3 of the events-as-SOT overhaul)
--      must never cascade-wipe past or logged events. So convert both event->plan
--      foreign keys from ON DELETE CASCADE to ON DELETE SET NULL (and make the
--      columns nullable), and add is_modified to nutrition_events (mirror of
--      training_events mig 082) so regeneration can preserve coach edits.
--
-- SAFETY: additive only. Existing rows keep their plan id; SET NULL only bites on
--      a hard-delete that does not exist yet. No read/write code is required by
--      this migration itself (the gen-types nullability flip is handled in app code).
--
-- The two plan FKs were defined inline in migs 075/077 and are therefore
-- auto-named by Postgres; look the real name up dynamically rather than hardcode.

-- 1) nutrition_events.is_modified (mirror training_events mig 082)
ALTER TABLE nutrition_events
  ADD COLUMN IF NOT EXISTS is_modified BOOLEAN NOT NULL DEFAULT false;

-- 2) nutrition_events.nutrition_plan_id: ON DELETE CASCADE -> SET NULL + nullable
ALTER TABLE nutrition_events ALTER COLUMN nutrition_plan_id DROP NOT NULL;
DO $$
DECLARE
  v_name text;
BEGIN
  SELECT conname INTO v_name
  FROM pg_constraint
  WHERE contype = 'f'
    AND conrelid = 'public.nutrition_events'::regclass
    AND confrelid = 'public.nutrition_plans'::regclass;
  IF v_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE nutrition_events DROP CONSTRAINT %I', v_name);
  END IF;
END $$;
ALTER TABLE nutrition_events DROP CONSTRAINT IF EXISTS nutrition_events_plan_fk;
ALTER TABLE nutrition_events
  ADD CONSTRAINT nutrition_events_plan_fk
  FOREIGN KEY (nutrition_plan_id) REFERENCES nutrition_plans(id) ON DELETE SET NULL;

-- 3) training_events.training_plan_id: ON DELETE CASCADE -> SET NULL + nullable
ALTER TABLE training_events ALTER COLUMN training_plan_id DROP NOT NULL;
DO $$
DECLARE
  v_name text;
BEGIN
  SELECT conname INTO v_name
  FROM pg_constraint
  WHERE contype = 'f'
    AND conrelid = 'public.training_events'::regclass
    AND confrelid = 'public.training_plans'::regclass;
  IF v_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE training_events DROP CONSTRAINT %I', v_name);
  END IF;
END $$;
ALTER TABLE training_events DROP CONSTRAINT IF EXISTS training_events_plan_fk;
ALTER TABLE training_events
  ADD CONSTRAINT training_events_plan_fk
  FOREIGN KEY (training_plan_id) REFERENCES training_plans(id) ON DELETE SET NULL;
