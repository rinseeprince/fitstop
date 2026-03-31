# CoachHub Architecture Reference

This file documents the platform architecture, database schema, and data flow patterns. Unlike CONVENTIONS.md (which contains stable coding rules), this file evolves with the schema. **Update it when shipping migrations.**

---

## Platform Overview

CoachHub is a fitness coaching platform built with Next.js 14 (App Router). It connects two user types:

- **Coaches** (role: `trainer`) - manage clients, create training/nutrition plans, review check-ins, monitor wellness alerts. Dashboard at `/dashboard`.
- **Clients** (role: `client`) - track daily health metrics via Daily Pulse, log workouts, manage nutrition, complete weekly check-ins. Dashboard at `/client/dashboard`.

**Tech stack:** Next.js 14, Supabase (PostgreSQL + RLS + Auth), SWR (coach-side), Upstash Redis (rate limiting), OpenAI GPT-4o / GPT-4o-mini (AI summaries, training generation), Vitest, Tailwind CSS, shadcn/ui, Lucide icons, Framer Motion.

---

## Data Hierarchy

```
coaches
  └── clients                        -- coach_id FK, one coach per client
        ├── roadmaps                  -- opt-in, one active per client
        │     └── phases              -- time-bound strategy blocks
        │           ├── training_plans   -- phase_id FK (nullable)
        │           ├── nutrition_plans  -- phase_id FK (nullable)
        │           └── daily_habits     -- phase_id FK (nullable)
        │
        ├── training_plans            -- can exist without roadmap (phase_id = null)
        │     └── training_sessions
        │           └── training_exercises
        ├── nutrition_plans           -- can exist without roadmap (phase_id = null)
        ├── daily_habits              -- can exist without roadmap (phase_id = null)
        │
        ├── daily_logs (spine)        -- one per client per day
        │     ├── wellness_logs
        │     ├── nutrition_logs
        │     ├── training_logs
        │     │     └── session_logs
        │     │           └── exercise_logs
        │     ├── daily_habit_logs
        │     └── daily_external_activities
        │
        ├── check_ins                 -- weekly structured submissions
        ├── client_goals              -- versioned goal records
        └── body_metrics              -- immutable measurement events
```

### Roadmaps are opt-in

Clients without roadmaps work exactly as before: plans link to `client_id` directly with `phase_id = NULL`. When a coach creates a roadmap for a client, new plans must be linked to a phase via `requirePhaseSelection()` middleware (`lib/require-phase-selection.ts`). This enforces that if an active roadmap exists, the coach must select a planned or active phase when creating a training plan, nutrition plan, or habit.

---

## Roadmap/Phase Architecture

```
roadmaps              -- long-term goal container, one active per client
  └── phases           -- time-bound strategy blocks (planned/active/completed/skipped)
        ├── training_plans  -- linked via phase_id (nullable, backward compat)
        ├── nutrition_plans -- linked via phase_id (nullable, backward compat)
        └── daily_habits    -- linked via phase_id (nullable, backward compat)
```

### Roadmaps

- Status lifecycle: `active` / `archived` / `draft`
- Unique index enforces one active roadmap per client
- ON DELETE RESTRICT prevents hard-deletion (forces archival instead)
- Fields: `name`, `long_term_goal`, `started_at`, `target_end_date`

### Phases

- Status lifecycle: `planned` / `active` / `completed` / `skipped`
- Unique index enforces one active phase per roadmap
- `order_index` controls display order within a roadmap
- `phase_goals_snapshot` JSONB captures the client's goal state at phase creation time
- `phase_goal_weight` (NUMERIC, nullable) - phase-specific goal weight in kg. NULL = fall back to client's overall goal
- `phase_goal_body_fat_percentage` (NUMERIC, nullable) - phase-specific goal body fat %. NULL = fall back to client's overall goal
- `coach_reflection` (text) and `phase_summary` (JSONB) are written during phase transitions
- `milestones` JSONB — array of milestone objects scoped to the phase (`{id, text, completed, completed_at}`)
- `completion_seen` (boolean) tracks whether the client has dismissed the completion card

### Phase goal overrides

Phases can have optional goal overrides (`phase_goal_weight`, `phase_goal_body_fat_percentage`) that replace the client's overall goal for nutrition plan calculation. When NULL, the system falls back to the client's `client_goals` record.

