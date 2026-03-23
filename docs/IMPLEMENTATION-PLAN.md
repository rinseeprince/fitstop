# Roadmap Architecture Implementation Plan

Two-session implementation guide with copy-paste prompts for Claude Code.

---

## Pre-flight

Before starting either session, make sure:
- Supabase CLI is available: `supabase --version`
- No uncommitted work that could conflict with these changes

---

## Session 1: Foundations (Migrations + Dual-Write + New Services)

**Goal:** Create all new tables, backfill data, add new services, and add dual-writes to existing services. Nothing breaks. All existing behavior is preserved.

### Prompt 1A: Migrations

```
Read docs/IMPLEMENTATION-PLAN.md, CONVENTIONS.md, and docs/ARCHITECTURE.md before starting.

Create the following Supabase migrations in order. Follow existing migration patterns in supabase/migrations/ for style. All new tables need created_at and updated_at columns. Use gen_random_uuid() for primary keys.

Migration 060_create_client_goals.sql:
- Create client_goals table with: id (UUID PK), client_id (UUID NOT NULL FK to clients ON DELETE CASCADE), goal_weight (NUMERIC), goal_body_fat_percentage (NUMERIC), goal_deadline (DATE), primary_goal (TEXT), set_by (TEXT NOT NULL DEFAULT 'coach'), notes (TEXT), effective_from (TIMESTAMPTZ NOT NULL DEFAULT NOW()), superseded_at (TIMESTAMPTZ nullable), created_at, updated_at
- Unique partial index on (client_id) WHERE superseded_at IS NULL
- Index on (client_id, effective_from DESC)
- Enable RLS
- Backfill from clients table: INSERT INTO client_goals selecting goal_weight, goal_body_fat_percentage, goal_deadline from clients WHERE any goal field is NOT NULL. Use clients.created_at as effective_from, set_by = 'coach', notes = 'Backfilled from clients table'

Migration 061_create_body_metrics.sql:
- Create body_metrics table with: id (UUID PK), client_id (UUID NOT NULL FK to clients ON DELETE CASCADE), weight (NUMERIC), weight_unit (TEXT), body_fat_percentage (NUMERIC), bmr (INTEGER), tdee (INTEGER), source (TEXT NOT NULL), source_id (UUID nullable), recorded_at (TIMESTAMPTZ NOT NULL DEFAULT NOW()), created_at (TIMESTAMPTZ NOT NULL DEFAULT NOW())
- No updated_at - these are immutable events
- Index on (client_id, recorded_at DESC)
- Index on (client_id, source)
- Enable RLS
- Backfill from check_ins: INSERT INTO body_metrics selecting client_id, weight, weight_unit, body_fat_percentage, 'check_in' as source, id as source_id, created_at as recorded_at FROM check_ins WHERE weight IS NOT NULL OR body_fat_percentage IS NOT NULL
- Backfill from clients for clients with no check-in data: INSERT INTO body_metrics selecting id as client_id, current_weight, weight_unit, current_body_fat_percentage, bmr::integer, tdee::integer, 'intake_sync' as source, updated_at as recorded_at FROM clients WHERE current_weight IS NOT NULL AND NOT EXISTS (SELECT 1 FROM body_metrics bm WHERE bm.client_id = clients.id)

Migration 062_create_roadmaps_and_phases.sql:
- Create roadmaps table with: id (UUID PK), client_id (UUID NOT NULL FK to clients ON DELETE CASCADE), coach_id (UUID NOT NULL FK to coaches(id)), name (TEXT NOT NULL DEFAULT 'Training Roadmap'), long_term_goal (TEXT), status (TEXT NOT NULL DEFAULT 'active' CHECK IN ('active', 'archived', 'draft')), started_at (DATE), target_end_date (DATE), created_at, updated_at
- Unique partial index on (client_id) WHERE status = 'active' (only one active roadmap per client)
- Index on (client_id, created_at DESC)
- Enable RLS

- Create phases table with: id (UUID PK), roadmap_id (UUID NOT NULL FK to roadmaps ON DELETE SET NULL), client_id (UUID NOT NULL FK to clients ON DELETE CASCADE), name (TEXT NOT NULL), description (TEXT), objectives (TEXT), order_index (INTEGER NOT NULL DEFAULT 0), status (TEXT NOT NULL DEFAULT 'planned' CHECK IN ('planned', 'active', 'completed', 'skipped')), start_date (DATE), end_date (DATE), duration_weeks (INTEGER), phase_goals_snapshot (JSONB), created_at, updated_at
- Unique partial index on (roadmap_id) WHERE status = 'active' (only one active phase per roadmap)
- Index on (roadmap_id, order_index)
- Index on (client_id, start_date DESC)
- Enable RLS

Migration 063_add_phase_id_to_plans.sql:
- ALTER TABLE training_plans ADD COLUMN IF NOT EXISTS phase_id UUID REFERENCES phases(id) ON DELETE SET NULL
- ALTER TABLE nutrition_plans ADD COLUMN IF NOT EXISTS phase_id UUID REFERENCES phases(id) ON DELETE SET NULL
- ALTER TABLE daily_habits ADD COLUMN IF NOT EXISTS phase_id UUID REFERENCES phases(id) ON DELETE SET NULL
- Index on each where phase_id IS NOT NULL

Migration 064_rls_policies_new_tables.sql:
- RLS policies for client_goals, body_metrics, roadmaps, phases
- Follow the existing RLS pattern from the codebase. Check migration files for how RLS is done on similar tables (e.g. check how nutrition_plans or training_plans RLS works)
- Coaches can read/write their clients' data
- Clients can read their own data
- Add a comment at the top explaining which tables are covered

Migration 065_add_phase_fk_to_daily_logs.sql:
- daily_logs.phase_id column already exists but has no FK constraint. Add the FK: ALTER TABLE daily_logs ADD CONSTRAINT daily_logs_phase_id_fkey FOREIGN KEY (phase_id) REFERENCES phases(id) ON DELETE SET NULL
- Same for daily_habit_logs.phase_id if it exists and has no FK

After creating all migrations, run: supabase db reset
Then regenerate types: supabase gen types typescript --local > types/database.ts

Do NOT modify any service files or components yet. Migrations only.
```

