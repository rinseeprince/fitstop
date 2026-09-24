import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NutritionOutOfDateNotice } from "./nutrition-out-of-date-notice";
import type { NutritionOutOfDate } from "@/lib/nutrition/nutrition-out-of-date";

// units-context imports auth-context, which constructs the browser Supabase
// client at module load and throws without env vars.
const units = vi.hoisted(() => ({ preference: "metric" as "metric" | "imperial" }));
vi.mock("@/contexts/units-context", () => ({
  useUnits: () => ({ preference: units.preference, isLoading: false, error: null }),
}));

const TODAY = "2026-09-23";

// The goal changed today: the calories were worked out for 81.5 kg by 9 Nov.
const fromToday: NutritionOutOfDate = {
  versionId: "v-run",
  fromDay: TODAY,
  built: { goalWeightKg: 81.5, deadline: "2026-11-09" },
  goal: { goalWeightKg: 79, deadline: "2026-12-20" },
  goalName: "Cut deeper",
  goalChangedOn: TODAY,
  setByHand: false,
};

// A planned goal takes over on 19 Oct while Lean out's calories still run.
const fromLater: NutritionOutOfDate = {
  versionId: "v-run",
  fromDay: "2026-10-19",
  built: { goalWeightKg: 81.9, deadline: "2026-10-18" },
  goal: { goalWeightKg: 84.6, deadline: "2026-12-14" },
  goalName: "Build",
  goalChangedOn: "2026-10-19",
  setByHand: false,
};

beforeEach(() => {
  cleanup();
  units.preference = "metric";
});

