import { describe, it, expect, vi, beforeEach } from "vitest";

const fromMock = vi.fn();
vi.mock("./supabase-admin", () => ({
  supabaseAdmin: { from: (...a: unknown[]) => fromMock(...a) },
}));

import {
  deleteClientNote,
  listClientNotes,
  setClientNotePinned,
} from "./client-notes-service";

const NOTE_ROW = {
  id: "note-1",
  body: "Knee niggle — keep squats above parallel",
  is_pinned: true,
  created_at: "2026-07-01T10:00:00Z",
};

// Chainable builder: awaitable (→ {data,error}) and .single/.maybeSingle.
function makeChain(response: { data?: unknown; error?: unknown }) {
  const chain: Record<string, unknown> = {};
  for (const m of ["update", "insert", "delete", "select", "eq", "neq", "order"]) {
    chain[m] = vi.fn(() => chain);
  }
  chain.single = vi.fn(() =>
    Promise.resolve({ data: response.data ?? null, error: response.error ?? null })
  );
  chain.maybeSingle = vi.fn(() =>
    Promise.resolve({ data: response.data ?? null, error: response.error ?? null })
  );
  chain.then = (resolve: (v: unknown) => unknown) =>
    resolve({ data: response.data ?? null, error: response.error ?? null });
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("setClientNotePinned", () => {
  it("verifies the note, then unpins others scoped to the client, then pins the target", async () => {
    const readChain = makeChain({ data: { id: "note-1" } });
    const unpinChain = makeChain({});
    const pinChain = makeChain({ data: NOTE_ROW });
    fromMock
      .mockReturnValueOnce(readChain)
      .mockReturnValueOnce(unpinChain)
      .mockReturnValueOnce(pinChain);

    const note = await setClientNotePinned("client-1", "note-1", true);

    expect(fromMock).toHaveBeenCalledTimes(3);
    expect(readChain.eq).toHaveBeenCalledWith("id", "note-1");
    expect(readChain.eq).toHaveBeenCalledWith("client_id", "client-1");

    expect(unpinChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ is_pinned: false })
    );
    expect(unpinChain.eq).toHaveBeenCalledWith("client_id", "client-1");
    expect(unpinChain.eq).toHaveBeenCalledWith("is_pinned", true);
    expect(unpinChain.neq).toHaveBeenCalledWith("id", "note-1");

    expect(pinChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ is_pinned: true })
    );
    expect(pinChain.eq).toHaveBeenCalledWith("id", "note-1");
    expect(pinChain.eq).toHaveBeenCalledWith("client_id", "client-1");

    expect(note).toEqual({
      id: "note-1",
      body: NOTE_ROW.body,
      isPinned: true,
      createdAt: "2026-07-01T10:00:00Z",
    });
  });

  it("unpinning touches only the target note (no sweep)", async () => {
    const readChain = makeChain({ data: { id: "note-1" } });
    const updateChain = makeChain({ data: { ...NOTE_ROW, is_pinned: false } });
    fromMock.mockReturnValueOnce(readChain).mockReturnValueOnce(updateChain);

    const note = await setClientNotePinned("client-1", "note-1", false);

    expect(fromMock).toHaveBeenCalledTimes(2);
    expect(updateChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ is_pinned: false })
    );
    expect(updateChain.neq).not.toHaveBeenCalled();
    expect(note?.isPinned).toBe(false);
  });

  it("returns null when the note doesn't belong to the client", async () => {
    fromMock.mockReturnValueOnce(makeChain({ data: null }));

    const note = await setClientNotePinned("client-1", "someone-elses-note", false);

    expect(note).toBeNull();
  });

  it("a failed pin writes NOTHING — it must not clear the existing pin", async () => {
    // Regression: sweeping before verifying left the client with no pinned note
    // after a request that answered 404.
    fromMock.mockReturnValueOnce(makeChain({ data: null }));

    const note = await setClientNotePinned("client-1", "stale-note", true);

    expect(note).toBeNull();
    expect(fromMock).toHaveBeenCalledTimes(1);
  });
});

describe("listClientNotes", () => {
  it("orders pinned first then newest-first and maps to the contract shape", async () => {
    const chain = makeChain({ data: [NOTE_ROW] });
    fromMock.mockReturnValueOnce(chain);

    const notes = await listClientNotes("client-1");

    expect(chain.eq).toHaveBeenCalledWith("client_id", "client-1");
    expect(chain.order).toHaveBeenNthCalledWith(1, "is_pinned", { ascending: false });
    expect(chain.order).toHaveBeenNthCalledWith(2, "created_at", { ascending: false });
    expect(notes).toEqual([
      { id: "note-1", body: NOTE_ROW.body, isPinned: true, createdAt: "2026-07-01T10:00:00Z" },
    ]);
  });
});

describe("deleteClientNote", () => {
  it("deletes only within the client's scope and reports success", async () => {
    const chain = makeChain({ data: { id: "note-1" } });
    fromMock.mockReturnValueOnce(chain);

    const deleted = await deleteClientNote("client-1", "note-1");

    expect(deleted).toBe(true);
    expect(fromMock).toHaveBeenCalledWith("client_notes");
    // The client_id filter is the whole safety story for a hard delete —
    // without it a guessed note id would delete another coach's note.
    expect(chain.eq).toHaveBeenCalledWith("id", "note-1");
    expect(chain.eq).toHaveBeenCalledWith("client_id", "client-1");
  });

  it("reports false when the note does not belong to the client (route 404s)", async () => {
    fromMock.mockReturnValueOnce(makeChain({ data: null }));

    await expect(deleteClientNote("client-1", "someone-elses-note")).resolves.toBe(false);
  });

  it("throws on a database error rather than reporting a silent success", async () => {
    fromMock.mockReturnValueOnce(makeChain({ error: { message: "boom" } }));

    await expect(deleteClientNote("client-1", "note-1")).rejects.toThrow(/boom/);
  });
});
