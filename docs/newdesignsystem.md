# CoachHub Design System — Teal Summit

Single source of truth for the CoachHub visual design. Every new page and component must follow these specifications. This doc is written to be **copy-paste actionable**: prefer importing the components/tokens it names, and when you must write fresh markup, paste the literal class strings in the recipes below.

---

## How to use this doc

### Canonical hierarchy (what wins when things disagree)

1. **Shipped Programs & Builder code is the reference.** The system was established with the Nutrition redesign, then hardened by the **Programs page** (`app/dashboard/programs/**`, `components/programs/**`) and the **Program Builder** (`components/clients/training/program-builder/**`). When a spec here and a shipped component disagree, **match the shipped Programs/Builder code**. Every new page should read like those two.
2. This doc.
3. Everything else (the OKLCH base layer, old pages) is legacy to be migrated.

### Two token layers — author with the hardcoded hex

`app/globals.css` defines an OKLCH `:root` layer (shadcn defaults: `--background`, `--primary`, `--border`, `--muted`, `--radius: 10px`, `--radius-xs: 6px`, …). **Teal-Summit surfaces override that layer with hardcoded hex.** Rules:

- **Author new Teal-Summit UI with the hex values in this doc**, not the semantic OKLCH tokens — write `bg-[#0d9488]`, `rounded-[6px]`, `text-[#0c1a1e]`, `border-[rgba(13,148,136,0.08)]`. The OKLCH layer still powers un-migrated primitives and generic `bg-background`/`border-border` fallbacks, but a Teal-Summit page must not depend on it for its look.
- The base radius token is **10px**; Teal-Summit forces **6px everywhere** via explicit `rounded-[6px]`. Never inherit the 10px default on a card/dialog.
- The design mockups (`docs/atletafit-*.html`) are **historical** — they use DM Sans / `#2E8577` / 10–18px radii that never shipped. Ignore their token values; trust the code.

---

## Non-negotiables checklist

Apply these by default on every surface — they are the difference between "right first time" and iteration:

- [ ] **Radius = `rounded-[6px]`** on all cards/buttons/inputs/dialogs/sheets/popovers/badges. Inner chips & segmented-active = `rounded-[4px]`. Circles (dots, ordinals) = `rounded-full`. No pill shapes, no large radii.
- [ ] **Greys carry a teal undertone.** Ink `#0c1a1e`, secondary `#5a7d82`, muted `#93b0b4`. **Never** use `#64748b`, `#94a3b8`, `#0f172a`, `#1e293b`, or any Tailwind slate/gray default.
- [ ] **Numerals & micro-labels use `font-mono-display`** (JetBrains Mono): calories, macros, reps/sets/loads, dates, counts, stat values, uppercase labels, card metas.
- [ ] **UI text uses Instrument Sans** (the default body font — no class needed).
- [ ] **Primary/brand = `#0d9488`, its hover = `#0b7f75`.** Never invent a hover shade.
- [ ] **Every input gets `FOCUS_RING`** (`focus-visible:ring-2 ring-[#0d9488]/35 ring-offset-0`).
- [ ] **Borders carry a teal tint** — default `border-[rgba(13,148,136,0.08)]`, inner hairlines `rgba(13,148,136,0.06)`.
- [ ] **Spacing does separation, not borders.** White cards on `#f4f7f6` need no border where spacing already separates them.
- [ ] **Uppercase micro-labels** get letter-spacing (`tracking-[0.06em]`–`0.14em`) and a muted colour.
- [ ] **Page background is `#f4f7f6`** (cool-green tint), dark surfaces are `#0f2027` (deep teal-black) — never neutral slate.
- [ ] **Reuse the shared components/tokens** (see index) before writing new class strings.
- [ ] **Primary CTA colour pair everywhere:** `bg-[#0d9488] text-white hover:bg-[#0b7f75]`; Cancel/dismiss = `variant="ghost"`.

---

## Colour Palette

### Core colours

| Token | Value | Usage |
|-------|-------|-------|
| Brand | `#0d9488` | Primary actions, active states, training indicators, surplus values, icons |
| Brand hover | `#0b7f75` | Hover state of every teal-filled primary button |
| Deep teal | `#0a5c55` | Text/icons **on** teal tints — active-pill text, W# chip, ordinal circles, hover text |
| Brand light | `rgba(13,148,136,0.08)` | Standard borders, chip/thumb/ordinal backgrounds, hover backgrounds, table highlights |
| Brand subtle | `rgba(13,148,136,0.05)` | Segmented-control track, count badges, rest-day badge, hover washes |
| Dark surface | `#0f2027` | Summary/stat cards, builder hero header, icon strip (deep teal-black, NOT slate) |
| Page background | `#f4f7f6` | Main content area (cool-green tint, NOT pure grey) |
| Card background | `#fff` | All content cards |
| Neutral surface | `#f0f5f4` | Neutral (non-teal) chip backgrounds and neutral icon-button hover backgrounds |

### Text colours

| Token | Value | Usage |
|-------|-------|-------|
| Primary text | `#0c1a1e` | Headings, active labels, names, large numbers |
| Secondary text | `#5a7d82` | Button text, secondary labels, body-secondary |
| Muted text | `#93b0b4` | Captions, inactive icons, helper text, metas |
| Mid muted text | `#6b8a8e` | Inactive sidebar tabs |
| Faint numerals | `#c2d0cc` | De-emphasised mono numerals (list index, "+N more", frequency microcopy) |
| Disabled | `#d5e0dd` | Disabled icon buttons (e.g. pager at range end) |

### Borders

| Token | Value | Usage |
|-------|-------|-------|
| Standard border | `rgba(13,148,136,0.08)` | Default card/table/panel border, expanded-body hairlines |
| Inner hairline | `rgba(13,148,136,0.06)` | Table footer top border, card footer divider, popover footer |
| Rest dashed | `rgba(13,148,136,0.10)` | Dashed border on rest-day cards |
| Drop-set dashed | `rgba(13,148,136,0.15)` | Dashed left rail on the drop-set sub-editor |
| Dashed "add" (idle) | `rgba(13,148,136,0.20)` | "Add week" dashed button (resting) |
| Dashed "new" / hover border | `rgba(13,148,136,0.25)` | "New session/exercise" dashed buttons, day-cell hover border |

