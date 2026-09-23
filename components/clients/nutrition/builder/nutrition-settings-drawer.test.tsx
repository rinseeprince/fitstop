import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const builder = {
  hasPlan: true,
  isGenerating: false,
  nutritionData: null,
  discardSurplusEdits: vi.fn(),
};

vi.mock("@/contexts/nutrition-builder-context", () => ({
  useNutritionBuilderContext: () => builder,
}));
vi.mock("./drawer-header", () => ({ DrawerHeader: () => null }));
vi.mock("./drawer-form-body", () => ({ DrawerFormBody: () => <p>form</p> }));
vi.mock("./drawer-footer", () => ({ DrawerFooter: () => null }));

import { NutritionSettingsDrawer } from "./nutrition-settings-drawer";

beforeEach(() => {
  builder.hasPlan = true;
  builder.isGenerating = false;
  builder.discardSurplusEdits.mockClear();
});
afterEach(cleanup);

describe("NutritionSettingsDrawer", () => {
  it("drops an unsaved surplus flip when the drawer is closed without saving", () => {
    const onOpenChange = vi.fn();
    render(<NutritionSettingsDrawer open onOpenChange={onOpenChange} />);

    fireEvent.keyDown(screen.getByText("form"), { key: "Escape" });

    expect(builder.discardSurplusEdits).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("drops it too when a save closes the drawer, so the next open shows what was saved", () => {
    const onOpenChange = vi.fn();
    builder.isGenerating = true;
    const { rerender } = render(<NutritionSettingsDrawer open onOpenChange={onOpenChange} />);
    expect(builder.discardSurplusEdits).not.toHaveBeenCalled();

    builder.isGenerating = false;
    rerender(<NutritionSettingsDrawer open onOpenChange={onOpenChange} />);

    expect(builder.discardSurplusEdits).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
