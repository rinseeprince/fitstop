# Nutrition Tab Improvements - Implementation Plan (v3)

## Context

Following the phase goal overrides feature (sessions 1-2, shipped), the nutrition tab needs several improvements:
1. Block nutrition plan creation for non-active phases
2. Post-phase-transition nudge when no nutrition plan exists
3. Nutrition tab redesign with Data/Plans sub-tabs
4. Phase-grouped plan history with coach notes (replacing broken history modal)
5. Nutrition Targets card cleanup (phase-aware, simplified layout)

---

## Codebase Review Findings (incorporated)

These findings from reviewing the actual codebase are baked into the plan:

- **RPC, not direct insert**: Nutrition plan creation goes through `create_nutrition_plan_atomic` RPC, not a direct Supabase insert. New columns must be added to both the table AND the RPC function.
- **Component names and paths**:
  - `NutritionBuilderRightPanel` is at `components/clients/nutrition/builder/nutrition-builder-right-panel.tsx`
  - `NutritionPlanHeader` is at `components/clients/nutrition/display/nutrition-plan-header.tsx`
  - `NutritionDayAccordion` is at `components/clients/nutrition/display/nutrition-day-accordion.tsx`
  - `NutritionSettingsDrawer` is at `components/clients/nutrition/builder/nutrition-settings-drawer.tsx`
  - The "regeneration flow" uses a side drawer, NOT a dialog
- **History modal is dead code**: `NutritionPlanHistoryModal` exists and calls `GET /api/clients/${clientId}/nutrition/history`, but the route was never implemented. The modal silently fails (catches 404, shows empty state). It should be removed and replaced by inline plan history on the Plans sub-tab.
- **Activation banner won't help**: `ClientActivationBanner` is gated to `onboardingStatus === "setup_in_progress"`. It will never reappear after a client is activated. A separate inline alert is needed on the Plans sub-tab.
- **PhaseSelector is shared**: Used by training, nutrition, and habits. Nutrition-specific active-only restriction needs an `activeOnly` prop, not a global change.
- **`requirePhaseSelection` return type**: Already extended with `phaseGoalWeight`, `phaseGoalBodyFatPercentage`, `phaseEndDate` from session 1. Now also needs `phaseStatus`.
- **Type file**: `NutritionPlanHistory` type is at `types/check-in.ts:593`. Currently has no `coachNotes`, `goalSource`, or `phaseId` fields.
- **No `?subtab=` pattern exists**: The client page uses `?tab=` for main tabs. The `?subtab=` pattern is new and needs to be introduced.
- **Phase/roadmap data not in builder hook**: `useNutritionBuilder` doesn't fetch roadmap or phase display data. PhaseSelector does its own SWR fetch. The builder hook needs to own this data for the redesigned UI.
- **`generatePlan()` takes only `useCustomMacros: boolean`**: `coachNotes` should be added as hook state (like `phaseId`/`setPhaseId`), not a function parameter.
- **`NutritionPlanHeader` props being removed**: `onShowHistory`, `projectedDate`, `trainingDaysCount`, `restDaysCount` are all going away. New data needed: phase name/dates, roadmap goal, phase goal progress.

### Current nutrition tab component tree
```
TabsContent value="nutrition"
  ├── NutritionCalculatorCardEnhanced (client, onUpdate)
  │     └── NutritionPlanBuilder
  │           ├── NutritionBuilderRightPanel
  │           │     ├── NutritionPlanHeader (with History button -> broken modal)
  │           │     ├── WeeklyNutritionView / NutritionDayAccordion (week/list toggle)
  │           │     └── NutritionPlanHistoryModal (dead code - endpoint missing)
  │           └── NutritionSettingsDrawer
  │                 ├── UnitToggle
  │                 ├── NutritionRegenerationBanner
  │                 ├── NutritionSettingsForm
  │                 ├── PhaseSelector
  │                 ├── NutritionCustomMacrosSection
  │                 ├── NutritionTrainingCaloriesDisplay
  │                 └── CalorieSkewingSection
  └── NutritionHistoryTable (clientId)
        ├── Summary cards (Total Calories, Protein, Carbs, Fat)
        └── HistoryTable (daily nutrition log)
```

