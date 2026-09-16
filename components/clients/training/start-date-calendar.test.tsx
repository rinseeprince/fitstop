import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { StartDateCalendar } from "./start-date-calendar";

afterEach(() => {
  cleanup();
});

// Wednesday 16 September 2026 is the client's today; the program starts on
// Monday 28 September.
function renderCalendar(overrides: Partial<Parameters<typeof StartDateCalendar>[0]> = {}) {
  const onPick = vi.fn();
  render(
    <StartDateCalendar
      selected="2026-09-28"
      today="2026-09-16"
      min="2026-09-16"
      onPick={onPick}
      {...overrides}
    />,
  );
  return { onPick };
}

const day = (name: RegExp) => screen.getByRole("button", { name });

describe("StartDateCalendar", () => {
  it("opens on the month of the current start, Monday first", () => {
    renderCalendar();
    expect(screen.getByText("Sep 2026")).toBeInTheDocument();
    expect(screen.getAllByText(/^[MTWFS]$/).map((cell) => cell.textContent)).toEqual([
      "M",
      "T",
      "W",
      "T",
      "F",
      "S",
      "S",
    ]);
    // Thirty days of September, and no day of another month.
    expect(screen.getAllByRole("button", { name: /September 2026/ })).toHaveLength(30);
    expect(screen.queryByRole("button", { name: /August|October/ })).toBeNull();
  });

  it("marks the current start and today", () => {
    renderCalendar();
    expect(day(/^Monday 28 September 2026, current start$/)).toHaveClass("bg-[#0d9488]");
    expect(day(/^Wednesday 16 September 2026, today$/)).toHaveClass("ring-1");
  });

  it("greys every day before the first allowed one, and a greyed day can't be picked", () => {
    const { onPick } = renderCalendar({ min: "2026-09-17" });

    for (let date = 1; date <= 16; date++) {
      expect(day(new RegExp(`^\\w+ ${date} September 2026`))).toBeDisabled();
    }
    expect(day(/^Thursday 17 September 2026$/)).toBeEnabled();

    fireEvent.click(day(/^Wednesday 16 September 2026, today$/));
    expect(onPick).not.toHaveBeenCalled();
  });

  it("picks a day with its date", () => {
    const { onPick } = renderCalendar();
    fireEvent.click(day(/^Wednesday 30 September 2026$/));
    expect(onPick).toHaveBeenCalledWith("2026-09-30");
  });

  it("the current start can be picked too — the caller decides it moves nothing", () => {
    const { onPick } = renderCalendar();
    fireEvent.click(day(/current start$/));
    expect(onPick).toHaveBeenCalledWith("2026-09-28");
  });

  it("pages forward, and back no further than the first allowed day's month", () => {
    const { onPick } = renderCalendar();
    const previous = screen.getByRole("button", { name: "Previous month" });
    const next = screen.getByRole("button", { name: "Next month" });

    // September holds the first allowed day, so August can't be reached.
    expect(previous).toBeDisabled();

    fireEvent.click(next);
    expect(screen.getByText("Oct 2026")).toBeInTheDocument();
    expect(previous).toBeEnabled();
    fireEvent.click(day(/^Monday 5 October 2026$/));
    expect(onPick).toHaveBeenCalledWith("2026-10-05");

    fireEvent.click(previous);
    expect(screen.getByText("Sep 2026")).toBeInTheDocument();
    expect(previous).toBeDisabled();
  });

  it("opens on a later month when the start is later, and can page back to the first allowed day", () => {
    renderCalendar({ selected: "2026-11-02" });
    expect(screen.getByText("Nov 2026")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
    fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
    expect(screen.getByText("Sep 2026")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous month" })).toBeDisabled();
  });
});
