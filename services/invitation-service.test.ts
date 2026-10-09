import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/services/email-service", () => ({ sendInvitationEmail: vi.fn(), generateInviteToken: vi.fn() }));
vi.mock("@/services/supabase-admin", () => ({ supabaseAdmin: { from: vi.fn() } }));
vi.mock("@/lib/error-handler", () => ({ captureApiError: vi.fn() }));

import {
  findLiveInvitation,
  getInvitationByToken,
  invitationLinkWorks,
  INVITATION_NOT_SENT,
  readInvitation,
  sendInvitation,
  sendInvitationIfNeeded,
} from "./invitation-service";
import { supabaseAdmin } from "@/services/supabase-admin";
import { generateInviteToken, sendInvitationEmail } from "@/services/email-service";
import { captureApiError } from "@/lib/error-handler";

const TOKEN = "cd".repeat(32);
const NEW_TOKEN = "ef".repeat(32);
const ROW = {
  id: "invitation-1",
  client_id: "client-1",
  email: "s.kalepa91+invite-smoke@gmail.com",
  accepted_at: null,
  expires_at: new Date(Date.now() + 86_400_000).toISOString(),
  client: { name: "Smoke · invite me", coach: { name: "Sam Coach" } },
};

/** Resend's own refusal, which the coach must never read. */
const RESEND_WORDS = "Failed to send email: You can only send testing emails to your own email address";

/**
 * Every statement the service makes through supabaseAdmin, and the email, in
 * the order they ran: the service role reads past every rule in the database,
 * so a statement's filters are its whole scope. Each `table.verb` answers what
 * `answers` holds for it, else nothing.
 */
type Step = { step: string; args: unknown[] };
let steps: Step[] = [];
let answers: Record<string, { data?: unknown; error?: { message: string } | null }> = {};

function stubSupabase() {
  steps = [];
  answers = {};
  vi.mocked(supabaseAdmin.from).mockImplementation(((table: string) => {
    let verb = "select";
    const answer = () => Promise.resolve({ data: null, error: null, ...answers[`${table}.${verb}`] });
    const builder = {
      select: (...args: unknown[]) => (steps.push({ step: `${table}.select`, args }), builder),
      upsert: (...args: unknown[]) => ((verb = "upsert"), steps.push({ step: `${table}.upsert`, args }), builder),
      eq: (...args: unknown[]) => (steps.push({ step: `${table}.eq`, args }), builder),
      maybeSingle: answer,
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => answer().then(resolve, reject),
    };
    return builder;
  }) as never);
  vi.mocked(sendInvitationEmail).mockImplementation((...args: unknown[]) => {
    steps.push({ step: "email", args });
    return Promise.resolve({ success: true });
  });
  vi.mocked(generateInviteToken).mockReturnValue(NEW_TOKEN);
}

/** The invitation read resolving to `result`, its select and filter exposed. */
function stubRead(result: { data: unknown; error: unknown }) {
  const maybeSingle = vi.fn().mockResolvedValue(result);
  const eq = vi.fn().mockReturnValue({ maybeSingle });
  const select = vi.fn().mockReturnValue({ eq });
  vi.mocked(supabaseAdmin.from).mockReturnValue({ select } as never);
  return { select, eq };
}

const NOW = new Date("2026-10-07T20:00:00Z");
const FUTURE = "2026-10-14T20:00:00.000Z";
const PAST = "2026-10-01T20:00:00.000Z";

describe("invitationLinkWorks: the one predicate for a link (D40)", () => {
  it.each([
    ["never used, its expiry ahead", { accepted_at: null, expires_at: FUTURE }, true],
    ["never used, written before links expired", { accepted_at: null, expires_at: null }, true],
    ["never used, its expiry passed", { accepted_at: null, expires_at: PAST }, false],
    ["used, its expiry ahead", { accepted_at: PAST, expires_at: FUTURE }, false],
    ["used, written before links expired", { accepted_at: PAST, expires_at: null }, false],
  ])("a link %s → %s", (_label, row, works) => {
    expect(invitationLinkWorks(row, NOW)).toBe(works);
  });

  it("stops working the instant its expiry passes", () => {
    expect(invitationLinkWorks({ accepted_at: null, expires_at: NOW.toISOString() }, NOW)).toBe(false);
    expect(invitationLinkWorks({ accepted_at: null, expires_at: NOW.toISOString() }, new Date(NOW.getTime() - 1))).toBe(true);
  });
});

