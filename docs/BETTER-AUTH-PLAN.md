# Better Auth — every login moves off Supabase Auth, and the account screens that were never built

**Status: PLAN, nothing built (2026-10-08).** Eleven commits (§6: 1 to 9, 5.1 and 5.5), each with a pasteable prompt, each gated.
**The logins move in commits 1–3.** Better Auth stands up beside Supabase Auth with today's logins and their
password hashes copied in (1); every sign-in, the invite, forgot password and reset switch over, and the user
keys move (2); the seed and proof scripts make their logins through Better Auth (3). **The account features are
commits 4–8:** the owner creates a coach and the coach sets a password from an email (4); change password, change
email, sign out everywhere (5); every screen and email says the product's name, Atletafit (5.1); a client changes
their email too, every copy of an address follows it in one write, and the owner moves the login of someone who
lost their inbox (5.5); delete account (6); Continue with Google (7);
the server ready for the client app (8). **Commit 9** writes the docs and the PROD runbook. This plan adds
migrations 208, 209, 210 and 211: DEV and PROD hold 208 and 209 (PROD since 2026-10-08), and PROD takes 210 and 211
by §8.2. **Billing is not here:** Better Auth's
Stripe plugin later adds one column and one table and touches nothing this plan builds (D27). Every file and line
named here was grepped on 2026-10-07 at `d5f23299`; every Better Auth fact is from its docs and source at
**1.7.7** (§2.9), the version commit 1 pins.

**The owner's model, in their words (2026-10-07):** "I need to build out better auth … i haven't even built a way
for coaches to even sign up, manage their account, delete their account, change passwords, forgot passwords etc.";
"can I still manually sign clients up without them following through a payment flow? For free trials/free
accounts"; "give me the full prompt for the better auth and to leave stripe". **The four answers given today**
(D1–D4): only coaches the owner invites can have a coach account; deleting a coach deletes their clients, their
records and their logins; clients may sign in with Google (sign in only); an email address is verified before its
first sign-in, and an account made through an emailed link counts as verified.

**Scope:** the move of every login (coaches, clients, the owner's own) to Better Auth on the same user ids and the
same passwords; the login, forgot-password, reset-password, set-password and invite screens on Better Auth; the
owner's `coach:create` command and its email; an Account card on the coach's Settings (change password, change
email, sign out everywhere, delete account) and on the client's Settings (change password, change email, delete
account); a login's address the same everywhere it shows, changed in one write; the owner's `auth:move-email`
command for a lost inbox; the product's name, Atletafit, on every screen, email and tab title (5.1, D30); Continue
with Google for sign-in; Better Auth's bearer and Expo plugins switched on and proven, so the client app can be
built on them; the retirement of Supabase Auth; docs; seven smokes. **Not in scope:** billing (D27 leaves the room);
the React Native app itself; the coach chat's Claude connector (rebuilt on Better Auth's MCP plugin by its own plan
later; §9.3 lists what it will need); a list of signed-in devices; a lockout per account (TECHNICAL-DEBT :282 stays
open); a data export before deletion; a coach deleting a client's records (a client deletes their own);
two-factor; magic links; a recovery email address (D39: the owner's `auth:move-email` serves a lost inbox).

**How this plan is used.** Each commit's prompt tells a fresh session to read `CONVENTIONS.md` whole, this file's
head, §1–§5, §6's "How every commit runs" and its own entry, and only the ARCHITECTURE sections it names, and to
build without a plan review. "How every commit runs" sets each session's weight and wins over a prompt's heavier lines. A session stops only when
a §3 decision it needs is blank, when building as listed would break a CONVENTIONS rule that §4 does not mark for
rewriting, when a gate's root fix lies outside its commit, or when a Better Auth fact in §2.9 turns out false at
1.7.7 (it says so and stops; the plan is corrected before anyone builds on it). When a commit ships, its session
replaces that commit's STATUS line in §6 and commits this file with its work. When every smoke in §7 has passed
and PROD has switched (§8), this document is deleted on the owner's confirmation (ARCHITECTURE holds the shape,
git holds this file).

---

## 1. What a coach sees, what a client sees

**A coach** signs in at the same address with the same email and password as today (once more, after the switch),
gets an Account card in Settings with Change password, Change email, Sign out everywhere and Delete account, and a
new coach starts from a "Set your password" email the owner sends.

**A client** opens the same invite link, sets a password and signs in as today (once more, after the switch), and
gets an Account card in Settings with Change password, Change email and Delete account.

**The owner** creates a coach with one command, and the coach gets the email. With another, the owner moves the
login of someone who has lost their sign-in inbox to a new address.

### 1.1 The rules, one line each

The coach's side:
1. `/login` asks for email and password. A wrong pair shows "Wrong email or password." Nothing else about the
   page changes. After the switch (commit 2) every signed-in person is signed out once and signs in again with
   the password they already have.
2. "Log out" (the sidebar's and the strip's) signs out this device only. Other devices stay signed in until
   "Sign out everywhere" (rule 7) or seven days without use.
3. `/signup` is gone: a coach account is made by the owner (rule 9). The "Continue with Google" button, which never
   worked, is gone from `/login` until commit 7 brings a working one (rule 8).
4. "Forgot your password?" on `/login` opens `/forgot-password`: an email address, then "If that address has an
   account, we've emailed a link." whatever was typed. The email's link lasts one hour and opens
   `/reset-password`: new password twice (8 characters or more), "Password updated", then `/login`. Every other
   device is signed out when a password is reset. A used or expired link says "This link has expired. Request a
   new one."
5. Settings keeps its Units card and its Business Information card as they are. Its "Profile Information" card
   becomes the **Account** card: the coach's name and email, then four buttons.
6. **Change password**: current password, new password twice (8 or more); a wrong current password says so; on
   success "Password changed" and every other device is signed out.
   **Change email**: the new address; then "We've emailed <current address> to approve the change." The approve
   link (one hour) sends a second email to the new address: "Confirm your new email". Only that second link
   changes the address; the coach's email shows the new address everywhere after it (the roster's coach name and
   the emails clients get use it).
7. **Sign out everywhere**: one confirm, then every session including this one ends and the coach is on `/login`.
8. **Continue with Google** (commit 7) on `/login` signs in to the account that already has that email address.
   A Google address with no account shows "There's no account for that Google email." on `/login`. Google never
   creates an account.
9. A new coach gets the email "Set your password for Atletafit" (the product's name from 5.1; commit 4 sent it as
   "CoachHub") from the owner's command (rule 14). Its link (one
   hour) opens `/set-password`: password twice, "Password set", then `/login`. The address counts as verified
   the moment the link is used; nothing else is asked.
10. **Delete account**: the sentence "This deletes your account, every client you coach, all of their records and
    photos, and their logins. It can't be undone.", the coach's password, Delete. Then "Check your email to
    confirm." The email's link (one day) deletes everything and lands on `/login` with "Your account has been
    deleted." A client of a deleted coach can no longer sign in.

The client's side:
11. The invite link shows the coach's name and the invited address with its middle hidden (`s•••a@gmail.com`),
    asks for a password twice (8 or more), and lands on the intake form as today. The link lasts seven days and
    works once. An address that already has a login says "This email already has an account. Sign in instead."
12. `/login`, Log out (the avatar menu's "Sign out"), forgot password and reset work exactly as rules 1, 2 and 4;
    Google as rule 8.
13. Settings gets an **Account** card between Profile and Units: **Change password** (as rule 6), **Change email**
    (as rule 6, from commit 5.5; rule 17) and **Delete
    account**: "This deletes your account and everything recorded about you, including your photos. Your coach
    keeps none of it. It can't be undone.", the password, Delete, the confirmation email, the link, and `/login`
    with "Your account has been deleted." The coach's roster no longer lists the client.

Everyone:
14. The owner's command `npm run coach:create -- --project <ref> --email <address> --name "<name>"` creates the
    coach's login and sends rule 9's email. When an email can't be delivered (Resend's sandbox, §9.1),
    `npm run auth:last-link -- --email <address>` prints that address's newest live link, on DEV only.
15. Too many sign-in attempts from one place (more than three in ten seconds) show "Too many attempts. Wait a
    moment and try again." Too many reset requests (more than three a minute) the same.
16. Every page a signed-out person opens sends them to `/login`, as today. A signed-out request to any `/api/…`
    address gets a plain "Unauthorized" answer instead of the login page (nothing a person sees; the client app
    needs it).

A login's address (commit 5.5, owner 2026-10-09: "changing their email needs to be reflected platform wide …
nothing should break"):
17. A coach or a client who changes their email (rule 6) has the new address everywhere from the moment the second
    link is opened: they sign in with it, their Settings shows it, the coach sees a client's new address on their
    profile and in every list, and the app's emails to them go to it. Nothing else about them changes, and they
    stay signed in. The address and every copy of it change together or not at all. A new address that any account,
    coach or client on the platform already uses gets the same answer and no email, as Better Auth already answers
    an address with a login. A link that can no longer be used lands back on Settings with "This link has expired.
    Request a new one."
18. On a client's details sheet the coach can't change the email of a client who has an account: the field shows
    the address, with "The client changes this from their Settings." under it, and a save keeps it. Before the
    client accepts the invite the field is the coach's to edit, as today.
