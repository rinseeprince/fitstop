import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { DayHeader } from "./day-header";
import { getDateDaysFrom, getTodayDateString } from "@/lib/date-helpers";

const today = getTodayDateString();
const todayMidnight = new Date(today + "T00:00:00");
const yesterday = getDateDaysFrom(todayMidnight, -1);
const tomorrow = getDateDaysFrom(todayMidnight, 1);

function makeProps(date: string) {
  return {
    date,
    onPrev: vi.fn(),
    onNext: vi.fn(),
    onToday: vi.fn(),
  };
}

describe("DayHeader", () => {
  beforeEach(() => cleanup());

  it('renders "Today" when date is today', () => {
    render(<DayHeader {...makeProps(today)} />);
    expect(screen.getByText("Today")).toBeInTheDocument();
  });

  it('renders "Yesterday" when date is the day before today', () => {
    render(<DayHeader {...makeProps(yesterday)} />);
    expect(screen.getByText("Yesterday")).toBeInTheDocument();
  });

  it('renders "Tomorrow" when date is the day after today', () => {
    render(<DayHeader {...makeProps(tomorrow)} />);
    expect(screen.getByText("Tomorrow")).toBeInTheDocument();
  });

  it("renders an absolute weekday/month/day/year label for distant dates", () => {
    const distantDate = getDateDaysFrom(todayMidnight, 100);
    const expectedLabel = new Date(distantDate + "T00:00:00").toLocaleDateString(
      "en-US",
      { weekday: "short", month: "short", day: "numeric", year: "numeric" },
    );
    render(<DayHeader {...makeProps(distantDate)} />);
    expect(screen.getByText(expectedLabel)).toBeInTheDocument();
  });

  it("calls onPrev when the previous-day button is clicked", async () => {
    const user = userEvent.setup();
    const props = makeProps(today);
    render(<DayHeader {...props} />);

    await user.click(screen.getByRole("button", { name: /previous day/i }));
    expect(props.onPrev).toHaveBeenCalledTimes(1);
  });

  it("calls onNext when the next-day button is clicked", async () => {
    const user = userEvent.setup();
    const props = makeProps(today);
    render(<DayHeader {...props} />);

    await user.click(screen.getByRole("button", { name: /next day/i }));
    expect(props.onNext).toHaveBeenCalledTimes(1);
  });

  it('calls onToday when "Jump to today" is clicked on a non-today date', async () => {
    const user = userEvent.setup();
    const props = makeProps(yesterday);
    render(<DayHeader {...props} />);

    await user.click(screen.getByRole("button", { name: /jump to today/i }));
    expect(props.onToday).toHaveBeenCalledTimes(1);
  });

  it('disables "Jump to today" when the current date is today', () => {
    render(<DayHeader {...makeProps(today)} />);
    expect(
      screen.getByRole("button", { name: /jump to today/i }),
    ).toBeDisabled();
  });

  it('enables "Jump to today" when the current date is not today', () => {
    render(<DayHeader {...makeProps(yesterday)} />);
    expect(
      screen.getByRole("button", { name: /jump to today/i }),
    ).toBeEnabled();
  });
});
