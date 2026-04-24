# Technical Debt Tracker

## Authentication & Authorization

Reviewed: 2026-03-12

### P0 - Security

| # | Issue | File(s) | Details | Status |
|---|-------|---------|---------|--------|
| 1 | Middleware uses `getSession()` instead of `getUser()` | `middleware.ts:49,90` | `getSession()` reads the JWT from cookies without server-side validation. Supabase docs recommend `getUser()` for security-sensitive route protection as it validates the token server-side. A tampered/expired JWT could pass middleware checks. Violates §1, §9. | Done |
| 2 | Dangerous default role fallback | `middleware.ts:106` | `const role = profile?.role \|\| "trainer"` - if profile fetch fails (DB error, network issue), user silently gets trainer-level access. Should deny access instead. Violates §3, §9. | Done |
| 3 | No `requireClientAuth` guard | `lib/require-coach-auth.ts` | Coach routes have a shared `requireCoachAuth()` guard but no equivalent exists for client routes. Each client route implements its own auth check, risking inconsistency. Violates §2 "No duplicate logic". | Open |
| 4 | Auth callback route missing rate limiting | `app/auth/callback/route.ts` | The OAuth callback endpoint has no rate limiting. All other auth-related routes are properly rate-limited. Violates §9 "Rate limiting: MANDATORY". | Open |
| 5 | Invitation token endpoint uses wrong rate limit tier | `app/api/invitations/[token]/route.ts` | Uses `apiRateLimit` (60/min) instead of `authRateLimit` (5/15min). This is a public endpoint that reveals invitation details and could be used for token enumeration. | Done |
| 6 | Inconsistent password minimum length | `app/reset-password/page.tsx:35`, `lib/validations/auth.ts:30` | Signup and invite signup require 8-char minimum. Password reset allows 6-char minimum. Users can downgrade password strength via the reset flow. | Done |
| 7 | No email verification enforcement | `contexts/auth-context.tsx` | Users can sign up and immediately access the app without verifying their email. Supabase supports email verification but it's not gated in the auth flow. **Blocked** until production domain is live (Supabase email verification requires verified sender domain). | Open |
| 8 | No account-level lockout after failed login attempts | `lib/rate-limit.ts` | Rate limiting protects at the IP level (via `authRateLimit`), but there's no per-account lockout. An attacker distributing attempts across IPs could still brute-force a specific account's password. | Open |

---

### P1 - File Size Violations

| # | File | Lines | Limit | Over By | Status |
|---|------|-------|-------|---------|--------|
| 1 | `contexts/auth-context.tsx` | 512 | 300 | 212 (71%) | Open |

**Suggested splits:**

1. **`contexts/auth-context.tsx`** - Extract profile fetching/creation (`fetchProfile`, `createProfile`, `fetchOrCreateCoachProfile`) into `services/auth-profile-service.ts`. Extract session sync logic (visibility change handler, storage change handler) into a `hooks/use-session-sync.ts` hook.

---

### P2 - Code Quality

