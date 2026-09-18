import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SetColumnsMenu } from "./set-columns-menu";
import { COLUMN_PRESET_FIELDS } from "@/utils/column-presets";
import type { PrescribedField } from "@/utils/prescribed-fields";

// The column selector: presets first, then every column grouped as Strength,
// Endurance and Framework; any column ticked or unticked; on a group's heading
// the presets alone.

const STRENGTH: PrescribedField[] = ["set_type", "reps", "load", "rpe", "rest"];

describe("SetColumnsMenu", () => {
  beforeEach(() => cleanup());

  it("lists the presets first, then the three groups holding every column", async () => {
    const user = userEvent.setup();
    render(<SetColumnsMenu fields={new Set(STRENGTH)} subject="Bench Press" onChange={vi.fn()} onPreset={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Columns for Bench Press" }));

    const items = screen.getAllByRole("menuitem").map((item) => item.textContent);
    expect(items).toEqual(["Strength", "Bodyweight", "Endurance", "Erg", "Carry & sled", "Holds", "Circuit"]);
    // A preset names its columns for the coach before they pick it.
    expect(screen.getByRole("menuitem", { name: "Endurance" })).toHaveAttribute(
      "title",
      "Set type · Distance · Duration · Pace · HR zone · Rest",
    );

    // The groups, each under its own label.
    expect(screen.getAllByRole("group").map((group) => group.firstElementChild?.textContent)).toEqual([
      "Presets",
      "Strength",
      "Endurance",
      "Framework",
    ]);
    const boxes = screen.getAllByRole("menuitemcheckbox").map((box) => box.textContent);
    expect(boxes).toEqual([
      "Load", "Reps", "RPE", "RIR", "Tempo",
      "Distance", "Duration", "Pace", "Split", "Calories", "Cadence", "Stroke rate", "Resistance", "HR zone", "Target HR", "Power", "% FTP",
      "Set type", "Rest",
    ]);
    // Presets come before the columns.
    const menu = screen.getByRole("menu");
    const all = [...menu.querySelectorAll('[role="menuitem"],[role="menuitemcheckbox"]')];
    expect(all.slice(0, 7).every((el) => el.getAttribute("role") === "menuitem")).toBe(true);
  });

  it("ticks and unticks any column, writing the list in the builder's order", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SetColumnsMenu fields={new Set(STRENGTH)} subject="Bench Press" onChange={onChange} onPreset={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Columns for Bench Press" }));

    await user.click(screen.getByRole("menuitemcheckbox", { name: "Distance" }));
    expect(onChange).toHaveBeenLastCalledWith(["set_type", "reps", "load", "rpe", "distance", "rest"]);
    await user.click(screen.getByRole("menuitemcheckbox", { name: "RPE" }));
    expect(onChange).toHaveBeenLastCalledWith(["set_type", "reps", "load", "rest"]);
    // The menu stays open across ticks.
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("refuses to untick the last remaining column", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SetColumnsMenu fields={new Set<PrescribedField>(["pace"])} subject="Run" onChange={onChange} onPreset={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Columns for Run" }));
    const pace = screen.getByRole("menuitemcheckbox", { name: "Pace" });
    expect(pace).toHaveAttribute("aria-disabled", "true");
    await user.click(pace);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("a preset is handed back by name; the menu stays open for adjustments", async () => {
    const user = userEvent.setup();
    const onPreset = vi.fn();
    render(<SetColumnsMenu fields={new Set(STRENGTH)} subject="Run" onChange={vi.fn()} onPreset={onPreset} />);
    await user.click(screen.getByRole("button", { name: "Columns for Run" }));
    await user.click(screen.getByRole("menuitem", { name: "Erg" }));
    expect(onPreset).toHaveBeenCalledWith("erg");
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("doesn't offer a hidden column — Rest where the rows are a superset's rounds", async () => {
    const user = userEvent.setup();
    render(
      <SetColumnsMenu fields={new Set(STRENGTH)} hiddenFields={["rest"]} subject="Bench Press" onChange={vi.fn()} onPreset={vi.fn()} />,
    );
    await user.click(screen.getByRole("button", { name: "Columns for Bench Press" }));
    expect(screen.queryByRole("menuitemcheckbox", { name: "Rest" })).toBeNull();
    expect(screen.getByRole("menuitemcheckbox", { name: "Set type" })).toBeInTheDocument();
  });

  it("on a group offers the presets alone, for every exercise in it", async () => {
    const user = userEvent.setup();
    const onPreset = vi.fn();
    render(<SetColumnsMenu subject="the superset" onPreset={onPreset} />);
    await user.click(screen.getByRole("button", { name: "Columns for the superset" }));
    expect(screen.getByText("A preset sets every exercise in the superset")).toBeInTheDocument();
    expect(screen.getAllByRole("menuitem")).toHaveLength(Object.keys(COLUMN_PRESET_FIELDS).length);
    expect(screen.queryAllByRole("menuitemcheckbox")).toHaveLength(0);
    await user.click(screen.getByRole("menuitem", { name: "Circuit" }));
    expect(onPreset).toHaveBeenCalledWith("circuit");
  });
});
