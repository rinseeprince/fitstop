import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { BlockForm } from "./block-form";
import type { ClientBlockView } from "@/lib/blocks/block-derivations";

// A block's start is fixed once it is drawn: the form picks it on an add and
// shows it greyed on every drawn block that has not ended. To start a block on
// a different day, the coach deletes it and draws it again.

const TODAY = "2026-09-15";

const block = (
  state: ClientBlockView["state"],
  overrides: Partial<ClientBlockView> = {},
): ClientBlockView => ({
  id: `blk-${state}`,
  name: "Build",
  focus: "Add size on the new base.",
  startsOn: "2026-10-06",
  endsOn: "2026-11-02",
  archivedAt: null,
  weeks: 4,
  state,
  weekOfTotal: null,
  ...overrides,
});

function renderEdit(view: ClientBlockView) {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  render(
    <BlockForm
      mode={{
        kind: "edit",
        block: view,
        minEnd: view.state === "current" ? TODAY : null,
      }}
      minStart={TODAY}
      onSubmit={onSubmit}
      onCancel={vi.fn()}
    />,
  );
  return onSubmit;
}

afterEach(() => cleanup());

describe("BlockForm — the start", () => {
  it("lets the coach pick the start when drawing a block", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <BlockForm
        mode={{ kind: "add", appendAfterEndsOn: "2026-10-04" }}
        minStart={TODAY}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );

    const starts = screen.getByLabelText("Starts");
    expect(starts).toBeEnabled();
    // The day after the block before it, as ever.
    expect(starts).toHaveValue("2026-10-05");
    fireEvent.change(starts, { target: { value: "2026-10-12" } });
    fireEvent.change(screen.getByLabelText("Ends"), { target: { value: "2026-11-08" } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Peak" } });
    fireEvent.click(screen.getByRole("button", { name: "Add block" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith({
      name: "Peak",
      startsOn: "2026-10-12",
      endsOn: "2026-11-08",
      focus: null,
    });
  });

  it("greys a future block's start and saves the rest without it", async () => {
    const onSubmit = renderEdit(block("future"));

    const starts = screen.getByLabelText("Starts");
    expect(starts).toBeDisabled();
    expect(starts).toHaveValue("2026-10-06");
    // Name, end and focus stay the coach's.
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Build 2" } });
    fireEvent.change(screen.getByLabelText("Ends"), { target: { value: "2026-10-26" } });
    fireEvent.change(screen.getByLabelText("Focus (optional)"), {
      target: { value: "Shorter build." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save block" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith({
      name: "Build 2",
      endsOn: "2026-10-26",
      focus: "Shorter build.",
    });
    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty("startsOn");
  });

  it("greys the running block's start too", () => {
    renderEdit(block("current", { name: "Cut", startsOn: "2026-09-08", endsOn: "2026-10-02" }));

    const starts = screen.getByLabelText("Starts");
    expect(starts).toBeDisabled();
    expect(starts).toHaveValue("2026-09-08");
    expect(screen.getByLabelText("Ends")).toBeEnabled();
    expect(screen.getByLabelText("Name")).toBeEnabled();
  });

  it("keeps an ended block's dates as text, with no date fields", () => {
    renderEdit(block("past", { startsOn: "2026-07-06", endsOn: "2026-08-02" }));

    expect(screen.queryByLabelText("Starts")).toBeNull();
    expect(screen.queryByLabelText("Ends")).toBeNull();
    expect(screen.getByText("Dates")).toBeInTheDocument();
  });
});
