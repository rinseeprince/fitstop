import { betaTool } from "@anthropic-ai/sdk/helpers/beta/json-schema";
import { normalizeExerciseName } from "@/services/exercise-catalog-service";
import type { DraftWorkspace } from "./draft-workspace";
import {
  exerciseLine,
  programSkeleton,
  resolveSession,
  resolveWeek,
  sessionDetail,
} from "./draft-tool-helpers";

// READ tools — answer from the per-request workspace, zero client round-trips.
// The prompt only carries the program skeleton; the model pulls detail on
// demand, so a 52-week program never rides into context wholesale.

export function buildReadTools(ws: DraftWorkspace) {
  const getProgramOverview = betaTool({
    name: "get_program_overview",
    description:
      "One-line-per-week overview of the whole program (current working state, including edits already made this turn). Use before planning multi-week changes.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    } as const,
    run: () => programSkeleton(ws.draft),
  });

  const getWeek = betaTool({
    name: "get_week",
    description:
      "Every session in one week with its exercise list (compact: sets/reps/loads per exercise). Use get_session for full per-set detail.",
    inputSchema: {
      type: "object",
      properties: {
        week: { type: "integer", minimum: 1, description: "1-based week number" },
      },
      required: ["week"],
      additionalProperties: false,
    } as const,
    run: ({ week }) => {
      const w = resolveWeek(ws, week);
      if (!w.ok) return w.error;
      const lines = w.value.days.map((slot, i) => {
        if (!slot.session) return `Day ${i + 1}: rest`;
        const head = `Day ${i + 1}: "${slot.session.name}"${slot.session.focus ? ` (${slot.session.focus})` : ""}`;
        const exercises = slot.session.exercises.map((ex, j) => `  ${exerciseLine(ex, j + 1)}`);
        return [head, ...exercises].join("\n");
      });
      return [`Week ${week}:`, ...lines].join("\n");
    },
  });

  const getSession = betaTool({
    name: "get_session",
    description:
      "Full detail of one session including every per-set prescription (set types, reps, loads, RPE, drops). Read this before editing an exercise's sets.",
    inputSchema: {
      type: "object",
      properties: {
        week: { type: "integer", minimum: 1 },
        day: { type: "integer", minimum: 1, maximum: 7 },
      },
      required: ["week", "day"],
      additionalProperties: false,
    } as const,
    run: ({ week, day }) => {
      const session = resolveSession(ws, week, day);
      if (!session.ok) return session.error;
      return sessionDetail(session.value, week, day);
    },
  });

  const searchExercises = betaTool({
    name: "search_exercises",
    description:
      "Search the coach's exercise catalog (their custom exercises + the global library). Every exercise you ADD must come from this catalog — if add_exercise can't resolve a name, search here and pick a real entry.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", minLength: 1, maxLength: 100 },
        limit: { type: "integer", minimum: 1, maximum: 20 },
      },
      required: ["query"],
      additionalProperties: false,
    } as const,
    run: ({ query, limit }) => {
      const max = limit ?? 10;
      const normalized = normalizeExerciseName(query);
      const terms = normalized.split(/\s+/).filter(Boolean);
      const matches = ws.catalog
        .map((row) => {
          const haystacks = [row.name, ...(row.aliases ?? [])].map((h) => h.toLowerCase());
          const hits = terms.filter((t) => haystacks.some((h) => h.includes(t))).length;
          return { row, hits };
        })
        .filter(({ hits }) => hits > 0)
        .sort(
          (a, b) => b.hits - a.hits || a.row.name.localeCompare(b.row.name),
        )
        .slice(0, max);
      if (matches.length === 0) {
        return `No catalog exercises match "${query}". Try a different term, or tell the coach it isn't in their library.`;
      }
      return matches
        .map(({ row }) => {
          const bits = [row.name];
          if (row.muscle_group) bits.push(row.muscle_group);
          if ((row.category ?? "").trim().toLowerCase() === "compound") bits.push("compound");
          return `- ${bits.join(" — ")}`;
        })
        .join("\n");
    },
  });

  return [getProgramOverview, getWeek, getSession, searchExercises];
}
