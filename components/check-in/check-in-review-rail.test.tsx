import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { toastError, toastSuccess } = vi.hoisted(() => ({
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: { error: toastError, success: toastSuccess },
}));

import { CheckInReviewRail } from "./check-in-review-rail";
import type { CheckInReview } from "@/types/check-in";

function makeReview(overrides: Partial<CheckInReview> = {}): CheckInReview {
  return {
    summary: "Five of six sessions, sleep slipped midweek.",
    watchItems: [{ type: "risk", text: "Sleep down three nights running" }],
    themes: ["sleep"],
    coachActions: [{ priority: "high", text: "Ask about Thursday" }],
    clientMessage: "Great week — let's talk about sleep.",
    ...overrides,
  };
}

function renderRail(review: CheckInReview, onRefresh = vi.fn()) {
  render(
    <CheckInReviewRail
      checkInId="ci-1"
      clientName="Jane"
      review={review}
      onRefresh={onRefresh}
    />,
  );
  return { onRefresh };
}

const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockResolvedValue({ ok: true, status: 200 });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the AI review card", () => {
  it("renders the four blocks under one header", () => {
    renderRail(makeReview());

    expect(screen.getByText("AI review")).toBeInTheDocument();
    for (const label of ["Summary", "What to watch", "Coach actions", "Share with client"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("hides a block that has nothing in it", () => {
    renderRail(makeReview({ coachActions: [], watchItems: [], themes: [] }));

    expect(screen.getByText("Summary")).toBeInTheDocument();
    expect(screen.queryByText("Coach actions")).not.toBeInTheDocument();
    expect(screen.queryByText("What to watch")).not.toBeInTheDocument();
  });

  it("names a coach action's priority for anyone who cannot see the dot", () => {
    // The priority used to be an uppercase word; it is a coloured marker now,
    // so the word has to survive somewhere a screen reader reaches.
    renderRail(makeReview({ coachActions: [{ priority: "high", text: "Ask about Thursday" }] }));

    expect(screen.getByText("High priority")).toBeInTheDocument();
  });

  it("drops the Summary pencil — it never persisted anything", () => {
    renderRail(makeReview());

    expect(screen.queryByRole("button", { name: /edit summary/i })).not.toBeInTheDocument();
    // Share's own Edit is the only one left, and it opens a textarea only once
    // clicked — nothing in the card is editable on arrival.
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
    expect(screen.getByRole("button", { name: /edit message/i })).toBeInTheDocument();
  });
});

describe("an empty review", () => {
  // Unreachable through the normal path — the zod fallback in
  // lib/validations/check-in-review.ts always yields a summary — so the
  // fixture is built directly.
  const empty = makeReview({
    summary: "",
    watchItems: [],
    themes: [],
    coachActions: [],
    clientMessage: "",
  });

  it("shows ONE placeholder, not one per block", () => {
    renderRail(empty);

    expect(screen.getByText(/no ai review yet/i)).toBeInTheDocument();
    expect(screen.queryByText("Summary")).not.toBeInTheDocument();
  });

  it("still offers Share, so a coach can reply before the AI has run", () => {
    // A pending check-in had a usable Share card before C4 and must keep one:
    // the coach's reply is the coach's, not part of the AI's output.
    renderRail(empty);

    expect(screen.getByText("Share with client")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^send$/i })).toBeInTheDocument();
  });
});

describe("Regenerate", () => {
  it("refreshes the detail when the call succeeds", async () => {
    const { onRefresh } = renderRail(makeReview());

    await userEvent.click(screen.getByRole("button", { name: /regenerate review/i }));

    await waitFor(() => expect(onRefresh).toHaveBeenCalledOnce());
    expect(toastError).not.toHaveBeenCalled();
  });

  it("says so when the coach hits the AI rate limit", async () => {
    // A 429 from the coach-keyed aiRateLimit used to spin the icon and then
    // do nothing at all.
    fetchMock.mockResolvedValue({ ok: false, status: 429 });
    const { onRefresh } = renderRail(makeReview());

    await userEvent.click(screen.getByRole("button", { name: /regenerate review/i }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/too many/i)));
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("reports any other failure rather than swallowing it", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    const { onRefresh } = renderRail(makeReview());

    await userEvent.click(screen.getByRole("button", { name: /regenerate review/i }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/could not regenerate/i)),
    );
    expect(onRefresh).not.toHaveBeenCalled();
  });
});

describe("the share draft", () => {
  it("follows a regenerated draft instead of showing the old one", () => {
    // useState seeded from the prop once, so a regenerate rewrote the draft
    // upstream while this card kept showing — and would have sent — the
    // previous message.
    const { rerender } = render(
      <CheckInReviewRail checkInId="ci-1" clientName="Jane" review={makeReview()} />,
    );
    expect(screen.getByText("Great week — let's talk about sleep.")).toBeInTheDocument();

    rerender(
      <CheckInReviewRail
        checkInId="ci-1"
        clientName="Jane"
        review={makeReview({ clientMessage: "Rewritten after regenerate." })}
      />,
    );

    expect(screen.getByText("Rewritten after regenerate.")).toBeInTheDocument();
    expect(screen.queryByText("Great week — let's talk about sleep.")).not.toBeInTheDocument();
  });
});
