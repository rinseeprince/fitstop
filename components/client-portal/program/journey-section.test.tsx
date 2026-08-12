import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

// Required, not optional: units-context imports auth-context, which constructs
// the browser Supabase client at module load and throws without env vars. Any
// test rendering a component that calls useUnits() must stub this module.
const useUnitsMock = vi.fn();
vi.mock("@/contexts/units-context", () => ({
  useUnits: () => useUnitsMock(),
}));

import { JourneySection } from "./journey-section";
import type { ClientJourney, ClientJourneyBlock } from "@/types/client-journey";

const block = (
  overrides: Partial<ClientJourneyBlock> = {}
): ClientJourneyBlock => ({
  id: "block-1",
  name: "Build",
  focus: "Six weeks of volume",
  targetWeightKg: 89,
  startsOn: "2026-08-02",
  endsOn: "2026-08-22",
  weeks: 3,
  state: "current",
  weekOfTotal: { current: 2, total: 3 },
  startWeightKg: 90.2,
  endWeightKg: 89.9,
  ...overrides,
});

const journey = (overrides: Partial<ClientJourney> = {}): ClientJourney => ({
  clientToday: "2026-08-12",
  blocks: [block()],
  goal: { weightKg: 85, deadline: "2026-12-01" },
  currentWeightKg: 89.9,
  ...overrides,
});

beforeEach(() => {
  cleanup();
  useUnitsMock.mockReturnValue({
    preference: "metric",
    isLoading: false,
    error: null,
  });
});

describe("JourneySection", () => {
  it("renders the current block: name, focus, week line, time-progress bar, both target lines", () => {
    const { container } = render(<JourneySection journey={journey()} />);

    expect(screen.getByText("Build")).toBeInTheDocument();
    expect(screen.getByText("Six weeks of volume")).toBeInTheDocument();
    expect(screen.getByText(/Week 2 of 3 · ends 22 Aug/)).toBeInTheDocument();

    // 2026-08-02 → 2026-08-22 is 20 days; 10 elapsed on the wire's clientToday.
    const fill = container.querySelector("div[style]") as HTMLElement;
    expect(fill.style.width).toBe("50%");

    expect(screen.getByText("This block:")).toBeInTheDocument();
    expect(
      screen.getByText(/89\.0 kg by 22 Aug, 0\.9 kg to go/)
    ).toBeInTheDocument();
    expect(screen.getByText("Your goal:")).toBeInTheDocument();
    expect(
      screen.getByText(/85\.0 kg by 1 Dec, 4\.9 kg to go/)
    ).toBeInTheDocument();
  });

  it("omits the goal line on maintenance and the block line without a target", () => {
    render(
      <JourneySection
        journey={journey({
          blocks: [block({ targetWeightKg: null })],
          goal: { weightKg: null, deadline: null },
        })}
      />
    );

    expect(screen.queryByText("This block:")).not.toBeInTheDocument();
    expect(screen.queryByText("Your goal:")).not.toBeInTheDocument();
  });

  it("drops the 'to go' tail when no current weight exists; the deadline clause when none is set", () => {
    render(
      <JourneySection
        journey={journey({
          currentWeightKg: null,
          goal: { weightKg: 85, deadline: null },
        })}
      />
    );

    expect(screen.getByText("89.0 kg by 22 Aug")).toBeInTheDocument();
    expect(screen.getByText("85.0 kg")).toBeInTheDocument();
    expect(screen.queryByText(/to go/)).not.toBeInTheDocument();
  });

  it("finished blocks: coach-row wording with the change computed round-then-subtract", () => {
    render(
      <JourneySection
        journey={journey({
          blocks: [
            // 90.06 → 89.94 displays as 90.1 → 89.9: the change is −0.2 like
            // the coach card (subtracting pre-rounded points), NOT the −0.1 a
            // raw round(end − start) would print.
            block({
              id: "past-1",
              name: "Base",
              state: "past",
              weekOfTotal: null,
              startsOn: "2026-06-01",
              endsOn: "2026-06-28",
              weeks: 4,
              startWeightKg: 90.06,
              endWeightKg: 89.94,
            }),
            block({
              id: "past-2",
              name: "Intro",
              state: "past",
              weekOfTotal: null,
              startsOn: "2026-05-01",
              endsOn: "2026-05-21",
              weeks: 3,
              startWeightKg: null,
              endWeightKg: null,
            }),
          ],
        })}
      />
    );

    expect(screen.getByText("Finished blocks")).toBeInTheDocument();
    expect(screen.getByText("Base")).toBeInTheDocument();
    expect(screen.getByText(/1 Jun – 28 Jun · 4 weeks/)).toBeInTheDocument();
    expect(screen.getByText("-0.2 kg")).toBeInTheDocument();
    // No weights → the muted dash, never a fabricated zero.
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("renders weights in the viewer's unit (imperial)", () => {
    useUnitsMock.mockReturnValue({
      preference: "imperial",
      isLoading: false,
      error: null,
    });

    render(<JourneySection journey={journey()} />);

    // 89 kg → 196.2 lbs; current 89.9 kg → 198.2 lbs; goal 85 kg → 187.4 lbs.
    expect(
      screen.getByText(/196\.2 lbs by 22 Aug, 2\.0 lbs to go/)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/187\.4 lbs by 1 Dec, 10\.8 lbs to go/)
    ).toBeInTheDocument();
  });

  it("renders nothing when the journey holds only future blocks", () => {
    const { container } = render(
      <JourneySection
        journey={journey({
          blocks: [
            block({
              state: "future",
              weekOfTotal: null,
              startsOn: "2026-09-01",
              endsOn: "2026-09-28",
              startWeightKg: null,
              endWeightKg: null,
            }),
          ],
          currentWeightKg: null,
        })}
      />
    );

    expect(container).toBeEmptyDOMElement();
  });
});
