import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useDialogSubject } from "./use-dialog-subject";

// The subject outlives the close: Radix re-renders a closing card from live
// state, so the card must still have its subject while it fades out.
describe("useDialogSubject", () => {
  it("starts closed with no subject", () => {
    const { result } = renderHook(() => useDialogSubject<{ id: string }>());
    expect(result.current.open).toBe(false);
    expect(result.current.subject).toBe(null);
  });

  it("show sets the subject and opens in one update", () => {
    const { result } = renderHook(() => useDialogSubject<{ id: string }>());
    act(() => result.current.show({ id: "a" }));
    expect(result.current.open).toBe(true);
    expect(result.current.subject).toEqual({ id: "a" });
  });

  it("openKey changes on every show, the same subject included, and never on a close", () => {
    const { result } = renderHook(() => useDialogSubject<{ id: string }>());
    const subject = { id: "a" };
    act(() => result.current.show(subject));
    const first = result.current.openKey;
    act(() => result.current.close());
    expect(result.current.openKey).toBe(first);
    act(() => result.current.show(subject));
    expect(result.current.openKey).not.toBe(first);
  });

  it("close leaves the subject alone, and the next show replaces it", () => {
    const { result } = renderHook(() => useDialogSubject<{ id: string }>());
    act(() => result.current.show({ id: "a" }));
    act(() => result.current.close());
    expect(result.current.open).toBe(false);
    expect(result.current.subject).toEqual({ id: "a" });

    act(() => result.current.show({ id: "b" }));
    expect(result.current.open).toBe(true);
    expect(result.current.subject).toEqual({ id: "b" });
  });
});
