import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { NeedsAttentionSection } from "./needs-attention-section";
import type { AlertSeverity, AlertType, AttentionAlert } from "@/types/attention-feed";

function alert(
  type: AlertType,
  severity: AlertSeverity,
  message: string,
  affectedDays: string[] = []
): AttentionAlert {
  return { type, severity, message, affectedDays, metricData: [] };
}

const PROPS = {
  clientName: "Alex",
  unreviewedCheckIn: null,
  attentionAlerts: [],
  blockEnding: null,
  onTabChange: vi.fn(),
  onDismissAlert: vi.fn(),
};

beforeEach(() => cleanup());

describe("NeedsAttentionSection", () => {
  it("zero-state: caught up when nothing is pending", () => {
    render(<NeedsAttentionSection {...PROPS} />);

    expect(screen.getByText(/caught up on Alex/i)).toBeInTheDocument();
  });

  it("puts no count on the rail — the rows are the count", () => {
    render(
      <NeedsAttentionSection
        {...PROPS}
        unreviewedCheckIn={{ id: "ci-1", submittedAt: new Date().toISOString() }}
        attentionAlerts={[alert("training_missed", "high", "Missed 3 training sessions")]}
        blockEnding={{ blockName: "Build", endsOn: "2026-08-30", nextBlockName: "Cut" }}
      />
    );

    expect(screen.getByText("Check-in awaiting review")).toBeInTheDocument();
    expect(screen.getByText("3 sessions missed")).toBeInTheDocument();
    // A "3" beside three visible rows restates what is already on screen.
    expect(screen.queryByText("3", { selector: "span" })).not.toBeInTheDocument();
  });

  it("routes the check-in row to check-ins through a text action, not a button", async () => {
    const user = userEvent.setup();
    const onTabChange = vi.fn();
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

    render(
      <NeedsAttentionSection
        {...PROPS}
        onTabChange={onTabChange}
        unreviewedCheckIn={{ id: "ci-1", submittedAt: threeDaysAgo.toISOString() }}
      />
    );

    expect(screen.getByText("Submitted 3 days ago")).toBeInTheDocument();

    await user.click(screen.getByText("Check-in awaiting review"));
    expect(onTabChange).toHaveBeenCalledWith("check-ins");
  });

  it("keeps the block-ending row's journey round-trip params", async () => {
    const user = userEvent.setup();
    const onTabChange = vi.fn();

    render(
      <NeedsAttentionSection
        {...PROPS}
        onTabChange={onTabChange}
        blockEnding={{ blockName: "Build", endsOn: "2026-08-30", nextBlockName: "Cut" }}
      />
    );

    await user.click(screen.getByText("Build ends Sunday."));
    expect(onTabChange).toHaveBeenCalledWith("metrics", { journey: "blocks" });
  });

  it("words an alert with the dashboard's own copy functions", () => {
    render(
      <NeedsAttentionSection
        {...PROPS}
        attentionAlerts={[
          alert("high_stress", "high", "Stress elevated", ["2026-08-01", "2026-08-02"]),
        ]}
      />
    );

    expect(screen.getByText("High stress (2 days)")).toBeInTheDocument();
    expect(screen.getByText("Stress at 8+ for 2 days")).toBeInTheDocument();
  });

  it("renders the title alone when the fuller sentence would repeat it", () => {
    render(
      <NeedsAttentionSection
        {...PROPS}
        attentionAlerts={[alert("no_log_gap", "high", "No logs in 5 days")]}
      />
    );

    // no_log_gap falls through BOTH copy switches to alert.message, so a row
    // that printed both lines would show the same string twice.
    expect(screen.getAllByText("No logs in 5 days")).toHaveLength(1);
  });

  it("hides no_log_gap while no_engagement is live, and shows it again once that clears", () => {
    const gap = alert("no_log_gap", "high", "No logs in 5 days");
    const engagement = alert("no_engagement", "high", "No activity logged in the last 3 days");

    const { rerender } = render(
      <NeedsAttentionSection {...PROPS} attentionAlerts={[gap, engagement]} />
    );

    expect(screen.queryByText("No logs in 5 days")).not.toBeInTheDocument();
    expect(screen.getByText("No recent activity")).toBeInTheDocument();

    rerender(<NeedsAttentionSection {...PROPS} attentionAlerts={[gap]} />);

    expect(screen.getByText("No logs in 5 days")).toBeInTheDocument();
  });

  it("sends each alert to its destination and labels it there", async () => {
    const user = userEvent.setup();
    const onTabChange = vi.fn();

    render(
      <NeedsAttentionSection
        {...PROPS}
        onTabChange={onTabChange}
        attentionAlerts={[
          alert("training_missed", "high", "Missed 3 training sessions this week"),
          alert("habit_dropoff", "medium", "Habits at 2 of 7 days below 50%"),
        ]}
      />
    );

    expect(screen.getByText("TRAINING")).toBeInTheDocument();
    expect(screen.getByText("HABITS")).toBeInTheDocument();

    await user.click(screen.getByText("3 sessions missed"));
    expect(onTabChange).toHaveBeenCalledWith("training");
  });

  it("orders alerts by severity", () => {
    render(
      <NeedsAttentionSection
        {...PROPS}
        attentionAlerts={[
          alert("habit_dropoff", "low", "Habits at 2 of 7 days below 50%"),
          alert("training_missed", "high", "Missed 3 training sessions this week"),
        ]}
      />
    );

    const titles = screen
      .getAllByText(/sessions missed|Low habits/)
      .map((el) => el.textContent);
    expect(titles[0]).toBe("3 sessions missed");
  });

  it("dismisses an alert by type, and offers no dismiss on the coach-action rows", async () => {
    const user = userEvent.setup();
    const onDismissAlert = vi.fn();

    render(
      <NeedsAttentionSection
        {...PROPS}
        onDismissAlert={onDismissAlert}
        unreviewedCheckIn={{ id: "ci-1", submittedAt: new Date().toISOString() }}
        blockEnding={{ blockName: "Build", endsOn: "2026-08-30", nextBlockName: null }}
        attentionAlerts={[alert("mood_drop", "high", "Mood dropped")]}
      />
    );

    const dismissals = screen.getAllByTitle("Dismiss this alert");
    expect(dismissals).toHaveLength(1);

    await user.click(dismissals[0]);
    expect(onDismissAlert).toHaveBeenCalledWith("mood_drop");
  });
});
