// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

/**
 * The coach's side trays are the nutrition plan tray's width (owner,
 * 2026-09-30). The nutrition plan tray and Manage Habits are Sheets that ask
 * for w-[420px] and leave the sheet's own cap on a right-hand panel
 * (sm:max-w-sm, components/ui/sheet.tsx) in place, so the same Sheet renders
 * both at 384px on a desktop screen. The Training tab's "Apply a program" tray
 * is no Sheet, so it carries that width and that cap itself. jsdom lays
 * nothing out; this scan pins the shape the shared width rests on.
 */
const ROOT = join(__dirname, "..");
const read = (file: string) => readFileSync(join(ROOT, file), "utf8");

const NUTRITION_TRAY = "components/clients/nutrition/builder/nutrition-settings-drawer.tsx";
const HABITS_DRAWER = "components/clients/habits/habits-manage-drawer.tsx";
const APPLY_TRAY = "components/clients/training/builder/training-plan-builder-overlay.tsx";

/** The classes of the first `className="…"` after `anchor` in `file`. */
function classesAfter(file: string, anchor: string): string[] {
  const source = read(file);
  const start = source.indexOf(anchor);
  expect(start, `${anchor} in ${file}`).toBeGreaterThan(-1);
  const match = /\sclassName="([^"]*)"/.exec(source.slice(start));
  expect(match, `a className after ${anchor} in ${file}`).not.toBeNull();
  return match![1].split(/\s+/).filter(Boolean);
}

/** The classes that set a width, a min width or a max width, at any breakpoint. */
const widthClasses = (classes: string[]) => classes.filter((name) => /^(?:[^\s:]+:)*!?(?:min-|max-)?w-/.test(name));

describe("the coach's side trays are the nutrition plan tray's width", () => {
  it("the sheet caps a right-hand panel at sm:max-w-sm, the cap the three trays rest on", () => {
    const right = /side === 'right' &&\s*'([^']*)'/.exec(read("components/ui/sheet.tsx"));
    expect(right).not.toBeNull();
    expect(right![1].split(/\s+/)).toContain("sm:max-w-sm");
  });

  it("the nutrition plan tray and Manage Habits ask the sheet for w-[420px] alone, never lifting its cap", () => {
    for (const file of [NUTRITION_TRAY, HABITS_DRAWER]) {
      expect(widthClasses(classesAfter(file, "<SheetContent")), file).toEqual(["w-[420px]"]);
    }
  });

  it("the Apply a program tray, no Sheet, carries the same width and the sheet's cap itself", () => {
    expect(widthClasses(classesAfter(APPLY_TRAY, 'key="tray"')).sort()).toEqual(
      ["w-[420px]", "max-w-[100vw]", "sm:max-w-sm"].sort()
    );
  });
});
