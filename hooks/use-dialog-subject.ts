"use client";

import { useCallback, useState } from "react";

/**
 * A dialog's two pieces of local state, kept apart on purpose: `open` is what
 * a close flips, the SUBJECT is what the body renders from — left alone by
 * the close and replaced by the next `show`. Radix keeps a closing card
 * mounted for its exit animation and re-renders it from live state, so a
 * subject that doubled as the open flag blanked the card mid-fade
 * (CONVENTIONS §7 → "No frame disagrees", rule 5). `show` lands both in one
 * update, so a click is one commit.
 *
 * `openKey` changes on every `show` and never on a close: key a surface that
 * holds local state (a form's fields, a pending flag) by it, and each open
 * mounts it fresh on its subject while a close leaves the closing card as it
 * was — a key on the subject's id would miss the same record opened twice.
 * Prefix it per surface (`edit-reading-${openKey}`): two dialogs mounted side
 * by side both start at 0, and sibling keys must differ.
 */
export function useDialogSubject<T>(): {
  subject: T | null;
  open: boolean;
  openKey: number;
  show: (subject: T) => void;
  close: () => void;
} {
  const [subject, setSubject] = useState<T | null>(null);
  const [open, setOpen] = useState(false);
  const [openKey, setOpenKey] = useState(0);
  const show = useCallback((next: T) => {
    setSubject(next);
    setOpen(true);
    setOpenKey((key) => key + 1);
  }, []);
  const close = useCallback(() => setOpen(false), []);
  return { subject, open, openKey, show, close };
}
