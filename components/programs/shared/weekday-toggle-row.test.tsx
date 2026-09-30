import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WeekdayToggleRow } from "./weekday-toggle-row";

afterEach(() => cleanup());

describe("WeekdayToggleRow — seven toggles, any number on at once", () => {
  it("names itself, lists the week Monday first and says which days are picked", () => {
    render(<WeekdayToggleRow label="Chosen days" value={["wednesday", "monday"]} onChange={vi.fn()} />);
    const row = screen.getByRole("group", { name: "Chosen days" });
    const days = [...row.querySelectorAll("button")];
    expect(days.map((day) => day.textContent)).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
    expect(days.map((day) => day.getAttribute("aria-pressed"))).toEqual(["true", "false", "true", "false", "false", "false", "false"]);
  });

  it("adds a day to the picked ones, answered Monday first, and takes one away", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(<WeekdayToggleRow label="Days" value={["friday"]} onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "Mon" }));
    expect(onChange).toHaveBeenLastCalledWith(["monday", "friday"]);

    rerender(<WeekdayToggleRow label="Days" value={["monday", "friday"]} onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "Fri" }));
    expect(onChange).toHaveBeenLastCalledWith(["monday"]);
  });

  // Like the segmented control's, the weight never changes with the state:
  // the wash carries the pick, never the weight.
  it("keeps one weight on every day, picked or not", () => {
    render(<WeekdayToggleRow label="Days" value={["monday"]} onChange={vi.fn()} />);
    for (const day of ["Mon", "Tue"]) {
      const button = screen.getByRole("button", { name: day });
      expect(button).toHaveClass("font-medium");
      expect(button).not.toHaveClass("font-semibold");
    }
  });

  it("picks nothing while disabled", async () => {
    const onChange = vi.fn();
    render(<WeekdayToggleRow label="Days" value={[]} onChange={onChange} disabled />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Mon" }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
