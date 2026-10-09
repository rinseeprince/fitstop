import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/services/email-service", async () => {
  const { PRODUCT_NAME } = await vi.importActual<typeof import("@/lib/constants")>("@/lib/constants");
  return { EMAIL_SENDER: `${PRODUCT_NAME} <no-reply@example.com>`, resend: { emails: { send: vi.fn() } } };
});
vi.mock("@/lib/error-handler", () => ({ captureApiError: vi.fn() }));

import { sendApproveEmailChangeEmail, sendConfirmDeleteAccountEmail, sendConfirmNewEmailEmail, sendPasswordLinkEmail } from "./auth-email-service";
import { EMAIL_SENDER, resend } from "@/services/email-service";
import { captureApiError } from "@/lib/error-handler";
import { ACCOUNT_DELETION_TAKES, PRODUCT_NAME } from "@/lib/constants";

const LINK = {
  user: { email: "coach@example.com", name: "Sam" },
  url: "http://localhost:3000/api/auth/reset-password/tok123?callbackURL=%2Freset-password",
};

/** An email's html as a person reads it: React marks where a value meets its sentence (<!-- -->); the text reads it whole. */
function readable(html: string | undefined): string {
  return (html ?? "").replace(/<!-- -->/g, "");
}

/** Signed by the product's team, in the html and the text alike. */
function expectSignedByTheTeam(message: { html?: string; text?: string }) {
  expect(readable(message.html)).toContain(`The ${PRODUCT_NAME} Team`);
  expect(message.text).toContain(`The ${PRODUCT_NAME} Team`);
}

describe("sendPasswordLinkEmail", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sends the Reset your password email to the login's address, from the app's sender, carrying Better Auth's link", async () => {
    vi.mocked(resend.emails.send).mockResolvedValue({ data: { id: "e1" }, error: null } as never);
    await sendPasswordLinkEmail(LINK);
    expect(resend.emails.send).toHaveBeenCalledTimes(1);
    const [message] = vi.mocked(resend.emails.send).mock.calls[0];
    expect(message).toMatchObject({ from: EMAIL_SENDER, to: "coach@example.com", subject: "Reset your password" });
    expect(message.html).toContain(LINK.url.replace(/&/g, "&amp;"));
    expect(message.text).toContain(LINK.url);
    expect(readable(message.html)).toContain(`Someone asked to reset the password for your ${PRODUCT_NAME} account.`);
    expect(message.text).toContain(`Someone asked to reset the password for your ${PRODUCT_NAME} account.`);
    expectSignedByTheTeam(message);
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
    expect(message).toMatchObject({ from: EMAIL_SENDER, to: "coach@example.com", subject: `Set your password for ${PRODUCT_NAME}` });
    expect(message.html).toContain("Set your password");
    expect(readable(message.html)).toContain(`Your coach account on ${PRODUCT_NAME} is ready.`);
    expect(message.html).toContain(url.replace(/&/g, "&amp;"));
    expect(message.html).not.toContain("Reset your password");
    expect(message.text).toContain(url);
    expect(message.text).toContain(`Your coach account on ${PRODUCT_NAME} is ready.`);
    expectSignedByTheTeam(message);
    expect(`${message.html}${message.text}`).not.toContain("—");
    expect(captureApiError).not.toHaveBeenCalled();
  });

  it.each([
    ["the same page named by its full address", `?callbackURL=${encodeURIComponent("http://localhost:3000/set-password")}`],
    ["the page with a query of its own", `?callbackURL=${encodeURIComponent("/set-password?from=owner")}`],
  ])("%s is still /set-password", async (_label, query) => {
    expect((await sentFor(query)).message.subject).toBe(`Set your password for ${PRODUCT_NAME}`);
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
    expect(readable(message.html)).not.toContain(`Your coach account on ${PRODUCT_NAME} is ready.`);
  });
});

/** Change email's two links, as Better Auth builds them (a token it signs, landing on the coach's Settings). */
const APPROVE_URL = "http://localhost:3000/api/auth/verify-email?token=eyJ.approve.sig&callbackURL=%2Fsettings";
const CONFIRM_URL = "http://localhost:3000/api/auth/verify-email?token=eyJ.confirm.sig&callbackURL=%2Fsettings";

/** The one email sent, and its html and text together. */
function sentEmail() {
  expect(resend.emails.send).toHaveBeenCalledTimes(1);
  const [message] = vi.mocked(resend.emails.send).mock.calls[0];
  return { message, both: `${message.html}${message.text}` };
}

