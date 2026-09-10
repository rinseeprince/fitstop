import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MacroBalance } from "./macro-balance";
import {
  gramsToCalories,
  splitToGrams,
  type MacroBalanceValue,
  type MacroSplit,
} from "@/lib/nutrition/macro-balance";

// jsdom doesn't implement APIs the Radix Slider needs to render/interact.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver =
  ResizeObserverStub;
if (!(globalThis as { PointerEvent?: unknown }).PointerEvent) {
  (globalThis as unknown as { PointerEvent: typeof MouseEvent }).PointerEvent =
    MouseEvent as unknown as typeof PointerEvent;
}
// Radix slides only while the pointer is captured; jsdom has no capture, so
// say it always is — the drag test below depends on it.
Element.prototype.hasPointerCapture = () => true;
Element.prototype.setPointerCapture = () => {};
Element.prototype.releasePointerCapture = () => {};
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

const START: MacroSplit = { carbs: 45, fat: 25, protein: 30 };

/** The balancer is controlled; this is the parent both mounts are. */
function Harness({
  initial,
  onChange,
}: {
  initial: MacroBalanceValue;
  onChange?: (next: MacroBalanceValue) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <MacroBalance
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
    />
  );
}

const gramsInput = (label: string) => screen.getByLabelText<HTMLInputElement>(label);
const caloriesInput = () => screen.getByLabelText<HTMLInputElement>("Calories");
const thumb = (name: string) => screen.getByRole("slider", { name });
const percents = () =>
  ["Carbs", "Fat", "Protein"].map(
    (label) => screen.getByLabelText(label).closest("div")!.parentElement!.querySelector("p")!.textContent
  );

/** The sum of the grams the current value derives, in kcal. */
const derivedKcal = (v: MacroBalanceValue) => gramsToCalories(splitToGrams(v.calories ?? 0, v.split));

beforeEach(() => cleanup());
afterEach(() => vi.restoreAllMocks());

describe("MacroBalance — what it shows", () => {
  it("renders the split's percents, the grams the calories derive, and the preset the split matches", () => {
    render(<Harness initial={{ calories: 2400, split: START }} />);

    expect(caloriesInput().value).toBe("2400");
    // 2,400 at 45 / 25 / 30: protein 180 g; fat 600 kcal = 66.7 → 67 g; carbs
    // take the remainder, 1,077 kcal → 269 g.
    expect(gramsInput("Protein").value).toBe("180");
    expect(gramsInput("Fat").value).toBe("67");
    expect(gramsInput("Carbs").value).toBe("269");
    expect(percents()).toEqual(["45%", "25%", "30%"]);
    // 45 / 25 is no diet type's ratio at 30% protein.
    expect(screen.getByRole("button", { name: /Custom/ })).toBeInTheDocument();
    // Two thumbs, named as the boundaries they are, at carbs and carbs + fat.
    expect(thumb("Carbs and fat boundary")).toHaveAttribute("aria-valuenow", "45");
    expect(thumb("Fat and protein boundary")).toHaveAttribute("aria-valuenow", "70");
  });

  it("names a matching preset: balanced at 30% protein reads Balanced", () => {
    render(<Harness initial={{ calories: 2000, split: { carbs: 35, fat: 35, protein: 30 } }} />);
    expect(screen.getByRole("button", { name: /Balanced/ })).toBeInTheDocument();
  });

  it("an empty calorie field disables the gram inputs and shows no grams", () => {
    render(<Harness initial={{ calories: null, split: START }} />);
    expect(caloriesInput().value).toBe("");
    for (const label of ["Carbs", "Fat", "Protein"]) {
      expect(gramsInput(label)).toBeDisabled();
      expect(gramsInput(label).value).toBe("");
    }
    // The split is still there to read and to move.
    expect(percents()).toEqual(["45%", "25%", "30%"]);
  });
});

