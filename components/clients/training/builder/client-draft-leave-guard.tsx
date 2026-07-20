"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useProgramDraft } from "@/components/clients/training/program-builder/program-draft-provider";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

// Soft-navigation guard for the client editor (Phase 5 follow-up).
//
// The client editor Dialog is non-modal so the app's 52px nav rail stays
// clickable (consistent with the rest of the app). But the rail's icons are
// Next <Link>s doing App Router soft navigation, which unmounts the client page
// and silently drops the in-memory client draft (it's never persisted — it only
// materializes onto the calendar on Apply). App Router has no route-change
// interception, so we catch outside <a href> clicks at the document capture
// phase (which runs before React's root listeners, so preventing default +
// stopping propagation blocks Next's Link handler) and confirm before leaving.
//
// Mounted INSIDE ProgramDraftProvider so it can read the live dirty/mode state.
// Scoped to the rail only — links inside the editor (role="dialog") pass through.
export function ClientDraftLeaveGuard() {
  const router = useRouter();
  const { isDirty, mode } = useProgramDraft();
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  useEffect(() => {
    // Only guard while there's something to lose.
    if (!(isDirty && mode === "edit")) return;

    const onClickCapture = (e: MouseEvent) => {
      // Let modified clicks (new tab / window / download) through — they don't
      // unmount the SPA, so the draft survives.
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
        return;
      }
      const el = e.target instanceof Element ? e.target : null;
      const anchor = el?.closest<HTMLAnchorElement>("a[href]");
      if (!anchor) return;
      // Links inside the editor surface itself are fine — only rail/app nav away
      // from the client page risks the draft.
      if (anchor.closest('[role="dialog"]')) return;
      if (anchor.target === "_blank" || anchor.hasAttribute("download")) return;

      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return; // external — leave alone
      const dest = `${url.pathname}${url.search}${url.hash}`;
      if (dest === `${window.location.pathname}${window.location.search}${window.location.hash}`) {
        return; // navigating to the current URL — nothing to guard
      }

      e.preventDefault();
      e.stopPropagation();
      setPendingHref(dest);
    };

    // Hard-reload / tab-close parity (the provider's beforeunload is gated to the
    // library builder; this covers the client editor). Cleaned up on unmount, so
    // Apply — which closes the overlay — de-arms it.
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };

    document.addEventListener("click", onClickCapture, true);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      document.removeEventListener("click", onClickCapture, true);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [isDirty, mode]);

  return (
    <ConfirmDialog
      open={pendingHref !== null}
      onOpenChange={(open) => !open && setPendingHref(null)}
      title="Discard unsaved changes?"
      description="You have unsaved changes to this program. Leaving now will discard them — they're only saved to the client once you apply."
      confirmLabel="Leave without applying"
      onConfirm={() => {
        const dest = pendingHref;
        setPendingHref(null);
        if (dest) router.push(dest);
      }}
    />
  );
}
