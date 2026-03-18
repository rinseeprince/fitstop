# Historical Data Tables — Implementation Plan

## Overview

Five paginated data tables for coaches to view client progress over time. Each table lives in its respective tab and shows date-descending rows with server-side pagination (10 rows/page). Unlogged days show as empty rows with dashes. Clickable metric columns open chart/graph overlays.

**Build order:** Shared abstractions → Nutrition → Wellness → Body Metrics → Training → Habits

---

## Session 0: Shared Abstractions

Build the reusable paginated history table component and its supporting hook/API utilities. Every subsequent session depends on this.

### 0A. Reusable `HistoryTable` component

**File:** `components/clients/history-table/history-table.tsx`

A generic, paginated data table with:
- Props: `columns: ColumnDef[]`, `data: Row[]`, `total: number`, `page: number`, `onPageChange`, `isLoading`, `emptyMessage`
- 10 rows per page, previous/next pagination (uses existing `components/ui/pagination.tsx`)
- Loading skeleton state
- Empty state with message
- Each `ColumnDef` has: `key`, `label`, `render(value, row)`, `chartType?` (signals clickable)
- Clickable column headers open a chart dialog (pass `onColumnClick(columnKey)` up)
- Uses existing `Table`, `TableHeader`, `TableBody`, `TableRow`, `TableHead`, `TableCell` from `components/ui/table.tsx`
- Keep under 250 lines — split pagination controls into a sub-component if needed

### 0B. Reusable `useHistoryData` hook

**File:** `hooks/use-history-data.ts`

Generic SWR-based paginated data hook:
```ts
useHistoryData<T>(url: string, page: number, pageSize?: number)
// Returns: { rows: T[], total: number, isLoading, isError, mutate }
```
- Builds URL with `?limit=${pageSize}&offset=${page * pageSize}`
- SWR config: `revalidateOnFocus: false`, `dedupingInterval: 5000` (matches existing hooks in `hooks/use-check-in-data.ts`)
- Uses `swrFetcher` from `lib/swr-fetcher.ts`

### 0C. Reusable `HistoryChartDialog` component

**File:** `components/clients/history-table/history-chart-dialog.tsx`

A dialog/sheet that renders a chart for a selected metric column:
- Props: `open`, `onClose`, `title`, `chartType` (`"line"` | `"bar"` | `"heatmap"`), `data`, `dataKey`, `color`
- Uses Recharts (`AreaChart`/`BarChart`) — same patterns as `components/clients/metrics/metric-chart-card.tsx`
- Wrap in existing `ChartContainer` from `components/ui/chart.tsx`
- Color mapping follows `lib/design-tokens.ts` chart tokens
- For heatmaps: use Recharts `BarChart` with `Cell` color-per-bar (pattern from `components/clients/habits/habit-chart-card.tsx`)

### 0D. API helper for paginated history queries

**File:** `services/history-service.ts`

Shared Supabase query builder helpers:
```ts
// Paginated date-descending query on any table
async function getPaginatedHistory(
  table: string,
  clientId: string,
  options: { limit: number; offset: number; dateColumn?: string }
): Promise<{ rows: any[]; total: number }>
```
- Uses `supabaseAdmin` for service-role access
- Orders by date column descending
- Returns `{ rows, total }` with count via Supabase `.count()`

### Files created this session
| File | Purpose | Max lines |
|------|---------|-----------|
| `components/clients/history-table/history-table.tsx` | Reusable paginated table | 250 |
| `components/clients/history-table/history-chart-dialog.tsx` | Chart overlay dialog | 200 |
| `hooks/use-history-data.ts` | Generic paginated SWR hook | 50 |
| `services/history-service.ts` | Shared Supabase query helpers | 100 |

---

## Session 1: Nutrition History Table

**Location:** Nutrition tab, below the existing `NutritionCalculatorCardEnhanced`
**Data source:** Single-table query on `daily_logs`
**Complexity:** Low — all fields snapshotted on the row

### 1A. API route

**File:** `app/api/clients/[id]/history/nutrition/route.ts`

