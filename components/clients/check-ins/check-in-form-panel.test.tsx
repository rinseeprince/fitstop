import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useState } from "react";
import { SWRConfig } from "swr";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CheckInFormSheet } from "./check-in-form-sheet";
import type { Client } from "@/types/check-in";

/**
 * The panel's own tests run against the REAL editor hook and the REAL SWR — only
 * `fetch` is faked. That is deliberate: the defect these exist for lived in the
 * seam between the two, and a mocked hook cannot see it.
 */

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

const client = { id: "client-1", name: "Sam Kalepa" } as Client;

let failFormRead = false;

beforeEach(() => {
  failFormRead = false;
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url: string) => {
      if (url.includes("check-in-form") && failFormRead) {
        return Promise.resolve({
          ok: false,
          status: 500,
          headers: new Headers(),
          json: () => Promise.resolve({ success: false, error: "boom" }),
        });
      }
      const data = url.includes("check-in-form")
        ? { fields: ["notes", "weight"], questions: [] }
        : url.includes("questions")
          ? { questions: [] }
          : { templates: [] };
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => Promise.resolve({ success: true, data }),
      });
    })
  );
});

afterEach(() => vi.unstubAllGlobals());

/** The sheet with its own open state, the way the Check-ins tab holds it. */
function Host() {
  const [open, setOpen] = useState(false);
  return (
    // A shared cache across opens, like the browser's — that is the condition
    // the reopen regression needs.
    <SWRConfig value={{ dedupingInterval: 0 }}>
      <button type="button" onClick={() => setOpen(true)}>
        Customise check-in
      </button>
      <CheckInFormSheet client={client} open={open} onOpenChange={setOpen} />
    </SWRConfig>
  );
}

const openSheet = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole("button", { name: "Customise check-in" }));

/**
 * "The editor is on screen." Asserted through the field LABEL and the absence
 * of a spinner rather than through the switch role, so this holds against the
 * pre-fix build too — that is what let the reopen case below be verified as a
 * genuinely failing test rather than assumed to be one.
 */
const editorIsUp = async () => {
  await waitFor(() => expect(screen.getByText("Weight")).toBeInTheDocument());
  expect(document.querySelector(".animate-spin")).toBeNull();
};

describe("CheckInFormPanel", () => {
  it("holds a spinner until the form resolves, then renders the editor", async () => {
    const user = userEvent.setup();
    render(<Host />);
    await openSheet(user);
    await editorIsUp();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeInTheDocument();
  });

  it("shows the error state — and NO editor — when the form read fails", async () => {
    failFormRead = true;
    const user = userEvent.setup();
    render(<Host />);
    await openSheet(user);

    await waitFor(() =>
      expect(screen.getByText(/Failed to load the check-in form/)).toBeInTheDocument()
    );
    // No editor means no Save, which is the point: a coach can never commit an
    // empty form over a real one because the form they'd be saving never renders.
    expect(screen.queryByRole("switch", { name: "Weight" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
  });

  it("REOPENS after a close, against the same cached form", async () => {
    // The C6b regression. Seeding used to run in an effect that flipped a
    // `useRef`, while the spinner was computed from that ref during render —
    // so the flip scheduled no render. It only ever cleared as a side effect of
    // the setState calls beside it changing something; on a second open the
    // cached form came back as the SAME object, all four setters bailed out on
    // `Object.is`, nothing re-rendered, and the sheet spun forever over a
    // correctly-loaded form. Fails on the pre-fix code.
    const user = userEvent.setup();
    render(<Host />);

    await openSheet(user);
    await editorIsUp();

    await user.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByText("Weight")).not.toBeInTheDocument());

    await openSheet(user);
    await editorIsUp();
  });

  it("discards edits on close — the next open starts from the saved form", async () => {
    const user = userEvent.setup();
    render(<Host />);

    await openSheet(user);
    await editorIsUp();
    await user.click(screen.getByRole("switch", { name: "Weight" }));
    expect(screen.getByRole("switch", { name: "Weight" })).not.toBeChecked();

    await user.click(screen.getByRole("button", { name: "Close" }));
    await openSheet(user);
    await editorIsUp();

    expect(screen.getByRole("switch", { name: "Weight" })).toBeChecked();
  });
});
