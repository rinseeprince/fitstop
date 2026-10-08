import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/lib/auth-client", () => ({ authClient: { changeEmail: vi.fn() } }));
const { toastMock } = vi.hoisted(() => ({
  toastMock: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: toastMock }));

import { ChangeEmailDialog } from "./change-email-dialog";
import { authClient } from "@/lib/auth-client";

/**
 * Change email's dialog (rule 6, D18): its call, its states, and what it
 * says. The two emails and the change itself are Better Auth's, proven in
 * lib/auth.test.ts and by scripts/account-proof.ts.
 */
const CURRENT = "coach@example.com";

function renderDialog() {
  const onOpenChange = vi.fn();
  render(<ChangeEmailDialog open currentEmail={CURRENT} onOpenChange={onOpenChange} />);
  return { onOpenChange };
}

const submit = () => screen.getByRole("button", { name: "Change email" });

async function ask(newEmail: string) {
  if (newEmail) await userEvent.type(screen.getByLabelText("New email"), newEmail);
  await userEvent.click(submit());
}

describe("ChangeEmailDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("asks Better Auth for the change, both links landing on Settings, and says where the approval went", async () => {
    vi.mocked(authClient.changeEmail).mockResolvedValue({ data: { status: true }, error: null } as never);
    const { onOpenChange } = renderDialog();
    await ask("  new@example.com ");
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(authClient.changeEmail).toHaveBeenCalledTimes(1);
    expect(authClient.changeEmail).toHaveBeenCalledWith({ newEmail: "new@example.com", callbackURL: "/settings" });
    expect(toastMock.success).toHaveBeenCalledWith("We've emailed coach@example.com to approve the change.");
    const order = (fn: unknown) => vi.mocked(fn as () => void).mock.invocationCallOrder[0];
    expect(order(onOpenChange)).toBeLessThan(order(toastMock.success));
  });

  it.each([
    ["the address the coach signs in with now, in any case", "Coach@Example.com", "This is already your email."],
    ["no address", "", "Email is required"],
    ["something that is not an address", "not-an-address", "Please enter a valid email address"],
  ])("refuses %s before asking Better Auth", async (_label, typed, sentence) => {
    const { onOpenChange } = renderDialog();
    await ask(typed);
    expect(await screen.findByText(sentence)).toBeInTheDocument();
    expect(authClient.changeEmail).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it.each([
    ["too many attempts (429)", { status: 429 }, "Too many attempts. Wait a moment and try again."],
    ["any other refusal", { status: 400, message: "Email is the same" }, "Something went wrong. Try again."],
  ])("%s is said in a toast, and the dialog stays open", async (_label, error, sentence) => {
    vi.mocked(authClient.changeEmail).mockResolvedValue({ data: null, error } as never);
    const { onOpenChange } = renderDialog();
    await ask("new@example.com");
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("Couldn't change your email", { description: sentence }));
    expect(toastMock.success).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(submit()).toBeEnabled();
  });

  it("a call that never reaches Better Auth is logged, said in a toast, and leaves the dialog open", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(authClient.changeEmail).mockRejectedValue(new TypeError("Failed to fetch"));
    const { onOpenChange } = renderDialog();
    await ask("new@example.com");
    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith("Couldn't change your email", { description: "Something went wrong. Try again." })
    );
    expect(logged).toHaveBeenCalledWith("Change email failed:", expect.any(TypeError));
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("while the request is in flight it spins, nothing can be pressed, and the dialog won't close", async () => {
    vi.mocked(authClient.changeEmail).mockReturnValue(new Promise(() => {}) as never);
    const { onOpenChange } = renderDialog();
    await ask("new@example.com");
    await waitFor(() => expect(submit()).toBeDisabled());
    expect(submit().querySelector(".animate-spin")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("Escape and Cancel close it while nothing is in flight, asking Better Auth nothing", async () => {
    const { onOpenChange } = renderDialog();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onOpenChange.mock.calls).toEqual([[false], [false]]);
    expect(authClient.changeEmail).not.toHaveBeenCalled();
  });
});
