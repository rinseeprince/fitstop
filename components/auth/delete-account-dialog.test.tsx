import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/lib/auth-client", () => ({ authClient: { deleteUser: vi.fn() } }));
const { toastMock } = vi.hoisted(() => ({
  toastMock: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: toastMock }));

import { DeleteAccountDialog } from "./delete-account-dialog";
import { authClient } from "@/lib/auth-client";
import { ACCOUNT_DELETED_PAGE, ACCOUNT_DELETION_TAKES, type DeletedAccount } from "@/lib/constants";

/**
 * Delete account's dialog (rules 10 and 13, D20): what it says for each
 * account, its call, its states, and where each answer goes. Better Auth's
 * own answers, and the link that deletes, are proven in lib/auth.test.ts.
 */
const PASSWORD = "my password";

function renderDialog(account: DeletedAccount = "coach") {
  const onOpenChange = vi.fn();
  render(<DeleteAccountDialog open account={account} onOpenChange={onOpenChange} />);
  return { onOpenChange };
}

const submit = () => screen.getByRole("button", { name: "Delete account" });

async function fill(password = PASSWORD) {
  if (password) await userEvent.type(screen.getByLabelText("Password"), password);
  await userEvent.click(submit());
}

const answers = (value: unknown) => vi.mocked(authClient.deleteUser).mockResolvedValue(value as never);

describe("DeleteAccountDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it.each([
    ["coach", "every client you coach, all of their records and photos, and their logins"],
    ["client", "Your coach keeps none of it."],
  ] as const)("says what goes with a %s's account, in the words the confirming email uses", (account, words) => {
    renderDialog(account);
    expect(screen.getByText(ACCOUNT_DELETION_TAKES[account])).toBeInTheDocument();
    expect(ACCOUNT_DELETION_TAKES[account]).toContain(words);
    expect(ACCOUNT_DELETION_TAKES[account]).toContain("It can't be undone.");
  });

  it("asks Better Auth with the password, the link landing on the login page's deleted notice, and says to check the email", async () => {
    answers({ data: { success: true, message: "Verification email sent" }, error: null });
    const { onOpenChange } = renderDialog();
    await fill();
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(authClient.deleteUser).toHaveBeenCalledTimes(1);
    expect(authClient.deleteUser).toHaveBeenCalledWith({ password: PASSWORD, callbackURL: ACCOUNT_DELETED_PAGE });
    expect(ACCOUNT_DELETED_PAGE).toBe("/login?deleted=1");
    expect(toastMock.success).toHaveBeenCalledWith("Check your email to confirm.");
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it("closes in the same tick its answer lands, keeping its spinner as it goes", async () => {
    let land!: (value: unknown) => void;
    vi.mocked(authClient.deleteUser).mockReturnValue(new Promise((resolve) => (land = resolve)) as never);
    const { onOpenChange } = renderDialog();
    await fill();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(submit()).toBeDisabled();
    expect(submit().querySelector(".animate-spin")).not.toBeNull();
    land({ data: { success: true }, error: null });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    const order = (fn: unknown) => vi.mocked(fn as () => void).mock.invocationCallOrder[0];
    expect(order(onOpenChange)).toBeLessThan(order(toastMock.success));
    expect(submit()).toBeDisabled();
  });

  it("an empty password is refused before Better Auth is asked", async () => {
    const { onOpenChange } = renderDialog();
    await fill("");
    expect(await screen.findByText("Password is required")).toBeInTheDocument();
    expect(authClient.deleteUser).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("a wrong password says so under its box, and the dialog stays open to try again", async () => {
    answers({ data: null, error: { status: 400, code: "INVALID_PASSWORD", message: "Invalid password" } });
    const { onOpenChange } = renderDialog();
    await fill();
    expect(await screen.findByText("Wrong password.")).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(toastMock.success).not.toHaveBeenCalled();
    expect(toastMock.error).not.toHaveBeenCalled();
    expect(submit()).toBeEnabled();
  });

  it.each([
    ["a refusal of another kind", { data: null, error: { status: 500, code: "FAILED", message: "boom" } }, "Something went wrong. Try again."],
    ["too many attempts", { data: null, error: { status: 429, message: "Too many requests" } }, "Too many attempts. Wait a moment and try again."],
    [
      "a login with no password yet (a coach who signs in with Google)",
      { data: null, error: { status: 400, code: "CREDENTIAL_ACCOUNT_NOT_FOUND", message: "Credential account not found" } },
      'Your account has no password yet. Log out, then use "Forgot your password?" on the sign-in page to set one.',
    ],
  ])("%s goes to a toast with its sentence, nothing raw, and the dialog stays open", async (_label, answer, sentence) => {
    answers(answer);
    const { onOpenChange } = renderDialog();
    await fill();
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("Couldn't delete your account", { description: sentence }));
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(submit()).toBeEnabled();
  });

  it("a request that never answers (the network) says the generic sentence, and the dialog stays open", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(authClient.deleteUser).mockRejectedValue(new TypeError("Failed to fetch"));
    const { onOpenChange } = renderDialog();
    await fill();
    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith("Couldn't delete your account", { description: "Something went wrong. Try again." })
    );
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("can't be closed while the request is in flight", async () => {
    vi.mocked(authClient.deleteUser).mockReturnValue(new Promise(() => undefined) as never);
    const { onOpenChange } = renderDialog();
    await fill();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    await userEvent.keyboard("{Escape}");
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
