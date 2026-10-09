-- =============================================================================
-- 213_google_links.sql -- a login's Google links go when its address changes,
-- and one Google account links to one login (docs/BETTER-AUTH-PLAN.md section 6
-- commit 7's follow-up, owner's go 2026-10-09).
--
-- Better Auth 1.7.7 finds a Google sign-in's login by the Google account first
-- (findAccountOwnerByKey: its account row, keyed by "providerId" and
-- "accountId"), and by address only when no row is found. A Google account
-- linked to a login therefore kept signing it in after the login's address
-- changed: a coach who linked a work Google account and then changed their
-- login to a personal address could still be signed in by whoever controls
-- the work account. Every path that changes an address (verify-email's second
-- link of a change of email, the owner's npm run auth:move-email, the admin
-- plugin's update-user, SQL) is one UPDATE of better_auth."user", which
-- migration 210's trigger already answers.
--
-- 1. The trigger's function becomes better_auth.follow_login_email(): it copies
--    the new address to the login's coach row and client row, as
--    copy_login_email did, and deletes every account row of the login but its
--    password (providerId credential), inside the statement that changed the
--    address. A change that fails (a copy meets coaches.email's UNIQUE key)
--    keeps the links too. Afterwards the new address's own Google account
--    links again by address, as any first Google sign-in does, and the old
--    one's finds no login. SECURITY DEFINER, its search_path pinned, executable
--    by no role, as before; the old function goes.
-- 2. The trigger runs it: after an UPDATE that sets the login's email to
--    another address, once per row, as migration 210 made it.
-- 3. A UNIQUE key on better_auth.account ("providerId", "accountId"). Better
--    Auth reads at most two rows by that pair and throws on two ("Multiple
--    accounts match"), refusing that Google account's every sign-in, and two
--    first sign-ins of one Google account at the same instant could both
--    write a row. Under the key the second write fails: that one sign-in lands
--    on /login?error=unable_to_link_account ("Couldn't sign in with Google.
--    Try again.", and Sentry), and the next finds the link. The key's index
--    serves Better Auth's lookup, which read the whole table. A password row
--    (credential, the login's own id) is one per login under it too.
-- 4. The schema's COMMENT names what the trigger does, beside migration 211's
--    delete_coach_records, the other writer there.
-- 5. A closing check, in migration 210's shape: the trigger runs the new
--    function, the old one is gone, the new one is postgres's alone with its
--    search_path pinned, the key is unique and valid on its two columns, and
--    nothing in schema better_auth grants anything to a role but its owner
--    (npm run check:rls clause 6 holds the same lock). It prints how many
--    provider links there are.
--
-- Nothing a coach or a client sees changes until an address does. Re-runnable.
-- Pure ASCII.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. The function.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION better_auth.follow_login_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, better_auth
AS $$
BEGIN
  UPDATE public.coaches SET email = NEW.email WHERE user_id = NEW.id AND email IS DISTINCT FROM NEW.email;
  UPDATE public.clients SET email = NEW.email WHERE user_id = NEW.id AND email IS DISTINCT FROM NEW.email;
  DELETE FROM better_auth.account WHERE "userId" = NEW.id AND "providerId" <> 'credential';
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION better_auth.follow_login_email() IS
  'A login''s new address, inside the UPDATE that changed it (trigger login_email_follows): copied to its coach row and its client row (migration 210), and every account row of the login but its password deleted, so a Google account linked on the old address no longer signs it in (migration 213).';

REVOKE ALL ON FUNCTION better_auth.follow_login_email() FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. The trigger.
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS login_email_follows ON better_auth."user";
CREATE TRIGGER login_email_follows
  AFTER UPDATE OF email ON better_auth."user"
  FOR EACH ROW
  WHEN (OLD.email IS DISTINCT FROM NEW.email)
  EXECUTE FUNCTION better_auth.follow_login_email();

DROP FUNCTION IF EXISTS better_auth.copy_login_email();

-- ---------------------------------------------------------------------------
-- 3. The key.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS account_provider_id_account_id_key
  ON better_auth.account ("providerId", "accountId");

COMMENT ON INDEX better_auth.account_provider_id_account_id_key IS
  'One row per provider account: a Google account links to one login, and a login has one password row. Serves Better Auth''s lookup of a sign-in''s account (migration 213).';

-- ---------------------------------------------------------------------------
-- 4. The schema's COMMENT.
-- ---------------------------------------------------------------------------
COMMENT ON SCHEMA better_auth IS
  'Better Auth''s tables (logins, sessions, credentials, one-time tokens, its rate limiter). Off the Data API: PostgREST serves public only. Reached by Better Auth''s own connection, by the trigger login_email_follows (migrations 210 and 213), which copies a login''s new address to its coach and client rows and deletes its Google links, and by migration 211''s public.delete_coach_records, which deletes a deleted coach''s clients'' logins.';

-- ---------------------------------------------------------------------------
-- 5. The closing check.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  found           text;
  provider_links  integer;
BEGIN
  -- The trigger: on better_auth."user", enabled, after an UPDATE of the email
  -- column alone (tgtype 17: once per row, on UPDATE, not before; tgattr, an
  -- int2vector numbered from 0, holds that one column), only when the address
  -- changes, running the new function.
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
     WHERE t.tgrelid = 'better_auth."user"'::regclass
       AND t.tgname = 'login_email_follows'
       AND NOT t.tgisinternal
       AND t.tgenabled = 'O'
       AND t.tgtype = 17
       AND t.tgfoid = 'better_auth.follow_login_email()'::regprocedure
       AND cardinality(t.tgattr::int2[]) = 1
       AND t.tgattr::int2[] @> ARRAY[(SELECT a.attnum FROM pg_attribute a
                                       WHERE a.attrelid = 'better_auth."user"'::regclass AND a.attname = 'email')]::int2[]
       AND t.tgqual IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Migration 213: trigger login_email_follows is not on better_auth."user" as written';
  END IF;

  IF to_regprocedure('better_auth.copy_login_email()') IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 213: better_auth.copy_login_email() is still there';
  END IF;

  -- The function: SECURITY DEFINER, postgres's, its search_path pinned.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
     WHERE p.oid = 'better_auth.follow_login_email()'::regprocedure
       AND p.prosecdef
       AND p.proowner = 'postgres'::regrole
       AND EXISTS (SELECT 1 FROM unnest(p.proconfig) AS setting WHERE setting LIKE 'search_path=%')
  ) THEN
    RAISE EXCEPTION 'Migration 213: better_auth.follow_login_email() is not SECURITY DEFINER, owned by postgres, with its search_path pinned';
  END IF;

  -- The key: unique, valid, on "providerId" then "accountId" alone (indkey, an
  -- int2vector numbered from 0), with no WHERE and no expression.
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i
     WHERE i.indexrelid = 'better_auth.account_provider_id_account_id_key'::regclass
       AND i.indrelid = 'better_auth.account'::regclass
       AND i.indisunique
       AND i.indisvalid
       AND i.indpred IS NULL
       AND i.indexprs IS NULL
       AND i.indnatts = 2
       AND i.indkey[0] = (SELECT a.attnum FROM pg_attribute a WHERE a.attrelid = 'better_auth.account'::regclass AND a.attname = 'providerId')
       AND i.indkey[1] = (SELECT a.attnum FROM pg_attribute a WHERE a.attrelid = 'better_auth.account'::regclass AND a.attname = 'accountId')
  ) THEN
    RAISE EXCEPTION 'Migration 213: better_auth.account_provider_id_account_id_key is not a valid unique key on ("providerId", "accountId")';
  END IF;

  -- Nothing in better_auth grants a privilege to a role but its owner: no
  -- function (a NULL ACL is the default, EXECUTE for PUBLIC), no table, index
  -- or sequence, and not the schema.
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
    RAISE EXCEPTION 'Migration 213: a role other than the owner holds a privilege in better_auth: %', found;
  END IF;

  SELECT count(*) INTO provider_links FROM better_auth.account WHERE "providerId" <> 'credential';
  RAISE NOTICE 'Migration 213: % provider links (Google accounts linked to a login)', provider_links;
END $$;
