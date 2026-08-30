import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ClientNotesSection } from "./client-notes-section";
import type { CheckInWithDetails } from "@/types/check-in";

function makeCheckIn(
  overrides: Partial<CheckInWithDetails> = {},
): CheckInWithDetails {
  return { id: "ci-1", clientId: "c-1", ...overrides } as CheckInWithDetails;
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

  it("renders the coach's questions as one block, prompt over answer", () => {
    render(
      <ClientNotesSection
        checkIn={makeCheckIn({
          customAnswers: [
            { questionId: "q-1", prompt: "How did the split feel?", answer: "Heavy." },
            { questionId: "q-2", prompt: "Sleep any better?", answer: "A bit." },
          ],
        })}
      />,
    );

    // ONE category label for the pair — a 300-character prompt in the label
    // slot would set a sentence in 10px uppercase. The prompt and its answer
    // are separated by colour instead.
    expect(screen.getByText("Coach questions")).toBeInTheDocument();
    expect(screen.getAllByText("Coach questions")).toHaveLength(1);

    const prompt = screen.getByText("How did the split feel?");
    expect(prompt).toHaveClass("text-[#93b0b4]");
    expect(screen.getByText("Heavy.")).toHaveClass("text-[#0c1a1e]");
    expect(screen.getByText("Sleep any better?")).toBeInTheDocument();
  });

  it("renders the card for a client who ONLY answered custom questions", () => {
    render(
      <ClientNotesSection
        checkIn={makeCheckIn({
          customAnswers: [{ questionId: "q-1", prompt: "Anything hurting?", answer: "No" }],
        })}
      />,
    );

    expect(screen.getByText("Coach questions")).toBeInTheDocument();
    expect(screen.queryByText("Reflection")).not.toBeInTheDocument();
  });
});
