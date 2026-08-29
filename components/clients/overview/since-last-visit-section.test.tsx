import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { SinceLastVisitSection } from "./since-last-visit-section";
import type { ActivityItem } from "@/types/coach-brief";

// Required, not optional: units-context imports auth-context, which constructs
// the browser Supabase client at module load and throws without env vars.
const units = vi.hoisted(() => ({ preference: "metric" as "metric" | "imperial" }));
vi.mock("@/contexts/units-context", () => ({
  useUnits: () => ({ preference: units.preference, isLoading: false, error: null }),
}));

const NOOP = { onMarkSeen: vi.fn(), isMarkingSeen: false };

beforeEach(() => {
  cleanup();
  units.preference = "metric";
});

describe("SinceLastVisitSection", () => {
  it("first visit: names the state and what will appear next time", () => {
    render(<SinceLastVisitSection lastViewedAt={null} activity={[]} {...NOOP} />);

    expect(screen.getByText(/first time viewing this client/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /mark seen/i })).not.toBeInTheDocument();
  });

  it("nothing new: shows the caught-up state", () => {
    render(
      <SinceLastVisitSection lastViewedAt="2026-06-01T00:00:00Z" activity={[]} {...NOOP} />
    );

    expect(screen.getByText(/all caught up/i)).toBeInTheDocument();
    // Distinct from the first-visit state, which is the other empty branch.
    expect(screen.queryByText(/first time viewing/i)).not.toBeInTheDocument();
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

  it("renders at most five rows and counts the rest in the footer", () => {
    const activity: ActivityItem[] = Array.from({ length: 9 }, (_, i) => ({
      type: "session_completed" as const,
      at: `2026-06-0${i + 1}T17:00:00Z`,
      sessionName: `Session ${i + 1}`,
      exerciseCount: 4,
    }));

    render(
      <SinceLastVisitSection lastViewedAt="2026-06-01T00:00:00Z" activity={activity} {...NOOP} />
    );

    expect(screen.getAllByText("Session completed")).toHaveLength(5);
    // The five newest as the service ordered them — the cap slices, it never sorts.
    expect(screen.getByText(/Session 1 ·/)).toBeInTheDocument();
    expect(screen.queryByText(/Session 6 ·/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show 4 more" })).toBeInTheDocument();
  });

  it("expands to the whole feed, because Mark seen would otherwise destroy it unread", async () => {
    const user = userEvent.setup();
    const activity: ActivityItem[] = Array.from({ length: 9 }, (_, i) => ({
      type: "session_completed" as const,
      at: `2026-06-0${i + 1}T17:00:00Z`,
      sessionName: `Session ${i + 1}`,
      exerciseCount: 4,
    }));

    render(
      <SinceLastVisitSection lastViewedAt="2026-06-01T00:00:00Z" activity={activity} {...NOOP} />
    );
    await user.click(screen.getByRole("button", { name: "Show 4 more" }));

    expect(screen.getAllByText("Session completed")).toHaveLength(9);
    expect(screen.getByText(/Session 9 ·/)).toBeInTheDocument();
  });

  it("collapses back, so expanding is not a one-way door into a 1,760px card", async () => {
    const user = userEvent.setup();
    const activity: ActivityItem[] = Array.from({ length: 9 }, (_, i) => ({
      type: "session_completed" as const,
      at: `2026-06-0${i + 1}T17:00:00Z`,
      sessionName: `Session ${i + 1}`,
      exerciseCount: 4,
    }));

    render(
      <SinceLastVisitSection lastViewedAt="2026-06-01T00:00:00Z" activity={activity} {...NOOP} />
    );
    await user.click(screen.getByRole("button", { name: "Show 4 more" }));
    await user.click(screen.getByRole("button", { name: "Show less" }));

    expect(screen.getAllByText("Session completed")).toHaveLength(5);
    expect(screen.getByRole("button", { name: "Show 4 more" })).toBeInTheDocument();
  });

  it("shows no overflow footer when the feed fits", () => {
    const activity: ActivityItem[] = Array.from({ length: 5 }, (_, i) => ({
      type: "session_completed" as const,
      at: `2026-06-0${i + 1}T17:00:00Z`,
      sessionName: `Session ${i + 1}`,
      exerciseCount: 4,
    }));

    render(
      <SinceLastVisitSection lastViewedAt="2026-06-01T00:00:00Z" activity={activity} {...NOOP} />
    );

    expect(screen.getAllByText("Session completed")).toHaveLength(5);
    expect(screen.queryByRole("button", { name: /more$/ })).not.toBeInTheDocument();
  });

  it("shows a measurement's value and its delta from the previous entry", () => {
    const activity: ActivityItem[] = [
      {
        type: "measurement",
        at: "2026-06-02T08:00:00Z",
        metricKey: "weight",
        value: 82.4,
        previousValue: 83,
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
