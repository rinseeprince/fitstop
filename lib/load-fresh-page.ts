/**
 * Leaves for `url` with a full page load. A fresh page keeps nothing of this
 * one: not the data it holds, nor the routes Next remembers (Next 16 keeps a
 * proxy's redirect for an address for up to five minutes, whoever is signed
 * in since). For the moment who is signed in changes: Log out
 * (contexts/auth-context.tsx).
 */
export function loadFreshPage(url: string): void {
  window.location.assign(url)
}
