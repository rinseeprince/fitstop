/**
 * The count every back arrow reads.
 *
 * `depth` is how many coach pages precede the current history entry in this
 * session: 0 on the first coach screen after login, on a pasted address and in
 * a fresh tab; one more for every place the coach has pushed since. An arrow
 * calls the browser's Back while it is above zero and goes to its parent when
 * it is not, so the arrow and browser Back always agree.
 *
 * It RECORDS and never mirrors (CONVENTIONS §7): nothing renders from it but
 * an arrow's target, and it is read at click time, never during a render.
 *
 * How it stays right with no other state:
 * - Every entry carries its own depth in `history.state` (`coachDepth`). The
 *   browser keeps that across a reload, and Next preserves custom keys at
 *   hydration and on Back/Forward, so a reload keeps its place and a traverse
 *   reads the entry it lands on.
 * - Next rewrites `history.state` on every push and replace, so the depth is
 *   stamped by wrapping `pushState` / `replaceState` once per document — the
 *   same thing Next itself does — and forwarding the call. A push counts one
 *   more while a coach page is mounted, and zero while none is, so the first
 *   coach screen reached from the login page starts a fresh count; a replace
 *   keeps the entry's depth.
 * - The wrapper is never uninstalled: Next captured it as its own original at
 *   hydration, and restoring the native methods would break that chain. The
 *   coach layout switches the count on and off instead.
 */
const STAMP = "coachDepth";

let installed = false;
let active = false;
let depth = 0;
let nativeReplaceState: History["replaceState"] | null = null;

function stampOf(state: unknown): number | undefined {
  if (state === null || typeof state !== "object") return undefined;
  const value = (state as Record<string, unknown>)[STAMP];
  return typeof value === "number" ? value : undefined;
}

function withStamp(data: unknown, value: number): Record<string, unknown> {
  const base =
    data !== null && typeof data === "object" ? (data as Record<string, unknown>) : {};
  return { ...base, [STAMP]: value };
}

function install(): void {
  if (installed) return;
  installed = true;
  const history = window.history;
  const pushState = history.pushState.bind(history);
  const replaceState = history.replaceState.bind(history);
  nativeReplaceState = replaceState;
  history.pushState = (data, unused, url) => {
    depth = active ? depth + 1 : 0;
    pushState(withStamp(data, depth), unused, url);
  };
  history.replaceState = (data, unused, url) => {
    depth = stampOf(data) ?? stampOf(history.state) ?? depth;
    replaceState(withStamp(data, depth), unused, url);
  };
  window.addEventListener("popstate", () => {
    depth = stampOf(history.state) ?? 0;
  });
}

/**
 * Starts counting from the current entry: its own stamp when it carries one
 * (a reload, a return), else zero. Returns the stop function for unmount.
 */
export function trackCoachHistory(): () => void {
  install();
  active = true;
  depth = stampOf(window.history.state) ?? 0;
  window.history.replaceState(withStamp(window.history.state, depth), "");
  return () => {
    active = false;
  };
}

/** Whether a coach page precedes the current entry — read at click time. */
export function hasCoachHistory(): boolean {
  return depth > 0;
}

/**
 * The count, the switch and the current entry's stamp; the wrapper stays, as
 * it does in a browser. The stamp is cleared through the native method, so
 * the next test starts on an entry no count has seen.
 */
export function resetCoachHistoryForTests(): void {
  active = false;
  depth = 0;
  nativeReplaceState?.({}, "");
}
