"use client";

import { Loader2, X } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { clientInitials } from "@/lib/client-initials";
import { getRosterStatus, rosterStatusLabel } from "@/lib/roster-views";
import { ConfirmStartEditDialog } from "@/components/clients/overview/confirm-start-edit-dialog";
import type { ClientProfileEdit } from "@/components/clients/overview/use-client-profile-edit";
import {
  HEADER_EYEBROW_CLASS,
  MONO,
} from "@/components/clients/training/program-builder/builder-tokens";
import { DetailsGroups } from "./details-groups";
import type { Client } from "@/types/check-in";
import type { CheckInTiming } from "@/types/coach-brief";

/**
 * Every editable fact about a client, in one 780px right sheet.
 *
 * This replaces inline editing inside the Overview's two cards. Those cards
 * turned eleven values into inputs in place, which meant the page had two
 * modes and the coach edited a phone number on a dark stat card. The fields
 * are the same; the surface is not.
 *
 * The hero + `#f4f7f6` body follow `session-editor-sheet.tsx` rather than the
 * white-bodied sheet recipe — the body is railed groups of white cards, and a
 * white body would erase the rails.
 *
 * **Save is four sequential, non-transactional requests** (profile → TDEE →
 * check-in config → goals), which is why `useClientProfileEdit` distinguishes
 * "Save failed" from "Partly saved". A single button hides that; the toast is
 * the only thing that can tell the coach an edit already landed.
 */
export function ClientDetailsSheet({
  client,
  checkInTiming,
  edit,
}: {
  client: Client;
  /** The brief's timing, for the read-only Next check-in field. */
  checkInTiming: CheckInTiming | null;
  edit: ClientProfileEdit;
}) {
  const status = rosterStatusLabel(getRosterStatus(client));

  return (
    <Sheet
      open={edit.isEditing}
      onOpenChange={(open) => {
        // A save in flight must finish; closing under it would leave the coach
        // unable to read which of the four writes landed.
        if (!open && !edit.isSaving) edit.cancel();
      }}
    >
      <SheetContent
        side="right"
        hideClose
        className="flex w-full flex-col gap-0 bg-[#f4f7f6] p-0 sm:w-[780px] sm:max-w-full"
      >
        <SheetTitle className="sr-only">Edit {client.name}</SheetTitle>
        <SheetDescription className="sr-only">
          Contact details, profile, check-in schedule, baseline measurements, goals and energy.
        </SheetDescription>

        <header className="flex shrink-0 items-center gap-3.5 bg-[#0f2027] px-5 py-4">
          <span
            className="grid h-11 w-11 shrink-0 place-items-center rounded-[6px] text-[14px] font-semibold text-white"
            style={{ background: "linear-gradient(135deg, #0d9488, #0f766e)" }}
            aria-hidden
          >
            {clientInitials(client.name)}
          </span>
          <div className="min-w-0">
            <p className={HEADER_EYEBROW_CLASS}>Client</p>
            <p className="mt-0.5 truncate text-[17px] font-semibold leading-tight tracking-[-0.01em] text-white">
              {client.name}
            </p>
            <p className="mt-0.5 truncate text-[11px] text-[rgba(255,255,255,0.3)]">
              {status}
              {client.startDate && (
                <>
                  {" · started "}
                  <span className={MONO}>{client.startDate}</span>
                </>
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={edit.cancel}
            disabled={edit.isSaving}
            aria-label="Close"
            className="ml-auto self-start rounded p-1 text-[rgba(255,255,255,0.35)] transition-colors hover:text-white disabled:opacity-50"
          >
            <X className="h-4 w-4" strokeWidth={1.5} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <DetailsGroups
            client={client}
            checkInTiming={checkInTiming}
            edit={edit}
            status={status}
          />
        </div>

        <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-[rgba(13,148,136,0.08)] bg-white px-5 py-3">
          <Button variant="ghost" onClick={edit.cancel} disabled={edit.isSaving}>
            Cancel
          </Button>
          <Button
            onClick={() => void edit.requestSave()}
            disabled={edit.isSaving}
            className={cn("bg-[#0d9488] text-white hover:bg-[#0b7f75]")}
          >
            {edit.isSaving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Save changes
          </Button>
        </footer>

        {/* Mounted beside the commit, not in a host: correcting a recorded
            start overwrites a fact nothing can recover, and no future host
            should be able to mount this form and forget the guard. */}
        <ConfirmStartEditDialog
          open={edit.confirmStartOpen}
          edits={edit.startEdits}
          clientName={edit.clientName}
          isSaving={edit.isSaving}
          onCancel={() => edit.setConfirmStartOpen(false)}
          onConfirm={edit.confirmStartEdit}
        />
      </SheetContent>
    </Sheet>
  );
}
