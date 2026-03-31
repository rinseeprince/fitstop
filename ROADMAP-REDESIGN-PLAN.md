# Roadmap Page Redesign + Milestones - Session Plan

7 sessions, each independently testable. Execute in order.

---

## Session 1: Database Migration + Types

**Scope:** Add milestones JSONB column to phases table, update all TypeScript types, mappers, and Zod schemas.

**Files to create:**
- `supabase/migrations/070_add_milestones_to_phases.sql`

**Files to modify:**
- `types/roadmap.ts`
- `services/roadmap-service.ts`
- `services/phase-service.ts`
- `lib/validations/roadmap.ts`

**Verify:** `npx tsc --noEmit` passes, `npx vitest run` passes, existing roadmap API still works.

### Prompt

```
Read CONVENTIONS.md, docs/ARCHITECTURE.md, and docs/newdesignsystem.md before starting.

Add a milestones feature to roadmap phases via a JSONB column. This is a data-layer-only session - no UI changes.

1. Create migration `supabase/migrations/070_add_milestones_to_phases.sql`:
   - Add `milestones JSONB NOT NULL DEFAULT '[]'` to the `phases` table
   - Add a comment: 'Array of {id, text, completed, completed_at} milestone objects'

2. Update `types/roadmap.ts`:
   - Add a `Milestone` type: `{ id: string; text: string; completed: boolean; completed_at: string | null }`
   - Add `milestones: Milestone[]` to the `Phase` type
   - Add `milestones: { id: string; text: string; completed: boolean; completed_at: string | null }[] | null` to `PhaseRow`

3. Update `services/roadmap-service.ts`:
   - Import the `Milestone` type from `types/roadmap`
   - Update `mapPhaseRow()` to map milestones: `milestones: (row.milestones as Milestone[]) ?? []`

4. Update `services/phase-service.ts`:
   - In `createPhase()`, pass `milestones` through to the Supabase insert if provided
   - In `updatePhase()`, pass `milestones` through to the Supabase update if provided

5. Update `lib/validations/roadmap.ts`:
   - Add a `milestoneSchema` object: `z.object({ id: z.string().uuid(), text: z.string().min(1).max(500), completed: z.boolean(), completed_at: z.string().nullable() })`
   - Add `milestones: z.array(milestoneSchema).max(20).optional()` to both `createPhaseSchema` and `updatePhaseSchema`

6. Update `docs/ARCHITECTURE.md`:
   - Add `milestones` to the phases table field list in the Roadmap/Phase Architecture section
   - Note: "milestones JSONB - array of milestone objects scoped to the phase"

Run `npx tsc --noEmit` to verify no type errors. Run `npx vitest run` to verify no test regressions.
```

---

## Session 2: Dark Summary Card + Phase Card Headers

**Scope:** Redesign the roadmap page layout with a Teal Summit dark summary card at the top and redesigned phase card headers (collapsed view only). No expanded content changes yet.

**Files to create:**
- `components/clients/roadmap/roadmap-summary-strip.tsx`

**Files to modify:**
- `components/clients/roadmap/roadmap-tab-content.tsx`
- `components/clients/roadmap/phase-card.tsx`

**Reference:** `components/clients/habits/habits-summary-strip.tsx` for the dark summary card pattern.

**Verify:** Roadmap page renders with dark summary card, phase cards show correct headers with status badges and borders, expand/collapse works, all action buttons (activate, complete, edit) still function.

### Prompt

