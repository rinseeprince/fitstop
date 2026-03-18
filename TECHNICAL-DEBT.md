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
| 4 | Monitor RLS query performance | `supabase/migrations/015_*.sql`, `supabase/migrations/044_*.sql` | Nested subquery RLS policies on `training_exercises` and `nutrition_plan_daily_targets` join through multiple tables (exercises -> sessions -> plans -> clients -> user_id). May degrade at scale. Set up query profiling to monitor these policies and consider denormalizing if latency increases. | Open |

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
| 3 | Missing indexes on frequently-queried foreign keys | `check_in_session_completions`, `check_in_exercise_highlights`, `check_in_external_activities`, `client_intake`, `nutrition_plan_daily_targets` | FK columns used in WHERE clauses and JOINs lack composite indexes. Add `(client_id, created_at DESC)` composite on daily_logs and similar patterns on detail tables. | Open |
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
