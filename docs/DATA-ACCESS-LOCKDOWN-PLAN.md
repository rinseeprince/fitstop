# Data access lockdown — the server is the only gatekeeper

**Status: commit 1 (this plan) SHIPPED 2026-09-24; commits 2–6 NOT STARTED.** Six commits, agreed with the owner on
2026-09-24: this plan; the write side door closes (2); the reads outside sign-in move onto the server (3); the
content library moves onto the server (4); sign-in reads move onto the server (5); the database is locked and the
guard holds it (6). Commit 2 can run now. Commits 3–5 run in order, each after the owner's browser smoke of the one
before. Commit 6 runs last and only after 3–5: dropping a read rule while its reader still uses it breaks that
screen for everyone.

**How this plan is used.** Each commit in §6 carries a prompt to paste into a fresh Claude Code session. **The owner
does not review a plan per commit** (owner, 2026-09-24): the session reads, builds, proves, gates and commits, marks
its STATUS line, updates the memory record, and hands the owner a browser smokelist; the owner runs the smoke before
pasting the next prompt. A session stops and asks only when a live probe or a grep contradicts this document, when
`docs/ARCHITECTURE.md` or `CONVENTIONS.md` state a rule the commit contradicts, or when the work needs something
outside the commit's list. Every list below was verified on 2026-09-24; each prompt still says grep and probe at
execution time, because the lists drift.

---

## 1. Why the shape changes

The app runs two security models side by side, and the database's is looser than the app's.

- **Writes.** Every write the app makes goes through a route and the service role — except one: activation's
  `clients` update runs under the coach's own login. Yet the database carries **56 write rules on 23 tables**
  (identical on DEV and PROD, all PERMISSIVE, all keyed on `auth.uid()`) that let a signed-in user write rows
  straight through the Data API with the browser's public key and their own token, skipping every rule the routes
  enforce. A client can rewrite a locked week's wellness, nutrition and habit logs, add or delete workout logs and
  sets, and post a check-in; a coach can hard-delete a client (the cascade takes their whole history, with no archive
  and no audit entry) and create or edit check-ins, invitations, reminders, intake, habits and content. Nothing is
  cross-tenant — every rule is tied to the caller's own login — and a user cannot change their own role (the profile
  rule pins it). Nothing uses the other 55: the code has no other session-client write, and neither database's
  `pg_stat_statements` shows a write to these tables under a user's role.
- **Reads.** About 95% of reads go through the service role. **34 reads in 18 files, on 8 tables and 3 views**
  (§4.2), still run under the user's own login, so their database rules decide what they see — the sign-in checks
  on every request, the client's profile and progress reads, activation, the attention feed's coach lookup and the
  content library. A rule change there is a functional change, and dropping the three rules behind the sign-in
  checks locks everyone out.
- **Permissions.** Tables created before CONVENTIONS §8's new-table rule still give `anon` and `authenticated`
  Supabase's stock permissions (DEV: 42 and 46 relations; PROD: 44 and 48), so the rules are the only lock on them.
- **The gate.** `npm run check:rls` checks that a rule is scoped to its caller, never whether it should exist —
  which is how 55 unused write rules survived.
- **Later: Better Auth.** Not next (owner, 2026-09-24): Supabase Auth stays until the platform's functionality is
  finished. When it comes, `auth.uid()` is empty for every request, so every rule matches nothing and the 34 reads
  return zero rows with no error — every route 401s and the middleware sends everyone to the login page. Commits 3–5
  are its prerequisite.

## 2. The target shape

```
 Browser (web harness)  /  RN app later
    │ 1. sign in ────────────► Supabase Auth   (public key: sign-in only, opens no table)
    │ 2. every request carries the user's login token
    ▼
 Our server  (Next.js middleware + /api routes)   ← the one gatekeeper
    verify the token (auth.getUser) → who is this → rate limit, CSRF → do they own it?
    → validate the input → business rules → audit log
    │ service role only; every query filtered to the verified coach or client id
    ▼
 Database (Supabase Postgres)                     ← a vault only the server opens
    RLS on every table, no policies; the public roles hold no privileges
```

1. **One gatekeeper.** The server decides every access: the route chain of CONVENTIONS §8 on every handler, and the
   verified coach or client id on every query, so a forged id matches nothing.
2. **The session client validates sessions and reads nothing.** `auth.getUser()` stays on it (CONVENTIONS §9 —
   never `getSession()`); every row lookup, the sign-in checks included, goes through the service role keyed on the
   verified user id.