**Resolution flow** in `app/api/clients/[id]/nutrition/route.ts`:
1. `requirePhaseSelection()` returns the matched phase's goal data alongside `phaseId`
2. If `phaseGoalWeight` is set, it's used directly as `effectiveGoalWeightKg` (already in kg, no conversion) and `phaseEndDate` becomes the goal deadline
3. If NULL/undefined, falls back to `currentGoals.goalWeight` with `weightToKg()` conversion and `body.goalDeadline`
4. Response includes `goalSource: "phase" | "client"` so the UI knows which source was used

**Status guard**: Phase goals can only be edited while `status = 'planned'`. The guard in `updatePhase()` rejects the entire request (including non-goal fields in the same payload) if goal fields are present and the phase is not planned.

### Phase selection enforcement

`requirePhaseSelection(clientId, phaseId)` in `lib/require-phase-selection.ts`:
- No active roadmap: proceeds without phaseId (backward-compatible)
- Roadmap exists but no phaseId provided: returns 400
- Roadmap exists but zero selectable phases: returns 400
- phaseId not in selectable (planned/active) list: returns 400
- On success: returns `phaseId`, `phaseGoalWeight`, `phaseGoalBodyFatPercentage`, `phaseEndDate` from the matched phase

Called by plan creation routes (training, nutrition, habits) before the service layer.

---

## Client Goals & Body Metrics

### client_goals table

Versioned goals using the `effective_from` / `superseded_at` pattern:
- New goals are created as new rows (never update existing records)
- The previous active goal gets `superseded_at = NOW()` when a new goal is set
- Unique index ensures one active (non-superseded) goal per client
- Fields: `goal_weight`, `goal_body_fat_percentage`, `goal_deadline`, `primary_goal`, `set_by`, `notes`

### body_metrics table

Immutable event log with source provenance:
- Each measurement is a new row (no `updated_at` column - intentionally immutable)
- `source` field tracks origin: `check_in` / `metrics_api` / `intake_sync` / `nutrition_plan`
- `source_id` (nullable UUID) references the originating record
- Indexed on `(client_id, recorded_at DESC)` for efficient latest-first queries
- Fields: `weight`, `weight_unit`, `body_fat_percentage`, `bmr`, `tdee`

### Denormalized cache on clients table

The `clients` table retains `current_weight`, `current_body_fat_percentage`, `bmr`, `tdee` as a denormalized cache. These are updated on every body_metrics write for backward compatibility.

### Dual-write pattern

When a check-in submits body metrics (`services/client-check-in-service.ts`):
1. Updates `clients` table with new current metrics (the denormalized cache)
2. Recalculates BMR/TDEE from updated client data
3. Calls `recordBodyMetrics()` to write an immutable event to `body_metrics` (non-blocking)

### Read switch fallback

Services that read goals/metrics prefer the new tables but fall back to legacy `client.*` fields for pre-migration clients (`services/comparison-service.ts`):
```
goalWeight = currentGoals?.goalWeight ?? client.goalWeight
earliestWeight = earliestMetrics[0]?.weight ?? client.startingWeight
```

---

## Phase Transition Flow

When a coach completes a phase, the transition follows this sequence:

### 1. Review data gathering

`getPhaseReviewData()` in `services/phase-transition-service.ts` runs parallel queries (with `Promise.allSettled` for partial data tolerance):
- **Training adherence**: session_logs count vs training plan frequency_per_week across the phase date range
- **Nutrition adherence**: averaged nutrition_adherence scores from nutrition_logs (hit=1.0, partial=0.5, missed=0.0)
- **Habit completion**: daily_habit_logs completed percentage vs total expected
- **Body metrics delta**: weight/body_fat at phase start vs current (from body_metrics table)
- **Goals comparison**: phase_goals_snapshot vs current client_goals, plus phase-level goal overrides (`phaseGoals`)

### 2. Atomic RPC

`transition_phase_atomic` RPC executes in a single transaction:
- Marks current phase as `completed`, writes `coach_reflection` and `phase_summary` JSONB
- Based on `next_action` parameter:
  - `activate_next`: activates the next planned phase
  - `archive_roadmap`: archives the entire roadmap
- Based on `plan_handling` flags, archives or keeps training plans, nutrition plans, and habits

### 3. Client completion card

`PhaseCompletionCard` (`components/daily-pulse/phase-completion-card.tsx`):
- Fetches via SWR from `GET /api/client/phase-completion` (queries phases where `status='completed'`, `phase_summary IS NOT NULL`, `completion_seen=false`)
- Displays: phase name, coach reflection, summary stats (training %, nutrition %, weight change), next phase name
- On dismiss: `POST /api/client/phase-completion` sets `completion_seen = true`

