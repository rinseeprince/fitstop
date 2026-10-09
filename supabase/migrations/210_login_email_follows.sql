-- =============================================================================
-- 210_login_email_follows.sql -- a login's address and every copy of it change
-- in one write (docs/BETTER-AUTH-PLAN.md sections 2.1 and 2.10, D37, and
-- section 6 commit 5.5).
--
-- coaches.email and clients.email copy the address a login signs in with:
-- createCoachLogin writes a coach's and acceptClientInvitation a client's when
-- the login is made (services/login-service.ts), and every screen and email
-- of the app reads one of the two. Better Auth changes an address in one
-- UPDATE of better_auth."user", whichever path asks: its verify-email endpoint
-- at the second link of a change of email (internalAdapter.updateUserByEmail),
-- and the owner's npm run auth:move-email (internalAdapter.updateUser). This
-- trigger rewrites the login's coach row and client row inside that same
-- statement, so the address and its copies change together or not at all: a
-- copy that cannot be written (coaches.email is UNIQUE) fails the statement,
-- and the login keeps its address too.
--
-- 1. The function. SECURITY DEFINER, so the copy is written as its owner
--    (postgres) whoever updates the login, with its search_path pinned. No
--    role may execute it: a trigger runs it, and a trigger function cannot be
--    called any other way.
-- 2. The trigger: after an UPDATE that sets the login's email to another
--    address, once per row.
-- 3. The schema's COMMENT names the trigger beside Better Auth's connection.
-- 4. A closing check, in migration 201's shape: the trigger is on
--    better_auth."user" as written, the function is postgres's alone, and
--    nothing in schema better_auth grants anything to a role but its owner
--    (npm run check:rls clause 6 holds the same lock). It prints how many coach
--    and client rows hold an address other than their login's.
--
-- Nothing a coach or a client sees changes until an address does.
-- Re-runnable. Pure ASCII.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. The function.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION better_auth.copy_login_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, better_auth
AS $$
BEGIN
  UPDATE public.coaches SET email = NEW.email WHERE user_id = NEW.id AND email IS DISTINCT FROM NEW.email;
  UPDATE public.clients SET email = NEW.email WHERE user_id = NEW.id AND email IS DISTINCT FROM NEW.email;
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION better_auth.copy_login_email() IS
  'Copies a login''s new address to its coach row and its client row, inside the UPDATE that changed it (trigger login_email_follows, migration 210).';

REVOKE ALL ON FUNCTION better_auth.copy_login_email() FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. The trigger.
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS login_email_follows ON better_auth."user";
CREATE TRIGGER login_email_follows
  AFTER UPDATE OF email ON better_auth."user"
  FOR EACH ROW
  WHEN (OLD.email IS DISTINCT FROM NEW.email)
  EXECUTE FUNCTION better_auth.copy_login_email();

-- ---------------------------------------------------------------------------
-- 3. The schema's COMMENT.
-- ---------------------------------------------------------------------------
COMMENT ON SCHEMA better_auth IS
  'Better Auth''s tables (logins, sessions, credentials, one-time tokens, its rate limiter). Off the Data API: PostgREST serves public only. Reached by Better Auth''s own connection, and by migration 210''s trigger, which copies a login''s address to its coach and client rows.';

-- ---------------------------------------------------------------------------
-- 4. The closing check.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  found           text;
  stale_coaches   integer;
  stale_clients   integer;
BEGIN
  -- The trigger: on better_auth."user", enabled, after an UPDATE of the email
  -- column alone (tgtype 17: once per row, on UPDATE, not before; tgattr, an
  -- int2vector numbered from 0, holds that one column), only when the address
  -- changes, running the function.
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
     WHERE t.tgrelid = 'better_auth."user"'::regclass
       AND t.tgname = 'login_email_follows'
       AND NOT t.tgisinternal
       AND t.tgenabled = 'O'
       AND t.tgtype = 17
       AND t.tgfoid = 'better_auth.copy_login_email()'::regprocedure
       AND cardinality(t.tgattr::int2[]) = 1
       AND t.tgattr::int2[] @> ARRAY[(SELECT a.attnum FROM pg_attribute a
                                       WHERE a.attrelid = 'better_auth."user"'::regclass AND a.attname = 'email')]::int2[]
       AND t.tgqual IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Migration 210: trigger login_email_follows is not on better_auth."user" as written';
  END IF;

  -- The function: SECURITY DEFINER, postgres's, its search_path pinned.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
     WHERE p.oid = 'better_auth.copy_login_email()'::regprocedure
       AND p.prosecdef
       AND p.proowner = 'postgres'::regrole
       AND EXISTS (SELECT 1 FROM unnest(p.proconfig) AS setting WHERE setting LIKE 'search_path=%')
  ) THEN
    RAISE EXCEPTION 'Migration 210: better_auth.copy_login_email() is not SECURITY DEFINER, owned by postgres, with its search_path pinned';
  END IF;

  -- Nothing in better_auth grants a privilege to a role but its owner: no
  -- function (a NULL ACL is the default, EXECUTE for PUBLIC), no table or
  -- sequence, and not the schema.
  SELECT string_agg(item, '; ' ORDER BY item) INTO found
    FROM (
      SELECT format('%s -> %s: %s', p.oid::regprocedure,
                    CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END, a.privilege_type) AS item
        FROM pg_proc p
        CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
       WHERE p.pronamespace = 'better_auth'::regnamespace
         AND a.grantee <> p.proowner
      UNION ALL
      SELECT format('%s -> %s: %s', c.relname,
                    CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END, a.privilege_type)
        FROM pg_class c
        CROSS JOIN LATERAL aclexplode(c.relacl) a
       WHERE c.relnamespace = 'better_auth'::regnamespace
         AND a.grantee <> c.relowner
      UNION ALL
      SELECT format('schema better_auth -> %s: %s',
                    CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END, a.privilege_type)
        FROM pg_namespace n
        CROSS JOIN LATERAL aclexplode(n.nspacl) a
       WHERE n.nspname = 'better_auth'
         AND a.grantee <> n.nspowner
    ) x;
  IF found IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 210: a role other than the owner holds a privilege in better_auth: %', found;
  END IF;

  SELECT count(*) INTO stale_coaches FROM public.coaches c JOIN better_auth."user" u ON u.id = c.user_id
   WHERE c.email IS DISTINCT FROM u.email;
  SELECT count(*) INTO stale_clients FROM public.clients c JOIN better_auth."user" u ON u.id = c.user_id
   WHERE c.email IS DISTINCT FROM u.email;
  RAISE NOTICE 'Migration 210: % coach rows and % client rows hold an address other than their login''s', stale_coaches, stale_clients;
END $$;
