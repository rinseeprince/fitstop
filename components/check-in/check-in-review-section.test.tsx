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

import { CheckInReviewSection } from "./check-in-review-section";
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

function renderSection(review: CheckInReview, onRefresh = vi.fn()) {
  render(
    <CheckInReviewSection
      checkInId="ci-1"
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

describe("the AI review section", () => {
  it("renders its three blocks under one rail", () => {
    renderSection(makeReview());

    expect(screen.getByText("AI review")).toBeInTheDocument();
    for (const label of ["Summary", "What to watch", "Coach actions"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("hides a block that has nothing in it", () => {
    renderSection(makeReview({ coachActions: [], watchItems: [], themes: [] }));

    expect(screen.getByText("Summary")).toBeInTheDocument();
    expect(screen.queryByText("Coach actions")).not.toBeInTheDocument();
    expect(screen.queryByText("What to watch")).not.toBeInTheDocument();
  });

  it("names a coach action's priority for anyone who cannot see the dot", () => {
    // The priority used to be an uppercase word; it is a coloured marker now,
    // so the word has to survive somewhere a screen reader reaches.
    renderSection(makeReview({ coachActions: [{ priority: "high", text: "Ask about Thursday" }] }));

    expect(screen.getByText("High priority")).toBeInTheDocument();
  });

  it("has no editable field — the AI review is a readout", () => {
    renderSection(makeReview());

    expect(screen.queryByRole("button", { name: /edit summary/i })).not.toBeInTheDocument();
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
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
    renderSection(empty);

    expect(screen.getByText(/no ai review yet/i)).toBeInTheDocument();
    expect(screen.queryByText("Summary")).not.toBeInTheDocument();
  });

  it("renders no reply controls — the reply is its own section", () => {
    renderSection(empty);

    expect(screen.queryByRole("button", { name: /^send$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
});

describe("Regenerate", () => {
  it("refreshes the detail when the call succeeds", async () => {
    const { onRefresh } = renderSection(makeReview());

    await userEvent.click(screen.getByRole("button", { name: /regenerate review/i }));

    await waitFor(() => expect(onRefresh).toHaveBeenCalledOnce());
    expect(toastError).not.toHaveBeenCalled();
  });

  it("says so when the coach hits the AI rate limit", async () => {
    // A 429 from the coach-keyed aiRateLimit used to spin the icon and then
    // do nothing at all.
    fetchMock.mockResolvedValue({ ok: false, status: 429 });
    const { onRefresh } = renderSection(makeReview());

    await userEvent.click(screen.getByRole("button", { name: /regenerate review/i }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/too many/i)));
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("reports any other failure rather than swallowing it", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    const { onRefresh } = renderSection(makeReview());

    await userEvent.click(screen.getByRole("button", { name: /regenerate review/i }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/could not regenerate/i)),
    );
    expect(onRefresh).not.toHaveBeenCalled();
  });
});