### Regeneration flow (current)
1. Coach clicks "Regenerate Plan" button in `NutritionPlanHeader`
2. Opens `NutritionSettingsDrawer` (side drawer, not a dialog)
3. Coach adjusts settings, clicks "Generate Plan" / "Regenerate Plan"
4. `builder.generatePlan(false)` in `use-nutrition-builder.ts` constructs POST body
5. POSTs to `/api/clients/${client.id}/nutrition`
6. Route validates, calls `createNutritionPlan()` from `nutrition-plan-service.ts`
7. Service calls `create_nutrition_plan_atomic` RPC (archives old plan + inserts new + creates daily targets in one transaction)
8. Drawer auto-closes on success

---

## Session 3: Backend (migration, RPC update, guards, metadata)

### Prompt

```
Read CONVENTIONS.md, docs/ARCHITECTURE.md, and the plan file NUTRITION-TAB-IMPROVEMENTS-PLAN.md (start from the "Session 3" section). Pay close attention to the "Codebase Review Findings" section at the top - it documents the actual component names, file paths, data flow, and known issues.

Implement Session 3 (backend) of the nutrition tab improvements. Here are the steps:

1. Create migration `supabase/migrations/069_add_nutrition_plan_metadata.sql`:

   A) Add two nullable columns to `nutrition_plans` table:
   - `coach_notes TEXT` - optional note written by coach at plan creation/regeneration
   - `goal_source TEXT` - "phase" or "client", records which goal drove the calorie calculation
   Add column comments explaining each.

   B) Update the `create_nutrition_plan_atomic` RPC function to accept two new parameters:
   - `p_coach_notes TEXT DEFAULT NULL`
   - `p_goal_source TEXT DEFAULT NULL`
   And write them into the INSERT statement for the new nutrition plan row.

   IMPORTANT: Read the existing RPC definition first (check migration 066 or wherever it's defined). The updated RPC must include ALL existing parameters plus the two new ones. Do not break the existing function signature - add new params with DEFAULT NULL so existing callers still work.

2. Update `types/check-in.ts`:
   - Find the `NutritionPlanHistory` type (~line 593)
   - Add `coachNotes?: string | null` and `goalSource?: "phase" | "client" | null`

3. Update `lib/validations/nutrition.ts`:
   - Add `coachNotes: z.string().max(500).optional()` to `nutritionPlanSchema`

4. Update `services/nutrition-plan-service.ts`:
   - `createNutritionPlan()` must pass `p_coach_notes` and `p_goal_source` to the RPC call
   - Read the function first to understand the current params being passed to the RPC

5. Update `app/api/clients/[id]/nutrition/route.ts`:
   - Accept `coachNotes` from the request body (already validated by updated schema)
   - Pass `coachNotes` and `goalSource` (from the phase goal resolution chain added in session 1) through to `createNutritionPlan()`

6. Add server-side guard in the nutrition route: after `requirePhaseSelection`, if a phaseId is provided and the matched phase status is not "active", return 400 with message "Nutrition plans can only be created for the active phase".

   To implement this, extend the `requirePhaseSelection` return type (in `lib/require-phase-selection.ts`) to also include `phaseStatus` from the matched phase. The nutrition route checks `phaseCheck.phaseStatus !== "active"` when phaseId is present.

   IMPORTANT: Only apply this guard in the nutrition route. Training plan and habit creation routes call requirePhaseSelection too - they should NOT have this restriction.

7. Run `npx tsc --noEmit` and `npx vitest run` to verify. Fix any issues.
```

### Files modified

| File | Change |
|------|--------|
| `supabase/migrations/069_add_nutrition_plan_metadata.sql` | **New** - add columns + update RPC |
| `types/check-in.ts` | Add coachNotes, goalSource to NutritionPlanHistory type |
| `lib/validations/nutrition.ts` | Add coachNotes to nutritionPlanSchema |
| `services/nutrition-plan-service.ts` | Pass new params to RPC call |
| `app/api/clients/[id]/nutrition/route.ts` | Write metadata, add active-phase guard |
| `lib/require-phase-selection.ts` | Add phaseStatus to return type |

