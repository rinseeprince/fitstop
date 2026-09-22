import { describe, expect, it, vi } from "vitest";

// The workspace module reaches the catalog service, which creates the admin
// client at import; none of this test touches the database.
vi.mock("@/services/supabase-admin", () => ({ supabaseAdmin: { from: vi.fn() } }));
import { systemPrompt } from "./draft-agent-service";
import { buildExerciseTools } from "./draft-exercise-tools";
import { buildWorkspaceFromRows } from "./draft-workspace";
import { normalizeDraft } from "@/components/clients/training/program-builder/program-builder-model";
import { makeRestWeek } from "@/components/clients/training/program-builder/program-builder-types";

// A smoke found the model reading an exercise's type as a rule and refusing
// "Sprint on the strength preset" (2026-09-19). The words that stop that are
// pinned here, in the prompt and on the tools that take a preset.
describe("the assistant is told a type is a default, never a restriction", () => {
  const draft = normalizeDraft({
    id: "44444444-4444-4444-8444-444444444444",
    name: "P",
    description: null,
    status: "saved",
    splitType: null,
    programDurationWeeks: null,
    defaultSurplusPercentage: null,
    weeks: [makeRestWeek(0)],
  });

  it("in the system prompt, for every target", () => {
    for (const target of ["library", "client-draft", "placed-plan"] as const) {
      const prompt = systemPrompt(target);
      expect(prompt).toContain("A type is only the default, never a restriction");
      expect(prompt).toContain("never something to refuse or question");
    }
  });

  it("on add_exercise and update_exercise", () => {
    const ws = buildWorkspaceFromRows({ target: "library", draft, catalog: [] });
    const tools = buildExerciseTools(ws) as unknown as Array<{ name: string; description: string }>;
    const description = (name: string) => tools.find((t) => t.name === name)?.description ?? "";
    expect(description("add_exercise")).toContain("The type is a default, not a rule");
    expect(description("update_exercise")).toContain("any preset applies to any exercise, whatever its type");
  });
});

// No engine progresses a program (owner, 2026-09-22): the assistant copies a
// week exactly, edits the copies itself, and reports what the program holds.
describe("the assistant progresses a program by copying weeks and editing the copies", () => {
  it("shows it with one example, in every target, and reports the values the program holds", () => {
    for (const target of ["library", "client-draft", "placed-plan"] as const) {
      const prompt = systemPrompt(target);
      expect(prompt).toContain(
        "A progression or a deload is those copies edited afterwards with the exercise tools",
      );
      expect(prompt.match(/duplicate_week\{/g)).toHaveLength(1);
      expect(prompt).toContain("Never report a number the program doesn't hold.");
    }
  });
});
