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

import { CheckInReplyBlock } from "./check-in-reply-block";

const fetchMock = vi.fn();

function renderBlock(props: Partial<React.ComponentProps<typeof CheckInReplyBlock>> = {}) {
  const onSent = props.onSent ?? vi.fn();
  const utils = render(
    <CheckInReplyBlock
      checkInId="ci-1"
      clientName="Jane"
      draft="Great week — let's talk about sleep."
      {...props}
      onSent={onSent}
    />,
  );
  return { onSent, ...utils };
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockResolvedValue({ ok: true });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("sending", () => {
  it("sends what is in the box and reports the review done", async () => {
    const { onSent } = renderBlock();

    await userEvent.click(screen.getByRole("button", { name: /^send$/i }));

    await waitFor(() => expect(onSent).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/check-in/ci-1/review",
      expect.objectContaining({ method: "POST" }),
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      coachResponse: "Great week — let's talk about sleep.",
    });
    expect(toastSuccess).toHaveBeenCalledWith("Message sent to Jane");
  });

  it("sends the coach's edit, not the draft it started from", async () => {
    renderBlock();
    const box = screen.getByRole("textbox");

    await userEvent.clear(box);
    await userEvent.type(box, "Rewritten by hand.");
    await userEvent.click(screen.getByRole("button", { name: /^send$/i }));

    await waitFor(() =>
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
        coachResponse: "Rewritten by hand.",
      }),
    );
  });

  it("refuses an empty message without calling the API", () => {
    const { onSent } = renderBlock({ draft: "   " });

    // Disabled is the first guard; the handler's own check is the second, and
    // both matter because the box can be emptied after mount.
    expect(screen.getByRole("button", { name: /^send$/i })).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onSent).not.toHaveBeenCalled();
  });

  it("reports a failed send rather than closing the review", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    const { onSent } = renderBlock();

    await userEvent.click(screen.getByRole("button", { name: /^send$/i }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Failed to send message"));
    expect(onSent).not.toHaveBeenCalled();
  });
});

describe("the draft", () => {
  it("follows a regenerated draft instead of showing the old one", () => {
    // `useState` seeds from the prop once, so a regenerate rewrote the draft
    // upstream while this block kept showing — and would have sent — the
    // previous message.
    const { rerender } = renderBlock();
    expect(screen.getByRole("textbox")).toHaveValue("Great week — let's talk about sleep.");

    rerender(
      <CheckInReplyBlock
        checkInId="ci-1"
        clientName="Jane"
        draft="Rewritten after regenerate."
      />,
    );

    expect(screen.getByRole("textbox")).toHaveValue("Rewritten after regenerate.");
  });
});

describe("a reply that has already been sent", () => {
  const sent = {
    sentMessage: "Solid week, keep the sleep up.",
    sentAt: "2026-08-31T10:00:00Z",
  };

  it("dates the reply on the rail and shows what was said", () => {
    renderBlock(sent);

    expect(screen.getByText(/Sent Aug 31/)).toBeInTheDocument();
    expect(screen.getByText("Solid week, keep the sleep up.")).toBeInTheDocument();
  });

  it("stays open for a follow-up", () => {
    // A coach can legitimately write again; the sent state reports, it does not
    // lock. The button names which kind of message this is.
    renderBlock(sent);

    const send = screen.getByRole("button", { name: /send follow-up/i });
    expect(send).toBeEnabled();
    expect(screen.getByRole("textbox")).toBeEnabled();
  });

  it("says only Send when nothing has been sent yet", () => {
    renderBlock();

    expect(screen.getByRole("button", { name: /^send$/i })).toBeInTheDocument();
    expect(screen.queryByText(/^Sent /)).not.toBeInTheDocument();
    expect(screen.queryByText("Already sent")).not.toBeInTheDocument();
  });
});

describe("copy", () => {
  it("copies what is in the box", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    renderBlock();

    await userEvent.click(screen.getByRole("button", { name: /copy/i }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("Great week — let's talk about sleep."));
    expect(toastSuccess).toHaveBeenCalledWith("Message copied");
  });
});

describe("the footer actions", () => {
  it("sit at the right edge, Copy before Send, so the primary is outermost", () => {
    // Divider grammar: identity left, actions right. The primary takes the far
    // edge, which puts Copy first in reading order.
    renderBlock();

    const names = screen.getAllByRole("button").map((button) => button.textContent?.trim());
    expect(names).toEqual(["Copy", "Send"]);
    expect(screen.getByRole("button", { name: /^send$/i }).parentElement).toHaveClass("justify-end");
  });
});