---

## Session 4a: Frontend restructure (tabs, card redesign, data fetching, drawer)

### Prompt

```
Read CONVENTIONS.md, docs/ARCHITECTURE.md, DESIGNSYSTEM.md, and the plan file NUTRITION-TAB-IMPROVEMENTS-PLAN.md (start from the "Session 4a" section). Pay close attention to the "Codebase Review Findings" section at the top - it documents the actual component names, file paths, component tree, and data flow.

Implement Session 4a (frontend restructure) of the nutrition tab improvements. The backend is already complete (Session 3 is done). Here are the steps:

IMPORTANT: Read ALL existing nutrition tab files before making changes. The current component tree is documented in the plan. Understand data flow before restructuring.

### Step 1: Lift phase/roadmap data into useNutritionBuilder

The redesigned UI needs phase name, date range, phase goal weight, and roadmap goal in several places (header, metrics, progress line). Currently `useNutritionBuilder` doesn't fetch this data. PhaseSelector does its own SWR fetch for phases.

In `hooks/use-nutrition-builder.ts`:
- Add a SWR call for the active roadmap with phases (use the same API the PhaseSelector currently calls)
- Expose from the hook: `activePhase` (name, dateRange, phaseGoalWeight, phaseGoalBodyFatPercentage, status), `roadmapGoal` (name, long_term_goal, target_end_date), and `phases` (the full Phase[] array)
- The PhaseSelector in the nutrition settings drawer should read phases from the builder context instead of fetching its own. Add an optional `phases` prop to the shared PhaseSelector component - when provided, it uses that data instead of its own SWR fetch. When not provided (training/habits context), it fetches as today. Pass phases from the builder context in the nutrition drawer.

### Step 2: Add coachNotes state to the builder hook

In `hooks/use-nutrition-builder.ts`:
- Add `coachNotes` state (string) and `setCoachNotes` setter, following the same pattern as `phaseId`/`setPhaseId`
- In `generatePlan()`, read `coachNotes` from state and include it in the POST body
- Reset `coachNotes` to empty string after successful generation
- Expose `coachNotes` and `setCoachNotes` from the hook

### Step 3: Coach notes textarea in settings drawer

In `components/clients/nutrition/nutrition-settings-drawer.tsx`:
- Add a textarea BEFORE the Generate/Regenerate button
- Label: "Notes (optional)"
- Placeholder: "Why are you adjusting this plan?"
- Max 500 characters with character count
- Bind to `builder.coachNotes` / `builder.setCoachNotes` from the builder context
- The value is automatically included in the POST because Step 2 reads it in generatePlan()

### Step 4: PhaseSelector activeOnly prop

In `components/clients/shared/phase-selector.tsx`:
- Add an optional `activeOnly?: boolean` prop
- Add an optional `phases?: Phase[]` prop (externally provided phase data)
- When `phases` is provided, use it instead of the internal SWR fetch
- When `activeOnly={true}`, planned and completed phases render as disabled options with a tooltip: "Nutrition plans can only be created for the active phase"
- In the nutrition settings drawer, pass `activeOnly={true}` and `phases={builder.phases}` to PhaseSelector
- Do NOT change training or habit usages of PhaseSelector - they keep current behavior

### Step 5: Data/Plans tab switcher

Add a Data | Plans sub-tab switcher to the nutrition tab content area.

URL pattern: Introduce `?subtab=` as a new URL search param alongside the existing `?tab=`. This is a new pattern - it doesn't exist elsewhere in the codebase yet. Use the same `router.replace` approach as the main tabs but with the `subtab` param.

**Data tab (default view)**:
- Compact phase progress line at the top: "Phase 2: Intensive Cut - 1.8 kg to phase goal" (reads from phase goal via builder context if set, falls back to client goal). When no active phase, show overall goal progress only.
- Summary cards below (Total Calories, Total Protein, Total Carbs, Total Fat with days logged count) - from the existing `NutritionHistoryTable` component
- Daily nutrition log table below - also from `NutritionHistoryTable`

**Plans tab**:
- Inline "no nutrition plan" alert when the active phase has no active nutrition plan (e.g., after a phase transition archives the old plan). Message: "No nutrition plan for this phase - generate one with the Regenerate Plan button." Only show when there's an active phase but no active plan.
- The redesigned nutrition plan builder (see Step 6)
- Plan history placeholder: just render a text "Plan history coming soon" (built in Session 4b)

### Step 6: Nutrition plan card redesign

Modify the existing `components/clients/nutrition/builder/nutrition-builder-right-panel.tsx` and `components/clients/nutrition/display/nutrition-plan-header.tsx`. Do NOT create new wrapper components.

**NutritionPlanHeader - new layout:**
- "Nutrition Targets" title
- Phase pill showing active phase name + date range (e.g., "Phase 2: Intensive Cut (Jan 15 - Feb 28)") - read from builder context `activePhase`
- Regenerate Plan button + Plan active/inactive badge
- REMOVE: History button, `onShowHistory` prop, `projectedDate` prop, `trainingDaysCount` prop, `restDaysCount` prop

**NutritionBuilderRightPanel - new layout:**
- **Metrics row (two items only):**
  - Weekly total: e.g., "18,035 cal"
  - Phase goal progress: e.g., "1.8 kg to go" or "92kg to 90kg by Feb 28" (reads phase goal from builder context when set, falls back to client goal)
- **Secondary line (muted text):**
  - Overall roadmap goal: e.g., "Roadmap goal: 85kg by Sep 2026" - read from builder context `roadmapGoal`
- **Daily schedule:**
  - Keep the existing `WeeklyNutritionView` day cards
  - REMOVE: Week/List toggle entirely
  - REMOVE: `NutritionDayAccordion` import and rendering path

**Remove from current layout:**
- The three-section summary bar (Weekly Total / Progress / Schedule)
- Schedule badge (5 training / 2 rest)
- "Projected goal date" standalone line
- List view toggle and NutritionDayAccordion
- History button and NutritionPlanHistoryModal trigger

### Step 7: Cleanup

1. Delete `components/clients/nutrition/display/nutrition-day-accordion.tsx` (list view killed - only imported in nutrition-builder-right-panel.tsx)
2. Remove NutritionPlanHistoryModal import and trigger from NutritionBuilderRightPanel (the modal file itself is deleted in Session 4b when the replacement is built)
3. Clean up unused imports from all modified files

### Step 8: Verify

Run `npx tsc --noEmit` and `npx vitest run`. Fix any issues.
```