**Verify 1A:**
- `supabase db reset` completes without errors
- `npx tsc --noEmit` passes (regenerated types are valid)
- Manually check: `SELECT count(*) FROM client_goals;` should match number of clients with goal data
- Manually check: `SELECT count(*) FROM body_metrics;` should have rows from check_ins backfill

---

### Prompt 1B: New Types

```
Read docs/IMPLEMENTATION-PLAN.md and CONVENTIONS.md.

Create types/roadmap.ts with TypeScript types for the new tables. Follow the pattern used in existing type files (check types/client-intake.ts or types/check-in.ts for style).

Types needed:
- Roadmap: id, clientId, coachId, name, longTermGoal, status ('active'|'archived'|'draft'), startedAt, targetEndDate, createdAt, updatedAt
- Phase: id, roadmapId, clientId, name, description, objectives, orderIndex, status ('planned'|'active'|'completed'|'skipped'), startDate, endDate, durationWeeks, phaseGoalsSnapshot (Record<string, unknown> or a typed shape), createdAt, updatedAt
- ClientGoals: id, clientId, goalWeight, goalBodyFatPercentage, goalDeadline, primaryGoal, setBy, notes, effectiveFrom, supersededAt, createdAt
- BodyMetricsEvent: id, clientId, weight, weightUnit, bodyFatPercentage, bmr, tdee, source ('check_in'|'metrics_api'|'intake_sync'), sourceId, recordedAt, createdAt

Also update lib/database-helpers.ts to add row type aliases for the new tables, following the existing pattern in that file.

Keep both files under their size limits (types: no limit specified, database-helpers.ts: check current size).
```

**Verify 1B:**
- `npx tsc --noEmit` passes
- All types are exported and importable

---

### Prompt 1C: New Services + Unit Tests

