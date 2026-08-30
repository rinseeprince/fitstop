import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  ReviewBlock,
  ReviewList,
  ReviewListRow,
  ReviewProse,
} from "./review-block";

describe("ReviewBlock", () => {
  it("renders its label and children", () => {
    render(
      <ReviewBlock label="Coach actions">
        <p>Ask about Thursday</p>
      </ReviewBlock>,
    );

    expect(screen.getByText("Coach actions")).toBeInTheDocument();
    expect(screen.getByText("Ask about Thursday")).toBeInTheDocument();
  });

  it("renders an actions slot beside the label, and omits it when there is none", () => {
    const { rerender } = render(
      <ReviewBlock label="Share with client" actions={<button>Edit</button>}>
        <p>body</p>
      </ReviewBlock>,
    );
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();

    rerender(
      <ReviewBlock label="Share with client">
        <p>body</p>
      </ReviewBlock>,
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("ReviewProse", () => {
  it("keeps the line breaks the client typed", () => {
    // The whole reason this primitive exists rather than a bare <p>: every
    // string it renders is free text someone typed into a textarea, and the
    // old markup collapsed the breaks into one run.
    //
    // TWO assertions because neither is enough alone. textContent proves the
    // break reaches the DOM (a caller sanitising newlines away would fail it)
    // but passes with ANY css, since jsdom does no layout — a mutation test
    // deleting `whitespace-pre-wrap` did not fail this file until the class
    // itself was asserted. The class is the mechanism, so the class is pinned;
    // that it LOOKS right is the owner's smoke, not this file's claim.
    const { container } = render(
      <ReviewProse>{"Hit a PR on squats\nAlso slept better"}</ReviewProse>,
    );

    expect(container.textContent).toBe("Hit a PR on squats\nAlso slept better");
    expect(container.firstElementChild).toHaveClass("whitespace-pre-wrap");
  });
});

describe("ReviewList", () => {
  it("gives every row a marker slot and its text", () => {
    render(
      <ReviewList>
        <ReviewListRow marker={<span data-testid="marker-a">•</span>}>
          Squat volume up
        </ReviewListRow>
        <ReviewListRow marker={<span data-testid="marker-b">•</span>}>
          Sleep down
        </ReviewListRow>
      </ReviewList>,
    );

    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByTestId("marker-a")).toBeInTheDocument();
    expect(screen.getByTestId("marker-b")).toBeInTheDocument();
    expect(screen.getByText("Squat volume up")).toBeInTheDocument();
  });
});