3. **The public key opens nothing.** RLS on every table with no policy in `public` or `storage`; `anon` and
   `authenticated` hold no privilege on any table, view or sequence in `public`; new tables arrive closed; every
   SECURITY DEFINER function is executable by `service_role` alone. RLS stops being a second rule set and becomes
   the lock.
4. **What holds for any writer stays.** Foreign keys, CHECKs, the exclusion constraints on plan and block windows,
   the write-once trigger on a sent check-in, and the goal and measurement functions (`service_role` only).
5. **The guard.** `check:rls` fails on any policy, or any public-role privilege, outside an explicit list that ends
   empty; `check:service-key` keeps the service key out of browser code; a vitest scan keeps the session client on
   `auth.*` alone.

Nothing a coach or a client sees changes at any step.

## 3. Decisions — all answered by the owner, 2026-09-24

| # | Decision | Answer |
|---|---|---|
| D1 | Which write rules close | All 55 the app does not use, client side and coach side; activation's rule stays until commit 3 moves its writer and commit 6 drops it |
| D2 | How many commits | Six, as in the Status line |
| D3 | Auth | Supabase Auth stays; Better Auth comes after the platform's functionality is finished, and this plan is its prerequisite |
| D4 | Direct database clients | None: the RN app is not in development; the web harness is the only client; the RN app will use `/api/client/**` |
| D5 | Per-commit review | No plan review per commit; each commit ends with a browser smokelist the owner runs before the next |
| D6 | PROD | Pushes stay the owner's call. PROD is at 184 with 185–199 pending; this plan's two migrations queue behind them |

## 4. What is there today — verified 2026-09-24

### 4.1 The write rules (56 on 23 tables, identical on DEV and PROD)

Kept by commit 2, dropped by commit 6: `clients` → "Coaches can update their own clients" (UPDATE — activation).

Dropped by commit 2 (55):

| Table | Rules |
|---|---|
| `check_in_exercise_highlights` | `clients_insert_exercise_highlights`, `exercise_highlights_delete`, `exercise_highlights_insert`, `exercise_highlights_update` |
| `check_in_reminders` | "Coaches can create reminders for their clients", "Coaches can update reminders for their clients" |
| `check_ins` | "Coaches can create check-ins for their clients", "Coaches can update their clients check-ins", `clients_insert_own_check_ins` |
| `client_intake` | `coaches_manage_client_intake` (ALL) |
| `client_invitations` | "Coaches can create client invitations", "Coaches can update client invitations" |
| `clients` | "Coaches can delete their own clients", "Coaches can insert their own clients" |
| `coaches` | "Coaches can update their own data" |
| `content_assignments` | "Coaches can create assignments for their clients", "Coaches can delete assignments for their clients" |
| `content_folders` | "Coaches can create their own folders", "Coaches can delete their own folders", "Coaches can update their own folders" |
| `content_items` | "Coaches can create their own content", "Coaches can delete their own content", "Coaches can update their own content" |
| `daily_habit_logs` | `clients_manage_own_habit_logs` (ALL) |
| `daily_habits` | `coaches_manage_client_habits` (ALL) |
| `daily_logs` | `clients_delete_daily_logs`, `clients_insert_daily_logs`, `clients_insert_own_daily_logs`, `clients_update_daily_logs`, `clients_update_own_daily_logs` |
| `exercise_logs` | `clients_delete_exercise_logs`, `clients_insert_exercise_logs`, `clients_update_exercise_logs` |
| `nutrition_logs` | `clients_insert_own_nutrition_logs`, `clients_update_own_nutrition_logs` |
| `profiles` | "Users can update own profile" |
| `session_logs` | `clients_delete_session_logs`, `clients_insert_session_logs`, `clients_update_session_logs` |
| `set_logs` | `clients_delete_set_logs`, `clients_insert_set_logs`, `clients_update_set_logs` |
| `training_exercises` | `training_exercises_delete`, `training_exercises_insert`, `training_exercises_update` |
| `training_logs` | `clients_insert_own_training_logs`, `clients_update_own_training_logs` |
| `training_plans` | `training_plans_delete`, `training_plans_insert`, `training_plans_update` |
| `training_sessions` | `training_sessions_delete`, `training_sessions_insert`, `training_sessions_update` |
| `wellness_logs` | `clients_insert_own_wellness_logs`, `clients_update_own_wellness_logs` |

The three ALL rules also grant a read; no session read of those three tables exists (§4.2), so they go whole. The
nine `training_*` rules compare a `coaches.id` with `auth.uid()` and can never pass; dropping them changes nothing.
DEV carries `TO authenticated` on two `daily_logs` rules where PROD has no `TO` clause (dashboard drift); the drop
is by name, so both go.

