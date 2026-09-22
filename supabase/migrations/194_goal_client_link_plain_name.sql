-- =============================================================================
-- 194_goal_client_link_plain_name.sql -- the goal's link to its client takes
-- its plain name (docs/MEASUREMENT-LOG-PLAN.md §6 commit 8d).
--
-- Migration 193 created the new client_goals while the old versioned table --
-- moved aside, then dropped in the same migration -- still held the name
-- client_goals_client_id_fkey, so Postgres named the new link
-- client_goals_client_id_fkey1. The old table is gone; the link takes the
-- plain name. Renamed only where the suffixed name exists, so the migration
-- reads the same on every database.
-- =============================================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.client_goals'::regclass
       AND conname = 'client_goals_client_id_fkey1'
  ) THEN
    ALTER TABLE public.client_goals
      RENAME CONSTRAINT client_goals_client_id_fkey1 TO client_goals_client_id_fkey;
  END IF;
END $$;
