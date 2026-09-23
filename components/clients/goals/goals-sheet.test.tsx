import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ClientGoalsOverview, CurrentGoal, GoalOnDay } from "@/types/client-goals";

// The goals behind the Overview goal card's pencil (docs/MEASUREMENT-LOG-PLAN.md
// §6 commit 8d2). The goals read is a small store the mocked writes land their
// answers in, so the list re-renders from what a write returned, exactly as
// the seeded SWR read does.

const { goalsStore, api, toast } = vi.hoisted(() => {
  let state: unknown = null;
  const listeners = new Set<() => void>();
  return {
    goalsStore: {
      get: () => state,
      set: (next: unknown) => {
        state = next;
        listeners.forEach((listener) => listener());
      },
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      flags: { isLoading: false, isError: false },
      retry: vi.fn(),
    },
    api: {
      run: vi.fn(),
      remove: vi.fn(),
      land: vi.fn(),
    },
    toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
  };
});

vi.mock("@/hooks/use-client-goals", async () => {
  const React = await import("react");
  return {
    useClientGoals: () => {
      const data = React.useSyncExternalStore(goalsStore.subscribe, goalsStore.get) as ClientGoalsOverview;
      return { ...data, ...goalsStore.flags, retry: goalsStore.retry };
    },
  };
});
vi.mock("./use-goal-writes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./use-goal-writes")>()),
  useGoalWrites: () => api,
}));
vi.mock("@/contexts/units-context", () => ({
  useUnits: () => ({ preference: "metric", isLoading: false, error: null }),
}));
vi.mock("sonner", () => ({ toast }));

import { GoalsSheet } from "./goals-sheet";
import { GoalRefusal } from "./use-goal-writes";

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;
Element.prototype.scrollIntoView = () => {};
Element.prototype.hasPointerCapture = () => false;
Element.prototype.releasePointerCapture = () => {};

const TODAY = "2026-10-07";

const CURRENT: CurrentGoal = {
  id: "goal-lean",
  clientId: "client-2",
  name: "Lean out",
  type: "lose_weight",
  targetWeight: 79.2,
  targetBodyFatPercentage: null,
  description: "Feel lighter on the bike",
  startsOn: "2026-08-10",
  source: "coach",
  setBy: "coach-1",
  createdAt: "2026-08-10T08:00:00Z",
  updatedAt: "2026-08-10T08:00:00Z",
  deadline: "2026-12-04",
  startReadings: { weight: 86.4, bodyFat: null },
};

const PLANNED: GoalOnDay = {
  id: "goal-peak",
  clientId: "client-2",
  name: "Peak",
  type: "build_muscle",
  targetWeight: 84.6,
  targetBodyFatPercentage: null,
  description: null,
  startsOn: "2026-12-14",
  source: "coach",
  setBy: "coach-1",
  createdAt: "2026-09-30T08:00:00Z",
  updatedAt: "2026-09-30T08:00:00Z",
  deadline: "2027-02-19",
};

const OVERVIEW: ClientGoalsOverview = {
  current: CURRENT,
  planned: [PLANNED],
  clientToday: TODAY,
};

/** What a write answers with: the goals as they now stand. */
const ANSWER: ClientGoalsOverview = {
  current: { ...CURRENT, targetWeight: 77.6 },
  planned: [],
  clientToday: TODAY,
};

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function renderSheet(overview: ClientGoalsOverview = OVERVIEW) {
  goalsStore.set(overview);
  render(
    <GoalsSheet
      clientId="client-2"
      clientName="Alex Kim"
      open
      onOpenChange={vi.fn()}
      readings={{ weight: 82.3, bodyFat: 21.7 }}
    />
  );
  return userEvent.setup();
}

const saveButton = () => screen.getByRole("button", { name: "Save goal" });
const formOpen = () => screen.queryByRole("button", { name: "Save goal" }) !== null;

async function chooseType(name: string) {
  fireEvent.keyDown(screen.getByRole("combobox", { name: "Goal type" }), { key: "ArrowDown" });
  fireEvent.keyDown(await screen.findByRole("option", { name }), { key: "Enter" });
}

