import { describe, expect, it, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { DeletePlanDialog, describePlanDelete } from "./delete-plan-dialog";
import type { BlockPlanDeleteTarget } from "./block-timeline";

// The per-plan delete's confirm (C3): the design system's destructive confirm
// with one sentence per case, scoping the verb and stopping — never a
// reassurance about what survives.

const plan = (overrides: Partial<BlockPlanDeleteTarget>): BlockPlanDeleteTarget => ({
  track: "training",
  id: "p1",
  name: "Upper Lower",
  state: "active",
  startsOn: "2026-09-07",
  endsOn: "2026-09-20",
  ...overrides,
});

afterEach(cleanup);

describe("describePlanDelete — the four sentences", () => {
  const text = (copy: ReturnType<typeof describePlanDelete>) => {
    const { container } = render(<p>{copy.body}</p>);
    return container.textContent;
  };

  it("a running program ends, and its upcoming sessions go", () => {
    const copy = describePlanDelete(plan({}));
    expect(copy.title).toBe("End plan?");
    expect(text(copy)).toBe("Ends Upper Lower. Its upcoming sessions are removed.");
    expect(copy.cta).toBe("End plan");
  });

  it("a queued program is removed, named with its range", () => {
    const copy = describePlanDelete(
      plan({ name: "Glute Focused", state: "upcoming", startsOn: "2026-09-21", endsOn: "2026-10-04" })
    );
    expect(copy.title).toBe("Remove plan?");
    expect(text(copy)).toBe("Removes Glute Focused, 21 Sep – 4 Oct.");
    expect(copy.cta).toBe("Remove plan");
  });

  it("running targets end from today, named by their range — a version carries no name", () => {
    const copy = describePlanDelete(plan({ track: "nutrition", name: null }));
    expect(copy.title).toBe("End targets?");
    expect(text(copy)).toBe(
      "Ends the nutrition targets running 7 Sep – 20 Sep. Targets from today are removed."
    );
    expect(copy.cta).toBe("End targets");
  });

  it("queued targets are removed with their range", () => {
    const copy = describePlanDelete(
      plan({ track: "nutrition", name: null, state: "upcoming", startsOn: "2026-09-21", endsOn: "2026-10-04" })
    );
    expect(copy.title).toBe("Remove targets?");
    expect(text(copy)).toBe("Removes the nutrition targets for 21 Sep – 4 Oct.");
    expect(copy.cta).toBe("Remove targets");
  });

  it("never reassures about what survives", () => {
    for (const target of [
      plan({}),
      plan({ state: "upcoming" }),
      plan({ track: "nutrition", name: null }),
      plan({ track: "nutrition", name: null, state: "upcoming" }),
    ]) {
      expect(text(describePlanDelete(target))).not.toMatch(/keep|kept|survive|past days/i);
    }
  });
});

describe("DeletePlanDialog", () => {
  it("renders the case's title, sentence and CTA, and confirms with the plan", () => {
    const onConfirm = vi.fn();
    const target = plan({});
    render(<DeletePlanDialog plan={target} isDeleting={false} onCancel={vi.fn()} onConfirm={onConfirm} />);

    expect(screen.getByRole("dialog")).toBeDefined();
    expect(screen.getByText("End plan?")).toBeDefined();
    expect(screen.getByText("Upper Lower")).toBeDefined();
    screen.getByRole("button", { name: "End plan" }).click();
    expect(onConfirm).toHaveBeenCalledWith(target);
  });

  it("is inert mid-delete and closed with no plan", () => {
    const onConfirm = vi.fn();
    const { unmount } = render(
      <DeletePlanDialog plan={plan({ state: "upcoming" })} isDeleting onCancel={vi.fn()} onConfirm={onConfirm} />
    );
    expect(screen.getByRole("button", { name: "Remove plan" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    unmount();

    render(<DeletePlanDialog plan={null} isDeleting={false} onCancel={vi.fn()} onConfirm={onConfirm} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