```
Read CONVENTIONS.md, docs/ARCHITECTURE.md, and docs/newdesignsystem.md before starting. Read `components/clients/habits/habits-summary-strip.tsx` as a reference for the dark summary card pattern. Read `components/clients/roadmap/roadmap-tab-content.tsx` and `components/clients/roadmap/phase-card.tsx` to understand the current implementation.

Redesign the Roadmap page to match the Teal Summit design system. This session covers the summary card and phase card headers only (no expanded content changes).

### 1. Create `components/clients/roadmap/roadmap-summary-strip.tsx`

Follow the exact pattern from `habits-summary-strip.tsx` (StatColumn helper + main component).

Dark card with `bg-[#0f2027] rounded-[6px]` containing:
- Top section: "ACTIVE PROGRAMME" label (10px uppercase, `text-[rgba(255,255,255,0.35)]`) + programme name as large heading (22px, white, font-weight 700) + active status badge (teal bg with dot)
- Progress bar showing timeline progress across all phases. Segmented by phase count. Fill uses `linear-gradient(90deg, #0d9488, #0fb9ac)`. Show start and end dates below in `font-mono-display text-[rgba(255,255,255,0.3)]`
- Stats row (4-column grid below a `border-t border-[rgba(255,255,255,0.06)]` divider):
  - Start Weight: large number (26px, font-mono-display, white) with "kg" or "lbs" suffix in muted
  - Current Weight: same styling, with delta shown in brand teal below (e.g. "-0.5kg")
  - Goal Weight: same styling, with "X kg to go" in warning colour (`text-[#d97706]` on `bg-[rgba(245,158,11,0.07)]`)
  - Progress: "X/Y phases" with completed count

Props: roadmap (name, dates, phases), client weight data (startWeight, currentWeight, goalWeight, weightUnit).

### 2. Redesign `components/clients/roadmap/roadmap-tab-content.tsx`

- Replace the plain Card header with `RoadmapSummaryStrip`
- The component needs client body metrics for the summary strip. Add a second SWR call to fetch the client's body metrics: use the existing `/api/clients/${client.id}/body-metrics?limit=1` endpoint for current weight, and derive start weight from the roadmap's phase data or the client object
- Below the summary strip, add the phases section with "PHASES" label (10px uppercase, `text-[#93b0b4]`) + count badge (`bg-[rgba(13,148,136,0.05)] text-[#0d9488]`) + "Add Phase" button on the right (white bg, `border border-[rgba(13,148,136,0.08)]`, `text-[#5a7d82]`, hover turns teal)
- Phase cards in a `space-y-2` container
- Empty states use Teal Summit muted colours (`text-[#93b0b4]` for muted, `text-[#0c1a1e]` for headings)
- NO Tailwind semantic greys (no text-muted-foreground, no bg-muted). Use explicit Teal Summit hex values

### 3. Redesign `components/clients/roadmap/phase-card.tsx`

Phase header (always visible, clickable to expand/collapse):
- Replace Card with a plain `div` using `bg-white rounded-[6px]`
- Border styling by status:
  - Active: `border border-[rgba(13,148,136,0.08)]` (solid)
  - Planned: `border border-dashed border-[rgba(13,148,136,0.10)]` with `opacity-[0.85]`
  - Completed: `border border-[rgba(13,148,136,0.08)]` (solid, same as active)
- Header row contains:
  - Chevron icon (ChevronRight from lucide, rotates 90deg on expand with `transition-transform duration-200`)
  - Phase name (14px, font-weight 600, `text-[#0c1a1e]`)
  - Status badge using existing Badge component with teal-appropriate variants
  - Goal targets in `font-mono-display text-[#93b0b4]` (e.g. "Goal: 94.5kg / 16%") - only if phase has goal overrides
  - Date range with Calendar icon (`font-mono-display text-[#93b0b4]`)
  - Week progress badge for active phase (e.g. "2/6 weeks", `bg-[rgba(13,148,136,0.05)] text-[#0d9488]`)
  - Edit (Pencil) icon button
  - Action button: "Complete Phase" for active, "Activate" for planned (secondary button: white bg, teal-tinted border)
- Active phase auto-expanded (use `useState(phase.status === "active")` as initial state)
- Keep expanded content as-is for now (will be redesigned in Session 3)

All components must stay under 250 lines. Use NO Tailwind semantic colours - all explicit Teal Summit values.

Run `npx tsc --noEmit` to verify.
```

---

## Session 3: Expanded Phase Content + Weekly Data API

**Scope:** Build the expanded content area for phase cards (description/objectives, milestones display, weekly check-in data table) and the API endpoint to fetch weekly aggregated data.

**Files to create:**
- `components/clients/roadmap/phase-expanded-content.tsx`
- `components/clients/roadmap/phase-weekly-table.tsx`
- `services/phase-weekly-data-service.ts`
- `app/api/clients/[id]/roadmap/phases/[phaseId]/weekly-data/route.ts`

**Files to modify:**
- `components/clients/roadmap/phase-card.tsx` (wire up new expanded content)

**Reference:** `services/check-in-service.ts` for check-in queries, `services/phase-transition-service.ts` for how phase data is queried.

**Verify:** Expand an active phase, see description/objectives/milestones displayed read-only, see weekly data table with real check-in data. Expand a planned phase with no data - see appropriate empty states.

### Prompt

```
Read CONVENTIONS.md, docs/ARCHITECTURE.md, and docs/newdesignsystem.md before starting. Read `services/check-in-service.ts` to understand how check-ins are queried and what fields are available. Read `services/phase-transition-service.ts` for phase data patterns. Read `components/clients/roadmap/phase-card.tsx` to see the current expanded section.

Build the expanded content for phase cards and the API to fetch weekly check-in data.

### 1. Create `services/phase-weekly-data-service.ts`

Export a function `getPhaseWeeklyData(phaseId: string, clientId: string)` that:
- Fetches the phase record to get start_date and end_date (or current date if no end_date)
- Queries the `check_ins` table directly. Each check-in already represents one check-in period aligned to the client's expectedCheckInDay, with `period_start` and `period_end` stored on the record
- Filter check-ins by `client_id` where `period_start >= phase.start_date` and `period_end <= phase.end_date` (or current date if no end_date)
- For each check-in, extract:
  - `weight` from the check-in's body metrics fields
  - `nutrition_days_on_target` for nutrition adherence
  - Training session count from the related `check_in_session_completions` records (or from the check-in's training fields if available)
- Use the stored `period_start` and `period_end` directly - do not recalculate week boundaries. This eliminates ISO week misalignment since check-ins already store their aligned period boundaries
- Order results by `period_start` ascending and derive `weekNumber` from the row index (1-based)
- Return type: `PhaseWeeklyDataRow[]` where each row is:
  ```typescript
  {
    weekNumber: number;
    periodStart: string;              // stored period_start from check-in
    periodEnd: string;                // stored period_end from check-in
    checkInDate: string;              // date the check-in was submitted (created_at)
    weight: number | null;            // reported weight
    nutritionDaysOnTarget: number | null;
    trainingSessions: number;         // completed sessions that period
  }
  ```
- Use `supabaseAdmin` (coach-side cross-table query)
- Keep under 300 lines

### 2. Create API route `app/api/clients/[id]/roadmap/phases/[phaseId]/weekly-data/route.ts`

GET handler only. Follow the exact middleware pattern from the existing `app/api/clients/[id]/roadmap/phases/[phaseId]/route.ts`:
1. `coachApiRateLimit(request)`
2. `getAuthenticatedCoachId()` + ownership check
3. Call `getPhaseWeeklyData(phaseId, clientId)`
4. Return `{ success: true, data: weeklyData }`

### 3. Create `components/clients/roadmap/phase-weekly-table.tsx`

A table component that receives weekly data as props and renders:
- "WEEKLY CHECK-INS" label (10px uppercase, `text-[#93b0b4]`, tracking-[0.06em])
- Table with columns:
  - Week # (number)
  - Period (periodStart to periodEnd, dd/mm format, font-mono-display)
  - Weight (reported weight in client's unit, font-mono-display)
  - Nutrition (days on target, font-mono-display)
  - Sessions (training session count, font-mono-display)
- All numerical values in `font-mono-display`
- Null/missing values show "—" in `text-[#93b0b4]`
- Row dividers: `border-b border-[rgba(13,148,136,0.08)]`
- Empty state: "No check-in data yet" in italic `text-[#93b0b4]`
- Props: `{ data: PhaseWeeklyDataRow[]; weightUnit: "lbs" | "kg" }`

### 4. Create `components/clients/roadmap/phase-expanded-content.tsx`

Renders below the phase header when expanded. Separated from header by `border-t border-[rgba(13,148,136,0.08)]`.

Three sections stacked vertically:

1. **Description & Objectives** (only if either exists):
   - Two columns: "DESCRIPTION" label + text, "OBJECTIVES" label + text
   - Labels: 10px uppercase `text-[#93b0b4]`
   - Text: 12.5px `text-[#0c1a1e]`
   - Bottom border separator

2. **Milestones** (read-only display for now, toggle comes in Session 5):
   - Flag icon + "MILESTONES" label + count badge (e.g. "1/3", `bg-[rgba(13,148,136,0.05)] text-[#0d9488]`)
   - Each milestone: circle icon (empty for incomplete, filled teal CheckCircle2 for complete) + text
   - Completed milestones: `line-through text-[#93b0b4]`
   - Empty state: "No milestones" in italic `text-[#93b0b4]`

3. **Weekly Data Table**:
   - Render `PhaseWeeklyTable` component
   - Fetch data via SWR from `/api/clients/${clientId}/roadmap/phases/${phase.id}/weekly-data` only when this component mounts (lazy load)
   - Show Skeleton while loading

Props: `{ phase: Phase; clientId: string; weightUnit: "lbs" | "kg" }`

### 5. Update `components/clients/roadmap/phase-card.tsx`

Replace the existing expanded content (the div with description/objectives/duration) with the new `PhaseExpandedContent` component.

All components must stay under 250 lines. All services under 300 lines. Use explicit Teal Summit colours throughout.

Run `npx tsc --noEmit` to verify.
```

---

## Session 4: Milestones CRUD in Add/Edit Phase Dialogs

**Scope:** Add milestone management UI to the add-phase and edit-phase dialogs so coaches can create and manage milestones when creating or editing phases.

**Files to create:**
- `components/clients/roadmap/milestone-input-list.tsx`

**Files to modify:**
- `components/clients/roadmap/add-phase-dialog.tsx`
- `components/clients/roadmap/edit-phase-dialog.tsx`

**Verify:** Create a new phase with milestones - verify they appear in the expanded phase card. Edit a phase, see pre-populated milestones, add/remove, save - verify changes persist.

### Prompt

```
Read CONVENTIONS.md and docs/newdesignsystem.md before starting. Read `components/clients/roadmap/add-phase-dialog.tsx` and `components/clients/roadmap/edit-phase-dialog.tsx` to understand the current dialog implementation. Read `types/roadmap.ts` for the Milestone type.

Add milestone management to the phase dialogs.

### 1. Create `components/clients/roadmap/milestone-input-list.tsx`

A reusable controlled component for managing a list of milestones.

Props:
```typescript
{
  milestones: Milestone[];
  onChange: (milestones: Milestone[]) => void;
  disabled?: boolean;
}
```

UI:
- "Milestones (optional)" label in 10px uppercase `text-[#93b0b4]`
- Text input + "Add" button row. Input has `rounded-[6px] border-[rgba(13,148,136,0.08)]` focus ring teal. Button is secondary style (white bg, teal border, `text-[#5a7d82]`). Also add on Enter keypress.
- Each milestone renders as a row: text (12.5px `text-[#0c1a1e]`) + X button (`text-[#93b0b4]` hover `text-[#c06060]`) to remove
- On add: create milestone with `id: crypto.randomUUID()`, `completed: false`, `completed_at: null`
- Max 20 milestones (disable add when at limit, show "Maximum 20 milestones" hint)
- Empty state: no extra message needed, just the input

### 2. Modify `components/clients/roadmap/add-phase-dialog.tsx`

- Add `milestones` state: `useState<Milestone[]>([])`
- Import and render `MilestoneInputList` below the Objectives textarea
- Include `milestones` in the POST body to `/api/clients/${clientId}/roadmap/phases`
- Reset milestones to `[]` on successful creation and when dialog closes
- Import `Milestone` type from `types/roadmap`

### 3. Modify `components/clients/roadmap/edit-phase-dialog.tsx`

- Add `milestones` state: `useState<Milestone[]>(phase.milestones ?? [])`
- Sync milestones state when `phase` prop changes (in the existing useEffect that syncs form state)
- Import and render `MilestoneInputList` below the Objectives textarea
- Include `milestones` in the PUT body
- Milestones should be editable regardless of phase status (unlike phase goals which lock when active)
- Import `Milestone` type from `types/roadmap`

All files must stay under 250 lines. Use explicit Teal Summit styling on the new component.

Run `npx tsc --noEmit` to verify.
```

---

## Session 5: Complete Phase Drawer Redesign

**Scope:** Redesign the phase completion drawer with Teal Summit styling, add milestones summary with toggle capability, and update the transition service to save milestone state.

**Files to create:**
- `components/clients/roadmap/phase-review-milestones.tsx`

**Files to modify:**
- `components/clients/roadmap/phase-review-drawer.tsx`
- `components/clients/roadmap/phase-review-stats.tsx`
- `services/phase-transition-service.ts`
- `app/api/clients/[id]/roadmap/phases/[phaseId]/transition/route.ts`

**Verify:** Open Complete Phase drawer on an active phase. See Teal Summit styled stats, toggle milestones, fill reflection, select next action, submit. Verify milestones are saved with completed_at timestamps. Verify phase transitions still work correctly.

### Prompt

```
Read CONVENTIONS.md and docs/newdesignsystem.md before starting. Read `components/clients/roadmap/phase-review-drawer.tsx`, `components/clients/roadmap/phase-review-stats.tsx`, `services/phase-transition-service.ts`, and `app/api/clients/[id]/roadmap/phases/[phaseId]/transition/route.ts` to understand the current implementation.

Redesign the Complete Phase drawer with Teal Summit styling and add milestone toggling.

### 1. Create `components/clients/roadmap/phase-review-milestones.tsx`

Displays the phase's milestones with clickable toggles so the coach can mark milestones complete/incomplete before confirming the phase transition.

Props:
```typescript
{
  milestones: Milestone[];
  onChange: (milestones: Milestone[]) => void;
}
```

UI:
- "MILESTONES" label (10px uppercase `text-[#93b0b4]`) + completion badge ("X/Y", `bg-[rgba(13,148,136,0.05)] text-[#0d9488]`)
- Each milestone row: clickable circle/checkbox + text
  - Incomplete: empty circle border `border-[rgba(13,148,136,0.3)]`, normal text
  - Complete: filled teal circle with white check, `line-through text-[#93b0b4]`
- On click: toggle completed state. When toggling to complete, set `completed_at` to `new Date().toISOString()`. When toggling to incomplete, set `completed_at` to `null`.
- If no milestones exist, don't render this component at all

### 2. Redesign `components/clients/roadmap/phase-review-stats.tsx`

Apply Teal Summit design system:
- Duration badge: "X days in this phase" with calendar icon, `bg-[rgba(13,148,136,0.05)]` background
- Phase Goal Progress section (if phase has goal overrides):
  - Goal Weight card: target vs actual with delta (teal `#0d9488` for on-track, `#c06060` for off-track)
  - Weight and Body Fat side-by-side cards showing start to end values
- Summary stats row (3 columns with `border-[rgba(13,148,136,0.08)]` dividers):
  - Training: percentage + "X sessions" subtitle
  - Nutrition: percentage + "X days logged" subtitle
  - Habits: percentage + "X/Y" subtitle
- All numbers in `font-mono-display`
- All labels in 10px uppercase `text-[#93b0b4]`
- Card backgrounds: white with `rounded-[6px]` and teal-tinted borders

### 3. Redesign `components/clients/roadmap/phase-review-drawer.tsx`

Keep the Sheet pattern. Update styling:
- Sheet content: use teal-tinted border `border-[rgba(13,148,136,0.08)]`
- Header: "Complete Phase" title in `text-[#0c1a1e]`, subtitle in `text-[#93b0b4]`
- Add milestone state: `const [milestones, setMilestones] = useState<Milestone[]>(phase.milestones ?? [])`
- Render sections in order:
  1. `PhaseReviewStats` (existing, now restyled)
  2. `PhaseReviewMilestones` (new, between stats and reflection) - only if phase has milestones
  3. Coach reflection textarea with teal focus ring
  4. Next step radio group
  5. Plan handling switches
- Footer buttons: Cancel (ghost) + "Complete Phase" (primary teal `bg-[#0d9488]`)
- Preserve the existing default values for plan handling toggles: archiveTraining = true, archiveNutrition = true, deactivateHabits = false. Do not change these defaults.
- Include `milestones` in the POST body alongside coachReflection, nextAction, planHandling

### 4. Update `services/phase-transition-service.ts`

In the `TransitionOptions` type (or wherever options are typed), add:
```typescript
milestones?: Milestone[];
```

In the `transitionPhase` function, before calling the RPC:
- If `options.milestones` is provided, update the phase's milestones column: `supabaseAdmin.from("phases").update({ milestones: options.milestones }).eq("id", phaseId)`
- Do this before the RPC call so milestones are saved even if transition has issues

Additionally, freeze milestones into the `phaseSummary` snapshot that gets passed to `transition_phase_atomic`. Add a `milestones` key to the summary object so the milestone completion state at transition time is permanently recorded and cannot be altered by later edits. The phaseSummary structure should become:
```typescript
{
  completedAt: string;
  metricsSnapshot: { startWeight, endWeight, startBodyFat, endBodyFat };
  adherence: { training, nutrition, habits };
  phaseGoals: { goalWeight, goalBodyFatPercentage };
  milestones: Milestone[]; // frozen snapshot of milestone state at completion
}
```
Use `options.milestones` if provided, otherwise fall back to the phase's existing milestones array.

### 5. Update `app/api/clients/[id]/roadmap/phases/[phaseId]/transition/route.ts`

Add `milestones` to the transition POST schema:
```typescript
milestones: z.array(z.object({
  id: z.string(),
  text: z.string(),
  completed: z.boolean(),
  completed_at: z.string().nullable(),
})).optional(),
```

Pass `milestones` through to the `transitionPhase` service call.

All files must stay under their line limits. Use explicit Teal Summit colours throughout - no Tailwind semantic greys.

Run `npx tsc --noEmit` and `npx vitest run` to verify.
```

---

## Session 6: Animations + Polish + Edge Cases

**Scope:** Add entrance animations, handle all edge cases (empty states, loading states, error states), add milestone toggling directly in expanded phase cards (not just in the complete drawer), and polish the overall experience.

**Files to modify:**
- `components/clients/roadmap/roadmap-tab-content.tsx`
- `components/clients/roadmap/phase-card.tsx`
- `components/clients/roadmap/phase-expanded-content.tsx`
- `components/clients/roadmap/create-roadmap-dialog.tsx`

**Verify:** Visual inspection of all states. Animations play smoothly. Milestone toggling in expanded cards works with optimistic updates. Loading skeletons use teal tints. All empty states have appropriate messaging.

### Prompt

```
Read CONVENTIONS.md and docs/newdesignsystem.md before starting. Read all the roadmap components you've built/modified in previous sessions.

Polish the Roadmap page redesign with animations, milestone toggling, and edge case handling.

### 1. Animations

In `phase-card.tsx`:
- Add staggered `slideUp` entrance animation to phase cards: use inline style `{ animation: 'slideUp 0.35s ease forwards', animationDelay: '${index * 0.04}s', opacity: 0 }` where index is passed as a prop
- Add a CSS keyframe for slideUp: `@keyframes slideUp { from { transform: translateY(10px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }` - add this as a `<style>` tag or use Tailwind's arbitrary animation syntax
- Chevron rotation: ensure `transition-transform duration-200 ease-in-out` is applied, rotating from 0 to 90 degrees

In `phase-expanded-content.tsx`:
- Wrap expanded content in a div with `animate-in fade-in duration-300` (use Tailwind's animation utilities or inline keyframes)

In `phase-weekly-table.tsx`:
- Add staggered fade-in to table rows: `style={{ animationDelay: '${index * 0.05}s' }}`

### 2. Milestone toggling in expanded phase cards

In `phase-expanded-content.tsx`:
- Make milestones clickable (not just read-only display)
- On click, toggle the milestone's completed state optimistically
- PATCH the phase via `/api/clients/${clientId}/roadmap/phases/${phase.id}` with the updated milestones array
- Use SWR's `mutate` for optimistic update (mutate the parent roadmap SWR key)
- When toggling to complete: set `completed_at` to `new Date().toISOString()`
- When toggling to incomplete: set `completed_at` to `null`
- Add an `onMutate` prop from the parent so the roadmap data can be refreshed

### 3. Empty states and edge cases

In `roadmap-tab-content.tsx`:
- No roadmap state: Target icon in `text-[#93b0b4]`, "No roadmap yet" in `text-[#0c1a1e]`, description in `text-[#93b0b4]`, "Build Roadmap" button in primary teal
- No phases state: same teal-muted treatment

In `create-roadmap-dialog.tsx`:
- Apply Teal Summit input styling: `rounded-[6px]`, focus ring teal, labels in `text-[#5a7d82]`

### 4. Completed phase display

In `phase-card.tsx` header for completed phases:
- Show coach reflection snippet (first 80 chars + "...") if it exists, in `text-[#93b0b4] text-[12px] italic`
- Show milestone completion badge (e.g. "3/4 milestones") next to the status badge, using `bg-[rgba(13,148,136,0.05)] text-[#0d9488]`

### 5. Loading states

All SWR-dependent sections should show Skeleton components with teal-tinted backgrounds while loading. Use `bg-[rgba(13,148,136,0.04)]` for skeleton base colour if possible, otherwise default Skeleton is fine.

All files must stay under their line limits.

Run `npx tsc --noEmit` to verify.
```

---

## Session 7: Client-Side Read-Only Milestones (Separate Session)

**Scope:** Add read-only milestone display on the client portal for completed phases. This session is independent from the coach-side work.

**Files to modify:**
- Client-side roadmap/phase components (identify first)
- `components/daily-pulse/phase-completion-card.tsx`

**Verify:** Client sees milestones on completed phases with appropriate styling. Phase completion card shows milestone summary.

### Prompt

```
Read CONVENTIONS.md and docs/newdesignsystem.md before starting. Read `components/daily-pulse/phase-completion-card.tsx` to understand the current phase completion card. Search for any client-side roadmap components under `components/` or `app/client/`.

Add read-only milestone display for the client portal.

### 1. Phase Completion Card

Update `components/daily-pulse/phase-completion-card.tsx`:
- Add a milestones section showing the completed phase's milestones
- Completed milestones: teal check icon (`text-[#0d9488]`) + normal text
- Incomplete milestones: muted empty circle (`text-[#93b0b4]`) + muted text
- Show `completed_at` date for completed milestones in `font-mono-display text-[#93b0b4] text-[11px]`
- Add a "X/Y milestones" summary badge in the phase header area
- The milestones data should already be available via the phase record returned by the API - verify this by reading the `/api/client/phase-completion` route

### 2. Client-side data access

- Update the GET handler in `app/api/client/phase-completion/route.ts` to include the `milestones` column in the phase SELECT query. The milestones array must be returned alongside `phase_summary` in the API response so the phase-completion-card can render them.
- For historical accuracy, prefer reading milestones from `phase_summary.milestones` (the frozen snapshot at completion time, added in Session 5) rather than the live `phases.milestones` column. Fall back to the live column if the snapshot doesn't contain milestones (for phases completed before this feature existed).
- Verify that the existing RLS policies on the `phases` table allow clients to read their own phase data including the milestones JSONB column
- Use `fetch` with `{ cache: 'no-store' }` per CONVENTIONS.md for any new client-side data fetching

### 3. Styling

- All styling follows Teal Summit design system
- Client-side components use the same colour tokens as coach-side
- JetBrains Mono (`font-mono-display`) for dates and numbers
- 6px border radius

All files must stay under their line limits.

Run `npx tsc --noEmit` to verify.
```

---

## Technical Notes

- **File size limits:** Components max 250 lines, services max 300 lines, API routes max 250 lines. Split if approaching limits.
- **Data fetching:** SWR for coach-side, fetch with no-store for client-side.
- **Colours:** NO Tailwind semantic greys (no `text-muted-foreground`, `bg-muted`, etc). Every grey has a teal undertone. Use explicit hex values from newdesignsystem.md.
- **Typography:** JetBrains Mono (`font-mono-display`) for ALL numbers/dates. Instrument Sans for all UI text.
- **Border radius:** 6px everywhere. No pills. No large radii.
- **Auth pattern:** Coach routes use `coachApiRateLimit` + `getAuthenticatedCoachId()` + ownership check. Client routes use `clientApiRateLimit` + `getAuthenticatedClientId()`.
- **JSONB:** Supabase handles serialization automatically. Never use `JSON.stringify()` on JSONB columns.
