import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";

let search = new URLSearchParams("");
vi.mock("next/navigation", () => ({
  useSearchParams: () => search,
}));

import { LoginNotice } from "./login-notice";

describe("LoginNotice", () => {
  it("shows the message the middleware sent the visitor here with", () => {
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

describe("the login page hosts the notice", () => {
  it("behind its own Suspense boundary, so the page stays statically prerendered", () => {
    const page = readFileSync(join(__dirname, "..", "..", "app", "login", "page.tsx"), "utf8");
    expect(page).toMatch(/<Suspense[^>]*>\s*<LoginNotice \/>\s*<\/Suspense>/);
    expect(page).not.toMatch(/useSearchParams/);
  });
});
