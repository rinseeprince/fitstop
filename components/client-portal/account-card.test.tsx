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

async function standIn(kind: string) {
  const { useState } = await import("react");
  return function StandIn(props: { open: boolean; currentEmail?: string; landing?: string; onOpenChange: (open: boolean) => void }) {
    // Mounted once per opening: its first props are recorded, as a fresh dialog's form would start from them.
    useState(() => dialogs.mounts.push({ kind, props }));
    return (
      <div data-testid={kind} data-open={String(props.open)} data-email={props.currentEmail ?? ""} data-landing={props.landing ?? ""}>
        <button type="button" onClick={() => props.onOpenChange(false)}>
          close {kind}
        </button>
      </div>
    );
  };
}

import { ClientAccountCard } from "./account-card";

const ALEX = { id: "user-2", name: "Alex Doe", email: "alex@example.com" };

describe("ClientAccountCard (rules 13 and 17)", () => {
  beforeEach(() => {
    auth.user = ALEX;
    dialogs.mounts = [];
  });
  afterEach(() => cleanup());

  it("holds Change password and Change email, and nothing to delete yet", () => {
    render(<ClientAccountCard />);
    expect(screen.getByRole("heading", { name: "Account" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change password" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Change email" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: /delete/i })).toBeNull();
  });

  it("until the session is read, Change email waits; the card and Change password are there", () => {
    auth.user = null;
    render(<ClientAccountCard />);
    expect(screen.getByRole("heading", { name: "Account" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change email" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Change password" })).toBeEnabled();
  });

  it.each([
    ["Change password", "change-password"],
    ["Change email", "change-email"],
  ])("%s opens its dialog, and only that one", async (button, kind) => {
    render(<ClientAccountCard />);
    await userEvent.click(screen.getByRole("button", { name: button }));
    expect(screen.getByTestId(kind)).toHaveAttribute("data-open", "true");
    expect(dialogs.mounts.map((mount) => mount.kind)).toEqual([kind]);
  });

  it("change email is handed the address the session holds, its links landing on the client's Settings, kept through the close", async () => {
    render(<ClientAccountCard />);
    await userEvent.click(screen.getByRole("button", { name: "Change email" }));
    const opened = screen.getByTestId("change-email");
    expect(opened).toHaveAttribute("data-email", "alex@example.com");
    expect(opened).toHaveAttribute("data-landing", "/client/settings");
    await userEvent.click(within(opened).getByRole("button"));
    // Closing: open flips, the subject stays, so the closing card shows what it showed.
    expect(screen.getByTestId("change-email")).toHaveAttribute("data-open", "false");
    expect(screen.getByTestId("change-email")).toHaveAttribute("data-email", "alex@example.com");
  });

  it("an open change email keeps the address it opened with while the session's changes under it", async () => {
    const { rerender } = render(<ClientAccountCard />);
    await userEvent.click(screen.getByRole("button", { name: "Change email" }));
    auth.user = { ...ALEX, email: "alex.new@example.com" };
    rerender(<ClientAccountCard />);
    expect(screen.getByTestId("change-email")).toHaveAttribute("data-email", "alex@example.com");
  });

  it("each opening mounts its dialog afresh, so its form starts empty; one after another replaces it", async () => {
    render(<ClientAccountCard />);
    await userEvent.click(screen.getByRole("button", { name: "Change email" }));
    await userEvent.click(within(screen.getByTestId("change-email")).getByRole("button"));
    await userEvent.click(screen.getByRole("button", { name: "Change email" }));
    expect(dialogs.mounts).toHaveLength(2);
    await userEvent.click(screen.getByRole("button", { name: "Change password" }));
    expect(screen.queryByTestId("change-email")).toBeNull();
    expect(screen.getByTestId("change-password")).toHaveAttribute("data-open", "true");
  });
});
