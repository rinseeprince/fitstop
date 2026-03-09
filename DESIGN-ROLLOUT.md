# Design System Rollout — Step-by-Step

> 13 steps to migrate every file to the new design system defined in `DESIGNSYSTEM.md`.
> Each step includes a copy-paste Claude Code prompt.

---

## Replacement Mapping (reference for all steps)

| Old Pattern | New Pattern |
|---|---|
| `text-gray-900` / `text-gray-800` | `text-foreground` |
| `text-gray-700` | `text-foreground` |
| `text-gray-600` / `text-gray-500` / `text-gray-400` | `text-muted-foreground` |
| `text-gray-300` | `text-muted-foreground` (or `text-border` if decorative) |
| `border-gray-200` / `border-gray-100` / `border-gray-300` | `border-border` |
| `bg-gray-50` | `bg-muted/50` |
| `bg-gray-100` | `bg-muted` |
| `bg-gray-200` | `bg-muted` |
| `bg-white` | `bg-card` |
| `bg-gradient-to-*` | Remove entirely (flat color) |
| `from-*` / `to-*` / `via-*` (gradient stops) | Remove entirely |
| `shadow-sm` / `shadow` / `shadow-md` / `shadow-lg` (on cards/buttons) | Remove (only floating elements get shadow) |
| `hover:shadow-*` | Remove |
| `rounded-full` (on badges) | `rounded-md` |
| `rounded-xl` / `rounded-2xl` | `rounded-lg` |
| `ring-2` (non-focus) | `ring-1` |
| `backdrop-blur-*` | Remove |
| `font-bold` (headings) | `font-semibold` |
| `font-bold` (labels) | `font-medium` |
| Hardcoded macro colors (e.g. `text-blue-500`, `bg-green-100`) | Use `text-protein`/`bg-protein/10`, `text-carbs`/`bg-carbs/10`, `text-fat`/`bg-fat/10` |

---

## Step 0 — Font Swap ✅

**Files:**
- `app/layout.tsx`
- `app/globals.css`
- `DESIGNSYSTEM.md` (update font section)

### Prompt

```
Read DESIGNSYSTEM.md, app/layout.tsx, and app/globals.css.

Make these changes:

1. app/layout.tsx:
   - Change `import { Inter } from "next/font/google"` → `import { Plus_Jakarta_Sans } from "next/font/google"`
   - Change `const inter = Inter({ subsets: ["latin"] })` → `const plusJakarta = Plus_Jakarta_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"] })`
   - Change `inter.className` → `plusJakarta.className`

2. app/globals.css — in `@theme inline`:
   - Change `--font-sans` to: `"Plus Jakarta Sans", system-ui, -apple-system, sans-serif`
   - Remove "Inter", "Poppins", "Geist", "Geist Fallback", "SF Pro Display" from the font stack

3. DESIGNSYSTEM.md — Section 3.1 "Font Stack":
   - Replace all references to "Inter" with "Plus Jakarta Sans"
   - Update the code example to show `import { Plus_Jakarta_Sans } from 'next/font/google'`
   - Update the const to: `const plusJakarta = Plus_Jakarta_Sans({ subsets: ['latin'], weight: ['400', '500', '600', '700'] })`

Verify after:
- grep -r "Inter" app/layout.tsx (should find nothing)
- grep -r "Poppins\|Geist" app/globals.css (should find nothing except --font-mono which can keep Geist Mono)
```

---

## Step 1 — Add Macro Tokens + Typography Scale ✅

**Files:**
- `app/globals.css`
- `DESIGNSYSTEM.md`

### Prompt

```
Read app/globals.css and DESIGNSYSTEM.md.

1. app/globals.css — Add macro nutrient tokens:

   In `:root` block, after the `--error` line, add:
     /* Macro Nutrient Colors */
     --protein: oklch(0.55 0.18 255);
     --carbs: oklch(0.6 0.14 55);
     --fat: oklch(0.55 0.15 25);

   In `.dark` block, after the `--error` line, add:
     /* Macro Nutrient Colors */
     --protein: oklch(0.6 0.18 255);
     --carbs: oklch(0.65 0.14 55);
     --fat: oklch(0.6 0.15 25);

   In `@theme inline` block, after `--color-error`, add:
     --color-protein: var(--protein);
     --color-carbs: var(--carbs);
     --color-fat: var(--fat);

