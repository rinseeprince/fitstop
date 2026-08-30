"use client";

import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { CheckInFormPanel } from "./check-in-form-panel";
import type { Client } from "@/types/check-in";

/**
 * "Customise check-in" — which built-in fields this client is asked, and which
 * of the coach's own questions ride along.
 *
 * 780px right Sheet with a dark hero over an `#f4f7f6` body of railed white
 * cards: the `client-details-sheet.tsx` shape, because the body is groups of
 * cards and a white body would erase the rails.
 *
 * Entry is the Check-ins tab, not the Overview (D4.2): the tab owns this
 * client's check-ins, and ARCHITECTURE has the Overview as read-only.
 *
 * **This file is a shell and holds no data.** Everything inside `SheetContent`
 * is rendered by `CheckInFormPanel`, and Radix unmounts `SheetContent` when the
 * sheet closes — so the reads and the editor's draft state get a fresh
 * lifecycle per open for free, with no `enabled` flag, no seeding effect and no
 * "have I loaded yet?" ref. That structure is the fix for the reopen that hung.
 */
export function CheckInFormSheet({
  client,
  open,
  onOpenChange,
}: {
  client: Client;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        hideClose
        className="flex w-full flex-col gap-0 bg-[#f4f7f6] p-0 sm:w-[780px] sm:max-w-full"
      >
        <SheetTitle className="sr-only">
          Customise {client.name}&apos;s check-in
        </SheetTitle>
        <SheetDescription className="sr-only">
          Choose which fields this client is asked and add your own questions.
        </SheetDescription>

        <CheckInFormPanel client={client} onClose={() => onOpenChange(false)} />
      </SheetContent>
    </Sheet>
  );
}
