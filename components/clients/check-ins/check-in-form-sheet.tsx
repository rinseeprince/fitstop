"use client";

import { useState } from "react";
import { BookmarkPlus, ChevronDown, Loader2, SlidersHorizontal, X } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SectionLabel } from "@/components/programs/shared/section-label";
import { cn } from "@/lib/utils";
import { pluralize } from "@/components/clients/overview/overview-format";
import {
  FOCUS_RING,
  HEADER_EYEBROW_CLASS,
  LABEL_CLASS,
} from "@/components/clients/training/program-builder/builder-tokens";
import { CHECK_IN_FORM_FIELD_KEYS } from "@/lib/check-in/form-fields";
import { CheckInFormFieldsCard } from "./check-in-form-fields-card";
import { CheckInFormQuestionsCard } from "./check-in-form-questions-card";
import { useCheckInFormEditor } from "./use-check-in-form-editor";
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
  const editor = useCheckInFormEditor({
    clientId: client.id,
    open,
    onClose: () => onOpenChange(false),
  });
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [templateName, setTemplateName] = useState("");

  const enabledCount = editor.fields.length;

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        // A save in flight must finish — closing under it leaves the coach
        // unable to tell whether it landed.
        if (!next && editor.isSaving) return;
        onOpenChange(next);
      }}
    >
      <SheetContent
        side="right"
        hideClose
        className="flex w-full flex-col gap-0 bg-[#f4f7f6] p-0 sm:w-[780px] sm:max-w-full"
      >
        <SheetTitle className="sr-only">Customise {client.name}&apos;s check-in</SheetTitle>
        <SheetDescription className="sr-only">
          Choose which fields this client is asked and add your own questions.
        </SheetDescription>

        <header className="flex shrink-0 items-center gap-3.5 bg-[#0f2027] px-5 py-4">
          <span
            className="grid h-11 w-11 shrink-0 place-items-center rounded-[6px] bg-[rgba(13,148,136,0.15)] text-[#0d9488]"
            aria-hidden
          >
            <SlidersHorizontal className="h-4 w-4" strokeWidth={1.5} />
          </span>
          <div className="min-w-0">
            <p className={HEADER_EYEBROW_CLASS}>Check-in form</p>
            <p className="mt-0.5 truncate text-[17px] font-semibold leading-tight tracking-[-0.01em] text-white">
              {client.name}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={editor.isSaving}
            aria-label="Close"
            className="ml-auto self-start rounded p-1 text-[rgba(255,255,255,0.35)] transition-colors hover:text-white disabled:opacity-50"
          >
            <X className="h-4 w-4" strokeWidth={1.5} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {editor.isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-5 w-5 animate-spin text-[#93b0b4]" />
            </div>
          ) : editor.isError ? (
            <div className="rounded-[6px] bg-white p-6 text-center">
              <p className="text-sm text-[#93b0b4]">Failed to load the check-in form.</p>
            </div>
          ) : (
            <>
              <div className="mb-5 flex items-center justify-between gap-3 rounded-[6px] bg-white px-[18px] py-4">
                <div className="min-w-0">
                  <p className={LABEL_CLASS}>Start from a template</p>
                  <p className="mt-1 text-[11px] text-[#93b0b4]">
                    Replaces everything below. Nothing is saved until you save changes.
                  </p>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      disabled={editor.templates.length === 0}
                      title={
                        editor.templates.length === 0
                          ? "Save a form as a template to reuse it here"
                          : undefined
                      }
                      className={cn(
                        "flex shrink-0 items-center gap-1 rounded-[6px] px-2 py-1 text-[11px] font-medium text-[#93b0b4] transition-colors",
                        "hover:bg-[rgba(13,148,136,0.05)] hover:text-[#0d9488] data-[state=open]:bg-[rgba(13,148,136,0.05)]",
                        "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-[#93b0b4]",
                        FOCUS_RING
                      )}
                    >
                      Choose a template
                      <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.5} />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" sideOffset={6} className="w-52">
                    {editor.templates.map((template) => (
                      <DropdownMenuItem
                        key={template.id}
                        onSelect={() => editor.applyTemplate(template)}
                      >
                        {template.name}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              <SectionLabel
                label="Fields"
                meta={`${enabledCount}/${CHECK_IN_FORM_FIELD_KEYS.length} on`}
              />
              <CheckInFormFieldsCard
                fields={editor.fields}
                onToggle={editor.toggleField}
                clientName={client.name}
              />

              <SectionLabel
                label="Your questions"
                meta={
                  editor.questions.length > 0
                    ? pluralize(editor.questions.length, "question")
                    : undefined
                }
              />
              <CheckInFormQuestionsCard editor={editor} />
            </>
          )}
        </div>

        <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-[rgba(13,148,136,0.08)] bg-white px-5 py-3">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={editor.isSaving}
          >
            Cancel
          </Button>
          <Button
            variant="outline"
            disabled={editor.isSaving || editor.isLoading}
            onClick={() => {
              setTemplateName("");
              setTemplateDialogOpen(true);
            }}
          >
            <BookmarkPlus className="mr-1.5 h-4 w-4" strokeWidth={1.5} />
            Save as template
          </Button>
          <Button
            onClick={() => void editor.save()}
            disabled={editor.isSaving || editor.isLoading}
            className="bg-[#0d9488] text-white hover:bg-[#0b7f75]"
          >
            {editor.isSaving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Save changes
          </Button>
        </footer>

        {/* Saves what is ON SCREEN, unsaved edits included — a coach shaping a
            form and banking it before committing it to this client is the
            gesture. So a template can exist from a state this client never had. */}
        <Dialog open={templateDialogOpen} onOpenChange={setTemplateDialogOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Save as template</DialogTitle>
            </DialogHeader>
            <div className="space-y-1.5 py-1">
              <Label htmlFor="check-in-template-name">Template name</Label>
              <Input
                id="check-in-template-name"
                value={templateName}
                maxLength={80}
                onChange={(event) => setTemplateName(event.target.value)}
                placeholder="e.g. Fat-loss weekly"
              />
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setTemplateDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                disabled={templateName.trim() === "" || editor.isSaving}
                onClick={() => {
                  void editor
                    .saveAsTemplate(templateName.trim())
                    .then(() => setTemplateDialogOpen(false))
                    .catch(() => {
                      /* the editor toasts; the dialog stays open to retry */
                    });
                }}
                className="bg-[#0d9488] text-white hover:bg-[#0b7f75]"
              >
                {editor.isSaving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                Save template
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </SheetContent>
    </Sheet>
  );
}
