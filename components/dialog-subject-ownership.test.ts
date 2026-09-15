// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

/**
 * A dialog's subject outlives its close (CONVENTIONS §7 → "No frame
 * disagrees", rule 5; §3 → "Dialog/modal structure"). Radix keeps a closing
 * card mounted through its exit animation and re-renders it from live state,
 * so a card whose subject doubled as its open flag faded out blank, on a
 * fallback title or on a spinner. Each surface below takes `open` apart from
 * its subject, and each host keeps the subject through the close
 * (`useDialogSubject`). jsdom never paints; this scan pins the shape.
 */
const ROOT = join(__dirname, "..");
const read = (file: string) => readFileSync(join(ROOT, file), "utf8");

// Each surface's open is its own prop, never derived from its subject.
const SURFACES: { file: string; derived: RegExp[]; latches?: string[] }[] = [
  { file: "components/clients/metrics/blocks/delete-plan-dialog.tsx", derived: [/open=\{plan\s*!==?\s*null\}/] },
  { file: "components/clients/metrics/blocks/delete-block-dialog.tsx", derived: [/open=\{block\s*!==?\s*null\}/] },
  { file: "components/clients/metrics/blocks/block-trim-dialog.tsx", derived: [/open=\{question\s*!==?\s*null\}/, /if\s*\(!question\)\s*return null/] },
  {
    file: "components/clients/training/calendar/delete-event-dialog.tsx",
    derived: [/open=\{event\s*!==?\s*null\}/, /open=\{weekStartDate\s*!==?\s*null\}/],
  },
  {
    file: "components/clients/training/calendar/placed-session-editor.tsx",
    derived: [/open=\{state\s*!==?\s*null\}/],
    latches: ["displayDate"],
  },
  { file: "components/clients/training/program-builder/session-editor-sheet.tsx", derived: [/open=\{session\s*!==?\s*null\}/] },
  {
    file: "components/programs/standalone-session-editor.tsx",
    derived: [/open=\{state\s*!==?\s*null\}/],
    latches: ["displayMode"],
  },
  { file: "components/clients/metrics/edit-reading-dialog.tsx", derived: [/open=\{row\s*!==?\s*null\}/], latches: ["prevOpen"] },
  { file: "components/clients/metrics/remove-reading-dialog.tsx", derived: [/open=\{row\s*!==?\s*null\}/], latches: ["prevOpen"] },
  { file: "components/clients/nutrition/calendar/nutrition-edit-targets-dialog.tsx", derived: [], latches: ["latchedDays"] },
];

// Each host keeps its subjects with the hook, and no close nulls one.
const HOSTS: { file: string; nulled: string[] }[] = [
  { file: "components/clients/metrics/blocks/blocks-subtab.tsx", nulled: ["setDeleteTarget(null)", "setDeletePlanTarget(null)", "setPendingEdit(null)"] },
  { file: "components/clients/training/calendar/training-calendar-view.tsx", nulled: ["setDeleteTarget(null)", "setPendingClearWeek(null)", "setSelectedSession(null)"] },
  { file: "components/clients/training/program-builder/library-session-list.tsx", nulled: ["setDeleteTarget(null)", "setEditorState(null)"] },
  { file: "components/clients/training/program-builder/library-exercise-list.tsx", nulled: ["setDeleteTarget(null)", "setEditTarget(null)"] },
  { file: "components/programs/programs-table.tsx", nulled: ["setDeleteTarget(null)"] },
  { file: "components/clients/training/builder/training-plan-builder-overlay.tsx", nulled: ["setPlanToDelete(null)"] },
  { file: "components/clients/training/program-builder/program-builder.tsx", nulled: ["setEditingSessionUid(null)"] },
  { file: "components/clients/training/training-history-table.tsx", nulled: ["setChartColumn(null)", "setSelectedSessionLogId(null)"] },
  { file: "components/clients/metrics/metrics-tab-content.tsx", nulled: ["setEditingReading(null)", "setRemovingReading(null)"] },
  { file: "hooks/use-nutrition-calendar-editing.ts", nulled: ["setEditorOpen(false)"] },
];

describe("a dialog's subject outlives its close", () => {
  for (const surface of SURFACES) {
    it(`${surface.file} takes open apart from its subject and latches nothing`, () => {
      const source = read(surface.file);
      for (const pattern of surface.derived) expect(source).not.toMatch(pattern);
      for (const latch of surface.latches ?? []) expect(source).not.toContain(latch);
    });
  }

  for (const host of HOSTS) {
    it(`${host.file} keeps its subjects through the close`, () => {
      const source = read(host.file);
      expect(source).toContain("useDialogSubject");
      for (const call of host.nulled) expect(source).not.toContain(call);
    });
  }

  it("the session log's read is keyed on the log alone, so the closing card keeps its data", () => {
    const source = read("components/clients/training/session-log-detail-dialog.tsx");
    expect(source).not.toMatch(/open\s*&&\s*sessionLogId/);
  });

  it("the reading dialogs and the exercise form are keyed by the opening, never reset by a close", () => {
    const metrics = read("components/clients/metrics/metrics-tab-content.tsx");
    expect(metrics).toContain("key={`edit-reading-${editing.openKey}`}");
    expect(metrics).toContain("key={`remove-reading-${removing.openKey}`}");
    const exercises = read("components/clients/training/program-builder/library-exercise-list.tsx");
    expect(exercises).toContain("key={`exercise-form-${formDialog.openKey}`}");
    expect(read("components/programs/exercise-form-dialog.tsx")).not.toMatch(/useEffect\s*\(/);
  });
});
