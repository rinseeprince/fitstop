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

  const PRESETS = ["Strength", "Bodyweight", "Endurance", "Erg", "Carry & sled", "Holds", "Circuit"];

  it("lists the presets first, then the three groups holding every column", async () => {
    const user = userEvent.setup();
    render(
      <SetColumnsMenu fields={new Set(STRENGTH)} activePreset="strength" subject="Bench Press" onChange={vi.fn()} onPreset={vi.fn()} />,
    );
    await user.click(screen.getByRole("button", { name: "Columns for Bench Press" }));

    const items = screen.getAllByRole("menuitemcheckbox").map((item) => item.textContent);
    expect(items.slice(0, 7)).toEqual(PRESETS);
    // A preset names its columns for the coach before they pick it.
    expect(screen.getByRole("menuitemcheckbox", { name: "Endurance" })).toHaveAttribute(
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
    expect(items.slice(7)).toEqual([
      "Load", "Reps", "RPE", "RIR", "Tempo",
      "Distance", "Duration", "Pace", "Split", "Calories", "Cadence", "Stroke rate", "Resistance", "HR zone", "Target HR", "Power", "% FTP",
      "Set type", "Rest",
    ]);
  });

  it("ticks the preset the columns are on, and none when they match no preset", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <SetColumnsMenu fields={new Set(STRENGTH)} activePreset="strength" subject="Bench Press" onChange={vi.fn()} onPreset={vi.fn()} />,
    );
    await user.click(screen.getByRole("button", { name: "Columns for Bench Press" }));
    const checked = () =>
      PRESETS.filter((name) => screen.getByRole("menuitemcheckbox", { name }).getAttribute("aria-checked") === "true");
    expect(checked()).toEqual(["Strength"]);

    // The tick follows the columns: a change made elsewhere moves it.
    rerender(
      <SetColumnsMenu fields={new Set<PrescribedField>(["reps", "load"])} activePreset="circuit" subject="Bench Press" onChange={vi.fn()} onPreset={vi.fn()} />,
    );
    expect(checked()).toEqual(["Circuit"]);
    rerender(
      <SetColumnsMenu fields={new Set<PrescribedField>(["reps"])} activePreset={null} subject="Bench Press" onChange={vi.fn()} onPreset={vi.fn()} />,
    );
    expect(checked()).toEqual([]);
  });

  it("ticks and unticks any column, writing the list in the builder's order", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <SetColumnsMenu fields={new Set(STRENGTH)} activePreset="strength" subject="Bench Press" onChange={onChange} onPreset={vi.fn()} />,
    );
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
    render(
      <SetColumnsMenu fields={new Set<PrescribedField>(["pace"])} activePreset={null} subject="Run" onChange={onChange} onPreset={vi.fn()} />,
    );
    await user.click(screen.getByRole("button", { name: "Columns for Run" }));
    const pace = screen.getByRole("menuitemcheckbox", { name: "Pace" });
    expect(pace).toHaveAttribute("aria-disabled", "true");
    await user.click(pace);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("a preset is handed back by name; the menu stays open for adjustments", async () => {
    const user = userEvent.setup();
    const onPreset = vi.fn();
    render(
      <SetColumnsMenu fields={new Set(STRENGTH)} activePreset="strength" subject="Run" onChange={vi.fn()} onPreset={onPreset} />,
    );
    await user.click(screen.getByRole("button", { name: "Columns for Run" }));
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Erg" }));
    expect(onPreset).toHaveBeenCalledWith("erg");
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("doesn't offer a hidden column — Rest where the rows are a superset's rounds", async () => {
    const user = userEvent.setup();
    render(
      <SetColumnsMenu fields={new Set(STRENGTH)} hiddenFields={["rest"]} activePreset="strength" subject="Bench Press" onChange={vi.fn()} onPreset={vi.fn()} />,
    );
    await user.click(screen.getByRole("button", { name: "Columns for Bench Press" }));
    expect(screen.queryByRole("menuitemcheckbox", { name: "Rest" })).toBeNull();
    expect(screen.getByRole("menuitemcheckbox", { name: "Set type" })).toBeInTheDocument();
  });

  it("on a group offers the presets alone, for every exercise in it, ticking the one they are all on", async () => {
    const user = userEvent.setup();
    const onPreset = vi.fn();
    render(<SetColumnsMenu activePreset="circuit" subject="the superset" onPreset={onPreset} />);
    await user.click(screen.getByRole("button", { name: "Columns for the superset" }));
    expect(screen.getByText("A preset sets every exercise in the superset")).toBeInTheDocument();
    const items = screen.getAllByRole("menuitemcheckbox");
    expect(items).toHaveLength(Object.keys(COLUMN_PRESET_FIELDS).length);
    expect(items.map((item) => item.textContent)).toEqual(PRESETS);
    expect(screen.getByRole("menuitemcheckbox", { name: "Circuit" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("menuitemcheckbox", { name: "Erg" })).toHaveAttribute("aria-checked", "false");
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Erg" }));
    expect(onPreset).toHaveBeenCalledWith("erg");
  });
});
