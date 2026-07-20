import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ClientDraftLeaveGuard } from "./client-draft-leave-guard";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

// The guard reads live dirty/mode from the provider; drive it directly.
let draftState: { isDirty: boolean; mode: "edit" | "view" } = {
  isDirty: true,
  mode: "edit",
};
vi.mock(
  "@/components/clients/training/program-builder/program-draft-provider",
  () => ({
    useProgramDraft: () => draftState,
  }),
);

describe("ClientDraftLeaveGuard", () => {
  beforeEach(() => {
    cleanup();
    pushMock.mockClear();
    draftState = { isDirty: true, mode: "edit" };
  });

  it("intercepts an outside nav link while dirty-editing and confirms before leaving", () => {
    render(
      <>
        {/* A rail-style app link, outside the editor dialog. */}
        <a href="/dashboard" onClick={(e) => e.preventDefault()}>
          Dashboard
        </a>
        <ClientDraftLeaveGuard />
      </>,
    );

    fireEvent.click(screen.getByText("Dashboard"));
    // Navigation is held pending confirmation.
    expect(pushMock).not.toHaveBeenCalled();
    expect(screen.getByText("Discard unsaved changes?")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Leave without applying" }),
    );
    expect(pushMock).toHaveBeenCalledTimes(1);
    expect(pushMock).toHaveBeenCalledWith("/dashboard");
  });

  it("lets nav through untouched when there are no unsaved edits", () => {
    draftState = { isDirty: false, mode: "edit" };
    render(
      <>
        <a href="/dashboard" onClick={(e) => e.preventDefault()}>
          Dashboard
        </a>
        <ClientDraftLeaveGuard />
      </>,
    );

    fireEvent.click(screen.getByText("Dashboard"));
    // No guard armed → no confirmation surfaced.
    expect(screen.queryByText("Discard unsaved changes?")).toBeNull();
  });

  it("ignores clicks that don't target a nav link", () => {
    render(
      <>
        <button type="button">Just a button</button>
        <ClientDraftLeaveGuard />
      </>,
    );

    fireEvent.click(screen.getByText("Just a button"));
    expect(screen.queryByText("Discard unsaved changes?")).toBeNull();
    expect(pushMock).not.toHaveBeenCalled();
  });
});