describe("getInvitationByToken (what whoever holds the link sees)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("answers the coach's name and the address with its middle hidden, never the address or the client's name (D11)", async () => {
    const read = stubRead({ data: ROW, error: null });
    const result = await getInvitationByToken(TOKEN);
    expect(result).toEqual({
      success: true,
      invitation: { coachName: "Sam Coach", emailMasked: "s•••e@gmail.com", expiresAt: ROW.expires_at },
    });
    expect(JSON.stringify(result)).not.toContain("kalepa91");
    expect(JSON.stringify(result)).not.toContain("Smoke");
    expect(read.eq).toHaveBeenCalledWith("token", TOKEN);
  });

  it.each([
    ["no invitation holds the token", { data: null, error: null }, "Invalid invitation link"],
    ["it has expired", { data: { ...ROW, expires_at: "2020-01-01T00:00:00Z" }, error: null }, "This invitation has expired"],
    ["it was used", { data: { ...ROW, accepted_at: "2026-10-02T09:00:00Z" }, error: null }, "This invitation has already been used"],
    ["it was used, and its expiry has passed since", { data: { ...ROW, accepted_at: "2019-12-30T09:00:00Z", expires_at: "2020-01-01T00:00:00Z" }, error: null }, "This invitation has already been used"],
    ["the read fails", { data: null, error: { message: "connection refused" } }, "Failed to validate invitation"],
  ])("when %s it says so, and shows nothing of the invitation", async (_label, result, error) => {
    stubRead(result);
    expect(await getInvitationByToken(TOKEN)).toEqual({ success: false, error });
  });
});

describe("findLiveInvitation (what accepting needs, server-side)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("hands the full invitation to the server: the address the login is made with and the client's name", async () => {
    stubRead({ data: ROW, error: null });
    expect(await findLiveInvitation(TOKEN)).toEqual({
      invitation: {
        id: "invitation-1",
        clientId: "client-1",
        email: ROW.email,
        clientName: "Smoke · invite me",
        coachName: "Sam Coach",
        expiresAt: ROW.expires_at,
      },
    });
  });

  it("judges the link by its dates alone: it reads accepted_at and expires_at", async () => {
    const read = stubRead({ data: ROW, error: null });
    await findLiveInvitation(TOKEN);
    const columns = String(read.select.mock.calls[0][0]);
    expect(columns).toContain("accepted_at");
    expect(columns).toContain("expires_at");
    expect(columns).not.toMatch(/\bstatus\b/);
  });

  it("throws on a failed read, which is no refusal", async () => {
    stubRead({ data: null, error: { message: "connection refused" } });
    await expect(findLiveInvitation(TOKEN)).rejects.toThrow("Failed to read the invitation: connection refused");
  });
});