beforeEach(() => {
  vi.clearAllMocks();
  // A queued answer a failed test never used must not reach the next one.
  for (const write of Object.values(api)) write.mockReset();
  goalsStore.flags.isLoading = false;
  goalsStore.flags.isError = false;
  api.land.mockImplementation((answer: ClientGoalsOverview) => goalsStore.set(answer));
});

afterEach(() => cleanup());

describe("the goals sheet — the list", () => {
  it("lists today's goal and the planned ones, each with its type, targets and days", () => {
    renderSheet();

    expect(screen.getByText("Lean out")).toBeInTheDocument();
    expect(screen.getByText("Lose weight · 79.2 kg · since 10 Aug · by 4 Dec")).toBeInTheDocument();
    expect(screen.getByText("Peak")).toBeInTheDocument();
    expect(screen.getByText("Build muscle · 84.6 kg · from 14 Dec · by 19 Feb")).toBeInTheDocument();
    for (const name of ["Lean out", "Peak"]) {
      expect(screen.getByRole("button", { name: `Edit ${name}` })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: `Delete ${name}` })).toBeInTheDocument();
    }
  });

  it("says there is no current goal, and still offers Plan a goal", () => {
    renderSheet({ ...OVERVIEW, current: null, planned: [] });

    expect(screen.getByText("No current goal")).toBeInTheDocument();
    expect(screen.queryByText("Planned")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Plan a goal" })).toBeInTheDocument();
  });

  it("calls event prep's deadline its event day", () => {
    renderSheet({
      ...OVERVIEW,
      planned: [{ ...PLANNED, name: "Race", type: "event_prep", targetWeight: null, deadline: "2027-03-13" }],
    });

    expect(screen.getByText("Event prep · from 14 Dec · event day 13 Mar")).toBeInTheDocument();
  });

  it("claims nothing while the read is in flight, and offers Try again when it fails", async () => {
    goalsStore.flags.isLoading = true;
    renderSheet();
    expect(screen.queryByText("No current goal")).not.toBeInTheDocument();
    expect(screen.queryByText("Lean out")).not.toBeInTheDocument();
    cleanup();

    goalsStore.flags.isLoading = false;
    goalsStore.flags.isError = true;
    const user = renderSheet();
    expect(screen.getByText("Couldn't load the goals")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(goalsStore.retry).toHaveBeenCalled();
  });
});

