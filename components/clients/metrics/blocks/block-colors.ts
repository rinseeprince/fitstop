// Static palette indexed by chain position — the METRIC_COLORS discipline
// (exercise-trend-chart.tsx): position-indexed, no picker, no category→colour
// mapping (the owner decision recorded at builder-tokens.ts's THUMB_CLASS).
// Teal-Summit hues from docs/newdesignsystem.md; position cycles past four.
//
// Re-stepped in Session 3.5, validator-driven (dataviz six checks, light
// surface #ffffff): unlike METRIC_COLORS' one-metric-at-a-time rendering,
// blocks sit ADJACENT as chart bands, so adjacent-pair separation matters.
// #0a5c55 was dropped (fails the lightness band and chroma floor as a mark)
// and the order re-stepped so teal↔cyan-blue (normal-vision ΔE 7.9, below
// the hard 15 floor) are never adjacent — including the cycle's wrap pair.
// The surviving warns are relieved by design: every band carries a direct
// name label, and boundaries carry white dividers. Amber (#d97706) is
// deliberately absent — it is the goal line's reserved meaning.
export const BLOCK_COLORS = [
  "#0d9488",
  "#c8923a",
  "#2d8fb5",
  "#c06060",
] as const;

export function blockColor(position: number): string {
  return BLOCK_COLORS[((position % BLOCK_COLORS.length) + BLOCK_COLORS.length) % BLOCK_COLORS.length];
}
