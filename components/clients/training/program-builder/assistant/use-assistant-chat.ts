"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import {
  draftOpSchema,
  type AssistantChatResponseData,
} from "@/lib/validations/assistant";
import type { ProgramDraft } from "../program-builder-types";
import {
  isDestructiveOp,
  type DraftOp,
} from "../program-builder-ops";
import { useProgramDraft } from "../program-draft-provider";

// Chat state for the AI draft assistant (builder S6a). Owns the transcript,
// the bounded undo stack, and the two apply paths:
// - auto-apply for ordinary turns (ops replay immediately through the
//   provider's applyAssistantOps — one revision bump, same semantics as a
//   hand edit);
// - preview gating when a turn contains destructive ops (week deletes, day
//   clears) OR the coach edited mid-turn (revision drift): ops render as
//   chips with Apply all / Dismiss so surprises never auto-land.
// Chat state dies with the provider remount (template switch) by design —
// the conversation is about THIS draft.

export type AssistantChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  applied?: number;
  skipped?: string[];
};

export type PendingAssistantOps = {
  ops: DraftOp[];
  reason: "destructive" | "drift";
  labels: string[];
  assistantText: string;
};

const UNDO_DEPTH = 10;

const opFallbackLabel: Record<DraftOp["type"], string> = {
  set_program_meta: "Update program details",
  insert_week: "Insert a week",
  remove_week: "Delete a week",
  move_week: "Move a week",
  place_session: "Add a session",
  clear_slot: "Clear a day to rest",
  move_session: "Move a session",
  update_session: "Update a session",
  add_exercise: "Add an exercise",
  update_exercise: "Update an exercise",
  remove_exercise: "Remove an exercise",
  reorder_exercise: "Reorder an exercise",
};

export const opLabelText = (op: DraftOp): string =>
  op.label ?? opFallbackLabel[op.type];

