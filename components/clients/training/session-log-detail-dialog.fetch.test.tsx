import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { SWRConfig, type Cache } from "swr";
import { SessionLogDetailDialog } from "./session-log-detail-dialog";
import { swrFetcher } from "@/lib/swr-fetcher";
import type { SessionLog } from "@/types/training";

// Real SWR, not the mock the sibling test uses: what this pins is SWR's own
// behaviour across a key change, which a mocked hook cannot show.

// Required, not optional: units-context imports auth-context, which constructs
// the browser Supabase client at module load and throws without env vars. Any
// test rendering a component that calls useUnits() must stub this module.
vi.mock("@/contexts/units-context", () => ({
  useUnits: () => ({ preference: "metric", isLoading: false, error: null }),
}));

vi.mock("@/lib/swr-fetcher", () => ({ swrFetcher: vi.fn() }));

const URL_A = "/api/clients/client-1/training/session-logs/sl-a";
const URL_B = "/api/clients/client-1/training/session-logs/sl-b";

function sessionLog(id: string, name: string): SessionLog {
  return {
    id,
    clientId: "client-1",
    trainingSessionId: "ts-1",
    trainingEventId: null,
    completedAt: "2026-04-06T08:00:00Z",
    completionQuality: "full",
    notes: "Felt strong",
    weekStartDate: "2026-04-06",
    prescribedSessionSnapshot: { name },
    createdAt: "2026-04-06T08:00:00Z",
    updatedAt: "2026-04-06T08:00:00Z",
  };
}

// Fresh SWR cache per test, kept across a `rerender`.
function tree(cache: Cache, sessionLogId: string) {
  return (
    <SWRConfig value={{ provider: () => cache, dedupingInterval: 0 }}>
      <SessionLogDetailDialog
        clientId="client-1"
        sessionLogId={sessionLogId}
        open
        onOpenChange={vi.fn()}
      />
    </SWRConfig>
  );
}

describe("SessionLogDetailDialog through real SWR", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("never renders the previous session under a failed fetch for the next one", async () => {
    vi.mocked(swrFetcher).mockImplementation((url: string) => {
      if (url === URL_A) {
        return Promise.resolve({
          success: true,
          data: {
            sessionLog: sessionLog("sl-a", "Push Day"),
            exerciseLogs: [],
            prescribedGroups: [],
            performedSessionName: null,
          },
        });
      }
      return Promise.reject(new Error(url === URL_B ? "Network error" : `unexpected ${url}`));
    });
    const cache: Cache = new Map();

    const { rerender } = render(tree(cache, "sl-a"));
    expect(await screen.findByText("Push Day")).toBeInTheDocument();
    expect(screen.getByText("Felt strong")).toBeInTheDocument();

    rerender(tree(cache, "sl-b"));

    expect(await screen.findByText(/failed to load session details/i)).toBeInTheDocument();
    // Session A's title and body stay out of session B's card: the error
    // stands alone under the fallback title.
    expect(screen.queryByText("Push Day")).toBeNull();
    expect(screen.queryByText("Felt strong")).toBeNull();
    expect(screen.getByText("Training Session")).toBeInTheDocument();
  });
});