### Destructive-soft

| Token | Value | Usage |
|-------|-------|-------|
| Danger text/icon | `#c06060` | Delete/remove icon hover, destructive accents (same hue as the "fat" macro — deliberate reuse) |
| Danger hover bg | `rgba(192,96,96,0.08)` | Hover background behind a destructive icon button |

### The teal-tint alpha ladder

Every teal tint is `rgba(13,148,136,α)`. Pick the rung by role:

| α | Use |
|---|-----|
| `0.03` | Faintest hover wash (rest-cell hover fill) |
| `0.05` | Segmented-control track, count badges, hover washes on rows/buttons |
| `0.06` | Inner hairlines (table/card/popover footers & dividers) |
| `0.08` | **Default** — borders, chip/thumb/ordinal fills, icon-button hover bg, table highlight |
| `0.10` | Rest-day dashed border |
| `0.15` | Drop-set dashed rail; active icon on dark strip |
| `0.20` | Idle dashed "add" button border; working-set select border |
| `0.25` | Dashed "new" button border; interactive card hover border |
| `0.35` | Focus ring (`ring-[#0d9488]/35`) |

### On-dark values (text/borders over `#0f2027`)

| Element | Value |
|---------|-------|
| Eyebrow (mint) | `#5eead4` |
| Strong value | `rgba(255,255,255,0.92)` |
| Label / muted | `rgba(255,255,255,0.35)` |
| Faint / secondary | `rgba(255,255,255,0.3)`–`0.4` |
| Divider | `rgba(255,255,255,0.06)`–`0.08` (use `0.07` for stat-band cell dividers) |
| Subtle border | `rgba(255,255,255,0.14)`; badge outline `rgba(255,255,255,0.2)` |

### Warning / goal

| Element | Value | Notes |
|---------|-------|-------|
| Warning/goal text | `#d97706` | On `rgba(245,158,11,0.07)` background |

---

## Macro Colours (Teal-shifted)

| Macro | Value | Description |
|-------|-------|-------------|
| Protein | `#2d8fb5` | Cyan-blue |
| Carbs | `#c8923a` | Warm honey |
| Fat | `#c06060` | Dusty rose (also the destructive-soft accent) |

These replace the old Tailwind defaults (`#3b82f6`, `#f59e0b`, `#ef4444`) everywhere macros are displayed.

---

## Typography

### Font families

| Role | Font | How to apply |
|------|------|--------------|
| UI text | **Instrument Sans** | Default body font (`app/layout.tsx` sets it on `<body>`) — no class needed |
| Numerical data & micro-labels | **JetBrains Mono** | `font-mono-display` utility (`--font-mono-display`, fallback `ui-monospace, monospace`) |

`font-mono-display` is mandatory for: calories, macros, reps/sets/loads/RPE, averages, dates, counts, stat values, and uppercase mono labels — **when they stand alone as data** (card metas, stat rows, table cells, chips, numerals, labeled key-value lines).

### Prose vs data — where mono is allowed

**Never set a word, date, or number in `font-mono-display` inside a running sentence.** Sentences — dialog descriptions, toast text, empty states, help text, banners — are 100% Instrument Sans, including any dates or names they contain (bold sans is fine for emphasis).

- ✅ `Removes Push Day on Sun, Aug 2 from the calendar.` (all sans; "Push Day" may be `font-semibold`)
- ❌ `Removes Push Day on `<code>Sun, Aug 2</code>` from the calendar.` (mono date mid-sentence reads as broken kerning)
- ✅ A card meta line `Wed, Jul 22 · on 3 upcoming days` in `MONO_LABEL_CLASS` — that's standalone data, not a sentence.

### Type scale (px → role)

Author with explicit arbitrary sizes (`text-[13px]`) to match shipped pixels — do not rely on Tailwind's default `text-sm`/`text-base` steps for Teal-Summit surfaces.

| Size | Role / where |
|------|--------------|
| `9px` | Draft badge on the dark builder header |
| `9.5px` | Header eyebrow (`0.14em`), day-cell list index numerals, "+N more" |
| `10px` | Metas, uppercase labels (`0.06em`), chips, surplus % / surplus badge |
| `10.5px` | Section-label divider (`0.07em`), week "W#" chip |
| `11px` | Mono stat rows, set-row & drop-set inputs, ordinal circle, pager text, table-footer count |
| `12px` (`text-xs`) | Body-small, card/session titles in dense contexts, panel search inputs |
| `12.5px` | Table mono cells, filter chips, "All programs" back link |
| `13px` | Session/exercise names, segmented control, primary-button text, default table body |
| `13.5px` | Table program name, client name |
| `15px` | Section topbar title, sheet title |
| `17px` | Program builder title (dark header) |
| `18px` (`text-lg`) | Dialog title |
| `22–24px` | Stat-band value (24px) & large numbers; nutrition hero numbers up to 32px |

### Weights

| Weight | Usage |
|--------|-------|
| 700 | Headings, large stat numbers |
| 600 | Labels, active states, names, section-label |
| 500 | Buttons, chips, medium emphasis |
| 400 | Body text, inactive states |

### Letter-spacing

| Tracking | Where |
|----------|-------|
| `-0.01em` | Titles (program name, sheet/section headings) |
| `-0.02` to `-0.03em` | Large stat numbers |
| `0.06em` | Standard uppercase labels (`LABEL_CLASS`) |
| `0.07em` | Section-label divider |
| `0.08em` | Mono uppercase labels (`MONO_LABEL_CLASS`), surplus label |
| `0.14em` | Dark-header eyebrow (`HEADER_EYEBROW_CLASS`) |

---

## Corner Radii

