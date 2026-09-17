import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import type { SavedPlan } from "@/types/training";
import type { BlockStartOption } from "@/lib/blocks/block-start-options";

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/hooks/use-nutrition-calendar-events", () => ({
  useInvalidateNutritionCalendar: () => vi.fn(),
}));
// The training area and the Training tab's plan read, spied: an apply
// refreshes the one and clears the other.
const refresh = vi.hoisted(() => ({
  invalidateTrainingData: vi.fn(),
  clearTrainingPlan: vi.fn(),
}));
vi.mock("@/hooks/use-calendar-events", () => ({
  useInvalidateTrainingData: () => refresh.invalidateTrainingData,
}));
vi.mock("@/hooks/use-training-plan", () => ({
  useClearTrainingPlan: () => refresh.clearTrainingPlan,
}));
vi.mock("@/hooks/use-client-overview", () => ({
  useClearClientOverview: () => vi.fn(),
}));
vi.mock("@/hooks/use-attention-feed", () => ({
  useClearAttentionFeed: () => vi.fn(),
}));

// The blocks payload carries the client's blocks, their today and the
// plan-start floor (the deletion floor: today, or tomorrow once the client has
// logged a workout today). Held where the module mock can reach it; null =
// not landed.
const state = vi.hoisted(() => ({
  clientToday: null as string | null,
  planStartFloor: null as string | null,
  blocks: [] as Array<{ id: string; name: string; startsOn: string; endsOn: string }>,
}));
vi.mock("@/components/clients/metrics/hooks/use-client-blocks", () => ({
  useClientBlocks: vi.fn(() => ({
    blocks: state.blocks,
    clientToday: state.clientToday,
    planStartFloor: state.planStartFloor,
    isLoading: false,
    isError: false,
  })),
  useClearBlockFacts: () => vi.fn(),
}));

// The shared picker is a Radix Select; its own test drives the real one. Here
// it is a native select so a pick is one change event and the label
// association (`htmlFor` → the trigger's id) still resolves.
vi.mock("@/components/clients/metrics/blocks/block-start-picker", () => ({
  BlockStartPicker: ({
    id,
    options,
    value,
    onValueChange,
  }: {
    id: string;
    options: readonly BlockStartOption[];
    value: string;
    onValueChange: (value: string) => void;
  }) => (
    <select id={id} value={value} onChange={(e) => onValueChange(e.target.value)}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

import { ApplyToClientDialog } from "./apply-to-client-dialog";
import { useClientBlocks } from "@/components/clients/metrics/hooks/use-client-blocks";
import { getTodayDateString } from "@/lib/date-helpers";

// Fixed dates, deliberately not the machine's: the floor is a server answer.
const TODAY = "2026-02-09";
const TOMORROW = "2026-02-10";
// A block under way at the client's today, the next one, and one that ended.
const CUT = { id: "b-cut", name: "Cut", startsOn: "2026-02-01", endsOn: "2026-02-22" };
const BUILD = { id: "b-build", name: "Build", startsOn: "2026-02-23", endsOn: "2026-03-22" };
const OLD = { id: "b-old", name: "Base", startsOn: "2026-01-05", endsOn: "2026-01-31" };
const PLAN = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "PPL",
  sessions: [],
  programDurationWeeks: 4,
  splitType: null,
} as unknown as SavedPlan;

function renderDialog(
  overrides: Partial<ComponentProps<typeof ApplyToClientDialog>> = {}
) {
  render(
    <ApplyToClientDialog
      open
      onOpenChange={vi.fn()}
      savedPlan={PLAN}
      preselectedClientId="client-1"
      clientName="Chloe"
      {...overrides}
    />
  );
}

const dateField = () => screen.getByLabelText("Start Date");
const blockField = () => screen.getByLabelText("Block");
const blockLabels = () =>
  Array.from(blockField().querySelectorAll("option")).map((o) => o.textContent);

function mockPlacement() {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ success: true, sessionsCreated: 3, eventsCreated: 12 }),
  } as unknown as Response);
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  state.clientToday = TODAY;
  state.planStartFloor = TODAY;
  state.blocks = [OLD, CUT, BUILD];
});