---

## Daily Logs (spine + child tables)

Daily tracking data is split into a spine table and domain-specific child tables:
```
daily_logs (spine)         -- id, client_id, date, notes, phase_id
  ├── wellness_logs        -- mood, energy, sleep, stress (1:1 via daily_log_id FK)
  ├── nutrition_logs       -- consumed, targets, adherence (1:1 via daily_log_id FK)
  ├── training_logs        -- trained, training_session_id, training_data JSONB (1:1 via daily_log_id FK)
  ├── daily_habit_logs     -- per-habit completion (1:many, FK to daily_habits)
  └── daily_external_activities -- ad-hoc activities (1:many)
```
- **Writes** go through the `upsert_daily_log_atomic()` RPC function which upserts spine + child tables in a single transaction
- **Domain-specific reads** query child tables directly (e.g. wellness history queries `wellness_logs`, not the view)
- **Cross-domain reads** use the `daily_logs_full` view (e.g. attention feed, AI summary generation)
- Each child table has `client_id` and `date` columns for direct querying without joining the spine
- Phase linkage for nutrition/training logs is derived via plan FKs: `nutrition_logs.nutrition_plan_id` -> `nutrition_plans.phase_id` -> `phases`. The spine (`daily_logs`) retains `phase_id` for direct phase context.
- The `DailyLog` TypeScript type remains flat. The split is DB + service layer only. Hooks, components, and utils are unaffected

---

## Training Completion Hierarchy

```
training_logs        -- did the client train today? (1:1 per day, child of daily_logs)
  └── session_logs   -- per-session-per-week completion details (renamed from client_session_completions)
        └── exercise_logs  -- per-exercise performance (renamed from client_exercise_completions)
```
- `session_logs.training_session_id` is SET NULL on delete (nullable). When a training plan is replaced, old completion records are preserved via `prescribed_session_snapshot` JSONB
- `exercise_logs.training_exercise_id` is SET NULL on delete (nullable). History preserved via `prescribed_exercise_snapshot` JSONB
- Snapshots are written at completion time and backfilled for existing data

---

## Daily Pulse Architecture (Client-side)

Daily Pulse is the client's daily tracking interface at `/client/dashboard`. Clients log wellness (mood, energy, sleep, stress), training completion, nutrition intake, and habits each day.

### Core principles

1. **Lifted state** - `daily-pulse.tsx` owns ALL state. Child components are controlled/presentational. Props down, callbacks up.
2. **Single source of truth** - The `training_data` JSONB column on `training_logs` stores the complete training UI state. On page load, everything restores from this column, not from cross-referencing other tables.
3. **No auto-save** - Nothing saves until "Log Day" is clicked (wellness + training + nutrition). Exception: habits auto-save independently on toggle.
4. **Cache busting** - All fetches use `{ cache: 'no-store' }`. All GET API routes return `Cache-Control: no-store` headers.
5. **Historical snapshots** - Training and nutrition targets are snapshotted at save time. Coach-side views always read saved values, never the current plan.
6. **Date-aware saves** - The server-side save flow uses the log's `date` field (not today's date) when looking up nutrition targets and planned activities.

### Data fetching

`use-daily-pulse.ts` fires a single `Promise.all` on date change:
```
GET /api/client/daily-logs/today?date={selectedDate}
GET /api/client/daily-logs/streak
GET /api/client/daily-logs/nutrition-target?date={selectedDate}
GET /api/client/training
GET /api/client/habits
GET /api/client/habits/logs/today?date={selectedDate}
```
- All fetches use `fetchWithRetry` (handles 429 rate limits with 1500ms retry)
- `AbortController` cancels previous requests on date change
- Single `isLoading` flag is true until all resolve

### Save flow

`handleSave()` in `daily-pulse-handlers.ts`:
1. Builds `training_data` JSONB payload (trainingSessionId, trainingSessionName, activityStatuses, unplannedActivities)
2. POSTs to `/api/client/daily-logs` with wellness, nutrition, training data
3. Server calls `upsert_daily_log_atomic()` RPC

### Restore flow

When a saved log exists for the selected date:
1. Restores wellness from log fields
2. Restores nutrition from log fields (including snapshotted targets)
3. Reads `training_data` JSONB: matches session IDs to current plan, handles orphaned sessions (plan changed since save) via `trainingSessionName` fallback

### Coach-side wellness strip

