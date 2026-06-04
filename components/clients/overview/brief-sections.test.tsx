import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { WaitingOnYouSection } from "./waiting-on-you-section";
import { SinceLastVisitSection } from "./since-last-visit-section";
import type { SinceLastVisit } from "@/types/coach-brief";

const ZERO: SinceLastVisit = {
  newCheckIns: 0,
  newLogs: 0,
  newBodyMetrics: 0,
  newWorkoutsLogged: 0,
  eventStatusChanges: 0,
};

beforeEach(() => cleanup());

describe("WaitingOnYouSection", () => {
  it("zero-state: caught up when nothing is pending", () => {
    render(
      <WaitingOnYouSection
        clientName="Alex"
        unreviewedCheckIn={null}
        attentionAlerts={[]}
        onReviewCheckIns={vi.fn()}
      />
    );
    expect(screen.getByText(/caught up on Alex/i)).toBeInTheDocument();
  });

  it("renders an unreviewed check-in with a Review action and surfaces alerts", async () => {
    const user = userEvent.setup();
    const onReview = vi.fn();
    render(
      <WaitingOnYouSection
        clientName="Alex"
        unreviewedCheckIn={{ id: "ci-1", createdAt: "2026-06-03T10:00:00Z", status: "pending" }}
        attentionAlerts={[
          {
            type: "no_log_gap",
            severity: "high",
            message: "No logs in 5 days",
            affectedDays: [],
            metricData: [],
          },
        ]}
        onReviewCheckIns={onReview}
      />
    );

    expect(screen.getByText(/check-in awaiting review/i)).toBeInTheDocument();
    expect(screen.getByText("No logs in 5 days")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /review/i }));
    expect(onReview).toHaveBeenCalledTimes(1);
  });
});

describe("SinceLastVisitSection", () => {
  it("first visit: shows the first-visit copy", () => {
    render(<SinceLastVisitSection lastViewedAt={null} deltas={ZERO} />);
    expect(screen.getByText(/first time viewing this client/i)).toBeInTheDocument();
  });

  it("nothing new: shows the since-date copy", () => {
    render(<SinceLastVisitSection lastViewedAt="2026-06-01T00:00:00Z" deltas={ZERO} />);
    expect(screen.getByText(/nothing new since/i)).toBeInTheDocument();
  });

  it("renders non-zero deltas as a list", () => {
    render(
      <SinceLastVisitSection
        lastViewedAt="2026-06-01T00:00:00Z"
        deltas={{ ...ZERO, newCheckIns: 2, newWorkoutsLogged: 3 }}
      />
    );
    expect(screen.getByText("2 new check-ins")).toBeInTheDocument();
    expect(screen.getByText("3 workouts logged")).toBeInTheDocument();
  });
});