| Element | Radius |
|---------|--------|
| Cards, buttons, inputs, dialogs, sheets, popovers, badges | `rounded-[6px]` (global default) |
| Inner chips, segmented-control active state | `rounded-[4px]` |
| Status dots, notification badges, ordinal circles | `rounded-full` |

No pill shapes. No large radii. Never inherit the 10px base `--radius`.

---

## Focus ring & input-height ladder

### Focus ring

Every input, select trigger, and editable field uses the shared ring:

```
focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0d9488]/35 focus-visible:ring-offset-0
```

Import it as `FOCUS_RING` (see system tokens) rather than retyping.

### Input heights by context

| Height | Class | Where |
|--------|-------|-------|
| 24px | `h-6` | Drop-set editor cells |
| 28px | `h-7` | Set-row editor cells (dense numeric grid) |
| 32px | `h-8` | Standard form fields, panel/popover search |
| 36px | `h-9` | Toolbar search & sort select |
| 40px | `h-10` | Default `Button` size |

Numeric fields are `font-mono-display` and `text-center`.

---

## System component tokens

The builder tokens are **app-wide** — reuse them anywhere, not just in the builder. Import from `@/components/clients/training/program-builder/builder-tokens`:

| Token | Literal value |
|-------|---------------|
| `TEXT_PRIMARY` | `text-[#0c1a1e]` |
| `TEXT_SECONDARY` | `text-[#5a7d82]` |
| `TEXT_MUTED` | `text-[#93b0b4]` |
| `FOCUS_RING` | `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0d9488]/35 focus-visible:ring-offset-0` |
| `LABEL_CLASS` | `text-[10px] font-medium uppercase tracking-[0.06em] text-[#93b0b4]` |
| `MONO_LABEL_CLASS` | `font-mono-display text-[10px] font-medium uppercase tracking-[0.08em] text-[#93b0b4]` |
| `HEADER_EYEBROW_CLASS` | `font-mono-display text-[9.5px] font-medium uppercase tracking-[0.14em] text-[#5eead4]` (on dark) |
| `CHIP_NEUTRAL_CLASS` | `rounded-[4px] bg-[#f0f5f4] px-1.5 py-px text-[10px] font-medium text-[#5a7d82]` |
| `THUMB_CLASS` | `grid shrink-0 place-items-center rounded-[6px] bg-[rgba(13,148,136,0.08)] text-[#0d9488]` (caller sets `h-/w-`) |
| `TRAINING_CARD_BORDER` | `border border-[rgba(13,148,136,0.08)]` |
| `REST_CARD_BORDER` | `border border-dashed border-[rgba(13,148,136,0.10)]` |

To turn a mono label to normal case (e.g. a meta line), append `normal-case tracking-normal`.

---

## Reusable components index

**Import these before writing new class strings.** They already encode the specs above.

| Pattern | Import from |
|---------|-------------|
| Dark KPI / stat band | `@/components/programs/shared/stat-band` → `<StatBand cells={…} />` |
| Segmented pill toggle | `@/components/programs/shared/segmented-control` → `<SegmentedControl />` (`fullWidth` opt) |
| Uppercase section-label + hairline (+ meta/actions) | `@/components/programs/shared/section-label` → `<SectionLabel />` — the `actions` slot may host a full control cluster (month nav, chips, a SegmentedControl); the training calendar's toolbar-in-divider is the reference |
| White table card + "Showing X of Y" pager | `@/components/programs/shared/library-table-shell` → `<LibraryTableShell />` (`LIBRARY_PAGE_SIZE = 25`) |
| Hover-revealed row action cluster | `@/components/programs/shared/row-actions` → `<RowActions actions={…} />` (row needs `group/row`) |
| Search input (icon + field) | `@/components/programs/shared/library-search-input` → `<LibrarySearchInput />` |
| Relative "updated" formatting | `@/components/programs/shared/format-relative` → `formatRelativeUpdated()` |
| Dialog / Sheet / Popover / Button / Badge / Input / Select / Table | `@/components/ui/*` (already Teal-Summit-styled — see Overlays) |

---

## Recipe: building a new page from scratch

A standard section page (library-style) is:

```tsx
// layout.tsx — wrap in the section shell (52px icon strip is global via PersistentSidebar)
<div className="flex min-h-screen bg-background">
  <div className="min-w-0 flex-1 flex flex-col lg:ml-[52px]">   {/* min-w-0 + overflow-x-hidden below are load-bearing */}
    <header className="sticky top-0 z-10 bg-white px-8 py-2">   {/* sticky topbar */}
      <div className="flex items-center justify-between">
        <h1 className="text-[15px] font-bold text-[#0c1a1e]">Title</h1>
        <NotificationsDropdown compact />
      </div>
    </header>
    <main className="flex-1 overflow-y-auto overflow-x-hidden bg-[#f4f7f6] px-8 py-5 pb-[60px]">
      {children}
    </main>
  </div>
</div>
```

Page body rhythm:

```tsx
<div className="space-y-5">
  <StatBand cells={cells} />                     {/* dark KPI band */}
  {/* toolbar: search + segmented + spacer + sort */}
  <div className="mb-4 flex flex-wrap items-center gap-3"> … <div className="flex-1" /> … </div>
  <SectionLabel label="…" actions={…} />         {/* uppercase divider */}
  <LibraryTableShell …>{/* TableHeader + TableBody */}</LibraryTableShell>
</div>
```

Reference: `components/programs/programs-shell.tsx`, `programs-topbar.tsx`, `app/dashboard/programs/page.tsx`.

---

## Buttons

