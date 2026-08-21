import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { BlockCard } from "./block-card";
import type { ClientBlockView } from "@/lib/blocks/block-derivations";
import type { BlockFacts } from "@/types/client-blocks";

// Session 7.3/7.4: an unset Training or Nutrition fact becomes the way into the
// setup flow — on CURRENT and FUTURE blocks ONLY (owner decision 2026-08-21).
// Elapsed and archived keep plain text: placement writes from a chosen start
// date, not the block's window, so a click on a finished block leads somewhere
// confusing, and it matches the read-only posture elapsed blocks already have.

function makeBlock(overrides: Partial<ClientBlockView> = {}): ClientBlockView {
  return {
    id: "blk-1",
    name: "Cut 2",
    focus: null,
    targetWeightKg: null,
    startsOn: "2026-08-01",
    endsOn: "2026-09-30",
    archivedAt: null,
    weeks: 9,
    state: "current",
    weekOfTotal: null,
    ...overrides,
  };
}

// No training programs and no nutrition version — both empty states render.
const EMPTY_FACTS: BlockFacts = {
  blockId: "blk-1",
  training: [],
  nutrition: null,
  notes: [],
};

function renderCard(block: ClientBlockView, handlers: {
  onPlaceProgram?: () => void;
  onSetNutrition?: () => void;
} = {}) {
  return render(
    <BlockCard
      block={block}
      color="#0d9488"
      facts={EMPTY_FACTS}
      factsLoading={false}
      factsError={false}
      weight={{ start: null, end: null, change: null }}
      pace={null}
      targetDisplay={null}
      weightUnit="kg"
      defaultOpen
      {...handlers}
    />
  );
}

describe("BlockCard — the round-trip empty states", () => {
  it("offers the way in on a CURRENT block", () => {
    renderCard(makeBlock({ state: "current" }), { onPlaceProgram: vi.fn() });
    expect(
      screen.getByRole("button", { name: /No program placed/ })
    ).toBeDefined();
  });

  it("offers the way in on a FUTURE block", () => {
    renderCard(makeBlock({ state: "future" }), { onPlaceProgram: vi.fn() });
    expect(
      screen.getByRole("button", { name: /No program placed/ })
    ).toBeDefined();
  });

  it("keeps ELAPSED blocks as plain text", () => {
    renderCard(makeBlock({ state: "past" }), { onPlaceProgram: vi.fn() });
    expect(screen.getByText("No program placed")).toBeDefined();
    expect(
      screen.queryByRole("button", { name: /No program placed/ })
    ).toBeNull();
  });

  it("keeps ARCHIVED blocks as plain text, even while current", () => {
    renderCard(
      makeBlock({ state: "current", archivedAt: "2026-08-20T00:00:00Z" }),
      { onPlaceProgram: vi.fn() }
    );
    expect(screen.getByText("No program placed")).toBeDefined();
    expect(
      screen.queryByRole("button", { name: /No program placed/ })
    ).toBeNull();
  });

  it("keeps plain text when no handler is supplied at all", () => {
    renderCard(makeBlock({ state: "current" }));
    expect(screen.getByText("No program placed")).toBeDefined();
    expect(
      screen.queryByRole("button", { name: /No program placed/ })
    ).toBeNull();
  });

  it("fires the handler with the block the coach clicked", () => {
    const onPlaceProgram = vi.fn();
    renderCard(makeBlock({ state: "current" }), { onPlaceProgram });
    screen.getByRole("button", { name: /No program placed/ }).click();
    expect(onPlaceProgram).toHaveBeenCalledTimes(1);
  });

  // The Nutrition fact's empty state (7.4) is gated identically — one rule,
  // blockAcceptsSetup, not two that can drift apart.
  it("offers the nutrition way in on a CURRENT block", () => {
    const onSetNutrition = vi.fn();
    renderCard(makeBlock({ state: "current" }), { onSetNutrition });
    const button = screen.getByRole("button", { name: /Not set/ });
    button.click();
    expect(onSetNutrition).toHaveBeenCalledTimes(1);
  });

  it("keeps the nutrition empty state plain on ELAPSED blocks", () => {
    renderCard(makeBlock({ state: "past" }), { onSetNutrition: vi.fn() });
    expect(screen.getByText("Not set")).toBeDefined();
    expect(screen.queryByRole("button", { name: /Not set/ })).toBeNull();
  });

  it("keeps the nutrition empty state plain on ARCHIVED blocks", () => {
    renderCard(
      makeBlock({ state: "future", archivedAt: "2026-08-20T00:00:00Z" }),
      { onSetNutrition: vi.fn() }
    );
    expect(screen.getByText("Not set")).toBeDefined();
    expect(screen.queryByRole("button", { name: /Not set/ })).toBeNull();
  });
});
