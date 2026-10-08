import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/services/email-service", () => ({
  EMAIL_SENDER: "CoachHub <no-reply@example.com>",
  resend: { emails: { send: vi.fn() } },
}));
vi.mock("@/lib/error-handler", () => ({ captureApiError: vi.fn() }));

import { sendPasswordLinkEmail } from "./auth-email-service";
import { resend } from "@/services/email-service";
import { captureApiError } from "@/lib/error-handler";

const LINK = {
  user: { email: "coach@example.com", name: "Sam" },
  url: "http://localhost:3000/api/auth/reset-password/tok123?callbackURL=%2Freset-password",
};

describe("sendPasswordLinkEmail", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sends the Reset your password email to the login's address, from the app's sender, carrying Better Auth's link", async () => {
    vi.mocked(resend.emails.send).mockResolvedValue({ data: { id: "e1" }, error: null } as never);
    await sendPasswordLinkEmail(LINK);
    expect(resend.emails.send).toHaveBeenCalledTimes(1);
    const [message] = vi.mocked(resend.emails.send).mock.calls[0];
    expect(message).toMatchObject({ from: "CoachHub <no-reply@example.com>", to: "coach@example.com", subject: "Reset your password" });
    expect(message.html).toContain(LINK.url.replace(/&/g, "&amp;"));
    expect(message.text).toContain(LINK.url);
    expect(message.text).not.toContain("—");
    expect(captureApiError).not.toHaveBeenCalled();
  });

  it.each([
    ["Resend refuses it", () => vi.mocked(resend.emails.send).mockResolvedValue({ data: null, error: { message: "sandbox" } } as never)],
    ["the send throws", () => vi.mocked(resend.emails.send).mockRejectedValue(new Error("network"))],
  ])("never throws when %s: forgot password answers every address alike, and the failure reaches Sentry", async (_label, failIt) => {
    failIt();
    await expect(sendPasswordLinkEmail(LINK)).resolves.toBeUndefined();
    expect(captureApiError).toHaveBeenCalledWith(expect.any(Error), { source: "sendPasswordLinkEmail" });
  });
});

/** The one email sent for a link Better Auth built with this callbackURL query (already encoded, as Better Auth encodes it). */
async function sentFor(callbackQuery: string) {
  vi.mocked(resend.emails.send).mockResolvedValue({ data: { id: "e1" }, error: null } as never);
  const url = `http://localhost:3000/api/auth/reset-password/tok123${callbackQuery}`;
  await sendPasswordLinkEmail({ user: { email: "coach@example.com", name: "Sam" }, url });
  expect(resend.emails.send).toHaveBeenCalledTimes(1);
  return { url, message: vi.mocked(resend.emails.send).mock.calls[0][0] };
}

describe("the email a password link goes out as (D17): picked by the page the link lands on", () => {
  beforeEach(() => vi.clearAllMocks());

  it("a link landing on /set-password, the owner's coach:create's, is the Set your password email (rule 9)", async () => {
    const { url, message } = await sentFor("?callbackURL=%2Fset-password");
    expect(message).toMatchObject({ from: "CoachHub <no-reply@example.com>", to: "coach@example.com", subject: "Set your password for CoachHub" });
    expect(message.html).toContain("Set your password");
    expect(message.html).toContain("Your coach account on CoachHub is ready.");
    expect(message.html).toContain(url.replace(/&/g, "&amp;"));
    expect(message.html).not.toContain("Reset your password");
    expect(message.text).toContain(url);
    expect(message.text).toContain("Your coach account on CoachHub is ready.");
    expect(`${message.html}${message.text}`).not.toContain("—");
    expect(captureApiError).not.toHaveBeenCalled();
  });

  it.each([
    ["the same page named by its full address", `?callbackURL=${encodeURIComponent("http://localhost:3000/set-password")}`],
    ["the page with a query of its own", `?callbackURL=${encodeURIComponent("/set-password?from=owner")}`],
  ])("%s is still /set-password", async (_label, query) => {
    expect((await sentFor(query)).message.subject).toBe("Set your password for CoachHub");
  });

  it.each([
    ["/reset-password, forgot password's", "?callbackURL=%2Freset-password"],
    ["no landing at all", ""],
    ["an empty landing", "?callbackURL="],
    ["a page that only starts like it", `?callbackURL=${encodeURIComponent("/set-password-now")}`],
    ["a page beneath it", `?callbackURL=${encodeURIComponent("/set-password/x")}`],
  ])("a link landing on %s is the Reset your password email", async (_label, query) => {
    const { message } = await sentFor(query);
    expect(message.subject).toBe("Reset your password");
    expect(message.html).not.toContain("Your coach account on CoachHub is ready.");
  });
});
