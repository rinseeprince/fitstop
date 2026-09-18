# CoachHub Design System — Teal Summit

Single source of truth for the CoachHub visual design. Every new page and component must follow these specifications. This doc is written to be **copy-paste actionable**: prefer importing the components/tokens it names, and when you must write fresh markup, paste the literal class strings in the recipes below.

---

## How to use this doc

### Canonical hierarchy (what wins when things disagree)

1. **Shipped Programs & Builder code is the reference.** The system was established with the Nutrition redesign, then hardened by the **Programs page** (`app/(coach)/dashboard/programs/**`, `components/programs/**`) and the **Program Builder** (`components/clients/training/program-builder/**`). When a spec here and a shipped component disagree, **match the shipped Programs/Builder code**. Every new page should read like those two.
2. This doc.
3. Everything else (the OKLCH base layer, old pages) is legacy to be migrated.

### Two token layers — author with the hardcoded hex

`app/globals.css` defines an OKLCH `:root` layer (shadcn defaults: `--background`, `--primary`, `--border`, `--muted`, `--radius: 10px`, `--radius-xs: 6px`, …). **Teal-Summit surfaces override that layer with hardcoded hex.** Rules:

- **Author new Teal-Summit UI with the hex values in this doc**, not the semantic OKLCH tokens — write `bg-[#0d9488]`, `rounded-[6px]`, `text-[#0c1a1e]`, `border-[rgba(13,148,136,0.08)]`. The OKLCH layer still powers un-migrated primitives and generic `bg-background`/`border-border` fallbacks, but a Teal-Summit page must not depend on it for its look.
- The base radius token is **10px**; Teal-Summit forces **6px everywhere** via explicit `rounded-[6px]`. Never inherit the 10px default on a card/dialog.
- The original `atletafit-*.html` design mockups were **deleted** (they used DM Sans / `#2E8577` / 10–18px radii that never shipped). The shipped code is the only visual reference.

---

## Non-negotiables checklist

Apply these by default on every surface — they are the difference between "right first time" and iteration:

- [ ] **Radius = `rounded-[6px]`** on all cards/buttons/inputs/dialogs/sheets/popovers/badges. Inner chips & segmented-active = `rounded-[4px]`. Circles (dots, ordinals) = `rounded-full`. No pill shapes, no large radii — **the one exemption is `<Switch>`**, where the pill IS the affordance (see "Switch").
- [ ] **Greys carry a teal undertone.** Ink `#0c1a1e`, secondary `#5a7d82`, muted `#93b0b4`. **Never** use `#64748b`, `#94a3b8`, `#0f172a`, `#1e293b`, or any Tailwind slate/gray default.
- [ ] **Mono = numbers only.** `font-mono-display` (JetBrains Mono) is ONLY for numerals and number-bearing data strings; every word-only string — labels, eyebrows, instructions, the word "Rest" — is Instrument Sans. See the Typography decision table; `npm run check:labels` enforces it.
- [ ] **UI text uses Instrument Sans** (the default body font — no class needed).
- [ ] **Primary/brand = `#0d9488`, its hover = `#0b7f75`.** Never invent a hover shade.
- [ ] **Every input gets `FOCUS_RING`** (`focus-visible:ring-2 ring-[#0d9488]/35 ring-offset-0`).
- [ ] **Borders carry a teal tint** — default `border-[rgba(13,148,136,0.08)]`, inner hairlines `rgba(13,148,136,0.06)`.
- [ ] **Spacing does separation, not borders.** White cards on `#f4f7f6` need no border where spacing already separates them.
- [ ] **Uppercase micro-labels** get letter-spacing (`tracking-[0.06em]`–`0.14em`) and a muted colour.
- [ ] **Page background is `#f4f7f6`** (cool-green tint), dark surfaces are `#0f2027` (deep teal-black) — never neutral slate.
- [ ] **Every pane/period/filter switcher is `<SegmentedControl>`.** One component, one size, one weight — `12.5px` `font-medium` in BOTH states, the active segment carried by the white pill + shadow + darker ink and never by a heavier font. **Never hand-roll the track**; `npm run check:labels` (clause 3) fails on the markup. See "Segmented control".
- [ ] **Never correct a `ui/` primitive at the call site** — `Input`/`Textarea`/`Label`/`Select`/`Switch`/`Slider`/`Dialog`/`Table` are Teal-Summit; a radius, border, ink or focus ring pasted onto one is a bug report about the primitive. `check:labels` clause 4 enforces the focus half.
- [ ] **Search = `<LibrarySearchInput>`, toolbar sort = `<LibrarySortSelect>`.** Never hand-roll either.
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
| `0.15` | Drop-set dashed rail; linked-group rail; active icon on dark strip |
| `0.20` | Idle dashed "add" button border; working-set select border |
| `0.25` | Dashed "new" button border; interactive card hover border |
| `0.35` | Focus ring (`ring-[#0d9488]/35`) |

### On-dark values (text/borders over `#0f2027`)

| Element | Value |
|---------|-------|
| Eyebrow | `rgba(255,255,255,0.35)` — the label scale, NOT teal/mint. On-dark teal is reserved for interactive/active elements; a passive eyebrow in mint out-shouts the title beneath it (`#5eead4` is retired from labels) |
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
| UI text & every word-only string | **Instrument Sans** | Default body font (`app/layout.tsx` sets it on `<body>`) — no class needed |
| Numerals & number-bearing data strings | **JetBrains Mono** | Always via a token from `builder-tokens.ts` (`MONO`, `MONO_*`, `STAT_VALUE_DARK_CLASS`, …) — never the raw `font-mono-display` utility |

### Mono = numbers only (decision table)

The rule (owner decision, 2026-07-23): **JetBrains Mono is ONLY for numerals and number-bearing data strings. Instrument Sans is for every word-only string.**

| MONO (JetBrains, via token) | SANS (Instrument, default) |
|---|---|
| Set/rep schemes — `4×10-12` | Labels & eyebrows — `TRAINING PLAN`, `PROGRAM`, `EXERCISE` |
| Loads, durations — `60 min` | Section dividers — `SCHEDULE` |
| Dates — `Wed, Jul 22` | Stat labels — `SESSIONS COMPLETED` |
| Counts — `22 sessions`, `+1 more`, `0/1 sessions` | Table column headers |
| Ordinals/chips — `W1`, `Day 1`, `3×` | Form labels |
| Stat values | Instructions — `DRAG A SESSION ONTO A DAY` |
| Metas that contain numbers — `6 weeks · 22 sessions` | The word `Rest` in day cells |

**Tie-break:** if the string contains a numeral that IS the information → mono; otherwise sans. (A user-authored *name* containing digits stays sans — the digits are part of the name, not the datum. Interactive control options — select items, segmented values — are controls, not data strings, and stay sans.)

**Dynamic slots** that render words sometimes and numbers other times take the dominant case at the class site; split the branches when the states are already distinguishable (e.g. a word-only fallback next to a numeric rate).

**Enforcement:** `npm run check:labels` (`scripts/check-labels.ts`, in the §13 commit-ready checklist) fails the build when the raw `font-mono-display` literal or a hand-rolled `uppercase` + `tracking-*` label string appears outside the token modules and the explicit whitelist (`scripts/check-labels-whitelist.ts` — out-of-scope trees only, never a dodge for coach-surface code).

Recipes elsewhere in this doc describe **rendered pixels**; where a recipe names `font-mono-display` or an uppercase label string, author it via the corresponding token (`MONO`, `MONO_META_CLASS`, `LABEL_CLASS`, …) + call-site overrides — never by pasting the raw utility.

### Prose vs data — where mono is allowed

**Never set a word, date, or number in `font-mono-display` inside a running sentence.** Sentences — dialog descriptions, toast text, empty states, help text, banners — are 100% Instrument Sans, including any dates or names they contain (bold sans is fine for emphasis).

