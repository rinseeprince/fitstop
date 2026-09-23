'use client'

import { Toaster as Sonner } from 'sonner'
import { X } from 'lucide-react'

import { cn } from '@/lib/utils'
import { FOCUS_RING } from '@/components/clients/training/program-builder/builder-tokens'

/**
 * The app's one toaster: Sonner, styled to the Teal-Summit card.
 *
 * Mounted once, by the root layout. A call site does `import { toast } from
 * "sonner"` and calls it directly — `toast.success(title, { description })`,
 * `toast.error(…)`, a plain `toast(title)` for a confirmation with no verdict,
 * and `action: { label: "Undo", onClick }` on the one toast that can take its
 * outcome back — there is no hook and no second toaster
 * (docs/newdesignsystem.md → Toasts).
 *
 * Why Sonner: a Radix toast is a DismissableLayer, so a modal opened after it
 * wrote `pointer-events: none` onto it — a toast under a drawer could not be
 * hovered or closed — and the Radix provider's close-timer pause flag was
 * shared across toasts and could go stale. Sonner is not a layer and pauses
 * per toast. Its toaster sits above every overlay; `pointer-events-auto` on
 * the toast keeps it clickable under a modal, and the Dialog and Sheet
 * primitives treat a press on it as no outside click (lib/toast-interaction.ts).
 *
 * ON THE IMPORTANT MODIFIER (`!`). Sonner injects its stylesheet at runtime,
 * unlayered. Tailwind v4 puts every utility in a cascade layer, and an
 * unlayered declaration beats a layered one whatever its specificity, so a
 * plain utility loses to Sonner on any property Sonner also declares on that
 * element. The card itself is exempt: `unstyled` switches Sonner's card off,
 * and the `toast` classes below ARE the card. The title, description, icon and
 * close button keep Sonner's own (un-gated) rules, so each utility here that
 * contests one of them carries `!`; a utility without `!` is one Sonner does
 * not contest. The toaster's font is the same story — Sonner names a system
 * stack on the list, so the body font is re-asserted.
 */

// The close timer, unchanged from the Radix toaster it replaces. Hovering a
// toast pauses it; the pause is per toast.
const TOAST_DURATION_MS = 5000

export function Toaster() {
  return (
    <Sonner
      position="bottom-right"
      duration={TOAST_DURATION_MS}
      closeButton
      className="font-sans!"
      icons={{ close: <X className="h-4 w-4" strokeWidth={1.5} /> }}
      toastOptions={{
        unstyled: true,
        classNames: {
          // The card. `group` lets the icon read the toast's type; the last
          // class hides a toast's content while it sits stacked behind the
          // front one — what Sonner does for its own card. The right padding
          // keeps the text clear of the always-visible close button.
          toast: cn(
            'group pointer-events-auto flex w-full items-center gap-1.5 rounded-[6px] border border-[rgba(13,148,136,0.08)] bg-white p-4 pr-9 text-[#0c1a1e] shadow-[0_6px_20px_rgba(13,148,136,0.10)]',
            'data-[type=success]:border-[rgba(13,148,136,0.20)] data-[type=error]:border-[rgba(185,28,28,0.20)] data-[type=warning]:border-[rgba(245,158,11,0.20)]',
            '[&[data-expanded=false][data-front=false]>*]:opacity-0',
          ),
          title: 'text-sm! font-semibold!',
          description: 'text-sm! opacity-90',
          // Sonner's own success / error glyphs, tinted by type.
          icon: 'group-data-[type=success]:text-[#0d9488] group-data-[type=error]:text-[#c06060] group-data-[type=warning]:text-[#d97706]',
          // The icon-action grammar, top-right inside the card. Sonner places
          // its close button half outside the top-left corner as a bordered
          // circle; every utility undoing that contests one of its rules.
          // Sonner also declares its own focus box-shadow, which is the
          // channel Tailwind's ring paints through — the last class re-asserts
          // that channel with importance so the imported FOCUS_RING is what
          // shows; its width and colour still come from the token alone.
          closeButton: cn(
            'left-auto! right-2! top-2! h-6! w-6! transform-none! rounded-[4px]! border-0! bg-transparent! text-[#93b0b4]! hover:text-[#5a7d82]!',
            FOCUS_RING,
            'focus-visible:shadow-none!',
          ),
          // A teal text action at the card's end (Undo). Sonner's own button
          // rules are off with the card; its margin and focus shadow are not,
          // so both are re-asserted, as on the close button.
          actionButton: cn(
            'ml-auto! shrink-0 cursor-pointer rounded-[4px] px-2 py-1 text-[13px] font-medium text-[#0d9488] transition-colors hover:bg-[rgba(13,148,136,0.08)] hover:text-[#0b7f75]',
            FOCUS_RING,
            'focus-visible:shadow-none!',
          ),
        },
      }}
    />
  )
}
