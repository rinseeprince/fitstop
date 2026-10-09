import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Resend } from "resend";

const send = vi.hoisted(() => vi.fn<Resend["emails"]["send"]>());
vi.mock("resend", () => ({ Resend: class { emails = { send }; } }));

import { PRODUCT_NAME } from "@/lib/constants";

/** The module as it loads under this environment: the sender is read once, at load. */
async function loadWith(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  return import("./email-service");
}

/** An email's html as a person reads it: React marks where a value meets its sentence (<!-- -->); the text reads it whole. */
function readable(html: string | undefined): string {
  return (html ?? "").replace(/<!-- -->/g, "");
}

/** The one email sent, and its html as read beside its text. */
function sentEmail() {
  expect(send).toHaveBeenCalledTimes(1);
  const [message] = send.mock.calls[0];
  return { message, bodies: [readable(message.html), message.text ?? ""] };
}

const SENDING = { RESEND_API_KEY: "re_test", NEXT_PUBLIC_APP_URL: "http://localhost:3000" };

describe("the sender of every email (D30)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is the product's name on Resend's sandbox address while EMAIL_FROM is missing", async () => {
    const { EMAIL_SENDER } = await loadWith({ EMAIL_FROM: undefined });
    expect(EMAIL_SENDER).toBe(`${PRODUCT_NAME} <onboarding@resend.dev>`);
  });
});

describe("the client's emails name the product", () => {
  beforeEach(() => {
    send.mockReset();
    send.mockResolvedValue({ data: { id: "e1" }, error: null } as never);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("the invitation, in its subject, its heading, its sentence and its sign-off", async () => {
    const { sendInvitationEmail } = await loadWith(SENDING);
    await expect(sendInvitationEmail("client@example.com", "Alex", "Sam Coach", "tok123")).resolves.toEqual({ success: true });
    const { message, bodies } = sentEmail();
    expect(message.subject).toBe(`You're invited to join ${PRODUCT_NAME} by Sam Coach`);
    expect(readable(message.html)).toContain(`invited to join ${PRODUCT_NAME}!`);
    for (const body of bodies) {
      expect(body).toContain(`Sam Coach has invited you to track your fitness journey together on ${PRODUCT_NAME}.`);
      expect(body).toContain(`The ${PRODUCT_NAME} Team`);
    }
  });

  it("the activation, in its subject, its sentences and its sign-off", async () => {
    const { sendActivationEmail } = await loadWith(SENDING);
    await expect(sendActivationEmail("client@example.com", "Alex", "Sam Coach")).resolves.toEqual({ success: true });
    const { message, bodies } = sentEmail();
    expect(message.subject).toBe(`Sam Coach has set up your plan on ${PRODUCT_NAME}`);
    expect(readable(message.html)).toContain(`Click the button below to open ${PRODUCT_NAME} and see your plan:`);
    expect(message.text).toContain(`Open ${PRODUCT_NAME} to view your plan: http://localhost:3000`);
    for (const body of bodies) {
      expect(body).toContain(`Sam Coach has finished setting up your personalised plan on ${PRODUCT_NAME}. Everything is ready`);
      expect(body).toContain(`The ${PRODUCT_NAME} Team`);
    }
  });
});