GET endpoint returning paginated nutrition history:
- Auth: `requireCoachOwnsClient` (from `lib/require-coach-auth.ts`)
- Rate limit: `coachApiRateLimit` (from `lib/rate-limit.ts`)
- Pagination: `parsePaginationParams` (from `lib/api-utils.ts`)
- Query: `SELECT date, calories_consumed, target_calories, protein_g, target_protein_g, carbs_g, target_carbs_g, fat_g, target_fat_g, calorie_surplus_deficit, nutrition_adherence FROM daily_logs WHERE client_id = ? AND calories_consumed IS NOT NULL ORDER BY date DESC`
- The `calories_consumed IS NOT NULL` filter ensures only nutrition-logged days appear
- Response shape: `{ rows: NutritionHistoryRow[], total: number }`

### 1B. Type definition

**File:** `types/history.ts` (new shared types file for all history tables)

```ts
export interface NutritionHistoryRow {
  date: string
  calories_consumed: number | null
  target_calories: number | null
  protein_g: number | null
  target_protein_g: number | null
  carbs_g: number | null
  target_carbs_g: number | null
  fat_g: number | null
  target_fat_g: number | null
  calorie_surplus_deficit: number | null
  nutrition_adherence: "hit" | "partial" | "missed" | null
  adherence_pct: number | null  // calculated: (consumed / target) * 100
}
```

### 1C. Component

**File:** `components/clients/nutrition/nutrition-history-table.tsx`

- Uses `useHistoryData<NutritionHistoryRow>` with URL `/api/clients/${clientId}/history/nutrition`
- Columns: Date | Calories (consumed/target) | Protein (g) | Carbs (g) | Fat (g) | Surplus/Deficit | Adherence
- Adherence column: color-coded badge — green (hit), amber (partial), red (missed)
- Adherence % calculated client-side: `Math.round((consumed / target) * 100)`
- Clickable columns: Calories → adherence heatmap, Protein/Carbs/Fat → line charts

### 1D. Chart: Adherence Heatmap

When "Calories" column is clicked, open `HistoryChartDialog` with:
- `chartType: "heatmap"`
- Recharts `BarChart` with `Cell` fill per bar:
  - Green (`#22c55e`): adherence >= 90%
  - Amber (`#f59e0b`): adherence 70-89%
  - Red (`#ef4444`): adherence < 70%
- X-axis: dates, Y-axis: adherence %
- Fetches last 30 days of data (separate lightweight query, or reuse existing rows)

### 1E. Integration

- Add `NutritionHistoryTable` below the existing content in `NutritionCalculatorCardEnhanced` or alongside it in the nutrition `TabsContent` in `app/clients/[id]/page.tsx`
- Wrapped in a `Card` with title "Nutrition History"

### Files created/modified this session
| File | Action | Max lines |
|------|--------|-----------|
| `types/history.ts` | Create | 100 |
| `app/api/clients/[id]/history/nutrition/route.ts` | Create | 80 |
| `components/clients/nutrition/nutrition-history-table.tsx` | Create | 200 |
| `app/clients/[id]/page.tsx` | Modify (add table to nutrition tab) | — |

---

## Session 2: Wellness History Table

**Location:** New "Wellness" tab (add to tab navigation)
**Data source:** Single-table query on `daily_logs`
**Complexity:** Low — same table as nutrition, different columns

### 2A. Add "Wellness" tab

- Add `{ value: "wellness", label: "Wellness" }` to `TABS` array in `components/clients/client-page-header.tsx`
- Update `ClientTab` type (auto-derived from TABS const)
- Add `<TabsContent value="wellness">` in `app/clients/[id]/page.tsx`

### 2B. API route

**File:** `app/api/clients/[id]/history/wellness/route.ts`

- Same pattern as nutrition route
- Query: `SELECT date, mood, energy, sleep, stress, notes FROM daily_logs WHERE client_id = ? AND (mood IS NOT NULL OR energy IS NOT NULL OR sleep IS NOT NULL OR stress IS NOT NULL) ORDER BY date DESC`
- Filter: at least one wellness field logged

