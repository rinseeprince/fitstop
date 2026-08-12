import { describe, expect, it } from "vitest";
import { toUtcMs } from "@/utils/metric-points";
import {
  clampBlockBands,
  DAY_MS,
  shapeBlockBandIdentity,
} from "./block-chart-bands";
import { BLOCK_COLORS } from "./block-colors";
import type { ClientBlockView } from "@/lib/blocks/block-derivations";

const view = (
  id: string,
  startsOn: string,
  endsOn: string,
  state: ClientBlockView["state"]
): ClientBlockView => ({
  id,
  name: `Block ${id}`,
  focus: null,
  targetWeightKg: null,
  startsOn,
  endsOn,
  archivedAt: null,
  weeks: 4,
  state,
  weekOfTotal: null,
});

// Contiguous chain: past, current, future.
const CHAIN = [
  view("a", "2026-06-01", "2026-06-28", "past"),
  view("b", "2026-06-29", "2026-08-23", "current"),
  view("c", "2026-08-24", "2026-09-20", "future"),
];

describe("shapeBlockBandIdentity", () => {
  it("colours by CHAIN position and mutes only elapsed blocks", () => {
    const identities = shapeBlockBandIdentity(CHAIN);
    expect(identities.map((i) => i.color)).toEqual([
      BLOCK_COLORS[0],
      BLOCK_COLORS[1],
      BLOCK_COLORS[2],
    ]);
    expect(identities.map((i) => i.muted)).toEqual([true, false, false]);
  });
});

describe("clampBlockBands", () => {
  const identities = shapeBlockBandIdentity(CHAIN);
  // Window: 2026-06-15 .. end of 2026-08-11 (today) — cuts block a's front,
  // cuts block b at today, excludes future block c entirely.
  const domainMin = toUtcMs("2026-06-15");
  const domainMax = toUtcMs("2026-08-11") + DAY_MS;

  it("tiles adjacent blocks exactly: previous x2 === next x1", () => {
    const wide = clampBlockBands(
      identities,
      toUtcMs("2026-05-01"),
      toUtcMs("2026-10-01")
    );
    expect(wide.bands).toHaveLength(3);
    expect(wide.bands[0].x2).toBe(wide.bands[1].x1);
    expect(wide.bands[1].x2).toBe(wide.bands[2].x1);
    // Exclusive day-slab end: a's band runs through the END of its last day.
    expect(wide.bands[0].x2).toBe(toUtcMs("2026-06-29"));
    expect(wide.boundaries).toEqual([
      toUtcMs("2026-06-29"),
      toUtcMs("2026-08-24"),
    ]);
  });

  it("clamps to the domain and skips wholly-outside bands", () => {
    const { bands } = clampBlockBands(identities, domainMin, domainMax);
    expect(bands.map((b) => b.id)).toEqual(["a", "b"]);
    expect(bands[0].x1).toBe(domainMin); // front-clamped
    expect(bands[1].x2).toBe(domainMax); // clamped at end-of-today
  });

  it("elapsed bands still render inside the window, muted — the invariant-10 story", () => {
    const { bands } = clampBlockBands(identities, domainMin, domainMax);
    expect(bands[0].muted).toBe(true);
  });

  it("no divider at a clamped domain edge; interior contact keeps one", () => {
    const { boundaries } = clampBlockBands(identities, domainMin, domainMax);
    // a↔b contact at 2026-06-29 is interior; b's end is the domain edge.
    expect(boundaries).toEqual([toUtcMs("2026-06-29")]);
  });

  it("a gap between non-contiguous bands gets no divider", () => {
    const gapped = [
      identities[0],
      { ...identities[2] }, // c starts well after a ends
    ];
    const { boundaries } = clampBlockBands(
      gapped,
      toUtcMs("2026-05-01"),
      toUtcMs("2026-10-01")
    );
    expect(boundaries).toEqual([]);
  });
});
