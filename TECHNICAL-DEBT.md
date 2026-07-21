# Technical Debt Tracker

## Nutrition-calendar invalidation — uninstrumented caller-less routes

Logged: 2026-07-02 (class-wide SWR invalidation pass; see CONVENTIONS.md §7 "Nutrition calendar cache invalidation").

Four routes rewrite `nutrition_events` server-side but currently have **no web client caller**, so no success handler calls `useInvalidateNutritionCalendar`. If any of these gains a caller (web or RN), that caller MUST adopt the invalidator:

- `DELETE /api/clients/[id]/training/[planId]` (archive plan; cascades via `cascadeNutritionAfterTrainingChange`)
- `POST /api/clients/[id]/training/[planId]/regenerate-events`
- `PATCH /api/clients/[id]/training/[planId]/events/[eventId]` (per-event surplus; web UI routes surplus edits through the sessions endpoint instead)
- `PATCH /api/clients/[id]/nutrition/events/[date]/reset` (single-date reset; web UI uses the bulk `/events/reset`)

---

## Training builder week model — deferred tails (builder S2.5)

Logged: 2026-07-01.

- **`training_plans.frequency_per_week` CHECK (1..7) outlives the week model.** The column (migration 015) predates multi-week programs; a raw non-rest total across N weeks violates it at apply time. S2.5 clamps at derivation (`deriveCycleInfoFromSessions` / `recomputePlanCycleInfo` now store a per-week average clamped to 1..7) and defensively at the placement boundary (`library-placement-service.ts` `createTrainingPlanAtomic` call). **The CHECK is still live in migration 015 and both clamps must stay until it is dropped.** Its nominated owner (CPEP 7.10a, which also rewrites the per-week readers in `phase-transition-service.ts` + display labels) sits in the PARKED roadmap workstream with no date, and builder Phase 7 ships no migrations. Treat as indefinitely open — do not drop it piecemeal, and do not remove either clamp on the assumption it is gone.
---

## Training builder progression — pre-existing read cap (builder S4)

Logged: 2026-07-03.

- **`getClientTrainingPlan`'s `training_exercises` read is uncapped** (`services/client-training-plan-service.ts` ~L140-148: one `.in("session_id", sessionIds)` select with no `.range()` paging). PostgREST silently truncates at ~1000 rows, so a long multi-week program (e.g. 52 weeks × 5 sessions × 8 exercises ≈ 2000 rows) would silently drop the tail exercises from the client plan view. Same class as the exercise-catalog cap fixed in `c0020a4` — page with a range loop keyed on the ordered columns. Pre-existing before S4, but duplicate-week progression makes long programs materially likelier.

---

## Training builder standalone sessions — deferred tails (builder S3)

Logged: 2026-07-02.

