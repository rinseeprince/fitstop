# CoachHub Design System — Teal Summit

Single source of truth for the CoachHub visual design, established with the Nutrition page redesign. All new pages and components must follow these specifications.

---

## Colour Palette

### Core colours

| Token | Value | Usage |
|-------|-------|-------|
| Brand | `#0d9488` | Primary actions, active states, training indicators, surplus values |
| Brand light | `rgba(13,148,136,0.08)` | Active status backgrounds, table highlights, borders |
| Brand subtle | `rgba(13,148,136,0.05)` | Segmented control backgrounds, count badges, rest day badges |
| Dark card / dark surfaces | `#0f2027` | Summary cards, icon strip background (deep teal-black, NOT neutral slate) |
| Page background | `#f4f7f6` | Main content area (slight cool-green tint, NOT pure grey) |
| Card background | `#fff` | All content cards |

### Text colours

| Token | Value | Usage |
|-------|-------|-------|
| Primary text | `#0c1a1e` | Headings, active labels, large numbers |
| Secondary text | `#5a7d82` | Button text, secondary labels |
| Muted text | `#93b0b4` | Captions, inactive icons, helper text |
| Mid muted text | `#6b8a8e` | Inactive sidebar tabs |

### Borders

| Token | Value | Usage |
|-------|-------|-------|
| Standard border | `rgba(13,148,136,0.08)` | All borders carry a teal tint |
| Rest day dashed border | `rgba(13,148,136,0.10)` | Dashed border on rest day cards |

### Key rule

**NO neutral slate greys anywhere.** Every grey in the app carries a subtle teal undertone. Never use `#64748b`, `#94a3b8`, `#0f172a`, `#1e293b`, or any Tailwind slate/gray defaults.

---

## Macro Colours (Teal-shifted)

| Macro | Value | Description |
|-------|-------|-------------|
| Protein | `#2d8fb5` | Cyan-blue |
| Carbs | `#c8923a` | Warm honey |
| Fat | `#c06060` | Dusty rose |

These replace the old Tailwind defaults (`#3b82f6`, `#f59e0b`, `#ef4444`) everywhere macros are displayed.

---

## Status / Indicator Colours

| Element | Value | Notes |
|---------|-------|-------|
| Active / training indicators | `#0d9488` | Brand teal, NOT green |
| Surplus values | `#0d9488` | Brand teal |
| Goal / warning badge text | `#d97706` | On `rgba(245,158,11,0.07)` background |
| Active status dot | `#0d9488` | 5px diameter |
| Notification badge | `#0d9488` background | White text |

---

## Typography

### Font families

| Role | Font | Fallback |
|------|------|----------|
| UI text | Instrument Sans | -apple-system, sans-serif |
| Numerical data | JetBrains Mono | monospace |

JetBrains Mono is used for: calories, macros, averages, dates in tables.

### Font weights

| Weight | Usage |
|--------|-------|
| 700 | Headings, large numbers |
| 600 | Labels, active states |
| 500 | Buttons, medium emphasis |
| 400 | Body text, inactive states |

### Font sizes

| Element | Size | Additional |
|---------|------|------------|
| Labels | 10–11px | Uppercase, letter-spacing 0.06–0.07em, muted text colour |
| Body text | 12–13px | |
| Large numbers | 22–32px | Font-weight 700, letter-spacing -0.02 to -0.03em |

---

## Corner Radii

| Element | Radius |
|---------|--------|
| Cards, buttons, inputs, badges | 6px (global default) |
| Inner elements (segmented control active state) | 3–4px |
| Status dots, notification badges | 50% (circles) |

No pill shapes. No large radii.

---

## Layout

### Client detail pages (3-column)

#### Far left: Icon strip — 52px wide

- Background: `#0f2027`
- Logo: 32px square, 6px radius, `linear-gradient(135deg, #0d9488, #0f766e)`, white "CH" text
- Nav icons: 36px square buttons, 6px radius
- Active icon: `rgba(13,148,136,0.15)` background, `#0d9488` stroke
- Inactive icons: `rgba(255,255,255,0.35)` stroke, hover `rgba(255,255,255,0.05)` background
- Notification bell at bottom with teal badge

#### Centre: Client sidebar — 200px wide, white background

- Right border: `1px solid rgba(13,148,136,0.08)`
- **Top section** (padding 18px 16px 14px): back arrow (`#93b0b4`) + client avatar (26px, 6px radius, teal gradient) + name (13.5px, font-weight 600)
- **Vertical tab list**: 13.5px font
  - Active tab: 3px teal left bar + `rgba(13,148,136,0.05)` background + font-weight 600 + `#0c1a1e` colour
  - Inactive tab: font-weight 400 + `#6b8a8e` colour, hover `rgba(0,0,0,0.02)` background
