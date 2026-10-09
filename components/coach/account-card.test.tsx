import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Who is signed in: Better Auth's session, as useAuth() hands it on.
const auth = vi.hoisted(() => ({ user: null as { id: string; name: string; email: string } | null }));
vi.mock("@/contexts/auth-context", () => ({ useAuth: () => auth }));

// Each dialog stands in as a record of what the card hands it; each is tested
// on its own beside its file.
const dialogs = vi.hoisted(() => ({ mounts: [] as { kind: string; props: Record<string, unknown> }[] }));
vi.mock("@/components/auth/change-password-dialog", async () => ({ ChangePasswordDialog: await standIn("change-password") }));
vi.mock("@/components/auth/change-email-dialog", async () => ({ ChangeEmailDialog: await standIn("change-email") }));
vi.mock("@/components/coach/sign-out-everywhere-dialog", async () => ({ SignOutEverywhereDialog: await standIn("sign-out-everywhere") }));
vi.mock("@/components/auth/delete-account-dialog", async () => ({ DeleteAccountDialog: await standIn("delete-account"), DANGER_OUTLINE_CLASS: "" }));

async function standIn(kind: string) {
  const { useState } = await import("react");
  return function StandIn(props: { open: boolean; currentEmail?: string; landing?: string; account?: string; onOpenChange: (open: boolean) => void }) {
    // Mounted once per opening: its first props are recorded, as a fresh dialog's form would start from them.
    useState(() => dialogs.mounts.push({ kind, props }));
    return (
      <div
        data-testid={kind}
        data-open={String(props.open)}
        data-email={props.currentEmail ?? ""}
        data-landing={props.landing ?? ""}
        data-account={props.account ?? ""}
      >
        <button type="button" onClick={() => props.onOpenChange(false)}>
          close {kind}
        </button>
      </div>
    );
  };
}

import { CoachAccountCard } from "./account-card";

const SAM = { id: "user-1", name: "Sam Coach", email: "sam@example.com" };

describe("CoachAccountCard (rules 5, 6, 7 and 10)", () => {
  beforeEach(() => {
    auth.user = SAM;
    dialogs.mounts = [];
  });
  afterEach(() => cleanup());

  it("shows the name and the address the coach signs in with, from the session, and the four actions", () => {
    render(<CoachAccountCard />);
    expect(screen.getByRole("heading", { name: "Account" })).toBeInTheDocument();
    expect(screen.getByText("Name").nextSibling).toHaveTextContent("Sam Coach");
    expect(screen.getByText("Email").nextSibling).toHaveTextContent("sam@example.com");
    for (const name of ["Change password", "Change email", "Sign out everywhere", "Delete account"]) {
      expect(screen.getByRole("button", { name })).toBeEnabled();
    }
  });

  it("delete account opens with the coach's account, which says the clients go with it (rule 10)", async () => {
    render(<CoachAccountCard />);
    await userEvent.click(screen.getByRole("button", { name: "Delete account" }));
    expect(screen.getByTestId("delete-account")).toHaveAttribute("data-account", "coach");
  });

  it("shows the address the session holds: a change lands here when the second link changes the login, never before", () => {
    const { rerender } = render(<CoachAccountCard />);
    expect(screen.getByText("Email").nextSibling).toHaveTextContent("sam@example.com");
    auth.user = { ...SAM, email: "sam.new@example.com" };
    rerender(<CoachAccountCard />);
    expect(screen.getByText("Email").nextSibling).toHaveTextContent("sam.new@example.com");
  });

  it("until the session is read, both values are pending and Change email waits; the card and the other actions are there", () => {
    auth.user = null;
    render(<CoachAccountCard />);
    expect(screen.getByRole("heading", { name: "Account" })).toBeInTheDocument();
    expect(screen.getByText("Name").nextSibling?.firstChild).toHaveAttribute("data-slot", "skeleton");
    expect(screen.getByText("Email").nextSibling?.firstChild).toHaveAttribute("data-slot", "skeleton");
    expect(screen.getByRole("button", { name: "Change email" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Change password" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Sign out everywhere" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Delete account" })).toBeEnabled();
  });

  it.each([
    ["Change password", "change-password"],
    ["Change email", "change-email"],
    ["Sign out everywhere", "sign-out-everywhere"],
    ["Delete account", "delete-account"],
  ])("%s opens its dialog, and only that one", async (button, kind) => {
    render(<CoachAccountCard />);
    await userEvent.click(screen.getByRole("button", { name: button }));
    expect(screen.getByTestId(kind)).toHaveAttribute("data-open", "true");
    expect(dialogs.mounts.map((mount) => mount.kind)).toEqual([kind]);
  });

  it("change email is handed the address the card showed when it opened, kept through the close, its links landing on the coach's Settings", async () => {
    render(<CoachAccountCard />);
    await userEvent.click(screen.getByRole("button", { name: "Change email" }));
    expect(screen.getByTestId("change-email")).toHaveAttribute("data-email", "sam@example.com");
    expect(screen.getByTestId("change-email")).toHaveAttribute("data-landing", "/settings");
    await userEvent.click(within(screen.getByTestId("change-email")).getByRole("button"));
    // Closing: open flips, the subject stays, so the closing card shows what it showed.
    expect(screen.getByTestId("change-email")).toHaveAttribute("data-open", "false");
    expect(screen.getByTestId("change-email")).toHaveAttribute("data-email", "sam@example.com");
  });

  it("an open change email keeps the address it opened with while the session's changes under it; the card shows the new one", async () => {
    const { rerender } = render(<CoachAccountCard />);
    await userEvent.click(screen.getByRole("button", { name: "Change email" }));
    auth.user = { ...SAM, email: "sam.new@example.com" };
    rerender(<CoachAccountCard />);
    expect(screen.getByTestId("change-email")).toHaveAttribute("data-email", "sam@example.com");
    expect(screen.getByText("Email").nextSibling).toHaveTextContent("sam.new@example.com");
  });

  it("each opening mounts its dialog afresh, so its form starts empty; a close remounts nothing", async () => {
    render(<CoachAccountCard />);
    const open = () => userEvent.click(screen.getByRole("button", { name: "Change password" }));
    await open();
    await userEvent.click(within(screen.getByTestId("change-password")).getByRole("button"));
    expect(dialogs.mounts).toHaveLength(1);
    await open();
    expect(dialogs.mounts).toHaveLength(2);
    expect(screen.getByTestId("change-password")).toHaveAttribute("data-open", "true");
  });

  it("opening one dialog after another replaces it", async () => {
    render(<CoachAccountCard />);
    await userEvent.click(screen.getByRole("button", { name: "Change password" }));
    await userEvent.click(screen.getByRole("button", { name: "Sign out everywhere" }));
    expect(screen.queryByTestId("change-password")).toBeNull();
    expect(screen.getByTestId("sign-out-everywhere")).toHaveAttribute("data-open", "true");
  });
});