```
Read docs/IMPLEMENTATION-PLAN.md, CONVENTIONS.md (especially sections 2, 3, 8, 9, 10), and docs/ARCHITECTURE.md.

Create three new service files. Before writing each one, read 2-3 existing service files to match patterns exactly (check services/client-service.ts, services/nutrition-plan-service.ts, services/training-service.ts for style). Use createServerSupabaseClient() by default per conventions. Use supabaseAdmin only where justified with a comment.

1. services/body-metrics-service.ts (max 300 lines):
   - recordBodyMetrics({ clientId, weight?, weightUnit?, bodyFatPercentage?, bmr?, tdee?, source, sourceId? }): Inserts a row into body_metrics. Also updates the denormalized cache on clients table (current_weight, current_body_fat_percentage, bmr, tdee) if the respective fields are provided.
   - getLatestBodyMetrics(clientId): Returns the most recent body_metrics row for the client. Query body_metrics WHERE client_id = ? ORDER BY recorded_at DESC LIMIT 1.
   - getBodyMetricsHistory(clientId, opts?: { limit?, from?, to? }): Returns body_metrics rows with optional date filtering and pagination.

2. services/client-goals-service.ts (max 300 lines):
   - getCurrentGoals(clientId): Returns the current (non-superseded) client_goals row. Query WHERE client_id = ? AND superseded_at IS NULL using .maybeSingle().
   - updateGoals(clientId, goals: { goalWeight?, goalBodyFatPercentage?, goalDeadline?, primaryGoal? }, setBy: string): Supersedes the current row (UPDATE SET superseded_at = NOW() WHERE client_id = ? AND superseded_at IS NULL), then inserts a new row with merged fields (carry forward unchanged fields from the superseded row). Also dual-writes to clients table for backward compat (goal_weight, goal_body_fat_percentage, goal_deadline).
   - getGoalsHistory(clientId): Returns all client_goals rows ordered by effective_from DESC.

3. services/roadmap-service.ts (max 300 lines - if it exceeds, split phase functions into services/phase-service.ts):
   - createRoadmap(clientId, coachId, data: { name, longTermGoal?, startedAt?, targetEndDate? }): Inserts roadmap row. Validates no active roadmap exists for client first.
   - getActiveRoadmap(clientId): Returns active roadmap with its phases ordered by order_index.
   - getRoadmap(roadmapId): Returns roadmap by ID with phases.
   - archiveRoadmap(roadmapId): Sets status = 'archived'. Does NOT delete phases.
   - createPhase(roadmapId, data: { name, description?, objectives?, startDate?, endDate?, durationWeeks?, orderIndex? }): Inserts phase. Gets roadmap to set client_id. Optionally snapshots current goals into phase_goals_snapshot by calling getCurrentGoals.
   - activatePhase(phaseId): Sets phase status = 'active'. Ensures only one active phase per roadmap (deactivate others first by setting them to 'completed' or keeping them as 'planned').
   - completePhase(phaseId): Sets status = 'completed', sets end_date = NOW() if not already set.
   - getActivePhase(clientId): Returns the active phase for the client (via active roadmap).

Each service must use proper error handling (try/catch, meaningful error messages). Use the mapper pattern from existing services for converting DB rows to domain types.

Now write unit tests for ALL three services. Follow the existing test patterns in the codebase (read services/daily-logs-service.test.ts and __tests__/helpers/mock-data-builders.ts for patterns). Use vitest. Place tests colocated next to source files.

services/body-metrics-service.test.ts:
- Test recordBodyMetrics: mock supabaseAdmin.from().insert() for body_metrics and .update() for clients cache. Verify both calls are made with correct data. Test with partial data (only weight, no body fat). Test error handling when insert fails.
- Test getLatestBodyMetrics: mock query chain with .select().eq().order().limit().maybeSingle(). Test returns mapped BodyMetricsEvent. Test returns null when no data.
- Test getBodyMetricsHistory: mock query chain. Test with no options (returns all). Test with limit option. Test with from/to date range. Test empty result returns empty array.

services/client-goals-service.test.ts:
- Test getCurrentGoals: mock query with .eq('superseded_at', null). Test returns mapped ClientGoals. Test returns null for client with no goals.
- Test updateGoals: mock the supersede UPDATE, the INSERT of new row, and the clients table dual-write. Verify superseded_at is set on old row. Verify new row merges old + new fields (e.g. changing only goalWeight carries forward existing goalDeadline). Test first-ever goal set (no existing row to supersede).
- Test getGoalsHistory: mock query returning multiple rows. Verify ordered by effective_from DESC.

services/roadmap-service.test.ts (or split if service was split):
- Test createRoadmap: mock insert. Verify error thrown if active roadmap already exists. Verify successful creation returns mapped Roadmap.
- Test getActiveRoadmap: mock query with .eq('status', 'active'). Test returns roadmap with phases. Test returns null when no active roadmap.
- Test archiveRoadmap: mock update to set status='archived'. Verify phases are NOT deleted.
- Test createPhase: mock roadmap lookup + phase insert. Verify client_id is set from roadmap. Verify phase_goals_snapshot is populated from getCurrentGoals if goals exist.
- Test activatePhase: mock phase lookup + update. Verify only one active phase per roadmap constraint.
- Test completePhase: mock update. Verify end_date set to current date if not already set.
- Test getActivePhase: mock query joining through active roadmap. Test returns null when no active phase.

Add mock data builders to __tests__/helpers/mock-data-builders.ts:
- createMockClientGoalsRow(overrides?)
- createMockBodyMetricsRow(overrides?)
- createMockRoadmapRow(overrides?)
- createMockPhaseRow(overrides?)

Run npx tsc --noEmit and npx vitest run after creating all files.
```

**Verify 1C:**
- `npx tsc --noEmit` passes
- `npx vitest run` - all new tests pass
- Each service file is under 300 lines
- Each test file covers success paths, error paths, and edge cases

---

### Prompt 1D: Dual-Writes + Tests for Modified Services

