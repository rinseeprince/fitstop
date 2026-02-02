# CoachHub Design System

> This document defines the visual language for CoachHub. All UI components and pages should follow these guidelines. When building new features, reference this document to ensure consistency.

---

## Table of Contents

1. [Design Principles](#1-design-principles)
2. [Colours](#2-colours)
3. [Typography](#3-typography)
4. [Spacing](#4-spacing)
5. [Shadows & Elevation](#5-shadows--elevation)
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

- **Clean over clever** — Prioritise clarity and usability over flashy effects
- **Consistent** — Same patterns everywhere, no one-off designs
- **Calm** — Soft colours, generous whitespace, nothing screams for attention
- **Professional** — Coaches trust us with their business; the UI should feel reliable
- **AI-forward** — AI features should feel magical but not gimmicky

### 1.2 Visual Guidelines

- Use shadows instead of borders for depth
- Prefer subtle backgrounds over harsh dividers
- Let content breathe with generous padding
- Reserve bright colours for meaningful actions and states
- Make interactive elements obviously interactive

---

## 2. Colours

> **IMPORTANT: Tailwind v4 CSS Variables**
>
> This project uses **Tailwind v4** with CSS variables defined in `app/globals.css`.
> Do NOT use numbered color scales like `bg-primary-600` — they won't work.
>
> **Use CSS variable classes with opacity modifiers:**
> - `bg-primary` — main color
> - `bg-primary/90` — slightly transparent (hover states)
> - `bg-primary/15` — light tint (backgrounds)
> - `bg-primary/10` — very light tint

### 2.1 Available CSS Variable Colors

These colors are defined in `app/globals.css` and available via Tailwind:

| Token | CSS Variable | Usage |
|-------|-------------|-------|
| `primary` | `--primary` | Brand blue - buttons, links, accents |
| `secondary` | `--secondary` | Secondary actions |
| `accent` | `--accent` | AI/violet features |
| `destructive` | `--destructive` | Errors, delete actions |
| `success` | `--success` | Success states |
| `warning` | `--warning` | Warning states |
| `muted` | `--muted` | Muted backgrounds |
| `muted-foreground` | `--muted-foreground` | Secondary text |

### 2.2 Colour Usage

| Use Case | Tailwind Class |
|----------|----------------|
| Page background | `bg-background` or `bg-muted` |
| Card background | `bg-white` or `bg-card` |
| Primary button | `bg-primary text-primary-foreground` |
| Primary button hover | `hover:bg-primary/90` |
| AI features | `bg-accent` or gradient |
| Success states | `text-success` or `bg-success/15 text-success` |
| Warning states | `text-warning` or `bg-warning/15 text-warning` |
| Error states | `text-destructive` or `bg-destructive/15 text-destructive` |
| Body text | `text-gray-900` or `text-foreground` |
| Secondary text | `text-gray-500` or `text-muted-foreground` |
| Muted text | `text-gray-400` |
| Borders (when needed) | `border-gray-200` or `border-border` |

### 2.3 Creating Tints with Opacity

Use opacity modifiers to create lighter/darker variants:

```tsx
// Light background tint (for badges, highlights)
className="bg-primary/15"    // ~15% opacity
className="bg-success/15"
className="bg-warning/15"
className="bg-destructive/15"

// Hover states (slightly darker)
className="hover:bg-primary/90"

// Very subtle backgrounds
className="bg-primary/5"
className="bg-primary/10"
```

### 2.4 Gradients

Use gradients sparingly, primarily for AI-related features:

```tsx
// AI button gradient
className="bg-gradient-to-r from-primary to-accent hover:from-primary/90 hover:to-accent/90"

// AI subtle background
className="bg-gradient-to-br from-accent/10 to-primary/10"
```

---

## 3. Typography

### 3.1 Font Stack

Use Inter as the primary font. If not installed, add to your layout:

```tsx
import { Inter } from 'next/font/google'

const inter = Inter({ subsets: ['latin'] })

// In layout.tsx
<body className={inter.className}>
```

### 3.2 Type Scale

| Name | Size | Weight | Line Height | Class |
|------|------|--------|-------------|-------|
| Display | 36px | 700 | 1.2 | `text-4xl font-bold tracking-tight` |
| H1 | 30px | 600 | 1.25 | `text-3xl font-semibold tracking-tight` |
| H2 | 24px | 600 | 1.3 | `text-2xl font-semibold tracking-tight` |
| H3 | 20px | 600 | 1.4 | `text-xl font-semibold` |
| H4 | 18px | 600 | 1.4 | `text-lg font-semibold` |
| Body | 16px | 400 | 1.5 | `text-base` |
| Body Small | 14px | 400 | 1.5 | `text-sm` |
| Caption | 12px | 500 | 1.4 | `text-xs font-medium` |
| Overline | 12px | 500 | 1.4 | `text-xs font-medium uppercase tracking-wider` |

### 3.3 Typography Patterns

```tsx
// Page title
<h1 className="text-2xl font-semibold text-gray-900 tracking-tight">
  Training Plan
</h1>

// Section title
<h2 className="text-lg font-semibold text-gray-900">
  BJJ Supportive Strength Program
</h2>

// Card title
<h3 className="text-base font-medium text-gray-900">
  Weekly Overview
</h3>

// Body text
<p className="text-sm text-gray-600">
  A balanced program designed to enhance performance.
</p>

// Label
<label className="text-sm font-medium text-gray-700">
  Work Activity Level
</label>

// Helper text
<p className="text-xs text-gray-400 mt-1">
  This affects your daily calorie calculations
</p>

// Overline / category label
<span className="text-xs font-medium text-gray-400 uppercase tracking-wider">
  Mon
</span>

// Large stat number
<span className="text-3xl font-bold text-gray-900">
  2,744
</span>

// Stat unit
<span className="text-sm text-gray-500">
  cal
</span>
```

---

## 4. Spacing

### 4.1 Spacing Scale

Use Tailwind's default spacing scale. Prefer these values for consistency:

| Token | Value | Use Case |
|-------|-------|----------|
| 1 | 4px | Tight spacing between related elements |
| 2 | 8px | Default gap between small elements |
| 3 | 12px | Padding inside compact components |
| 4 | 16px | Standard padding, gaps between components |
| 5 | 20px | Breathing room in cards |
| 6 | 24px | Section padding |
| 8 | 32px | Large section gaps |
| 12 | 48px | Page section separation |
| 16 | 64px | Major layout divisions |

### 4.2 Common Spacing Patterns

```tsx
// Card padding
className="p-5" // 20px all sides

// Card with tighter padding
className="p-4" // 16px all sides

// Gap between cards in a grid
className="gap-4" // 16px

// Gap between form fields
className="space-y-4" // 16px vertical

// Gap between label and input
className="space-y-1.5" // 6px vertical

// Page content padding
className="p-6" // 24px all sides

// Section margin
className="mt-8" // 32px top margin
```

---

## 5. Shadows & Elevation

### 5.1 Shadow Scale

Do not use borders for containment. Use shadows instead.

| Level | Class | Use Case |
|-------|-------|----------|
| None | — | Flat elements, nested cards |
| Subtle | `shadow-sm` | Default cards, inputs |
| Medium | `shadow-md` | Hover states, dropdowns |
| Large | `shadow-lg` | Modals, popovers |
| XL | `shadow-xl` | Full-page modals |

### 5.2 Shadow Patterns

```tsx
// Default card
className="bg-white rounded-xl shadow-sm"

// Card with hover
className="bg-white rounded-xl shadow-sm hover:shadow-md transition-shadow"

// Dropdown menu
className="bg-white rounded-xl shadow-lg border border-gray-100"

// Modal
className="bg-white rounded-2xl shadow-xl"

// Floating action button
className="bg-primary rounded-full shadow-lg hover:shadow-xl"
```

### 5.3 When to Use Borders

Borders should be rare. Use them for:
- Dashed outlines (empty states, drop zones)
- Subtle internal dividers within a card
- Selected/active states as reinforcement

```tsx
// Divider inside a card
<hr className="border-t border-gray-100 my-4" />

// Empty/drop zone
className="border-2 border-dashed border-gray-200 rounded-xl"

// Selected state (in addition to background)
className="bg-primary/10 border border-primary/30 rounded-xl"
```

---

## 6. Border Radius

### 6.1 Radius Scale

| Token | Value | Class | Use Case |
|-------|-------|-------|----------|
| sm | 6px | `rounded-md` | Small buttons, badges, chips |
| DEFAULT | 8px | `rounded-lg` | Inputs, small cards |
| lg | 12px | `rounded-xl` | Cards, containers |
| xl | 16px | `rounded-2xl` | Modals, large cards |
| full | 9999px | `rounded-full` | Avatars, circular buttons, pills |

### 6.2 Standard Usage

```tsx
// Primary cards and containers
className="rounded-xl" // 12px

// Buttons
className="rounded-lg" // 8px

// Inputs
className="rounded-lg" // 8px

// Badges and chips
className="rounded-full" // pill shape

// Avatars
className="rounded-full"

// Modals
className="rounded-2xl" // 16px

// Small inline elements
className="rounded-md" // 6px
```

---

## 7. Layout

### 7.1 Page Structure

```tsx
// Standard page layout
<div className="min-h-screen bg-[#F8FAFA]">
  {/* Sidebar - fixed */}
  <aside className="fixed left-0 top-0 h-screen w-64 bg-white border-r border-gray-100">
    {/* Sidebar content */}
  </aside>
  
  {/* Main content area */}
  <main className="ml-64">
    {/* Page header with tabs */}
    <header className="bg-white border-b border-gray-100 sticky top-0 z-10">
      <div className="px-6 py-4">
        {/* Breadcrumb, title, actions */}
      </div>
      <nav className="px-6">
        {/* Tab navigation */}
      </nav>
    </header>
    
    {/* Page content */}
    <div className="p-6">
      {/* Content cards */}
    </div>
  </main>
</div>
```

### 7.2 Content Layout Patterns

```tsx
// Two-column layout (sidebar + main)
<div className="grid grid-cols-[380px_1fr] gap-6">
  <aside>{/* Left panel */}</aside>
  <main>{/* Main content */}</main>
</div>

// Three-column layout
<div className="grid grid-cols-3 gap-6">
  {/* Equal columns */}
</div>

// Card grid
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
  {/* Cards */}
</div>

// Week calendar grid
<div className="grid grid-cols-7 gap-3">
  {/* Day cards */}
</div>

// Stacked sections
<div className="space-y-6">
  <section>{/* Section 1 */}</section>
  <section>{/* Section 2 */}</section>
</div>
```

### 7.3 Container Widths

```tsx
// Max content width (for readability)
className="max-w-4xl" // 896px

// Wide content
className="max-w-6xl" // 1152px

// Full width with padding
className="w-full px-6"
```

---

## 8. Components

### 8.1 Buttons

#### Primary Button
```tsx
<Button className="bg-primary hover:bg-primary/90 text-primary-foreground font-medium px-4 py-2.5 rounded-lg shadow-sm hover:shadow transition-all">
  Save Changes
</Button>
```

#### Secondary Button
```tsx
<Button variant="outline" className="bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 hover:border-gray-300 font-medium px-4 py-2.5 rounded-lg transition-all">
  Cancel
</Button>
```

#### Ghost Button
```tsx
<Button variant="ghost" className="text-gray-600 hover:text-gray-900 hover:bg-gray-100 font-medium px-4 py-2.5 rounded-lg transition-all">
  <Settings className="w-4 h-4 mr-2" />
  Settings
</Button>
```

#### Destructive Button
```tsx
<Button className="bg-destructive hover:bg-destructive/90 text-destructive-foreground font-medium px-4 py-2.5 rounded-lg transition-all">
  Delete Client
</Button>
```

#### AI Button (Gradient)
```tsx
<Button className="bg-gradient-to-r from-primary to-accent hover:from-primary/90 hover:to-accent/90 text-primary-foreground font-medium px-4 py-2.5 rounded-lg shadow-sm hover:shadow transition-all">
  <Sparkles className="w-4 h-4 mr-2" />
  Generate with AI
</Button>
```

#### Icon Button
```tsx
<Button variant="ghost" size="icon" className="w-9 h-9 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-all">
  <MoreHorizontal className="w-4 h-4" />
</Button>
```

#### Button Sizes
```tsx
// Small
className="text-sm px-3 py-1.5 rounded-md"

// Default
className="text-sm px-4 py-2.5 rounded-lg"

// Large
className="text-base px-6 py-3 rounded-lg"
```

### 8.2 Cards

#### Standard Card
```tsx
<div className="bg-white rounded-xl shadow-sm p-5">
  <h3 className="text-lg font-semibold text-gray-900 mb-4">Card Title</h3>
  <p className="text-sm text-gray-600">Card content goes here.</p>
</div>
```

#### Interactive Card
```tsx
<div className="bg-white rounded-xl shadow-sm p-5 hover:shadow-md transition-shadow cursor-pointer">
  {/* Content */}
</div>
```

#### Card with Header
```tsx
<div className="bg-white rounded-xl shadow-sm overflow-hidden">
  <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
    <h3 className="font-semibold text-gray-900">Card Title</h3>
    <Button variant="ghost" size="icon">
      <MoreHorizontal className="w-4 h-4" />
    </Button>
  </div>
  <div className="p-5">
    {/* Card body */}
  </div>
</div>
```

#### Coloured Card (Feature-specific)
```tsx
// Training card
<div className="bg-secondary/10 border border-secondary/20 rounded-xl p-4">
  {/* Training-related content */}
</div>

// Nutrition card
<div className="bg-warning/10 border border-warning/20 rounded-xl p-4">
  {/* Nutrition-related content */}
</div>

// AI/insight card
<div className="bg-gradient-to-br from-accent/10 to-primary/10 border border-accent/20 rounded-xl p-4">
  {/* AI-generated content */}
</div>
```

### 8.3 Badges

```tsx
// Status badges (use opacity modifiers for backgrounds)
<span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-success/15 text-success">
  Active
</span>

<span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-warning/15 text-warning">
  Pending
</span>

<span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-destructive/15 text-destructive">
  Overdue
</span>

// Info badges
<span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary/15 text-primary">
  4x/week
</span>

// Neutral badge
<span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground">
  Rest
</span>

// Badge with icon
<span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-secondary/15 text-secondary">
  <Dumbbell className="w-3 h-3" />
  Training
</span>
```

### 8.4 Inputs

#### Text Input
```tsx
<div className="space-y-1.5">
  <label className="text-sm font-medium text-gray-700">
    Client Name
  </label>
  <input
    type="text"
    className="w-full px-3.5 py-2.5 bg-white border border-gray-200 rounded-lg text-sm placeholder:text-gray-400 focus:border-primary focus:ring-2 focus:ring-ring focus:outline-none transition-all"
    placeholder="Enter name"
  />
  <p className="text-xs text-gray-400">This will be visible to the client</p>
</div>
```

#### Textarea
```tsx
<textarea
  className="w-full px-3.5 py-2.5 bg-white border border-gray-200 rounded-lg text-sm placeholder:text-gray-400 focus:border-primary focus:ring-2 focus:ring-ring focus:outline-none transition-all resize-none"
  rows={4}
  placeholder="Enter description..."
/>
```

#### Input with Icon
```tsx
<div className="relative">
  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
  <input
    type="text"
    className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-200 rounded-lg text-sm placeholder:text-gray-400 focus:border-primary focus:ring-2 focus:ring-ring focus:outline-none transition-all"
    placeholder="Search clients..."
  />
</div>
```

#### Select (using shadcn/ui)
```tsx
<Select>
  <SelectTrigger className="w-full bg-white border-gray-200 rounded-lg focus:border-primary focus:ring-2 focus:ring-ring">
    <SelectValue placeholder="Select option" />
  </SelectTrigger>
  <SelectContent className="bg-white rounded-xl shadow-lg border border-gray-100 p-1">
    <SelectItem className="rounded-lg cursor-pointer focus:bg-gray-50">
      Option 1
    </SelectItem>
    <SelectItem className="rounded-lg cursor-pointer focus:bg-gray-50">
      Option 2
    </SelectItem>
  </SelectContent>
</Select>
```

### 8.5 Toggles & Switches

#### Segmented Control / Toggle Group
```tsx
<div className="bg-gray-100 p-1 rounded-lg inline-flex">
  {/* Active */}
  <button className="px-4 py-2 text-sm font-medium bg-white text-gray-900 rounded-md shadow-sm transition-all">
    <CalendarDays className="w-4 h-4 inline mr-2" />
    Week
  </button>

  {/* Inactive */}
  <button className="px-4 py-2 text-sm font-medium text-gray-500 hover:text-gray-700 rounded-md transition-all">
    <List className="w-4 h-4 inline mr-2" />
    List
  </button>
</div>
```

#### AI/Manual Toggle
```tsx
<div className="bg-gray-100 p-1 rounded-lg inline-flex">
  {/* Active - AI */}
  <button className="px-4 py-2 text-sm font-medium bg-white text-gray-900 rounded-md shadow-sm flex items-center gap-2">
    <Sparkles className="w-4 h-4 text-accent" />
    AI Generation
  </button>

  {/* Inactive - Manual */}
  <button className="px-4 py-2 text-sm font-medium text-gray-500 hover:text-gray-700 rounded-md flex items-center gap-2">
    <Pencil className="w-4 h-4" />
    Manual Creation
  </button>
</div>
```

#### Switch (using shadcn/ui)
```tsx
<Switch className="data-[state=checked]:bg-primary" />
```

### 8.6 Chips / Tags

#### Selectable Chip
```tsx
// Unselected
<button className="px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded-full hover:bg-gray-200 transition-colors">
  Fat loss
</button>

// Selected
<button className="px-3 py-1.5 text-sm bg-primary/15 text-primary rounded-full border border-primary/30">
  Strength
</button>
```

#### Chip Group
```tsx
<div className="flex flex-wrap gap-2">
  <button className="px-3 py-1.5 text-sm bg-primary/15 text-primary rounded-full border border-primary/30">
    Upper/Lower
  </button>
  <button className="px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded-full hover:bg-gray-200 transition-colors">
    Push/Pull/Legs
  </button>
  <button className="px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded-full hover:bg-gray-200 transition-colors">
    Full Body 3x
  </button>
</div>
```

### 8.7 Tabs

```tsx
<div className="border-b border-gray-200">
  <nav className="flex gap-6">
    {/* Active tab */}
    <button className="py-3 text-sm font-medium text-gray-900 border-b-2 border-primary -mb-px">
      Training Plan
    </button>

    {/* Inactive tab */}
    <button className="py-3 text-sm font-medium text-gray-500 hover:text-gray-700 border-b-2 border-transparent -mb-px transition-colors">
      Nutrition & Habits
    </button>

    <button className="py-3 text-sm font-medium text-gray-500 hover:text-gray-700 border-b-2 border-transparent -mb-px transition-colors">
      Content Access
    </button>
  </nav>
</div>
```

### 8.8 Modals / Dialogs

```tsx
// Using shadcn/ui Dialog
<DialogContent className="bg-white rounded-2xl shadow-xl p-0 max-w-2xl">
  <DialogHeader className="px-6 py-4 border-b border-gray-100">
    <DialogTitle className="text-lg font-semibold text-gray-900">
      Modal Title
    </DialogTitle>
  </DialogHeader>
  
  <div className="px-6 py-5">
    {/* Modal content */}
  </div>
  
  <DialogFooter className="px-6 py-4 border-t border-gray-100 bg-gray-50 rounded-b-2xl">
    <Button variant="outline">Cancel</Button>
    <Button>Save</Button>
  </DialogFooter>
</DialogContent>
```

### 8.9 Avatars

```tsx
// With image
<div className="w-10 h-10 rounded-full overflow-hidden bg-gray-100">
  <img src={avatarUrl} alt={name} className="w-full h-full object-cover" />
</div>

// With initials
<div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
  <span className="text-sm font-medium text-primary">SK</span>
</div>

// Avatar sizes
className="w-8 h-8"   // Small
className="w-10 h-10" // Default
className="w-12 h-12" // Large
className="w-16 h-16" // XL (profile pages)
```

### 8.10 Toasts / Notifications

```tsx
// Success toast
<div className="bg-white rounded-xl shadow-lg border border-gray-100 p-4 flex items-start gap-3 max-w-sm">
  <div className="w-8 h-8 rounded-full bg-success/15 flex items-center justify-center flex-shrink-0">
    <Check className="w-4 h-4 text-success" />
  </div>
  <div>
    <p className="text-sm font-medium text-gray-900">Plan saved</p>
    <p className="text-xs text-gray-500 mt-0.5">Training plan has been updated</p>
  </div>
</div>

// Error toast
<div className="bg-white rounded-xl shadow-lg border border-destructive/20 p-4 flex items-start gap-3 max-w-sm">
  <div className="w-8 h-8 rounded-full bg-destructive/15 flex items-center justify-center flex-shrink-0">
    <X className="w-4 h-4 text-destructive" />
  </div>
  <div>
    <p className="text-sm font-medium text-gray-900">Failed to save</p>
    <p className="text-xs text-gray-500 mt-0.5">Please try again</p>
  </div>
</div>
```

---

## 9. States

### 9.1 Interactive States

Apply to all interactive elements:

```tsx
// Hover
className="hover:bg-gray-50"
className="hover:shadow-md"
className="hover:border-gray-300"

// Focus
className="focus:outline-none focus:ring-2 focus:ring-ring focus:border-primary"

// Active/Pressed
className="active:scale-[0.98]"

// Disabled
className="disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none"
```

### 9.2 Loading States

#### Skeleton
```tsx
<div className="animate-pulse space-y-3">
  <div className="h-4 bg-gray-200 rounded w-3/4"></div>
  <div className="h-4 bg-gray-200 rounded w-1/2"></div>
</div>
```

#### Shimmer
```tsx
// Add to tailwind.config.js
animation: {
  shimmer: 'shimmer 1.5s infinite',
},
keyframes: {
  shimmer: {
    '0%': { transform: 'translateX(-100%)' },
    '100%': { transform: 'translateX(100%)' },
  },
},

// Usage
<div className="relative overflow-hidden bg-gray-100 rounded-xl h-24">
  <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/60 to-transparent" />
</div>
```

#### Spinner
```tsx
<div className="w-5 h-5 border-2 border-gray-200 border-t-primary rounded-full animate-spin" />
```

#### Button Loading State
```tsx
<Button disabled className="relative">
  <span className="opacity-0">Save Changes</span>
  <div className="absolute inset-0 flex items-center justify-center">
    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
  </div>
</Button>
```

### 9.3 Empty States

```tsx
<div className="flex flex-col items-center justify-center py-16 px-8 text-center">
  <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4">
    <Dumbbell className="w-8 h-8 text-gray-400" />
  </div>
  <h3 className="text-lg font-semibold text-gray-900 mb-2">
    No training plan yet
  </h3>
  <p className="text-sm text-gray-500 mb-6 max-w-sm">
    Create a personalised training program for your client using AI or build one manually.
  </p>
  <Button className="bg-primary hover:bg-primary/90 text-primary-foreground">
    <Sparkles className="w-4 h-4 mr-2" />
    Generate with AI
  </Button>
</div>
```

### 9.4 Error States

```tsx
// Form field error
<div className="space-y-1.5">
  <label className="text-sm font-medium text-gray-700">Email</label>
  <input
    className="w-full px-3.5 py-2.5 border border-destructive rounded-lg text-sm focus:border-destructive focus:ring-2 focus:ring-destructive/20"
  />
  <p className="text-xs text-destructive flex items-center gap-1">
    <AlertCircle className="w-3 h-3" />
    Please enter a valid email address
  </p>
</div>
```

---

## 10. Animation & Transitions

### 10.1 Transition Defaults

Apply to all interactive elements:

```tsx
// Standard transition
className="transition-all duration-150 ease-out"

// Colour only
className="transition-colors duration-150"

// Shadow only
className="transition-shadow duration-150"

// Transform only
className="transition-transform duration-150"
```

### 10.2 Duration Scale

| Duration | Use Case |
|----------|----------|
| 100ms | Micro-interactions (button press) |
| 150ms | Standard transitions (hover, focus) |
| 200ms | Slightly larger elements |
| 300ms | Page transitions, modals appearing |
| 500ms | Complex animations |

### 10.3 Easing

```tsx
// Default (most transitions)
ease-out

// Entering elements
ease-out

// Exiting elements
ease-in

// Continuous motion
ease-in-out
```

### 10.4 Common Animations

```tsx
// Fade in
className="animate-in fade-in duration-200"

// Slide up
className="animate-in slide-in-from-bottom-2 duration-200"

// Scale in (for modals)
className="animate-in zoom-in-95 duration-200"

// Pulse (for notifications)
className="animate-pulse"

// Spin (for loaders)
className="animate-spin"
```

---

## 11. Icons

### 11.1 Icon Library

Use Lucide React exclusively for consistency.

```tsx
import { 
  Dumbbell, 
  Utensils, 
  Sparkles, 
  ChevronRight,
  Check,
  X,
  // etc.
} from 'lucide-react'
```

### 11.2 Icon Sizes

| Size | Class | Use Case |
|------|-------|----------|
| 12px | `w-3 h-3` | Inline with small text, badges |
| 16px | `w-4 h-4` | Buttons, inputs, default |
| 20px | `w-5 h-5` | Navigation, larger buttons |
| 24px | `w-6 h-6` | Section icons, headers |
| 32px | `w-8 h-8` | Empty states, feature icons |

### 11.3 Icon Colours

```tsx
// Default (matches text)
className="text-gray-400"

// Interactive
className="text-gray-400 hover:text-gray-600"

// In primary button
className="text-primary-foreground"

// Feature-specific
className="text-primary"
className="text-accent"       // AI features
className="text-success"
className="text-warning"
className="text-destructive"
```

---

## 12. Patterns

### 12.1 Week Calendar

```tsx
<div className="space-y-2">
  {/* Day headers */}
  <div className="grid grid-cols-7 gap-3">
    {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => (
      <div key={day} className="text-center">
        <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">
          {day}
        </span>
      </div>
    ))}
  </div>

  {/* Day cards */}
  <div className="grid grid-cols-7 gap-3">
    {/* Workout day */}
    <div className="bg-primary/5 border border-primary/20 rounded-xl p-3 hover:shadow-md hover:border-primary/30 transition-all cursor-pointer min-h-[100px]">
      <div className="flex items-center gap-2 mb-2">
        <Dumbbell className="w-4 h-4 text-primary" />
        <span className="text-sm font-medium text-gray-900 truncate">Upper Body</span>
      </div>
      <p className="text-xs text-gray-500 truncate">Strength session</p>
      <div className="flex items-center gap-1 mt-2 text-xs text-gray-400">
        <Clock className="w-3 h-3" />
        75m
      </div>
    </div>

    {/* Rest day */}
    <div className="bg-gray-50 border border-dashed border-gray-200 rounded-xl p-3 flex items-center justify-center min-h-[100px]">
      <span className="text-xs text-gray-400 font-medium">Rest</span>
    </div>

    {/* Nutrition day */}
    <div className="bg-warning/5 border border-warning/20 rounded-xl p-3 hover:shadow-md hover:border-warning/30 transition-all cursor-pointer min-h-[100px]">
      <div className="text-center mb-2">
        <span className="text-2xl font-bold text-warning">2,744</span>
        <span className="text-xs text-gray-500 block">cal</span>
      </div>
      <div className="flex justify-center">
        <span className="bg-success text-white text-xs px-2 py-0.5 rounded-full">
          Training
        </span>
      </div>
    </div>
  </div>
</div>
```

### 12.2 Stat Card

```tsx
<div className="bg-white rounded-xl shadow-sm p-5">
  <div className="flex items-center justify-between mb-1">
    <span className="text-sm text-gray-500">Weekly Total</span>
    <TrendingUp className="w-4 h-4 text-success" />
  </div>
  <div className="flex items-baseline gap-2">
    <span className="text-3xl font-bold text-gray-900">17,908</span>
    <span className="text-sm text-gray-500">cal</span>
  </div>
  <p className="text-xs text-success mt-2 flex items-center gap-1">
    <ArrowUp className="w-3 h-3" />
    12% from last week
  </p>
</div>
```

### 12.3 AI Insight Card

```tsx
<div className="bg-gradient-to-br from-accent/10 to-primary/10 border border-accent/20 rounded-xl p-4">
  <div className="flex items-center gap-2 mb-3">
    <div className="w-6 h-6 bg-white rounded-full flex items-center justify-center shadow-sm">
      <Sparkles className="w-3.5 h-3.5 text-accent" />
    </div>
    <span className="text-sm font-medium text-gray-900">AI Summary</span>
  </div>
  <p className="text-sm text-gray-700">
    Sam has demonstrated excellent discipline by completing all workout sessions this week...
  </p>
</div>
```

### 12.3 Priority Recommendation Cards

```tsx
// High priority (red accent)
<div className="bg-white rounded-lg border-l-4 border-destructive p-4 shadow-sm">
  <span className="text-xs font-semibold text-destructive uppercase tracking-wide">High Priority</span>
  <p className="text-sm text-gray-700 mt-1">Address declining protein intake immediately.</p>
</div>

// Medium priority (amber accent)
<div className="bg-white rounded-lg border-l-4 border-warning p-4 shadow-sm">
  <span className="text-xs font-semibold text-warning uppercase tracking-wide">Medium Priority</span>
  <p className="text-sm text-gray-700 mt-1">Consider adjusting rest day nutrition.</p>
</div>

// Low priority (blue accent)
<div className="bg-white rounded-lg border-l-4 border-primary p-4 shadow-sm">
  <span className="text-xs font-semibold text-primary uppercase tracking-wide">Low Priority</span>
  <p className="text-sm text-gray-700 mt-1">Monitor sleep quality over the next week.</p>
</div>
```

### 12.4 Client List Item

```tsx
<div className="flex items-center gap-4 p-4 bg-white rounded-xl shadow-sm hover:shadow-md transition-shadow cursor-pointer">
  {/* Avatar */}
  <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
    <span className="text-sm font-medium text-primary">SK</span>
  </div>

  {/* Info */}
  <div className="flex-1 min-w-0">
    <h4 className="text-sm font-medium text-gray-900">Sam Kalepa</h4>
    <p className="text-xs text-gray-500 truncate">Last check-in: 2 days ago</p>
  </div>

  {/* Status */}
  <span className="bg-success/15 text-success text-xs font-medium px-2.5 py-0.5 rounded-full">
    Active
  </span>

  {/* Arrow */}
  <ChevronRight className="w-4 h-4 text-gray-400" />
</div>
```

---

## Quick Reference

### Do's
- ✅ Use shadows instead of borders
- ✅ Keep colour palette limited and consistent
- ✅ Use generous whitespace
- ✅ Make AI features feel special with violet accents
- ✅ Apply transitions to all interactive elements
- ✅ Use semantic colours for states (success/warning/error)

### Don'ts
- ❌ Use harsh borders for containers
- ❌ Use saturated colours for large areas
- ❌ Cram too much into small spaces
- ❌ Use different border-radius values randomly
- ❌ Skip hover/focus states
- ❌ Use plain text for empty states

---

## Implementation Notes

When implementing this design system:

1. **Start with tokens** — Add the colour definitions to tailwind.config.js first
2. **Build base components** — Create Button, Card, Badge, Input components with these styles
3. **Apply globally** — Update layout backgrounds and container styles
4. **Page by page** — Apply to each page, starting with the most-used ones
5. **Review consistency** — Check that spacing, colours, and shadows are uniform

For Claude Code: Reference this document when building any new component or page. Use the exact class names and patterns specified here.