### 2C. Type definition

Add to `types/history.ts`:
```ts
export interface WellnessHistoryRow {
  date: string
  mood: number | null       // 1-5
  energy: number | null     // 1-10
  sleep: number | null      // 1-10
  stress: number | null     // 1-10
  notes: string | null
}
```

### 2D. Component

**File:** `components/clients/wellness/wellness-history-table.tsx`

- Columns: Date | Mood (1-5) | Energy (1-10) | Sleep (1-10) | Stress (1-10) | Notes
- Color coding per cell using existing wellness thresholds (from `components/clients/daily-pulse/wellness-bar-chart.tsx`):
  - Mood: 4+ green, 3 amber, <3 red
  - Energy/Sleep: 7+ green, 4-6 amber, <4 red
  - Stress: ≤3 green, ≤6 amber, >6 red (inverted)
- Clickable columns → line charts showing trends over time
- Suggested chart type: `AreaChart` with gradient fill (matches `metric-chart-card.tsx` pattern)

### 2E. Wellness tab content wrapper

**File:** `components/clients/wellness/wellness-tab-content.tsx`

- Simple wrapper rendering `WellnessHistoryTable` inside a `Card`
- Props: `client` (for clientId)
- Could later house additional wellness features

### Files created/modified this session
| File | Action |
|------|--------|
| `app/api/clients/[id]/history/wellness/route.ts` | Create |
| `components/clients/wellness/wellness-history-table.tsx` | Create |
| `components/clients/wellness/wellness-tab-content.tsx` | Create |
| `types/history.ts` | Modify (add WellnessHistoryRow) |
| `components/clients/client-page-header.tsx` | Modify (add Wellness tab) |
| `app/clients/[id]/page.tsx` | Modify (add Wellness TabsContent) |

---

## Session 3: Body Metrics History Table

**Location:** Existing Metrics tab (alongside or below current metrics display)
**Data source:** Single-table query on `check_ins`
**Complexity:** Low — but rows are per check-in, not daily

### 3A. API route

**File:** `app/api/clients/[id]/history/body-metrics/route.ts`

- Query: `SELECT created_at, period_start, period_end, weight, weight_unit, body_fat_percentage, waist, hips, chest, arms, thighs, measurement_unit FROM check_ins WHERE client_id = ? AND (weight IS NOT NULL OR body_fat_percentage IS NOT NULL) ORDER BY created_at DESC`
- Filter: at least weight or body fat logged
- Pagination: standard limit/offset

### 3B. Type definition

Add to `types/history.ts`:
```ts
export interface BodyMetricsHistoryRow {
  date: string              // from created_at
  period_label: string      // derived: "Mar 9 – 15"
  weight: number | null
  weight_unit: "lbs" | "kg" | null
  body_fat_percentage: number | null
  waist: number | null
  hips: number | null
  chest: number | null
  arms: number | null
  thighs: number | null
  measurement_unit: "in" | "cm" | null
}
```

### 3C. Component

**File:** `components/clients/metrics/body-metrics-history-table.tsx`

- Columns: Check-In Period | Weight | Body Fat % | Waist | Hips | Chest | Arms | Thighs
- Null fields show as "—"
- Weight column shows value with unit (e.g., "185 lbs")
- Clickable columns → line charts showing trends
  - Weight → line chart with goal weight as reference line (from `clients.goal_weight`)
  - Body fat → line chart with goal as reference line
  - Measurements → individual line charts
- Use existing metric color mapping from `metric-chart-card.tsx`

### 3D. Integration

- Add `BodyMetricsHistoryTable` to the Metrics tab content in `components/clients/metrics/metrics-tab-content.tsx`
- Position below the existing metrics grid

### Files created/modified this session
| File | Action |
|------|--------|
| `app/api/clients/[id]/history/body-metrics/route.ts` | Create |
| `components/clients/metrics/body-metrics-history-table.tsx` | Create |
| `types/history.ts` | Modify (add BodyMetricsHistoryRow) |
| `components/clients/metrics/metrics-tab-content.tsx` | Modify (add table) |

