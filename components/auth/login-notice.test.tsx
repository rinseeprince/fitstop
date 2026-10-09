import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";

let search = new URLSearchParams("");
const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useSearchParams: () => search,
  useRouter: () => ({ replace }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));

import { LoginNotice } from "./login-notice";
import { toast } from "sonner";
import { ACCOUNT_DELETED_PAGE, LOGIN_ERROR_GOOGLE_CANCELLED, LOGIN_ERROR_GOOGLE_NO_ACCOUNT, LOGIN_ERROR_GOOGLE_NOT_LINKED } from "@/lib/constants";

describe("LoginNotice", () => {
  it("shows the message the proxy sent the visitor here with", () => {
    search = new URLSearchParams("error=profile_unavailable");
    render(<LoginNotice />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "We couldn't load your account. Please try again in a few minutes."
    );
  });

  it("shows nothing without the error", () => {
    search = new URLSearchParams("");
    const { container } = render(<LoginNotice />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows nothing for an empty error", () => {
    search = new URLSearchParams("error=");
    const { container } = render(<LoginNotice />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("LoginNotice after a refused Continue with Google (rule 8)", () => {
  it.each([
    ["a Google address no login has", LOGIN_ERROR_GOOGLE_NO_ACCOUNT, "signup_disabled"],
    ["a Google address Better Auth won't link to its login", LOGIN_ERROR_GOOGLE_NOT_LINKED, "account_not_linked"],
  ])("%s says there's no account for that Google email, as an error", (_label, error, code) => {
    // Better Auth's own codes, which its callback sends the browser back to /login with.
    expect(error).toBe(code);
    search = new URLSearchParams({ error });
    render(<LoginNotice />);
    const notice = screen.getByRole("alert");
    expect(notice).toHaveTextContent("There's no account for that Google email.");
    expect(notice.className).toContain("text-destructive");
  });

  it.each([
    ["Google's code for a code that couldn't be traded (a wrong client secret)", "invalid_code"],
    ["a state that expired or was used (Back to Google's page after signing in)", "state_mismatch"],
    ["a database fault behind the lookup", "internal_server_error"],
  ])("any other error is a Google sign-in that failed, %s: it says so, as an error", (_label, error) => {
    search = new URLSearchParams({ error });
    render(<LoginNotice />);
    const notice = screen.getByRole("alert");
    expect(notice).toHaveTextContent("Couldn't sign in with Google. Try again.");
    expect(notice.className).toContain("text-destructive");
  });

  it.each(["constructor", "toString", "__proto__"])("an error named like an object's own key, %s, is one more failed sign-in, never a value off the prototype", (error) => {
    search = new URLSearchParams({ error });
    render(<LoginNotice />);
    expect(screen.getByRole("alert")).toHaveTextContent(/^Couldn't sign in with Google\. Try again\.$/);
  });

  it("a person who said no on Google's page is told nothing", () => {
    // Google's own code, which Better Auth passes through to the page.
    expect(LOGIN_ERROR_GOOGLE_CANCELLED).toBe("access_denied");
    search = new URLSearchParams({ error: LOGIN_ERROR_GOOGLE_CANCELLED });
    const { container } = render(<LoginNotice />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("LoginNotice after delete account's link (rules 10 and 13)", () => {
  it("says the account has been deleted, as information, not as an error", () => {
    search = new URLSearchParams("deleted=1");
    render(<LoginNotice />);
    const notice = screen.getByRole("alert");
    expect(notice).toHaveTextContent("Your account has been deleted.");
    expect(notice.className).not.toContain("text-destructive");
  });

  it("is the page the delete dialog asks Better Auth's link to land on", () => {
    search = new URLSearchParams(new URL(ACCOUNT_DELETED_PAGE, "http://localhost").search);
    render(<LoginNotice />);
    expect(screen.getByRole("alert")).toHaveTextContent("Your account has been deleted.");
  });

  it("leaves the address alone and says nothing of a log out", () => {
    vi.mocked(toast.success).mockClear();
    replace.mockClear();
    search = new URLSearchParams("deleted=1");
    render(<LoginNotice />);
    expect(toast.success).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });
});

describe("LoginNotice after Log out", () => {
  it("says Logged out successfully once Log out has loaded the page, then drops the marker so a refresh doesn't say it again", () => {
    vi.mocked(toast.success).mockClear();
    replace.mockClear();
    search = new URLSearchParams("logged-out=1");
    const { container } = render(<LoginNotice />);
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith("Logged out successfully", { id: "logged-out", description: "See you next time!" });
    expect(replace).toHaveBeenCalledWith("/login");
    expect(container).toBeEmptyDOMElement();
  });

  it.each([
    ["no marker", ""],
    ["only the proxy's error", "error=profile_unavailable"],
  ])("says nothing of a log out with %s, and leaves the address alone", (_label, query) => {
    vi.mocked(toast.success).mockClear();
    replace.mockClear();
    search = new URLSearchParams(query);
    render(<LoginNotice />);
    expect(toast.success).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });
});

describe("the login page hosts the notice", () => {
  it("behind its own Suspense boundary, so the page stays statically prerendered", () => {
    const page = readFileSync(join(__dirname, "..", "..", "app", "login", "page.tsx"), "utf8");
    expect(page).toMatch(/<Suspense[^>]*>\s*<LoginNotice \/>\s*<\/Suspense>/);
    expect(page).not.toMatch(/useSearchParams/);
  });
});
