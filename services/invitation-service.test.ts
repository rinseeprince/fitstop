import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/services/email-service", () => ({ sendInvitationEmail: vi.fn(), generateInviteToken: vi.fn() }));
vi.mock("@/services/supabase-admin", () => ({ supabaseAdmin: { from: vi.fn() } }));

import { findLiveInvitation, getInvitationByToken } from "./invitation-service";
import { supabaseAdmin } from "@/services/supabase-admin";

const TOKEN = "cd".repeat(32);
const ROW = {
  id: "invitation-1",
  client_id: "client-1",
  email: "s.kalepa91+invite-smoke@gmail.com",
  status: "sent",
  expires_at: new Date(Date.now() + 86_400_000).toISOString(),
  client: { name: "Smoke · invite me", coach: { name: "Sam Coach" } },
};

/** The invitation read resolving to `result`, its select and filter exposed. */
function stubRead(result: { data: unknown; error: unknown }) {
  const maybeSingle = vi.fn().mockResolvedValue(result);
  const eq = vi.fn().mockReturnValue({ maybeSingle });
  const select = vi.fn().mockReturnValue({ eq });
  vi.mocked(supabaseAdmin.from).mockReturnValue({ select } as never);
  return { select, eq };
}

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
    ["it was accepted", { data: { ...ROW, status: "accepted" }, error: null }, "This invitation has already been used"],
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

  it("throws on a failed read, which is no refusal", async () => {
    stubRead({ data: null, error: { message: "connection refused" } });
    await expect(findLiveInvitation(TOKEN)).rejects.toThrow("Failed to read the invitation: connection refused");
  });
});
