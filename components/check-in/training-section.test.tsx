import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { TrainingSection } from "./training-section";
import type { CheckInTrainingEventDetail } from "@/types/check-in";

// Required, not optional: units-context imports auth-context, which constructs
// the browser Supabase client at module load and throws without env vars.
vi.mock("@/contexts/units-context", () => ({
  useUnits: () => ({ preference: "metric", isLoading: false, error: null }),
}));

const workout = (
  overrides: Partial<CheckInTrainingEventDetail> = {}
): CheckInTrainingEventDetail => ({
  eventId: "e-1",
  date: "2026-09-14",
  sessionName: "Push",
  status: "completed",
  logStatus: "logged",
  completionQuality: "full",
  trainingSessionId: "ts-1",
  sessionLogId: "sl-1",
  ...overrides,
});

/** A week with every prescribed workout done — the case that used to print
 *  "4 of 4 completed" on the rail. */
const FOUR_OF_FOUR: CheckInTrainingEventDetail[] = [
  ["Push", "2026-09-14"],
  ["Pull", "2026-09-15"],
  ["Legs", "2026-09-17"],
  ["Upper", "2026-09-18"],
].map(([sessionName, date], i) =>
  workout({ eventId: `e-${i}`, sessionName, date })
);

afterEach(cleanup);

describe("TrainingSection — the rail", () => {
  it("carries no completed count: the KPI ribbon states the figure once (owner, 2026-09-04)", () => {
    render(<TrainingSection workouts={FOUR_OF_FOUR} highlights={[]} />);

    expect(screen.getByText("Training")).toBeInTheDocument();
    expect(screen.queryByText(/\d+ of \d+ completed/)).not.toBeInTheDocument();
    // The rows themselves are untouched.
    expect(screen.getByText("Push")).toBeInTheDocument();
    expect(screen.getAllByText("Full")).toHaveLength(4);
  });

  it("names each workout's day from its own date", () => {
    render(<TrainingSection workouts={FOUR_OF_FOUR} highlights={[]} />);

    expect(screen.getByText("Mon")).toBeInTheDocument();
    expect(screen.getByText("Fri")).toBeInTheDocument();
  });

  // Commit 10's safety net: the pill follows the LOG, not the status word.
  it("renders a completed workout whose log says partial as Partial", () => {
    render(
      <TrainingSection
        workouts={[workout({ status: "completed", completionQuality: "partial" })]}
        highlights={[]}
      />
    );

    expect(screen.getByText("Partial")).toBeInTheDocument();
    expect(screen.queryByText("Full")).not.toBeInTheDocument();
  });

  it("renders a workout the client never logged as Missed, and names the session they swapped in", () => {
    render(
      <TrainingSection
        workouts={[
          workout({
            eventId: "e-9",
            status: "scheduled",
            logStatus: "not_logged",
            completionQuality: null,
            sessionLogId: null,
          }),
          workout({ eventId: "e-10", performedSessionName: "Lower" }),
        ]}
        highlights={[]}
      />
    );

    expect(screen.getByText("Missed")).toBeInTheDocument();
    expect(screen.getByText("Lower")).toBeInTheDocument();
  });
});