describe("the goals sheet — planning a goal", () => {
  it("asks for the type first, then what that type uses, with the start floored on the client's today", async () => {
    const user = renderSheet();
    await user.click(screen.getByRole("button", { name: "Plan a goal" }));

    expect(screen.getByRole("combobox", { name: "Goal type" })).toHaveTextContent("Choose a type");
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();

    await chooseType("Build muscle");
    expect(screen.getByLabelText("Name")).toHaveValue("Build muscle");
    expect(screen.getByLabelText("Target weight (kg)")).toBeInTheDocument();
    expect(screen.queryByLabelText("Target body fat (%)")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Starts")).toHaveAttribute("min", TODAY);
    expect(screen.getByLabelText("Deadline")).toHaveAttribute("min", TODAY);
    expect(screen.getByLabelText("Description")).toBeInTheDocument();

    await chooseType("Recomp");
    expect(screen.getByLabelText("Name")).toHaveValue("Recomp");
    expect(screen.queryByLabelText("Target weight (kg)")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Target body fat (%)")).toBeInTheDocument();

    await chooseType("Event prep");
    expect(screen.getByLabelText("Event day")).toBeInTheDocument();
    expect(screen.queryByLabelText(/Target/)).not.toBeInTheDocument();
  });

  it("keeps a name the coach typed through a change of type", async () => {
    const user = renderSheet();
    await user.click(screen.getByRole("button", { name: "Plan a goal" }));
    await chooseType("Lose weight");
    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "Summer cut");

    await chooseType("Maintain");
    expect(screen.getByLabelText("Name")).toHaveValue("Summer cut");
  });

  it("says what is missing and writes nothing", async () => {
    const user = renderSheet();
    await user.click(screen.getByRole("button", { name: "Plan a goal" }));
    await user.click(saveButton());
    // The placeholder, and the line under the empty select.
    expect(screen.getAllByText("Choose a type")).toHaveLength(2);

    await chooseType("Lose weight");
    await user.click(saveButton());
    expect(screen.getByText("Enter a target weight")).toBeInTheDocument();
    expect(screen.getByText("Choose a start day")).toBeInTheDocument();
    expect(api.run).not.toHaveBeenCalled();
  });

  // The frame test: the form stays open, busy, until the write answers; the
  // answer is landed and the form closed together, so no frame shows the list
  // without the goal just planned.
  it("plans the goal, then lands its answer and closes the form together", async () => {
    const write = deferred<ClientGoalsOverview>();
    api.run.mockReturnValue(write.promise);
    const user = renderSheet();
    await user.click(screen.getByRole("button", { name: "Plan a goal" }));
    await chooseType("Build muscle");
    await user.type(screen.getByLabelText("Target weight (kg)"), "88.7");
    fireEvent.change(screen.getByLabelText("Starts"), { target: { value: "2026-10-26" } });
    await user.click(saveButton());

    expect(api.run).toHaveBeenCalledWith({
      kind: "add",
      body: {
        type: "build_muscle",
        name: "Build muscle",
        targetWeight: 88.7,
        targetBodyFatPercentage: null,
        description: null,
        deadline: null,
        startsOn: "2026-10-26",
      },
    });
    expect(saveButton()).toBeDisabled();
    expect(api.land).not.toHaveBeenCalled();

    await act(async () => {
      write.resolve(ANSWER);
      await write.promise;
    });
    expect(api.land).toHaveBeenCalledWith(ANSWER);
    expect(formOpen()).toBe(false);
    expect(toast.success).toHaveBeenCalledWith("Goal saved");
  });
});

describe("the goals sheet — editing a goal", () => {
  it("opens today's goal as it stands, with no start day to change", async () => {
    const user = renderSheet();
    await user.click(screen.getByRole("button", { name: "Edit Lean out" }));

    expect(screen.getByRole("combobox", { name: "Goal type" })).toHaveTextContent("Lose weight");
    expect(screen.getByLabelText("Name")).toHaveValue("Lean out");
    expect(screen.getByLabelText("Target weight (kg)")).toHaveValue("79.2");
    expect(screen.getByLabelText("Deadline")).toHaveValue("2026-12-04");
    expect(screen.getByLabelText("Description")).toHaveValue("Feel lighter on the bike");
    expect(screen.queryByLabelText("Starts")).not.toBeInTheDocument();
  });

  it("records a new deadline against the goal, and closes on its answer", async () => {
    api.run.mockResolvedValue(ANSWER);
    const user = renderSheet();
    await user.click(screen.getByRole("button", { name: "Edit Lean out" }));
    fireEvent.change(screen.getByLabelText("Deadline"), { target: { value: "2027-01-08" } });
    await user.click(saveButton());

    await waitFor(() => expect(api.land).toHaveBeenCalledWith(ANSWER));
    expect(api.run).toHaveBeenCalledTimes(1);
    expect(api.run).toHaveBeenCalledWith({ kind: "deadline", goalId: "goal-lean", deadline: "2027-01-08" });
    expect(formOpen()).toBe(false);
  });

  it("says a changed target starts a new goal from today, and saves it as one", async () => {
    api.run.mockResolvedValue(ANSWER);
    const user = renderSheet();
    await user.click(screen.getByRole("button", { name: "Edit Lean out" }));
    expect(screen.queryByText("This starts a new goal from today.")).not.toBeInTheDocument();
    // A running goal's deadline may fall on any day from its start.
    expect(screen.getByLabelText("Deadline")).toHaveAttribute("min", "2026-08-10");

    await user.clear(screen.getByLabelText("Target weight (kg)"));
    await user.type(screen.getByLabelText("Target weight (kg)"), "77.6");
    expect(screen.getByText("This starts a new goal from today.")).toBeInTheDocument();
    // …and a new goal's from today.
    expect(screen.getByLabelText("Deadline")).toHaveAttribute("min", TODAY);
    await user.click(saveButton());

    await waitFor(() => expect(api.run).toHaveBeenCalled());
    expect(api.run).toHaveBeenCalledWith({
      kind: "add",
      body: expect.objectContaining({ type: "lose_weight", targetWeight: 77.6, startsOn: TODAY }),
    });
  });

  it("warns when a target points the other way from the type, and still saves", async () => {
    api.run.mockResolvedValue(ANSWER);
    const user = renderSheet();
    await user.click(screen.getByRole("button", { name: "Edit Lean out" }));
    await user.clear(screen.getByLabelText("Target weight (kg)"));
    await user.type(screen.getByLabelText("Target weight (kg)"), "83.1");

    expect(screen.getByText("This target is above their current weight (82.3 kg).")).toBeInTheDocument();
    await user.click(saveButton());
    await waitFor(() => expect(api.run).toHaveBeenCalled());
  });

  it("gives a planned goal its start day to move, floored on the client's today", async () => {
    api.run.mockResolvedValue(ANSWER);
    const user = renderSheet();
    await user.click(screen.getByRole("button", { name: "Edit Peak" }));

    expect(screen.getByLabelText("Starts")).toHaveValue("2026-12-14");
    expect(screen.getByLabelText("Starts")).toHaveAttribute("min", TODAY);
    fireEvent.change(screen.getByLabelText("Starts"), { target: { value: "2026-12-28" } });
    await user.click(saveButton());

    await waitFor(() => expect(api.run).toHaveBeenCalled());
    expect(api.run).toHaveBeenCalledWith({
      kind: "edit",
      goalId: "goal-peak",
      body: expect.objectContaining({ startsOn: "2026-12-28", targetWeight: 84.6 }),
    });
  });

  // Targets are asked for where the save writes them. A goal that started
  // before today writes none unless the save makes a new goal, so a target it
  // has always lacked, or one out of today's bounds, never blocks its deadline.
  it("saves a started goal's deadline past a target it lacks, or one out of today's bounds", async () => {
    api.run.mockResolvedValue(ANSWER);
    const recomp: CurrentGoal = { ...CURRENT, name: "Recomp", type: "recomposition", targetWeight: null };
    const user = renderSheet({ ...OVERVIEW, current: recomp });
    await user.click(screen.getByRole("button", { name: "Edit Recomp" }));
    fireEvent.change(screen.getByLabelText("Deadline"), { target: { value: "2027-01-15" } });
    await user.click(saveButton());

    await waitFor(() => expect(formOpen()).toBe(false));
    expect(screen.queryByText("Enter a target body fat")).not.toBeInTheDocument();
    expect(api.run).toHaveBeenCalledWith({ kind: "deadline", goalId: "goal-lean", deadline: "2027-01-15" });
    cleanup();

    api.run.mockClear();
    const heavy: CurrentGoal = { ...CURRENT, targetWeight: 263.8 };
    const again = renderSheet({ ...OVERVIEW, current: heavy });
    await again.click(screen.getByRole("button", { name: "Edit Lean out" }));
    fireEvent.change(screen.getByLabelText("Deadline"), { target: { value: "2027-02-05" } });
    await again.click(saveButton());

    await waitFor(() => expect(formOpen()).toBe(false));
    expect(api.run).toHaveBeenCalledTimes(1);
    expect(api.run).toHaveBeenCalledWith({ kind: "deadline", goalId: "goal-lean", deadline: "2027-02-05" });
  });

  it("checks today's goal's targets — it is rewritten whole", async () => {
    const todays: CurrentGoal = { ...CURRENT, startsOn: TODAY, deadline: null };
    const user = renderSheet({ ...OVERVIEW, current: todays });
    await user.click(screen.getByRole("button", { name: "Edit Lean out" }));
    await user.clear(screen.getByLabelText("Target weight (kg)"));
    await user.click(saveButton());

    expect(screen.getByText("Enter a target weight")).toBeInTheDocument();
    expect(api.run).not.toHaveBeenCalled();
  });

  it("checks a target a started goal's save does write — the new goal's", async () => {
    const recomp: CurrentGoal = { ...CURRENT, name: "Recomp", type: "recomposition", targetWeight: null };
    const user = renderSheet({ ...OVERVIEW, current: recomp });
    await user.click(screen.getByRole("button", { name: "Edit Recomp" }));
    await user.type(screen.getByLabelText("Target body fat (%)"), "73.5");
    expect(screen.getByText("This starts a new goal from today.")).toBeInTheDocument();
    await user.click(saveButton());

    expect(screen.getByText("Body fat must be between 3% and 60%")).toBeInTheDocument();
    expect(api.run).not.toHaveBeenCalled();
  });

  // Two writes, no transaction: the deadline, then the labels. Once the first
  // has landed, "Save failed" would tell the coach to redo what is stored.
  it("says Partly saved when the labels fail after the deadline landed", async () => {
    const deadlineAnswer: ClientGoalsOverview = { ...OVERVIEW, current: { ...CURRENT, deadline: "2027-01-01" } };
    api.run.mockResolvedValueOnce(deadlineAnswer).mockRejectedValueOnce(new Error("Goal not found."));
    const user = renderSheet();
    await user.click(screen.getByRole("button", { name: "Edit Lean out" }));
    fireEvent.change(screen.getByLabelText("Deadline"), { target: { value: "2027-01-01" } });
    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "Race weight");
    await user.click(saveButton());

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Partly saved", {
        description: "The deadline was saved, but the rest was not: Goal not found.",
      })
    );
    expect(api.run).toHaveBeenNthCalledWith(2, {
      kind: "rename",
      goalId: "goal-lean",
      name: "Race weight",
      description: "Feel lighter on the bike",
    });
    expect(api.land).toHaveBeenCalledWith(deadlineAnswer);
    expect(formOpen()).toBe(true);
    expect(saveButton()).toBeEnabled();
  });

  it("closes without a write when nothing changed", async () => {
    const user = renderSheet();
    await user.click(screen.getByRole("button", { name: "Edit Peak" }));
    await user.click(saveButton());

    expect(api.run).not.toHaveBeenCalled();
    expect(formOpen()).toBe(false);
  });
});