| Variant | Recipe |
|---------|--------|
| Primary (teal fill) | `inline-flex items-center gap-1.5 rounded-[6px] bg-[#0d9488] px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-[#0b7f75]` — or `<Button className="bg-[#0d9488] text-white hover:bg-[#0b7f75]">` |
| Secondary / subtle | White, `border border-[rgba(13,148,136,0.08)]`, text `#5a7d82` (`<Button variant="outline">`) |
| Ghost | Transparent, text `#5a7d82`, hover `bg-[rgba(0,0,0,0.02)]` / muted (`<Button variant="ghost">`) — used for Cancel |
| Icon action (in a rail) | `rounded p-1 text-[#93b0b4] transition-colors hover:text-[#0d9488]`; destructive variant hovers `hover:text-[#c06060]`; icons `h-3.5 w-3.5` `strokeWidth={1.5}` |
| Dashed "add / new" | `flex w-full items-center justify-center gap-1.5 rounded-[6px] border border-dashed border-[rgba(13,148,136,0.25)] py-2 text-xs font-medium text-[#5a7d82] transition-colors hover:border-[#0d9488] hover:bg-[rgba(13,148,136,0.05)] hover:text-[#0a5c55]` |

The base `Button` primitive: default size `h-10 px-4 py-2.5 rounded-md text-sm font-medium`, `sm` = `h-8 px-3 py-1.5`, `active:scale-[0.98]`. Teal-Summit overrides fills to the `#0d9488`/`#0b7f75` pair.

---

## Badges & chips

| Variant | Recipe |
|---------|--------|
| Neutral chip (focus/split/tag) | `rounded-[4px] bg-[#f0f5f4] px-1.5 py-px text-[10px] font-medium text-[#5a7d82]` (= `CHIP_NEUTRAL_CLASS`); table variant `bg-[#f0f5f4] text-[11px] font-medium text-[#5a7d82] border-transparent` |
| Teal chip / pill (on-tint) | `rounded-[6px] bg-[rgba(13,148,136,0.08)] px-2 py-0.5 font-mono-display text-[10px] text-[#0a5c55]` |
| Draft badge | `<Badge variant="outline">` + `border-[rgba(13,148,136,0.12)] text-[10px] text-[#5a7d82]` (on dark: `border-[rgba(255,255,255,0.2)] px-1.5 py-0 text-[9px] text-[rgba(255,255,255,0.6)]`) |
| Status active | `bg-[rgba(13,148,136,0.08)] text-[#0d9488]` |
| Status archived/inactive | `bg-[rgba(0,0,0,0.03)] text-[#93b0b4]` |
| Warning / goal | `bg-[rgba(245,158,11,0.07)] text-[#d97706]` |
| Training | `bg-[#0d9488] text-white` |
| Rest | `bg-[rgba(13,148,136,0.05)] text-[#93b0b4]` |

Filter chips (toggle): `h-8 rounded-[6px] px-3 text-[12.5px] capitalize`; active `bg-[rgba(13,148,136,0.08)] font-semibold text-[#0d9488]`; inactive `border border-[rgba(13,148,136,0.08)] bg-white font-medium text-[#5a7d82] hover:text-[#0c1a1e]`.

---

## Overlays (dialog / sheet / popover / slide-over)

### When to use which

| Surface | Use for | Width |
|---------|---------|-------|
| **Dialog** | Short confirm or small create form (name + a few fields) | `sm:max-w-md` (compact) → `sm:max-w-lg` (default) → `sm:max-w-xl` (rich, e.g. duplicate-week) |
| **Sheet** (right) | Editing a rich object in place (session editor) | `sm:w-[780px] sm:max-w-full` |
| **Slide-over** (right Sheet) | Creating a rich object (new session) | `sm:w-[780px] sm:max-w-full` |
| **Popover** | Quick pick / attach (choose a session to place) | `w-[320px]` |

### Dialog

Base `DialogContent` is already Teal-Summit: `bg-white border border-[rgba(13,148,136,0.08)] rounded-[6px] p-6 gap-4 shadow-[0_10px_40px_rgba(13,148,136,0.10)] sm:max-w-lg`; overlay `bg-black/40`; title `text-lg font-semibold tracking-tight text-[#0c1a1e]` (18px); description `text-[#5a7d82] text-sm`; close X `absolute top-4 right-4 text-[#93b0b4] hover:text-[#5a7d82]`. Body rhythm `space-y-4 py-1`; field group `space-y-1.5` with a `<Label>`; footer `<DialogFooter>` right-aligns Cancel (ghost) + primary CTA.

### Sheet / slide-over (780px pattern)

Override the base Sheet:

```tsx
<SheetContent side="right" className="flex w-full flex-col gap-0 bg-white p-0 sm:w-[780px] sm:max-w-full">
  <SheetHeader className="flex-row items-center gap-3 space-y-0 border-b border-[rgba(13,148,136,0.08)] px-5 py-3.5">
    {/* THUMB_CLASS h-8 w-8 + SheetTitle text-[15px] font-semibold + SheetDescription MONO_LABEL_CLASS */}
  </SheetHeader>
  <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-4">{/* body */}</div>
  <div className="flex items-center justify-between gap-2 border-t border-[rgba(13,148,136,0.08)] px-5 py-3">
    {/* secondary Button variant="outline" + primary Done bg-[#0d9488] hover:bg-[#0b7f75] */}
  </div>
</SheetContent>
```

Overlay is `bg-black/50`. Slide-over footer uses `justify-end` (Cancel ghost + Save teal).

### Popover (320px pattern)

`<PopoverContent align="start" sideOffset={6} className="w-[320px] rounded-[6px] border-[rgba(13,148,136,0.08)] p-0">` — header `px-3.5 pb-2 pt-3` (title `text-sm font-semibold` + `MONO_LABEL_CLASS` subtitle + close X), scroll body `max-h-[260px] overflow-y-auto px-1.5 pb-1.5`, footer `border-t border-[rgba(13,148,136,0.06)] p-1.5` with a teal-text action.

### Destructive confirm dialog

Reference: `components/clients/training/calendar/delete-event-dialog.tsx`. Use the styled `Dialog` primitive (never `ConfirmDialog`/AlertDialog — un-migrated OKLCH).

