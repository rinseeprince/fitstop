"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import {
  useCheckInFormTemplates,
  useCheckInQuestions,
  useClientCheckInForm,
  useInvalidateCheckInFormTemplates,
  useInvalidateCheckInQuestions,
  useInvalidateClientCheckInForm,
} from "@/hooks/use-check-in-form-config";
import { MAX_CHECK_IN_QUESTIONS } from "@/lib/constants";
import type { CheckInFormFieldKey } from "@/lib/check-in/form-fields";
import type {
  CheckInFormEditorQuestion,
  CheckInFormTemplate,
} from "@/types/check-in";

/**
 * The coach's check-in-form editor: what is on screen while the sheet is open,
 * and the three writes that leave it.
 *
 * **Seeded ONCE per open.** The draft is local state; a background
 * revalidation must not clobber edits in progress (the program builder's rule).
 * Re-opening the sheet re-seeds from the server, so Cancel really discards.
 *
 * **Nothing here touches a `clients` column.** The form lives in its own tables
 * precisely so a save cannot reach `updateClientCheckInConfig`, which is a full
 * replace of the four scheduling columns and would clear `next_check_in_due`
 * (ARCHITECTURE → "Two writers, and only two").
 */

type SaveState = "idle" | "saving";

async function writeJson(
  url: string,
  method: "POST" | "PUT" | "PATCH",
  body: unknown
): Promise<unknown> {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await res.json()) as { success?: boolean; error?: string; data?: unknown };
  if (!res.ok || !payload.success) {
    throw new Error(payload.error || "Request failed");
  }
  return payload.data;
}

