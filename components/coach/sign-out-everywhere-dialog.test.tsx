import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/lib/auth-client", () => ({ authClient: { revokeSessions: vi.fn() } }));
// A full page load jsdom cannot make: recorded instead.
vi.mock("@/lib/load-fresh-page", () => ({ loadFreshPage: vi.fn() }));
const { toastMock } = vi.hoisted(() => ({
  toastMock: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: toastMock }));

import { SignOutEverywhereDialog } from "./sign-out-everywhere-dialog";
import { authClient } from "@/lib/auth-client";
import { loadFreshPage } from "@/lib/load-fresh-page";

/**
 * Sign out everywhere's confirm (rule 7, D14): its call, where it goes, and
 * its states. That Better Auth ends every session is proven in
 * lib/auth.test.ts and by scripts/account-proof.ts.
 */
function renderDialog() {
  const onOpenChange = vi.fn();
  render(<SignOutEverywhereDialog open onOpenChange={onOpenChange} />);
  return { onOpenChange };
}

const confirm = () => screen.getByRole("button", { name: "Sign out everywhere" });

describe("SignOutEverywhereDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("asks once, saying what happens", () => {
    renderDialog();
    expect(screen.getByRole("heading", { name: "Sign out everywhere?" })).toBeInTheDocument();
    expect(screen.getByText("Every device signed in to your account is signed out, this one too.")).toBeInTheDocument();
  });

  it("ends every session, without Better Auth re-reading this page's session, then loads the login page fresh", async () => {
    vi.mocked(authClient.revokeSessions).mockResolvedValue({ data: { status: true }, error: null } as never);
    const { onOpenChange } = renderDialog();
    await userEvent.click(confirm());
    await waitFor(() => expect(loadFreshPage).toHaveBeenCalledWith("/login?logged-out=1"));
    expect(authClient.revokeSessions).toHaveBeenCalledTimes(1);
    expect(authClient.revokeSessions).toHaveBeenCalledWith({ fetchOptions: { disableSignal: true } });
    const order = (fn: unknown) => vi.mocked(fn as () => void).mock.invocationCallOrder[0];
    expect(order(authClient.revokeSessions)).toBeLessThan(order(loadFreshPage));
    // The confirm stays until the page goes, spinning.
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(confirm()).toBeDisabled();
    expect(confirm().querySelector(".animate-spin")).not.toBeNull();
  });

  it.each([
    ["refused", () => vi.mocked(authClient.revokeSessions).mockResolvedValue({ data: null, error: { status: 429 } } as never), "Too many attempts. Wait a moment and try again."],
    ["unreachable", () => vi.mocked(authClient.revokeSessions).mockRejectedValue(new TypeError("Failed to fetch")), "Something went wrong. Try again."],
  ])("a call that is %s goes nowhere: the confirm stays open, its reason in a toast", async (_label, failIt, sentence) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    failIt();
    const { onOpenChange } = renderDialog();
    await userEvent.click(confirm());
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("Couldn't sign out everywhere", { description: sentence }));
    expect(loadFreshPage).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(confirm()).toBeEnabled();
  });

  it("while it is in flight nothing can be pressed and the confirm won't close", async () => {
    vi.mocked(authClient.revokeSessions).mockReturnValue(new Promise(() => {}) as never);
    const { onOpenChange } = renderDialog();
    await userEvent.click(confirm());
    await waitFor(() => expect(confirm()).toBeDisabled());
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("Escape and Cancel close it while nothing is in flight, and nobody is signed out", async () => {
    const { onOpenChange } = renderDialog();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onOpenChange.mock.calls).toEqual([[false], [false]]);
    expect(authClient.revokeSessions).not.toHaveBeenCalled();
    expect(loadFreshPage).not.toHaveBeenCalled();
  });
});
