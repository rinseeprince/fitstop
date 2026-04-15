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
  - Simple and working beats clever and fragile.
  - One fix per change. Don't fix a bug AND refactor the component AND update the styling in the same edit. If something breaks, you can't tell which change caused it.

  ### Debugging
  - Debug first, fix second. Add console.logs and show the output before changing logic.
  - Never guess at the root cause - prove it with evidence.
  - When reverting a fix that made things worse, revert only the specific changes, don't rewrite the file.

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

  ### Writing style
  - Never use em dashes in code comments, UI copy, or documentation. Use hyphens or "to" instead.

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
  - Instrument Sans (UI text) + JetBrains Mono (numerical data) - see DESIGNSYSTEM.md for full typography spec
  - Async/await over promises
  - Named exports over default
  - No `as any` type casts - use proper types from `types/database.ts`. If extending an existing type, create a local interface.
  - Use `lib/design-tokens.ts` for type-safe spacing, border radius, shadows, and typography constants

  ## 6. File Structure
  ```
  /app           - Next.js App Router pages and API routes
  /components    - React components
    /daily-pulse - Client-side Daily Pulse components
    /clients     - Coach-side components (daily-pulse/, habits/, etc.)
    /ui          - Shadcn/Radix base components
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
  - `lib/design-tokens.ts` - Type-safe design system constants
  - `lib/auth-helpers.ts` - `getAuthenticatedCoachId()`, `getAuthenticatedClientId()`

  Coach-side components in `components/clients/`. Client-side in `components/daily-pulse/` or `components/`. Never mix them.

  ## 7. Data Fetching & State

  ### Client-side (Daily Pulse)
  - Use `fetch` with `{ cache: 'no-store' }` for all API calls
  - Client-facing GET API routes should return `Cache-Control: no-store` headers
  - Single `Promise.all` for initial data load - components never fetch their own data
  - `fetchWithRetry` helper for handling 429 rate limit errors
  - AbortController to cancel previous requests on date changes

  ### Coach-side
  - Use SWR for data fetching and caching
  - SWR config should include: `revalidateOnFocus: false`, `errorRetryCount: 3`, `errorRetryInterval: 1000`
  - Use `isLoading` for initial load skeletons, NOT `isValidating` (which fires on background refetches)
  - Dedupe rapid requests with `dedupingInterval: 2000` where appropriate
  - Include `onError` callback for debugging failed fetches

  ### State management
  - Server state: SWR (coach-side), fetch with cache busting (client-side)
  - Form state: React Hook Form with Zod where applicable
  - Local component state: useState
  - URL state: Search params for filters/pagination
  - No useState for server data on the coach side - use SWR

  ### What NOT to use
  - Do not use TanStack Query / React Query (not installed)
  - Do not use Zustand (not installed)
  - Do not use axios (not installed)

  ## 8. Database

  ### Database Access
  - Use `createServerSupabaseClient()` (session-scoped, respects RLS) for all
    database operations in authenticated routes by default.
  - Use `supabaseAdmin` (bypasses RLS) ONLY when:
    1. The operation is called from an unauthenticated context (e.g. token-based
      check-in submission)
    2. The operation queries across multiple clients (e.g. coach aggregation
      queries where RLS would block cross-client reads)
    3. The operation is a system-level write (e.g. background upserts not tied
      to a user session)
  - When supabaseAdmin is required, add a comment above the usage explaining
    which exception applies.

  ### General
  - Migrations: Version controlled, never edit directly
  - Relations: Foreign keys with ON DELETE CASCADE, SET NULL, or RESTRICT. Use RESTRICT on parent tables that must not be hard-deleted (e.g. roadmaps - forces archival instead).
  - Indexes: On foreign keys, search fields, sort columns
  - Timestamps: created_at, updated_at on all tables. Exception: immutable event tables (e.g. body_metrics) intentionally skip updated_at - add a comment explaining why.

  ### Query result methods
  - `.single()` - Use when expecting exactly one row. Errors if zero or multiple rows returned.
  - `.maybeSingle()` - Use when expecting zero or one row. Returns `null` if no row found, no error.
  - No suffix - Returns an array of rows.

  ### Soft deletes
  - User-created data uses soft delete, never hard delete
  - **is_active pattern**: Training sessions, exercises, and daily habits use `is_active = false`. Always filter by `.eq("is_active", true)` in read queries
  - **Status-based lifecycle**: Entities with richer states (e.g. roadmaps: 'active'/'archived'/'draft', phases: 'planned'/'active'/'completed'/'skipped') use a status column instead of is_active. Never hard-delete these - they contain historical data (e.g. phase_goals_snapshot)
  - Unique constraints must account for inactive rows (check for inactive before inserting, reactivate if found)
  - Provide UI for viewing and reactivating inactive items where appropriate

  ### Migration awareness
  - Don't suggest schema changes that would break existing data
  - If adding a required column, it needs a default value
  - If renaming a column, everything that queries it breaks
  - JSONB columns: Supabase handles serialization automatically - never use `JSON.stringify()` on JSONB

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

  #### Rate Limit Types:
  - `authRateLimit`: Auth/invitation routes (5 requests per 15 minutes)
  - `apiRateLimit`: General API endpoints (60 requests per minute)
  - `coachApiRateLimit`: Coach-side client routes (30 requests per 10 seconds, allows burst traffic)
  - `clientApiRateLimit`: Client portal routes (30 requests per 10 seconds, allows burst traffic)
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
  - Sentry config: `sentry.client.config.ts` (10% traces, replay with `maskAllText`/`blockAllMedia`) and `sentry.server.config.ts` (10% traces)
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
  - Database queries: Indexes on foreign keys, frequently queried fields
  - API responses: <200ms target, pagination for lists >20 items
  - Images: Optimize/compress before upload, use WebP
  - Caching: Redis (Upstash) for rate limiting
  - Lazy loading: Components below fold, infinite scroll for feeds

  ## 15. Documentation
  - API endpoints: Request/response examples, error codes
  - Complex functions: JSDoc with params, returns, examples
  - Setup: .env.example with all required variables documented
  - Database schema: ER diagram, migration strategy
  - README: Local setup in <5 steps

  ## 16. References
  - **docs/ARCHITECTURE.md**: Database schema diagrams, table hierarchies, JSONB conventions. Evolves with migrations - update when shipping schema changes.
  - **Daily Pulse README**: Full architectural documentation for the Daily Pulse feature, including data flow, component structure, and rules that must not be violated. Claude Code should read this before modifying any Daily Pulse related code.
  - **DESIGNSYSTEM.md**: Visual patterns, colour tokens, spacing, component styling conventions. This is the authoritative source for all visual tokens and takes precedence over any inline references in other sections.
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