-- Security: lock down the atomic SECURITY DEFINER RPCs.
--
-- WHY: A new Postgres function defaults to EXECUTE granted to PUBLIC. Only the
-- read-path analytics functions (migrations 094/095/102) were ever REVOKE'd; the
-- write-path atomic RPCs below were not. Each runs as the table owner (BYPASSRLS)
-- and takes a caller-supplied p_client_id / p_phase_id / p_roadmap_id with NO
-- internal authorization. Because EXECUTE is PUBLIC, any authenticated user (and
-- potentially anon) can call them directly via PostgREST:
--   POST /rest/v1/rpc/upsert_daily_log_atomic     {"p_client_id":"<victim>", ...}
--   POST /rest/v1/rpc/create_nutrition_plan_atomic {...}
--   POST /rest/v1/rpc/transition_phase_atomic      {"p_phase_id":"<victim>", ...}
--   POST /rest/v1/rpc/archive_roadmap_atomic       {"p_roadmap_id":"<victim>"}
-- -> cross-tenant writes that bypass the entire route ownership layer.
--
-- FIX: revoke EXECUTE from PUBLIC/anon/authenticated and grant only service_role
-- (these are only ever invoked through supabaseAdmin, so this is non-breaking),
-- and pin search_path = public on each (defense against search_path hijacking of
-- a SECURITY DEFINER function).
--
-- A pg_proc loop is used because several of these were CREATE OR REPLACE'd with
-- CHANGED argument signatures over time (e.g. create_nutrition_plan_atomic across
-- 048/066/069/078/080), which creates multiple live overloads in the catalog.
-- Looping over every matching overload guarantees we don't miss an old signature.
-- handle_new_user() is intentionally excluded: it is a trigger function (invoked by
-- the trigger mechanism, not via rpc) and already pins search_path.

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef                              -- SECURITY DEFINER only
      AND p.proname IN (
        'upsert_daily_log_atomic',
        'create_nutrition_plan_atomic',
        'create_training_plan_atomic',
        'transition_phase_atomic',
        'archive_roadmap_atomic'
      )
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated;', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role;', r.sig);
    EXECUTE format('ALTER FUNCTION %s SET search_path = public;', r.sig);
    RAISE NOTICE 'Locked down SECURITY DEFINER function: %', r.sig;
  END LOOP;
END $$;
