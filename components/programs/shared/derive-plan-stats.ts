import type { SavedPlan } from "@/types/training";

// Pure client-side derivations over the saved-plans list payload (the list
// endpoint returns the full nested tree; there are no stored counts).
// Same formulas program-card.tsx used — lifted here so the Programs table,
// stat band, and builder meta can never drift from each other.

export function getWeekCount(plan: SavedPlan): number {
  return (
    (plan.sessions ?? []).reduce((max, s) => Math.max(max, s.weekIndex), 0) + 1
  );
}

export function getTotalSlots(plan: SavedPlan): number {
  return plan.sessions?.length ?? 0;
}

export function getTrainingCount(plan: SavedPlan): number {
  return plan.sessions?.filter((s) => !s.isRest).length ?? 0;
}

export function getRestCount(plan: SavedPlan): number {
  return getTotalSlots(plan) - getTrainingCount(plan);
}

// Per-week average to one decimal — mockup formula (total / weeks).toFixed(1).
export function getPerWeek(plan: SavedPlan): number {
  const weeks = getWeekCount(plan);
  if (weeks === 0) return 0;
  return Math.round((getTrainingCount(plan) / weeks) * 10) / 10;
}

// Long focus strings don't fit a KPI cell — abbreviate to initials
// ("push pull legs" → "PPL"), matching the mockup's treatment.
export function abbreviateFocus(value: string): string {
  if (value.length <= 12) return value;
  return value
    .split(/\s+/)
    .map((word) => word[0] ?? "")
    .join("")
    .toUpperCase();
}

// Most frequent non-null value of a derived field, with its count.
export function getMode<T>(
  items: T[],
  pick: (item: T) => string | null
): { value: string; count: number } | null {
  const counts = new Map<string, number>();
  for (const item of items) {
    const v = pick(item);
    if (!v) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  let best: { value: string; count: number } | null = null;
  for (const [value, count] of counts) {
    if (!best || count > best.count) best = { value, count };
  }
  return best;
}