- Header row: danger thumb `grid h-9 w-9 shrink-0 place-items-center rounded-[6px] bg-[rgba(192,96,96,0.08)]` + `Trash2 h-4 w-4 text-[#c06060]` (strokeWidth 1.5) beside the `DialogTitle`.
- Body: ONE plain-sans sentence (`text-sm text-[#5a7d82]`) naming exactly what happens and what is preserved ("Completed and past sessions are kept."). No mono. The subject may be `font-semibold text-[#0c1a1e]`.
- Footer: Cancel (`variant="ghost"`) + danger-outline CTA: `variant="outline"` + `border-[rgba(192,96,96,0.3)] text-[#c06060] hover:bg-[rgba(192,96,96,0.08)] hover:text-[#c06060]`, `Loader2` spinner while pending. **There is no filled destructive button in this system — never invent one.** CTA label repeats the verb ("Remove session", "Clear week"), never "OK"/"Confirm".

### Scope / choice dialog (pick-one actions)

Reference: the placed-session tray's save-scope dialog. `sm:max-w-md`; a one-sentence sans intro; then full-width option buttons: `flex w-full items-center gap-3 rounded-[6px] border border-[rgba(13,148,136,0.08)] p-3 text-left hover:bg-[rgba(13,148,136,0.03)]` — leading `h-4 w-4` radio circle (`border-2 border-[#0d9488]` for the primary option, `border-[#93b0b4]` otherwise; swaps to a teal `Loader2` while that option saves), title `text-sm font-medium text-[#0c1a1e]`, subline `text-[11px] text-[#93b0b4]`. Footer: ghost Cancel only (choosing an option IS the confirm). Radio-input variants (e.g. move-scope) use `accent-[#0d9488]` and tint the selected row `border-[rgba(13,148,136,0.2)] bg-[rgba(13,148,136,0.05)]`.

### Toasts

Always `const { toast } = useToast()` — never a bespoke notification surface.

- Title: a short sans fragment stating the outcome — `Session saved`, `Week cleared`, `"{name}" updated`. Quote user-named things with `"…"`.
- Description (optional): one plain sans sentence of consequence — `Programs that already use a copy of this session are unchanged.`
- Failures: `variant: "destructive"` with `title: "Save failed"` (or similar) + the reason as description.
- Never: markup, mono spans, raw error strings, IDs, or dates set in mono. Toast text obeys the prose rule above in full.

---

## Chapter: Programs (Library) page

Reference: `app/dashboard/programs/page.tsx`, `components/programs/programs-table.tsx`, `programs-stat-band.tsx`, `components/programs/shared/**`.

### Stat band

`<StatBand cells={cells} />` renders `bg-[#0f2027] rounded-[6px] p-5 grid animate-card-in` (2–4 cols by cell count). Each cell: `flex flex-col pl-5 pr-5`, right divider `border-r border-[rgba(255,255,255,0.07)]` (except last). Label `text-[10px] uppercase tracking-[0.06em] text-[rgba(255,255,255,0.35)] font-medium`; value `text-[24px] font-bold font-mono-display text-white leading-tight` (muted fallback `text-[13px] text-[rgba(255,255,255,0.3)]`); unit `text-[10px] text-[rgba(255,255,255,0.3)]`; sub `text-[10px] font-mono-display mt-1` (tones: neutral `rgba(255,255,255,0.3)`, warn `#d97706`, up `#0d9488`).

### Toolbar

`mb-4 flex flex-wrap items-center gap-3`:
- `<LibrarySearchInput>` — wrapper relative; `Search` icon `absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#93b0b4]`; input `h-9 w-[260px] pl-9 text-sm`.
- `<SegmentedControl>` — All / Custom / AI generated.
- `<div className="flex-1" />` spacer (pushes sort right).
- Sort `<Select>` — trigger `h-9 w-[180px] text-[13px]`.

### Section-label divider

`<SectionLabel label="Program library" actions={<button …>+</button>} />` → label `text-[10.5px] font-semibold uppercase tracking-[0.07em] text-[#93b0b4]` + `h-px flex-1 bg-[rgba(13,148,136,0.08)]` rule + optional mono meta + actions. Action "+" button: `rounded p-1 text-[#93b0b4] transition-colors hover:text-[#0d9488]` with `Plus h-3.5 w-3.5 strokeWidth={1.5}`.

### Table

`<LibraryTableShell>` = `overflow-hidden rounded-[6px] border border-[rgba(13,148,136,0.08)] bg-white` wrapping `<Table>` + footer (`border-t border-[rgba(13,148,136,0.06)] px-5 py-2.5`; count `font-mono-display text-[11px] text-[#93b0b4]`; pager buttons `h-7 w-7 rounded-[6px]`, enabled `text-[#93b0b4] hover:bg-[#f0f5f4] hover:text-[#5a7d82]`, disabled `text-[#d5e0dd]`).

Rows (`group/row cursor-pointer`, first cell `pl-5`):
- Name: `text-[13.5px] font-semibold text-[#0c1a1e]`; optional Draft badge; description `mt-0.5 max-w-[380px] truncate text-xs text-[#93b0b4]`.
- Focus: neutral chip `bg-[#f0f5f4] text-[11px] font-medium text-[#5a7d82] border-transparent`, else `text-[#93b0b4]` dash.
- Numeric cells: `font-mono-display text-[12.5px]` — primary `text-[#5a7d82]`, meta `text-[#93b0b4]`.
- Actions: `<RowActions>` (hover-revealed, `h-7 w-7` buttons, `h-[15px] w-[15px]` icons; danger hover `bg-[rgba(192,96,96,0.08)] text-[#c06060]`).

`TableHead` (base): `h-10 px-2 text-xs uppercase tracking-wider font-medium text-muted-foreground`. `TableCell` base `p-2`.

### Empty state

`py-12 text-center text-[#5a7d82]` with a large muted icon (`h-8 w-8 opacity-50 strokeWidth={1.5}`), a `text-sm` line, a `text-xs text-[#93b0b4]` hint, and a primary "New" button.

### Create-program dialog