describe("NutritionOutOfDateNotice", () => {
  it("a problem from today names the goal now and what the calories still aim for, and offers Regenerate", () => {
    const onRegenerate = vi.fn();
    const onSetFrom = vi.fn();
    render(
      <NutritionOutOfDateNotice
        outOfDate={fromToday}
        clientToday={TODAY}
        onRegenerate={onRegenerate}
        onSetFrom={onSetFrom}
      />
    );

    expect(
      screen.getByText(
        "The goal is now Cut deeper (79.0 kg by 20 Dec), but the calories still aim for 81.5 kg by 9 Nov."
      )
    ).toBeInTheDocument();
    screen.getByRole("button", { name: "Regenerate" }).click();
    expect(onRegenerate).toHaveBeenCalledOnce();
    expect(onSetFrom).not.toHaveBeenCalled();
  });

  it("a later day's problem names the day and the goal from it, and offers Set nutrition from it", () => {
    const onRegenerate = vi.fn();
    const onSetFrom = vi.fn();
    render(
      <NutritionOutOfDateNotice
        outOfDate={fromLater}
        clientToday={TODAY}
        onRegenerate={onRegenerate}
        onSetFrom={onSetFrom}
      />
    );

    expect(
      screen.getByText(
        "From 19 Oct the goal is Build (84.6 kg by 14 Dec), but the calories still aim for 81.9 kg by 18 Oct."
      )
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Regenerate" })).not.toBeInTheDocument();
    screen.getByRole("button", { name: "Set nutrition from 19 Oct" }).click();
    expect(onSetFrom).toHaveBeenCalledWith("2026-10-19");
  });

  it("without Regenerate, today's problem offers Set nutrition from today", () => {
    const onSetFrom = vi.fn();
    render(<NutritionOutOfDateNotice outOfDate={fromToday} clientToday={TODAY} onSetFrom={onSetFrom} />);

    screen.getByRole("button", { name: "Set nutrition from 23 Sept" }).click();
    expect(onSetFrom).toHaveBeenCalledWith(TODAY);
  });

  it("with nothing to do — the drawer already on the day — it only says so", () => {
    render(<NutritionOutOfDateNotice outOfDate={fromLater} clientToday={TODAY} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("closes with an × only where the surface offers it", () => {
    const onClose = vi.fn();
    const { unmount } = render(
      <NutritionOutOfDateNotice outOfDate={fromLater} clientToday={TODAY} onClose={onClose} />
    );
    screen.getByRole("button", { name: "Close" }).click();
    expect(onClose).toHaveBeenCalledOnce();
    unmount();

    render(<NutritionOutOfDateNotice outOfDate={fromLater} clientToday={TODAY} />);
    expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
  });

  it("names a goal with no weight target by its name alone", () => {
    render(
      <NutritionOutOfDateNotice
        outOfDate={{ ...fromLater, goal: { goalWeightKg: null, deadline: null }, goalName: "Maintain" }}
        clientToday={TODAY}
      />
    );
    expect(
      screen.getByText("From 19 Oct the goal is Maintain, but the calories still aim for 81.9 kg by 18 Oct.")
    ).toBeInTheDocument();
  });

  it("says when the goal has no deadline", () => {
    render(
      <NutritionOutOfDateNotice
        outOfDate={{ ...fromToday, goal: { goalWeightKg: 76, deadline: null }, goalName: "Lose weight" }}
        clientToday={TODAY}
      />
    );
    expect(
      screen.getByText(
        "The goal is now Lose weight (76.0 kg, no deadline), but the calories still aim for 81.5 kg by 9 Nov."
      )
    ).toBeInTheDocument();
  });

  it("says maintenance when the calories were worked out with no goal to aim for", () => {
    render(
      <NutritionOutOfDateNotice
        outOfDate={{ ...fromLater, built: { goalWeightKg: null, deadline: null } }}
        clientToday={TODAY}
      />
    );
    expect(
      screen.getByText(
        "From 19 Oct the goal is Build (84.6 kg by 14 Dec), but the calories still aim for maintenance."
      )
    ).toBeInTheDocument();
  });

  it("says so when there is no goal at all", () => {
    render(
      <NutritionOutOfDateNotice
        outOfDate={{ ...fromToday, goal: { goalWeightKg: null, deadline: null }, goalName: null }}
        clientToday={TODAY}
      />
    );
    expect(
      screen.getByText("There's no goal now, but the calories still aim for 81.5 kg by 9 Nov.")
    ).toBeInTheDocument();
  });

  it("follows the coach's unit", () => {
    units.preference = "imperial";
    render(<NutritionOutOfDateNotice outOfDate={fromToday} clientToday={TODAY} />);
    // 79.0 kg is 174.2 lbs and 81.5 kg is 179.7 lbs.
    expect(
      screen.getByText(
        "The goal is now Cut deeper (174.2 lbs by 20 Dec), but the calories still aim for 179.7 lbs by 9 Nov."
      )
    ).toBeInTheDocument();
  });
});

describe("NutritionOutOfDateNotice — calories typed by hand (commits 8d4, 9b)", () => {
  // Typed calories were priced for no goal, so they never "still aim for"
  // one: the notice says when the goal changed and that the calories have not.
  it("says the day the goal changed — days ago, not today — and offers the same button", () => {
    const onRegenerate = vi.fn();
    render(
      <NutritionOutOfDateNotice
        outOfDate={{ ...fromToday, setByHand: true, goalChangedOn: "2026-09-16" }}
        clientToday={TODAY}
        onRegenerate={onRegenerate}
      />
    );

    expect(
      screen.getByText("The goal changed on 16 Sept. The calories haven't changed since then.")
    ).toBeInTheDocument();
    expect(screen.queryByText(/still aim for/)).not.toBeInTheDocument();
    screen.getByRole("button", { name: "Regenerate" }).click();
    expect(onRegenerate).toHaveBeenCalledOnce();
  });

  it("says a planned goal changes it from its day", () => {
    const onSetFrom = vi.fn();
    render(
      <NutritionOutOfDateNotice
        outOfDate={{ ...fromLater, setByHand: true }}
        clientToday={TODAY}
        onSetFrom={onSetFrom}
      />
    );

    expect(
      screen.getByText("From 19 Oct the goal changes. The calories stay as they are.")
    ).toBeInTheDocument();
    screen.getByRole("button", { name: "Set nutrition from 19 Oct" }).click();
    expect(onSetFrom).toHaveBeenCalledWith("2026-10-19");
  });

  it("says so when there is no goal now", () => {
    render(
      <NutritionOutOfDateNotice
        outOfDate={{
          ...fromToday,
          goal: { goalWeightKg: null, deadline: null },
          goalName: null,
          goalChangedOn: null,
          setByHand: true,
        }}
        clientToday={TODAY}
      />
    );

    expect(screen.getByText("There's no goal now. The calories stay as they are.")).toBeInTheDocument();
  });

  it("says a later day has no goal", () => {
    render(
      <NutritionOutOfDateNotice
        outOfDate={{
          ...fromLater,
          goal: { goalWeightKg: null, deadline: null },
          goalName: null,
          goalChangedOn: null,
          setByHand: true,
        }}
        clientToday={TODAY}
      />
    );

    expect(screen.getByText("From 19 Oct there's no goal. The calories stay as they are.")).toBeInTheDocument();
  });

  it("leaves a change with no day undated — a goal deleted, or edited before its start", () => {
    render(
      <NutritionOutOfDateNotice outOfDate={{ ...fromToday, setByHand: true, goalChangedOn: null }} clientToday={TODAY} />
    );

    expect(screen.getByText("The goal has changed. The calories haven't changed since then.")).toBeInTheDocument();
  });
});
