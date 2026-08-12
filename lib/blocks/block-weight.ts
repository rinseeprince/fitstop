import type { MetricPoint } from "@/utils/metric-points";
import type { ClientBlockView } from "@/lib/blocks/block-derivations";

// Pure weight facts for a block, from the merged check-in ⊕ coach-entry series
// (utils/metric-points.ts) — shared by the coach Journey card and the client
// journey endpoint so the two surfaces read the same numbers by construction.
// Like derivePace, the values are UNIT-AGNOSTIC: the coach feeds points already
// converted to the viewer's unit; the server feeds canonical kg. Points must be
// ascending (the merged-series contract); the renderer formats the delta.

/** The two fields the facts walk reads — a structural subset of MetricPoint,
 *  so a server caller can feed raw kg pairs without fabricating the rest. */
export type BlockWeightPoint = Pick<MetricPoint, "date" | "value">;

export interface BlockWeightFacts {
  /** Latest entry at or before the block's start — derivePace's baseline. */
  start: { value: number; date: string } | null;
  /** Past blocks: latest entry inside the window. Current: latest overall.
   *  Future: null (nothing has happened yet). */
  end: { value: number; date: string } | null;
  /** end − start, in the series' unit. */
  change: number | null;
}

export function deriveBlockWeightFacts(
  points: BlockWeightPoint[],
  block: Pick<ClientBlockView, "startsOn" | "endsOn" | "state">
): BlockWeightFacts {
  if (block.state === "future") {
    return { start: null, end: null, change: null };
  }

  // Points are ascending; walk from the tail for the latest-at-or-before reads.
  let start: BlockWeightFacts["start"] = null;
  for (let i = points.length - 1; i >= 0; i--) {
    if (points[i].date <= block.startsOn) {
      start = { value: points[i].value, date: points[i].date };
      break;
    }
  }

  let end: BlockWeightFacts["end"] = null;
  if (block.state === "current") {
    const last = points[points.length - 1];
    if (last) end = { value: last.value, date: last.date };
  } else {
    for (let i = points.length - 1; i >= 0; i--) {
      if (points[i].date <= block.endsOn) {
        end = { value: points[i].value, date: points[i].date };
        break;
      }
    }
  }

  return {
    start,
    end,
    change: start && end ? end.value - start.value : null,
  };
}
