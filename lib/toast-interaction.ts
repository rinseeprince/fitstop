// A toast is never an outside click.
//
// Radix dismisses a Dialog or Sheet on any pointer-down (and, when non-modal,
// any focus) outside its content that is not on one of its own DismissableLayer
// branches. Sonner's toaster is not a Radix layer, so pressing a toast's close
// button over an open drawer would read as an outside click and close the
// drawer under it. The Dialog and Sheet primitives wrap their outside-interaction
// handlers in `ignoringToasts`: an event from inside the toaster is neither a
// dismissal nor an outside interaction — Radix's default is prevented and the
// call site's handler is not run. One predicate for both primitives, so they
// cannot drift. The toaster is the only surface this covers: anything else
// that must work over a modal sheet is hosted inside that sheet's content.

const TOASTER_SELECTOR = "[data-sonner-toaster]";

interface OutsideEvent {
  target: EventTarget | null;
  preventDefault(): void;
}

function isToastInteraction(event: OutsideEvent): boolean {
  const target = event.target;
  const element =
    target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
  return element?.closest(TOASTER_SELECTOR) != null;
}

export function ignoringToasts<E extends OutsideEvent>(
  handler?: (event: E) => void,
): (event: E) => void {
  return (event) => {
    if (isToastInteraction(event)) {
      event.preventDefault();
      return;
    }
    handler?.(event);
  };
}
