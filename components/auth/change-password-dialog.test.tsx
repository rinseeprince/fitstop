import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/lib/auth-client", () => ({ authClient: { changePassword: vi.fn() } }));
const { toastMock } = vi.hoisted(() => ({
  toastMock: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: toastMock }));

import { ChangePasswordDialog } from "./change-password-dialog";
import { authClient } from "@/lib/auth-client";

/**
 * Change password's dialog (rule 6, D19): its call, its states, and where
 * each answer goes. Better Auth's own answers are proven in lib/auth.test.ts.
 */
const CURRENT = "my current password";
const NEXT = "a brand new password";

function renderDialog() {
  const onOpenChange = vi.fn();
  render(<ChangePasswordDialog open onOpenChange={onOpenChange} />);
  return { onOpenChange };
}

const submit = () => screen.getByRole("button", { name: "Change password" });

async function fill({ current = CURRENT, password = NEXT, confirm = password }: { current?: string; password?: string; confirm?: string } = {}) {
  if (current) await userEvent.type(screen.getByLabelText("Current password"), current);
  if (password) await userEvent.type(screen.getByLabelText("New password"), password);
  if (confirm) await userEvent.type(screen.getByLabelText("Confirm new password"), confirm);
  await userEvent.click(submit());
}

const answers = (value: unknown) => vi.mocked(authClient.changePassword).mockResolvedValue(value as never);

describe("ChangePasswordDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("changes it with the current password and the new one, and asks Better Auth to sign every other device out", async () => {
    answers({ data: { token: "t", user: {} }, error: null });
    const { onOpenChange } = renderDialog();
    await fill();
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(authClient.changePassword).toHaveBeenCalledTimes(1);
    expect(authClient.changePassword).toHaveBeenCalledWith({ currentPassword: CURRENT, newPassword: NEXT, revokeOtherSessions: true });
    expect(toastMock.success).toHaveBeenCalledWith("Password changed");
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it("closes with Password changed in the same tick its answer lands, keeping its spinner as it goes", async () => {
    let land!: (value: unknown) => void;
    vi.mocked(authClient.changePassword).mockReturnValue(new Promise((resolve) => (land = resolve)) as never);
    const { onOpenChange } = renderDialog();
    await fill();
    expect(onOpenChange).not.toHaveBeenCalled();
    land({ data: { token: "t", user: {} }, error: null });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    const order = (fn: unknown) => vi.mocked(fn as () => void).mock.invocationCallOrder[0];
    expect(order(onOpenChange)).toBeLessThan(order(toastMock.success));
    expect(submit()).toBeDisabled();
    expect(submit().querySelector(".animate-spin")).not.toBeNull();
  });

  it("a wrong current password says so under its box, and the dialog stays open to try again", async () => {
    answers({ data: null, error: { status: 400, code: "INVALID_PASSWORD", message: "Invalid password" } });
    const { onOpenChange } = renderDialog();
    await fill();
    expect(await screen.findByText("Wrong password.")).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(toastMock.success).not.toHaveBeenCalled();
    expect(toastMock.error).not.toHaveBeenCalled();
    expect(submit()).toBeEnabled();
    expect(screen.getByLabelText("Current password")).toHaveValue(CURRENT);
  });

  it.each([
    ["too many attempts (429)", { status: 429 }, "Too many attempts. Wait a moment and try again."],
    ["any other refusal", { status: 500, code: "FAILED_TO_GET_SESSION" }, "Something went wrong. Try again."],
  ])("%s is said in a toast, and the dialog stays open", async (_label, error, sentence) => {
    answers({ data: null, error });
    const { onOpenChange } = renderDialog();
    await fill();
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("Couldn't change your password", { description: sentence }));
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.queryByText("Wrong password.")).toBeNull();
    expect(submit()).toBeEnabled();
  });

  it("a call that never reaches Better Auth is logged, said in a toast, and leaves the dialog open", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(authClient.changePassword).mockRejectedValue(new TypeError("Failed to fetch"));
    const { onOpenChange } = renderDialog();
    await fill();
    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith("Couldn't change your password", { description: "Something went wrong. Try again." })
    );
    expect(logged).toHaveBeenCalledWith("Change password failed:", expect.any(TypeError));
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("refuses before asking Better Auth: no current password, a new one under 8 characters, two that differ", async () => {
    renderDialog();
    await fill({ current: "" });
    expect(await screen.findByText("Current password is required")).toBeInTheDocument();
    cleanup();

    renderDialog();
    await fill({ password: "short" });
    expect(await screen.findByText("Password must be at least 8 characters")).toBeInTheDocument();
    cleanup();

    renderDialog();
    await fill({ confirm: "a different password" });
    expect(await screen.findByText("Passwords don't match")).toBeInTheDocument();
    expect(authClient.changePassword).not.toHaveBeenCalled();
  });

  it("while the change is in flight nothing can be pressed and the dialog won't close", async () => {
    vi.mocked(authClient.changePassword).mockReturnValue(new Promise(() => {}) as never);
    const { onOpenChange } = renderDialog();
    await fill();
    await waitFor(() => expect(submit()).toBeDisabled());
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByLabelText("New password")).toBeDisabled();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("Cancel closes it and asks Better Auth nothing", async () => {
    const { onOpenChange } = renderDialog();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(authClient.changePassword).not.toHaveBeenCalled();
  });

  it("Escape closes it while nothing is in flight (the control for the in-flight refusal)", () => {
    const { onOpenChange } = renderDialog();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
