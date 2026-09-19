import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { GroupTimer } from "./group-timer";

// The simple web timers: a countdown to an AMRAP's cap, an EMOM's interval cue,
// a For time's stopwatch. Time comes from the clock, which the fake timers own.

describe("GroupTimer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-19T10:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // Plain click events: userEvent's own delays fight the fake timers.
  const click = (name: string) => act(() => {
    fireEvent.click(screen.getByRole("button", { name }));
  });
  const readout = () => screen.getByTestId("group-timer-readout").textContent;
  const tick = (ms: number) => act(() => vi.advanceTimersByTime(ms));

  it("an AMRAP counts down from its cap and reads Time at zero", () => {
    render(<GroupTimer kind="countdown" seconds={90} />);
    expect(readout()).toBe("1:30");
    click("Start");
    tick(10_000);
    expect(readout()).toBe("1:20");
    click("Pause");
    tick(5_000);
    expect(readout()).toBe("1:20");
    click("Start");
    tick(80_000);
    expect(readout()).toBe("Time");
    // Done: it stopped itself, and only Reset is left.
    expect(screen.getByRole("button", { name: "Start" })).toBeDisabled();
    click("Reset");
    expect(readout()).toBe("1:30");
  });

  it("an EMOM cues each minute: the interval left, and which minute of how many", () => {
    render(<GroupTimer kind="intervals" intervalSeconds={60} rounds={3} />);
    const cue = () => screen.getByTestId("group-timer-cue").textContent;
    expect(cue()).toBe("Minute 1 of 3");
    expect(readout()).toBe("1:00");
    click("Start");
    tick(59_000);
    expect(cue()).toBe("Minute 1 of 3");
    expect(readout()).toBe("0:01");
    tick(1_000);
    // A new minute starts on its 0-second mark.
    expect(cue()).toBe("Minute 2 of 3");
    expect(readout()).toBe("1:00");
    tick(120_000);
    expect(cue()).toBe("Minute 3 of 3");
    expect(readout()).toBe("Done");
  });

  it("an interval that isn't a minute is called an interval", () => {
    render(<GroupTimer kind="intervals" intervalSeconds={90} rounds={4} />);
    expect(screen.getByTestId("group-timer-cue")).toHaveTextContent("Interval 1 of 4");
    expect(readout()).toBe("1:30");
  });

  it("a For time runs a stopwatch to a tenth, names its cap, and hands its time to the box", () => {
    const onUseTime = vi.fn();
    render(<GroupTimer kind="stopwatch" capSeconds={720} onUseTime={onUseTime} />);
    expect(readout()).toBe("0:00.0");
    expect(screen.getByTestId("group-timer-cue")).toHaveTextContent("12:00 cap");
    expect(screen.getByRole("button", { name: "Use this time" })).toBeDisabled();
    click("Start");
    tick(512_400);
    expect(readout()).toBe("8:32.4");
    // Running: the time can't be used yet.
    expect(screen.getByRole("button", { name: "Use this time" })).toBeDisabled();
    click("Stop");
    click("Use this time");
    expect(onUseTime).toHaveBeenCalledWith(512.4);
  });

  it("a For time keeps running past its cap and says so", () => {
    render(<GroupTimer kind="stopwatch" capSeconds={60} onUseTime={vi.fn()} />);
    click("Start");
    tick(75_000);
    expect(readout()).toBe("1:15.0");
    expect(screen.getByTestId("group-timer-cue")).toHaveTextContent("Past the 1:00 cap");
    expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument();
  });

  it("a For time with no cap has no cue", () => {
    render(<GroupTimer kind="stopwatch" capSeconds={null} onUseTime={vi.fn()} />);
    expect(screen.queryByTestId("group-timer-cue")).toBeNull();
  });
});
