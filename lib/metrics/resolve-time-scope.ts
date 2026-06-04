import type { Phase, Roadmap } from "@/types/roadmap";

/**
 * A roadmap with its phases — the shape the active/archived roadmap endpoints
 * return (mirrors `RoadmapWithPhases` in services/roadmap-service.ts, kept
 * structural here so this pure lib has no service-layer import).
 */
export type RoadmapWithPhases = Roadmap & { phases: Phase[] };

/**
 * The coach's selected metrics time-scope. One control drives both the
 * body/wellness trend charts (client-side check-in filter) and the exercise
 * progression charts (server-side RPC date bounds) — see Sessions 7.5 / 7.7.
 */
export type TimeScope =
  | { kind: "all" }
  | { kind: "relative"; days: 7 | 30 | 90 }
  | { kind: "program"; roadmapId: string }
  | { kind: "phase"; phaseId: string };

/** A resolved `[start, end]` window. `null` = unbounded on that side. ISO YYYY-MM-DD. */
export type ResolvedWindow = { start: string | null; end: string | null };

/** UTC date math on a YYYY-MM-DD string (avoids TZ drift from local Date parsing). */
function addDays(dateStr: string, delta: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function minStr(values: string[]): string {
  return values.reduce((a, b) => (a < b ? a : b));
}

function maxStr(values: string[]): string {
  return values.reduce((a, b) => (a > b ? a : b));
}

function findPhase(roadmaps: RoadmapWithPhases[], phaseId: string): Phase | undefined {
  for (const r of roadmaps) {
    const phase = r.phases.find((p) => p.id === phaseId);
    if (phase) return phase;
  }
  return undefined;
}

/**
 * Resolve a `TimeScope` to a concrete `{ start, end }` window.
 *
 * - **all** → unbounded both sides.
 * - **relative(days)** → `[today - days, null]` (lower-bound only, matching the
 *   legacy cutoff-only date-range filter).
 * - **phase** → `[phase.startDate, phase.endDate ?? today]`. An ongoing (active)
 *   phase has a null `endDate`, so the window runs to today.
 * - **program** → the union of the roadmap's phases:
 *   `[min(phase.startDate), max(phase.endDate ?? today)]`. Treating a null
 *   `endDate` as `today` means an active phase extends the window to today while
 *   a completed roadmap ends on its last phase's actual end. Falls back to the
 *   roadmap's own `startedAt`/`targetEndDate` only when every phase is date-less
 *   (the roadmap-column path; `roadmap.ended_at` does not exist until Session 7.10).
 *
 * The end bound is a calendar date; callers filtering timestamped rows must treat
 * it as inclusive-by-date (e.g. `createdAt < end + 1 day`).
 */
export function resolveTimeScope(
  scope: TimeScope,
  roadmaps: RoadmapWithPhases[],
  today: string
): ResolvedWindow {
  switch (scope.kind) {
    case "all":
      return { start: null, end: null };

    case "relative":
      return { start: addDays(today, -scope.days), end: null };

    case "phase": {
      const phase = findPhase(roadmaps, scope.phaseId);
      if (!phase) return { start: null, end: null };
      return { start: phase.startDate ?? null, end: phase.endDate ?? today };
    }

    case "program": {
      const roadmap = roadmaps.find((r) => r.id === scope.roadmapId);
      if (!roadmap) return { start: null, end: null };

      const starts = roadmap.phases
        .map((p) => p.startDate)
        .filter((d): d is string => !!d);
      const datedPhases = roadmap.phases.filter((p) => p.startDate || p.endDate);

      // Every phase is date-less → fall back to the roadmap's own declared span.
      if (starts.length === 0 && datedPhases.length === 0) {
        return {
          start: roadmap.startedAt ?? null,
          end: roadmap.targetEndDate ?? today,
        };
      }

      const start = starts.length ? minStr(starts) : roadmap.startedAt ?? null;
      const ends = datedPhases.map((p) => p.endDate ?? today);
      const end = ends.length ? maxStr(ends) : today;
      return { start, end };
    }
  }
}