### Files modified

| File | Change |
|------|--------|
| `hooks/use-nutrition-builder.ts` | Add roadmap/phase SWR fetch, coachNotes state, expose new data |
| `components/clients/nutrition/builder/nutrition-settings-drawer.tsx` | Add coach notes textarea, pass phases + activeOnly to PhaseSelector |
| `components/clients/shared/phase-selector.tsx` | Add `activeOnly` and `phases` props |
| Client page nutrition tab area | Add Data/Plans sub-tab switcher with `?subtab=`, restructure layout |
| `components/clients/nutrition/display/nutrition-plan-header.tsx` | Redesign: phase pill, remove History/projectedDate/schedule props |
| `components/clients/nutrition/builder/nutrition-builder-right-panel.tsx` | Redesign: two metrics, secondary line, kill list view + toggle |
| `components/clients/nutrition/display/nutrition-day-accordion.tsx` | **Deleted** - list view killed |
| Data sub-tab component | Summary cards + log table + compact progress line |

---

## Session 4b: Plan history (endpoint, component, dead code cleanup)

### Prompt

```
Read CONVENTIONS.md, docs/ARCHITECTURE.md, DESIGNSYSTEM.md, and the plan file NUTRITION-TAB-IMPROVEMENTS-PLAN.md (start from the "Session 4b" section). Pay close attention to the "Codebase Review Findings" section.

Implement Session 4b (plan history) of the nutrition tab improvements. Sessions 3 and 4a are already complete. The nutrition tab now has Data/Plans sub-tabs, the card is redesigned, and there's a placeholder "Plan history coming soon" on the Plans tab. Here are the steps:

IMPORTANT: Read the current state of the nutrition tab files first, since Session 4a modified them.

### Step 1: History API endpoint

Create `app/api/clients/[id]/nutrition/history/route.ts`:
- Follow middleware ordering: coachApiRateLimit > auth via getAuthenticatedCoachId() > IDOR ownership check (verify coach owns the client)
- Query all nutrition_plans for the client (active + archived), include coach_notes, goal_source, phase_id, created_at, status, and all calorie/macro fields
- Join with phases table for phase name, start_date, end_date, phase_goal_weight, phase_goal_body_fat_percentage, status as phase_status
- Query body_metrics for weight at phase start and phase end dates (for completed phases) and current weight (for active phase)
- Return data structured as:
  - Array of phase groups, ordered by phase start_date DESC (newest first)
  - Each group: { phaseId, phaseName, dateRange, phaseGoalWeight, startWeight, endWeight (or currentWeight), phaseStatus, plans: [...] }
  - Plans within each group ordered by created_at ASC
  - Include a group with phaseId: null for pre-roadmap plans (phase_id IS NULL)
- Response format: `{ success: true, data: { groups: [...] } }`

### Step 2: Phase-grouped plan history component

Create `components/clients/nutrition/nutrition-plan-history.tsx`:
- Fetches from `/api/clients/${clientId}/nutrition/history` via SWR (coach-side pattern: revalidateOnFocus: false)
- Renders as accordion sections grouped by phase
- Use isLoading for skeleton, not isValidating

**Phase group header (each accordion section):**
- Phase name + date range (e.g., "Phase 2: Intensive Cut - Jan 15 to Feb 28")
- Weight context line: Start weight -> Phase goal weight (if set) or Client goal weight -> Actual end weight
  - For completed phases: "85kg -> Goal: 82kg -> Actual: 83.1kg"
  - For active phase: "83.1kg -> Goal: 80kg -> Current: 81.5kg"
- Hit/missed indicator for completed phases (green check if actual end weight <= phase goal weight for deficit goals, or >= for surplus goals)

**Plan rows within each phase group:**
- Date created + label derived from order within group (first plan = "Initial", subsequent = "Revision 1", "Revision 2", etc. - derive from array index, don't store a column)
- Calories, Protein (g), Carbs (g), Fat (g) in a compact row
- Goal source badge: "Phase goal" or "Client goal" (reads goal_source column, show nothing if null for pre-migration plans)
- Coach notes displayed below the row when present (muted/italic text, collapsed by default if long)
- Active plan has a green "Active" badge, archived plans are muted

**Pre-roadmap section:**
- Group with phaseId: null, labelled "Pre-roadmap"
- Same plan row format but no weight context line in the header

**Empty state:**
- "No nutrition plan history yet"

### Step 3: Wire into Plans sub-tab

Replace the "Plan history coming soon" placeholder (from Session 4a) with the new `NutritionPlanHistory` component. Pass the clientId prop.

### Step 4: Delete dead code

1. Delete `components/clients/nutrition/nutrition-plan-history-modal.tsx` (dead code - its endpoint never existed, now fully replaced by inline history)
2. Remove any remaining references to NutritionPlanHistoryModal in other files (check imports)
3. Clean up unused imports

### Step 5: Verify

Run `npx tsc --noEmit` and `npx vitest run`. Fix any issues.
```