export function useCheckInFormEditor({
  clientId,
  open,
  onClose,
}: {
  clientId: string;
  open: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const { form, isLoading, isError } = useClientCheckInForm(clientId, open);
  const { questions: bank, isLoading: isBankLoading } = useCheckInQuestions(open);
  const { templates } = useCheckInFormTemplates(open);
  const invalidateForm = useInvalidateClientCheckInForm();
  const invalidateBank = useInvalidateCheckInQuestions();
  const invalidateTemplates = useInvalidateCheckInFormTemplates();

  const [fields, setFields] = useState<CheckInFormFieldKey[]>([]);
  const [questions, setQuestions] = useState<CheckInFormEditorQuestion[]>([]);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [isDirty, setIsDirty] = useState(false);
  // Which template the current state came from. Cleared by the first edit,
  // because after one toggle the state is no longer that template — and that
  // is what lets a coach re-apply the same one to start over.
  const [appliedTemplateId, setAppliedTemplateId] = useState<string | null>(null);
  const seeded = useRef(false);

  useEffect(() => {
    if (!open) {
      seeded.current = false;
      return;
    }
    if (seeded.current || !form) return;
    setFields(form.fields as CheckInFormFieldKey[]);
    setQuestions(form.questions);
    setIsDirty(false);
    setAppliedTemplateId(null);
    seeded.current = true;
  }, [open, form]);

  /** Every mutator routes through this, so nothing can edit without marking. */
  const edit = useCallback((mutate: () => void) => {
    mutate();
    setIsDirty(true);
    setAppliedTemplateId(null);
  }, []);

  const toggleField = useCallback(
    (key: CheckInFormFieldKey) =>
      edit(() =>
        setFields((prev) =>
          prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
        )
      ),
    [edit]
  );

  const toggleQuestion = useCallback(
    (questionId: string) =>
      edit(() =>
        setQuestions((prev) =>
          prev.map((q) => (q.id === questionId ? { ...q, enabled: !q.enabled } : q))
        )
      ),
    [edit]
  );

  const moveQuestion = useCallback(
    (questionId: string, direction: -1 | 1) =>
      edit(() =>
        setQuestions((prev) => {
          const index = prev.findIndex((q) => q.id === questionId);
          const target = index + direction;
          if (index === -1 || target < 0 || target >= prev.length) return prev;
          const next = [...prev];
          [next[index], next[target]] = [next[target], next[index]];
          return next;
        })
      ),
    [edit]
  );

  const removeQuestion = useCallback(
    (questionId: string) =>
      edit(() => setQuestions((prev) => prev.filter((q) => q.id !== questionId))),
    [edit]
  );

  /** Put an existing bank question on this form, at the end. */
  const addExistingQuestion = useCallback(
    (question: { id: string; prompt: string }) =>
      edit(() =>
        setQuestions((prev) =>
          prev.some((q) => q.id === question.id) || prev.length >= MAX_CHECK_IN_QUESTIONS
            ? prev
            : [...prev, { id: question.id, prompt: question.prompt, enabled: true }]
        )
      ),
    [edit]
  );

  /** Mint a bank question and put it on this form. The bank write is immediate;
   *  the form membership is not, and lands with Save changes. */
  const createQuestion = useCallback(
    async (prompt: string) => {
      const data = (await writeJson("/api/check-ins/questions", "POST", { prompt })) as {
        question: { id: string; prompt: string };
      };
      await invalidateBank();
      addExistingQuestion(data.question);
    },
    [addExistingQuestion, invalidateBank]
  );

  /**
   * Reword one bank question.
   *
   * It updates the LOCAL row as well as revalidating the bank. The editor's
   * list is local state seeded once per open, so an invalidate-only version
   * would leave the old wording on screen until the sheet was reopened — while
   * the card's own sentence promises the change lands everywhere. Same shape as
   * the stale Share draft C4 fixed.
   *
   * Not an `edit()`: the bank row is already written, so this does not make the
   * FORM dirty and must not discard the applied-template marker.
   */
  const renameQuestion = useCallback(
    async (questionId: string, prompt: string) => {
      await writeJson(`/api/check-ins/questions/${questionId}`, "PATCH", { prompt });
      setQuestions((prev) =>
        prev.map((q) => (q.id === questionId ? { ...q, prompt } : q))
      );
      await invalidateBank();
    },
    [invalidateBank]
  );

  /**
   * Apply a template: a COPY into the editor, exactly like every other library
   * object here. Nothing is written until Save changes — a template is a
   * starting point the coach reviews, which is why there is no server-side
   * apply route.
   */
  const applyTemplate = useCallback((template: CheckInFormTemplate) => {
    setFields(template.fields as CheckInFormFieldKey[]);
    setQuestions(template.questions.map((q) => ({ ...q })));
    setIsDirty(true);
    setAppliedTemplateId(template.id);
  }, []);

  const payload = useCallback(
    () => ({
      fields,
      questions: questions.map((q) => ({ questionId: q.id, enabled: q.enabled })),
    }),
    [fields, questions]
  );

  const save = useCallback(async () => {
    setSaveState("saving");
    try {
      await writeJson(`/api/clients/${clientId}/check-in-form`, "PUT", payload());
      await invalidateForm(clientId);
      toast({ title: "Check-in form saved" });
      onClose();
    } catch (error) {
      toast({
        title: "Save failed",
        description: error instanceof Error ? error.message : "Could not save the form",
        variant: "destructive",
      });
    } finally {
      setSaveState("idle");
    }
  }, [clientId, invalidateForm, onClose, payload, toast]);

  /**
   * Save the editor's CURRENT state as a template — unsaved edits included.
   * Deliberate: a coach shaping a form and banking it before committing it to
   * this client is the gesture. The consequence is that a template can exist
   * from a state this client's form never had.
   */
  const saveAsTemplate = useCallback(
    async (name: string) => {
      setSaveState("saving");
      try {
        await writeJson("/api/check-ins/forms", "POST", { name, ...payload() });
        await invalidateTemplates();
        toast({ title: `"${name}" saved to your templates` });
      } catch (error) {
        toast({
          title: "Save failed",
          description:
            error instanceof Error ? error.message : "Could not save the template",
          variant: "destructive",
        });
        throw error;
      } finally {
        setSaveState("idle");
      }
    },
    [invalidateTemplates, payload, toast]
  );

  return {
    // `!seeded` covers the gap between the fetch settling and the effect
    // running — but never when the read FAILED, or a failed GET would spin
    // forever instead of reaching the error state.
    isLoading: !isError && (isLoading || isBankLoading || (open && !seeded.current)),
    isError,
    fields,
    questions,
    bank,
    templates,
    appliedTemplateId,
    isDirty,
    isSaving: saveState === "saving",
    toggleField,
    toggleQuestion,
    moveQuestion,
    removeQuestion,
    addExistingQuestion,
    createQuestion,
    renameQuestion,
    applyTemplate,
    save,
    saveAsTemplate,
  };
}

export type CheckInFormEditor = ReturnType<typeof useCheckInFormEditor>;