`<DialogContent className="sm:max-w-md">`; body `space-y-4 py-1`; each field `space-y-1.5` (`<Label>` + `<Input>`/`<Textarea>`); footer Cancel (ghost) + `Create program` (`bg-[#0d9488] text-white hover:bg-[#0b7f75]`, spinner `Loader2 mr-1.5 h-4 w-4 animate-spin`).

---

## Chapter: Program Builder page

Reference: `components/clients/training/program-builder/**`. The builder is **full-bleed** (its own dark header replaces the section topbar — `ProgramsTopbar` returns null for the builder view).

### Frame & layout

- Root cancels the shell padding and goes full height: `-mx-8 -mt-5 -mb-[60px] flex h-screen flex-col`.
- Inner row `flex min-h-0 flex-1`: left **library panel** + main column.
- Main column: `flex min-h-0 min-w-0 flex-1 flex-col px-6 pt-5`.
- Loading: centered `Loader2 h-6 w-6 animate-spin text-[#93b0b4]` in `py-24`.

### Library panel (left)

`sticky top-0 flex h-screen w-[296px] shrink-0 flex-col border-r border-[rgba(13,148,136,0.08)] bg-white`. Header `px-[18px] pt-[18px]`: back link `text-[12.5px] font-medium text-[#5a7d82] hover:text-[#0a5c55]` (+ `ChevronLeft h-3.5 w-3.5`); title `text-base font-semibold tracking-[-0.01em] text-[#0c1a1e]`; `<SegmentedControl fullWidth>` Sessions/Exercises.

Library cards (session & exercise): `group/row flex items-center gap-2 rounded-[6px] bg-white p-2 pl-1.5` + `TRAINING_CARD_BORDER`; hover `-translate-y-px shadow-[0_6px_20px_rgba(13,148,136,0.08)]`; dragging `opacity-40`. Grip `GripVertical h-3.5 w-3.5` (`cursor-grab`); thumb `THUMB_CLASS h-[30px] w-[30px]` + `Dumbbell h-[15px] w-[15px]`; name `truncate text-xs font-semibold text-[#0c1a1e]`; meta `mt-0.5 MONO_LABEL_CLASS normal-case tracking-normal`; focus chip `CHIP_NEUTRAL_CLASS`; `<RowActions>`.

List area `min-h-0 flex-1 space-y-2 overflow-y-auto px-[14px] pb-2`; search `h-8 pl-8 text-xs` + `FOCUS_RING` (icon `left-2.5 h-3.5 w-3.5 text-[#93b0b4]`); drag hint `px-[18px] pb-1.5 MONO_LABEL_CLASS`. Footer `border-t border-[rgba(13,148,136,0.08)] px-[18px] py-3` with a dashed "New session/exercise" button (`h-8` dashed-`0.25` recipe above).

### Dark hero header (`program-top-bar`)

`mb-4 flex items-center gap-4 overflow-hidden rounded-[6px] bg-[#0f2027] px-5 py-3`. Back `text-[rgba(255,255,255,0.45)] hover:text-white` (`ArrowLeft h-4 w-4`). Eyebrow `HEADER_EYEBROW_CLASS` ("Program") + optional draft badge. Name (view) `text-[17px] font-semibold leading-tight tracking-[-0.01em] text-white` (edit: transparent borderless `Input` + `FOCUS_RING`). Stat row (`md:flex`, hidden below) `font-mono-display text-[11px] text-[rgba(255,255,255,0.4)]`, bold segments `text-[rgba(255,255,255,0.92)] font-medium`, dot separators `h-[3px] w-[3px] rounded-full bg-[rgba(255,255,255,0.2)]`. Surplus pill `ml-auto rounded-[6px] border border-[rgba(255,255,255,0.14)] px-2.5 py-1` (label `font-mono-display text-[10px] uppercase tracking-[0.08em]`, borderless mono input, `%` suffix).

### Schedule divider + action rail

`<SectionLabel>` ("Schedule") with an action cluster `flex items-center gap-3`: Edit (`Pencil`), Delete (`Trash2`, hover `#c06060`), Discard (`Ban`, hover `#c06060`), Save (`Save`, `text-[#0d9488] hover:text-[#0b7f75]`, `Loader2` while saving). All `rounded p-1`, icons `h-3.5 w-3.5 strokeWidth={1.5}`.

### The weeks × day grid

- Column template (shared by header + every row): `grid grid-cols-[42px_repeat(7,minmax(158px,1fr))] gap-2` (= `GRID_COLS`).
- Scroll container `scrollbar-none relative min-h-0 flex-1 overflow-auto`; content floor `min-w-[1220px]` so day columns breathe on wide screens and scroll on narrow (page body must never scroll — the grid does).
- Sticky planes on `bg-[#f4f7f6]`: day-header row `sticky top-0 z-30`; week-column cell `sticky left-0 z-20`; corner `sticky` both + `z-40`. Each sticky cell paints an 8px gap-cover strip: `after:absolute after:left-full after:top-0 after:h-full after:w-2 after:bg-[#f4f7f6]`.
- Day headers `py-1 text-center MONO_LABEL_CLASS`. Week rows stacked `space-y-2`. "Add week" `sticky left-0 pt-2` dashed button (idle border `rgba(13,148,136,0.2)`, hover solid teal + `bg-[rgba(13,148,136,0.05)]`).

### Week card (42px column)

`flex flex-col items-center gap-1 pt-2.5` (`group/wk`). W# chip `rounded-[6px] bg-[rgba(13,148,136,0.08)] px-[7px] py-1 font-mono-display text-[10.5px] font-semibold text-[#0a5c55]`; frequency `font-mono-display text-[9.5px] text-[#c2d0cc]`. Hover control stack `hidden group-hover/wk:flex`; each control `grid h-5 w-5 place-items-center rounded hover:bg-[rgba(13,148,136,0.08)]` (`CTRL_BTN`) with `h-3 w-3` icons (grip, collapse chevron, `Copy`, `TrendingUp` = duplicate-with-progression, `Trash2` delete → `text-destructive hover:bg-red-50`).

