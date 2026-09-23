import { describe, expect, it, vi, beforeEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DrawerFooter } from "./drawer-footer";

// Session 7.4: the return trip to Journey hangs off generatePlan's BOOLEAN,
// never off the drawer closing. Two ways that distinction earns its keep:
// a coach can close the drawer without saving, and since Session 6 a save can
// return false AFTER the plan committed (a failed note insert) — which leaves
// them here with their note intact. Bouncing on either would be a lie.

const generatePlan = vi.fn();

const CLIENT_TODAY = "2026-07-02";

const builder = {
  hasPlan: false,
  manualEnabled: false,
  manualBlockingError: null as string | null,
  calcInputs: { status: "ready", today: CLIENT_TODAY },
  isGenerating: false,
  client: { bmr: 1800, name: "Alex Doe" },
  // The day the plan takes effect is the drawer's Starts on setting, read here
  // at save time — nothing stands between the button and the save.
  effectiveFrom: CLIENT_TODAY as string | null,
  clientToday: CLIENT_TODAY as string | null,
  // The Starts on day's goal (docs/MEASUREMENT-LOG-PLAN.md commit 8d1).
  isDayPending: false,
  isDayError: false,
  generatePlan,
};

vi.mock("@/contexts/nutrition-builder-context", () => ({
  useNutritionBuilderContext: () => builder,
}));

beforeEach(() => {
  cleanup();
  generatePlan.mockReset();
  builder.effectiveFrom = CLIENT_TODAY;
  builder.isDayPending = false;
  builder.isDayError = false;
});

function clickGenerate() {
  fireEvent.click(screen.getByRole("button", { name: /Generate Plan/ }));
}

describe("DrawerFooter — what counts as a save", () => {
  it("reports a save when generatePlan resolves true", async () => {
    generatePlan.mockResolvedValue(true);
    const onSaved = vi.fn();
    render(<DrawerFooter onSaved={onSaved} />);
    clickGenerate();
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  });

  it("reports NOTHING when generatePlan resolves false", async () => {
    // Validation refused, the POST failed, or Session 6's note insert threw
    // after the plan committed. The coach stays put in every one of those.
    generatePlan.mockResolvedValue(false);
    const onSaved = vi.fn();
    render(<DrawerFooter onSaved={onSaved} />);
    clickGenerate();
    await waitFor(() => expect(generatePlan).toHaveBeenCalledTimes(1));
    expect(onSaved).not.toHaveBeenCalled();
  });
});

// docs/MEASUREMENT-LOG-PLAN.md commit 8bb, D26: the save-time date dialog is
// gone. The date is a drawer setting the coach set before reaching the button.
describe("DrawerFooter — Generate saves directly from the drawer's settings", () => {
  it("one click saves, with only the manual flag — the hook reads its own date", async () => {
    generatePlan.mockResolvedValue(true);
    render(<DrawerFooter />);
    clickGenerate();
    await waitFor(() => expect(generatePlan).toHaveBeenCalledTimes(1));
    expect(generatePlan).toHaveBeenCalledWith(false);
  });

  it("refuses a start date before the client's today with a sentence, and saves nothing", () => {
    builder.effectiveFrom = "2026-07-01";
    render(<DrawerFooter />);
    clickGenerate();
    expect(screen.getByText("The start date can't be in the past.")).toBeInTheDocument();
    expect(generatePlan).not.toHaveBeenCalled();
  });

  // Owner, 2026-09-11: today is the coach's to replace whatever the client has
  // logged; the save re-records a logged today onto their log. The past is the
  // footer's only bound — there is no floor line and no floor refusal.
  it("saves a start on today whatever the client has logged — the past is the only bound", async () => {
    generatePlan.mockResolvedValue(true);
    builder.effectiveFrom = CLIENT_TODAY;
    render(<DrawerFooter />);
    clickGenerate();
    await waitFor(() => expect(generatePlan).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/has already logged/)).toBeNull();
  });
});

// docs/MEASUREMENT-LOG-PLAN.md commit 8d1: Generate waits for the Starts on
// day's goal — a save priced for a day the drawer has not shown would not be
// the plan on screen.
describe("DrawerFooter — Generate waits for the day's goal", () => {
  it("is held while the day's goal is loading", () => {
    builder.isDayPending = true;
    render(<DrawerFooter />);
    expect(screen.getByRole("button", { name: /Generate Plan/ })).toBeDisabled();
  });

  it("is held while the day's read has failed", () => {
    builder.isDayError = true;
    render(<DrawerFooter />);
    expect(screen.getByRole("button", { name: /Generate Plan/ })).toBeDisabled();
  });

  it("saves once the day's goal is in", async () => {
    generatePlan.mockResolvedValue(true);
    render(<DrawerFooter />);
    clickGenerate();
    await waitFor(() => expect(generatePlan).toHaveBeenCalledTimes(1));
  });
});