2. app/globals.css — Add a typography scale comment block at the top of `@layer base`:
   /*
    * Typography Scale (Plus Jakarta Sans)
    * ─────────────────────────────────────
    * Display : text-4xl  font-bold     tracking-tight  — hero numbers only
    * H1      : text-3xl  font-semibold tracking-tight  — page titles
    * H2      : text-2xl  font-semibold tracking-tight  — section titles
    * H3      : text-xl   font-semibold                 — sub-sections
    * H4      : text-lg   font-semibold                 — card headers
    * Body    : text-base                               — default body
    * Body-sm : text-sm                                 — most UI text
    * Caption : text-xs   font-medium                   — labels, badges
    * Overline: text-xs   font-medium uppercase tracking-wider — column headers
    *
    * Rules:
    *   font-semibold → all headings (H1–H4)
    *   font-medium   → labels, captions
    *   font-bold     → large stat numbers (Display) only
    *   All headings  → text-foreground (never hardcoded grays)
    */

3. DESIGNSYSTEM.md — After section 2 "Colours", in the token reference table, add rows for:
   | `--protein` | `oklch(0.55 0.18 255)` | Protein macro colour (blue) |
   | `--carbs` | `oklch(0.6 0.14 55)` | Carbohydrate macro colour (amber) |
   | `--fat` | `oklch(0.55 0.15 25)` | Fat macro colour (red-orange) |

   Also add to the "Colour Usage" table:
   | Protein badge/chart | `bg-protein/10 text-protein` |
   | Carbs badge/chart | `bg-carbs/10 text-carbs` |
   | Fat badge/chart | `bg-fat/10 text-fat` |

Verify after:
- grep "protein\|carbs\|fat" app/globals.css (should show 9 lines: 3 in :root, 3 in .dark, 3 in @theme)
```

---

## Step 2 — UI Primitives Cleanup ✅

**Files:**
- `components/ui/badge.tsx`
- `components/ui/button.tsx`
- `components/ui/card.tsx`
- `components/ui/dialog.tsx`
- `components/ui/input.tsx`
- `components/ui/select.tsx`
- `components/ui/textarea.tsx`
- `components/ui/table.tsx`
- `components/ui/tabs.tsx`
- `components/ui/toast.tsx`
- `components/ui/sonner.tsx`
- `components/ui/segmented-control.tsx`
- `components/ui/stat-card-v2.tsx`

### Prompt

```
Read all these files:
- components/ui/badge.tsx
- components/ui/button.tsx
- components/ui/card.tsx
- components/ui/dialog.tsx
- components/ui/input.tsx
- components/ui/select.tsx
- components/ui/textarea.tsx
- components/ui/table.tsx
- components/ui/tabs.tsx
- components/ui/toast.tsx
- components/ui/sonner.tsx
- components/ui/segmented-control.tsx
- components/ui/stat-card-v2.tsx

Read DESIGNSYSTEM.md as the source of truth.

For each file, apply these rules:
1. Replace any hardcoded gray-* colors → design tokens (text-foreground, text-muted-foreground, bg-muted, border-border)
2. Replace bg-white → bg-card
3. Replace ring-2 → ring-1 (except focus-visible:ring-2 on buttons which is correct per design system)
4. Remove shadow-sm / shadow-md from non-floating elements (cards, buttons). Only floating elements (dialogs, select dropdowns, segmented control active thumb) should have shadow.
5. Replace rounded-full on badges → rounded-md
6. Replace rounded-xl / rounded-2xl → rounded-lg
7. Remove any gradient classes (bg-gradient-to-*, from-*, to-*, via-*)
8. Remove backdrop-blur-*
9. Replace font-bold on headings → font-semibold
10. Ensure all heading text uses text-foreground, not hardcoded grays