describe("the goals sheet — a refused save says what would clear it", () => {
  const SENTENCE = "The deadline runs into Peak, which starts 14 Dec. Move Peak to 23 Jan or delete it.";

  async function refusedDeadline() {
    api.run.mockRejectedValueOnce(new GoalRefusal(SENTENCE));
    const user = renderSheet();
    await user.click(screen.getByRole("button", { name: "Edit Lean out" }));
    fireEvent.change(screen.getByLabelText("Deadline"), { target: { value: "2027-01-22" } });
    await user.click(saveButton());
    await screen.findByText(SENTENCE);
    return user;
  }

  it("keeps the form open with the rule's sentence, and nothing to click in it", async () => {
    await refusedDeadline();

    expect(screen.queryByRole("button", { name: /^Move / })).not.toBeInTheDocument();
    // The one Delete Peak is Peak's own row's.
    expect(screen.getAllByRole("button", { name: "Delete Peak" })).toHaveLength(1);
    expect(api.land).not.toHaveBeenCalled();
    expect(saveButton()).toBeEnabled();
  });

  it("holds the refusal only while the fields read as refused", async () => {
    await refusedDeadline();

    fireEvent.change(screen.getByLabelText("Deadline"), { target: { value: "2026-12-11" } });
    expect(screen.queryByText(SENTENCE)).not.toBeInTheDocument();
  });

  // The coach clears it from the goal in the way's own row, the form open as typed.
  it("drops the refusal once the goal in the way is deleted, and the save then goes through", async () => {
    const user = await refusedDeadline();
    api.remove.mockResolvedValue({ ...OVERVIEW, planned: [] });
    await user.click(screen.getByRole("button", { name: "Delete Peak" }));
    await user.click(
      within(screen.getByRole("dialog", { name: "Delete Peak?" })).getByRole("button", { name: "Delete goal" })
    );

    await waitFor(() => expect(screen.queryByText(SENTENCE)).not.toBeInTheDocument());
    expect(screen.getByLabelText("Deadline")).toHaveValue("2027-01-22");

    api.run.mockResolvedValueOnce(ANSWER);
    await user.click(saveButton());
    await waitFor(() => expect(formOpen()).toBe(false));
    expect(api.run).toHaveBeenLastCalledWith({ kind: "deadline", goalId: "goal-lean", deadline: "2027-01-22" });
  });

  it("a planned start inside the current goal's deadline says so, with nothing to click", async () => {
    const sentence = "Lean out's deadline is 4 Dec. End that deadline on 15 Nov, or start this goal after it.";
    api.run.mockRejectedValueOnce(new GoalRefusal(sentence));
    const user = renderSheet();
    await user.click(screen.getByRole("button", { name: "Plan a goal" }));
    await chooseType("Maintain");
    fireEvent.change(screen.getByLabelText("Starts"), { target: { value: "2026-11-16" } });
    await user.click(saveButton());

    expect(await screen.findByText(sentence)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^End / })).not.toBeInTheDocument();
  });

  it("a failure that is no refusal is a toast, and the form stays", async () => {
    api.run.mockRejectedValueOnce(new Error("Failed to save the goal"));
    const user = renderSheet();
    await user.click(screen.getByRole("button", { name: "Edit Lean out" }));
    fireEvent.change(screen.getByLabelText("Deadline"), { target: { value: "2027-01-29" } });
    await user.click(saveButton());

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Save failed", { description: "Failed to save the goal" })
    );
    expect(formOpen()).toBe(true);
  });
});

