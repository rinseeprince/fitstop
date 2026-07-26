import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { SinceLastVisitSection } from "./since-last-visit-section";
import type { ActivityItem } from "@/types/coach-brief";

const NOOP = { onMarkSeen: vi.fn(), isMarkingSeen: false };

beforeEach(() => cleanup());

describe("SinceLastVisitSection", () => {
  it("first visit: names the state and what will appear next time", () => {
    render(<SinceLastVisitSection lastViewedAt={null} activity={[]} {...NOOP} />);

    expect(screen.getByText(/first time viewing this client/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /mark seen/i })).not.toBeInTheDocument();
  });

  it("nothing new: shows the caught-up state with the anchor date", () => {
    render(
      <SinceLastVisitSection lastViewedAt="2026-06-01T00:00:00Z" activity={[]} {...NOOP} />
    );

    expect(screen.getByText(/all caught up/i)).toBeInTheDocument();
    expect(screen.getByText(/Nothing new since 1 Jun/)).toBeInTheDocument();
  });

  it("renders one row per activity type", () => {
    const activity: ActivityItem[] = [
      { type: "check_in", at: "2026-06-02T09:00:00Z" },
      {
        type: "measurement",
        at: "2026-06-02T08:00:00Z",
        metricKey: "weight",
        value: 82.4,
        previousValue: 83,
        unit: "kg",
      },
      {
        type: "pr",
        at: "2026-06-01T18:00:00Z",
        exerciseName: "Back Squat",
        weight: 140,
        previousBest: 135,
      },
      {
        type: "session_completed",
        at: "2026-06-01T17:00:00Z",
        sessionName: "Lower A",
        exerciseCount: 6,
      },
    ];

    render(
      <SinceLastVisitSection lastViewedAt="2026-06-01T00:00:00Z" activity={activity} {...NOOP} />
    );

    expect(screen.getByText("Check-in submitted")).toBeInTheDocument();
    expect(screen.getByText("Weight logged")).toBeInTheDocument();
    expect(screen.getByText("New personal record")).toBeInTheDocument();
    expect(screen.getByText("Session completed")).toBeInTheDocument();
  });

  it("shows a measurement's value and its delta from the previous entry", () => {
    const activity: ActivityItem[] = [
      {
        type: "measurement",
        at: "2026-06-02T08:00:00Z",
        metricKey: "weight",
        value: 82.4,
        previousValue: 83,
        unit: "kg",
      },
    ];

    render(
      <SinceLastVisitSection lastViewedAt="2026-06-01T00:00:00Z" activity={activity} {...NOOP} />
    );

    expect(screen.getByText(/82\.4 kg/)).toBeInTheDocument();
    expect(screen.getByText(/-0\.6/)).toBeInTheDocument();
  });

  it("omits the delta when there is no previous value", () => {
    const activity: ActivityItem[] = [
      {
        type: "measurement",
        at: "2026-06-02T08:00:00Z",
        metricKey: "waist",
        value: 32,
        previousValue: null,
        unit: "in",
      },
    ];

    render(
      <SinceLastVisitSection lastViewedAt="2026-06-01T00:00:00Z" activity={activity} {...NOOP} />
    );

    expect(screen.getByText("Waist logged")).toBeInTheDocument();
    expect(screen.queryByText(/from last/)).not.toBeInTheDocument();
  });

  it("Mark seen is offered only when there is a feed, and calls back", async () => {
    const user = userEvent.setup();
    const onMarkSeen = vi.fn();

    render(
      <SinceLastVisitSection
        lastViewedAt="2026-06-01T00:00:00Z"
        activity={[{ type: "check_in", at: "2026-06-02T09:00:00Z" }]}
        onMarkSeen={onMarkSeen}
        isMarkingSeen={false}
      />
    );

    await user.click(screen.getByRole("button", { name: /mark seen/i }));
    expect(onMarkSeen).toHaveBeenCalledTimes(1);
  });
});
