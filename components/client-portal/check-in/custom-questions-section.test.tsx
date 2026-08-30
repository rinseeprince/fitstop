import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CustomQuestionsSection } from "./custom-questions-section";

const QUESTIONS = [
  { id: "q-1", prompt: "How did the new split feel?" },
  { id: "q-2", prompt: "Sleep any better?" },
];

describe("CustomQuestionsSection", () => {
  it("renders nothing when the coach has asked nothing", () => {
    const { container } = render(
      <CustomQuestionsSection questions={[]} answers={[]} onChange={vi.fn()} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders one box per question, in the order given", () => {
    render(
      <CustomQuestionsSection questions={QUESTIONS} answers={[]} onChange={vi.fn()} />
    );
    const boxes = screen.getAllByRole("textbox");
    expect(boxes).toHaveLength(2);
    expect(screen.getByLabelText("How did the new split feel?")).toBe(boxes[0]);
    expect(screen.getByLabelText("Sleep any better?")).toBe(boxes[1]);
  });

  it("keys an answer by questionId, never by position", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <CustomQuestionsSection questions={QUESTIONS} answers={[]} onChange={onChange} />
    );

    await user.type(screen.getByLabelText("Sleep any better?"), "y");

    expect(onChange).toHaveBeenCalledWith([{ questionId: "q-2", answer: "y" }]);
  });

  it("seeds each box from the answer with its own id", () => {
    render(
      <CustomQuestionsSection
        questions={QUESTIONS}
        // Deliberately out of question order: a positional read would put this
        // text under the wrong prompt.
        answers={[{ questionId: "q-2", answer: "Much better" }]}
        onChange={vi.fn()}
      />
    );
    expect(screen.getByLabelText("Sleep any better?")).toHaveValue("Much better");
    expect(screen.getByLabelText("How did the new split feel?")).toHaveValue("");
  });

  it("drops an emptied answer instead of sending a blank", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <CustomQuestionsSection
        questions={QUESTIONS}
        answers={[{ questionId: "q-1", answer: "x" }]}
        onChange={onChange}
      />
    );

    await user.clear(screen.getByLabelText("How did the new split feel?"));
    expect(onChange).toHaveBeenCalledWith([]);
  });
});