### Files modified

| File | Change |
|------|--------|
| `app/api/clients/[id]/nutrition/history/route.ts` | **New** - history endpoint with phase joins and body metrics |
| `components/clients/nutrition/nutrition-plan-history.tsx` | **New** - phase-grouped inline plan history |
| Plans sub-tab area | Replace placeholder with NutritionPlanHistory component |
| `components/clients/nutrition/nutrition-plan-history-modal.tsx` | **Deleted** - dead code replaced |
| Any files importing the deleted modal | Remove unused imports |

---

## Key Design Decisions

- **Data tab is the default** - coaches click Nutrition to see what the client did, not the plan settings
- **Weekly total stays** - coaches think in weekly calorie budgets
- **List view killed** - not useful enough to justify the toggle
- **Phase goal is primary progress indicator** - shows the immediate target, not the distant roadmap goal
- **Roadmap goal shown as secondary muted line** - big-picture context
- **Coach notes as hook state** - follows the phaseId/setPhaseId pattern. State in hook, drawer sets it, generatePlan reads it.
- **Phase/roadmap data lifted into useNutritionBuilder** - one SWR call, shared through existing context. PhaseSelector accepts optional `phases` prop to avoid duplicate fetch in nutrition context.
- **goal_source persisted** - written at creation so history shows what drove each plan
- **Revision labels derived, not stored** - count plans per phase by created_at order (array index)
- **Active-phase-only guard** - server guard in nutrition route + PhaseSelector `activeOnly` prop. Training and habits NOT restricted.
- **Projected goal date replaced** - phase end date is the implicit deadline
- **Dead code removed** - NutritionPlanHistoryModal (endpoint never existed) and NutritionDayAccordion replaced by working solutions
- **Activation banner not used** - gated to onboardingStatus, won't show post-activation. Inline alert on Plans sub-tab used instead.
- **RPC updated, not just table** - create_nutrition_plan_atomic must accept new params since that's where the insert happens
- **`?subtab=` is a new URL pattern** - introduced for nutrition Data/Plans tabs, uses same router.replace approach as existing `?tab=`
- **Session 4 split into 4a/4b** - 4a is the structural change (tabs, card redesign, data fetching). 4b is additive (history endpoint + component). If 4a has issues, fix before layering on complexity.

