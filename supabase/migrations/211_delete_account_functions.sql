-- =============================================================================
-- 211_delete_account_functions.sql -- a deleted account's records go in one
-- statement per role (docs/BETTER-AUTH-PLAN.md sections 2.1 and 2.6, D2, D20,
-- D21, and section 6 commit 6).
--
-- Delete account is Better Auth's: its emailed link calls the app's
-- beforeDelete (services/account-service.ts deleteAccountRecords), which
-- removes the account's storage objects and then calls one of these two
-- functions; Better Auth then deletes the login itself, which takes its
-- sessions, its password and its profile (profiles.user_id is ON DELETE
-- CASCADE, migration 209). Neither function deletes the caller's own login.
--
-- 1. delete_client_records(p_user_id): the client rows the login signs in as.
--    Every key to clients is ON DELETE CASCADE, so the one DELETE takes
--    everything recorded about the person, and the rows under those rows.
-- 2. delete_coach_records(p_user_id): the coach's clients' logins, then the
--    coach's clients, then the coach row, which takes the coach's library
--    (plans, folders, items, saved plans and sessions, questions and forms,
--    custom exercises). The clients go in a statement of their own, before
--    the coach: content_assignments.assigned_by and check_in_answers.
--    question_id are NO ACTION keys, and Postgres checks a NO ACTION key in
--    the round of cascades that removes its parent, before a deeper round has
--    removed the rows pointing at it. Deleting the coach alone fails for a
--    coach whose client holds an assignment, or answered one of the coach's
--    questions; with the clients gone first, nothing points at either.
-- 3. Both are SECURITY DEFINER, postgres's, their search_path pinned, and
--    executable by service_role alone (migration 106's shape): the app calls
--    them through supabaseAdmin, and only from beforeDelete.
-- 4. The better_auth schema's COMMENT names delete_coach_records beside
--    migration 210's trigger: the two things outside Better Auth that write
--    its tables.
-- 5. A closing check, in migration 210's shape.
--
-- Additive: nothing calls either function until commit 6's code runs.
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
  DELETE FROM public.clients WHERE user_id = p_user_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

COMMENT ON FUNCTION public.delete_client_records(uuid) IS
  'Delete account (migration 211): the client rows a login signs in as, and through their ON DELETE CASCADE keys everything recorded about the person. Returns the client rows deleted. Called by the app''s beforeDelete once the person''s photos are gone; Better Auth then deletes the login.';

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
BEGIN
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
  'Delete account (migration 211): a coach''s clients'' logins, then the clients and everything under them, then the coach row and the coach''s library. Returns the coach rows deleted. Called by the app''s beforeDelete once the objects are gone; Better Auth then deletes the coach''s login.';

-- ---------------------------------------------------------------------------
-- 3. Executable by service_role alone.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.delete_client_records(uuid), public.delete_coach_records(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_client_records(uuid), public.delete_coach_records(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 4. The schema's COMMENT.
-- ---------------------------------------------------------------------------
COMMENT ON SCHEMA better_auth IS
  'Better Auth''s tables (logins, sessions, credentials, one-time tokens, its rate limiter). Off the Data API: PostgREST serves public only. Reached by Better Auth''s own connection, by migration 210''s trigger, which copies a login''s address to its coach and client rows, and by migration 211''s public.delete_coach_records, which deletes a deleted coach''s clients'' logins.';

-- ---------------------------------------------------------------------------
-- 5. Closing check.
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
      RAISE EXCEPTION 'Migration 211: % is not SECURITY DEFINER, owned by postgres, with its search_path pinned', fn;
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
      RAISE EXCEPTION 'Migration 211: % grants a privilege to a role but its owner and service_role: %', fn, found;
    END IF;
    IF NOT has_function_privilege('service_role', fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'Migration 211: service_role cannot execute %', fn;
    END IF;
  END LOOP;
END $$;
