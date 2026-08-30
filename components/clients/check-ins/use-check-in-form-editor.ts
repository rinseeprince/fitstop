"use client";

import { useCallback, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import {
  useCheckInFormTemplates,
  useCheckInQuestions,
  useInvalidateCheckInFormTemplates,
  useInvalidateCheckInQuestions,
  useInvalidateClientCheckInForm,
} from "@/hooks/use-check-in-form-config";
import { MAX_CHECK_IN_QUESTIONS } from "@/lib/constants";
import type { CheckInFormFieldKey } from "@/lib/check-in/form-fields";
import type {
  CheckInFormEditorConfig,
  CheckInFormEditorQuestion,
  CheckInFormTemplate,
} from "@/types/check-in";

/**
 * The coach's check-in-form editor: what is on screen while the sheet is open,
 * and the three writes that leave it.
 *
 * **It takes the saved form as a PROP and initialises state from it once.** It
 * does not fetch it, does not know whether the sheet is open, and holds no
 * "have I seeded yet?" flag — its owner mounts it only once the form has
 * loaded, and Radix unmounts the sheet's content on close, so one editor
 * lifetime IS one open. That is what makes "seeded once, a revalidation can
 * never clobber edits in progress" a structural fact rather than a flag.
 *
 * It replaced an effect + `useRef` latch that seeded on `[open, form]`
 * transitions, and the difference is not stylistic. `seeded` was a REF, and the
 * sheet's spinner was computed from it during render — so flipping it scheduled
 * no render. The spinner only ever cleared as a SIDE EFFECT of the four
 * setState calls beside it changing something. On a second open the saved form
 * came back from the SWR cache as the SAME OBJECT, all four setters bailed out
 * on `Object.is`, nothing re-rendered, and the sheet spun forever over a
 * correctly-loaded form. Render-visible state does not live in a ref.
 *
 * **Nothing here touches a `clients` column.** The form lives in its own tables
 * precisely so a save cannot reach `updateClientCheckInConfig`, which is a full
 * replace of the four scheduling columns and would clear `next_check_in_due`
 * (ARCHITECTURE → "Two writers, and only two").
 */

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
  initialForm,
  onClose,
}: {
  clientId: string;
  /** The client's saved form. Read by the panel; this hook never fetches it. */
  initialForm: CheckInFormEditorConfig;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const { questions: bank, isError: isBankError } = useCheckInQuestions();
  const { templates, isError: isTemplatesError } = useCheckInFormTemplates();
  const invalidateForm = useInvalidateClientCheckInForm();
  const invalidateBank = useInvalidateCheckInQuestions();
  const invalidateTemplates = useInvalidateCheckInFormTemplates();

  // Initialised ONCE from the prop, by construction — see the header.
  const [fields, setFields] = useState<CheckInFormFieldKey[]>(
    () => initialForm.fields as CheckInFormFieldKey[]
  );
  const [questions, setQuestions] = useState<CheckInFormEditorQuestion[]>(
    () => initialForm.questions
  );
  const [isSaving, setIsSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  // Which template the current state came from. Cleared by the first edit,
  // because after one toggle the state is no longer that template — and that
  // is what lets a coach re-apply the same one to start over.
  const [appliedTemplateId, setAppliedTemplateId] = useState<string | null>(null);

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

  /**
   * Drag-and-drop reorder — the `onReorderExercise` shape (active id over
   * target id), because it is the same gesture the program builder's exercise
   * list uses and one kernel per gesture beats two spellings.
   */
  const reorderQuestion = useCallback(
    (activeId: string, overId: string) =>
      edit(() =>
        setQuestions((prev) => {
          const from = prev.findIndex((q) => q.id === activeId);
          const to = prev.findIndex((q) => q.id === overId);
          if (from === -1 || to === -1 || from === to) return prev;
          const next = [...prev];
          const [moved] = next.splice(from, 1);
          next.splice(to, 0, moved);
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
   * list is local state initialised at mount, so an invalidate-only version
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
    setIsSaving(true);
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
      setIsSaving(false);
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
      setIsSaving(true);
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
        setIsSaving(false);
      }
    },
    [invalidateTemplates, payload, toast]
  );

  return {
    fields,
    questions,
    bank,
    templates,
    // The two secondary reads get their own error surfaces rather than being
    // dropped. A failing bank used to hold the whole sheet's spinner with no
    // way out; now it can only empty its own popover.
    isBankError,
    isTemplatesError,
    appliedTemplateId,
    isDirty,
    isSaving,
    toggleField,
    toggleQuestion,
    reorderQuestion,
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
