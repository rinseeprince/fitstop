// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

/**
 * A place pushes, a refinement replaces (ARCHITECTURE → "Client page tab
 * structure"): a tab, a pane and an opened record push a history entry, so
 * browser Back returns one step; the metric, an exercise pick and a one-shot
 * strip replace, so Back never lands on a refinement or re-opens a flow.
 *
 * The class of every writer is pinned here at the source, because the two
 * pane switchers under the Training and Nutrition tabs mount providers no
 * host test drives, and a writer flipped from push to replace fails nothing
 * else — the page keeps working, only Back changes.
 */
const ROOT = join(__dirname, "..", "..");

type Writer = {
  file: string;
  /** The writer's declaration; the segment runs from here … */
  from: string;
  /** … to the next occurrence of this. */
  to: string;
  method: "push" | "replace";
};

const WRITERS: Writer[] = [
  // Places
  {
    file: "components/clients/metrics/metrics-tab-content.tsx",
    from: "const setPane =",
    to: "const tab: MetricTab",
    method: "push",
  },
  {
    file: "components/clients/training/builder/training-plan-builder.tsx",
    from: "const setSubtab =",
    to: "return (",
    method: "push",
  },
  {
    file: "components/clients/nutrition/builder/nutrition-plan-builder.tsx",
    from: "const setSubtab =",
    to: "return (",
    method: "push",
  },
  // The Training tab's apply tray, a place of its own: Apply program pushes it
  {
    file: "components/clients/training/builder/training-plan-builder.tsx",
    from: "const openTray =",
    to: "const closeTrayEntry",
    method: "push",
  },
  // The plan editor, a full-screen place of its own: Edit plan pushes it
  {
    file: "components/clients/training/builder/training-plan-builder.tsx",
    from: "const openPlanEditor =",
    to: "const exitPlanEditor",
    method: "push",
  },
  // Refinements
  {
    file: "components/clients/metrics/metrics-tab-content.tsx",
    from: "const setMetric =",
    to: "const [range",
    method: "replace",
  },
  {
    file: "components/clients/training/exercise-data/exercise-data-view.tsx",
    from: "const handleExerciseSelect =",
    to: "const hasExercise",
    method: "replace",
  },
  // The client editor REPLACES the tray's entry (a pick), and its arrow
  // replaces back to the list — so Back out of the editor lands on the calendar
  {
    file: "components/clients/training/builder/training-plan-builder.tsx",
    from: "const openEditor =",
    to: "const exitEditorToList",
    method: "replace",
  },
  {
    file: "components/clients/training/builder/training-plan-builder.tsx",
    from: "const exitEditorToList =",
    to: "const closeEditor",
    method: "replace",
  },
  // A tray's or an editor's exit on a pasted address: the entry is replaced away
  {
    file: "components/clients/training/builder/training-plan-builder.tsx",
    from: "const closeTrayEntry =",
    to: "const closeTray =",
    method: "replace",
  },
  {
    file: "components/clients/training/builder/training-plan-builder.tsx",
    from: "const closeEditor =",
    to: "const openPlanEditor",
    method: "replace",
  },
  // One-shot strips
  {
    file: "hooks/use-journey-round-trip.ts",
    from: "useEffect(() => {",
    to: "const setOpen",
    method: "replace",
  },
  {
    file: "hooks/use-journey-round-trip.ts",
    from: "export function useJourneyReturnBlock",
    to: "const clearReturnBlock",
    method: "replace",
  },
  {
    file: "hooks/use-journey-focus-block.ts",
    from: "useEffect(() => {",
    to: "return focusBlockId",
    method: "replace",
  },
  {
    file: "hooks/use-profile-editor-trip.ts",
    from: "useEffect(() => {",
    to: "}, [searchParams",
    method: "replace",
  },
];

function segment(file: string, from: string, to: string): string {
  const source = readFileSync(join(ROOT, file), "utf8");
  const start = source.indexOf(from);
  expect(start, `${file}: "${from}"`).toBeGreaterThan(-1);
  const end = source.indexOf(to, start);
  expect(end, `${file}: "${to}" after "${from}"`).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("every URL writer has the class its param needs", () => {
  for (const writer of WRITERS) {
    it(`${writer.file} — ${writer.from} ${writer.method}es`, () => {
      const body = segment(writer.file, writer.from, writer.to);
      const other = writer.method === "push" ? "replace" : "push";
      expect(body).toContain(`router.${writer.method}(`);
      expect(body).not.toContain(`router.${other}(`);
    });
  }

  it("the client page's handler pushes a tab change, replaces a same-tab address and a flow's completion", () => {
    const body = segment(
      "app/(coach)/clients/[id]/page.tsx",
      "const handleTabChange",
      "const displayClient"
    );
    expect(body).toContain("if (tab === activeTab) router.replace(url, { scroll: false })");
    expect(body).toContain("else if (options?.replace) router.replace(url)");
    expect(body).toContain("else router.push(url)");
  });
});
