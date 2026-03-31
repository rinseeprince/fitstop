"use client";

import { useState } from "react";
import { X } from "lucide-react";
import type { Milestone } from "@/types/roadmap";

type MilestoneInputListProps = {
  milestones: Milestone[];
  onChange: (milestones: Milestone[]) => void;
  disabled?: boolean;
};

const MAX_MILESTONES = 20;

export const MilestoneInputList = ({
  milestones,
  onChange,
  disabled = false,
}: MilestoneInputListProps) => {
  const [text, setText] = useState("");

  const atLimit = milestones.length >= MAX_MILESTONES;

  const addMilestone = () => {
    const trimmed = text.trim();
    if (!trimmed || atLimit) return;
    onChange([
      ...milestones,
      { id: crypto.randomUUID(), text: trimmed, completed: false, completed_at: null },
    ]);
    setText("");
  };

  const removeMilestone = (id: string) => {
    onChange(milestones.filter((m) => m.id !== id));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addMilestone();
    }
  };

  return (
    <div className="space-y-2">
      <label className="block text-[10px] font-semibold uppercase tracking-wider text-[#93b0b4]">
        Milestones (optional)
      </label>

      <div className="flex gap-2">
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled || atLimit}
          placeholder={atLimit ? "Maximum reached" : "Add a milestone…"}
          className="flex-1 rounded-[6px] border border-[rgba(13,148,136,0.08)] bg-white px-3 py-1.5 text-[12.5px] text-[#0c1a1e] placeholder:text-[#93b0b4] focus:outline-none focus:ring-2 focus:ring-teal-500/30 disabled:opacity-50"
        />
        <button
          type="button"
          onClick={addMilestone}
          disabled={disabled || atLimit || !text.trim()}
          className="rounded-[6px] border border-teal-500 bg-white px-3 py-1.5 text-[12.5px] font-medium text-[#5a7d82] hover:bg-teal-50 disabled:opacity-40 disabled:hover:bg-white"
        >
          Add
        </button>
      </div>

      {atLimit && (
        <p className="text-[10px] text-[#93b0b4]">Maximum 20 milestones</p>
      )}

      {milestones.length > 0 && (
        <ul className="space-y-1">
          {milestones.map((m) => (
            <li
              key={m.id}
              className="flex items-center justify-between rounded-[4px] px-2 py-1 hover:bg-[rgba(13,148,136,0.03)]"
            >
              <span className="text-[12.5px] text-[#0c1a1e]">{m.text}</span>
              {!disabled && (
                <button
                  type="button"
                  onClick={() => removeMilestone(m.id)}
                  className="ml-2 text-[#93b0b4] hover:text-[#c06060]"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
