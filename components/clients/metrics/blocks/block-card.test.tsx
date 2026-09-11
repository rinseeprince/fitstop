import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { BlockCard } from "./block-card";
import type { ClientBlockView } from "@/lib/blocks/block-derivations";
import type { BlockFacts } from "@/types/client-blocks";

// Session 7.3/7.4: an unset Training or Nutrition fact becomes the way into the
// setup flow — on CURRENT and FUTURE blocks ONLY (owner decision 2026-08-21).
// Elapsed and archived keep plain text: a plan cannot start before the deletion
// floor, so a finished block is not listed by the setup surfaces' Block field,
// and it matches the read-only posture elapsed blocks already have.
// H: a SET fact carries the same way in — "update plan" / "update targets" to
// the RIGHT of the value on its own line, exactly where "place one" sits after
// "No program placed" — on the same gate and through the same handler, so a
// coach changes a block's programming from the card rather than the calendars.

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
  nutrition: [],
};

// A program placed and targets set inside the block — both set states render.
const SET_FACTS: BlockFacts = {
  blockId: "blk-1",
  training: [{ id: "p1", name: "Push Pull Legs", startsOn: "2026-08-03" }],
  nutrition: [
    { id: "v1", startsOn: "2026-08-03", calories: 2140, deficitPerDay: 310, note: null },
  ],
};

/** The empty state on a current block, in its own container, for a
 *  same-test comparison against a set state already on screen. */
function renderEmpty() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  return render(
    <BlockCard
      block={makeBlock({ state: "current" })}
      color="#0d9488"
      facts={EMPTY_FACTS}
      factsLoading={false}
      factsError={false}
      weight={{ start: null, end: null, change: null }}
      pace={null}
      targetDisplay={null}
      weightUnit="kg"
      defaultOpen
      onPlaceProgram={vi.fn()}
    />,
    { container: host }
  );
}

