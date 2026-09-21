// Based on https://github.com/pwa-builder/PWABuilder/blob/main/docs/sw.js
//
// Offline support for static assets only.
//
// Two corrections to the template, both of which broke the app once the UI started
// talking to an API:
//
//  1. **API requests are not intercepted at all.** The template rewrote the URL of every
//     same-origin request to add a `cache-bust` query parameter. Against an API whose
//     query parameters are validated, that turned every call into a 400 - the listings
//     and the AI analysis simply never loaded. Beyond that, a stale-while-revalidate
//     cache in front of an API is wrong on its own terms: it can serve a stale listing,
//     and it can serve a response to a request that was never made to the server.
//
//  2. **Only GET requests are handled.** `cache.put()` throws a TypeError on any other
//     method, so the template silently swallowed an exception on every POST.
//
// The cache-busting query parameter is kept for same-origin *static* assets, which is
// what it was there for: static hosts serve them with a long max-age, and a service
// worker can otherwise pin a stale bundle indefinitely.

const HOSTNAME_WHITELIST = [
  self.location.hostname,
  'fonts.gstatic.com',
  'fonts.googleapis.com',
  'cdn.jsdelivr.net',
];

const CACHE_NAME = 'pwa-cache';

/** Paths that must always reach the network untouched. */
const isApiRequest = (url) => url.origin === self.location.origin && url.pathname.startsWith('/api/');

// Keep the protocol in step with the page, and add a cache-busting query to same-origin
// static assets so a long-lived CDN cache cannot pin a stale bundle.
const getFixedUrl = (req) => {
  const now = Date.now();
  const url = new URL(req.url);

  url.protocol = self.location.protocol;

  if (url.hostname === self.location.hostname) {
    url.search += (url.search ? '&' : '?') + 'cache-bust=' + now;
  }

  return url.href;
};

self.addEventListener('install', () => {
  // Take over as soon as the new worker is installed, so a fix like this one reaches
  // existing clients on their next load rather than whenever the last tab closes.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Anything that is not a plain GET - API writes, form posts - is left alone.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  if (isApiRequest(url)) return;
  if (HOSTNAME_WHITELIST.indexOf(url.hostname) === -1) return;

  // Stale-while-revalidate: answer with whichever of cache or network arrives first,
  // then refresh the cache from the network response.
  const cached = caches.match(request);
  const fetched = fetch(getFixedUrl(request), { cache: 'no-store' });
  const fetchedCopy = fetched.then((response) => response.clone());

  event.respondWith(
    Promise.race([fetched.catch(() => cached), cached])
      .then((response) => response || fetched)
      .catch(() => {
        /* Offline with nothing cached - let the browser show its own error. */
      })
  );

  event.waitUntil(
    Promise.all([fetchedCopy, caches.open(CACHE_NAME)])
      .then(([response, cache]) => response.ok && cache.put(request, response))
      .catch(() => {
        /* A failed cache write must never fail the request. */
      })
  );
});
