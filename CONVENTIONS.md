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

## 5. Code Style
- Use Tailwind for styling
- Lucide icons only
- Inter font family
- Async/await over promises
- Named exports over default
- No `as any` type casts - use proper types from `types/database.ts`. If extending an existing type, create a local interface.

## 6. File Structure
```
/components    - React components
  /daily-pulse - Client-side Daily Pulse components
  /clients     - Coach-side components (daily-pulse/, habits/, etc.)
/services      - Business logic
/api           - API routes
/utils         - Helper functions
/hooks         - Custom React hooks
/types         - TypeScript definitions
/lib           - Constants, helpers, utilities
```

Coach-side components in `components/clients/`. Client-side in `components/daily-pulse/` or `components/`. Never mix them.

## 7. Data Fetching & State

### Client-side (Daily Pulse)
- Use `fetch` with `{ cache: 'no-store' }` for all API calls
- All GET API routes return `Cache-Control: no-store` headers
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
  1. The table is not in `types/database.ts` (e.g. client_intake)
  2. The operation is called from an unauthenticated context (e.g. token-based
     check-in submission)
  3. The operation queries across multiple clients (e.g. coach aggregation
     queries where RLS would block cross-client reads)
  4. The operation is a system-level write (e.g. background upserts not tied
     to a user session)
- When supabaseAdmin is required, add a comment above the usage explaining
  which exception applies.

### General
- Migrations: Version controlled, never edit directly
- Relations: Foreign keys with ON DELETE CASCADE/SET NULL
- Indexes: On foreign keys, search fields, sort columns
- Timestamps: created_at, updated_at on all tables

### Soft deletes
- User-created data uses soft delete (`is_active = false`), never hard delete
- Always filter by `is_active = true` in default queries
- Unique constraints must account for inactive rows (check for inactive before inserting, reactivate if found)
- Provide UI for viewing and reactivating inactive items where appropriate

### Migration awareness
- Don't suggest schema changes that would break existing data
- If adding a required column, it needs a default value
- If renaming a column, everything that queries it breaks
- JSONB columns: Supabase handles serialization automatically - never use `JSON.stringify()` on JSONB

### JSONB conventions
- See Daily Pulse README for `training_data` and `activityStatuses` shape documentation
- `activityStatuses` is `Record<string, { completed, activityName, estimatedCalories }>` - always read `.completed` field, never use the object as a truthy check
- `training_data` JSONB is the single source of truth for training restore - never cross-reference other tables

## 9. Security
- Auth: Check on every protected route/component
- Input sanitization: All user inputs (especially coach bios, session notes)
- Rate limiting: **MANDATORY** - Every API route must include rate limiting as the first check
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
- Custom limits: AI/expensive operations (10 requests per minute or stricter)

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
- **Custom strict limits**: AI endpoints, file processing, expensive computations
- **apiRateLimit**: All other routes (default choice)

## 10. API Design
- RESTful routes: /api/coaches, /api/sessions/:id
- Status codes: 200 (success), 201 (created), 400 (validation), 401 (auth), 404 (not found), 500 (server)
- Response format: { success: bool, data: {}, error?: string }
- Timestamps: ISO 8601 format
- Versioning: /api/v1 for future-proofing

### API changes cascade
- If you change an API response shape, check every file that consumes that endpoint.
- If you add a required field, update every caller.
- If you add an export to a module, check if tests mock that module and update the mock.

### User-facing errors
- Never show raw database errors to users (e.g. "duplicate key value violates unique constraint").
- Catch known error patterns and return friendly messages (e.g. "A habit with this name already exists").

## 11. Error Handling
- All API routes: try-catch with proper error codes
- User-facing errors: Toast notifications with plain language
- Log all errors with context (user ID, action, timestamp)
- Validation: Zod schemas for all inputs/API payloads
- Database operations: Transaction rollbacks on failure
- No empty catch blocks - always log the error or surface it to the user

## 12. Testing
- Unit tests: All service functions and utilities
- Integration tests: Critical flows (booking, payments, auth)
- API tests: All endpoints with success/error cases
- Run tests before commits
- Coverage target: 70% minimum

### Commit-ready checklist
Before saying "ready to commit", ALL of these must pass:
1. `npx tsc --noEmit` - no TypeScript errors
2. `npx vitest run` - all tests pass
3. `grep -rn "console.log" [changed files]` - no debug artifacts
4. `grep -rn "as any" [changed files]` - no type escapes
5. `grep -rn "TODO\|FIXME\|HACK\|DEBUG" [changed files]` - no leftover markers

## 13. Performance
- Database queries: Indexes on foreign keys, frequently queried fields
- API responses: <200ms target, pagination for lists >20 items
- Images: Optimize/compress before upload, use WebP
- Caching: Redis for session data, frequently accessed coach profiles
- Lazy loading: Components below fold, infinite scroll for feeds

## 14. Documentation
- API endpoints: Request/response examples, error codes
- Complex functions: JSDoc with params, returns, examples
- Setup: .env.example with all required variables documented
- Database schema: ER diagram, migration strategy
- README: Local setup in <5 steps

## 15. References
- **Daily Pulse README**: Full architectural documentation for the Daily Pulse feature, including JSONB conventions, data flow, component structure, and rules that must not be violated. Claude Code should read this before modifying any Daily Pulse related code.
- **DESIGN-SYSTEM.md**: Visual patterns, colour tokens, spacing, component styling conventions.

## 16. Logging
- Info: User actions (login, booking, payment)
- Warn: Recoverable errors (rate limit hit, validation fail)
- Error: System failures with stack traces
- Format: Structured JSON for log aggregation
- Never log: Passwords, tokens, full credit cards

## 17. Configuration
- .env files: .env.local (dev), .env.production
- Required vars: Document in .env.example with descriptions
- Feature flags: For gradual rollouts
- Secrets: Never in code, use vault/secrets manager for prod