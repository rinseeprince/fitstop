"use client";

import { Plus, Moon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Inline "add new session" form for the draft editor. A null `draft` means the
 * form is collapsed into the two call-to-action buttons; a string (including
 * "") means the input is open.
 *
 * Parent owns the `draft` state so it can close the form after a successful
 * add (e.g. `onDraftChange(null)` inside the addSession success path). The
 * form itself is purely presentational.
 */
export function SessionForm({
  draft,
  onDraftChange,
  onAdd,
  onAddRest,
}: {
  draft: string | null;
  onDraftChange: (next: string | null) => void;
  onAdd: (name: string) => void;
  onAddRest: () => void;
}) {
  if (draft !== null) {
    const trimmed = draft.trim();
    return (
      <div className="flex items-center gap-2 px-4 py-3 rounded-[8px] border border-dashed border-[rgba(13,148,136,0.3)] bg-white">
        <Input
          autoFocus
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && trimmed) {
              onAdd(trimmed);
            } else if (e.key === "Escape") {
              onDraftChange(null);
            }
          }}
          placeholder="Session name (e.g., Upper Body)"
          className="flex-1 h-9 text-[13px]"
        />
        <Button
          size="sm"
          onClick={() => trimmed && onAdd(trimmed)}
          disabled={!trimmed}
        >
          Add
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onDraftChange(null)}>
          Cancel
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 pt-1">
      <Button
        variant="outline"
        size="sm"
        onClick={() => onDraftChange("")}
        className="border-[rgba(13,148,136,0.2)] text-[#5a7d82] hover:bg-[rgba(13,148,136,0.04)] hover:text-[#0c1a1e]"
      >
        <Plus className="h-3.5 w-3.5 mr-1" />
        Add Session
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={onAddRest}
        className="border-[rgba(148,163,184,0.3)] text-[#64748b] hover:bg-[rgba(148,163,184,0.08)] hover:text-[#0c1a1e]"
      >
        <Moon className="h-3.5 w-3.5 mr-1" />
        Add Rest Day
      </Button>
    </div>
  );
}