---

## Session 4: Training History Table

> **Approach change (from investigation):** The original plan used `client_session_completions` as the primary source with derived dates from `week_start_date + day_of_week`. This breaks when clients complete alternative sessions - if a client does "Pull Day" (normally Thursday) on a Wednesday, the derived date would be Thursday, not the actual Wednesday they trained. The daily pulse always writes training data to `daily_logs` first (with the exact calendar date and session metadata in the `training_data` JSONB), then writes a matching `client_session_completions` row. Using `daily_logs` as the primary source gives exact dates and correctly handles alternative sessions.

**Location:** Training tab, below the existing `TrainingPlanCard`
**Data source:** Primary: `daily_logs` (training fields). Enriched with: `client_session_completions` (for completion_quality). Fallback: orphaned `client_session_completions` rows with no matching daily log.
**Complexity:** Low-moderate - JSONB extraction + LEFT JOIN

### 4A. Service function

**File:** `services/training-history-service.ts`

```ts
async function getTrainingHistory(clientId: string, options: { limit: number; offset: number })
```

Query strategy:
1. **Primary query:** `daily_logs WHERE trained = true` - the exact calendar date is in `daily_logs.date`, session metadata is in the `training_data` JSONB column
2. **Enrich:** LEFT JOIN `client_session_completions` on `(client_id, training_session_id, week_start_date)` to get `completion_quality` (full/partial/skipped)
3. **Fallback:** UNION with orphaned `client_session_completions` rows (those with no matching `daily_logs` entry). Only these rows use derived date math (`week_start_date + day_of_week offset`) as a fallback. This handles the theoretical case where a completion was written without a daily log.
4. Return rows sorted by date descending

SQL approach:
```sql
-- Primary: daily_logs with exact dates
SELECT
  dl.date,
  dl.training_data->>'trainingSessionName' as session_name,
  (dl.training_data->>'isAlternativeSession')::boolean as is_alternative,
  csc.completion_quality,
  dl.training_data->>'notes' as notes
FROM daily_logs dl
LEFT JOIN client_session_completions csc
  ON csc.client_id = dl.client_id
  AND csc.training_session_id = (dl.training_data->>'trainingSessionId')::uuid
  AND csc.week_start_date = date_trunc('week', dl.date::date)::date
WHERE dl.client_id = $1
  AND dl.trained = true
  AND dl.training_data IS NOT NULL

UNION ALL

-- Fallback: orphaned completions with no matching daily_log
SELECT
  (csc.week_start_date + CASE ts.day_of_week
    WHEN 'monday' THEN 0
    WHEN 'tuesday' THEN 1
    WHEN 'wednesday' THEN 2
    WHEN 'thursday' THEN 3
    WHEN 'friday' THEN 4
    WHEN 'saturday' THEN 5
    WHEN 'sunday' THEN 6
  END)::text as date,
  ts.name as session_name,
  false as is_alternative,
  csc.completion_quality,
  csc.notes
FROM client_session_completions csc
JOIN training_sessions ts ON ts.id = csc.training_session_id
WHERE csc.client_id = $1
  AND NOT EXISTS (
    SELECT 1 FROM daily_logs dl
    WHERE dl.client_id = csc.client_id
      AND dl.trained = true
      AND (dl.training_data->>'trainingSessionId')::uuid = csc.training_session_id
      AND date_trunc('week', dl.date::date)::date = csc.week_start_date
  )

ORDER BY date DESC
LIMIT $2 OFFSET $3
```

Note: `training_plans` may be soft-deleted (`deleted_at IS NOT NULL`). The primary query avoids this entirely since `training_data` JSONB already contains the session name. The fallback query only JOINs `training_sessions` (not `training_plans`) for the session name and day_of_week.

### 4B. API route

**File:** `app/api/clients/[id]/history/training/route.ts`