- **`PATCH`/`DELETE /api/training/saved-sessions/[savedSessionId]` are not standalone-scoped.** `updateSavedSession`/`removeSavedSession` filter only `.eq(id).eq(coach_id)` (`services/coach-saved-session-service.ts`) because the same functions back the plan-attached `saved-plans/[savedPlanId]/sessions/[sessionId]` routes — so the nominally-standalone route can mutate/delete plan-attached sessions too (same-coach only; no cross-tenant exposure). Harmless today (no UI caller PATCHes standalone sessions; the only DELETE caller is the builder library panel's session list, fed by `GET /api/training/saved-sessions`, which returns standalone rows only — the S4.5 Sessions page that previously owned this is now a redirect stub). `updateSavedSession`/`removeSavedSession` now back exactly one route each, so they can be scoped with `.is("saved_plan_id", null)` without breaking another caller, but scope the standalone route with `.is("saved_plan_id", null)` — via a scoped service variant, not by breaking the shared plan-attached callers — before any new caller appears. The S3 overwrite endpoint (`.../overwrite`) is correctly scoped already.

---

## Exercise columns with no authoring path — `superset_group` / `is_warmup`

- **`superset_group` has zero readers.** Every reference is serialize/map/write plumbing; nothing renders it. It round-trips through the columns and drafts and is displayed nowhere.
- **`is_warmup` is read and written, but not from the program builder.** Four live render branches (`components/client-portal/training/exercise-tracker-block.tsx`, `components/clients/training/sessions/training-exercise-row.tsx`) and one live writer: the checkbox in `components/clients/training/sessions/add-exercise-dialog.tsx`, reachable from the calendar's `session-detail-drawer.tsx`. In the program builder a warm-up is a per-set `set_type` inside `set_specs` instead.
- **Why neither is dropped:** removing either column needs a migration plus a data audit ("does anything readable still carry a non-default value?"), and `is_warmup` additionally needs its authoring surface and render branches retired first.
- **Rule until then:** keep splatting both fields at every clone/insert site — a write path that drops them silently rewrites existing prescriptions. Add no new UI for either.

---

## Dead-but-undeletable fallback — `getClientTrainingPlan` path B

Logged: 2026-07-21 (Phase 7 sweep).

- **`services/client-training-plan-service.ts` (~191-235) splices synthetic rest entries** from the library template's `cycle_length`/`rest_pattern`. It runs only when path A does not trigger (no entry has `isRest` or `weekIndex > 0`) AND `saved_plan_id` is set AND the template carries both metadata columns.
- **It is reachable, not dead** — an adversarial verification pass during the S7 sweep specifically refuted the "unreachable post-121" assumption. A clean single-week, all-training program (no rest days, `weekIndex` 0) placed via `type:"plan"` lands here. The spliced result is equivalent to the flat path in that case, so the effect is benign, but **do not delete it as unreachable** and do not "simplify" the three-path read.
- It is the **last reader of `training_plans.saved_plan_id`**. Removing it is a data question, not a code question: it needs an audit that no live `training_plans` row predates migration 121 with rest-bearing template metadata.

---

## Draft assistant — untriaged review-fleet findings (builder S6a)

Logged: 2026-07-21 (Phase 7 sweep). Source: the 6a pre-commit adversarial fleet — 63 findings, 28 survived verification; the 4 HIGH + 6 MEDIUM were fixed in `56464f5`. **~18 LOW/unverified were never triaged** and live only in a workflow journal, which is not a durable location. Named here so the path doesn't rot.

| # | Issue | File(s) | Details | Status |
|---|-------|---------|---------|--------|
| 1 | No runtime validation of tool inputs | `services/assistant/draft-*-tools.ts` | `betaTool`'s `parse` is a passthrough — the JSON schema is advisory to the model, not enforced at execution. The only real guard is the client-side zod belt, which runs AFTER the server has mutated its workspace and narrated the turn, so a malformed input voids the whole turn instead of failing at the tool. Add per-tool zod parsing in the executor bodies — **which must stay synchronous** (see the sync-executor constraint below). | Open |
| 2 | Truncated tool call can execute on partial input | `services/assistant/draft-agent-service.ts` | `max_tokens: 16000`; a `tool_use` block cut off mid-JSON can reach an executor with a partial argument object. With #1 unfixed nothing rejects it. Check `stop_reason === "max_tokens"` before running a response's tools. | Open |
| 3 | Transcript history is not `asUntrusted`-fenced | `services/assistant/draft-agent-service.ts` | Only the live `command` is fenced. Prior turns replayed from the client-supplied transcript (≤24 × ≤4000 chars) enter the prompt unfenced, so an injection payload only has to survive one round trip to become unfenced context. | Open |
| 4 | Missing IP burst guard on the assistant route | `app/api/training/assistant/route.ts` | Unlike the client-portal two-tier pattern, this route has no IP-keyed first tier — only the post-auth coach-keyed `assistantRateLimit`. Documented as a deviation in CONVENTIONS §9; logged here so it is not mistaken for an endorsed pattern. | Open |
| 5 | Remaining ~15 LOW/unverified findings not read out | workflow journal | Read the journal, triage into this table or discard with a reason, before it is pruned. | Open |
| 6 | Owed verification from 6a | — | Live browser smoke of both assistant dock mounts, and `usage.cache_read_input_tokens` confirmed non-zero against the real API. Also still owed from earlier phases: manual smoke of 2.5-apply-to-client, 2.75, S3, and the full-screen client-draft apply. | Open |

**Two silent-failure constraints — do not "tidy" these:**
1. **Prompt-cache floor.** The cacheable tools+system prefix must stay above the model's cache minimum (4096 tokens on Opus 4.8). Below it the API caches nothing with **no error** — cost rises and no test fails. `services/assistant/prompt-size.test.ts` guards the size; the telemetry's `cacheEngaged` flag is the live check. Shortening the system prompt is a cost regression nothing will announce.
2. **Tool executors must stay synchronous.** The SDK runs a response's tool calls through `Promise.all` and the prompt encourages batching; that is safe only because a sync body gives the event loop no interleave point while mutating the shared workspace. Adding an `await` inside any tool `run` lets batched calls clobber each other. This is currently unreachable because the assistant never reads the DB (the catalog is preloaded once per turn) — a future tool needing a DB read must either serialize tool execution first or preload its data the same way.

---

## Deployment prerequisite — assistant route needs a >240s function timeout

Logged: 2026-07-21 (Phase 7 sweep). **Not debt so much as an undeclared requirement.**

- `app/api/training/assistant/route.ts` exports `maxDuration = 300`, deliberately above the SDK client's 240s timeout so a long turn fails as a handled SDK timeout rather than an opaque platform kill. **There is no `vercel.json` and no `.vercel/` in the repo**, so nothing declares this to a host.
- Any platform capping functions below 300s (Vercel Hobby is 60s) will kill long turns mid-flight; to the coach it presents as "the assistant is broken", not as a timeout. Raising either number means raising both.
- **This has never been exercised against a real platform ceiling** — the longest recorded turn (~5 minutes, from the 6a record) ran locally. Add a `vercel.json` when a deploy target is chosen, so the requirement is version-controlled rather than tribal.

---

## `savePlanFromCalendar` flattens multi-week programs

Logged: 2026-07-21 (Phase 7 sweep). Behavior bug, observed not fixed (S7 was docs + deletions only).

- `services/coach-library-calendar-service.ts` hardcodes `is_rest: false` on every copied session and writes no `week_index`. Saving a placed multi-week program back to the library therefore **flattens it into one week and turns rest rows into ordinary sessions named "Rest"** — which then place as training days on the next apply.

---

## `SET_TYPE_OPTIONS` is not in `utils/set-spec-edits.ts`

Logged: 2026-07-21 (Phase 7 sweep). A trap for whoever collapses the re-exports.

- The exec plan asks a future session to collapse `use-set-spec-mutations.ts`'s re-exports onto direct `utils/set-spec-edits` imports at the call sites. **`SET_TYPE_OPTIONS` is defined in `use-set-spec-mutations.ts` and does not exist in `utils/set-spec-edits.ts`** (it is UI label data, not edit logic), so a blanket find-and-replace fails `tsc`. S7 removed the one genuinely unused re-export (`MAX_DROPS`) and left the rest.

---

## Events-as-SOT overhaul — test coverage gap

- **`create_training_plan_atomic` (mig 114) real-effect coverage.** Session 2◆1 rewrote the RPC to be additive (window-bounded delete + provenance insert). The vitest suite mocks `supabaseAdmin`, so the RPC's actual DELETE/INSERT — window-bound, coexistence of disjoint plans, idempotent re-place, overlap "incoming wins" — has **no automated coverage**. Correctness currently rests on the manual smoke (place A Jan + B Mar disjoint → both survive; place B overlapping A → B wins contested, A's pre-overlap survives; re-place same range → event count stable). **Owe a focused local-supabase RPC test no later than Session 5** (where seed/backfill already needs DB-level validation). Same gap applies to `getNextPlanStartCap`'s cross-plan cap. Decided 2026-06-18 (no pgTAP/Postgres infra before launch — consistent with the mock-everything architecture + deferred-tooling stance).

