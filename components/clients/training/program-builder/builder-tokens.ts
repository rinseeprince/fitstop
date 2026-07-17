// Shared Teal-Summit style constants for the Program builder. The design doc
// (docs/newdesignsystem.md) defines day-card borders + text tokens but no
// input focus ring — defined ONCE here so every builder input matches. (The
// modal scrim is already single-sourced in components/ui/dialog.tsx.)

// One explicit column template shared by the header row and every week row —
// sticky left column + aligned Day 1–7 columns depend on all rows using it.
// Day columns are FIXED 132px: a minmax(…,1fr) never clamps here because the
// min-w-max scroll wrapper sizes tracks to content, so fr columns balloon to
// their card text. Fixed width = deterministically narrow cards everywhere;
// the grid simply ends early on very wide windows.
export const GRID_COLS =
  "grid grid-cols-[220px_repeat(7,152px)]";

// Day-card treatments (docs/newdesignsystem.md "training vs rest day cards").
export const TRAINING_CARD_BORDER = "border border-[rgba(13,148,136,0.08)]";
export const REST_CARD_BORDER = "border border-dashed border-[rgba(13,148,136,0.10)]";

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

// Mono variant — the mockup renders day headers, week microcopy, rest labels,
// popover subtitles, and card metas in the numeral font.
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

// Mono eyebrow on the dark program header (teal on #0f2027).
export const HEADER_EYEBROW_CLASS =
  "font-mono-display text-[9.5px] font-medium uppercase tracking-[0.14em] text-[#5eead4]";
