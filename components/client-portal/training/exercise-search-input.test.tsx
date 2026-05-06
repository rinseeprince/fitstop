import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import {
  ExerciseSearchInput,
  type ExerciseSearchSelection,
} from "./exercise-search-input";

function Harness({
  initial = "",
  onSelect,
}: {
  initial?: string;
  onSelect?: (s: ExerciseSearchSelection) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <ExerciseSearchInput
      value={value}
      onChange={(next) => {
        setValue(next.name);
        onSelect?.(next);
      }}
      testId="picker"
    />
  );
}

describe("ExerciseSearchInput", () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          exercises: [
            { id: "uuid-bench", name: "Bench Press", muscle_group: "chest" },
            { id: "uuid-bb-row", name: "Barbell Row", muscle_group: "back" },
          ],
        }),
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not fetch when query is shorter than 2 chars", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(screen.getByTestId("picker"), "b");
    // Wait past debounce.
    await new Promise((r) => setTimeout(r, 350));
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("fetches once after debounce when query reaches 2 chars", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(screen.getByTestId("picker"), "be");
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    const url = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(url).toContain("/api/client/exercises?search=be");
  });

  it("renders results in the dropdown and fills name + exerciseId on select", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<Harness onSelect={onSelect} />);
    await user.type(screen.getByTestId("picker"), "bench");
    await waitFor(() =>
      expect(screen.getByText("Bench Press")).toBeInTheDocument(),
    );
    await user.click(screen.getByTestId("picker-option-uuid-bench"));
    expect(onSelect).toHaveBeenLastCalledWith({
      name: "Bench Press",
      exerciseId: "uuid-bench",
    });
  });

  it("free-typing emits exerciseId: undefined", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<Harness onSelect={onSelect} />);
    await user.type(screen.getByTestId("picker"), "made up");
    // Last onChange call has the freehand value with no exerciseId.
    const last = onSelect.mock.calls[onSelect.mock.calls.length - 1][0];
    expect(last.exerciseId).toBeUndefined();
    expect(last.name).toBe("made up");
  });
});