- **Bottom section**: Settings button pinned, separated by `border-top rgba(13,148,136,0.08)`

#### Right: Content area

- `flex: 1`
- Background: `#f4f7f6`
- Padding: `20px 32px 60px`

### Non-client pages

- Standard sidebar: 80px wide with icons + labels
- Content area fills remaining width

---

## Component Patterns

### Segmented control (Data/Plans toggle)

| Element | Value |
|---------|-------|
| Container | `rgba(13,148,136,0.05)` background, 6px radius, 2px padding |
| Active segment | White background, 3–4px radius, `box-shadow: 0 1px 3px rgba(0,0,0,0.05)`, `#0c1a1e` text |
| Inactive segment | Transparent, `#5a7d82` text |

### Dark summary cards

| Property | Value |
|----------|-------|
| Background | `#0f2027` |
| Radius | 6px |
| Labels | 10px uppercase, `rgba(255,255,255,0.35)` |
| Large values | White, 22–32px bold |
| Secondary info | JetBrains Mono, `rgba(255,255,255,0.3–0.4)` |
| Internal dividers | `1px solid rgba(255,255,255,0.06–0.08)` |

### White content cards

| Property | Value |
|----------|-------|
| Background | `#fff` |
| Border | None (spacing provides separation from page background) |
| Radius | 6px |
| Hover (interactive) | `translateY(-1px)`, `box-shadow: 0 6px 20px rgba(13,148,136,0.08)` |

### Training vs rest day cards

| Property | Training | Rest |
|----------|----------|------|
| Background | White | Transparent |
| Border | `1px solid rgba(13,148,136,0.08)` | `1px dashed rgba(13,148,136,0.10)` |
| Badge | Teal `#0d9488` bg, white text, "Train" | Brand-subtle bg, muted text, "Rest" |
| Text colour | Bold dark | Muted `#93b0b4` |
| Macro bars | Full opacity | 30% opacity |
| Empty values | — | Dash "—" |
| Height | Equal height enforced via `minHeight` + `justify-content: space-between` | Same |

### Collapsible sections (e.g. weekly history)

- White card, no border, 6px radius
- Header: clickable, font-weight 600 title + count badge (brand-subtle background)
- Chevron rotates on toggle
- Table inside: light teal-tinted row dividers, macro values in JetBrains Mono with matching colours

---

## Buttons

| Variant | Background | Border | Text |
|---------|------------|--------|------|
| Primary | Brand teal | — | White |
| Secondary / subtle | White | `1px solid rgba(13,148,136,0.08)` | `#5a7d82` |
| Ghost | Transparent | — | `#5a7d82`, hover `rgba(0,0,0,0.02)` background |

---

## Badges

| Variant | Background | Text |
|---------|------------|------|
| Status active | `rgba(13,148,136,0.08)` | `#0d9488` |
| Status archived / inactive | `rgba(0,0,0,0.03)` | `#93b0b4` |
| Warning / goal | `rgba(245,158,11,0.07)` | `#d97706` |
| Training | `#0d9488` | White |
| Rest | `rgba(13,148,136,0.05)` | `#93b0b4` |

---

## Animations

| Animation | Properties |
|-----------|------------|
| Card entrance | `translateY(10px)` → `0`, `opacity 0` → `1`, `0.35s ease`, staggered `0.04s` incremental delay |
| Fade in | `opacity 0` → `1`, `0.3s ease` |
| Slide up | `translateY(6px)` → `0`, `opacity 0` → `1`, `0.35s ease` |
| Hover transitions | `0.12–0.15s ease` |
| Chevron rotation | `0.2s ease` |

---

## Icon Guidance

- Library: Lucide icons (planned migration to Phosphor icons)
- Stroke width: `1.5px` consistently
- Colour hierarchy:
  - Primary: `#0c1a1e`
  - Secondary: `#5a7d82`
  - Muted: `#93b0b4`
  - Dark surfaces inactive: `rgba(255,255,255,0.35)`
  - Dark surfaces active: `#0d9488`

---

## Spacing Principles

**Let spacing do separation work, not borders.** Remove borders wherever possible. White cards on `#f4f7f6` background provide enough contrast without borders.

| Context | Value |
|---------|-------|
| Between day cards | 8px |
| Between major sections | 16px |
| Between section groups | 24–28px |
| Content padding top | 20px |
| Content padding horizontal | 32px |
| Content padding bottom | 60px |
