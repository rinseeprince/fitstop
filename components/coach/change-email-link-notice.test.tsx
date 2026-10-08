import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";

const replace = vi.fn();
let search = new URLSearchParams("");
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => search,
}));
const { toastMock } = vi.hoisted(() => ({
  toastMock: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: toastMock }));

import { ChangeEmailLinkNotice } from "./change-email-link-notice";

/**
 * What the coach's Settings says when one of change email's links failed
 * (rule 6): Better Auth sends the browser there with `?error=<its code>`,
 * the codes pinned to its verify-email endpoint at 1.7.7.
 */
describe("ChangeEmailLinkNotice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => cleanup());

  it.each([
    ["an expired link", "TOKEN_EXPIRED"],
    ["a link Better Auth didn't sign", "INVALID_TOKEN"],
    ["a link used already, its address changed since", "USER_NOT_FOUND"],
    ["a link opened where another login is signed in", "INVALID_USER"],
  ])("%s says the used-or-expired link sentence, once, and drops the marker", (_label, code) => {
    search = new URLSearchParams(`error=${code}`);
    const { container } = render(<ChangeEmailLinkNotice />);
    expect(toastMock.error).toHaveBeenCalledTimes(1);
    expect(toastMock.error).toHaveBeenCalledWith("This link has expired. Request a new one.", { id: "change-email-link" });
    expect(replace).toHaveBeenCalledWith("/settings");
    expect(container).toBeEmptyDOMElement();
  });

  it.each([
    ["Settings with no marker", ""],
    ["an error that is not one of the links'", "error=profile_unavailable"],
  ])("%s says nothing and leaves the address alone", (_label, query) => {
    search = new URLSearchParams(query);
    render(<ChangeEmailLinkNotice />);
    expect(toastMock.error).not.toHaveBeenCalled();
    expect(toastMock).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });
});
