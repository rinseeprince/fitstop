import { describe, it, expect } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { usePendingWrites } from "./use-pending-writes";

/** A write the test settles by hand. */
function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Whether `promise` has settled, after the microtasks queued so far have run. */
async function settled(promise: Promise<unknown>): Promise<boolean> {
  let done = false;
  void promise.then(
    () => (done = true),
    () => (done = true)
  );
  await act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  });
  return done;
}

describe("usePendingWrites — the writes Send waits for", () => {
  it("hands back the write it tracks, its outcome untouched", async () => {
    const { result } = renderHook(() => usePendingWrites());
    const write = Promise.resolve("saved");
    expect(result.current.track(write)).toBe(write);
    await expect(write).resolves.toBe("saved");
  });

  it("waits for every write on its way, from both steps, and for nothing once they have settled", async () => {
    const { result } = renderHook(() => usePendingWrites());
    const workout = deferred();
    const habit = deferred();
    void result.current.track(workout.promise);
    void result.current.track(habit.promise);

    const flush = result.current.flush();
    expect(await settled(flush)).toBe(false);
    habit.resolve();
    expect(await settled(flush)).toBe(false);
    workout.resolve();
    expect(await settled(flush)).toBe(true);

    // Nothing on its way: it settles at once.
    expect(await settled(result.current.flush())).toBe(true);
  });

  it("waits for a write made while it waits", async () => {
    const { result } = renderHook(() => usePendingWrites());
    const first = deferred();
    const second = deferred();
    void result.current.track(first.promise);

    const flush = result.current.flush();
    // A number box left as Send was pressed: its write joins the line.
    void result.current.track(second.promise);
    first.resolve();
    expect(await settled(flush)).toBe(false);
    second.resolve();
    expect(await settled(flush)).toBe(true);
  });

  it("never fails: a write that failed has said so on its own step, and must not stop the send", async () => {
    const { result } = renderHook(() => usePendingWrites());
    const failing = deferred();
    result.current.track(failing.promise).catch(() => {});

    const flush = result.current.flush();
    failing.reject(new Error("refused"));
    await expect(flush).resolves.toBeUndefined();
  });
});
