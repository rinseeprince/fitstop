import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { BlockStartPicker } from "./block-start-picker";
import {
  buildBlockStartOptions,
  NO_BLOCK_OPTION,
} from "@/lib/blocks/block-start-options";

// Radix Select positions its list through a popper (ResizeObserver) and scrolls
// the selected item into view on open; jsdom has neither.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);
Element.prototype.scrollIntoView = () => {};
Element.prototype.hasPointerCapture = () => false;
Element.prototype.releasePointerCapture = () => {};

const FLOOR = "2026-03-10";
const CUT = { id: "b-cut", name: "Cut", startsOn: "2026-03-02", endsOn: "2026-03-29" };
const BUILD = { id: "b-build", name: "Build", startsOn: "2026-03-30", endsOn: "2026-04-26" };
const OPTIONS = buildBlockStartOptions([CUT, BUILD], FLOOR);

function renderPicker(value: string) {
  const onValueChange = vi.fn();
  render(
    <>
      <label htmlFor="start-block">Block</label>
      <BlockStartPicker
        id="start-block"
        options={OPTIONS}
        value={value}
        onValueChange={onValueChange}
      />
    </>
  );
  return { onValueChange };
}

// Keyboard drive: ArrowDown on the trigger opens the list (Radix's OPEN_KEYS),
// Enter on an item selects it (SELECTION_KEYS). Pointer opening depends on a
// PointerEvent with a mouse pointerType, which jsdom does not model.
async function openList() {
  fireEvent.keyDown(screen.getByLabelText("Block"), { key: "ArrowDown" });
  return screen.findAllByRole("option");
}

describe("BlockStartPicker", () => {
  beforeEach(cleanup);

  it("shows the selected option's label on the trigger", () => {
    renderPicker(BUILD.id);
    expect(screen.getByLabelText("Block")).toHaveTextContent("Build · 30 Mar – 26 Apr");
  });

  it("shows the dash when no block is chosen — the empty state", () => {
    renderPicker(NO_BLOCK_OPTION);
    expect(screen.getByLabelText("Block")).toHaveTextContent("—");
  });

  it("lists every option in order, the dash first and then the blocks", async () => {
    renderPicker(NO_BLOCK_OPTION);
    const items = await openList();
    expect(items.map((item) => item.textContent)).toEqual([
      "—",
      "Cut · 2 Mar – 29 Mar",
      "Build · 30 Mar – 26 Apr",
    ]);
  });

  it("a pick hands the block's id up to the host, which owns the value", async () => {
    const { onValueChange } = renderPicker(NO_BLOCK_OPTION);
    await openList();
    fireEvent.keyDown(screen.getByRole("option", { name: "Build · 30 Mar – 26 Apr" }), {
      key: "Enter",
    });
    expect(onValueChange).toHaveBeenCalledWith(BUILD.id);
  });

  it("picking the dash hands its value up", async () => {
    const { onValueChange } = renderPicker(BUILD.id);
    await openList();
    fireEvent.keyDown(screen.getByRole("option", { name: "—" }), { key: "Enter" });
    expect(onValueChange).toHaveBeenCalledWith(NO_BLOCK_OPTION);
  });
});
