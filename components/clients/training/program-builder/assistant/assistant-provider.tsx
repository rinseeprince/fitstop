"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { useAssistantChat } from "./use-assistant-chat";

// The program assistant's state (builder S6a), owned once above both of the
// panel's hosts: the chat (use-assistant-chat.ts — the transcript, a pending
// preview, busy, send, undo), whether the panel is open, and the command being
// typed. ProgramBuilder mounts this above the session sheet and the corner
// dock, and the panel is hosted by whichever of the two is on top. A component
// that moves between hosts remounts, so nothing the coach would miss may live
// in the panel itself: the transcript, a pending preview, a half-typed command
// and the panel being open all survive a session opening or closing and the
// panel collapsing. `open` is here rather than in the dock because the session
// sheet's footer button opens the same panel. Mounted only inside
// ProgramBuilder, under ProgramDraftProvider, which the chat hook reads; the
// conversation dies with that provider's remount (a template switch) by
// design — it is about THIS draft.
type AssistantContextValue = ReturnType<typeof useAssistantChat> & {
  open: boolean;
  setOpen: (open: boolean) => void;
  input: string;
  setInput: (input: string) => void;
};

const AssistantContext = createContext<AssistantContextValue | null>(null);

export function useAssistant(): AssistantContextValue {
  const value = useContext(AssistantContext);
  if (!value) {
    throw new Error("useAssistant must be used inside AssistantProvider");
  }
  return value;
}

export function AssistantProvider({ children }: { children: ReactNode }) {
  const chat = useAssistantChat();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");

  const value: AssistantContextValue = { ...chat, open, setOpen, input, setInput };

  return <AssistantContext.Provider value={value}>{children}</AssistantContext.Provider>;
}
