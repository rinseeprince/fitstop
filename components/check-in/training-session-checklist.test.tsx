import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CheckInTrainingEventDetail } from "@/types/check-in";

// canEditDay is the ONLY lock rule — stub it so the test controls editability
// independent of the real today/timezone math.
const canEditDayMock = vi.fn();
vi.mock("@/lib/daily-log-permissions", () => ({
  canEditDay: (...args: unknown[]) => canEditDayMock(...args),
}));

// Replace the Radix Select with a native <select> so onValueChange is driveable
// deterministically in jsdom (Radix's portal listbox doesn't open reliably here).
vi.mock("@/components/ui/select", () => {
  const Select = ({
    value,
    onValueChange,
    children,
  }: {
    value?: string;
    onValueChange?: (v: string) => void;
    children?: React.ReactNode;
  }) => (
    <select
      role="combobox"
      value={value ?? ""}
      onChange={(e) => onValueChange?.(e.target.value)}
    >
      <option value="" disabled hidden />
      <option value="full">Completed</option>
      <option value="partial">Partial</option>
      <option value="skipped">Skipped</option>
      {children}
    </select>
  );
  const Passthrough = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
  return {
    Select,
    SelectTrigger: Passthrough,
    SelectValue: () => null,
    SelectContent: () => null,
    SelectItem: () => null,
  };
});

import { TrainingSessionChecklist } from "./training-session-checklist";

const detail = (overrides: Partial<CheckInTrainingEventDetail>): CheckInTrainingEventDetail => ({
  eventId: "e-1",
  date: "2026-05-11",
  sessionName: "Push Day",
  status: "scheduled",
  logStatus: "not_logged",
  trainingSessionId: "ts-1",
  sessionLogId: null,
  ...overrides,
});

describe("TrainingSessionChecklist (Session 6.4)", () => {
  beforeEach(() => {
    cleanup();
    canEditDayMock.mockReset();
  });

  it("renders logged-day rows LOCKED (display-only, no inputs) when canEditDay is false", () => {
    canEditDayMock.mockReturnValue(false);
    render(
      <TrainingSessionChecklist
        events={[
          detail({
            eventId: "e-locked",
            sessionName: "Logged Push",
            status: "completed",
            logStatus: "logged",
            completionQuality: "full",
            notes: "felt strong",
            sessionLogId: "l1",
          }),
        ]}
        clientTimezone="UTC"
        onLogEvent={vi.fn()}
      />
    );

    expect(screen.getByText("Logged Push")).toBeInTheDocument();
    // No editable controls on a locked row.
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    // The logged note shows read-only.
    expect(screen.getByText(/felt strong/)).toBeInTheDocument();
  });

  it("renders unlogged-day rows EDITABLE (status select + notes) when canEditDay is true", () => {
    canEditDayMock.mockReturnValue(true);
    render(
      <TrainingSessionChecklist
        events={[detail({ eventId: "e-open", sessionName: "Open Pull", logStatus: "not_logged" })]}
        clientTimezone="UTC"
        onLogEvent={vi.fn()}
      />
    );

    expect(screen.getByText("Open Pull")).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("canEditDay is the only lock rule — a completed/logged row is editable if the stub allows it", () => {
    canEditDayMock.mockReturnValue(true);
    render(
      <TrainingSessionChecklist
        events={[
          detail({
            eventId: "e-1",
            status: "completed",
            logStatus: "logged",
            sessionLogId: "l1",
          }),
        ]}
        clientTimezone="UTC"
        onLogEvent={vi.fn()}
      />
    );
    // Despite being logged+completed, the stubbed canEditDay=true makes it editable.
    expect(screen.getByRole("combobox")).toBeInTheDocument();
  });

  it("editing an unlogged day POSTs via onLogEvent (per-event log endpoint), not a check-in write", async () => {
    canEditDayMock.mockReturnValue(true);
    const onLogEvent = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();

    render(
      <TrainingSessionChecklist
        events={[detail({ eventId: "e-open", sessionName: "Open Pull", logStatus: "not_logged" })]}
        clientTimezone="UTC"
        onLogEvent={onLogEvent}
      />
    );

    await user.selectOptions(screen.getByRole("combobox"), "partial");

    await waitFor(() => {
      expect(onLogEvent).toHaveBeenCalledWith("e-open", {
        completionQuality: "partial",
        notes: undefined,
      });
    });
  });
});