```
Read docs/IMPLEMENTATION-PLAN.md and CONVENTIONS.md.

Now add dual-writes to existing services. The rule: every place that currently writes event data (body metrics or goals) to the clients table must ALSO write to the new body_metrics and client_goals tables. No read changes yet - existing reads stay exactly as they are.

IMPORTANT: Read each file fully before modifying. Follow the "one fix per change" convention - only add the dual-write calls, don't refactor anything else.

Files to modify:

1. services/client-check-in-service.ts - Find updateClientMetricsFromCheckIn(). After the existing clients table update, add a call to recordBodyMetrics() with source='check_in' and source_id=checkInId. Import recordBodyMetrics from body-metrics-service.

2. app/api/clients/[id]/metrics/route.ts - Find the PUT handler. After the existing clients table update for weight/body_fat/bmr/tdee, add a call to recordBodyMetrics() with source='metrics_api'. If goal fields changed (goal_weight, goal_body_fat_percentage, goal_deadline), call updateGoals() with setBy='coach'. Import both services.

3. services/intake-review-service.ts - Find syncMetricsToClient(). After the existing sync to clients, add recordBodyMetrics() with source='intake_sync' for any body metrics that were synced. Add updateGoals() for any goal fields that were synced, with setBy='intake'.

4. services/client-service.ts - Find createClient(). After creating the client row, if body metric data was provided, call recordBodyMetrics() with source='intake_sync'. If goal data was provided, call updateGoals() with setBy='coach'. Find updateClient(). If body metric or goal fields are being updated, add the corresponding dual-write calls.

5. services/nutrition-plan-service.ts - Find createNutritionPlan(). If it writes tdee back to the clients table, also call recordBodyMetrics() with source='nutrition_plan' including the tdee value.

Now update existing tests and add new test cases for the dual-write behavior:

For each modified file, check if a .test.ts file exists. If it does, update the mocks to include the new imports (vi.mock for body-metrics-service and client-goals-service) so existing tests don't break. Then add new test cases:

1. If services/client-check-in-service.test.ts exists:
   - Add mock for recordBodyMetrics
   - Add test: "calls recordBodyMetrics after updating client metrics from check-in" - verify recordBodyMetrics called with source='check_in', correct weight/bodyFat values, and the check-in ID as sourceId
   - Add test: "still updates clients table even if recordBodyMetrics fails" - mock recordBodyMetrics to throw, verify clients table update still succeeded (dual-write is fire-and-forget, not blocking)

2. For intake-review-service, if test exists:
   - Add mocks for recordBodyMetrics and updateGoals
   - Add test: "dual-writes body metrics on sync" - verify recordBodyMetrics called with source='intake_sync'
   - Add test: "dual-writes goals on sync" - verify updateGoals called with setBy='intake' when goal fields synced

3. For client-service, if test exists:
   - Add mocks for both new services
   - Add test: "records initial body metrics on createClient" - verify recordBodyMetrics called
   - Add test: "records initial goals on createClient" - verify updateGoals called

If a test file doesn't exist for a modified service, create a minimal one that covers the dual-write behavior only.

After all changes:
- Run npx tsc --noEmit
- Run npx vitest run
- Fix any type errors or test failures
- Make sure no console.log debug artifacts are left
```

