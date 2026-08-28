import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { CheckInGateStatus } from "@/lib/check-in-schedule";

const { mockUseSWR } = vi.hoisted(() => ({ mockUseSWR: vi.fn() }));
vi.mock("swr", () => ({ default: mockUseSWR }));
vi.mock("@/lib/swr-fetcher", () => ({ swrFetcher: vi.fn() }));

import { CheckInCardSummary } from "./check-in-card-summary";

function setStatus(status: CheckInGateStatus, nextDueDate: string | null = null) {
  mockUseSWR.mockReturnValue({
    data: { success: true, data: { status, nextDueDate } },
    isLoading: false,
  });
}

describe("CheckInCardSummary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cleanup();
  });

  it("renders a skeleton while loading", () => {
    mockUseSWR.mockReturnValue({ data: undefined, isLoading: true });
    render(<CheckInCardSummary />);
    expect(screen.getByText("Weekly check-in")).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("shows 'Due today' with a Start hint when available", () => {
    setStatus("available");
    render(<CheckInCardSummary />);
    expect(screen.getByText("Due today")).toBeInTheDocument();
    expect(screen.getByText("Start")).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute("href", "/client/check-in");
  });

  it("shows the overdue prompt", () => {
    setStatus("overdue");
    render(<CheckInCardSummary />);
    expect(screen.getByText("Overdue — submit now")).toBeInTheDocument();
    expect(screen.getByText("Start")).toBeInTheDocument();
  });

  // "Completed this week" is retired. Submitting advances the due date, so a
  // client who has just checked in and one whose turn has not come round yet
  // are the same state — and the DATE is the useful half of it: they know they
  // checked in, they do not know when the next one lands. (Its "View" hint was
  // a fib besides: the row led to the check-in form, not to the check-in.)
  it("shows the next due date whether they have just checked in or not", () => {
    setStatus("not_due", "2026-05-29");
    render(<CheckInCardSummary />);
    expect(screen.getByText("Next check-in May 29")).toBeInTheDocument();
    expect(screen.queryByText("Completed this week")).not.toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute("href", "/client/check-in");
  });
});
