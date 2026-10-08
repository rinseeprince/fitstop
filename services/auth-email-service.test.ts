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
