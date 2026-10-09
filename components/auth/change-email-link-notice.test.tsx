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
import { CLIENT_SETTINGS_PAGE, COACH_SETTINGS_PAGE } from "@/lib/constants";

/**
 * What a Settings page, the coach's or the client's, says when one of change
 * email's links failed (rules 6 and 17): Better Auth sends the browser to the
 * link's landing with `?error=<its code>`, the codes pinned to its
 * verify-email endpoint at 1.7.7.
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
    const { container } = render(<ChangeEmailLinkNotice landing={COACH_SETTINGS_PAGE} />);
    expect(toastMock.error).toHaveBeenCalledTimes(1);
    expect(toastMock.error).toHaveBeenCalledWith("This link has expired. Request a new one.", { id: "change-email-link" });
    expect(replace).toHaveBeenCalledWith("/settings");
    expect(container).toBeEmptyDOMElement();
  });

  it.each([
    ["the coach's Settings", COACH_SETTINGS_PAGE, "/settings"],
    ["the client's Settings", CLIENT_SETTINGS_PAGE, "/client/settings"],
  ] as const)("on %s, drops the marker by staying on that page", (_label, landing, page) => {
    search = new URLSearchParams("error=TOKEN_EXPIRED");
    render(<ChangeEmailLinkNotice landing={landing} />);
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith(page);
  });

  it.each([
    ["Settings with no marker", ""],
    ["an error that is not one of the links'", "error=profile_unavailable"],
  ])("%s says nothing and leaves the address alone", (_label, query) => {
    search = new URLSearchParams(query);
    render(<ChangeEmailLinkNotice landing={CLIENT_SETTINGS_PAGE} />);
    expect(toastMock.error).not.toHaveBeenCalled();
    expect(toastMock).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });
});
