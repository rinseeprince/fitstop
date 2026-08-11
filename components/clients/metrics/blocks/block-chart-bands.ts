import { toUtcMs } from "@/utils/metric-points";
import { blockColor } from "./block-colors";
import type { ClientBlockView } from "@/lib/blocks/block-derivations";

// Pure geometry for the trend chart's block bands. Identity (name, colour,
// muted) is shaped ONCE from the chain — colour by CHAIN position, so a
// range window that hides early blocks never repaints the survivors (colour
// follows the entity, not its rank). The chart clamps to its numeric time
// domain: a band is a [startsOn, endsOn+1day) slab, so adjacent blocks tile
// exactly and the shared edge is where the white divider goes.

export const DAY_MS = 86_400_000;

/** Chain-derived identity, stable across range windows. */
export interface BlockBandIdentity {
  id: string;
  name: string;
  color: string;
  /** Elapsed blocks render too — muted, per workstream invariant 10. */
  muted: boolean;
  startsOn: string;
  endsOn: string;
}

export function shapeBlockBandIdentity(
  blocks: ClientBlockView[]
): BlockBandIdentity[] {
  return blocks.map((block, index) => ({
    id: block.id,
    name: block.name,
    color: blockColor(index),
    muted: block.state === "past",
    startsOn: block.startsOn,
    endsOn: block.endsOn,
  }));
}

export interface BlockBand {
  id: string;
  name: string;
  color: string;
  muted: boolean;
  x1: number;
  x2: number;
}

export interface BlockBandLayout {
  bands: BlockBand[];
  /** Interior contact edges between adjacent clamped bands — the white
   *  divider positions. Domain edges never get one. */
  boundaries: number[];
}

export function clampBlockBands(
  identities: BlockBandIdentity[],
  domainMin: number,
  domainMax: number
): BlockBandLayout {
  const bands: BlockBand[] = [];
  for (const identity of identities) {
    const x1 = Math.max(toUtcMs(identity.startsOn), domainMin);
    const x2 = Math.min(toUtcMs(identity.endsOn) + DAY_MS, domainMax);
    if (x2 <= x1) continue; // wholly outside the visible window
    bands.push({
      id: identity.id,
      name: identity.name,
      color: identity.color,
      muted: identity.muted,
      x1,
      x2,
    });
  }

  const boundaries: number[] = [];
  for (let i = 1; i < bands.length; i++) {
    const edge = bands[i].x1;
    if (edge === bands[i - 1].x2 && edge > domainMin && edge < domainMax) {
      boundaries.push(edge);
    }
  }
  return { bands, boundaries };
}
