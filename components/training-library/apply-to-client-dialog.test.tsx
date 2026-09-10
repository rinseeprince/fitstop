import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import type { SavedPlan } from "@/types/training";
import type { BlockStartOption } from "@/lib/blocks/block-start-options";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/hooks/use-nutrition-calendar-events", () => ({
  useInvalidateNutritionCalendar: () => vi.fn(),
}));
vi.mock("@/hooks/use-calendar-events", () => ({
  useInvalidateTrainingData: () => vi.fn(),
}));
vi.mock("@/hooks/use-client-overview", () => ({
  useClearClientOverview: () => vi.fn(),
}));
vi.mock("@/hooks/use-attention-feed", () => ({
  useClearAttentionFeed: () => vi.fn(),
}));

// The blocks payload carries the client's blocks, their today and the
// plan-start floor (the shared deletion floor: today, or tomorrow once the
// client has logged today). Held where the module mock can reach it; null =
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

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  state.clientToday = TODAY;
  state.planStartFloor = TODAY;
  state.blocks = [OLD, CUT, BUILD];
});

afterEach(() => vi.restoreAllMocks());

// Commit B: a plan cannot start on a day the client has already logged. The
// picker's `min` is the shared deletion floor, the dialog opens on a usable
// date, and a greyed-out today is explained under the field. The server is
// the belt; this is the affordance.
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
    expect(dateField()).not.toHaveAttribute("max");
    expect(blockLabels()).toEqual(["No block — pick a date"]);
    expect(screen.queryByText(/has already logged/)).toBeNull();
  });

  it("the coach's own pick wins, and an emptied field returns to the seed", () => {
    state.planStartFloor = TOMORROW;
    renderDialog();

    fireEvent.change(dateField(), { target: { value: "2026-02-16" } });
    expect(dateField()).toHaveValue("2026-02-16");

    fireEvent.change(dateField(), { target: { value: "" } });
    expect(dateField()).toHaveValue(TOMORROW);
  });

  it("submits the derived date and carries no override flag", async () => {
    state.planStartFloor = TOMORROW;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true, sessionsCreated: 3, eventsCreated: 12 }),
    } as unknown as Response);
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
});

// D: a Block field above the start date. It lists the client's blocks whose end
// is on or after the floor with their ranges, then No block; choosing one sets
// the start and BOUNDS the picker to the block's window (min/max natively — the
// server keeps its own checks); the block the coach came from is preselected.
describe("ApplyToClientDialog — the Block field", () => {
  it("sits above Start Date, lists the current and future blocks with their ranges, then No block", () => {
    renderDialog();
    const field = blockField();
    expect(
      field.compareDocumentPosition(dateField()) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(blockLabels()).toEqual([
      "Cut · 1 Feb – 22 Feb",
      "Build · 23 Feb – 22 Mar",
      "No block — pick a date",
    ]);
    // A block that ended before the floor is not on offer.
    expect(blockLabels().join()).not.toMatch(/Base/);
    expect(field).toHaveValue("none");
  });

  it("the block the coach came from is preselected: a future block seeds its start and bounds the date to it", () => {
    renderDialog({ preselectedBlockId: BUILD.id });

    expect(blockField()).toHaveValue(BUILD.id);
    expect(dateField()).toHaveValue(BUILD.startsOn);
    expect(dateField()).toHaveAttribute("min", BUILD.startsOn);
    expect(dateField()).toHaveAttribute("max", BUILD.endsOn);
  });

  it("a block already under way seeds the floor, not the day it began", () => {
    state.planStartFloor = TOMORROW;
    renderDialog({ preselectedBlockId: CUT.id });

    expect(blockField()).toHaveValue(CUT.id);
    expect(dateField()).toHaveValue(TOMORROW);
    expect(dateField()).toHaveAttribute("min", TOMORROW);
    expect(dateField()).toHaveAttribute("max", CUT.endsOn);
  });

  it("a round trip from a block no longer listed falls to No block", () => {
    renderDialog({ preselectedBlockId: OLD.id });

    expect(blockField()).toHaveValue("none");
    expect(dateField()).toHaveValue(TODAY);
    expect(dateField()).not.toHaveAttribute("max");
  });

  it("picking a block sets the date and its bounds; picking No block clears the ceiling", () => {
    renderDialog();

    fireEvent.change(blockField(), { target: { value: BUILD.id } });
    expect(dateField()).toHaveValue(BUILD.startsOn);
    expect(dateField()).toHaveAttribute("min", BUILD.startsOn);
    expect(dateField()).toHaveAttribute("max", BUILD.endsOn);

    fireEvent.change(blockField(), { target: { value: "none" } });
    expect(dateField()).toHaveValue(TODAY);
    expect(dateField()).toHaveAttribute("min", TODAY);
    expect(dateField()).not.toHaveAttribute("max");
  });

  it("the coach's own date wins inside the window, and a block change re-seeds it", () => {
    renderDialog();

    fireEvent.change(blockField(), { target: { value: BUILD.id } });
    fireEvent.change(dateField(), { target: { value: "2026-03-02" } });
    expect(dateField()).toHaveValue("2026-03-02");

    fireEvent.change(blockField(), { target: { value: CUT.id } });
    expect(dateField()).toHaveValue(TODAY);
    expect(dateField()).toHaveAttribute("max", CUT.endsOn);
  });

  it("submits the selected block's first available day as the start", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true, sessionsCreated: 3, eventsCreated: 12 }),
    } as unknown as Response);
    renderDialog({ preselectedBlockId: BUILD.id });

    fireEvent.click(screen.getByRole("button", { name: /Apply Plan/ }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string) as Record<string, unknown>;
    expect(body).toEqual({ type: "plan", savedPlanId: PLAN.id, startDate: BUILD.startsOn });
  });
});
