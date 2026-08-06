import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth-helpers", () => ({
  getAuthenticatedCoachId: vi.fn(),
  getAuthenticatedClientId: vi.fn(),
}));

vi.mock("@/services/supabase-admin", () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}));

vi.mock("@/lib/error-handler", () => ({
  captureApiError: vi.fn(),
}));

import {
  getViewerUnitPreference,
  resolveViewerUnitPreference,
} from "./viewer-preferences";
import {
  getAuthenticatedClientId,
  getAuthenticatedCoachId,
} from "@/lib/auth-helpers";
import { captureApiError } from "@/lib/error-handler";
import { supabaseAdmin } from "@/services/supabase-admin";

function makeRequest(): NextRequest {
  return new NextRequest("http://localhost/api/me/unit-preference");
}

/** Mirrors `.from(t).select(c).eq(c, v).maybeSingle()`. */
function mockQuery(result: { data: unknown; error: unknown }) {
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
  };
  vi.mocked(supabaseAdmin.from).mockReturnValue(
    query as unknown as ReturnType<typeof supabaseAdmin.from>
  );
  return query;
}

describe("resolveViewerUnitPreference", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAuthenticatedCoachId).mockResolvedValue(null);
    vi.mocked(getAuthenticatedClientId).mockResolvedValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the authenticated coach's preference", async () => {
    vi.mocked(getAuthenticatedCoachId).mockResolvedValue("coach-1");
    const query = mockQuery({ data: { unit_preference: "imperial" }, error: null });

    const result = await resolveViewerUnitPreference(makeRequest());

    expect(result).toBe("imperial");
    expect(supabaseAdmin.from).toHaveBeenCalledWith("coaches");
    expect(query.eq).toHaveBeenCalledWith("id", "coach-1");
    // A coach resolves in one branch — the client helper is never reached.
    expect(getAuthenticatedClientId).not.toHaveBeenCalled();
  });

  it("returns the authenticated client's preference when no coach resolves", async () => {
    vi.mocked(getAuthenticatedClientId).mockResolvedValue("client-1");
    const query = mockQuery({ data: { unit_preference: "metric" }, error: null });

    const result = await resolveViewerUnitPreference(makeRequest());

    expect(result).toBe("metric");
    expect(supabaseAdmin.from).toHaveBeenCalledWith("clients");
    expect(query.eq).toHaveBeenCalledWith("id", "client-1");
  });

  it("returns null when nobody is authenticated", async () => {
    const result = await resolveViewerUnitPreference(makeRequest());

    expect(result).toBeNull();
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
  });

  it("returns null when the resolved id has no row", async () => {
    // Reachable: the auth cache holds a user -> id mapping for 60s, so the row
    // can be deleted inside that window. Not an error — the caller 401s.
    vi.mocked(getAuthenticatedCoachId).mockResolvedValue("coach-gone");
    mockQuery({ data: null, error: null });

    expect(await resolveViewerUnitPreference(makeRequest())).toBeNull();
  });

  it("throws on a database error rather than guessing a default", async () => {
    vi.mocked(getAuthenticatedCoachId).mockResolvedValue("coach-1");
    mockQuery({ data: null, error: { message: "connection reset" } });

    await expect(resolveViewerUnitPreference(makeRequest())).rejects.toThrow(
      "Failed to read coach unit preference: connection reset"
    );
  });

  it("throws on a client-side database error too", async () => {
    vi.mocked(getAuthenticatedClientId).mockResolvedValue("client-1");
    mockQuery({ data: null, error: { message: "timeout" } });

    await expect(resolveViewerUnitPreference(makeRequest())).rejects.toThrow(
      "Failed to read client unit preference: timeout"
    );
  });

  it("passes the request through to both auth helpers", async () => {
    const request = makeRequest();

    await resolveViewerUnitPreference(request);

    expect(getAuthenticatedCoachId).toHaveBeenCalledWith(request);
    expect(getAuthenticatedClientId).toHaveBeenCalledWith(request);
  });

  it("normalizes an unexpected stored value to metric", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(getAuthenticatedCoachId).mockResolvedValue("coach-1");
    mockQuery({ data: { unit_preference: "stones" }, error: null });

    expect(await resolveViewerUnitPreference(makeRequest())).toBe("metric");
  });
});

describe("getViewerUnitPreference", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAuthenticatedCoachId).mockResolvedValue(null);
    vi.mocked(getAuthenticatedClientId).mockResolvedValue(null);
  });

  it("returns the resolved preference when there is one", async () => {
    vi.mocked(getAuthenticatedCoachId).mockResolvedValue("coach-1");
    mockQuery({ data: { unit_preference: "imperial" }, error: null });

    expect(await getViewerUnitPreference(makeRequest())).toBe("imperial");
  });

  it("falls back to metric when nobody is authenticated", async () => {
    expect(await getViewerUnitPreference(makeRequest())).toBe("metric");
    expect(captureApiError).not.toHaveBeenCalled();
  });

  it("falls back to metric on a database error, and reports it", async () => {
    // Deliberately lossy, unlike resolveViewerUnitPreference: this variant
    // serves server-rendered prompt strings with no UI state to degrade into.
    vi.mocked(getAuthenticatedCoachId).mockResolvedValue("coach-1");
    mockQuery({ data: null, error: { message: "connection reset" } });

    expect(await getViewerUnitPreference(makeRequest())).toBe("metric");
    expect(captureApiError).toHaveBeenCalledTimes(1);
  });
});
