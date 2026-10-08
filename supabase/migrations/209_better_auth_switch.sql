-- =============================================================================
-- 209_better_auth_switch.sql -- the user keys point at Better Auth's logins,
-- and Supabase's sign-up trigger goes (docs/BETTER-AUTH-PLAN.md section 2.1
-- and section 6 commit 2).
--
-- From this migration every sign-in runs on Better Auth (lib/auth.ts): the
-- proxy and the auth seam read Better Auth's session, and a login is made only
-- by the admin plugin's create-user, which the client invite calls on the
-- server and which writes the login's profile and client link in the same
-- request (services/login-service.ts). Nothing inserts into auth.users any
-- more, so nothing would fire the trigger, and the role comes from the path
-- that makes the login.
--
-- 1. The copy again: logins Supabase made, and passwords it changed, after
--    migration 208 ran (on DEV the days between commits 1 and 2; on PROD 208
--    and 209 land in one push and this changes nothing). Migration 208's two
--    copy INSERTs verbatim, then every copied bcrypt hash brought level with
--    Supabase's. A scrypt password set through Better Auth is never touched.
-- 2. The three user keys (profiles, coaches, clients) re-pointed from
--    auth.users to better_auth."user" with their ON DELETE actions unchanged
--    (004, 021, 023), and coaches.user_id held unique by a constraint.
-- 3. Supabase's sign-up trigger and its function (025, rewritten in 107)
--    dropped, with the table privileges 025 gave supabase_auth_admin.
-- 4. A closing check: the copy complete, the three keys on better_auth, no key
--    in public on auth.users, the unique constraint, the trigger, the function
--    and supabase_auth_admin's privileges gone. It prints the counts.
--
-- The undo is section 8.3 of the plan: Supabase's rows are never touched here.
-- Pure ASCII.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. The copy again.
-- ---------------------------------------------------------------------------
INSERT INTO better_auth."user" (id, name, email, "emailVerified", image, "createdAt", "updatedAt", banned, "banExpires")
SELECT u.id,
       coalesce((SELECT c.name FROM public.coaches c WHERE c.user_id = u.id ORDER BY c.created_at DESC, c.id LIMIT 1),
                (SELECT cl.name FROM public.clients cl WHERE cl.user_id = u.id ORDER BY cl.created_at DESC, cl.id LIMIT 1),
                nullif(u.raw_user_meta_data->>'name', ''),
                nullif(u.raw_user_meta_data->>'full_name', ''),
                split_part(u.email, '@', 1)),
       lower(u.email),
       true,
       nullif(u.raw_user_meta_data->>'avatar_url', ''),
       u.created_at,
       coalesce(u.updated_at, u.created_at),
       (u.banned_until IS NOT NULL AND u.banned_until > now()),
       CASE WHEN u.banned_until > now() THEN u.banned_until END
FROM auth.users u
WHERE u.email IS NOT NULL
ON CONFLICT (id) DO NOTHING;

INSERT INTO better_auth.account (id, "userId", "accountId", "providerId", password, "createdAt", "updatedAt")
SELECT gen_random_uuid(), u.id, u.id::text, 'credential', u.encrypted_password, u.created_at, coalesce(u.updated_at, u.created_at)
FROM auth.users u
WHERE u.email IS NOT NULL AND coalesce(u.encrypted_password, '') <> ''
  AND NOT EXISTS (SELECT 1 FROM better_auth.account a WHERE a."userId" = u.id AND a."providerId" = 'credential');

-- A password Supabase changed after 208 copied it. Only a copied hash
-- (bcrypt, $2...) is brought level; a scrypt one was set through Better Auth.
UPDATE better_auth.account a SET password = u.encrypted_password, "updatedAt" = now()
  FROM auth.users u
 WHERE a."userId" = u.id AND a."providerId" = 'credential' AND a.password LIKE '$2%'
   AND coalesce(u.encrypted_password, '') <> '' AND a.password IS DISTINCT FROM u.encrypted_password;

-- From this migration the admin plugin's create-user (the client invite) makes
-- every login, with the plugin's role user.
COMMENT ON COLUMN better_auth."user".role IS
  'The admin plugin''s role: user for a login it makes, empty for a copied one. The app''s role is public.profiles.role.';

-- ---------------------------------------------------------------------------
-- 2. The three user keys.
-- ---------------------------------------------------------------------------
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT c.conname, c.conrelid::regclass AS tbl FROM pg_constraint c
            WHERE c.contype = 'f' AND c.confrelid = 'auth.users'::regclass
              AND c.conrelid IN ('public.profiles'::regclass, 'public.coaches'::regclass, 'public.clients'::regclass)
  LOOP EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tbl, r.conname); END LOOP;
END $$;

-- Today's ON DELETE actions. ADD CONSTRAINT validates every row: a user_id
-- with no copied login fails the migration loudly instead of leaving a
-- dangling key.
ALTER TABLE public.profiles ADD CONSTRAINT profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES better_auth."user"(id) ON DELETE CASCADE;
ALTER TABLE public.coaches  ADD CONSTRAINT coaches_user_id_fkey  FOREIGN KEY (user_id) REFERENCES better_auth."user"(id) ON DELETE CASCADE;
ALTER TABLE public.clients  ADD CONSTRAINT clients_user_id_fkey  FOREIGN KEY (user_id) REFERENCES better_auth."user"(id) ON DELETE SET NULL;

