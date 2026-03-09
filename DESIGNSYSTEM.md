# CoachHub Design System

> Minimal & clean aesthetic inspired by Linear, Vercel, and Stripe. This document is the single source of truth for all UI patterns. Every code example is pulled from real component implementations.

---

## Table of Contents

1. [Design Principles](#1-design-principles)
2. [Colours](#2-colours)
3. [Typography](#3-typography)
4. [Spacing](#4-spacing)
5. [Borders & Elevation](#5-borders--elevation)
6. [Border Radius](#6-border-radius)
7. [Layout](#7-layout)
8. [Components](#8-components)
9. [States](#9-states)
10. [Animation & Transitions](#10-animation--transitions)
11. [Icons](#11-icons)
12. [Patterns](#12-patterns)

---

## 1. Design Principles

### 1.1 Core Values

- **Restrained** — Monochrome palette with one strong accent colour; let content do the talking
- **Structured** — Borders and tokens for separation, not shadows or colour washes
- **Snappy** — Fast, subtle animations (0.15–0.2s); nothing bouncy or theatrical
- **Consistent** — Same patterns everywhere, no one-off designs
- **Professional** — Coaches trust us with their business; the UI should feel reliable

### 1.2 Visual Guidelines

- Use **borders** for separation — `border border-border` on all containers
- Shadows are barely-there and reserved for **floating layers** (dropdowns, dialogs, segmented-control active thumb)
- Colour is used **sparingly** — mostly monochrome; colour signals meaning (status, domain, action)
- No gradients, no glassmorphism, no decorative backgrounds
- All colours, borders, and backgrounds use **design tokens** — never hardcode `gray-*`, `white`, or hex values

---

## 2. Colours

> **Tailwind v4 CSS Variables**
>
> This project uses **Tailwind v4** with OKLCH CSS variables defined in `app/globals.css`.
> Do NOT use numbered colour scales like `bg-primary-600` — they don't exist.
>
> **Use CSS variable classes with opacity modifiers:**
> - `bg-primary` — full colour
> - `bg-primary/10` — 10% tint (badges, highlights)
> - `bg-primary/5` — 5% tint (card variant backgrounds)

### 2.1 Token Reference

| Token | OKLCH Value (Light) | Role |
|-------|-------------------|------|
| `--primary` | `oklch(0.45 0.18 255)` | Deep blue — buttons, links, accent |
| `--primary-foreground` | `oklch(0.99 0 0)` | Text on primary |
| `--secondary` | `oklch(0.965 0.002 260)` | Neutral light surface |
| `--secondary-foreground` | `oklch(0.25 0.004 260)` | Text on secondary |
| `--accent` | `oklch(0.965 0.002 260)` | Same as secondary (no violet) |
| `--destructive` | `oklch(0.55 0.2 25)` | Errors, delete actions |
| `--success` | `oklch(0.55 0.15 155)` | Success states |
| `--warning` | `oklch(0.7 0.15 75)` | Warning states |
| `--background` | `oklch(0.985 0 0)` | Page background |
| `--foreground` | `oklch(0.145 0.004 260)` | Primary text |
| `--card` | `oklch(1 0 0)` | Card/surface background |
| `--muted` | `oklch(0.965 0.002 260)` | Muted surfaces, segmented control track |
| `--muted-foreground` | `oklch(0.556 0.01 260)` | Secondary/helper text |
| `--border` | `oklch(0.915 0.004 260)` | All borders |
| `--input` | `oklch(0.915 0.004 260)` | Input borders |
| `--ring` | `oklch(0.45 0.18 255)` | Focus ring (matches primary) |
| `--training` | `oklch(0.55 0.12 180)` | Training domain (teal) |
| `--nutrition` | `oklch(0.6 0.14 55)` | Nutrition domain (amber) |
| `--error` | `oklch(0.55 0.2 25)` | Error domain (same as destructive) |
| `--protein` | `oklch(0.55 0.18 255)` | Protein macro colour (blue) |
| `--carbs` | `oklch(0.6 0.14 55)` | Carbohydrate macro colour (amber) |
| `--fat` | `oklch(0.55 0.15 25)` | Fat macro colour (red-orange) |

### 2.2 Colour Usage

| Use Case | Tailwind Class |
|----------|----------------|
| Page background | `bg-background` |
| Card/surface background | `bg-card` |
| Primary text | `text-foreground` |
| Secondary text | `text-muted-foreground` |
| Borders | `border-border` |
| Primary button | `bg-primary text-primary-foreground` |
| Primary button hover | `hover:bg-primary/90` |
| Badge tint background | `bg-primary/10`, `bg-success/10`, `bg-warning/10`, `bg-destructive/10` |
| Card variant tint | `bg-training/5 border border-training/15` |
| Interactive card hover | `hover:border-primary/30` |
| Protein badge/chart | `bg-protein/10 text-protein` |
| Carbs badge/chart | `bg-carbs/10 text-carbs` |
| Fat badge/chart | `bg-fat/10 text-fat` |

### 2.3 Opacity Tints

```tsx
// Badges — use /10 opacity
className="bg-primary/10 text-primary"
className="bg-success/10 text-success"
className="bg-warning/10 text-warning"
className="bg-destructive/10 text-destructive"

// Card domain variants — use /5 bg, /15 border
className="bg-training/5 border border-training/15"
className="bg-nutrition/5 border border-nutrition/15"

// Hover accents — use /30
className="hover:border-primary/30"

// Icon containers — use /10 bg, /15 hover
className="bg-primary/10 group-hover:bg-primary/15"
```

### 2.4 What NOT to Use

```tsx
// WRONG — hardcoded grays
className="text-gray-900"        // Use text-foreground
className="text-gray-500"        // Use text-muted-foreground
className="border-gray-200"      // Use border-border
className="bg-gray-100"          // Use bg-muted
className="bg-gray-50"           // Use bg-muted/50
className="bg-white"             // Use bg-card

// WRONG — gradients
className="bg-gradient-to-r from-primary to-accent"

// WRONG — /15 opacity for badges (we use /10)
className="bg-primary/15"
```

---

## 3. Typography

### 3.1 Font Stack

Plus Jakarta Sans is the primary font, loaded via `next/font/google` in the root layout:

```tsx
import { Plus_Jakarta_Sans } from 'next/font/google'
const plusJakarta = Plus_Jakarta_Sans({ subsets: ['latin'], weight: ['400', '500', '600', '700'] })
```

### 3.2 Type Scale

| Name | Class | Use Case |
|------|-------|----------|
| Display | `text-4xl font-bold tracking-tight` | Hero numbers |
| H1 | `text-3xl font-semibold tracking-tight` | Page titles |
| H2 | `text-2xl font-semibold tracking-tight` | Section titles |
| H3 | `text-xl font-semibold` | Sub-sections |
| H4 | `text-lg font-semibold` | Card headers |
| Body | `text-base` | Default body |
| Body Small | `text-sm` | Most UI text |
| Caption | `text-xs font-medium` | Labels, badges, metadata |
| Overline | `text-xs font-medium uppercase tracking-wider` | Column headers, categories |

### 3.3 Typography Patterns

```tsx
// Page title
<h1 className="text-2xl font-semibold text-foreground tracking-tight">
  Training Plan
</h1>

// Section heading
<h3 className="text-base font-semibold tracking-tight">
  Needs Attention
</h3>

// Card title (via CardTitle component)
<CardTitle>Weekly Overview</CardTitle>
// Renders: font-semibold text-foreground tracking-tight

// Body text
<p className="text-sm text-muted-foreground">
  A balanced program designed to enhance performance.
</p>

// Label
<label className="text-sm font-medium text-foreground">
  Work Activity Level
</label>

// Metric label
<p className="text-sm font-medium text-muted-foreground mb-3">Active Clients</p>

// Large stat
<h3 className="text-4xl font-semibold tracking-tight">
  2,744
</h3>
```

---

## 4. Spacing

### 4.1 Spacing Scale

Use Tailwind's default scale. Preferred values:

| Token | Value | Use Case |
|-------|-------|----------|
| 1 | 4px | Tight gaps (badge icon + text) |
| 2 | 8px | Small element gaps |
| 3 | 12px | Compact component padding |
| 4 | 16px | Standard gaps between components |
| 5 | 20px | Card padding (`p-5`) |
| 6 | 24px | Section padding, page padding |
| 8 | 32px | Large section gaps |

### 4.2 Common Spacing Patterns

```tsx
// Card body padding
className="p-5"              // 20px — standard card content
className="p-6"              // 24px — metric cards, spacious cards

// Card header/footer padding
className="px-5 py-4"        // CardHeader, CardFooter

// Gap between cards
className="gap-4"            // 16px grid gap

// Form field spacing
className="space-y-4"        // 16px between fields
className="space-y-1.5"      // 6px between label and input

// Page content
className="p-6"              // Page padding
className="mb-6"             // Section spacing
```

---

## 5. Borders & Elevation

### 5.1 Borders Are Primary

Borders are the primary separation mechanism. Every card, input, and container uses `border border-border`.

```tsx
// Standard card
className="bg-card border border-border rounded-lg"

// Input
className="bg-transparent border border-border rounded-md"

// Dialog
className="bg-card border border-border rounded-lg"

// Divider inside a card
className="border-b border-border"   // CardHeader bottom
className="border-t border-border"   // CardFooter top

// Table rows
className="border-b"                 // Row separator

// Tabs
className="border-b border-border"   // TabsList bottom border
```

### 5.2 Shadow Scale

Shadows are reserved for **floating** elements only. Defined as CSS custom properties:

| Token | Value | Use Case |
|-------|-------|----------|
| `--shadow-sm` | `0 1px 2px rgba(0,0,0,0.04)` | Segmented control active thumb |
| `--shadow-md` | `0 2px 8px rgba(0,0,0,0.06)` | Dropdowns, dialogs, select content |
| `--shadow-lg` | `0 4px 12px rgba(0,0,0,0.08)` | — reserved — |

```tsx
// Segmented control active button
className="bg-card text-foreground shadow-sm"

// Select dropdown content
className="bg-card rounded-lg shadow-md border border-border"

// Dialog content
className="bg-card border border-border rounded-lg shadow-md"
```

### 5.3 What NOT to Do

```tsx
// WRONG — shadows on cards
className="bg-card rounded-lg shadow-sm"           // No shadow on cards
className="bg-card rounded-lg hover:shadow-md"      // No shadow hover on cards

// WRONG — shadow on buttons
className="bg-primary shadow-sm hover:shadow"       // No shadow on buttons
```

---

## 6. Border Radius

### 6.1 Radius Tokens

Defined in `globals.css`:

| Token | Value | Tailwind Class | Use Case |
|-------|-------|---------------|----------|
| `--radius` | `0.625rem` (10px) | `rounded-lg` | Cards, segmented control track, select dropdown |
| `--radius-xs` | `0.375rem` (6px) | `rounded-md` | Buttons, inputs, badges, select items |
| — | — | `rounded-full` | Avatars only |

### 6.2 Standard Usage

```tsx
// Cards and containers
className="rounded-lg"     // All cards, dialogs, segmented control

// Buttons (all sizes and variants)
className="rounded-md"

// Inputs and selects
className="rounded-md"

// Badges
className="rounded-md"

// Avatars
className="rounded-full"
```

### 6.3 What NOT to Do

```tsx
// WRONG
className="rounded-xl"     // Not used — cards are rounded-lg
className="rounded-2xl"    // Not used — dialogs are rounded-lg
className="rounded-full"   // Only for avatars, never for badges
```

---

## 7. Layout

### 7.1 Page Structure

```tsx
<div className="min-h-screen bg-background">
  {/* Sidebar - fixed */}
  <aside className="fixed left-0 top-0 h-screen w-64 bg-sidebar border-r border-sidebar-border">
    {/* Sidebar content */}
  </aside>

  {/* Main content area */}
  <main className="ml-64">
    {/* Page header */}
    <header className="border-b border-border sticky top-0 z-10 bg-card">
      <div className="px-6 py-4">
        {/* Title, actions */}
      </div>
    </header>

    {/* Page content */}
    <div className="p-6">
      {/* Content */}
    </div>
  </main>
</div>
```

### 7.2 Content Layout Patterns

```tsx
// Two-column layout
<div className="grid grid-cols-[380px_1fr] gap-6">
  <aside>{/* Panel */}</aside>
  <main>{/* Content */}</main>
</div>

// Card grid
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
  {/* Cards */}
</div>

// Stacked sections
<div className="space-y-6">
  <section>{/* Section 1 */}</section>
  <section>{/* Section 2 */}</section>
</div>
```

---

## 8. Components

### 8.1 Buttons

Use the `<Button>` component from `components/ui/button.tsx`. All variants use `rounded-md`, no shadows.

#### Variants

```tsx
// Primary (default)
<Button>Save Changes</Button>
// → bg-primary hover:bg-primary/90 text-primary-foreground rounded-md

// Secondary
<Button variant="secondary">Cancel</Button>
// → bg-secondary text-secondary-foreground border border-border hover:bg-muted rounded-md

// Outline
<Button variant="outline">Settings</Button>
// → border border-border bg-transparent text-foreground hover:bg-muted rounded-md

// Ghost
<Button variant="ghost">
  <Settings className="w-4 h-4" />
  Settings
</Button>
// → text-muted-foreground hover:text-foreground hover:bg-muted rounded-md

// Destructive
<Button variant="destructive">Delete Client</Button>
// → bg-destructive hover:bg-destructive/90 text-destructive-foreground rounded-md

// AI (same styling as primary — no gradient)
<Button variant="ai">
  <Sparkles className="w-4 h-4" />
  Generate with AI
</Button>
// → bg-primary hover:bg-primary/90 text-primary-foreground rounded-md

// Link
<Button variant="link">Learn more</Button>
// → text-primary underline-offset-4 hover:underline
```

#### Sizes

```tsx
<Button size="sm">Small</Button>      // h-8 px-3 py-1.5 text-sm
<Button>Default</Button>              // h-10 px-4 py-2.5
<Button size="lg">Large</Button>      // h-11 px-6 py-3 text-base
<Button size="icon">                  // h-9 w-9
  <MoreHorizontal className="w-4 h-4" />
</Button>
```

#### Shared Behaviour

All buttons include:
- `transition-colors duration-150`
- `active:scale-[0.98]`
- `focus-visible:ring-2 focus-visible:ring-ring`
- `disabled:pointer-events-none disabled:opacity-50`

### 8.2 Cards

Use the `<Card>` component from `components/ui/card.tsx`. All variants use `rounded-lg`, border-based separation, no shadows.

#### Variants

```tsx
// Default
<Card>
  <CardBody>Content</CardBody>
</Card>
// → bg-card border border-border rounded-lg

// Interactive (hoverable)
<Card variant="interactive">
  <CardBody>Clickable content</CardBody>
</Card>
// → bg-card border border-border hover:border-primary/30 cursor-pointer rounded-lg

// Domain: Training
<Card variant="training">
  <CardBody>Training content</CardBody>
</Card>
// → bg-training/5 border border-training/15 rounded-lg

// Domain: Nutrition
<Card variant="nutrition">
  <CardBody>Nutrition content</CardBody>
</Card>
// → bg-nutrition/5 border border-nutrition/15 rounded-lg

// AI (no gradient — plain card)
<Card variant="ai">
  <CardBody>AI-generated content</CardBody>
</Card>
// → bg-card border border-border rounded-lg

// Status variants
<Card variant="success">...</Card>   // bg-success/5 border-success/15
<Card variant="warning">...</Card>   // bg-warning/5 border-warning/15
<Card variant="error">...</Card>     // bg-destructive/5 border-destructive/15
```

#### Sub-components

```tsx
<Card>
  <CardHeader>
    <CardTitle>Card Title</CardTitle>
    <CardAction>
      <Button variant="ghost" size="icon">
        <MoreHorizontal className="w-4 h-4" />
      </Button>
    </CardAction>
  </CardHeader>
  <CardBody>
    <p className="text-sm text-muted-foreground">Card content</p>
  </CardBody>
  <CardFooter>
    <Button>Save</Button>
  </CardFooter>
</Card>

// CardHeader → px-5 py-4 border-b border-border flex items-center justify-between
// CardBody   → p-5
// CardFooter → px-5 py-4 border-t border-border bg-muted/50 rounded-b-lg
// CardTitle  → font-semibold text-foreground tracking-tight
```

### 8.3 Badges

Use the `<Badge>` component from `components/ui/badge.tsx`. All badges use `rounded-md`, `/10` opacity tints, never `rounded-full`.

```tsx
<Badge>Default</Badge>                    // bg-primary/10 text-primary
<Badge variant="success">Active</Badge>   // bg-success/10 text-success
<Badge variant="warning">Pending</Badge>  // bg-warning/10 text-warning
<Badge variant="destructive">Overdue</Badge> // bg-destructive/10 text-destructive
<Badge variant="secondary">Draft</Badge>  // bg-muted text-muted-foreground
<Badge variant="training">Training</Badge> // bg-training/10 text-training
<Badge variant="nutrition">Nutrition</Badge> // bg-nutrition/10 text-nutrition
<Badge variant="outline">v2.0</Badge>     // border border-border bg-transparent text-muted-foreground

// Badge with icon
<Badge variant="training">
  <Dumbbell className="w-3 h-3" />
  Training
</Badge>

// Shared: inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium
```

### 8.4 Inputs

Use the `<Input>` component from `components/ui/input.tsx`.

```tsx
// Text input
<div className="space-y-1.5">
  <label className="text-sm font-medium text-foreground">Client Name</label>
  <Input placeholder="Enter name" />
  <p className="text-xs text-muted-foreground">This will be visible to the client</p>
</div>

// Input classes:
// bg-transparent border border-border rounded-md text-sm
// placeholder:text-muted-foreground
// focus:border-primary focus:ring-1 focus:ring-primary/20
// disabled:opacity-50 disabled:cursor-not-allowed

// Input with icon (manual composition)
<div className="relative">
  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
  <Input className="pl-10" placeholder="Search clients..." />
</div>
```

### 8.5 Select

Use the `<Select>` components from `components/ui/select.tsx`.

```tsx
<Select>
  <SelectTrigger>
    <SelectValue placeholder="Select option" />
  </SelectTrigger>
  <SelectContent>
    <SelectItem value="1">Option 1</SelectItem>
    <SelectItem value="2">Option 2</SelectItem>
  </SelectContent>
</Select>

// SelectTrigger → bg-transparent border border-border rounded-md
//                 focus:border-primary focus:ring-1 focus:ring-primary/20
// SelectContent → bg-card rounded-lg shadow-md border border-border
// SelectItem    → rounded-md focus:bg-muted cursor-pointer
```

### 8.6 Tabs

Use the `<Tabs>` components from `components/ui/tabs.tsx`. Underline style with `border-b-2`.

```tsx
<Tabs defaultValue="training">
  <TabsList>
    <TabsTrigger value="training">Training Plan</TabsTrigger>
    <TabsTrigger value="nutrition">Nutrition</TabsTrigger>
    <TabsTrigger value="content">Content Access</TabsTrigger>
  </TabsList>
  <TabsContent value="training">...</TabsContent>
</Tabs>

// TabsList    → inline-flex border-b border-border bg-transparent
// TabsTrigger → text-sm font-medium text-muted-foreground border-b-2 border-transparent -mb-px
//               hover:text-foreground
//               data-[state=active]:border-primary data-[state=active]:text-foreground
```

### 8.7 Segmented Control

Use the `<SegmentedControl>` from `components/ui/segmented-control.tsx`.

```tsx
<SegmentedControl
  options={[
    { value: "week", label: "Week", icon: <CalendarDays /> },
    { value: "list", label: "List", icon: <List /> },
  ]}
  value={view}
  onChange={setView}
/>

// Track    → bg-muted p-1 rounded-lg inline-flex
// Active   → bg-card text-foreground shadow-sm rounded-md
// Inactive → text-muted-foreground hover:text-foreground rounded-md
// Sizes    → default: px-4 py-2 text-sm | sm: px-3 py-1.5 text-xs
```

### 8.8 Dialogs / Modals

Use the `<Dialog>` components from `components/ui/dialog.tsx`.

```tsx
<Dialog>
  <DialogTrigger asChild>
    <Button>Open</Button>
  </DialogTrigger>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>Modal Title</DialogTitle>
      <DialogDescription>Optional description text</DialogDescription>
    </DialogHeader>
    <div>{/* Modal body */}</div>
    <DialogFooter>
      <Button variant="outline">Cancel</Button>
      <Button>Save</Button>
    </DialogFooter>
  </DialogContent>
</Dialog>

// DialogContent → bg-card border border-border rounded-lg shadow-md p-6
// DialogOverlay → bg-black/40
// DialogFooter  → flex flex-col-reverse gap-2 sm:flex-row sm:justify-end
```

### 8.9 Tables

Use the `<Table>` components from `components/ui/table.tsx`.

```tsx
<Table>
  <TableHeader>
    <TableRow>
      <TableHead>Name</TableHead>
      <TableHead>Status</TableHead>
    </TableRow>
  </TableHeader>
  <TableBody>
    <TableRow>
      <TableCell>Sam Kalepa</TableCell>
      <TableCell><Badge variant="success">Active</Badge></TableCell>
    </TableRow>
  </TableBody>
</Table>

// TableHead → text-muted-foreground text-xs uppercase tracking-wider font-medium
// TableRow  → hover:bg-muted/30 border-b
// TableCell → p-2 align-middle whitespace-nowrap
```

### 8.10 Avatars

```tsx
// With image
<div className="w-10 h-10 rounded-full overflow-hidden">
  <img src={avatarUrl} alt={name} className="w-full h-full object-cover" />
</div>

// With initials
<div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
  <span className="text-sm font-medium text-primary">SK</span>
</div>

// Sizes: w-8 h-8 (sm) | w-10 h-10 (default) | w-12 h-12 (lg)
```

---

## 9. States

### 9.1 Interactive States

```tsx
// Hover — cards
className="hover:border-primary/30"

// Hover — buttons/links
className="hover:bg-primary/90"         // Primary button
className="hover:bg-muted"             // Ghost/outline button
className="hover:text-foreground"      // Text links

// Focus
className="focus-visible:ring-2 focus-visible:ring-ring"      // Buttons
className="focus:border-primary focus:ring-1 focus:ring-primary/20"  // Inputs

// Active/Pressed
className="active:scale-[0.98]"        // Buttons only

// Disabled
className="disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none"
```

### 9.2 Loading States

```tsx
// Skeleton
<div className="animate-pulse space-y-3">
  <div className="h-4 bg-muted rounded w-3/4"></div>
  <div className="h-4 bg-muted rounded w-1/2"></div>
</div>

// Spinner
<div className="w-5 h-5 border-2 border-muted border-t-primary rounded-full animate-spin" />

// Button loading
<Button disabled className="relative">
  <span className="opacity-0">Save Changes</span>
  <div className="absolute inset-0 flex items-center justify-center">
    <div className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
  </div>
</Button>
```

### 9.3 Empty States

```tsx
<div className="flex flex-col items-center justify-center py-16 px-8 text-center">
  <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
    <Dumbbell className="w-8 h-8 text-muted-foreground" />
  </div>
  <h3 className="text-lg font-semibold text-foreground mb-2">
    No training plan yet
  </h3>
  <p className="text-sm text-muted-foreground mb-6 max-w-sm">
    Create a personalised training program for your client.
  </p>
  <Button>
    <Sparkles className="w-4 h-4" />
    Generate with AI
  </Button>
</div>
```

### 9.4 Error States

```tsx
// Form field error
<div className="space-y-1.5">
  <label className="text-sm font-medium text-foreground">Email</label>
  <Input className="border-destructive focus:border-destructive focus:ring-destructive/20" />
  <p className="text-xs text-destructive flex items-center gap-1">
    <AlertCircle className="w-3 h-3" />
    Please enter a valid email address
  </p>
</div>
```

---

## 10. Animation & Transitions

### 10.1 CSS Transitions

All interactive elements use `transition-colors duration-150`:

```tsx
// Standard (colour change only — most common)
className="transition-colors duration-150"

// All properties (when layout shifts)
className="transition-all duration-150"
```

### 10.2 Framer Motion — Entry Animations

Use `framer-motion` for component entry animations. Keep them **snappy**: small Y offset (6–8px), fast duration (0.15–0.2s), `easeOut` easing.

```tsx
// Card/section fade up
<motion.div
  initial={{ opacity: 0, y: 6 }}
  animate={{ opacity: 1, y: 0 }}
  transition={{ duration: 0.2, delay: 0.05 }}
>

// Metric card with staggered delay
<motion.div
  initial={{ opacity: 0, y: 8 }}
  animate={{ opacity: 1, y: 0 }}
  transition={{ delay: index * 0.05, duration: 0.2, ease: "easeOut" }}
>

// Inline element (badge, trend indicator)
<motion.div
  initial={{ opacity: 0, scale: 0.8 }}
  animate={{ opacity: 1, scale: 1 }}
  transition={{ delay: 0.2 }}
>
```

### 10.3 Animation Don'ts

```tsx
// WRONG — too much Y offset (looks sluggish)
initial={{ opacity: 0, y: 20 }}

// WRONG — too slow
transition={{ duration: 0.5 }}

// WRONG — bouncy spring (not our aesthetic)
transition={{ type: "spring", bounce: 0.4 }}

// WRONG — scale hover effects on cards
whileHover={{ scale: 1.02 }}

// WRONG — elaborate stagger delays
transition={{ delay: index * 0.15 }}   // Keep stagger to 0.05s max
```

---

## 11. Icons

### 11.1 Icon Library

Use **Lucide React** exclusively:

```tsx
import { Dumbbell, Utensils, Sparkles, ChevronRight, Check, X } from 'lucide-react'
```

### 11.2 Icon Sizes

| Size | Class | Use Case |
|------|-------|----------|
| 12px | `w-3 h-3` | Inline with small text, badges |
| 16px | `w-4 h-4` | Buttons, inputs, default |
| 20px | `w-5 h-5` | Navigation, icon containers |
| 24px | `w-6 h-6` | Section icons |
| 32px | `w-8 h-8` | Empty states |

### 11.3 Icon Colours

```tsx
className="text-muted-foreground"                     // Default
className="text-muted-foreground hover:text-foreground" // Interactive
className="text-primary-foreground"                   // Inside primary button
className="text-primary"                              // Accent / feature icon
className="text-success"                              // Positive states
className="text-warning"                              // Caution states
className="text-destructive"                          // Error states
className="text-training"                             // Training domain
className="text-nutrition"                            // Nutrition domain
```

---

## 12. Patterns

### 12.1 Metric Card

From `components/metric-card.tsx`:

```tsx
<motion.div
  initial={{ opacity: 0, y: 8 }}
  animate={{ opacity: 1, y: 0 }}
  transition={{ delay, duration: 0.2, ease: "easeOut" }}
  className="rounded-lg bg-card border border-border p-6 transition-colors duration-150 hover:border-primary/30"
>
  <div className="flex items-start justify-between">
    <div className="flex-1">
      <p className="text-sm font-medium text-muted-foreground mb-3">{title}</p>
      <div className="flex items-baseline gap-2">
        <h3 className="text-4xl font-semibold tracking-tight">{value}</h3>
        {trend && (
          <div className={`flex items-center gap-1 text-xs font-medium ${
            trend.positive ? "text-success" : "text-destructive"
          }`}>
            {trend.positive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            {trend.value}
          </div>
        )}
      </div>
    </div>
    <div className="flex h-12 w-12 items-center justify-center rounded-md bg-primary/10 text-primary">
      <Icon className="h-5 w-5" />
    </div>
  </div>
</motion.div>
```

### 12.2 Needs Attention Feed

From `components/dashboard/needs-attention-feed.tsx`:

```tsx
// Container
<motion.div
  initial={{ opacity: 0, y: 6 }}
  animate={{ opacity: 1, y: 0 }}
  transition={{ duration: 0.2, delay: 0.05 }}
  className="bg-card border border-border rounded-lg p-5 mb-6"
>
  {/* Header with on-track badge */}
  <div className="flex items-center justify-between mb-3">
    <h3 className="text-base font-semibold tracking-tight">Needs Attention</h3>
    <span className="bg-success/10 text-success text-xs font-medium px-2 py-0.5 rounded-md">
      12 of 15 clients on track
    </span>
  </div>

  {/* Priority client (high severity) */}
  <div className="bg-destructive/5 border border-destructive/10 rounded-lg p-3 mb-3">
    {/* Avatar + name + alert text */}
  </div>

  {/* Compact list with dividers */}
  <div className="divide-y divide-border">
    <div className="py-2 flex items-center justify-between">
      <span className="text-sm text-foreground">Client Name</span>
      <span className="bg-warning/10 text-warning text-xs font-medium px-1.5 py-0.5 rounded-md">2</span>
      <Link className="text-sm text-primary hover:text-primary/80">View</Link>
    </div>
  </div>
</motion.div>
```

### 12.3 Priority Recommendation Cards

```tsx
// High priority
<Card variant="error" className="border-l-4 border-l-destructive">
  <CardBody>
    <span className="text-xs font-semibold text-destructive uppercase tracking-wide">High Priority</span>
    <p className="text-sm text-muted-foreground mt-1">Address declining protein intake.</p>
  </CardBody>
</Card>

// Medium priority
<Card variant="warning" className="border-l-4 border-l-warning">
  <CardBody>
    <span className="text-xs font-semibold text-warning uppercase tracking-wide">Medium Priority</span>
    <p className="text-sm text-muted-foreground mt-1">Consider adjusting rest day nutrition.</p>
  </CardBody>
</Card>
```

### 12.4 Client List Item

```tsx
<Card variant="interactive" className="flex items-center gap-4 p-4">
  {/* Avatar */}
  <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
    <span className="text-sm font-medium text-primary">SK</span>
  </div>
  {/* Info */}
  <div className="flex-1 min-w-0">
    <h4 className="text-sm font-medium text-foreground">Sam Kalepa</h4>
    <p className="text-xs text-muted-foreground truncate">Last check-in: 2 days ago</p>
  </div>
  {/* Status */}
  <Badge variant="success">Active</Badge>
  {/* Arrow */}
  <ChevronRight className="w-4 h-4 text-muted-foreground" />
</Card>
```

---

## Quick Reference

### Do's

- Use `border border-border` for all containers
- Use design tokens (`text-foreground`, `bg-card`, `border-border`) — never hardcode colours
- Use `/10` opacity for badge backgrounds, `/5` for card variant backgrounds
- Use `rounded-lg` for cards, `rounded-md` for buttons/inputs/badges
- Use `training/*` and `nutrition/*` tokens for domain-specific styling
- Keep Framer Motion entries snappy: `y: 6–8`, `duration: 0.15–0.2`, `ease: "easeOut"`
- Use `transition-colors duration-150` on all interactive elements

### Don'ts

- Don't use shadows on cards or buttons — shadows are for floating layers only
- Don't use `rounded-full` on badges — only on avatars
- Don't use `rounded-xl` or `rounded-2xl` — not in our scale
- Don't use gradients for any purpose
- Don't hardcode `gray-*`, `bg-white`, or hex values — use tokens
- Don't use `/15` opacity for badges — use `/10`
- Don't use bouncy springs or large Y offsets in animations
- Don't use `scale` hover effects on cards
- Don't use glassmorphism or backdrop blur

---

## Implementation Notes

For Claude Code: Reference this document when building any new component or page. Use the exact class names and patterns specified here. When in doubt, check the actual component source files — they are the ground truth.