| # | Issue | File(s) | Details | Status |
|---|-------|---------|---------|--------|
| 1 | Duplicate Supabase server client factories | `lib/auth-helpers.ts:5-28`, `lib/supabase-server.ts:8-29` | `createSupabaseServerClient()` and `createServerSupabaseClient()` are nearly identical functions with confusingly similar names. Consolidate into one. Violates §2 "No duplicate logic". | Open |
| 2 | `CoachRow` type defined locally | `contexts/auth-context.tsx:37-45` | Should be imported from shared types. Comment says "profiles table not in generated types yet" - indicates database types are stale. Violates §5, §6. | Open |
| 3 | Pervasive type assertions | `contexts/auth-context.tsx:92,114-116,125,149,174` | Multiple `as unknown as` and `as Record<string, unknown>` casts because `profiles` and `coaches` tables aren't in the generated `Database` type. Fix by regenerating Supabase types. Violates §5. | Open |
| 4 | `ClientRow` type defined locally | `app/api/invitations/send/route.ts:9-15` | Same issue as #2 - inline type instead of shared from `/types`. | Open |
| 5 | Deprecated `acceptInvitation` still called | `app/auth/callback/route.ts:59`, `services/invitation-service.ts:364` | Marked `@deprecated` in favor of `acceptInvitationByToken`, but the callback route still uses it. Violates §1. | Open |
| 6 | Legacy clientId-based acceptance still maintained | `app/api/invitations/accept/route.ts:42-81` | The deprecated code path adds ~40 lines of complexity. If `acceptInvitation` (#5) is migrated, this entire branch can be removed. | Open |
| 7 | `invitation-service.ts` imports browser client | `services/invitation-service.ts:1` | `getInvitationForClient()` uses the browser Supabase client. If called server-side, this will fail or bypass proper auth. Should use admin or server client. Violates §1. | Open |
| 8 | Login fetches profile twice | `contexts/auth-context.tsx:384-388` | `login()` calls `initializeUserData()` (which fetches profile) then immediately calls `fetchProfile()` again to return the role. Violates §2 "don't fetch the same endpoint twice". | Open |
| 9 | `error: any` in auth pages | `app/forgot-password/page.tsx:31`, `app/reset-password/page.tsx:55` | Both use `catch (error: any)` while login and signup correctly use `catch (error: unknown)` with `instanceof Error` checks. Violates §5. | Open |
| 10 | Forgot-password and reset-password skip Zod validation | `app/forgot-password/page.tsx`, `app/reset-password/page.tsx` | Both use raw `useState` with manual validation, while login/signup use `react-hook-form` + `zodResolver`. Violates §11, §3. | Open |
| 11 | Manual cookie parsing in browser client | `services/supabase-client.ts:21-63` | `createBrowserClient` handles cookies automatically by default. The manual `document.cookie` parsing is unnecessary and a potential source of bugs. Violates §1. | Open |
| 12 | Duplicated auth page layout/background | `app/login/page.tsx`, `app/signup/page.tsx`, `app/forgot-password/page.tsx`, `app/reset-password/page.tsx`, `app/invite/[token]/page.tsx` | All 5 auth pages duplicate the same animated orb background, card wrapper, and Framer Motion pattern. Extract to a shared `AuthLayout` component. | Open |
| 13 | Magic link onboarding check uses unset metadata | `app/auth/callback/route.ts:67` | `!user.user_metadata?.password_set` - this metadata field is never set anywhere in the codebase, so `needsOnboarding` is always `true` for clients via this path. Dead code that silently misdirects users. | Open |

---

### P3 - Cleanup

| # | Issue | File(s) | Details | Status |
|---|-------|---------|---------|--------|
| 1 | ~25 console.log debug statements | `contexts/auth-context.tsx` | Left over from debugging. Should be removed. Violates §12 commit-ready checklist. | Open |
| 2 | Stale closure in visibility change handler | `contexts/auth-context.tsx:319-322` | `handleVisibilityChange` captures `session` from the initial render closure. On subsequent tab focuses, it compares against the stale initial session, not the current state. Should use a ref. | Open |

---

## Client Onboarding Flow

Reviewed: 2026-03-12

### P1 - File Size Violations

These files exceed the limits defined in CONVENTIONS.md Section 4 and should be split.

| # | File | Lines | Limit | Over By | Status |
|---|------|-------|-------|---------|--------|
| 1 | `services/check-in-tracking-service.ts` | 455 | 300 | 155 (51%) | Open |
| 2 | `app/client/dashboard/page.tsx` | 366 | 250 | 116 (46%) | Open |
| 3 | `components/check-in/check-in-detail-modal.tsx` | 352 | 250 | 102 (41%) | Open |
| 4 | `app/api/client/check-ins/route.ts` | 292 | 250 | 42 (17%) | Open |
| 5 | `app/client/check-in/page.tsx` | 290 | 250 | 40 (16%) | Open |
| 6 | `components/daily-pulse/daily-pulse.tsx` | 277 | 250 | 27 (11%) | Open |
| 7 | `components/client/walkthrough/guided-walkthrough.tsx` | 266 | 250 | 16 (6%) | Open |
| 8 | `lib/date-utils.ts` | 221 | 150 | 71 (47%) | Open |
| 9 | `utils/daily-logs-aggregation.ts` | 185 | 150 | 35 (23%) | Open |

**Suggested splits:**

1. **`check-in-tracking-service.ts`** - Split into `check-in-overdue-service.ts` (overdue/due-soon detection) and `check-in-adherence-service.ts` (streak calculations, adherence stats). Currently mixes unrelated concerns: overdue severity, upcoming detection, streak counting, and adherence statistics.

2. **`dashboard/page.tsx`** - Extract a `useDashboardData()` hook to handle the 6-endpoint `Promise.all` fetch and associated state management. The page component should only own layout and rendering.

3. **`check-in-detail-modal.tsx`** - Extract tab content panels (daily context summary, AI summary card, photo viewer) into sub-components. The modal currently manages multiple data fetches and complex state for unrelated tabs.

4. **`check-ins/route.ts`** - Extract photo upload handling and AI summary triggering into the check-in service layer. The POST handler has too many inline responsibilities.

5. **`check-in/page.tsx`** - Extract step navigation logic and `canProceed()` validation into a `useCheckInSteps()` hook.

6. **`daily-pulse.tsx`** - Split into `DailyPulseContainer` (hooks, state, handlers) and `DailyPulseView` (JSX rendering).

7. **`guided-walkthrough.tsx`** - Extract individual step content renderers into a `walkthrough-steps.tsx` sub-component.

8. **`date-utils.ts`** - Move check-in-specific functions (`calculateCheckInPeriod`, `getCheckInStatus`, `getNextPeriodEnd`) to a new `lib/check-in-date-utils.ts`.

9. **`daily-logs-aggregation.ts`** - Split metric averaging into a separate `utils/metric-averages.ts`.

---

### P2 - Code Quality

| # | Issue | File(s) | Details | Status |
|---|-------|---------|---------|--------|
| 1 | Duplicate constant | `lib/date-utils.ts` | `DAY_MAP` defined twice (lines 50-58 and 129-137). Extract to a single module-level constant. | Open |
| 2 | Hardcoded magic numbers | `services/check-in-tracking-service.ts` | `-3` days upcoming threshold, `frequencyDays + 2` tolerance (lines 262, 311), `7` days grace window (line 440). Extract to named constants. | Open |
| 3 | Hardcoded magic numbers | `components/check-in/daily-logs-summary.tsx` | Wellness thresholds (mood 3/4, stress 3/6, energy/sleep 5/7) and score divisors (2.5, 2, 3.5, 2.5). Extract to `lib/constants.ts`. | Open |
| 4 | Hardcoded magic numbers | `components/check-in/step-subjective.tsx` | Minimum logs threshold `3` (line 29), default metric values of `5`. | Open |
| 5 | Hardcoded magic numbers | `services/client-check-in-service.ts` | `6` days offset (line 66), `1.2` TDEE sedentary multiplier (line 146). | Open |
| 6 | Hardcoded magic numbers | `components/clients/check-in/check-in-schedule-card.tsx` | `"24"` default hours, `168` max hours. | Open |
| 7 | Unsafe type casts | `lib/mappers.ts` | Lines 37-38 cast raw DB JSON to `AIInsight[]` and `AIRecommendation[]` without runtime validation. Add Zod schemas or type guards. | Open |
| 8 | Empty catch blocks | `components/client/walkthrough/guided-walkthrough.tsx` | Line 76: catch block with only a comment, no logging. Should at minimum `console.warn`. | Open |
| 9 | Empty catch blocks | `components/coach/client-activation-dialog.tsx` | Lines 87, 111: errors are logged but not surfaced to the user via toast. | Open |
| 10 | Incomplete error handling | `app/client/dashboard/page.tsx` | `Promise.all` fetches 6 endpoints but failure in one leaves all state undefined. Should handle per-endpoint failures independently. | Open |
| 11 | Unmemoized handler factories | `components/daily-pulse/daily-pulse.tsx` | Lines 208-210: `createAddHandler`, `createRemoveHandler`, `createToggleHandler` recreated every render. Wrap in `useCallback`. | Open |

---

## Daily Pulse Feature

Reviewed: 2026-03-12

### P1 - Bugs

| # | Issue | File(s) | Details | Status |
|---|-------|---------|---------|--------|
| 1 | Wrong date for unplanned activities | `components/daily-pulse/utils/daily-pulse-handlers.ts:84` | `saveUnplannedActivities` hardcodes `new Date().toISOString().split('T')[0]` instead of using the selected date. Saving unplanned activities on a past date incorrectly logs them for today. Fix: pass `selectedDate` as a parameter. | Open |

---

### P2 - Code Quality

| # | Issue | File(s) | Details | Status |
|---|-------|---------|---------|--------|
| 1 | Duplicate type: `HabitLogWithDetails` | `daily-pulse-content.tsx`, `habits-section.tsx`, `use-daily-pulse.ts`, `use-daily-pulse-state.ts`, `daily-pulse-logged-view.tsx` | Defined independently in 5 files. Canonical export exists in `types/daily-habit.ts`. All other files should import from there. | Open |
| 2 | Duplicate type: `TodaysActivity` | `daily-pulse-content.tsx`, `training-summary.tsx`, `daily-logs-service.ts`, `use-daily-pulse.ts` | Defined in 4 files. Extract to `types/daily-log.ts` and import everywhere. | Open |
| 3 | Duplicate type: `UnplannedActivity` | `daily-pulse-content.tsx`, `training-summary.tsx`, `nutrition-tracking-helpers.ts`, `add-activity-form.tsx` | Defined in 4 files. Extract to `types/daily-log.ts` and import everywhere. | Open |
| 4 | Silent error swallowing | `components/daily-pulse/utils/daily-pulse-handlers.ts:55-57, 90-92` | `handleSessionCompletion` and `saveUnplannedActivities` catch errors with only `console.error`. No user-facing toast. Violates CONVENTIONS "Never swallow errors silently". | Open |
| 5 | Duplicated row-to-model mapping | `services/daily-logs-service.ts:159-183, 203-227, 267-291` | Identical snake_case-to-camelCase mapping repeated 3 times. Extract a `mapRowToDailyLog(row: DailyLogRow): DailyLog` helper. | Open |
| 6 | Inconsistent date string handling | `components/daily-pulse/habits-section.tsx:83`, `components/daily-pulse/daily-pulse.tsx:40` | Uses `.split('T')[0]` instead of existing `getDateString()` from `lib/date-helpers.ts`. | Open |
| 7 | Undocumented eslint-disable | `hooks/use-training-restoration.ts:92` | Suppresses `react-hooks/exhaustive-deps` without a "why" comment. CONVENTIONS require commenting the why (Section 3, line 82-83). Audit deps and add rationale or fix. | Open |

---

### P3 - Test Coverage

| # | Issue | File(s) | Details | Status |
|---|-------|---------|---------|--------|
| 1 | No tests for daily pulse hooks | `hooks/use-daily-pulse.ts`, `hooks/use-daily-pulse-state.ts`, `hooks/use-training-restoration.ts` | 3 hooks with ~500 lines of logic and zero test coverage. CONVENTIONS require 70% minimum (Section 12). | Open |
| 2 | No tests for handler utilities | `components/daily-pulse/utils/daily-pulse-handlers.ts`, `daily-pulse-event-handlers.ts`, `nutrition-change-handlers.ts` | Pure functions with no tests. These are easily testable without component mocking. | Open |

---

## Client Onboarding Flow (previous section)

### P3 - Test Maintenance

| # | Issue | File | Details | Status |
|---|-------|------|---------|--------|
| 1 | File size violation | `__tests__/helpers/mock-data-builders.ts` | 418 lines (67% over 250-line limit). Split into `mock-client-builders.ts`, `mock-check-in-builders.ts`, `mock-training-builders.ts`. | Open |

---

## Known RLS Gaps (Tech Debt)

- **`daily_logs`** - Done. RLS enabled in migration 051. All 8 code paths confirmed to use supabaseAdmin (bypasses RLS). Policies added for defense-in-depth.
- **`check_ins`** - Done. RLS enabled in migration 050. Policies already existed from migrations 005 + 026 but `ENABLE ROW LEVEL SECURITY` was never executed.

---

## Production Readiness

Reviewed: 2026-03-18

### P1 - Infrastructure

| # | Issue | File(s) | Details | Status |
|---|-------|---------|---------|--------|
| 1 | Add per-coach daily AI call quota | `services/ai-service.ts`, `services/training-ai-service.ts`, `services/activity-ai-service.ts` | Track AI usage per coach in the database and enforce daily/monthly limits to cap OpenAI costs. Currently rate limiting is IP-based and per-minute only, which prevents burst abuse but not sustained cost accumulation over a billing period. **Deferred to post-launch** - needs usage data to calibrate limits. | Open |
| 2 | Transaction wrapping for check-in submission | `app/api/check-in/submit/[token]/route.ts` | Token claiming + check-in creation + token update are separate queries, not wrapped in a Postgres transaction. If check-in creation fails after token claim, the token is consumed without a check-in being created. Add compensation logic to release the token on failure, or wrap in a Supabase RPC function for atomicity. | Open |
| 3 | Add structured logging | All API routes, services | All logging is `console.error`/`console.log` with unstructured messages. Adopt JSON-format structured logging with request IDs for better debugging and log aggregation in production. Currently relies on Sentry for error tracking but has no request tracing for non-error debugging. | Open |
| 4 | Monitor RLS query performance | `supabase/migrations/015_*.sql`, `supabase/migrations/044_*.sql`, `supabase/migrations/075_*.sql`, `supabase/migrations/077_*.sql` | Nested subquery RLS policies on `training_exercises`, `nutrition_plan_daily_targets`, `training_events`, and `nutrition_events` join through multiple tables (exercises -> sessions -> plans -> clients -> user_id). May degrade at scale. Set up query profiling to monitor these policies and consider denormalizing if latency increases. | Open |

### P1 - Observability & Error Handling

| # | Issue | File(s) | Details | Status |
|---|-------|---------|---------|--------|
| 1 | Background task errors not reported to Sentry | `app/api/check-in/submit/[token]/route.ts:244-251` | `markReminderAsResponded()` and `triggerAISummaryGeneration()` fire-and-forget with only `console.error` in `.catch()`. Failures are invisible in monitoring. Add `captureApiError()` calls in the catch handlers. | Open |
| 2 | No retry logic on OpenAI calls | `services/ai-service.ts:60-76` | Transient failures (timeouts, rate limits) cause permanent failure for check-in summaries. Add exponential backoff retry (2-3 attempts) for transient errors. | Open |

---

### P2 - Cleanup

| # | Issue | File(s) | Details | Status |
|---|-------|---------|---------|--------|
| 1 | Rate limiting uses IP only | `lib/rate-limit.ts:97-101` | `getClientIdentifier()` extracts IP from `x-forwarded-for` header. Does not incorporate authenticated user ID, so a single user behind a shared IP (office, VPN) shares quota with all other users on that IP, and an attacker can bypass limits by rotating IPs. Add authenticated user ID to the rate limit key when a session is available. | Open |
| 2 | In-memory rate limit fallback is per-process | `lib/rate-limit.ts:44-79` | When Redis is unavailable, rate limiting falls back to an in-memory `Map`. In multi-instance deployments (e.g., multiple Vercel serverless functions), each instance tracks limits independently, making the effective limit N times higher. Consider making Redis required in production. | Open |
| 3 | `check_in_tokens.client_id` column type mismatch | `supabase/migrations/002_create_check_in_tokens_table.sql` | `client_id` is defined as `TEXT` while all other ID columns in the schema use `UUID`. Type inconsistency, not a security issue, but may cause subtle query performance differences and prevents foreign key enforcement. | Open |

---

## Training Plan AI Generation

Reviewed: 2026-03-18

### P1 - Performance

| # | Issue | File(s) | Details | Status |
|---|-------|---------|---------|--------|
| 1 | `generateTrainingPlanAI` takes ~60s even with gpt-4o-mini | `services/training-ai-service.ts` | The full plan generation call takes ~60s despite switching from gpt-4o to gpt-4o-mini and stripping coaching notes from the output. Investigate: (a) Log input/output token counts to see how large the prompt is. (b) Could the plan be generated in stages (structure first, then exercises per session) with parallel calls? (c) Could we stream the response so the UI renders progressively? (d) Test if a simpler response format (JSON array vs nested object) reduces latency. | Open |

---

### P2 - Output Quality

| # | Issue | File(s) | Details | Status |
|---|-------|---------|---------|--------|
| 1 | AI produces poor day ordering for splits | `services/training-ai-service.ts` | The model doesn't produce sensible day ordering. E.g. push/pull/legs should alternate properly, not stack similar muscle groups on consecutive days. Options: (a) Add explicit day ordering rules to the prompt. (b) Let the AI generate sessions unordered, then apply ordering logic in application code based on the split type. (c) Let coaches drag to reorder days after generation. | Open |
| 2 | RPE and rest periods still lack variation | `services/training-ai-service.ts` | Despite adding prescriptive rest/RPE rules to the prompt, verify the model is actually producing varied rest periods (2-3min for compounds, 60-90s for isolation) and meaningful RPE targets rather than blanket values across all exercises. May need stronger prompt constraints or post-processing validation. | Open |

---

## Production Readiness Audit - Medium Priority

Reviewed: 2026-03-18

### M - Performance & Data Integrity

| # | Issue | File(s) | Details | Status |
|---|-------|---------|---------|--------|
| 1 | N+1 query on habit stats | `hooks/use-client-habits.ts:42-81` | Fetches stats per-habit via individual API calls (`Promise.all` of N fetches). 20 habits = 20 HTTP requests. Fix: add batch endpoint `/api/clients/{id}/habits/stats-batch`. | Open |
| 2 | N+1 query on daily log count enrichment | `services/check-in-service.ts:176-210` | `enrichWithDailyLogCounts()` runs one DB query per check-in period. Fix: single query with date range aggregation or GROUP BY. | Open |
| 3 | Missing indexes on frequently-queried foreign keys | `check_in_session_completions`, `check_in_exercise_highlights`, `check_in_external_activities`, `client_intake`, `nutrition_plan_daily_targets`, `nutrition_events`, `training_events` | FK columns used in WHERE clauses and JOINs lack composite indexes. Add `(client_id, created_at DESC)` composite on daily_logs and similar patterns on detail tables. The event tables are frequently queried by `(client_id, date)` — confirm that range is covered. | Open |
| 4 | Unbounded client list query | `app/api/clients/route.ts` | Lists all clients for coach with no LIMIT. Fine for <100 clients, problematic at scale. Add LIMIT + pagination. | Open |
| 5 | Daily logs need pagination for large date ranges | `app/api/client/daily-logs/route.ts`, `app/api/clients/[id]/daily-logs/route.ts` | Date range parameters have no pagination. Large historical queries could return thousands of rows. Add cursor-based or offset pagination for requests spanning large date ranges. | Open |
| 6 | Auth failures not logged for audit trail | `lib/auth-helpers.ts` | `getAuthenticatedCoachId()` and `getAuthenticatedClientId()` return null on auth failure without logging the attempt. Add structured logging with timestamp, route, and IP (not PII) for security auditing. | Open |
| 7 | Inconsistent error logging patterns | Various API routes | Some routes log raw `error` objects (`console.error("Error:", error)`) which could include stack traces and query details in Sentry. Standardize to `error instanceof Error ? error.message : "Unknown error"` pattern. | Open |

---

## Production Readiness Audit - Low Priority

Reviewed: 2026-03-18

### L - Nice to Have

| # | Issue | File(s) | Details | Status |
|---|-------|---------|---------|--------|
| 1 | No realtime updates for coach dashboard | N/A | Coach dashboard relies on SWR polling (30s interval). New check-ins from clients don't appear in real time. Consider Supabase realtime subscriptions for check-in notifications. | Open |
| 2 | Polling-based content notifications | `hooks/use-new-content-notifications.ts` | Uses localStorage + polling every 30s to detect new content. Not event-driven. Consider push notifications or realtime subscriptions. | Open |
| 3 | Some complex pages lack error boundaries | `components/check-in/check-in-form.tsx`, nutrition builder, training builder | High-complexity pages with multiple form steps are not wrapped in `<ErrorBoundary>`. A JS error in one section crashes the entire page. | Open |
| 4 | Check-in submission doesn't invalidate SWR caches | `app/api/check-in/submit/[token]/route.ts` | After client submits check-in, coach-side SWR caches for `/api/check-ins/unreviewed` stay stale until next polling interval (30s+). | Open |
| 5 | CSP script-src uses unsafe-eval and unsafe-inline | `next.config.mjs` | Current Content-Security-Policy allows `unsafe-eval` and `unsafe-inline` for scripts due to Next.js requirements. Tighten for production using nonce-based CSP (requires Next.js config changes). | Open |

---

## Schema Readiness - Planned Work

Reviewed: 2026-03-22

### Client Metrics Log Extraction

| # | Issue | File(s) | Details | Status |
|---|-------|---------|---------|--------|
| 1 | No body metrics history table | `clients` table | Create `client_metrics_log` table (client_id, date, source, weight, body_fat, bmr, tdee, measurements). Write to it from check-ins, intake sync, manual updates. Keep `current_*` columns on `clients` as denormalized cache. Currently biometrics are overwritten on the clients table with no history outside of check-in snapshots. | Open |

### Coach Exercise Library

| # | Issue | File(s) | Details | Status |
|---|-------|---------|---------|--------|
| 1 | No canonical exercise reference | `training_exercises.name` | Create `coach_exercises` table (coach_id, name, category, muscle_groups, equipment, notes, video_url). Add nullable `coach_exercise_id` FK to `training_exercises`. Currently exercises are free-text with no canonical reference, blocking cross-client analytics, templates, and progressive overload tracking. | Open |

### Type Safety Gaps from Schema Split

| # | Issue | File(s) | Details | Status |
|---|-------|---------|---------|--------|
| 1 | `as never` casts on view/new table queries | `services/daily-logs-service.ts`, `services/attention-feed-service.ts`, `services/training-history-service.ts`, `services/weekly-nutrition-service.ts`, `app/api/client/session-completions/route.ts`, wellness/nutrition history routes and summary routes | 8 locations use `as never` casts bypassing type safety on `.from()`, `.update()`, or `.upsert()` calls for the `daily_logs_full` view and new child tables. These should be replaced with proper type definitions once the generated types stabilize. | Open |
| 2 | `types/database.ts` is stale — missing `profiles` and `coaches` | `types/database.ts` (3055 lines), `contexts/auth-context.tsx:92,114-116,125,149,174` | The generated `Database` type does not include the `profiles` or `coaches` tables, forcing `as unknown as` and `as Record<string, unknown>` casts across auth-context (6 sites) to do anything with those tables. Combined with #1 (`as never` casts for post-split child tables), the root cause is one stale generation. Fix: `npx supabase gen types typescript --linked > types/database.ts`, then grep for `as never` / `as unknown as` in services and auth-context and drop the casts that become unnecessary. Not a file-size problem — generator output is expected to be large — but the staleness leaks type-safety holes into ~13 files. Duplicates Auth P2 #3; consolidated here because root cause is shared with #1. | Open |

### Check-in Training Completion Duplication

| # | Issue | File(s) | Details | Status |
|---|-------|---------|---------|--------|
| 1 | Parallel entry for training completions | `check_in_session_completions`, `session_logs` | `check_in_session_completions` should pre-populate from `session_logs` for the check-in period instead of being a parallel entry system. Currently clients can enter conflicting completion data between the daily flow and the check-in form. **Addressed by Session 6.4 of the client portal redesign**: daily logs become the source of truth for the check-in, the form locks fields for logged days, unlogged-day edits route through the canonical per-card write endpoints, and the table is dropped in the same migration. Mark Resolved once 6.4 commits. | Scheduled |

### Post-Phase-7 Column Retirement

The client portal redesign (Phase 1 Session 1.7) rewires the attention feed's training signals to read `training_events.status` directly. The legacy `training_logs.trained` column becomes dead data once Phase 7 (coach-side metrics + progression) ships and no reader remains.

| # | Issue | File(s) | Details | Status |
|---|-------|---------|---------|--------|
| 1 | Retire `training_logs.trained` column | `training_logs` table; `services/training-history-service.ts:45` (primary reader) | Once Phase 7 of the client portal redesign ships and `training_events.status` is the single source of truth for training completion, `training_logs.trained` has no consumers. Write a migration that (a) audits for any remaining readers via grep, (b) drops the column, (c) updates `types/database.ts`. Do NOT do this before Phase 7 completes — the attention feed rewire in Session 1.7 intentionally leaves the column in place for backward compat during the transition. | Open |

### Documentation Updates Needed

| # | Issue | File(s) | Details | Status |
|---|-------|---------|---------|--------|
| 1 | ~~CONVENTIONS.md daily_logs conventions outdated~~ | `docs/ARCHITECTURE.md` | Schema diagrams moved to `docs/ARCHITECTURE.md` with corrections applied (phase_id linkage, spine + child table architecture, training_data as UI restore cache). | Resolved |

---

## Pre-existing Test Failures

Reviewed: 2026-03-25. **Resolved as of 2026-04-23** — full `npx vitest run` passes (50 files, 683 tests). The entries below are preserved for historical context; all failures were addressed in earlier cleanup passes.

### Unimplemented Behavior (8 failures)

| # | Issue | File(s) | Details | Status |
|---|-------|---------|---------|--------|
| 1 | Tests expect sanitization logic that was never implemented | `ai-prompt-sanitizer.test.ts` | 8 tests expect `sanitizeForAIPrompt` to strip "Disregard", "Override", whitespace-prefixed injection patterns, and truncate at 500 chars. The implementation performs none of this. Tests were written for planned behavior. | Resolved |

### Stale Assertions After Refactors (12 failures)

| # | Issue | File(s) | Details | Status |
|---|-------|---------|---------|--------|
| 1 | Error message format mismatch | `client-service.test.ts` | 7 failures. Tests expect `"Failed to X: <db error>"` format but service throws `"Failed to X"` without appending the DB error. Tests also expect `getClientById` to return `null` for not-found but it throws, and expect `null` for empty string notes but service sends empty string. | Resolved |
| 2 | Color value assertions outdated | `check-in-utils.test.ts` | 4 failures. `getStatusColor` tests expect raw color names (`"yellow"`, `"blue"`, `"green"`, `"gray"`) but implementation returns semantic Tailwind classes (`"bg-warning/10 text-warning"`, etc.). Tests weren't updated after design token migration. | Resolved |
| 3 | Button variant class outdated | `button.test.tsx` | 1 failure. Expects `bg-white` class on secondary variant but component uses `bg-secondary`. Test wasn't updated after button styling change. | Resolved |
| 4 | Date-dependent test assertion | `attention-triggers.test.ts` | 1 failure. `evaluateTrainingMisses` test creates logs for today/yesterday and expects a trigger, but the function's week-window logic returns `null` depending on what day of the week the test runs. Test needs fixed date mocking. | Resolved |

### Incorrect Assumptions (3 failures)

| # | Issue | File(s) | Details | Status |
|---|-------|---------|---------|--------|
| 1 | Fallback mode assumption wrong | `rate-limit.test.ts` | 2 failures. Tests expect unlimited requests in fallback mode but in-memory rate limiter actually enforces limits. Tests assume fallback = no limit; implementation says fallback = still rate limited. | Resolved |
| 2 | Error exposure assumption wrong | `notifications/route.test.ts` | 1 failure. Expects raw DB error message in 500 response but route returns generic `"Failed to fetch notifications"`. Test expectation conflicts with the convention of not exposing internal errors to users. | Resolved |

---

## Training Plan Architecture

Reviewed: 2026-04-13

### ~~P2 - Rethink External Activities~~ (Resolved 2026-04-24)

Removed entirely in commits `37f6eaf..fadff55` (external-activities sprint, 7 commits). Features A (training-plan external activities: pre-generation activities, `session_type = 'external_activity'`, `activity_metadata`, `allowSameDayTraining` AI prompt flag, `check_in_external_activities` table) and B (daily external activities: `daily_external_activities` table + Daily Pulse write path) both gone. Coach calendar prescribes any session type as a regular training session now, as anticipated. Schema changes in migration `088_remove_external_activities.sql`. `IntensityLevel` relocated from `types/external-activity.ts` to `types/daily-pulse.ts` where it's still used by the in-JSONB unplanned-activity flow.

---

### Missing Mocks (2 suite failures)

Both suites now run cleanly; preserved for historical context.

| # | Issue | File(s) | Details | Status |
|---|-------|---------|---------|--------|
| 1 | Supabase client not mocked | `intake-review-service.test.ts` | Suite fails before any test runs. Imports `supabase-client.ts` which throws when `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are not set. Needs `vi.mock("@/services/supabase-client")` at the top. | Resolved |
| 2 | Supabase admin not mocked | `app/api/clients/[id]/roadmap/route.test.ts` | Suite fails before any test runs. Imports `supabase-admin.ts` which throws when `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are not set. Needs `vi.mock("@/services/supabase-admin")` at the top. | Resolved |

---

## Auth Architecture Hygiene (Shape-B hardening)

Reviewed: 2026-04-23

CoachHub runs in a backend-mediated shape (browser → Next.js API → Supabase). The primary security control is route-level auth + ownership checks (the IDOR chain); service functions accept `clientId` explicitly and use `supabaseAdmin` internally; RLS is defense-in-depth. This is a valid and common pattern for apps with a dedicated backend, multiple audiences, cross-user reads, and server-only integrations (OpenAI, Stripe, email).

The consequence: the route layer **is** the security perimeter. Gaps in route-level auth are not caught by a second line of defense. The items below close that perimeter. Bundle into a pre-launch hardening session after the client portal redesign ships - do NOT mix into redesign work, it muddies the diffs.

CONVENTIONS §8 is scheduled for rewrite to describe this pattern accurately (currently describes an aspirational RLS-first model that was never actually built).

### H1 - Pre-launch

| # | Issue | File(s) | Details | Status |
|---|-------|---------|---------|--------|
| 1 | Build `requireClientAuth()` helper | `lib/` (new), `app/api/client/**/route.ts` | `lib/require-coach-auth.ts` exists for coach routes; no client-side equivalent. Every client route rolls its own auth chain (rate limit → CSRF → `getAuthenticatedClientId` → 401 handling). Any route that forgets or reorders a step is a hole. A single shared helper returning `{ clientId }` or a typed error response eliminates drift. Duplicates "Authentication & Authorization P0 #3" — promoted here because it is Shape-B-critical. | Done |
| 2 | Audit every client-portal route for the §9 auth chain | `app/api/client/**/route.ts` | After H1 #1 ships, sweep every client route to confirm it uses the helper. No exceptions. A missing step in Shape B is the whole hole; there is no RLS safety net on admin-serviced reads. | Done |
| 3 | `invitation-service.ts` imports browser Supabase client | `services/invitation-service.ts:1` | Called from server-side routes but imports the browser client. In Shape A this would be caught by RLS because the browser client has no session server-side. In Shape B it means the route is authed, the service runs with no session, and nothing enforces scope. Direct bug. Duplicates "Authentication & Authorization P2 #7" — elevated priority due to Shape-B blast radius. | Done |
| 4 | Consolidate duplicate Supabase server-client factories | `lib/auth-helpers.ts:5-28`, `lib/supabase-server.ts:8-29`, `services/client-portal-service.ts:14-36` | `createSupabaseServerClient()` (private, auth-helpers), `createServerSupabaseClient()` (exported, supabase-server) and `createPortalClient()` (exported, client-portal-service) were three byte-identical factories with confusingly similar names. In Shape B session-scoped is rarely used; three variants across the codebase is a foot-gun. Collapsed: canonical body lives in `lib/supabase-server.ts`; `auth-helpers.ts` imports it; `client-portal-service.ts` re-exports it as `createPortalClient` so existing service callers don't churn. Duplicates "Authentication & Authorization P2 #1" — elevated because Shape-B ambiguity. | Done |
| 5 | Session-log writes accept client-supplied `trainingSessionId` without plan-ownership check | `services/client-portal-training.ts:markSessionComplete`, `app/api/client/session-completions/route.ts` POST | Both upsert a row into `session_logs` keyed on `(client_id, training_session_id)` with the `trainingSessionId` coming directly from the request body. Neither verifies that the session belongs to a training plan assigned to `clientId` (join: `training_sessions → training_plans.client_id`). Impact is self-pollution, not a cross-user data leak — the `client_id` on the log row is always the authed client, so no other client's data is touched — but the client can forge completion entries for arbitrary session UUIDs, polluting their own stats and activity feed. Surfaced during the H1 #2 route sweep. Fix: pre-flight join query in each service function (parallel to the `logHabit` ownership check added alongside the sweep). | Open |
| 6 | Client portal fetches a coach-facing endpoint (`/api/clients/[id]/activation-readiness`) | client-side caller TBD (grep `activation-readiness` under `components/`, `hooks/`, `app/client/`) | Network logs on client login show `GET /api/clients/[id]/activation-readiness 401`. That route is under `/api/clients/` (plural — coach-facing per CONVENTIONS §6). The 401 is the route defending correctly; the bug is that a client-portal component or SWR hook is calling a coach endpoint at all, violating the audience-split rule. Risk: low today (coach session check rejects the request), but if the route ever relaxes its auth shape, the client portal would start receiving data it shouldn't. The redesign (`docs/CLIENT-PORTAL-EXECUTION-PLAN.md`) rebuilds client screens from scratch and may retire the offending caller incidentally, but we should not rely on that — grep, find, remove. Surfaced during the H1 #2 sweep smoke test. | Open |

### H2 - Post-launch operational hygiene

| # | Issue | File(s) | Details | Status |
|---|-------|---------|---------|--------|
| 1 | Structured auth-failure logging | `lib/auth-helpers.ts` | `getAuthenticatedCoachId` and `getAuthenticatedClientId` return null on auth failure with no log. In Shape B these are security-relevant events; without an audit trail a probe campaign is invisible. Log timestamp, route, IP (not PII), reason (missing / invalid / expired). Duplicates "Production Readiness Medium #6". **Shipped for the client path** — `requireClientAuth` threads `request` into the helpers, so 29 client-portal routes now emit `auth_failure` warns with route + hashed IP (SHA-256 truncated). Coach path logs reason + timestamp but logs `route: "unknown"` and `ipHash: "unknown"` because the 72 coach-route call sites don't thread `request`. Follow-up: add an optional `request` arg pass-through at the coach call sites (low-priority mechanical change). | Partially done |
| 2 | Codify "services accept `clientId` explicitly" | `CONVENTIONS.md §8`, all `services/*.ts` | Most services follow this already but it is convention not rule. Make it a documented requirement: no service function reads client-owned data without a `clientId` parameter. Audit call sites to prove compliance. Addressed as part of the §8 rewrite. **Codified: §8 line 242 explicitly names the rule as written. Audited: 14 real violations + 4 borderline cases found, restructured fix tracked as H2 #3.** | Done (audited) |
| 3 | Fix §8 service-scoping violations surfaced by the H2 #2 audit | `services/check-in-service.ts`, `services/training-session-service.ts`, `services/training-exercise-service.ts`, `services/check-in-details-service.ts` | The H2 #2 audit found service functions that mutate or read client-scoped tables by primary key alone without accepting or filtering on `clientId`. In practice, the route layer catches IDOR today (coach routes use `requireCoachOwnsCheckIn` / `requireCoachOwnsClient`), but §8 treats service-layer scope as non-optional defense-in-depth. Violations: **`check-in-service.ts`** — `getCheckInById` (borderline, reads by id), `updateCheckInStatus` (L240), `updateCheckInAISummary` (L255), `updateCheckInResponse` (L288), `markResponseAsSent` (L307). **`training-session-service.ts`** — `updateSession` (L17), `addSession` (L86), `deleteSession` (L123), `replaceSessionExercises` (L138), `getSessionWithExercises` (L191), `updateSessionCalories` (L312), `cloneSessionForEvent` (L372). **`training-exercise-service.ts`** — `updateExercise` (L12), `addExercise` (L43), `deleteExercise` (L92). **`check-in-details-service.ts`** — `getCheckInSessionCompletions` (L21), `getCheckInExerciseHighlights` (L42), `getCheckInExternalActivities` (L60) (all borderline — query by `check_in_id` after caller has authorized the check-in). Fix pattern: add `clientId` parameter; training functions resolve scope via `training_plans.client_id` join; pre-flight ownership query + `.eq("client_id", clientId)` on the mutation. Route callers then pass the scope through. Not trivial — ~14 function signatures and their callers change. Keep routes' existing ownership guards in place; this is defense-in-depth, not a replacement. | Open |

### H3 - Philosophical cleanup (defer)

| # | Issue | File(s) | Details | Status |
|---|-------|---------|---------|--------|
| 1 | Simplify nested-subquery RLS policies | `supabase/migrations/015_*.sql`, `044_*.sql`, `075_*.sql`, `077_*.sql` | The 4-level subquery chains for training_exercises / nutrition_events / etc. exist because RLS was written assuming direct-to-Supabase access that never materialized. Under Shape B these policies don't run (service_role bypasses them) and carry only perf cost. Replace with simple `authenticated`-role policies, or remove entirely. Not a security issue — the app layer is the control. Defer; the migration effort outweighs the gain pre-launch. Duplicates "Production Readiness P1 #4". | Open |

---

## Training Builder & Content Library Bloat

Reviewed: 2026-04-23

These three files were identified in a codebase-wide bloat audit as genuinely painful to work in — not "long but cohesive," but files mixing multiple concerns where the next change is meaningfully harder because of the file's shape. CONVENTIONS.md §4 caps are loose guidelines, so these are the three that would be worth splitting even under a generous reading. Other long files found in the same audit (`training-calendar-view.tsx` 682, `training-event-calendar-service.ts` 571, `session-detail-drawer.tsx` 565, `content-upload-dialog.tsx` 532, `app/dashboard/content/page.tsx` 501) are long but cohesive — splitting them would prop-drill one flow across multiple files, which §4 itself warns against. Leave those alone.

### P1 - File Size Violations

| # | File | Lines | Limit | Over By | Status |
|---|------|-------|-------|---------|--------|
| 1 | `services/coach-library-service.ts` | 1211 | 300 | 911 (304%) | Open |
| 2 | `components/clients/training/builder/draft-editor.tsx` | 890 | 250 | 640 (256%) | Open |
| 3 | `services/content-service.ts` | 635 | 300 | 335 (112%) | Open |

**Suggested splits:**

1. **`services/coach-library-service.ts`** — Mixes three concerns on top of 8+ CRUD functions for saved plans, sessions, and standalone sessions: row-to-model mappers (~lines 21-42), insertion helpers (~144-185), and cycle-length detection (~106-140). Extract mappers to `lib/coach-mappers.ts` first — lowest-risk ~200 LOC win with zero coupling to the CRUD surface. Move cycle-length detection to `utils/plan-cycle-helpers.ts`. Then split remaining CRUD into `coach-saved-plan-service.ts` and `coach-saved-session-service.ts`. The three stages can land as three separate PRs.

2. **`components/clients/training/builder/draft-editor.tsx`** — 8 `useState` calls plus inline DnD sensors, form modal, fetch-based mutations, and promote/discard flow. The session mutation cluster (`patchSession`, `patchExercise`, `removeSession`, `removeExercise`) is a self-contained unit that lifts cleanly to a `useSessionMutations()` hook. DnD sensors + `DndContext` wiring lift to `useSessionDragDrop()`. Session form modal becomes `SessionFormDialog`. Target shape: render + promote/discard only, ~400 LOC.

3. **`services/content-service.ts`** — 20+ exports spanning five decoupled concerns: folders, items, assignments, metadata fetching (video/link), and S3 storage (upload/signed URLs). Unlike the training builder, these concerns are genuinely independent — a folder rename does not touch S3. Split into `content-folder-service.ts`, `content-item-service.ts`, `content-assignment-service.ts`, `content-metadata-service.ts`, `content-storage-service.ts`. No prop-drilling risk.