---

## Pre-launch Security Checklist (from 2026-06-10 audit)

Items deliberately deferred or remaining after the 2026-06-10 security remediation pass (migrations 105–108 + code fixes — see "Known RLS Gaps"). Address before public launch.

- **Invite-accept email match (deferred by owner — intentional).** `acceptInvitationByToken` (`services/invitation-service.ts`) does NOT verify `user.email === invitation.email`, and `POST /api/invitations/accept` (token branch) trusts a body-supplied `userId`. Retained on purpose so fake-email variants can be run through onboarding while Resend is limited to a single verified address pre-domain-registration. **Re-enable** the email check (mirror the legacy `clientId` branch's `getUserById` + email compare, or derive the principal from the server session) once the sending domain is verified. Until then, possession of a valid invite token + a self-signup lets an attacker bind the client record to an account under their own email.
- **`captureApiError` coverage (~9/144 routes).** Most handled route errors never reach Sentry. Finish via planned sessions 9.3 / 9.9 rather than a separate sweep.
- **Dependency follow-ups (transitive, non-production-hot-path).** The `next` bump to 16.2.9 cleared the SSRF (8.6) + middleware/route-param bypass highs. `npm audit` still reports: dev-only `vitest`/`@vitest/coverage-v8` (critical — UI server arbitrary file read/exec), `vite`/`fast-uri`/`picomatch`/`ws`/`brace-expansion` (build/test tooling), and `uuid`/`postcss`(bundled under `next`)/`svix` moderates via `resend` + `@sentry`. Run `npm audit fix` opportunistically and re-bump after the next `next`/`resend`/`@sentry` releases.
- **CSP nonces.** `script-src` still uses `'unsafe-inline' 'unsafe-eval'` (Next.js requirement). Move to nonce-based CSP for production (Production Readiness L #5). `base-uri`/`form-action` were added 2026-06-10.
- **Upload content sniffing depth.** Magic-byte checks were added for images + PDF (`lib/upload-validation.ts`); office docs (docx/xls) and plain text are gated by the MIME allowlist only (no reliable magic number). Add a dedicated content-type library if richer formats are accepted later.
- **Backups / restore + uptime alerting.** Supabase-managed; confirm PITR/backup retention and add external uptime + alerting beyond Sentry error capture. (Infra, not code.)
- **Still open in Auth P0:** account-level lockout (#8) and email verification (#7, blocked on production domain).

---

## Authentication & Authorization

Reviewed: 2026-03-12

### P0 - Security

| # | Issue | File(s) | Details | Status |
|---|-------|---------|---------|--------|
| 1 | Middleware uses `getSession()` instead of `getUser()` | `middleware.ts:49,90` | `getSession()` reads the JWT from cookies without server-side validation. Supabase docs recommend `getUser()` for security-sensitive route protection as it validates the token server-side. A tampered/expired JWT could pass middleware checks. Violates §1, §9. | Done |
| 2 | Dangerous default role fallback | `middleware.ts:106` | `const role = profile?.role \|\| "trainer"` - if profile fetch fails (DB error, network issue), user silently gets trainer-level access. Should deny access instead. Violates §3, §9. | Done |
| 3 | No `requireClientAuth` guard | `lib/require-coach-auth.ts` | Coach routes have a shared `requireCoachAuth()` guard but no equivalent exists for client routes. Each client route implements its own auth check, risking inconsistency. Violates §2 "No duplicate logic". | Open |
| 4 | Auth callback route missing rate limiting | `app/auth/callback/route.ts` | The OAuth callback endpoint has no rate limiting. All other auth-related routes are properly rate-limited. Violates §9 "Rate limiting: MANDATORY". | Done (apiRateLimit added, security pass 2026-06-10) |
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
| 5 | Deprecated `acceptInvitation` still called | `app/auth/callback/route.ts`, `services/invitation-service.ts:364` | The unauthenticated `/auth/callback` caller (an account-takeover vector — it linked a URL-supplied `clientId` to the session with no checks) was **removed** in the 2026-06-10 security pass. `acceptInvitation` now has only ONE caller: the legacy `clientId` branch of `POST /api/invitations/accept`, which verifies `invitedUser.email === invitation.email` first. Remaining work is purely cosmetic (delete the deprecated fn + legacy branch). | Partially resolved (takeover path removed) |
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
| 5 | Duplicated row-to-model mapping | `services/daily-logs-service.ts` | Identical snake_case-to-camelCase mapping repeated 3 times. Extract a `mapRowToDailyLog(row: DailyLogRow): DailyLog` helper. **RESOLVED 2026-05-21 (Session 3.1)** — the duplication was already collapsed into one mapper; renamed it to the exported `mapRowToDailyLog` and added a direct unit test. | Resolved |
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

> ⚠️ **Threat-model correction (2026-06-10).** "RLS is only defense-in-depth because service_role bypasses it" is true for the *app*, but NOT a reason to tolerate permissive policies. The public anon key ships in the browser and a logged-in user holds an `authenticated` JWT, so anyone can call PostgREST (`/rest/v1/...`) **directly**, bypassing the route layer. For any object reachable that way, RLS is the *only* perimeter. The security pass below was a direct consequence.

- **`daily_logs`** - Done. RLS enabled in migration 051. All 8 code paths confirmed to use supabaseAdmin (bypasses RLS). Policies added for defense-in-depth.
- **`check_ins`** - Hardened 2026-06-10 (migration **105**). The earlier "Done" note was WRONG: migration 050 enabled RLS but left the permissive `"Authenticated users can view/update check-ins"` policies from migration 003 in place, so any authenticated user could read/update EVERY tenant's health data via the anon-key PostgREST endpoint. Migration 105 drops those; only the client-scoped policies from 026 remain. Coaches read/respond via service_role.
- **`check_in_tokens`** - Hardened 2026-06-10 (migration **105**). The permissive `"Authenticated users can view tokens"` policy (migration 003) was never dropped — any authenticated user could harvest other clients' magic-link tokens. Dropped in 105; the table is now service_role-only (deny-all otherwise).
- **`SECURITY DEFINER` atomic RPCs** - Hardened 2026-06-10 (migration **106**). `upsert_daily_log_atomic`, `create_nutrition_plan_atomic`, `create_training_plan_atomic`, `transition_phase_atomic`, `archive_roadmap_atomic` retained Postgres' default `PUBLIC` execute and took caller-supplied ids with no internal authz → cross-tenant writes via `/rest/v1/rpc/`. 106 REVOKEs PUBLIC/anon/authenticated, GRANTs service_role only, and pins `search_path`.
- **`training_events`, `exercises`, `coach_saved_plans`, `coach_saved_sessions`, `coach_saved_exercises`** - Hardened 2026-07-21 (migration **122**). All five were created with **no `ENABLE ROW LEVEL SECURITY` and no policies** (075:4, 083:5, 084:6/27/46) and stayed that way for 47 migrations. Verified live before the fix: the browser-shipped anon key, with **no login**, returned 540 / 1597 / 28 / 164 / 275 rows. RLS now enabled with zero policies (deny-all); all access is service_role. `GRANT ALL … TO anon` is deliberately left in place — RLS covers everything PostgREST exposes; the residual is `TRUNCATE` (not subject to RLS) and introspection, neither REST-reachable.
- **`attention_dismissals`, `coach_client_views`** - Hardened 2026-07-21 (migration **125**). Both carried `FOR ALL TO authenticated USING (true) WITH CHECK (true)` — created *after* migration 105 had already established why that shape is wrong, because `CONVENTIONS.md` still prescribed it. Now deny-all.
- **`storage.objects` (progress-photos bucket)** - Hardened 2026-07-21 (migration **126**). Two policies existed **only as Studio drift, in no migration**, both with no `TO` clause (→ PUBLIC → anon). Verified live: an unauthenticated caller listed the private bucket, downloaded a real photo (HTTP 200, 60,696 bytes), and created an object. A source-only audit could not have found these.
- **How to check this list is still true:** `npm run check:rls`. It reads the live catalog (not the migration tree) and asserts RLS on every public table, no trivially-true policy for `authenticated`, no anon-reachable policy whose qual ignores the caller, and `security_invoker` on every view. The tree is not trustworthy here — see the two drift incidents recorded below.

### Opened by the 2026-07-21 database audit (not yet fixed)

- **Studio drift is real and it defeats `DROP POLICY IF EXISTS`.** Twice in one workstream the live catalog disagreed with the tree: `daily_logs_full` was already `security_invoker` in prod though no migration said so, and the content-library client storage policy had been recreated under the text of migration 029's *comment* line (`"Clients can view files from their coach"`) rather than its `CREATE POLICY` name (`"Clients can view their coach's content"`). Migration 125 dropped the source name and **silently did nothing** — a successful push does not mean a policy was removed. **Always verify a policy drop against a fresh `supabase db dump`, never against the push exiting 0.**
- **Six dead coach policies on `storage.objects`** (029:297-331 plus drifted Studio duplicates under a second naming scheme). Unused — there are zero non-admin `.storage` calls in the repo; both buckets are reached only via `services/content-storage-service.ts` and `services/storage-service.ts`, both on `supabaseAdmin`. Deliberately left in place by migration 126 rather than bundling hygiene into a security push. Safe to drop in a cleanup sweep.
- **Edge cache outlives RLS.** Storage uploads set `cacheControl: "3600"` (`services/storage-service.ts`, `services/content-storage-service.ts`) and the CDN serves objects `cache-control: public, max-age=3600` keyed on path. Any private object fetched while a policy was open stays retrievable from the edge for up to an hour **after** the policy is fixed — observed directly when validating migration 126 (`cf-cache-status: HIT` on an object whose authorization had already been revoked; a cache-busted request correctly returned 400). RLS is therefore not the whole control for storage. Consider a shorter TTL or `private` cache-control on the private buckets.
- **Attention feed `.in(clientIds)` request-line ceiling.** Paging (fixed 2026-07-21) does not address this: the feed inlines every client id into five `.in()` filters, ~37 B/UUID, so the request line grows past gateway limits on a large roster and the feed fails outright. Needs a server-side aggregate (RPC), not paging.
- **`CREATE INDEX CONCURRENTLY` is unreachable from a migration file** — see the runbook in `docs/ARCHITECTURE.md`. Zero of 116 index builds use it. Harmless so far because each index was created in the same migration as its (empty) table, but any index retro-fitted onto `set_logs` / `training_exercises` / `exercise_logs` once they pass ~1M rows is a full write outage of that table for the duration of the build.
- **RPC surface not re-verified against the live catalog.** The audit's grant/overload conclusions (§3) are all reasoned from migration order; live `pg_proc.proacl` / `proconfig` were never read, and the two orphaned `upsert_daily_log_atomic` overloads (6-arg 057:7, 8-arg 059:18 — zero callers, both BYPASSRLS) are still presumed present. `npm run check:rls` does **not** cover functions.

---

## Production Readiness

Reviewed: 2026-03-18

### P1 - Infrastructure

| # | Issue | File(s) | Details | Status |
|---|-------|---------|---------|--------|
| 1 | **Per-coach AI spend quota — PRIMARY unbuilt cost control** | `app/api/training/assistant/route.ts`, `services/assistant/draft-agent-service.ts`, `services/ai-service.ts` | The draft assistant bills **per coach message**: a tool loop up to 30 iterations x 16000 max_tokens, model set by the `ASSISTANT_MODEL` env knob (default `claude-opus-4-8`). Owner measurement puts a working coach at **~$6/month on Haiku 4.5 vs ~$30 on Opus 4.8**. Because the tier is an env var, the quota — not the model choice — is what makes that number bounded rather than estimated. What exists: `assistantRateLimit` (20 req / 5 min, coach-keyed — burst control, not spend) and per-turn telemetry already logging iterations, token counts, `cacheEngaged` and `estimatedUsd`. What is missing: persisting that telemetry per coach + a daily/monthly USD ceiling enforced before the loop starts. Build on the existing `estimatedUsd` — no new measurement needed. Was deferred post-launch pending calibration data; **the telemetry IS the calibration data**. Raised from deferred by builder S6a/S7 (2026-07-21). The two OpenAI files it originally named are deleted. | Open — do first |
| 2 | Transaction wrapping for check-in submission | `app/api/check-in/submit/[token]/route.ts` | Token claiming + check-in creation + token update are separate queries, not wrapped in a Postgres transaction. If check-in creation fails after token claim, the token is consumed without a check-in being created. Add compensation logic to release the token on failure, or wrap in a Supabase RPC function for atomicity. | Open |
| 3 | Add structured logging | All API routes, services | All logging is `console.error`/`console.log` with unstructured messages. Adopt JSON-format structured logging with request IDs for better debugging and log aggregation in production. Currently relies on Sentry for error tracking but has no request tracing for non-error debugging. | Open |
| 4 | Monitor RLS query performance | `supabase/migrations/015_*.sql`, `supabase/migrations/044_*.sql`, `supabase/migrations/077_*.sql` | Nested subquery RLS policies on `training_exercises`, `nutrition_plan_daily_targets` and `nutrition_events` join through multiple tables (exercises -> sessions -> plans -> clients -> user_id). May degrade at scale. Set up query profiling to monitor these policies and consider denormalizing if latency increases. **Corrected 2026-07-21:** this entry previously also named `075_*.sql` / `training_events`. That was false — migration 075 is 27 lines (CREATE TABLE + 3 CREATE INDEX) and defined **no** RLS and **no** policies, so there was nothing to profile. `training_events` now has RLS with zero policies (deny-all, migration 122), which also has no measurable RLS cost. The genuinely expensive policies this entry never named are on `set_logs` (090), `exercise_logs` and `session_logs` (055). | Open |

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
| 1 | `as never` casts on view/new table queries | `services/daily-logs-service.ts`, `services/attention-feed-service.ts`, `services/training-history-service.ts`, `services/weekly-nutrition-service.ts`, `app/api/client/session-completions/route.ts`, wellness/nutrition history routes and summary routes | 8 locations use `as never` casts bypassing type safety on `.from()`, `.update()`, or `.upsert()` calls for the `daily_logs_full` view and new child tables. These should be replaced with proper type definitions once the generated types stabilize. **RESOLVED 2026-05-21 (Session 3.1)** — the view + child tables are already in the generated types; removed every `as never` on `daily_logs_full`/`nutrition_logs`/`wellness_logs`/`training_logs` reads across these files plus `schedule-data-service.ts`. Unrelated `as never` casts (the stale `profiles`/`coaches`/`client_intake` types in #2, and the `create_*_atomic`/`transition_phase_atomic` RPCs) are out of scope and remain. | Resolved |
| 2 | `types/database.ts` is stale — missing `profiles` and `coaches` | `types/database.ts` (3055 lines), `contexts/auth-context.tsx:92,114-116,125,149,174` | The generated `Database` type does not include the `profiles` or `coaches` tables, forcing `as unknown as` and `as Record<string, unknown>` casts across auth-context (6 sites) to do anything with those tables. Combined with #1 (`as never` casts for post-split child tables), the root cause is one stale generation. Fix: `npx supabase gen types typescript --linked > types/database.ts`, then grep for `as never` / `as unknown as` in services and auth-context and drop the casts that become unnecessary. Not a file-size problem — generator output is expected to be large — but the staleness leaks type-safety holes into ~13 files. Duplicates Auth P2 #3; consolidated here because root cause is shared with #1. | Open |

### Check-in Training Completion Duplication

| # | Issue | File(s) | Details | Status |
|---|-------|---------|---------|--------|
| 1 | Parallel entry for training completions | `check_in_session_completions`, `session_logs` | `check_in_session_completions` should pre-populate from `session_logs` for the check-in period instead of being a parallel entry system. Currently clients can enter conflicting completion data between the daily flow and the check-in form. **Addressed by Session 6.4 of the client portal redesign**: daily logs become the source of truth for the check-in, the form locks fields for logged days, unlogged-day edits route through the canonical per-card write endpoints, and the table is dropped in the same migration. Mark Resolved once 6.4 commits. | Scheduled |

### Post-Phase-7 Column Retirement

> **"Phase 7" here means CLIENT-PORTAL Phase 7 (`docs/CLIENT-PORTAL-EXECUTION-PLAN.md`), NOT the Training Builder Phase 7 that shipped 2026-07-21.** They are different workstreams. The training-builder sweep does not unblock this entry, and `training_logs.trained` still has two live readers — do not drop it on the strength of the builder phase completing.

The client portal redesign (Phase 1 Session 1.7) rewires the attention feed's training signals to read `training_events.status` directly. The legacy `training_logs.trained` column becomes dead data once Phase 7 (coach-side metrics + progression) ships and no reader remains.

| # | Issue | File(s) | Details | Status |
|---|-------|---------|---------|--------|
| 1 | Retire `training_logs.trained` column | `training_logs` table; remaining readers: `services/schedule-data-service.ts:113`, `utils/daily-logs-aggregation.ts:65` | Once Phase 7 of the client portal redesign ships and `training_events.status` is the single source of truth for training completion, `training_logs.trained` has no consumers. Write a migration that (a) audits for any remaining readers via grep, (b) drops the column, (c) updates `types/database.ts`. Do NOT do this before Phase 7 completes — the attention feed rewire in Session 1.7 intentionally leaves the column in place for backward compat during the transition. **Update 2026-05-22:** the former primary reader `services/training-history-service.ts` was **deleted** when the coach training-history route unified on the event path (roadmaps are opt-in). Two readers remain, both on the `daily_logs`/spine side. | Open |

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
| 4 | Route handlers calling `supabaseAdmin` directly instead of going through services | `app/api/**/route.ts` (36 files) | Audit on 2026-05-01: 36 of 131 route files contain `await supabaseAdmin.from(...)` inside the handler instead of delegating to a service function. Worst offenders by raw count: `clients/[id]/nutrition/route.ts` (5), `clients/[id]/nutrition/skew/route.ts` (5), `clients/[id]/metrics/route.ts` (4), `client/phase-completion/route.ts` (4), `clients/[id]/history/wellness/route.ts` (3), `client/session-completions/route.ts` (3, will be retired by event-keyed log path in Sessions 1.2/1.3). Most violations are 1-2 ad-hoc queries the developer didn't bother factoring (e.g., a 6-line next-future-plan lookup inline in `clients/[id]/training/route.ts` — additive placement has no `planned` status, so it selects the next plan whose `effective_from` is after today). A few are deliberate exceptions and self-document with a comment (e.g., `clients/[id]/training/period-stats/route.ts:33` — `// Uses supabaseAdmin: coach querying client data (RLS exception 2)`). **Risk**: low security blast radius — every offending route still runs the full §9 auth chain before the direct query, so this is a layering smell, not a hole. The cost is maintenance friction: changing how a table is read/written requires grepping the route layer too, not just the service layer. **Fix pattern (lazy migration, not a sweep)**: next time a route in this list is edited for any reason, factor its direct queries into a service function; routes that have a legitimate reason to keep the direct call (e.g., aggregate count queries that don't fit any existing service's responsibility) get a one-line `// Uses supabaseAdmin: <reason>` comment matching the existing pattern. Don't do a 36-file refactor PR — diffs become unreviewable and the cleanup risks regressions in routes nobody is actively touching. Track convergence by re-running `grep -rln "await supabaseAdmin" app/api/ \| grep -v ".test.ts" \| wc -l` quarterly; expect the number to drift toward ~5 (legitimate exceptions) over a year of normal feature work. | Open |
| 5 | Circular import: `client-portal-service` ↔ `client-portal-training` | `services/client-portal-service.ts`, `services/client-portal-training.ts` | Resolved 2026-05-01. `client-portal-service.ts` imported `getClientTrainingPlan` from `./client-portal-training`, while `client-portal-training.ts` imported the re-exported `createPortalClient` from `./client-portal-service`. JS handles circular imports by returning a partial module at load time, but this can break in subtle ways during initialization. Fix: changed `client-portal-training.ts` to import `createServerSupabaseClient` directly from `@/lib/supabase-server` (aliased to `createPortalClient` so call sites are unchanged). Cycle gone; no behavior change. Surfaced during the 2026-05-01 structural audit. | Done |
| 6 | `getClientNutritionTargets` couples a read to a write + uses session-scoped Supabase | `services/client-portal-service.ts:59-137`, callers including `app/api/client/nutrition/route.ts`, `app/api/client/nutrition-plan/route.ts` (Session 2.9) | Two related smells in one function. **Smell 1 — ✅ RESOLVED (events-SOT S3):** `promoteNutritionPlanIfReady` was **deleted** (nutrition is now one durable plan per client — no planned→active promotion), so `getClientNutritionTargets` no longer couples a write into a `get*`. The read-vs-write coupling is gone. **Smell 2**: the function uses `createPortalClient` (session-scoped, RLS-bound) where CONVENTIONS §8 calls `supabaseAdmin` the default for services. Functionally identical for the access pattern in normal flow (both apply `.eq("client_id", clientId)` against a `requireClientAuth`-verified id; RLS is belt-and-suspenders), but legacy by convention. **Fix pattern (Smell 2 only — Smell 1 no longer applies)**: switch `getClientNutritionTargets` from `createPortalClient` (session-scoped) to `supabaseAdmin` (the §8 service default). The old "split into `WithPromote` / `ReadOnly` orchestrators" plan is moot now that the promotion write is gone. No security delta under Shape B (both filter `.eq("client_id", clientId)` against a `requireClientAuth`-verified id); tackle when the service is next touched. | Partially resolved (Smell 1 gone; Smell 2 open) |

### H3 - Philosophical cleanup (defer)

| # | Issue | File(s) | Details | Status |
|---|-------|---------|---------|--------|
| 1 | Simplify nested-subquery RLS policies | `supabase/migrations/015_*.sql`, `044_*.sql`, `077_*.sql` | The 4-level subquery chains for training_exercises / nutrition_events / etc. exist because RLS was written assuming direct-to-Supabase access that never materialized. Under Shape B these policies don't run (service_role bypasses them) and carry only perf cost. **⚠️ Rewritten 2026-07-21 — the previous version of this entry was actively dangerous and must not be restored.** It (a) named `075_*.sql` / `training_events` as carrying nested-subquery policies when that table had **no RLS at all** — the exact property whose absence was the top finding of the 2026-07-21 database audit; (b) prescribed *"Replace with simple `authenticated`-role policies"*, which would convert these tables into a platform-wide cross-tenant read, precisely the bug migration 105 was written to fix and that 091/101 reintroduced; and (c) asserted *"Not a security issue — the app layer is the control"*, which is false at the PostgREST layer, as the threat-model correction at the top of "Known RLS Gaps" already states. **If simplifying, collapse the client-side and coach-side policies into ONE correctly-scoped policy per table** (one qual, no top-level OR, so the sublink can pull up to a semi-join) — never an `authenticated`-allow policy. Defer; the migration effort outweighs the gain pre-launch. Duplicates "Production Readiness P1 #4". | Open |

---

## Design System & Color Tokens

Reviewed: 2026-05-12

### P2 - Code Quality

| # | Issue | File(s) | Details | Status |
|---|-------|---------|---------|--------|
| 1 | No color tokens in Tailwind config; 501 hardcoded hex values across 95 files | `tailwind.config.ts`, 95 component/page files | The Tailwind config defines zero custom colors. The brand teal (`#0d9488`) is actually Tailwind's built-in `teal-600`, but the codebase universally uses arbitrary-value syntax (`text-[#0d9488]`, `bg-[rgba(13,148,136,0.15)]`) instead of utility classes. Secondary colors like `#93b0b4` (muted inactive) have no Tailwind equivalent and genuinely need config entries. `lib/design-tokens.ts` is referenced in CONVENTIONS.md but was never created. If the brand color changes, it requires find-and-replace across 95 files. | Open |

**Suggested fix:**

1. Add custom color tokens to `tailwind.config.ts` under `theme.extend.colors`: `brand` (teal-600 / `#0d9488`), `brand-muted` (`#93b0b4`), and the common rgba variants as opacity modifiers.
2. Bulk-replace `text-[#0d9488]` with `text-brand`, `bg-[#0d9488]` with `bg-brand`, etc. across all 95 files. Mechanical change, safe to do in a single sweep PR.
3. Either create `lib/design-tokens.ts` as referenced in CONVENTIONS, or remove the CONVENTIONS reference if Tailwind config is the canonical token source. Pick one, not both.

---

## Training Builder & Content Library Bloat

Re-measured 2026-07-21.

### P1 - File Size Violations (re-measured at HEAD)

| # | File | Lines | Limit | Over By | Status |
|---|------|-------|-------|---------|--------|
| 1 | `services/training-log-service.ts` | 934 | 300 | 634 (211%) | Open — worst offender |
| 2 | `services/coach-saved-plan-service.ts` | 785 | 300 | 485 (162%) | Open |
| 3 | `services/library-placement-service.ts` | 585 | 300 | 285 (95%) | Open — but cohesive (one transactional placement flow) |
| 4 | `services/exercise-catalog-service.ts` | 571 | 300 | 271 (90%) | Open |
| 5 | `components/clients/training/program-builder/program-builder.tsx` | 559 | 250 | 309 (124%) | Open — but cohesive (pure orchestrator, one DndContext; its state already lives in `ProgramDraftProvider`) |
| 6 | `__tests__/helpers/mock-data-builders.ts` | 633 | 250 | 383 (153%) | Open — **worsening** (was 418 in 2026-03) |

**Suggested split (2):** `coach-saved-plan-service.ts` holds the whole-tree write surface (`overwriteSavedPlan`, `promoteDraftToSaved`, `duplicateSavedPlan`, `createSavedPlanFromCalendar`) alongside the list/paged/summary reads. Lift the write path into `coach-saved-plan-write-service.ts`, leaving reads + status transitions behind.

**Long but cohesive — deliberately left alone** (splitting would prop-drill one flow across files, which §4 itself warns against): `training-calendar-view.tsx` 758, `training-event-calendar-service.ts` 583, `session-detail-drawer.tsx` 575, `content-upload-dialog.tsx` 532, `app/dashboard/content/page.tsx` 497.

---

## Timezone correctness — deferred tail (after sessions 7.81–7.85)

Logged: 2026-06-10; updated 2026-06-12 (Session 7.85). Sessions 7.81–7.84 (`docs/CLIENT-PORTAL-EXECUTION-PLAN.md`) fix device-synced capture (client + coach), plan placement, promotion, check-in gate, streaks, client home, and coach-side windows to the locked model: *"today" = the device timezone of whoever the date belongs to.* Session 7.85 anchored the write-path stragglers: phase-transition stamps (`p_today`, migration 111), the attention-dismissal date (coach-local; migration 112 dropped the table's UTC default), the three bare delete-future calls, and **four** swallowed `{ data }`-only destructures hardened to loud `{ data, error }` handling (`getDayEditState`, `assertCanEditTrainingDay`, `enrichWithDailyLogCounts`, and `getCoachTodayString` itself). These items are intentionally left for later.

### P2 - Deferred
- **Reminder email cron is unwired.** `services/reminder-service.ts` (`sendAutomatedReminders`) has no invoker (no cron). Session 7.84 fixed the shared tracking fns it calls (`getDaysUntilOrPastDue` etc. now resolve the CLIENT's local day from `client.timezone`), so the day math is correct — but the cron itself is still unwired, and `lastReminderSentAt` throttling plus the send time-of-day remain untimezoned. Wire + verify before enabling.
- **Sites deliberately left on server UTC** (dead fallbacks or non-day-decision uses, all commented in-file where relevant): the planId-only event-cleanup fallbacks (`deleteFutureEventsForPlan`, `deleteFutureNutritionEventsForPlan`, `cancelFutureEventsForPlan`) — as of Session 7.85 every live caller passes an explicit anchored date (the three bare callers in phase-transition ×2 and library-placement ×1 were the gap; the audit falsified the previous version of this claim), so the optional `fromDate`/`effectiveFrom` params are dead defensive code and could now be made required; `getWeeklyHabitsData`'s `todayAnchor` default (its only caller passes coach-local); coarse abuse bounds (e.g. the habits/weekly "max 7 days in future" range check — ±tz slack is harmless); audit/`created_at`/`updated_at` timestamps throughout (instants, not day decisions). `validateDateParameter` is now format-only — day bounds belong to write-side `canEditDay` (7.83).
- **Non-day-decision `{ data }`-only swallows left after 7.85** (out of that session's tz scope, same silent-failure smell): the pre-RPC plan-ID captures in `services/phase-transition-service.ts` (~L275–294; a swallowed error silently skips event cleanup) and the child-row "logged" check in `services/daily-log-permissions-service.ts` (~L90; a swallowed error reads as never-logged). Harden opportunistically. *(The former `library-placement-service.ts` active/planned-plan lookups referenced here were removed by the additive placement rewrite, events-SOT S2.)*

### P3 - Guardrail (defer until users exist)
- **No lint rule prevents a new server-side UTC `getTodayDateString()`.** After 7.81–7.84, a fresh `getTodayDateString()` / bare `CURRENT_DATE` in `services/**` or `app/api/**` silently reintroduces the bug. A custom ESLint `no-restricted-syntax` rule banning it server-side (allowing browser/`'use client'` code + `lib/date-helpers.ts`) would prevent regressions. Deferred per "defer tooling until users exist."
