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
import { ACCOUNT_DELETED_PAGE } from "@/lib/constants";

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

  it("shows nothing for an error it does not know", () => {
    search = new URLSearchParams("error=something_else");
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
