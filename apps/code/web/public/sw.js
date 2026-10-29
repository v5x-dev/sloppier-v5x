// Keep requests on the network so authenticated pages and live data are never
// served from a stale cache. Installation does not imply offline support.
self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request))
})
