"use client";

import { useCallback, useRef } from "react";

/**
 * The writes a page has on their way, which its submit waits for. The client's
 * check-in wizard is the user: its Training step logs a workout the client
 * missed and its Habits step makes a habit entry, each saved on its own as the
 * client goes, and the server derives the week's figures and freezes the
 * check-in's copy from those logs when the check-in is sent — so Send waits
 * for every one of them first.
 *
 * `track` registers a write and hands it back; it leaves the set when it
 * settles, either way. `flush` resolves once every write registered — and any
 * registered while it waits — has settled. It never rejects: a write that
 * failed has said so on its own step, and must not stop the send.
 */
export function usePendingWrites() {
  const pending = useRef(new Set<Promise<unknown>>());

  const track = useCallback(<T,>(write: Promise<T>): Promise<T> => {
    const writes = pending.current;
    writes.add(write);
    const settled = () => {
      writes.delete(write);
    };
    write.then(settled, settled);
    return write;
  }, []);

  const flush = useCallback(async (): Promise<void> => {
    while (pending.current.size > 0) {
      await Promise.allSettled(Array.from(pending.current));
    }
  }, []);

  return { track, flush };
}
