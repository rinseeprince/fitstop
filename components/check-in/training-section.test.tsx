import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { TrainingSection } from "./training-section";
import type { CheckInWithDetails } from "@/types/check-in";

// Required, not optional: units-context imports auth-context, which constructs
// the browser Supabase client at module load and throws without env vars.
vi.mock("@/contexts/units-context", () => ({
  useUnits: () => ({ preference: "metric", isLoading: false, error: null }),
}));

/** A week with every prescribed session done — the case that used to print
 *  "4 of 4 completed" on the rail. */
const FOUR_OF_FOUR = {
  sessionCompletions: ["Push", "Pull", "Legs", "Upper"].map((sessionName, i) => ({
    id: `s-${i}`,
    sessionName,
    dayOfWeek: ["monday", "tuesday", "thursday", "friday"][i],
    completed: true,
    completionQuality: "full",
  })),
  exerciseHighlights: [],
} as unknown as CheckInWithDetails;

afterEach(cleanup);

describe("TrainingSection — the rail", () => {
  it("carries no completed count: the KPI ribbon states the figure once (owner, 2026-09-04)", () => {
    render(<TrainingSection checkIn={FOUR_OF_FOUR} />);

    expect(screen.getByText("Training")).toBeInTheDocument();
    expect(screen.queryByText(/\d+ of \d+ completed/)).not.toBeInTheDocument();
    // The rows themselves are untouched.
    expect(screen.getByText("Push")).toBeInTheDocument();
    expect(screen.getAllByText("Completed")).toHaveLength(4);
  });
});
