import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("next/headers", () => ({
  headers: vi.fn(),
}));

import { requireCSRFProtection } from "./csrf-protection";
import { headers } from "next/headers";

/**
 * The CSRF check every mutating route runs second (CONVENTIONS §9): a request
 * from the app's own pages passes, one from another site is refused, and the
 * client app's bearer request, which no browser sends, passes with neither
 * Origin nor Referer (docs/BETTER-AUTH-PLAN.md 2.2, 2.8).
 */

const APP = "http://localhost:3000";
const ELSEWHERE = "https://evil.example";
const TOKEN = "session-token.signature";

/** The incoming request's headers, as next/headers hands them to the route, on the app's host behind http. */
function incoming(extra: Record<string, string> = {}): void {
  vi.mocked(headers).mockResolvedValue(new Headers({ host: "localhost:3000", "x-forwarded-proto": "http", ...extra }) as never);
}

const request = (method: string) => new NextRequest(`${APP}/api/client/settings`, { method });

/** Whether the check let the request through: null, the route carries on. */
async function passes(method = "PATCH"): Promise<boolean> {
  return (await requireCSRFProtection(request(method))) === null;
}

beforeEach(() => {
  vi.mocked(headers).mockReset();
});

describe("a browser's request: its Origin, else its Referer, must be the app's own", () => {
  it("lets a GET through without reading a header", async () => {
    expect(await passes("GET")).toBe(true);
    expect(headers).not.toHaveBeenCalled();
  });

  it("lets a request from the app's own origin through", async () => {
    incoming({ origin: APP, cookie: "better-auth.session_token=browser" });
    expect(await passes()).toBe(true);
  });

  it("refuses another site's Origin with a 403 the client can read", async () => {
    incoming({ origin: ELSEWHERE, cookie: "better-auth.session_token=browser" });
    const refused = await requireCSRFProtection(request("POST"));
    expect(refused?.status).toBe(403);
    expect(await refused?.json()).toEqual({ success: false, error: "CSRF validation failed" });
  });

  it("refuses another site's Origin even with a bearer token beside it: a browser named the site it posted from", async () => {
    incoming({ origin: ELSEWHERE, authorization: `Bearer ${TOKEN}` });
    expect(await passes()).toBe(false);
  });

  it("with no Origin, lets the app's own Referer through and refuses another site's, a bearer token beside it or not", async () => {
    incoming({ referer: `${APP}/client/settings` });
    expect(await passes()).toBe(true);
    incoming({ referer: `${ELSEWHERE}/page` });
    expect(await passes()).toBe(false);
    incoming({ referer: `${ELSEWHERE}/page`, authorization: `Bearer ${TOKEN}` });
    expect(await passes()).toBe(false);
  });

  it("refuses when the headers can't be read", async () => {
    vi.mocked(headers).mockRejectedValue(new Error("outside a request"));
    expect(await passes()).toBe(false);
  });
});

describe("a request with neither Origin nor Referer, which no browser sends", () => {
  it("refuses one that carries only a cookie", async () => {
    incoming({ cookie: "better-auth.session_token=browser" });
    expect(await passes()).toBe(false);
  });

  it("lets the client app's bearer request through, on every mutating verb", async () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      incoming({ authorization: `Bearer ${TOKEN}` });
      expect(await passes(method), method).toBe(true);
    }
  });

  it("reads the scheme in any case, as Better Auth's bearer plugin does", async () => {
    for (const scheme of ["bearer", "BEARER", "BeArEr"]) {
      incoming({ authorization: `${scheme} ${TOKEN}` });
      expect(await passes(), scheme).toBe(true);
    }
  });

  it("refuses the scheme with no token after it, and any other scheme", async () => {
    // A header's own spaces are trimmed before anyone reads it; a no-break
    // space is not, and the bearer plugin's trim() reads it as no token too.
    for (const authorization of ["Bearer ", "Bearer    ", "Bearer", "Bearer \u00a0", `Bearer${TOKEN}`, `Basic ${TOKEN}`, TOKEN]) {
      incoming({ authorization });
      expect(await passes(), JSON.stringify(authorization)).toBe(false);
    }
  });
});
