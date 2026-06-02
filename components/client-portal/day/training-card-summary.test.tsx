import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import { TrainingCardSummary } from "./training-card-summary";
import type { TrainingEventSummary } from "@/types/training";
import { getDateDaysFrom, getTodayDateString } from "@/lib/date-helpers";

const DATE = "2026-05-08";
const FUTURE_DATE = getDateDaysFrom(
  new Date(getTodayDateString() + "T00:00:00"),
  1,
);

function event(overrides: Partial<TrainingEventSummary> = {}): TrainingEventSummary {
  return {
    eventId: "e1",
    sessionName: "Push Day A",
    sessionFocus: null,
    completionQuality: null,
    loggedExerciseCount: 0,
    prescribedExerciseCount: 6,
    ...overrides,
  };
}

describe("TrainingCardSummary", () => {
  beforeEach(() => cleanup());

  it("renders Rest day as a link to the picker for today/past", () => {
    render(<TrainingCardSummary events={[]} date={DATE} />);

    expect(screen.getByText("Rest day")).toBeInTheDocument();
    expect(screen.getByText("No training scheduled")).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      `/client/training?date=${DATE}`,
    );
  });

  it("renders Rest day with no link for a future date", () => {
    render(<TrainingCardSummary events={[]} date={FUTURE_DATE} />);

    expect(screen.getByText("Rest day")).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("renders a 'Trained for' line when trainedFor is present", () => {
    render(
      <TrainingCardSummary
        events={[]}
        date={DATE}
        trainedFor={[{ date: "2026-05-05", sessionName: "Pull Day" }]}
      />,
    );

    expect(screen.getByText(/Trained for/)).toBeInTheDocument();
    expect(screen.getByText("Pull Day")).toBeInTheDocument();
  });

  it("renders an unlogged event with Tap to log and link to detail", () => {
    render(<TrainingCardSummary events={[event()]} date={DATE} />);

    expect(screen.getByText("Push Day A")).toBeInTheDocument();
    expect(screen.getByText("Not logged yet")).toBeInTheDocument();
    expect(screen.getByText("Tap to log")).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      `/client/training?eventId=e1&date=${DATE}`,
    );
  });

  it("renders a quick-logged-full event with Tap to view", () => {
    render(
      <TrainingCardSummary
        events={[event({ completionQuality: "full" })]}
        date={DATE}
      />,
    );

    expect(screen.getByText("Logged as complete")).toBeInTheDocument();
    expect(screen.getByText("Tap to view")).toBeInTheDocument();
  });

  it("renders a quick-logged-partial event with the right copy", () => {
    render(
      <TrainingCardSummary
        events={[event({ completionQuality: "partial" })]}
        date={DATE}
      />,
    );

    expect(screen.getByText("Logged as partial")).toBeInTheDocument();
  });

  it("renders a quick-logged-skipped event with the right copy", () => {
    render(
      <TrainingCardSummary
        events={[event({ completionQuality: "skipped" })]}
        date={DATE}
      />,
    );

    expect(screen.getByText("Logged as skipped")).toBeInTheDocument();
  });

  it("renders a detailed-logged event with N/M exercises logged + Tap to view", () => {
    render(
      <TrainingCardSummary
        events={[
          event({
            completionQuality: "partial",
            loggedExerciseCount: 5,
            prescribedExerciseCount: 6,
          }),
        ]}
        date={DATE}
      />,
    );

    expect(screen.getByText("5/6 exercises logged")).toBeInTheDocument();
    expect(screen.getByText("Tap to view")).toBeInTheDocument();
  });

  it("renders multiple events as a list of links with distinct hrefs", () => {
    render(
      <TrainingCardSummary
        events={[
          event({ eventId: "e1", sessionName: "Push" }),
          event({ eventId: "e2", sessionName: "Cardio" }),
        ]}
        date={DATE}
      />,
    );

    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute(
      "href",
      `/client/training?eventId=e1&date=${DATE}`,
    );
    expect(links[1]).toHaveAttribute(
      "href",
      `/client/training?eventId=e2&date=${DATE}`,
    );
    expect(screen.getByText("Push")).toBeInTheDocument();
    expect(screen.getByText("Cardio")).toBeInTheDocument();
  });

  it("renders future-date events as info-only with no link and no hint", () => {
    render(<TrainingCardSummary events={[event()]} date={FUTURE_DATE} />);

    expect(screen.getByText("Push Day A")).toBeInTheDocument();
    expect(screen.getByText("Not logged yet")).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByText("Tap to log")).toBeNull();
    expect(screen.queryByText("Tap to view")).toBeNull();
  });
});