- Standard auth/rate-limit/pagination pattern
- Calls `getTrainingHistory` service
- Response: `{ rows: TrainingHistoryRow[], total: number }`

### 4C. Type definition

Add to `types/history.ts`:
```ts
export interface TrainingHistoryRow {
  date: string              // from daily_logs.date (exact), or derived for orphaned completions
  session_name: string
  is_alternative: boolean   // true when client did a different session than prescribed
  completion_quality: "full" | "partial" | "skipped" | null  // null when no matching completion record
  notes: string | null
}
```

### 4D. Component

**File:** `components/clients/training/training-history-table.tsx`

- Columns: Date | Session | Alt? | Status | Notes
- Alt? column: small indicator when `is_alternative` is true (e.g. swap icon or "Alt" badge)
- Status column: color-coded badge
  - Full → green "Completed"
  - Partial → amber "Partial"
  - Skipped → red "Skipped"
  - Null → grey "Logged" (training was logged in daily pulse but has no matching completion record)
- Clickable Status column → bar chart showing completion distribution over time
- Suggested chart: stacked bar chart (full/partial/skipped per week)

### 4E. Integration

- Add `TrainingHistoryTable` below `TrainingPlanCard` in the training `TabsContent` in `app/clients/[id]/page.tsx`
- Wrapped in a `Card` with title "Training History"

### 4F. Verification

- Verify rows show actual calendar dates (not derived)
- Verify alternative sessions show the `is_alternative` indicator and the session the client actually did (not the prescribed one)
- Verify `completion_quality` is populated when a matching `client_session_completions` row exists
- Verify rows with no matching completion record show grey "Logged" badge
- Verify orphaned completions (if any exist) appear with derived dates as fallback

### Files created/modified this session
| File | Action |
|------|--------|
| `services/training-history-service.ts` | Create |
| `app/api/clients/[id]/history/training/route.ts` | Create |
| `components/clients/training/training-history-table.tsx` | Create |
| `types/history.ts` | Modify (add TrainingHistoryRow) |
| `app/clients/[id]/page.tsx` | Modify (add table to training tab) |

---

## Session 5: Habits History Table

**Location:** Habits tab, below the existing `HabitsTabContent`
**Data source:** Join `daily_habit_logs` + `daily_habits`
**Complexity:** Moderate — dynamic columns (one per active habit), no habit versioning

### 5A. Service function

**File:** `services/habits-history-service.ts`

Two queries:
1. **Get client's habits** (both active and inactive, to cover historical logs):
   ```sql
   SELECT id, name, is_boolean, target_value, target_unit, is_active
   FROM daily_habits WHERE client_id = $1
   ORDER BY sort_order
   ```

2. **Get paginated daily habit completions**:
   ```sql
   SELECT dhl.date, dhl.daily_habit_id, dhl.completed, dhl.value, dhl.notes
   FROM daily_habit_logs dhl
   WHERE dhl.client_id = $1
   ORDER BY dhl.date DESC
   ```

   Pivot in the service layer: group by date, create one row per date with a column per habit.

Response shape:
```ts
{
  habits: { id: string; name: string; is_boolean: boolean; target_value: number | null; target_unit: string | null }[]
  rows: HabitsHistoryRow[]
  total: number  // count of distinct dates
}
```

### 5B. API route

**File:** `app/api/clients/[id]/history/habits/route.ts`

- Standard pattern
- Calls service, returns habits metadata + pivoted rows

### 5C. Type definition

Add to `types/history.ts`:
```ts
export interface HabitsHistoryRow {
  date: string
  habits: Record<string, {   // keyed by daily_habit_id
    completed: boolean
    value: number | null
    notes: string | null
  }>
  total_completed: number
  total_habits: number
}
```

### 5D. Component

**File:** `components/clients/habits/habits-history-table.tsx`

- Dynamic columns based on the `habits` array in the API response
- Columns: Date | [Habit 1 Name] | [Habit 2 Name] | ... | Completion Rate
- Boolean habits: checkmark (green) or X (red)
- Value-based habits: show `value / target` with color coding
- Completion rate column: `total_completed / total_habits` as percentage
- Clickable Completion Rate → bar chart (daily completion % over time)
- Clickable individual habit → streak/completion chart for that habit

