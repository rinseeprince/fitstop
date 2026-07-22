import { z } from "zod";
import { setSpecSchema } from "./training";
import type { DraftOp } from "@/components/clients/training/program-builder/program-builder-ops";

// AI draft-assistant wire schemas (builder S6a).
//
// The SNAPSHOT schemas mirror the builder's in-memory ProgramDraft tree and are
// deliberately LENIENT where the draft itself is (no .url() on videoUrl, no
// all-warmup refine): the snapshot is a read of client state, and rejecting a
// draft the builder legally holds would brick the assistant on that program.
// Authoring invariants (≥1 working set, catalog-resolved adds) are enforced at
// the TOOL layer, where the model can be told what to fix. Structural caps
// (7 days/week, ≤52 weeks, ≤30 specs) stay hard — they are what applyDraftOp's
// replay determinism depends on (normalizeDraft must never pad-mint uids).
//
// The OP schemas re-validate the assistant response on the CLIENT before
// replay — a belt so nothing malformed ever reaches the draft reducer.

const uidSchema = z.string().min(1).max(64);

const setSpecsSnapshotSchema = z.array(setSpecSchema).min(1).max(30);

export const exerciseDraftSnapshotSchema = z.object({
  uid: uidSchema,
  exerciseId: z.string().uuid().nullable(),
  name: z.string().min(1).max(200),
  setSpecs: setSpecsSnapshotSchema.nullable(),
  sets: z.number().int().min(1).max(20),
  repsMin: z.number().int().min(0).max(100).nullable(),
  repsMax: z.number().int().min(0).max(100).nullable(),
  repsTarget: z.string().max(20).nullable(),
  rpeTarget: z.number().min(0).max(10).nullable(),
  percentage1rm: z.number().min(0).max(100).nullable(),
  tempo: z.string().max(20).nullable(),
  restSeconds: z.number().int().min(0).max(3600).nullable(),
  supersetGroup: z.string().max(10).nullable(),
  isWarmup: z.boolean(),
  notes: z.string().max(500).nullable(),
  videoUrl: z.string().max(500).nullable(),
});

export const sessionDraftSnapshotSchema = z.object({
  uid: uidSchema,
  name: z.string().min(1).max(200),
  focus: z.string().max(200).nullable(),
  estimatedDurationMinutes: z.number().int().min(0).max(480).nullable(),
  calorieSurplusPercentage: z.number().min(0).max(100).nullable(),
  notes: z.string().max(1000).nullable(),
  sessionType: z.string().max(50),
  exercises: z.array(exerciseDraftSnapshotSchema).max(50),
});

const daySlotSnapshotSchema = z.object({
  uid: uidSchema,
  orderIndex: z.number().int().min(0).max(6),
  isRest: z.boolean(),
  session: sessionDraftSnapshotSchema.nullable(),
});

export const weekDraftSnapshotSchema = z.object({
  uid: uidSchema,
  weekIndex: z.number().int().min(0).max(51),
  // Exactly 7 — a short week would make normalizeDraft pad-mint slot uids,
  // and those would differ between the server's copy and the client's draft.
  days: z.array(daySlotSnapshotSchema).length(7),
});

export const programDraftSnapshotSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200),
  description: z.string().max(1000).nullable(),
  status: z.enum(["draft", "saved"]),
  splitType: z.string().max(100).nullable(),
  programDurationWeeks: z.number().int().min(1).max(52).nullable(),
  defaultSurplusPercentage: z.number().min(0).max(100).nullable(),
  weeks: z.array(weekDraftSnapshotSchema).min(1).max(52),
});

// --- DraftOp union (client-side re-validation of the assistant response) ---

const opLabel = z.string().max(200).optional();

const programMetaPatchSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(1000).nullable().optional(),
    splitType: z.string().max(100).nullable().optional(),
    defaultSurplusPercentage: z.number().min(0).max(100).nullable().optional(),
  })
  .strict();

const sessionPatchSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    focus: z.string().max(200).nullable().optional(),
    estimatedDurationMinutes: z.number().int().min(0).max(480).nullable().optional(),
    calorieSurplusPercentage: z.number().min(0).max(100).nullable().optional(),
    notes: z.string().max(1000).nullable().optional(),
    sessionType: z.string().max(50).optional(),
  })
  .strict();

const exercisePatchSchema = z
  .object({
    exerciseId: z.string().uuid().nullable().optional(),
    name: z.string().min(1).max(200).optional(),
    setSpecs: setSpecsSnapshotSchema.nullable().optional(),
    sets: z.number().int().min(1).max(20).optional(),
    repsMin: z.number().int().min(0).max(100).nullable().optional(),
    repsMax: z.number().int().min(0).max(100).nullable().optional(),
    repsTarget: z.string().max(20).nullable().optional(),
    rpeTarget: z.number().min(0).max(10).nullable().optional(),
    percentage1rm: z.number().min(0).max(100).nullable().optional(),
    tempo: z.string().max(20).nullable().optional(),
    restSeconds: z.number().int().min(0).max(3600).nullable().optional(),
    supersetGroup: z.string().max(10).nullable().optional(),
    isWarmup: z.boolean().optional(),
    notes: z.string().max(500).nullable().optional(),
    videoUrl: z.string().max(500).nullable().optional(),
  })
  .strict();

