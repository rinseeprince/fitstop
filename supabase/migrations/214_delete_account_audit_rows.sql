-- =============================================================================
-- 214_delete_account_audit_rows.sql -- a deleted account's audit rows go with
-- its records.
--
-- Delete account tells a client that everything recorded about them goes, and
-- a coach that their clients' records go. audit_logs (migration 108) keys on
-- plain uuids, with no foreign key to cascade, so each function deletes the
-- account's audit rows itself, inside the same statement as its records:
--
-- 1. delete_client_records(p_user_id): every audit row about the client rows
--    the login signs in as (client_id), or done by them (actor_role 'client'),
--    then the client rows, as migration 211.
-- 2. delete_coach_records(p_user_id): every audit row about the coach's
--    clients or done by them, and every row the coach did (actor_role
--    'trainer'), before the clients' logins, the clients and the coach row, as
--    migration 211. The ids are read into arrays first, so the planner can
--    match each through migration 108's two indexes, led by client_id and by
--    actor_id, rather than reading the whole table for every row.
-- 3. Grants restated in migration 211's shape: service_role alone.
-- 4. A closing check, migration 211's, and that each body reaches audit_logs.
--
-- Re-runnable. Pure ASCII.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. A client's records.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_client_records(p_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n integer;
BEGIN
  DELETE FROM public.audit_logs a
   USING public.clients cl
   WHERE cl.user_id = p_user_id
     AND (a.client_id = cl.id OR (a.actor_role = 'client' AND a.actor_id = cl.id));

  DELETE FROM public.clients WHERE user_id = p_user_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

COMMENT ON FUNCTION public.delete_client_records(uuid) IS
  'Delete account (migrations 211 and 214): the audit rows about or by the client rows a login signs in as, then those client rows, and through their ON DELETE CASCADE keys everything recorded about the person. Returns the client rows deleted. Called by the app''s beforeDelete once the person''s photos are gone; Better Auth then deletes the login.';

-- ---------------------------------------------------------------------------
-- 2. A coach's records, their clients' among them.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_coach_records(p_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, better_auth
AS $$
DECLARE
  n integer;
  client_ids uuid[];
  coach_ids uuid[];
BEGIN
  -- The audit rows about the coach's clients or done by them, and every row
  -- the coach did.
  client_ids := ARRAY(SELECT cl.id FROM public.clients cl JOIN public.coaches c ON c.id = cl.coach_id WHERE c.user_id = p_user_id);
  coach_ids := ARRAY(SELECT c.id FROM public.coaches c WHERE c.user_id = p_user_id);
  DELETE FROM public.audit_logs a
   WHERE a.client_id = ANY (client_ids)
      OR (a.actor_role = 'client' AND a.actor_id = ANY (client_ids))
      OR (a.actor_role = 'trainer' AND a.actor_id = ANY (coach_ids));

  -- The clients' logins first: clients.user_id is ON DELETE SET NULL, so
  -- nothing else removes them. Each takes its sessions, its password and its
  -- profile. Never a login with a coach row, or one that signs in as a client
  -- of another coach.
  DELETE FROM better_auth."user" u
   USING public.clients cl
   JOIN public.coaches c ON c.id = cl.coach_id
   WHERE c.user_id = p_user_id
     AND cl.user_id = u.id
     AND NOT EXISTS (SELECT 1 FROM public.coaches oc WHERE oc.user_id = u.id)
     AND NOT EXISTS (SELECT 1 FROM public.clients other WHERE other.user_id = u.id AND other.coach_id <> c.id);

  -- The clients, in a statement of their own, so every row under them (their
  -- content assignments and their answers to the coach's questions among
  -- them) is gone before the coach row's NO ACTION keys are checked.
  DELETE FROM public.clients
   WHERE coach_id IN (SELECT c.id FROM public.coaches c WHERE c.user_id = p_user_id);

  DELETE FROM public.coaches WHERE user_id = p_user_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

COMMENT ON FUNCTION public.delete_coach_records(uuid) IS
  'Delete account (migrations 211 and 214): the audit rows about or by a coach''s clients and by the coach, the clients'' logins, then the clients and everything under them, then the coach row and the coach''s library. Returns the coach rows deleted. Called by the app''s beforeDelete once the objects are gone; Better Auth then deletes the coach''s login.';

-- ---------------------------------------------------------------------------
-- 3. Executable by service_role alone.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.delete_client_records(uuid), public.delete_coach_records(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_client_records(uuid), public.delete_coach_records(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 4. Closing check.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  fn regprocedure;
  found text;
BEGIN
  FOREACH fn IN ARRAY ARRAY['public.delete_client_records(uuid)'::regprocedure, 'public.delete_coach_records(uuid)'::regprocedure]
  LOOP
    -- SECURITY DEFINER, postgres's, its search_path pinned.
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p
       WHERE p.oid = fn
         AND p.prosecdef
         AND p.proowner = 'postgres'::regrole
         AND EXISTS (SELECT 1 FROM unnest(p.proconfig) AS setting WHERE setting LIKE 'search_path=%')
    ) THEN
      RAISE EXCEPTION 'Migration 214: % is not SECURITY DEFINER, owned by postgres, with its search_path pinned', fn;
    END IF;

    -- EXECUTE for service_role, and for no other role but the owner (a NULL
    -- ACL is the default, EXECUTE for PUBLIC).
    SELECT string_agg(format('%s: %s', CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END, a.privilege_type), '; ')
      INTO found
      FROM pg_proc p
      CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     WHERE p.oid = fn
       AND a.grantee <> p.proowner
       AND a.grantee <> 'service_role'::regrole::oid;
    IF found IS NOT NULL THEN
      RAISE EXCEPTION 'Migration 214: % grants a privilege to a role but its owner and service_role: %', fn, found;
    END IF;
    IF NOT has_function_privilege('service_role', fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'Migration 214: service_role cannot execute %', fn;
    END IF;

    -- The body deletes the account's audit rows.
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = fn AND position('DELETE FROM public.audit_logs' IN p.prosrc) > 0) THEN
      RAISE EXCEPTION 'Migration 214: % does not delete the account''s audit rows', fn;
    END IF;
  END LOOP;
END $$;
