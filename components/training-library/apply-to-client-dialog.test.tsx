import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import type { SavedPlan } from "@/types/training";

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/hooks/use-nutrition-calendar-events", () => ({
  useInvalidateNutritionCalendar: () => vi.fn(),
}));
// The training area and the Training tab's plan read, spied: an apply
// refreshes the one and clears the other. The plan read also carries the
// client's today and the plan-start floor (the deletion floor: today, or
// tomorrow once the client has logged a workout today), held where the module
// mock can reach them; null = not landed.
const refresh = vi.hoisted(() => ({
  invalidateTrainingData: vi.fn(),
  clearTrainingPlan: vi.fn(),
}));
const state = vi.hoisted(() => ({
  clientToday: null as string | null,
  planStartFloor: null as string | null,
}));
vi.mock("@/hooks/use-calendar-events", () => ({
  useInvalidateTrainingData: () => refresh.invalidateTrainingData,
}));
vi.mock("@/hooks/use-training-plan", () => ({
  useClearTrainingPlan: () => refresh.clearTrainingPlan,
  useTrainingPlan: vi.fn(() => ({
    clientToday: state.clientToday,
    planStartFloor: state.planStartFloor,
  })),
}));
vi.mock("@/hooks/use-client-overview", () => ({
  useClearClientOverview: () => vi.fn(),
}));
vi.mock("@/hooks/use-attention-feed", () => ({
  useClearAttentionFeed: () => vi.fn(),
}));

import { ApplyToClientDialog } from "./apply-to-client-dialog";
import { useTrainingPlan } from "@/hooks/use-training-plan";
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

  it("reads the floor from the SELECTED client's plan read", () => {
    renderDialog();
    expect(useTrainingPlan).toHaveBeenCalledWith({ clientId: "client-1" });
  });

  it("before the read lands, the device's today stands in and nothing is claimed", () => {
    state.clientToday = null;
    state.planStartFloor = null;
    renderDialog();

    expect(dateField()).toHaveAttribute("min", getTodayDateString());
    expect(dateField()).toHaveValue(getTodayDateString());
    expect(dateField()).toBeEnabled();
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

// The start is a plain date field (SD6, docs/SUNSET-PLAN.md): no Block field
// above it, never disabled, floored at the deletion floor and opening on it.
describe("ApplyToClientDialog — the start field", () => {
  it("has a start-date field and no Block field", () => {
    renderDialog();
    expect(dateField()).toBeEnabled();
    expect(screen.queryByLabelText("Block")).toBeNull();
  });
});