describe("the goals sheet — deleting a goal", () => {
  const dialog = () => screen.getByRole("dialog", { name: /^Delete / });

  it("names a planned goal's day, and deletes it at a click", async () => {
    const user = renderSheet();
    await user.click(screen.getByRole("button", { name: "Delete Peak" }));

    expect(within(dialog()).getByText("Deletes Peak, planned from 14 Dec.")).toBeInTheDocument();
    expect(within(dialog()).getByRole("button", { name: "Delete goal" })).toBeEnabled();
  });

  it("has the current goal's delete typed", async () => {
    const user = renderSheet();
    await user.click(screen.getByRole("button", { name: "Delete Lean out" }));

    expect(
      within(dialog()).getByText(
        "Lean out is the current goal. Deleting it can't be undone: set again, it starts from today and its progress counts from today's weight."
      )
    ).toBeInTheDocument();
    expect(within(dialog()).getByRole("button", { name: "Delete goal" })).toBeDisabled();
    await user.type(within(dialog()).getByLabelText("Type DELETE to confirm"), "DELETE");
    expect(within(dialog()).getByRole("button", { name: "Delete goal" })).toBeEnabled();
  });

  // The frame test: the confirm holds its spinner until the delete answers;
  // the answer is landed and the confirm closed together.
  it("deletes, lands the answer and closes the confirm together, then says so", async () => {
    const removal = deferred<ClientGoalsOverview>();
    api.remove.mockReturnValue(removal.promise);
    const user = renderSheet();
    await user.click(screen.getByRole("button", { name: "Delete Peak" }));
    await user.click(within(dialog()).getByRole("button", { name: "Delete goal" }));

    expect(api.remove).toHaveBeenCalledWith("goal-peak");
    expect(within(dialog()).getByRole("button", { name: "Delete goal" })).toBeDisabled();
    expect(api.land).not.toHaveBeenCalled();

    const answer = { ...OVERVIEW, planned: [] };
    await act(async () => {
      removal.resolve(answer);
      await removal.promise;
    });
    expect(api.land).toHaveBeenCalledWith(answer);
    expect(screen.queryByRole("dialog", { name: /^Delete / })).not.toBeInTheDocument();
    expect(screen.queryByText("Peak")).not.toBeInTheDocument();
    expect(toast.success).toHaveBeenCalledWith("Goal deleted");
  });

  it("a failed delete says so and leaves the confirm open", async () => {
    api.remove.mockRejectedValue(new Error("Goal not found."));
    const user = renderSheet();
    await user.click(screen.getByRole("button", { name: "Delete Peak" }));
    await user.click(within(dialog()).getByRole("button", { name: "Delete goal" }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Delete failed", { description: "Goal not found." })
    );
    expect(within(dialog()).getByRole("button", { name: "Delete goal" })).toBeEnabled();
    expect(api.land).not.toHaveBeenCalled();
  });

  it("a delete of another goal leaves an open form as it was", async () => {
    api.remove.mockResolvedValue({ ...OVERVIEW, current: null });
    const user = renderSheet();
    await user.click(screen.getByRole("button", { name: "Edit Peak" }));
    await user.click(screen.getByRole("button", { name: "Delete Lean out" }));
    await user.type(within(dialog()).getByLabelText("Type DELETE to confirm"), "DELETE");
    await user.click(within(dialog()).getByRole("button", { name: "Delete goal" }));

    await waitFor(() => expect(api.land).toHaveBeenCalled());
    expect(formOpen()).toBe(true);
    expect(screen.getByLabelText("Starts")).toHaveValue("2026-12-14");
  });
});
