"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Check, Loader2, Pencil, Plus, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { SegmentedControl } from "@/components/programs/shared/segmented-control";
import { cn } from "@/lib/utils";
import { MAX_CHECK_IN_QUESTIONS } from "@/lib/constants";
import {
  FOCUS_RING,
  MONO_LABEL_CLASS,
} from "@/components/clients/training/program-builder/builder-tokens";
import type { CheckInFormEditor } from "./use-check-in-form-editor";

/**
 * The coach's own questions on THIS client's form: order, on/off, wording, and
 * what is on the form at all.
 *
 * Wording is edited HERE but belongs to the bank row, so a reword changes the
 * question everywhere it is asked and relabels every past answer — that is what
 * a question being a row rather than a copied string buys, and the card says so
 * rather than letting a coach discover it.
 */

const ON_OFF = [
  { value: "on", label: "On" },
  { value: "off", label: "Off" },
];

const ICON_BUTTON =
  "rounded p-1 text-[#93b0b4] transition-colors hover:text-[#0d9488] disabled:opacity-40 disabled:hover:text-[#93b0b4]";

function QuestionRow({
  question,
  index,
  total,
  editor,
}: {
  question: { id: string; prompt: string; enabled: boolean };
  index: number;
  total: number;
  editor: CheckInFormEditor;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [isRenaming, setIsRenaming] = useState(false);

  const commitRename = async () => {
    const next = (draft ?? "").trim();
    if (!next || next === question.prompt) {
      setDraft(null);
      return;
    }
    setIsRenaming(true);
    try {
      await editor.renameQuestion(question.id, next);
      setDraft(null);
    } finally {
      setIsRenaming(false);
    }
  };

  if (draft !== null) {
    return (
      <div className="flex items-center gap-2 py-1.5">
        <Input
          autoFocus
          value={draft}
          maxLength={300}
          aria-label={`Reword "${question.prompt}"`}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void commitRename();
            if (event.key === "Escape") setDraft(null);
          }}
          className={cn(FOCUS_RING, "h-8 text-[13px]")}
        />
        <button
          type="button"
          className={ICON_BUTTON}
          aria-label="Save wording"
          disabled={isRenaming}
          onClick={() => void commitRename()}
        >
          {isRenaming ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Check className="h-3.5 w-3.5" strokeWidth={1.5} />
          )}
        </button>
        <button
          type="button"
          className={ICON_BUTTON}
          aria-label="Cancel wording"
          onClick={() => setDraft(null)}
        >
          <X className="h-3.5 w-3.5" strokeWidth={1.5} />
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 py-1.5">
      <span className="min-w-0 flex-1 text-[13px] text-[#0c1a1e]">{question.prompt}</span>
      <div role="group" aria-label={question.prompt} className="shrink-0">
        <SegmentedControl
          options={ON_OFF}
          value={question.enabled ? "on" : "off"}
          onChange={() => editor.toggleQuestion(question.id)}
        />
      </div>
      <button
        type="button"
        className={ICON_BUTTON}
        aria-label={`Move "${question.prompt}" up`}
        disabled={index === 0}
        onClick={() => editor.moveQuestion(question.id, -1)}
      >
        <ArrowUp className="h-3.5 w-3.5" strokeWidth={1.5} />
      </button>
      <button
        type="button"
        className={ICON_BUTTON}
        aria-label={`Move "${question.prompt}" down`}
        disabled={index === total - 1}
        onClick={() => editor.moveQuestion(question.id, 1)}
      >
        <ArrowDown className="h-3.5 w-3.5" strokeWidth={1.5} />
      </button>
      <button
        type="button"
        className={ICON_BUTTON}
        aria-label={`Reword "${question.prompt}"`}
        onClick={() => setDraft(question.prompt)}
      >
        <Pencil className="h-3.5 w-3.5" strokeWidth={1.5} />
      </button>
      <button
        type="button"
        className={cn(ICON_BUTTON, "hover:text-[#c06060]")}
        aria-label={`Remove "${question.prompt}" from this form`}
        onClick={() => editor.removeQuestion(question.id)}
      >
        <X className="h-3.5 w-3.5" strokeWidth={1.5} />
      </button>
    </div>
  );
}