### 4.2 Reads that run under the user's own login (34 in 18 files)

| Where | Tables | Moved by |
|---|---|---|
| `services/client-portal-progress.ts` (`/api/client/progress`) | `check_ins` (count), `client_measurements_live`, `wellness_logs`, `clients` with `client_current_measurements` and `client_baseline_measurements` | commit 3 |
| `services/client-portal-service.ts` — `getClientForCurrentUser` (`/api/client/me`), the `createPortalClient` alias | `clients` | commit 3 |
| `app/api/clients/[id]/activate/route.ts` | `clients` — two reads and the one session write | commit 3 |
| `app/api/dashboard/attention-feed/route.ts` — its own `createServerClient` | `coaches` | commit 3 |
| 11 routes under `app/api/content/**` — each with its own `getUser` and coach lookup | `coaches` (13), `content_items` (3), `clients` (3), `content_assignments` (1) | commit 4 |
| `middleware.ts` (two reads), `app/auth/callback/route.ts` | `profiles` | commit 5 |
| `lib/auth-helpers.ts` — behind `getAuthenticatedCoachId` / `getAuthenticatedClientId` | `coaches`, `clients` | commit 5 |

`app/api/auth/me/route.ts` and `lib/supabase-server.ts` use the session client for `auth.getUser()` alone and stay.
The browser client (`services/supabase-client.ts`) is `auth.*` only.

### 4.3 Permissions, storage and functions

- **Grants.** `anon` holds privileges on 42 relations on DEV and 44 on PROD, `authenticated` on 46 and 48 — the
  stock grants on tables created before CONVENTIONS §8's new-table rule.
- **Policies.** SELECT rules: 46 on DEV, 48 on PROD. Storage rules: 6 on DEV, 3 on PROD. Every storage call in the
  app is the service role's. Buckets: `content-library` on both, private; `progress-photos` on DEV only, private,
  and in no migration.
- **Functions.** SECURITY DEFINER functions were locked to `service_role` by migrations 106 and later. Nobody has
  read the live `proacl` since (TECHNICAL-DEBT → "RPC surface not re-verified against the live catalog").

### 4.4 Docs that describe today's shape

- **`docs/ARCHITECTURE.md`:**
  - the legacy-section map's "Database clients" row
  - "client_measurements table" → **Security**
  - "Client Portal Architecture" → the Journey line, and "Database access (which client, and why)"
  - "Auth Model" → "Database clients": the two-data-paths paragraph and the universal-gates box
- **`CONVENTIONS.md` §8:**
  - the Shape B introduction
  - "When to use `createServerSupabaseClient()`"
  - "RLS policies", including the "do not retrofit the tables that carry policies" paragraph
- **`TECHNICAL-DEBT.md`:**
  - the `check_ins` direct-writes entry
  - "Opened by the 2026-07-30 anon-path read trace": the inventory and the `assert-rls.ts` premise
  - the untyped session-client entry
  - "Opened by the 2026-07-21 database audit": the dead storage policies
- **Memory:**
  - `project_rls_is_decorative_service_role_everywhere`
  - `project_supabase_coupling_audit_2026_09_19` (its "collapse identity to the seam" items are commits 3–5)
  - this workstream's `project_data_access_lockdown_workstream`

## 5. Verification — every commit

- **Proof over real HTTP.** The request-level harness (`scripts/proof-session.ts`: `mintSession`, `send`) against
  `next dev` on DEV. A vitest that mocks `supabaseAdmin` proves nothing about a data path. Moved reads are recorded
  before the change and diffed after, byte-identical. Access decisions are proven with real sessions. Throwaway
  users and clients go under the owner's coach and are removed at the end.
- **Tests with mutations.** Every new assertion is mutation-tested from a copy in the scratchpad; never `git stash`
  or `git checkout --`. Every fixture number is distinct.
- **Gates.** `npx tsc --noEmit`, `npx eslint .` (0 errors), `npx vitest run`, `npm run check:labels`, `npx knip`,
  `npm run check:service-key`. Plus `npm run check:rls` for commits 2 and 6, and `npm run build` for commit 5.
- **Migrations.**
  - the next free number at execution time
  - `npx supabase db push --dry-run` immediately before the push, which auto-confirms in a non-TTY shell and may be
    classifier-blocked (then it goes to the owner as a `!` command)
  - `gen types`, with no diff expected for policy and grant changes
  - DEV only; PROD is the owner's call