export function useAssistantChat() {
  const {
    target,
    clientId,
    mode,
    isSaving,
    assistantBusy,
    setAssistantBusy,
    getDraft,
    getDirty,
    getRevision,
    replaceDraft,
    restoreDirty,
    applyAssistantOps,
  } = useProgramDraft();

  const [messages, setMessages] = useState<AssistantChatMessage[]>([]);
  const [pending, setPending] = useState<PendingAssistantOps | null>(null);
  const undoStackRef = useRef<Array<{ draft: ProgramDraft; dirty: boolean }>>([]);
  const [undoDepth, setUndoDepth] = useState(0);
  // Latest-value mirror: send()'s closure captures `mode` at call time, but the
  // coach can leave edit mode (Cancel editing / Discard changes) while a turn is
  // in flight, and ops must never auto-apply into a view-mode tree.
  const modeRef = useRef(mode);
  modeRef.current = mode;
  // A save that COMPLETED between an AI edit and an undo means the DB holds the
  // AI-edited tree; restoring the pre-AI snapshot as "clean" would disarm the
  // leave guards over a tree that no longer matches what was persisted.
  const savedSinceUndoEntryRef = useRef(false);

  const pushMessage = useCallback((message: Omit<AssistantChatMessage, "id">) => {
    setMessages((prev) => [...prev, { ...message, id: crypto.randomUUID() }]);
  }, []);

  // The tree is immutable — holding the pre-apply reference IS the snapshot.
  const applyOps = useCallback(
    (ops: DraftOp[]): { applied: number; skipped: string[] } => {
      const before = getDraft();
      const wasDirty = getDirty();
      const result = applyAssistantOps(ops, { target });
      if (!result) return { applied: 0, skipped: ["The program isn't loaded yet"] };
      // Snapshot AFTER the fact and only when something actually changed: a
      // turn whose ops all skipped leaves the tree untouched, and an undo entry
      // for it would later revert the coach's own subsequent manual edits under
      // the label "Undo the last AI edit".
      if (before && result.draft !== before) {
        undoStackRef.current = [
          ...undoStackRef.current.slice(-(UNDO_DEPTH - 1)),
          { draft: before, dirty: wasDirty },
        ];
        setUndoDepth(undoStackRef.current.length);
        savedSinceUndoEntryRef.current = false;
      }
      return {
        applied: result.applied,
        skipped: result.skipped.map((s) => s.reason),
      };
    },
    [applyAssistantOps, getDirty, getDraft, target],
  );

  // Any completed save invalidates the "restore the old clean flag" shortcut.
  useEffect(() => {
    if (isSaving) savedSinceUndoEntryRef.current = true;
  }, [isSaving]);

  const send = useCallback(
    async (command: string) => {
      const trimmed = command.trim();
      const draft = getDraft();
      if (!trimmed || !draft || assistantBusy || isSaving || mode !== "edit") return;

      pushMessage({ role: "user", text: trimmed });
      setAssistantBusy(true);
      const sentRevision = getRevision();
      // Reference identity catches what the counter can't: seed() (Discard
      // changes / Discard draft) replaces the whole tree WITHOUT bumping the
      // revision, so a mid-turn discard would otherwise read as "no drift" and
      // the turn's ops would auto-apply onto the freshly reverted tree.
      const sentDraft = draft;
      // Text-only prior turns; the fresh snapshot supersedes old tool traffic.
      const transcript = messages
        .slice(-24)
        .map((m) => ({ role: m.role, text: m.text.slice(0, 4000) }));

      try {
        const res = await fetch("/api/training/assistant", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            target,
            clientId: target === "client-draft" ? (clientId ?? undefined) : undefined,
            command: trimmed,
            transcript,
            draft,
          }),
        });

        if (!res.ok) {
          pushMessage({
            role: "assistant",
            text:
              res.status === 429
                ? "I need a short breather — you've hit the assistant's rate limit. Try again in a few minutes."
                : "Something went wrong on my side — your program is untouched. Try again.",
          });
          return;
        }

        const json = (await res.json()) as { success?: boolean; data?: AssistantChatResponseData };
        const data = json.data;
        // Belt: re-validate the op stream before anything touches the draft.
        const parsedOps = z.array(draftOpSchema).safeParse(data?.ops ?? []);
        if (!data || !parsedOps.success) {
          pushMessage({
            role: "assistant",
            text: "I got a malformed response back, so I didn't touch your program. Try again.",
          });
          return;
        }
        const ops = parsedOps.data as DraftOp[];
        const serverNotes = data.skipped;

        const drift =
          getRevision() !== sentRevision ||
          getDraft() !== sentDraft ||
          modeRef.current !== "edit";
        const destructive = ops.some(isDestructiveOp);
        if (ops.length > 0 && (drift || destructive)) {
          setPending({
            ops,
            reason: destructive ? "destructive" : "drift",
            labels: ops.map(opLabelText),
            assistantText: data.assistantText,
          });
          pushMessage({
            role: "assistant",
            text: data.assistantText,
            skipped: serverNotes,
          });
          return;
        }

        if (ops.length > 0) {
          const result = applyOps(ops);
          pushMessage({
            role: "assistant",
            text:
              data.stopReason === "max_iterations"
                ? `${data.assistantText}\n\n(I stopped at my step limit — ask me to continue.)`
                : data.assistantText,
            applied: result.applied,
            skipped: [...serverNotes, ...result.skipped],
          });
        } else {
          pushMessage({ role: "assistant", text: data.assistantText, skipped: serverNotes });
        }
      } catch {
        pushMessage({
          role: "assistant",
          text: "I couldn't reach the server — your program is untouched. Check your connection and try again.",
        });
      } finally {
        setAssistantBusy(false);
      }
    },
    [
      applyOps,
      assistantBusy,
      clientId,
      getDraft,
      getRevision,
      isSaving,
      messages,
      mode,
      pushMessage,
      setAssistantBusy,
      target,
    ],
  );

  const applyPending = useCallback(() => {
    if (!pending) return;
    const result = applyOps(pending.ops);
    setPending(null);
    pushMessage({
      role: "assistant",
      text: `Applied ${result.applied} edit${result.applied === 1 ? "" : "s"}.`,
      applied: result.applied,
      skipped: result.skipped,
    });
  }, [applyOps, pending, pushMessage]);

  const dismissPending = useCallback(() => {
    if (!pending) return;
    setPending(null);
    pushMessage({ role: "assistant", text: "Okay — I discarded those edits. Nothing changed." });
  }, [pending, pushMessage]);

  // Wholesale restore through apply() (revision bumps — markSaved stays
  // honest) + the snapshotted dirty flag. Also reverts manual edits made
  // since the snapshot; the UI labels that.
  const undo = useCallback(() => {
    if (assistantBusy || isSaving) return;
    const entry = undoStackRef.current.pop();
    setUndoDepth(undoStackRef.current.length);
    if (!entry) return;
    replaceDraft(entry.draft);
    // If a save landed since this entry was captured, the persisted tree now
    // holds the AI edit — the restored tree DIFFERS from it, so it must stay
    // dirty (restoring a stale clean flag would disarm the leave guards and
    // the coach would exit believing the undo persisted).
    restoreDirty(savedSinceUndoEntryRef.current || entry.dirty);
    pushMessage({ role: "assistant", text: "Undone — the program is back to how it was before that edit." });
  }, [assistantBusy, isSaving, pushMessage, replaceDraft, restoreDirty]);

  return {
    messages,
    pending,
    send,
    applyPending,
    dismissPending,
    undo,
    canUndo: undoDepth > 0 && !assistantBusy && !isSaving,
    busy: assistantBusy,
  };
}
