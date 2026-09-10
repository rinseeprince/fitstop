import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { ComponentProps } from "react";
import { NutritionSettingsForm } from "./nutrition-settings-form";
import {
  buildBlockStartOptions,
  NO_BLOCK_OPTION,
  type BlockStartOption,
} from "@/lib/blocks/block-start-options";

// Required, not optional: units-context imports auth-context, which constructs
// the browser Supabase client at module load and throws without env vars.
vi.mock("@/contexts/units-context", () => ({
  useUnits: () => ({ preference: "metric", isLoading: false, error: null }),
}));

// The shared picker is a Radix Select; its own test drives the real one. Here it
// is a native select so a pick is one change event and the label association
// (`htmlFor` → the trigger's id) still resolves.
vi.mock("@/components/clients/metrics/blocks/block-start-picker", () => ({
  BlockStartPicker: ({
    id,
    options,
    value,
    onValueChange,
  }: {
    id: string;
    options: readonly BlockStartOption[];
    value: string;
    onValueChange: (value: string) => void;
  }) => (
    <select id={id} value={value} onChange={(e) => onValueChange(e.target.value)}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

const CLIENT_TODAY = "2026-07-02";
const RUNS_UNTIL = /Targets are already queued for/;
const REPLACES = /This replaces the targets queued for/;

// A block under way at the client's today and a future one — the options the
// hook builds from the chain payload and the floor.
const CUT = { id: "b-cut", name: "Cut", startsOn: "2026-06-20", endsOn: "2026-07-17" };
const BUILD = { id: "b-build", name: "Build", startsOn: "2026-07-18", endsOn: "2026-08-14" };
const OPTIONS = buildBlockStartOptions([CUT, BUILD], CLIENT_TODAY);

// `Partial` of a required prop would type each override as possibly undefined,
// so the overrides are a plain subset: every key given is given in full.
type FormOverrides = {
  [K in keyof ComponentProps<typeof NutritionSettingsForm>]?: ComponentProps<
    typeof NutritionSettingsForm
  >[K];
};

function renderForm(overrides: FormOverrides = {}) {
  const onEffectiveFromChange = vi.fn();
  const onBlockChange = vi.fn();
  render(
    <NutritionSettingsForm
      tdee={2400}
      proteinTargetGPerKg={2.0}
      dietType="balanced"
      onSettingsChange={vi.fn()}
      blockOptions={OPTIONS}
      blockValue={NO_BLOCK_OPTION}
      onBlockChange={onBlockChange}
      blockSelected={false}
      effectiveFrom={CLIENT_TODAY}
      clientToday={CLIENT_TODAY}
      startFloor={CLIENT_TODAY}
      clientName="Alex Doe"
      queuedChangeDate={null}
      onEffectiveFromChange={onEffectiveFromChange}
      {...overrides}
    />,
  );
  return { onEffectiveFromChange, onBlockChange };
}

const startsOn = () => screen.getByLabelText("Starts on");
const blockField = () => screen.getByLabelText("Block");

// The day the plan takes effect is a drawer setting picked BEFORE the save
// (docs/MEASUREMENT-LOG-PLAN.md commit 8bb, D26) — no dialog stands between
// Generate and the save any more.
describe("NutritionSettingsForm — Starts on", () => {
  beforeEach(cleanup);

  it("floors the field at the start floor — the server's belt, as an affordance", () => {
    renderForm();
    expect(startsOn()).toHaveAttribute("min", CLIENT_TODAY);
  });

  // The floor is the shared deletion floor (commit B): today, or tomorrow once
  // the client has logged today. A greyed-out today with no explanation is
  // worse than an error, so the field says why.
  describe("the logged-today line", () => {
    const TOMORROW = "2026-07-03";

    it("floors at the deletion floor and says who logged which day, and when targets can start", () => {
      renderForm({ startFloor: TOMORROW, effectiveFrom: TOMORROW });
      expect(startsOn()).toHaveAttribute("min", TOMORROW);
      // en-AU spells July in full (June/July/Sept are the four-letter months).
      expect(screen.getByText(/has already logged/)).toHaveTextContent(
        "Alex Doe has already logged 2 July. Targets can start from 3 July."
      );
    });

    it("says nothing while the floor is today", () => {
      renderForm();
      expect(screen.queryByText(/has already logged/)).toBeNull();
    });
  });

  it("shows the day it was given — the client's today until the coach picks", () => {
    renderForm();
    expect(startsOn()).toHaveValue(CLIENT_TODAY);
  });

  it("hands a pick up to the hook, which owns the setting", () => {
    const { onEffectiveFromChange } = renderForm();
    fireEvent.change(startsOn(), { target: { value: "2026-07-23" } });
    expect(onEffectiveFromChange).toHaveBeenCalledWith("2026-07-23");
  });

  it("renders empty, with no floor, until the resolved inputs have loaded", () => {
    renderForm({
      effectiveFrom: null,
      clientToday: null,
      startFloor: null,
      blockOptions: [],
    });
    const field = startsOn();
    expect(field).toHaveValue("");
    expect(field).not.toHaveAttribute("min");
    expect(field).toBeEnabled();
  });

  // The queued-change line (migration 166): a save dated BEFORE a queued
  // version runs until the day before it and leaves it standing; a save dated
  // ON it replaces it in place. Inform, never block — one sentence says which,
  // then the save does what was asked.
  describe("the queued-change line", () => {
    const QUEUED = "2026-07-12";

    it("a pick BEFORE the queued change says these targets run until the day before it", () => {
      renderForm({ queuedChangeDate: QUEUED, effectiveFrom: "2026-07-02" });
      expect(screen.getByText(RUNS_UNTIL)).toHaveTextContent("12 Jul");
      expect(screen.queryByText(REPLACES)).toBeNull();
    });

    it("a pick ON the queued date says it replaces those targets", () => {
      renderForm({ queuedChangeDate: QUEUED, effectiveFrom: QUEUED });
      expect(screen.getByText(REPLACES)).toHaveTextContent("12 Jul");
      expect(screen.queryByText(RUNS_UNTIL)).toBeNull();
    });

    it("a pick after the queued change shows neither", () => {
      renderForm({ queuedChangeDate: QUEUED, effectiveFrom: "2026-07-13" });
      expect(screen.queryByText(RUNS_UNTIL)).toBeNull();
      expect(screen.queryByText(REPLACES)).toBeNull();
    });

    it("nothing queued shows neither", () => {
      renderForm({ queuedChangeDate: null, effectiveFrom: "2026-07-02" });
      expect(screen.queryByText(RUNS_UNTIL)).toBeNull();
      expect(screen.queryByText(REPLACES)).toBeNull();
    });
  });
});

// The Block field (D): the dash — the empty state — then the client's current
// and future blocks with their ranges, ABOVE the date. A chosen block fixes the
// start and greys the date; the dash hands it back. The hook owns both.
describe("NutritionSettingsForm — the Block field", () => {
  beforeEach(cleanup);

  it("sits above Starts on and lists the dash, then the blocks with their ranges", () => {
    renderForm();
    const field = blockField();
    expect(
      field.compareDocumentPosition(startsOn()) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(Array.from(field.querySelectorAll("option")).map((o) => o.textContent)).toEqual([
      "—",
      "Cut · 20 June – 17 July",
      "Build · 18 July – 14 Aug",
    ]);
    expect(field).toHaveValue(NO_BLOCK_OPTION);
  });

  it("a chosen block greys the date, which shows the block's first available day", () => {
    renderForm({ blockValue: BUILD.id, blockSelected: true, effectiveFrom: BUILD.startsOn });
    expect(blockField()).toHaveValue(BUILD.id);
    expect(startsOn()).toBeDisabled();
    expect(startsOn()).toHaveValue(BUILD.startsOn);
    expect(startsOn()).not.toHaveAttribute("max");
  });

  it("the dash leaves the date the coach's own, floored at the floor with no ceiling", () => {
    renderForm();
    expect(startsOn()).toBeEnabled();
    expect(startsOn()).toHaveAttribute("min", CLIENT_TODAY);
    expect(startsOn()).not.toHaveAttribute("max");
  });

  it("a pick hands the block up to the hook, which owns the selection", () => {
    const { onBlockChange } = renderForm();
    fireEvent.change(blockField(), { target: { value: BUILD.id } });
    expect(onBlockChange).toHaveBeenCalledWith(BUILD.id);
  });
});