afterEach(() => vi.restoreAllMocks());

// Commit B: a program cannot start on a day the client has already trained —
// the floor is keyed on a logged WORKOUT alone (C2; a meal moves nothing). The
// picker's `min` is the deletion floor, the dialog opens on a usable date, and
// a greyed-out today is explained under the field. The server is the belt;
// this is the affordance.
describe("ApplyToClientDialog — the program's figures", () => {
  it("counts training and rest DAYS, however many sessions a day holds", () => {
    // Two days of two sessions, one of one, and four rest days: 3 training + 4 rest.
    const at = (orderIndex: number, dayOrder: number, isRest = false) => ({
      orderIndex,
      dayOrder,
      weekIndex: 0,
      isRest,
    });
    renderDialog({
      savedPlan: {
        ...PLAN,
        sessions: [at(0, 0), at(0, 1), at(1, 0), at(1, 1), at(2, 0), at(3, 0, true), at(4, 0, true), at(5, 0, true), at(6, 0, true)],
      } as unknown as SavedPlan,
    });
    expect(screen.getByText("3 training + 4 rest")).toBeInTheDocument();
  });
});

describe("ApplyToClientDialog — the start floor", () => {
  it("floors the picker at the server's floor, opens on it, and says why today is greyed", () => {
    state.planStartFloor = TOMORROW;
    renderDialog();

    expect(dateField()).toHaveAttribute("min", TOMORROW);
    expect(dateField()).toHaveValue(TOMORROW);
    expect(screen.getByText(/has already logged/)).toHaveTextContent(
      "Chloe has already logged 9 Feb. A plan can start from 10 Feb."
    );
  });

  it("with today untouched, floors at today, opens on it, and says nothing", () => {
    renderDialog();

    expect(dateField()).toHaveAttribute("min", TODAY);
    expect(dateField()).toHaveValue(TODAY);
    expect(screen.queryByText(/has already logged/)).toBeNull();
  });

  it("reads the payload for the SELECTED client", () => {
    renderDialog();
    expect(useClientBlocks).toHaveBeenCalledWith("client-1");
  });

  it("before the payload lands, the device's today stands in and nothing is claimed", () => {
    state.clientToday = null;
    state.planStartFloor = null;
    state.blocks = [];
    renderDialog();

    expect(dateField()).toHaveAttribute("min", getTodayDateString());
    expect(dateField()).toHaveValue(getTodayDateString());
    expect(dateField()).toBeEnabled();
    expect(blockLabels()).toEqual(["—"]);
    expect(screen.queryByText(/has already logged/)).toBeNull();
  });

  it("the coach's own pick wins, and an emptied field returns to the floor", () => {
    state.planStartFloor = TOMORROW;
    renderDialog();

    fireEvent.change(dateField(), { target: { value: "2026-02-16" } });
    expect(dateField()).toHaveValue("2026-02-16");

    fireEvent.change(dateField(), { target: { value: "" } });
    expect(dateField()).toHaveValue(TOMORROW);
  });

  it("submits the derived date and carries no override flag", async () => {
    state.planStartFloor = TOMORROW;
    const fetchSpy = mockPlacement();
    renderDialog();

    fireEvent.click(screen.getByRole("button", { name: /Apply Plan/ }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/clients/client-1/training/place-from-library");
    const body = JSON.parse(init?.body as string) as Record<string, unknown>;
    expect(body).toEqual({ type: "plan", savedPlanId: PLAN.id, startDate: TOMORROW });
    expect(body).not.toHaveProperty("startAnyway");
    expect(screen.queryByText(/Start anyway/)).toBeNull();
  });

  // The Plans pane never remounts its calendar, so the apply itself refreshes
  // what reads the sessions it laid, for every host of the dialog.
  it("a placement refreshes the client's calendar and clears the plan read", async () => {
    state.planStartFloor = TOMORROW;
    refresh.invalidateTrainingData.mockClear();
    refresh.clearTrainingPlan.mockClear();
    mockPlacement();
    renderDialog();

    fireEvent.click(screen.getByRole("button", { name: /Apply Plan/ }));

    await waitFor(() => expect(refresh.clearTrainingPlan).toHaveBeenCalledWith("client-1"));
    expect(refresh.invalidateTrainingData).toHaveBeenCalledWith("client-1");
  });
});

// D: a Block field above the start date. It leads with the dash — the empty
// state — then the client's blocks whose end is on or after the floor, with
// their ranges. A chosen block FIXES the start on its first available day and
// greys the date field; the dash hands the date back to the coach, floored at
// the deletion floor. The block the coach came from is preselected.
describe("ApplyToClientDialog — the Block field", () => {
  it("sits above Start Date and lists the dash, then the current and future blocks with their ranges", () => {
    renderDialog();
    const field = blockField();
    expect(
      field.compareDocumentPosition(dateField()) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(blockLabels()).toEqual(["—", "Cut · 1 Feb – 22 Feb", "Build · 23 Feb – 22 Mar"]);
    // A block that ended before the floor is not on offer.
    expect(blockLabels().join()).not.toMatch(/Base/);
    expect(field).toHaveValue("none");
    expect(dateField()).toBeEnabled();
  });

  it("the block the coach came from is preselected: a future block fixes the start on its first day and greys the date", () => {
    renderDialog({ preselectedBlockId: BUILD.id });

    expect(blockField()).toHaveValue(BUILD.id);
    expect(dateField()).toHaveValue(BUILD.startsOn);
    expect(dateField()).toBeDisabled();
    expect(dateField()).toHaveAttribute("min", TODAY);
    expect(dateField()).not.toHaveAttribute("max");
  });

  it("a block already under way fixes the start at the floor, not the day it began, and still says why", () => {
    state.planStartFloor = TOMORROW;
    renderDialog({ preselectedBlockId: CUT.id });

    expect(blockField()).toHaveValue(CUT.id);
    expect(dateField()).toHaveValue(TOMORROW);
    expect(dateField()).toBeDisabled();
    expect(screen.getByText(/has already logged/)).toHaveTextContent(
      "Chloe has already logged 9 Feb. A plan can start from 10 Feb."
    );
  });

  it("a round trip from a block no longer listed falls to the dash, and the date stays the coach's", () => {
    renderDialog({ preselectedBlockId: OLD.id });

    expect(blockField()).toHaveValue("none");
    expect(dateField()).toHaveValue(TODAY);
    expect(dateField()).toBeEnabled();
  });

  it("picking a block fixes and greys the date; picking the dash hands it back at the floor", () => {
    renderDialog();

    fireEvent.change(blockField(), { target: { value: BUILD.id } });
    expect(dateField()).toHaveValue(BUILD.startsOn);
    expect(dateField()).toBeDisabled();

    fireEvent.change(blockField(), { target: { value: "none" } });
    expect(dateField()).toHaveValue(TODAY);
    expect(dateField()).toBeEnabled();
    expect(dateField()).toHaveAttribute("min", TODAY);
  });

  it("the coach's own date applies with the dash only, and a block change discards it", () => {
    renderDialog();

    fireEvent.change(dateField(), { target: { value: "2026-02-16" } });
    expect(dateField()).toHaveValue("2026-02-16");

    fireEvent.change(blockField(), { target: { value: BUILD.id } });
    expect(dateField()).toHaveValue(BUILD.startsOn);

    fireEvent.change(blockField(), { target: { value: "none" } });
    expect(dateField()).toHaveValue(TODAY);
  });

  it("submits the chosen block's first available day as the start", async () => {
    const fetchSpy = mockPlacement();
    renderDialog({ preselectedBlockId: BUILD.id });

    fireEvent.click(screen.getByRole("button", { name: /Apply Plan/ }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string) as Record<string, unknown>;
    expect(body).toEqual({ type: "plan", savedPlanId: PLAN.id, startDate: BUILD.startsOn });
  });
});