---

## Verification

**Session 3:**
- TypeScript: `npx tsc --noEmit` passes
- Tests: `npx vitest run` passes, update mocks for new fields and RPC params
- Manual: Attempt to create nutrition plan for a planned phase via API, verify 400 error
- Manual: Create a nutrition plan with coach notes, verify notes and goal_source are stored in DB
- Manual: Verify existing nutrition plan creation still works (RPC backward compat with DEFAULT NULL)

**Session 4a:**
- TypeScript: `npx tsc --noEmit` passes
- Tests: `npx vitest run` passes
- Manual flow:
  - Click Nutrition tab, verify Data sub-tab is default showing summary cards and log table
  - Verify compact phase progress line shows phase goal (not roadmap goal) when set
  - Switch to Plans sub-tab, verify redesigned builder layout
  - Verify phase name and date range shown on header as a pill
  - Verify metrics row shows weekly total and phase goal progress only
  - Verify roadmap goal shown as secondary muted line
  - Verify Week/List toggle is gone, only week view renders
  - Open settings drawer, verify coach notes textarea is present
  - Verify PhaseSelector only allows active phase selection in nutrition context
  - Regenerate a plan with a coach note, verify it saves successfully
  - Verify "No nutrition plan" alert shows when active phase has no plan
  - Verify History button no longer exists on the header
  - Navigate to Training Plan tab, verify PhaseSelector still shows all selectable phases (no activeOnly restriction)

**Session 4b:**
- TypeScript: `npx tsc --noEmit` passes
- Tests: `npx vitest run` passes
- Manual flow:
  - Switch to Plans sub-tab, verify plan history renders below the builder card
  - Verify plans are grouped by phase with phase name + date range headers
  - Verify weight context shows start -> goal -> actual/current per phase
  - Verify plan rows show date, revision label, calories, macros
  - Verify goal source badge shows "Phase goal" or "Client goal"
  - Verify coach notes display below relevant plan rows
  - Verify active plan has "Active" badge, archived plans are muted
  - Regenerate a plan, verify history updates (new "Revision" appears)
  - Verify pre-roadmap plans appear under "Pre-roadmap" group
  - Verify NutritionPlanHistoryModal is fully removed (no dead code)