19. Someone who has lost access to their sign-in inbox (they can't approve a change or get a reset link) asks the
    owner, who confirms who they are and runs `npm run auth:move-email -- --project <ref> --email <current> --to
    <new>`. The login moves to the new address everywhere at once (rule 17), every session of it ends, and "Reset
    your password" goes to the new address. An address with no login, or a new address in use anywhere, is refused
    with nothing changed. There is no recovery email (D39).

### 1.2 Frame test (CONVENTIONS §7, "No frame disagrees")

Every auth screen has one source for who is signed in: Better Auth's session, read by `authClient.useSession()`
in the browser and by `auth.api.getSession()` on the server. The profile and coach row still come from
`GET /api/auth/me`, keyed on the session's user id, as today. Each dialog on the Account card owns only its own
form state. The address carries a token (`?token=`), a notice (`?error=`, `?deleted=1`) or nothing.

| # | Transition | The one source it changes | Every frame from click to settled screen |
|---|---|---|---|
| F1 | Sign in | the session (cookie set by the response) | button busy → `/dashboard` or `/client` on the first render after `/me` answers (today's shape) |
| F2 | Wrong password | nothing | button busy → the form with "Wrong email or password." under it |
| F3 | Log out | the session (revoked) | `/login` with an empty form; no flash of the old page |
| F4 | Forgot: submit | nothing stored for the browser | the same card says "If that address has an account, we've emailed a link." |
| F5 | Reset or set-password link, then submit | the address (`?token=`); the submit changes the password alone and never signs in | the form → "Password updated" (or "Password set") → `/login` |
| F6 | Invite: submit | the session (cookie forwarded by the accept route) and the client row's login | button busy → the intake form (`/client/onboarding`) on first render |
| F7 | Change password dialog | its form; on success the other sessions (revoked) | dialog → toast "Password changed" → dialog closed in the same tick |
| F8 | Change email dialog | its form; the row changes only at the second emailed link | dialog → toast "Check <current address> to approve the change" → closed; the card shows the old address until the second link is used |
| F9 | Sign out everywhere | the session (all revoked) | confirm → `/login` |
| F10 | Delete account dialog | its form; the rows go only at the emailed link | dialog → toast "Check your email to confirm." → closed; the link's page is Better Auth's redirect to `/login?deleted=1`, which shows the notice |
| F11 | Continue with Google | the session (set by Better Auth's callback) | the Google page → `/` → the role's home by the proxy's redirect (one hop, no flash: `/` is never rendered for a signed-in person today either) |
| F12 | A client's Change email dialog (5.5) | its form; the login and its copies change only at the second emailed link, in one write | dialog → toast "We've emailed <current address> to approve the change." → closed; the Profile card shows the old address until the second link, whose landing (`/client/settings`, loaded fresh) shows the new one |
| F13 | A coach saves a client's details (5.5) | the client row, the email left as it is for a client with an account | as today: the field is shown read-only, so nothing between the click and the settled sheet shows another address |

No entrance animation. Busy states use the dialog pattern's `Loader2` (CONVENTIONS lines 177–185).

### 1.3 What a session proves on DEV, not a person

The proxy's 401 for `/api/…` (rule 16), bearer-token sign-in for the client app (§2.8), the guard that refuses any
login made outside the owner's command and the invite (D9), the compensation when the app's rows can't be written
after a login is made (D10), rate limits (rule 15), that a login's address and its copies change in one write or
not at all (rule 17, D37) and the migrations' row counts are proved by scripts and tests (§5), not by the smokes
(§7).

---

## 2. Target shape

### 2.1 Data model: migrations 208, 209, 210 and 211

**Better Auth's tables live in their own schema, `better_auth`, under Better Auth's own names and column names
(D5).** PostgREST serves `public` alone, so nothing on the Data API can reach them with any key; only Better
Auth's own connection (the `postgres` user through Supabase's pooler, D28), the address trigger of migration 210
and the two delete functions of migration 211 touch them. The ids are `uuid` with the database's default, so
today's user ids carry over (D6).
Columns are Better Auth's camelCase (its docs, CLI and plugins assume them; the app never reads these tables
through PostgREST, so CONVENTIONS' snake_case examples don't apply, §4). `"user"` is a reserved word and is quoted
in every statement.

208 shipped in commit 1 as `supabase/migrations/208_better_auth_schema.sql`, the record from here: the sketch
below plus an explicit REVOKE of every role on the five tables and a closing check that the copy matches
`auth.users` and nothing but postgres holds a privilege; `npm run check:rls` clause 6 holds the lock since.

```sql
-- 208_better_auth_schema.sql: Better Auth's tables, and today's logins copied in (docs/BETTER-AUTH-PLAN.md 2.1).
-- Additive: nothing reads these tables until migration 209 lands with commit 2. Pure ASCII.
-- Column names are Better Auth 1.7.7's own (camelCase, quoted); "user" is a reserved word and is always quoted.

CREATE SCHEMA IF NOT EXISTS better_auth;
REVOKE ALL ON SCHEMA better_auth FROM PUBLIC;
COMMENT ON SCHEMA better_auth IS
  'Better Auth''s tables (logins, sessions, credentials, one-time tokens, its rate limiter). Off the Data API: PostgREST serves public only. Reached by Better Auth''s own connection, which owns them.';

CREATE TABLE IF NOT EXISTS better_auth."user" (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  email           text NOT NULL UNIQUE,
  "emailVerified" boolean NOT NULL DEFAULT false,
  image           text,
  "createdAt"     timestamptz NOT NULL DEFAULT now(),
  "updatedAt"     timestamptz NOT NULL DEFAULT now(),
  role            text,                       -- admin plugin: "admin" for nobody yet; the app's role stays in public.profiles
  banned          boolean NOT NULL DEFAULT false,
  "banReason"     text,
  "banExpires"    timestamptz
);
CREATE TABLE IF NOT EXISTS better_auth.session (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId"         uuid NOT NULL REFERENCES better_auth."user"(id) ON DELETE CASCADE,
  token            text NOT NULL UNIQUE,
  "expiresAt"      timestamptz NOT NULL,
  "ipAddress"      text,
  "userAgent"      text,
  "impersonatedBy" text,                      -- admin plugin
  "createdAt"      timestamptz NOT NULL DEFAULT now(),
  "updatedAt"      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS session_user_id_idx ON better_auth.session ("userId");
CREATE TABLE IF NOT EXISTS better_auth.account (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId"                uuid NOT NULL REFERENCES better_auth."user"(id) ON DELETE CASCADE,
  "accountId"             text NOT NULL,     -- the user id for password logins; Google's subject for Google
  "providerId"            text NOT NULL,     -- 'credential' or 'google'
  "accessToken"           text,
  "refreshToken"          text,
  "idToken"               text,
  "accessTokenExpiresAt"  timestamptz,
  "refreshTokenExpiresAt" timestamptz,
  scope                   text,
  password                text,              -- Supabase's bcrypt hash for copied logins; scrypt for every password set after the switch
  "createdAt"             timestamptz NOT NULL DEFAULT now(),
  "updatedAt"             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS account_user_id_idx ON better_auth.account ("userId");
CREATE TABLE IF NOT EXISTS better_auth.verification (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier  text NOT NULL,                 -- Better Auth's token kinds: reset-password:<token>, change-email-confirmation:<token>, ...
  value       text NOT NULL,
  "expiresAt" timestamptz NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS verification_identifier_idx ON better_auth.verification (identifier);
CREATE TABLE IF NOT EXISTS better_auth."rateLimit" (        -- rateLimit.storage = "database" (D16)
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key           text NOT NULL UNIQUE,           -- the limiter's first-insert race re-reads on the violation
  count         integer NOT NULL,
  "lastRequest" bigint NOT NULL
);
ALTER TABLE better_auth."user"       ENABLE ROW LEVEL SECURITY;   -- uniform with public; postgres owns and bypasses
ALTER TABLE better_auth.session      ENABLE ROW LEVEL SECURITY;
ALTER TABLE better_auth.account      ENABLE ROW LEVEL SECURITY;
ALTER TABLE better_auth.verification ENABLE ROW LEVEL SECURITY;
ALTER TABLE better_auth."rateLimit"  ENABLE ROW LEVEL SECURITY;

-- Today's logins, on today's ids. Born verified (D4: Supabase never required it here, and refusing a login that
-- works today would lock people out). Name: the coach row, else the client row, else what sign-up stored, else
-- the address's local part. Rerunnable: ON CONFLICT / NOT EXISTS.
INSERT INTO better_auth."user" (id, name, email, "emailVerified", image, "createdAt", "updatedAt", banned, "banExpires")
SELECT u.id,
       coalesce((SELECT c.name  FROM public.coaches c  WHERE c.user_id  = u.id LIMIT 1),
                (SELECT cl.name FROM public.clients cl WHERE cl.user_id = u.id LIMIT 1),
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

DO $$
DECLARE missing_users integer; missing_passwords integer;
BEGIN
  SELECT count(*) INTO missing_users FROM auth.users u
   WHERE u.email IS NOT NULL AND NOT EXISTS (SELECT 1 FROM better_auth."user" b WHERE b.id = u.id);
  SELECT count(*) INTO missing_passwords FROM auth.users u
   WHERE u.email IS NOT NULL AND coalesce(u.encrypted_password, '') <> ''
     AND NOT EXISTS (SELECT 1 FROM better_auth.account a WHERE a."userId" = u.id AND a."providerId" = 'credential');
  IF missing_users <> 0 OR missing_passwords <> 0 THEN
    RAISE EXCEPTION 'better_auth copy incomplete: % logins, % passwords missing', missing_users, missing_passwords;
  END IF;
END $$;
```

```sql
-- 209_better_auth_switch.sql: the user keys point at Better Auth's logins; Supabase's sign-up trigger goes (2.1).
-- Lands with commit 2's code (section 8.1). The undo is section 8.3. Pure ASCII.

-- Logins Supabase made, and passwords it changed, after 208 ran (on DEV the days between commits 1 and 2; on
-- PROD 208 and 209 land in one push and this changes nothing): 208's section 2 again, verbatim, then every
-- copied bcrypt hash brought level with Supabase's. A scrypt password set through Better Auth is never touched.
--   <208's two copy INSERTs, as supabase/migrations/208_better_auth_schema.sql holds them>
UPDATE better_auth.account a SET password = u.encrypted_password, "updatedAt" = now()
  FROM auth.users u
 WHERE a."userId" = u.id AND a."providerId" = 'credential' AND a.password LIKE '$2%'
   AND coalesce(u.encrypted_password, '') <> '' AND a.password IS DISTINCT FROM u.encrypted_password;
-- From this commit the admin plugin's create-user (the invite) makes logins, with role 'user'.
COMMENT ON COLUMN better_auth."user".role IS
  'The admin plugin''s role: user for a login it makes, empty for a copied one. The app''s role is public.profiles.role.';

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT c.conname, c.conrelid::regclass AS tbl FROM pg_constraint c
            WHERE c.contype = 'f' AND c.confrelid = 'auth.users'::regclass
              AND c.conrelid IN ('public.profiles'::regclass, 'public.coaches'::regclass, 'public.clients'::regclass)
  LOOP EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tbl, r.conname); END LOOP;
END $$;
-- The three keys, with today's ON DELETE actions (004:4, 021:4, 023:3). ADD CONSTRAINT validates every row:
-- a user_id with no copied login fails the migration loudly instead of leaving a dangling key.
ALTER TABLE public.profiles ADD CONSTRAINT profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES better_auth."user"(id) ON DELETE CASCADE;
ALTER TABLE public.coaches  ADD CONSTRAINT coaches_user_id_fkey  FOREIGN KEY (user_id) REFERENCES better_auth."user"(id) ON DELETE CASCADE;
ALTER TABLE public.clients  ADD CONSTRAINT clients_user_id_fkey  FOREIGN KEY (user_id) REFERENCES better_auth."user"(id) ON DELETE SET NULL;
-- The unique key ON CONFLICT (user_id) has always needed, which DEV holds and no migration created (CONVENTIONS 676):
CREATE UNIQUE INDEX IF NOT EXISTS coaches_user_id_key ON public.coaches (user_id);
-- Supabase's sign-up trigger (025, rewritten in 107): no insert into auth.users will ever fire it again, and
-- the role now comes from the path that makes the login (D9).
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();
REVOKE ALL ON TABLE public.profiles, public.coaches FROM supabase_auth_admin;   -- what 025:54-55 gave

DO $$
BEGIN
  IF (SELECT count(*) FROM pg_constraint WHERE contype = 'f' AND confrelid = 'better_auth."user"'::regclass
        AND conrelid IN ('public.profiles'::regclass, 'public.coaches'::regclass, 'public.clients'::regclass)) <> 3
     OR EXISTS (SELECT 1 FROM pg_constraint WHERE contype = 'f' AND confrelid = 'auth.users'::regclass
                  AND connamespace = 'public'::regnamespace)
     OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'on_auth_user_created')
     OR EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'handle_new_user' AND pronamespace = 'public'::regnamespace)
  THEN RAISE EXCEPTION 'migration 209 did not land as described';
  END IF;
END $$;
```

```sql
-- 210_login_email_follows.sql: a login's address and every copy of it change in one write (2.10, D37). Pure ASCII.
-- coaches.email and clients.email copy the address a login signs in with. Better Auth changes an address in one
-- UPDATE of better_auth."user" (its verify-email endpoint; the owner's auth:move-email through its adapter); this
-- trigger rewrites the login's coach row and client row inside that same statement, so a copy that cannot be
-- written (coaches.email is UNIQUE) undoes the login's change with it.
CREATE OR REPLACE FUNCTION better_auth.copy_login_email() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, better_auth AS $$
BEGIN
  UPDATE public.coaches SET email = NEW.email WHERE user_id = NEW.id AND email IS DISTINCT FROM NEW.email;
  UPDATE public.clients SET email = NEW.email WHERE user_id = NEW.id AND email IS DISTINCT FROM NEW.email;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION better_auth.copy_login_email() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS login_email_follows ON better_auth."user";
CREATE TRIGGER login_email_follows AFTER UPDATE OF email ON better_auth."user"
  FOR EACH ROW WHEN (OLD.email IS DISTINCT FROM NEW.email) EXECUTE FUNCTION better_auth.copy_login_email();
COMMENT ON SCHEMA better_auth IS
  'Better Auth''s tables (logins, sessions, credentials, one-time tokens, its rate limiter). Off the Data API: PostgREST serves public only. Reached by Better Auth''s own connection, and by migration 210''s trigger, which copies a login''s address to its coach and client rows.';
-- Closing check, in 201's shape: the trigger is on better_auth."user", and the function grants nothing to PUBLIC
-- or any role but its owner.
```

```sql
-- 211_delete_account_functions.sql: the app's records go in one statement each when a login is deleted (2.6).
-- Also extends the better_auth schema's COMMENT to name these two functions beside 210's trigger.
CREATE OR REPLACE FUNCTION public.delete_client_records(p_user_id uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  DELETE FROM public.clients WHERE user_id = p_user_id;   -- every FK to clients is ON DELETE CASCADE (2.6)
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
CREATE OR REPLACE FUNCTION public.delete_coach_records(p_user_id uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, better_auth AS $$
DECLARE n integer;
BEGIN
  -- the clients' logins first: clients.user_id -> "user" is SET NULL, so nothing else would remove them
  DELETE FROM better_auth."user" u USING public.clients cl JOIN public.coaches c ON cl.coach_id = c.id
   WHERE c.user_id = p_user_id AND cl.user_id = u.id;
  DELETE FROM public.coaches WHERE user_id = p_user_id;   -- cascades the clients and everything under them
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.delete_client_records(uuid), public.delete_coach_records(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_client_records(uuid), public.delete_coach_records(uuid) TO service_role;
```

Neither function deletes the caller's own login row: Better Auth does that itself after `beforeDelete` returns
(§2.6), which cascades `profiles`, `coaches` (already gone) and the sessions.

**Alternatives considered** (CONVENTIONS §8: the data model is a decision):
- **Where the tables live:** their own schema (chosen) or `public` with Better Auth's names. In `public` they'd sit on
  the Data API behind RLS and the lockdown's revoked grants, appear in `types/database.ts`, and the service-role key
  would reach password hashes through PostgREST. A schema the Data API never serves needs none of that, and Better
  Auth has a `schemaName` option for exactly this.
- **Ids:** `uuid` generated by the database (chosen, `advanced.database.generateId: "uuid"`), Better Auth's default
  random `text` ids (would force the three FK columns to `text` and lose today's ids), or Supabase's ids copied into
  text columns (same loss for new logins).
- **Column names:** Better Auth's camelCase (chosen) or a `fields` map to snake_case on every model, every plugin
  field included (five maps to keep right, for tables the app never queries).
- **The copy:** SQL inside the migration (chosen: one `db push` carries PROD's switch too, rerunnable) or Better
  Auth's Node migration script from its Supabase guide (a second tool and a second connection string on push day).
- **Role:** the app's `profiles.role` stays the role (chosen). Better Auth's `user.role` is the admin plugin's and
  is empty for everyone; the owner's admin standing comes from `adminUserIds` (D24).
- **A login's address and its copies (210, D37):** a trigger on the login (chosen): the copy is written inside the
  statement that changes the address, whichever path changes it, so the two can't disagree. Better Auth's hook
  after it updates a login (commit 5's `mirrorLoginEmail`, which 5.5 deletes) wrote the copy after the login's
  change had committed, and a copy that failed left the coach seeing, and the app emailing, the old address. No
  copy at all, reading the address from the login wherever it shows: a client row exists before its login (an
  invited client), and the app reads `public` through `supabaseAdmin`, which never reaches `better_auth`. An RPC
  the app calls: Better Auth makes the write itself, inside its verify-email endpoint, so nothing of the app's
  runs in that transaction.

### 2.2 The server

**`lib/auth.ts`** is the one `betterAuth(...)` in the tree; `lib/auth-client.ts` the one `createAuthClient(...)`.
Commit 1 writes the first with the options below that have no email or screen behind them yet; later commits add
theirs where marked. Every option name is from §2.9. Commit 1's file is the record from here, and adds what the
sketch lacks: the pool's TLS verified against Supabase's root and a `DATABASE_URL` with parameters refused
(`lib/supabase-connection.ts`, which scripts that reach the pool's database use too), a ten-second connect timeout,
idle-connection errors and every unexpected Better Auth error sent to Sentry (`onAPIError` and an after hook), bigints read as
numbers, `database.transaction: true`, the password lengths as `PASSWORD_MIN_LENGTH` / `PASSWORD_MAX_LENGTH`
(`lib/constants.ts`), and a refusal to start when `BETTER_AUTH_URL` and `NEXT_PUBLIC_APP_URL` name different origins.

```ts
import { betterAuth } from "better-auth"
import { admin, bearer } from "better-auth/plugins"
import { expo } from "@better-auth/expo"                        // commit 8
import { verifyPassword } from "better-auth/crypto"
import { APIError } from "better-auth/api"
import bcrypt from "bcryptjs"
import { Pool } from "pg"
import { PostgresDialect } from "kysely"

const pool = new Pool({ ...supabaseConnection(process.env.DATABASE_URL!), max: 4 })   // Supabase's transaction pooler (D28), TLS verified
const adminUserIds = (process.env.AUTH_ADMIN_USER_IDS ?? "").split(",").map((id) => id.trim()).filter(Boolean)   // D24

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL,                           // = NEXT_PUBLIC_APP_URL
  secret: process.env.BETTER_AUTH_SECRET,
  database: { dialect: new PostgresDialect({ pool }), type: "postgres", schemaName: "better_auth" },
  trustedOrigins: [process.env.NEXT_PUBLIC_APP_URL!, "atletafit://", "atletafit://*"],   // the scheme: commit 8
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,                                          // D1, D9: no public sign-up, ever
    requireEmailVerification: true,                               // D4
    minPasswordLength: 8,
    maxPasswordLength: 128,
    revokeSessionsOnPasswordReset: true,                          // rule 4
    password: { verify: verifyBcryptOrScrypt },                   // hash stays Better Auth's scrypt (D7)
    sendResetPassword: sendPasswordLinkEmail,                     // commit 2 (reset) and 4 (set): one callback, two templates
  },
  emailVerification: { sendVerificationEmail: sendConfirmNewEmailEmail, expiresIn: 60 * 60 },   // commit 5 (change email's second step)
  user: {
    changeEmail: { enabled: true, sendChangeEmailConfirmation: sendApproveEmailChangeEmail },   // commit 5
    deleteUser: { enabled: true, sendDeleteAccountVerification: sendConfirmDeleteEmail, beforeDelete: deleteAccountRecords },   // commit 6
  },
  session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },   // Better Auth's defaults, written down; no cookieCache (D15)
  rateLimit: { storage: "database" },                             // on in production, off under next dev (D16)
  databaseHooks: {
    user: {
      create: { before: refuseUnlessOwnerOrInvite },              // D9's guard
      update: { after: mirrorEmailToCoachRow },                   // commit 5
    },
  },
  socialProviders: { google: { clientId: process.env.GOOGLE_CLIENT_ID!, clientSecret: process.env.GOOGLE_CLIENT_SECRET!, disableSignUp: true, prompt: "select_account" } },   // commit 7
  account: { accountLinking: { enabled: true, trustedProviders: ["google"] } },   // commit 7
  advanced: { database: { generateId: "uuid" } },
  plugins: [admin({ adminUserIds }), bearer(), expo()],           // expo(): commit 8
  telemetry: { enabled: false },
})

async function verifyBcryptOrScrypt({ hash, password }: { hash: string; password: string }) {
  return hash.startsWith("$2") ? bcrypt.compare(password, hash) : verifyPassword({ hash, password })
}
async function refuseUnlessOwnerOrInvite(_user: unknown, ctx: { path?: string } | null) {
  if (ctx?.path !== "/admin/create-user") throw new APIError("FORBIDDEN", { message: "Accounts are created by invitation." })
}
```

- **The route:** `app/api/auth/[...all]/route.ts` — `export const { GET, POST } = toNextJsHandler(auth)`. It is
  Better Auth's whole surface: `/api/auth/sign-in/email`, `/sign-out`, `/request-password-reset`,
  `/reset-password`, `/change-password`, `/change-email`, `/delete-user`, `/revoke-sessions`, `/callback/google`,
  `/get-session`, and the admin plugin's `/admin/create-user`. `app/api/auth/me/route.ts` stays where it is (a
  more specific segment, so Next routes it there, not to the catch-all) and keeps its contract (D13).
- **The proxy.** `middleware.ts` becomes `proxy.ts` (Next 16: the file and the export are renamed, it runs on
  Node, and `pg` runs in it; §2.9 #1). Same decisions in the same order as `middleware.ts:49-198` today, with
  these changes: (a) the skip list gains the prefix `/api/auth/` (Better Auth's endpoints must be reachable
  signed out; `/me` answers its own 401) and, from commit 4, the exact path `/set-password`; `/auth/callback`
  leaves it (the route is deleted); (b) who is signed in comes from `auth.api.getSession({ headers: request.headers })`, which
  returns `null` for no session and never throws; (c) a request under `/api/` with no session answers
  `401 { success: false, error: "Unauthorized" }` instead of the 307 to `/login` (rule 16); pages keep the 307;
  (d) the role still comes from `profiles` through `supabaseAdmin`, fail-closed to `/login?error=profile_unavailable`
  as today, and `redirectPreservingCookies` goes (the browser's `useSession()` calls Better Auth's own
  `/get-session` route, which refreshes the cookie; the proxy never needs to). `trainerRoutes` stays a
  literal list, `middleware.test.ts` becomes `proxy.test.ts` with the same folder ⟷ list assertion.
- **The seam.** `lib/auth-helpers.ts` keeps `getAuthenticatedCoachId(request?)` and `getAuthenticatedClientId(request?)`
  with their signatures (the `request` argument feeds the auth-failure log, CONVENTIONS 104–106), the 60 s
  Redis cache and `invalidateClientAuthCache`. The user id comes from `auth.api.getSession({ headers })` (the
  request's headers, or `headers()` from `next/headers` when no request is passed). A bearer token in
  `Authorization` is accepted by the same call (the bearer plugin, §2.8). `lib/require-coach-auth.ts` and
  `lib/require-client-auth.ts` don't change.
- **`GET /api/auth/me`** returns the same `{ profile, coach }` shape, read through `supabaseAdmin` by the session's
  user id. The create-on-read branches of `services/auth-profile-service.ts:83-160` (profile upsert by invitation
  email, coach self-heal) are deleted: the two paths that make a login write their rows in the same request (§2.3),
  and no trigger races them. `deriveRole` goes with them (closes TECHNICAL-DEBT :468).
- **CSRF.** `lib/csrf-protection.ts` passes a request whose `Authorization` header starts with `Bearer ` (commit 8):
  a bearer token is attached by code that holds it, never by a browser form, and the proxy and seam accept it only
  through Better Auth. Everything else about it stays. Better Auth's own endpoints check `Origin` against
  `trustedOrigins` themselves.
- **Rate limits.** Better Auth's limiter covers `/api/auth/*`: 3 per 10 s on sign-in, change-password and
  change-email, 3 per minute on reset and verification requests, 100 per 10 s otherwise, per IP, stored in
  `better_auth."rateLimit"`, on in production and off under `next dev` (§2.9 #5). `apiRateLimit` stays on `/me`;
  `authRateLimit` stays on `/api/invitations/*`. A 429 reaches the page as rule 15's sentence.
- **Errors.** Better Auth's codes reach the page in `error.code` (`INVALID_EMAIL_OR_PASSWORD`, `INVALID_PASSWORD`,
  `INVALID_TOKEN`, `TOKEN_EXPIRED`, `USER_ALREADY_EXISTS`, `EMAIL_NOT_VERIFIED`, a 429 for the limiter); the pages
  map them to rules 1, 4, 6, 11 and 15, every other code to "Something went wrong. Try again." Nothing raw is shown.

### 2.3 Making a login: `services/login-service.ts`

Two functions, both server-only, both the only writers of `profiles` and the login side of `coaches` / `clients`:

- `createCoachLogin({ email, name })` — `auth.api.createUser({ body: { email, name, data: { emailVerified: true } } })`
  (the admin plugin; no password, so no credential row until the coach sets one; called from a script with no
  session, which 1.7.7 allows — §2.9 #2), then `profiles { user_id, role: 'trainer' }` and
  `coaches { user_id, name, email }` through `supabaseAdmin`, then
  `auth.api.requestPasswordReset({ body: { email, redirectTo: "/set-password" } })`, which emails rule 9's link.
  Returns the user id.
- `acceptClientInvitation({ token, password })` — the token is looked up and checked exactly as
  `getInvitationByToken` does (`services/invitation-service.ts:20-106`: pending, not expired); then
  `auth.api.createUser({ body: { email: invitation.email, name: invitation.clientName, password, data: { emailVerified: true } } })`;
  then `profiles { role: 'client' }`, `clients.user_id = <the new id>`, `client_invitations.status = 'accepted'`
  (the writes of `acceptInvitationByToken` :256-333, now keyed on the id just made); then
  `auth.api.signInEmail({ body: { email, password }, returnHeaders: true })` and the `set-cookie` headers are
  handed back for the route to forward. **The request body never carries a user id** (closes TECHNICAL-DEBT :470).
  An address that already has a login → `USER_ALREADY_EXISTS` → rule 11's sentence, nothing written.
- **Compensation (D10):** if any app row fails after `createUser`, the function deletes the login it just made
  (`auth.api.removeUser` needs an admin session, so it deletes through the pool: `DELETE FROM better_auth."user"
  WHERE id = $1`, the one SQL statement the app runs against that schema outside migrations) and throws. Nothing
  is left half-made; the proof forces each failure in turn. At 1.7.7 the admin plugin's `createUser` writes the
  login and then its credential as two statements, in no transaction (`plugins/admin/routes.mjs`), so a
  `createUser` that throws may already have made the login: the compensation then deletes by the invited address.
- **The guard** `refuseUnlessOwnerOrInvite` (§2.2) refuses every user creation whose path is not
  `/admin/create-user`: public sign-up is off, Google can't sign up, and nothing else makes a login. The copy in
  migration 208 is SQL and never meets the hook.

`scripts/create-coach.ts` (`npm run coach:create -- --project <ref> --email … --name …`) calls the first only when
`--project` equals `supabase/.temp/project-ref`, `DATABASE_URL` names the same ref (the pooler string carries it in its
user, `postgres.<ref>`) and so does `NEXT_PUBLIC_SUPABASE_URL` (`scripts/project-ref.ts`), so a PROD run is a
deliberate pair of flags and env, never an accident, and on any project but DEV only when `BETTER_AUTH_URL` is https
(the emailed link opens it; `.env.local`'s localhost would send a real coach to the owner's machine); `scripts/auth-last-link.ts` (`npm run auth:last-link`, rule 14) refuses every ref but DEV's,
reads `better_auth.verification` through the pool for the live token of an address (the identifier prefixes
Better Auth 1.7.7 writes, read from its source by commit 4: `reset-password:<token>` and `delete-account-<token>`,
pinned by a test on Better Auth's memory adapter; change email's two links carry a JWT Better Auth signs and never
stores, so no row holds them) and prints the link the email would carry. The rows record no landing page: a login with
no password yet is printed `/set-password`, one with a password `/reset-password`, and a delete-account link
`/login?deleted=1` (`ACCOUNT_DELETED_PAGE`, `lib/constants.ts`).

`POST /api/invitations/accept` (`authRateLimit`, CSRF, zod `{ token: 64 hex, password: PASSWORD_MIN_LENGTH–PASSWORD_MAX_LENGTH }`,
the two in `lib/constants.ts` that `lib/auth.ts` holds Better Auth to, as do the reset and set-password pages) calls the second
function and forwards its cookies. The legacy `{ clientId, userId }` branch (`route.ts:42-81`) and
`acceptInvitation` (`invitation-service.ts:346-366`) are deleted. `GET /api/invitations/[token]` answers
`{ coachName, emailMasked, expiresAt }` (D11: the full address and the client's name stop travelling to whoever
holds a link).

### 2.4 The browser

- `contexts/auth-context.tsx` keeps its `AuthProvider` contract (`user`, `profile`, `coach`, `loading`,
  `login`, `logout`) on `authClient.useSession()`: no `onAuthStateChange`, no Supabase client. `login()` calls
  `authClient.signIn.email({ email, password })`, then primes `/me` as today (`:125-143`); `logout()` calls
  `authClient.signOut()` and purges `/me` (this device only, rule 2). `services/supabase-client.ts` and
  `lib/supabase-server.ts` are deleted; `@supabase/ssr` leaves `package.json`; the anon key has no reader left
  (D29).
- `app/login/page.tsx`: the form as today; the Google button goes in commit 2 and returns in commit 7 wired to
  `authClient.signIn.social({ provider: "google", callbackURL: "/", errorCallbackURL: "/login" })`;
  `components/auth/login-notice.tsx` reads `?error=profile_unavailable` (today), `?error=signup_disabled` and
  `?error=account_not_linked` (rule 8: "There's no account for that Google email.") and `?deleted=1` (rule 10, an
  informational variant of the same Alert); the names live in `lib/constants.ts` beside
  `LOGIN_ERROR_PROFILE_UNAVAILABLE`.
- `app/signup/page.tsx`, `app/auth/callback/route.ts`, `signupSchema` in `lib/validations/auth.ts`: deleted.
- `app/forgot-password/page.tsx`: `authClient.requestPasswordReset({ email, redirectTo: "/reset-password" })`;
  the same sentence for every address. `app/reset-password/page.tsx`: reads `?token=` (and `?error=INVALID_TOKEN`
  → rule 4's expired sentence), `authClient.resetPassword({ newPassword, token })`. `app/set-password/page.tsx`
  (commit 4) is the same component with rule 9's wording, mounted at the path the owner's email lands on.
- `app/invite/[token]/page.tsx`: shows `coachName` and `emailMasked`, posts `{ token, password }` to
  `/api/invitations/accept`, then `router.push("/client")` (the layout's bounce to onboarding is unchanged).
- **The Account card** (commits 5–6): `components/coach/account-card.tsx` on `app/(coach)/settings/page.tsx` in
  place of the mock "Profile Information" card (`:36-56`); `components/client-portal/account-card.tsx` on
  `app/client/settings/page.tsx` between Profile and Units (`:164-166`). Each button opens a dialog in CONVENTIONS'
  dialog pattern (RHF + zod, `Loader2`, save closes in the same tick, Sonner toast): `authClient.changePassword({
  currentPassword, newPassword, revokeOtherSessions: true })`, `authClient.changeEmail({ newEmail, callbackURL:
  "/settings" })` (the coach's from commit 5; the client's from 5.5, landing on `/client/settings`, §2.10),
  `authClient.revokeSessions()` then `/login`, `authClient.deleteUser({ password,
  callbackURL: "/login?deleted=1" })`. Design: `docs/newdesignsystem.md`'s Card, Button and Dialog, the Settings
  page's existing `cardClass`/`headerClass`, no new tokens; the client card matches the client Settings page's
  cards.

### 2.5 Emails (`/emails`, through Resend, `services/email-service.ts`)

Five React Email templates beside `invitation-email.tsx` and `activation-email.tsx`, same look, same sender
constant, same product name: `set-password-email.tsx` (rule 9), `reset-password-email.tsx` (rule 4),
`approve-email-change-email.tsx` (to the current address, rule 6), `confirm-new-email-email.tsx` (to the new
address, rule 6), `confirm-delete-account-email.tsx` (rules 10 and 13; the coach's names what goes with the
account, the client's that the coach keeps nothing). Better Auth calls one function per kind
(`sendResetPassword`, `sendChangeEmailConfirmation`, `sendVerificationEmail`, `sendDeleteAccountVerification`);
each is a thin function in `services/auth-email-service.ts` that renders the template and sends through the
existing `resend` client. `sendPasswordLinkEmail` picks set-password or reset-password by the `callbackURL` inside
the `url` it is given (`/set-password` vs `/reset-password`, D17); nothing else tells them apart. So only the server's
own call may ask for `/set-password`: over HTTP `request-password-reset` is open to anyone signed out and its origin
check accepts any page of the app as `redirectTo`, and `lib/auth.ts`'s before hook refuses that landing (commit 4's
review). The sender comes
from `EMAIL_FROM` (falling back to `<the product's name> <onboarding@resend.dev>`, Atletafit from 5.1, D30); Resend's sandbox delivers to the
owner's one verified address only (TECHNICAL-DEBT :256), so the smokes say where each email must go until the
owner verifies a domain (§9.1).

### 2.6 Deleting an account (commit 6)

`beforeDelete(user)` in `services/account-service.ts` looks up the role, then:
- **client:** collects the client's `check_ins.photo_front/side/back` keys, removes those objects from
  `progress-photos` through `supabaseAdmin.storage` (`services/storage-service.ts` owns the bucket name), then
  `supabaseAdmin.rpc("delete_client_records", { p_user_id })`. Every FK to `clients` is ON DELETE CASCADE
  (check_ins, check_in_reminders, training_plans, client_session_completions, client_intake, nutrition_plans,
  wellness_logs, nutrition_logs, client_goals, training_events, attention_dismissals, coach_client_views,
  client_notes, client_phases, client_measurements, nutrition_day_edits, client_habits, client_habit_logs,
  content_assignments, client_invitations, and check_in_forms' nullable key), so the one DELETE takes everything
  recorded about the person.
- **coach:** collects every photo key of every client of the coach and every `content_items.storage_path` of the
  coach, removes the objects from both buckets, then `delete_coach_records`: the clients' logins, then the coach
  row, which cascades `clients` and all of the above plus the coach's plans, folders, items, saved plans and
  sessions, questions and forms, custom exercises (D2). `content_assignments.assigned_by` is the one NO ACTION key
  to `coaches`; its rows go through `client_id` and `content_item_id` in the same statement, so it never fires
  (the proof deletes a coach whose client holds an assignment).
- Objects first, rows second (D20): a failed object removal refuses the delete ("Couldn't delete your account. Try
  again.") with the account intact; a failed function call after the objects went is logged with the keys and
  refused the same way, and a retry completes it. Then Better Auth deletes the sessions, the credential and Google
  rows and the login, which cascades `profiles`.
- The dialog sends the password; Better Auth checks it, then sends the email instead of deleting (§2.9 #7). The
  email's link is Better Auth's `/api/auth/delete-user/callback?token=…&callbackURL=/login?deleted=1`, valid one
  day, and needs the person still signed in on the device that opens it (the same browser, in practice).

### 2.7 Google (commit 7)

`socialProviders.google` with `disableSignUp: true` and `account.accountLinking.trustedProviders: ["google"]`:
a Google sign-in whose address matches a login links to it and signs in; an unknown address is refused with
`signup_disabled` and lands on `/login?error=signup_disabled`; a login whose `emailVerified` were false would be
refused with `account_not_linked` (none is: D4). Google's console needs the redirect URI
`<app>/api/auth/callback/google` (and localhost's for DEV) — §9.1. The same button serves coaches and clients
(D3): after sign-in Better Auth lands on `/`, and the proxy sends the role home.

### 2.8 Ready for the client app (commit 8), nothing of the app built

- `bearer()` (on from commit 1): every response that sets the session cookie also carries `set-auth-token`; a
  request with `Authorization: Bearer <that value>` is a session to `auth.api.getSession`, so the seam needs no
  branch of its own. The token follows the session's life (seven days, extended daily; revoked with it).
- `expo()` and the scheme `atletafit://` in `trustedOrigins` (D25): a future Expo app signs in at the same
  `/api/auth` routes, keeps the session in SecureStore and sends it as a `Cookie` header, and Google sign-in
  from the app returns through `atletafit://…`. Dev-only `exp://` origins are added by the plugin under
  `NODE_ENV=development`. Nothing else on the server changes for the app, ever (§2.9 #4).
- The proxy's JSON 401 (rule 16) and the CSRF pass for bearer requests (§2.2) are the two app-side changes.
- Proof (§5): a sign-in over HTTP with a client's credentials, the token from `set-auth-token`, then
  `GET /api/client/me` with the header and no cookie → 200; `PATCH /api/client/settings` with the header, no
  cookie and no `Origin` → 200; a garbage token → 401 JSON; a revoked one → 401; a POST to `/api/auth/sign-in/email`
  with `Origin: atletafit://` → accepted, with `Origin: https://evil.example` → 403.

### 2.9 Better Auth facts this plan relies on (1.7.7, read 2026-10-07)

1. Next.js: `toNextJsHandler` from `better-auth/next-js`; `createAuthClient` from `better-auth/react` with
   `useSession()`; in Next 16 `middleware.ts` is deprecated and renamed `proxy.ts`, which runs on Node only, so
   `auth.api.getSession({ headers })` is allowed there (Better Auth suggests a cookie-presence check for speed; this
   plan keeps the full check, D11). https://www.better-auth.com/docs/integrations/next,
   https://nextjs.org/docs/app/api-reference/file-conventions/proxy,
   https://nextjs.org/docs/app/guides/upgrading/version-16.
2. Admin plugin: `createUser` body `{ email, password?, name, role?, data }`; called server-side with no `headers`
   it runs with no session and no admin check (source: `packages/better-auth/src/plugins/admin/routes.ts:340-345`
   at v1.7.7); every other admin endpoint needs an admin session; `adminUserIds` names admins. `data` is spread
   onto the row, so `emailVerified: true` lands (source-derived; commit 4's proof reads the row).
   https://www.better-auth.com/docs/plugins/admin.
3. Postgres through Kysely: `database: { dialect, type: "postgres", schemaName }`; `advanced.database.generateId:
   "uuid"` makes Better Auth skip id generation on Postgres and rely on the column default; inserts use
   `RETURNING`. https://www.better-auth.com/docs/adapters/postgresql,
   https://www.better-auth.com/docs/concepts/database#id-generation.
4. Bearer and Expo: `bearer()` copies the session cookie's value into `set-auth-token` and reads `Authorization:
   Bearer` back; `expo()` trusts `exp://` in development, rewrites non-http callback redirects to carry the cookie,
   and the app scheme must be in `trustedOrigins` (`myapp://`, `myapp://*`).
   https://www.better-auth.com/docs/plugins/bearer, https://www.better-auth.com/docs/integrations/expo.
5. Rate limiting: on in production only; 10 s / 100 by default; built-in rules 3 per 10 s on `/sign-in*`,
   `/sign-up*`, `/change-password`, `/change-email`, 3 per 60 s on `/request-password-reset` and
   `/send-verification-email`; `storage: "database"` keeps counters in a `rateLimit` table; `auth.api` calls are
   not limited. https://www.better-auth.com/docs/concepts/rate-limit.
6. Email and password: `disableSignUp`, `requireEmailVerification` (sign-in → 403 `EMAIL_NOT_VERIFIED`),
   `password.verify({ hash, password })` replaces the check and `hash` stays scrypt (`better-auth/crypto` exports
   `verifyPassword`); `requestPasswordReset({ email, redirectTo })` emails
   `<baseURL>/api/auth/reset-password/<token>?callbackURL=<redirectTo>`, whose click lands on
   `<redirectTo>?token=…` or `?error=INVALID_TOKEN`; `resetPassword({ newPassword, token })` works for a login with
   no password yet (it creates the credential row); `revokeSessionsOnPasswordReset`; `changePassword({
   currentPassword, newPassword, revokeOtherSessions })`; `forgetPassword` no longer exists.
   https://www.better-auth.com/docs/authentication/email-password.
7. Change email and delete: `user.changeEmail.enabled` + `sendChangeEmailConfirmation` (to the current address;
   its link then triggers `emailVerification.sendVerificationEmail` to the new one; the row changes at the second
   click); `user.deleteUser` with `sendDeleteAccountVerification` sends the email and does not delete on the POST,
   even with a correct password; `beforeDelete` may throw to refuse; the callback needs the user's live session.
   https://www.better-auth.com/docs/concepts/users-accounts.
8. Sessions: `expiresIn` 7 d, `updateAge` 1 d, `cookieCache` off by default; `revokeSessions` ends every session;
   `getSession` returns `null` without a session; `auth.api.signInEmail({ body, returnHeaders: true })` returns
   `{ headers, response }`. https://www.better-auth.com/docs/concepts/session-management,
   https://www.better-auth.com/docs/concepts/api.
9. Hooks: `databaseHooks.user.create.before(user, ctx)` gets the endpoint context (`ctx.path`) and may throw
   `APIError`; admin `createUser` fires it. https://www.better-auth.com/docs/concepts/database#database-hooks.
10. Google: `disableSignUp`, `prompt`, `account.accountLinking.trustedProviders`; an unknown address with sign-up
    disabled → `?error=signup_disabled` on `errorCallbackURL`; linking needs the local login's `emailVerified`.
    https://www.better-auth.com/docs/authentication/google, https://www.better-auth.com/docs/concepts/oauth.
11. Supabase migration guide: ids are kept by inserting with the same `id`; `encrypted_password` is copied into
    `account.password` with `providerId: 'credential'` and `accountId: user.id`; `email_confirmed_at` →
    `emailVerified`; the move invalidates every session. https://www.better-auth.com/docs/guides/supabase-migration-guide.
12. Env and cookies: `BETTER_AUTH_SECRET` (required in production), `BETTER_AUTH_URL`; cookies
    `better-auth.session_token`, `__Secure-` prefixed under https; `telemetry: { enabled: false }`.
    https://www.better-auth.com/docs/reference/options, https://www.better-auth.com/docs/concepts/cookies.
13. Room left: the Stripe plugin adds `user.stripeCustomerId` and a `subscription` table; the MCP plugin
    (`@better-auth/mcp`, with `jwt()`) adds its OAuth tables and serves the well-known endpoints itself (§9.3).
    https://www.better-auth.com/docs/plugins/stripe, https://www.better-auth.com/docs/plugins/mcp.
14. Found by commit 5 in the installed source: every before hook is handed the request as it came, and the
    top-level `hooks.before` runs before every plugin's, the bearer plugin's included, which is the hook that turns
    `Authorization: Bearer` into the session cookie (`api/dispatch.mjs` `getHooks`, `runBeforeHooks`;
    `plugins/bearer/index.mjs`). A hook that must know who is asking reads `readSessionUserId(ctx.headers)`, which
    runs Better Auth's own get-session with every hook. Change email's links are JWTs signed with the secret and
    never stored; verify-email's failures redirect to the landing with `?error=TOKEN_EXPIRED|INVALID_TOKEN|
    USER_NOT_FOUND|INVALID_USER`; its second link, opened with no session, makes one for the login.

### 2.10 A login's address, everywhere (commit 5.5)

The address a login signs in with is copied twice in `public`: `coaches.email` (UNIQUE) for a coach and
`clients.email` for a client. Every screen and email of the app reads one of those, the Account card and the coach
menus aside (they read the session). From 5.5 the copies follow the login in one write, for both roles:
- **The write.** Migration 210's trigger (§2.1) rewrites the login's coach row and client row in the statement that
  changes its address, whoever changes it: Better Auth's verify-email (the second link of a change, rule 17) or the
  owner's command (rule 19). Commit 5's `mirrorLoginEmail` (`lib/auth.ts`) and `mirrorEmailToCoachRow`
  (`services/account-service.ts`), and the `user.update.after` hook that ran them, are deleted. A copy that fails
  fails the login's change with it: Better Auth then answers the link with its 500 (to Sentry through
  `reportEndpointFailure`) and nothing has changed, so the link can be opened again once the conflict is gone.
- **From birth.** `acceptClientInvitation` (`services/login-service.ts`) writes `clients.email` with `user_id`: the
  invited address, lower-cased as the login's. A coach who edited a pending client's address after the invite went
  out (the details sheet already says "An invitation already sent stays addressed to the old email.") no longer
  leaves the client row on an address the client doesn't sign in with. `createCoachLogin` already writes the
  login's address to the coach row.
- **Who may change it.** Coaches and clients alike (D18). Commit 5's `refuseEmailChangeUnlessCoach` becomes the
  check of the new address: a change to an address that a coach row or a client row of another login, or of no
  login, already holds is answered as Better Auth answers an address with a login (`{ status: true }`, no email),
  so no answer tells anyone which addresses are in use, and a pending client's invite can never meet an address
  someone else took. It still reads who is asking through `readSessionUserId` first (no session: the endpoint's
  own 401, so the check answers nobody signed out) and runs on `/change-email` alone (§2.9 #14).
- **The client's card.** `components/client-portal/account-card.tsx` gains Change email. The dialog moves from
  `components/coach/` to `components/auth/` (both audiences) and takes its landing: `COACH_SETTINGS_PAGE` or a new
  `CLIENT_SETTINGS_PAGE` (`/client/settings`, `lib/constants.ts`); the client card hands it the session's address.
  `ChangeEmailLinkNotice` moves to `components/auth/` the same way, each Settings page hosting it behind its own
  Suspense boundary with its own landing (the client page is prerendered too).
- **The coach's lock (D38).** `components/clients/details/details-groups.tsx` shows the Email field read-only, with
  "The client changes this from their Settings.", for a client whose record carries `userId` (`lib/mappers.ts`).
  The sheet sends `email` on every save, so the server's rule is about a change, not the field: `PATCH
  /api/clients/[id]` answers 409 "This client changes their own email." for an `email` that differs from the
  row's on a client row with a `user_id`, and the same address passes. A pending client's address stays the coach's.
- **The owner's command (D39, rule 19).** `scripts/move-email.ts` (`npm run auth:move-email -- --project <ref>
  --email <current> --to <new>`) with `create-coach.ts`'s refusals (`scripts/project-ref.ts`: `--project`, the
  linked ref, `DATABASE_URL` and `NEXT_PUBLIC_SUPABASE_URL` agree; off DEV only with an https `BETTER_AUTH_URL`),
  calling `moveLoginEmail({ email, to })` in `services/account-service.ts`: it refuses an address with no login
  and a new one that any login, coach row or client row holds, then changes the login's address, verified, through
  Better Auth's own adapter (`(await auth.$context).internalAdapter.updateUser`, so Better Auth stays the writer of
  its tables and the trigger copies the rows), ends every session of the login (`deleteUserSessions`), and asks for
  "Reset your password" at the new address (`requestPasswordReset`, landing on `/reset-password`), awaiting
  `backgroundWorkSettled()` before it exits. It prints the move, the session count it ended and, on DEV, the
  `auth:last-link` line.

### 2.11 The product's name (commit 5.1)

The product is Atletafit (owner, 2026-10-09). Commits 1–5 shipped "CoachHub" in 41 places across 15 files, and
5.1 replaces every one a person reads, writing the name once as `PRODUCT_NAME` (`lib/constants.ts`) that each place
reads:
- **Emails:** the six templates in `emails/` (headings, sentences, "The Atletafit Team"), their text bodies and
  subjects in `services/email-service.ts` and `services/auth-email-service.ts` ("You're invited to join
  Atletafit by …", "… has set up your plan on Atletafit", "Set your password for Atletafit"), and the sender's
  fallback, `EMAIL_SENDER`: `<PRODUCT_NAME> <onboarding@resend.dev>` when `EMAIL_FROM` is missing.
- **Screens:** the login page's name, the invite page's sentence and its "Welcome to …" toast, the client portal's
  header (`components/client-portal/nav/client-nav.tsx`), the marketing navbar and footer, the tab's title
  (`app/layout.tsx`: "Atletafit - Client Management Platform"), and the coach rails' monogram, whose alt text
  already says it (`components/persistent-sidebar.tsx`, `components/collapsed-icon-strip.tsx`).
- **What no person reads but still carries the name:** the link-preview fetcher's User-Agent
  (`services/content-metadata-service.ts`), `Atletafit-MetadataBot/1.0`.
- **The guard:** a scan test fails "CoachHub", in any case, anywhere in the shipped tree (`app/`, `components/`,
  `emails/`, `services/`, `lib/`, `contexts/`, `hooks/`, `scripts/`), and "Atletafit" spelled out in code outside
  `lib/constants.ts`, so the old name can't come back and the new one can't drift. Lower-case `atletafit` in a
  domain (`seed.atletafit.test`), a file name or the app's scheme (`atletafit://`, commit 8) is an address, not
  the name, and passes.
- **Docs:** each document's own name for the product (`CONVENTIONS.md`, `docs/ARCHITECTURE.md`,
  `docs/newdesignsystem.md`, `README.md`), and this plan's lines that describe shipped wording. Passed smokes keep
  the words they were run with.
- Nothing else changes: no route, no data, no behaviour.

---

## 3. Decisions

D1–D4 are the owner's answers of 2026-10-07; the rest follow from them, the code or Better Auth, and any of them
can be vetoed before its commit starts.

| # | Decision | Why |
|---|---|---|
| D1 | **Only coaches the owner invites get a coach account.** `/signup` is deleted; the owner's command makes the login and the coach sets a password from an email. | Owner, 2026-10-07. Nobody can give themselves a free account before billing exists; the sign-up page returns with billing. |
| D2 | **Deleting a coach deletes their clients, every record about them, their photos and their logins.** The screen says so in one sentence; an emailed link confirms. | Owner, 2026-10-07. A client's account on this platform exists only through their coach. |
| D3 | **Clients may sign in with Google, never sign up with it.** One login page serves both roles, so it costs nothing. | Owner, 2026-10-07. |
| D4 | **An address must be verified before it can sign in.** Logins made through an emailed link (the owner's coach invite, the coach's client invite) and the logins copied from Supabase are born verified; a changed address takes over only when the new address confirms. | Owner, 2026-10-07. No path makes an unverified login, so nobody sees an extra step; copied logins worked yesterday and keep working. |
| D5 | Better Auth's five tables live in schema `better_auth` with Better Auth's names and column names (§2.1). | Off the Data API entirely; no `fields` maps to maintain; its CLI and plugins assume those names. |
| D6 | Every existing user keeps their id: the copy inserts today's `auth.users.id`, the three FKs re-point to `better_auth."user"` with today's ON DELETE actions. | Nothing that points at a user changes (`profiles`, `coaches`, `clients`, the audit trail's hashes, the proof fixtures). |
| D7 | Passwords keep working: the bcrypt hashes are copied into `account.password`; `password.verify` checks a `$2…` hash with bcryptjs and anything else with Better Auth's scrypt; every password set after the switch is scrypt. A login with no password in Supabase (none expected) uses forgot password. | Better Auth's own Supabase guide does the copy; the two-way verify is the one addition. Nobody has to do anything. |
| D8 | At the switch everyone is signed out once and signs in again; Supabase's reset links sent before it stop working; invite links keep working (they are the app's own tokens). | Supabase's cookies are not Better Auth sessions, and Better Auth's guide says the same. |
| D9 | The role is set by the path that makes the login: `coach:create` → trainer, the invite → client; a guard refuses any creation on another path; the Supabase trigger and the email lookup are gone. | Closes TECHNICAL-DEBT :470 (anyone with an invited address could sign up as that client) and :468 at the root. |
| D10 | A login and its app rows are two writes; if the second fails the first is undone and the error shown. | Better Auth owns its insert (hashing included) and PostgREST owns ours; no transaction spans them. |
| D11 | The invite is accepted on the server in one request from `{ token, password }`; the token lookup answers the coach's name and a masked address. | TECHNICAL-DEBT :470's body-supplied `userId` goes; a stolen link learns less. |
| D12 | The proxy (`proxy.ts`, Node) validates the session with Better Auth on every request and keeps today's fail-closed role check; signed-out `/api/…` requests get `401` JSON, pages the 307. | Same posture as today with one database read instead of one call to Supabase's auth server; the client app needs JSON, not a login page. |
| D13 | `/api/auth/me` keeps its shape and becomes a pure read; the create-on-read branches and `deriveRole` are deleted. | The creation paths write the rows in the same request; nothing races them. |
| D14 | "Log out" ends this device's session; "Sign out everywhere" ends all of them, this one included. | Today's `signOut({ scope: "global" })` signed out everywhere on every log out; Better Auth separates the two, and the owner asked for both. |
| D15 | Sessions last seven days from their last renewal, and a use a day or more after it renews them (Better Auth's defaults); no cookie cache. | Revocation, deletion and sign-out-everywhere take effect on the next request. |
| D16 | Better Auth's limiter, stored in its own table, on in production only (its default); the app's Upstash limiter and tiers are untouched. | No Redis coupling for the auth endpoints; the proofs run under `next dev` where it is off. Per-account lockout stays unbuilt (TECHNICAL-DEBT :282). |
| D17 | "Set your password" and "Reset your password" are one Better Auth flow with two templates, told apart by the page the link lands on (`/set-password` vs `/reset-password`). | No user column, no hook, no flag to clear; the owner's command simply asks for the other landing page. |
| D18 | A coach and a client change their email the same way: two emails (approve at the current address, confirm at the new), and only the second link changes it (commit 5 for coaches, 5.5 for clients). Every copy of the address follows it in one write (D37). A new address already in use anywhere gets Better Auth's no-email answer. | Better Auth's flow at 1.7.7. Owner, 2026-10-09: "changing their email needs to be reflected platform wide. client side and coach side etc. … nothing should break." (Commit 5 shipped coaches only, from a list that had given clients no change-email.) |
| D19 | Change password asks for the current password and signs out every other device; passwords are 8–128 characters everywhere (the invite's 72 was bcrypt's limit). | Better Auth's `revokeOtherSessions`; scrypt has no 72-byte limit. |
| D20 | Delete account asks for the password, then an emailed link; photos and files go first, then one SQL function per role, then Better Auth deletes the login. | The password check is free; the link makes a stolen session useless for deletion; objects first so a retry can always finish. |
| D21 | A client's delete removes their client row and everything under it; the coach sees the client gone and keeps nothing. | UK GDPR erasure of what the app holds about the person; the owner wasn't asked for anything softer. |
| D22 | The seam's functions keep their names, signatures and `request` argument; `lib/require-*-auth.ts` don't change; 120+ routes don't change. | The seam was built for this (the lockdown collapsed every identity read onto it). |
| D23 | Google is sign-in only, linked by email to the existing login (trusted provider); an unknown address lands on `/login` with "There's no account for that Google email."; the button exists only once the keys do (commit 7). | `disableSignUp` plus `trustedProviders`; today's button never worked, so showing it before commit 7 is a lie. |
| D24 | The admin plugin is on for `createUser`; `adminUserIds` is read from `AUTH_ADMIN_USER_IDS` (the owner's user id) for the admin endpoints that need a session later. | The owner's command needs `createUser` alone, which 1.7.7 allows without a session. |
| D25 | `bearer()` and `expo()` are on; the scheme is `atletafit://`; the CSRF check passes bearer requests; no app code. | The audit's first priority before any RN build; the scheme must be chosen now or it is a server change later. |
| D26 | Packages: `better-auth` pinned at `1.7.7`, `pg`, `kysely`, `bcryptjs`, `@better-auth/expo`; `@supabase/ssr` removed. Approved by the owner's go on this plan (CONVENTIONS "ask before npm install"). npm's resolver refuses `better-auth` here (its optional SvelteKit peer wants Vite 8; vitest has Vite 7), so commit 1 resolved it lockfile-only in a scratch copy (`npm install --package-lock-only --force`), checked the lockfile gained only better-auth's own packages, copied it in and ran a plain `npm install`; removing `@supabase/ssr` (3) and adding `@better-auth/expo` (8) take the same route. `--legacy-peer-deps` is never the answer: it drops the 53 peer-installed packages, `@testing-library/dom` among them. | The adapter form with `schemaName` takes a Kysely dialect; bcryptjs is pure JS (no native build on the host); `pg` is Better Auth's peer. |
| D27 | Billing's room: Better Auth's Stripe plugin later adds `user.stripeCustomerId` and a `subscription` table in the same schema by its own migration; nothing here is shaped for it and nothing blocks it. | The owner's "leave room … build nothing of it". |
| D28 | `DATABASE_URL` is Supabase's transaction pooler string for the `postgres` user; one pool of four per bundle (the proxy's and the routes' are separate bundles). | Serverless-safe; `postgres` owns the schema, so RLS never bites Better Auth; a direct connection is IPv6-only on Supabase. |
| D29 | Env: `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` (= `NEXT_PUBLIC_APP_URL`), `DATABASE_URL`, `AUTH_ADMIN_USER_IDS`, `EMAIL_FROM`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`; `NEXT_PUBLIC_SUPABASE_ANON_KEY` has no reader after commit 3 and leaves `.env.local`. | Documented per CONVENTIONS 852 (no `.env.example`): at the read site and in §19's list. |
| D30 | The emails use one sender (`EMAIL_FROM`, falling back to `onboarding@resend.dev`), one look, and the product's name, Atletafit, written once (`PRODUCT_NAME`, `lib/constants.ts`) and read by every screen, email and tab title (commit 5.1). Commits 1–5 shipped the old name, "CoachHub". | Owner, 2026-10-09: "It's not called coachub." One constant, so the name can't drift between an email's sender and its sign-off. |
| D31 | Migrations: 208 (schema + copy, additive), 209 (the switch), 210 (a login's address and its copies in one write, commit 5.5), 211 (delete functions, commit 6). The coach chat plan's "migration 208" takes the next free number when it is built (§9.3). | CONVENTIONS: next number, never skip; this plan ships first; 5.5 is built before 6, so it takes 210. |
| D32 | Undo (§8.3): revert the switch commit, then a new migration re-points the FKs to `auth.users` as `NOT VALID` and restores the trigger from 107; logins made after the switch are re-invited; passwords changed after it revert to the old ones. | Supabase's rows are never touched by the switch, so the old door reopens. |
| D33 | Supabase Auth is retired, not deleted, until the undo window closes: providers off, sign-ups off; the owner deletes `auth.users` after (§9.1). | The undo needs the rows. |
| D34 | `proof-session.ts` mints a session by inserting a `better_auth.session` row through the pool and sending its token as a bearer token; cookie-path proofs sign in over HTTP with a throwaway's password. | The old magic-link mint is Supabase's; a bare token is accepted by the bearer plugin (its default); no secret-signing in scripts. |
| D35 | `check:service-key`'s positive control becomes `NEXT_PUBLIC_SENTRY_DSN` (public by design, inlined by `instrumentation-client.ts`). | The anon key, today's control, leaves the bundle with the browser client. |
| D36 | `next.config.mjs`'s CSP is untouched: after commit 2 the browser makes no request to Supabase's auth server, and the `*.supabase.co` entries still serve storage images and signed links. | Trimming the CSP is not this plan's job; nothing in it refers to auth. |
| D37 | `coaches.email` and `clients.email` are copies of the login's address, written in the statement that changes it by a trigger on `better_auth."user"` (migration 210), whatever changes it; the invite's acceptance writes the client's at birth. Commit 5's after hook (`mirrorLoginEmail`) is deleted. | Owner, 2026-10-09: "nothing should break". A copy written after the login's change can fail on its own and leave the coach seeing, and the app emailing, an old address; one write can't half-happen (§2.1's alternatives). |
| D38 | A coach can't change the email of a client who has an account: the details sheet shows it read-only, and the client route refuses a different address with 409. Before the invite is accepted, the field is the coach's as today. | Owner, 2026-10-09: "prevent a coach from editing as it's the clients to change." A coach's edit moved only the copy, never the address the client signs in with. |
| D39 | No recovery email. Someone who has lost their sign-in inbox asks the owner, who confirms who they are and runs `npm run auth:move-email`: the address moves everywhere (D37), every session of the login ends, and "Reset your password" goes to the new address. | Owner, 2026-10-09. A recovery address is a second key to every account, with its own takeover risk and its own upkeep for every person; "forgot which email I use" is answered by the coach (a client's) and the owner (a coach's). |

---

## 4. Blast radius

Grepped 2026-10-07 at `d5f23299`. A map, not a promise: each session greps again for every dependant.

| Subsystem | Today | After | Commit |
|---|---|---|---|
| `package.json` | `@supabase/ssr`, no auth library | `better-auth@1.7.7`, `pg`, `kysely`, `bcryptjs`, later `@better-auth/expo`; `@supabase/ssr` gone (3) | 1, 3, 8 |
| `supabase/migrations/` | 207 | 208 (schema + copy), 209 (switch), 210 (a login's address in one write), 211 (delete functions) | 1, 2, 5.5, 6 |
| `lib/auth.ts`, `lib/auth-client.ts`, `app/api/auth/[...all]/route.ts` | none | new | 1, 2 |
| `middleware.ts` + `middleware.test.ts` | Edge; Supabase `getUser()`; 307 for `/api/**` | `proxy.ts` + `proxy.test.ts`; Node; `auth.api.getSession`; 401 JSON for `/api/**`; `/api/auth/` and `/set-password` public | 1 (the `/api/auth/` skip only), 2 |
| `lib/auth-helpers.ts` + test | `createServerSupabaseClient().auth.getUser()` | `auth.api.getSession({ headers })`; bearer accepted | 2 |
| `lib/supabase-server.ts`, `services/supabase-client.ts` | the session clients | deleted | 2 |
| `contexts/auth-context.tsx` | Supabase browser client, `onAuthStateChange` | `authClient.useSession()`; `login`/`logout` on Better Auth | 2 |
| `app/login/page.tsx`, `components/auth/login-notice.tsx`, `lib/constants.ts` | Google button (dead), one notice | no Google until 7; notices for `signup_disabled`, `account_not_linked`, `deleted=1` | 2, 6, 7 |
| `app/signup/page.tsx`, `app/auth/callback/route.ts`, `signupSchema` | exist | deleted | 2 |
| `app/forgot-password/page.tsx`, `app/reset-password/page.tsx` | Supabase calls | `requestPasswordReset`, `resetPassword` with `?token=` | 2 |
| `app/set-password/page.tsx` | none | new (rule 9) | 4 |
| `app/invite/[token]/page.tsx`, `app/api/invitations/accept/route.ts`, `app/api/invitations/[token]/route.ts`, `services/invitation-service.ts` | browser `signUp` + body `userId`; full email in the lookup | `{ token, password }` → `acceptClientInvitation`; masked email; legacy branch and `acceptInvitation` deleted | 2 |
| `services/auth-profile-service.ts`, `app/api/auth/me/route.ts` | create-on-read, `deriveRole` | `services/login-service.ts` (`createCoachLogin`, `acceptClientInvitation`); `/me` reads only | 2, 4 |
| `services/email-service.ts`, `services/auth-email-service.ts`, `/emails/*` | two templates, sender constant | five new templates; `EMAIL_FROM` | 2, 4, 5, 6 |
| `components/persistent-sidebar.tsx:29-41`, `components/collapsed-icon-strip.tsx:35-47`, `components/client-portal/nav/client-nav.tsx:43-46,81-84` | `logout()` → `/login` | unchanged callers; `logout()` is this device only | 2 |
| `lib/session-client-ownership.test.ts` | positive control requires the Supabase session clients | no file may build a Supabase session client; `lib/auth.ts` the only `betterAuth(`/`new Pool(` (test files aside: `lib/auth.test.ts` builds one over the memory adapter); `lib/auth-client.ts` the only `createAuthClient(`; the receiver rule stays | 2 |
| `scripts/check-service-key-leak.ts` | anon key as the bundle control | Sentry DSN as the control (D35) | 2 |
| `scripts/proof-session.ts` and every script that mints a Supabase session or login (`sign-in-proof.ts`, `measurement-edit-proof.ts`, `content-access-proof.ts`, `data-api-locked-proof.ts`, `data-api-writes-proof.ts`, `habit-routes-proof.ts`, `clear-training-log-proof.ts`, `wire-proof-measurements.ts`, `check-in-as-of-proof.ts`, `seed/teardown.ts`, `seed-scale.ts`, `seed-scale-client.ts`) | `generateLink`/`verifyOtp`/`auth.admin.createUser` | `mintSession` (bearer) and `createThrowawayLogin` / `deleteThrowawayLogin` from `scripts/auth-fixtures.ts` | 2 (`proof-session.ts`), 3 (the rest) |
| `scripts/create-coach.ts`, `scripts/auth-last-link.ts`, `scripts/move-email.ts`, `package.json` scripts | none | `coach:create`, `auth:last-link`, `auth:move-email` | 4, 5.5 |
| `app/(coach)/settings/page.tsx`, `components/coach/account-card.tsx` (+ dialogs), `components/auth/change-email-dialog.tsx` and `change-email-link-notice.tsx` (moved from `components/coach/` in 5.5) | mock Profile card | the Account card | 5, 5.5, 6 |
| `app/client/settings/page.tsx`, `components/client-portal/account-card.tsx` (+ dialogs) | Profile, Units, Timezone | + Account (Change password; Change email and the link notice from 5.5) | 5, 5.5, 6 |
| `services/account-service.ts`, `services/storage-service.ts` | none; upload only | 5: the coach-email mirror (deleted by 5.5); 5.5: `moveLoginEmail` and the new address's check; 6: delete paths, object removal by key list | 5, 5.5, 6 |
| `lib/constants.ts` and the 15 files that say "CoachHub" (`emails/*`, `services/email-service.ts`, `services/auth-email-service.ts`, `services/content-metadata-service.ts`, `app/layout.tsx`, `app/login/page.tsx`, `app/invite/[token]/page.tsx`, `app/(marketing)/layout.tsx`, `components/marketing/marketing-navbar.tsx`, `components/client-portal/nav/client-nav.tsx`), the two rails' monogram, their tests, the docs' titles | "CoachHub" written out in each | `PRODUCT_NAME` ("Atletafit") read by each; a scan test holds it | 5.1 |
| `services/login-service.ts`, `services/client-service.ts`, `app/api/clients/[id]/route.ts`, `components/clients/details/details-groups.tsx` | the invite links `user_id` alone; the coach edits any client's email | the invite writes `clients.email` with the link; a client with an account keeps their address against the coach's edit (409, read-only field) | 5.5 |
| `lib/csrf-protection.ts` + test | Origin/Referer always | bearer requests pass | 8 |
| `docs/ARCHITECTURE.md` | Auth Model, Onboarding (1298), Database clients on Supabase Auth | current shape only | 2 (Auth Model), 9 (the rest) |
| `CONVENTIONS.md`, `TECHNICAL-DEBT.md`, `CLIENT-APP-REFERENCE.md` | see below | see below | 2, 9 |

**CONVENTIONS rules marked for rewriting** (built as §2 says; the words change in commit 2 for the first four
and commit 9 for the rest): §8 line 501 (the browser's "anon-key client is `supabase.auth`-only" sentence → the
browser holds `authClient` alone and never a Supabase client); §8 lines 525–527 (the session-client paragraph →
no session client exists; who the caller is comes from `auth.api.getSession` in the seam and the proxy); §9
line 713 (the `getUser()`-not-`getSession()` rule → Better Auth's `getSession` validates against the session
table, and `getSessionCookie` is the thing never to trust); §8 line 543 (the `handle_new_user` exception → gone);
§9 line 751 (`authRateLimit` and "no app route serves login" → `/api/auth/*` is Better Auth's, limited by its own
limiter; `/me` and the invite routes as today); §9 lines 729–757 (the tiers gain Better Auth's); §6's folder map
(`lib/auth.ts`, `lib/auth-client.ts`, `proxy.ts`, `services/login-service.ts`, `services/account-service.ts`,
`services/auth-email-service.ts`, `app/api/auth/[...all]/`); lines 880–882's env list (D29); line 581's soft-delete
rule (a fourth hard-delete exception: an account deletion is an erasure, §2.6); lines 66–67 (the packages, approved
here); lines 168–170 ("additive over breaking": the switch replaces by design, on the owner's plan); §2 line
104, §8 lines 503–514, §9 lines 715, 716 and 721, §10 lines 762 and 766–775, and §12 line 810 (the review's write-route item,
the route-level chain, the rate limit as the first check, the `requireCSRFProtection` call, the `{ success, data }`
answer, the handler order and the route's own try/catch → an exception for Better Auth's catch-all
`app/api/auth/[...all]`: its own limiter, origin check, error handling and answers; `/api/auth/me` keeps the app's
chain, and §12 line 812 holds, its unexpected errors reaching Sentry through `onAPIError` and an after hook; owner, 2026-10-08, at
commit 1). **ARCHITECTURE
lines that describe the old shape** and change in commit 2: 1222–1261 ("Auth Model" through "Database clients":
the trigger at 1225, the public list at 1231, `auth.getUser()` and Edge at 1235, the helpers at 1247, the session
bootstrap at 1252, the session-client bullet at 1259, `supabase_auth_admin` at 1261); 1298 ("creates Supabase
auth account"); in commit 9: the Settings pages, the delete paths, the RN contract. `CLIENT-APP-REFERENCE.md`
:36, :153-157 and :164 ("Login/logout are Supabase client SDK calls") in commit 9. `TECHNICAL-DEBT.md`: :470
closed by commit 2; :256, :281, :306-307, :468 closed by 2; :679 closed by 6; :282 and :632-637 stay open, said
so.

---

## 5. Verification

- **Gates after every commit:** `npx tsc --noEmit`, `npx eslint .` (and `grep -rn "console.log"` on changed
  files), `npx vitest run`, `npm run check:labels`, `grep -rn "as any"` and `grep -rn "TODO\|FIXME\|HACK\|DEBUG"`
  on changed files, `npx knip`, `npm run check:service-key`. Plus `npm run check:rls` for commits 1, 2, 5.5 and 6
  (migrations), and `npm run build` (which chains `check:prerender`) for commits 1, 2, 4, 5, 5.1, 5.5, 6, 7 and 8 (the
  proxy, a route handler, pages or Settings change). Commit 9's doc edits need none. **The security, load and
  performance review** (CONVENTIONS §2) is reported for every commit but 9; for 2 it covers every redirect and
  cookie the proxy and the accept route emit; for 5.5 every path that changes an address and every row the
  trigger writes; for 6 every row the two functions reach. The
  `components/client-portal/**` set-tracker test is known to flake in full runs (a fetch race): if it alone fails,
  rerun it alone and say so.
- **Proofs on DEV** (the shape of `scripts/proof-session.ts` after commit 2 and `scripts/goal-routes-proof.ts`, run
  with `npx tsx --tsconfig ./tsconfig.json` against a `next dev` the script starts on a free port, never :3000;
  every row a proof creates is deleted in `finally`; Resend is never called — the proofs read tokens from
  `better_auth.verification` through the pool; from commit 3, `startProofServer` in `scripts/proof-server.ts` starts
  that server, `createThrowawayLogin` / `deleteThrowawayLogin` in `scripts/auth-fixtures.ts` make and remove a
  throwaway's login, `passwordLinkToken` beside them reads a password link's token, and `endMintedSessions` ends
  every session a proof minted):
  - 1: `scripts/better-auth-standup-proof.ts prepare|check`: `prepare` (before the push) makes a throwaway Supabase
    login with a known password through `auth.admin.createUser` (the trigger makes its rows); `check` (after)
    signs it in through `POST /api/auth/sign-in/email` → 200, `set-auth-token` and the cookie, `GET
    /api/auth/get-session` → the Supabase user id; a wrong password → 401 `INVALID_EMAIL_OR_PASSWORD`; `POST
    /api/auth/sign-up/email` → refused; counts: every `auth.users` row with an email has a `better_auth."user"`
    row and every one with a password a `credential` row. Cleanup removes both sides.
  - 2: `scripts/sign-in-proof.ts` rewritten: as the owner's coach (minted, D34) `/api/auth/me` and `/api/clients`
    answer as before; as "Test intake form bug" `/api/client/me` answers; no session: `/dashboard` → 307 `/login`
    (`redirect: "manual"`), `/api/clients` → 401 JSON; a client on `/dashboard` → 307 `/client`; a coach on
    `/client` → 307 `/dashboard`; a throwaway coach signs in over HTTP (cookie), requests a reset, the token is
    read from the table, the reset link lands on `/reset-password?token=…`, `resetPassword` works, the old
    password fails, the earlier cookie is dead; an invited throwaway client accepts with `{ token, password }` and
    the response's cookie opens `/api/client/me` with the right client id; a second accept of the same token →
    error; an accept body with an extra `userId` is ignored (zod strips it); the expired-link page shows rule 4's
    sentence (`?error=INVALID_TOKEN`); `GET /api/invitations/<token>` carries no full address; the compensation:
    a throwaway accept with the `profiles` insert forced to fail leaves no `better_auth."user"` row.
  - 3: each rewritten script runs once end to end on DEV (its own checks are the proof); `npm run check:rls`
    unchanged.
  - 4: `scripts/create-coach-proof.ts`: `npm run coach:create` for a throwaway address → `better_auth."user"`
    row with `emailVerified = true`, `profiles` trainer, `coaches` row, no credential row; `auth:last-link`
    prints a link whose `callbackURL` is `/set-password`; following it and `resetPassword` makes the credential
    row; sign-in works; `coach:create` again for the same address → "already exists", nothing written; a run
    whose `--project` names PROD's ref against DEV's env is refused before any write.
  - 5: `scripts/account-proof.ts` on a throwaway coach: change password with a wrong current → 400
    `INVALID_PASSWORD`; with the right one → the old fails, the new works, a second session minted before is
    dead; change email → the approval token appears for the old address and nothing changes; following it → the
    confirmation token for the new address; following that → `better_auth."user".email` and `coaches.email` both
    read the new address; `revokeSessions` → every session of the user gone from the table.
  - 5.5: `scripts/email-follows-proof.ts`, its email read from `scripts/proof-mailbox.ts` as commit 5's proof reads
    it, the throwaways a coach and two clients of theirs (one with an account, one only invited): a client's change of
    email by its two links → `better_auth."user".email` and `clients.email` both new, the client signs in with it
    and stays signed in on the session that asked, the coach's `GET /api/clients/<id>` answers the new address, the
    client's `GET /api/client/me` too; a coach's change → `coaches.email` follows (the trigger, the hook gone);
    one write: a coach row with no login holding an address, and the throwaway coach's login changed to it
    through the pool (the guard bypassed on purpose) → the coach row's UNIQUE key fails the statement, and the
    login and its coach row both keep their address; a change to an address a client row or a coach row holds → 200, no email,
    nothing changed; the coach's `PATCH /api/clients/<id>` with another address for the client with an account →
    409, the row unchanged; with the same address → 200; for the invited client → 200, changed; the invite's
    acceptance after the coach edited the pending address → the client row reads the invited address;
    `npm run auth:move-email` for the throwaway client → the login and the client row on the new address, its
    sessions 0, "Reset your password" in the mailbox for the new address (the command's Resend pointed at it),
    the reset works; refused with nothing changed: an address with no login, a `--to` that any login, coach row or
    client row holds, and PROD's ref against DEV's env.
  - 6: `scripts/delete-account-proof.ts`: a throwaway coach with two throwaway clients, one holding a check-in
    with a photo object and a content item assigned (`assigned_by` the coach); as a client: delete-user with the
    password → the token appears; the callback → the client row and every row under it gone, the photo object
    gone, the login gone, the other client and the coach intact; as the coach: the same → every row referencing
    the coach in every table of §2.6 is 0, both buckets hold none of the keys, the clients' logins are gone; a
    forced object-removal failure → refused, every row intact.
  - 8: the bearer proof of §2.8.
- **Tests** (vitest; Better Auth's `auth.api` and the pool mocked the way `supabaseAdmin` is mocked elsewhere):
  the proxy's decisions (the two skip lists, 401 JSON under `/api/`, 307 for pages, role redirects, fail-closed,
  the folder ⟷ list binding); the seam (null session → null, bearer header reaches `getSession`, cache untouched);
  the guard hook (every path but `/admin/create-user` throws); `verifyBcryptOrScrypt` (a bcrypt hash → bcryptjs,
  anything else → scrypt); `createCoachLogin` and `acceptClientInvitation` (every refusal, every write, the
  compensation on each failing write); the accept route (zod, no `userId`, cookies forwarded); the masked address;
  the email picker (`/set-password` vs `/reset-password`); each dialog's states and its call; the login notices;
  `beforeDelete` (role → keys → objects → function; refusal on each failure); the CSRF bearer pass; the
  `auth-last-link` parser against Better Auth's memory adapter; the ownership scan's new clauses; the
  `check:service-key` control; for 5.1, the name's scan (the old name, a second spelling) and each email's and
  screen's wording read from `PRODUCT_NAME`; for 5.5, migration 210's file read for its trigger, its function's grants and its
  closing check, the new address's check over Better Auth's pipeline (cookie and bearer, a held address, no
  session), the client card's Change email and both Settings pages' notice, the details sheet's read-only field,
  the route's 409 and its same-address pass, the invite's email write, and `moveLoginEmail`'s refusals and writes.
  **A test and a mutation for every new rule.**
- **The browser smokes** are the owner's: §7.1 after commit 2, §7.2 after 4, §7.3 after 5, §7.3a after 5.1, §7.3b
  after 5.5, §7.4 after 6, §7.5 after 7.

---

## 6. The commits

Each prompt is complete on its own: paste it into a fresh session. **The session builds without a plan review**
(owner, 2026-10-07: "so fresh sessions build it without a plan review"). It stops only for the reasons its prompt
names, and hands over when everything the commit lists is built and every gate passes. The logins move in 1–3;
nothing a coach or client sees changes until commit 2, and from commit 2 every screen runs on Better Auth.

**How every commit runs (owner, 2026-10-08, after commit 1 took a day).** Where a prompt below asks for more (every
Better Auth fact checked against docs and source, every review finding fixed, every gate run twice, a mutation for
every rule), this block wins:
1. **Read** CONVENTIONS.md whole; from this plan its head, §1–§5, this block, the commit's own §6 entry, and the §7
   smoke and §8 step it names. ARCHITECTURE only where the prompt names it.
2. **Better Auth facts:** check only the ones this commit's code relies on, against the installed source in
   `node_modules` (the source is the truth; no docs sweep). A §2.9 fact found false still stops the session.
3. **Tests:** a test for every new rule; a deliberate break (a mutation) only for the rules the prompt names and
   for any security guard. While building, run only the affected test files.
4. **Review:** one independent review of the diff once the build is done. Fix its blockers and should-fix items at
   the root, list its nits in the handover for the owner to decide, and run no second review, except in the four
   security-heavy commits, 2 (the switch), 5.5 (moving a login's address), 6 (deleting accounts) and 8 (app
   tokens): there a second independent
   review reads the first review's fixes, and its blockers and should-fix items are fixed the same way.
5. **Proof and gates:** the commit's DEV proof once, on the finished code; the full gates once, after the last
   review's fixes.
6. **Scope:** build what the commit lists. A security defect in the commit's own code is fixed in the commit; a
   fact that changes how a later commit must be built goes into that commit's entry here; anything else worth
   doing goes in the handover as a recommendation, not into the diff.

### Commit 1 — `feat(auth): Better Auth stands up beside Supabase Auth: its schema (migration 208), today's logins copied in, and the server behind /api/auth`

**STATUS: SHIPPED `a503ddb6` 2026-10-08.**

- `better-auth@1.7.7` (exact), `pg`, `kysely`, `bcryptjs` installed (D26). `lib/auth.ts` with every §2.2 option
  that needs no email and no screen: the database, `trustedOrigins` (the app URL only), `emailAndPassword` with
  `disableSignUp`, `requireEmailVerification`, the password lengths, `revokeSessionsOnPasswordReset`,
  `password.verify`; `session`; `rateLimit`; the guard hook; `advanced.database.generateId: "uuid"`;
  `plugins: [admin({ adminUserIds }), bearer()]`; telemetry off. No `sendResetPassword` yet (nothing calls it).
- `app/api/auth/[...all]/route.ts`. In `middleware.ts`, the prefix `/api/auth/` joins the skip list (its test
  asserts it, and that `/api/auth/me` still answers its own 401).
- Migration 208 (§2.1) on DEV, checked against `npx auth@1.7.7 generate` (the CLI at the pinned version) run to a scratch file before the push
  (every column the CLI expects exists with a compatible type; the deliberate differences are the uuid ids and
  the NOT NULL defaults); `types/database.ts` regenerated and read (expected: no change — the schema is not
  `public`).
- Env: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `AUTH_ADMIN_USER_IDS` read in `lib/auth.ts` with
  a comment each; CONVENTIONS §19's list gains them (the words themselves wait for commit 9's rewrite, but the
  list is current from here).
- `scripts/better-auth-standup-proof.ts prepare|check` (§5), run around the push.
- Nothing a coach or client sees changes; nothing imports `lib/auth.ts` but the route handler and the proof; the
  middleware keeps its Supabase path untouched (it stays on the Edge runtime until commit 2).

```text
Read CONVENTIONS.md (whole) and from docs/BETTER-AUTH-PLAN.md its head, §1–§5, §6's "How every commit runs" and this commit's entry. From
docs/ARCHITECTURE.md read only "Auth Model" through "Database clients" and
"API Route Structure". Also read supabase/migrations/201_lock_the_database.sql
(a migration's closing DO check), supabase/migrations/203_client_habits.sql (a
new table's header and comments), middleware.ts and middleware.test.ts, and
scripts/proof-session.ts with scripts/goal-routes-proof.ts as the proof shape.
Open another section only when something you touch points to it.

Job: Commit 1 of docs/BETTER-AUTH-PLAN.md §6 — `feat(auth): Better Auth stands
up beside Supabase Auth: its schema (migration 208), today's logins copied in,
and the server behind /api/auth`. Build exactly what that section lists, to §2.1
and §2.2. Every sign-in still runs on Supabase after this commit; Better Auth
only answers under /api/auth and holds a copy of every login.

Before anything: .env.local must hold DATABASE_URL (Supabase's transaction
pooler string for DEV), BETTER_AUTH_SECRET and BETTER_AUTH_URL; if any is
missing, stop and ask me for it. Read Better Auth's docs for every option you
set (§2.9 names the pages) and its installed source where §2.9 cites source; if
a §2.9 fact is false at 1.7.7, stop and say which.

You have my go: don't show me a plan and don't wait for my review. Plan for
yourself, build it, and hand over when it is done. Stop and ask me only if a §3
decision this commit needs is blank, if building exactly what this commit lists
would break a CONVENTIONS.md rule that §4 does not mark for rewriting, or if a
gate fails and its root fix lies outside this commit.

Done when: everything that section lists is built; migration 208 is on DEV and
holds every column the CLI's generated schema expects; scripts/better-auth-
standup-proof.ts check passes on DEV after the push (prepare ran before it);
an independent review of the whole diff, docs included, has run and every
finding is fixed at the root; and every gate passes after the build and again
after the review's fixes: npx tsc --noEmit, npx eslint ., npx vitest run, npm
run check:labels, npx knip, npm run check:service-key, npm run check:rls, npm
run build. Never skip, weaken or delete a test to make a gate pass. Report the
security, load and performance review (CONVENTIONS §2).

Working method: the Edit tool, not shell edit scripts; grep at execution time
for every dependant (§4 is a map, not a promise); a test and a mutation for
every new rule (the guard hook, the two-way password verify, the skip list),
each test run green on the real code first, each mutation from a cp backup in
the scratchpad, never git stash or git checkout --. The proof starts its own
next dev on a free port; lsof -i :3000 first and never start or stop :3000.
Before the push, confirm supabase/.temp/project-ref reads aeaphsslctwcmebldrzx
(DEV); run supabase db push --dry-run immediately before the push (from the
Bash tool the push confirms itself; if it is classifier-blocked, hand it to me
with !), then npx supabase gen types typescript --linked > types/database.ts
and read the diff.

Then commit directly to main (this plan file included), replace this commit's
STATUS line in §6 with SHIPPED, the hash and the date, and hand over: what
shipped; anything you decided that the plan did not say; the proof's output;
and the counts the migration's check printed. There is no browser smoke for
this commit: the proof is the evidence.
```

### Commit 2 — `feat(auth): every sign-in runs on Better Auth: the proxy, the seam, the login, forgot and reset pages, the invite; migration 209 moves the user keys`

**STATUS: SHIPPED `9f136a30` 2026-10-08.**

- `middleware.ts` → `proxy.ts` and `proxy.test.ts` (§2.2: `/api/auth/` and `/set-password` public, `auth.api.getSession`,
  401 JSON under `/api/`, the fail-closed role check, `redirectPreservingCookies` gone). `lib/auth-helpers.ts` on
  `auth.api.getSession` (§2.2), its test rewritten. `GET /api/auth/me` a pure read; `services/auth-profile-service.ts`
  replaced by `services/login-service.ts` (§2.3: `createCoachLogin` and `acceptClientInvitation`, the compensation).
- `contexts/auth-context.tsx` on `lib/auth-client.ts` (§2.4); `app/login/page.tsx` without the Google button;
  `app/forgot-password`, `app/reset-password` on Better Auth; `app/signup/**`, `app/auth/callback/**`,
  `signupSchema`, `lib/supabase-server.ts`, `services/supabase-client.ts` deleted; `@supabase/ssr` removed.
- The invite (§2.3): `app/invite/[token]/page.tsx`, `POST /api/invitations/accept` on `{ token, password }` with
  the cookies forwarded, `GET /api/invitations/[token]` masked, the legacy branch and `acceptInvitation` deleted.
- `sendResetPassword` wired to `emails/reset-password-email.tsx` through `services/auth-email-service.ts` (§2.5;
  the set-password template is commit 4's); `EMAIL_FROM` read in `services/email-service.ts`.
- `lib/constants.ts`: the notice names; `components/auth/login-notice.tsx` unchanged in commit 2 beyond the
  constant's move. `lib/session-client-ownership.test.ts` to its new clauses; `scripts/check-service-key-leak.ts`
  to the Sentry DSN control (D35); `scripts/proof-session.ts` to D34 (`mintSession` → bearer; `signInWithPassword`
  → cookie jar); `scripts/sign-in-proof.ts` rewritten as §5's proof 2.
- Migration 209 (§2.1) on DEV, pushed before the new code is started; `types/database.ts` regenerated.
- `docs/ARCHITECTURE.md` "Auth Model" through "Database clients" and line 1298, CONVENTIONS §8 line 501, lines
  525–527, line 543 and §9 line 713 rewritten to the shape this commit leaves (current shape only, no "used to").
- The smoke seed (§7.1): a pending invitation for "Smoke · invite me" under the owner's coach, its link in the
  handover.

```text
Read CONVENTIONS.md (whole) and from docs/BETTER-AUTH-PLAN.md its head, §1–§5, §6's "How every commit runs" and this commit's entry, then lib/auth.ts
as commit 1 left it. From docs/ARCHITECTURE.md read "Auth Model" through
"Database clients", "Client Onboarding Flow" (to its state machine) and "API
Route Structure". Also read middleware.ts and middleware.test.ts, lib/auth-
helpers.ts and its test, lib/require-coach-auth.ts, lib/require-client-auth.ts,
contexts/auth-context.tsx, services/auth-profile-service.ts, app/api/auth/me/
route.ts, app/login/page.tsx, app/forgot-password/page.tsx, app/reset-
password/page.tsx, app/signup/page.tsx, app/auth/callback/route.ts, app/invite/
[token]/page.tsx, app/api/invitations/accept/route.ts, app/api/invitations/
[token]/route.ts, services/invitation-service.ts, services/email-service.ts,
emails/invitation-email.tsx, lib/session-client-ownership.test.ts, scripts/
check-service-key-leak.ts, scripts/proof-session.ts, scripts/sign-in-proof.ts,
and components/auth/login-notice.tsx. Open another section only when something
you touch points to it.

Job: Commit 2 of docs/BETTER-AUTH-PLAN.md §6 — `feat(auth): every sign-in runs
on Better Auth: the proxy, the seam, the login, forgot and reset pages, the
invite; migration 209 moves the user keys`. Build exactly what that section
lists, to §2.2, §2.3, §2.4 and §2.5, and the rules of §1.1 it names (1, 2, 3,
4, 11, 12, 16). This is the switch: after it, no code path calls Supabase Auth,
and everyone signs in again once (D8). Read Better Auth's docs and installed
source for every endpoint and option you touch; if a §2.9 fact is false at
1.7.7, stop and say which.

You have my go: don't show me a plan and don't wait for my review. Plan for
yourself, build it, and hand over when it is done. Stop and ask me only if a §3
decision this commit needs is blank, if building exactly what this commit lists
would break a CONVENTIONS.md rule that §4 does not mark for rewriting, or if a
gate fails and its root fix lies outside this commit.

Done when: everything that section lists is built; migration 209 is on DEV
(pushed before the new code is first run, with its closing check passing) and
types/database.ts shows exactly its changes; scripts/sign-in-proof.ts passes on
DEV (every check of §5's proof 2); grep finds no @supabase/ssr, createServer
Client, createBrowserClient, onAuthStateChange, signInWithPassword,
exchangeCodeForSession or auth.admin outside scripts/ (commit 3 takes the
scripts); an independent review of the whole diff, docs included, has run and
every finding is fixed at the root; a second independent review of those fixes
has run and its findings are fixed; and every gate passes after the build and
again after the second review's fixes: npx tsc --noEmit, npx eslint ., npx vitest run,
npm run check:labels, npx knip, npm run check:service-key (with its new
control), npm run check:rls, npm run build. Never skip, weaken or delete a test
to make a gate pass. Report the security, load and performance review
(CONVENTIONS §2), covering every redirect and every Set-Cookie the proxy and
the accept route emit.

Working method: the Edit tool, not shell edit scripts; grep at execution time
for every dependant; a test and a mutation for every new rule, each test run
green on the real code first, each mutation from a cp backup in the
scratchpad, never git stash or git checkout --. The proof starts its own next
dev on a free port; lsof -i :3000 first and never start or stop :3000. Before
the push, confirm supabase/.temp/project-ref reads aeaphsslctwcmebldrzx (DEV);
run supabase db push --dry-run immediately before the push (from the Bash tool
the push confirms itself; if it is classifier-blocked, hand it to me with !),
then npx supabase gen types typescript --linked > types/database.ts and read
the diff. The docs describe the shape the code has now, current shape only.

The seed: a throwaway TypeScript script in the session scratchpad, run with
npx tsx --tsconfig ./tsconfig.json, importing @/scripts/env-bootstrap, that
makes a pending client "Smoke · invite me" under my coach (samuel.k@taboola.
com) through the app's own invitation service with the address
s.kalepa91+invite-smoke@gmail.com, deleting any earlier one of that name
first, and prints the invite link. Save its recipe to memory the way earlier
seeds are kept (reference_dev_seed_better_auth_switch_smoke.md, indexed in
reference_dev_seeds.md).

Then commit directly to main (this plan file included), replace this commit's
STATUS line in §6 with SHIPPED, the hash and the date, and hand over: what
shipped; anything you decided that the plan did not say; the proof's output;
and §7.1's smoke list with the invite link and, for every step that needs an
email, the address it must go to (Resend's sandbox delivers only to my
verified address until I verify a domain) — 5 to 12 steps, one action each,
the exact route, what I should see in plain words. The browser smoke is mine.
```

### Commit 3 — `test(auth): the seed and proof scripts make their logins through Better Auth`

**STATUS: SHIPPED `f6d6606e` 2026-10-09.**

- `scripts/auth-fixtures.ts`: `createThrowawayLogin({ email, password, role, name, coachId? })` through
  `createCoachLogin` / the invite path's writes (never a Supabase call), `deleteThrowawayLogin(email)` through
  the pool and the app's rows; every script in §4's row that minted a Supabase session or login moves onto it
  and `proof-session.ts` (`sign-in-proof.ts` already did in commit 2). As built, a client's login takes the
  client row the script made rather than a coach: `{ role: "coach", email, password, name }` or `{ role:
  "client", email, password, clientId, inviteToken? }`, the client row on that same address with no login yet.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` has no reader left: removed from CONVENTIONS' env list (line 881) and from
  `README.md:75`; grep proves it; the owner removes it from `.env.local`.
- Each moved script run once on DEV; no product code changes.
- What commit 2 left for this commit: `@supabase/ssr` leaves `package.json` here (D26's route), with the four scripts
  that still import it for their own Supabase sessions (`measurement-edit-proof.ts`, `clear-training-log-proof.ts`,
  `wire-proof-measurements.ts`, `check-in-as-of-proof.ts`). `scripts/proof-session.ts` is D34's already:
  `ProofSession` is `{ label, headers }` (`mintSession` gives `Authorization: Bearer`, `signInOverHttp` the session
  cookie) and `endSession` removes a minted row; the scripts that read `.cookie` now spread `session.headers`. The
  two data-API proofs' "login token" arm now sends a Better Auth session token, which PostgREST cannot read as a
  JWT: decide what that arm proves. `measurement-create-proof.ts`'s signed-out check expects the old 307; the proxy
  answers `/api/**` with 401 JSON. `better-auth-standup-proof.ts` was deleted with commit 2 (its proof belonged to
  the window between 208 and 209).

```text
Read CONVENTIONS.md (whole) and from docs/BETTER-AUTH-PLAN.md its head, §1–§5, §6's "How every commit runs" and this commit's entry, then
scripts/proof-session.ts, scripts/sign-in-proof.ts and services/login-service.ts
as commit 2 left them, scripts/env-bootstrap.ts, scripts/seed/teardown.ts, and
every script §4 names in the proof-scripts row. Open another section only when
something you touch points to it.

Job: Commit 3 of docs/BETTER-AUTH-PLAN.md §6 — `test(auth): the seed and proof
scripts make their logins through Better Auth`. Build exactly what that section
lists. No product code changes; if a script's check can only pass with a
product change, stop and say which.

You have my go: don't show me a plan and don't wait for my review. Stop and ask
me only if a gate fails and its root fix lies outside this commit.

Done when: grep finds no auth.admin, generateLink, verifyOtp, @supabase/ssr or
NEXT_PUBLIC_SUPABASE_ANON_KEY anywhere in the tree outside git history; every
moved script has run once end to end on DEV with its own checks passing (list
each with its last line of output); an independent review of the whole diff
has run and every finding is fixed; and every gate passes: npx tsc --noEmit,
npx eslint ., npx vitest run, npm run check:labels, npx knip, npm run
check:service-key. Never skip, weaken or delete a check to make a script pass.

Working method: the Edit tool; grep at execution time; every throwaway row a
script makes is deleted in finally, the real data (my coach, "Test intake form
bug", the fixture client) never changed; the scripts start their own next dev
on a free port; lsof -i :3000 first and never start or stop :3000; confirm
supabase/.temp/project-ref reads aeaphsslctwcmebldrzx (DEV) before any run.

Then commit directly to main (this plan file included), replace this commit's
STATUS line in §6 with SHIPPED, the hash and the date, and hand over what
shipped and each script's result. There is no browser smoke for this commit.
```

### Commit 4 — `feat(auth): the owner creates a coach: npm run coach:create and the "Set your password" email`

**STATUS: SHIPPED `de807bd1`, 2026-10-09.**

- `scripts/create-coach.ts` → `npm run coach:create -- --project <ref> --email … --name "…"` (§2.3): refuses to
  run unless `--project`, the linked ref and `DATABASE_URL` agree, calls `createCoachLogin`, prints the user id and
  "Set-your-password email sent to …".
- `scripts/auth-last-link.ts` → `npm run auth:last-link -- --email …` (rule 14; DEV's ref only; its parser pinned
  by a test on Better Auth's memory adapter).
- `app/set-password/page.tsx` (rule 9; the reset page's component with its own wording), public in the proxy;
  `emails/set-password-email.tsx`; `sendPasswordLinkEmail` picks by the landing page (D17).
- `scripts/create-coach-proof.ts` (§5, proof 4).
- What commit 2 left for this commit: `createCoachLogin` exists and is tested (its undo covers the coach row and the
  link request); `sendPasswordLinkEmail` never throws, because forgot password must answer every address alike, so
  `coach:create` cannot learn of a failed send from it (the command can say where `auth:last-link` finds the link).
  Better Auth's emails go out in the background (`advanced.backgroundTasks`, `runAfterAnswer`); in a script nothing
  keeps that work alive, so `coach:create` awaits `backgroundWorkSettled()` (`lib/auth.ts`) before it exits.

```text
Read CONVENTIONS.md (whole) and from docs/BETTER-AUTH-PLAN.md its head, §1–§5, §6's "How every commit runs" and this commit's entry, then lib/auth.ts,
services/login-service.ts, services/auth-email-service.ts, app/reset-password/
page.tsx, proxy.ts and proxy.test.ts, emails/reset-password-email.tsx and
scripts/create-coach-proof.ts's neighbours scripts/proof-session.ts and
scripts/auth-fixtures.ts. From docs/ARCHITECTURE.md read "Auth Model" as commit
2 rewrote it. Open another section only when something you touch points to it.

Job: Commit 4 of docs/BETTER-AUTH-PLAN.md §6 — `feat(auth): the owner creates a
coach: npm run coach:create and the "Set your password" email`. Build exactly
what that section lists, to §2.3, §2.5 and rules 9 and 14. Read the admin
plugin's docs and its installed source for createUser (§2.9 #2: no session is
needed server-side at 1.7.7; if that is false, stop and say so) and Better
Auth's source for the verification identifiers auth-last-link parses.

You have my go: don't show me a plan and don't wait for my review. Stop and ask
me only if a §3 decision this commit needs is blank, if building exactly what
this commit lists would break a CONVENTIONS.md rule that §4 does not mark for
rewriting, or if a gate fails and its root fix lies outside this commit.

Done when: everything that section lists is built; scripts/create-coach-proof.ts
passes on DEV (every check of §5's proof 4, the throwaway removed in finally);
an independent review of the whole diff has run and every finding is fixed at
the root; and every gate passes after the build and again after the review's
fixes: npx tsc --noEmit, npx eslint ., npx vitest run, npm run check:labels,
npx knip, npm run check:service-key, npm run build. Never skip, weaken or
delete a test to make a gate pass. Report the security, load and performance
review (CONVENTIONS §2).

Working method: the Edit tool; grep at execution time; a test and a mutation
for every new rule (the ref guard, the template picker, the parser), each test
green on the real code first, each mutation from a cp backup in the
scratchpad, never git stash or git checkout --; the proof starts its own next
dev on a free port, lsof -i :3000 first, never :3000.

Then commit directly to main (this plan file included), replace this commit's
STATUS line in §6 with SHIPPED, the hash and the date, and hand over: what
shipped; anything you decided that the plan did not say; the proof's output;
and §7.2's smoke list with the exact command for me to run and, if my
deliverable address already holds a login on DEV, the auth:last-link command
instead of the email step. The browser smoke is mine.
```

### Commit 5 — `feat(account): change password, change email and sign out everywhere, on the coach's and the client's Settings`

**STATUS: SHIPPED `444403f8` 2026-10-09.**

- `components/coach/account-card.tsx` on the coach's Settings in place of the mock Profile card: name, email,
  Change password, Change email, Sign out everywhere (Delete account arrives in commit 6); the dialogs (§2.4,
  rules 5, 6, 7). `components/client-portal/account-card.tsx` on the client's Settings: Change password (rule 13's
  first half).
- `user.changeEmail` and `emailVerification` in `lib/auth.ts`; `emails/approve-email-change-email.tsx`,
  `emails/confirm-new-email-email.tsx`; `mirrorEmailToCoachRow` (D18).
- `scripts/account-proof.ts` (§5, proof 5).
- Found by commit 4 in Better Auth 1.7.7's installed source (`changeEmail`, `api/routes/update-user.mjs`;
  `createEmailVerificationToken`, `api/routes/email-verification.mjs`) and pinned by `scripts/auth-last-link.test.ts`:
  change email's two links carry a JWT signed with `BETTER_AUTH_SECRET`, and nothing is written to
  `better_auth.verification`. So proof 5 cannot read "the approval token" or "the confirmation token" from the table
  as §5 says, and `auth:last-link` prints neither: the proof takes each link from the email Better Auth hands
  `sendChangeEmailConfirmation` and `sendVerificationEmail`, and §7.3's two addresses must both receive real email.
- Found after commit 4 (2026-10-09): every way out of a session loads the login page fresh, never an in-app push.
  Next 16 keeps a proxy redirect for an address for up to five minutes, and an in-app trip to `/login` then landed
  back on the dashboard; the old page also kept the previous account's data for the next sign-in. `logout()`
  (`contexts/auth-context.tsx`) does it through `loadFreshPage` (`lib/load-fresh-page.ts`), and Sign out everywhere
  must do the same after `revokeSessions`.

```text
Read CONVENTIONS.md (whole) and from docs/BETTER-AUTH-PLAN.md its head, §1–§5, §6's "How every commit runs" and this commit's entry, then lib/auth.ts,
lib/auth-client.ts, services/auth-email-service.ts, app/(coach)/settings/
page.tsx, components/coach/settings-units-card.tsx, app/client/settings/
page.tsx, components/client-portal/nav/client-nav.tsx, and one existing dialog
in CONVENTIONS' dialog pattern (grep useDialogSubject). From
docs/newdesignsystem.md read the Card, Dialog, Button and form sections. From
docs/ARCHITECTURE.md read "Auth Model" as it stands. Open another section only
when something you touch points to it.

Job: Commit 5 of docs/BETTER-AUTH-PLAN.md §6 — `feat(account): change password,
change email and sign out everywhere, on the coach's and the client's
Settings`. Build exactly what that section lists, to §2.4, §2.5, D14, D18, D19
and rules 5, 6, 7 and 13 (its Change password). The frames are §1.2's F7, F8
and F9: one source each, no frame the settled screen doesn't show. Read Better
Auth's docs and installed source for changePassword, changeEmail and
revokeSessions (§2.9 #6–#8); if a fact there is false at 1.7.7, stop and say
which.

You have my go: don't show me a plan and don't wait for my review. Stop and ask
me only if a §3 decision this commit needs is blank, if building exactly what
this commit lists would break a CONVENTIONS.md rule that §4 does not mark for
rewriting, or if a gate fails and its root fix lies outside this commit.

Done when: everything that section lists is built; scripts/account-proof.ts
passes on DEV (every check of §5's proof 5); an independent review of the
whole diff has run and every finding is fixed at the root; and every gate
passes after the build and again after the review's fixes: npx tsc --noEmit,
npx eslint ., npx vitest run, npm run check:labels, npx knip, npm run
check:service-key, npm run build. Never skip, weaken or delete a test to make
a gate pass. Report the security, load and performance review (CONVENTIONS
§2).

Working method: the Edit tool; grep at execution time; a test and a mutation
for every new rule (each dialog's states and call, the email mirror, the two
templates), each test green on the real code first, each mutation from a cp
backup in the scratchpad, never git stash or git checkout --; the proof
starts its own next dev on a free port, lsof -i :3000 first, never :3000.

Then commit directly to main (this plan file included), replace this commit's
STATUS line in §6 with SHIPPED, the hash and the date, and hand over: what
shipped; anything you decided that the plan did not say; the proof's output;
and §7.3's smoke list, naming for each email where it will arrive. The browser
smoke is mine.
```

### Commit 5.1 — `feat(brand): every screen, email and tab title says Atletafit`

**STATUS: SHIPPED `8d4d8d00` 2026-10-09.**

Asked for by the owner on 2026-10-09 ("It's not called coachub"), after commit 5 (D30; rule 9's subject; §2.11).
- `PRODUCT_NAME = "Atletafit"` in `lib/constants.ts`, read by every place §2.11 lists: the six email templates,
  their text bodies and subjects, `EMAIL_SENDER`'s fallback, the login and invite pages and the invite's toast, the
  client portal's header, the marketing navbar and footer, the tab's title, the rails' monogram alt text and the
  metadata fetcher's User-Agent. Nothing else about any of them changes.
- The scan test of §2.11's guard, and the wording tests that read the old name (`services/auth-email-service.test.ts`,
  `components/client-portal/nav/client-nav.test.tsx`, and any grep finds) to the new one, never loosened.
- Docs: the product's name in `CONVENTIONS.md`, `docs/ARCHITECTURE.md`, `docs/newdesignsystem.md` and `README.md`,
  and this plan's lines that describe shipped wording (§2.5, D30, rule 9 and §9.1 already do).
- No proof script: nothing but words changes; the tests, the build and §7.3a are the evidence.

```text
Read CONVENTIONS.md (whole) and from docs/BETTER-AUTH-PLAN.md its head,
§1–§5, §6's "How every commit runs" and this commit's entry. Then grep the
tree for CoachHub (any case) and read every file it finds, and lib/constants.ts
where PRODUCT_NAME goes. Open another file only when something you touch
points to it.

Job: Commit 5.1 of docs/BETTER-AUTH-PLAN.md §6 — `feat(brand): every screen,
email and tab title says Atletafit`. Build exactly what that section lists, to
§2.11 and D30. Only words change: no route, no data, no behaviour, no layout.

You have my go: don't show me a plan and don't wait for my review. Stop and ask
me only if a place that says CoachHub isn't one §2.11 names and you can't tell
whether a person reads it, or if a gate fails and its root fix lies outside
this commit.

Done when: grep finds no CoachHub (any case) in app/, components/, emails/,
services/, lib/, contexts/, hooks/, scripts/, CONVENTIONS.md, README.md or
docs/ outside this plan (which tells the rename); "Atletafit" is spelled out in code only in
lib/constants.ts; an independent review of the whole diff has run and every
finding is fixed at the root; and every gate passes after the review's fixes:
npx tsc --noEmit, npx eslint ., npx vitest run, npm run check:labels, npx knip,
npm run check:service-key, npm run build. Never skip, weaken or delete a test
to make a gate pass.

Working method: the Edit tool; grep at execution time; a test and a mutation
for the scan (the old name brought back in one file, a second spelling of the
new one), each test green on the real code first, each mutation from a cp
backup in the scratchpad, never git stash or git checkout --.

Then commit directly to main (this plan file included), replace this commit's
STATUS line in §6 with SHIPPED, the hash and the date, and hand over what
shipped and §7.3a's smoke list. The browser smoke is mine.
```

### Commit 5.5 — `feat(account): clients change their email too, every copy of an address follows it in one write (migration 210), and the owner's auth:move-email`

**STATUS: NOT STARTED.**

Asked for by the owner on 2026-10-09, after commit 5 shipped coaches only (D18, D37, D38, D39; rules 13, 17, 18, 19).
- Migration 210 (§2.1, D37) on DEV: the trigger that copies a login's address to its coach and client rows in the
  same statement, its function postgres's alone, the schema's COMMENT naming it, a closing check in 201's shape.
  `types/database.ts` regenerated and read (expected: no change, the function lives in `better_auth`);
  `npm run check:rls` holds clause 6.
- `lib/auth.ts`: `mirrorLoginEmail` and the `user.update.after` hook deleted, with `services/account-service.ts`'s
  `mirrorEmailToCoachRow` and `isCoachLogin` and their tests. `refuseEmailChangeUnlessCoach` becomes the new
  address's check (§2.10), still through `readSessionUserId` and on `/change-email` alone; `lib/auth.test.ts`'s guard
  tests are rewritten to it and keep their cookie, bearer and cookie-plus-bearer cases.
- `services/login-service.ts`: the invite's link writes `clients.email` with `user_id` (§2.10, "From birth").
- The client's Settings (rule 13): Change email on `components/client-portal/account-card.tsx`; the dialog and
  `ChangeEmailLinkNotice` move to `components/auth/` with a landing prop; `CLIENT_SETTINGS_PAGE` in
  `lib/constants.ts`; `app/client/settings/page.tsx` hosts the notice behind its own Suspense boundary.
- The coach's lock (D38, rule 18): the details sheet's read-only Email field with its sentence, for a client whose
  record carries `userId`; `PATCH /api/clients/[id]` refuses a different address for a client with a login (409
  "This client changes their own email."), checked against the client the route already loads for its ownership
  check, and lets the same address through.
- The owner's command (D39, rule 19): `scripts/move-email.ts`, `npm run auth:move-email`, `moveLoginEmail` in
  `services/account-service.ts` (§2.10), with `create-coach.ts`'s refusals before anything that reaches a database
  loads.
- `scripts/email-follows-proof.ts` (§5, proof 5.5); `scripts/account-proof.ts`'s step 3, the client refused, becomes
  the new address's check by cookie, by bearer token and by both: an address a client row holds → 200, no email.
- Docs: ARCHITECTURE's "Account changes" to the shape this commit leaves (both roles, the trigger as the one writer
  of the copies after birth, the lock, the command), current shape only.
- The smoke seed (§7.3b): a pending client "Smoke · change email" under the owner's coach, its invite link in the
  handover.

```text
Read CONVENTIONS.md (whole) and from docs/BETTER-AUTH-PLAN.md its head, §1–§5,
§6's "How every commit runs" and this commit's entry, then lib/auth.ts,
services/account-service.ts, services/login-service.ts (acceptClientInvitation),
services/client-service.ts (updateClient), app/api/clients/[id]/route.ts,
components/clients/details/details-groups.tsx and components/clients/overview/
use-client-profile-edit.ts, components/coach/change-email-dialog.tsx and
change-email-link-notice.tsx, components/client-portal/account-card.tsx,
app/client/settings/page.tsx, scripts/create-coach.ts with scripts/project-
ref.ts, scripts/account-proof.ts with scripts/proof-mailbox.ts, and supabase/
migrations/201_lock_the_database.sql (a closing check) with 209 (a migration on
better_auth). From docs/ARCHITECTURE.md read "Auth Model" as it stands. Open
another section only when something you touch points to it.

Job: Commit 5.5 of docs/BETTER-AUTH-PLAN.md §6 — `feat(account): clients
change their email too, every copy of an address follows it in one write
(migration 210), and the owner's auth:move-email`. Build exactly what that
section lists, to §2.1 (migration 210), §2.10, D18, D37, D38, D39 and rules 13,
17, 18 and 19. Read Better Auth's installed source for the write that changes
an address (verify-email's updateUserByEmail: one UPDATE statement), the
internal adapter's updateUser and deleteUserSessions, and auth.$context; if
§2.9 #14 or a fact there is false at 1.7.7, stop and say which.

You have my go: don't show me a plan and don't wait for my review. Stop and ask
me only if a §3 decision this commit needs is blank, if building exactly what
this commit lists would break a CONVENTIONS.md rule that §4 does not mark for
rewriting, or if a gate fails and its root fix lies outside this commit.

Done when: everything that section lists is built; migration 210 is on DEV
with its closing check passing, types/database.ts read after gen types, and
npm run check:rls passing; scripts/email-follows-proof.ts passes on DEV (every
check of §5's proof 5.5) and scripts/account-proof.ts passes as rewritten; an
independent review of the whole diff has run and every finding is fixed at the
root; a second independent review of those fixes has run and its findings are
fixed; and every gate passes after the second review's fixes: npx tsc --noEmit,
npx eslint ., npx vitest run, npm run check:labels, npx knip, npm run
check:service-key, npm run check:rls, npm run build. Never skip, weaken or
delete a test to make a gate pass. Report the security, load and performance
review (CONVENTIONS §2), naming every path that changes an address and every
row the trigger writes.

Working method: the Edit tool; grep at execution time; a test and a mutation
for every new rule (the trigger's two copies and its grants, the new address's
check, the lock and its same-address pass, the invite's email write, the
command's refusals and writes), each test green on the real code first, each
mutation from a cp backup in the scratchpad, never git stash or git checkout
--; the proofs start their own next dev on a free port, lsof -i :3000 first,
never :3000. Before the push, confirm supabase/.temp/project-ref reads
aeaphsslctwcmebldrzx (DEV); supabase db push --dry-run immediately before the
push (from the Bash tool the push confirms itself; if it is classifier-blocked,
hand it to me with !), then gen types and read the diff.

The seed: a throwaway script in the session scratchpad (npx tsx --tsconfig
./tsconfig.json, @/scripts/env-bootstrap) that makes a pending client "Smoke ·
change email" under my coach (samuel.k@taboola.com) through the app's own
invitation service with the address s.kalepa91+change-email-smoke@gmail.com,
deleting any earlier one of that name first, and prints the invite link. Save
its recipe to memory (reference_dev_seed_change_email_smoke.md, indexed in
reference_dev_seeds.md).

Then commit directly to main (this plan file included), replace this commit's
STATUS line in §6 with SHIPPED, the hash and the date, and hand over: what
shipped; anything you decided that the plan did not say; the proofs' output;
and §7.3b's smoke list with the invite link and, for each email, where it
arrives (EMAIL_FROM must be on the verified domain first). The browser smoke is
mine; offer to run its terminal step.
```

### Commit 6 — `feat(account): delete account, the coach's and the client's; migration 211`

**STATUS: NOT STARTED.**

- Migration 211 (§2.1) on DEV. `services/account-service.ts` (§2.6: `deleteAccountRecords` as `beforeDelete`,
  the key collection, `services/storage-service.ts` gains `removeObjects(bucket, keys)`); `user.deleteUser` in
  `lib/auth.ts`; `emails/confirm-delete-account-email.tsx` (two wordings, one template with a role prop).
- The Delete account button and dialog on both Account cards (rules 10 and 13); `?deleted=1` on the login notice.
  The dialog's `callbackURL` is `ACCOUNT_DELETED_PAGE` (`lib/constants.ts`, from commit 4): Better Auth's row records no
  landing, so `auth:last-link` prints a delete-account link with that constant, and the two must stay one.
- `scripts/delete-account-proof.ts` (§5, proof 6).
- The smoke seed (§7.4): a throwaway coach "Smoke · delete coach" with two clients and the records the steps name.
- Found by commits 5 and 5.5: `services/account-service.ts` exists (5.5's `moveLoginEmail` and the new address's
  check; 5's `isCoachLogin` is gone, so `beforeDelete` reads the role itself), and `deleteAccountRecords` joins it.
  Migration 211 also rewrites the `better_auth` schema's COMMENT to name its two functions beside 210's trigger.
  Both Account cards host their dialogs with `useDialogSubject` over a dialog kind (`CoachAccountCard`'s
  `AccountDialog`, `ClientAccountCard`'s): the Delete account dialog joins those, keyed by `openKey`. `lib/auth.ts` sends
  every Better Auth email through `sendWithEmailService`, and its one before hook is `refuseBeforeEndpoint`. A hook that
  must know who is asking reads `readSessionUserId(ctx.headers)`, never the request's own cookie: every before hook is
  handed the request as it came, before the bearer plugin turns a bearer token into the session cookie (commit 5's
  review found a client changing email by bearer token that way).

```text
Read CONVENTIONS.md (whole) and from docs/BETTER-AUTH-PLAN.md its head, §1–§5, §6's "How every commit runs" and this commit's entry, then lib/auth.ts,
services/login-service.ts, services/storage-service.ts, services/client-
service.ts (deleteClient, reactivateClient), services/content-item-service.ts,
components/coach/account-card.tsx, components/client-portal/account-card.tsx,
components/auth/login-notice.tsx, supabase/migrations/106_*.sql (a function's
privileges) and scripts/account-proof.ts. From docs/ARCHITECTURE.md read "Auth
Model" and the storage paragraphs grep finds for progress-photos and content-
library. Open another section only when something you touch points to it.

Job: Commit 6 of docs/BETTER-AUTH-PLAN.md §6 — `feat(account): delete account,
the coach's and the client's; migration 211`. Build exactly what that section
lists, to §2.1 (migration 211), §2.6, D2, D20, D21 and rules 10 and 13. Before
the first edit, list every table the two functions reach by grepping the
migrations for every FK to clients and to coaches and compare with §2.6; a
table §2.6 misses is added to the plan's list in this commit. Read Better
Auth's docs and installed source for deleteUser and beforeDelete (§2.9 #7); if
a fact there is false at 1.7.7, stop and say which.

You have my go: don't show me a plan and don't wait for my review. Stop and ask
me only if a §3 decision this commit needs is blank, if building exactly what
this commit lists would break a CONVENTIONS.md rule that §4 does not mark for
rewriting, or if a gate fails and its root fix lies outside this commit.

Done when: everything that section lists is built; migration 211 is on DEV and
types/database.ts shows exactly its functions; scripts/delete-account-proof.ts
passes on DEV (every check of §5's proof 6, every throwaway removed in finally
even when a check fails); an independent review of the whole diff has run and
every finding is fixed at the root; a second independent review of those fixes
has run and its findings are fixed; and every gate passes after the build and
again after the second review's fixes: npx tsc --noEmit, npx eslint ., npx vitest run,
npm run check:labels, npx knip, npm run check:service-key, npm run check:rls,
npm run build. Never skip, weaken or delete a test to make a gate pass. Report
the security, load and performance review (CONVENTIONS §2), naming every row
the two functions reach.

Working method: the Edit tool; grep at execution time; a test and a mutation
for every new rule, each test green on the real code first, each mutation from
a cp backup in the scratchpad, never git stash or git checkout --; the proof
starts its own next dev on a free port, lsof -i :3000 first, never :3000.
Before the push, confirm supabase/.temp/project-ref reads aeaphsslctwcmebldrzx
(DEV); supabase db push --dry-run immediately before the push; then gen types
and read the diff.

The seed: a throwaway script in the session scratchpad (npx tsx --tsconfig
./tsconfig.json, @/scripts/env-bootstrap), through the app's own services and
scripts/auth-fixtures.ts, that makes exactly what §7.4's steps need, deleting
any earlier "Smoke · delete …" accounts by name first, and prints the two
passwords it set. Save its recipe to memory (reference_dev_seed_delete_account_
smoke.md, indexed in reference_dev_seeds.md).

Then commit directly to main (this plan file included), replace this commit's
STATUS line in §6 with SHIPPED, the hash and the date, and hand over: what
shipped; anything you decided that the plan did not say; the proof's output;
and §7.4's smoke list with the seeded logins and, for each email, where it
arrives or the auth:last-link command. The browser smoke is mine.
```

### Commit 7 — `feat(auth): Continue with Google, for sign-in only`

**STATUS: NOT STARTED.**

- `socialProviders.google` and `account.accountLinking` in `lib/auth.ts` (§2.7); the button back on
  `app/login/page.tsx` wired to `signIn.social`; the two notices on `components/auth/login-notice.tsx` (rule 8).
- No proof script can drive Google; the tests cover the config, the button's call and the notices, and §7.5 is
  the evidence.
- Found by commit 5: Better Auth's change password needs the login's password row (`findCredentialAccount`); a coach
  who never used the "Set your password" link and signs in with Google has none, and Change password answers
  `CREDENTIAL_ACCOUNT_NOT_FOUND`, which the dialog words as "Something went wrong. Try again." A change of a login's
  address, whatever makes it, runs migration 210's trigger (5.5); Google's linking changes no address.

```text
Read CONVENTIONS.md (whole) and from docs/BETTER-AUTH-PLAN.md its head, §1–§5, §6's "How every commit runs" and this commit's entry, then lib/auth.ts,
lib/auth-client.ts, app/login/page.tsx, components/auth/login-notice.tsx,
lib/constants.ts and proxy.ts. From docs/ARCHITECTURE.md read "Auth Model".
Open another section only when something you touch points to it.

Job: Commit 7 of docs/BETTER-AUTH-PLAN.md §6 — `feat(auth): Continue with
Google, for sign-in only`. Build exactly what that section lists, to §2.7, D3,
D23 and rule 8. Before anything: .env.local must hold GOOGLE_CLIENT_ID and
GOOGLE_CLIENT_SECRET for a Google OAuth client whose redirect URI is
http://localhost:3000/api/auth/callback/google; if either is missing, stop and
ask me. Read Better Auth's Google and account-linking docs and installed source
(§2.9 #10); if a fact there is false at 1.7.7, stop and say which.

You have my go: don't show me a plan and don't wait for my review. Stop and ask
me only if a §3 decision this commit needs is blank, if building exactly what
this commit lists would break a CONVENTIONS.md rule that §4 does not mark for
rewriting, or if a gate fails and its root fix lies outside this commit.

Done when: everything that section lists is built; GET /api/auth/sign-in/
social with provider google (driven by a script against your own next dev)
answers a redirect to accounts.google.com carrying the right redirect_uri, and
/login?error=signup_disabled and ?error=account_not_linked show rule 8's
sentence; an independent review of the whole diff has run and every finding is
fixed at the root; and every gate passes after the build and again after the
review's fixes: npx tsc --noEmit, npx eslint ., npx vitest run, npm run
check:labels, npx knip, npm run check:service-key, npm run build. Never skip,
weaken or delete a test to make a gate pass. Report the security, load and
performance review (CONVENTIONS §2).

Working method: the Edit tool; grep at execution time; a test and a mutation
for every new rule, each test green on the real code first, each mutation from
a cp backup in the scratchpad, never git stash or git checkout --; lsof -i
:3000 first, never :3000.

Then commit directly to main (this plan file included), replace this commit's
STATUS line in §6 with SHIPPED, the hash and the date, and hand over: what
shipped; anything you decided that the plan did not say; and §7.5's smoke
list, naming which of my logins has a Google address. The browser smoke is
mine.
```

### Commit 8 — `feat(auth): the server is ready for the client app: bearer tokens on every client route, the Expo plugin, the app's scheme`

**STATUS: NOT STARTED.**

- `@better-auth/expo@1.7.7`; `expo()` in `plugins` and `atletafit://`, `atletafit://*` in `trustedOrigins` (D25,
  §2.8); `lib/csrf-protection.ts` passes bearer requests (§2.2) with its test.
- `scripts/bearer-proof.ts` (§2.8's proof). `CLIENT-APP-REFERENCE.md:164`'s sentence rewritten here (it is the
  app's contract): sign-in is `POST /api/auth/sign-in/email`, the token is `set-auth-token`, every `/api/client/**`
  call carries `Authorization: Bearer`, a dead token is 401 JSON.
- What commit 2 left for this commit: the proxy and the seam read a session without renewing it
  (`readSessionUserId`, `disableRefresh`), so a session is renewed only by `GET /api/auth/get-session`. The app
  must call it (the Expo client's `useSession()` does) or its session ends seven days after sign-in; the proof
  shows a bearer session past `updateAge` renewed there.
- Found by commit 5: a Better Auth before hook sees the request before the bearer plugin's hook turns its token into
  the session cookie, so a guard reading the request's own cookie misses a bearer request, or names the cookie's login
  when a bearer token rides beside it. Change email's check of the new address (commit 5's guard as 5.5 rewrites
  it) reads who is asking through `readSessionUserId`, and `scripts/account-proof.ts` step 3 drives it by bearer
  token; this commit's review of what a bearer request may do covers every before-hook guard the same way.

```text
Read CONVENTIONS.md (whole) and from docs/BETTER-AUTH-PLAN.md its head, §1–§5, §6's "How every commit runs" and this commit's entry, then lib/auth.ts,
lib/csrf-protection.ts and its test, lib/auth-helpers.ts, proxy.ts,
CLIENT-APP-REFERENCE.md (the auth lines around 36, 153–164) and
scripts/proof-session.ts. Open another section only when something you touch
points to it.

Job: Commit 8 of docs/BETTER-AUTH-PLAN.md §6 — `feat(auth): the server is ready
for the client app: bearer tokens on every client route, the Expo plugin, the
app's scheme`. Build exactly what that section lists, to §2.8 and D25. Nothing
of the app is built. Read Better Auth's bearer and Expo docs and the installed
source of both plugins (§2.9 #4); if a fact there is false at 1.7.7, stop and
say which.

You have my go: don't show me a plan and don't wait for my review. Stop and ask
me only if a §3 decision this commit needs is blank, if building exactly what
this commit lists would break a CONVENTIONS.md rule that §4 does not mark for
rewriting, or if a gate fails and its root fix lies outside this commit.

Done when: everything that section lists is built; scripts/bearer-proof.ts
passes on DEV (every check of §2.8's last bullet); an independent review of
the whole diff has run and every finding is fixed at the root; a second
independent review of those fixes has run and its findings are fixed; and every
gate passes after the build and again after the second review's fixes: npx tsc --noEmit,
npx eslint ., npx vitest run, npm run check:labels, npx knip, npm run
check:service-key, npm run build. Never skip, weaken or delete a test to make
a gate pass. Report the security, load and performance review (CONVENTIONS
§2), covering what a bearer request may and may not do that a cookie request
can't.

Working method: the Edit tool; grep at execution time; a test and a mutation
for every new rule (the CSRF pass, the trusted scheme), each test green on the
real code first, each mutation from a cp backup in the scratchpad, never git
stash or git checkout --; the proof starts its own next dev on a free port,
lsof -i :3000 first, never :3000.

Then commit directly to main (this plan file included), replace this commit's
STATUS line in §6 with SHIPPED, the hash and the date, and hand over what
shipped and the proof's output. There is no browser smoke for this commit.
```

### Commit 9 — `docs(auth): ARCHITECTURE, CONVENTIONS, TECHNICAL-DEBT and CLIENT-APP-REFERENCE describe the logins as they are; the PROD runbook`

**STATUS: NOT STARTED.**

- `docs/ARCHITECTURE.md`: "Auth Model" complete for the account features, Google, the bearer path, the delete
  paths; the Settings pages' Account cards under their pages; the emails list; the "Client Onboarding Flow" line
  for the invite; current shape only. Commits 5 and 5.5 wrote "Account changes" (change password, change email for
  both roles and the address's copies, the coach's lock, the owner's `auth:move-email`, sign out everywhere): it is
  completed, not restarted.
- `CONVENTIONS.md`: the rules §4 marks for rewriting that commit 2 didn't take (§9's tiers, §6's map, §19's env
  list, the soft-delete exception, the packages line, the "additive over breaking" line).
- `TECHNICAL-DEBT.md`: the entries §4 closes, each deleted or marked with the hash, and with them the open P2 rows
  commit 2's deletions and rewrites closed, which §4 does not name (:302 the server-client factories, :310 `error: any`
  in the auth pages, :311 their missing zod, :312 the browser client's cookie parsing, :314 the callback's metadata
  check); :313 stays open without `app/signup/page.tsx`; new entries for what this plan leaves (no per-account lockout; two pools; `removeUser` needs an admin
  session so compensation deletes through the pool; the Supabase retirement steps still owed until the owner does
  them, §9.1).
- `CLIENT-APP-REFERENCE.md` :36 and :153-157, and :148-149 ("Middleware Protection", `middleware.ts`, now `proxy.ts`).
- §8.2's runbook stays in this file until PROD has switched (it is deleted with the file).

```text
Read CONVENTIONS.md (whole) and from docs/BETTER-AUTH-PLAN.md its head, §1–§5, §6's "How every commit runs" and this commit's entry, then the code
commits 1–8 built (lib/auth.ts, lib/auth-client.ts, proxy.ts, services/login-
service.ts, services/account-service.ts, services/auth-email-service.ts,
app/api/auth/, app/set-password/, components/coach/account-card.tsx,
components/client-portal/account-card.tsx, scripts/create-coach.ts,
scripts/auth-last-link.ts). From docs/ARCHITECTURE.md read "Auth Model" as it
stands, "Client Onboarding Flow", "API Route Structure" and the Settings
paragraphs grep finds. Read TECHNICAL-DEBT.md's entries §4 names and
CLIENT-APP-REFERENCE.md whole. Open another section only when something you
touch points to it.

Job: Commit 9 of docs/BETTER-AUTH-PLAN.md §6 — `docs(auth): ARCHITECTURE,
CONVENTIONS, TECHNICAL-DEBT and CLIENT-APP-REFERENCE describe the logins as
they are; the PROD runbook`. Build exactly what that section lists. Docs
describe the shape the code has now, current shape only: no history, no "used
to", no sentence about Supabase Auth except the retirement steps still owed;
where a doc line disagrees with the code, the code wins and the line is fixed.

You have my go: don't show me a plan and don't wait for my review. Stop and ask
me only if the code disagrees with this plan in a way a coach or client would
see.

Done when: everything that section lists is built; the doc edits run no gates;
grep over docs/, CONVENTIONS.md, TECHNICAL-DEBT.md, CLIENT-APP-REFERENCE.md and
README.md finds no getUser(), auth.users, handle_new_user, @supabase/ssr,
createBrowserClient, anon key or Supabase Auth sentence that describes the
present; an independent review of the whole diff has run and every finding is
fixed.

Then commit directly to main (this plan file included), replace this commit's
STATUS line in §6 with SHIPPED, the hash and the date, and hand over what
shipped and the list of TECHNICAL-DEBT entries closed and opened. There is no
browser smoke; the PROD switch (§8.2) is mine to schedule.
```

---

## 7. The smokes

Every list below is handed over by its commit's session with the blanks filled (addresses, links, seeded
passwords, exact wording as built). Until the owner verifies a Resend domain (§9.1), every email the app sends
reaches the Resend account's one verified address only; where a step needs an email at another address, the
session replaces "open the email" with `npm run auth:last-link -- --email <address>` and "open the link it
prints". A step that says "private window" means a browser window with no session.

### 7.1 The switch (after commit 2)

The seed: a pending client "Smoke · invite me" under the owner's coach, its invite link in the handover.

1. Open `/login` and sign in with your coach email and password. You land on `/dashboard`. (If you were signed in
   before the switch, you had been signed out: this is the one re-sign-in.)
2. Open `/signup`. You see "This page could not be found."
3. In a private window open `/dashboard`. You are sent to `/login`.
4. In the private window, sign in with your coach email and a wrong password. "Wrong email or password." shows
   under the form.
5. In the private window click "Forgot your password?", enter <the address the session names>, click Send. The
   card says "If that address has an account, we've emailed a link." Open the email "Reset your password" and
   click its link. On `/reset-password` type a new password twice and save. "Password updated", then `/login`.
   Sign in with the new password: `/dashboard`. This is that login's password from now on.
6. Back in the first window (signed in since step 1), reload `/dashboard`. You are sent to `/login`: resetting a
   password signs out every other device.
7. Open <the invite link>. The page names you as the coach and shows `s•••e@gmail.com`. Type a password twice and
   click Create account. You land on the intake form (`/client/onboarding`).
8. Open the same invite link in a private window. The page shows the "already used" card (the session quotes it).
9. In the private window sign in as "Test intake form bug" (s.kalepa91+intake@gmail.com). You land on `/client`.
   Open the avatar menu and click Sign out. You are on `/login`.
10. Open `/client` in that window. You are sent to `/login`.

### 7.2 The owner creates a coach (after commit 4)

1. In the repo's terminal run `npm run coach:create -- --project aeaphsslctwcmebldrzx --email <a deliverable
   address with no login> --name "Smoke coach"`. It prints "Created <address>; the set-your-password email is
   sent."
2. Open the email "Set your password for CoachHub" (or the `auth:last-link` command the session gives) and click
   its link. On `/set-password` type a password twice and save. "Password set", then `/login`.
3. Sign in as Smoke coach. `/dashboard` with an empty roster and "Smoke coach" at the sidebar's foot.
4. Run the command from step 1 again with the same address. It says the address already has a login and writes
   nothing.

### 7.3 The Account card (after commit 5)

As Smoke coach from §7.2 (the session names the login if that one is gone):
1. Open `/settings`. The Account card shows the name and the email, with Change password, Change email and Sign
   out everywhere. The Units and Business Information cards are as before.
2. Click Change password, type a wrong current password and a new one twice, save. "Wrong password." Type the
   right current password, save. "Password changed."
3. In a private window sign in as Smoke coach with the new password: `/dashboard`. Back in the first window click
   Sign out everywhere and confirm. You are on `/login`. In the private window reload `/dashboard`: `/login`.
4. Sign in again. Click Change email, type <the second deliverable address>, save. "We've emailed <current
   address> to approve the change." The card still shows the current address.
5. Open the email "Approve your email change" at the current address and click its link. Open the email "Confirm
   your new email" at the new address and click its link. `/settings` shows the new address.
6. Log out. Sign in with the new address and the password from step 2: `/dashboard`.
7. Sign in as "Test intake form bug" at `/login`, open `/client/settings`. The Account card sits between Profile
   and Units with Change password. Change it to a new password, log out, sign in with the new one: `/client`.
   Change it back to the old one.

### 7.3a The product's name (after commit 5.1)

`EMAIL_FROM` set to `"Atletafit <hello@atletafit.com>"` first.
1. Open `/login`. The page and the browser tab say Atletafit; nothing says CoachHub.
2. Click "Forgot your password?", enter your coach address and send. The "Reset your password" email arrives from
   Atletafit and is signed "The Atletafit Team".
3. Sign in as "Test intake form bug". The client portal's header says Atletafit.

### 7.3b A client's email, everywhere (after commit 5.5)

The seed: a pending client "Smoke · change email" under the owner's coach, on a deliverable address, its invite
link in the handover. `EMAIL_FROM` on the verified domain first (every step's email goes to a `+` address).
1. Open the invite link, type a password twice and create the account. You land on the intake form.
2. Open `/client/settings`. The Account card has Change password and Change email.
3. Click Change email, type <the second address>, save. "We've emailed <the first address> to approve the change."
   The Profile card still shows the first address.
4. Open "Approve your email change" and click its button: `/client/settings`, still the first address. Open
   "Confirm your new email" and click its button: `/client/settings` shows the second address.
5. In another browser, as your coach, open Smoke · change email's profile: the second address. Open its details
   sheet: the email can't be edited, and says "The client changes this from their Settings."
6. Back as the client, log out and sign in with the second address and your password: you're in.
7. Run `npm run auth:move-email -- --project aeaphsslctwcmebldrzx --email <the second address> --to <a third
   address>` (or let the session run it). It says the login moved. The client's open page goes to `/login` on its
   next request. Open "Reset your password" at the third address, set a password, and sign in with it.
8. As your coach, reload the client's profile: the third address.

### 7.4 Delete account (after commit 6)

The seed: a coach "Smoke · delete coach" with two clients, "Smoke · delete client A" (a sent check-in with a
photo) and "Smoke · delete client B" (a content item assigned), all three with logins and the passwords the
session prints.

1. Sign in as Smoke · delete client A, open `/client/settings`, click Delete account. The dialog says what goes;
   type the password, click Delete. "Check your email to confirm."
2. Open the email "Confirm deleting your account" (or the `auth:last-link` command) and click its link. You are on
   `/login` with "Your account has been deleted." Sign in as client A: "Wrong email or password."
3. Sign in as Smoke · delete coach. On `/clients` client A is gone and client B is listed; B's content item is
   still in the library.
4. Open `/settings`, click Delete account. The dialog says the clients, their records and logins go too; type the
   password, click Delete. "Check your email to confirm." Open the email, click its link. `/login` with "Your
   account has been deleted."
5. Sign in as the coach: "Wrong email or password." Sign in as client B: the same.
6. Sign in as your own coach. Your roster is as it was.

### 7.5 Continue with Google (after commit 7)

1. Signed out, on `/login` click Continue with Google and pick <the Google account whose address is your coach
   login>. You land on `/dashboard`.
2. Log out. Click Continue with Google and pick a Google account that has no login here. You are on `/login` with
   "There's no account for that Google email."
3. If one of your client logins is a Google account you can open, repeat step 1 with it: you land on `/client`.

---

## 8. The switch-over: DEV first, then PROD; sessions; undo

### 8.1 DEV, commit by commit

- **Commit 1** pushes 208 with Supabase Auth still in charge. Nothing anyone sees changes; Better Auth answers
  under `/api/auth` and holds a copy of every login and hash.
- **Commit 2 is the switch.** Its session pushes 209, then starts the new code. From that moment every Supabase
  cookie is ignored: the owner (and any other signed-in person on DEV) signs in again with the password they have
  (D8). Pending invite links keep working. A Supabase reset email sent before the switch is dead: ask for a new one.
  Nothing is deleted from `auth.users`.
- **Commits 3–9** are additive on DEV.

### 8.2 PROD

PROD is `etezzztgafcotyahgijk`. It took 185–209 on 2026-10-08 with no app deployed against it, holding no logins
(208 copied none) and no coaching data: it serves the marketing site's waitlist alone. It owes 210 and 211; the app's PROD
deployment and its env will live wherever the owner runs it (no file in the repo describes it). The session that
runs this counts PROD's `auth.users` first: with no app on PROD none should appear, and a login found there is
copied by rerunning 209's section 1 (idempotent) before the deploy.

1. **Before, the owner (§9.1 "before PROD"):** PROD's `DATABASE_URL`, a new `BETTER_AUTH_SECRET`,
   `BETTER_AUTH_URL` = the coaches' https address, `EMAIL_FROM` on the verified domain, Google's PROD redirect URI,
   all set where the app runs. `AUTH_ADMIN_USER_IDS` stays empty until step 5. Better Auth's limiter reads the
   caller's address from `x-forwarded-for` only when it holds one address (Vercel's shape); on a host that sends a
   chain, set `advanced.ipAddress` (the header, or the trusted proxies) in `lib/auth.ts` first, or every caller
   shares one count per path and three sign-ins in ten seconds lock everyone out.
2. `npx supabase link --project-ref etezzztgafcotyahgijk < /dev/null`; `npx supabase migration list --linked`
   (expect 210 and 211 pending, nothing else); count `auth.users`, `profiles`, `coaches`, `clients` with
   `db query --linked` and write the numbers in the handover.
3. `npx supabase db push --dry-run`, read it, then the owner runs `npx supabase db push` (Claude Code's auto mode
   refuses a push to PROD): 210 adds the address trigger, 211 the delete functions.
4. Deploy `main` with the env of step 1.
5. If PROD held logins, each person signs in again (D8). If it held none, `npm run coach:create -- --project
   etezzztgafcotyahgijk …` for the owner's own coach, from the repo while it is linked to PROD (step 2), with PROD's
   values in the shell, where they win over `.env.local`: `DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` and `NEXT_PUBLIC_APP_URL` (both the coaches'
   https address, which the emailed link opens; the command refuses any other on a project but DEV), `RESEND_API_KEY`
   and `EMAIL_FROM`. Set the password from the email, then put that user id in `AUTH_ADMIN_USER_IDS` and redeploy.
6. `npm run check:rls` (linked to PROD), `npx supabase gen types typescript --linked` to a scratch file and diff
   against `types/database.ts` (only the `PostgrestVersion` line may differ). Relink DEV:
   `npx supabase link --project-ref aeaphsslctwcmebldrzx < /dev/null`.
7. After a week with no undo: §9.1's "after the switch" steps on PROD's Supabase project.

### 8.3 Undo

- **A commit after 2** is undone by `git revert` of that commit alone; 211's two functions may stay (nothing calls
  them without commit 6), and so may 210's trigger without 5.5's code (all it does is copy an address).
- **The switch itself:** `git revert` commit 2 (and every later one that landed), redeploy, and push a new
  migration (the next free number) with the SQL below. Sign-ins return to Supabase Auth with the passwords it
  holds: a password changed after the switch reverts to the old one; a login made after the switch does not exist
  in `auth.users` and is re-invited; `better_auth.*` stays in place, and the next attempt's 208 re-copies on
  conflict-free rows. Supabase Auth's providers must not have been switched off yet (D33).

```sql
-- 2NN_undo_better_auth_switch.sql: only if commit 2 is reverted (docs/BETTER-AUTH-PLAN.md 8.3). Pure ASCII.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT c.conname, c.conrelid::regclass AS tbl FROM pg_constraint c
            WHERE c.contype = 'f' AND c.confrelid = 'better_auth."user"'::regclass
              AND c.conrelid IN ('public.profiles'::regclass, 'public.coaches'::regclass, 'public.clients'::regclass)
  LOOP EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tbl, r.conname); END LOOP;
END $$;
-- NOT VALID: rows whose login was made after the switch are not checked; a new row still must point at auth.users.
ALTER TABLE public.profiles ADD CONSTRAINT profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;
ALTER TABLE public.coaches  ADD CONSTRAINT coaches_user_id_fkey  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;
ALTER TABLE public.clients  ADD CONSTRAINT clients_user_id_fkey  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL NOT VALID;
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
GRANT ALL ON public.profiles, public.coaches TO supabase_auth_admin;
-- then public.handle_new_user() and the trigger on_auth_user_created exactly as 107_harden_role_assignment.sql
-- wrote them, and the function's privileges exactly as 201_lock_the_database.sql lines 108-110 set them.
```

---

## 9. What the owner does, and what the coach chat's connector will need

### 9.1 The owner's own steps, in order

**Before commit 1 (DEV):**
- `DATABASE_URL`: Supabase dashboard → Atletafit - Dev → Connect → "Transaction pooler" (the `postgres.aeaphsslctwcmebldrzx@…pooler.supabase.com:6543` string). It needs the database password: Project Settings → Database → reset it if you don't have it. Into `.env.local`.
- `BETTER_AUTH_SECRET`: `openssl rand -base64 32`, into `.env.local`. `BETTER_AUTH_URL=http://localhost:3000`
  (the same value as `NEXT_PUBLIC_APP_URL`).
- `AUTH_ADMIN_USER_IDS`: your own user id (commit 1's session prints it from `auth.users` for
  samuel.k@taboola.com); leave it empty until then.

**Before commit 4's smoke (and every email after it): Resend.** Resend → Domains → Add domain → the DNS records it
shows (DKIM, SPF / return-path, DMARC) at your registrar → Verified. Then `EMAIL_FROM="Atletafit <no-reply@<your
domain>>"` in `.env.local` (DEV's verified `atletafit.com`: `EMAIL_FROM="Atletafit <hello@atletafit.com>"`). Until this is done every email the app sends reaches only your Resend account's
address, and the smokes use `npm run auth:last-link` for the rest.

**Before commit 7: Google.** Google Cloud Console → APIs & Services → OAuth consent screen (External; the app's
name and your support email; publish it, or add yourself as a test user) → Credentials → Create credentials →
OAuth client ID → Web application → Authorized JavaScript origins `http://localhost:3000`; Authorized redirect
URIs `http://localhost:3000/api/auth/callback/google` → `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` into
`.env.local`.

**Before PROD (§8.2):** PROD's pooler string for `etezzztgafcotyahgijk`; a new `BETTER_AUTH_SECRET` (never DEV's);
`BETTER_AUTH_URL` and `NEXT_PUBLIC_APP_URL` = the coaches' https address; `EMAIL_FROM` on the verified domain;
the Google client gains the PROD origin and `https://<that address>/api/auth/callback/google`; all of it set
where PROD's app runs.

**After the switch (PROD, and DEV once commit 2 has soaked):** Supabase dashboard → Authentication → Sign In /
Providers → Email: off (at least "Allow new users to sign up" off); Google: off if it was ever on; URL
Configuration → clear Site URL and Redirect URLs. After the undo window (D33, a week): Authentication → Users →
delete every user (nothing cascades: the keys no longer point there). Keep the service-role key and the Data API:
the app reads its data through them as before. `NEXT_PUBLIC_SUPABASE_ANON_KEY` leaves `.env.local` when commit
3's session says so.

### 9.2 Where the plan is thin, said plainly

- Resend's sandbox decides how many smoke steps can use a real email; the domain is the fix.
- Whether `auth.api.createUser` runs without a session is read from 1.7.7's source, not a doc sentence (§2.9 #2);
  commit 4's proof is the check, and `adminUserIds` is the fallback (the owner's script signs in first).
- Supabase's pooler with Kysely is a general Postgres fact, not a Better Auth doc line; commit 1's proof exercises
  it.

### 9.3 What the coach chat's connector (COACH-CHAT-PLAN.md commits 8–9) will need from Better Auth

The chat plan's §2.8, D21, D24, D28, D29, its proofs 8–9 and both prompts assume Supabase's OAuth server. When
the connector is built, on Better Auth 1.7.7:
- `@better-auth/mcp` with the `jwt()` plugin in `lib/auth.ts`: `mcp({ loginPage: "/login", consentPage:
  "/oauth/consent", resource: NEXT_PUBLIC_APP_URL + "/api/mcp", scopes, allowDynamicClientRegistration: true,
  allowUnauthenticatedClientRegistration: true })` — Claude registers a client before anyone signs in, and the
  plugin never enables registration by itself.
- A migration (the next free number after this plan's; the chat plan's "208" is renumbered when built) for the
  plugin's tables in `better_auth`: `oauthClient`, `oauthAccessToken`, `oauthRefreshToken`, `oauthConsent`,
  `oauthClientAssertion`, and jwt's `jwks`; from `npx auth@<the installed better-auth version> generate`, ids as `uuid` like §2.1.
- The authorization server is the app itself: `/.well-known/oauth-authorization-server` and
  `/.well-known/oauth-protected-resource` are served by the plugin (no `app/.well-known/...` route; the proxy's
  skip list gains `/.well-known/`); `/oauth2/authorize`, `/oauth2/token`, `/oauth2/userinfo` are Better Auth's
  under `/api/auth`. The chat plan's D21 and D28 are rewritten; the three Supabase dashboard settings in its §8
  disappear.
- `verifyToken` (`supabaseAdmin.auth.getUser(bearerToken)` + the `client_id` claim) becomes
  `requireMcpAuth(auth, handler, { resource })` (renamed from `withMcpAuth` in 1.7); `mcpHandler` became
  `createMcpProtectedRequestHandler`; the MCP SDK the plugin expects (v2's `createMcpHandler`) must be checked
  against the chat plan's D22 (`mcp-handler@1.1.0` + `@modelcontextprotocol/sdk@1.26.0`) before installing.
- The consent page calls the plugin's consent endpoints instead of `supabase.auth.oauth.getAuthorizationDetails`
  / `approveAuthorization` / `denyAuthorization`, and the query it receives is the plugin's, not
  `?authorization_id=`; the `lib/oauth-consent.ts` validator matches that shape. The signed-out return path
  (`/login?next=…`) becomes the plugin's `loginPage` continuation.
- Identity is unchanged: the token's subject is the Better Auth user id, the same uuid as today, so
  `coaches.user_id` and the `chat_enabled` check stand. Tokens carry the resource as audience, so the chat plan's
  D24 ("a web session's token is refused") becomes "only a token the plugin issued for this resource".
- The chat plan's D29 (no disconnect in the app) can be revisited: the plugin stores consents and tokens, so a
  revoke screen is possible.
