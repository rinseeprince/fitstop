import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import { JourneySection } from "./journey-section";
import type { ClientJourney, ClientJourneyBlock } from "@/types/client-journey";

const block = (
  overrides: Partial<ClientJourneyBlock> = {}
): ClientJourneyBlock => ({
  id: "block-1",
  name: "Build",
  focus: "Six weeks of volume",
  startsOn: "2026-08-02",
  endsOn: "2026-08-22",
  weeks: 3,
  state: "current",
  weekOfTotal: { current: 2, total: 3 },
  ...overrides,
});

const journey = (overrides: Partial<ClientJourney> = {}): ClientJourney => ({
  clientToday: "2026-08-12",
  blocks: [block()],
  goal: { weightKg: 85, deadline: "2026-12-01" },
  currentWeightKg: 89.9,
  currentBlockNotes: null,
  ...overrides,
});

beforeEach(() => {
  cleanup();
});

describe("JourneySection", () => {
  it("renders the current block: name, focus, week line, time-progress bar — never a target or the goal", () => {
    const { container } = render(<JourneySection journey={journey()} />);

    expect(screen.getByText("Build")).toBeInTheDocument();
    expect(screen.getByText("Six weeks of volume")).toBeInTheDocument();
    expect(screen.getByText(/Week 2 of 3 · ends 22 Aug/)).toBeInTheDocument();

    // 2026-08-02 → 2026-08-22 is 20 days; 10 elapsed on the wire's clientToday.
    const fill = container.querySelector("div[style]") as HTMLElement;
    expect(fill.style.width).toBe("50%");

    // The goal is the client's own card (goal-card.tsx), block or no block.
    expect(screen.queryByText(/Your goal/)).not.toBeInTheDocument();
    expect(screen.queryByText(/to go|kg/)).not.toBeInTheDocument();
  });

  it("finished blocks: name, dates and weeks — no weight figure", () => {
    render(
      <JourneySection
        journey={journey({
          blocks: [
            block({
              id: "past-1",
              name: "Base",
              state: "past",
              weekOfTotal: null,
              startsOn: "2026-06-01",
              endsOn: "2026-06-28",
              weeks: 4,
            }),
            block({
              id: "past-2",
              name: "Intro",
              state: "past",
              weekOfTotal: null,
              startsOn: "2026-05-01",
              endsOn: "2026-05-21",
              weeks: 3,
            }),
          ],
        })}
      />
    );

    expect(screen.getByText("Finished blocks")).toBeInTheDocument();
    expect(screen.getByText("Base")).toBeInTheDocument();
    expect(screen.getByText(/1 Jun – 28 Jun · 4 weeks/)).toBeInTheDocument();
    expect(screen.getByText("Intro")).toBeInTheDocument();
    // Nothing on the section is a weight.
    expect(screen.queryByText(/kg/)).not.toBeInTheDocument();
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
            }),
          ],
          currentWeightKg: null,
        })}
      />
    );

    expect(container).toBeEmptyDOMElement();
  });

  describe("coach notes", () => {
    const notes = {
      blockId: "block-1",
      notes: [
        { id: "n1", effectiveOn: "2026-08-05", body: "Dropping calories 200." },
        { id: "n2", effectiveOn: "2026-08-12", body: "Holding here this week." },
      ],
    };

    it("renders the wire's notes verbatim, oldest first, with their dates", () => {
      render(<JourneySection journey={journey({ currentBlockNotes: notes })} />);

      expect(screen.getByText("From your coach")).toBeInTheDocument();
      expect(screen.getByText("Dropping calories 200.")).toBeInTheDocument();
      expect(screen.getByText("Holding here this week.")).toBeInTheDocument();
      expect(screen.getByText("5 Aug")).toBeInTheDocument();
      expect(screen.getByText("12 Aug")).toBeInTheDocument();
    });

    it("says 'From your coach', never the coach-side 'Visible to X'", () => {
      // That copy tells a COACH who else reads the note. On the reader's own
      // screen it is meaningless.
      render(<JourneySection journey={journey({ currentBlockNotes: notes })} />);
      expect(screen.queryByText(/Visible to/)).not.toBeInTheDocument();
    });

    it("renders no notes section when the wire sends null or an empty list", () => {
      const { rerender } = render(
        <JourneySection journey={journey({ currentBlockNotes: null })} />
      );
      expect(screen.queryByText("From your coach")).not.toBeInTheDocument();

      rerender(
        <JourneySection
          journey={journey({ currentBlockNotes: { blockId: "block-1", notes: [] } })}
        />
      );
      expect(screen.queryByText("From your coach")).not.toBeInTheDocument();
    });

    it("does NOT filter — it renders whatever the wire allowed", () => {
      // The policy lives on the wire (see ClientJourneyCurrentBlockNotes). A
      // filter here would be that rule leaking back into a renderer, where the
      // RN client cannot inherit it. So a note dated outside the rendered
      // block's own range still renders: deciding was the server's job.
      render(
        <JourneySection
          journey={journey({
            currentBlockNotes: {
              blockId: "block-1",
              notes: [{ id: "n3", effectiveOn: "2026-07-01", body: "Earlier note." }],
            },
          })}
        />
      );
      expect(screen.getByText("Earlier note.")).toBeInTheDocument();
    });
  });
});