describe("change email's first email: Approve your email change, to the address the coach signs in with now (rule 6)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("goes to the current address from the app's sender, names the new one, and carries Better Auth's link", async () => {
    vi.mocked(resend.emails.send).mockResolvedValue({ data: { id: "e1" }, error: null } as never);
    await sendApproveEmailChangeEmail({ user: { email: "coach@example.com", name: "Sam" }, newEmail: "new@example.com", url: APPROVE_URL });
    const { message, both } = sentEmail();
    expect(message).toMatchObject({ from: EMAIL_SENDER, to: "coach@example.com", subject: "Approve your email change" });
    expect(message.html).toContain("Approve your email change");
    expect(message.html).toContain(APPROVE_URL.replace(/&/g, "&amp;"));
    expect(message.text).toContain(APPROVE_URL);
    expect(readable(message.html)).toContain(`Someone asked to change the email you sign in to ${PRODUCT_NAME} with to new@example.com.`);
    expect(message.text).toContain(`Someone asked to change the email you sign in to ${PRODUCT_NAME} with to new@example.com.`);
    expectSignedByTheTeam(message);
    expect(both).toContain("This link expires in one hour.");
    expect(both).not.toContain("Confirm your new email");
    expect(both).not.toContain("—");
    expect(captureApiError).not.toHaveBeenCalled();
  });

  it.each([
    ["Resend refuses it", () => vi.mocked(resend.emails.send).mockResolvedValue({ data: null, error: { message: "sandbox" } } as never)],
    ["the send throws", () => vi.mocked(resend.emails.send).mockRejectedValue(new Error("network"))],
  ])("never throws when %s: it runs after the answer, and the failure reaches Sentry", async (_label, failIt) => {
    failIt();
    await expect(
      sendApproveEmailChangeEmail({ user: { email: "coach@example.com", name: "Sam" }, newEmail: "new@example.com", url: APPROVE_URL })
    ).resolves.toBeUndefined();
    expect(captureApiError).toHaveBeenCalledWith(expect.any(Error), { source: "sendApproveEmailChangeEmail" });
  });
});

describe("change email's second email: Confirm your new email, to the new address (rule 6)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("goes to the address Better Auth hands over, the new one, and carries its link", async () => {
    vi.mocked(resend.emails.send).mockResolvedValue({ data: { id: "e2" }, error: null } as never);
    await sendConfirmNewEmailEmail({ user: { email: "new@example.com", name: "Sam" }, url: CONFIRM_URL });
    const { message, both } = sentEmail();
    expect(message).toMatchObject({ from: EMAIL_SENDER, to: "new@example.com", subject: "Confirm your new email" });
    expect(message.html).toContain("Confirm your new email");
    expect(message.html).toContain(CONFIRM_URL.replace(/&/g, "&amp;"));
    expect(message.text).toContain(CONFIRM_URL);
    expect(readable(message.html)).toContain(`Once you do, you sign in to ${PRODUCT_NAME} with this email.`);
    expect(message.text).toContain(`Once you do, you sign in to ${PRODUCT_NAME} with this email.`);
    expectSignedByTheTeam(message);
    expect(both).toContain("This link expires in one hour.");
    expect(both).not.toContain("Approve your email change");
    expect(both).not.toContain("—");
    expect(captureApiError).not.toHaveBeenCalled();
  });

  it("never throws when Resend refuses it, and the failure reaches Sentry", async () => {
    vi.mocked(resend.emails.send).mockResolvedValue({ data: null, error: { message: "sandbox" } } as never);
    await expect(sendConfirmNewEmailEmail({ user: { email: "new@example.com", name: "Sam" }, url: CONFIRM_URL })).resolves.toBeUndefined();
    expect(captureApiError).toHaveBeenCalledWith(expect.any(Error), { source: "sendConfirmNewEmailEmail" });
  });
});

describe("delete account's email: Confirm deleting your account, to the address the person signs in with (rules 10 and 13)", () => {
  beforeEach(() => vi.clearAllMocks());

  const DELETE_URL = "http://localhost:3000/api/auth/delete-user/callback?token=abc123&callbackURL=%2Flogin%3Fdeleted%3D1";
  const ASKER = { email: "coach@example.com", name: "Sam" };

  it.each(["coach", "client"] as const)("a %s's goes from the app's sender, says what goes with the account, and carries Better Auth's link", async (account) => {
    vi.mocked(resend.emails.send).mockResolvedValue({ data: { id: "e4" }, error: null } as never);
    await sendConfirmDeleteAccountEmail({ user: ASKER, url: DELETE_URL, account });
    const [message] = vi.mocked(resend.emails.send).mock.calls[0];
    expect(message).toMatchObject({ from: EMAIL_SENDER, to: "coach@example.com", subject: "Confirm deleting your account" });
    expect(message.html).toContain(DELETE_URL.replace(/&/g, "&amp;"));
    expect(message.text).toContain(DELETE_URL);
    const both = `${readable(message.html)}\n${message.text}`;
    for (const shown of [readable(message.html), message.text ?? ""]) {
      expect(shown).toContain(`Someone asked to delete your ${PRODUCT_NAME} account.`);
      expect(shown.replace(/&#x27;/g, "'")).toContain(ACCOUNT_DELETION_TAKES[account]);
      expect(shown.replace(/&#x27;/g, "'")).toContain("This link expires in one day and works once. Open it in the browser you asked from, while you're signed in.");
    }
    expect(both).not.toContain(ACCOUNT_DELETION_TAKES[account === "coach" ? "client" : "coach"]);
    expectSignedByTheTeam(message);
    expect(both).not.toContain("—");
    expect(captureApiError).not.toHaveBeenCalled();
  });

  it("never throws when Resend refuses it, and the failure reaches Sentry", async () => {
    vi.mocked(resend.emails.send).mockResolvedValue({ data: null, error: { message: "sandbox" } } as never);
    await expect(sendConfirmDeleteAccountEmail({ user: ASKER, url: DELETE_URL, account: "client" })).resolves.toBeUndefined();
    expect(captureApiError).toHaveBeenCalledWith(expect.any(Error), { source: "sendConfirmDeleteAccountEmail" });
  });
});