- ✅ `Removes Push Day on Sun, Aug 2 from the calendar.` (all sans; "Push Day" may be `font-semibold`)
- ❌ `Removes Push Day on `<code>Sun, Aug 2</code>` from the calendar.` (mono date mid-sentence reads as broken kerning)
- ✅ A card meta line `Wed, Jul 22` in `MONO_LABEL_CLASS` — that's standalone data, not a sentence.

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
| `12.5px` | Table mono cells, filter chips, **segmented control (all segments, both states)** |
| `13px` | Session/exercise names, primary-button text, default table body |
| `13.5px` | Table program name, client name, **sidebar back-row label** ("All programs", the client's name) |
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

### The `ui/` primitives are Teal-Summit — HARD RULE

**Never correct a shared primitive at the call site.** `Input`, `Textarea`, `Label`, `Select` (trigger *and* panel), `Switch`, `Slider`, `Dialog` and `Table` already carry the radius, the teal border, the ink, the placeholder tone and the focus ring. A `rounded-xs`, a `border-[rgba(13,148,136,0.08)]`, a `text-[13px]` or a `focus:` ring pasted onto one of them is not a style — it is a bug report about that primitive, and the fix belongs in `components/ui/**`.

A call site may only add what is genuinely local: a **size tier** (`h-8`/`h-9`), a **width**, `bg-white` where the field sits on a tint, `resize-none`, or `font-medium`.

**Why this is a hard rule.** These primitives shipped un-migrated for a long time while the doc asserted they were done. The result, found in one sweep on 2026-08-22:

- `rounded-xs` hand-written at the call site in **five files**, each correcting the same wrong 8px default one input at a time.
- **Eight** local constants (`inputClass`, `TRIGGER_CLASS`, `FIELD_INPUT`, `selectTriggerClass`, `ITEM_CLASS`, …) re-implementing the primitive — three exact copies of one string, three of another.
- **Four different focus treatments** for the same control: `focus:ring-1 ring-[#0d9488]/20`, `focus-visible:ring-[#0d9488]` with neither width nor opacity, `focus:shadow-[0_0_0_3px_rgba(13,148,136,0.06)]` paired with `focus:ring-0` to *disable* the shared ring, and the correct literal simply retyped rather than imported.

`npm run check:labels` **clause 4 fails the build** on any `focus:`/`focus-visible:` ring or border naming `#0d9488` outside the token modules. (Selection and "today" indicators are `ring-1 ring-[#0d9488]` with no `focus:` prefix, so they do not match.)

### Search fields — HARD RULE

**Every search field is `<LibrarySearchInput>`** (`@/components/programs/shared/library-search-input`). Two tiers, one component; never hand-roll a magnifier beside an input.

| `size` | Field | Icon | Default `fill` | Where |
|---|---|---|---|---|
| `toolbar` (default) | `h-9 w-[260px] pl-9 pr-2.5 text-[13px]` | `left-3 h-4 w-4` | `white` | A section toolbar, paired with `<LibrarySortSelect>` |
| `panel` | `h-8 pl-8 pr-2.5 text-xs` | `left-2.5 h-3.5 w-3.5` | `transparent` | A side panel, drawer or popover list filter |

Pass `className` for **width only** (`flex-1 max-w-md`); the treatment belongs to the tier.

`fill` (`transparent` | `white` | `page`) is the one visual choice a call site makes, because it depends on what the field sits ON, not on what the field is: a toolbar search reads white against the page, a drawer search reads recessed (`page`) against white. It is an enum rather than a class so that "set the fill" cannot quietly become "restyle the field".

### Sort / filter selects — HARD RULE

**A toolbar's sort control is `<LibrarySortSelect>`** (`@/components/programs/shared/library-sort-select`) — `h-9 w-[180px]`, secondary ink, options as data. Everywhere else use `<Select>` directly and let it style itself.

The trigger and the panel are ONE control and must not be styled apart: `Select`'s panel now matches `DropdownMenu` exactly (6px radius, `rgba(13,148,136,0.08)` border, `shadow-[0_10px_40px_rgba(13,148,136,0.10)]`, `rounded-[4px]` `px-2.5 py-1.5` 13px items, `0.05` focus wash, `#0a5c55` ink, a teal `Check`). Migrating one half without the other is not a smaller change — it is a grey 8px trigger opening a teal 6px panel.

### Switch — the one sanctioned pill

**Every two-way toggle that is a SETTING is `<Switch>`** (`@/components/ui/switch`) — a
per-item on/off, not a choice between two named modes. A switcher between *panes, periods,
filters or modes* is `<SegmentedControl>`; the two are not interchangeable, and the question
that separates them is whether the off state has a name.

| Part | Class |
|---|---|
| Track | `h-[22px] w-[40px] rounded-[11px] border border-transparent shadow-xs transition-all` |
| On | `bg-[#0d9488]` |
| Off | `bg-[rgba(13,148,136,0.12)]` |
| Thumb | `h-4 w-4 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.12)]`, travel `translate-x-[18px]` |
| Focus | `FOCUS_RING` |
| Disabled | `disabled:cursor-not-allowed disabled:opacity-50` |

**`rounded-[11px]` on a 22px track is a full pill, and that is the one exemption to
"no pill shapes"** — on a switch the pill is the affordance, not decoration. It does not
extend to anything else: a card, a button, a chip or a badge in a pill shape is still wrong.

**A call site passes `checked`, `onCheckedChange`, `disabled` and an `aria-label`. Nothing
else.** The primitive shipped un-migrated until 2026-08-30 and the result is the reason this
section exists: six call sites, three treatments — the full look hand-written at
`nutrition-surplus-settings.tsx`, half of it (`data-[state=checked]:bg-[#0d9488]` alone, so
the OFF track stayed OKLCH grey at the default size) at two more, and three on the raw
shadcn defaults. The spec above is that hand-written string, moved into the primitive.

**It carries its own accessible name.** Radix gives it `role="switch"`, so an `aria-label`
is all it needs — never wrap it in a `role="group"` to name it.

### Input heights by context

| Height | Class | Where |
|--------|-------|-------|
| 24px | `h-6` | Drop-set editor cells |
| 28px | `h-7` | Set-row editor cells (dense numeric grid) |
| 32px | `h-8` | Standard form fields, panel/popover search |
| 36px | `h-9` | Toolbar search & sort select |
| 40px | `h-10` | Default `Button` size |

Numeric fields are `font-mono-display` and `text-center`.

**Every control on a row shares one height — HARD RULE.** A text input, a date input and a
`<Select>` sitting in the same grid row all take the same `h-*`, so the row reads as one band and a
card of them stacks evenly. A dropdown standing 8px taller than the field beside it is the tell.

- **Set it at the call site, once per row.** `h-8` for a standard form row (the client details
  sheet is the reference), `h-7` in a dense numeric grid (set-row editor). Do not leave a control
  on its own default and hope it matches.
- **A `<Select>` needs no special handling** — pass it the same `h-*` as its neighbours and it
  obeys. It did NOT until 2026-08-28: `SelectTrigger` set its default height through
  `data-[size=default]:h-10`, and a data-variant is a different group to tailwind-merge than a bare
  `h-8`, so the two never registered as conflicting and the variant won. Six call sites were asking
  for a shorter trigger and silently getting 40px. The base now carries a plain `h-10`, which
  merges normally. **If you ever add a sizing class to a `components/ui` primitive, write it plain,
  never behind a `data-[…]:` variant** — a variant cannot be overridden by the call site and fails
  silently rather than loudly.
- **Height only.** Horizontal padding already agrees (`px-3.5` on both `Input` and `SelectTrigger`);
  a dense grid overrides both together (`h-7 px-2`).

### Date inputs express their bounds natively

**A date field with a bound sets `min` / `max` on the input, not validation alone.** The impossible
days are then greyed out and unclickable in the picker, instead of being offered, chosen, and
rejected afterwards — a coach should never be able to select a day the app will refuse.

- Validation still ships. `min`/`max` are a native affordance, not a security control: they are
  trivially bypassed, so the schema and the route keep their own checks. They exist so the coach
  never reaches those checks by accident.
- **Compose multiple bounds into one attribute.** A field constrained by two rules takes the
  tighter: `min={max(today, startDate)}` rather than one bound honoured and the other 400'd.
- **Only bound what is genuinely impossible.** A past *deadline* is refused, so it is bounded; a
  past *start date* is a real thing to record, so it is not. Greying out a legitimate day is the
  same defect in the other direction.

A date changed from an icon rather than a field is the "Date picker popover" (Overlays) — the same bound, greyed in its calendar.

Shipped references: `components/clients/nutrition/builder/nutrition-settings-form.tsx` and
`components/training-library/apply-to-client-dialog.tsx` (the two setup surfaces — "Starts on" /
"Start Date" under a Block field: `min` = the field's floor — the deletion floor on the apply dialog, the client's today on the nutrition drawer; with a block chosen the field is
DISABLED on the block's first available day rather than bounded, and the field's empty state is a
bare dash; one shared picker, `components/clients/metrics/blocks/block-start-picker.tsx`), `components/clients/metrics/blocks/block-form.tsx` (blocks — composes two bounds
into one `min`, plus a `max`), `components/clients/metrics/log-measurement-dialog.tsx`
(`max={today}` — a measurement cannot be logged in the future), and the Overview status card's
goal deadline.

---

## System component tokens

The builder tokens are **app-wide** — reuse them anywhere, not just in the builder. Import from `@/components/clients/training/program-builder/builder-tokens`:

| Token | Literal value |
|-------|---------------|
| `TEXT_PRIMARY` | `text-[#0c1a1e]` |
| `TEXT_SECONDARY` | `text-[#5a7d82]` |
| `TEXT_MUTED` | `text-[#93b0b4]` |
| `FOCUS_RING` | `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0d9488]/35 focus-visible:ring-offset-0` |
| `LABEL_CLASS` | `text-[10px] font-medium uppercase tracking-[0.06em] text-[#93b0b4]` (word-only labels) |
| `MONO_LABEL_CLASS` | `font-mono-display text-[10px] font-medium uppercase tracking-[0.08em] text-[#93b0b4]` (number-bearing labels/metas ONLY — `Day 3`, `Wed, Jul 22`) |
| `HEADER_EYEBROW_CLASS` | `text-[9.5px] font-medium uppercase tracking-[0.14em] text-[rgba(255,255,255,0.35)]` (on dark; SANS — eyebrows are word-only) |
| `MONO` | `font-mono-display` (bare numeric fragments inheriting size/colour — the only sanctioned route to the raw utility) |
| `MONO_META_CLASS` | `font-mono-display text-[#93b0b4]` (numeric metas/footers/counters; size at call site) |
| `MONO_INPUT_CLASS` | `text-center font-mono-display` (numeric editor inputs; size/height at call site) |
| `MONO_CELL_CLASS` | `font-mono-display text-[12.5px]` (numeric table cells; colour at call site) |
| `STAT_LABEL_DARK_CLASS` | `text-[10px] font-medium uppercase tracking-[0.06em] text-[rgba(255,255,255,0.35)]` (on-dark word stat label — StatBand's label) |
| `STAT_VALUE_DARK_CLASS` | `font-mono-display font-bold text-white` (on-dark stat value; size tier at call site: 22/24/32px) |
| `SECTION_LABEL_CLASS` | `text-[10.5px] font-semibold uppercase tracking-[0.07em] text-[#93b0b4]` (divider-label text; prefer `<SectionLabel>` when a hairline is wanted) |
| `COUNT_CHIP_CLASS` | `font-mono-display text-[10px] font-semibold rounded-[6px] bg-[rgba(13,148,136,0.05)] px-1.5 py-0.5 text-[#0d9488]` (teal count chips — `3`, `2/5`) |
| `CHIP_NEUTRAL_CLASS` | `rounded-[4px] bg-[#f0f5f4] px-1.5 py-px text-[10px] font-medium text-[#5a7d82]` (word chips — focus tags, `Notes`) |
| `THUMB_CLASS` | `grid shrink-0 place-items-center rounded-[6px] bg-[rgba(13,148,136,0.08)] text-[#0d9488]` (caller sets `h-/w-`) |
| `TRAINING_CARD_BORDER` | `border border-[rgba(13,148,136,0.08)]` |
| `REST_CARD_BORDER` | `border border-dashed border-[rgba(13,148,136,0.10)]` |

To turn a mono label to normal case (e.g. a meta line), append `normal-case tracking-normal`. Compose overrides through `cn()` AFTER the token argument (tailwind-merge lets call-site size/colour win).

---

## Reusable components index

**Import these before writing new class strings.** They already encode the specs above.

| Pattern | Import from |
|---------|-------------|
| Dark KPI / stat band | `@/components/programs/shared/stat-band` → `<StatBand cells={…} />` |
| Segmented pill toggle | `@/components/programs/shared/segmented-control` → `<SegmentedControl />` (`fullWidth` opt) |
| Uppercase section-label + hairline (+ meta/actions) | `@/components/programs/shared/section-label` → `<SectionLabel />` — the `actions` slot may host a full control cluster of icon actions; the builder's Schedule rail is the reference. Icon-action order is stable across modes: commit (Save) leftmost, destructive (Trash) ALWAYS rightmost. A label-less variant (bare hairline + right-aligned mono cluster) is hand-rolled with the same tokens — the training calendar's toolbar is the reference. Its left cluster is label-slot furniture and reads uppercase like every other divider: month label = `MONO_LABEL_CLASS` + `text-[11px]` (number-bearing date), the Today jump = `LABEL_CLASS` + `text-[11px]` + teal hover (word-only, interactive — same pattern as the drop-set editor's "Add drop"); the right-side meta ("6 sessions") stays normal-case mono like every divider meta. **Rail dropdown** (a value-picker mounted on a rail): a **sentence-case** trigger showing the current value + `ChevronDown h-3.5` at `text-[11px] font-medium text-[#93b0b4]` (`px-2 py-1`, teal hover + `data-[state=open]` wash), opening the styled `DropdownMenu` (`align="end" sideOffset={6}`, teal `Check` on the selected item; no `aria-label` — the trigger's accessible name IS its value). Sentence case is deliberate: it preserves mixed casing (e1RM, PRs) and separates the dropdown from uppercase text-action options. **No rail instance currently ships**: the former reference (the Exercise Data metric picker) moved into its hero as an on-dark **lens row** — sentence-case `text-[11px] font-medium` options, `rounded-[4px] px-2 py-1`, active `bg-[rgba(13,148,136,0.15)] text-[#0d9488]`, inactive `text-[rgba(255,255,255,0.45)] hover:text-white`, under a `rgba(255,255,255,0.06)` hairline (`exercise-search-select.tsx`); the Metrics hero's title switcher (eyebrow+title cluster as `DropdownMenu` trigger, `metric-switcher.tsx`) is the hero-scale kin. Passive words on a rail stay normal-case muted sans (`text-[11px] text-[#93b0b4]`) — rail uppercase is reserved for interactive options, so clickable and furniture never share a register |
| "Showing X of Y" pager on a divider rail | `@/components/programs/shared/divider-pager` → `<DividerPager page total pageSize noun onPageChange />` — pass it as `SectionLabel`'s `actions`. Renders the mono count meta (`text-[11px]` + `MONO_META_CLASS`) + `p-1` rail chevrons (`h-3.5 w-3.5`, disabled `#d5e0dd`); returns null at `total === 0` (the table body owns the empty message) and renders disabled-not-hidden on a single page (no pop-in). The four history tables (training/nutrition/wellness/body-metrics) are the reference. Rail pager for history tables; `LibraryTableShell`'s card-footer pager stays for library tables |
| White table card + "Showing X of Y" pager | `@/components/programs/shared/library-table-shell` → `<LibraryTableShell />` (`LIBRARY_PAGE_SIZE = 25`) |
| Hover-revealed row action cluster | `@/components/programs/shared/row-actions` → `<RowActions actions={…} />` (row needs `group/row`) |
| Search input (icon + field) | `@/components/programs/shared/library-search-input` → `<LibrarySearchInput size="toolbar" \| "panel" />` — the ONLY search field |
| Toolbar sort select | `@/components/programs/shared/library-sort-select` → `<LibrarySortSelect options value onChange />` |
| Relative "updated" formatting | `@/components/programs/shared/format-relative` → `formatRelativeUpdated()` |
| Per-item on/off toggle | `@/components/ui/switch` → `<Switch checked onCheckedChange aria-label />` — see "Switch" |
| Slider, single or two-thumb | `@/components/ui/slider` → `<Slider thumbLabels trackContent />` — the `h-1.5` rounded track in the `0.08` tint with a teal range, a 16px white thumb on a teal hairline with `FOCUS_RING`. `thumbLabels` names each thumb (a two-thumb pair otherwise reads "Minimum" / "Maximum", wrong for boundaries); `trackContent` replaces the range fill with a track that is itself the information. The macro balancer (`components/clients/nutrition/macro-balance.tsx`) is the reference |
| Dialog / Sheet / Popover / Button / Badge / Input / Select / Table | `@/components/ui/*` (already Teal-Summit-styled — see Overlays) |
| Toast | `import { toast } from "sonner"` → `toast.success(title, { description })` / `toast.error(…)` / plain `toast(title)`. The one toaster is `@/components/ui/sonner` → `<Toaster />`, mounted by `app/layout.tsx` alone — see Toasts |

---

## Recipe: building a new page from scratch

A standard section page (library-style) is:

```tsx
// layout.tsx — wrap in the section shell; the shell mounts its own 52px icon strip
<div className="flex min-h-screen bg-background">
  <CollapsedIconStrip />
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

Reference: `components/programs/programs-shell.tsx`, `programs-topbar.tsx`, `app/(coach)/dashboard/programs/page.tsx`.

---

## Buttons

| Variant | Recipe |
|---------|--------|
| Primary (teal fill) | `inline-flex items-center gap-1.5 rounded-[6px] bg-[#0d9488] px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-[#0b7f75]` — or `<Button className="bg-[#0d9488] text-white hover:bg-[#0b7f75]">` |
| **Rail save (DEFAULT commit)** | `rounded p-1 text-[#0d9488] transition-colors hover:text-[#0b7f75] disabled:opacity-50` with `Save h-3.5 w-3.5 strokeWidth={1.5}` (swap to `Loader2 … animate-spin` while saving) + `aria-label`/`title` naming the action. **This icon IS the save button for a persistent editor surface**: whenever a surface's primary commit lives on its `SectionLabel` divider rail (library builder "Save program", the plan editor's "Save changes to plan"), render THIS — never a filled text button on the rail. Filled teal primaries stay where they belong: dialog/sheet footers, forms, heroes, empty-state CTAs. Rail order rule: commit (Save) leftmost, destructive (Trash/Ban) always rightmost. |
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

One owner per overlay, and an overlay whose content derives from the address closes instantly (CONVENTIONS §7 → "No frame disagrees"): the Training tab's apply tray and its two full-screen editors are addresses, and the editors, being the program builder, do not animate in either direction; a dialog or sheet is local state, and one about a record keeps the record through its close (`useDialogSubject`), so its exit shows what it showed.

### When to use which

| Surface | Use for | Width |
|---------|---------|-------|
| **Dialog** | Short confirm or small create form (name + a few fields); a readout of a record (the logged workout) | `sm:max-w-md` (compact) → `sm:max-w-lg` (default) → `sm:max-w-xl` (rich, e.g. duplicate-week) → `sm:max-w-[780px]` (a readout as wide as the tray, e.g. the target-over-actual table) |
| **Sheet** (right) | Editing a rich object in place (session editor) | `sm:w-[780px] sm:max-w-full` |
| **Slide-over** (right Sheet) | Creating a rich object (new session) | `sm:w-[780px] sm:max-w-full` |
| **Popover** | Quick pick / attach (choose a session to place) | `w-[320px]` |

### Dialog

Base `DialogContent` is already Teal-Summit: `bg-white rounded-[6px] p-6 gap-4 shadow-[0_10px_40px_rgba(13,148,136,0.10)] sm:max-w-lg` — **no edge border**, like the Sheet: the shadow separates the card from the overlay, and the 8%-teal hairline composited over white reads as a white ring around a dark hero pressed to the edge (the per-day nutrition editor); **centred by auto margins** (`inset-0 m-auto h-fit`), never a transform — `translate(-50%, -50%)` lands the card on a half-pixel whenever its height is odd, and that row shows the card's white through a dark hero as a hairline; overlay `bg-black/40`; title `text-lg font-semibold tracking-tight text-[#0c1a1e]` (18px); description `text-[#5a7d82] text-sm`; close X `absolute top-4 right-4 text-[#93b0b4] hover:text-[#5a7d82]`. Body rhythm `space-y-4 py-1`; field group `space-y-1.5` with a `<Label>`; footer `<DialogFooter>` right-aligns Cancel (ghost) + primary CTA.

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

### Dropdown menu (kebab / row actions)

The base `DropdownMenuContent`/`Item` primitives (`components/ui/dropdown-menu.tsx`) are Teal-Summit — and since 2026-08-22 so is `components/ui/select.tsx`, which had been the un-migrated twin of this exact pattern: content `bg-white rounded-[6px] border border-[rgba(13,148,136,0.08)] p-1 shadow-[0_10px_40px_rgba(13,148,136,0.10)]`; items `rounded-[4px] px-2.5 py-1.5 text-[13px]` with hover/focus `bg-[rgba(13,148,136,0.05)] text-[#0a5c55]` and muted `#93b0b4` icons (`h-3.5 w-3.5 strokeWidth={1.5}`); separator = the `0.06` hairline. Destructive rows use `variant="destructive"` (`#c06060` text + `rgba(192,96,96,0.08)` wash — never a filled red) and sit LAST, grouped behind a separator. Typical width `w-52`.

**No single menu currently demonstrates the whole pattern.** The training calendar's week-actions menu (`calendar-week-rail.tsx`) was the reference until its three non-destructive items were removed on 2026-07-27; with one item left it stopped being a menu at all and is now a bare destructive rail icon (see Buttons → "Icon action (in a rail)"). **A kebab holding one action is the wrong affordance** — two clicks to reach one thing; drop to a bare icon and let the confirm dialog carry the safety. For the multi-item shape see `nutrition-calendar-week-rail.tsx`; for a menu mixing a normal and a destructive row see the calendar event card (`calendar-event-card.tsx`), which currently hand-rolls `className="text-[#c06060] focus:text-[#c06060]"` instead of `variant="destructive"` and carries no separator — a deviation to fix when that file is next touched, not a pattern to copy.

### Popover (320px pattern)

`<PopoverContent align="start" sideOffset={6} className="w-[320px] rounded-[6px] border-[rgba(13,148,136,0.08)] p-0">` — header `px-3.5 pb-2 pt-3` (title `text-sm font-semibold` + `MONO_LABEL_CLASS` subtitle + close X), scroll body `max-h-[260px] overflow-y-auto px-1.5 pb-1.5`, footer `border-t border-[rgba(13,148,136,0.06)] p-1.5` with a teal-text action.

### Date picker popover (a date changed from an icon)

Reference: `components/clients/training/plan-hero-line.tsx` + `start-date-calendar.tsx` — the pencil beside the Plans hero's "Starts <date>". A date changed from an icon, with no field to type in, opens a month calendar in a `Popover`; a date FIELD keeps its native input and `min`/`max` (see "Date inputs express their bounds natively").

- **Trigger:** a `Pencil h-3 w-3 strokeWidth={1.5}` in a `grid h-4 w-4 place-items-center rounded-[4px]` button in the line's own muted colour (on a dark hero `text-[rgba(255,255,255,0.45)] hover:text-white`), `FOCUS_RING`, and an `aria-label` naming the act ("Change start date"). The line's icons sit together after the datum in one `ml-1.5 flex items-center gap-1` cluster; a bin for the same record follows the pencil in the same button, `Trash2` with the destructive hover `hover:text-[#c06060]` and an `aria-label` of its verb ("Remove Strength").
- **Card:** `<PopoverContent align="start" sideOffset={6} className="w-auto rounded-[6px] border-[rgba(13,148,136,0.08)] bg-white p-3">`, the calendar `w-[252px]`.
- **Header:** the month in `MONO_LABEL_CLASS text-[11px]` ("SEP 2026") on the left; previous/next `ChevronLeft`/`ChevronRight h-3.5 w-3.5 strokeWidth={1.5}` in `rounded p-1 text-[#93b0b4] hover:text-[#0d9488]`, disabled `text-[#d5e0dd]`. Previous is disabled on the month holding the earliest allowed day, since every month before it would be greyed.
- **Grid:** `grid grid-cols-7 gap-1`, Monday first like the coach calendar; weekday initials in `LABEL_CLASS` `h-6` cells; always six weeks (`monthPage`, `lib/month-grid.ts`), blank cells outside the month, so paging never changes the card's height.
- **Day:** `MONO text-[12px] grid h-8 w-8 place-items-center rounded-[4px]` + `FOCUS_RING`. Resting `text-[#0c1a1e] hover:bg-[rgba(13,148,136,0.08)] hover:text-[#0a5c55]`; the current value `bg-[#0d9488] font-semibold text-white hover:bg-[#0b7f75]`; today `ring-1 ring-inset ring-[#0d9488]`; a day outside the bound is `disabled` with `cursor-not-allowed text-[#d5e0dd]` — greyed and unclickable, the promise a native `min` makes.
- **Behaviour:** a pick closes the popover and opens a confirm in the same click; picking the current value closes it and asks nothing. The confirm is the plan editor's (`move-plan-dialog.tsx`, `plan-edit-dialogs.tsx`): a `bg-[rgba(13,148,136,0.08)]` thumb with `CalendarClock`, the title naming the thing ("Move Upper Lower?"), one sans sentence saying what happens, then Cancel (ghost) and the teal primary. The primary carries the work's pending state (`Loader2`) and the dialog refuses to close until the work and its refresh are done, so it fades out onto the settled screen. Popover and confirm both render from a subject captured at open (`useDialogSubject`) and are keyed by `openKey`, so each exit shows what it showed and each open starts fresh.

### Destructive confirm dialog

Reference: `components/clients/training/calendar/delete-event-dialog.tsx`. Use the styled `Dialog` primitive (never `ConfirmDialog`/AlertDialog — un-migrated OKLCH).

- Header row: danger thumb `grid h-9 w-9 shrink-0 place-items-center rounded-[6px] bg-[rgba(192,96,96,0.08)]` + `Trash2 h-4 w-4 text-[#c06060]` (strokeWidth 1.5) beside the `DialogTitle`.
- Body: ONE plain-sans sentence (`text-sm text-[#5a7d82]`) naming exactly what happens ("Removes the upcoming scheduled sessions from the week of Jul 14."). Scope the verb precisely ("upcoming") rather than appending obvious reassurances — "Completed and past sessions are kept" is retired as filler (owner call, 2026-07-24); spell out what survives only when it is genuinely surprising (e.g. the delete-ALL-plans confirm). No mono. The subject may be `font-semibold text-[#0c1a1e]`.
**Non-delete variant.** The same recipe covers a confirm that is not a deletion but is still unrecoverable and consequential — the reference is `overview/confirm-start-edit-dialog.tsx`, correcting a client's recorded START weight, which overwrites a fact no later measurement can recover and re-bases every progress figure derived from it. **Change the glyph, nothing else:** `AlertTriangle` in the same danger thumb, since nothing is being removed. Danger palette, danger-outline CTA and the one-sentence body all stay — the register is "you cannot undo this", not "this deletes a row".

- Footer: Cancel (`variant="ghost"`) + danger-outline CTA: `variant="outline"` + `border-[rgba(192,96,96,0.3)] text-[#c06060] hover:bg-[rgba(192,96,96,0.08)] hover:text-[#c06060]`, `Loader2` spinner while pending. **There is no filled destructive button in this system — never invent one.** CTA label repeats the verb ("Remove session", "Clear week"), never "OK"/"Confirm".

### Toasts

**Exactly one toaster, mounted by the root layout** — `components/ui/sonner.tsx`, the app's `Toaster` over Sonner's, in `app/layout.tsx`. A call site does `import { toast } from "sonner"` and calls it directly; there is no hook, no wrapper and never a second toaster or a bespoke notification surface.

- Success: `toast.success("Session saved")` — a consequence, when there is one, as `{ description }`.
- Failure: `toast.error("Save failed", { description: reason })` — the reason as the description, in plain words.
- A confirmation with no verdict (`Nothing to clear`): plain `toast("Nothing to clear")` — no icon.
- Title: a short sans fragment stating the outcome — `Session saved`, `Week cleared`, `"{name}" updated`. Quote user-named things with `"…"`.
- Description (optional): one plain sans sentence of consequence — `Programs that already use a copy of this session are unchanged.`
- Never: markup, mono spans, raw error strings, IDs, or dates set in mono. Toast text obeys the prose rule above in full.

**The card** (Sonner's own look is switched off; `richColors` stays off): white, `rounded-[6px]`, `p-4`, `shadow-[0_6px_20px_rgba(13,148,136,0.10)]`, a border tinted by type — `rgba(13,148,136,0.08)` plain, `rgba(13,148,136,0.20)` success, `rgba(185,28,28,0.20)` error, `rgba(245,158,11,0.20)` warning. Title `text-sm font-semibold text-[#0c1a1e]`; description `text-sm` at 90% ink. Sonner's own success and error glyphs stay, tinted `#0d9488` / `#c06060` (`#d97706` warning). An always-visible close X in the icon-action grammar — `text-[#93b0b4] hover:text-[#5a7d82]`, `FOCUS_RING`, a Lucide `X` at `h-4 w-4`. Bottom-right, 5 s, hovering holds it. The look lives in the primitive alone — never restyle a toast at a call site.

**A toast is never an outside click.** The toaster sits above every overlay and a toast keeps its pointer events under a modal, so it can be hovered and closed over an open drawer — and the `Dialog` and `Sheet` primitives ignore a pointer-down or interaction whose target is inside the toaster (`lib/toast-interaction.ts`), so closing the toast leaves the drawer open.

---

## Loading & async states

Every asynchronous surface distinguishes four states — **loading**, **resolved
with content**, **resolved empty**, **error** — and only the states that need
user-facing treatment get one. Resolved-with-content has no treatment: the
content is the treatment, and nothing ever announces success.

**Unresolved or failed is never rendered as empty.** An empty state is a
statement about the data ("No check-ins yet"), so it may only render from a
fetch that settled with an empty result. Reaching it while a read is in
flight, or after one failed, announces an all-clear nobody earned — a failed
read renders the error treatment, always.

**A known surface renders immediately; its values arrive as pending.** When a
surface's existence is decided by something already in hand — the route, the
record, a prop — it mounts at once and shows unresolved values as pending
slots: never `return null`, never a guessed value. Structural chrome never
waits on data it does not read. The code-side rule is `CONVENTIONS.md` §7 →
"Gate content, not structure"; worked examples: the activation banner
(existence is `onboardingStatus`, readiness renders as pending inside it), the
roster frame (`view={null}`), the Programs stat band (muted `—` values).

### Which treatment

| Surface | Treatment |
|---|---|
| A page or tab you navigated to | Spinner + a **visible** label naming what is loading: `Loader2 h-6 w-6 animate-spin text-[#93b0b4]` centred in `py-24`, label beneath in `text-[13px] text-[#93b0b4]`, copy `Loading {thing}…`. Never `sr-only` — a bare spinner says something is happening but not what. Implemented once: `components/page-loading.tsx` (`<PageLoading label="Loading clients…" />`) — use it, don't re-spell it |
| A layout whose geometry is known | Skeletons at the real dimensions (Journey's hero and cards, `HistoryTable`'s rows, the Check-ins list's card skeletons), so nothing moves when data lands. No label — the shape is the message |
| A value slot inside a loaded surface | A `Skeleton` holding the exact slot the value will occupy (the activation banner's counter and state chips). For pending TEXT — the dark bands' values and sublines — render `components/text-skeleton.tsx` INSIDE the real text element: the element's own font strut then fixes the line box, so pending and loaded are the same size by construction, never by a hand-measured slot |
| A control mid-action (button, row, toggle) | Inline spinner at the control's own size, no label — the control already has one |

### Errors

Every fetch-backed surface has an error branch: a plain statement of what
failed ("Could not load your programs"), a muted hint, and — wherever the
surface holds a refresh handler — a retry. An error never falls through to
the empty state's copy or its call-to-action.

## Chapter: Programs (Library) page

Reference: `app/(coach)/dashboard/programs/page.tsx`, `components/programs/programs-table.tsx`, `programs-stat-band.tsx`, `components/programs/shared/**`.

### Stat band

`<StatBand cells={cells} />` renders `bg-[#0f2027] rounded-[6px] p-5 grid animate-card-in` (2–4 cols by cell count). Each cell: `flex flex-col pl-5 pr-5`, right divider `border-r border-[rgba(255,255,255,0.07)]` (except last). Label = `STAT_LABEL_DARK_CLASS`; value = `STAT_VALUE_DARK_CLASS` + `text-[24px] leading-tight` (muted fallback `text-[13px] text-[rgba(255,255,255,0.3)]`); unit `text-[10px] text-[rgba(255,255,255,0.3)]`; sub = `MONO` + `text-[10px] mt-1` (tones: neutral `rgba(255,255,255,0.3)`, warn `#d97706`, up `#0d9488`).

### Toolbar

`mb-4 flex flex-wrap items-center gap-3`:
- `<LibrarySearchInput>` — wrapper relative; `Search` icon `absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#93b0b4]`; input `h-9 w-[260px] pl-9 text-sm`.
- `<SegmentedControl>` — All / Custom / AI generated.
- `<div className="flex-1" />` spacer (pushes sort right).
- Sort `<Select>` — trigger `h-9 w-[180px] text-[13px]`.

### Section-label divider

`<SectionLabel label="Program library" actions={<button …>+</button>} />` → label = `SECTION_LABEL_CLASS` (`text-[10.5px] font-semibold uppercase tracking-[0.07em] text-[#93b0b4]`) + `h-px flex-1 bg-[rgba(13,148,136,0.08)]` rule + optional mono meta (`MONO_META_CLASS` + `text-[11px]`) + actions. Action "+" button: `rounded p-1 text-[#93b0b4] transition-colors hover:text-[#0d9488]` with `Plus h-3.5 w-3.5 strokeWidth={1.5}`.

### Table

`<LibraryTableShell>` = `overflow-hidden rounded-[6px] border border-[rgba(13,148,136,0.08)] bg-white` wrapping `<Table>` + footer (`border-t border-[rgba(13,148,136,0.06)] px-5 py-2.5`; count `font-mono-display text-[11px] text-[#93b0b4]`; pager buttons `h-7 w-7 rounded-[6px]`, enabled `text-[#93b0b4] hover:bg-[#f0f5f4] hover:text-[#5a7d82]`, disabled `text-[#d5e0dd]`).

Rows (`group/row cursor-pointer`, first cell `pl-5`):
- Name: `text-[13.5px] font-semibold text-[#0c1a1e]`; optional Draft badge; description `mt-0.5 max-w-[380px] truncate text-xs text-[#93b0b4]`.
- Focus: neutral chip `bg-[#f0f5f4] text-[11px] font-medium text-[#5a7d82] border-transparent`, else `text-[#93b0b4]` dash.
- Numeric cells: `font-mono-display text-[12.5px]` — primary `text-[#5a7d82]`, meta `text-[#93b0b4]`.
- Actions: `<RowActions>` (hover-revealed, `h-7 w-7` buttons, `h-[15px] w-[15px]` icons; danger hover `bg-[rgba(192,96,96,0.08)] text-[#c06060]`).

**Table rows and headings are inherited, never restyled — HARD RULE.** `components/ui/table.tsx` owns them, and the habits tracker is the shape they were taken from:

| Part | Treatment |
|---|---|
| Row divider | `border-b border-[rgba(13,148,136,0.06)]` — the inner-hairline rung: separation without a rule |
| Header row | `border-b border-[rgba(13,148,136,0.08)]` |
| Column heading | `LABEL_CLASS` + `h-10 px-2` (10px / 0.06em / `#93b0b4`) |
| Row hover | `bg-[rgba(13,148,136,0.03)]` |
| `TableCell` | `p-2` |

A heading holding something that is not a label — the habits day columns hold a mixed-case `Mon` — appends `normal-case tracking-normal`. Nothing else overrides these at a call site.

### Empty state

`py-12 text-center text-[#5a7d82]` with a large muted icon (`h-8 w-8 opacity-50 strokeWidth={1.5}`), a `text-sm` line, a `text-xs text-[#93b0b4]` hint, and a primary "New" button.

### Create-program dialog

`<DialogContent className="sm:max-w-md">`; body `space-y-4 py-1`; each field `space-y-1.5` (`<Label>` + `<Input>`/`<Textarea>`); footer Cancel (ghost) + `Create program` (`bg-[#0d9488] text-white hover:bg-[#0b7f75]`, spinner `Loader2 mr-1.5 h-4 w-4 animate-spin`).

---

## Chapter: Program Builder page

Reference: `components/clients/training/program-builder/**`. The builder is **full-bleed** — `ProgramsTopbar` returns null for the builder view, because the library panel runs the full viewport height and a shell-level strip above it would push the panel off screen. The builder renders its **own** title band *inside* the main column instead, right of the panel: the same relationship the client detail pages have between their sidebar and their title band.

### Frame & layout

- Root cancels the shell padding and goes full height: `-mx-8 -mt-5 -mb-[60px] flex h-screen flex-col`.
- Inner row `flex min-h-0 flex-1`: left **library panel** + main column.
- Main column: `flex min-h-0 min-w-0 flex-1 flex-col` → the page-header band, then the content box `flex min-h-0 min-w-0 flex-1 flex-col px-6 pt-5`.
- Loading: centered `Loader2 h-6 w-6 animate-spin text-[#93b0b4]` in `py-24`.

### Page-header band (library target only)

The client-detail title band, with `px-6` tracking the main column's own padding the way the client version tracks its `px-8` main: `shrink-0 bg-white px-6 py-2` wrapping `flex items-center justify-between` → `<h1 className="text-[15px] font-bold text-[#0c1a1e]">Program Builder</h1>` + `<NotificationsDropdown compact />`. **Deliberately NOT `sticky top-0`** (the one deviation from the client-detail band): nothing scrolls under it — the grid owns its own scroller — and Chrome insets a sticky element's constraint rect by the scroll container's padding, so inside the shell's `py-5` main a `sticky top-0` clamps the band 20px down, re-introducing the exact offset the root's `-mt-5` exists to cancel. CDP-measured: `top: 20` sticky vs `top: 0` static, against the panel's `top: 0`. The client-scoped overlays (`client-draft`, `placed-plan`) render **no band** — they are overlays, not pages, and the panel already names the client while the hero names the program.

### Library panel (left)

`sticky top-0 flex h-screen w-[296px] shrink-0 flex-col border-r border-[rgba(13,148,136,0.08)] bg-white`. Header `px-[18px] pt-[18px]`, then `mb-3.5 flex items-center gap-2.5` — the **same back-row grammar as the client-profile sidebar** (`components/clients/client-sidebar.tsx`), which is the reference for every sidebar header: `ArrowLeft h-4 w-4 text-[#93b0b4]` → `group-hover:text-[#5a7d82]`, label `text-[13.5px] font-semibold text-[#0c1a1e]`. Two shapes:

- **Library** — arrow + `All programs` are one `<Link href="/dashboard/programs">` (it names a destination). A plain click is intercepted and routed through the builder's guarded exit, which leaves the page — back to the entry before the builder — when a coach page precedes it, and to `/dashboard/programs` when none does; modified clicks (new tab/window) are left to the browser so the href stays meaningful.
- **Client-scoped** (`client-draft` / `placed-plan`) — only the arrow is interactive (an icon-only `<button>` carrying the `aria-label`); beside it an `Editing for` eyebrow (`LABEL_CLASS`) over the client's name. A client is context, not a destination — exactly like the client-profile sidebar, where the arrow links out and the name is plain text.

Then `<SegmentedControl fullWidth>` Sessions/Exercises.

**The panel's arrow is the builder's single exit on every target** (the hero carries none), so it is also the only control wired to the unsaved-changes confirm — never add a second back affordance.

Library cards (session & exercise): `group/row flex items-center gap-2 rounded-[6px] bg-white p-2 pl-1.5` + `TRAINING_CARD_BORDER`; hover `-translate-y-px shadow-[0_6px_20px_rgba(13,148,136,0.08)]`; dragging `opacity-40`. Grip `GripVertical h-3.5 w-3.5` (`cursor-grab`); thumb `THUMB_CLASS h-[30px] w-[30px]` + `Dumbbell h-[15px] w-[15px]`; name `truncate text-xs font-semibold text-[#0c1a1e]`; meta `mt-0.5 MONO_LABEL_CLASS normal-case tracking-normal`; focus chip `CHIP_NEUTRAL_CLASS`; `<RowActions>`.

List area `min-h-0 flex-1 space-y-2 overflow-y-auto px-[14px] pb-2`; search `h-8 pl-8 text-xs` + `FOCUS_RING` (icon `left-2.5 h-3.5 w-3.5 text-[#93b0b4]`); drag hint `px-[18px] pb-1.5 MONO_LABEL_CLASS`. Footer `border-t border-[rgba(13,148,136,0.08)] px-[18px] py-3` with a dashed "New session/exercise" button (`h-8` dashed-`0.25` recipe above).

### Dark hero header (`program-top-bar`)

`mb-4 flex items-center gap-4 overflow-hidden rounded-[6px] bg-[#0f2027] px-5 py-3`. **No back control** — the library panel's header arrow is the builder's single exit (see Library panel above). Eyebrow `HEADER_EYEBROW_CLASS` ("Program") + optional draft badge. Name (view) `text-[17px] font-semibold leading-tight tracking-[-0.01em] text-white` (edit: transparent borderless `Input` + `FOCUS_RING`). Stat row (`md:flex`, hidden below) `font-mono-display text-[11px] text-[rgba(255,255,255,0.4)]`, bold segments `text-[rgba(255,255,255,0.92)] font-medium`, dot separators `h-[3px] w-[3px] rounded-full bg-[rgba(255,255,255,0.2)]`. Surplus pill `ml-auto rounded-[6px] border border-[rgba(255,255,255,0.14)] px-2.5 py-1` (label `font-mono-display text-[10px] uppercase tracking-[0.08em]`, borderless mono input, `%` suffix).

### Schedule divider + action rail

`<SectionLabel>` ("Schedule") with an action cluster `flex items-center gap-3`: Edit (`Pencil`), Delete (`Trash2`, hover `#c06060`), Discard (`Ban`, hover `#c06060`), Save (`Save`, `text-[#0d9488] hover:text-[#0b7f75]`, `Loader2` while saving). All `rounded p-1`, icons `h-3.5 w-3.5 strokeWidth={1.5}`. The Save icon here is the system's **default commit affordance** for every editor surface mounted under a divider rail (see Buttons → "Rail save") — the plan editor's "Save changes to plan" uses the same icon in the same slot, not a filled button.

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
  - Exercise list `mt-1.5 space-y-[3px]` (first 3): index `w-2 font-mono-display text-[9.5px] text-[#c2d0cc]`, name `text-[11px] text-[#5a7d82]`, sets×reps `font-mono-display text-[10px] text-[#93b0b4]`; "+N more" `font-mono-display text-[10px] text-[#c2d0cc]`. A linked group's lines sit on its rail, indented: `space-y-[3px] border-l-2 border-[rgba(13,148,136,0.15)] pl-1.5`; the numbers run straight on, and a superset or circuit exercise reads its rounds, `3×8-10`, or `21-15-9` when rounds differ.
  - Footer `mt-auto border-t border-[rgba(13,148,136,0.06)] pt-1.5` — duration & focus `font-mono-display text-[10px] text-[#93b0b4]`.
- **A day's sessions stack in the cell**, one session card per session in the day's order: the cell is `flex h-full flex-col gap-2` (the 8px stacked-card rhythm) and each card `flex-auto`, so a day holding one fills the cell as it always has and a day holding several reaches the row's bottom edge together. Each card is exactly the card above — its own header, list and footer (`day-session-card.tsx`) — and acts on its own session: a click opens it, its grip drags it, and its X (aria "Remove session") removes that session alone; the day turns rest when the last one goes. Today's ring and the lock marker are drawn on every card. The cell, not a card, is the drop target.
- **Adding to a day that holds sessions:** the card's hover cluster leads with a `Plus h-3 w-3` (`rounded p-1 hover:bg-[rgba(13,148,136,0.08)] hover:text-[#0d9488]`, aria and title "Add session to this day") before the X and the grip, on every card of an editable day with room (none collapsed, in view mode, locked or on a full day). It opens the add-session popover and the session added joins the day, last. The popover's copy is the rest cell's.
- **Dragging a session:** onto another day it joins that day, last, and every card of that day (or the rest cell) takes the drag-over border. Over its own day nothing is lit, from the drag's first frame (the day is the drag's own from its start, `DayReorder`, not from the pointer's first move): a `DropLine` (the session editor's line, `drop-line.tsx`) marks where it will land between the day's cards — `first-item-top` inside the first card's top edge, `item-top` in the 8px gap above any other card, `item-bottom` in the gap below the last — and a place that would change nothing draws none. Nothing slides; the dragged card stays in place at `opacity-40` while the copy follows the pointer in a `DragOverlay` portaled to `<body>` and mounted only while the drag lasts, so the drop, the line and the copy change in one render.

### Exercise card (in the session editor)

`rounded-[6px] bg-white` + `TRAINING_CARD_BORDER`. Header `flex items-center gap-2 p-2`: grip; ordinal circle `grid h-6 w-6 place-items-center rounded-full bg-[rgba(13,148,136,0.08)] font-mono-display text-[11px] font-semibold text-[#0a5c55]`; thumb `THUMB_CLASS h-7 w-7` + `Dumbbell h-3.5 w-3.5`; name `text-[13px] font-semibold text-[#0c1a1e]`; "Notes" teal chip; `Video h-3 w-3`; compact summary `font-mono-display text-[11px] text-[#5a7d82]`; remove `Trash2 h-3 w-3 text-destructive hover:bg-red-50`; expand chevron. Expanded body `space-y-1 border-t border-[rgba(13,148,136,0.08)] p-2` with the set grid; exercise-level fields (video URL, coach note) under another `border-t` with `LABEL_CLASS` labels and `h-7`/`min-h-14` inputs + `FOCUS_RING`. In a linked group, and while picking exercises to link, see "Grouped exercises (editor)".

### Set-row & drop-set editors

- Set grid: `grid items-center gap-1.5` (`SET_GRID_BASE`) over a template built from the exercise's columns (`setGridTemplate`, `set-row-editor.tsx`): the number column `20px` (`44px` where the rows are rounds), then one track per chosen column in the builder's order — Type, Reps, Load, RPE, RIR, Tempo, Distance, Duration, Pace, Split, Calories, Cadence, Stroke rate, Resistance, HR zone, Target HR, Power, % FTP, Rest s — each `minmax(<floor>px,<share>fr)` (Load `minmax(150px,1.7fr)` for its select and box, a plain number `minmax(48px,0.7fr)`, a split `minmax(104px,1.1fr)`), then the `48px` action column. The header row uses `LABEL_CLASS`. **When the columns don't fit the card, the grid scrolls sideways** inside a `-mx-0.5 overflow-x-auto px-0.5` wrapper with the number cell pinned (`PINNED_CELL_CLASS`: `sticky left-0 z-[1] bg-white`) — the same rule as the client grid and the coach's readout.
- All set inputs/selects `h-7 … font-mono-display text-[11px]` + `FOCUS_RING`, numerics centered; working-set select adds `border-[rgba(13,148,136,0.2)] bg-[rgba(13,148,136,0.05)] font-medium text-[#0a5c55]`. Row action buttons `rounded p-1 hover:bg-[rgba(13,148,136,0.08)] text-[#93b0b4]` (`h-3 w-3` icons).
- Drop-set sub-editor: `ml-8 mt-1 space-y-1 border-l border-dashed border-[rgba(13,148,136,0.15)] pl-3`; inputs `h-6 … font-mono-display text-[11px]`; "Add drop" uses `LABEL_CLASS hover:text-[#0d9488]`.
- **Range boxes.** Every numeric column is ONE text box taking a value or a range typed with a hyphen (en and em dashes are accepted, the box shows a hyphen). Reps, RPE, RIR and the plain-number measures speak the range grammar — "8-12", "7-8" (`utils/target-range.ts`); a distance, duration, pace, split or HR zone speaks the entry grammar at each end (`MeasureRangeInput`, `measure-range-input.tsx`; `parseEntryRange` / `formatEntryRange` over `parseEntry` / `formatEntry`), typed and read in the viewer's units — "400-800 m", "5-6" (km, or miles for an imperial coach), "2:00-2:30", "3:45-3:50 /km" or "7:39 /mi", "1:52.3-1:55 /500m", "Z2-Z3" — a unit written once on the right end reading for both, and stored canonically. The placeholder is the viewer's unit or the measure's word (`km` / `mi`, `mm:ss`, `/km` / `/mi`, `/500m`, `kcal`, `rpm`, `spm`, `bpm`, `W`, `%`). Every box seeds from the stored pair, selects all on focus, commits on blur behind the seeded-string guard (a focus-through writes nothing), reverts a typo to what was there, and clamps each end to the column's bounds — a typed RPE 0 becomes 1, a zone 7 becomes 5. Tempo is one compound box, `3-1-X-0` (a lower-case x reads as X; an emptied box clears it). The load box (`LoadRangeInput`, `w-20`) carries the viewer's unit or `%` as its placeholder and stays disabled until a load type is chosen; a drop's load is still one number (`LoadValueInput`). Readouts never use the hyphen: the client grid's hint and the coach's log table read a range with an en dash — "7–8", "100–105 kg", "70–75% 1RM" (`formatBoxTarget`, over `formatTargetReadout` and `formatPrescribedLoad`).
- **Column selector and presets** (`set-columns-menu.tsx`; `utils/column-presets.ts`). The `Columns3` icon action at the end of the grid's header row (aria "Columns for {exercise}") opens a `DropdownMenuContent` — `align="end" sideOffset={6}`, `w-[460px]`, `max-h-(--radix-dropdown-menu-content-available-height) overflow-y-auto` — headed "Columns" with the muted `text-[11px]` line "What your client sees and fills in". Under a `LABEL_CLASS` "Presets" label (`px-2.5 pb-1 pt-2`), the seven presets as `DropdownMenuCheckboxItem`s in a `grid grid-cols-4` — Strength, Bodyweight, Endurance, Erg, Carry & sled, Holds, Circuit — each with its columns as its `title`; a pick sets the exercise's columns to exactly the preset's, and the preset the columns are on carries the teal tick (`presetOf`, the hidden Rest left out), so a pick is confirmed in the menu itself when the cards are collapsed; none is ticked when the columns match no preset. Then a separator and the columns in a `grid grid-cols-3 gap-x-1`, one `DropdownMenuGroup` per group under its own `LABEL_CLASS` label — **Strength** (Load, Reps, RPE, RIR, Tempo), **Endurance** (Distance … % FTP), **Framework** (Set type, Rest) — each a `DropdownMenuCheckboxItem` with the teal tick. An exercise's last column can't be unticked (disabled, `title` "Keep at least one column"); a tick writes the explicit list in the builder's order; the menu stays open across ticks and presets (`onSelect` prevents default). A column the selector doesn't offer where the exercise sits — Rest in a superset or circuit — keeps its stored choice through every tick and preset. **On a linked group's heading** the same trigger (aria "Columns for the superset") opens the presets alone in a `w-64` menu, one per row, under "A preset sets every exercise in the superset"; a pick sets every exercise in the group, and the preset every exercise is on carries the tick (`groupColumnsPreset`).

### Grouped exercises (readout)

Reference: `components/clients/training/session-log-group.tsx`, the coach's workout log view. The words come from `utils/exercise-group-display.ts`, which the client app shares, so a group reads the same to a coach and a client.

- **A group of one is a plain exercise card** — no heading, no rail. Coaches never see a group around a single exercise.
- **Groups carry no letters, anywhere.** A linked group is known by its format's name: Superset (a looped pair), Circuit (three or more), Straight sets, AMRAP, EMOM, For time.
- **A linked group (two or more exercises)** is `<section aria-label={title} className="flex flex-col gap-2">`:
  - Heading `px-1`: the name `text-[13px] font-semibold text-[#0c1a1e]`, then `·` (`mx-1.5`) and the rounds in `font-normal text-[#5a7d82]`, the count in `MONO`. Under it the rests, `mt-0.5 text-[12px] text-[#5a7d82]`, each duration in `MONO` — "30s rest between exercises · 1m 30s rest between rounds". Then the coach's notes, `mt-0.5 whitespace-pre-wrap text-[12px] text-[#93b0b4]`.
  - Its cards on one rail: `flex flex-col gap-[10px] border-l-2 border-[rgba(13,148,136,0.15)] pl-3`.
- **Where a group's rows are rounds** (every format but straight sets) the set table's first column reads **Round**.

### Target over actual (readout)

Reference: `components/clients/training/session-log-set-table.tsx`, inside `session-log-exercise-card.tsx`, in the coach's logged-workout dialog (`session-log-detail-dialog.tsx`, the Training tab's Data pane). The coach reads what they set over what the client did, one column per measure, so a strength exercise is Set, Load, Reps, RPE and a run is Set, Distance, Duration, Pace.

- **The dialog** is the tray's width: `sm:max-w-[780px] max-h-[85vh] grid-rows-[auto_minmax(0,1fr)] gap-0 p-0`. The header (`px-6 pt-6`: the title, the date · quality · focus line, then the `0.08` hairline as its last line) stays put; only the body row scrolls (`min-h-0 overflow-y-auto px-6 pb-6`). Never overflow on the `DialogContent` itself.
- **The card**: `overflow-hidden rounded-[6px]` + the `0.08` border, the exercise's name `text-[14px] font-semibold` in `px-4 pb-2 pt-3`, then the `Table` primitive — rows and headings inherited, never restyled.
- **Columns**: Set, then one per measure in the prescribed columns' order — every column the exercise prescribes and any other a row has a target or a value in (`loggedColumns`), so history never hides a value. Headings are the client grid's (`boxHeader`: "Load (kg)", "Reps", "RPE", "Distance", "Pace", "HR zone" …); Rest appears only when a rest was recorded; where the rows are a superset's rounds the first heading reads Round. There is no Prescribed column.
- **A cell is two `block` lines, left-aligned**: the target in `MONO text-[11px] leading-[14px] text-[#93b0b4]` over the value in `MONO_CELL_CLASS leading-[18px]` ink. The target line always keeps its height — a non-breaking space when the column sets no target — so every value in a row sits on one baseline. The words are the readout grammar's (`formatBoxTarget`, `formatBoxActual`): a target carries its unit ("100–105 kg", "3:45–3:50 /km", "Z3") or reads bare where the heading names it ("8–10", "7–8"); the value is what the client's box read back ("102.5", "5.02 km", "26:10"). Nothing recorded is a `#c2d0cc` dash.
- **Marks are colour on the number, nothing else** — no chip, no icon, no background: outside the target, below or above, the value is warning amber `text-[#d97706]`; an RPE two or more above its target keeps `font-semibold text-[#c06060]`; a % load is never marked; a tempo that differs is amber. A marked value carries its words as a `title` ("Above target") and sr-only. A warm-up's values are `#93b0b4` and never marked.
- **The Set cell** holds the tick — `Check h-3.5 w-3.5` teal, muted on a warm-up, its `w-3.5` slot kept when the set wasn't done, with sr-only "Logged" / "Not done" — then the set number (`MONO_CELL_CLASS text-[#5a7d82]`; a drop's continuation rows show none) and the set type's word tag (`rounded-[4px] px-1.5 text-[10px] font-semibold`: Warm-up in the warning pair, Drop and AMRAP in the teal chip, Failure destructive-soft; a working set is untagged). The heading's word is indented `pl-[22px]` so it sits over the numbers, not the tick. First cell `w-[132px] pl-4`, last cell `pr-4`, lining up with the card's name.
- **Sideways scroll**: when the columns don't fit, the `Table` primitive's own container scrolls (`overflow-x-auto`) inside the card, and the Set cell stays put — `sticky left-0 z-[1] bg-white`, and on the row's hover `group-hover/row:bg-[#f8fcfb]`, the opaque twin of the row's 3% teal wash (the row carries `group/row`), because a pinned cell can't be see-through. The measures slide under it.

### Grouped exercises (editor)

Reference: `components/clients/training/program-builder/session-exercises.tsx`, `exercise-group-block.tsx`, `group-settings-popover.tsx`, `drop-line.tsx` — the session editor, in every surface that hosts it. The heading's words and markup are the readout's (`components/clients/training/group-heading-lines.tsx`), so a group reads the same while a coach builds it and when they review the workout.

- **A lone exercise is the plain Exercise card** — no heading, no rail. The ordinal circles count straight through the session, groups included. No letters.
- **A linked group** is `<section aria-label={title} className="group/grp relative flex flex-col gap-2">`. Heading row `flex items-start gap-2 px-1`: a hover-revealed grip that drags the whole group (`GripVertical h-3.5 w-3.5`, `-ml-0.5 mt-px rounded p-0.5 opacity-0 group-hover/grp:opacity-100`), the readout's heading lines in `min-w-0 flex-1`, then a hover-revealed action cluster (`opacity-0 group-hover/grp:opacity-100`, held open with its popover or menu by `has-[[data-state=open]]:opacity-100`): settings (`SlidersHorizontal`, aria "Superset settings"), Columns (`Columns3`, aria "Columns for the superset" — the presets alone, see "Column selector and presets") and Unlink (`Unlink2`, aria "Unlink superset"), each `rounded p-1 text-[#93b0b4] hover:text-[#0d9488]` + `FOCUS_RING`, icons `h-3.5 w-3.5 strokeWidth={1.5}`. Under it the readout's rail, `flex flex-col gap-[10px] border-l-2 border-[rgba(13,148,136,0.15)] pl-3`. View mode drops the grip and the actions.
- **Link** is an icon action on the Exercises rail, left of the add-exercise `+` in a `gap-3` cluster (`Link2`, the rail icon-action recipe, `disabled:opacity-50` below two exercises). Picking swaps the rail's meta for `N selected` and its actions for two uppercase text actions in `LABEL_CLASS text-[11px]`: Cancel (teal hover) and `Make superset` / `Make circuit` by the count (`font-semibold text-[#0d9488] hover:text-[#0b7f75] disabled:text-[#d5e0dd]`, disabled below two picks). While picking, each card's header row is one `role="checkbox"` button; its grip, remove and chevron give up their places but keep their space, so nothing on the row moves; a picked card carries `ring-1 ring-inset ring-[#0d9488]` and its ordinal circle turns `bg-[#0d9488] text-white` around a `Check h-3.5 w-3.5`.
- **Settings** — the 320px Popover (`align="end" sideOffset={6}`, `p-0`): header `px-3.5 pb-2 pt-3`, the group's name in `text-sm font-semibold` over `N exercises` in `MONO_LABEL_CLASS normal-case tracking-normal`; body `space-y-3 px-3.5 pb-3.5`: a full-width `<SegmentedControl>` (Superset or Circuit by the count / Straight sets), rows `flex items-center justify-between gap-3` of a `LABEL_CLASS` label and a number input `MONO_INPUT_CLASS h-8 w-20 text-xs` + `FOCUS_RING` — Rounds, then Rest between exercises and Rest between rounds, each followed by a muted `text-[11px]` `s` — and Notes, a `LABEL_CLASS` label over a `min-h-14 bg-white px-2 py-1.5 text-xs` Textarea. Rounds and Rest between rounds show only for a superset or circuit. Every field commits on blur, like the rest of the editor; no footer.
- **Rows are rounds** in a superset or circuit: the set grid's first column reads Round and is 44px wide, the client tracker's number column (`#` needs only 20px), in the heading and every row alike; a row has no duplicate or remove (its action cell stays, empty, so the columns align); there is no Add set, no Rest column, and no Rest in the Columns menu — the group's rests are what the client gets. The card's summary reads the reps round by round, `21-15-9 reps`. Rows change only with the group's Rounds.
- **Dragging draws a line; nothing in the list moves.** The dragged card or group stays in its place at `opacity-40`, and a copy follows the pointer: a `DragOverlay` portaled to `<body>` and mounted only while the drag lasts (so the copy goes in the same render the drop lands in), holding the week grid's drag chip — `rounded-[6px] bg-white px-3 py-2 shadow-lg` + `TRAINING_CARD_BORDER` — with the card's top line (the name `text-[13px] font-semibold`, the summary `MONO text-[11px]`) or the group's heading line. The scrolling list therefore never changes height during a drag. A `h-0.5 rounded-[1px] bg-[#0d9488]` line (`pointer-events-none absolute inset-x-0 z-20`) marks where it will land, centred in the gap: `-top-[5px]` / `-bottom-[5px]` between the list's items (their 8px gaps), `-top-[6px]` / `-bottom-[6px]` between a rail's cards (their 10px gaps) — the rail's indent is what tells the coach the exercise joins the group — and `top-0` on the list's first item, where the scroll area would clip a line above it. The list keeps `pb-2` so a line under its last item shows. A drop that would change nothing draws no line.

### Session editor sheet / create slide-over / add-session popover / exercise picker / duplicate-week dialog / progression preview

Follow the **Overlays** recipes: session editor & create-session are 780px right Sheets (fields grid `grid grid-cols-2 … lg:grid-cols-[1fr_1fr_110px_130px] gap-3`, `h-8` inputs); add-session is a 320px Popover (rows hover `bg-[rgba(13,148,136,0.05)]`, "Create blank session" in teal `#0d9488`) that opens level with the control the coach used — a card's Plus, or the rest cell's label in its middle — on the day's left edge (`dayAnchor`), never against the whole day, which can be as tall as the screen; it keeps `collisionPadding={8}` from the screen's edge and its height gives way to the room on its side (`max-h-(--radix-popover-content-available-height)`, a `flex-col` whose session list is the part that shrinks and scrolls); exercise picker is a `rounded-[6px] border-[rgba(13,148,136,0.08)] bg-white` dropdown (`max-h-64`, rows `px-2.5 py-1.5 hover:bg-[rgba(13,148,136,0.05)]`); duplicate-week is `sm:max-w-xl max-h-[85vh] grid-rows-[auto_minmax(0,1fr)_auto]` with only its body scrolling (`min-h-0 overflow-y-auto` on the middle row — the card's padding, title and footer stay put; never `overflow-y-auto` on the `DialogContent` itself, which scrolls the padding away and cuts the title at the edge; no description under its title; its `<SegmentedControl>` switches span the dialog's width) with `AMOUNT_INPUT_CLASS = h-8 w-20 text-center font-mono-display text-xs`; progression preview is `max-h-[40vh] rounded-[6px] bg-white` + `TRAINING_CARD_BORDER`, diffs `font-mono-display text-[11px]` with the "after" value `font-semibold text-[#0d9488]`; working sets that share a value read as one (`100–105 kg → 102.5–107.5 kg`), sets that differ read one line per set in the row's right-hand column — one `w-fit` grid pushed to the right edge (`ml-auto grid grid-cols-[auto_auto_auto_auto] gap-x-2`: muted label, before right-aligned, arrow, after in teal with the unit), arrows lined up, under the exercise's name — and a line that still doesn't fit wraps; nothing spills past the card.

---

## Layout

### Client detail pages (3-column)

#### Far left: Icon strip — 52px wide

- Background `#0f2027`; logo = `/monogram-af.png` (the "af." monogram on a `#0f2027` ground, so it sits flat on the rail with no box) drawn 44px square here and 48px on the 80px `PersistentSidebar` rail.
- Nav icons 36px square, 6px radius. Active `bg-[rgba(13,148,136,0.15)]` + `#0d9488` stroke; inactive `rgba(255,255,255,0.35)` stroke, hover `rgba(255,255,255,0.05)` bg.
- Notification bell at bottom with teal badge.

#### Centre: Client sidebar — 200px, white

- Right border `1px solid rgba(13,148,136,0.08)`.
- Top (padding `18px 16px 14px`): back arrow (`ArrowLeft h-4 w-4`, `#93b0b4` → hover `#5a7d82`) + avatar (26px, 6px radius, teal gradient) + name (13.5px, 600), one `gap-2.5` row. **This row is the reference for every sidebar header** — the Program Builder's library panel follows it (see that chapter). The arrow is the only interactive element — a `BackLink` that leaves the client page, back to the entry before it began when a coach page precedes it, else `/clients`; the name is context, not a link.
- Vertical tabs (13.5px): active = 3px teal left bar + `rgba(13,148,136,0.05)` bg + 600 + `#0c1a1e`; inactive = 400 + `#6b8a8e`, hover `rgba(0,0,0,0.02)`.
- Bottom: Settings pinned, separated by `border-top rgba(13,148,136,0.08)`.

#### Right: Content area

`flex: 1`, background `#f4f7f6`, padding `20px 32px 60px` (`px-8 py-5 pb-[60px]`).

### Non-client / section pages

- The section shell mounts the 52px icon strip (`CollapsedIconStrip`); section content offset `lg:ml-[52px]`, `min-w-0`, `overflow-x-hidden`, `bg-[#f4f7f6]`, sticky white topbar.

---

## Component Patterns (legacy reference)

### Segmented control — HARD RULE

**There is exactly one segmented control in this codebase and you must import it:**
`@/components/programs/shared/segmented-control` → `<SegmentedControl options value onChange />` (`fullWidth` optional). Every pane switcher (Journey, Training, Nutrition), every period selector, every status filter and every in-card two-way toggle is this component. **Do not hand-roll the track**, and do not re-style a Radix `TabsList` into the same silhouette. Hold the active value in state and let `<SegmentedControl>` drive whatever renders the panes — `components/clients/metrics/metrics-top-bar.tsx` is the reference, and every one of the call sites switches its own panes this way rather than wrapping Radix `Tabs`. If you do reach for `Tabs`, it must be **controlled** by the same state the control writes; an uncontrolled `TabsList` is the shape this rule exists to stop.

`npm run check:labels` **clause 3 fails the build** on the track markup (the brand `0.05` tint together with the `p-[2px]`/`p-0.5` inset) anywhere but the component itself.

The spec, for reading — not for retyping:

| Part | Class |
|---|---|
| Track | `rounded-[6px] bg-[rgba(13,148,136,0.05)] p-[2px] gap-[2px]` (`inline-flex`, or `flex` when `fullWidth`) |
| Segment | `px-4 py-1.5 rounded-[4px] text-[12.5px] font-medium transition-all duration-150` |
| Active | `bg-white text-[#0c1a1e] shadow-[0_1px_3px_rgba(0,0,0,0.05)]` |
| Inactive | `text-[#5a7d82] hover:text-[#0c1a1e]` |
| Disabled | `cursor-not-allowed opacity-50` (the segment stays visible; `title` says why) |

**`font-medium` is unconditional, and that is the rule, not an oversight** (owner decision, 2026-08-21). The white pill, the shadow and the darker ink already carry the selection; adding weight on top made the control reflow as the selection moved and made a pane switcher out-shout the content beneath it. The earlier `13px` / `font-semibold` spec is superseded — if you find it quoted anywhere, that text is stale.

**Why this is a hard rule and not a recipe.** This section documented the recipe from the day the design system landed, and five surfaces hand-rolled it anyway — at `11.5px`, `12px`, `12.5px`, `13px` and `14px`, with two different active weights. A recipe that only lives in prose decays; clause 3 is what stops the sixth.

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
| Card entrance (`animate-card-in`) | `translateY(10px)`→`0`, `opacity 0`→`1`, `0.35s ease`; stagger `0.02s` per row, in reading order (the client Overview's eight rows, `0.02s`→`0.20s`, is the only staggered surface) |
| Fade in | `opacity 0`→`1`, `0.3s ease` — reached through the overlay transitions, not written by hand |
| Drawer slide-in (`animate-drawer-slide-in`) | `translateX(100%)`→`0`, `0.35s cubic-bezier(0.16,1,0.3,1)` |
| Card hover-lift | `-translate-y-px` + `shadow-[0_6px_20px_rgba(13,148,136,0.08)]` |
| Hover transitions | `0.12–0.15s ease` (`duration-150`) |
| Chevron rotation | `0.2s ease` (`duration-200`) |
| Button press | `active:scale-[0.98]` |

### Where animation may be used

**Animation marks arrival.** A surface is arrived at when you navigate to its route, plus the landing tab of that route. A tab switch, a pane switch, or a detail view that replaces a list inside a page you are already on is **not** an arrival — and neither is persistent chrome: the icon sidebar is present on every arrival, so it is never arrived at.

**The rule governs entrance only** — how a surface first appears. It says nothing about how one reacts. The reaction rows in the table above (hover-lift, hover transitions, chevron rotation, button press), plus spinners, skeletons and overlay open/close, belong wherever the interaction is and are untouched by it.

| Animates | Does not |
|---|---|
| `/dashboard` · `/clients` · `/dashboard/programs` · a client page's **Overview** · the auth pages and `/` | every other client-page tab and pane · the check-in review surface · the program builder · the icon sidebar |

The client portal animates nothing. Its pages are arrivals, so the rule **permits** an entrance there; it does not ask for one.

**A loop that carries meaning is a status indicator, not an animation.** The habits tracker's pulsing dot on today's cell says *still open* — deleting it deletes the only thing marking that cell — so it is out of scope here. Decorative loops are confined to the auth and marketing pages, which sit outside the product.

**Every entrance is gated on `prefers-reduced-motion`, and the gate keeps the fade and drops the travel.** Of everything on this page, an entrance is the one thing a reader can be unable to tolerate; a fade is not what they are asking to be spared. `animate-card-in` swaps to an opacity-only keyframe (`app/globals.css`); Framer is configured app-wide by `MotionPreferencesProvider` (`contexts/motion-preferences.tsx`, `reducedMotion="user"`), which snaps every positional value — the transform props, `width`/`height`/inset — and lets opacity run. The two paths therefore behave identically. A raw `useSpring` outside a `motion` element is the one thing that provider cannot reach, so it reads `useReducedMotion()` itself (`components/animated-counter.tsx`).

Two consequences to know before reaching for an exception:

- **A shared component carries one verdict.** `StatBand` renders both the roster's band and the Programs library's, so an animation on it is on both surfaces. The rule is drawn so that never has to be settled with a per-call-site prop — both are arrivals.
- **A tab remounts.** Radix unmounts inactive `TabsContent`, so the Overview replays its entrance on every return to it. Accepted: suppressing it needs per-visit state, which is more machinery than the effect is worth.

---

## Icon Guidance

- Library: Lucide (planned migration to Phosphor).
- **Stroke width `1.5` consistently.**
- Sizes: card grips/search/close/thumbs `h-3.5 w-3.5` (14px); inline action icons `h-3 w-3` (12px); row-action icons `h-[15px] w-[15px]`; sheet-header thumb `h-4 w-4`; loaders `h-4 w-4`/`h-5 w-5`.
- Colour hierarchy: primary `#0c1a1e`; secondary `#5a7d82`; muted `#93b0b4`; on dark inactive `rgba(255,255,255,0.35)`, active `#0d9488` (labels/eyebrows on dark stay muted white — never mint).

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
| Above a section divider | 16px — provided by the block above (`mb-4`) or the section rhythm |
| Below a section divider | 12px — the divider row's OWN `mb-3` (SectionLabel's built-in). Never mount a divider inside a flex `gap-*` parent that adds around it: flex gaps and margins ADD (no collapse), which is how the 28px/0px outliers happened |
| Divider row height | `min-h-[24.5px]` + `items-center` on EVERY divider row (SectionLabel bakes it in). Equal margins are not enough: the hairline is centered in the row, so a 15.75px bare-label row and a 24.5px toolbar row put the line ~4px apart even at identical margins. 24.5px = the calendar toolbars' natural height (Today button: 11px × 1.5 line-height + `py-1`); pinning it lands the line at exactly 27.75px below / 23.75px above its neighbours on every surface (CDP-measured) |
| Builder main column | `px-6 pt-5` |
| Overlay body padding | `px-5 py-4` (sheet) / `p-6` (dialog) |

---

## Anti-patterns — do NOT

- ❌ Use slate/gray defaults (`#64748b`, `#94a3b8`, `text-slate-*`, `bg-gray-*`). ✅ Use the teal-tinted greys.
- ❌ Use pill shapes or the 10px base radius on cards/dialogs. ✅ `rounded-[6px]` (4px inner chips) — `<Switch>` is the single exemption.
- ❌ Build an on/off setting out of a two-segment `<SegmentedControl>` ("On | Off"). ✅ `<Switch>`; SegmentedControl is for named modes.
- ❌ Set numerals in the sans font, or words in the numeral font. ✅ Mono = numbers only (see the Typography decision table); word-only labels are sans.
- ❌ Write the raw `font-mono-display` utility or a hand-rolled `uppercase tracking-` string in a component. ✅ Import a token from `builder-tokens.ts` — `npm run check:labels` fails otherwise.
- ❌ Invent a primary-button hover colour. ✅ `hover:bg-[#0b7f75]`.
- ❌ Ship an input without a focus ring. ✅ Add `FOCUS_RING`.
- ❌ Rebuild StatBand / SegmentedControl / LibraryTableShell / SectionLabel / RowActions from scratch. ✅ Import them.
- ❌ Paste a radius, border, ink or focus ring onto `Input`/`Textarea`/`Label`/`Select`/`Table` to correct it. ✅ Fix the primitive; call sites add only size, width, `bg-white` on a tint, `resize-none`.
- ❌ Hand-roll a magnifier beside an input, or a local `inputClass`/`TRIGGER_CLASS` constant. ✅ `<LibrarySearchInput>` / `<LibrarySortSelect>`.
- ❌ Spell a focus ring by hand — even correctly. ✅ Import `FOCUS_RING`; `check:labels` clause 4 fails otherwise.
- ❌ Hand-roll a segmented-control track, or restyle a `TabsList` into one. ✅ `<SegmentedControl>` — `npm run check:labels` clause 3 fails otherwise.
- ❌ Bold the active segment of a switcher. ✅ `font-medium` in both states; the white pill carries the selection.
- ❌ Style a Teal-Summit surface off the OKLCH tokens (`bg-background`, `bg-primary`, `rounded-lg`). ✅ Author with the hex values here.
- ❌ Resurrect token values from the deleted `atletafit-*.html` mockups (git history). ✅ Match the shipped Programs/Builder code.
- ❌ Set a date, name, or number in `font-mono-display` inside a running sentence (dialog/toast/empty-state prose). ✅ Mono is for standalone data only — see "Prose vs data".
