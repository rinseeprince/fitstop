-- =============================================================================
-- 208_better_auth_schema.sql -- Better Auth's tables, and today's logins copied
-- in (docs/BETTER-AUTH-PLAN.md section 2.1 and section 6 commit 1).
--
-- Better Auth keeps its logins, sessions, credentials, one-time tokens and
-- rate-limit counters in five tables of its own. They live in schema
-- better_auth, under Better Auth 1.7.7's own table and column names (camelCase,
-- quoted; "user" is a reserved word and is quoted in every statement).
-- PostgREST serves public alone, so the Data API cannot reach these tables
-- with any key: only Better Auth's own connection (the postgres user through
-- Supabase's transaction pooler, lib/auth.ts), which owns them, reads or
-- writes them. Every id is a uuid the database makes, so today's user ids
-- carry over and a new login's id has the same type as every user_id that
-- will point at it.
--
-- 1. The schema and the five tables. RLS on, no policies, and no privilege
--    for any role but the owner: nothing but Better Auth's connection reads
--    them.
-- 2. Today's logins, copied from auth.users on today's ids, each with its
--    Supabase bcrypt hash as a credential (lib/auth.ts checks a bcrypt hash
--    with bcryptjs and every other with Better Auth's scrypt). Born verified:
--    Supabase never required it here, and refusing a login that works today
--    would lock people out. Rerunnable: ON CONFLICT / NOT EXISTS.
-- 3. A closing check: every login and every password copied as Supabase holds
--    it, RLS on, and no role but the owner holding a privilege. It prints the
--    counts.
--
-- Additive: every sign-in still runs on Supabase Auth, and nothing reads these
-- tables but Better Auth's routes under /api/auth until the switch (migration
-- 209 with commit 2). Pure ASCII.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. The schema and the five tables.
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS better_auth;
REVOKE ALL ON SCHEMA better_auth FROM PUBLIC;
COMMENT ON SCHEMA better_auth IS
  'Better Auth''s tables (logins, sessions, credentials, one-time tokens, its rate limiter). Off the Data API: PostgREST serves public only. Reached by Better Auth''s own connection, which owns them.';

CREATE TABLE IF NOT EXISTS better_auth."user" (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  email           TEXT NOT NULL UNIQUE,
  "emailVerified" BOOLEAN NOT NULL DEFAULT false,
  image           TEXT,
  "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"     TIMESTAMPTZ NOT NULL DEFAULT now(),
  role            TEXT,
  banned          BOOLEAN NOT NULL DEFAULT false,
  "banReason"     TEXT,
  "banExpires"    TIMESTAMPTZ
);

COMMENT ON TABLE better_auth."user" IS
  'A login: one per person who signs in. Its id is the user_id of profiles, coaches and clients. Written by Better Auth.';
COMMENT ON COLUMN better_auth."user".email IS
  'Stored lowercased: Better Auth lowercases every address it writes or looks up.';
COMMENT ON COLUMN better_auth."user"."emailVerified" IS
  'Sign-in refuses a login whose address is not verified. Every copied login is born verified.';
COMMENT ON COLUMN better_auth."user".role IS
  'The admin plugin''s role, empty for everyone. The app''s role is public.profiles.role.';
COMMENT ON COLUMN better_auth."user".banned IS
  'The admin plugin''s ban, with "banReason" and "banExpires".';

