import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams(""),
}));
const login = vi.fn();
vi.mock("@/contexts/auth-context", () => ({ useAuth: () => ({ login }) }));
const social = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth-client", () => ({ authClient: { signIn: { social } } }));

import LoginPage from "./page";
import { AuthRefusal } from "@/lib/auth-error-messages";
import { PRODUCT_NAME } from "@/lib/constants";

async function signIn(password = "a password") {
  render(<LoginPage />);
  await userEvent.type(screen.getByLabelText("Email"), "coach@example.com");
  await userEvent.type(screen.getByLabelText("Password"), password);
  await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
}

describe("the login page (rules 1, 3, 15)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("asks for email and password, offers forgot password and Continue with Google, and no sign-up link", () => {
    render(<LoginPage />);
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Forgot your password?" })).toHaveAttribute("href", "/forgot-password");
    expect(screen.getByRole("button", { name: "Continue with Google" })).toBeEnabled();
    expect(screen.queryByRole("link", { name: /sign up/i })).toBeNull();
    expect(document.querySelector('a[href="/signup"]')).toBeNull();
  });

  it("is headed by the product's name", () => {
    render(<LoginPage />);
    expect(screen.getByRole("heading", { level: 1, name: PRODUCT_NAME })).toBeInTheDocument();
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

describe("Continue with Google (rule 8, D3)", () => {
  beforeEach(() => vi.clearAllMocks());

  const google = () => screen.getByRole("button", { name: "Continue with Google" });

  it("asks Better Auth for Google, landing on / or, refused, on /login, and the page stays busy while the browser leaves for Google", async () => {
    // Better Auth's client sends the browser to Google's page itself once this answers.
    social.mockResolvedValue({ data: { url: "https://accounts.google.com/o/oauth2/v2/auth", redirect: true }, error: null });
    render(<LoginPage />);
    await userEvent.click(google());
    expect(social).toHaveBeenCalledTimes(1);
    expect(social).toHaveBeenCalledWith({ provider: "google", callbackURL: "/", errorCallbackURL: "/login" });
    await waitFor(() => expect(google()).toBeDisabled());
    expect(screen.getByRole("button", { name: "Sign in" })).toBeDisabled();
    expect(screen.getByLabelText("Email")).toBeDisabled();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(login).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it("an earlier sign-in's sentence goes when Continue with Google is clicked: it was about that attempt", async () => {
    login.mockRejectedValue(new AuthRefusal({ status: 401, code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password" }));
    social.mockReturnValue(new Promise(() => {}));
    await signIn();
    expect(await screen.findByRole("alert")).toHaveTextContent("Wrong email or password.");
    await userEvent.click(google());
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("a refusal before Google's page, too many attempts, is said under the form, and the page is idle again", async () => {
    social.mockResolvedValue({ data: null, error: { status: 429, statusText: "Too Many Requests" } });
    render(<LoginPage />);
    await userEvent.click(google());
    expect(await screen.findByRole("alert")).toHaveTextContent("Too many attempts. Wait a moment and try again.");
    expect(google()).toBeEnabled();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
  });

  it("a request that fails says the generic sentence, nothing raw", async () => {
    const failed = new TypeError("Failed to fetch");
    social.mockRejectedValue(failed);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      render(<LoginPage />);
      await userEvent.click(google());
      expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong. Try again.");
      expect(screen.queryByText("Failed to fetch")).toBeNull();
      expect(error).toHaveBeenCalledWith("Continue with Google failed:", failed);
      expect(google()).toBeEnabled();
    } finally {
      error.mockRestore();
    }
  });

  it("back from Google's page, a page the browser restores as it was left is idle again; a fresh show changes nothing", async () => {
    social.mockReturnValue(new Promise(() => {}));
    render(<LoginPage />);
    await userEvent.click(google());
    await waitFor(() => expect(google()).toBeDisabled());
    const shown = (persisted: boolean) => Object.assign(new Event("pageshow"), { persisted });
    act(() => {
      window.dispatchEvent(shown(false));
    });
    expect(google()).toBeDisabled();
    act(() => {
      window.dispatchEvent(shown(true));
    });
    expect(google()).toBeEnabled();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
  });
});
