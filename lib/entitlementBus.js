/*
 * Tiny in-memory pub/sub so any page can tell the navbar to refetch
 * /api/entitlement after a credit-spending action. Browser-only.
 */
const subs = new Set();

export function subscribeEntitlement(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}

export function bumpEntitlement() {
  subs.forEach((fn) => {
    try { fn(); } catch {}
  });
}