describe("MacroBalance — the calories are held whatever the thumbs do", () => {
  it("a keyboard step on the carbs | fat thumb moves one percent; the grams follow and the sum holds", () => {
    const onChange = vi.fn();
    render(<Harness initial={{ calories: 2400, split: START }} onChange={onChange} />);

    const carbsFat = thumb("Carbs and fat boundary");
    carbsFat.focus();
    fireEvent.keyDown(carbsFat, { key: "ArrowRight" });

    expect(percents()).toEqual(["46%", "24%", "30%"]);
    expect(carbsFat).toHaveAttribute("aria-valuenow", "46");
    expect(caloriesInput().value).toBe("2400");
    const last = onChange.mock.calls.at(-1)?.[0] as MacroBalanceValue;
    expect(last.split).toEqual({ carbs: 46, fat: 24, protein: 30 });
    expect(Math.abs(derivedKcal(last) - 2400)).toBeLessThanOrEqual(2);
    expect(gramsInput("Carbs").value).toBe(String(splitToGrams(2400, last.split).carbG));
  });

  it("a pointer drag moves the nearest thumb and the other boundary stays put", () => {
    // Radix maps the pointer onto the track through the slider's rect; jsdom
    // has no layout, so the track is 100px wide at x = 0 — one px per percent.
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 100,
      bottom: 6,
      width: 100,
      height: 6,
      toJSON: () => ({}),
    } as DOMRect);
    const onChange = vi.fn();
    const { container } = render(
      <Harness initial={{ calories: 2400, split: START }} onChange={onChange} />
    );
    const root = container.querySelector('[data-slot="slider"]')!;

    // Press at 40%: the carbs | fat thumb (at 45) is nearer than the other (70).
    fireEvent.pointerDown(root, { clientX: 40, button: 0 });
    fireEvent.pointerMove(root, { clientX: 35 });
    fireEvent.pointerUp(root, { clientX: 35 });

    expect(percents()).toEqual(["35%", "35%", "30%"]);
    expect(thumb("Fat and protein boundary")).toHaveAttribute("aria-valuenow", "70");
    expect(caloriesInput().value).toBe("2400");
    const last = onChange.mock.calls.at(-1)?.[0] as MacroBalanceValue;
    expect(Math.abs(derivedKcal(last) - 2400)).toBeLessThanOrEqual(2);
  });

  it("typing protein grams moves the thumbs and rebalances carbs and fat in their ratio", () => {
    const onChange = vi.fn();
    render(<Harness initial={{ calories: 2400, split: START }} onChange={onChange} />);

    // 240 g = 960 kcal = 40%. The other 60 keeps carbs:fat at 45:25 → 39 / 21.
    fireEvent.change(gramsInput("Protein"), { target: { value: "240" } });

    expect(percents()).toEqual(["39%", "21%", "40%"]);
    expect(thumb("Carbs and fat boundary")).toHaveAttribute("aria-valuenow", "39");
    expect(thumb("Fat and protein boundary")).toHaveAttribute("aria-valuenow", "60");
    expect(caloriesInput().value).toBe("2400");
    const last = onChange.mock.calls.at(-1)?.[0] as MacroBalanceValue;
    expect(Math.abs(derivedKcal(last) - 2400)).toBeLessThanOrEqual(2);

    // On blur the field reads the grams the split derives — here the typed
    // figure exactly, since 40% of 2,400 is 240 g.
    fireEvent.blur(gramsInput("Protein"));
    expect(gramsInput("Protein").value).toBe("240");
  });

  it("typing calories re-derives the grams and keeps the split", () => {
    render(<Harness initial={{ calories: 2400, split: START }} />);

    fireEvent.change(caloriesInput(), { target: { value: "3000" } });

    expect(percents()).toEqual(["45%", "25%", "30%"]);
    expect(gramsInput("Protein").value).toBe("225");
    expect(gramsInput("Fat").value).toBe("83");
    expect(gramsInput("Carbs").value).toBe(String(splitToGrams(3000, START).carbG));
  });

  it("a preset sets the thumbs, holding the protein share", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness initial={{ calories: 2400, split: START }} onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: /Custom/ }));
    await user.click(await screen.findByRole("menuitem", { name: "Keto" }));

    // Keto is 10 / 90 of the 70 left after protein → 7 / 63 / 30.
    expect(percents()).toEqual(["7%", "63%", "30%"]);
    expect(thumb("Carbs and fat boundary")).toHaveAttribute("aria-valuenow", "7");
    expect(thumb("Fat and protein boundary")).toHaveAttribute("aria-valuenow", "70");
    expect(screen.getByRole("button", { name: /Keto/ })).toBeInTheDocument();
    expect(caloriesInput().value).toBe("2400");
  });
});
