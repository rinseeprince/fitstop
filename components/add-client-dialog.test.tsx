import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AddClientDialog } from "./add-client-dialog";
import type { UnitSystem } from "@/utils/unit-conversions";

// The dialog reaches useUnits() -> auth-context -> the browser Supabase client,
// which throws without env vars. Same mock ~20 other suites carry since Phase 3.
const preference = { current: "metric" as UnitSystem };
vi.mock("@/contexts/units-context", () => ({
  useUnits: () => ({ preference: preference.current, isLoading: false, error: undefined }),
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;
Element.prototype.scrollIntoView = () => {};
Element.prototype.hasPointerCapture = () => false;
Element.prototype.releasePointerCapture = () => {};

function mockCreateOk() {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ client: { id: "new-1" }, inviteSent: true }),
  } as Response);
}

/** The POST body, parsed. Null when the submit never fired. */
function createBody(spy: ReturnType<typeof mockCreateOk>) {
  const call = spy.mock.calls.find(([url]) => String(url) === "/api/clients");
  return call ? (JSON.parse(call[1]?.body as string) as Record<string, unknown>) : null;
}

async function openDialog() {
  const user = userEvent.setup();
  render(<AddClientDialog trigger={<button>Add client</button>} />);
  await user.click(screen.getByRole("button", { name: "Add client" }));
  return user;
}