### Day cell (session vs rest)

- **Rest / empty:** `flex h-full flex-col items-center justify-center rounded-[6px] border border-dashed border-transparent bg-transparent`; drag-over `border-[#0d9488] bg-[rgba(13,148,136,0.05)]`; editable hover `hover:border-[rgba(13,148,136,0.25)] hover:bg-[rgba(13,148,136,0.03)]` + `FOCUS_RING`. "Rest" label `MONO_LABEL_CLASS`; on hover reveals "Add session" `text-[11px] font-semibold text-[#0d9488]`.
- **Session card:** `flex h-full cursor-pointer flex-col rounded-[6px] bg-white px-[11px] py-2.5` + `TRAINING_CARD_BORDER` + `FOCUS_RING`; expanded hover-lift `hover:-translate-y-px hover:shadow-[0_6px_20px_rgba(13,148,136,0.08)]`; drag-over `border-[#0d9488]`. Collapsed `min-h-9` (36px), expanded `min-h-[148px]`.
  - Header: thumb `THUMB_CLASS h-5 w-5` + `Dumbbell h-3 w-3`; name `text-[13px] font-semibold text-[#0c1a1e]`; surplus badge `font-mono-display text-[10px] font-medium text-[#0d9488]` ("+N%"); hover actions (clear-X danger, grip) `opacity-0 group-hover/cell:opacity-100`.
  - Exercise list `mt-1.5 space-y-[3px]` (first 3): index `w-2 font-mono-display text-[9.5px] text-[#c2d0cc]`, name `text-[11px] text-[#5a7d82]`, sets×reps `font-mono-display text-[10px] text-[#93b0b4]`; "+N more" `font-mono-display text-[10px] text-[#c2d0cc]`.
  - Footer `mt-auto border-t border-[rgba(13,148,136,0.06)] pt-1.5` — duration & focus `font-mono-display text-[10px] text-[#93b0b4]`.

### Exercise card (in the session editor)

`rounded-[6px] bg-white` + `TRAINING_CARD_BORDER`. Header `flex items-center gap-2 p-2`: grip; ordinal circle `grid h-6 w-6 place-items-center rounded-full bg-[rgba(13,148,136,0.08)] font-mono-display text-[11px] font-semibold text-[#0a5c55]`; thumb `THUMB_CLASS h-7 w-7` + `Dumbbell h-3.5 w-3.5`; name `text-[13px] font-semibold text-[#0c1a1e]`; "Notes" teal chip; `Video h-3 w-3`; compact summary `font-mono-display text-[11px] text-[#5a7d82]`; remove `Trash2 h-3 w-3 text-destructive hover:bg-red-50`; expand chevron. Expanded body `space-y-1 border-t border-[rgba(13,148,136,0.08)] p-2` with the set grid; exercise-level fields (video URL, coach note) under another `border-t` with `LABEL_CLASS` labels and `h-7`/`min-h-14` inputs + `FOCUS_RING`.

### Set-row & drop-set editors

