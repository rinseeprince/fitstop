import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ApplyDateDialog } from "./apply-date-dialog";
import { getTodayDateString, addDaysToDateString } from "@/lib/date-helpers";

const today = getTodayDateString();
const tomorrow = addDaysToDateString(today, 1);

function renderDialog(onApply = vi.fn()) {
  render(
    <ApplyDateDialog open onOpenChange={vi.fn()} onApply={onApply} />,
  );
  return onApply;
}

describe("ApplyDateDialog", () => {
  beforeEach(cleanup);

  it("defaults the picker to today and a bare Apply means NOW — sent as null, never the date string", () => {
    // null is the contract, not a shortcut: the picker shows the COACH's
    // calendar day, but plan dates live on the CLIENT's. Sending the literal
    // string across a midnight offset schedules the client's tomorrow; null
    // lets the server resolve today in the client's stored timezone (the old
    // Apply Now behaviour, preserved through the single-button redesign).
    const onApply = renderDialog();

    expect(screen.getByDisplayValue(today)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith(null);
  });

  it("sends a future pick as the typed date", () => {
    const onApply = renderDialog();

    fireEvent.change(screen.getByDisplayValue(today), {
      target: { value: tomorrow },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    expect(onApply).toHaveBeenCalledWith(tomorrow);
  });

  it("re-picking today after a change is NOW again, not a literal date", () => {
    const onApply = renderDialog();
    const input = screen.getByDisplayValue(today);

    fireEvent.change(input, { target: { value: tomorrow } });
    fireEvent.change(input, { target: { value: today } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    expect(onApply).toHaveBeenCalledWith(null);
  });

  it("disables Apply on a past date — min guards the picker, this guards typed input", () => {
    const onApply = renderDialog();

    fireEvent.change(screen.getByDisplayValue(today), {
      target: { value: addDaysToDateString(today, -1) },
    });

    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
    expect(onApply).not.toHaveBeenCalled();
  });

  it("absorb warning: picking on/before a queued change says it will be replaced — warn, never block", () => {
    const queued = addDaysToDateString(today, 10);
    const onApply = vi.fn();
    render(
      <ApplyDateDialog
        open
        onOpenChange={vi.fn()}
        onApply={onApply}
        queuedChangeDate={queued}
      />,
    );

    // The default (today) is before the queued date → the sentence renders…
    expect(screen.getByText(/This replaces the change queued for/)).toBeInTheDocument();

    // …and Apply still works exactly as asked (warn, then do).
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(onApply).toHaveBeenCalledWith(null);
  });

  it("absorb warning: a pick AFTER the queued change shows no warning", () => {
    const queued = addDaysToDateString(today, 10);
    render(
      <ApplyDateDialog
        open
        onOpenChange={vi.fn()}
        onApply={vi.fn()}
        queuedChangeDate={queued}
      />,
    );

    fireEvent.change(screen.getByDisplayValue(today), {
      target: { value: addDaysToDateString(today, 11) },
    });

    expect(screen.queryByText(/This replaces the change queued for/)).toBeNull();
  });
});