// An exercise the ASSISTANT introduces must carry a catalog identity — this is
// the wire-level belt of the Phase-6 catalog constraint (the tool layer already
// resolved the name; an unresolved add can't even be constructed).
const aiAddedExerciseSchema = exerciseDraftSnapshotSchema.extend({
  exerciseId: z.string().uuid(),
});

export const draftOpSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("set_program_meta"),
    patch: programMetaPatchSchema,
    label: opLabel,
  }),
  z.object({
    type: z.literal("insert_week"),
    afterWeekUid: uidSchema.nullable(),
    week: weekDraftSnapshotSchema,
    label: opLabel,
  }),
  z.object({ type: z.literal("remove_week"), weekUid: uidSchema, label: opLabel }),
  z.object({
    type: z.literal("move_week"),
    weekUid: uidSchema,
    toIndex: z.number().int().min(0).max(51),
    label: opLabel,
  }),
  z.object({
    type: z.literal("place_session"),
    slotUid: uidSchema,
    session: sessionDraftSnapshotSchema,
    label: opLabel,
  }),
  z.object({ type: z.literal("clear_slot"), slotUid: uidSchema, label: opLabel }),
  z.object({
    type: z.literal("move_session"),
    sessionUid: uidSchema,
    targetSlotUid: uidSchema,
    label: opLabel,
  }),
  z.object({
    type: z.literal("update_session"),
    sessionUid: uidSchema,
    patch: sessionPatchSchema,
    label: opLabel,
  }),
  z.object({
    type: z.literal("add_exercise"),
    sessionUid: uidSchema,
    exercise: aiAddedExerciseSchema,
    label: opLabel,
  }),
  z.object({
    type: z.literal("update_exercise"),
    sessionUid: uidSchema,
    exerciseUid: uidSchema,
    patch: exercisePatchSchema,
    label: opLabel,
  }),
  z.object({
    type: z.literal("remove_exercise"),
    sessionUid: uidSchema,
    exerciseUid: uidSchema,
    label: opLabel,
  }),
  z.object({
    type: z.literal("reorder_exercise"),
    sessionUid: uidSchema,
    exerciseUid: uidSchema,
    toIndex: z.number().int().min(0).max(49),
    label: opLabel,
  }),
]);

// Compile-time parity belt: every schema-valid op must be a DraftOp. (The
// reverse direction — every DraftOp shape has a schema arm — is covered by the
// round-trip fixture test.)
type _SchemaOpIsDraftOp = z.infer<typeof draftOpSchema> extends DraftOp ? true : never;
const _schemaOpIsDraftOp: _SchemaOpIsDraftOp = true;
void _schemaOpIsDraftOp;

// --- Request / response ---

export const assistantTranscriptEntrySchema = z.object({
  role: z.enum(["user", "assistant"]),
  text: z.string().max(4000),
});

export const assistantChatRequestSchema = z
  .object({
    target: z.enum(["library", "client-draft", "placed-plan"]),
    // Present (and IDOR-checked by the route) for the client-scoped editors.
    clientId: z.string().uuid().optional(),
    // Placed-plan only: the client-side training_plans id (the route verifies
    // it belongs to clientId) and the serialized lock set — the same array the
    // amendment surface computed at seed, so server executors and client
    // replay refuse the same history. 400 slots = 52 weeks × 7 + headroom.
    planId: z.string().uuid().optional(),
    lockedSlotUids: z.array(z.string().min(1).max(64)).max(400).optional(),
    command: z.string().min(1).max(2000),
    transcript: z.array(assistantTranscriptEntrySchema).max(24),
    draft: programDraftSnapshotSchema,
  })
  .refine((body) => body.target !== "client-draft" || body.clientId != null, {
    message: "clientId is required for the client editor",
  })
  .refine(
    (body) =>
      body.target !== "placed-plan" ||
      (body.clientId != null && body.planId != null && body.lockedSlotUids != null),
    {
      message:
        "clientId, planId and lockedSlotUids are required for the placed-plan editor",
    },
  )
  .refine(
    (body) =>
      body.target === "placed-plan" ||
      (body.planId == null && body.lockedSlotUids == null),
    {
      message: "planId and lockedSlotUids are only valid for the placed-plan editor",
    },
  );

export type AssistantChatRequest = z.infer<typeof assistantChatRequestSchema>;

export type AssistantChatResponseData = {
  assistantText: string;
  ops: DraftOp[];
  // Executor-level notes the coach should see (skipped edits, sweep discards).
  skipped: string[];
  stopReason: "done" | "max_iterations";
};