-- One coach row per login, which the auth seam reads by user_id and which no
-- migration made: DEV holds it as a constraint made outside the migrations
-- (CONVENTIONS section 8, "A destructive change re-probes PROD first"). A
-- constraint, not a bare index, so both databases end the same; an index
-- already named so becomes the constraint's.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.coaches'::regclass AND conname = 'coaches_user_id_key') THEN
    IF to_regclass('public.coaches_user_id_key') IS NOT NULL THEN
      ALTER TABLE public.coaches ADD CONSTRAINT coaches_user_id_key UNIQUE USING INDEX coaches_user_id_key;
    ELSE
      ALTER TABLE public.coaches ADD CONSTRAINT coaches_user_id_key UNIQUE (user_id);
    END IF;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Supabase's sign-up trigger, its function, and what 025 gave
--    supabase_auth_admin (025 lines 54-55) to run it.
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();
REVOKE ALL ON TABLE public.profiles, public.coaches FROM supabase_auth_admin;

-- ---------------------------------------------------------------------------
-- 4. The closing check.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  logins            integer;
  copied_logins     integer;
  missing_logins    integer;
  missing_passwords integer;
  behind_passwords  integer;
  found             text;
BEGIN
  SELECT count(*) INTO logins FROM auth.users u WHERE u.email IS NOT NULL;
  SELECT count(*) INTO copied_logins FROM better_auth."user";
  SELECT count(*) INTO missing_logins FROM auth.users u
   WHERE u.email IS NOT NULL AND NOT EXISTS (SELECT 1 FROM better_auth."user" b WHERE b.id = u.id);
  SELECT count(*) INTO missing_passwords FROM auth.users u
   WHERE u.email IS NOT NULL AND coalesce(u.encrypted_password, '') <> ''
     AND NOT EXISTS (SELECT 1 FROM better_auth.account a WHERE a."userId" = u.id AND a."providerId" = 'credential');
  SELECT count(*) INTO behind_passwords FROM better_auth.account a JOIN auth.users u ON u.id = a."userId"
   WHERE a."providerId" = 'credential' AND a.password LIKE '$2%'
     AND coalesce(u.encrypted_password, '') <> '' AND a.password IS DISTINCT FROM u.encrypted_password;
  RAISE NOTICE 'Migration 209: auth.users holds % logins with an email; better_auth holds % logins', logins, copied_logins;
  IF missing_logins <> 0 OR missing_passwords <> 0 OR behind_passwords <> 0 THEN
    RAISE EXCEPTION 'Migration 209: copy incomplete: % logins, % passwords missing, % copied passwords behind Supabase''s',
      missing_logins, missing_passwords, behind_passwords;
  END IF;

  SELECT string_agg(format('%s.%s', t.relname, c.confdeltype), '; ' ORDER BY t.relname) INTO found
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
   WHERE c.contype = 'f' AND c.confrelid = 'better_auth."user"'::regclass
     AND c.conrelid IN ('public.profiles'::regclass, 'public.coaches'::regclass, 'public.clients'::regclass);
  IF found IS DISTINCT FROM 'clients.n; coaches.c; profiles.c' THEN
    RAISE EXCEPTION 'Migration 209: the user keys on better_auth."user" are not the three expected (clients SET NULL, coaches and profiles CASCADE): %', found;
  END IF;

  SELECT string_agg(format('%s.%s', c.conrelid::regclass, c.conname), '; ') INTO found
    FROM pg_constraint c
   WHERE c.contype = 'f' AND c.confrelid = 'auth.users'::regclass AND c.connamespace = 'public'::regnamespace;
  IF found IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 209: a key in public still points at auth.users: %', found;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.coaches'::regclass AND conname = 'coaches_user_id_key' AND contype = 'u'
                    AND conkey = ARRAY[(SELECT attnum FROM pg_attribute
                                         WHERE attrelid = 'public.coaches'::regclass AND attname = 'user_id')]) THEN
    RAISE EXCEPTION 'Migration 209: coaches.user_id is not held unique by coaches_user_id_key';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'on_auth_user_created' AND tgrelid = 'auth.users'::regclass)
     OR EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'handle_new_user' AND pronamespace = 'public'::regnamespace) THEN
    RAISE EXCEPTION 'Migration 209: Supabase''s sign-up trigger or its function is still there';
  END IF;

  SELECT string_agg(format('%s: %s', c.relname, a.privilege_type), '; ' ORDER BY c.relname, a.privilege_type) INTO found
    FROM pg_class c
    CROSS JOIN LATERAL aclexplode(c.relacl) a
   WHERE c.oid IN ('public.profiles'::regclass, 'public.coaches'::regclass)
     AND a.grantee = 'supabase_auth_admin'::regrole;
  IF found IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 209: supabase_auth_admin still holds %', found;
  END IF;
END $$;
