import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { SetRowEditor } from "./set-row-editor";
import type { SetSpec } from "@/utils/exercise-set-specs";
import type { PrescribedField } from "@/utils/prescribed-fields";

// Required, not optional: units-context imports auth-context, which constructs
// the browser Supabase client at module load and throws without env vars.
vi.mock("@/contexts/units-context", () => ({
  useUnits: () => ({ preference: "metric", isLoading: false, error: null }),
}));

const FIELDS: ReadonlySet<PrescribedField> = new Set(["set_type", "reps"]);
const working: SetSpec = { set_number: 1, set_type: "working", reps_min: 8, reps_max: 10 };
const failure: SetSpec = { ...working, set_type: "failure" };

const row = (spec: SetSpec) => (
  <SetRowEditor spec={spec} fields={FIELDS} index={0} disabled={false} onEdit={vi.fn()} />
);

afterEach(cleanup);

describe("the reps box across a set-type switch", () => {
  // A working set's box is uncontrolled (a default it commits on blur); a
  // failure set's box is controlled and empty. They are two boxes, so a type
  // switch must mount the other one — never flip one DOM input between modes,
  // which React reports as an uncontrolled-to-controlled change.
  it("is two boxes: a switch mounts the other, and no input changes mode", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { rerender } = render(row(working));
      expect(screen.getByLabelText("Set 1 reps")).toHaveValue("8-10");

      // The parent applies the Type pick and re-renders the row as a failure set.
      rerender(row(failure));
      const closed = screen.getByLabelText("Set 1 reps (not prescribed)");
      expect(closed).toBeDisabled();
      expect(closed).toHaveValue("");
      expect(closed).toHaveAttribute("placeholder", "To failure");
      expect(screen.queryByLabelText("Set 1 reps")).toBeNull();

      // And back: a fresh box reads the range the spec still carries.
      rerender(row(working));
      expect(screen.getByLabelText("Set 1 reps")).toHaveValue("8-10");
      expect(screen.queryByLabelText("Set 1 reps (not prescribed)")).toBeNull();

      const modeWarnings = consoleError.mock.calls.filter((args) =>
        args.some((a) => typeof a === "string" && /controlled/i.test(a)),
      );
      expect(modeWarnings).toEqual([]);
    } finally {
      consoleError.mockRestore();
    }
  });
});
