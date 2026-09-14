// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

/**
 * One owner per surface (CONVENTIONS §7 → "No frame disagrees"): the Training
 * tab's apply tray and its two full-screen editors are the ADDRESS's, so the
 * host holds no state about them and the overlay reads no ref — a ref or a
 * state mirror is exactly what let the tray fade out wearing the last editor.
 * jsdom never paints, so the closing frame itself is not observable by any
 * gate; this scan pins the shape the frame analysis rests on.
 */
const ROOT = join(__dirname, "..", "..", "..", "..");
const read = (file: string) => readFileSync(join(ROOT, file), "utf8");
// A hook call with or without a type argument: `useRef(`, `useRef<T>(`.
const hook = (name: string) => new RegExp(`\\b${name}\\s*(<[^\\n]*>)?\\s*\\(`);

function segment(source: string, from: string, to: string): string {
  const start = source.indexOf(from);
  expect(start, `"${from}"`).toBeGreaterThan(-1);
  const end = source.indexOf(to, start);
  expect(end, `"${to}" after "${from}"`).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("the apply surface has one owner, the address", () => {
  it("the host holds no state, ref or one-shot open for the tray or the editor", () => {
    const host = read("components/clients/training/builder/training-plan-builder.tsx");
    expect(host).not.toMatch(hook("useState"));
    expect(host).not.toMatch(hook("useRef"));
    expect(host).not.toContain("useJourneyRoundTrip");
    expect(host).toContain('searchParams.get("apply") === "1"');
    expect(host).toContain('searchParams.get("editor")');
  });

  it("the overlay derives every frame from its props: no ref, no state of its own", () => {
    const source = read(
      "components/clients/training/builder/training-plan-builder-overlay.tsx"
    );
    const body = segment(source, "export function TrainingPlanBuilderOverlay", "function LibraryHeader");
    expect(body).not.toMatch(hook("useRef"));
    expect(body).not.toMatch(hook("useState"));
    expect(body).not.toMatch(hook("useEffect"));
  });

  it("the two Content elements are keyed by surface, and only the tray keeps an exit animation", () => {
    const source = read(
      "components/clients/training/builder/training-plan-builder-overlay.tsx"
    );
    const editor = segment(source, 'key="editor"', 'key="tray"');
    const tray = segment(source, 'key="tray"', "</DialogPrimitive.Portal>");
    expect(editor).not.toContain("data-[state=closed]");
    expect(tray).toContain("data-[state=closed]:slide-out-to-right");
    expect(tray).toContain("data-[state=open]:slide-in-from-right");
  });

  it("the amendment editor closes in the same frame its address goes", () => {
    const source = read("components/clients/training/builder/plan-amendment-overlay.tsx");
    expect(source).not.toContain("data-[state=closed]");
    expect(source).not.toContain("DialogPrimitive.Overlay");
  });

  it("the exercise pane's selection is the address's, never a state seeded from it", () => {
    const source = read("components/clients/training/exercise-data/exercise-data-view.tsx");
    expect(source).not.toMatch(/useState(<[^\n]*>)?\s*\(\s*searchParams/);
    expect(source).not.toMatch(/useState<string \| null>/);
  });

  it("the Blocks pane reads its one-shot through the hook that strips it", () => {
    const source = read("components/clients/metrics/blocks/blocks-subtab.tsx");
    expect(source).toContain("useJourneyFocusBlock()");
    expect(source).not.toContain('searchParams.get("block")');
  });
});
