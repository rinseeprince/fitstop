/**
 * Whether a click is the plain left click a link handler may intercept.
 *
 * A modified click (cmd / ctrl / shift / alt) or a non-primary button opens a
 * new tab, a new window or a download — the browser's business, and one that
 * cannot drop an in-memory draft — so a handler leaves those to the href.
 */
type ClickModifiers = {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
};

export function isPlainLeftClick(event: ClickModifiers): boolean {
  return (
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  );
}
