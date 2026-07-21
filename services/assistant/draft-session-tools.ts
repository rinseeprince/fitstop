import { betaTool } from "@anthropic-ai/sdk/helpers/beta/json-schema";
import {
  newUid,
  type SessionDraft,
} from "@/components/clients/training/program-builder/program-builder-types";
import type { DraftWorkspace } from "./draft-workspace";
import { commitOp, resolveSession, resolveSlot } from "./draft-tool-helpers";

// Program- and session-level WRITE tools. Template identity (program
// name/focus, existing session name/focus) is rejected here for client-drafts
// AND again inside applyDraftOp AND by the final sweep — three layers, so no
// single miss can violate the b2b970f rule.

const IDENTITY_ERROR =
  "In the client editor the program/session names and focus are template identity and can't be changed — everything else is editable.";

export function buildSessionTools(ws: DraftWorkspace) {
  const updateProgram = betaTool({
    name: "update_program",
    description:
      "Update program-level fields: name, focus (the program's descriptive focus, e.g. 'Push/Pull/Legs — hypertrophy'), description, or the default calorie surplus % that training days inherit when a session has no override. Name/focus are locked in the client editor.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", minLength: 1, maxLength: 200 },
        focus: { type: ["string", "null"], maxLength: 100 },
        description: { type: ["string", "null"], maxLength: 1000 },
        defaultSurplusPercentage: { type: ["number", "null"], minimum: 0, maximum: 100 },
      },
      additionalProperties: false,
    } as const,
    run: (input) => {
      const identityTouch = input.name !== undefined || input.focus !== undefined;
      if (ws.target === "client-draft" && identityTouch) return IDENTITY_ERROR;
      const patch: {
        name?: string;
        splitType?: string | null;
        description?: string | null;
        defaultSurplusPercentage?: number | null;
      } = {};
      if (input.name !== undefined) patch.name = input.name;
      if (input.focus !== undefined) patch.splitType = input.focus;
      if (input.description !== undefined) patch.description = input.description;
      if (input.defaultSurplusPercentage !== undefined) {
        patch.defaultSurplusPercentage = input.defaultSurplusPercentage;
      }
      if (Object.keys(patch).length === 0) return "Nothing to change — pass at least one field.";
      const err = commitOp(ws, {
        type: "set_program_meta",
        patch,
        label: "Updated program details",
      });
      return err ?? "Program details updated.";
    },
  });

  const addSession = betaTool({
    name: "add_session",
    description:
      "Add a new empty training session to a REST day (each day holds one session). Add exercises to it afterwards with add_exercise.",
    inputSchema: {
      type: "object",
      properties: {
        week: { type: "integer", minimum: 1 },
        day: { type: "integer", minimum: 1, maximum: 7 },
        name: { type: "string", minLength: 1, maxLength: 200 },
        focus: { type: "string", maxLength: 200 },
      },
      required: ["week", "day", "name"],
      additionalProperties: false,
    } as const,
    run: ({ week, day, name, focus }) => {
      const slot = resolveSlot(ws, week, day);
      if (!slot.ok) return slot.error;
      const session: SessionDraft = {
        uid: newUid("sess"),
        name,
        focus: focus ?? null,
        estimatedDurationMinutes: null,
        calorieSurplusPercentage: null,
        notes: null,
        sessionType: "training",
        exercises: [],
      };
      const err = commitOp(ws, {
        type: "place_session",
        slotUid: slot.value.uid,
        session,
        label: `W${week} D${day}: added "${name}"`,
      });
      return err ?? `Added "${name}" on week ${week} day ${day}. It has no exercises yet.`;
    },
  });

  const clearDay = betaTool({
    name: "clear_day",
    description:
      "Remove the session from a day, turning it back into a rest day. DESTRUCTIVE — the session and its exercises are removed from the draft (the coach previews and confirms this).",
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
      const slot = resolveSlot(ws, week, day);
      if (!slot.ok) return slot.error;
      const err = commitOp(ws, {
        type: "clear_slot",
        slotUid: slot.value.uid,
        label: `W${week} D${day}: removed "${session.value.name}" (now rest)`,
      });
      return err ?? `Week ${week} day ${day} is now a rest day ("${session.value.name}" removed).`;
    },
  });

  const moveSession = betaTool({
    name: "move_session",
    description:
      "Move a session to another day. Moving onto a rest day relocates it; moving onto an occupied day SWAPS the two sessions.",
    inputSchema: {
      type: "object",
      properties: {
        fromWeek: { type: "integer", minimum: 1 },
        fromDay: { type: "integer", minimum: 1, maximum: 7 },
        toWeek: { type: "integer", minimum: 1 },
        toDay: { type: "integer", minimum: 1, maximum: 7 },
      },
      required: ["fromWeek", "fromDay", "toWeek", "toDay"],
      additionalProperties: false,
    } as const,
    run: ({ fromWeek, fromDay, toWeek, toDay }) => {
      const session = resolveSession(ws, fromWeek, fromDay);
      if (!session.ok) return session.error;
      const target = resolveSlot(ws, toWeek, toDay);
      if (!target.ok) return target.error;
      const swapped = target.value.session != null;
      const err = commitOp(ws, {
        type: "move_session",
        sessionUid: session.value.uid,
        targetSlotUid: target.value.uid,
        label: `Moved "${session.value.name}" to W${toWeek} D${toDay}${swapped ? " (swap)" : ""}`,
      });
      return (
        err ??
        `Moved "${session.value.name}" to week ${toWeek} day ${toDay}${swapped ? ` — it swapped places with "${target.value.session?.name}".` : "."}`
      );
    },
  });

  const updateSessionDetails = betaTool({
    name: "update_session_details",
    description:
      "Update a session's fields: name, focus, estimated duration (minutes), calorie surplus % override (null = inherit the program default), or notes. Name/focus are locked in the client editor.",
    inputSchema: {
      type: "object",
      properties: {
        week: { type: "integer", minimum: 1 },
        day: { type: "integer", minimum: 1, maximum: 7 },
        name: { type: "string", minLength: 1, maxLength: 200 },
        focus: { type: ["string", "null"], maxLength: 200 },
        durationMinutes: { type: ["integer", "null"], minimum: 0, maximum: 480 },
        surplusPercentage: { type: ["number", "null"], minimum: 0, maximum: 100 },
        notes: { type: ["string", "null"], maxLength: 1000 },
      },
      required: ["week", "day"],
      additionalProperties: false,
    } as const,
    run: ({ week, day, name, focus, durationMinutes, surplusPercentage, notes }) => {
      const session = resolveSession(ws, week, day);
      if (!session.ok) return session.error;
      const identityTouch = name !== undefined || focus !== undefined;
      if (ws.target === "client-draft" && identityTouch) return IDENTITY_ERROR;
      const patch: Partial<Omit<SessionDraft, "uid" | "exercises">> = {};
      if (name !== undefined) patch.name = name;
      if (focus !== undefined) patch.focus = focus;
      if (durationMinutes !== undefined) patch.estimatedDurationMinutes = durationMinutes;
      if (surplusPercentage !== undefined) patch.calorieSurplusPercentage = surplusPercentage;
      if (notes !== undefined) patch.notes = notes;
      if (Object.keys(patch).length === 0) return "Nothing to change — pass at least one field.";
      const err = commitOp(ws, {
        type: "update_session",
        sessionUid: session.value.uid,
        patch,
        label: `W${week} D${day} "${session.value.name}": updated details`,
      });
      return err ?? `Updated "${session.value.name}" (week ${week} day ${day}).`;
    },
  });

  return [updateProgram, addSession, clearDay, moveSession, updateSessionDetails];
}
