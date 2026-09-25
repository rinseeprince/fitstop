-- The database is locked: no policy, no public-role privilege
-- (docs/DATA-ACCESS-LOCKDOWN-PLAN.md §6 commit 6).
--
-- Since commit 5 (534d852b, 2026-09-25) every query, database function call
-- and storage call the app makes is the service role's, filtered in code by
-- the coach or client id the route or the middleware verified; a session
-- client — the browser's, a route's, the middleware's — calls auth.* alone
-- (lib/session-client-ownership.test.ts holds the tree to it). No rule in the
-- database governs an app read any more, so every policy and every anon or
-- authenticated privilege is a door only the browser-shipped public key can
-- open: a signed-in user could still read, through /rest/v1 with their own
-- token, whatever the 46 SELECT rules let them see. This migration closes that
-- door. RLS stays enabled on every table and becomes the lock, not a rule set:
-- with no policy, only a role that bypasses it (service_role) reads or writes.
--
-- Probed 2026-09-25 on DEV (aeaphsslctwcmebldrzx, at 200) and PROD
-- (etezzztgafcotyahgijk, at 184; 185–200 queue before this file):
--   policies    DEV 47 in public (46 SELECT + activation's UPDATE) and 6 on
--               storage.objects; PROD 104 in public (its 56 write rules go
--               with 200, then 48 SELECT) and 3 on storage.objects. All
--               PERMISSIVE, so every drop narrows access.
--   privileges  anon on 42/44 relations, authenticated on 46/48 (DEV/PROD):
--               the stock GRANT ALL on every table created before CONVENTIONS
--               §8's new-table rule and on the view daily_logs_full, plus
--               authenticated's SELECT on client_measurements and its three
--               views (migration 158). No PUBLIC grant, no column grant, no
--               sequence. client_notes and client_phases carried the stock
--               grants too, whatever their migrations meant.
--   defaults    pg_default_acl for the role the migrations run as (postgres)
--               hands ALL on a new table and sequence, and EXECUTE on a new
--               function, to anon, authenticated and service_role.
--   functions   19 (DEV) / 15 (PROD) SECURITY DEFINER functions in public,
--               all owned by postgres, every one already service_role-only in
--               migration 106's shape — except handle_new_user(), the auth
--               trigger, executable by PUBLIC, and PROD's rls_auto_enable()
--               event-trigger function.
--   callers     pg_stat_statements holds, under anon and authenticated, only
--               the app's own former session reads (moved by commits 3–5) and
--               the 2026-07 audits' probes, on DEV; nothing on PROD, where the
--               marketing site writes waitlist_signups as service_role.
--
-- In order:
--   1. every policy in public and storage is dropped, by a loop over
--      pg_policies — not by name: a name the dashboard drifted would skip
--      silently (migration 125), and DEV and PROD do not hold the same set
--   2. anon, authenticated and PUBLIC lose every privilege on every table,
--      view and sequence in public; schema USAGE stays
--   3. the default privileges that would hand a new table or sequence to them
--      are revoked for the role the migrations create tables as (postgres) —
--      a new table arrives closed; CONVENTIONS §8's per-table REVOKE stays as
--      the belt. supabase_admin's defaults are not ours to change and govern
--      nothing a migration creates
--   4. every SECURITY DEFINER function in public is executable by service_role
--      alone; the auth trigger handle_new_user() also keeps supabase_auth_admin,
--      the role GoTrue inserts auth.users as (its table grants from migration
--      025 stay)
--   5. a closing check raises unless public and storage hold no policy, anon
--      and authenticated hold no privilege — explicit or through PUBLIC — on
--      any public relation or column, postgres's default privileges hand them
--      nothing, no SECURITY DEFINER function is executable by them, and RLS is
--      on for every table
--
-- Nothing a coach or a client sees changes. Re-runnable: every step is
-- idempotent. `npm run check:rls` clauses 4 and 5 hold the result.

-- 1. Every policy in public and storage
DO $$
DECLARE
  r record;
  dropped integer := 0;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname
      FROM pg_policies
     WHERE schemaname IN ('public', 'storage')
     ORDER BY schemaname, tablename, policyname
  LOOP
    EXECUTE format('DROP POLICY %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
    dropped := dropped + 1;
  END LOOP;
  RAISE NOTICE 'Migration 201: dropped % policies', dropped;
END $$;

-- 2. No public-role privilege on any table, view or sequence in public
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, anon, authenticated;

-- 3. A new table or sequence arrives closed
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;

-- 4. Every SECURITY DEFINER function: service_role alone (the auth trigger
--    also supabase_auth_admin)
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig, p.proname
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prosecdef
     ORDER BY 1
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
    IF r.proname = 'handle_new_user' THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO supabase_auth_admin', r.sig);
      RAISE NOTICE 'Migration 201: % is executable by service_role and supabase_auth_admin', r.sig;
    ELSE
      RAISE NOTICE 'Migration 201: % is executable by service_role alone', r.sig;
    END IF;
  END LOOP;
END $$;

-- 5. The closing check
DO $$
DECLARE
  found text;
BEGIN
  SELECT string_agg(format('%s.%s "%s"', schemaname, tablename, policyname), '; ' ORDER BY schemaname, tablename, policyname)
    INTO found
    FROM pg_policies
   WHERE schemaname IN ('public', 'storage');
  IF found IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 201: policies remain: %', found;
  END IF;

  SELECT string_agg(item, '; ' ORDER BY item)
    INTO found
    FROM (
      SELECT format('%s.%s -> %s: %s', n.nspname, c.relname,
                    CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END, a.privilege_type) AS item
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        CROSS JOIN LATERAL aclexplode(c.relacl) a
       WHERE n.nspname = 'public'
         AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
         AND (a.grantee = 0 OR pg_get_userbyid(a.grantee) IN ('anon', 'authenticated'))
      UNION ALL
      SELECT format('%s.%s.%s -> %s: %s', n.nspname, c.relname, att.attname,
                    CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END, a.privilege_type)
        FROM pg_attribute att
        JOIN pg_class c ON c.oid = att.attrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        CROSS JOIN LATERAL aclexplode(att.attacl) a
       WHERE n.nspname = 'public'
         AND att.attacl IS NOT NULL
         AND (a.grantee = 0 OR pg_get_userbyid(a.grantee) IN ('anon', 'authenticated'))
    ) x;
  IF found IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 201: anon/authenticated privileges remain: %', found;
  END IF;

  SELECT string_agg(format('%s -> %s: %s',
                           CASE d.defaclobjtype WHEN 'r' THEN 'TABLES' WHEN 'S' THEN 'SEQUENCES' ELSE d.defaclobjtype::text END,
                           CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END, a.privilege_type), '; ')
    INTO found
    FROM pg_default_acl d
    CROSS JOIN LATERAL aclexplode(d.defaclacl) a
   WHERE d.defaclrole = 'postgres'::regrole
     AND d.defaclnamespace = 'public'::regnamespace
     AND d.defaclobjtype IN ('r', 'S')
     AND (a.grantee = 0 OR pg_get_userbyid(a.grantee) IN ('anon', 'authenticated'));
  IF found IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 201: default privileges still hand a new relation to a public role: %', found;
  END IF;

  SELECT string_agg(p.oid::regprocedure::text, '; ' ORDER BY p.oid::regprocedure::text)
    INTO found
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.prosecdef
     AND (has_function_privilege('anon', p.oid, 'EXECUTE')
       OR has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  IF found IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 201: SECURITY DEFINER functions executable by a public role: %', found;
  END IF;

  SELECT string_agg(c.relname, '; ' ORDER BY c.relname)
    INTO found
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relkind IN ('r', 'p')
     AND NOT c.relrowsecurity;
  IF found IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 201: tables without RLS: %', found;
  END IF;
END $$;
