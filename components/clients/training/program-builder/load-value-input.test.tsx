import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LoadValueInput } from "./load-value-input";

// units-context reaches auth-context, which builds the browser Supabase client
// at module load. Stubbed per viewer so the conversion branch can be exercised.
const { unitPreference } = vi.hoisted(() => ({ unitPreference: { current: "metric" } }));
vi.mock("@/contexts/units-context", () => ({
  useUnits: () => ({ preference: unitPreference.current, isLoading: false, error: null }),
}));

describe("LoadValueInput", () => {
  beforeEach(() => {
    unitPreference.current = "metric";
  });

  it("is disabled until a load type is chosen", () => {
    render(
      <LoadValueInput
        loadType={null}
        value={null}
        ariaLabel="Drop 1 load"
        onCommit={vi.fn()}
      />,
    );

    // "What unit is this in?" has no answer yet, so the field must not invite a
    // value — and must not imply kilograms with a placeholder.
    const input = screen.getByLabelText("Drop 1 load");
    expect(input).toBeDisabled();
    expect(input).toHaveAttribute("placeholder", "");
  });

  it("takes its suffix from the load type", () => {
    const { rerender } = render(
      <LoadValueInput
        loadType="absolute"
        value={null}
        ariaLabel="load"
        onCommit={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("load")).toHaveAttribute("placeholder", "kg");

    rerender(
      <LoadValueInput
        loadType="pct_1rm"
        value={null}
        ariaLabel="load"
        onCommit={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("load")).toHaveAttribute("placeholder", "%");
  });

  it("does NOT convert a percentage for an imperial viewer", async () => {
    // The bug this control exists to make impossible: the drop editor committed
    // every value through commitLoad, so an imperial coach typing 60 for
    // "60% 1RM" would have had it read as 60 lb and stored as 27.2.
    unitPreference.current = "imperial";
    const onCommit = vi.fn();
    const user = userEvent.setup();

    render(
      <LoadValueInput
        loadType="pct_1rm"
        value={null}
        ariaLabel="load"
        onCommit={onCommit}
      />,
    );

    await user.type(screen.getByLabelText("load"), "60");
    await user.tab();

    expect(onCommit).toHaveBeenCalledWith(60);
  });

  it("converts an absolute load to canonical kilograms", async () => {
    unitPreference.current = "imperial";
    const onCommit = vi.fn();
    const user = userEvent.setup();

    render(
      <LoadValueInput
        loadType="absolute"
        value={null}
        ariaLabel="load"
        onCommit={onCommit}
      />,
    );

    await user.type(screen.getByLabelText("load"), "220");
    await user.tab();

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit.mock.calls[0][0]).toBeCloseTo(99.79, 1);
  });

  it("writes nothing when a focus-through leaves the value untouched", async () => {
    // Display rounding is lossy in both directions, so re-committing an
    // untouched absolute field would drift the prescription with nobody editing.
    unitPreference.current = "imperial";
    const onCommit = vi.fn();
    const user = userEvent.setup();

    render(
      <LoadValueInput
        loadType="absolute"
        value={100}
        ariaLabel="load"
        onCommit={onCommit}
      />,
    );

    await user.click(screen.getByLabelText("load"));
    await user.tab();

    expect(onCommit).not.toHaveBeenCalled();
  });

  it("seeds an absolute value unsnapped, and a percentage raw", () => {
    unitPreference.current = "imperial";
    const { rerender } = render(
      <LoadValueInput
        loadType="absolute"
        value={100}
        ariaLabel="load"
        onCommit={vi.fn()}
      />,
    );
    // displayLoad, not formatLoad — seeding from a snapped value would
    // round-trip the snap into set_specs (CONVENTIONS §20).
    expect(screen.getByLabelText("load")).toHaveValue(220.5);

    rerender(
      <LoadValueInput
        loadType="pct_1rm"
        value={60}
        ariaLabel="load"
        onCommit={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("load")).toHaveValue(60);
  });
});
