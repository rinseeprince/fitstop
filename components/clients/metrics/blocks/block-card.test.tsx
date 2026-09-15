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
// H: a SET fact carries a way in on the same gate, to the RIGHT of the value on
// its line, exactly where "place one" sits after "No program placed", so a
// coach changes a block's programming from the card rather than the calendars.
// Training: a running or planned headline says "edit plan" and opens the plan
// editor on that plan (`onEditPlan`); an ended one can't be edited, so it says
// "update plan" and opens the program list (`onPlaceProgram`), the empty
// state's door. Nutrition: "update targets", through the empty state's handler.

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
      factsError={false}
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
  onEditPlan?: (planId: string) => void;
  onSetNutrition?: () => void;
  facts?: BlockFacts;
} = {}) {
  const { facts = EMPTY_FACTS, ...rest } = handlers;
  return render(
    <BlockCard
      block={block}
      color="#0d9488"
      facts={facts}
      factsError={false}
      defaultOpen
      {...rest}
    />
  );
}

describe("BlockCard — the round-trip empty states", () => {
  it("shows two fact columns, Training and Nutrition, and nothing about weight", () => {
    renderCard(makeBlock({ state: "current" }));
    expect(screen.getByText("Training", { selector: "p" })).toBeDefined();
    expect(screen.getByText("Nutrition", { selector: "p" })).toBeDefined();
    expect(screen.queryByText(/weight/i)).toBeNull();
    expect(screen.queryByText(/kg/)).toBeNull();
  });

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

  // With no plan there is nothing to edit: the empty state's door is the
  // program list, whatever else the card was handed.
  it("keeps place one with the plan editor's handler present, and opens the program list", () => {
    const onPlaceProgram = vi.fn();
    const onEditPlan = vi.fn();
    renderCard(makeBlock({ state: "current" }), { onPlaceProgram, onEditPlan });
    const placeOne = screen.getByRole("button", { name: /No program placed/ });
    expect(placeOne.textContent).toBe("No program placed — place one");
    expect(screen.queryByRole("button", { name: /edit plan|update plan/ })).toBeNull();

    placeOne.click();
    expect(onPlaceProgram).toHaveBeenCalledTimes(1);
    expect(onEditPlan).not.toHaveBeenCalled();
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

describe("BlockCard — the set state's doors (H)", () => {
  it("offers edit plan on a RUNNING headline, beside the value, in place of the empty state", () => {
    renderCard(makeBlock({ state: "current" }), {
      facts: SET_FACTS,
      onPlaceProgram: vi.fn(),
      onEditPlan: vi.fn(),
    });
    const edit = screen.getByRole("button", { name: /edit plan/ });
    expect(column("Training").getByText("Push Pull Legs")).toBeDefined();
    expect(screen.queryByRole("button", { name: /No program placed/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /update plan/ })).toBeNull();
    // ONE grammar and ONE position for the way in: the value, a dash, then the
    // word — the plan's name is INSIDE the same line as the word, to its left,
    // exactly as "No program placed" is to the left of "place one". Never a
    // line of its own under the value, never the label register (a small-caps
    // word beside the column label reads as a title).
    expect(edit.textContent).toBe("Push Pull Legs — edit plan");
    const empty = renderEmpty();
    const placeOne = empty.getByRole("button", { name: /No program placed/ });
    expect(placeOne.textContent).toBe("No program placed — place one");
    expect(edit.className).toBe(placeOne.className);
    expect(edit.querySelector("span:last-child")?.className).toBe(
      placeOne.querySelector("span:last-child")?.className
    );
    expect(edit.className).not.toMatch(/uppercase/);
  });

  // ONE entry per track — the headline. The plan in force today shows; one
  // queued later in the block does not (the timeline lists it), and the day it
  // takes over it becomes the headline, because its state does. The door rides
  // the headline's line, once, and opens the plan it heads.
  it("headlines the plan in force and hides one queued later in the block", () => {
    const onEditPlan = vi.fn();
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
      onEditPlan,
    });
    const doors = screen.getAllByRole("button", { name: /edit plan/ });
    expect(doors).toHaveLength(1);
    expect(doors[0].textContent).toBe("Push Pull Legs — edit plan");
    doors[0].click();
    expect(onEditPlan).toHaveBeenCalledWith("p1");
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
  // the block falling back to "No program placed". An ended program can't be
  // edited, so its door is the program list, the empty state's.
  it("headlines a program that ended early as Ended, with update plan to the program list", () => {
    const onPlaceProgram = vi.fn();
    const onEditPlan = vi.fn();
    renderCard(makeBlock({ state: "current" }), {
      facts: {
        ...SET_FACTS,
        training: [
          { id: "p1", name: "Push Pull Legs", startsOn: "2026-08-03", endsOn: "2026-08-20", state: "ended" },
        ],
      },
      onPlaceProgram,
      onEditPlan,
    });
    const door = screen.getByRole("button", { name: /update plan/ });
    expect(door.textContent).toBe("Push Pull LegsEnded — update plan");
    expect(column("Training").getByText("Ended")).toBeDefined();
    expect(screen.queryByText(/No program placed/)).toBeNull();
    expect(screen.queryByRole("button", { name: /edit plan/ })).toBeNull();

    door.click();
    expect(onPlaceProgram).toHaveBeenCalledTimes(1);
    expect(onEditPlan).not.toHaveBeenCalled();
  });

  it("with nothing in force, headlines the first queued plan as Planned, and edit plan opens it", () => {
    const onPlaceProgram = vi.fn();
    const onEditPlan = vi.fn();
    renderCard(makeBlock({ state: "current" }), {
      facts: {
        ...SET_FACTS,
        training: [
          { id: "p0", name: "Base", startsOn: "2026-07-01", endsOn: "2026-08-10", state: "ended" },
          { id: "p2", name: "Glute Focused", startsOn: "2026-08-12", endsOn: "2026-09-30", state: "upcoming" },
          { id: "p3", name: "Peak", startsOn: "2026-10-01", endsOn: "2026-10-28", state: "upcoming" },
        ],
      },
      onPlaceProgram,
      onEditPlan,
    });
    const training = column("Training");
    expect(training.getByText("Glute Focused")).toBeDefined();
    expect(training.getByText("Planned")).toBeDefined();
    expect(training.queryByText("Base")).toBeNull();
    expect(training.queryByText("Peak")).toBeNull();

    const door = screen.getByRole("button", { name: /edit plan/ });
    expect(door.textContent).toBe("Glute FocusedPlanned — edit plan");
    expect(screen.queryByRole("button", { name: /update plan/ })).toBeNull();
    door.click();
    expect(onEditPlan).toHaveBeenCalledWith("p2");
    expect(onPlaceProgram).not.toHaveBeenCalled();
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

  it("offers edit plan on a set FUTURE block", () => {
    renderCard(makeBlock({ state: "future" }), {
      facts: SET_FACTS,
      onEditPlan: vi.fn(),
    });
    expect(screen.getByRole("button", { name: /edit plan/ })).toBeDefined();
  });

  // The one gate, blockAcceptsSetup, decides for every door on the column: a
  // finished or archived block's headline is plain text in every state.
  it.each(["active", "upcoming", "ended"] as const)(
    "keeps a set ELAPSED block's %s headline as plain text",
    (state) => {
      renderCard(makeBlock({ state: "past" }), {
        facts: { ...SET_FACTS, training: [{ ...SET_FACTS.training[0], state }] },
        onPlaceProgram: vi.fn(),
        onEditPlan: vi.fn(),
      });
      expect(column("Training").getByText("Push Pull Legs")).toBeDefined();
      expect(screen.queryByRole("button", { name: /edit plan|update plan/ })).toBeNull();
    }
  );

  it.each(["active", "upcoming", "ended"] as const)(
    "keeps a set ARCHIVED block's %s headline as plain text, even while current",
    (state) => {
      renderCard(
        makeBlock({ state: "current", archivedAt: "2026-08-20T00:00:00Z" }),
        {
          facts: { ...SET_FACTS, training: [{ ...SET_FACTS.training[0], state }] },
          onPlaceProgram: vi.fn(),
          onEditPlan: vi.fn(),
        }
      );
      expect(column("Training").getByText("Push Pull Legs")).toBeDefined();
      expect(screen.queryByRole("button", { name: /edit plan|update plan/ })).toBeNull();
    }
  );

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

  // A running plan's door opens the plan editor on that plan — never the
  // program list, which would place a new one. Each track's action fires its
  // own handler and never the other's.
  it("edit plan hands the plan editor the headline's plan, not the program list or the nutrition trip", () => {
    const onPlaceProgram = vi.fn();
    const onEditPlan = vi.fn();
    const onSetNutrition = vi.fn();
    renderCard(makeBlock({ state: "current" }), {
      facts: SET_FACTS,
      onPlaceProgram,
      onEditPlan,
      onSetNutrition,
    });
    screen.getByRole("button", { name: /edit plan/ }).click();
    expect(onEditPlan).toHaveBeenCalledTimes(1);
    expect(onEditPlan).toHaveBeenCalledWith("p1");
    expect(onPlaceProgram).not.toHaveBeenCalled();
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
    expect(screen.queryByRole("button", { name: /edit plan|update plan/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /update targets/ })).toBeNull();
  });

  // Each door rides its own handler: the program list's never opens a running
  // plan, and the plan editor's never an ended one.
  it("renders no door when the headline's own handler is missing", () => {
    const { unmount } = renderCard(makeBlock({ state: "current" }), {
      facts: SET_FACTS,
      onPlaceProgram: vi.fn(),
    });
    expect(column("Training").getByText("Push Pull Legs")).toBeDefined();
    expect(screen.queryByRole("button", { name: /edit plan|update plan/ })).toBeNull();
    unmount();

    renderCard(makeBlock({ state: "current" }), {
      facts: { ...SET_FACTS, training: [{ ...SET_FACTS.training[0], state: "ended" }] },
      onEditPlan: vi.fn(),
    });
    expect(column("Training").getByText("Push Pull Legs")).toBeDefined();
    expect(screen.queryByRole("button", { name: /edit plan|update plan/ })).toBeNull();
  });

  // A fact that has not resolved is not set: nothing to change yet, and nothing
  // claimed either way.
  it("renders no change action while the facts are loading or unavailable", () => {
    const { unmount } = render(
      <BlockCard
        block={makeBlock({ state: "current" })}
        color="#0d9488"
        facts={undefined}
        factsError={false}
        defaultOpen
        onPlaceProgram={vi.fn()}
        onEditPlan={vi.fn()}
        onSetNutrition={vi.fn()}
      />
    );
    expect(screen.queryByRole("button", { name: /update|edit plan/ })).toBeNull();
    unmount();

    render(
      <BlockCard
        block={makeBlock({ state: "current" })}
        color="#0d9488"
        facts={SET_FACTS}
        factsError
        defaultOpen
        onPlaceProgram={vi.fn()}
        onEditPlan={vi.fn()}
        onSetNutrition={vi.fn()}
      />
    );
    expect(screen.getAllByText("Couldn't load the plans").length).toBe(3);
    expect(screen.queryByRole("button", { name: /update|edit plan/ })).toBeNull();
  });
});

// The block's plans, before they land, are never rendered as an empty state:
// "No program placed", "Not set" and "Nothing yet." are statements about the
// data, and only a settled read may make one. Every slot the plans fill — both
// columns and the timeline — says the same thing while they are pending, and
// says so when they could not be read.
describe("BlockCard — the plans before they land", () => {
  it("says Loading… in both columns and in What happened while the block has no entry yet", () => {
    render(
      <BlockCard
        block={makeBlock({ state: "current" })}
        color="#0d9488"
        facts={undefined}
        factsError={false}
        defaultOpen
        onPlaceProgram={vi.fn()}
        onSetNutrition={vi.fn()}
      />
    );

    expect(screen.getAllByText("Loading…").length).toBe(3);
    expect(screen.queryByText("No program placed")).toBeNull();
    expect(screen.queryByText("Not set")).toBeNull();
    expect(screen.queryByText("Nothing yet.")).toBeNull();
    expect(screen.queryByText("Block started")).toBeNull();
  });

  it("says the plans couldn't be loaded — in the timeline too, even with an entry in hand", () => {
    // A read that failed after one landed is still a failed read: the entry may
    // be stale, so no slot claims it, the timeline included (its rows carry the
    // per-plan delete).
    render(
      <BlockCard
        block={makeBlock({ state: "current" })}
        color="#0d9488"
        facts={SET_FACTS}
        factsError
        defaultOpen
        onPlaceProgram={vi.fn()}
        onSetNutrition={vi.fn()}
        onDeletePlan={vi.fn()}
      />
    );

    expect(screen.getAllByText("Couldn't load the plans").length).toBe(3);
    expect(screen.queryByText("Push Pull Legs")).toBeNull();
    expect(screen.queryByText("Block started")).toBeNull();
    expect(screen.queryByText("Loading…")).toBeNull();
  });

  it("a block whose settled entry holds nothing keeps its empty states", () => {
    render(
      <BlockCard
        block={makeBlock({ state: "current" })}
        color="#0d9488"
        facts={EMPTY_FACTS}
        factsError={false}
        defaultOpen
        onPlaceProgram={vi.fn()}
        onSetNutrition={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: /No program placed/ })).toBeDefined();
    expect(screen.getByRole("button", { name: /Not set/ })).toBeDefined();
    expect(screen.getByText("Block started")).toBeDefined();
    expect(screen.queryByText("Loading…")).toBeNull();
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