Do NOT change:
- rounded-full on avatars (that's correct)
- shadow-sm on segmented control active thumb (that's correct)
- shadow-md on dialog/select content (that's correct)
- focus-visible:ring-2 on buttons (that's correct)

Verify after:
grep -rn "gray-\|bg-white\|rounded-full\|rounded-xl\|rounded-2xl\|backdrop-blur\|bg-gradient" components/ui/badge.tsx components/ui/button.tsx components/ui/card.tsx components/ui/dialog.tsx components/ui/input.tsx components/ui/select.tsx components/ui/textarea.tsx components/ui/table.tsx components/ui/tabs.tsx components/ui/toast.tsx components/ui/sonner.tsx components/ui/segmented-control.tsx components/ui/stat-card-v2.tsx
```

---

## Step 3 — Auth Pages ✅

**Files:**
- `app/login/page.tsx`
- `app/signup/page.tsx`
- `app/forgot-password/page.tsx`
- `app/reset-password/page.tsx`
- `app/invite/[token]/page.tsx`
- `app/client/check-in/page.tsx`

### Prompt

```
Read all these files:
- app/login/page.tsx
- app/signup/page.tsx
- app/forgot-password/page.tsx
- app/reset-password/page.tsx
- app/invite/[token]/page.tsx
- app/client/check-in/page.tsx

Read DESIGNSYSTEM.md as the source of truth.

Apply the design system to each file:

Replacement map:
- bg-white → bg-card
- bg-gray-50 → bg-muted/50
- bg-gray-100 → bg-muted
- text-gray-900 / text-gray-800 / text-gray-700 → text-foreground
- text-gray-600 / text-gray-500 / text-gray-400 → text-muted-foreground
- border-gray-200 / border-gray-300 → border-border
- bg-gradient-to-* and gradient stops (from-*, to-*, via-*) → remove (use flat bg-background or bg-card)
- shadow-sm / shadow-md / shadow-lg / shadow on cards → remove
- hover:shadow-* → remove
- rounded-full on badges → rounded-md (keep rounded-full only on avatars)
- rounded-xl / rounded-2xl → rounded-lg
- font-bold on headings → font-semibold (font-bold only for large stat numbers)
- Headings must use text-foreground, never hardcoded grays
- Labels should use font-medium

Auth pages typically have a centered card layout. Ensure:
- Page background: bg-background (or bg-muted/50 for subtle contrast)
- Card: bg-card border border-border rounded-lg (no shadow)
- Heading: text-2xl font-semibold text-foreground tracking-tight
- Subtext: text-sm text-muted-foreground
- Inputs: per DESIGNSYSTEM.md (bg-transparent border border-border rounded-md)

Verify after:
grep -rn "gray-\|bg-white\|bg-gradient\|shadow-sm\|shadow-md\|rounded-full\|rounded-xl" app/login/page.tsx app/signup/page.tsx app/forgot-password/page.tsx app/reset-password/page.tsx "app/invite/[token]/page.tsx" app/client/check-in/page.tsx
```

---

## Step 4 — Layout & Navigation ✅

**Files:**
- `components/app-layout.tsx`
- `components/persistent-sidebar.tsx`
- `components/sidebar-nav.tsx`
- `components/page-header.tsx`
- `components/floating-action-button.tsx`
- `app/client/layout.tsx`
- `components/client-portal/client-navigation.tsx`

### Prompt

```
Read all these files:
- components/app-layout.tsx
- components/persistent-sidebar.tsx
- components/sidebar-nav.tsx
- components/page-header.tsx
- components/floating-action-button.tsx
- app/client/layout.tsx
- components/client-portal/client-navigation.tsx

Read DESIGNSYSTEM.md as the source of truth.

Apply the design system:

Replacement map:
- bg-white → bg-card (for sidebar, headers) or bg-background (for page background)
- bg-gray-50 → bg-muted/50
- bg-gray-100 → bg-muted
- text-gray-* → text-foreground or text-muted-foreground (see main mapping table)
- border-gray-* → border-border
- bg-gradient-to-* / from-* / to-* / via-* → remove
- backdrop-blur-* → remove
- shadow-* on non-floating elements → remove
- rounded-xl / rounded-2xl → rounded-lg
- font-bold on headings → font-semibold

Layout rules per DESIGNSYSTEM.md Section 7:
- Sidebar: bg-sidebar border-r border-sidebar-border
- Page header: border-b border-border sticky top-0 z-10 bg-card
- Page content area: p-6
- Floating action button is a floating element, so it CAN keep shadow

Verify after:
grep -rn "gray-\|bg-white\|bg-gradient\|backdrop-blur\|rounded-xl" components/app-layout.tsx components/persistent-sidebar.tsx components/sidebar-nav.tsx components/page-header.tsx components/floating-action-button.tsx app/client/layout.tsx components/client-portal/client-navigation.tsx
```

---

## Step 5 — Dashboard & Top-Level Pages ✅

**Files:**
- `app/dashboard/page.tsx`
- `app/dashboard/content/page.tsx`
- `app/clients/page.tsx`
- `app/clients/[id]/page.tsx`
- `app/clients/overdue/page.tsx`
- `app/check-ins/review/page.tsx`
- `components/dashboard/needs-attention-feed.tsx`
- `components/metric-card.tsx`
- `components/coach-tip-card.tsx`
- `components/stat-card.tsx`

### Prompt

```
Read all these files:
- app/dashboard/page.tsx
- app/dashboard/content/page.tsx
- app/clients/page.tsx
- app/clients/[id]/page.tsx
- app/clients/overdue/page.tsx
- app/check-ins/review/page.tsx
- components/dashboard/needs-attention-feed.tsx
- components/metric-card.tsx
- components/coach-tip-card.tsx
- components/stat-card.tsx

Read DESIGNSYSTEM.md as the source of truth.

Apply the full replacement map:
- bg-white → bg-card
- All gray-* → design tokens (text-foreground, text-muted-foreground, bg-muted, border-border)
- bg-gradient-to-* / from-* / to-* / via-* → remove
- shadow-* on cards → remove
- hover:shadow-* → remove
- rounded-full on badges → rounded-md (keep on avatars)
- rounded-xl / rounded-2xl → rounded-lg
- font-bold on headings → font-semibold
- All heading text → text-foreground
- Labels → font-medium

app/clients/page.tsx is the biggest offender with 50+ old patterns. Be thorough.

Metric card and stat card patterns should match DESIGNSYSTEM.md Section 12.1:
- bg-card border border-border rounded-lg p-6
- Hover: hover:border-primary/30
- No shadow

Verify after:
grep -rn "gray-\|bg-white\|bg-gradient\|shadow-sm\|shadow-md\|rounded-full" app/dashboard/page.tsx app/clients/page.tsx components/dashboard/needs-attention-feed.tsx components/metric-card.tsx components/coach-tip-card.tsx
```

---

## Step 6 — Client Detail: Training ✅

**Files:**
- `components/clients/training/plan-display-header.tsx`
- `components/clients/training/training-plan-card.tsx`
- `components/clients/training/training-plan-history-modal.tsx`
- `components/clients/training/builder/ai-prompt-panel.tsx`
- `components/clients/training/builder/manual-workout-builder.tsx`
- `components/clients/training/builder/mode-toggle.tsx`
- `components/clients/training/builder/quick-suggestions.tsx`
- `components/clients/training/builder/training-builder-left-panel.tsx`
- `components/clients/training/builder/training-builder-right-panel.tsx`
- `components/clients/training/builder/training-plan-builder.tsx`
- `components/clients/training/builder/training-plan-generator-drawer.tsx`
- `components/clients/training/schedule/day-headers-grid.tsx`
- `components/clients/training/schedule/droppable-day-cell.tsx`
- `components/clients/training/schedule/sortable-schedule-item.tsx`
- `components/clients/training/schedule/weekly-schedule-item.tsx`
- `components/clients/training/schedule/weekly-schedule-view.tsx`
- `components/clients/training/schedule/workout-template-picker.tsx`
- `components/clients/training/sessions/add-exercise-dialog.tsx`
- `components/clients/training/sessions/add-session-dialog.tsx`
- `components/clients/training/sessions/session-list.tsx`
- `components/clients/training/sessions/training-exercise-row.tsx`
- `components/clients/training/sessions/training-session-card.tsx`

### Prompt

```
Read all files in components/clients/training/ (recursively — all subdirectories).
Read DESIGNSYSTEM.md as the source of truth.

Apply the full replacement map to every file:
- bg-white → bg-card
- All gray-* → design tokens (text-foreground, text-muted-foreground, bg-muted, bg-muted/50, border-border)
- bg-gradient-to-* / from-* / to-* / via-* → remove
- shadow-* on cards/panels → remove (keep on dialogs/drawers which are floating)
- hover:shadow-* → remove
- rounded-full on badges → rounded-md (keep on avatars)
- rounded-xl / rounded-2xl → rounded-lg
- font-bold on headings → font-semibold
- All heading text → text-foreground
- Labels → font-medium
- backdrop-blur → remove
- ring-2 (non-focus) → ring-1

Training-specific:
- Use training domain tokens where appropriate: bg-training/5, border-training/15, text-training
- Cards: bg-card border border-border rounded-lg (no shadow)
- Drawers/Dialogs: can keep shadow-md

Verify after:
grep -rn "gray-\|bg-white\|bg-gradient\|shadow-sm\|shadow-md\|rounded-full\|rounded-xl\|backdrop-blur" components/clients/training/
```

---

## Step 7 — Client Detail: Nutrition ✅

**Files:**
- `components/clients/nutrition/nutrition-calculator-card.tsx`
- `components/clients/nutrition/nutrition-calculator-card-enhanced.tsx`
- `components/clients/nutrition/nutrition-plan-history-modal.tsx`
- `components/clients/nutrition/nutrition-regeneration-banner.tsx`
- `components/clients/nutrition/nutrition-warnings.tsx`
- `components/clients/nutrition/builder/nutrition-builder-right-panel.tsx`
- `components/clients/nutrition/builder/nutrition-custom-macros-section.tsx`
- `components/clients/nutrition/builder/nutrition-plan-builder.tsx`
- `components/clients/nutrition/builder/nutrition-settings-drawer.tsx`
- `components/clients/nutrition/builder/nutrition-settings-form.tsx`
- `components/clients/nutrition/builder/nutrition-training-calories-display.tsx`
- `components/clients/nutrition/display/nutrition-day-accordion.tsx`
- `components/clients/nutrition/display/nutrition-day-card.tsx`
- `components/clients/nutrition/display/nutrition-plan-header.tsx`
- `components/clients/nutrition/display/nutrition-targets-display.tsx`
- `components/clients/nutrition/display/weekly-nutrition-view.tsx`

### Prompt

```
Read all files in components/clients/nutrition/ (recursively — all subdirectories).
Read DESIGNSYSTEM.md as the source of truth.

This is the heaviest area. Apply the full replacement map:
- bg-white → bg-card
- All gray-* → design tokens (text-foreground, text-muted-foreground, bg-muted, bg-muted/50, border-border)
- bg-gradient-to-* / from-* / to-* / via-* → remove
- shadow-* on cards/panels → remove (keep on dialogs/drawers)
- hover:shadow-* → remove
- rounded-full on badges → rounded-md (keep on avatars)
- rounded-xl / rounded-2xl → rounded-lg
- font-bold on headings → font-semibold
- All heading text → text-foreground
- Labels → font-medium
- ring-2 (non-focus) → ring-1

CRITICAL — Macro nutrient colors:
Replace ALL hardcoded macro colors with the new tokens:
- Protein colors (typically blue-*) → text-protein / bg-protein/10
- Carbs colors (typically amber-*, yellow-*, green-*) → text-carbs / bg-carbs/10
- Fat colors (typically red-*, orange-*, rose-*) → text-fat / bg-fat/10

Look for patterns like:
- text-blue-500, text-blue-600, bg-blue-100 → text-protein, bg-protein/10
- text-amber-500, text-yellow-500, bg-amber-100, bg-yellow-100 → text-carbs, bg-carbs/10
- text-red-500, text-orange-500, text-rose-500, bg-red-100 → text-fat, bg-fat/10
- Any hex values used for macros → replace with tokens

Also look for inline styles with hardcoded colors for chart/progress bars and replace with CSS variable references where possible.

nutrition-settings-form.tsx has 28+ gray instances — be thorough.

Verify after:
grep -rn "gray-\|bg-white\|bg-gradient\|shadow-sm\|blue-[0-9]\|amber-[0-9]\|yellow-[0-9]\|red-[0-9]\|orange-[0-9]\|rose-[0-9]\|rounded-full\|rounded-xl" components/clients/nutrition/
```

---

## Step 8 — Client Detail: Habits, Metrics, Daily Pulse ✅

**Files (Habits):**
- `components/clients/habits/add-habit-dialog.tsx`
- `components/clients/habits/completion-badge.tsx`
- `components/clients/habits/edit-habit-inline.tsx`
- `components/clients/habits/habit-actions.tsx`
- `components/clients/habits/habit-chart-card.tsx`
- `components/clients/habits/habit-empty-state.tsx`
- `components/clients/habits/habits-grid.tsx`
- `components/clients/habits/habits-sidebar.tsx`
- `components/clients/habits/habits-tab-content.tsx`
- `components/clients/habits/habit-list-item.tsx`

**Files (Metrics):**
- `components/clients/metrics/metric-chart-card.tsx`
- `components/clients/metrics/metric-list-item.tsx`
- `components/clients/metrics/metrics-grid.tsx`
- `components/clients/metrics/metrics-sidebar.tsx`
- `components/clients/metrics/metrics-tab-content.tsx`

**Files (Daily Pulse — coach side):**
- `components/clients/daily-pulse/adherence-dot-row.tsx`
- `components/clients/daily-pulse/day-detail-card.tsx`
- `components/clients/daily-pulse/daily-wellness-strip.tsx`
- `components/clients/daily-pulse/wellness-bar-chart.tsx`

### Prompt

```
Read all files in:
- components/clients/habits/ (all files)
- components/clients/metrics/ (all files)
- components/clients/daily-pulse/ (all files)

Read DESIGNSYSTEM.md as the source of truth.

Apply the full replacement map:
- bg-white → bg-card
- All gray-* → design tokens (text-foreground, text-muted-foreground, bg-muted, bg-muted/50, border-border)
- bg-gradient-to-* / from-* / to-* / via-* → remove
- shadow-* on cards → remove
- hover:shadow-* → remove
- rounded-full on badges → rounded-md (keep on avatars and circular progress indicators)
- rounded-xl / rounded-2xl → rounded-lg
- font-bold on headings → font-semibold
- All heading text → text-foreground
- Labels → font-medium
- ring-2 (non-focus) → ring-1

day-detail-card.tsx has 44 gray instances — be extremely thorough.

For any hardcoded macro colors in these files, use the new tokens:
- Protein → text-protein / bg-protein/10
- Carbs → text-carbs / bg-carbs/10
- Fat → text-fat / bg-fat/10

Verify after:
grep -rn "gray-\|bg-white\|bg-gradient\|shadow-sm\|rounded-full\|rounded-xl" components/clients/habits/ components/clients/metrics/ components/clients/daily-pulse/
```

---

## Step 9 — Check-in Components ✅

**Files:**
- `components/check-in/ai-summary-card.tsx`
- `components/check-in/body-fat-goal-card.tsx`
- `components/check-in/check-in-comparison-view.tsx`
- `components/check-in/check-in-data-display.tsx`
- `components/check-in/check-in-detail-modal.tsx`
- `components/check-in/check-in-form.tsx`
- `components/check-in/check-in-response-editor.tsx`
- `components/check-in/check-in-timeline.tsx`
- `components/check-in/daily-context-charts.tsx`
- `components/check-in/daily-context-summary.tsx`
- `components/check-in/daily-logs-summary.tsx`
- `components/check-in/daily-logs-training-summary.tsx`
- `components/check-in/exercise-highlights-section.tsx`
- `components/check-in/external-activities-checkin.tsx`
- `components/check-in/form-success.tsx`
- `components/check-in/goal-deadline-card.tsx`
- `components/check-in/goal-progress-view.tsx`
- `components/check-in/nutrition-adherence-section.tsx`
- `components/check-in/photo-comparison.tsx`
- `components/check-in/progress-charts.tsx`
- `components/check-in/progress-indicator.tsx`
- `components/check-in/send-check-in-dialog.tsx`
- `components/check-in/step-metrics.tsx`
- `components/check-in/step-photos.tsx`
- `components/check-in/step-subjective.tsx`
- `components/check-in/step-training.tsx`
- `components/check-in/training-session-checklist.tsx`
- `components/check-in/weight-goal-card.tsx`

### Prompt

```
Read all files in components/check-in/ (all files).
Read DESIGNSYSTEM.md as the source of truth.

Apply the full replacement map:
- bg-white → bg-card
- All gray-* → design tokens (text-foreground, text-muted-foreground, bg-muted, bg-muted/50, border-border)
- bg-gradient-to-* / from-* / to-* / via-* → remove (use flat colors)
- shadow-* on cards → remove
- hover:shadow-* → remove
- rounded-full on badges → rounded-md (keep on avatars, progress circles)
- rounded-xl / rounded-2xl → rounded-lg
- font-bold on headings → font-semibold
- All heading text → text-foreground
- Labels → font-medium
- ring-2 (non-focus) → ring-1
- backdrop-blur → remove

For macro colors, use the new tokens:
- Protein → text-protein / bg-protein/10
- Carbs → text-carbs / bg-carbs/10
- Fat → text-fat / bg-fat/10

Check-in forms should use:
- Card containers: bg-card border border-border rounded-lg
- Progress indicators: can use bg-primary/10 for track, bg-primary for fill
- Success states: bg-success/10 text-success
- Warning states: bg-warning/10 text-warning

Verify after:
grep -rn "gray-\|bg-white\|bg-gradient\|shadow-sm\|shadow-md\|rounded-full\|rounded-xl\|ring-2\|backdrop-blur" components/check-in/
```

---

## Step 10 — Client Portal Pages ✅

**Files (pages):**
- `app/client/dashboard/page.tsx`
- `app/client/nutrition/page.tsx`
- `app/client/training/page.tsx`
- `app/client/progress/page.tsx`
- `app/client/progress/check-in/[id]/page.tsx`
- `app/client/resources/page.tsx`

**Files (components):**
- `components/client-portal/nutrition/client-nutrition-day-card.tsx`
- `components/client-portal/nutrition/vertical-nutrition-view.tsx`
- `components/client-portal/training/client-session-card.tsx`
- `components/client-portal/training/weekly-completion-progress.tsx`

**Files (daily pulse — client side):**
- `components/daily-pulse/add-activity-form.tsx`
- `components/daily-pulse/activity-list.tsx`
- `components/daily-pulse/daily-pulse.tsx`
- `components/daily-pulse/daily-pulse-content.tsx`
- `components/daily-pulse/daily-pulse-logged-view.tsx`
- `components/daily-pulse/daily-pulse-summary.tsx`
- `components/daily-pulse/day-nav-bar.tsx`
- `components/daily-pulse/habit-row.tsx`
- `components/daily-pulse/habits-section.tsx`
- `components/daily-pulse/macro-inputs.tsx`
- `components/daily-pulse/nutrition-section.tsx`
- `components/daily-pulse/nutrition-section-compact.tsx`
- `components/daily-pulse/nutrition-target-display.tsx`
- `components/daily-pulse/session-picker.tsx`
- `components/daily-pulse/training-section.tsx`
- `components/daily-pulse/training-summary.tsx`
- `components/daily-pulse/wellness-section.tsx`

### Prompt

```
Read all files in:
- app/client/ (all page.tsx and layout.tsx files, recursively)
- components/client-portal/ (all files, recursively)
- components/daily-pulse/ (all files)

Read DESIGNSYSTEM.md as the source of truth.

Apply the full replacement map:
- bg-white → bg-card
- All gray-* → design tokens (text-foreground, text-muted-foreground, bg-muted, bg-muted/50, border-border)
- bg-gradient-to-* / from-* / to-* / via-* → remove
- shadow-* on cards → remove
- hover:shadow-* → remove
- rounded-full on badges → rounded-md (keep on avatars)
- rounded-xl / rounded-2xl → rounded-lg
- font-bold on headings → font-semibold
- All heading text → text-foreground
- Labels → font-medium
- ring-2 (non-focus) → ring-1
- backdrop-blur → remove

For macro colors (especially in nutrition and daily-pulse), use:
- Protein → text-protein / bg-protein/10
- Carbs → text-carbs / bg-carbs/10
- Fat → text-fat / bg-fat/10

Client portal uses a mobile-friendly layout, so:
- Page background: bg-background
- Cards: bg-card border border-border rounded-lg
- Navigation: bg-card border-t border-border (bottom nav)

Verify after:
grep -rn "gray-\|bg-white\|bg-gradient\|shadow-sm\|rounded-xl\|rounded-full" app/client/ components/client-portal/ components/daily-pulse/
```

---

## Step 11 — Remaining Pages & Components ✅

**Files (pages):**
- `app/crm/page.tsx`
- `app/automation/page.tsx`
- `app/automation/loading.tsx`
- `app/email/page.tsx`
- `app/email/loading.tsx`
- `app/messages/page.tsx`
- `app/messages/loading.tsx`
- `app/settings/page.tsx`
- `app/(marketing)/layout.tsx`
- `app/(marketing)/page.tsx`
- `app/global-error.tsx`

**Files (root components):**
- `components/add-client-dialog.tsx`
- `components/animated-counter.tsx`
- `components/automation-rule-card.tsx`
- `components/client-status-badge.tsx`
- `components/conversation-list.tsx`
- `components/edit-client-dialog.tsx`
- `components/engagement-indicator.tsx`
- `components/lead-card.tsx`
- `components/message-bubble.tsx`

**Files (client sub-components):**
- `components/clients/activities/activity-analysis-preview.tsx`
- `components/clients/activities/activity-autocomplete.tsx`
- `components/clients/activities/add-activity-dialog.tsx`
- `components/clients/activities/external-activities-section.tsx`
- `components/clients/activities/external-activity-card.tsx`
- `components/clients/activities/pre-generation-activities.tsx`
- `components/clients/activities/pre-generation-activity-form.tsx`
- `components/clients/activities/pre-generation-activity-item.tsx`
- `components/clients/check-in/check-in-schedule-card.tsx`
- `components/clients/check-in/metric-save-dialog.tsx`
- `components/clients/check-in/overdue-banner.tsx`
- `components/clients/check-in/overdue-client-card.tsx`
- `components/clients/check-in/reminder-history-modal.tsx`
- `components/clients/invite-client-dialog.tsx`
- `components/clients/shared/exercise-search-input.tsx`
- `components/clients/shared/inline-editable-metric.tsx`
- `components/clients/shared/unit-toggle.tsx`

### Prompt

```
Read all these files (in batches if needed):

Pages:
- app/crm/page.tsx
- app/automation/page.tsx
- app/email/page.tsx
- app/messages/page.tsx
- app/settings/page.tsx
- app/(marketing)/layout.tsx
- app/(marketing)/page.tsx

Root components:
- components/add-client-dialog.tsx
- components/animated-counter.tsx
- components/automation-rule-card.tsx
- components/client-status-badge.tsx
- components/conversation-list.tsx
- components/edit-client-dialog.tsx
- components/engagement-indicator.tsx
- components/lead-card.tsx
- components/message-bubble.tsx

Client sub-components:
- components/clients/activities/ (all files)
- components/clients/check-in/ (all files)
- components/clients/invite-client-dialog.tsx
- components/clients/shared/ (all files)

Read DESIGNSYSTEM.md as the source of truth.

Apply the full replacement map:
- bg-white → bg-card
- All gray-* → design tokens
- bg-gradient-to-* / from-* / to-* / via-* → remove
- shadow-* on cards → remove
- hover:shadow-* → remove
- rounded-full on badges → rounded-md
- rounded-xl / rounded-2xl → rounded-lg
- font-bold on headings → font-semibold
- All heading text → text-foreground
- Labels → font-medium
- ring-2 (non-focus) → ring-1
- backdrop-blur → remove

Marketing pages (app/(marketing)/*) may have intentional gradients for the landing page. Replace those with the design system approach: flat bg-background with accent colors via tokens. No gradients.

Verify after:
grep -rn "gray-\|bg-white\|bg-gradient\|shadow-sm\|rounded-full\|rounded-xl\|backdrop-blur" app/crm/ app/automation/ app/email/ app/messages/ app/settings/ "app/(marketing)/" components/add-client-dialog.tsx components/lead-card.tsx components/message-bubble.tsx components/clients/activities/ components/clients/check-in/ components/clients/shared/
```

---

## Step 12 — Final Verification ✅

### Prompt

```
Run these grep commands across the entire codebase (excluding node_modules, .next, .git) and report the results. Do NOT make any changes — just report.

1. Hardcoded grays (should be zero outside of tailwind config and CSS variable definitions):
   grep -rn "text-gray-\|bg-gray-\|border-gray-" --include="*.tsx" --include="*.ts" --exclude-dir=node_modules --exclude-dir=.next .

2. bg-white (should be zero in components/app):
   grep -rn "bg-white" --include="*.tsx" --exclude-dir=node_modules --exclude-dir=.next .

3. Gradients (should be zero):
   grep -rn "bg-gradient-to-\|from-[a-z]\|via-[a-z]" --include="*.tsx" --exclude-dir=node_modules --exclude-dir=.next .

4. Shadows on non-floating elements (review each — only dialogs, dropdowns, segmented-control active thumb should have shadow):
   grep -rn "shadow-sm\|shadow-md\|shadow-lg" --include="*.tsx" --exclude-dir=node_modules --exclude-dir=.next .

5. rounded-full on non-avatars:
   grep -rn "rounded-full" --include="*.tsx" --exclude-dir=node_modules --exclude-dir=.next .

6. rounded-xl / rounded-2xl (should be zero):
   grep -rn "rounded-xl\|rounded-2xl" --include="*.tsx" --exclude-dir=node_modules --exclude-dir=.next .

7. backdrop-blur (should be zero):
   grep -rn "backdrop-blur" --include="*.tsx" --exclude-dir=node_modules --exclude-dir=.next .

8. Old font references:
   grep -rn "Inter\b" --include="*.tsx" --include="*.ts" --include="*.css" --exclude-dir=node_modules --exclude-dir=.next .

9. ring-2 (review — only focus-visible:ring-2 on buttons is correct):
   grep -rn "ring-2" --include="*.tsx" --exclude-dir=node_modules --exclude-dir=.next .

10. Hardcoded macro colors (should use protein/carbs/fat tokens):
    grep -rn "text-blue-[0-9]\|bg-blue-[0-9]\|text-amber-[0-9]\|bg-amber-[0-9]\|text-red-[0-9]\|bg-red-[0-9]\|text-orange-[0-9]\|bg-orange-[0-9]" --include="*.tsx" --exclude-dir=node_modules --exclude-dir=.next .

For each grep, report:
- Number of matches
- File:line for each match
- Whether it's a legitimate use or needs fixing

If there are remaining violations, list them grouped by file with the fix needed.
Then do a visual spot-check by listing the key user flows that should be manually tested:
1. Login → Dashboard
2. Client list → Client detail → Training tab
3. Client detail → Nutrition tab
4. Client detail → Habits/Metrics tab
5. Check-in form (client-facing)
6. Check-in review (coach-facing)
7. Client portal dashboard
8. Daily pulse logging
9. Settings page
10. Marketing/landing page
```

---

## Execution Order

| Step | Area | Est. Files | Dependencies |
|------|------|-----------|--------------|
| 0 | Font Swap | 3 | None |
| 1 | Macro Tokens + Typography | 2 | Step 0 |
| 2 | UI Primitives | ~13 | Step 1 |
| 3 | Auth Pages | 6 | Step 2 |
| 4 | Layout & Nav | 7 | Step 2 |
| 5 | Dashboard & Top Pages | ~10 | Step 2 |
| 6 | Training | ~22 | Step 2 |
| 7 | Nutrition | ~16 | Step 1 (macro tokens) |
| 8 | Habits/Metrics/Pulse | ~27 | Step 1 (macro tokens) |
| 9 | Check-in | ~28 | Step 2 |
| 10 | Client Portal | ~23 | Step 1 (macro tokens) |
| 11 | Remaining | ~28 | Step 2 |
| 12 | Final Verification | 0 | All above |

Steps 3–11 can be run in any order after Step 2. Steps 7, 8, 10 need Step 1 for macro tokens.

**Total files:** ~185 modifications across 12 steps.
