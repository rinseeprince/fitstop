import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ClientNotesSection } from "./client-notes-section";
import type { CheckIn } from "@/types/check-in";

function makeCheckIn(overrides: Partial<CheckIn> = {}): CheckIn {
  return { id: "ci-1", clientId: "c-1", ...overrides } as CheckIn;
}

afterEach(cleanup);

describe("ClientNotesSection", () => {
  it("labels the three blocks the client filled in", () => {
    render(
      <ClientNotesSection
        checkIn={makeCheckIn({
          notes: "Felt strong all week.",
          prs: "Squat PR",
          challenges: "Work travel",
        })}
      />,
    );

    for (const label of ["Reflection", "Wins", "Challenges"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("renders nothing at all when the client wrote nothing", () => {
    const { container } = render(<ClientNotesSection checkIn={makeCheckIn()} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("omits a block the client left blank", () => {
    render(<ClientNotesSection checkIn={makeCheckIn({ prs: "Squat PR" })} />);

    expect(screen.getByText("Wins")).toBeInTheDocument();
    expect(screen.queryByText("Reflection")).not.toBeInTheDocument();
    expect(screen.queryByText("Challenges")).not.toBeInTheDocument();
  });

  it("keeps the line breaks the client typed", () => {
    // Free text out of a textarea: before C4 these three blocks collapsed
    // every break into one run, so a list of wins arrived as a paragraph.
    // The class is asserted alongside the text for the reason review-block's
    // own test spells out — jsdom does no layout, so textContent alone would
    // pass with the styling removed.
    render(
      <ClientNotesSection
        checkIn={makeCheckIn({ prs: "Squat 140kg\nBench 100kg\nFirst pull-up" })}
      />,
    );

    const wins = screen.getByText(/Squat 140kg/);
    expect(wins.textContent).toBe("Squat 140kg\nBench 100kg\nFirst pull-up");
    expect(wins).toHaveClass("whitespace-pre-wrap");
  });
});