- Set grid: `grid grid-cols-[20px_minmax(0,1.1fr)_minmax(0,1.3fr)_minmax(0,1.7fr)_minmax(0,0.7fr)_minmax(0,0.8fr)_48px] items-center gap-1.5` (# / type / reps / load / RPE / rest / actions). Column header row uses `LABEL_CLASS`.
- All set inputs/selects `h-7 … font-mono-display text-[11px]` + `FOCUS_RING`, numerics centered; working-set select adds `border-[rgba(13,148,136,0.2)] bg-[rgba(13,148,136,0.05)] font-medium text-[#0a5c55]`. Row action buttons `rounded p-1 hover:bg-[rgba(13,148,136,0.08)] text-[#93b0b4]` (`h-3 w-3` icons).
- Drop-set sub-editor: `ml-8 mt-1 space-y-1 border-l border-dashed border-[rgba(13,148,136,0.15)] pl-3`; inputs `h-6 … font-mono-display text-[11px]`; "Add drop" uses `LABEL_CLASS hover:text-[#0d9488]`.

### Session editor sheet / create slide-over / add-session popover / exercise picker / duplicate-week dialog / progression preview

Follow the **Overlays** recipes: session editor & create-session are 780px right Sheets (fields grid `grid grid-cols-2 … lg:grid-cols-[1fr_1fr_110px_130px] gap-3`, `h-8` inputs); add-session is a 320px Popover (rows hover `bg-[rgba(13,148,136,0.05)]`, "Create blank session" in teal `#0d9488`); exercise picker is a `rounded-[6px] border-[rgba(13,148,136,0.08)] bg-white` dropdown (`max-h-64`, rows `px-2.5 py-1.5 hover:bg-[rgba(13,148,136,0.05)]`); duplicate-week is `sm:max-w-xl` with `AMOUNT_INPUT_CLASS = h-8 w-20 text-center font-mono-display text-xs` and `<SegmentedControl>` switches; progression preview is `max-h-[40vh] rounded-[6px] bg-white` + `TRAINING_CARD_BORDER`, diffs `font-mono-display text-[11px]` with the "after" value `font-semibold text-[#0d9488]`.

---

## Layout

### Client detail pages (3-column)

#### Far left: Icon strip — 52px wide

- Background `#0f2027`; logo 32px square, 6px radius, `linear-gradient(135deg, #0d9488, #0f766e)`, white "CH".
- Nav icons 36px square, 6px radius. Active `bg-[rgba(13,148,136,0.15)]` + `#0d9488` stroke; inactive `rgba(255,255,255,0.35)` stroke, hover `rgba(255,255,255,0.05)` bg.
- Notification bell at bottom with teal badge.

#### Centre: Client sidebar — 200px, white

- Right border `1px solid rgba(13,148,136,0.08)`.
- Top (padding `18px 16px 14px`): back arrow (`#93b0b4`) + avatar (26px, 6px radius, teal gradient) + name (13.5px, 600).
- Vertical tabs (13.5px): active = 3px teal left bar + `rgba(13,148,136,0.05)` bg + 600 + `#0c1a1e`; inactive = 400 + `#6b8a8e`, hover `rgba(0,0,0,0.02)`.
- Bottom: Settings pinned, separated by `border-top rgba(13,148,136,0.08)`.

#### Right: Content area

`flex: 1`, background `#f4f7f6`, padding `20px 32px 60px` (`px-8 py-5 pb-[60px]`).

### Non-client / section pages

- Global 52px icon strip (via `PersistentSidebar`); section content offset `lg:ml-[52px]`, `min-w-0`, `overflow-x-hidden`, `bg-[#f4f7f6]`, sticky white topbar.

---

## Component Patterns (legacy reference)

### Segmented control

Track `rounded-[6px] bg-[rgba(13,148,136,0.05)] p-[2px] gap-[2px]`; active `bg-white rounded-[4px] font-semibold text-[#0c1a1e] shadow-[0_1px_3px_rgba(0,0,0,0.05)]`; inactive `font-medium text-[#5a7d82] hover:text-[#0c1a1e]`; buttons `px-3.5 py-1.5 text-[13px] transition-all duration-150`.

### Dark summary cards

Background `#0f2027`, 6px radius; labels 10px uppercase `rgba(255,255,255,0.35)`; values white 22–32px bold (mono); secondary `font-mono-display rgba(255,255,255,0.3–0.4)`; dividers `rgba(255,255,255,0.06–0.08)`.

### White content cards

Background `#fff`; border none where spacing separates (else `rgba(13,148,136,0.08)`); 6px radius; interactive hover `translateY(-1px)` + `shadow-[0_6px_20px_rgba(13,148,136,0.08)]`.

### Training vs rest day cards

| Property | Training | Rest |
|----------|----------|------|
| Background | White | Transparent |
| Border | `1px solid rgba(13,148,136,0.08)` | `1px dashed rgba(13,148,136,0.10)` |
| Badge | Teal `#0d9488` bg, white "Train" | Brand-subtle bg, muted "Rest" |
| Text | Bold dark | Muted `#93b0b4` |
| Macro bars | Full opacity | 30% opacity |
| Empty values | — | Dash "—" |

### Collapsible sections

White card, no border, 6px radius; header clickable (600 title + count badge on brand-subtle bg); chevron rotates on toggle; inner table with light teal-tinted dividers and mono macro values.

---

## Animations

| Animation | Properties |
|-----------|------------|
| Card entrance (`animate-card-in`) | `translateY(10px)`→`0`, `opacity 0`→`1`, `0.35s ease`; stagger `0.04s` |
| Fade in | `opacity 0`→`1`, `0.3s ease` |
| Slide up | `translateY(6px)`→`0`, `opacity 0`→`1`, `0.35s ease` |
| Drawer slide-in (`animate-drawer-slide-in`) | `translateX(100%)`→`0`, `0.35s cubic-bezier(0.16,1,0.3,1)` |
| Card hover-lift | `-translate-y-px` + `shadow-[0_6px_20px_rgba(13,148,136,0.08)]` |
| Hover transitions | `0.12–0.15s ease` (`duration-150`) |
| Chevron rotation | `0.2s ease` (`duration-200`) |
| Button press | `active:scale-[0.98]` |

---

## Icon Guidance

- Library: Lucide (planned migration to Phosphor).
- **Stroke width `1.5` consistently.**
- Sizes: card grips/search/close/thumbs `h-3.5 w-3.5` (14px); inline action icons `h-3 w-3` (12px); row-action icons `h-[15px] w-[15px]`; sheet-header thumb `h-4 w-4`; loaders `h-4 w-4`/`h-5 w-5`.
- Colour hierarchy: primary `#0c1a1e`; secondary `#5a7d82`; muted `#93b0b4`; on dark inactive `rgba(255,255,255,0.35)`, active `#0d9488` / eyebrow `#5eead4`.

---

## Spacing Principles

**Let spacing do separation work, not borders.** White cards on `#f4f7f6` provide enough contrast without borders.

| Context | Value |
|---------|-------|
| Between day cards / grid gap | 8px (`gap-2`) |
| Between stacked cards / rows | 8px (`space-y-2`) |
| Page section rhythm | 20px (`space-y-5`) |
| Between major sections | 16px (`mb-4`) |
| Between section groups | 24–28px |
| Content padding top | 20px (`py-5`) |
| Content padding horizontal | 32px (`px-8`) |
| Content padding bottom | 60px (`pb-[60px]`) |
| Builder main column | `px-6 pt-5` |
| Overlay body padding | `px-5 py-4` (sheet) / `p-6` (dialog) |

---

## Anti-patterns — do NOT

- ❌ Use slate/gray defaults (`#64748b`, `#94a3b8`, `text-slate-*`, `bg-gray-*`). ✅ Use the teal-tinted greys.
- ❌ Use pill shapes or the 10px base radius on cards/dialogs. ✅ `rounded-[6px]` (4px inner chips).
- ❌ Set numerals in the sans font. ✅ `font-mono-display` for all numbers/metas/labels.
- ❌ Invent a primary-button hover colour. ✅ `hover:bg-[#0b7f75]`.
- ❌ Ship an input without a focus ring. ✅ Add `FOCUS_RING`.
- ❌ Rebuild StatBand / SegmentedControl / LibraryTableShell / SectionLabel / RowActions from scratch. ✅ Import them.
- ❌ Style a Teal-Summit surface off the OKLCH tokens (`bg-background`, `bg-primary`, `rounded-lg`). ✅ Author with the hex values here.
- ❌ Copy values from the `atletafit-*.html` mockups. ✅ Match the shipped Programs/Builder code.
- ❌ Set a date, name, or number in `font-mono-display` inside a running sentence (dialog/toast/empty-state prose). ✅ Mono is for standalone data only — see "Prose vs data".
