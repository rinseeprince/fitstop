// Shared Teal-Summit style constants for the Program builder. The design doc
// (docs/newdesignsystem.md) defines day-card borders + text tokens but no
// input focus ring — defined ONCE here so every builder input matches. (The
// modal scrim is already single-sourced in components/ui/dialog.tsx.)

// One explicit column template shared by the header row and every week row —
// sticky left column + aligned Day 1–7 columns depend on all rows using it.
// Reference geometry (atletafit-builder-redesign.html `.sched`): a slim 42px
// week column (a chip stack, NOT a card) + seven Day columns that flex to fill
// (minmax(158px,1fr)), 8px gap. The `1fr` grows only because the scroll
// wrapper is a FIXED min-width (min-w-[1220px]) rather than min-w-max — so on
// a wide window the cards breathe, on a narrow one the grid scrolls.
export const GRID_COLS =
  "grid grid-cols-[42px_repeat(7,minmax(158px,1fr))] gap-2";

// Day-card treatments (docs/newdesignsystem.md "training vs rest day cards").
export const TRAINING_CARD_BORDER = "border border-[rgba(13,148,136,0.08)]";

// Brand-teal focus ring for builder inputs.
export const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0d9488]/35 focus-visible:ring-offset-0";

// Text tokens.
export const TEXT_PRIMARY = "text-[#0c1a1e]";
export const TEXT_SECONDARY = "text-[#5a7d82]";
export const TEXT_MUTED = "text-[#93b0b4]";

// 10-11px uppercase label treatment.
export const LABEL_CLASS =
  "text-[10px] font-medium uppercase tracking-[0.06em] text-[#93b0b4]";

// Mono variant — for NUMBER-BEARING labels and metas only (day-header
// ordinals "Day 3", schemes, dates, counts). Word-only strings use
// LABEL_CLASS; mono = numbers only (owner decision, 2026-07-23).
export const MONO_LABEL_CLASS =
  "font-mono-display text-[10px] font-medium uppercase tracking-[0.08em] text-[#93b0b4]";

// Neutral focus chip on session/library/popover cards.
export const CHIP_NEUTRAL_CLASS =
  "rounded-[4px] bg-[#f0f5f4] px-1.5 py-px text-[10px] font-medium text-[#5a7d82]";

// Teal-tinted icon square — the session-card chip, library-card thumb, and
// exercise-block thumb all share this (size set by the caller via h-/w-).
// Deliberately ONE neutral treatment: the mockup's push/pull/legs tints are
// collapsed (owner decision — no focus→colour mapping).
export const THUMB_CLASS =
  "grid shrink-0 place-items-center rounded-[6px] bg-[rgba(13,148,136,0.08)] text-[#0d9488]";

// Sans eyebrow on the dark hero headers (Program / Assistant / Training plan
// / Exercise data). Word-only, so Instrument Sans per the mono=numbers rule;
// muted white (the on-dark LABEL scale, same tone as stat-band labels), NOT
// the old #5eead4 mint — teal on dark is reserved for interactive/active
// elements; a passive label in mint out-shouts the title it sits above
// (owner calls, 2026-07-23).
export const HEADER_EYEBROW_CLASS =
  "text-[9.5px] font-medium uppercase tracking-[0.14em] text-[rgba(255,255,255,0.35)]";

// ---------------------------------------------------------------------------
// Mono = numbers only (owner decision, 2026-07-23). JetBrains Mono is for
// numerals and number-bearing data strings; Instrument Sans for every
// word-only string. scripts/check-labels.ts enforces that the raw utility
// appears only in token modules — import these instead of retyping it.
// ---------------------------------------------------------------------------

// Base numeral-font token for bare numeric fragments that inherit their
// size/colour from the parent (stat values, inline counts).
export const MONO = "font-mono-display";

// Numeric card metas, footers and counters ("4×10-12", "60 min", "+2 more",
// "Showing 3 of 25"). Size is contextual — append text-[10px]/text-[11px]/
// text-[12px] at the call site; colour overrides ride through cn().
export const MONO_META_CLASS = "font-mono-display text-[#93b0b4]";

// Centered numeric editor inputs (set/rep/load/RPE/rest cells). Size and
// height stay at the call site (h-6/h-7 tiers).
export const MONO_INPUT_CLASS = "text-center font-mono-display";

// Numeric table cells in the library tables (12.5px per the type scale);
// colour at the call site (#5a7d82 primary, #93b0b4 meta).
export const MONO_CELL_CLASS = "font-mono-display text-[12.5px]";

// On-dark word-only stat label (the StatBand label scale).
export const STAT_LABEL_DARK_CLASS =
  "text-[10px] font-medium uppercase tracking-[0.06em] text-[rgba(255,255,255,0.35)]";

// On-dark stat value — mono, bold, white; size tier at the call site
// (22px macro tier, 24px StatBand, 32px hero lead).
export const STAT_VALUE_DARK_CLASS = "font-mono-display font-bold text-white";

// The section-divider label treatment (SectionLabel's own text). Prefer the
// <SectionLabel> component when a hairline divider is wanted; import this
// for label-only contexts so the literal cannot drift.
export const SECTION_LABEL_CLASS =
  "text-[10.5px] font-semibold uppercase tracking-[0.07em] text-[#93b0b4]";

// Teal count chip ("3", "2/5") — counts are mono per the rule.
export const COUNT_CHIP_CLASS =
  "font-mono-display text-[10px] font-semibold rounded-[6px] bg-[rgba(13,148,136,0.05)] px-1.5 py-0.5 text-[#0d9488]";
