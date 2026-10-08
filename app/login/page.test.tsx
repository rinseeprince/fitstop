import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams(""),
}));
const login = vi.fn();
vi.mock("@/contexts/auth-context", () => ({ useAuth: () => ({ login }) }));

import LoginPage from "./page";
import { AuthRefusal } from "@/lib/auth-error-messages";

async function signIn(password = "a password") {
  render(<LoginPage />);
  await userEvent.type(screen.getByLabelText("Email"), "coach@example.com");
  await userEvent.type(screen.getByLabelText("Password"), password);
  await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
}

describe("the login page (rules 1, 3, 15)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("asks for email and password, offers forgot password, and no Google button or sign-up link", () => {
    render(<LoginPage />);
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Forgot your password?" })).toHaveAttribute("href", "/forgot-password");
    expect(screen.queryByText(/google/i)).toBeNull();
    expect(screen.queryByRole("link", { name: /sign up/i })).toBeNull();
    expect(document.querySelector('a[href="/signup"]')).toBeNull();
  });

  it("a wrong pair shows 'Wrong email or password.' under the form, and goes nowhere", async () => {
    login.mockRejectedValue(new AuthRefusal({ status: 401, code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password" }));
    await signIn();
    expect(await screen.findByRole("alert")).toHaveTextContent("Wrong email or password.");
    expect(screen.queryByText("Invalid email or password")).toBeNull();
    expect(push).not.toHaveBeenCalled();
  });

  it("too many attempts says to wait", async () => {
    login.mockRejectedValue(new AuthRefusal({ status: 429 }));
    await signIn();
    expect(await screen.findByRole("alert")).toHaveTextContent("Too many attempts. Wait a moment and try again.");
  });

  it.each([
    ["trainer", "/dashboard"],
    ["client", "/client"],
    [null, "/dashboard"],
  ] as const)("a %s goes to %s", async (role, home) => {
    login.mockResolvedValue(role);
    await signIn();
    await waitFor(() => expect(push).toHaveBeenCalledWith(home));
    expect(login).toHaveBeenCalledWith("coach@example.com", "a password");
  });
});