**Verify 1D:**
- `npx tsc --noEmit` passes
- `npx vitest run` - ALL tests pass (existing + new)
- No `console.log` artifacts in modified files
- Dual-writes are non-blocking (wrapped in try/catch so a body_metrics failure doesn't break the existing flow)

---

### Prompt 1E: Verification and Commit

```
Run the full verification checklist:
1. npx tsc --noEmit
2. npx vitest run
3. npm run build
4. Check that no "as any" was introduced: grep -rn "as any" services/body-metrics-service.ts services/client-goals-service.ts services/roadmap-service.ts types/roadmap.ts
5. Check no console.log artifacts: grep -rn "console.log" services/body-metrics-service.ts services/client-goals-service.ts services/roadmap-service.ts

Fix any issues found.

Then commit with a message like:
"feat: add roadmap/phase tables, client_goals, body_metrics with dual-write

- Migrations 060-065: client_goals, body_metrics, roadmaps, phases tables with RLS
- Add phase_id FK to training_plans, nutrition_plans, daily_habits
- Backfill client_goals from clients table, body_metrics from check_ins
- New services: body-metrics-service, client-goals-service, roadmap-service
- Dual-write: all existing metric/goal writers now also write to new tables
- Full unit test coverage for all new services and dual-write behavior
- No read changes yet - existing behavior fully preserved"
```

---

## Session 2: Switch Reads + New Routes + Roadmap UI + Activation Flow

**Goal:** Switch reads to new tables, create roadmap/phase API routes, build the Roadmap tab UI, update the activation flow, and update CONVENTIONS.md.

### Prompt 2A: Switch Reads + Tests

```
Read docs/IMPLEMENTATION-PLAN.md, CONVENTIONS.md, and docs/ARCHITECTURE.md.

We completed Session 1 (migrations, new services, dual-writes). Now switch reads from clients.* event fields to the new services. The clients table keeps current_weight, current_body_fat_percentage, bmr, tdee as denormalized cache for list views - don't remove those fields.

Read each file fully before modifying. Only change the read source, don't refactor surrounding code.

Files to modify:

1. app/api/clients/[id]/nutrition/route.ts - In the POST handler, replace reads of client.currentWeight, client.bmr, client.tdee, client.goalWeight with calls to getLatestBodyMetrics(clientId) and getCurrentGoals(clientId). Fall back to client.* fields if the new services return null (backward compat for clients created before the migration).

2. app/api/clients/[id]/training/route.ts - Same pattern. Replace client.currentWeight, client.currentBodyFatPercentage, client.goalWeight, client.tdee reads with getLatestBodyMetrics() + getCurrentGoals(). Fall back to client.* if null.

3. services/comparison-service.ts - Replace client.goalWeight, client.goalBodyFatPercentage, client.startingWeight, client.startingBodyFatPercentage reads. For starting metrics, use getBodyMetricsHistory(clientId, { limit: 1 }) ordered by recorded_at ASC (earliest record). For goals, use getCurrentGoals(). Fall back to client.* if null.

4. services/bmr-service.ts - The calculateBMR function should remain a pure calculation function. But callers that pass client.currentWeight should now pass the latest body_metrics weight instead. Check which callers need updating.

Now write/update tests for the read-switch behavior:

1. Create or update test for the nutrition route POST handler (if no test exists, create app/api/clients/[id]/nutrition/route.test.ts):
   - Mock getLatestBodyMetrics and getCurrentGoals
   - Test: "uses body_metrics values when available" - mock both services to return data, verify the plan creation uses those values
   - Test: "falls back to client fields when body_metrics returns null" - mock getLatestBodyMetrics to return null, verify client.currentWeight is used instead
   - Test: "falls back to client fields when getCurrentGoals returns null" - same pattern for goals

2. Create or update test for the training route POST handler:
   - Same pattern as nutrition: test new source, test fallback

3. Update comparison-service tests if they exist:
   - Mock getBodyMetricsHistory and getCurrentGoals
   - Test: "reads starting weight from earliest body_metrics row"
   - Test: "reads goals from client_goals service"
   - Test: "falls back to client fields when services return null"

After all changes:
- npx tsc --noEmit
- npx vitest run
- Fix any issues
```

**Verify 2A:**
- `npx tsc --noEmit` passes
- `npx vitest run` - all tests pass including new fallback tests
- Existing daily-logs-service tests still pass (no regression)

---

### Prompt 2B: New API Routes + Route Tests

```
Read docs/IMPLEMENTATION-PLAN.md, CONVENTIONS.md (especially sections 9 and 10 for security and API design), and docs/ARCHITECTURE.md.

Create new API routes. Before writing, read an existing route like app/api/clients/[id]/training/route.ts to match the exact pattern for: rate limiting, CSRF, auth, ownership check, validation, error handling, response format.

Every route must follow this middleware order:
1. Rate limiting (coachApiRateLimit for coach routes, clientApiRateLimit for client routes)
2. CSRF protection (requireCSRFProtection for POST/PUT/PATCH/DELETE)
3. Authentication (getAuthenticatedCoachId)
4. Authorization (verify coach owns client)
5. Input validation (Zod schema)
6. Business logic in try/catch

Create Zod schemas in lib/validations/roadmap.ts for all inputs.

Routes to create:

1. app/api/clients/[id]/roadmap/route.ts
   - GET: Returns active roadmap with phases for the client. 404 if no active roadmap.
   - POST: Creates a new roadmap. Body: { name, longTermGoal?, startedAt?, targetEndDate? }. Returns 201 with created roadmap.

2. app/api/clients/[id]/roadmap/phases/route.ts
   - GET: Returns all phases for the active roadmap, ordered by order_index.
   - POST: Creates a new phase. Body: { name, description?, objectives?, startDate?, endDate?, durationWeeks?, orderIndex? }. Snapshots current goals into phase_goals_snapshot. Returns 201.

3. app/api/clients/[id]/roadmap/phases/[phaseId]/route.ts
   - GET: Returns phase detail with linked plans (training_plans, nutrition_plans, daily_habits where phase_id matches).
   - PUT: Updates phase fields (name, description, objectives, dates, status). Body is partial.

4. app/api/clients/[id]/roadmap/phases/[phaseId]/activate/route.ts
   - POST: Activates the phase. Calls activatePhase(). Returns updated phase.

5. app/api/clients/[id]/goals/route.ts
   - GET: Returns current goals + optionally history if ?history=true query param.
   - PUT: Updates goals via updateGoals(). Body: { goalWeight?, goalBodyFatPercentage?, goalDeadline?, primaryGoal? }.

6. app/api/clients/[id]/body-metrics/route.ts
   - GET: Returns body metrics history with optional ?limit=N&from=DATE&to=DATE query params.

7. app/api/client/phase/route.ts (CLIENT-side route, not coach)
   - GET: Returns the client's active phase info (name, objectives, start_date, end_date, status) for display in the client app. Uses clientApiRateLimit and getAuthenticatedClientId.

Keep each route file under 250 lines. If a route file would exceed that, extract the business logic into the relevant service.

Now write tests for the critical routes. Follow the pattern in app/api/client/notifications/route.test.ts for API route testing style. Create these test files:

app/api/clients/[id]/roadmap/route.test.ts:
- Mock roadmap-service, auth helpers, rate-limit, csrf
- Test GET: "returns active roadmap with phases" - mock getActiveRoadmap, verify 200 + response shape
- Test GET: "returns 404 when no active roadmap" - mock getActiveRoadmap returning null
- Test GET: "returns 401 when not authenticated"
- Test POST: "creates roadmap successfully" - mock createRoadmap, verify 201
- Test POST: "returns 400 with invalid body" - send empty body, verify validation error
- Test POST: "requires CSRF token on POST"

app/api/clients/[id]/goals/route.test.ts:
- Test GET: "returns current goals"
- Test GET: "returns goals with history when ?history=true"
- Test GET: "returns empty when no goals set"
- Test PUT: "updates goals and returns new version"
- Test PUT: "validates input - rejects negative weight"

app/api/client/phase/route.test.ts:
- Test GET: "returns active phase for authenticated client"
- Test GET: "returns 404 when no active phase"
- Test GET: "returns 401 when not authenticated"

After creating all routes and tests:
- npx tsc --noEmit
- npx vitest run
- Fix any type errors or test failures
```

**Verify 2B:**
- `npx tsc --noEmit` passes
- `npx vitest run` - all route tests pass
- Each route file is under 250 lines
- All routes have rate limiting + CSRF (on mutating methods) + auth

---

### Prompt 2C: Plan Linking + Tests

```
Read CONVENTIONS.md. Read the existing plan creation flows before modifying.

When a coach creates a training plan, nutrition plan, or habits while a phase is active, the plan should automatically link to that phase.

Modify these files:

1. app/api/clients/[id]/training/route.ts - In the POST handler, after getting the client, call getActivePhase(clientId). If an active phase exists, pass phase.id to the training plan creation. Modify services/training-service.ts createTrainingPlan() to accept an optional phaseId param and include it in the INSERT.

2. app/api/clients/[id]/nutrition/route.ts - Same pattern. Call getActivePhase(clientId). Pass phaseId to createNutritionPlan(). Modify services/nutrition-plan-service.ts to accept and store phaseId.

3. For daily habits - find where habits are created (search for the habits creation endpoint). Add the same pattern: get active phase, pass phaseId.

Important: phaseId is always optional/nullable. If no active phase exists, plans create exactly as before with phase_id = NULL. This preserves backward compatibility for clients without roadmaps.

Now add tests for the plan linking:

Update or create tests for training plan creation:
- Mock getActivePhase from roadmap-service
- Test: "sets phase_id when active phase exists" - mock getActivePhase returning a phase, verify createTrainingPlan is called with phaseId
- Test: "creates plan without phase_id when no active phase" - mock getActivePhase returning null, verify plan created with phase_id = null/undefined

Update or create tests for nutrition plan creation:
- Same two tests as above

Update or create tests for habit creation:
- Same two tests as above

After changes:
- npx tsc --noEmit
- npx vitest run
```

**Verify 2C:**
- `npx tsc --noEmit` passes
- `npx vitest run` - all tests pass
- Plans created without a roadmap still work (phase_id = NULL)

---

### Prompt 2D: Roadmap Tab UI (Coach Side)

```
Read CONVENTIONS.md (especially sections 3, 4, 5, 6, 7 for coding standards, file sizes, data fetching).

Before writing any components, read these files to match patterns:
- components/clients/client-page-header.tsx (to see how tabs are defined)
- app/clients/[id]/page.tsx (to see how tab content is rendered)
- One existing tab component for style reference (e.g. a training or nutrition tab component)

Coach-side data fetching must use SWR with revalidateOnFocus: false per conventions.

Step 1: Add the Roadmap tab
- In components/clients/client-page-header.tsx, add { value: "roadmap", label: "Roadmap" } to the TABS array. Place it second, right after "overview".
- Update the ClientTab type export.
- In app/clients/[id]/page.tsx, add a TabsContent for "roadmap" that renders a new RoadmapTabContent component.

Step 2: Create components/clients/roadmap/roadmap-tab-content.tsx (max 250 lines)
- Uses SWR to fetch from /api/clients/${clientId}/roadmap
- If no roadmap exists: show an empty state card with a "Build Roadmap" button that opens a create dialog
- If roadmap exists: show the roadmap header (name, long-term goal, date range) and a timeline/list of phases
- Include an "Add Phase" button

Step 3: Create components/clients/roadmap/create-roadmap-dialog.tsx (max 250 lines)
- Dialog following the convention pattern: controlled by parent via open/onOpenChange
- Form with React Hook Form + Zod: name (required), longTermGoal (optional textarea), startedAt (date picker), targetEndDate (date picker)
- On submit: POST to /api/clients/${clientId}/roadmap
- Shows loader on submit button, toast on success/error
- On success: calls SWR mutate to refresh roadmap data

Step 4: Create components/clients/roadmap/phase-card.tsx (max 250 lines)
- Displays a single phase: name, status badge, date range, objectives
- Shows linked plans (training plan name, nutrition plan name) if any
- "Activate" button if status is 'planned' (POST to activate endpoint)
- "Complete" button if status is 'active'
- Click to expand and see phase details

Step 5: Create components/clients/roadmap/add-phase-dialog.tsx (max 250 lines)
- Replace or enhance the existing add-week-button.tsx
- Dialog with: name (required), description, objectives (textarea), startDate, endDate
- On submit: POST to /api/clients/${clientId}/roadmap/phases
- Toast on success, SWR mutate to refresh

Use Tailwind for all styling. Lucide icons only. No new dependencies.

After all components:
- npx tsc --noEmit
- npm run build (to catch any SSR issues)
```

**Verify 2D:**
- `npx tsc --noEmit` passes
- `npm run build` passes
- Each component file is under 250 lines
- Roadmap tab appears in the client page header
- No new npm dependencies added

---

### Prompt 2E: Update Activation Flow + Tests

```
Read CONVENTIONS.md. Read these files before modifying:
- components/clients/client-activation-banner.tsx
- components/coach/client-activation-dialog.tsx
- app/api/clients/[id]/activation-readiness/route.ts
- components/coach/intake-review-page.tsx

Modify the activation flow to support roadmaps:

1. app/api/clients/[id]/activation-readiness/route.ts
   - Add two new checks: hasRoadmap (query roadmaps WHERE client_id AND status = 'active'), hasActivePhase (query phases WHERE client_id AND status = 'active')
   - Keep existing checks (hasTrainingPlan, hasNutritionPlan, hasHabits)
   - Return all 5 readiness flags in the response
   - Roadmap and phase are NOT required - they're recommended. The coach can still activate without them (backward compat). Add a field like roadmapRecommended: true to signal the UI.

2. components/clients/client-activation-banner.tsx
   - Add roadmap and phase status to the checklist display
   - Show them as recommended (yellow) not required (red) if missing
   - Add a button "Build Roadmap" that switches to the roadmap tab (use the onTabChange callback)

3. components/coach/client-activation-dialog.tsx
   - If an active phase exists, auto-populate the start date from phase.start_date
   - Show the active phase name in the dialog summary
   - No blocking changes - activation still works without a roadmap

4. components/coach/intake-review-page.tsx
   - Add a "Build Roadmap" button alongside the existing "Go to Training Builder" and "Go to Nutrition Builder" buttons
   - This button navigates to the client page with ?tab=roadmap (or calls onTabChange if available)

Now write tests for the activation readiness endpoint:

Create or update app/api/clients/[id]/activation-readiness/route.test.ts:
- Mock supabase queries for roadmaps, phases, training_plans, nutrition_plans, daily_habits
- Test: "returns all readiness flags including roadmap" - mock all queries, verify response includes hasRoadmap, hasActivePhase, hasTrainingPlan, hasNutritionPlan, hasHabits
- Test: "returns hasRoadmap=false when no roadmap" - mock empty roadmap query
- Test: "returns hasActivePhase=false when roadmap exists but no active phase"
- Test: "returns all true when fully set up" - mock everything present
- Test: "client can still activate without roadmap" - verify roadmapRecommended flag is true but no blocking error

After all changes:
- npx tsc --noEmit
- npm run build
- npx vitest run
```

**Verify 2E:**
- `npx tsc --noEmit` passes
- `npm run build` passes
- `npx vitest run` - activation tests pass
- Existing activation still works (no roadmap required)

---

### Prompt 2F: Update CONVENTIONS.md + Final Verification

```
Read CONVENTIONS.md and docs/ARCHITECTURE.md fully.

Update docs/ARCHITECTURE.md to add the new roadmap/phase schema documentation:

1. Add a new section "Roadmap/Phase Architecture":
   Document the hierarchy:
   ```
   roadmaps              -- long-term goal container, one active per client
     └── phases           -- time-bound strategy blocks (planned/active/completed/skipped)
           ├── training_plans  -- linked via phase_id (nullable, backward compat)
           ├── nutrition_plans -- linked via phase_id (nullable, backward compat)
           └── daily_habits    -- linked via phase_id (nullable, backward compat)
   ```
   - Roadmaps are opt-in. Clients without roadmaps work exactly as before (plans link to client_id directly)
   - phase_goals_snapshot JSONB on phases captures goal state at phase start
   - client_goals table tracks versioned goals with effective_from/superseded_at pattern
   - body_metrics table tracks every metric measurement as an immutable event with source provenance
   - clients table retains current_weight, current_body_fat_percentage, bmr, tdee as denormalized cache

Now run the FULL commit-ready checklist from CONVENTIONS.md section 13:
1. npx tsc --noEmit - no TypeScript errors
2. npx eslint . - no lint errors
3. npx vitest run - all tests pass
4. grep -rn "as any" on all new/modified files - no type escapes
5. grep -rn "console.log" on all new/modified files - should only be console.error/warn
6. grep -rn "TODO\|FIXME\|HACK\|DEBUG" on all new/modified files - no leftover markers

Fix any issues found. Then commit with message:
"feat: roadmap tab UI, API routes, plan linking, read migration, activation flow

- New API routes: roadmap, phases, goals, body-metrics, client phase
- Switch metric/goal reads from clients table to body_metrics + client_goals
- Auto-link new plans to active phase
- Roadmap tab with timeline, phase cards, create/add dialogs
- Updated activation flow with roadmap readiness checks
- Full test coverage for routes, services, and activation
- Updated CONVENTIONS.md with roadmap architecture docs"
```

**Verify 2F:**
- All 6 checklist items pass
- Build succeeds
- All tests pass

---

## Post-Implementation Verification

After both sessions are complete, do a manual smoke test:

1. **Existing client (no roadmap):** Create a daily log, create a training plan, verify weekly summaries. Everything should work exactly as before.
2. **New roadmap flow:** Go to a client, open Roadmap tab, create a roadmap, add a phase, activate it. Then create a training plan and nutrition plan - verify they get phase_id set.
3. **Goal history:** Update a client's goals via the metrics page. Check /api/clients/[id]/goals?history=true to verify both old and new goal records exist.
4. **Body metrics history:** Submit a check-in with new weight. Check /api/clients/[id]/body-metrics to verify the event was recorded with source='check_in'.
5. **Activation:** Create a new client, complete intake, verify the activation banner shows roadmap as recommended.

---

## Test Coverage Summary

| Area | Test File | What's Covered |
|------|-----------|----------------|
| Body metrics service | services/body-metrics-service.test.ts | record, getLatest, getHistory, cache update, error handling |
| Client goals service | services/client-goals-service.test.ts | getCurrent, update (supersede+insert+merge), getHistory, first goal |
| Roadmap service | services/roadmap-service.test.ts | create, getActive, archive, createPhase, activate, complete, goal snapshot |
| Dual-writes | Modified existing test files | recordBodyMetrics called from check-in, metrics, intake, client create |
| Read switches | Nutrition/training route tests | New source used, fallback to client.* when null |
| Roadmap API | app/api/clients/[id]/roadmap/route.test.ts | GET/POST, auth, validation, 404 |
| Goals API | app/api/clients/[id]/goals/route.test.ts | GET with history, PUT with validation |
| Client phase API | app/api/client/phase/route.test.ts | GET auth, 404 |
| Plan linking | Training/nutrition route tests | phase_id set when active, null when no phase |
| Activation | activation-readiness/route.test.ts | All 5 flags, roadmap recommended not required |

---

## Rollback Plan

If something goes wrong:
- **Migrations are additive** - new tables and nullable columns. Rolling back means dropping the new tables, which doesn't affect existing data.
- **Dual-writes are safe** - if the new tables have bad data, the old clients table still has the correct values since we never stopped writing to it.
- **Read switches have fallbacks** - every switched read falls back to client.* if the new service returns null.