- **§2 review.** CONVENTIONS §2's security, load and performance review, reported in the commit body.
- **Browser smoke.** The owner runs it after each commit, from the session's list: only what changed, one action
  per step, on data the session seeded on DEV.

## 6. The commits

### Commit 1 — `docs(plan): data access lockdown — the server is the only gatekeeper`

**STATUS: SHIPPED 2026-09-24 — the commit that adds this file.**

### Commit 2 — `fix(security): the Data API's write side door closes — 55 write rules nothing uses are dropped`

**STATUS: NOT STARTED.**

- **Probes first, read-only, on DEV and PROD:**
  - the non-SELECT policies: 56 on 23 tables, all PERMISSIVE, named as §4.1
  - `pg_stat_statements`: no write to these tables under `anon` or `authenticated`
  - a grep: no code writes through a session client except activation
- **Migration:**
  - `DROP POLICY IF EXISTS` for the 55 in §4.1
  - `COMMENT ON POLICY "Coaches can update their own clients"`, naming activation as its one user
  - a closing `DO` block that raises unless exactly one non-SELECT policy remains in `public` and it is that one.
    A name the dashboard drifted would otherwise skip silently, as it did to migration 125.
  - no grant changes (CONVENTIONS §8)
- **Test.** New `lib/session-client-ownership.test.ts`, in the shape of `lib/measurements/baseline-ownership.test.ts`:
  - The rule: a file that constructs a session client (`createServerClient`, `createServerSupabaseClient`,
    `createPortalClient`) makes no write through it — no `.insert(`, `.update(`, `.upsert(` or `.delete(` on any
    receiver but `supabaseAdmin`. The one allowance is `app/api/clients/[id]/activate/route.ts`.
  - Mutations: a session `.insert(` in a scanned file; the allowance widened to a second file.
