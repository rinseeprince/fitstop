"use client";

import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { CheckInCustomAnswerInput, CheckInFormQuestion } from "@/types/check-in";

type CustomQuestionsSectionProps = {
  questions: CheckInFormQuestion[];
  answers: CheckInCustomAnswerInput[];
  onChange: (answers: CheckInCustomAnswerInput[]) => void;
};

/**
 * The coach's own questions, at the end of the first step.
 *
 * Answers are keyed by `questionId`, never by position: the coach can reorder,
 * disable or remove a question between the day a draft is saved and the day it
 * is submitted, and an index would silently attach an answer to the wrong
 * question. Anything the form no longer asks is dropped by `applyCheckInForm`
 * on both sides of the wire.
 *
 * Every question is optional. A blank answer is an unanswered question, not a
 * validation error — the schema accepts it and the strip drops it.
 */
export const CustomQuestionsSection = ({
  questions,
  answers,
  onChange,
}: CustomQuestionsSectionProps) => {
  if (questions.length === 0) return null;

  const valueFor = (questionId: string) =>
    answers.find((a) => a.questionId === questionId)?.answer ?? "";

  const setAnswer = (questionId: string, answer: string) => {
    const rest = answers.filter((a) => a.questionId !== questionId);
    onChange(answer === "" ? rest : [...rest, { questionId, answer }]);
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold mb-1">Your coach asked</h3>
        <p className="text-sm text-muted-foreground">
          {questions.length === 1
            ? "One question from your coach (optional)"
            : "Questions from your coach (all optional)"}
        </p>
      </div>

      {questions.map((question) => (
        <div key={question.id} className="space-y-3">
          <Label htmlFor={`question-${question.id}`} className="text-muted-foreground">
            {question.prompt}
          </Label>
          <Textarea
            id={`question-${question.id}`}
            value={valueFor(question.id)}
            onChange={(e) => setAnswer(question.id, e.target.value)}
            rows={3}
            maxLength={2000}
            className="resize-none"
          />
        </div>
      ))}
    </div>
  );
};
