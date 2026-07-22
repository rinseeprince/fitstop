import { describe, it, expect, vi } from "vitest";

vi.mock("@/services/supabase-admin", () => ({ supabaseAdmin: { from: vi.fn() } }));

import { systemPrompt } from "./draft-agent-service";
import { buildWorkspaceFromRows } from "./draft-workspace";
import { buildReadTools } from "./draft-read-tools";
import { buildWeekTools } from "./draft-week-tools";
import { buildSessionTools } from "./draft-session-tools";
import { buildExerciseTools } from "./draft-exercise-tools";
import { makeRestWeek } from "@/components/clients/training/program-builder/program-builder-types";
import { normalizeDraft } from "@/components/clients/training/program-builder/program-builder-model";

// PROMPT-CACHE FLOOR GUARD.
//
// Opus 4.8 refuses to cache a prefix shorter than 4096 tokens — silently: no
// error, no warning, `cache_read_input_tokens` just stays 0 and every tool-loop
// iteration re-pays full price for the whole tools+system prefix. The cached
// prefix is tools + system (tools render first; the cache_control breakpoint
// sits on the system block and covers both).
//
// Tokens can't be counted offline, so this asserts on CHARACTERS using a
// deliberately PESSIMISTIC 4.0 chars/token — real English prose and JSON
// schemas both tokenize denser than that, so clearing this bar means clearing
// the real floor with margin.
const CACHE_FLOOR_TOKENS = 4096;
const PESSIMISTIC_CHARS_PER_TOKEN = 4.0;
const MIN_PREFIX_CHARS = CACHE_FLOOR_TOKENS * PESSIMISTIC_CHARS_PER_TOKEN;

function toolsWireChars(): number {
  const draft = normalizeDraft({
    id: "00000000-0000-4000-8000-000000000000",
    name: "P",
    description: null,
    status: "saved",
    splitType: null,
    programDurationWeeks: null,
    defaultSurplusPercentage: null,
    weeks: [makeRestWeek(0)],
  });
  const ws = buildWorkspaceFromRows({ target: "library", draft, catalog: [] });
  const tools = [
    ...buildReadTools(ws),
    ...buildWeekTools(ws),
    ...buildSessionTools(ws),
    ...buildExerciseTools(ws),
  ];
  // JSON.stringify drops the `run`/`parse` functions, leaving exactly what
  // goes over the wire: type + name + description + input_schema. (The schema
  // key is snake_case `input_schema` on the runtime object — reading it as
  // `inputSchema` silently serializes nothing and the guard passes vacuously.)
  return JSON.stringify(tools).length;
}

describe("assistant prompt cache floor", () => {
  it("keeps the cacheable tools+system prefix above Opus 4.8's 4096-token floor in EVERY target", () => {
    const tools = toolsWireChars();
    for (const target of ["library", "client-draft", "placed-plan"] as const) {
      const prefix = tools + systemPrompt(target).length;
      expect(
        prefix,
        `${target} prefix is ${prefix} chars; below ${MIN_PREFIX_CHARS} risks silently disabling prompt caching`,
      ).toBeGreaterThan(MIN_PREFIX_CHARS);
    }
  });

  it("still ships all 18 tools (a dropped tool shrinks the prefix toward the floor)", () => {
    expect(toolsWireChars()).toBeGreaterThan(9000);
  });
});