- **Proof.** `scripts/data-api-writes-proof.ts`, using a throwaway client with its own login (`auth.admin.createUser`)
  and a habit, under the owner's coach. Everything is removed at the end: the auth users, the clients (cascade) and
  their audit rows.
  - **Before the push** (through `/rest/v1` with the public key and the user's own token), each attempt succeeds —
    the side door, shown:
    - the client inserts and updates a `daily_logs` + `wellness_logs` day, a `nutrition_logs` row, a
      `daily_habit_logs` row and a `check_ins` row
    - the coach inserts a check-in and deletes the throwaway client, then recreates it
  - **After:** each attempt is refused. An insert errors; an update or a delete changes nothing, read back with the
    service role.
  - **The app still writes:**
    - the client's wellness save (`PATCH /api/client/daily-logs/[date]/wellness`)
    - a habit tick (`POST /api/client/habits/log`)
    - the coach activating a pending throwaway client, through the kept rule
  - **The catalog:** one non-SELECT policy on DEV; `check:rls` passes.
- **Docs, current shape only:**
  - `TECHNICAL-DEBT.md`: the `check_ins` direct-writes entry closes by deletion; a hardened entry for this
    migration joins those for 105, 122, 125 and 126.
  - CONVENTIONS §8 → RLS policies: no policy grants a write to `anon`, `authenticated` or PUBLIC; a write goes
    through a route and the service role; the one exception is activation's `clients` UPDATE.
  - ARCHITECTURE → Database clients: the same fact.
- **The smoke must cover:**
  - as a client: log wellness, a meal, a habit, a workout; send a check-in
  - as a coach: activate a new client; add a habit; create, rename and delete a content folder; upload content and
    assign it; invite a client; edit a client's details

```text
Read CONVENTIONS.md (whole), docs/ARCHITECTURE.md and docs/DATA-ACCESS-LOCKDOWN-PLAN.md
(§1–§5 and §6 commit 2) before starting.

Job: Commit 2 of docs/DATA-ACCESS-LOCKDOWN-PLAN.md — `fix(security): the Data API's write
side door closes — 55 write rules nothing uses are dropped`. Build exactly what that
section lists: the PROD and DEV probes first; the migration with its closing check; the
session-client scan and its mutations; the request-level proof before and after the
push; the docs; npx knip clean.

The owner does not review a plan for this commit: build, prove, gate and commit without
stopping. Stop and ask only if a live probe or a grep contradicts the plan, if
ARCHITECTURE or CONVENTIONS state a rule this commit contradicts (name the doc line), or
if the work needs anything outside the section. Grep and probe at execution time; never
trust the plan's lists.

Rules: migration = the next free number; `npx supabase db push --dry-run` immediately
before the push (it auto-confirms in a non-TTY shell; if it is classifier-blocked, hand
it to me as a `!` command); DEV only — PROD waits for my call; gen types, no diff
expected. Every fixture number distinct; cp backups to the scratchpad before mutating,
never git stash or git checkout --; lsof -iTCP:3000 before starting or stopping a dev
server and never stop one you did not start; recordings go to the scratchpad. Gates: npx
tsc --noEmit, npx eslint . (0 errors), npx vitest run, npm run check:labels, npx knip,
npm run check:service-key, npm run check:rls. Run the §2 review into the commit body.
Commit directly to main, staging this commit's files by name. Then replace this commit's
STATUS line with SHIPPED, the hash and the date (a docs(plan) commit), update the memory
record project_data_access_lockdown_workstream, and hand me a browser smokelist covering
what the section lists: one action per step, on data you seeded on DEV.
```

### Commit 3 — `refactor(security): the client's reads, activation and the attention feed read through the server`

**STATUS: NOT STARTED. After commit 2's smoke.**

- **`/api/client/progress`** (`services/client-portal-progress.ts`): its four reads move to `supabaseAdmin`, each
  keeping its `.eq("client_id", clientId)` on the id `requireClientAuth` verified. The four are the check-in count,
  the measurement log, the wellness log, and the client row with its two reading views.
- **`/api/client/me`** (`getClientForCurrentUser`, `services/client-portal-service.ts`): the client's row is read
  through the server, scoped by the identity the route's auth already verified (grep its callers). The
  `createPortalClient` alias goes.
- **Activation** (`app/api/clients/[id]/activate/route.ts`): its two reads and its update go through the server,
  scoped by the client id the route proved the coach owns. Check the full coach chain runs before them. The kept
  write rule then has no user, and commit 6 drops it.
- **The attention feed** (`app/api/dashboard/attention-feed/route.ts`): its own session client and coach lookup go.
  It resolves the coach through `getAuthenticatedCoachId(request)`, like every coach route.
- **`scripts/perf-baseline.ts`:** the progress read no longer needs its admin-equivalent mirror — it measures
  `getClientProgressData` itself — and the `createPortalClient` follow-up goes.
- **Tests:**
  - The progress tests move their mocks to `supabaseAdmin` and keep every assertion. The `getClientForCurrentUser`,
    activation and attention-feed tests follow.
  - The scan tightens: no `.from(` or `.rpc(` on a session client in these files, and the activation allowance
    goes.
  - Mutations: a moved read back on a session client; an `.eq("client_id")` dropped from a moved read. A test must
    fail, since no RLS stands behind the service role.
- **Proof.** `scripts/wire-proof-server-reads.ts`, for the fixture client and Sam Kalepa, recorded before and diffed
  after:
  - `GET /api/client/me`, `GET /api/client/progress` at 30, 90 and 365 days, and the coach's
    `GET /api/dashboard/attention-feed` are byte-identical (the same rows through a different door)
  - activation works over HTTP on a throwaway pending client; another coach's client answers as it does today
- **Docs, current shape only:**
  - ARCHITECTURE: the client Journey line (the progress read is the server's, scoped to the verified client); "Database
    access (which client, and why)" (no `createPortalClient`); "client_measurements table" → Security (what reads
    the table now); the two-data-paths paragraph (the client reads, activation and the feed leave it).
  - TECHNICAL-DEBT: the session-read inventory loses these readers; the `createPortalClient` consolidation items
    close.
- **The smoke must cover:**
  - the client's Journey: Physique and Wellness show the same numbers as before
  - the client's home and settings load
  - the coach activates a new client
  - the coach dashboard's attention feed loads

```text
Read CONVENTIONS.md (whole), docs/ARCHITECTURE.md and docs/DATA-ACCESS-LOCKDOWN-PLAN.md
(§1–§5 and §6 commit 3) before starting.

Job: Commit 3 of docs/DATA-ACCESS-LOCKDOWN-PLAN.md — `refactor(security): the client's
reads, activation and the attention feed read through the server`. Build exactly what
that section lists: the four moved readers, each scoped by the id its route verified;
the createPortalClient alias gone; the perf-baseline mirror replaced by the real
function; the tests, the tightened scan and their mutations; the wire proof recorded
before the change and diffed after; the docs; npx knip clean. No migration.

The owner does not review a plan for this commit: build, prove, gate and commit without
stopping. Stop and ask only if a grep contradicts the plan, if ARCHITECTURE or
CONVENTIONS state a rule this commit contradicts (name the doc line), or if the work
needs anything outside the section. Grep at execution time; never trust the plan's
lists. The RN app is not built: /api/client/** is still the contract, so every recorded
response must be byte-identical.

Rules: every fixture number distinct; cp backups to the scratchpad before mutating, never
git stash or git checkout --; lsof -iTCP:3000 before starting or stopping a dev server
and never stop one you did not start; recordings go to the scratchpad. Gates: npx tsc
--noEmit, npx eslint . (0 errors), npx vitest run, npm run check:labels, npx knip, npm
run check:service-key. Run the §2 review into the commit body. Commit directly to main,
staging this commit's files by name. Then replace this commit's STATUS line with SHIPPED,
the hash and the date (a docs(plan) commit), update the memory record
project_data_access_lockdown_workstream, and hand me a browser smokelist covering what
the section lists: one action per step, on data you seeded on DEV.
```

### Commit 4 — `refactor(security): the content library reads through the server; the download's access check is code`

**STATUS: NOT STARTED. After commit 3's smoke.**

- **The 11 routes under `app/api/content/**`:** each route's own `getUser` and coach lookup are replaced by the
  auth seam (`lib/auth-helpers.ts`), and every table read goes through `supabaseAdmin`, scoped by the verified coach
  or client id. Responses and status codes stay exactly as they are; the routes' rate-limit tiers are out of scope.
- **The download** (`/api/content/download/[contentId]`): today its three reads run under the user's login, so the
  database rules decide what `hasAccess` can see. The decision stays the one in the code: access for the owning
  coach, and for an active client of that coach on a library item or an item assigned to them; nobody else. Its
  reads move to the server with explicit filters, and every case is tested one by one.
- **Tests:**
  - Each download case, with a mutation:
    - the owning coach ✓; another coach ✗
    - the coach's active client: a library item ✓, an assigned item ✓, an unassigned non-library item ✗
    - another coach's client ✗; a deactivated client ✗; signed in as neither ✗
  - The routes' tests move their mocks; the scan tightens to no session-client `.from(` under `app/api/content`.
- **Proof.** `scripts/content-access-proof.ts`:
  - the download cases over HTTP, with real sessions, throwaway content and a throwaway client
  - the content list routes' responses byte-identical before and after
- **Docs, current shape only:**
  - ARCHITECTURE: the two-data-paths paragraph (the content library leaves it)
  - TECHNICAL-DEBT: the inventory's content rows and the note that the database rules decide the download route
    close
- **The smoke must cover:**
  - as a coach: the content library lists; a folder is created, renamed and deleted; a file is uploaded, assigned to
    a client and unassigned
  - as the client: Resources opens a library item and an assigned one

```text
Read CONVENTIONS.md (whole), docs/ARCHITECTURE.md and docs/DATA-ACCESS-LOCKDOWN-PLAN.md
(§1–§5 and §6 commit 4) before starting.

Job: Commit 4 of docs/DATA-ACCESS-LOCKDOWN-PLAN.md — `refactor(security): the content
library reads through the server; the download's access check is code`. Build exactly
what that section lists: the 11 content routes on the auth seam and the service role;
the download's decision unchanged, every case tested; the tightened scan and every
mutation; the HTTP proof and the byte-identical list responses; the docs; npx knip
clean. No migration.

The owner does not review a plan for this commit: build, prove, gate and commit without
stopping. Stop and ask only if a grep contradicts the plan, if ARCHITECTURE or
CONVENTIONS state a rule this commit contradicts (name the doc line), or if the work
needs anything outside the section — the routes' rate-limit tiers are outside it. Grep
at execution time; never trust the plan's lists.

Rules: every fixture number distinct; cp backups to the scratchpad before mutating, never
git stash or git checkout --; lsof -iTCP:3000 before starting or stopping a dev server
and never stop one you did not start; recordings go to the scratchpad. Gates: npx tsc
--noEmit, npx eslint . (0 errors), npx vitest run, npm run check:labels, npx knip, npm
run check:service-key. Run the §2 review into the commit body. Commit directly to main,
staging this commit's files by name. Then replace this commit's STATUS line with SHIPPED,
the hash and the date (a docs(plan) commit), update the memory record
project_data_access_lockdown_workstream, and hand me a browser smokelist covering what
the section lists: one action per step, on data you seeded on DEV.
```

### Commit 5 — `refactor(security): sign-in reads through the server — the middleware, the auth callback and the auth seam`

**STATUS: NOT STARTED. After commit 4's smoke.**

- **What moves:** `middleware.ts` (its two `profiles` reads), `app/auth/callback/route.ts` (its `profiles` read) and
  `lib/auth-helpers.ts` (the `coaches` and `clients` lookups behind `getAuthenticatedCoachId` and
  `getAuthenticatedClientId`, used by some 120 routes).
- **How:** identity stays with Supabase Auth — `auth.getUser()` on the session client, never `getSession()`
  (CONVENTIONS §9). Each row lookup goes through the service role, keyed on the verified user id, with today's
  filters (a deactivated client still resolves to nothing; `lib/auth-cache.ts` keeps its behaviour). The session
  client is then used for `auth.*` alone.
- **The middleware's runtime** must hold the service key without it reaching a browser bundle. Check which runtime
  the middleware runs in, and prove it with `npm run check:service-key` and `npm run build` (which runs
  `check:prerender`).
- **Tests:**
  - The auth helpers' and the middleware's tests move their mocks.
  - The scan reaches its end state: a session client is used for `auth.*` only, everywhere (no `.from(`, `.rpc(` or
    `.storage`).
  - Mutations: a lookup back on the session client; the active filter dropped from the client lookup.
- **Proof.** `scripts/sign-in-proof.ts`, over HTTP:
  - a coach page and a coach API as the coach; a client page and a client API as the client
  - the client on a coach URL and the coach on a client URL route as they do today
  - no session → 307 to `/login`
  - a deactivated client → today's answer
  - `GET /api/auth/me` for both roles, byte-identical before and after
- **Docs, current shape only:**
  - ARCHITECTURE → Auth Model → Database clients: the session client validates the session and reads nothing; the
    universal-gates box goes, since those checks read through the server
  - CONVENTIONS §8 → "When to use `createServerSupabaseClient()`": to validate the session with `auth.getUser()`,
    never to read a table
  - TECHNICAL-DEBT: the session-read inventory is empty (commit 6 deletes the section); the untyped session-client
    entry closes, since nothing reads through it
- **The smoke must cover:**
  - sign in as a coach and as a client: each lands on their home
  - sign out
  - a signed-out visit to a coach page goes to the login page
  - a client opening a coach URL is sent to their own home
  - the coach's pages and the client's day load

```text
Read CONVENTIONS.md (whole), docs/ARCHITECTURE.md and docs/DATA-ACCESS-LOCKDOWN-PLAN.md
(§1–§5 and §6 commit 5) before starting.

Job: Commit 5 of docs/DATA-ACCESS-LOCKDOWN-PLAN.md — `refactor(security): sign-in reads
through the server — the middleware, the auth callback and the auth seam`. Build exactly
what that section lists: identity still from auth.getUser(), every row lookup through
the service role keyed on the verified user id with today's filters; the scan's end
state and every mutation; the HTTP proof; the docs; npx knip clean. No migration. This
code runs on every request — prove each role and each redirect before committing.

The owner does not review a plan for this commit: build, prove, gate and commit without
stopping. Stop and ask only if a grep contradicts the plan, if ARCHITECTURE or
CONVENTIONS state a rule this commit contradicts (name the doc line), if the service key
cannot be kept out of the browser bundle in the middleware's runtime, or if the work
needs anything outside the section. Grep at execution time; never trust the plan's
lists.

Rules: every fixture number distinct; cp backups to the scratchpad before mutating, never
git stash or git checkout --; lsof -iTCP:3000 before starting or stopping a dev server
and never stop one you did not start; recordings go to the scratchpad. Gates: npx tsc
--noEmit, npx eslint . (0 errors), npx vitest run, npm run check:labels, npx knip, npm
run check:service-key, npm run build. Run the §2 review into the commit body. Commit
directly to main, staging this commit's files by name. Then replace this commit's STATUS
line with SHIPPED, the hash and the date (a docs(plan) commit), update the memory record
project_data_access_lockdown_workstream, and hand me a browser smokelist covering what
the section lists: one action per step, on data you seeded on DEV.
```

### Commit 6 — `fix(security): the database is locked — no policy, no public-role privilege; check:rls holds it`

**STATUS: NOT STARTED. Last — only after commits 3, 4 and 5 have shipped and been smoked.**

- **Probes first, read-only, on DEV and PROD:**
  - every policy in `public` and `storage`
  - every `anon` and `authenticated` privilege on a `public` relation
  - `pg_default_acl`
  - the ACL of every SECURITY DEFINER function in `public`
  - the scan's end state: no session-client table access anywhere
- **Migration:**
  - drop every remaining policy in `public`: the SELECT rules, including the three sign-in rules migration 137
    labelled (`profiles`, `coaches`, `clients`), and activation's former write rule
  - drop every policy on `storage.objects`
  - revoke all privileges on every table, view and sequence in `public` from `anon` and `authenticated`, leaving
    schema usage
  - revoke the default privileges that hand a new table to `anon` and `authenticated`, for the role the migrations
    create tables as. A new table then arrives closed; CONVENTIONS §8's per-table REVOKE stays as the belt.
  - make every SECURITY DEFINER function executable by `service_role` alone, in migration 106's shape; leave the
    auth trigger's grant to `supabase_auth_admin`
  - a closing `DO` block that raises unless `public` and `storage` hold no policy, and `anon` and `authenticated`
    hold no privilege on any `public` relation
  - RLS stays enabled on every table: it is now the lock, not a rule set
- **Push:** DEV only. PROD waits for the owner with 185–199 and commit 2's migration. `gen types`, with no diff
  expected.
- **The guard:**
  - `scripts/assert-rls.ts` gains clause 4 (no policy in `public` or `storage` outside an allowlist, which ends
    empty) and clause 5 (no `anon` or `authenticated` privilege on a `public` relation outside an allowlist, which
    ends empty)
  - each clause is tested in `scripts/assert-rls.test.ts` against a fixture dump, each with a mutation
  - its header's premise ("this app's entire data path is service_role") is now true, and says so
- **Proof.** `scripts/data-api-locked-proof.ts`: with the public key alone, and with a real client's and a real
  coach's token, every table and view in `public` is refused through `/rest/v1` (a loop over the live list).
- **Docs, current shape only:**
  - ARCHITECTURE: the legacy-section map's Database clients row; the Database clients section (one data path; RLS
    on every table, no policies, no public-role privileges — the lock); "client_measurements table" → Security
  - CONVENTIONS §8: the Shape B introduction; "RLS policies" (no table carries a policy; the public roles hold no
    privileges; the "do not retrofit" paragraph goes)
  - TECHNICAL-DEBT: the 2026-07-30 anon-path section closes, `assert-rls.ts`'s premise now true; the 2026-07-21
    audit's dead storage policies close
  - memory: `project_rls_is_decorative_service_role_everywhere` becomes history
- **The smoke must cover:**
  - a full pass as the client: log wellness, a meal, a habit, a workout; open Journey; send a check-in
  - as the coach: Overview, Journey, the check-in review, the content library, activating a new client
  - a new client signing up from an invitation, which exercises the auth trigger
  - sign in and out as both

```text
Read CONVENTIONS.md (whole), docs/ARCHITECTURE.md and docs/DATA-ACCESS-LOCKDOWN-PLAN.md
(§1–§5 and §6 commit 6) before starting. Check that commits 3, 4 and 5 are SHIPPED in the
plan; if one is not, stop and tell me.

Job: Commit 6 of docs/DATA-ACCESS-LOCKDOWN-PLAN.md — `fix(security): the database is
locked — no policy, no public-role privilege; check:rls holds it`. Build exactly what
that section lists: the DEV and PROD probes first; the migration with its closing check;
check:rls clauses 4 and 5 with their tests and mutations; the locked-Data-API proof; the
docs; npx knip clean.

The owner does not review a plan for this commit: build, prove, gate and commit without
stopping. Stop and ask only if a live probe or a grep contradicts the plan — above all if
any code still touches a table through a session client, or if a function or grant turns
out to be needed by a caller other than the service role — if ARCHITECTURE or
CONVENTIONS state a rule this commit contradicts (name the doc line), or if the work
needs anything outside the section. Grep and probe at execution time; never trust the
plan's lists.

Rules: migration = the next free number; `npx supabase db push --dry-run` immediately
before the push (it auto-confirms in a non-TTY shell; if it is classifier-blocked, hand
it to me as a `!` command); DEV only — PROD waits for my call; gen types, no diff
expected. Every fixture number distinct; cp backups to the scratchpad before mutating,
never git stash or git checkout --; lsof -iTCP:3000 before starting or stopping a dev
server and never stop one you did not start; recordings go to the scratchpad. Gates: npx
tsc --noEmit, npx eslint . (0 errors), npx vitest run, npm run check:labels, npx knip,
npm run check:service-key, npm run check:rls. Run the §2 review into the commit body.
Commit directly to main, staging this commit's files by name. Then replace this commit's
STATUS line with SHIPPED, the hash and the date (a docs(plan) commit), update the memory
record project_data_access_lockdown_workstream, and hand me a browser smokelist covering
what the section lists: one action per step, on data you seeded on DEV.
```