### 5E. Known limitation (document in UI)

Habit names and targets reflect their **current** state, not what they were when logged. If a coach renames a habit, old rows will show the new name. This is acceptable for MVP. A future enhancement could snapshot habit metadata onto log rows (similar to how nutrition targets are snapshotted on `daily_logs`).

### 5F. Integration

- Add `HabitsHistoryTable` below the existing habits grid in `HabitsTabContent` or directly in the habits `TabsContent` in `app/clients/[id]/page.tsx`

### Files created/modified this session
| File | Action |
|------|--------|
| `services/habits-history-service.ts` | Create |
| `app/api/clients/[id]/history/habits/route.ts` | Create |
| `components/clients/habits/habits-history-table.tsx` | Create |
| `types/history.ts` | Modify (add HabitsHistoryRow) |
| `app/clients/[id]/page.tsx` or `habits-tab-content.tsx` | Modify (add table) |

---

## Verification Plan

After each session, verify:

1. **TypeScript**: `npx tsc --noEmit` — no errors
2. **Lint**: `npx eslint .` — clean
3. **Tests**: `npx vitest run` — all passing
4. **Manual testing per session:**
   - Session 0: Render `HistoryTable` with mock data, verify pagination, loading, empty states
   - Session 1: Navigate to Nutrition tab for a client with daily logs. Verify 10 rows, pagination, adherence colors, heatmap chart opens on click
   - Session 2: Navigate to new Wellness tab. Verify wellness data renders, color thresholds correct, line charts open
   - Session 3: Navigate to Metrics tab. Verify body metrics table shows check-in data, line charts with goal reference lines
   - Session 4: Navigate to Training tab. Verify dates are actual calendar dates (not derived), alternative session indicators appear correctly, completion quality badges show right colors, rows without completion records show grey "Logged" badge
   - Session 5: Navigate to Habits tab. Verify dynamic columns match client's habits, boolean vs value rendering, completion rate calculation

---

## File Summary (all sessions)

### New files (16)
```
types/history.ts
hooks/use-history-data.ts
services/history-service.ts
services/training-history-service.ts
services/habits-history-service.ts
components/clients/history-table/history-table.tsx
components/clients/history-table/history-chart-dialog.tsx
components/clients/nutrition/nutrition-history-table.tsx
components/clients/wellness/wellness-tab-content.tsx
components/clients/wellness/wellness-history-table.tsx
components/clients/metrics/body-metrics-history-table.tsx
components/clients/training/training-history-table.tsx
components/clients/habits/habits-history-table.tsx
app/api/clients/[id]/history/nutrition/route.ts
app/api/clients/[id]/history/wellness/route.ts
app/api/clients/[id]/history/body-metrics/route.ts
app/api/clients/[id]/history/training/route.ts
app/api/clients/[id]/history/habits/route.ts
```

### Modified files (4)
```
components/clients/client-page-header.tsx          — add Wellness tab
app/clients/[id]/page.tsx                          — add Wellness TabsContent, add history tables to existing tabs
components/clients/metrics/metrics-tab-content.tsx  — add body metrics history table
components/clients/habits/habits-tab-content.tsx    — add habits history table (or integrate via page.tsx)
```

### Key patterns to follow
- **API routes**: Rate limit → auth (`requireCoachOwnsClient`) → validate params → service call → response (pattern from `app/api/clients/[id]/check-ins/route.ts`)
- **Hooks**: SWR with `revalidateOnFocus: false`, `dedupingInterval: 5000` (pattern from `hooks/use-check-in-data.ts`)
- **Charts**: Recharts with `AreaChart`/`BarChart` + `ResponsiveContainer` (pattern from `components/clients/metrics/metric-chart-card.tsx`)
- **Styling**: Tailwind with design tokens, domain colors from `DESIGNSYSTEM.md`
- **Component size**: Max 250 lines per component, 250 per API route