CREATE TABLE IF NOT EXISTS better_auth.session (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId"         UUID NOT NULL REFERENCES better_auth."user"(id) ON DELETE CASCADE,
  token            TEXT NOT NULL UNIQUE,
  "expiresAt"      TIMESTAMPTZ NOT NULL,
  "ipAddress"      TEXT,
  "userAgent"      TEXT,
  "impersonatedBy" TEXT,
  "createdAt"      TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS session_user_id_idx ON better_auth.session ("userId");

COMMENT ON TABLE better_auth.session IS
  'A signed-in device. Its token is the session cookie''s value and the bearer token. Deleted on sign-out; gone with its login.';
COMMENT ON COLUMN better_auth.session."impersonatedBy" IS
  'The admin plugin''s: the admin acting as this login. Empty for every session.';

CREATE TABLE IF NOT EXISTS better_auth.account (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId"                UUID NOT NULL REFERENCES better_auth."user"(id) ON DELETE CASCADE,
  "accountId"             TEXT NOT NULL,
  "providerId"            TEXT NOT NULL,
  "accessToken"           TEXT,
  "refreshToken"          TEXT,
  "idToken"               TEXT,
  "accessTokenExpiresAt"  TIMESTAMPTZ,
  "refreshTokenExpiresAt" TIMESTAMPTZ,
  scope                   TEXT,
  password                TEXT,
  "createdAt"             TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS account_user_id_idx ON better_auth.account ("userId");

COMMENT ON TABLE better_auth.account IS
  'A way a login signs in: its password (providerId credential, accountId the user id) or a provider''s account.';
COMMENT ON COLUMN better_auth.account.password IS
  'Supabase''s bcrypt hash for a copied login; Better Auth''s scrypt for every password set through Better Auth.';

CREATE TABLE IF NOT EXISTS better_auth.verification (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier  TEXT NOT NULL,
  value       TEXT NOT NULL,
  "expiresAt" TIMESTAMPTZ NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS verification_identifier_idx ON better_auth.verification (identifier);

COMMENT ON TABLE better_auth.verification IS
  'A one-time token Better Auth emailed (a password reset, an email change, a deletion), keyed by its kind and token in identifier. Used once.';

CREATE TABLE IF NOT EXISTS better_auth."rateLimit" (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key           TEXT NOT NULL UNIQUE,
  count         INTEGER NOT NULL,
  "lastRequest" BIGINT NOT NULL
);

COMMENT ON TABLE better_auth."rateLimit" IS
  'Better Auth''s limiter on /api/auth (rateLimit.storage database), one row per address and path. key is unique: two first requests at once insert one row, and the loser re-reads it.';
COMMENT ON COLUMN better_auth."rateLimit"."lastRequest" IS
  'Milliseconds since the epoch, as Better Auth writes it.';

ALTER TABLE better_auth."user"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE better_auth.session      ENABLE ROW LEVEL SECURITY;
ALTER TABLE better_auth.account      ENABLE ROW LEVEL SECURITY;
ALTER TABLE better_auth.verification ENABLE ROW LEVEL SECURITY;
ALTER TABLE better_auth."rateLimit"  ENABLE ROW LEVEL SECURITY;

-- The owner (postgres, Better Auth's connection) is the only role that needs
-- them; RLS does not bind it. No default privilege reaches this schema today;
-- the REVOKE makes that explicit in source whatever the defaults say.
REVOKE ALL ON TABLE better_auth."user", better_auth.session, better_auth.account,
                    better_auth.verification, better_auth."rateLimit"
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Today's logins, on today's ids. Name: the coach row, else the newest
--    client row, else what sign-up stored, else the address's local part.
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

-- ---------------------------------------------------------------------------
-- 3. The closing check.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  logins            integer;
  passwords         integer;
  copied_logins     integer;
  copied_passwords  integer;
  bcrypt_passwords  integer;
  missing_logins    integer;
  missing_passwords integer;
  differing         integer;
  found             text;
BEGIN
  SELECT count(*) INTO logins FROM auth.users u WHERE u.email IS NOT NULL;
  SELECT count(*) INTO passwords FROM auth.users u
   WHERE u.email IS NOT NULL AND coalesce(u.encrypted_password, '') <> '';
  SELECT count(*) INTO copied_logins FROM better_auth."user";
  SELECT count(*), count(*) FILTER (WHERE a.password LIKE '$2%')
    INTO copied_passwords, bcrypt_passwords
    FROM better_auth.account a WHERE a."providerId" = 'credential';
  RAISE NOTICE 'Migration 208: auth.users holds % logins with an email, % with a password; better_auth holds % logins and % password credentials (% bcrypt)',
    logins, passwords, copied_logins, copied_passwords, bcrypt_passwords;

  SELECT count(*) INTO missing_logins FROM auth.users u
   WHERE u.email IS NOT NULL AND NOT EXISTS (SELECT 1 FROM better_auth."user" b WHERE b.id = u.id);
  SELECT count(*) INTO missing_passwords FROM auth.users u
   WHERE u.email IS NOT NULL AND coalesce(u.encrypted_password, '') <> ''
     AND NOT EXISTS (SELECT 1 FROM better_auth.account a WHERE a."userId" = u.id AND a."providerId" = 'credential');
  IF missing_logins <> 0 OR missing_passwords <> 0 THEN
    RAISE EXCEPTION 'Migration 208: copy incomplete: % logins, % passwords missing', missing_logins, missing_passwords;
  END IF;

  -- A copied row is the login Supabase holds: its address, and its hash with
  -- the account keyed the way Better Auth's sign-in finds it.
  SELECT count(*) INTO differing FROM auth.users u
    JOIN better_auth."user" b ON b.id = u.id
    LEFT JOIN better_auth.account a ON a."userId" = u.id AND a."providerId" = 'credential'
   WHERE u.email IS NOT NULL
     AND (b.email <> lower(u.email)
          OR (coalesce(u.encrypted_password, '') <> ''
              AND (a.password IS DISTINCT FROM u.encrypted_password OR a."accountId" <> u.id::text)));
  IF differing <> 0 THEN
    RAISE EXCEPTION 'Migration 208: % copied logins differ from auth.users (address, password or account key)', differing;
  END IF;

  SELECT string_agg(c.relname, '; ' ORDER BY c.relname) INTO found
    FROM pg_class c
   WHERE c.relnamespace = 'better_auth'::regnamespace
     AND c.relkind IN ('r', 'p')
     AND NOT c.relrowsecurity;
  IF found IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 208: tables without RLS: %', found;
  END IF;

  SELECT string_agg(item, '; ' ORDER BY item) INTO found
    FROM (
      SELECT format('%s -> %s: %s', c.relname,
                    CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END, a.privilege_type) AS item
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
    RAISE EXCEPTION 'Migration 208: a role other than the owner holds a privilege: %', found;
  END IF;
END $$;
