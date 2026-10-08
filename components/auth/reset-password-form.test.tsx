import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const push = vi.fn();
let search = new URLSearchParams("");
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => search,
}));
vi.mock("@/lib/auth-client", () => ({ authClient: { resetPassword: vi.fn() } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { ResetPasswordForm } from "./reset-password-form";
import { authClient } from "@/lib/auth-client";
import { toast } from "sonner";

const EXPIRED = "This link has expired. Request a new one.";

async function setPassword(password: string, confirm = password) {
  await userEvent.type(screen.getByLabelText("New Password"), password);
  await userEvent.type(screen.getByLabelText("Confirm Password"), confirm);
  await userEvent.click(screen.getByRole("button", { name: /update password/i }));
}

describe("the reset link's landing (rule 4)", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ["used or expired (Better Auth's error)", "error=INVALID_TOKEN"],
    ["missing its token", ""],
  ])("a link %s says it has expired and offers a new one, with no form", (_label, query) => {
    search = new URLSearchParams(query);
    render(<ResetPasswordForm />);
    expect(screen.getByRole("alert")).toHaveTextContent(EXPIRED);
    expect(screen.getByRole("link", { name: "Request a new link" })).toHaveAttribute("href", "/forgot-password");
    expect(screen.queryByLabelText("New Password")).toBeNull();
  });

  it("sets the new password with the link's token, says so, and goes to /login", async () => {
    search = new URLSearchParams("token=tok123");
    vi.mocked(authClient.resetPassword).mockResolvedValue({ data: { status: true }, error: null } as never);
    render(<ResetPasswordForm />);
    await setPassword("a brand new password");
    await waitFor(() => expect(push).toHaveBeenCalledWith("/login"));
    expect(authClient.resetPassword).toHaveBeenCalledWith({ newPassword: "a brand new password", token: "tok123" });
    expect(toast.success).toHaveBeenCalledWith("Password updated");
  });

  it("refuses a password under 8 characters, or two that differ, before asking Better Auth", async () => {
    search = new URLSearchParams("token=tok123");
    render(<ResetPasswordForm />);
    await setPassword("short");
    expect(await screen.findByText("Password must be at least 8 characters")).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText("New Password"));
    await userEvent.clear(screen.getByLabelText("Confirm Password"));
    await setPassword("a brand new password", "a different password");
    expect(await screen.findByText("Passwords don't match")).toBeInTheDocument();
    expect(authClient.resetPassword).not.toHaveBeenCalled();
  });

  it("a token used meanwhile says the link has expired, with a way to a new one", async () => {
    search = new URLSearchParams("token=tok123");
    vi.mocked(authClient.resetPassword).mockResolvedValue({ data: null, error: { status: 400, code: "INVALID_TOKEN" } } as never);
    render(<ResetPasswordForm />);
    await setPassword("a brand new password");
    expect(await screen.findByRole("alert")).toHaveTextContent(EXPIRED);
    expect(screen.getByRole("link", { name: "Request a new link" })).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });
});

describe("the reset page hosts the form", () => {
  it("behind its own Suspense boundary, with the fields as its pending frame, so the page stays prerendered", () => {
    const page = readFileSync(join(__dirname, "..", "..", "app", "reset-password", "page.tsx"), "utf8");
    expect(page).toMatch(/<Suspense fallback=\{<NewPasswordFields token=\{null\} \/>\}>\s*<ResetPasswordForm \/>\s*<\/Suspense>/);
    expect(page).not.toMatch(/useSearchParams/);
  });
});
