/**
 * The count every back arrow reads.
 *
 * Two numbers, stamped on every history entry the coach app creates:
 * - `coachDepth`: how many coach pages precede the entry in this session — 0
 *   on the first coach screen after login, on a pasted address and in a fresh
 *   tab; one more for every place the coach has pushed since.
 * - `coachPage`: the depth at which the current PAGE began — the first entry
 *   of the run of entries sharing this pathname (a client page and every tab
 *   and pane pushed inside it are one page).
 *
 * Browser Back is one step. A page's arrow LEAVES the page: it goes back over
 * every entry of the page to the one before it began, and to the page's parent
 * when the page began the count. A one-step return (the review's post-Send
 * return, an editor's own exit) goes back one entry. Either way the arrow and
 * the history agree.
 *
 * It RECORDS and never mirrors (CONVENTIONS §7): nothing renders from it but
 * an arrow's target, and it is read at click time, never during a render.
 *
 * How it stays right with no other state:
 * - Every entry carries its own numbers in `history.state`. The browser keeps
 *   that across a reload, and Next preserves custom keys at hydration and on
 *   Back/Forward, so a reload keeps its place and a traverse reads the entry
 *   it lands on.
 * - Next rewrites `history.state` on every push and replace, so the numbers
 *   are stamped by wrapping `pushState` / `replaceState` once per document —
 *   the same thing Next itself does — and forwarding the call. A push counts
 *   one more while a coach page is mounted, and zero while none is, so the
 *   first coach screen reached from the login page starts a fresh count; a
 *   push to another pathname begins a page; a replace keeps the entry's
 *   numbers.
 * - The wrapper is never uninstalled: Next captured it as its own original at
 *   hydration, and restoring the native methods would break that chain. The
 *   coach layout switches the count on and off instead.
 */
const DEPTH = "coachDepth";
const PAGE = "coachPage";

type Stamp = { depth: number; page: number };

let installed = false;
let active = false;
let depth = 0;
let page = 0;
let nativeReplaceState: History["replaceState"] | null = null;

function stampOf(state: unknown): Stamp | undefined {
  if (state === null || typeof state !== "object") return undefined;
  const record = state as Record<string, unknown>;
  const stampedDepth = record[DEPTH];
  const stampedPage = record[PAGE];
  if (typeof stampedDepth !== "number" || typeof stampedPage !== "number") return undefined;
  return { depth: stampedDepth, page: stampedPage };
}

function withStamp(data: unknown, stamp: Stamp): Record<string, unknown> {
  const base =
    data !== null && typeof data === "object" ? (data as Record<string, unknown>) : {};
  return { ...base, [DEPTH]: stamp.depth, [PAGE]: stamp.page };
}

/** Whether a navigation's URL leaves the current pathname — a new page. */
function changesPathname(url: string | URL | null | undefined): boolean {
  if (url === null || url === undefined) return false;
  return new URL(String(url), window.location.href).pathname !== window.location.pathname;
}

function install(): void {
  if (installed) return;
  installed = true;
  const history = window.history;
  const pushState = history.pushState.bind(history);
  const replaceState = history.replaceState.bind(history);
  nativeReplaceState = replaceState;
  history.pushState = (data, unused, url) => {
    const nextDepth = active ? depth + 1 : 0;
    // A page is a run of entries on one pathname: a push to another pathname
    // begins one, a push on the same pathname (a tab, a pane) belongs to it.
    const nextPage = active && !changesPathname(url) ? page : nextDepth;
    depth = nextDepth;
    page = nextPage;
    pushState(withStamp(data, { depth, page }), unused, url);
  };
  history.replaceState = (data, unused, url) => {
    const stamp = stampOf(data) ?? stampOf(history.state) ?? { depth, page };
    depth = stamp.depth;
    page = changesPathname(url) ? depth : stamp.page;
    replaceState(withStamp(data, { depth, page }), unused, url);
  };
  window.addEventListener("popstate", () => {
    const stamp = stampOf(history.state) ?? { depth: 0, page: 0 };
    depth = stamp.depth;
    page = stamp.page;
  });
}

/**
 * Starts counting from the current entry: its own stamp when it carries one
 * (a reload, a return), else zero. Returns the stop function for unmount.
 */
export function trackCoachHistory(): () => void {
  install();
  active = true;
  const stamp = stampOf(window.history.state) ?? { depth: 0, page: 0 };
  depth = stamp.depth;
  page = stamp.page;
  window.history.replaceState(withStamp(window.history.state, stamp), "");
  return () => {
    active = false;
  };
}

/** Whether a coach page precedes the current entry — one step back exists. */
export function hasCoachHistory(): boolean {
  return depth > 0;
}

/** Whether a coach page precedes the current PAGE — somewhere to leave it to. */
export function hasEntryBeforePage(): boolean {
  return page > 0;
}

/**
 * Leaves the current page: back over every entry of it to the entry before
 * it began, or `fallback` (the page's parent) when the page began the count.
 */
export function leaveCoachPage(fallback?: () => void): void {
  if (hasEntryBeforePage()) window.history.go(-(depth - page + 1));
  else fallback?.();
}

/**
 * The count, the switch and the current entry's stamp; the wrapper stays, as
 * it does in a browser. The stamp is cleared through the native method, so
 * the next test starts on an entry no count has seen.
 */
export function resetCoachHistoryForTests(): void {
  active = false;
  depth = 0;
  page = 0;
  nativeReplaceState?.({}, "");
}
