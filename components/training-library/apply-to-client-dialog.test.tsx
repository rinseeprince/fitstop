import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import type { SavedPlan } from "@/types/training";

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

// The blocks payload carries the client's today and the plan-start floor (the
// shared deletion floor: today, or tomorrow once the client has logged today);
// the round-trip seed is the block start the coach came from. Both held where
// the module mocks can reach them; null = not landed / no round trip.
const state = vi.hoisted(() => ({
  clientToday: null as string | null,
  planStartFloor: null as string | null,
  blockStart: null as string | null,
}));
vi.mock("@/components/clients/metrics/hooks/use-client-blocks", () => ({
  useClientBlocks: vi.fn(() => ({
    blocks: [],
    clientToday: state.clientToday,
    planStartFloor: state.planStartFloor,
    isLoading: false,
    isError: false,
  })),
  useClearBlockFacts: () => vi.fn(),
}));
vi.mock("@/components/clients/metrics/hooks/use-round-trip-block", () => ({
  useRoundTripBlockStart: () => state.blockStart,
}));

import { ApplyToClientDialog } from "./apply-to-client-dialog";
import { useClientBlocks } from "@/components/clients/metrics/hooks/use-client-blocks";
import { getTodayDateString } from "@/lib/date-helpers";

// Fixed dates, deliberately not the machine's: the floor is a server answer.
const TODAY = "2026-02-09";
const TOMORROW = "2026-02-10";
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

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  state.clientToday = TODAY;
  state.planStartFloor = TODAY;
  state.blockStart = null;
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

  it("the round-trip block start wins only when it is past the floor", () => {
    state.planStartFloor = TOMORROW;
    state.blockStart = "2026-02-20";
    renderDialog();
    expect(dateField()).toHaveValue("2026-02-20");

    cleanup();
    // A block already under way seeds the floor, not the day it began.
    state.blockStart = "2026-02-01";
    renderDialog();
    expect(dateField()).toHaveValue(TOMORROW);
  });

  it("before the payload lands, the device's today stands in and nothing is claimed", () => {
    state.clientToday = null;
    state.planStartFloor = null;
    renderDialog();

    expect(dateField()).toHaveAttribute("min", getTodayDateString());
    expect(dateField()).toHaveValue(getTodayDateString());
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
