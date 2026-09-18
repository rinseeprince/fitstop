import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { MeasureRangeInput } from "./measure-range-input";
import { METERS_PER_MILE } from "@/utils/unit-conversions";

// One box per measure, in the grammar the measure speaks everywhere: a plain
// number as a value or a range, a distance, duration, pace, split or zone in
// the entry grammar at each end, typed and read in the VIEWER's units and
// stored canonically.

const units = vi.hoisted(() => ({ preference: "metric" as "metric" | "imperial" }));
vi.mock("@/contexts/units-context", () => ({
  useUnits: () => ({ preference: units.preference, isLoading: false, error: null }),
}));

const blur = (input: HTMLElement, value: string) => {
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
};

describe("MeasureRangeInput", () => {
  beforeEach(() => {
    cleanup();
    units.preference = "metric";
  });

  it("a plain-number measure takes a value or a range, clamped to its bounds", () => {
    const onCommit = vi.fn();
    render(<MeasureRangeInput measure="rir" min={null} max={null} setNumber={1} onCommit={onCommit} />);
    const box = screen.getByLabelText("Set 1 RIR");
    expect(box).toHaveAttribute("placeholder", "RIR");
    blur(box, "1-2");
    expect(onCommit).toHaveBeenLastCalledWith({ min: 1, max: 2 });
    expect(box).toHaveValue("1-2");
    blur(box, "12");
    expect(onCommit).toHaveBeenLastCalledWith({ min: 10, max: 10 });
  });

  it("a distance is typed and read in kilometres or with its unit, and stored in metres", () => {
    const onCommit = vi.fn();
    render(<MeasureRangeInput measure="distance" min={5000} max={5000} setNumber={2} onCommit={onCommit} />);
    const box = screen.getByLabelText("Set 2 distance");
    expect(box).toHaveValue("5 km");
    expect(box).toHaveAttribute("placeholder", "km");
    blur(box, "400-800 m");
    expect(onCommit).toHaveBeenLastCalledWith({ min: 400, max: 800 });
    expect(box).toHaveValue("400-800 m");
  });

  it("an imperial coach types miles and minutes per mile; storage stays canonical", () => {
    units.preference = "imperial";
    const onCommit = vi.fn();
    render(
      <>
        <MeasureRangeInput measure="distance" min={5000} max={5000} setNumber={1} onCommit={onCommit} />
        <MeasureRangeInput measure="pace" min={285} max={285} setNumber={1} onCommit={onCommit} />
      </>,
    );
    const distance = screen.getByLabelText("Set 1 distance");
    expect(distance).toHaveValue("3.11 mi");
    expect(distance).toHaveAttribute("placeholder", "mi");
    blur(distance, "5");
    expect(onCommit).toHaveBeenLastCalledWith({
      min: Math.round(5 * METERS_PER_MILE * 100) / 100,
      max: Math.round(5 * METERS_PER_MILE * 100) / 100,
    });
    expect(distance).toHaveValue("5 mi");

    const pace = screen.getByLabelText("Set 1 pace");
    expect(pace).toHaveValue("7:39 /mi");
    expect(pace).toHaveAttribute("placeholder", "/mi");
    blur(pace, "8:00");
    const perKm = Math.round((480 * 1000) / METERS_PER_MILE);
    expect(onCommit).toHaveBeenLastCalledWith({ min: perKm, max: perKm });
    expect(pace).toHaveValue("8:00 /mi");
  });

  it("a duration, a split and a zone speak their own grammars", () => {
    const onCommit = vi.fn();
    render(
      <>
        <MeasureRangeInput measure="duration" min={null} max={null} setNumber={1} onCommit={onCommit} />
        <MeasureRangeInput measure="split" min={null} max={null} setNumber={1} onCommit={onCommit} />
        <MeasureRangeInput measure="heart_rate_zone" min={null} max={null} setNumber={1} onCommit={onCommit} />
      </>,
    );
    const duration = screen.getByLabelText("Set 1 duration");
    blur(duration, "120");
    expect(onCommit).toHaveBeenLastCalledWith({ min: 7200, max: 7200 });
    expect(duration).toHaveValue("2:00:00");

    const split = screen.getByLabelText("Set 1 split");
    blur(split, "1:52.3");
    expect(onCommit).toHaveBeenLastCalledWith({ min: 112.3, max: 112.3 });
    expect(split).toHaveValue("1:52.3 /500m");

    const zone = screen.getByLabelText("Set 1 HR zone");
    blur(zone, "2-3");
    expect(onCommit).toHaveBeenLastCalledWith({ min: 2, max: 3 });
    expect(zone).toHaveValue("Z2-Z3");
  });

  it("a focus-through writes nothing, and a typo reverts to what was there", () => {
    const onCommit = vi.fn();
    render(<MeasureRangeInput measure="distance" min={5000} max={6000} setNumber={1} onCommit={onCommit} />);
    const box = screen.getByLabelText("Set 1 distance");
    expect(box).toHaveValue("5-6 km");
    fireEvent.blur(box);
    expect(onCommit).not.toHaveBeenCalled();
    blur(box, "far");
    expect(onCommit).not.toHaveBeenCalled();
    expect(box).toHaveValue("5-6 km");
  });
});