function renderCard(block: ClientBlockView, handlers: {
  onPlaceProgram?: () => void;
  onSetNutrition?: () => void;
  facts?: BlockFacts;
} = {}) {
  const { facts = EMPTY_FACTS, ...rest } = handlers;
  return render(
    <BlockCard
      block={block}
      color="#0d9488"
      facts={facts}
      factsLoading={false}
      factsError={false}
      weight={{ start: null, end: null, change: null }}
      pace={null}
      targetDisplay={null}
      weightUnit="kg"
      defaultOpen
      {...rest}
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

  // A set block says when its targets start, as the training column says when
  // its program starts — a queued prescription on a future block would
  // otherwise show numbers with no date (migration 166).
  it("says when the targets start beside the numbers", () => {
    renderCard(makeBlock({ state: "future" }), {
      facts: {
        ...EMPTY_FACTS,
        nutrition: [{ id: "v1", startsOn: "2026-10-08", calories: 1732, deficitPerDay: 214, note: null }],
      },
    });
    expect(screen.getByText(/from 8 Oct/)).toBeDefined();
    expect(screen.getByText("1,732")).toBeDefined();
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

describe("BlockCard — the set state's update affordance (H)", () => {
  it("offers update plan on a set CURRENT block, beside the value, in place of the empty state", () => {
    renderCard(makeBlock({ state: "current" }), {
      facts: SET_FACTS,
      onPlaceProgram: vi.fn(),
    });
    const update = screen.getByRole("button", { name: /update plan/ });
    expect(screen.getByText("Push Pull Legs")).toBeDefined();
    expect(screen.queryByRole("button", { name: /No program placed/ })).toBeNull();
    // ONE grammar and ONE position for the way in: the value, a dash, then the
    // word — the plan's name is INSIDE the same line as the word, to its left,
    // exactly as "No program placed" is to the left of "place one". Never a
    // line of its own under the value, never the label register (a small-caps
    // word beside the column label reads as a title).
    expect(update.textContent).toBe("Push Pull Legs — update plan");
    const empty = renderEmpty();
    const placeOne = empty.getByRole("button", { name: /No program placed/ });
    expect(placeOne.textContent).toBe("No program placed — place one");
    expect(update.className).toBe(placeOne.className);
    expect(update.querySelector("span:last-child")?.className).toBe(
      placeOne.querySelector("span:last-child")?.className
    );
    expect(update.className).not.toMatch(/uppercase/);
  });

  // However many plans the column lists, the way in rides the FIRST entry's
  // line — the headline position — once. Two doors that do the same thing are
  // noise, and the second entry's line carries the plan alone.
  it("offers update plan once, on the first listed plan, when several are listed", () => {
    renderCard(makeBlock({ state: "current" }), {
      facts: {
        ...SET_FACTS,
        training: [
          ...SET_FACTS.training,
          { id: "p2", name: "Glute Focused", startsOn: "2026-08-24" },
        ],
      },
      onPlaceProgram: vi.fn(),
    });
    const doors = screen.getAllByRole("button", { name: /update plan/ });
    expect(doors).toHaveLength(1);
    expect(doors[0].textContent).toBe("Push Pull Legs — update plan");
    expect(screen.getByText("Glute Focused")).toBeDefined();
  });

  it("offers update plan on a set FUTURE block", () => {
    renderCard(makeBlock({ state: "future" }), {
      facts: SET_FACTS,
      onPlaceProgram: vi.fn(),
    });
    expect(screen.getByRole("button", { name: /update plan/ })).toBeDefined();
  });

  it("keeps a set ELAPSED block's program as plain text", () => {
    renderCard(makeBlock({ state: "past" }), {
      facts: SET_FACTS,
      onPlaceProgram: vi.fn(),
    });
    expect(screen.getByText("Push Pull Legs")).toBeDefined();
    expect(screen.queryByRole("button", { name: /update plan/ })).toBeNull();
  });

  it("keeps a set ARCHIVED block's program as plain text, even while current", () => {
    renderCard(
      makeBlock({ state: "current", archivedAt: "2026-08-20T00:00:00Z" }),
      { facts: SET_FACTS, onPlaceProgram: vi.fn() }
    );
    expect(screen.getByText("Push Pull Legs")).toBeDefined();
    expect(screen.queryByRole("button", { name: /update plan/ })).toBeNull();
  });

  // The Nutrition column is gated by the same one rule.
  it("offers update targets on a set CURRENT block and not on an ELAPSED one", () => {
    const { unmount } = renderCard(makeBlock({ state: "current" }), {
      facts: SET_FACTS,
      onSetNutrition: vi.fn(),
    });
    const update = screen.getByRole("button", { name: /update targets/ });
    // The numbers are the state, to the word's left on the same line.
    expect(update.textContent).toContain("2,140");
    expect(update.textContent).toMatch(/kcal\/day — update targets$/);
    expect(screen.queryByRole("button", { name: /Not set/ })).toBeNull();
    unmount();

    renderCard(makeBlock({ state: "past" }), {
      facts: SET_FACTS,
      onSetNutrition: vi.fn(),
    });
    expect(screen.getByText("2,140")).toBeDefined();
    expect(screen.queryByRole("button", { name: /update targets/ })).toBeNull();
  });

  // The change action IS the empty state's round trip: the same handler, so it
  // lands on the same surface with the same block preselected. Each track's
  // action fires its own handler and never the other's.
  it("update plan fires the apply round trip, not the nutrition one", () => {
    const onPlaceProgram = vi.fn();
    const onSetNutrition = vi.fn();
    renderCard(makeBlock({ state: "current" }), {
      facts: SET_FACTS,
      onPlaceProgram,
      onSetNutrition,
    });
    screen.getByRole("button", { name: /update plan/ }).click();
    expect(onPlaceProgram).toHaveBeenCalledTimes(1);
    expect(onSetNutrition).not.toHaveBeenCalled();
  });

  it("update targets fires the plan round trip, not the apply one", () => {
    const onPlaceProgram = vi.fn();
    const onSetNutrition = vi.fn();
    renderCard(makeBlock({ state: "future" }), {
      facts: SET_FACTS,
      onPlaceProgram,
      onSetNutrition,
    });
    screen.getByRole("button", { name: /update targets/ }).click();
    expect(onSetNutrition).toHaveBeenCalledTimes(1);
    expect(onPlaceProgram).not.toHaveBeenCalled();
  });

  it("renders no change action without a handler", () => {
    renderCard(makeBlock({ state: "current" }), { facts: SET_FACTS });
    expect(screen.getByText("Push Pull Legs")).toBeDefined();
    expect(screen.queryByRole("button", { name: /update plan/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /update targets/ })).toBeNull();
  });

  // A fact that has not resolved is not set: nothing to change yet, and nothing
  // claimed either way.
  it("renders no change action while the facts are loading or unavailable", () => {
    const { unmount } = render(
      <BlockCard
        block={makeBlock({ state: "current" })}
        color="#0d9488"
        facts={undefined}
        factsLoading
        factsError={false}
        weight={{ start: null, end: null, change: null }}
        pace={null}
        targetDisplay={null}
        weightUnit="kg"
        defaultOpen
        onPlaceProgram={vi.fn()}
        onSetNutrition={vi.fn()}
      />
    );
    expect(screen.queryByRole("button", { name: /update/ })).toBeNull();
    unmount();

    render(
      <BlockCard
        block={makeBlock({ state: "current" })}
        color="#0d9488"
        facts={SET_FACTS}
        factsLoading={false}
        factsError
        weight={{ start: null, end: null, change: null }}
        pace={null}
        targetDisplay={null}
        weightUnit="kg"
        defaultOpen
        onPlaceProgram={vi.fn()}
        onSetNutrition={vi.fn()}
      />
    );
    expect(screen.getAllByText("Unavailable").length).toBe(2);
    expect(screen.queryByRole("button", { name: /update/ })).toBeNull();
  });
});
