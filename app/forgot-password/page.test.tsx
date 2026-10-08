import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/lib/auth-client", () => ({ authClient: { requestPasswordReset: vi.fn() } }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import ForgotPasswordPage from "./page";
import { authClient } from "@/lib/auth-client";
import { toast } from "sonner";

async function ask(email: string) {
  render(<ForgotPasswordPage />);
  await userEvent.type(screen.getByLabelText("Email"), email);
  await userEvent.click(screen.getByRole("button", { name: /send reset link/i }));
}

describe("forgot password (rule 4)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("asks Better Auth for a link that lands on /reset-password, and says the same sentence whatever was typed", async () => {
    vi.mocked(authClient.requestPasswordReset).mockResolvedValue({ data: { status: true }, error: null } as never);
    await ask("anyone@example.com");
    expect(await screen.findByText("If that address has an account, we've emailed a link.")).toBeInTheDocument();
    expect(authClient.requestPasswordReset).toHaveBeenCalledWith({ email: "anyone@example.com", redirectTo: "/reset-password" });
    expect(screen.queryByText(/anyone@example\.com/)).toBeNull();
  });

  it("too many requests says to wait, and claims nothing was sent (rule 15)", async () => {
    vi.mocked(authClient.requestPasswordReset).mockResolvedValue({ data: null, error: { status: 429 } } as never);
    await ask("anyone@example.com");
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Couldn't send the link", {
        description: "Too many attempts. Wait a moment and try again.",
      })
    );
    expect(screen.queryByText(/we've emailed a link/)).toBeNull();
  });
});
