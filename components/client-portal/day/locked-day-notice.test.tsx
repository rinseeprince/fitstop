import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import { LockedDayNotice } from "./locked-day-notice";

describe("LockedDayNotice", () => {
  beforeEach(() => {
    cleanup();
  });

  it("renders the locked copy", () => {
    render(<LockedDayNotice reason="locked" />);
    expect(screen.getByText("This day is locked.")).toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("renders the today-no-plan copy, not the locked copy", () => {
    render(<LockedDayNotice reason="today-no-plan" />);
    expect(screen.getByText(/no plan scheduled for today/i)).toBeInTheDocument();
    expect(screen.queryByText("This day is locked.")).toBeNull();
  });
});
