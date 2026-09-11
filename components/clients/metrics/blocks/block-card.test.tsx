import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
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

// A program placed and targets set inside the block, both in force — both
// set states render. States are the WIRE's (stamped server-side against the
// client's day); the card never derives one.
const SET_FACTS: BlockFacts = {
  blockId: "blk-1",
  training: [
    { id: "p1", name: "Push Pull Legs", startsOn: "2026-08-03", endsOn: "2026-09-30", state: "active" },
  ],
  nutrition: [
    {
      id: "v1",
      startsOn: "2026-08-03",
      endsOn: "2026-09-30",
      state: "active",
      calories: 2140,
      deficitPerDay: 310,
      note: null,
    },
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
      weightUnit="kg"
      defaultOpen
      onPlaceProgram={vi.fn()}
    />,
    { container: host }
  );
}

/** Queries scoped to one fact column. The timeline below the columns lists
 *  every plan by name with its state chip, so an unscoped query for a plan's
 *  name or a state word finds two elements — the column's headline and the
 *  timeline's entry — and the two are asserted separately on purpose. */
function column(label: "Training" | "Nutrition") {
  return within(screen.getByText(label, { selector: "p" }).parentElement as HTMLElement);
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

  // A set block says when its targets run, as the training column says when
  // its program runs — the version's own range under the numbers, in the
  // grammar the card's header spells the block's (C1); a queued prescription
  // on a future block would otherwise show numbers with no dates.
  it("says when the targets run, as a range under the numbers", () => {
    renderCard(makeBlock({ state: "future" }), {
      facts: {
        ...EMPTY_FACTS,
        nutrition: [
          { id: "v1", startsOn: "2026-10-08", endsOn: "2026-11-04", state: "upcoming", calories: 1732, deficitPerDay: 214, note: null },
        ],
      },
    });
    expect(column("Nutrition").getByText("8 Oct – 4 Nov")).toBeDefined();
    expect(screen.queryByText(/from 8 Oct/)).toBeNull();
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

// C1: every plan and version shows its RANGE — the headline's under its value
// on both columns, the timeline's in its date column — "24 Aug – 6 Sep", the
// block header's own grammar; a plan that ran a single day shows one date, and
// the block boundaries keep their single dates. Never "from <date>".
describe("BlockCard — every plan shows its range (C1)", () => {
  const RANGED_FACTS: BlockFacts = {
    blockId: "blk-1",
    training: [
      { id: "p0", name: "Push Pull Legs", startsOn: "2026-08-01", endsOn: "2026-08-14", state: "ended" },
      { id: "p1", name: "Upper Lower", startsOn: "2026-08-15", endsOn: "2026-09-30", state: "active" },
    ],
    nutrition: [
      { id: "v1", startsOn: "2026-08-03", endsOn: "2026-09-30", state: "active", calories: 2140, deficitPerDay: 310, note: "Dropping 100 kcal." },
    ],
  };

  it("the headline's meta line is the plan's range on both columns, not 'from <date>'", () => {
    renderCard(makeBlock({ state: "current" }), { facts: RANGED_FACTS });
    expect(column("Training").getByText("15 Aug – 30 Sep")).toBeDefined();
    expect(column("Nutrition").getByText("3 Aug – 30 Sep")).toBeDefined();
    expect(screen.queryByText(/^from /)).toBeNull();
  });

  it("the timeline lists each plan and version with its range; block boundaries keep one date", () => {
    renderCard(makeBlock({ state: "past", startsOn: "2026-08-01", endsOn: "2026-09-30" }), {
      facts: RANGED_FACTS,
    });
    const timeline = within(screen.getByRole("list"));
    const rows = timeline.getAllByRole("listitem").map((row) => row.textContent);
    expect(rows[0]).toMatch(/^1 AugBlock started$/);
    expect(rows[1]).toMatch(/^1 Aug – 14 AugPush Pull LegsEnded$/);
    expect(rows[2]).toMatch(/^3 Aug – 30 SepNutritionActive2,140 kcal · −310 kcal\/dayDropping 100 kcal\.$/);
    expect(rows[3]).toMatch(/^15 Aug – 30 SepUpper LowerActive$/);
    expect(rows[4]).toMatch(/^30 SepBlock ended$/);
  });

  it("a plan that ran a single day shows one date, not a range of itself", () => {
    renderCard(makeBlock({ state: "current" }), {
      facts: {
        ...EMPTY_FACTS,
        training: [
          { id: "p1", name: "Test Day", startsOn: "2026-08-05", endsOn: "2026-08-05", state: "ended" },
        ],
      },
    });
    expect(column("Training").getByText("5 Aug")).toBeDefined();
    const rows = within(screen.getByRole("list")).getAllByRole("listitem").map((r) => r.textContent);
    expect(rows).toContain("5 AugTest DayEnded");
    expect(screen.queryByText(/5 Aug – 5 Aug/)).toBeNull();
  });
});

describe("BlockCard — the set state's update affordance (H)", () => {
  it("offers update plan on a set CURRENT block, beside the value, in place of the empty state", () => {
    renderCard(makeBlock({ state: "current" }), {
      facts: SET_FACTS,
      onPlaceProgram: vi.fn(),
    });
    const update = screen.getByRole("button", { name: /update plan/ });
    expect(column("Training").getByText("Push Pull Legs")).toBeDefined();
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

  // ONE entry per track — the headline. The plan in force today shows; one
  // queued later in the block does not (the timeline lists it), and the day it
  // takes over it becomes the headline, because its state does. The door rides
  // the headline's line, once.
  it("headlines the plan in force and hides one queued later in the block", () => {
    renderCard(makeBlock({ state: "current" }), {
      facts: {
        ...SET_FACTS,
        training: [
          ...SET_FACTS.training,
          // Queued INSIDE the block (starts before its end), so the timeline
          // lists it while the column does not.
          { id: "p2", name: "Glute Focused", startsOn: "2026-09-14", endsOn: "2026-10-28", state: "upcoming" },
        ],
      },
      onPlaceProgram: vi.fn(),
    });
    const doors = screen.getAllByRole("button", { name: /update plan/ });
    expect(doors).toHaveLength(1);
    expect(doors[0].textContent).toBe("Push Pull Legs — update plan");
    const training = column("Training");
    expect(training.queryByText("Glute Focused")).toBeNull();
    expect(training.queryByText("Active")).toBeNull();
    // The timeline keeps the whole story: both plans, each with its state —
    // and the targets in force, so two entries read Active.
    expect(screen.getByText("Glute Focused")).toBeDefined();
    expect(screen.getByText("Planned")).toBeDefined();
    expect(screen.getAllByText("Active")).toHaveLength(2);
  });

  // Owner, 2026-09-11: a program that ended early with nothing queued after it
  // still headlines its block — as ended, with the door beside it — rather than
  // the block falling back to "No program placed".
  it("headlines a program that ended early with nothing after it, as Ended, with the door", () => {
    renderCard(makeBlock({ state: "current" }), {
      facts: {
        ...SET_FACTS,
        training: [
          { id: "p1", name: "Push Pull Legs", startsOn: "2026-08-03", endsOn: "2026-08-20", state: "ended" },
        ],
      },
      onPlaceProgram: vi.fn(),
    });
    const door = screen.getByRole("button", { name: /update plan/ });
    expect(door.textContent).toBe("Push Pull LegsEnded — update plan");
    expect(column("Training").getByText("Ended")).toBeDefined();
    expect(screen.queryByText(/No program placed/)).toBeNull();
  });

  it("with nothing in force, headlines the first queued plan as Planned", () => {
    renderCard(makeBlock({ state: "current" }), {
      facts: {
        ...SET_FACTS,
        training: [
          { id: "p0", name: "Base", startsOn: "2026-07-01", endsOn: "2026-08-10", state: "ended" },
          { id: "p2", name: "Glute Focused", startsOn: "2026-08-12", endsOn: "2026-09-30", state: "upcoming" },
          { id: "p3", name: "Peak", startsOn: "2026-10-01", endsOn: "2026-10-28", state: "upcoming" },
        ],
      },
    });
    const training = column("Training");
    expect(training.getByText("Glute Focused")).toBeDefined();
    expect(training.getByText("Planned")).toBeDefined();
    expect(training.queryByText("Base")).toBeNull();
    expect(training.queryByText("Peak")).toBeNull();
  });

  it("nutrition headlines by the same rule — an early-ended version reads Ended with the door", () => {
    renderCard(makeBlock({ state: "current" }), {
      facts: {
        ...SET_FACTS,
        // In start order, the wire's contract: the earlier version first.
        nutrition: [
          { id: "v0", startsOn: "2026-07-01", endsOn: "2026-08-02", state: "ended", calories: 2600, deficitPerDay: 100, note: null },
          { ...SET_FACTS.nutrition[0], endsOn: "2026-08-20", state: "ended" },
        ],
      },
      onSetNutrition: vi.fn(),
    });
    const door = screen.getByRole("button", { name: /update targets/ });
    expect(door.textContent).toContain("2,140");
    expect(door.textContent).toContain("Ended");
    expect(column("Nutrition").queryByText("2,600")).toBeNull();
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
    expect(column("Training").getByText("Push Pull Legs")).toBeDefined();
    expect(screen.queryByRole("button", { name: /update plan/ })).toBeNull();
  });

  it("keeps a set ARCHIVED block's program as plain text, even while current", () => {
    renderCard(
      makeBlock({ state: "current", archivedAt: "2026-08-20T00:00:00Z" }),
      { facts: SET_FACTS, onPlaceProgram: vi.fn() }
    );
    expect(column("Training").getByText("Push Pull Legs")).toBeDefined();
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
    expect(column("Training").getByText("Push Pull Legs")).toBeDefined();
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

// C3: the per-plan delete. A hover-revealed destructive icon on the timeline
// rows whose plan is active or upcoming — on current and future blocks only,
// the same gate as the way in — carrying the row's plan to the handler. Ended
// rows, block rows, elapsed and archived blocks carry none.
describe("BlockCard — the per-plan delete (C3)", () => {
  const DELETE_FACTS: BlockFacts = {
    blockId: "blk-1",
    training: [
      { id: "p0", name: "Push Pull Legs", startsOn: "2026-08-01", endsOn: "2026-08-14", state: "ended" },
      { id: "p1", name: "Upper Lower", startsOn: "2026-08-15", endsOn: "2026-09-13", state: "active" },
      { id: "p2", name: "Glute Focused", startsOn: "2026-09-14", endsOn: "2026-09-30", state: "upcoming" },
    ],
    nutrition: [
      { id: "v1", startsOn: "2026-08-03", endsOn: "2026-09-13", state: "active", calories: 2200, deficitPerDay: 343, note: null },
      { id: "v2", startsOn: "2026-09-14", endsOn: "2026-09-30", state: "upcoming", calories: 2100, deficitPerDay: 443, note: null },
    ],
  };
  const deleteButtons = () => screen.queryAllByRole("button", { name: /^(End|Remove) / });

  it("offers the icon on the active and upcoming rows of a CURRENT block, never on an ended row or a block row", () => {
    renderCard(makeBlock({ state: "current" }), { facts: DELETE_FACTS, onDeletePlan: vi.fn() } as never);

    expect(deleteButtons().map((button) => button.getAttribute("aria-label"))).toEqual([
      "End the nutrition targets",
      "End Upper Lower",
      "Remove Glute Focused",
      "Remove the nutrition targets",
    ]);
    expect(screen.queryByRole("button", { name: /Push Pull Legs/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Block started/ })).toBeNull();
  });

  it("hands the handler the row's plan — its track, id, name, state and range", () => {
    const onDeletePlan = vi.fn();
    renderCard(makeBlock({ state: "current" }), { facts: DELETE_FACTS, onDeletePlan } as never);

    screen.getByRole("button", { name: "Remove Glute Focused" }).click();
    expect(onDeletePlan).toHaveBeenCalledWith({
      track: "training",
      id: "p2",
      name: "Glute Focused",
      state: "upcoming",
      startsOn: "2026-09-14",
      endsOn: "2026-09-30",
    });

    screen.getByRole("button", { name: "End the nutrition targets" }).click();
    expect(onDeletePlan).toHaveBeenLastCalledWith({
      track: "nutrition",
      id: "v1",
      name: null,
      state: "active",
      startsOn: "2026-08-03",
      endsOn: "2026-09-13",
    });
  });

  it("offers the icon on a FUTURE block's queued rows", () => {
    renderCard(makeBlock({ state: "future" }), {
      facts: {
        ...EMPTY_FACTS,
        training: [{ id: "p2", name: "Glute Focused", startsOn: "2026-08-05", endsOn: "2026-09-30", state: "upcoming" }],
      },
      onDeletePlan: vi.fn(),
    } as never);

    expect(deleteButtons()).toHaveLength(1);
  });

  it("offers no icon on an ELAPSED block, an ARCHIVED block, or without a handler", () => {
    const { unmount } = renderCard(makeBlock({ state: "past" }), { facts: DELETE_FACTS, onDeletePlan: vi.fn() } as never);
    expect(deleteButtons()).toHaveLength(0);
    unmount();

    const archived = renderCard(
      makeBlock({ state: "current", archivedAt: "2026-08-20T00:00:00Z" }),
      { facts: DELETE_FACTS, onDeletePlan: vi.fn() } as never
    );
    expect(deleteButtons()).toHaveLength(0);
    archived.unmount();

    renderCard(makeBlock({ state: "current" }), { facts: DELETE_FACTS });
    expect(deleteButtons()).toHaveLength(0);
  });

  it("the icon is hover-revealed and destructive on hover — the block rows' own grammar", () => {
    renderCard(makeBlock({ state: "current" }), { facts: DELETE_FACTS, onDeletePlan: vi.fn() } as never);
    const icon = screen.getByRole("button", { name: "End Upper Lower" });
    expect(icon.className).toMatch(/opacity-0/);
    expect(icon.className).toMatch(/group-hover\/entry:opacity-100/);
    expect(icon.className).toMatch(/hover:text-\[#c06060\]/);
  });
});

// The Weight column is the block's weight change and nothing else: the reading
// at its start, then the latest, then the unit — or a dash when either is
// missing. A block carries no target and no goal, so nothing here is judged.
describe("BlockCard — the Weight column", () => {
  const weightColumn = () =>
    screen.getByText("Weight", { selector: "p" }).parentElement as HTMLElement;

  it("reads the two readings and the unit, and nothing else", () => {
    render(
      <BlockCard
        block={makeBlock({ state: "current" })}
        color="#0d9488"
        facts={EMPTY_FACTS}
        factsLoading={false}
        factsError={false}
        weight={{
          start: { value: 88, date: "2026-08-01" },
          end: { value: 85.5, date: "2026-09-10" },
          change: -2.5,
        }}
        weightUnit="kg"
        defaultOpen
      />
    );
    expect(weightColumn().textContent).toBe("Weight88.0 → 85.5 kg");
  });

  it("shows a dash when either reading is missing", () => {
    render(
      <BlockCard
        block={makeBlock({ state: "current" })}
        color="#0d9488"
        facts={EMPTY_FACTS}
        factsLoading={false}
        factsError={false}
        weight={{ start: null, end: { value: 85.5, date: "2026-09-10" }, change: null }}
        weightUnit="kg"
        defaultOpen
      />
    );
    expect(weightColumn().textContent).toBe("Weight—");
  });
});
