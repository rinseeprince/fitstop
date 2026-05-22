import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import { LockedDayNotice } from "./locked-day-notice";

describe("LockedDayNotice", () => {
  beforeEach(() => {
    cleanup();
  });

  it("renders the past-logged copy", () => {
    render(<LockedDayNotice reason="past-logged" />);
    expect(screen.getByText(/locked and can.t be edited/i)).toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("renders the today-no-plan copy, not the locked copy", () => {
    render(<LockedDayNotice reason="today-no-plan" />);
    expect(screen.getByText(/no plan scheduled for today/i)).toBeInTheDocument();
    expect(screen.queryByText(/locked and can.t be edited/i)).toBeNull();
  });
});
