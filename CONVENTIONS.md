  **This file is mandatory reading.** Claude Code must read this file in full before planning or implementing any code changes. Do not skip sections. Do not assume patterns - follow what is documented here.

  # CoachHub Development Conventions

  ## 1. Engineering Philosophy
  - **No band-aid fixes**: Never work around symptoms. Always investigate and understand the root cause before implementing a fix.
  - **Quality over speed**: Take the time to build clean, maintainable solutions rather than quick hacks that create technical debt.
  - **Understand before implementing**: When something doesn't work as expected, research why. Read documentation, check for known issues, and understand the intended design before writing code.
  - **If it feels wrong, it probably is**: If a solution requires fighting against the framework or library's design, step back and find the proper approach.

  ## 2. Claude Code Behavior

  ### Planning
  - Always show a plan before writing code. Never start coding without approval.
  - Identify which existing files will be affected before creating new ones.
  - Check for existing patterns in the codebase before inventing new ones (e.g. check how other hooks work before creating a new hook).

  ### Scope discipline
  - Implement exactly what's asked, not what you think might be needed later.
  - Don't add optimistic updates, caching strategies, or performance optimizations unless explicitly requested.
    - **Authorized exception (client scale only):** Sessions 3.5–3.10 of `docs/CLIENT-PORTAL-EXECUTION-PLAN.md` are an explicitly-requested performance/scale workstream for the client app. Within those sessions (and only those), caching and perf work are in-scope: the Upstash `user_id → client_id` auth-resolution cache (3.8, `lib/auth-cache.ts`, 60s TTL), SQL aggregation (3.6/3.7), keyset pagination (3.7, `lib/cursor.ts`), bounded/render-ready payloads (3.9), and client rate-limit re-keying (3.10). Per product-owner direction, where this rule blocks a needed scale change in those sessions, the change wins and the deviation is flagged in the session. Everywhere else, this rule stands.
  - Simple and working beats clever and fragile.
  - One fix per change. Don't fix a bug AND refactor the component AND update the styling in the same edit. If something breaks, you can't tell which change caused it.

  ### Debugging
  - Debug first, fix second. Add console.logs and show the output before changing logic.
  - Never guess at the root cause - prove it with evidence.
  - When reverting a fix that made things worse, revert only the specific changes, don't rewrite the file.
  - **Stale `.next` cache after refactors.** Next.js maintains an incremental build cache in `.next/` that survives dev server restarts. After a large refactor that moves/renames files (≥5 files), the cache can carry zombie entries for deleted routes and miss newly-added ones. Symptoms: routes that exist on disk return 404, services silently no-op while returning "success", or TypeScript shows phantom errors in `.next/dev/types/routes.d.ts`. Before debugging further, try: stop the dev server, `rm -rf .next`, restart. Solves ~90% of post-refactor weirdness in under a minute. If the bug persists after a clean rebuild, it's a real bug.

  ### Don't silently change working code
  - If a fix requires changing an unrelated file, call it out before doing it.
  - Never refactor surrounding code while fixing a bug.
  - If something already works, don't touch it.

  ### Read before writing
  - Before modifying a file, read the full file first. Don't assume what's in it based on the filename.
  - Before creating a new hook or utility, search the codebase for existing ones that do the same thing.
  - Before changing an API response shape, check every file that consumes that endpoint.

  ### No duplicate logic
  - Before creating a new hook, check if an existing hook already fetches the same data.
  - Before creating a new utility function, search for existing helpers that do the same thing.
  - If two components need the same data, lift the fetch to a shared parent or shared hook - don't fetch the same endpoint twice.
  - If duplicating logic across client and coach components, extract to a shared utility in `/utils` or `/lib`.
  - When 3+ functions share the same structural pattern (e.g. fetch/error/toast/mutate, try/catch/validate/respond, query/auth-check/error-handle), extract a shared helper. Prefer one well-tested helper over duplicated try/catch blocks. Helpers should live close to their consumers - in the same file for hook-specific helpers, or in `/lib` or `/utils` for cross-cutting patterns.
  - Extracting logic you're about to duplicate may mean editing a file outside the task at hand. That's allowed - it's not a scope violation - as long as you surface it per "Don't silently change working code," and verify the touched file's tests still pass.

  ### Don't assume success
  - Don't say "all done, everything works" without verifying. Show proof: terminal output, build results, or explain what was tested.
  - Commit-ready means ALL of these pass: `npx tsc --noEmit`, `npx vitest run`, no `console.log` debug artifacts left in code.

  ### Don't install packages without asking
  - If a task can be done with what's already in the project, don't add a new dependency. Always ask before running `npm install`.

  ### Respect existing architecture
  - Don't switch from snake_case to camelCase mid-file.
  - Don't introduce a new state management library when one is already in use.
  - Don't change the response format of an API that other components already consume.
  - Match the pattern from the nearest similar file in the codebase.

  ### Don't break the mock contract
  - When adding exports to a module, check if tests mock that module and update the mock.
  - When changing a function signature, check if tests call that function and update them.

  ### Naming for the audience
  - UI labels should make sense to coaches and clients, not developers.
  - No "Boolean", no "JSONB", no "isActive" in the interface. Use plain language.

  ## 3. Coding Standards

  ### Match existing patterns exactly
  - If the codebase uses `fetch` for API calls, don't introduce `axios`.
  - If it uses SWR, don't add React Query.
  - If error toasts use `toast.error()`, don't switch to `console.error`.
  - Copy the pattern from the nearest similar file.

  ### No hardcoded values
  - No magic numbers or strings. Use constants, env variables, or config.
  - If a threshold appears twice, it should be defined once in `/lib/constants.ts`.

  ### Handle edge cases upfront
  - Empty states, null values, loading states, error states.
  - Don't just build the happy path and fix edge cases later.

  ### Comment the why, not the what
  - Don't write `// set loading to true`.
  - Do write `// debounce prevents rapid API calls during date navigation`.

  ### Fail loudly in dev, gracefully in prod
  - Throw errors during development so bugs surface fast.
  - Catch and display friendly messages in production.

  ### Never swallow errors silently
  - No empty catch blocks. Always log the error or surface it to the user.
  - An error you can't see is an error you can't fix.

  ### Preserve backwards compatibility
  - If existing clients/pages already work, new code shouldn't break them.
  - Additive changes over breaking changes.

  ### Component communication
  - Props down, callbacks up. Parent owns state.
  - No `onDataChange` useEffect patterns - these cause infinite loops.
  - Child components are controlled/presentational.

  ### Dialog/modal structure
  All dialogs follow this pattern:
  - `<Dialog open={open} onOpenChange={onOpenChange}>` controlled by parent
  - `DialogContent` > `DialogHeader` > body > `DialogFooter`
  - Submit buttons show `<Loader2 className="h-4 w-4 animate-spin" />` during loading
  - Close via `onOpenChange(false)`, not separate close state
  - Forms use React Hook Form with `zodResolver(schema)` and `defaultValues`

  ### Toast notifications
  - Success: `toast({ title: "Action successful" })`
  - Error: `toast({ title: "Error", description: "What went wrong", variant: "destructive" })`
  - Import via `const { toast } = useToast()`

  ## 4. File Size Limits
  - Components: Max 250 lines (split at 300)
  - Services: Max 300 lines (split at 400)
  - API routes: Max 250 lines (split at 300)
  - Utils: Max 150 lines (split at 200)
  - Hooks: Max 300 lines (split at 350)

  When files exceed limits, extract:
  - Sub-components
  - Custom hooks
  - Service functions
  - Helper utilities

  These limits are guidelines for catching runaway files, not hard rules. If a file exceeds the threshold but its contents are cohesive (single responsibility, tightly coupled state), that's fine. Only split when you can identify a natural boundary - a reusable sub-component, an independent service concern, a separable hook. If the only way to split is scattering one flow across multiple files connected by prop-drilling or re-exports, the cure is worse than the disease.

  ## 5. Code Style
  - Use Tailwind for styling
  - Lucide icons only
  - Instrument Sans (UI text) + JetBrains Mono (numerical data) - see `docs/newdesignsystem.md` for the full typography spec
  - Async/await over promises
  - Named exports over default
  - No `as any` type casts - use proper types from `types/database.ts`. If extending an existing type, create a local interface.

  ## 6. File Structure
  ```
  /app           - Next.js App Router pages and API routes
  /components    - React components
    /clients       - Coach-facing: a coach viewing their clients' data (plural)
      /daily-pulse - Legacy coach-side pulse (wellness strip, day-detail card; being retired)
    /client        - Client-facing: pre-activation flows (onboarding, walkthrough, waiting state)
    /client-portal - Client-facing: post-activation portal (home, detail pages, nav, settings)
    /ui            - Shadcn/Radix base components
  /services      - Business logic and data operations
  /utils         - Helper functions (AI, nutrition, training calculations)
  /hooks         - Custom React hooks
  /types         - TypeScript definitions
  /lib           - Constants, helpers, utilities
    /validations - Zod schemas (auth, check-in, client, nutrition, training, etc.)
    /constants   - Constant definitions (e.g. days.ts)
  /contexts      - React context providers (auth, nutrition-builder, training-builder)
  /emails        - React Email templates (Resend)
  /supabase      - Database migrations and config
  /docs          - Architecture documentation
  /scripts       - Utility scripts
  /styles        - Global styles
  ```

  Key lib files:
  - `lib/rate-limit.ts` - Rate limiting tiers (Upstash Redis + in-memory fallback)
  - `lib/csrf-protection.ts` - CSRF origin/referer validation
  - `lib/error-handler.ts` - Sentry error capture wrapper
  - `lib/swr-fetcher.ts` - SWR fetcher with error handling
  - `lib/auth-helpers.ts` - `getAuthenticatedCoachId()`, `getAuthenticatedClientId()`
  - `lib/auth-cache.ts` - Short-TTL (60s) `user_id → client_id` auth-resolution cache (Session 3.8)
  - `lib/cursor.ts` - Opaque base64url keyset cursor encode/decode for paginated reads (Sessions 3.7/3.9)
  - `lib/date-helpers.ts` - Date/timezone helpers; the ONLY surface owning `Intl.DateTimeFormat` math (`getTodayDateStringInTimezone`, `getTodayInTimezone`, `getDeviceTimeZone`)
  - `services/today-service.ts` - DB-fetching "today" helpers for bare ids: `getClientTodayString` (client→coach→UTC fallback), `getCoachTodayString`

  ### Component folder audience conventions

  The `components/` tree has three audience-scoped folders that are easy to confuse because of the singular/plural difference. They are **parallel audiences**, not refactor-before-and-after, and files never move across them.

  - **`components/clients/`** (plural) - **coach-facing**. A coach viewing, editing, or managing their clients' data: training plans, nutrition plans, roadmap, history tables, check-in review, wellness strip, attention feed, etc.
  - **`components/client/`** (singular) - **client-facing, pre-activation**. Flows the client sees before their coach has fully activated them: intake/onboarding (`client/onboarding/`) and the guided walkthrough (`client/walkthrough/`).
  - **`components/client-portal/`** - **client-facing, post-activation**. The logged-in client portal after activation: home day view, detail pages (training, nutrition, wellness, habits), navigation, settings, phase banner, etc.

  Rule of thumb when placing a new component:
  1. Is the coach the primary viewer? → `components/clients/`.
  2. Is this shown to a client who has not yet been activated by their coach? → `components/client/`.
  3. Is this shown to an activated client inside the portal? → `components/client-portal/`.
  4. Never mix audiences in the same file. A component used by both coach and client belongs in `components/` or `components/ui/`.

  `components/clients/daily-pulse/` (coach-side: wellness strip, day-detail card) is legacy and being retired as part of the client portal redesign. Do not add new files there. (The old client-side `components/daily-pulse/` was removed in Session 5.1.) See `docs/CLIENT-PORTAL-REDESIGN.md` for the target structure.

  ## 7. Data Fetching & State

  ### Data fetching (all surfaces)
  - Use SWR for all new data fetching - coach-side and client portal alike.
  - Use `swrFetcher` from `lib/swr-fetcher.ts` (throws on non-OK responses so SWR preserves previously cached data).
  - SWR config should include: `revalidateOnFocus: false`, `errorRetryCount: 3`, `errorRetryInterval: 1000`.
  - Use `isLoading` for initial load skeletons, NOT `isValidating` (which fires on background refetches).
  - Dedupe rapid requests with `dedupingInterval: 2000` where appropriate (especially anywhere the user can trigger rapid navigation, e.g. day-swipe in the client portal).
  - Include `onError` callback for debugging failed fetches.
  - Client-facing GET API routes should return `Cache-Control: no-store` headers.

  ### Nutrition calendar cache invalidation (landmine)
  - The coach nutrition calendar renders from an SWR cache keyed per month window (`/api/clients/{clientId}/nutrition/events?startDate=...&endDate=...`). **Any client-side success path whose server route rewrites `nutrition_events`** — plan regenerate, the training cascades via `cascadeNutritionAfterTrainingChange` (place/move/duplicate/delete/surplus edits), phase transition — **must call `useInvalidateNutritionCalendar` from `hooks/use-nutrition-calendar-events.ts`**, or the calendar silently shows stale targets until a page refresh.
  - The key-builder and invalidator are co-located in that hook module deliberately so they can never drift. Never construct a `/nutrition/events` key anywhere else.

  ### Legacy (being retired)
  - The old Daily Pulse used `fetch` with `{ cache: 'no-store' }`, `Promise.all` for initial load, `fetchWithRetry`, and AbortController for request cancellation. That pattern is being removed in the client portal redesign (see `docs/CLIENT-PORTAL-REDESIGN.md` and `docs/CLIENT-PORTAL-EXECUTION-PLAN.md`). Do NOT imitate it in new code. If you find yourself editing Daily Pulse code before it's deleted, keep the existing pattern - don't mix the two.

  ### State management
  - Server state: SWR.
  - Form state: React Hook Form with Zod where applicable.
  - Local component state: useState.
  - URL state: Search params for filters/pagination.
  - No useState for server data - use SWR.

  ### What NOT to use
  - Do not use TanStack Query / React Query (not installed).
  - Do not use Zustand (not installed).
  - Do not use axios (not installed).

  ## 8. Database

  ### Auth & data-access architecture (Shape B)

  CoachHub runs in a backend-mediated shape: the browser calls Next.js API routes, routes authenticate the user and verify ownership, routes call service functions scoped by `clientId`, service functions read/write through `supabaseAdmin`. Row-Level Security policies exist on most tables as a **safety net** for bugs in the route/service layers — not a second line of defense (if the route layer is broken, RLS does nothing because `service_role` bypasses it; see "RLS policies" below). This is a valid pattern for apps with a dedicated backend, multiple user audiences (coach + client), cross-user aggregation reads, and server-only integrations (OpenAI, Stripe, Resend). See `TECHNICAL-DEBT.md → Auth Architecture Hygiene` for the rationale and for open hardening items.

  The consequence: the route layer **is** the security perimeter. Gaps in route-level auth are not caught by a second line of defense. Treat the route's auth chain and the service function's scoping parameter as non-optional.

  #### Route-level auth chain (mandatory, in this order)

  Every authenticated API handler must execute these steps before any business logic. Order matters (§9 and §10 restate this; it is the same chain).

  1. **Rate limit** — `apiRateLimit` / `coachApiRateLimit` / `clientApiRateLimit` / `authRateLimit` / `checkInRateLimit` / `aiRateLimit` per the route's category.
  2. **CSRF** — `requireCSRFProtection(request)` on any mutating verb (POST / PUT / PATCH / DELETE).
  3. **Authentication** — `getAuthenticatedCoachId()` or `getAuthenticatedClientId()` from `lib/auth-helpers.ts`. 401 on null.
  4. **Authorization / IDOR** — verify the authed principal owns or has permission to access the resource. Coach routes verify `client.coachId === coachId`. Client routes verify the resource's `client_id === authedClientId`. Returns 403 (or 404 to avoid leaking existence) on mismatch.
  5. **Input validation** — zod `schema.safeParse(body)`. 400 on failure.
  6. **Business logic** — call the service function, passing the verified scope (e.g. `clientId`). Wrap in try/catch.

  Repeat per handler. Do NOT skip step 4 because step 3 succeeded — auth proves identity, not permission.

  #### Service layer contract

  - **Services use `supabaseAdmin`.** This is the default client for the service layer, not an exception. Import from `services/supabase-admin.ts`. Do NOT add a comment justifying its use — that was an artifact of the old rule and creates noise.
  - **Services that read or write user-owned data MUST accept an explicit scope parameter** (usually `clientId`, sometimes `coachId` for coach-owned resources). No service function reads client-owned data without being told whose data to read.
  - **Services MUST filter on the provided scope.** `.eq('client_id', clientId)` (or the equivalent join constraint for nested entities). A service that accepts `clientId` but doesn't filter on it is a data leak waiting to happen.
  - **Services trust their callers.** The route layer is responsible for proving that the `clientId` passed in is one the authed principal is allowed to access. Services do not re-verify (that would be the auth check moving into the wrong layer and creating circular dependencies).
  - **Never pass a user-provided `clientId` straight to a service.** The route takes `clientId` from the URL path (or request body) and MUST run an ownership check against the authed principal before handing it to a service. See the IDOR chain in step 4 above.
  - **Cross-user reads are legitimate.** Coach dashboard reads aggregate across all of a coach's clients; attention feed, library, roadmap browsing, etc. These pass `coachId` to services that fan out; the service filters on `coach_id` rather than `client_id`. Same rule: caller-verified scope, service filters on it.

  #### When to use `createServerSupabaseClient()`

  Rarely. Most existing usages are either legacy or candidates for consolidation (see `TECHNICAL-DEBT.md → Auth Architecture Hygiene H1 #4`). If you think you need the session-scoped client, first confirm:

  - You genuinely need `auth.uid()` in-database (to satisfy an RLS policy that is doing real work), AND
  - The admin + explicit-scope pattern doesn't fit, AND
  - There is no cleaner way to pass the scope through.

  If all three are true, use it and add a one-line comment explaining why. Otherwise use `supabaseAdmin`.

  #### RLS policies

  - RLS is enabled on most tables. Policies exist as a safety net for bugs in the route or service layers.
  - Do NOT write new app-code that relies on RLS to enforce access. If the route layer is broken, RLS under service_role does nothing (service_role bypasses RLS entirely — which is most of our DB traffic).
  - When adding a new table, enable RLS with simple deny-by-default plus authenticated-allow policies. Do not write nested-subquery policies that try to replicate the IDOR chain — those have a performance cost and no practical benefit because service_role bypasses them. See `TECHNICAL-DEBT.md → Auth Architecture Hygiene H3 #1` for the simplification plan for legacy policies.

  #### Audit logging (migration 108)

  - Security-relevant actions on client-owned data are recorded in an immutable, append-only `audit_logs` table for incident investigation (`services/audit-log-service.ts`, migration 108). Call `recordAuditEvent(...)` **fire-and-forget** (`void`-prefixed) AFTER a successful, already-authorized write — it records what the route already authorized; it never authorizes or blocks the request.
  - Pass a caller-verified `actorId` + `clientId`. Use `action` names from `AUDIT_ACTIONS` (`lib/constants.ts`); `metadata` is small, non-sensitive context only — never health PII. If you pass `request`, the helper hashes the IP (SHA-256 prefix), never the raw address.
  - When to log: client invitation/activation, goal/plan/metric changes, phase transitions, intake metrics sync, role creation. Failures go to Sentry, not the user.

  ### General
  - Migrations: Version controlled, never edit directly
  - Relations: Foreign keys with ON DELETE CASCADE, SET NULL, or RESTRICT. Use RESTRICT on parent tables that must not be hard-deleted (e.g. roadmaps - forces archival instead). **Event→plan FKs are SET NULL** (`training_events.training_plan_id`, `nutrition_events.nutrition_plan_id`, both nullable since migration 113) so deleting a plan/template never destroys past/logged events — the events carry the date-specific truth (see "Events-as-SOT" below and `docs/ARCHITECTURE.md → Nutrition & Training Events`).
  - Indexes: On foreign keys, search fields, sort columns
  - Timestamps: created_at, updated_at on all tables. Exception: immutable event tables (e.g. body_metrics) intentionally skip updated_at - add a comment explaining why.

  ### Query result methods
  - `.single()` - Use when expecting exactly one row. Errors if zero or multiple rows returned.
  - `.maybeSingle()` - Use when expecting zero or one row. Returns `null` if no row found, no error.
  - No suffix - Returns an array of rows.

  ### Client read scaling (client-portal reads)
  These codify the Phase-3 scale contract (Sessions 3.6 / 3.7 / 3.9); full rationale lives in `docs/CLIENT-PORTAL-REDESIGN.md`. They override the generic "copy the nearest pattern" guidance (§3) where existing client code still uses offset.
  - **Bounded AND keyset by default.** Client list/history reads page on a cursor (e.g. `(completed_at, id)` for sessions, `(created_at, id)` for check-ins), never `OFFSET` / `.range()`. Offset cost grows with how deep the client scrolls into a multi-year history; keyset stays flat. Add the matching keyset index *with* the query (e.g. `session_logs(client_id, completed_at DESC, id DESC)`).
  - **Sparse fieldsets.** Select only the columns a row needs — never `select('*')`, and never embed a dictionary inside a row list. Fetch dictionaries (e.g. the exercise catalog) once via their own endpoint; history rows carry IDs (`exercise_id`, with `performed_name` as fallback) and the client joins locally.
  - **Aggregate server-side.** Push GROUP BY / windowed aggregates into Postgres (RPCs) so payloads are render-ready and bounded by the result, not by history size. Native is a thin renderer.
  - **Keyset cursors are opaque.** Encode/decode via `lib/cursor.ts` (base64url of `{createdAt, id}`). Routes accept the cursor as a query param, decode it strictly (reject malformed base64/JSON, non-UUID `id`, or out-of-format timestamps with 400), and build the predicate with PostgREST `.or()` (`created_at.lt.<ts>,and(created_at.eq.<ts>,id.lt.<id>)`) ordered `created_at DESC, id DESC`. `isValidIsoTimestamp()` rejects any value outside the safe ISO charset (no commas/parens) to prevent PostgREST filter injection.
  - **Dictionaries sync via their own delta endpoint.** The exercise catalog is the canonical example: `GET /api/client/exercises/catalog?since=<ISO>` returns a sparse fieldset of rows with `updated_at` after `since` (omit `since` for a full resync). It is complete-by-construction past the ~1000-row PostgREST cap (pages internally on the tie-safe `(updated_at, id)` cursor); deletes are invisible to the delta, so a periodic full resync catches them.

  ### Soft deletes
  - User-created data uses soft delete, never hard delete
  - **is_active pattern**: Training sessions, exercises, and daily habits use `is_active = false`. Always filter by `.eq("is_active", true)` in read queries
  - **Status-based lifecycle**: Entities with richer states (e.g. roadmaps: 'active'/'archived'/'draft', phases: 'planned'/'active'/'completed'/'skipped') use a status column instead of is_active. The lifecycle is **not uniform across entities** — match the one already in place:
    - **Roadmaps** stay archive-only (`ON DELETE RESTRICT`); never hard-delete a roadmap (it holds historical phases/snapshots).
    - **Phases** auto-activate by date (`promotePhaseIfReady`, no manual button) and **CAN be coach hard-deleted for any status** (`deletePhase` unlinks plans/habits `phase_id := NULL` first; logged history survives because it is event-keyed, not phase-keyed). So the "never hard-delete a status entity" rule applies to roadmaps, **not** phases.
    - **Training plans** moved to **date-range coexistence** (events-as-SOT): many provenance `training_plans` rows coexist, there is **no `planned`/promotion concept**, and "active" is resolved **by date** (the row whose `[effective_from, effective_until]` covers today), not `status='active'`. Placement is additive (no wipe/archive of prior plans).
    - **Nutrition plans** stay **one durable active plan per client** (`idx_nutrition_plans_active_unique`), edited **in place** (upsert) with **no versioning/archival**. Per-day coach edits are materialized onto `nutrition_events` (`is_modified`), never minted as new plan rows.
  - Unique constraints must account for inactive rows (check for inactive before inserting, reactivate if found)
  - Provide UI for viewing and reactivating inactive items where appropriate

  ### Events-as-SOT (plans are templates/provenance)

  Date-specific training/nutrition targets live on **events** (`training_events`, `nutrition_events`), one row per date. Plans and their templates (`training_sessions`, `nutrition_plan_daily_targets`) are **blueprints that generate events + provenance for analytics/reapply** — not the live read path for a given day, and never embedded via a live join to a deletable plan. Historical reads resolve from immutable snapshots (`session_logs`, `nutrition_logs`), never from regenerable events. When you add a date-specific feature, write it onto the event, not the plan. Full model: `docs/ARCHITECTURE.md → Nutrition & Training Events`.

  **Deferred debt (events-SOT — documented, not done):**
  - **Adherence is not unified.** Two divergent live adherence calcs coexist (coach phase-review = `session_logs` / `frequency_per_week`; client check-in = `training_events` count). A periodisation-safe denominator + unifying them is a separate decision — do not change adherence math under the guise of an events-SOT edit.
  - **Prescribed denormalization.** `training_events.calorie_surplus_percentage` is denormalized from the session so the nutrition cascade can read it per date; **every** training event-write path must keep populating it (one dropped write silently falls nutrition back to rest-day calories while the TRAIN badge still renders). See `TECHNICAL-DEBT.md`.

  ### Migration awareness
  - Don't suggest schema changes that would break existing data
  - If adding a required column, it needs a default value
  - If renaming a column, everything that queries it breaks
  - JSONB columns: Supabase handles serialization automatically - never use `JSON.stringify()` on JSONB

  ### Migration workflow (MANDATORY)

  **Never paste schema SQL into the Supabase Studio SQL Editor.** The Studio SQL Editor is read-only in our mental model — fine for `SELECT` queries, ad-hoc investigation, debugging. Never `CREATE`, `ALTER`, `DROP`. Pasting schema SQL into the editor bypasses the `supabase_migrations.schema_migrations` tracking table and causes silent drift between the codebase and the live DB. Any schema change that reaches prod without a migration file in git is a bug.

  **The five-step workflow for every schema change:**

  1. Create a new migration file at `supabase/migrations/XXX_<short_description>.sql` with the next available number (never reuse, never skip, never edit existing migrations).
  2. Apply it via terminal: `npx supabase db push`.
  3. Regenerate types: `npx supabase gen types typescript --linked > types/database.ts`.
  4. Skim the `types/database.ts` diff — the changes should exactly correspond to your migration. Unexpected additions/removals are a red flag.
  5. Commit the migration file and regenerated types in the **same commit** so git history stays coherent.

  **Rules that keep this healthy:**
  - One file per change. Don't edit an existing migration to "add one more thing" — write a new file.
  - Never edit a migration file after `db push` has applied it. Once it's history, changes go in the next number.
  - Never skip or reuse migration numbers. 088 → 089 → 090. No `088_v2`, no going back.
  - `types/database.ts` is generated — never hand-edit it. If something looks wrong in that file, the bug is in the database schema, and the fix is a new migration.

  **Useful commands:**
  ```
  # Current state of the tracking table vs local migration files:
  npx supabase migration list --linked

  # Apply any pending migrations to the live DB:
  npx supabase db push

  # Regenerate types/database.ts from the live schema:
  npx supabase gen types typescript --linked > types/database.ts

  # Repair tracking table if drift appears (e.g. someone pasted into Studio):
  npx supabase migration repair --status applied <version> --linked
  ```

  **Docker requirement:** The daily workflow above does NOT need Docker — `db push` and `gen types` talk directly to the cloud DB via `--linked` credentials. Docker Desktop is only required for commands that spin up a local shadow DB (`supabase start`, `supabase db reset`, `supabase db diff`). Open Docker when you need those; keep it closed otherwise.

  ### Schema architecture
  Schema diagrams, table hierarchies, and JSONB conventions are documented in **docs/ARCHITECTURE.md**. That file evolves with migrations. These coding rules stay stable.

  ## 9. Security
  - Auth: Check on every protected route/component
  - Middleware auth: Uses `getUser()` which validates JWT server-side, NOT `getSession()` (which only reads the cookie without verification, making it susceptible to tampered tokens)
  - Input sanitization: All user inputs (especially coach bios, session notes)
  - Rate limiting: **MANDATORY** - Every API route must include rate limiting as the first check
  - CSRF protection: **MANDATORY** - All mutating API routes (POST/PUT/PATCH/DELETE) must call `requireCSRFProtection(request)` from `lib/csrf-protection.ts` as the second check after rate limiting
  - Sensitive data: Never log passwords, tokens, payment info
  - File uploads: Validate type, size, scan (profile pics, workout plans)

  ### Rate Limiting Requirements
  **ALL new API routes MUST implement rate limiting as the first operation in every handler function.**

  > **Client-portal two-tier exception (Session 3.10).** Client routes are keyed per *client identity*, but the client id isn't known until auth resolves. So client-portal routes run **two tiers**: a generous IP-keyed burst guard stays the mandatory *first* operation (DoS / carrier-NAT safe), and a tight **per-client** limit is applied immediately *after* `getAuthenticatedClientId()` resolves. This is the one sanctioned place a rate-limit check runs post-auth; the first-operation rule still holds for the IP guard.

  #### Rate Limit Types:
  - `authRateLimit`: Auth/invitation routes (5 requests per 15 minutes)
  - `apiRateLimit`: General API endpoints (60 requests per minute)
  - `coachApiRateLimit`: Coach-side client routes (30 requests per 10 seconds, allows burst traffic)
  - `clientApiRateLimit`: Client portal routes (first tier) — a loose, abuse-only IP burst guard (~1000 req/10s) set above any plausible carrier-NAT aggregate. Paired with a tight **per-client** limit (`clientPerClientRateLimit`, 30 req/10s, keyed by client id) applied post-auth. The per-client tier composes on top of any first-tier override; it is never replaced by one.
  - `checkInRateLimit`: Public check-in endpoints (30 requests per minute)
  - `aiRateLimit`: AI-powered endpoints using OpenAI (10 requests per minute) - prevents cost abuse

  #### Required Pattern:
  ```typescript
  import { apiRateLimit } from "@/lib/rate-limit";

  export async function GET(request: NextRequest) {
    const rateLimitResult = await apiRateLimit(request);
    if (rateLimitResult) return rateLimitResult;

    // ... rest of handler logic
  }
  ```

  #### When to Use Each Type:
  - **authRateLimit**: `/api/auth/*`, `/api/invitations/*`, login, signup, password reset
  - **coachApiRateLimit**: `/api/clients/*` (coach viewing/managing client data)
  - **clientApiRateLimit**: `/api/client/*` (client portal endpoints)
  - **checkInRateLimit**: Public check-in submission endpoints
  - **aiRateLimit**: AI-powered endpoints (check-in summaries, training generation, activity analysis)
  - **apiRateLimit**: All other routes (default choice)

  ## 10. API Design
  - RESTful routes: /api/coaches, /api/sessions/:id
  - Status codes: 200 (success), 201 (created), 400 (validation), 401 (auth), 404 (not found), 500 (server)
  - Response format: { success: bool, data: {}, error?: string }
  - Timestamps: ISO 8601 format
  - No version prefix in routes (use `/api/*` directly)

  ### API Route Middleware Ordering
  Every API handler must follow this exact sequence:
  1. Rate limiting (`apiRateLimit`, `coachApiRateLimit`, etc.)
  2. CSRF protection (`requireCSRFProtection`) - mutating methods only
  3. Authentication (`getAuthenticatedCoachId()` or `getAuthenticatedClientId()`)
  4. Authorization (ownership check - verify coach owns the client)
  5. Input validation (`schema.safeParse(body)`)
  6. Business logic (wrapped in try/catch)

  ### API changes cascade
  - If you change an API response shape, check every file that consumes that endpoint.
  - If you add a required field, update every caller.
  - If you add an export to a module, check if tests mock that module and update the mock.

  ### User-facing errors
  - Never show raw database errors to users (e.g. "duplicate key value violates unique constraint").
  - Catch known error patterns and return friendly messages (e.g. "A habit with this name already exists").

  ## 11. AI Services

  ### Model Selection
  - **`gpt-4o`**: Check-in AI summaries (`services/ai-service.ts`) - higher quality reasoning for nuanced client feedback
  - **`gpt-4o-mini`**: Training plans, activity analysis, calorie calculations (`services/training-ai-service.ts`, `services/activity-ai-service.ts`, `services/training-calorie-service.ts`) - cost-efficient for structured/formulaic tasks

  ### Timeout Budgets
  All OpenAI calls must specify an explicit timeout:
  - 25s for check-in summaries
  - 15s for activity analysis
  - 45s for training plan generation

  ### Rate Limiting
  All AI endpoints must use `aiRateLimit` (10 req/min) to prevent cost abuse from repeated requests.

  ## 12. Error Handling
  - All API routes: try-catch with proper error codes
  - User-facing errors: Toast notifications with plain language
  - Server-side errors: Use `captureApiError(error, context)` from `lib/error-handler.ts` to log and send to Sentry
  - Client-side errors: Wrap error-prone UI sections with `<ErrorBoundary>` from `components/ui/error-boundary.tsx`
  - Sentry config: `instrumentation-client.ts` (browser — 10% traces, `sendDefaultPii: false`, `scrubHealthData` beforeSend/beforeBreadcrumb, replay with `maskAllText`/`blockAllMedia`), `sentry.server.config.ts` and `sentry.edge.config.ts` (10% traces + `scrubHealthData`). The browser init lives in `instrumentation-client.ts` because under Next 16/Turbopack the legacy `sentry.client.config.ts` no longer loads — there must be exactly one client init.
  - Validation: Zod schemas in `lib/validations/` for all inputs/API payloads. Use `optionalString()`, `optionalNumber()` helpers for null/empty coercion. Use `.refine()` for cross-field validation.
  - Database operations: Transaction rollbacks on failure
  - No empty catch blocks - always log the error or surface it to the user

  ## 13. Testing
  - Unit tests: All service functions and utilities
  - Integration tests: Critical flows (booking, payments, auth)
  - API tests: All endpoints with success/error cases
  - Run tests before commits
  - Coverage target: 70% minimum

  ### Commit-ready checklist
  Before saying "ready to commit", ALL of these must pass:
  1. `npx tsc --noEmit` - no TypeScript errors
  2. `npx eslint .` - no lint errors (catches floating promises, console.log, type issues)
  3. `npx vitest run` - all tests pass
  4. `grep -rn "as any" [changed files]` - no type escapes
  5. `grep -rn "TODO\|FIXME\|HACK\|DEBUG" [changed files]` - no leftover markers

  ## 14. Performance
  - Database queries: Indexes on foreign keys, frequently queried fields. Index *with* the query — add the keyset index alongside the read it serves (see §8 "Client read scaling").
  - API responses: <200ms target. Client list/history reads are **keyset-paginated and bounded by default** (§8), not offset.
  - Images: Optimize/compress before upload, use WebP
  - Caching: Redis (Upstash) for rate limiting, plus the client-scale caches authorized in §2 (auth-resolution + short-TTL context, Sessions 3.7 / 3.8).
  - Lazy loading / infinite scroll: a **web-render** concern. The client web app is a throwaway test harness (the real client is React Native), so web-render perf — lazy-mount, memoization, virtualization, chart animations — is explicitly **out of scope** for the client portal; invest scale work in the data/API/DB layer instead. (Coach-side web perf is unaffected by this note.)

  ## 15. Documentation
  - API endpoints: Request/response examples, error codes
  - Complex functions: JSDoc with params, returns, examples
  - Setup: .env.example with all required variables documented
  - Database schema: ER diagram, migration strategy
  - README: Local setup in <5 steps

  ## 16. References
  - **docs/ARCHITECTURE.md**: Database schema diagrams, table hierarchies, JSONB conventions. Evolves with migrations - update when shipping schema changes.
  - **docs/CLIENT-PORTAL-REDESIGN.md** + **docs/CLIENT-PORTAL-EXECUTION-PLAN.md**: Active redesign replacing Daily Pulse with a day-centric, event-driven client portal. These are the source of truth for any client-portal work. Read both before modifying anything under `app/client/**` or `components/client-portal/**`. Where ARCHITECTURE.md and these docs disagree about a client-portal write path or data flow (for example the monolithic `upsert_daily_log_atomic()` write under ARCHITECTURE's "Daily Logs" section), these redesign docs win; ARCHITECTURE describes the legacy path until Session 5.1's doc sweep rewrites it.
  - **`docs/newdesignsystem.md`**: Visual patterns, colour tokens, spacing, typography. The authoritative source for visual tokens (the old `DESIGNSYSTEM.md` path no longer exists).
  - **TECHNICAL-DEBT.md**: Known gaps between conventions and current implementation.

  ## 17. Logging
  - Info: User actions (login, booking, payment)
  - Warn: Recoverable errors (rate limit hit, validation fail)
  - Error: System failures with stack traces - use `captureApiError()` for Sentry reporting
  - Current approach: `console.error/warn` + Sentry capture (no structured JSON logging yet)
  - Never log: Passwords, tokens, full credit cards

  ## 18. ESLint Configuration
  Uses flat config (`eslint.config.mjs`) with TypeScript ESLint type-checked rules.

  ### Error-level rules (must fix)
  - `no-floating-promises` - unhandled async calls cause silent failures
  - `no-misused-promises` - async functions in non-async contexts (allows async onClick)
  - `await-thenable` - awaiting non-Promise values
  - `require-await` - async functions that don't await

  ### Warn-level rules
  - `no-explicit-any` - use proper types instead
  - `no-unused-vars` - ignores `_`-prefixed variables
  - `no-console` - allows `console.warn`, `console.error`, `console.info`, `console.debug`

  ### File-specific overrides
  - Components, pages, hooks, contexts: `no-floating-promises` downgraded to warn (useEffect fire-and-forget pattern is intentional when try/catch is inside)
  - Test files: `no-explicit-any` and `no-console` disabled

  ## 19. Configuration
  - .env files: .env.local (dev), .env.production
  - Required vars: Document in .env.example with descriptions
  - Secrets: Never in code, use vault/secrets manager for prod