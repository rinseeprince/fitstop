// Static palette indexed by chain position — the METRIC_COLORS discipline
// (exercise-trend-chart.tsx): the hue carries identity across visits, not
// simultaneous contrast. No picker, no category→colour mapping (the owner
// decision recorded at builder-tokens.ts's THUMB_CLASS). Teal-shifted system
// hues from docs/newdesignsystem.md; position cycles past five blocks.
export const BLOCK_COLORS = [
  "#0d9488",
  "#2d8fb5",
  "#c8923a",
  "#0a5c55",
  "#c06060",
] as const;

export function blockColor(position: number): string {
  return BLOCK_COLORS[((position % BLOCK_COLORS.length) + BLOCK_COLORS.length) % BLOCK_COLORS.length];
}
