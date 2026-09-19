// A toast or the assistant panel is never an outside click.
//
// Radix dismisses a Dialog or Sheet on any pointer-down (and, when non-modal,
// any focus) outside its content that is not on one of its own DismissableLayer
// branches. Two surfaces float above every dialog and sheet without being in
// their React trees: Sonner's toaster, and the program assistant's panel, a
// Radix layer of its own portaled to the body so it stays clickable and
// typeable over the modal session sheet. Pressing either over an open drawer
// would otherwise read as an outside click and close the drawer under it. The
// Dialog and Sheet primitives wrap their outside-interaction handlers in
// `ignoringOverlays`: an event from inside either surface is neither a
// dismissal nor an outside interaction — Radix's default is prevented and the
// call site's handler is not run. One predicate for both primitives, so they
// cannot drift.

const OVERLAY_SELECTOR = "[data-sonner-toaster], [data-assistant-dock]";

interface OutsideEvent {
  target: EventTarget | null;
  preventDefault(): void;
}

function isOverlayInteraction(event: OutsideEvent): boolean {
  const target = event.target;
  const element =
    target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
  return element?.closest(OVERLAY_SELECTOR) != null;
}

export function ignoringOverlays<E extends OutsideEvent>(
  handler?: (event: E) => void,
): (event: E) => void {
  return (event) => {
    if (isOverlayInteraction(event)) {
      event.preventDefault();
      return;
    }
    handler?.(event);
  };
}
