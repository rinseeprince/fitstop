import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AddClientDialog } from "./add-client-dialog";

// Every committed frame of the card, as "open|description". The stub's
// DialogDescription records one per commit, so a click that lands in two
// commits leaves two frames (§7 → "No frame disagrees", rules 2 and 6).
const frames = vi.hoisted(() => [] as string[]);

// The closing card's shape (CONVENTIONS §7 → "No frame disagrees", rule 5).
// Radix keeps a closing card mounted through its exit animation and re-renders
// it from live state; jsdom never plays that animation, so the stub below
// stands in for it: the card stays rendered whatever `open` is, and carries
// `open` as data. A close must flip `open` and leave the path and the details;
// the next open clears them.
vi.mock("@/components/ui/dialog", async () => {
  const { createContext, useContext, useLayoutEffect } = await import("react");
  const DialogState = createContext({ open: false, onOpenChange: (_open: boolean) => {} });
  return {
    Dialog: ({
      open,
      onOpenChange,
      children,
    }: {
      open: boolean;
      onOpenChange: (open: boolean) => void;
      children: ReactNode;
    }) => (
      <DialogState.Provider value={{ open, onOpenChange }}>{children}</DialogState.Provider>
    ),
    DialogTrigger: ({ children }: { children: ReactNode }) => {
      const { open, onOpenChange } = useContext(DialogState);
      return <span onClick={() => onOpenChange(!open)}>{children}</span>;
    },
    DialogContent: ({ children }: { children: ReactNode }) => {
      const { open, onOpenChange } = useContext(DialogState);
      return (
        <div data-testid="card" data-open={String(open)}>
          {children}
          <button type="button" onClick={() => onOpenChange(false)}>
            Cancel
          </button>
        </div>
      );
    },
    DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
    DialogDescription: ({ children }: { children: ReactNode }) => {
      const { open } = useContext(DialogState);
      useLayoutEffect(() => {
        frames.push(`${open}|${children}`);
      });
      return <p data-testid="description">{children}</p>;
    },
  };
});

// Same env-free mocks as add-client-dialog.test.tsx: the manual form reaches
// useUnits() -> auth-context -> the browser Supabase client.
vi.mock("@/contexts/units-context", () => ({
  useUnits: () => ({ preference: "metric", isLoading: false, error: undefined }),
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

const PICKER = "Choose how you want to set up this client.";
const INTAKE = "Enter basic details. The client will complete an intake questionnaire.";

const card = () => screen.getByTestId("card");
const description = () => screen.getByTestId("description");
/** The distinct frames committed since the last `frames.length = 0`, in order. */
const committed = () => [...new Set(frames)];

async function openOnIntake() {
  const user = userEvent.setup();
  render(<AddClientDialog trigger={<button>Add client</button>} />);
  await user.click(screen.getByRole("button", { name: "Add client" }));
  await user.click(screen.getByText("Send intake questionnaire"));
  await user.type(screen.getByLabelText(/name/i), "Samuel James");
  return user;
}

describe("AddClientDialog's closing card", () => {
  beforeEach(() => {
    cleanup();
    frames.length = 0;
  });
  afterEach(() => vi.restoreAllMocks());

  it("closes on Cancel with the path and the details it showed", async () => {
    const user = await openOnIntake();
    frames.length = 0;

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(committed()).toEqual([`false|${INTAKE}`]);
    expect(card()).toHaveAttribute("data-open", "false");
    expect(description()).toHaveTextContent(INTAKE);
    expect(screen.getByLabelText(/name/i)).toHaveValue("Samuel James");
    expect(screen.queryByText("Send intake questionnaire")).not.toBeInTheDocument();
  });

  it("starts the next open over, on the picker and an empty form", async () => {
    const user = await openOnIntake();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    frames.length = 0;

    await user.click(screen.getByRole("button", { name: "Add client" }));

    // One commit: no frame opens on the path the last open left.
    expect(committed()).toEqual([`true|${PICKER}`]);
    expect(card()).toHaveAttribute("data-open", "true");
    expect(description()).toHaveTextContent(PICKER);
    await user.click(screen.getByText("Send intake questionnaire"));
    expect(screen.getByLabelText(/name/i)).toHaveValue("");
  });

  it("closes a create on what it showed, and the next open starts over", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ client: { id: "new-1" }, inviteSent: true }),
    } as Response);
    const user = await openOnIntake();
    await user.type(screen.getByLabelText(/email/i), "sam@example.com");
    frames.length = 0;

    await user.click(screen.getByRole("button", { name: /add & send questionnaire/i }));

    await waitFor(() => expect(card()).toHaveAttribute("data-open", "false"));
    expect(committed()).toEqual([`true|${INTAKE}`, `false|${INTAKE}`]);
    expect(description()).toHaveTextContent(INTAKE);
    expect(screen.getByLabelText(/name/i)).toHaveValue("Samuel James");
    expect(screen.getByLabelText(/email/i)).toHaveValue("sam@example.com");

    await user.click(screen.getByRole("button", { name: "Add client" }));
    expect(description()).toHaveTextContent(PICKER);
  });

  it("keeps the closing card on Adding… after a create; a failure and the next open clear it", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ client: { id: "new-1" }, inviteSent: true }),
    } as Response);
    const user = await openOnIntake();
    await user.type(screen.getByLabelText(/email/i), "sam@example.com");
    await user.click(screen.getByRole("button", { name: /add & send questionnaire/i }));

    await waitFor(() => expect(card()).toHaveAttribute("data-open", "false"));
    // react-hook-form has cleared its own isSubmitting by now; the card has not.
    expect(screen.getByRole("button", { name: /adding/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();

    // A failed create stays open and gives the buttons back.
    fetchMock.mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: "Email already in use" }),
    } as Response);
    await user.click(screen.getByRole("button", { name: "Add client" }));
    await user.click(screen.getByText("Send intake questionnaire"));
    expect(screen.getByRole("button", { name: /add & send questionnaire/i })).toBeEnabled();
    await user.type(screen.getByLabelText(/name/i), "Samuel James");
    await user.type(screen.getByLabelText(/email/i), "sam@example.com");
    await user.click(screen.getByRole("button", { name: /add & send questionnaire/i }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /add & send questionnaire/i })).toBeEnabled()
    );
    expect(card()).toHaveAttribute("data-open", "true");
  });
});