`daily-wellness-strip.tsx` on the client overview tab:
- Fetches 28-day rolling window of daily_logs + habit_logs via `Promise.all`
- Renders 2x2 bar chart grid (mood, energy, sleep, stress) + adherence dots
- Runs `detectAlerts()` on loaded data for the attention feed

---

## Coach-side Data Flow

### SWR fetching

All coach-side data fetching uses SWR with:
- `revalidateOnFocus: false`
- `swrFetcher` from `lib/swr-fetcher.ts` (throws on non-OK responses)
- `isLoading` for initial load skeletons (not `isValidating`)

### Client page tab structure

`app/clients/[id]/page.tsx` renders tabs synced to the URL via `?tab=` search param:

| Tab | Component | Description |
|-----|-----------|-------------|
| Overview | `ClientOverviewTab` | Quick metrics, wellness strip, recent check-ins |
| Roadmap | `RoadmapTabContent` | Phase timeline, create/transition dialogs |
| Metrics | `MetricsTabContent` | Body metrics charts, check-in history |
| Training Plan | `TrainingPlanCard` + `TrainingHistoryTable` | Plan builder, session history |
| Nutrition | `NutritionCalculatorCardEnhanced` + `NutritionHistoryTable` | Plan builder, weekly history |
| Wellness | `WellnessTabContent` | Wellness trends and analysis |
| Daily Habits | `HabitsTabContent` + `HabitsHistoryTable` | Habit management, analytics |
| Notes | Coach notes (inline) | Free-text notes |

Tab changes call `router.replace(/clients/${clientId}?tab=${tab}, { scroll: false })` to sync URL without scroll.

### Builder flows

Plan creation uses context providers wrapping custom hooks:

- **Training**: `TrainingBuilderProvider` wraps `useTrainingBuilder` hook. Manages sessions, exercises, reorder, add/edit/delete. State stored in context, consumed via `useTrainingBuilderContext()`.
- **Nutrition**: `NutritionBuilderProvider` wraps `useNutritionBuilder` hook. Manages calorie targets, macro breakdown, custom macros toggle. Calculates adjusted targets from client metrics (BMR, activity level).

Both contexts are thin wrappers: the context provides the hook's return value, and consumers access it via the context hook.

### Attention feed

Wellness/tracking/activity triggers evaluate across all coach's clients:
- `lib/wellness-triggers.ts` - mood/energy drops, stress spikes
- `lib/tracking-triggers.ts` - logging gaps, nutrition/training misses
- `lib/activity-triggers.ts` - habit dropoff, activity-calorie mismatch
- `services/attention-feed-service.ts` - aggregates triggers into prioritized feed
- `components/dashboard/needs-attention-feed.tsx` - renders on coach dashboard via SWR

---

## Auth Model

### Dual role system

- `profiles` table: `user_id`, `role` (`trainer` | `client`)
- `coaches` table: auto-created on first login for trainers
- `clients` table: `user_id`, `coach_id` for ownership

### Middleware routing (`middleware.ts`)

- Public routes: `/check-in/*`, `/api/check-in/*`, `/invite/*`, `/api/invitations/*`, password reset
- Trainers: restricted to `/dashboard`, `/clients`, `/check-ins`, etc.
- Clients: restricted to `/client/*` routes
- Role mismatch: redirects to appropriate dashboard

### Auth helpers (`lib/auth-helpers.ts`)

- `getAuthenticatedCoachId()`: validates JWT via `supabase.auth.getUser()`, queries `coaches` table, returns coach ID or null
- `getAuthenticatedClientId()`: same pattern against `clients` table

### Database clients

- `createServerSupabaseClient()` (`lib/supabase-server.ts`): session-scoped, respects RLS. Default for all authenticated routes.
- `supabaseAdmin` (`services/supabase-admin.ts`): bypasses RLS. Only used when:
  1. Unauthenticated context (e.g. token-based check-in submission)
  2. Cross-client queries (e.g. coach aggregation, attention feed)
  3. System-level writes (e.g. phase transition RPC, background upserts)

### IDOR prevention

Every coach API route manually verifies the ownership chain:
1. **Auth**: `getAuthenticatedCoachId()` - returns 401 if not authenticated
2. **Client ownership**: `client.coachId === coachId` - returns 403/404 if mismatch
3. **Resource ownership**: `resource.clientId === clientId` - returns 404 if mismatch

---

## Activation Flow

`GET /api/clients/[id]/activation-readiness` checks whether a client is ready for full activation.

**Required items** (must have all):
- `hasTrainingPlan` - an active training plan exists
- `hasNutritionPlan` - an active nutrition plan exists
- `hasHabits` - client has active daily habits

