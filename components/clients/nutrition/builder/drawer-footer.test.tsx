import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DrawerFooter } from "./drawer-footer";

// Session 7.4: the return trip to Journey hangs off generatePlan's BOOLEAN,
// never off the drawer closing. Two ways that distinction earns its keep:
// a coach can close the drawer without saving, and since Session 6 a save can
// return false AFTER the plan committed (a failed note insert) — which leaves
// them here with their note intact. Bouncing on either would be a lie.

const generatePlan = vi.fn();

const builder = {
  hasPlan: false,
  manualEnabled: false,
  manualBlockingError: null as string | null,
  calcInputs: { status: "complete" },
  isGenerating: false,
  client: { bmr: 1800 },
  nutritionData: null as { scheduledFor?: string | null } | null,
  generatePlan,
};

vi.mock("@/contexts/nutrition-builder-context", () => ({
  useNutritionBuilderContext: () => builder,
}));

// The date dialog is a separate, already-tested surface; here it is only the
// thing that hands `handleApply` an effective date.
vi.mock("@/components/ui/apply-date-dialog", () => ({
  ApplyDateDialog: ({
    open,
    onApply,
  }: {
    open: boolean;
    onApply: (effectiveFrom: string | null) => void;
  }) =>
    open ? (
      <button type="button" onClick={() => onApply(null)}>
        confirm-date
      </button>
    ) : null,
}));

beforeEach(() => generatePlan.mockReset());

function saveAPlan() {
  // fireEvent is act-wrapped, so the apply dialog is mounted before we reach
  // for it — a bare .click() leaves the state update unflushed.
  fireEvent.click(screen.getByRole("button", { name: /Generate Plan/ }));
  fireEvent.click(screen.getByRole("button", { name: "confirm-date" }));
}

describe("DrawerFooter — what counts as a save", () => {
  it("reports a save when generatePlan resolves true", async () => {
    generatePlan.mockResolvedValue(true);
    const onSaved = vi.fn();
    render(<DrawerFooter onSaved={onSaved} />);
    saveAPlan();
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  });

  it("reports NOTHING when generatePlan resolves false", async () => {
    // Validation refused, the POST failed, or Session 6's note insert threw
    // after the plan committed. The coach stays put in every one of those.
    generatePlan.mockResolvedValue(false);
    const onSaved = vi.fn();
    render(<DrawerFooter onSaved={onSaved} />);
    saveAPlan();
    await waitFor(() => expect(generatePlan).toHaveBeenCalledTimes(1));
    expect(onSaved).not.toHaveBeenCalled();
  });
});
