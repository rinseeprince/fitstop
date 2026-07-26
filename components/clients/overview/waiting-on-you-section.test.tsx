import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { WaitingOnYouSection } from "./waiting-on-you-section";
import type { AlertSeverity, AlertType, AttentionAlert } from "@/types/attention-feed";

function alert(type: AlertType, severity: AlertSeverity, message: string): AttentionAlert {
  return { type, severity, message, affectedDays: [], metricData: [] };
}

beforeEach(() => cleanup());

describe("WaitingOnYouSection", () => {
  it("zero-state: caught up when nothing is pending", () => {
    render(
      <WaitingOnYouSection
        clientName="Alex"
        unreviewedCheckIn={null}
        attentionAlerts={[]}
        onTabChange={vi.fn()}
        onDismissAlert={vi.fn()}
      />
    );

    expect(screen.getByText(/caught up on Alex/i)).toBeInTheDocument();
    // The count chip is suppressed when there is nothing to count.
    expect(screen.queryByRole("button", { name: /review/i })).not.toBeInTheDocument();
  });

  it("counts the check-in alongside the alerts", () => {
    render(
      <WaitingOnYouSection
        clientName="Alex"
        unreviewedCheckIn={{ id: "ci-1", submittedAt: new Date().toISOString() }}
        attentionAlerts={[alert("no_log_gap", "high", "No logs in 5 days")]}
        onTabChange={vi.fn()}
        onDismissAlert={vi.fn()}
      />
    );

    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("renders the check-in row with its submitted-at phrase and routes Review to check-ins", async () => {
    const user = userEvent.setup();
    const onTabChange = vi.fn();
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

    render(
      <WaitingOnYouSection
        clientName="Alex"
        unreviewedCheckIn={{ id: "ci-1", submittedAt: threeDaysAgo.toISOString() }}
        attentionAlerts={[]}
        onTabChange={onTabChange}
        onDismissAlert={vi.fn()}
      />
    );

    expect(screen.getByText(/check-in awaiting review/i)).toBeInTheDocument();
    expect(screen.getByText("Submitted 3 days ago")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /review/i }));
    expect(onTabChange).toHaveBeenCalledWith("check-ins");
  });

  it("says 'today' rather than '0 days ago' for a same-day submission", () => {
    render(
      <WaitingOnYouSection
        clientName="Alex"
        unreviewedCheckIn={{ id: "ci-1", submittedAt: new Date().toISOString() }}
        attentionAlerts={[]}
        onTabChange={vi.fn()}
        onDismissAlert={vi.fn()}
      />
    );

    expect(screen.getByText("Submitted today")).toBeInTheDocument();
  });

  it("sorts high severity above medium", () => {
    render(
      <WaitingOnYouSection
        clientName="Alex"
        unreviewedCheckIn={null}
        attentionAlerts={[
          alert("habit_dropoff", "medium", "Habits slipping"),
          alert("training_missed", "high", "Two sessions missed"),
        ]}
        onTabChange={vi.fn()}
        onDismissAlert={vi.fn()}
      />
    );

    // Each row is a nav button plus an icon-only dismiss button; only the
    // former carries text, so filtering on it gives the rows in DOM order.
    const rows = screen.getAllByRole("button").filter((b) => b.textContent?.trim());
    expect(within(rows[0]).getByText("Two sessions missed")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Habits slipping")).toBeInTheDocument();
  });

  it("offers a dismiss action per alert, reporting the alert type", async () => {
    const user = userEvent.setup();
    const onDismissAlert = vi.fn();

    render(
      <WaitingOnYouSection
        clientName="Alex"
        unreviewedCheckIn={null}
        attentionAlerts={[alert("high_stress", "medium", "Stress elevated")]}
        onTabChange={vi.fn()}
        onDismissAlert={onDismissAlert}
      />
    );

    await user.click(screen.getByRole("button", { name: "Dismiss: Stress elevated" }));
    expect(onDismissAlert).toHaveBeenCalledWith("high_stress");
  });

  it("dismissing does not also navigate", async () => {
    const user = userEvent.setup();
    const onTabChange = vi.fn();

    render(
      <WaitingOnYouSection
        clientName="Alex"
        unreviewedCheckIn={null}
        attentionAlerts={[alert("high_stress", "medium", "Stress elevated")]}
        onTabChange={onTabChange}
        onDismissAlert={vi.fn()}
      />
    );

    await user.click(screen.getByRole("button", { name: "Dismiss: Stress elevated" }));
    expect(onTabChange).not.toHaveBeenCalled();
  });

  it("navigates each alert to the tab that owns its data, labelled", async () => {
    const user = userEvent.setup();
    const onTabChange = vi.fn();

    render(
      <WaitingOnYouSection
        clientName="Alex"
        unreviewedCheckIn={null}
        attentionAlerts={[
          alert("high_soreness", "medium", "Soreness elevated"),
          alert("habit_dropoff", "medium", "Habits slipping"),
        ]}
        onTabChange={onTabChange}
        onDismissAlert={vi.fn()}
      />
    );

    expect(screen.getByText("WELLNESS")).toBeInTheDocument();
    expect(screen.getByText("HABITS")).toBeInTheDocument();

    await user.click(screen.getByText("Soreness elevated"));
    expect(onTabChange).toHaveBeenCalledWith("wellness");

    await user.click(screen.getByText("Habits slipping"));
    expect(onTabChange).toHaveBeenCalledWith("daily-habits");
  });
});