describe("sendInvitation: the email first, the row after it (D41)", () => {
  const CLIENT = { name: "Maya Okafor", email: "maya@example.com", user_id: null, coach: { name: "Priya", timezone: "Australia/Perth" } };

  beforeEach(() => {
    vi.clearAllMocks();
    stubSupabase();
    answers["clients.select"] = { data: CLIENT };
  });

  it("emails a new link, then writes the client's row in one upsert on client_id, and answers its dates on the coach's calendar", async () => {
    const result = await sendInvitation("client-1", NOW);

    expect(steps.map((s) => s.step)).toEqual([
      "clients.select",
      "clients.eq",
      "email",
      "client_invitations.upsert",
    ]);
    // The client it was handed, and no other.
    expect(steps[1]).toEqual({ step: "clients.eq", args: ["id", "client-1"] });
    expect(steps[2].args).toEqual(["maya@example.com", "Maya Okafor", "Priya", NEW_TOKEN]);
    expect(steps[3].args).toEqual([
      {
        client_id: "client-1",
        token: NEW_TOKEN,
        email: "maya@example.com",
        invited_at: NOW.toISOString(),
        expires_at: FUTURE,
        accepted_at: null,
      },
      { onConflict: "client_id" },
    ]);
    // 20:00 UTC is 04:00 the next day in Perth: the coach's days, not the server's.
    expect(result).toEqual({
      sent: true,
      invitation: { hasAccount: false, invitation: { sentOn: "2026-10-08", expiresOn: "2026-10-15", linkWorks: true } },
    });
  });

  it("never answers the link's token", async () => {
    const result = await sendInvitation("client-1", NOW);
    expect(JSON.stringify(result)).not.toContain(NEW_TOKEN);
  });

  it("a refused email writes nothing, so the link the client holds still opens; Resend's words go to Sentry, the coach reads a plain sentence", async () => {
    vi.mocked(sendInvitationEmail).mockImplementation((...args: unknown[]) => {
      steps.push({ step: "email", args });
      return Promise.resolve({ success: false, error: RESEND_WORDS });
    });

    const result = await sendInvitation("client-1", NOW);

    expect(result).toEqual({ sent: false, reason: "email_failed" });
    expect(INVITATION_NOT_SENT[result.sent ? "failed" : result.reason]).toBe("The email couldn't be sent. Try again.");
    expect(steps.some((s) => s.step === "client_invitations.upsert")).toBe(false);
    expect(captureApiError).toHaveBeenCalledWith(
      expect.objectContaining({ message: RESEND_WORDS }),
      expect.objectContaining({ clientId: "client-1" })
    );
    expect(JSON.stringify(result)).not.toContain("testing emails");
  });

  it("a write that fails after the email went is reported, and the send answers that it failed", async () => {
    answers["client_invitations.upsert"] = { error: { message: "connection reset" } };

    const result = await sendInvitation("client-1", NOW);

    expect(result).toEqual({ sent: false, reason: "failed" });
    expect(steps.map((s) => s.step)).toContain("email");
    expect(captureApiError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Failed to write the invitation: connection reset" }),
      expect.objectContaining({ clientId: "client-1" })
    );
  });

  it.each([
    ["a client with a login", { ...CLIENT, user_id: "user-9" }, "has_account"],
    ["a client with no address", { ...CLIENT, email: "" }, "no_email"],
    ["no client", null, "not_found"],
  ] as const)("refuses %s before anything is emailed or written", async (_label, client, reason) => {
    answers["clients.select"] = { data: client };

    expect(await sendInvitation("client-1", NOW)).toEqual({ sent: false, reason });
    expect(steps.map((s) => s.step)).toEqual(["clients.select", "clients.eq"]);
  });

  it("a failed read of the client sends nothing and never throws", async () => {
    answers["clients.select"] = { error: { message: "connection refused" } };

    expect(await sendInvitation("client-1", NOW)).toEqual({ sent: false, reason: "failed" });
    expect(sendInvitationEmail).not.toHaveBeenCalled();
    expect(captureApiError).toHaveBeenCalled();
  });

  it("each reason's sentence is plain words", () => {
    expect(INVITATION_NOT_SENT).toEqual({
      not_found: "Client not found",
      has_account: "This client already has an account.",
      no_email: "This client has no email address.",
      email_failed: "The email couldn't be sent. Try again.",
      failed: "Something went wrong. Try again.",
    });
  });
});

describe("readInvitation: what the Invite box reads (D43)", () => {
  const CLIENT = { id: "client-1", coachId: "coach-1", hasAccount: false };

  beforeEach(() => {
    vi.clearAllMocks();
    stubSupabase();
    answers["coaches.select"] = { data: { timezone: "Australia/Perth" } };
  });

  it("a client never invited: no invitation", async () => {
    expect(await readInvitation(CLIENT, NOW)).toEqual({ hasAccount: false, invitation: null });
  });

  it("an invitation: its dates as the coach's calendar days, whether its link works, and never its token", async () => {
    answers["client_invitations.select"] = {
      data: { invited_at: NOW.toISOString(), expires_at: FUTURE, accepted_at: null, token: TOKEN },
    };

    const read = await readInvitation(CLIENT, NOW);

    expect(read).toEqual({
      hasAccount: false,
      invitation: { sentOn: "2026-10-08", expiresOn: "2026-10-15", linkWorks: true },
    });
    expect(JSON.stringify(read)).not.toContain(TOKEN);
    const columns = steps.filter((s) => s.step === "client_invitations.select").map((s) => String(s.args[0]));
    expect(columns).toEqual(["invited_at, expires_at, accepted_at"]);
    expect(steps).toContainEqual({ step: "client_invitations.eq", args: ["client_id", "client-1"] });
    expect(steps).toContainEqual({ step: "coaches.eq", args: ["id", "coach-1"] });
  });

  it("a link that expired: still the invitation, its link no longer working", async () => {
    answers["client_invitations.select"] = { data: { invited_at: "2026-09-24T20:00:00.000Z", expires_at: PAST, accepted_at: null } };

    expect(await readInvitation(CLIENT, NOW)).toEqual({
      hasAccount: false,
      invitation: { sentOn: "2026-09-25", expiresOn: "2026-10-02", linkWorks: false },
    });
  });

  it("whether the client has an account is the caller's verified row", async () => {
    expect((await readInvitation({ ...CLIENT, hasAccount: true }, NOW)).hasAccount).toBe(true);
  });

  it.each([
    ["the invitation", "client_invitations.select"],
    ["the coach's timezone", "coaches.select"],
  ])("throws when %s can't be read", async (_label, step) => {
    answers[step] = { error: { message: "connection refused" } };
    await expect(readInvitation(CLIENT, NOW)).rejects.toThrow("connection refused");
  });
});

