import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { GoalPlanSheet } from "./goal-plan-sheet";
import type { Client } from "@/types/check-in";
import type { ClientGoal } from "@/types/client-goals";
import type { ClientPhase } from "@/services/client-phases-service";

const toast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));

const invalidateGoals = vi.fn();
const invalidatePhases = vi.fn();
vi.mock("@/hooks/use-client-goals", () => ({
  useInvalidateClientGoals: () => invalidateGoals,
}));
vi.mock("@/hooks/use-client-phases", () => ({
  useInvalidateClientPhases: () => invalidatePhases,
}));

// The panel anchors on the CLIENT's today, so the whole elapsed/live split is
// decided against this date.
const TODAY = "2026-08-03";
vi.mock("@/lib/date-helpers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/date-helpers")>()),
  getTodayDateStringInTimezone: () => TODAY,
}));

const CLIENT: Client = {
  id: "client-1",
  coachId: "coach-1",
  name: "Alex Kim",
  email: "alex@example.com",
  active: true,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  weightUnit: "kg",
  includeActivityBurn: false,
  surplusAsCarbs: false,
  timezone: "Australia/Sydney",
  currentWeight: 82,
};

function goal(over: Partial<ClientGoal> = {}): ClientGoal {
  return {
    id: "g1",
    clientId: "client-1",
    setBy: "coach",
    effectiveFrom: "2026-07-01",
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-01T00:00:00Z",
    goalWeight: 76,
    goalStartDate: "2026-08-03",
    ...over,
  };
}

function phase(over: Partial<ClientPhase> & { id: string }): ClientPhase {
  return {
    name: "Cut 1",
    startsOn: "2026-08-03",
    endsOn: "2026-09-27",
    ratePerWeekKg: -0.5,
    dailyTargets: null,
    ...over,
  };
}

function renderSheet(over: Partial<Parameters<typeof GoalPlanSheet>[0]> = {}) {
  return render(
    <GoalPlanSheet
      open
      onOpenChange={vi.fn()}
      client={CLIENT}
      goal={goal()}
      phases={[phase({ id: "11111111-1111-4111-8111-111111111111" })]}
      customMacrosEnabled={false}
      onSaved={vi.fn()}
      {...over}
    />
  );
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ success: true, data: {} }),
  });
  global.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => cleanup());

