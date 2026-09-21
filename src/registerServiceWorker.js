/**
 * Service worker registration.
 *
 * Production only, deliberately. A caching service worker in development is a reliable
 * source of confusion: it serves stale bundles after a rebuild, and - until
 * `public/service-worker.js` was corrected - it rewrote the URL of every same-origin
 * request, which turned every validated API call into a 400. CRA's own template makes
 * the same production-only choice for the same reasons.
 *
 * Registration is also deferred to `load` and its failure is swallowed: offline support
 * is an enhancement, and a browser that cannot provide it must not break the app.
 */
export function registerServiceWorker() {
  if (process.env.NODE_ENV !== 'production') return;
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', () => {
    const url = `${process.env.PUBLIC_URL || ''}/service-worker.js`;

    navigator.serviceWorker.register(url).catch(() => {
      /* Offline support is optional. */
    });
  });
}

/** Removes any previously registered worker. Useful when debugging a stale cache. */
export function unregisterServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  navigator.serviceWorker.ready
    .then((registration) => registration.unregister())
    .catch(() => {
      /* Nothing registered. */
    });
}
