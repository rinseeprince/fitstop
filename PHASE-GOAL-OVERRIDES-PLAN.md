# Phase-Level Goal Overrides - Implementation Plan

## Context

When a coach creates a nutrition plan linked to a phase, the calorie calculator always reads the client's overall goal from `client_goals`. But different phases need different targets - a 2-week intro might need maintenance, a 6-week intensive needs a deficit, a taper needs a surplus. The coach should be able to set a phase-specific goal weight that overrides the overall client goal for nutrition calorie calculation.

**Design**: Add dedicated nullable columns to `phases` (keeping `phase_goals_snapshot` untouched as a historical record of the client's overall goal at phase creation time). When NULL, the system falls back to the client's overall goal.

---

## Session 1: Backend (migration, types, services, API logic)

### Prompt

```
Read CONVENTIONS.md, docs/ARCHITECTURE.md, and the plan file PHASE-GOAL-OVERRIDES-PLAN.md. Implement Session 1 (backend) of the phase goal overrides feature. Here are the steps:

1. Create migration `supabase/migrations/068_add_phase_goal_columns.sql` adding two nullable columns to `phases`: `phase_goal_weight NUMERIC` and `phase_goal_body_fat_percentage NUMERIC`. Add column comments.

2. Update types in `types/roadmap.ts`:
   - `Phase` type: add `phaseGoalWeight?: number | null` and `phaseGoalBodyFatPercentage?: number | null`
   - `PhaseRow` type: add `phase_goal_weight: number | null` and `phase_goal_body_fat_percentage: number | null`
   - `PhaseReviewData` type: add `phaseGoals: { goalWeight: number | null; goalBodyFatPercentage: number | null } | null`

3. Update `mapPhaseRow()` in `services/roadmap-service.ts` to map the new fields.

4. Update `createPhaseSchema` in `lib/validations/roadmap.ts` to add:
   - `phaseGoalWeight: z.number().min(20).max(700).nullable().optional()`
   - `phaseGoalBodyFatPercentage: z.number().min(3).max(60).nullable().optional()`
   (updatePhaseSchema derives via .partial() so inherits automatically)

5. Update `services/phase-service.ts`:
   - `createPhase()`: extend data param, add new fields to insert object
   - `updatePhase()`: extend data param, add status guard that rejects goal edits when phase.status !== "planned" (throw Error "Phase goals can only be edited while the phase is in planned status"), add new fields to updateData block

6. Extend `lib/require-phase-selection.ts`:
   - Expand `PhaseCheckOk` type to include `phaseGoalWeight`, `phaseGoalBodyFatPercentage`, and `phaseEndDate`
   - At the success return (line 67), find the matched phase from the selectable array and attach its goal data and endDate
   - No-roadmap path returns undefined for the new fields

7. Update `app/api/clients/[id]/nutrition/route.ts` (core change):
   - After requirePhaseSelection (line 147), add goal resolution logic:
     - If phaseCheck.phaseGoalWeight is set, use it as effectiveGoalWeightKg (already in kg, no unit conversion needed) and use phaseCheck.phaseEndDate as effectiveGoalDeadline
     - Otherwise fall back to currentGoals?.goalWeight with weightToKg conversion
   - Replace all downstream references to goalWeight/goalWeightKg/body.goalDeadline with the effective values in both the custom macros path and calculated plan path
   - Include goalSource ("phase" | "client") in the response

8. Update `services/phase-transition-service.ts`:
   - In getPhaseReviewData() return object, add phaseGoals field from phase data
   - In transitionPhase(), persist phaseGoals into the phase_summary JSONB so the client completion card can read it

9. Update docs/ARCHITECTURE.md to document the new columns under the Phases section.

10. Run `npx tsc --noEmit` and `npx vitest run` to verify. Fix any issues.
```

### Files modified

| File | Change |
|------|--------|
| `supabase/migrations/068_add_phase_goal_columns.sql` | **New** - add columns |
| `types/roadmap.ts` | Add fields to Phase, PhaseRow, PhaseReviewData |
| `services/roadmap-service.ts` | Add fields to mapPhaseRow() |
| `lib/validations/roadmap.ts` | Add fields to createPhaseSchema |
| `services/phase-service.ts` | Update createPhase(), updatePhase() with status guard |
| `lib/require-phase-selection.ts` | Extend return type with phase goal data |
| `app/api/clients/[id]/nutrition/route.ts` | Goal resolution logic |
| `services/phase-transition-service.ts` | Add phaseGoals to review data + phase_summary |
| `docs/ARCHITECTURE.md` | Document new columns |

---

## Session 2: Frontend (UI components)

### Prompt

```
Read CONVENTIONS.md, docs/ARCHITECTURE.md, DESIGNSYSTEM.md, and the plan file PHASE-GOAL-OVERRIDES-PLAN.md. Implement Session 2 (frontend) of the phase goal overrides feature. The backend is already complete (Session 1 is done).

IMPORTANT: Phase goal weight is stored in kg in the database, but all UI inputs and displays must be unit-aware using the client's weightUnit. This matches the existing pattern in edit-client-dialog.tsx and add-client-manual-form.tsx: store normalized (kg), display localized (client's unit). Use weightToKg() on submit to convert input to kg, and kgToLbs() when displaying stored values for imperial clients.

Here are the steps:

1. Update `components/clients/roadmap/add-phase-dialog.tsx`:
   - The dialog needs access to the client's weightUnit (pass as prop or read from client data available in the parent)
   - Add two useState fields: phaseGoalWeight and phaseGoalBodyFatPercentage (both string, parsed to number on submit)
   - Add a "Phase Goals (optional)" section with number inputs for "Goal Weight ({weightUnit})" and "Goal Body Fat (%)"
   - Add helper text: "Leave blank to use the client's overall goal"
   - On submit, convert phaseGoalWeight to kg via weightToKg() before including in POST body
   - Reset on form reset

2. Create `components/clients/roadmap/edit-phase-dialog.tsx` (new file):
   - Follow the exact pattern of add-phase-dialog.tsx (controlled dialog, useState fields, toast pattern)
   - Takes phase: Phase, clientId: string, and weightUnit: "lbs" | "kg" props
   - Pre-fills all fields from phase. For phaseGoalWeight (stored in kg), convert to client's unit for display using kgToLbs() when weightUnit is "lbs"
   - On submit, convert back to kg via weightToKg() before including in PUT body
   - Submits PUT to /api/clients/${clientId}/roadmap/phases/${phase.id}
   - Goal inputs are DISABLED when phase.status !== "planned" with helper text: "Goals cannot be changed after a phase has started"

3. Update `components/clients/roadmap/phase-card.tsx`:
   - In expanded section, show phase goals when set — display weight in client's weightUnit (convert from stored kg), BF% as-is
   - Add an "Edit" button (Pencil icon from lucide-react) for planned/active phases, wired to EditPhaseDialog
   - Pass weightUnit to EditPhaseDialog

4. Update `components/clients/roadmap/phase-review-stats.tsx`:
   - When data.phaseGoals is present, add a "Phase Goal Progress" section between the duration line and body metrics grid
   - Show goal weight vs actual end weight (both displayed in client's weightUnit) and goal BF vs actual end BF using the existing MetricCard component

5. Update `components/daily-pulse/phase-completion-card.tsx`:
   - Update PhaseCompletionResponse type to include phaseGoals in phaseSummary
   - When phaseSummary.phaseGoals?.goalWeight exists, show "Goal: X {unit} | Actual: Y {unit}" alongside the existing weight change stat (display in client's unit)

6. Update `components/clients/shared/phase-selector.tsx`:
   - Below the select dropdown, when a phase is selected and has phaseGoalWeight, show: "Phase goal: {weight} {weightUnit} by {endDate}" (convert stored kg to client's unit for display)
   - When no phase goal override: "Using client's overall goal"
   - The PhaseSelector already has full Phase[] data from SWR, no extra fetch needed

7. Run `npx tsc --noEmit` and `npx vitest run` to verify. Fix any issues.
```

### Files modified

| File | Change |
|------|--------|
| `components/clients/roadmap/add-phase-dialog.tsx` | Add unit-aware goal inputs, convert to kg on submit |
| `components/clients/roadmap/edit-phase-dialog.tsx` | **New** - edit dialog with unit-aware, status-aware goal inputs |
| `components/clients/roadmap/phase-card.tsx` | Show goals in client's unit in expanded view + edit button |
| `components/clients/roadmap/phase-review-stats.tsx` | Coach: show phase goal vs actual in client's unit |
| `components/daily-pulse/phase-completion-card.tsx` | Client: show phase goal vs actual in client's unit |
| `components/clients/shared/phase-selector.tsx` | Goal source indicator with unit-aware display |

---

## Session 3: Tests

### Prompt

```
Read CONVENTIONS.md, docs/ARCHITECTURE.md, and the plan file PHASE-GOAL-OVERRIDES-PLAN.md. Implement Session 3 (tests) of the phase goal overrides feature. Sessions 1 and 2 are complete. Here are the steps:

1. Add unit tests for the status guard in `services/phase-service.test.ts`:
   - Test that updatePhase() with phaseGoalWeight/phaseGoalBodyFatPercentage succeeds when phase.status === "planned"
   - Test that updatePhase() with phaseGoalWeight/phaseGoalBodyFatPercentage throws "Phase goals can only be edited while the phase is in planned status" when phase.status === "active"
   - Test that updatePhase() with phaseGoalWeight/phaseGoalBodyFatPercentage throws the same error when phase.status === "completed"
   - Test that non-goal fields (name, notes) can still be updated on active phases (guard only applies to goal fields)

2. Add unit tests for goal resolution in `app/api/clients/[id]/nutrition/route.test.ts`:
   - Test case: phase has phaseGoalWeight set → effectiveGoalWeightKg uses phase value (no unit conversion since it's already kg), effectiveGoalDeadline uses phase endDate, response includes goalSource: "phase"
   - Test case: phase has null phaseGoalWeight → falls back to currentGoals.goalWeight with weightToKg conversion, response includes goalSource: "client"
   - Test case: no roadmap (requirePhaseSelection returns phaseGoalWeight undefined) → falls back to currentGoals.goalWeight, response includes goalSource: "client"
   - For each case, verify the correct goalWeightKg and goalDeadline values are passed to generateNutritionPlan / createNutritionPlan

3. Add API-level tests for the PUT phase route in `app/api/clients/[id]/roadmap/phases/[phaseId]/route.test.ts`:
   - Test that PUT with phaseGoalWeight and phaseGoalBodyFatPercentage on a planned phase succeeds and returns the updated values
   - Test that PUT with phaseGoalWeight on an active phase returns 400 with the status guard error message
   - Test that PUT with phaseGoalWeight: null (clearing the override) succeeds on a planned phase

4. Run `npx vitest run` to verify all tests pass. Fix any failures.
```

### Files modified

| File | Change |
|------|--------|
| `services/phase-service.test.ts` | Add status guard tests for goal field edits |
| `app/api/clients/[id]/nutrition/route.test.ts` | Add goal resolution tests (phase goal, fallback, no roadmap) |
| `app/api/clients/[id]/roadmap/phases/[phaseId]/route.test.ts` | Add PUT tests for phase goal fields with status guard |

---

## Key Design Decisions

- **Phase goal weight stored in kg, displayed in client's unit** - store normalized (kg), display localized (client's weightUnit). Matches the existing pattern in edit-client-dialog.tsx and add-client-manual-form.tsx. UI converts via weightToKg() on submit and kgToLbs() on display.
- **Phase end_date as implicit deadline** - no separate phase_goal_deadline column needed
- **NULL = fallback** - both columns being NULL means "use the client's overall goal"
- **Status guard** - phase goals only editable in "planned" status (service rejects, UI disables)
- **No extra DB query** - requirePhaseSelection already has phase data in memory, we extend its return type
- **phase_goals_snapshot untouched** - continues to capture the client's overall goal at phase creation time for historical reference