function AddQuestionPopover({ editor }: { editor: CheckInFormEditor }) {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  const onForm = new Set(editor.questions.map((q) => q.id));
  const available = editor.bank.filter((q) => !onForm.has(q.id));
  const isFull = editor.questions.length >= MAX_CHECK_IN_QUESTIONS;

  const create = async () => {
    const next = prompt.trim();
    if (!next || isFull) return;
    setIsCreating(true);
    try {
      await editor.createQuestion(next);
      setPrompt("");
      setOpen(false);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={isFull}
          title={
            isFull
              ? `A form can ask at most ${MAX_CHECK_IN_QUESTIONS} questions`
              : undefined
          }
          className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-[6px] border border-dashed border-[rgba(13,148,136,0.25)] py-2 text-xs font-medium text-[#5a7d82] transition-colors hover:border-[#0d9488] hover:bg-[rgba(13,148,136,0.05)] hover:text-[#0a5c55] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-[rgba(13,148,136,0.25)] disabled:hover:bg-transparent disabled:hover:text-[#5a7d82]"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
          Add question
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={6}
        className="w-[320px] rounded-[6px] border-[rgba(13,148,136,0.08)] p-0"
      >
        <div className="px-3.5 pb-2 pt-3">
          <p className="text-sm font-semibold text-[#0c1a1e]">Add a question</p>
          <div className="mt-2 flex items-center gap-2">
            <Input
              value={prompt}
              maxLength={300}
              placeholder="Ask something new…"
              aria-label="New question"
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void create();
              }}
              className={cn(FOCUS_RING, "h-8 text-[13px]")}
            />
            <button
              type="button"
              disabled={prompt.trim() === "" || isCreating}
              onClick={() => void create()}
              className="shrink-0 rounded p-1 text-[13px] font-medium text-[#0d9488] transition-colors hover:text-[#0b7f75] disabled:opacity-40"
            >
              {isCreating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                "Add"
              )}
            </button>
          </div>
        </div>

        <div className="border-t border-[rgba(13,148,136,0.06)] px-1.5 pb-1.5 pt-1.5">
          <p className={cn(MONO_LABEL_CLASS, "px-2 pb-1 normal-case tracking-normal")}>
            {available.length > 0
              ? "Or reuse one you have written"
              : "No other saved questions"}
          </p>
          <div className="max-h-[200px] overflow-y-auto">
            {available.map((question) => (
              <button
                key={question.id}
                type="button"
                onClick={() => {
                  editor.addExistingQuestion(question);
                  setOpen(false);
                }}
                className="w-full rounded-[4px] px-2.5 py-1.5 text-left text-[13px] text-[#0c1a1e] transition-colors hover:bg-[rgba(13,148,136,0.05)] hover:text-[#0a5c55]"
              >
                {question.prompt}
              </button>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function CheckInFormQuestionsCard({ editor }: { editor: CheckInFormEditor }) {
  return (
    <div className="mb-5 rounded-[6px] bg-white px-[18px] py-4">
      {editor.questions.length === 0 ? (
        <p className="text-[13px] text-[#93b0b4]">
          No questions yet. Anything you add is asked at the end of the first step
          of their check-in.
        </p>
      ) : (
        <div className="flex flex-col">
          {editor.questions.map((question, index) => (
            <QuestionRow
              key={question.id}
              question={question}
              index={index}
              total={editor.questions.length}
              editor={editor}
            />
          ))}
        </div>
      )}

      <AddQuestionPopover editor={editor} />

      <p className="mt-2.5 text-[11px] text-[#93b0b4]">
        Rewording a question changes it everywhere it is asked, including the
        label above every answer already given — it is the same question.
      </p>
    </div>
  );
}