describe("sendInvitationIfNeeded: activation's invitation (D42)", () => {
  const CLIENT = { name: "Maya Okafor", email: "maya@example.com", user_id: null, coach: { name: "Priya", timezone: "UTC" } };
  const MAYA = { id: "client-1", email: "maya@example.com" };
  const WORKS = { email: "maya@example.com", accepted_at: null, expires_at: "2999-01-01T00:00:00Z" };

  beforeEach(() => {
    vi.clearAllMocks();
    stubSupabase();
    answers["clients.select"] = { data: CLIENT };
  });

  it("a client with an account is sent nothing, and nothing is read", async () => {
    expect(await sendInvitationIfNeeded({ ...MAYA, userId: "user-9" })).toBe("not_needed");
    expect(steps).toEqual([]);
    expect(sendInvitationEmail).not.toHaveBeenCalled();
  });

  it("a client whose link still works at their address is sent nothing: no second email to end the first", async () => {
    answers["client_invitations.select"] = { data: WORKS };

    expect(await sendInvitationIfNeeded(MAYA)).toBe("not_needed");
    expect(sendInvitationEmail).not.toHaveBeenCalled();
    expect(steps.some((s) => s.step === "client_invitations.upsert")).toBe(false);
    // Its own invitation, read by the client it was handed.
    expect(steps).toContainEqual({ step: "client_invitations.eq", args: ["client_id", "client-1"] });
  });

  it("an address is one inbox whatever its case", async () => {
    answers["client_invitations.select"] = { data: { ...WORKS, email: "Maya@Example.com" } };
    expect(await sendInvitationIfNeeded(MAYA)).toBe("not_needed");
  });

  // The coach corrected a pending client's address after inviting them: the
  // link that still works went to another inbox, so the client is sent one at
  // theirs, and its row replaces the other's token.
  it("a link that still works at an earlier address is no link of the client's: one is sent to their address now", async () => {
    answers["client_invitations.select"] = { data: { ...WORKS, email: "maya@exmaple.com" } };

    expect(await sendInvitationIfNeeded(MAYA)).toBe("sent");
    expect(sendInvitationEmail).toHaveBeenCalledWith("maya@example.com", "Maya Okafor", "Priya", NEW_TOKEN);
    const upsert = steps.find((s) => s.step === "client_invitations.upsert");
    expect(upsert?.args[0]).toMatchObject({ client_id: "client-1", email: "maya@example.com", token: NEW_TOKEN });
  });

  it.each([
    ["never invited", null],
    ["whose link expired", { email: "maya@example.com", accepted_at: null, expires_at: PAST }],
  ])("a client %s is sent one, and awaited", async (_label, row) => {
    answers["client_invitations.select"] = { data: row };

    expect(await sendInvitationIfNeeded(MAYA)).toBe("sent");
    expect(sendInvitationEmail).toHaveBeenCalledTimes(1);
    expect(steps.some((s) => s.step === "client_invitations.upsert")).toBe(true);
  });

  it("a send that doesn't go answers failed", async () => {
    vi.mocked(sendInvitationEmail).mockResolvedValue({ success: false, error: RESEND_WORDS });
    expect(await sendInvitationIfNeeded(MAYA)).toBe("failed");
  });

  it("a client who accepted while it ran needs none", async () => {
    answers["clients.select"] = { data: { ...CLIENT, user_id: "user-9" } };
    expect(await sendInvitationIfNeeded(MAYA)).toBe("not_needed");
    expect(sendInvitationEmail).not.toHaveBeenCalled();
  });

  it("an invitation that can't be read is never overwritten: nothing is sent, and the activation hears it failed", async () => {
    answers["client_invitations.select"] = { error: { message: "connection refused" } };

    expect(await sendInvitationIfNeeded(MAYA)).toBe("failed");
    expect(sendInvitationEmail).not.toHaveBeenCalled();
    expect(captureApiError).toHaveBeenCalled();
  });
});