describe("GoalPlanSheet — the Route section", () => {
  // replaceClientPhases excludes elapsed rows from the write entirely, so an
  // editable field would accept a rename, return 200, and drop it silently.
  it("renders an elapsed block read-only, with no inputs at all", () => {
    renderSheet({
      phases: [
        phase({
          id: "11111111-1111-4111-8111-111111111111",
          name: "Prep",
          startsOn: "2026-06-01",
          endsOn: "2026-07-26",
        }),
      ],
    });

    expect(screen.getByText("Prep")).toBeInTheDocument();
    expect(screen.queryByLabelText("Block 1 name")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Block 1 length in weeks")).not.toBeInTheDocument();
  });

  it("locks the start date once a block has elapsed", () => {
    renderSheet({
      phases: [
        phase({
          id: "11111111-1111-4111-8111-111111111111",
          startsOn: "2026-06-01",
          endsOn: "2026-07-26",
        }),
      ],
    });
    expect(screen.getByLabelText("Plan starts")).toBeDisabled();
  });

  // Removing a PERSISTED block re-chains every later one and re-windows the
  // client's targets, so it goes through Task 3.2's confirm — not a row icon.
  it("offers no delete on a persisted block", () => {
    renderSheet();
    expect(screen.queryByRole("button", { name: "Remove block" })).not.toBeInTheDocument();
  });

  it("offers delete on a block the coach has just added, and dropping it needs no dialog", async () => {
    const user = userEvent.setup();
    renderSheet();

    await user.click(screen.getByRole("button", { name: /Add block/ }));
    const remove = screen.getByRole("button", { name: "Remove block" });
    await user.click(remove);

    expect(screen.queryByLabelText("Block 2 name")).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // A hand-written chain cannot be rebuilt from lengths, so normalizing it would
  // silently re-date the client's blocks.
  it("refuses to edit a non-conforming chain", () => {
    renderSheet({
      // A 10-day span: weeksBetween rounds it to 1 week.
      phases: [
        phase({
          id: "11111111-1111-4111-8111-111111111111",
          startsOn: "2026-08-03",
          endsOn: "2026-08-12",
        }),
      ],
    });
    expect(screen.getByText(/read-only/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Block 1 name")).not.toBeInTheDocument();
  });
});

describe("GoalPlanSheet — custom macros", () => {
  // All three enforcement points for "custom macros ignore blocks" are backend,
  // so without this line the coach gets flat numbers and no explanation.
  it("says blocks are not driving nutrition while custom macros is on", () => {
    renderSheet({ customMacrosEnabled: true });
    expect(screen.getByText(/not driving this client's nutrition/)).toBeInTheDocument();
  });

  it("says nothing when custom macros is off", () => {
    renderSheet({ customMacrosEnabled: false });
    expect(screen.queryByText(/not driving this client's nutrition/)).not.toBeInTheDocument();
  });
});

describe("GoalPlanSheet — the two independent writes (invariant 7)", () => {
  it("disables Save when there is nothing outstanding", () => {
    renderSheet();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  // The self-heal: a pristine form whose goal column disagrees with its blocks
  // has a real write to retry, so Save cannot be gated on isDirty.
  it("enables Save on a pristine form when the goal column disagrees with the blocks", () => {
    renderSheet({ goal: goal({ goalStartDate: "2026-07-01" }) });
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("writes ONLY the blocks on a rename — a rename must not mint a goal version", async () => {
    const user = userEvent.setup();
    renderSheet();

    const name = screen.getByLabelText("Block 1 name");
    await user.clear(name);
    await user.type(name, "Cutting phase 1");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][0]).toBe("/api/clients/client-1/phases");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.phases[0].name).toBe("Cutting phase 1");
    // Byte-identical to the stored kg — a re-conversion would null every grid.
    expect(body.phases[0].ratePerWeekKg).toBe(-0.5);
  });

  it("writes the blocks BEFORE the goal, so a failed goal write self-heals", async () => {
    const user = userEvent.setup();
    renderSheet();

    await user.clear(screen.getByLabelText("Plan starts"));
    await user.type(screen.getByLabelText("Plan starts"), "2026-08-10");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[0][0]).toBe("/api/clients/client-1/phases");
    expect(fetchMock.mock.calls[1][0]).toBe("/api/clients/client-1/goals");
  });

  // The phases PUT is served by two SWR areas (CONVENTIONS §7).
  it("fires BOTH invalidators after a block write", async () => {
    const user = userEvent.setup();
    renderSheet();

    const name = screen.getByLabelText("Block 1 name");
    await user.clear(name);
    await user.type(name, "Cut A");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(invalidatePhases).toHaveBeenCalledWith("client-1"));
    expect(invalidateGoals).toHaveBeenCalledWith("client-1");
  });

  // Two writes, no transaction: the coach must be told what actually landed.
  it("names the half that landed when the goal write fails after the blocks one", async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ success: true, data: {} }) })
      .mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ success: false, error: "Goal deadline cannot be in the past" }),
      });
    renderSheet();

    await user.clear(screen.getByLabelText("Plan starts"));
    await user.type(screen.getByLabelText("Plan starts"), "2026-08-10");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Blocks saved, goal did not",
          variant: "destructive",
        })
      )
    );
  });

  // PhaseWriteError's 422 names the block; swallowing it would leave the coach
  // with a silently unsaveable panel.
  it("surfaces the server's elapsed-block refusal verbatim", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue({
      ok: false,
      json: () =>
        Promise.resolve({
          success: false,
          error: '"Prep" has already finished and its dates cannot change',
        }),
    });
    renderSheet();

    const name = screen.getByLabelText("Block 1 name");
    await user.clear(name);
    await user.type(name, "Cut A");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          description: '"Prep" has already finished and its dates cannot change',
        })
      )
    );
  });
});

describe("GoalPlanSheet — the coerced inputs that used to write silently", () => {
  // parseBlockRows rounds, so "2.5" would preview AND save as 3 with no error to
  // surface — the server never sees a fraction to reject.
  it("rejects a fractional length instead of rounding it into the payload", async () => {
    const user = userEvent.setup();
    renderSheet();

    const weeks = screen.getByLabelText("Block 1 length in weeks");
    await user.clear(weeks);
    await user.type(weeks, "2.5");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.getByText("Whole weeks only")).toBeInTheDocument());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // parseBlockRows falls back to 0, and 0 is explicit maintenance (invariant 5),
  // so an empty field would write a coaching decision nobody made.
  it("requires a rate rather than coercing an empty field to maintenance", async () => {
    const user = userEvent.setup();
    renderSheet();

    await user.clear(screen.getByLabelText("Block 1 rate in kg per week"));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(screen.getByText("Enter a rate — use 0 for maintenance")).toBeInTheDocument()
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // updateGoalsSchema.goalWeight is .optional() but NOT .nullable(), so an
  // emptied field would be silently ignored by the write.
  it("refuses to empty a stored target weight", async () => {
    const user = userEvent.setup();
    renderSheet();

    await user.clear(screen.getByLabelText("Target weight"));
    // Blur, not Save: emptying the weight is deliberately NOT a change, so there
    // is no outstanding write and Save stays disabled. If the rule only fired on
    // submit the coach would clear the field and be told nothing at all.
    await user.tab();

    await waitFor(() =>
      expect(
        screen.getByText("Enter a target weight — it cannot be removed once set")
      ).toBeInTheDocument()
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("leaves the target weight optional for a client who has none — that is maintenance", async () => {
    const user = userEvent.setup();
    renderSheet({ goal: goal({ goalWeight: undefined }) });

    await user.click(screen.getByRole("button", { name: /Add block/ }));
    await user.type(screen.getByLabelText("Block 2 name"), "Maintain");
    await user.type(screen.getByLabelText("Block 2 rate in kg per week"), "0");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][0]).toBe("/api/clients/client-1/phases");
  });
});