**Recommended items** (displayed but not blocking):
- `hasRoadmap` - an active roadmap exists
- `hasActivePhase` - roadmap has an active phase (with name/startDate)

Uses `Promise.all` with `safeQuery()` wrapper for partial failure tolerance. The coach sees the `ClientActivationBanner` component which shows required vs recommended status.

---

## API Route Structure

### Middleware ordering

Every API handler follows this exact sequence:
1. Rate limiting (`apiRateLimit`, `coachApiRateLimit`, `clientApiRateLimit`)
2. CSRF protection (`requireCSRFProtection`) - mutating methods only (POST/PUT/PATCH/DELETE)
3. Authentication (`getAuthenticatedCoachId()` or `getAuthenticatedClientId()`)
4. Authorization / IDOR check (verify coach owns the client)
5. Input validation (`schema.safeParse(body)`)
6. Business logic (wrapped in try/catch)

### Response format

All endpoints return:
```json
{ "success": true, "data": { ... } }
{ "success": false, "error": "Human-readable message" }
```

Status codes: 200 (success), 201 (created), 400 (validation), 401 (auth), 403 (forbidden), 404 (not found), 409 (conflict), 429 (rate limited), 500 (server error).

### Route namespaces

- `/api/clients/[id]/*` - coach-side routes (use `coachApiRateLimit`, `getAuthenticatedCoachId`)
- `/api/client/*` - client-side routes (use `clientApiRateLimit`, `getAuthenticatedClientId`)
- `/api/check-in/*` - public token-based routes (use `checkInRateLimit`)
- `/api/dashboard/*` - coach dashboard aggregation routes

---

## JSONB Conventions

- See Daily Pulse README for `training_data` and `activityStatuses` shape documentation
- `activityStatuses` is `Record<string, { completed, activityName, estimatedCalories }>` - always read `.completed` field, never use the object as a truthy check
- `training_data` JSONB on `training_logs` is a **UI restore cache** for the Daily Pulse. It preserves the exact training state at save time so the UI can restore without cross-referencing. The **source of truth** for training completion is `session_logs` + `exercise_logs`

### phase_goals_snapshot

Written to `phases.phase_goals_snapshot` when a phase is created. Captures the client's current goals at that point:
```json
{
  "goalWeight": 75,
  "goalBodyFatPercentage": 15,
  "primaryGoal": "Lose fat, build muscle"
}
```

### phase_summary

Written to `phases.phase_summary` during phase transition. Captures completion metrics:
```json
{
  "completedAt": "2026-03-25T00:00:00.000Z",
  "metricsSnapshot": {
    "startWeight": 85, "endWeight": 82,
    "startBodyFat": 20, "endBodyFat": 18
  },
  "adherence": {
    "training": 0.85,
    "nutrition": 0.72,
    "habits": 0.90
  },
  "phaseGoals": {
    "goalWeight": 75,
    "goalBodyFatPercentage": 15
  }
}
```

---

## Check-in System

### Submission flow

1. Coach sends check-in link (or client navigates to `/client/check-in`)
2. Token-based auth via `check_in_tokens` table (7-day expiry)
3. Multi-step form captures: wellness (mood, energy, sleep, stress), body metrics (weight, body fat, measurements), training highlights, nutrition adherence, photos
4. On submit: creates `check_ins` record with `status='pending'`

### AI processing pipeline

After submission, `triggerAISummaryGeneration()` (`services/client-check-in-service.ts`) runs asynchronously:
1. Fetches current check-in with details + previous 5 check-ins for trend analysis
2. Fetches daily logs, habit logs, and weekly nutrition summary for the check-in period
3. Calls `generateCheckInSummary()` (Anthropic Claude API) with all context
4. Updates check-in with AI summary in v2 format (`ai_insights` JSONB)
5. Status transitions: `pending` -> `ai_processed` -> `reviewed` (after coach reviews)

### Check-in period gating

- `clients.expected_check_in_day` controls when check-ins are available
- `calculateCheckInPeriod()` computes the 7-day window (period_start, period_end) based on the expected day
- Clients can only submit during their designated period

### Metrics dual-write on check-in

`updateClientMetricsFromCheckIn()` handles the body metrics flow:
1. Updates `clients` table with current_weight, current_body_fat_percentage (denormalized cache)
2. Recalculates BMR and TDEE from updated client data
3. Writes immutable event to `body_metrics` table with `source: 'check_in'`