describe("AddClientDialog", () => {
  beforeEach(() => {
    preference.current = "metric";
    cleanup();
  });
  afterEach(() => vi.restoreAllMocks());

  it("offers the two setup paths", async () => {
    await openDialog();
    expect(screen.getByText("Send intake questionnaire")).toBeInTheDocument();
    expect(screen.getByText("Set up manually")).toBeInTheDocument();
  });

  /**
   * THE REGRESSION. The intake path was dead from 2026-08-21 (`624bdca`, which
   * added the "a manual add must carry a weight" refine) to 2026-08-27, and
   * nothing caught it because this dialog had no test at all.
   *
   * The refine reads `setupMode` DURING validation, but the dialog held it as
   * React state and only merged it into the payload inside `onSubmit` — which
   * `handleSubmit` calls only AFTER validating. So the refine always saw
   * `undefined`, always demanded a weight the intake form does not collect, and
   * pinned the error to a field that form does not render. No message, no
   * request, no toast, no close: a button that did nothing.
   *
   * Asserting the POST rather than the absence of an error is what makes this
   * test load-bearing — the bug's whole signature was that nothing happened.
   */
  it("submits the intake path with only a name and an email", async () => {
    const fetchSpy = mockCreateOk();
    const user = await openDialog();

    await user.click(screen.getByText("Send intake questionnaire"));
    await user.type(screen.getByLabelText(/name/i), "Samuel James");
    await user.type(screen.getByLabelText(/email/i), "sam@example.com");
    await user.click(screen.getByRole("button", { name: /add & send questionnaire/i }));

    await waitFor(() => expect(createBody(fetchSpy)).not.toBeNull());
    expect(createBody(fetchSpy)).toMatchObject({
      name: "Samuel James",
      email: "sam@example.com",
      setupMode: "intake",
    });
  });

  it("closes once the intake client is created", async () => {
    mockCreateOk();
    const user = await openDialog();

    await user.click(screen.getByText("Send intake questionnaire"));
    await user.type(screen.getByLabelText(/name/i), "Samuel James");
    await user.type(screen.getByLabelText(/email/i), "sam@example.com");
    await user.click(screen.getByRole("button", { name: /add & send questionnaire/i }));

    await waitFor(() =>
      expect(screen.queryByText("Add new client")).not.toBeInTheDocument()
    );
  });

  it("tells the caller a client was added", async () => {
    mockCreateOk();
    const onClientAdded = vi.fn();
    const user = userEvent.setup();
    render(
      <AddClientDialog trigger={<button>Add client</button>} onClientAdded={onClientAdded} />
    );

    await user.click(screen.getByRole("button", { name: "Add client" }));
    await user.click(screen.getByText("Send intake questionnaire"));
    await user.type(screen.getByLabelText(/name/i), "Samuel James");
    await user.type(screen.getByLabelText(/email/i), "sam@example.com");
    await user.click(screen.getByRole("button", { name: /add & send questionnaire/i }));

    await waitFor(() => expect(onClientAdded).toHaveBeenCalledTimes(1));
  });

  /**
   * The other side of the same bug. `setupMode` lives in two places — dialog
   * state for rendering, form value for validation — so Back must clear both.
   * Clearing only the state would leave the form saying "manual" while the
   * intake screen is on show, and the refine would demand a weight again.
   */
  it("does not carry a path across a trip through Back", async () => {
    const fetchSpy = mockCreateOk();
    const user = await openDialog();

    await user.click(screen.getByText("Set up manually"));
    await user.click(screen.getByRole("button", { name: /^back$/i }));
    await user.click(screen.getByText("Send intake questionnaire"));

    await user.type(screen.getByLabelText(/name/i), "Samuel James");
    await user.type(screen.getByLabelText(/email/i), "sam@example.com");
    await user.click(screen.getByRole("button", { name: /add & send questionnaire/i }));

    await waitFor(() => expect(createBody(fetchSpy)).not.toBeNull());
    expect(createBody(fetchSpy)?.setupMode).toBe("intake");
  });

  /**
   * The rule `624bdca` exists to enforce, still enforced. A manual add is the
   * only path that can mint a client with no starting measurement at all, and
   * one created without it has no BMR, no TDEE and no baseline for any progress
   * figure. Unlike the intake case, this form DOES render the field, so the
   * coach sees why.
   */
  it("still refuses a manual add with no weight, and says so", async () => {
    const fetchSpy = mockCreateOk();
    const user = await openDialog();

    await user.click(screen.getByText("Set up manually"));
    await user.type(screen.getByLabelText(/name/i), "Samuel James");
    await user.type(screen.getByLabelText(/email/i), "sam@example.com");
    await user.click(screen.getByRole("button", { name: /add client/i }));

    expect(await screen.findByText(/a current weight is required/i)).toBeInTheDocument();
    expect(createBody(fetchSpy)).toBeNull();
  });

  // The manual add sets the client's first goal with the goals sheet's fields
  // (docs/MEASUREMENT-LOG-PLAN.md §6 commit 8d2); it starts on their today.
  describe("the first goal", () => {
    async function manual(weight = "93.6") {
      const user = await openDialog();
      await user.click(screen.getByText("Set up manually"));
      await user.type(screen.getByLabelText(/^name/i), "Samuel James");
      await user.type(screen.getByLabelText(/email/i), "sam@example.com");
      await user.type(screen.getByLabelText("Current weight (kg)"), weight);
      return user;
    }

    async function chooseType(name: string) {
      fireEvent.keyDown(screen.getByRole("combobox", { name: "Goal type" }), { key: "ArrowDown" });
      fireEvent.keyDown(await screen.findByRole("option", { name }), { key: "Enter" });
    }

    it("is none by default, and asks for what its type uses once one is chosen — never a start day", async () => {
      await manual();
      expect(screen.getByRole("combobox", { name: "Goal type" })).toHaveTextContent("No goal");
      expect(screen.queryByLabelText("Target weight (kg)")).not.toBeInTheDocument();

      await chooseType("Lose weight");
      expect(screen.getByLabelText("Target weight (kg)")).toBeInTheDocument();
      expect(screen.getByLabelText("Deadline")).toBeInTheDocument();
      expect(screen.getByLabelText("Description")).toBeInTheDocument();
      expect(screen.queryByLabelText("Starts")).not.toBeInTheDocument();
    });

    it("sends the goal with the client", async () => {
      const fetchSpy = mockCreateOk();
      const user = await manual();
      await chooseType("Lose weight");
      await user.type(screen.getByLabelText("Target weight (kg)"), "86.9");
      fireEvent.change(screen.getByLabelText("Deadline"), { target: { value: "2027-02-05" } });
      await user.type(screen.getByLabelText("Description"), "Back into my suits");
      await user.click(screen.getByRole("button", { name: /add client/i }));

      await waitFor(() => expect(createBody(fetchSpy)).not.toBeNull());
      expect(createBody(fetchSpy)?.goal).toEqual({
        type: "lose_weight",
        name: "Lose weight",
        targetWeight: 86.9,
        targetBodyFatPercentage: null,
        description: "Back into my suits",
        deadline: "2027-02-05",
      });
    });

    it("sends no goal while the type is No goal", async () => {
      const fetchSpy = mockCreateOk();
      const user = await manual();
      await user.click(screen.getByRole("button", { name: /add client/i }));

      await waitFor(() => expect(createBody(fetchSpy)).not.toBeNull());
      expect(createBody(fetchSpy)).not.toHaveProperty("goal");
    });

    it("refuses a goal without the target its type needs, and says so", async () => {
      const fetchSpy = mockCreateOk();
      const user = await manual();
      await chooseType("Build muscle");
      await user.click(screen.getByRole("button", { name: /add client/i }));

      expect(await screen.findByText("Enter a target weight")).toBeInTheDocument();
      expect(createBody(fetchSpy)).toBeNull();
    });

    it("warns when the target points the other way from the weight typed above", async () => {
      const user = await manual("70.4");
      await chooseType("Lose weight");
      await user.type(screen.getByLabelText("Target weight (kg)"), "72.8");

      expect(screen.getByText("This target is above their current weight (70.4 kg).")).toBeInTheDocument();
    });
  });
});
